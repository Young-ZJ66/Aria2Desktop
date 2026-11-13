# Aria2 Desktop 路线图

> 更新于 2026-11-14，适用于 v1.3.x 系列。版本范围会随社区反馈调整，已发布内容以 [GitHub Releases](https://github.com/Young-ZJ66/Aria2Desktop/releases) 为准。

## 当前状态

v1.3.6 已发布：新增「自动化」页面（RSS/Atom 订阅定时抓取 + 监听文件夹自动导入，含过滤/去重/导入日志），yt-dlp 支持播放列表勾选下载、字幕、Cookie 与画质预设，浏览器扩展提供 Firefox（AMO）上架变体；Aria2Desktop 已被 [AppImage 目录](https://appimage.github.io/) 收录。应用内置 Aria2 引擎（Windows / Linux 1.37.0，macOS 1.36.0）。

## v1.3.x 迭代计划

| 版本 | 主题 | 主要交付 | 验收标准 |
| --- | --- | --- | --- |
| **v1.3.3**（已发布） | 界面一致性与国际化 | 统一页面头部、内容栅格与卡片间距；设置页扁平分组与控件宽度统一；建立主按钮/次按钮/危险按钮/文本按钮规范，白色按钮恢复 hover 蓝字蓝边；补齐简体中文、繁体中文、英语、日语、韩语、德语、法语、西班牙语、葡萄牙语（巴西）、意大利语、俄语、阿拉伯语、印地语、泰语、越南语、印度尼西亚语、土耳其语、荷兰语、波兰语、乌克兰语、捷克语共 21 种界面文案与 RTL 适配；日期、数字、相对时间本地化；长文案不截断，设置弹窗/抽屉适配小屏；键盘导航与 focus-visible 可见性 | 21 种语言关键页面截图检查通过；无硬编码文案；typecheck、lint、单测、E2E 全部通过 |
| **v1.3.4**（已发布） | Linux 兼容性修复 | 修复 Linux AppImage 在 Firejail、AppImageHub 等无用户命名空间环境中主窗口空白、只剩托盘图标的问题：移除主进程 `appendSwitch('no-sandbox')`，改由 electron-builder 的 AppRun 在 exec 前探测用户命名空间并按需追加 `--no-sandbox`；新增英文 README（`README.en.md`）与中文版语言切换入口 | AppImageHub 同款 Firejail 环境实测主窗口正常加载，AppImage 目录 PR #11313 重测通过并合并；原计划中的包管理器清单与稳定性事项顺延至「持续改进」 |
| **v1.3.5**（已发布） | 增量更新与数据基础 | Linux AppImage 内嵌 `gh-releases-zsync` 更新信息（写入 runtime `.upd_info` 节区）并随发版提供 `.zsync` 增量文件，消除 AppImage 目录「无更新信息」警告；任务历史由 JSON 迁移至 SQLite（Node 内置 `node:sqlite`、WAL 模式、上限 5 万条、旧数据自动迁移、无 SQLite 环境回退 JSON）；新增 BT 洞察页：Peers / Tracker 表格、做种数与聚合速度汇总卡，页面可见时每 5 秒轮询，21 种语言全部翻译 | CI 嵌入与 zsync 生成通过 verify-dist 校验；typecheck、lint、691 项单测、build、扩展校验、E2E 137 项全部通过 |
| **v1.3.6**（已发布） | 内容订阅与媒体工作流 | 新增自动化页面：RSS 2.0/Atom 订阅（内置零依赖解析器、包含/排除正则、单次上限 1–50、间隔 5 分钟–7 天、条目去重 500 条 FIFO、磁力/种子/直链三类下发）；监听文件夹自动导入 `.torrent`/`.metalink`/磁力文本（mtime≥3s+大小稳定判定、SHA-256 内容去重、导入后删除或移入 `imported/`、失败下轮重试）；最近 200 条导入日志；yt-dlp 播放列表（flat 解析 ≤500 条、勾选下载、进度显示条目标题/序号）、字幕（含自动生成、转 srt）、Cookie 文件与画质预设；Firefox 扩展 AMO 变体（background.scripts 事件页 + gecko 设置，`pack:extension-firefox` 随发版产出，扩展校验 16→21 项） | 795 项单测、typecheck、lint、build、扩展校验 21 项、API 校验 46 项、E2E 137 项全部通过；21 种语言全部翻译（96 新键） |
| **v1.3.7** | 远程与自动化 | 移动端 Web 控制台/PWA（安全登录、离线壳、推送可选）；OpenAPI 文档与细粒度 Token 权限；Webhook 重试、失败队列与 HMAC 签名；配置导出/同步；headless 注册为系统服务 | OpenAPI 契约测试通过；Token 越权测试拦截；Webhook 重试与签名校验通过；手机端常用操作可用 |
| **v1.3.8** | 插件生态与可访问性 | 插件 UI 扩展点（任务行、设置页、详情面板）；插件市场评分/举报/版本回滚；更多语言与 RTL 布局；WCAG 2.1 AA 基础适配（对比度、语义标签、屏幕阅读器） | 示例插件使用全部扩展点；插件市场安装/回滚通过；可访问性自动扫描无严重问题 |

## 持续改进（不绑定版本）

- **性能**：批量 RPC（`system.multicall`）覆盖更多轮询路径；任务列表虚拟滚动；统计页增量绘制；SQLite 历史分页与归档策略。
- **安全**：IPC 参数 schema 全覆盖；路径白名单持续审计；插件权限最小化与签名吊销列表；依赖供应链扫描。
- **可靠性**：下载引擎异常自动恢复；网络切换与代理变化自适应；日志脱敏与诊断包一键导出。
- **分发**：winget、Scoop、Homebrew 包管理器清单（原 v1.3.4 计划顺延）；应用内更新失败回滚；macOS aria2 升级 1.37（上游暂无免依赖预编译，需在 macOS runner 静态编译）；长时间做种与批量任务压测；崩溃恢复与启动自检增强。
- **文档**：插件开发指南、API 参考、常见故障排查、发版检查清单随版本同步更新。

## 优先级

1. v1.3.7 远程与自动化（下一步）
2. v1.3.8 插件生态与可访问性

## 非目标

以下方向暂不纳入路线图：内置 BT 资源搜索、网盘直链下载、原生移动 App、ED2K 支持、Docker 版 headless、迁移到 Tauri。若社区需求强烈，会另行评估。
