#!/usr/bin/env node
/*
 * Daily hunt updater for lagoslife.homes
 *
 * Usage:
 *   node update-hunt.js                          -> interactive: paste clue, pick a suggested answer
 *   node update-hunt.js --clue "..." --answer "..." [--confirmed] [--yes] [--no-push]
 *   node update-hunt.js --suggest "clue text"    -> only print candidate answers, change nothing
 *
 * What it does:
 *   1. Reads the clue, scores every venue on the site against it (name/area/activities) and shows top matches
 *   2. Replaces the first entry of HUNT_LOG in index.html (date / clue / where to look / status)
 *   3. Bumps the /daily-hunt lastmod date in sitemap.xml to today
 *   4. Runs node build.js (pre-renders dist/)
 *   5. Commits index.html + sitemap.xml and pushes (proxy -> direct retry loop)
 *
 * The suggested answer is marked "Candidate" unless you pass --confirmed.
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const vm = require("vm");
const readline = require("readline");

const ROOT = __dirname;
const INDEX = path.join(ROOT, "index.html");
const SITEMAP = path.join(ROOT, "sitemap.xml");
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const STOP = new Set(("the a an on in at of to is it where not and or for with your you we be this that " +
  "day today daily hunt find look clue gem its there here when what how get go one first new").split(" "));

function parseArgs() {
  const a = process.argv.slice(2), out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--clue") out.clue = a[++i];
    else if (a[i] === "--answer") out.answer = a[++i];
    else if (a[i] === "--confirmed") out.confirmed = true;
    else if (a[i] === "--yes") out.yes = true;
    else if (a[i] === "--no-push") out.noPush = true;
    else if (a[i] === "--suggest") { out.suggestOnly = a[++i]; }
    else if (a[i] === "--help" || a[i] === "-h") out.help = true;
  }
  return out;
}

function fmtDate(d) { return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }

function esc(s) {
  return String(s).trim()
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/</g, "\\u003C");
}

/* Extract a `var NAME = [ ... ];` array literal from index.html and evaluate it. */
function extractArray(src, name) {
  const start = src.indexOf("var " + name + " = [");
  if (start < 0) return null;
  const bodyStart = src.indexOf("[", start);
  let depth = 0, end = -1, inStr = false, q = "";
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === "\\") i++; else if (ch === q) inStr = false; continue; }
    if (ch === "\"" || ch === "'") { inStr = true; q = ch; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return vm.runInNewContext("(" + src.slice(bodyStart, end + 1) + ")"); }
  catch (e) { return null; }
}

function tokens(s) {
  return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(function (t) {
    return t.length > 1 && !STOP.has(t);
  });
}

/* Score every venue against the clue text using names, areas and activity names. */
function suggest(clue, venues, acts) {
  const clueTokens = tokens(clue);
  const actsByVenue = {};
  (acts || []).forEach(function (a) {
    (actsByVenue[a[0]] = actsByVenue[a[0]] || []).push(a[1] + " " + (a[4] || ""));
  });
  return venues.map(function (v) {
    const hay = v[0] + " " + v[1] + " " + (v[2] || "") + " " + (v[3] || "") + " " + (v[4] || "") +
      " " + (actsByVenue[v[0]] || []).join(" ");
    const hayL = hay.toLowerCase(), hayTokens = new Set(tokens(hay));
    let score = 0, hits = [];
    clueTokens.forEach(function (t) {
      const stem = t.replace(/(es|s)$/, "");
      if (hayTokens.has(t) || hayTokens.has(stem)) { score += 3; hits.push(t); }
      else if (hayL.indexOf(t) >= 0 || (stem.length > 3 && hayL.indexOf(stem) >= 0)) { score += 1; hits.push(t); }
    });
    return { venue: v[0], area: v[1], score: score, hits: hits };
  }).filter(function (r) { return r.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 5);
}

function printSuggestions(clue, venues, acts) {
  const list = suggest(clue, venues, acts);
  if (!list.length) { console.log("no keyword matches — think in terms of place types: water, market, night, sport, school"); return list; }
  console.log("\nCandidate answers (best guess first):");
  list.forEach(function (r, i) {
    console.log("  " + (i + 1) + ". " + r.venue + " (" + r.area + ")  [score " + r.score + " · " + r.hits.join(", ") + "]");
  });
  return list;
}

function ask(rl, q) {
  return new Promise(function (res) { rl.question(q, function (v) { res(v.trim()); }); });
}

function sh(cmd) {
  return cp.execSync(cmd, { cwd: ROOT, stdio: "pipe" }).toString().trim();
}

function pushWithRetry() {
  const cmds = [
    "git -c http.proxy=http://127.0.0.1:7897 push origin main",
    "git -c http.proxy= push origin main"
  ];
  for (let i = 0; i < 8; i++) {
    for (const c of cmds) {
      try { sh(c); console.log("pushed via " + (c.indexOf("127.0.0.1") >= 0 ? "proxy" : "direct")); return true; }
      catch (e) { /* retry */ }
    }
    cp.execSync("ping -n 4 127.0.0.1 > nul");
  }
  return false;
}

(async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log("node update-hunt.js [--clue \"...\"] [--answer \"...\"] [--confirmed] [--yes] [--no-push]");
    console.log("node update-hunt.js --suggest \"clue text\"   (print candidates only)");
    process.exit(0);
  }

  const src = fs.readFileSync(INDEX, "utf8");
  const venues = extractArray(src, "VENUES") || [];
  const acts = extractArray(src, "ACTIVITIES") || [];
  if (!venues.length) { console.error("could not read VENUES from index.html"); process.exit(1); }

  /* suggest-only mode */
  if (args.suggestOnly) { printSuggestions(args.suggestOnly, venues, acts); process.exit(0); }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const today = fmtDate(new Date());

  let clue = args.clue;
  let answer = args.answer;

  if (!clue) clue = await ask(rl, "Today's clue (copy from the game): ");
  if (!clue) { console.error("clue is required"); process.exit(1); }

  if (!answer) {
    const list = printSuggestions(clue, venues, acts);
    if (list.length) {
      const pick = await ask(rl, "Pick 1-" + list.length + ", or type your own answer: ");
      const n = parseInt(pick, 10);
      if (n >= 1 && n <= list.length) {
        answer = list[n - 1].venue + ", " + list[n - 1].area + " \u2014 matches " + list[n - 1].hits.slice(0, 3).join("/") + " in the clue";
      } else if (pick) { answer = pick; }
    }
    if (!answer) answer = await ask(rl, "Where to look (venue + area): ");
  }
  if (!answer) { console.error("answer is required"); process.exit(1); }

  let confirmed = args.confirmed;
  if (confirmed === undefined && process.stdin.isTTY) {
    const c = await ask(rl, "Gem confirmed there? (y/N): ");
    confirmed = /^y/i.test(c);
  }
  if (confirmed === undefined) confirmed = false;
  rl.close();

  const status = confirmed
    ? "Confirmed \\u00b7 gem found there on " + today
    : "Candidate \\u00b7 best reading of the riddle; gem not claimed yet";

  console.log("\n--- will write ---");
  console.log("date:    " + today);
  console.log("clue:    " + clue);
  console.log("answer:  " + answer);
  console.log("status:  " + status.replace("\\u00b7", "\u00b7"));
  if (!args.yes && process.stdin.isTTY) {
    const ok = await (function () {
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise(function (res) {
        rl2.question("Apply? (Y/n): ", function (v) { rl2.close(); res(!/^n/i.test(v || "")); });
      });
    })();
    if (!ok) { console.log("aborted"); process.exit(0); }
  }

  let html = src;
  const entryRe = /var HUNT_LOG = \[\s*\{ d: "(?:[^"\\]|\\.)*", c: "(?:[^"\\]|\\.)*", a: "(?:[^"\\]|\\.)*", s: "(?:[^"\\]|\\.)*" \}/;
  if (!entryRe.test(html)) { console.error("HUNT_LOG entry not found in index.html"); process.exit(1); }
  html = html.replace(entryRe,
    'var HUNT_LOG = [\n    { d: "' + esc(today) + '", c: "' + esc(clue) + '", a: "' + esc(answer) + '", s: "' + status + '" \}');
  fs.writeFileSync(INDEX, html);

  let sm = fs.readFileSync(SITEMAP, "utf8");
  sm = sm.replace(
    /(<loc>https:\/\/lagoslife\.homes\/daily-hunt<\/loc><lastmod>)\d{4}-\d{2}-\d{2}(<\/lastmod>)/,
    "$1" + new Date().toISOString().slice(0, 10) + "$2"
  );
  fs.writeFileSync(SITEMAP, sm);

  console.log("index.html + sitemap.xml updated");
  sh("node build.js");
  console.log("dist/ rebuilt");

  if (args.noPush) { console.log("done (--no-push, nothing committed)"); process.exit(0); }

  sh("git add index.html sitemap.xml");
  sh("git commit -m \"Daily hunt: " + today + " clue\"");
  if (pushWithRetry()) console.log("live in ~60-90s (Cloudflare build)");
  else { console.error("PUSH FAILED — run the push retry loop manually"); process.exit(1); }
})().catch(function (e) { console.error(e.message); process.exit(1); });
