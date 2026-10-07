/* Pre-render every route of the Lagos Life Guide into static HTML.
   Reads index.html (template + inline app script), runs the script in a
   sandbox to get the page map, then writes one HTML file per route into dist/.
   Usage: node build.js                                              */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const tpl = fs.readFileSync(path.join(root, "index.html"), "utf8");

const scripts = [...tpl.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const code = scripts.find((s) => s.indexOf("__LL") >= 0) || scripts[scripts.length - 1];

const sandbox = { module: { exports: {} }, exports: {}, console };
vm.runInNewContext(code, sandbox, { filename: "inline-app.js" });
const PAGES = sandbox.module.exports.PAGES;
const DESCS = sandbox.module.exports.DESCS || {};
const SITE = sandbox.module.exports.SITE || "https://lagoslife.homes";

const esc = (s) => String(s).replace(/&(?!amp;|lt;|gt;|quot;|#\d)/g, "&amp;");

const outDir = path.join(root, "dist");
fs.rmSync(outDir, { recursive: true, force: true });

function write(file, data) {
  const fp = path.join(outDir, file);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, data);
}

let count = 0;
for (const route of Object.keys(PAGES)) {
  const page = PAGES[route];
  const is404 = route === "/404";
  const body = page.render();
  const desc = page.desc || DESCS[route] || page.title + " \u2014 an independent, unofficial player guide to the Lagos Life browser game.";
  const full = is404 ? SITE + "/" : SITE + (route === "/" ? "/" : route);

  let html = tpl;
  html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>" + esc(page.title) + " \u00b7 Lagos Life Guide</title>");
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, (_m, a, b) => a + esc(desc) + b);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, (_m, a, b) => a + full + b);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, (_m, a, b) => a + esc(page.title + " \u00b7 Lagos Life Guide") + b);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, (_m, a, b) => a + esc(desc) + b);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, (_m, a, b) => a + full + b);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, (_m, a, b) => a + esc(page.title + " \u00b7 Lagos Life Guide") + b);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, (_m, a, b) => a + esc(desc) + b);
  html = html.replace('<main id="app" aria-live="polite"></main>', '<main id="app" aria-live="polite">' + body + "</main>");

  if (!is404) {
    const ld = sandbox.module.exports.ldGraph(route, page, desc);
    html = html.replace("</head>", '<script type="application/ld+json" id="ld-json">' + JSON.stringify(ld).replace(/</g, "\\u003c") + "</script>\n</head>");
  }
  if (is404) html = html.replace("</head>", '<meta name="robots" content="noindex">\n</head>');

  const file = is404 ? "404.html" : route === "/" ? "index.html" : route.replace(/^\//, "") + ".html";
  write(file, html);
  count++;
}

for (const asset of ["favicon.svg", "favicon.ico", "og-image.png", "robots.txt", "sitemap.xml", "_headers"]) {
  const src = path.join(root, asset);
  if (fs.existsSync(src)) write(asset, fs.readFileSync(src));
}

const adsDir = path.join(root, "ads");
if (fs.existsSync(adsDir)) {
  for (const f of fs.readdirSync(adsDir)) {
    const fp = path.join(adsDir, f);
    if (fs.statSync(fp).isFile()) write(path.join("ads", f), fs.readFileSync(fp));
  }
}

console.log("pre-rendered " + count + " pages + assets -> dist/");
