# Aria2 Desktop

<div align="center">

![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**集成 Aria2 引擎的现代化桌面下载管理器**

[快速开始](#快速开始) • [功能特性](#功能特性) • [开发指南](#开发指南) • [贡献代码](#贡献)

</div>

## 项目简介

**Aria2 Desktop** 是一款基于 **Electron + Vue 3** 构建的桌面端 Aria2 下载管理器。它将 Aria2 引擎与可视化管理界面集成于一体，提供从引擎启停、任务调度到参数配置的一站式下载管理体验。

### 项目愿景

- **引擎内置**: 内置 Aria2 可执行文件，无需额外安装和命令行操作
- **可视化管理**: 实时监控下载速度、进度、连接数，支持任务的暂停/恢复/删除等操作
- **全协议支持**: HTTP/HTTPS、FTP、BitTorrent、磁力链接、Metalink 全覆盖
- **现代界面**: 基于 Vue 3 + Naive UI 的响应式界面，支持深色/浅色主题切换
- **深度配置**: 涵盖 RPC、BT、HTTP、FTP/SFTP、Metalink、安全等全维度 Aria2 参数配置

## 功能特性

### 核心亮点
- **引擎内置**: 内置 Aria2 可执行文件，应用启动即可使用
- **可视化管理**: 直观的下载任务管理界面，支持列表/详情视图
- **实时监控**: 下载速度、进度、连接数、Peer 信息实时展示
- **多协议支持**: HTTP/HTTPS、FTP、BitTorrent、磁力链接、Metalink 全支持
- **流媒体下载**: 集成 yt-dlp，支持 YouTube、Bilibili 等 1000+ 站点的 HLS/DASH 流媒体下载
- **浏览器扩展**: Chrome/Edge 扩展，弹窗内可直接粘贴链接发送下载（自动填入当前页面地址），或右键菜单一键发送链接；可选拦截所有浏览器下载。**扩展与 App 打通**：在 App 运行时，扩展的分类、命名、重名处理全部交由 App 执行——你在 App 里自定义的分类规则、子目录与下载选项对扩展同样生效
- **插件系统**: 插件框架，支持权限裁剪与生命周期管理（插件在主进程运行，属完全可信代码，请勿安装来源不明的插件）

### 下载功能
- **多线程下载**: 最大化利用网络带宽
- **断点续传**: 下载中断后自动恢复
- **速度控制**: 全局和单任务速度限制，底部状态栏一键切换
- **速度调度**: 按星期/时间段自动切换限速（如工作日白天限速）
- **分类下载**: 按文件类型自动归类到子目录（视频/音乐/图片/文档/压缩包/程序）
- **BT Tracker 订阅**: 自动从公共源聚合最新 Tracker 列表
- **magnet: 协议**: 注册为系统默认磁力链接处理器
- **拖拽下载**: 直接拖拽 URL 或 .torrent/.metalink 文件到窗口创建任务
- **任务排序**: 点击列头切换升序/降序排序
- **任务导出/导入**: 下载任务页导出未完成任务用于迁移，下载完成页导出/恢复历史记录

### 界面体验
- **深色/浅色主题**: 支持主题切换，跟随系统主题
- **响应式设计**: 适配不同窗口大小
- **多语言支持**: 中文、英文界面
- **实时状态面板**: 通过图表直观展示实时流量与连接情况
- **全局键盘快捷键**: Ctrl+N 新建、Ctrl+F 搜索、Ctrl+Shift+P 暂停全部等
- **下载完成通知**: 窗口不可见时弹出系统通知
- **任务栏进度条**: 下载时 Windows 任务栏图标显示整体进度
- **剪贴板检测**: 复制下载链接后回到应用自动弹出新建窗口

### 系统集成
- **开机启动**: 支持系统启动时自动运行
- **系统托盘**: 最小化到托盘，后台保持下载任务运行
- **下载完成后操作**: 可设置下载全部完成后自动关机、休眠或关闭应用
- **系统代理检测**: 一键检测并填入系统代理配置
- **自动更新**: 应用内检查更新并下载安装

## 技术架构

| 技术栈 | 版本 | 用途 |
|--------|------|------|
| **Electron** | 43.x | 跨平台桌面应用框架 |
| **Vue.js** | 3.x | 响应式前端界面 |
| **Naive UI** | 2.x | UI 组件库 |
| **TypeScript** | 6.x | 类型安全开发 |
| **Vite** | 8.x | 前端构建工具 |
| **ECharts** | 6.x | 数据可视化图表 |
| **Pinia** | 3.x | 状态管理 |
| **vue-i18n** | 11.x | 国际化支持 |
| **Aria2** | 1.37.0 | 下载引擎核心 |
| **electron-log** | 5.x | 主进程日志（分级 + 落盘） |
| **Vitest** | 5.x | 单元测试 |
| **vue-tsc** | 3.x | 渲染层（含 `.vue`）类型检查 |

## 快速开始

### 下载安装包
前往 [Releases](../../releases) 页面下载最新版本

### 使用步骤
1. **安装运行**: 双击安装包，按提示完成安装
2. **启动应用**: 桌面双击图标启动
3. **添加下载**:
   - 点击 "+" 按钮添加下载链接
   - 支持批量添加多个链接
   - 新建任务对话框内可直接拖拽 `.torrent` / `.metalink` 文件，或拖放链接进行添加
   - 直接拖拽 URL 或文件到主窗口即可创建下载任务
   - 从浏览器复制下载链接后回到应用，自动弹出新建下载窗口
4. **管理任务**: 在任务列表中通过操作按钮进行暂停、恢复、删除、打开所在目录等操作
5. **浏览器扩展**: 安装 `extension/` 目录为 Chrome/Edge 扩展，右键链接可直接发送到 Aria2 Desktop 下载

### 流媒体下载（可选）
应用集成了 yt-dlp 作为外部引擎，支持 YouTube、Bilibili 等 1000+ 站点的流媒体下载。
1. 安装 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 并确保在系统 PATH 中
2. 在新建下载弹窗中切换到「流媒体」标签页
3. 粘贴视频链接，选择画质后下载

### 浏览器扩展安装
在 [Releases](https://github.com/Young-ZJ66/Aria2Desktop/releases) 页面下载扩展包，二选一：

- **`.crx`（推荐）**：`chrome://extensions/` → 开启「开发者模式」→ 把 `.crx` 文件拖入页面即可。
  会提示「未在 Chrome 网上应用店中列出」或 Edge 上的「不是来自任何已知来源」，属**正常提示**
  （安装包自签名、无商店签名），确认继续即可。
  **Edge 需先放行非商店来源**：`edge://extensions/` → 打开「允许来自其他应用商店的扩展」→
  **重启浏览器**；若拖拽 `.crx` 无效，改用下面的 `.zip` 方式。
- **`.zip`**：解压后按「加载解压的扩展程序」选择解压目录（Edge 上更稳妥的方式）。

> **Edge 用户**：扩展已提交 Edge 加载项商店审核，通过后可直接从商店安装并自动更新，无需上述步骤。
> 本扩展不计划上架 Chrome 网上应用店，Chrome 用户请使用上述旁加载方式（官方保留的开发者通道，长期可用）。

安装后扩展图标出现在工具栏，右键任意链接即可发送到 Aria2 Desktop。

> 扩展与 App 是**协作**关系：App 在运行时，扩展会通过本机回环接口（`127.0.0.1:6801`，
> 需带 RPC 密钥鉴权）把链接交给 App 解析，因此**你在 App 里自定义的分类规则、子目录与下载选项都会生效**；
> App 未运行时扩展回落到内置规则直连引擎，功能不受影响。

### 插件系统
插件存放在 `%APPDATA%/aria2-desktop/plugins/` 目录下，每个插件一个文件夹：
```
my-plugin/
├── manifest.json    # 插件元数据（id、name、version、permissions）
└── index.js         # 插件入口脚本
```

**manifest.json 示例**：
```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "插件描述",
  "main": "index.js",
  "permissions": ["aria2:read", "notify"]
}
```

**index.js 示例**：
```js
module.exports = {
  onActivate: function() { console.log('Plugin activated!') },
  onDownloadComplete: function(task) {
    notify.send('下载完成', task.name)
  }
}
```

**权限类型**：`aria2:read`（读取下载状态）、`aria2:write`（控制下载）、`settings:read/write`（读写设置）、`notify`（发送通知）、`network`（网络请求）

### 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建下载 |
| `Ctrl+F` | 搜索任务 |
| `Ctrl+Shift+P` | 暂停全部 |
| `Ctrl+Shift+R` | 恢复全部 |
| `Ctrl+,` | 打开设置 |
| `Escape` | 关闭当前弹窗 |

## 开发指南

### 环境要求
- **Node.js** 22.x 或更高版本
- **npm** 包管理器
- **Git** 版本控制工具

### 本地开发

```bash
# 克隆项目
git clone https://github.com/Young-ZJ66/Aria2Desktop.git
cd Aria2Desktop

# 安装依赖
npm install

# 启动开发服务器（Vue + Electron）
npm run dev

# 构建生产版本（前端 + Electron 主进程编译）
npm run build

# 打包安装程序（当前平台架构，仅支持 Windows）
npm run dist

# 打包 Windows 64 位 / 32 位 / 双架构安装包
npm run dist:win64
npm run dist:win32
npm run dist:win-all

# 单元测试（vitest）
npm run test        # 监听模式
npm run test:run    # 单次运行

# 类型检查
npm run typecheck       # 全量：主进程 + 测试代码 + 渲染层（含 .vue）
npm run typecheck:vue   # 仅渲染层（vue-tsc）

# 浏览器扩展
npm run check:extension     # 扩展静态校验（语言包结构/manifest 引用/i18n 一致性/端口一致）
npm run pack:extension      # 打包已签名 .crx（需本机装有 Chrome 或 Edge）
npm run pack:extension-zip  # 打包商店用 zip（无需系统 zip 工具）
npm run verify:extension-api # 本地接口端到端验证（先 build:electron；桩化 settings + 真实 aria2 引擎）
```

> **开发注意**：Electron 主进程入口是编译产物 `dist/electron/electron/main.js`，不是 TS 源码。
> `npm run dev` 会先编译一次主进程再启动；若手动改完 `electron/**/*.ts` 后直接用 `electron .`
> 启动，改动不会生效——请执行 `npm run build:electron`，或用 `npm run dev:electron:watch` 持续编译。
> `npm run build` 末尾会自动校验构建产物（`scripts/verify-resources.mjs`），资源缺失时直接构建失败。

> **日志**：主进程日志统一走 `electron/utils/logger.ts`（electron-log 薄封装），
> 落盘于 `<userData>/logs/main.log`（info 及以上），开发环境控制台输出 debug 全量、生产仅 warn/error。
> 新增主进程代码请使用 `createLogger('模块名')`，不要再直接用 `console.*`。

> **类型检查**：渲染层（含 `.vue` 模板与 `<script setup>`）由 `vue-tsc` 检查，配置见根 `tsconfig.json`
> （已开启 `noUncheckedIndexedAccess`、`noUnusedParameters`）。改动 `.vue` 后请跑一次 `npm run typecheck`
> ——`vite build` 只能发现语法与导入错误，发现不了类型不匹配、props 传错、插槽名写错这类问题。
> 主进程侧用 `tsc -p tsconfig.electron.json`；两者都在 `npm run typecheck` 里。

> **单元测试**：vitest，测试文件与源码同目录、命名为 `*.test.ts`
> （已被 `tsconfig.electron.json` 排除，不会编译进主进程产物）。
> 为便于测试，纯逻辑请抽成不依赖 electron 的独立模块（例如 `electron/utils/speedRule.ts`、
> `electron/utils/ipcSecurityCore.ts`、`src/utils/fingerprint.ts`）。

> **依赖约定**：渲染层依赖（Vue、Naive UI、axios 等）经 Vite 打包进 `dist/vue`，因此统一声明在
> `devDependencies`；`dependencies` 只保留必须随 asar 分发的**主进程运行时依赖**
> （`electron-store`、`electron-log`——后者用于主进程日志落盘），以减小安装包体积。
> 新增依赖时请遵循此约定：先判断它是否需要在打包后的主进程中使用。

> **平台支持**: 本项目仅构建 Windows 32/64 位版本。32 位打包资源后缀为 `x86`，64 位为 `x64`。推送以 `v` 开头的 tag 会自动触发 GitHub Actions 构建并发布 Release。

### 项目结构
```
Aria2Desktop/
├── src/                    # 渲染进程源代码
│   ├── components/         # Vue 组件（对话框、布局、任务操作、设置页子组件）
│   │   ├── dialogs/        # 弹窗/抽屉（新建任务、任务详情、连接、更新、删除任务）
│   │   ├── newTask/        # 新建任务弹窗的四个标签页（URI/种子/Metalink/流媒体）+ 契约类型
│   │   ├── task/           # 任务详情各分区（基本信息、Peer、服务器、分片）
│   │   ├── settings/       # 设置页外壳与小组件
│   │   └── layout/         # 侧边栏、页脚
│   ├── composables/        # 组合式函数（生命周期、刷新、流量监控、剪贴板、快捷键、新建任务提交骨架）
│   ├── views/              # 页面视图（任务列表、状态页、设置子页面）
│   ├── stores/             # Pinia 状态管理（连接、任务、设置、统计、UI）
│   ├── services/           # 服务层（Aria2 RPC、设置、持久化、会话管理）
│   ├── shared/             # 主进程/渲染层共享模块（设置类型、文件分类、Tracker 列表、本机引擎判定）
│   ├── router/             # 路由配置
│   ├── styles/             # 全局样式与主题 Token
│   ├── i18n/               # 国际化初始化
│   ├── locales/            # 语言文件（zh-CN / en-US）
│   ├── types/              # TypeScript 类型定义（含 preload 暴露的 electronAPI 契约）
│   └── utils/              # 工具函数（格式化、错误映射、反馈提示、文件类型图标）
├── electron/               # Electron 主进程代码
│   ├── controllers/        # 控制器（窗口/托盘/Aria2/IPC/更新/生命周期）
│   ├── managers/           # 进程管理（Aria2 子进程生命周期）
│   ├── services/           # 服务（Tracker 订阅、速度调度、yt-dlp、插件管理）
│   ├── types/              # 类型定义（Store、Plugin）
│   ├── utils/              # 工具函数（日志、IPC 安全工厂、settings 访问器、加密、配置监听、资源路径）
│   ├── main.ts             # 主进程入口
│   └── preload.ts          # 预加载脚本（contextBridge API）
├── extension/              # Chrome/Edge 浏览器扩展（Manifest V3）
├── plugins/                # 示例插件
├── resources/              # 资源文件（Aria2 引擎二进制、默认配置）
├── scripts/                # 构建辅助脚本（引擎准备、构建产物校验）
├── build/                  # 打包配置与图标
├── dist/                   # 编译产物
└── release/                # electron-builder 打包输出目录
```

## 贡献

我们欢迎所有形式的贡献！无论是报告 Bug、提出功能建议，还是提交代码改进。

### 贡献方式
1. **报告问题**: 在 [Issues](../../issues) 中提交 Bug 报告
2. **功能建议**: 提出新功能想法和改进建议
3. **代码贡献**: Fork 项目并提交 Pull Request
4. **文档完善**: 帮助改进项目文档

### 开发流程
1. Fork 本仓库到你的 GitHub 账号
2. 创建功能分支: `git checkout -b feature/amazing-feature`
3. 提交你的更改: `git commit -m 'Add amazing feature'`
4. 推送到分支: `git push origin feature/amazing-feature`
5. 创建 Pull Request

## 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

## 致谢

感谢以下开源项目为本项目提供的支持：

- [AriaNg](https://github.com/mayswind/AriaNg) - 现代化的 Aria2 Web 前端
- [Aria2](https://github.com/aria2/aria2) - 强大的命令行下载工具
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - 功能丰富的视频下载工具
- [Motrix](https://github.com/agalwood/Motrix) - 全功能下载管理器（功能参考）
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用开发框架
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Naive UI](https://www.naiveui.com/) - 基于 Vue.js 的组件库
- [ECharts](https://echarts.apache.org/) - 数据可视化图表库
- [Vite](https://vite.dev/) - 下一代前端构建工具

## 联系我们

- **邮箱**: 1600386893@qq.com
- **问题反馈**: [GitHub Issues](../../issues)

---

<div align="center">

**如果这个项目对你有帮助，请给个 Star 支持一下！**

</div>
