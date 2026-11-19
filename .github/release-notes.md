# v1.4.0 更新日志

## ✨ 设计系统与界面一致性

- 全新的 v2 设计语言：重做设计系统底座与 UI 原语，页面、外壳与主题配色统一到同一套令牌，浅色与深色模式对比度均达到 AA。
- 设置弹窗改为左侧导航 + 内容区工作台，分组层级、搜索与保存栏更清晰。
- 设置弹窗标题按设计规格调整为 18px / 650，设置分组标题修正为 14px / 600；设置项、输入框、下拉框与按钮统一到 13px 设计字号，按钮高度统一为 28 / 34 / 40px。
- 8 个主页面统一页头到内容间距为 16px，去掉不同页面之间的 24px / 16px 混用。
- 任务详情抽屉移除重复的「基本信息」标题，状态标签移到抽屉标题栏；Peer 数量不再同时出现在标签页和卡片工具栏；抽屉标题栏的 1px 分隔线已移除。
- 下载页空态让面板填满剩余高度并垂直居中；「还没有任务」与「筛选无结果」改用不同文案。
- 修正品牌名、快捷键提示、图表标签等散落硬编码字号，统一使用设计令牌；21 种语言补齐 v2 文案，键盘焦点环、表单标签与点击区域一并修正。
- 任务列表与队列页的表格外观统一：表头、表尾去掉灰色底与多余圆角，白色卡片上不再出现色带；任务列表始终填满列表区域，列宽与快捷键提示收敛，下载任务页按 Ctrl+F 直接聚焦搜索框。
- 勾选任务时上方的批量操作条保持中性底色，不再变成紫色；服务器信息改用网格布局，复制按钮落在链接右侧。
- 暂停任务在列表与详情统一显示 0 B/s、剩余时间 --，不再出现残留速度读数。
- 实例页补充「新增连接」槽位卡，状态页指标带重新排布，剩余时间统一为 H:MM:SS 格式。
- 新建任务弹窗整理标签页与表单间距、分隔线，URI 输入框内置格式提示，错误态输入框不再发光。

## 🚀 新功能

- **限速改为自定义数值**：底部状态栏的限速面板不再只有 5 个预设档，可填写任意数值并切换 KB/s、MB/s；输入即生效（停止输入 500ms 后自动应用，回车或失焦立即提交），打开限速开关直接使用面板里填的值；没有历史限速值时不再自动填 1 MB/s。
- **通知中心支持单条删除**：每条通知右侧有删除按钮（鼠标悬停或键盘聚焦时出现，触屏设备常显），只删除这一条并立即保存。
- 实例页的连接配置支持直接删除。
- 设置中文件预分配新增「截断预分配」，适合固态硬盘；窗口状态与剪贴板监听改为固定开启，界面上的开关已移除，避免误关。

## 🎬 流媒体下载

- 通过「智能解析本页视频」发起的流媒体任务，可在任务列表与详情抽屉查看进度、速度与剩余时间，并支持暂停、继续、删除；删除时可勾选「同时删除文件」。
- 修复下载中标题乱码：以前 yt-dlp 在 Windows 上按本地编码输出标题，开始下载后列表里的中文会变成乱码；现在标题改从 UTF-8 文件读取，下载全程显示正确中文，磁盘上的文件名也保持正常。
- 修复未下载完就删除任务时残留 .part 分片的问题：分片统一落在临时目录，删除任务或下载完成后自动清理。
- 修复暂停后任务行速度归零、右上角总速度却不清零的问题，两处现在保持一致。
- 任务详情移除速度曲线（与当前速度、剩余时间信息重复，且占用空间）。

## 🧩 浏览器扩展

- 扩展弹窗按原型重构为「任务 / 网络嗅探 / 设置」三页（400×600），页面标题 18px / 650、正文 13px、辅助文字 11.5px，按钮与输入框约 28–34px；浅色主题辅助文字对比度提升，并补充键盘 focus-visible 可见边框。
- 任务页展示实时下载 / 上传速度与活动、等待数量；任务按「进行中 / 失败 / 已完成」三档筛选，可暂停、继续、删除。
- 任务列表合并 App 里由「智能解析本页视频」发起的流媒体任务（带「流媒体」角标），暂停 / 继续 / 删除与 App 内状态同步；删除任务不会删除已下载的文件。
- 网络嗅探监听当前标签页的 HTTP(S) 请求，支持按视频 / 音频 / 图片 / 其他筛选、勾选批量下载，并支持「智能解析本页视频」交给 App 的 yt-dlp；B 站等 DASH/MSE 页面的视频 / 音频分片会被识别并提示使用智能解析下载完整视频。
- 新增 Motrix 风格「新建下载」弹窗：全宽入口，支持 URL、文件名、保存到默认目录与可折叠的请求选项（User-Agent / Referer），含网址校验、Esc / 遮罩关闭；发送时保留页面 Referer 并传递文件名与自定义请求头。
- 长文件名不再撑宽弹窗，任务列表为空时卡片保持满高。

## 🛠 稳定性修复

- 修复下载完成后的关机 / 休眠 / 退出动作可能在断线重连、删除最后一个活动任务或任务失败时误触发的问题。
- 连接失败时销毁残留的 Aria2Service / WebSocket，避免界面显示未连接但后台仍在无限重连。
- 删除任务前先确认引擎结果，失败时不再让任务从列表消失；删除已完成任务的文件失败时保留任务记录，方便重试。
- 设置保存改为串行队列，保存失败时回滚内存中的设置；Escape 关闭设置弹窗时走未保存确认；重新加载失败不再清除脏标记。
- 删除任务或清空列表时清理自动重试定时器；BT 洞察快速切换任务时不再叠加多条轮询链。
- 任务栏进度只在百分比变化时更新，避免每秒重复 IPC。
- 修复空列表遮住「引擎未连接」提示的问题。

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

- typecheck、86 个测试文件 / 933 项单测、生产构建、扩展校验 21 项、扩展 API 校验 57 项、应用 E2E 159 项全部通过。
- 21 种语言文案保持完整；扩展 manifest 版本同步为 1.4.0。

---

**完整变更对比**：https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.8...v1.4.0

---

# v1.4.0 Release Notes

## ✨ Design system and UI consistency

- A new v2 design language: the design foundation and UI primitives were rebuilt, so pages, shells and theme colors share one set of tokens and both light and dark themes meet AA contrast.
- The settings dialog is now a left navigation rail plus a content workspace, with clearer grouping, search and save bar.
- The settings dialog title follows the design spec at 18px / 650 and settings group headings are corrected to 14px / 600; settings labels, inputs, selects and buttons share the 13px type scale, with button heights standardized at 28 / 34 / 40px.
- All eight main pages now use a consistent 16px gap between the page header and content, removing the previous 24px / 16px mix.
- The task detail drawer no longer repeats the "Basic info" title, the status tag moves into the drawer header, the peer count no longer appears twice, and the extra 1px divider in the header is gone.
- Empty states on the download page now fill the remaining height and center vertically; "no tasks yet" and "no matching results" use different copy.
- Replaced remaining hard-coded font sizes (brand name, keyboard hints, chart labels) with design tokens; all 21 locales received the v2 copy, and keyboard focus rings, form labels and tap targets were fixed along the way.
- Table chrome across the task list and queue pages is unified: headers and footers drop the grey fill and extra rounding, so no colour bands break the white cards; the task list always fills its area, column widths and shortcut hints are tightened, and Ctrl+F in the download page focuses the search box.
- The batch toolbar keeps a neutral background when tasks are selected instead of turning purple; server information uses a grid layout with the copy button next to the link.
- Paused tasks show 0 B/s and -- in both the list and the detail drawer, with no leftover speed readings.
- The Instances page gains a "new connection" slot card, the Status page metric strip is re-laid out, and remaining time is standardized to H:MM:SS.
- The new-task dialog tightens tab and form spacing and dividers, shows the URI format guide inside the textarea, and drops the focus glow on invalid inputs.

## 🚀 New features

- **Custom speed limits**: the status-bar limit panel no longer offers only five presets. Enter any value and switch between KB/s and MB/s; changes apply as you type (500 ms after you stop typing, or immediately on Enter / blur), and turning the limit switch on uses the value in the panel. Without a remembered value, the app no longer fills in 1 MB/s by itself.
- **Delete individual notifications**: every notification has a delete button on the right (shown on hover or keyboard focus, always visible on touch devices) that removes just that notification and saves immediately.
- Connection profiles can now be deleted directly from the Instances page.
- Settings gained a "truncate" file preallocation option, which suits SSDs; window state and clipboard monitoring are now fixed on, with their switches removed from the UI so they cannot be turned off by accident.

## 🎬 Stream downloads

- Stream tasks started from "Resolve this page video" can be followed in the task list and detail drawer with progress, speed and time remaining, and support pause, resume and remove; removing lets you tick "delete the file as well".
- Fixed garbled titles during download: yt-dlp used to emit titles in the local Windows encoding, so Chinese names turned into mojibake once the download started. Titles are now read from a UTF-8 file, so they stay correct for the whole download and the file on disk keeps its proper name.
- Fixed leftover .part segments when a stream task is removed before it finishes: partial files now live in a temporary directory and are cleaned up when the task is removed or the download completes.
- Fixed the header total speed staying above zero after pausing while the task row already showed zero; both now agree.
- Removed the speed chart from the task detail drawer (it duplicated current speed and time remaining and took up space).

## 🧩 Browser extension

- The extension popup is rebuilt around the prototype with Tasks, Network Sniffer and Settings pages (400×600): 18px / 650 page titles, 13px body, 11.5px secondary text and roughly 28–34px buttons and inputs. Secondary text contrast is improved in the light theme and keyboard focus-visible outlines are visible.
- The Tasks page shows live download / upload speed plus active and waiting counts; tasks can be filtered by Active / Failed / Completed and paused, resumed or removed.
- The task list now merges stream tasks started from "Resolve this page video" in the app (marked with a Stream badge); pause, resume and remove stay in sync with the app, and removing a task never deletes the downloaded file.
- Network Sniffer observes HTTP(S) requests from the current tab, filters video / audio / images / other, supports batch download, and can hand the page to the app's yt-dlp resolver. DASH/MSE segments (e.g. Bilibili) are recognized and point users to the smart resolver for the complete video.
- Added a Motrix-style New Download dialog with a full-width entry, URL, file name, default save location and collapsible request options (User-Agent / Referer), plus URL validation and Esc / backdrop dismissal; sending preserves the page Referer and passes the file name and custom headers.
- Long file names no longer widen the popup, and the task list card keeps its full height when empty.

## 🛠 Stability fixes

- Fixed download-complete actions (shutdown / sleep / quit) firing after a reconnect, after deleting the last active task, or when a task failed.
- Failed connections now dispose of the residual Aria2Service / WebSocket, so the app no longer shows "disconnected" while reconnecting endlessly in the background.
- Task deletion now waits for the engine result before removing the local row; deleting a completed task's files no longer drops the record when file removal fails, so the user can retry.
- Settings saves are serialized and roll back in-memory values on failure; Escape from the settings dialog respects the unsaved-changes confirmation; a failed reload no longer clears the dirty state.
- Auto-retry timers are cleaned up when tasks are deleted or the list is cleared; rapid task switching in BT Insights no longer stacks polling chains.
- Taskbar progress is sent only when the integer percentage changes, avoiding a redundant IPC call every second.
- Empty lists no longer hide the "engine disconnected" notice.

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

- typecheck, 86 test files / 933 unit tests, production build, 21 extension checks, 57 extension API checks and 159 application E2E checks all pass.
- All 21 locales remain complete; the extension manifest version is now 1.4.0.

---

**Full changelog**: https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.8...v1.4.0
