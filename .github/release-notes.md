# v1.5.0-beta.4 更新日志

> 这是 1.5.0 的第四个预发布版本，供验证使用。稳定版 1.5.0 将在验证通过后发布。

## 📌 beta.4 相对 beta.3 的变化

本版**没有任何功能或行为改动**，只有依赖安全升级——beta.3 已验证过的功能在这一版里保持不变，请重点回归"更新、下载、插件、Web 控制台"这些与依赖相关的路径。

- **依赖安全升级**：修掉 `npm audit` 报出的 34 个漏洞（18 moderate / 15 high / 1 critical），其中包含 axios 的拒绝服务、Vue 与 vue-i18n 相关告警、vite 开发服务器与 shell-quote 的命令注入链。运行时 Electron 43.4.0 → 43.8.12，Vue 3.5.46、axios 1.21.1、vite 8.3.8、vitest 5.1.1。`npm audit --omit=dev`（真正随应用发布的生产依赖）现在为 0。
- **仍有 6 个 moderate**：全部来自 electron-builder 26.18.1 的打包工具链（@electron/universal、app-builder-lib、dmg-builder、minimatch），只在构建期运行、不随安装包发布，等上游修版后消除。
- **两个发版闸门**（beta.3 引入，本版继续生效）：`npm run verify:versions` 一次校验五处版本号是否自洽，`npm run verify:registry` 按客户端同一口径校验插件注册表结构与签名。两者都在 CI 与发布流水线里跑。
- **新增生产依赖漏洞闸门**：`npm run verify:audit` 直接跑 `npm audit --omit=dev`，生产依赖只要出现已知漏洞就让 CI 变红。它只拦 CI、不做发版硬闸门——新披露的漏洞不一定有可用修复，硬卡会挡住发布。

## 🎯 主题：可信接管

这一版把"装完能不能真的接管浏览器下载、升级会不会坏、配置会不会丢"这条链路修到可信，
再补齐任务编辑、失败可见性、首次使用引导等主路径体验。

## 🚀 新功能

- **首次启动向导**：下载目录 / 浏览器扩展 / 流媒体工具 / 远程访问四步引导，可跳过、可随时在设置中修改。
- **任务详情可编辑**：支持修改单任务选项（限速、连接数、保存目录、代理等），不必删除重建。
- **失败可见性**：下载任务页新增"仅看失败"筛选与批量重试；批量操作结果面板统一展示成功 / 失败 / 跳过数量与逐项失败原因，失败项保留选中状态。
- **状态页趋势图**：新增 7 天 / 30 天下载趋势（复用本地 90 天历史数据）。
- **Web 控制台**：中英双语界面、明暗主题跟随系统、"暂停全部 / 继续全部"；支持 HTTPS 监听，局域网访问强制加密；新增细粒度 API 令牌与更细的作用域校验。
- **MCP**：22 个工具补齐只读 / 破坏性标注，按工具粒度校验权限，破坏性工具要求 `confirm: true`。
- **插件市场**：注册表强制 Ed25519 签名校验，新装插件默认禁用，安装前展示发布者、来源、SHA-256 与权限清单。
- **流媒体任务持久化**：重启后保留完成 / 失败记录，中断任务标记为可重试；播放列表多文件完整记录。
- **引擎启动失败分类提示**：区分端口占用 / 遗留进程 / 可执行文件缺失 / 配置错误，并提供更换端口、重试、查看日志等操作；引擎放弃重启时通过系统通知 + 托盘异常态 + 应用内提示三通道告知。
- **托盘提示气泡**显示当前下载速度与活动任务数。
- **阿拉伯语从右到左排版**：侧边栏、设置、对话框、表格与开关等写死方向的组件全部镜像。

## 🎨 变更

- 设置弹窗左侧导航按"应用与引擎 / 下载与网络 / 组件与连接 / 维护与安全"分组，设置项搜索按页签分组展示。
- 队列页的"最大并发下载数"改为只读展示 + 跳转设置，消除与设置页的重复入口。
- 流媒体任务纳入统一体验：页脚速度 / 活动数、托盘提示、完成规则（移动 / 重命名 / 打开 / 通知 / Webhook）、下载历史统计；并发上限 3 条，超限时给出明确提示。
- 剪贴板监控改为默认关闭，需在「常规设置」显式开启。
- 多 URL 新建下载按行创建独立任务（此前被当成 aria2 镜像合并）；镜像下载仅作为显式高级选项。
- 种子 / Metalink 上传大小上限跟随引擎的 `rpc-max-request-size` 折算，不再写死 1MB。
- 主进程文案本地化：引擎启动失败、更新校验、组件安装、订阅 / 监听目录校验、Web 控制台 TLS 与 UPnP 映射失败等错误和对话框，按系统语言输出中英双语（此前英文界面会看到中文报错）。
- README 与安装说明改为跨平台表述，补充 macOS / Linux 的未签名安装提示与配置目录位置。

## 🔒 安全

- **修复设置保存白名单遗漏**：队列重试策略、任务模板、完成规则 / Webhook、Web 控制台令牌与 TLS 配置、插件市场开关与信任公钥此前会在每次保存时被静默丢弃，现已全部保留并校验。
- 插件市场注册表固定到发布 tag 并强制 Ed25519 签名；插件 settings 读取强制脱敏 Web 控制台令牌。
- 扩展配对改为下发受作用域限制的应用令牌，不再返回 aria2 RPC 密钥；配对确认框展示扩展名称与 ID。
- MCP 工具按作用域鉴权，`remove_task` / `pause_all` / `purge_download_result` 需二次确认；任务名做控制字符清洗防提示注入。
- Web 控制台页面改用事件委托绑定交互，并下发严格的 `Content-Security-Policy`，消除任务列表拼接 `gid` 造成的注入面；事件流（SSE）在连接期间定期复核令牌，权限被收回时立即断开。
- Web 控制台新建任务校验下载协议白名单，保存目录限制在下载根目录内；流媒体保存目录按真实路径（含符号链接）限制在下载根目录内。
- Web 控制台的操作审计日志持久化到用户数据目录，重启后仍在（保留最近 500 条）。

## 🛠 修复

- **更新"重启并安装"不再留下孤儿 aria2 进程**：退出前等待引擎关闭与端口释放，失败则强制结束进程树；安装程序启动失败会重新拉起引擎。
- 更新安装包路径持久化，重启后仍可继续安装；下载的安装包被删除时自动清理状态。
- 托盘"显示主窗口"、双击托盘、磁力链接唤起在窗口最小化时能正确还原。
- 插件 worker 生命周期加入世代校验，旧 worker 退出不再污染新实例；插件加载超时会终止 worker；升级失败回滚旧版本。
- `--headless` 模式不再创建渲染窗口，Linux 无 `$DISPLAY` 也能启动。
- 配置导入会同步写入 `aria2.conf` 并提示需要重启引擎。
- 切换连接改为"先探测后切换"，新实例连接失败时保留原连接与任务列表。
- 种子 / Metalink 解析失败会给出具体原因并阻止提交（此前静默按全部文件下载）。
- 拖拽支持一次拖入多个文件，逐个创建任务；拖入文本支持 `sftp` 链接。
- 流媒体重试完整透传播放列表 / 字幕 / Cookie / 仅音频等参数；失败任务勾选"删除文件"失败时保留任务记录。
- 通知中的失败任务标题回退到文件名或链接；通知去重不再被交错任务刷屏；日期时间统一按当前语言格式化。
- Chromium `ERR_*` 网络错误与队列页错误文案纳入统一错误映射；完成页删除失败的原因改为本地化文案并逐项列明。
- 关闭 Web 控制台时主动结束 keep-alive 空闲连接，避免停止服务要等到连接超时才返回。
- 设置弹窗的未保存提示不再误报：命中缓存的设置页在重新加载后正确对齐脏标记。

## ✅ 验证

- typecheck（主进程 + 测试代码 + 渲染层）通过；126 个测试文件 / 1403 项单测通过（引擎重启压力测试默认跳过）。
- Web 控制台页面内联脚本/样式的 CSP 哈希由单测逐字节校验，改了内联脚本却忘同步哈希会直接失败（否则浏览器会静默拒绝执行脚本，页面白屏）。
- `npm audit --omit=dev` 为 0；`npm audit` 从 34 个漏洞降到 6 个 moderate（仅 electron-builder 打包工具链，构建期依赖）。
- 应用 E2E 191 项全部通过（含首次启动向导、设置页、新建任务、真实下载、插件、状态筛选、任务设置面板、下载趋势、阿拉伯语 RTL 镜像布局）；其中 16 项是 Web 控制台的 HTTP 级断言（登录页安全头、PWA 资源、OpenAPI、无令牌/错令牌 401、非法 URI 400、SSE 首帧、审计留痕并落盘），此前该模块端到端零覆盖。
- 扩展静态校验 21 项通过；扩展多浏览器 smoke 50 项通过（Chrome for Testing / Chromium / Edge，Firefox 走 MV3 变体静态校验）；21 种语言文案 key 与占位符保持一致，1.5.0 新增文案已全部翻译。
- 引擎更新重启压力测试 50 轮通过（无残留端口、无孤儿进程）。

---

**完整变更对比**：https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.4.0...v1.5.0-beta.4

---

# v1.5.0-beta.4 Release Notes

> This is the fourth pre-release of 1.5.0 for validation. The stable 1.5.0 will follow once it is verified.

## 📌 What changed since beta.3

This release contains **no feature or behaviour changes** — only a dependency security upgrade. Everything you verified in beta.3 behaves identically; please focus regression testing on updates, downloads, plugins and the web console, which are the paths that touch these dependencies.

- **Dependency security upgrade**: fixes the 34 advisories reported by `npm audit` (18 moderate / 15 high / 1 critical), including an axios denial-of-service, advisories around Vue and vue-i18n, and a command-injection chain through the vite dev server and shell-quote. Electron runtime 43.4.0 → 43.8.12, Vue 3.5.46, axios 1.21.1, vite 8.3.8, vitest 5.1.1. `npm audit --omit=dev` (the production dependencies actually shipped) now reports zero.
- **Six moderate advisories remain**: all from the electron-builder 26.18.1 packaging toolchain (@electron/universal, app-builder-lib, dmg-builder, minimatch). They run at build time only and are not shipped in the installer; they will clear once upstream ships a fix.
- **Two release gates** (added in beta.3, still active): `npm run verify:versions` checks that the five version literals agree, and `npm run verify:registry` checks the plugin registry structure and signature with the same rules as the client. Both run in CI and the release pipeline.
- **New production-dependency audit gate**: `npm run verify:audit` runs `npm audit --omit=dev`, so any known advisory in a shipped dependency turns CI red. It is a CI gate only, not a release blocker — a freshly disclosed advisory may have no available fix, and blocking on it would stall releases.

## 🎯 Theme: taking over, verifiably

This release makes the "can it really take over browser downloads, will upgrading break anything, will my configuration survive" path trustworthy, then fills in task editing, failure visibility and first-run guidance.

## 🚀 New features

- **First-run wizard**: a four-step guide for download folder / browser extension / stream tooling / remote access, skippable and editable later in Settings.
- **Editable task options**: change speed limit, connections, save directory and proxy per task without deleting and re-adding it.
- **Failure visibility**: a "failed only" filter and batch retry on the downloads page; a batch result panel reports succeeded / failed / skipped counts with per-item reasons and keeps failed items selected.
- **Status trends**: 7-day and 30-day download trends on the Status page, reusing the local 90-day history.
- **Web console**: bilingual UI, light / dark theme following the system, "pause all / resume all"; HTTPS listening with mandatory encryption for LAN access; fine-grained API tokens with tighter scope checks.
- **MCP**: all 22 tools now declare read-only / destructive annotations, permissions are checked per tool, and destructive tools require `confirm: true`.
- **Plugin market**: the registry must be Ed25519-signed, newly installed plugins start disabled, and the install dialog shows publisher, source, SHA-256 and permissions.
- **Stream task persistence**: completed / failed stream tasks survive a restart, interrupted ones are marked retryable, and playlists record every file.
- **Engine startup failures** are classified (port in use / leftover engine / missing executable / config error) with actions to change the port, retry or open logs; when the engine gives up, the app notifies through a system notification, the tray and an in-app toast.
- **Tray tooltip** shows the current download speed and active task count.
- **Right-to-left layout** for Arabic: sidebar, settings, dialogs, tables and switches are mirrored.

## 🎨 Changes

- Settings navigation is grouped into Application & engine / Download & network / Components & connections / Maintenance & security, and settings search results are grouped by tab.
- "Max concurrent downloads" on the Queue page is read-only and links to Settings, removing the duplicate control.
- Stream tasks join the rest of the app: footer speed / active counts, tray tooltip, completion rules (move / rename / open / notify / webhook) and download history, with a concurrency cap of 3 and a clear message when exceeded.
- Clipboard monitoring is off by default and must be enabled in General settings.
- Multiple URLs create one task per line (they used to be merged as aria2 mirrors); mirroring is now an explicit advanced option.
- The torrent / Metalink upload limit follows the engine's `rpc-max-request-size` instead of a hard-coded 1MB.
- Main-process messages are localized: engine startup failures, update verification, component installs, subscription / watch-folder validation, web console TLS and UPnP mapping errors are shown in English on English systems (they used to be Chinese-only).
- README and install docs are cross-platform, covering unsigned installs on macOS / Linux and their config directories.

## 🔒 Security

- **Fixed a settings save whitelist gap**: queue retry policy, task templates, completion rules / webhooks, web console tokens and TLS paths, and plugin market settings plus trusted publishers were silently dropped on every save. They are now preserved and validated.
- The plugin registry is pinned to a release tag and must be Ed25519-signed; plugin settings reads redact web console tokens.
- Extension pairing issues a scoped app token instead of the aria2 RPC secret, and the pairing prompt shows the extension name and ID.
- MCP tools are authorized by scope, `remove_task` / `pause_all` / `purge_download_result` require a second confirmation, and task names are stripped of control characters to prevent prompt injection.
- The web console page uses event delegation and a strict `Content-Security-Policy`, removing the injection surface from interpolating `gid` into the task table; SSE connections re-check the token periodically and drop immediately when permission is revoked.
- Web console task creation validates the URI scheme whitelist and confines the save directory to the download root; stream save directories are confined by real path (symlinks resolved).
- Web console audit logs persist in the user data directory across restarts (last 500 entries kept).

## 🛠 Fixes

- **"Restart and install" no longer leaves an orphaned aria2 process**: the app waits for the engine to shut down and the port to be released, force-kills the process tree on failure, and restarts the engine if the installer fails to launch.
- The downloaded installer path persists across restarts; deleting the installer clears the state.
- Tray "show main window", double-click and magnet links restore a minimized window correctly.
- Plugin workers use generation checks so a stale worker cannot pollute a new instance; loading times out and terminates the worker; a failed upgrade rolls back to the previous version.
- `--headless` no longer creates a render window and starts on Linux without `$DISPLAY`.
- Importing a configuration writes `aria2.conf` and prompts for an engine restart.
- Switching connections probes first and keeps the current connection and task list when the new instance fails.
- Torrent / Metalink parse failures show the concrete reason and block submission instead of silently downloading every file.
- Dragging in several files creates one task each; dropped text accepts `sftp` links.
- Stream retries carry playlist / subtitle / cookie / audio-only options; removing a failed stream task with "delete file" keeps the record when deletion fails.
- Notification titles for failed tasks fall back to the file name or URL; notification deduplication is no longer flooded by interleaved tasks; dates follow the current language.
- Chromium `ERR_*` network errors and Queue page errors share the same message mapping; completed-task delete failures use localized per-item reasons.
- Stopping the web console closes keep-alive idle connections instead of waiting for a timeout.
- The settings unsaved-changes prompt no longer fires falsely: pages that load from cache realign their dirty state after a reload.

## ✅ Verification

- Typecheck (main process, tests, renderer) passes; 126 test files / 1403 unit tests pass (the engine-restart stress test is skipped by default).
- `npm audit --omit=dev` reports zero; `npm audit` drops from 34 advisories to 6 moderate ones (electron-builder packaging toolchain only, build-time dependencies).
- All 191 application E2E checks pass (first-run wizard, settings, new task, real download, plugins, status filter, per-task settings, download trend, Arabic RTL mirroring), of which 16 are HTTP-level web console checks (security headers, PWA assets, OpenAPI, 401 without/with a wrong token, 400 on an invalid URI, first SSE frame, audit trail written to disk); that module previously had no end-to-end coverage at all.
- All 21 extension static checks pass; the multi-browser extension smoke passes 50 checks (Chrome for Testing / Chromium / Edge; Firefox is covered by the MV3 variant static checks); all 21 locales keep matching keys and placeholders, and every 1.5.0 string is translated.
- The 50-round engine restart stress test passes with no leftover ports or orphan processes.

---

**Full changelog**: https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.4.0...v1.5.0-beta.4
