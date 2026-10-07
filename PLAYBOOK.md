# 从零到上线变现：整站搭建 Playbook

> 本文档完整记录 **lagoslife.homes（Lagos Life 非官方攻略站）** 从设计、开发、部署、SEO、变现到运维的全过程，可作为下次开发其他网站的**可复用操作手册**。
>
> 参考项目：`https://github.com/hilyca6/seo-lagos` · 线上：`https://lagoslife.homes` · 部署：Cloudflare Pages

---

## 0. 总体技术选型

| 项目 | 选择 | 说明 |
|---|---|---|
| 站点形态 | 单文件 `index.html` + 内联 CSS/JS + 客户端路由 | 无需构建框架，改起来快 |
| 路由 | **History API（路径路由）** | `lagoslife.homes/jobs` 而不是 `#/jobs`，利于 SEO |
| 渲染 | **预渲染**：`build.js` 把每个路由生成独立 HTML | 爬虫无需执行 JS 即可读内容 |
| 托管 | **Cloudflare Pages**（Git 集成，自动构建） | 免费、全球 CDN、自动 HTTPS |
| DNS/域名 | 域名在 **Spaceship**，DNS 托管迁到 **Cloudflare** | Cloudflare 代理 + 自动证书 |
| 统计 | **Cloudflare Web Analytics**（自动注入） | 免费、隐私友好 |
| 搜索 | **Google Search Console**（DNS 验证） | 提交 sitemap |
| 变现 | **Adsterra**（Banner + Native），规划中 **Google AdSense** | 展示广告 |

---

## 1. 阶段一：提取设计系统（Design System）

**做法**：给定目标网站 URL，不照抄代码，而是**观察并提取设计语言**。

1. 抓取目标站页面 HTML，找到其编译后的 CSS 文件（如 Astro 产物的 `_xxx.css`）。
2. 从 CSS 里汇总：
   - 颜色（`--color-*`、`--bg-*`、`--tint-*`）
   - 字体（display / body、字号层级、字重、行高）
   - 间距、圆角、阴影、过渡、断点
3. 产出：
   - `design-system.html`：单文件设计系统展示页（Colors / Typography / Spacing / Radius / Shadows / Buttons / Cards / FAQ / Dark mode / Responsive…）
   - 一套 **Design Tokens（CSS 变量）** 供正式站点复用

**要点**
- 不复制对方版权图片/Logo/商标；用文字字标 + 自绘 SVG 占位。
- 若目标站样式少，主动补全成更完整、商业化的系统。
- **字体**可用 Google Fonts；本项目最终用 `Space Grotesk`（标题）+ `Manrope`（正文）。

> 本项目中间做过一次“换皮”（先换成冷色系避免与参考站雷同，后又按需求改回绿色系）。这属于常见调整。

---

## 2. 阶段二：搭建站点

### 2.1 内容结构
- 单文件 `index.html`，内联 `<style>` + 一个 `<script>`。
- 脚本里维护一个 **`PAGES` 映射表**：`路由 → { title, desc, render() }`，`render()` 返回该页正文 HTML 字符串。
- 组件用函数拼字符串：`quickCard` / `systemCard` / `article` / `related` / `faqItem` / `adSlot` 等。

### 2.2 hash 路由 → 路径路由
1. 把所有内部链接从 `href="#/jobs"` 改为 `href="/jobs"`（批量正则替换；注意保留 SVG 的 `<use href="#llHouse">` 片段引用）。
2. 路由读取 `location.pathname`；拦截站内 `<a>` 点击做无刷新跳转（`history.pushState` + `popstate`）。
3. 每页更新 `document.title` 与 meta（canonical / og / twitter）。

### 2.3 预渲染（关键 SEO 步骤）
- `build.js`：
  1. 读取 `index.html`（模板 + 内联脚本）。
  2. 用 Node `vm` 在沙箱里执行脚本，拿到 `module.exports` 暴露的 `PAGES`。
  3. 遍历每个路由，`page.render()` 得到正文，替换模板里的 `<title>`、`description`、`canonical`、`og:*`、`twitter:*`，把正文注入 `<main id="app">`。
  4. 写入 `dist/<path>.html`（`/` → `index.html`，`/locations/quilox` → `locations/quilox.html`）。
  5. 复制静态资源（favicon / og 图 / robots / sitemap / `_headers` / `ads/`）。
- 为了能在无 DOM 环境跑，脚本里：`var app = (typeof document!=="undefined") ? ... : null;`，并把「路由」部分用 `if (app && typeof window!=="undefined"){...}` 包起来；末尾 `module.exports = { PAGES, DESCS, SITE, ldGraph }`。
- **真 404**：额外生成 `dist/404.html`，并加 `<meta name="robots" content="noindex">`。

**本地预览**（路径路由不能用 `file://`）：用一个小 Node 静态服务器模拟 Cloudflare 的 clean-urls + 404：
```
node 简易静态服务器.js dist 5197
```
（服务器逻辑：无扩展名 → 找 `<path>.html`；找不到 → 返回 `404.html` 且状态码 404。）

---

## 3. 阶段三：SEO 全套

| 项 | 内容 |
|---|---|
| 标题/描述 | 每页独立 `title` + `description`（集中维护在 `DESCS` 映射表） |
| Canonical | 每页 `https://lagoslife.homes/<path>` |
| Open Graph / Twitter | `og:title/description/url/image`；`og:image` 用 **1200×630 PNG** |
| favicon | `favicon.svg`（矢量）+ `favicon.ico`（32×32，避免 Googlebot 404） |
| robots.txt | `Allow: /`、`Disallow: /404`、`Sitemap: ...` |
| sitemap.xml | 列出全部页面，`https://lagoslife.homes/...` |
| JSON-LD | 每页 `@graph`：`WebSite`（首页）/`Article` + `BreadcrumbList` + `FAQPage`（有问答的页） |
| 结构化校验 | 本地校验脚本 + `validator.schema.org` API（注意限流 429，分批慢跑） |

**生成 OG PNG**：用 Windows GDI+（`System.Drawing`）画 1200×630，无需第三方库。
**生成 favicon.ico**：GDI+ 画 32×32 PNG → Node 封装成 PNG-in-ICO。

---

## 4. 阶段四：部署（Vercel → 改用 Cloudflare Pages）

- 先试 **Vercel**：163 邮箱 + GitHub 登录都被风控（“需要进一步申诉验证”），受阻。
- 改用 **Cloudflare Pages**（推荐，且 Cloudflare 在国内可访问、对邮箱域名不挑）。

**Cloudflare Pages 配置（Git 集成）**
1. Workers & Pages → **Create application**（新版入口）→ 需要 Pages 就点底部 **“Continue to Pages”**（legacy Pages workflow）。
2. 选 **「导入现有的 Git 仓库 / Import an existing Git repository」**。
3. 构建配置：
   - **Framework preset: None**
   - **Build command: `npm run build`**（= `node build.js`）
   - **Build output directory: `dist`**
   - Node 版本：仓库放 `.nvmrc`（=20）
4. `dist/_headers`（Cloudflare 用）设置安全头与缓存：
   ```
   /*
     X-Content-Type-Options: nosniff
     X-Frame-Options: SAMEORIGIN
     ...
   /index.html
     Cache-Control: public, max-age=0, must-revalidate
   ```
   > 注意：**Cloudflare Pages 不会用 `vercel.json`**；它读取输出根目录的 `_headers`。`_headers` 必须被 `build.js` 复制进 `dist`。
5. **Pretty URLs**：Cloudflare Pages 默认把 `/foo.html` **308 重定向**到 `/foo`。所以引用的 URL（如广告 iframe）应写**无扩展名**形式（`/ads/banner-desktop`）。
6. `/404.html` 会作为自定义 404（返回 404 状态码）。

---

## 5. 阶段五：域名与 DNS

- 域名 `lagoslife.homes` 在 **Spaceship** 注册。
- 接入 Cloudflare：
  1. Cloudflare → **Add a site** → **Connect a domain**（**不是** Transfer a domain；后者是转移注册商）。
  2. 选 **Free** 计划；域名策略保持 **搜索=允许**。
  3. 记下 Cloudflare 给的**两个 Nameserver**（如 `frida.ns.cloudflare.com` / `mike.ns.cloudflare.com`）。
  4. 到 **Spaceship → 该域名 → Nameservers** 改成这两个，保存。
  5. 等激活（几分钟~数小时）。
- 自定义域名：Pages 项目 → **Custom domains → 添加 `lagoslife.homes`**（根域名自动 CNAME 扁平化 + 自动 HTTPS）。
- 开域名前先确认 **DNSSEC 关闭**（换 NS 时避免解析问题）；本项目查 DS 记录确认未开启。

**踩坑**
- 中文路径在 PowerShell 里读 `.ps1`/写文件会乱码 → 脚本里用**相对路径**或先复制到 ASCII 路径。
- `.home` 不是可注册后缀（ICANN 保留）；`.homes` 才是真的。

---

## 6. 阶段六：Google Search Console

1. https://search.google.com/search-console → 添加资源。
2. 选 **网域（Domain）**（覆盖 apex + 所有子域 + http/https）→ Cloudflare 授权后**自动写入 TXT 记录** → 点 **验证**。
   - 也可用 **网址前置字元 + HTML 标签**（需要往 `<head>` 加 meta）。
3. 验证通过后 → **Sitemaps** → 提交 `sitemap.xml`。
4. 顶部搜索框 → 输入首页 URL → **请求编入索引**。
5. **“无法撷取”**：多为首次提交的暂时现象；确认 sitemap 返回 200 + 有效 XML + 未被 Cloudflare 拦（用 Googlebot UA 测试），然后等 Google 自动重抓（1–2 天）。

---

## 7. 阶段七：Cloudflare Web Analytics

- Cloudflare → **Web Analytics** → Add a site（或对已有域名）→ 进入站点 → **Manage site**。
- 选 **Enable**（自动注入）——域名经 Cloudflare 代理时**无需改代码**。
- 若用 **手动 JS 代码**：在 Manage site 的 snippet 里取到 `token`，再加：
  ```html
  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"你的token"}'></script>
  ```
  > 二选一：**开了自动注入就别再放手动脚本**，否则重复统计。
- 其它看流量的地方：**Workers & Pages → 项目 → Metrics**；**域名 → Analytics → Traffic**。

---

## 8. 阶段八：广告变现

### 8.1 Adsterra（门槛低，先上）
1. https://adsterra.com → **Sign up as a Publisher**。
   - **Login** 只能字母/数字/下划线（**不能含 `@`、`.`**）
   - 密码 ≥8 位且含大写+小写+数字
   - Messenger + Messenger account 必填
2. 后台 **Add new Website**：填域名；Category 选最接近的（没有就 **Other**）；Adult 关闭。
3. **Create ad unit**，本项目用了：
   | 广告 | 尺寸 | key |
   |---|---|---|
   | Banner 桌面 | 728×90 | `8c0a83a84e96511e61e4e218609c9caa` |
   | Banner 手机 | 320×50 | `ff6efd41997ca6ef21d505ee9a9b3bbb` |
   | Native | 容器 | `container-9dcf371bd19085ab167580ea62c11830`（脚本 `https://bauval.org/21/9dcf371bd19085ab167580ea62c11830`）|
4. 满 $5 可提现，后台设**提现方式**（Paxum/WebMoney/比特币/银行）。

**接入技巧：用 iframe 隔离**（参考站同款），这样无刷新翻页也能稳定加载、且不会被 `innerHTML` 的“脚本不执行”问题影响：
- `ads/banner-desktop.html`、`ads/banner-mobile.html`（内含 `atOptions` + `invoke.js`）
- `ads/native.html`（内含容器 div + Adsterra native 脚本）
- 页面里放 `.ad-slot > .ad-slot-frame > iframe`，JS 按窗口宽度切换桌面/手机模板。
- **`build.js` 要把 `ads/` 目录复制进 `dist`。**

**注意**
- 策略页（隐私/关于/联系/条款）**不放广告**（`article({ noAds:true })`）。
- **别点自己的广告**。

### 8.2 Google AdSense（RPM 更高，规划中）
1. 用 **Gmail/Google 账号**登录 https://adsense.google.com → 添加网站 + 填国家 + 同意条款。
2. 拿到 **发布商 ID `ca-pub-…`** + 验证脚本 `adsbygoogle.js?client=ca-pub-…` + `ads.txt` 内容。
3. 前置条件（**必做**）：**隐私政策 / 关于 / 联系 / 条款**页 + **Cookie 同意**。
4. 通过后创建广告单元，用 `data-ad-client`（ca-pub）+ `data-ad-slot` 部署。

---

## 9. 阶段九：合规页 + Cookie 同意（AdSense 门槛）

用站点自身的模板生成 4 个页面（走 `article()` 且 `noAds:true`）：
- `/privacy`（隐私政策：数据、Cookie、广告网络 Adsterra/Google、分析、退订链接、18+）
- `/about`（关于：非官方、不隶属、内容如何制作）
- `/contact`（联系：`contact@lagoslife.homes`）
- `/terms`（使用条款）

**Cookie 同意横幅**：轻量、无依赖、与主题一致。
- 页面底部固定条 + “Got it” 按钮；`localStorage` 记录已同意。
- 放在 `#app` **之外**（跨路由常驻），首访显示。

---

## 10. 阶段十：邮箱路由（让 Contact 页邮箱可用）

- Cloudflare → **Email Routing**：
  1. **Destination addresses**：填**你自己的收件邮箱** → Add → 收验证邮件并确认。
  2. **Routing rules**：创建 `contact@lagoslife.homes` → **Send to** 你的目的邮箱。
  3. 若提示加 MX/TXT，点同意（自动）。

---

## 11. 阶段十一：日志分析与修复

- 从 Cloudflare 导出 **HTTP 请求日志**（JSON，字段含 `edgeResponseStatus`、`clientRequestPath`、`userAgent` 等）。
- 用 Node 脚本统计：状态码分布、非 2xx 路径、Top 路径、User-Agent。
- 本项目发现：
  - `404 /favicon.ico`（**Googlebot-Image** 抓）→ **真问题** → 补 `favicon.ico` 修复。
  - `404 /.git/config`（黑客扫描）→ 正确拒绝，无需处理。
  - `403 /` POST（Python 爬虫）→ Cloudflare 主动拦截，正常。
- 结论：**新增资源时要同时提供 `/favicon.ico`**，否则 Google 会 404。

---

## 12. 截图清单（本项目已保存的界面截图）

> 截图位于项目根目录（本地，未部署）。复用时可对照这些步骤。

| 文件 | 对应步骤 / 内容 |
|---|---|
| `cf1.png` | Cloudflare “Create an app” 入口（Continue with GitHub / Upload your static files / **底部 Continue to Pages**）|
| `cf2.png` | Pages “开始使用”：**导入现有的 Git 仓库** / 拖放文件 |
| `cf3.png` | Custom domains → **Transfer DNS management**（Begin DNS transfer）|
| `cf4.png` | Add a site：**Connect a domain** / Transfer a domain / Buy a domain |
| `cf5.png` | Connect a domain 表单（域名 + AI 训练/搜索策略 + 导入 DNS）|
| `cf6.png` | DNS 记录页（2 条 A 记录）→ **Continue to activation** |
| `cf7.png` | **Update your nameservers**：`frida.ns.cloudflare.com` / `mike.ns.cloudflare.com` |
| `sign1.png` | Adsterra 发布者注册表单（Login 规则报错示例）|
| `sign2.png` | Adsterra **Add new Website** 弹窗（Category / Adult / 广告格式）|
| `search1.png` | Google Search Console **选择资源类型**（网域 / 网址前置字元）|
| `sitemap.png` | GSC **Sitemaps** 提交入口 |
| `sitemap1.png` | GSC sitemap 状态 **“无法撷取”**（暂时性）|
| `inject.png` | Web Analytics **Manage site**：RUM 选 **Enable（自动注入）** |
| `email.png` | Email Routing → **Destination addresses** 添加页 |

---

## 13. 新站复用 Checklist

**A. 内容与结构**
- [ ] 提取设计系统 → 产出 tokens + `design-system.html`
- [ ] 单文件 `index.html`，`PAGES` 路由映射表
- [ ] 内部链接用**路径**（`/xxx`），不用 `#/xxx`

**B. SEO**
- [ ] `build.js` 预渲染每页独立 HTML + title/description/canonical/OG
- [ ] `DESCS` 每页独立描述
- [ ] `robots.txt`、`sitemap.xml`（含全部页面）
- [ ] JSON-LD（WebSite/Article/Breadcrumb/FAQ）+ 校验
- [ ] OG 图 1200×630（PNG）、`favicon.svg` + **`favicon.ico`**
- [ ] 真 404（`404.html` + 404 状态）

**C. 部署**
- [ ] `build.js` + `package.json`（`"build": "node build.js"`）+ `.nvmrc`
- [ ] `_headers`（安全头 + 缓存）复制进 `dist`
- [ ] Cloudflare Pages：**Import an existing Git repo**，Build `npm run build`，Output `dist`
- [ ] 引用资源用**无扩展名** URL（Pretty URLs 会 308）

**D. 域名**
- [ ] Add site → **Connect a domain** → Free 计划
- [ ] 注册商改 **Nameservers** 为 Cloudflare 的两个
- [ ] 激活后 Pages → **Custom domains** 绑定

**E. 统计与搜索**
- [ ] Web Analytics（自动注入 或 手动 token）
- [ ] Search Console（**Domain + DNS 验证**）→ 提交 sitemap → 请求编入索引

**F. 变现**
- [ ] Adsterra 注册 → Add website → Create ad unit → 用 **iframe 隔离**接入
- [ ] 合规页（隐私/关于/联系/条款）+ **Cookie 同意** → 再申请 AdSense
- [ ] `contact@邮箱` 用 **Email Routing** 转发

---

## 14. 常用命令

```bash
# 构建（生成 dist/）
npm run build          # 等价 node build.js

# 本地预览（路径路由 + clean-urls + 404），端口自定
node 简易静态服务器.js dist 5197

# Git（走本地代理，GitHub 才通）
git config --global http.proxy http://127.0.0.1:7897   # 取消：--unset
git add -A
git commit -m "message"
git push origin main    # 推送后 Cloudflare 自动构建
```

**关键文件一览**
```
index.html       # 模板 + 内联 CSS/JS（PAGES 路由表）
build.js         # 预渲染 → dist/
package.json     # "build": "node build.js"
.nvmrc           # 20
_headers         # Cloudflare 头
robots.txt / sitemap.xml
favicon.svg / favicon.ico / og-image.png
ads/banner-desktop.html / banner-mobile.html / native.html
vercel.json      # 保留但 Cloudflare 不使用
```

---

## 15. 踩坑速查

| 问题 | 解决 |
|---|---|
| GitHub push 失败（SSL eof / 连不上） | 有本地代理时设 `git config --global http.proxy http://127.0.0.1:7897` |
| PowerShell 读脚本中文乱码 | `.ps1` 存 UTF-8 **带 BOM**，或脚本内用相对路径；别在脚本里写中文绝对路径 |
| 路径路由后 `file://` 打不开 | 用静态服务器预览 |
| Cloudflare 报 `foo.html` 308 | 引用写无扩展名 `foo`（Pretty URLs）|
| Google 抓 favicon 404 | 提供真正的 `/favicon.ico` |
| GSC sitemap “无法撷取” | 多为暂时；确认 Googlebot UA 能 200，等 1–2 天 |
| 换 NS 后担心 DNSSEC | 先把 DNSSEC 关掉再换；查 DS 记录判断是否开启 |
| Adsterra 广告不显示 | 新站需数小时~1 天填充；确认无广告拦截；等 Impressions 增长 |
| 结构化数据校验 429 | validator.schema.org 有速率限制，分批慢跑 |

---

## 16. 可复用脚本片段

**build.js 预渲染核心**
```js
const vm = require("vm");
const tpl = fs.readFileSync("index.html", "utf8");
const code = [...tpl.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes("__LL"));
const sandbox = { module:{exports:{}}, exports:{}, console };
vm.runInNewContext(code, sandbox);
const { PAGES, DESCS, SITE, ldGraph } = sandbox.module.exports;
// 每个 route：替换 title/desc/canonical/og/twitter，注入 <main>，写 dist/<path>.html
```

**内联脚本需同时兼容浏览器与 Node**
```js
var app = (typeof document !== "undefined" && document.getElementById) ? document.getElementById("app") : null;
// ... 结束后：
var __LL = { PAGES, DESCS, SITE: SITE_LD, ldGraph };
if (typeof module !== "undefined" && module.exports) module.exports = __LL;
else if (typeof window !== "undefined") window.__LL = __LL;
if (app && typeof window !== "undefined") { /* 路由（History API + 点击拦截 + popstate）*/ }
```

**广告 iframe 隔离（Adsterra）**
```html
<!-- ads/banner-desktop.html -->
<script>atOptions={'key':'你的KEY','format':'iframe','height':90,'width':728,'params':{}};</script>
<script src="//www.highperformanceformat.com/你的KEY/invoke.js"></script>
```
```html
<!-- 页面内：默认手机版，JS 按宽度切换桌面版 -->
<aside class="ad-slot"><span class="ad-slot-label">Advertisement</span>
  <div class="ad-slot-frame"><iframe src="/ads/banner-mobile" width="320" height="50" scrolling="no" loading="lazy"></iframe></div>
</aside>
```

---

*文档随项目沉淀，可复制到新项目作为起步模板。*
