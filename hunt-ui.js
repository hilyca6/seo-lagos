#!/usr/bin/env node
/*
 * Local web UI for the daily hunt update.
 *   node hunt-ui.js  ->  http://127.0.0.1:5214
 *
 * Paste today's clue, click once: the server picks the most likely venue,
 * writes the entry, rebuilds the site, commits and pushes (unless dry run).
 * Listens on 127.0.0.1 only.
 */
const http = require("http");
const lib = require("./hunt-lib");

const PORT = 5214;

process.on("uncaughtException", function (e) {
  console.error("[error] " + (e && e.message ? e.message : e));
});
process.on("unhandledRejection", function (e) {
  console.error("[error] " + (e && e.message ? e.message : e));
});

function page() {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Daily Hunt Updater · lagoslife.homes</title>
<style>
  :root{--bg:#09090b;--card:#18181b;--fg:#fafafa;--mut:#a1a1aa;--brd:#27272a;--pri:#ea580c;--ok:#22c55e;--err:#ef4444}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px 16px}
  .wrap{max-width:720px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:var(--mut);font-size:13px;margin:0 0 22px}
  .card{background:var(--card);border:1px solid var(--brd);border-radius:12px;padding:20px;margin-bottom:16px}
  label{display:block;font-size:12px;color:var(--mut);margin:0 0 6px;letter-spacing:.04em;text-transform:uppercase}
  textarea,input[type=text]{width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--brd);border-radius:8px;padding:12px;font:inherit;resize:vertical}
  textarea{min-height:84px}
  textarea:focus,input:focus{outline:none;border-color:var(--pri)}
  .row{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:14px}
  .chk{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--mut);text-transform:none;letter-spacing:0;margin:0;cursor:pointer}
  button{background:var(--pri);color:#fff;border:0;border-radius:8px;padding:12px 22px;font:inherit;font-weight:600;cursor:pointer}
  button:hover{filter:brightness(1.1)}
  button:disabled{opacity:.5;cursor:wait}
  button.ghost{background:transparent;border:1px solid var(--brd);color:var(--mut);font-weight:400}
  #out{margin-top:16px}
  .picked{border-left:3px solid var(--ok);padding:10px 14px;background:var(--bg);border-radius:0 8px 8px 0;margin-bottom:12px;font-size:14px}
  .picked b{color:var(--ok)}
  pre{background:var(--bg);border:1px solid var(--brd);border-radius:8px;padding:12px;font-size:12px;color:var(--mut);white-space:pre-wrap;word-break:break-all;margin:0}
  .cands{font-size:13px;color:var(--mut);margin:8px 0 0;padding-left:18px}
  .warn{color:#f59e0b;font-size:13px}
  .err{color:var(--err);font-size:13px}
  .foot{color:var(--mut);font-size:12px;margin-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Daily Hunt Updater</h1>
  <p class="sub">lagoslife.homes · 粘贴今天的线索 → 自动挑最可能的答案 → 构建 + 推送部署</p>

  <div class="card">
    <label for="clue">Today's clue（游戏里抄的那句话）</label>
    <textarea id="clue" placeholder="例：Walk the longest canopy in Africa, but don't look down."></textarea>

    <div class="row">
      <button id="go">发布（自动猜答案）</button>
      <label class="chk"><input type="checkbox" id="confirmed"> 我在游戏里确认了宝石就在那（标 Confirmed）</label>
    </div>
    <div class="row">
      <label class="chk"><input type="checkbox" id="manual"> 手动指定答案</label>
      <label class="chk"><input type="checkbox" id="dry"> 演练模式（改本地不推送）</label>
    </div>
    <div id="manualBox" style="display:none;margin-top:10px">
      <label for="answer">答案（地点, 区域 — 说明）</label>
      <input type="text" id="answer" placeholder="Lekki Conservation Centre, Lekki — its canopy walk is Africa's longest">
    </div>
    <div id="out"></div>
  </div>

  <p class="foot">服务只监听本机 127.0.0.1:${PORT} · 推送走代理/直连重试 · 线上生效约 60–90 秒（Cloudflare 构建）</p>
</div>

<script>
  var clue = document.getElementById('clue'),
      go = document.getElementById('go'),
      out = document.getElementById('out'),
      manual = document.getElementById('manual'),
      manualBox = document.getElementById('manualBox'),
      answer = document.getElementById('answer');
  manual.addEventListener('change', function(){ manualBox.style.display = manual.checked ? 'block' : 'none'; });

  function esc(s){ var d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }

  function candidatesHtml(list){
    if(!list || !list.length) return '';
    return '<ol class="cands">' + list.map(function(c){
      return '<li>' + esc(c.venue) + ' (' + esc(c.area) + ') — score ' + c.score + ' · ' + esc((c.hits||[]).join(', ')) + '</li>';
    }).join('') + '</ol>';
  }

  go.addEventListener('click', function(){
    var c = clue.value.trim();
    if(!c){ out.innerHTML = '<p class="err">先粘贴线索</p>'; return; }
    go.disabled = true;
    out.innerHTML = '<p class="warn">处理中…（写文件 → 构建 68 页 → 推送，约 10–30 秒）</p>';
    fetch('/api/deploy', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        clue: c,
        answer: manual.checked ? answer.value.trim() : '',
        confirmed: document.getElementById('confirmed').checked,
        dryRun: document.getElementById('dry').checked
      })
    }).then(function(r){ return r.json().then(function(j){ return {code:r.status, j:j}; }); })
    .then(function(res){
      go.disabled = false;
      var j = res.j;
      if(res.code !== 200){ out.innerHTML = '<p class="err">' + esc(j.error || ('HTTP ' + res.code)) + '</p>'; return; }
      if(j.needAnswer){
        out.innerHTML = '<p class="warn">关键词匹配不够自信，请手动填答案（候选如下）</p>' + candidatesHtml(j.candidates) +
          '<p class="warn">填到上方“手动指定答案”框里再点发布</p>';
        manual.checked = true; manualBox.style.display = 'block';
        return;
      }
      var html = '<div class="picked"><b>' + (j.picked === 'auto' ? '自动选定' : '手动答案') + '：</b>' + esc(j.answer) +
        (j.confirmed ? ' <b>[Confirmed]</b>' : ' [Candidate]') + '</div>';
      if(j.candidates && j.candidates.length) html += candidatesHtml(j.candidates);
      html += '<pre>' + esc((j.log || []).concat(j.pushLog || []).join('\\n')) + '</pre>';
      if(j.pushed === false) html += '<p class="err">推送失败 — 在项目目录手动跑 git push，或重试</p>';
      else if(j.dryRun) html += '<p class="warn">演练模式：已写本地并构建，未推送。正式发布请去掉“演练模式”再点一次。</p>';
      else html += '<p class="warn">已推送，60–90 秒后线上生效 → lagoslife.homes/daily-hunt</p>';
      out.innerHTML = html;
    })
    .catch(function(e){ go.disabled = false; out.innerHTML = '<p class="err">连不上本地服务（' + esc(e.message) + '）。请确认黑色窗口还开着并显示 Daily Hunt UI，然后按 F5 刷新本页重试。</p>'; });
  });
</script>
</body>
</html>`;
}

const server = http.createServer(function (req, res) {
  console.log(new Date().toLocaleTimeString() + " " + req.method + " " + req.url);
  function json(code, obj) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page());
    return;
  }
  if (req.method !== "POST" || req.url.indexOf("/api/") !== 0) { json(404, { error: "not found" }); return; }

  let body = "";
  req.on("data", function (c) { body += c; if (body.length > 1e5) req.destroy(); });
  req.on("end", function () {
    let b = {};
    try { b = JSON.parse(body || "{}"); } catch (e) { json(400, { error: "bad json" }); return; }
    const clue = String(b.clue || "").trim();
    if (req.url === "/api/suggest") {
      if (!clue) { json(400, { error: "clue required" }); return; }
      const d = lib.loadData();
      json(200, { candidates: lib.suggest(clue, d.venues, d.acts) });
      return;
    }
    if (req.url === "/api/deploy") {
      if (!clue) { json(400, { error: "clue required" }); return; }
      try {
        let answer = String(b.answer || "").trim(), picked = "manual", candidates = [];
        if (!answer) {
          const r = lib.bestAnswer(clue);
          candidates = r.candidates;
          if (!r.answer) { json(200, { needAnswer: true, candidates: candidates }); return; }
          answer = r.answer; picked = "auto";
        }
        const log = lib.applyUpdate(clue, answer, !!b.confirmed);
        let pushLog = [], pushed = null, dryRun = !!b.dryRun;
        if (dryRun) { pushLog = ["dry run — nothing committed or pushed"]; pushed = null; }
        else { const p = lib.pushUpdate(); pushLog = p.log; pushed = p.ok; }
        json(200, { ok: true, picked: picked, answer: answer, confirmed: !!b.confirmed,
                    candidates: candidates, log: log, pushLog: pushLog, pushed: pushed, dryRun: dryRun });
      } catch (e) {
        json(500, { error: String(e.message || e) });
      }
      return;
    }
    json(404, { error: "not found" });
  });
});

server.on("error", function (e) {
  if (e.code === "EADDRINUSE") {
    console.error("端口 " + PORT + " 已被占用 —— 可能上次的服务还在运行。");
    console.error("直接在浏览器打开 http://127.0.0.1:" + PORT + " 即可使用，或先关闭旧的 node 进程。");
  } else {
    console.error("[error] " + e.message);
  }
  console.error("按任意键关闭窗口…");
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", function () {
  const url = "http://127.0.0.1:" + PORT;
  console.log("Daily Hunt UI -> " + url + "  (Ctrl+C to stop)");
  try {
    if (process.platform === "win32") {
      require("child_process").exec('cmd /c start "" "' + url + '"', { stdio: "ignore" });
    } else {
      require("child_process").exec("open \"" + url + "\"", { stdio: "ignore" });
    }
  } catch (e) { }
});
