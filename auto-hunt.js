#!/usr/bin/env node
/*
 * Fully automatic daily hunt updater (no human step).
 *
 * Pulls the live clue from the game's public feed, works out the most likely
 * hiding place with hunt-lib's matcher, prepends the entry to the clue log,
 * rebuilds the site and (unless --no-push) commits + pushes. Cloudflare Pages
 * redeploys on the push. Scheduled by .github/workflows/daily-hunt.yml.
 *
 * Usage:
 *   node auto-hunt.js             fetch -> update -> build -> commit -> push
 *   node auto-hunt.js --no-push   fetch -> update -> build only
 *   node auto-hunt.js --dry-run   fetch + show the pick, change nothing
 *
 * The game resets at ~00:00 WAT (23:00 UTC); the "day"/"clue" fields come
 * straight from the feed, so the run is idempotent no matter how often it fires.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const lib = require("./hunt-lib");

const ROOT = __dirname;
const INDEX = path.join(ROOT, "index.html");
const API = process.env.HUNT_API || "https://lagoslife.app/api/hunt";

function fetchJSON(url) {
  return new Promise(function (resolve, reject) {
    const req = https.get(url, {
      headers: { "User-Agent": "lagoslife-homes-bot/1.0 (+https://lagoslife.homes)", Accept: "application/json" },
      timeout: 25000
    }, function (res) {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode + " from " + url)); }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", function (c) { body += c; });
      res.on("end", function () {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error("bad JSON from " + url)); }
      });
    });
    req.on("timeout", function () { req.destroy(new Error("timeout fetching " + url)); });
    req.on("error", reject);
  });
}

(function main() {
  const args = process.argv.slice(2);
  const dryRun = args.indexOf("--dry-run") >= 0;
  const noPush = dryRun || args.indexOf("--no-push") >= 0;

  return fetchJSON(API).then(function (j) {
    const clue = String(j.clue || "").trim();
    if (!clue) throw new Error("the hunt feed returned no clue");
    const iso = String(j.day || "").trim() || new Date().toISOString().slice(0, 10);
    const dayLabel = lib.fmtISO(iso);
    const found = typeof j.found === "number" ? j.found : null;
    const leaders = Array.isArray(j.leaders) ? j.leaders : null;

    console.log("feed day : " + iso + " (" + dayLabel + ")");
    console.log("clue     : " + clue);
    console.log("found    : " + (found == null ? "-" : found) + "   leaders: " + (leaders ? leaders.join(", ") : "-"));

    const src = fs.readFileSync(INDEX, "utf8");
    if (src.indexOf('d: "' + dayLabel + '"') >= 0) {
      console.log("already logged for " + dayLabel + " \u2014 nothing to do");
      return;
    }

    const pick = lib.pickAnswer(clue);
    console.log("answer   : " + pick.answer + "   [" + (pick.confident ? "high" : "low") + " confidence]");
    (pick.candidates || []).slice(0, 5).forEach(function (c, i) {
      console.log("   " + (i + 1) + ". " + c.venue + " (" + c.area + ") score=" + c.score + (c.strong ? " STRONG" : ""));
    });

    if (dryRun) { console.log("dry run \u2014 nothing changed"); return; }

    lib.applyUpdate(clue, pick.answer, false, {
      day: dayLabel, iso: iso, found: found, leaders: leaders, auto: true
    }).forEach(function (l) { console.log(l); });

    if (noPush) { console.log("done (no push)"); return; }

    const p = lib.pushUpdate(dayLabel);
    p.log.forEach(function (l) { console.log(l); });
    if (!p.ok) throw new Error("push failed");
    console.log("live in ~60-90s (Cloudflare build)");
  });
})().catch(function (e) {
  console.error("[auto-hunt] " + (e && e.message ? e.message : e));
  process.exit(1);
});
