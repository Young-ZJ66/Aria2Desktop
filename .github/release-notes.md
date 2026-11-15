# Aria2Desktop v1.3.8 更新日志

> 中文在前，English below.

v1.3.8 聚焦设置页与日常操作体验：设置页重新整理为更清晰的独立页面，新增内置日志查看器；实例页在连接后自动测延迟并持续刷新，连接切换更可靠；同时统一打磨按钮加载态、空列表与页面切换。

## 🧩 设置页重组

- 设置页现在有 **10 个一级分组**：常规设置、本地引擎、下载设置、网络与协议、BitTorrent 设置、工具与插件、远程访问、日志、重置与备份、安全与维护。
- **远程访问独立成页**：远程 Web 控制台与 API 令牌不再埋藏在「高级设置」里。
- **日志**与**重置与备份**同样独立成页；高级设置只保留事件与内存、日志参数等底层选项。
- 远程访问页的排版与其他设置页统一：左侧标签、固定标签宽度与行距，不再是松散的上下结构。
- 远程 Web 控制台的「运行状态」改为监听端口上方的状态行，不再单独占用一张卡片。
- 重置与备份页分为「重置」「备份」两张卡片；备份区用勾选框控制是否包含密钥与令牌，按钮改为「导入配置」。

## 📜 内置日志查看器

- 新增**日志页**，直接查看应用日志 `main.log`，无需再手动翻找 `userData` 目录。
- 支持**级别过滤**（全部 / 信息 / 警告 / 错误）、**关键字搜索**、**自动刷新**（每 3 秒）与一键**打开日志目录**。
- 日志区域使用固定高度，始终控制在一页之内，长日志在区域内滚动。
- **设置变更会写入日志**：只记录改动的字段名，绝不记录用户填写的值——引擎密钥、Web 控制台令牌等敏感内容不会进入日志。

## 🔌 实例页面

- **连接后自动测延迟**：连接成功即自动测量一次延迟，不需要再手动点「测试」。
- **实时延迟**：已连接的实例在后台每 5 秒静默刷新延迟，列表始终保持最新。
- **连接切换竞态安全**：第一个实例还在连接时去连第二个实例，现在会干净地接管第一次尝试——不再同时弹出成功与失败提示，也不会残留错误的「当前」标记。

## 🎛️ 设置项微调

- 移除了一眼就能看出功能的设置项上的问号提示（如「最小化到托盘」「检查更新」「自动启动」等），只保留带额外信息的说明。
- 公共设置页的「重新加载」按钮在点击后显示加载圈。

## 🖥️ 工作流页面

- 工作流从设置中独立为**工作流页面**，模板、规则与投递队列在同一页内分页签管理。

## ✨ 界面打磨

- **按钮加载态**：点击后文字位置换成加载圈，按钮的形状、长度与宽度完全不变（含带图标的按钮）。
- **空列表**：BT 洞察、自动化与工作流页面的空列表图标垂直居中，不再顶在卡片上方。
- **页面切换**：切换页面时保留页面状态，不再从头重建，也没有空白闪烁或残影。

## 🧩 其它变更

- 扩展弹窗：连接失败的长文案移到独立的状态详情行完整折行显示，不再被状态胶囊截断。
- 21 种语言补齐新增文案。
- 新增连接切换竞态与设置变更日志的单元测试。

## ⚠️ 已知限制

- Web 控制台尚未实现推送通知；页面打开期间每 3 秒轮询一次。
- PWA 离线壳只缓存控制台界面，不缓存任务数据——无连接时显示最后一次渲染的状态。

---

**完整变更对比**：https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.7...v1.3.8

---

# Aria2Desktop v1.3.8 Release Notes

v1.3.8 focuses on the settings experience and day-to-day workflow: the settings dialog is reorganized into clearer standalone pages and gains a built-in log viewer; the Instances page now measures latency automatically after connecting and keeps it fresh, and switching connections is more reliable. Button loading states, empty states and page switching are polished throughout.

## 🧩 Settings reorganized

- The settings dialog now has **10 top-level groups**: General, Local Engine, Downloads, Network & Protocol, BitTorrent, Tools & Plugins, Remote Access, Logs, Reset & Backup, and Security & Maintenance.
- **Remote Access is a standalone page**: the Remote Web Console and API tokens are no longer buried under Advanced Settings.
- **Logs** and **Reset & Backup** are standalone pages too; Advanced Settings keeps only low-level options such as events, memory and log parameters.
- The Remote Access page now uses the same layout as every other settings page: left-aligned labels, a fixed label width and consistent row spacing.
- The Remote Web Console "run status" is now a status row above the listening port instead of taking a card of its own.
- Reset & Backup is split into "Reset" and "Backup" cards; a checkbox controls whether secrets and tokens are included, and the file button is now "Import configuration".

## 📜 Built-in log viewer

- A new **Logs** page shows the application log `main.log` directly, with no need to dig through the `userData` directory.
- Supports **level filtering** (All / Info / Warn / Error), **keyword search**, **auto refresh** (every 3 seconds) and one-click **open log directory**.
- The log area has a fixed height and always fits within one page; long logs scroll inside it.
- **Setting changes are written to the log**: only the names of the changed fields are recorded, never the values — engine secrets, Web Console tokens and other sensitive content never reach the log.

## 🔌 Instances page

- **Latency is measured automatically after connecting** — no need to press "Test" any more.
- **Live latency**: the connected instance refreshes its latency silently in the background every 5 seconds, so the list stays up to date.
- **Connection switching is race-safe**: connecting to a second instance while the first attempt is still pending now supersedes the first cleanly — no contradictory success/failure toasts and no stale "current" marker.

## 🎛️ Settings tweaks

- Removed the question-mark tooltips from settings whose label already explains the feature (e.g. "Minimize to tray", "Check for updates", "Launch at startup"), keeping only the ones with extra information.
- The shared "Reload" button on settings pages now shows a spinner while reloading.

## 🖥️ Workflow page

- Workflow is now a dedicated **Workflow page** instead of a settings section; templates, rules and the delivery queue live in tabs on the same page.

## ✨ UI polish

- **Button loading states**: clicking a button replaces its label with a centered spinner while the button's shape, width and height stay exactly the same (icon buttons included).
- **Empty lists**: the empty-state icons on BT Insights, Automation and Workflow are vertically centered instead of sticking to the top of the card.
- **Page switching**: pages keep their state when you switch away and back — no rebuild from scratch, no blank flash and no ghosting.

## 🧩 Other changes

- Extension popup: long connection-failure messages move to a dedicated status-detail line that wraps fully instead of being truncated inside the status pill.
- All 21 languages updated with the new strings.
- Added unit tests for connection-switch races and settings-change logging.

## ⚠️ Known limitations

- Push notifications for the Web Console are not implemented; the page polls every 3 seconds while open.
- The PWA offline shell caches only the console UI, not task data — without a connection the last rendered state is shown.

---

**Full changelog**: https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.7...v1.3.8
