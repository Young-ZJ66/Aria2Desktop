# Aria2Desktop v1.4.0 更新日志

## ✨ 界面一致性

- 设置弹窗标题按设计规格调整为 18px / 650，设置分组标题修正为 14px / 600，层级更清晰。
- 设置项、输入框、下拉框与按钮统一到 13px 设计字号；按钮高度统一为 28 / 34 / 40px，和桌面端控件规范一致。
- 8 个主页面统一页头到内容间距为 16px，去掉不同页面之间的 24px / 16px 混用。
- 任务详情抽屉移除重复的「基本信息」标题，状态标签移到抽屉标题栏；Peer 数量不再同时出现在标签页和卡片工具栏。
- 抽屉标题栏移除多余的 1px 分隔线，与设置、新建任务等弹窗的标题栏样式一致。
- 修正品牌名、快捷键提示、图表标签等散落硬编码字号，统一使用设计令牌。

## 🧩 浏览器扩展

- 扩展弹窗重新调整字号与间距：标题 15px / 650，正文 13px，辅助文字 11.5px，输入框与按钮高度约 32–33px；浅色主题辅助文字对比度提升，并补充键盘 focus-visible 可见边框。
- 扩展弹窗按原型重构为「任务 / 网络嗅探 / 设置」三页，新增实时任务列表（暂停 / 继续 / 删除）、顶部状态指标与底部导航，统一 400×600 布局。
- 网络嗅探监听当前标签页的 HTTP(S) 请求，支持按视频 / 音频 / 图片 / 其他筛选、勾选批量下载，并支持「智能解析本页视频」交给 App 的 yt-dlp。
- 新增 Motrix 风格「新建下载」弹窗：全宽入口，支持 URL、文件名、保存到默认目录与可折叠的请求选项（User-Agent / Referer），含网址校验、Esc / 遮罩关闭；发送时保留页面 Referer 并传递文件名与自定义请求头。

## 🛠 稳定性修复

- 修复下载完成后的关机 / 休眠 / 退出动作可能在断线重连、删除最后一个活动任务或任务失败时误触发的问题。
- 连接失败时销毁残留的 Aria2Service / WebSocket，避免界面显示未连接但后台仍在无限重连。
- 删除任务前先确认引擎结果，失败时不再让任务从列表消失；删除已完成任务的文件失败时保留任务记录，方便重试。
- 设置保存改为串行队列，保存失败时回滚内存中的设置；Escape 关闭设置弹窗时走未保存确认；重新加载失败不再清除脏标记。
- 删除任务或清空列表时清理自动重试定时器；BT 洞察快速切换任务时不再叠加多条轮询链。
- 任务栏进度只在百分比变化时更新，避免每秒重复 IPC。

## ⚡ 性能

- 日志查看器只读取日志文件末尾 1MB；刷新时保持用户当前滚动位置；页面不可见时暂停自动刷新；长日志行启用 content-visibility。
- 状态页流量图移除 O(n²) 的坐标标签重复计算；流量监控在页面隐藏时停止采样。
- 任务轻量刷新只请求活动任务，不再每秒拉取 5000 条等待任务；轻量刷新与全量刷新互斥，避免旧响应覆盖新列表。
- SQLite 历史裁剪改为批量触发，避免每次保存都执行 COUNT / DELETE。

## 🖥 Electron 与更新

- ffmpeg 安装失败时恢复旧版本；yt-dlp 更新失败时从备份回滚，避免更新失败后无可用组件。
- 主窗口关闭后清空引用，macOS 点击 Dock 可重新创建窗口。
- 应用退出时关闭历史数据库；更新临时目录会清理旧版本半截下载与已完成安装包，减少磁盘占用。

## ✅ 验证

- typecheck、85 个测试文件 / 902 项单测、生产构建、扩展校验 21 项、扩展 API 校验 46 项、应用 E2E 138 项全部通过。
- 21 种语言文案保持完整；扩展 manifest 版本同步为 1.4.0。

---

**完整变更对比**：https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.8...v1.4.0

---

# Aria2Desktop v1.4.0 Release Notes

## ✨ UI consistency

- The settings dialog title now follows the design spec at 18px / 650, and settings group headings are corrected to 14px / 600 for a clearer hierarchy.
- Settings labels, inputs, selects and buttons now share the 13px type scale; button heights are standardized at 28 / 34 / 40px to match the desktop control system.
- All eight main pages now use a consistent 16px gap between the page header and content, removing the previous 24px / 16px mix.
- The task detail drawer no longer repeats the "Basic info" title, the status tag moves into the drawer header, and the peer count no longer appears in both the tab and the card toolbar.
- The drawer header no longer has an extra 1px divider, matching the header treatment used by Settings, New Task and other dialogs.
- Replaced remaining hard-coded font sizes in the brand name, keyboard hints and chart labels with design tokens.

## 🧩 Browser extension

- The extension popup now uses a clearer type and spacing system: 15px / 650 title, 13px body, 11.5px secondary text, and approximately 32–33px inputs and buttons. Secondary text contrast is improved in the light theme and keyboard focus-visible outlines are visible.
- The extension popup is rebuilt around the prototype with Tasks, Network Sniffer and Settings pages, including a live task list (pause / resume / remove), status metrics and bottom navigation in a 400×600 layout.
- Network Sniffer observes HTTP(S) requests from the current tab, filters video / audio / images / other, supports batch download, and can hand the current page to the app's yt-dlp resolver.
- Added a Motrix-style New Download dialog with a full-width entry, URL, file name, default save location and collapsible request options (User-Agent / Referer), plus URL validation and Esc / backdrop dismissal; sending preserves the page Referer and passes the file name and custom headers.

## 🛠 Stability fixes

- Fixed download-complete actions (shutdown / sleep / quit) firing after a reconnect, after deleting the last active task, or when a task failed.
- Failed connections now dispose of the residual Aria2Service / WebSocket, so the app no longer shows "disconnected" while reconnecting endlessly in the background.
- Task deletion now waits for the engine result before removing the local row; deleting a completed task's files no longer drops the record when file removal fails, so the user can retry.
- Settings saves are serialized and roll back in-memory values on failure; Escape from the settings dialog respects the unsaved-changes confirmation; a failed reload no longer clears the dirty state.
- Auto-retry timers are cleaned up when tasks are deleted or the list is cleared; rapid task switching in BT Insights no longer stacks polling chains.
- Taskbar progress is sent only when the integer percentage changes, avoiding a redundant IPC call every second.

## ⚡ Performance

- The log viewer reads only the last 1MB of the log file, preserves the user's scroll position on refresh, pauses auto-refresh while the page is hidden, and enables content-visibility for long log lines.
- Removed the O(n²) axis-label recomputation from the status traffic chart; traffic sampling stops while the page is hidden.
- Light task refresh now requests only active tasks instead of pulling 5,000 waiting tasks every second; light and full refreshes are mutually exclusive so stale responses cannot overwrite newer data.
- SQLite history trimming is batched instead of running COUNT / DELETE on every save.

## 🖥 Electron and updates

- ffmpeg installation restores the previous version on failure; yt-dlp update restores its backup when the new binary fails verification.
- The main window reference is cleared on close, allowing macOS Dock activation to recreate the window.
- The history database is closed on shutdown; the update temp directory now removes stale partial downloads and completed installers from older versions.

## ✅ Verification

- typecheck, 85 test files / 902 unit tests, production build, 21 extension checks, 46 extension API checks and 138 application E2E checks all pass.
- All 21 locales remain complete; the extension manifest version is now 1.4.0.

---

**Full changelog**: https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.8...v1.4.0
