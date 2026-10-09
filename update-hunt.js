#!/usr/bin/env node
/*
 * Daily hunt updater for lagoslife.homes
 *
 * Usage:
 *   node update-hunt.js                          -> interactive prompts
 *   node update-hunt.js --clue "..." --answer "..." [--confirmed] [--yes] [--no-push]
 *
 * What it does:
 *   1. Replaces the first entry of HUNT_LOG in index.html (date / clue / where to look / status)
 *   2. Bumps the /daily-hunt lastmod date in sitemap.xml to today
 *   3. Runs node build.js (pre-renders dist/)
 *   4. Commits index.html + sitemap.xml and pushes (proxy -> direct retry loop)
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const readline = require("readline");

const ROOT = __dirname;
const INDEX = path.join(ROOT, "index.html");
const SITEMAP = path.join(ROOT, "sitemap.xml");
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseArgs() {
  const a = process.argv.slice(2), out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--clue") out.clue = a[++i];
    else if (a[i] === "--answer") out.answer = a[++i];
    else if (a[i] === "--confirmed") out.confirmed = true;
    else if (a[i] === "--yes") out.yes = true;
    else if (a[i] === "--no-push") out.noPush = true;
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

function ask(rl, q, def) {
  return new Promise(function (res) {
    rl.question(q, function (v) { res(v.trim() || def || ""); });
  });
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
    process.exit(0);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const today = fmtDate(new Date());

  const clue = args.clue || await ask(rl, "Today's clue (copy from the game): ");
  const answer = args.answer || await ask(rl, "Where to look (venue + area): ");
  let confirmed = args.confirmed;
  if (confirmed === undefined) {
    const c = await ask(rl, "Gem confirmed there? (y/N): ", "");
    confirmed = /^y/i.test(c);
  }
  rl.close();

  if (!clue || !answer) { console.error("clue and answer are required"); process.exit(1); }

  const status = confirmed
    ? "Confirmed \\u00b7 gem found there on " + today
    : "Candidate \\u00b7 best reading of the riddle; gem not claimed yet";

  console.log("\n--- will write ---");
  console.log("date:    " + today);
  console.log("clue:    " + clue);
  console.log("answer:  " + answer);
  console.log("status:  " + status.replace("\\u00b7", "\u00b7"));
  if (!args.yes) {
    const ok = await (function () {
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise(function (res) {
        rl2.question("Apply? (Y/n): ", function (v) { rl2.close(); res(!/^n/i.test(v || "")); });
      });
    })();
    if (!ok) { console.log("aborted"); process.exit(0); }
  }

  let html = fs.readFileSync(INDEX, "utf8");
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
