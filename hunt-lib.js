/* Shared logic for the daily hunt updaters (CLI + web UI). */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const vm = require("vm");

const ROOT = __dirname;
const INDEX = path.join(ROOT, "index.html");
const SITEMAP = path.join(ROOT, "sitemap.xml");
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const STOP = new Set(("the a an on in at of to is it where not and or for with your you we be this that " +
  "day today daily hunt find look clue gem its there here when what how get go one first new").split(" "));

function fmtDate(d) { d = d || new Date(); return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }

function esc(s) {
  return String(s).trim()
    .replace(/\\u([0-9a-fA-F]{4})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
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

function lev1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++; else if (la < lb) j++; else { i++; j++; }
  }
  return true;
}

/* Score every venue against the clue text using names, areas, hours and activity names.
   Unmatched clue tokens get a one-typo fuzzy pass against venue words (>=4 chars). */
function suggest(clue, venues, acts) {
  const clueTokens = tokens(clue);
  const actsByVenue = {};
  (acts || []).forEach(function (a) {
    (actsByVenue[a[0]] = actsByVenue[a[0]] || []).push(a[1] + " " + (a[4] || ""));
  });
  const allVenueTokens = [];
  venues.forEach(function (v) {
    const hay = v[0] + " " + v[1] + " " + (v[3] || "") + " " + (v[4] || "") +
      " " + (actsByVenue[v[0]] || []).join(" ");
    tokens(hay).forEach(function (t) { if (t.length >= 4) allVenueTokens.push(t); });
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
      else if (t.length >= 4) {
        let fuzzy = 0;
        for (let k = 0; k < allVenueTokens.length && fuzzy < 2; k++) {
          const w = allVenueTokens[k];
          if (w !== t && lev1(t, w)) { score += 1; hits.push(t + "~" + w); fuzzy++; }
        }
      }
    });
    return { venue: v[0], area: v[1], score: score, hits: hits };
  }).filter(function (r) { return r.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 5);
}

function loadData() {
  const src = fs.readFileSync(INDEX, "utf8");
  return { src: src, venues: extractArray(src, "VENUES") || [], acts: extractArray(src, "ACTIVITIES") || [] };
}

/* Best automatic answer. Returns { answer, candidates }; answer is null when
   no candidate scores high enough to be trusted on its own. */
function bestAnswer(clue) {
  const d = loadData();
  const list = suggest(clue, d.venues, d.acts);
  if (!list.length || list[0].score < 3) return { answer: null, candidates: list };
  const t = list[0];
  return {
    answer: t.venue + ", " + t.area + " \u2014 matches " + t.hits.slice(0, 3).join("/") + " in the clue",
    candidates: list
  };
}

/* Write the new hunt entry + sitemap date, rebuild dist. Returns log lines. */
function applyUpdate(clue, answer, confirmed) {
  const today = fmtDate();
  const status = confirmed
    ? "Confirmed \\u00b7 gem found there on " + today
    : "Candidate \\u00b7 best reading of the riddle; gem not claimed yet";
  const log = [];

  let html = fs.readFileSync(INDEX, "utf8");
  const entryRe = /var HUNT_LOG = \[\s*\{ d: "(?:[^"\\]|\\.)*", c: "(?:[^"\\]|\\.)*", a: "(?:[^"\\]|\\.)*", s: "(?:[^"\\]|\\.)*" \}/;
  if (!entryRe.test(html)) throw new Error("HUNT_LOG entry not found in index.html");
  html = html.replace(entryRe,
    'var HUNT_LOG = [\n    { d: "' + esc(today) + '", c: "' + esc(clue) + '", a: "' + esc(answer) + '", s: "' + status + '" \}');
  fs.writeFileSync(INDEX, html);
  log.push("index.html updated");

  let sm = fs.readFileSync(SITEMAP, "utf8");
  const smOk = /(<loc>https:\/\/lagoslife\.homes\/daily-hunt<\/loc><lastmod>)\d{4}-\d{2}-\d{2}(<\/lastmod>)/.test(sm);
  if (smOk) {
    sm = sm.replace(
      /(<loc>https:\/\/lagoslife\.homes\/daily-hunt<\/loc><lastmod>)\d{4}-\d{2}-\d{2}(<\/lastmod>)/,
      "$1" + new Date().toISOString().slice(0, 10) + "$2"
    );
    fs.writeFileSync(SITEMAP, sm);
    log.push("sitemap.xml updated");
  }

  cp.execSync("node build.js", { cwd: ROOT, stdio: "pipe" });
  log.push("dist/ rebuilt (68 pages)");
  return log;
}

function shOut(cmd) {
  return cp.execSync(cmd, { cwd: ROOT, stdio: "pipe" }).toString().trim();
}

/* Commit + push with the proxy/direct retry loop. Returns { ok, log }. */
function pushUpdate() {
  const log = [];
  try {
    shOut("git add index.html sitemap.xml");
    shOut("git commit -m \"Daily hunt: " + fmtDate() + " clue\"");
    log.push("committed");
  } catch (e) {
    log.push("commit skipped (" + String(e.message).split("\n")[0].slice(0, 80) + ")");
  }
  const cmds = [
    ["proxy", "git -c http.proxy=http://127.0.0.1:7897 push origin main"],
    ["direct", "git -c http.proxy= push origin main"]
  ];
  for (let i = 0; i < 8; i++) {
    for (const c of cmds) {
      try { shOut(c[1]); log.push("pushed via " + c[0]); return { ok: true, log: log }; }
      catch (e) { /* retry */ }
    }
    try { cp.execSync("ping -n 4 127.0.0.1 > nul", { stdio: "pipe" }); } catch (e) { }
  }
  log.push("PUSH FAILED after retries");
  return { ok: false, log: log };
}

module.exports = {
  fmtDate: fmtDate, esc: esc, extractArray: extractArray, tokens: tokens,
  suggest: suggest, loadData: loadData, bestAnswer: bestAnswer,
  applyUpdate: applyUpdate, pushUpdate: pushUpdate
};
