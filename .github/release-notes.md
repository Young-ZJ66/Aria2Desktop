# v1.5.0-beta.2 更新日志

> 这是 1.5.0 的第二个预发布版本，供验证使用。稳定版 1.5.0 将在验证通过后发布。

## 📌 beta.2 相对 beta.1 的变化

- **主进程文案本地化**：引擎启动失败对话框与系统通知、更新校验失败、yt-dlp/ffmpeg 安装、RSS 订阅与监听目录校验、Web 控制台 TLS 错误、UPnP 映射失败、扩展配对、托盘菜单等 60+ 处此前硬编码中文的文案，现在按系统语言输出中英双语。英文/日文等界面不再在最关键的失败场景看到中文。
- 引擎启动失败分类器同时识别中英文错误串，避免英文界面下失败原因退化成「未知」。
- 新增主进程文案表的单元测试（中英齐全、占位符替换）与 v1.4.0 升级兼容用例（缺失配置块回落默认值、已有凭据不被覆盖），单测总数 1203 → 1225。

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

- typecheck（主进程 + 测试代码 + 渲染层）通过；109 个测试文件 / 1225 项单测全部通过。
- 应用 E2E 144 项全部通过（含首次启动向导、设置页、新建任务、真实下载、插件、Web 控制台）。
- 扩展静态校验 21 项通过；21 种语言文案 key 保持完整。

---

**完整变更对比**：https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.4.0...v1.5.0-beta.2

---

# v1.5.0-beta.2 Release Notes

> This is the second pre-release of 1.5.0 for validation. The stable 1.5.0 will follow once it is verified.

## 📌 What changed since beta.1

- **Main-process messages are localized**: engine startup failure dialogs and notifications, update verification failures, yt-dlp/ffmpeg installs, RSS subscription and watch-folder validation, web console TLS errors, UPnP mapping failures, extension pairing and the tray menu — 60+ strings that used to be Chinese-only now follow the system language.
- The engine startup failure classifier now recognizes both Chinese and English messages, so English UIs no longer fall back to an "unknown" reason.
- Added unit tests for the main-process copy tables (both languages present, placeholders substituted); total unit tests 1203 → 1221.

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

- Typecheck (main process, tests, renderer) passes; 109 test files / 1225 unit tests pass.
- All 144 application E2E checks pass (first-run wizard, settings, new task, real download, plugins, web console).
- All 21 extension static checks pass; the 21 locales remain complete.

---

**Full changelog**: https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.4.0...v1.5.0-beta.1
