/* Shared logic for the daily hunt updaters (CLI + web UI + auto-hunt). */
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

/* Curated clue -> venue synonyms. The riddle almost never uses the venue's own
   name, so these carry most of the matching power. Keys must match VENUES[i][0]. */
const ALIAS = {
  "Amala Shitta": ["food", "eat", "eating", "amala", "ewedu", "buka", "chop", "jollof", "pepper soup", "zobo", "mama"],
  "Balogun Market": ["market", "buy", "buys", "resell", "trade", "trading", "load", "carry", "alabaru", "bargain", "goods", "shop", "cheap"],
  "CcHub": ["tech", "startup", "coding", "hackathon", "pitch", "developer", "software", "co-work", "coworking"],
  "Eko Casino": ["casino", "gamble", "gambling", "slots", "bet", "betting", "buffet", "lucky", "jackpot"],
  "Eko Hotels & Suites": ["hotel", "suite", "suites", "luxury", "presidential", "room", "check in", "five star"],
  "Eko Police Division": ["police", "bail", "cell", "arrest", "officer", "crime", "jail", "station"],
  "Elegushi Beach": ["beach", "sand", "sea", "ocean", "waves", "shore", "photoshoot", "seaside", "coast"],
  "Freedom Park": ["park", "comedy", "laugh", "stand up", "standup", "concert", "festival", "garden", "open air"],
  "General Hospital": ["hospital", "doctor", "nurse", "sick", "health", "clinic", "medicine", "ward", "patient", "emergency"],
  "House of Grace Chapel": ["church", "chapel", "service", "worship", "pray", "prayer", "sunday", "pastor", "faith"],
  "i-Fitness": ["gym", "fitness", "workout", "exercise", "coach", "weights", "training", "session"],
  "Ikoyi Golf Club": ["golf", "holes", "green", "tee", "caddie", "club house", "swing"],
  "Ivory Rooftop": ["rooftop", "dinner", "candlelit", "date", "romantic", "restaurant", "skyline", "fine dining"],
  "Lagoon Boat Cruise": ["lagoon", "boat", "cruise", "sail", "sailing", "water", "creek", "deck", "ferry", "on the water"],
  "Lagos High Court": ["court", "law", "legal", "judge", "justice", "affidavit", "lawyer", "case", "trial"],
  "Lekki Conservation Centre": ["canopy", "walkway", "walk", "nature", "monkey", "forest", "africa", "longest", "reserve", "treetop", "bridge"],
  "Mama Bisi's Salon": ["salon", "hair", "braids", "hairstyle", "hairdresser", "beauty", "makeover", "weave"],
  "Marina Towers": ["bank", "banking", "office", "lobby", "civil service", "network", "tower", "corporate", "finance"],
  "MindSpace Wellness Centre": ["wellness", "therapy", "therapist", "spa", "relax", "mental", "counsel", "calm", "massage"],
  "Naija Radio House": ["radio", "broadcast", "broadcasting", "presenting", "presenter", "studio", "airwaves", "show"],
  "New Afrika Shrine": ["music", "afrobeat", "afrobeats", "fela", "mic", "shrine", "concert", "live band", "open mic", "stage"],
  "Oga Sunday Viewing Centre": ["football", "epl", "match", "viewing", "sport", "premier league", "goal", "fans"],
  "Polanco Motors": ["car", "cars", "whip", "whips", "drive", "dealership", "dealer", "showroom", "test drive", "auto", "vehicle", "motor", "dream car"],
  "Polling Unit 001": ["vote", "voting", "election", "polling", "ballot", "polls", "governor", "senator", "president"],
  "Quilox": ["club", "nightclub", "party", "dance", "dancing", "nightlife", "vip", "lounge", "dj", "turn up", "rave"],
  "Teslim Balogun Stadium": ["stadium", "football", "penalty", "match", "pitch", "sport", "arena", "goals"],
  "The Library": ["book", "books", "page", "pages", "read", "reading", "quiet", "shh", "shelf", "shelves", "study", "library", "novel", "story"],
  "The Palms": ["mall", "cinema", "movie", "movies", "film", "shop", "shopping", "retail", "screens"],
  "University of Lagos": ["school", "university", "student", "campus", "matriculate", "lecture", "study", "class", "degree", "unilag", "akoka"]
};

/* Expand two-letter area codes the clue uses. */
const AREA_ALIAS = {
  "Victoria Island": ["vi"],
  "Port Harcourt": ["ph"],
  "Lagos Island": ["lag"],
  "Five Cowries Creek": ["creek"]
};

function fmtDate(d) { d = d || new Date(); return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }

/* "2026-10-13" -> "13 Oct 2026" (used with the game feed's own day field). */
function fmtISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return fmtDate();
  return parseInt(m[3], 10) + " " + MONTHS[parseInt(m[2], 10) - 1] + " " + m[1];
}

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

/* Score every venue against the clue text. Strong signals first: curated alias
   phrases (weight 6 each), then literal clue words in the venue's name/area/
   hours/activity texts (weight 3), loose substrings (+1) and a one-typo fuzzy
   pass. Returns candidates plus a `strong` flag and clean `hits` for display. */
function suggest(clue, venues, acts) {
  const clueNorm = " " + String(clue).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
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
    const aliases = (ALIAS[v[0]] || []).concat(AREA_ALIAS[v[1]] || []);
    const hay = v[0] + " " + v[1] + " " + (v[2] || "") + " " + (v[3] || "") + " " + (v[4] || "") +
      " " + (actsByVenue[v[0]] || []).join(" ");
    const hayL = hay.toLowerCase(), hayTokens = new Set(tokens(hay));
    let score = 0, strong = false, hits = [];
    aliases.forEach(function (a) {
      if (clueNorm.indexOf(" " + a + " ") >= 0) { score += 6; strong = true; hits.push(a); }
    });
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
    return { venue: v[0], area: v[1], score: score, strong: strong, hits: hits };
  }).filter(function (r) { return r.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 5);
}

function loadData() {
  const src = fs.readFileSync(INDEX, "utf8");
  return { src: src, venues: extractArray(src, "VENUES") || [], acts: extractArray(src, "ACTIVITIES") || [] };
}

/* Human-readable "matches ..." tail built from the cleanest hits. */
function whyText(r) {
  const clean = r.hits.filter(function (h) { return h.indexOf("~") < 0; });
  const list = (clean.length ? clean : r.hits).slice(0, 4);
  return list.length ? "matches " + list.join("/") + " in the clue" : "closest match to the clue";
}

/* Best automatic answer. Returns { answer, candidates, confident }; confident is
   false when only weak/literal signals fire, so callers can hedge the wording.
   Never returns a null answer, so unattended runs always produce a line. */
function pickAnswer(clue) {
  const d = loadData();
  const list = suggest(clue, d.venues, d.acts);
  if (!list.length) {
    return { answer: "Not yet identified \u2014 we read the riddle as pointing at one of the places on the map (see the venues list)", candidates: [], confident: false };
  }
  const t = list[0];
  return {
    answer: t.venue + ", " + t.area + " \u2014 " + whyText(t),
    candidates: list,
    confident: !!(t.strong && t.score >= 6)
  };
}

/* Back-compat alias used by the manual UI/CLI: only trusts a strong match. */
function bestAnswer(clue) {
  const r = pickAnswer(clue);
  return { answer: r.confident ? r.answer : null, candidates: r.candidates };
}

/* Prepend the new hunt entry (history is kept), update the sitemap date, rebuild.
   opts: { day, iso, found, leaders, auto }. Returns log lines. */
function applyUpdate(clue, answer, confirmed, opts) {
  opts = opts || {};
  const day = opts.day || fmtDate();
  const iso = opts.iso || new Date().toISOString().slice(0, 10);
  const status = confirmed
    ? "Confirmed \\u00b7 gem found there on " + day
    : (opts.auto
        ? "Best reading of the riddle (auto-updated daily); gem not confirmed"
        : "Candidate \\u00b7 best reading of the riddle; gem not claimed yet");
  const log = [];

  const numF = opts.found != null ? ",\n      f: " + Number(opts.found) : "";
  const arrL = Array.isArray(opts.leaders) && opts.leaders.length
    ? ",\n      l: [" + opts.leaders.slice(0, 3).map(function (x) { return '"' + esc(String(x)) + '"'; }).join(", ") + "]"
    : "";
  const entry = '{ d: "' + esc(day) + '", c: "' + esc(clue) + '", a: "' + esc(answer) +
    '", s: "' + status + '"' + numF + arrL + " }";

  let html = fs.readFileSync(INDEX, "utf8");
  const marker = "var HUNT_LOG = [";
  const at = html.indexOf(marker);
  if (at < 0) throw new Error("HUNT_LOG not found in index.html");
  const insertPos = at + marker.length;
  html = html.slice(0, insertPos) + "\n    " + entry + "," + html.slice(insertPos);
  fs.writeFileSync(INDEX, html);
  log.push("index.html updated (new entry prepended, history kept)");

  let sm = fs.readFileSync(SITEMAP, "utf8");
  const smRe = /(<loc>https:\/\/lagoslife\.homes\/daily-hunt<\/loc><lastmod>)\d{4}-\d{2}-\d{2}(<\/lastmod>)/;
  if (smRe.test(sm)) {
    sm = sm.replace(smRe, "$1" + iso + "$2");
    fs.writeFileSync(SITEMAP, sm);
    log.push("sitemap.xml updated");
  }

  cp.execSync("node build.js", { cwd: ROOT, stdio: "pipe" });
  log.push("dist/ rebuilt");
  return log;
}

function shOut(cmd) {
  return cp.execSync(cmd, { cwd: ROOT, stdio: "pipe" }).toString().trim();
}

/* Commit + push with the proxy/direct retry loop. Works locally and in CI
   (a proxy attempt simply fails on a runner, then the direct attempt succeeds).
   `dayLabel` only affects the commit message. Returns { ok, log }. */
function pushUpdate(dayLabel) {
  const log = [];
  try {
    shOut("git add index.html sitemap.xml");
    shOut("git commit -m \"Daily hunt: " + (dayLabel || fmtDate()) + " clue\"");
    log.push("committed");
  } catch (e) {
    log.push("commit skipped (" + String(e.message).split("\n")[0].slice(0, 80) + ")");
  }
  const cmds = [
    ["direct", "git -c http.proxy= push origin main"],
    ["proxy", "git -c http.proxy=http://127.0.0.1:7897 push origin main"]
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
  fmtDate: fmtDate, fmtISO: fmtISO, esc: esc, extractArray: extractArray, tokens: tokens,
  suggest: suggest, loadData: loadData, bestAnswer: bestAnswer, pickAnswer: pickAnswer,
  applyUpdate: applyUpdate, pushUpdate: pushUpdate
};
