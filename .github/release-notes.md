# Aria2Desktop v1.3.7 更新日志

> 中文在前，English below.

v1.3.7 是一次远程访问更新：内置 **Web 控制台** 升级为可安装的 PWA，支持细粒度 API 令牌与 OpenAPI 文档；Webhook 增加重试、失败投递队列与 HMAC 签名；设置可在不同机器间导出/导入；新增无头服务化指南，说明如何把应用作为系统服务运行。

## 📱 Web 控制台：PWA、细粒度令牌与 OpenAPI

- Web 控制台现在是**可安装的 PWA**——在手机上打开后选择「添加到主屏幕」，即可全屏启动，拥有独立图标、离线壳与自动更新提示。
- **细粒度 API 令牌**：除主令牌外，可创建限定于 `tasks:read`、`tasks:write`、`tasks:control`、`audit:read` 或 `admin` 的命名令牌。只读令牌可以浏览队列，但不能新增、暂停或删除任何任务。
- 每个令牌在 **设置 → 远程访问 → API 令牌** 中显示其权限范围、创建时间与最近使用时间，并可随时吊销。
- **OpenAPI 3.0.3 文档**通过 `/openapi.json` 提供，覆盖所有控制台接口、Bearer 鉴权方案与权限语义——可直接导入 Postman、Insomnia 或任何代码生成器。
- 未授权与权限不足的请求分别返回 `401` / `403 { error: "insufficient_scope", required }`，并记入审计日志。

## 🔁 Webhook：重试、队列与 HMAC

- 完成规则中的 Webhook 动作现在会**自动重试**，采用指数退避（默认 4 次，基础间隔 60 秒，封顶 6 小时）。
- 失败的投递会保留在**投递队列**中（位于工作流页面），显示尝试次数、下次尝试时间与最后一次错误；可手动重试任一条或清空队列。
- **HMAC-SHA256 签名**：为每个 Webhook 配置密钥后，每个请求都会带上 `X-Aria2-Timestamp` 与 `X-Aria2-Signature: sha256=<hex>`，签名覆盖 `<timestamp>.<body>`，接收方可校验真实性并拒绝重放。
- 队列内容会持久化，未完成的投递在应用重启后依然保留。
- 新增按规则的字段：`secret`、`maxRetries`（0–10）与 `retryDelaySeconds`（5–3600）。

## 💾 设置导出 / 导入

- **导出**全部设置为 JSON 文件——可选择包含密钥，但需要先明确确认。
- **导入**时提供**预演预览**，显示将应用、跳过、拒绝多少键，以及哪些密钥会保留本机值而不被覆盖。
- 当导入文件已脱敏时，密钥（引擎 RPC 密钥、Web 控制台令牌、Webhook 密钥）会保留本机原值。
- 适合在机器之间迁移配置，或保留一份已知可用的配置。

## 🖥️ 无头服务化指南

- 新增 `docs/headless.md`：在 Linux 上以 `--headless` 运行 Aria2Desktop 并注册为 **systemd 用户服务**（含 `loginctl enable-linger` 与 `APPIMAGE_EXTRACT_AND_RUN` 说明），或在 Windows 上注册为**计划任务**。
- 覆盖 Web 控制台（`6802`）与扩展接口（`6801`）的 SSH 端口转发，以及对外暴露任一端口前的 `allowedIps` / 强令牌 / 防火墙检查清单。
- MCP、CLI 与 Webhook 入口均有说明与可运行示例。

## 🛠️ 其它变更

- CLI `add` 命令与 MCP 工具 schema 对齐（支持 `--fileName/-n`；`--dir` 会给出明确错误，因为目标目录由应用内分类规则决定）。
- 21 种语言补齐全部新文案（每种语言 80 个新键）。
- Web 控制台布局改为移动优先：窄屏时任务表格折叠为卡片，并为刘海屏设备保留安全区内边距。
- **设置页重组**：远程访问、日志、重置与备份现在是顶级页面，不再埋在高级设置里。
- **内置日志查看器**：新增日志页展示 `main.log`，支持级别过滤、关键字搜索、自动刷新与一键「打开日志目录」；设置变更会记入日志（只记字段名——密钥永不写入日志）。
- **实例页面**：连接成功后立即自动测延迟，并在后台持续刷新，列表无需手动点「测试」也能保持最新。
- **连接切换竞态安全**：第一个实例还在连接时去连第二个实例，现在会干净地接管第一次尝试——不再出现互相矛盾的成败提示，也不会残留错误的「当前」标记。
- **界面打磨**：按钮加载态用居中的加载圈替换文字且不改变按钮尺寸；空态垂直居中；切换页面不再从头重建。

## ⚠️ 已知限制

- Web 控制台尚未实现推送通知；页面打开期间每 3 秒轮询一次。
- PWA 离线壳只缓存控制台界面，不缓存任务数据——无连接时显示最后一次渲染的状态。
- Webhook 签名只覆盖原始请求体；接收方校验 `X-Aria2-Timestamp` 时需容忍时钟偏差。

---

**完整变更对比**：https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.6...v1.3.7

---

# Aria2Desktop v1.3.7 Release Notes

v1.3.7 is a remote-access release. The built-in **Web Console** becomes an installable PWA with scoped API tokens and an OpenAPI document, webhooks gain retries, a failed-delivery queue and HMAC signatures, settings can be exported/imported between machines, and a new headless guide shows how to run the app as a system service.

## 📱 Web Console: PWA, scoped tokens, OpenAPI

- The Web Console is now an **installable PWA** — open it on a phone, choose "Add to Home Screen", and it launches full-screen with its own icon, offline shell and automatic update prompt.
- **Scoped API tokens**: besides the master token, create named tokens limited to `tasks:read`, `tasks:write`, `tasks:control`, `audit:read` or `admin`. A read-only token can browse the queue but cannot add, pause or delete anything.
- Each token shows its scopes, creation time and last-used time in **Settings → Remote Access → API Tokens**, and can be revoked at any time.
- **OpenAPI 3.0.3 document** served at `/openapi.json`, covering every console endpoint, the bearer auth scheme and the scope semantics — import it into Postman, Insomnia or any generator.
- Unauthorized and insufficient-scope requests are rejected with `401` / `403 { error: "insufficient_scope", required }` and recorded in the audit log.

## 🔁 Webhooks: retries, queue and HMAC

- Webhook actions in completion rules now **retry automatically** with exponential backoff (default 4 attempts, 60 s base delay, capped at 6 h).
- Failed deliveries are kept in a **delivery queue** on the Workflow page, with attempts, next attempt time and the last error; retry any entry by hand or clear the queue.
- **HMAC-SHA256 signatures**: set a secret per webhook and each request carries `X-Aria2-Timestamp` and `X-Aria2-Signature: sha256=<hex>` over `<timestamp>.<body>`, so receivers can verify authenticity and reject replays.
- Queue contents are persisted, so pending deliveries survive an app restart.
- New per-rule fields: `secret`, `maxRetries` (0–10) and `retryDelaySeconds` (5–3600).

## 💾 Settings export / import

- **Export** all settings to a JSON file — optionally including secrets, which requires an explicit confirmation first.
- **Import** with a **dry-run preview** showing how many keys will be applied, skipped or rejected, plus which secrets stay local instead of being overwritten.
- Secrets (engine RPC secret, web console tokens, webhook secrets) are preserved from the local machine when the imported file is redacted.
- Useful for moving a setup between machines or keeping a known-good configuration around.

## 🖥️ Headless service guide

- New `docs/headless.md`: run Aria2Desktop with `--headless` as a **systemd user service** on Linux (including `loginctl enable-linger` and the `APPIMAGE_EXTRACT_AND_RUN` note) or as a **Windows scheduled task**.
- Covers SSH port forwarding for the Web Console (`6802`) and the extension API (`6801`), plus the `allowedIps` / strong-token / firewall checklist before exposing either port.
- MCP, CLI and Webhook entry points are documented together with working examples.

## 🛠️ Other changes

- The CLI `add` command now matches the MCP tool schema (`--fileName/-n` supported; `--dir` reports a clear error because the target directory is decided by in-app category rules).
- 21 languages updated with all new strings (80 new keys per locale).
- Web Console layout is now mobile-first: the task table collapses into cards on narrow screens, with safe-area padding for notched devices.
- **Settings reorganized**: Remote Access, Logs and Reset & Backup are now top-level pages instead of being buried under Advanced Settings.
- **Built-in log viewer**: a new Logs page shows `main.log` with level filtering, keyword search, auto refresh and one-click "open log directory"; setting changes are recorded in the log (field names only — secrets never reach the log).
- **Instance page**: latency is measured automatically right after connecting and refreshed in the background, so the list stays live without pressing "Test".
- **Connection switching is race-safe**: connecting to a second instance while the first attempt is still pending now supersedes the first cleanly — no contradictory success/failure toasts and no stale "current" marker.
- **UI polish**: button loading states replace the label with a centered spinner without changing the button size; empty states are vertically centred; switching pages no longer rebuilds the page from scratch.

## ⚠️ Known limitations

- Push notifications for the Web Console are not implemented; the page polls every 3 seconds while open.
- The PWA offline shell caches only the console UI, not task data — without a connection the last rendered state is shown.
- Webhook signatures cover the raw body only; receivers must tolerate clock skew when validating `X-Aria2-Timestamp`.

---

**Full changelog**: https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.6...v1.3.7
