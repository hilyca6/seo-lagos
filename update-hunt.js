#!/usr/bin/env node
/*
 * Daily hunt updater (CLI). Prefer the web UI: node hunt-ui.js
 *
 * Usage:
 *   node update-hunt.js                          -> interactive: paste clue, pick a suggested answer
 *   node update-hunt.js --clue "..." --answer "..." [--confirmed] [--yes] [--no-push]
 *   node update-hunt.js --suggest "clue text"    -> only print candidate answers, change nothing
 */
const readline = require("readline");
const lib = require("./hunt-lib");

function parseArgs() {
  const a = process.argv.slice(2), out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--clue") out.clue = a[++i];
    else if (a[i] === "--answer") out.answer = a[++i];
    else if (a[i] === "--confirmed") out.confirmed = true;
    else if (a[i] === "--yes") out.yes = true;
    else if (a[i] === "--no-push") out.noPush = true;
    else if (a[i] === "--suggest") out.suggestOnly = a[++i];
    else if (a[i] === "--help" || a[i] === "-h") out.help = true;
  }
  return out;
}

function ask(rl, q) {
  return new Promise(function (res) { rl.question(q, function (v) { res(v.trim()); }); });
}

(async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log("node update-hunt.js [--clue \"...\"] [--answer \"...\"] [--confirmed] [--yes] [--no-push]");
    console.log("node update-hunt.js --suggest \"clue text\"   (print candidates only)");
    process.exit(0);
  }

  /* suggest-only mode */
  if (args.suggestOnly) {
    const d = lib.loadData();
    const list = lib.suggest(args.suggestOnly, d.venues, d.acts);
    if (!list.length) { console.log("no keyword matches"); process.exit(0); }
    console.log("\nCandidate answers (best guess first):");
    list.forEach(function (r, i) {
      console.log("  " + (i + 1) + ". " + r.venue + " (" + r.area + ")  [score " + r.score + " \u00b7 " + r.hits.join(", ") + "]");
    });
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const today = lib.fmtDate();

  let clue = args.clue;
  let answer = args.answer;

  if (!clue) clue = await ask(rl, "Today's clue (copy from the game): ");
  if (!clue) { console.error("clue is required"); process.exit(1); }

  if (!answer) {
    const d = lib.loadData();
    const list = lib.suggest(clue, d.venues, d.acts);
    if (list.length) {
      console.log("\nCandidate answers (best guess first):");
      list.forEach(function (r, i) {
        console.log("  " + (i + 1) + ". " + r.venue + " (" + r.area + ")  [score " + r.score + " \u00b7 " + r.hits.join(", ") + "]");
      });
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

  console.log("\n--- will write ---");
  console.log("date:    " + today);
  console.log("clue:    " + clue);
  console.log("answer:  " + answer);
  console.log("status:  " + (confirmed ? "Confirmed" : "Candidate"));
  if (!args.yes && process.stdin.isTTY) {
    const ok = await (function () {
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise(function (res) {
        rl2.question("Apply? (Y/n): ", function (v) { rl2.close(); res(!/^n/i.test(v || "")); });
      });
    })();
    if (!ok) { console.log("aborted"); process.exit(0); }
  }

  const log = lib.applyUpdate(clue, answer, confirmed);
  log.forEach(function (l) { console.log(l); });

  if (args.noPush) { console.log("done (--no-push, nothing committed)"); process.exit(0); }
  const p = lib.pushUpdate();
  p.log.forEach(function (l) { console.log(l); });
  if (p.ok) console.log("live in ~60-90s (Cloudflare build)");
  else process.exit(1);
})().catch(function (e) { console.error(e.message); process.exit(1); });
