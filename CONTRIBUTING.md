# 贡献指南

## 环境要求

- **Node.js** 22.x 或更高（Electron 43 / vue-i18n 11 有硬性要求）
- **npm**（仓库带 `package-lock.json`，CI 用 `npm ci`）
- **Git**

## 常用命令

```bash
# 开发
npm run dev               # 同时起 Vite 与 Electron
npm run dev:electron      # 只重编主进程并启动 Electron
npm run build             # 构建渲染层 + 主进程，并校验资源是否齐全
npm run build:vue         # 只构建渲染层（vite build）
npm run build:electron    # 只编译主进程（tsc → dist/electron）

# 质量
npm run typecheck         # 主进程 + 测试代码 + 渲染层（含 .vue）
npm run typecheck:vue     # 只检查渲染层（vue-tsc）
npm run test              # vitest 监听模式
npm run test:run          # vitest 单次运行（CI 用这个）
npm run test:e2e          # 端到端：真启动应用，跑下载/解压/设置/扩展
npm run lint              # eslint（带 --fix）

# 扩展
npm run check:extension       # 静态校验：语言包结构、manifest 引用、i18n、端口一致性
npm run verify:extension-api  # 本地接口端到端（先 build:electron；桩化 settings + 真实 aria2）
npm run pack:extension        # 打包已签名 .crx（需本机 Chrome 或 Edge）
npm run pack:extension-zip    # 打包商店用 zip（无需系统 zip 工具）

# 打包
npm run dist:win64        # Windows x64：Setup.exe + portable.zip
npm run dist:win32        # Windows x86
npm run dist:win-all      # 两个架构
npm run dist:mac          # dmg + zip（只能在 macOS 上执行）
npm run dist:linux        # AppImage + deb（在 Linux 上执行）
npm run verify:dist       # 校验打包产物是否齐全、体积是否合理

# 冒烟：启动一次打包产物，断言引擎、本地接口、窗口渲染
node scripts/smoke-packaged.mjs
node scripts/smoke-packaged.mjs --exe <路径> --timeout 120000 --keep
xvfb-run -a node scripts/smoke-packaged.mjs --spawn-args=--no-sandbox   # 无显示的 Linux
```

在 Windows 上打 Linux 包，可以用 Docker（`electronuserland/builder`）、WSL2，
或者直接推一个 tag 让 GitHub Actions 在 Linux 运行器上构建。

## 项目结构

```
Aria2Desktop/
├── src/                    # 渲染进程
│   ├── components/         # Vue 组件（对话框、新建任务、任务详情、设置页、布局）
│   ├── composables/        # 组合式函数（生命周期、刷新、流量、剪贴板、快捷键）
│   ├── views/              # 页面（任务列表、状态页、设置子页面）
│   ├── stores/             # Pinia（连接、任务、设置、统计、流媒体任务…）
│   ├── services/           # 服务层（Aria2 RPC、设置、持久化、会话管理）
│   ├── shared/             # 主进程/渲染层共享模块（设置类型、文件分类、纯逻辑）
│   ├── locales/            # 语言文件（zh-CN / en-US）
│   ├── types/              # 类型定义（含 preload 暴露的 electronAPI 契约）
│   └── utils/              # 工具函数（格式化、错误映射、文件类型图标）
├── electron/               # 主进程
│   ├── controllers/        # 窗口、托盘、Aria2、IPC、更新、生命周期
│   ├── managers/           # Aria2 子进程生命周期
│   ├── services/           # Tracker 订阅、速度调度、yt-dlp、插件、扩展接口
│   ├── utils/              # 日志、IPC 安全工厂、settings 访问器、加密、纯逻辑核心
│   ├── main.ts             # 主进程入口
│   └── preload.ts          # contextBridge API
├── extension/              # 浏览器扩展（Manifest V3）
├── plugins/                # 示例插件
├── resources/              # aria2 引擎（按平台/架构）与默认配置
├── scripts/                # 构建、校验、端到端脚本
├── build/                  # 打包配置、图标、NSIS 自定义钩子
├── .github/workflows/      # ci / e2e / release / build-unix
└── dist/ release/          # 编译产物、打包输出（不入库）
```

## 开发约定

**主进程入口是编译产物**。`electron/**/*.ts` 先编译到 `dist/electron/` 才会生效；
`electron .` 启动的是编译产物，改完源码请跑 `npm run build:electron`（或 `npm run dev`）。
`npm run build` 末尾会自动执行资源校验，缺引擎等资源会直接失败。

**日志**。主进程统一用 `createLogger('模块名')`（`electron/utils/logger.ts` 对 electron-log 的封装），
落盘在 `<userData>/logs/main.log`；不要直接 `console.*`。渲染层开发日志用 `src/utils/devLog.ts`。

**类型检查**。渲染层（含 `.vue` 模板与 `<script setup>`）由 `vue-tsc` 检查，已开启
`noUncheckedIndexedAccess`、`noUnusedParameters`。`vite build` 只发现语法与导入问题，
类型不匹配、props 传错、插槽名写错只有 `npm run typecheck` 能拦住。

**测试**。vitest，测试文件与源码同目录、命名 `*.test.ts`（已被 `tsconfig.electron.json` 排除）。
为便于测试，请把纯逻辑抽成不依赖 electron 的模块（例如 `electron/utils/speedRule.ts`、
`src/shared/downloadCompletion.ts`）。改到主进程排除逻辑、路径处理、配置改写时，
优先补一条能复现问题的单测。

**依赖归类**。渲染层依赖经 Vite 打进 `dist/vue`，统一放 `devDependencies`；
`dependencies` 只保留必须随 asar 分发的主进程运行时依赖（`electron-store`、`electron-log`），
以控制安装包体积。新增依赖前先判断它是否要在打包后的主进程里使用。

**IPC**。新增通道用 `registerSecureHandler` / `registerSecureListener`（自带来源校验与
`failureValue`），并在 `preload.ts` 与 `src/types/electron.d.ts` 两处同步声明 ——
`scripts/api-surface.test.mjs` 会检查三者的键集合与通道名是否一致。

## 平台差异

| 能力 | Windows | macOS | Linux |
|---|---|---|---|
| 内置引擎 | aria2 1.37.0 | aria2 1.36.0 | aria2 1.36.0 |
| 应用内更新 | 检查 + 差量下载 + 安装 | 引导去 Release 页 | 同 macOS |
| 开机自启 | 注册表 Run 项 | 登录项 | `~/.config/autostart/*.desktop` |
| magnet 协议 | 注册表 | Info.plist | `.desktop` 的 `x-scheme-handler` |

## 应用内更新机制（Windows）

- **检查**：`releases/latest` 的 302 重定向拿到最新稳定版 tag（服务端保证跳过 pre-release）；
  启动时检查一次，主进程每 24 小时复查一次（托盘常驻也能收到提醒）。
- **差量下载**：Release 附带 `<Setup.exe>.blocks.json` 块表，应用对比本地缓存的上一版安装包，
  hash 相同的分块直接本地复制、只下载变化部分。分块用内容定义切点（CDC，平均 1 MB），
  实测相邻版本可复用约 94% 字节；块格式变化或缓存缺失时自动回落全量。
- **完整性**：无论差量还是全量，最终都强制比对 Release 的 `.sha256`，不匹配拒绝安装。
  被篡改的块表只会导致校验失败并回落全量，不会让坏包落地。

## 插件开发

插件放在 `%APPDATA%/aria2-desktop/plugins/<插件目录>/`，每个插件一个目录：

```
my-plugin/
├── manifest.json    # id、name、version、main、permissions
└── index.js         # 入口（CommonJS，导出钩子函数）
```

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

```js
module.exports = {
  onActivate() { /* 插件启用 */ },
  onDeactivate() { /* 插件停用 */ },
  onDownloadStart(task) { /* 任务开始 */ },
  onDownloadComplete(task) {
    notify.send('下载完成', task.name)
  }
}
```

权限：`aria2:read`（读状态）、`aria2:write`（控制任务）、`settings:read`（读设置，已脱敏）、`notify`（系统通知）。
类型定义见 `electron/types/plugin.ts`。

> 插件运行在独立的 Electron utilityProcess 中，只能通过白名单 IPC 调用受限的 aria2/settings/notify 能力；
> 异常或死循环会被隔离，不会冻结主进程。权限声明用于最小化插件能力，但仍应只安装你信任的插件。

## 提交与发版

- 提交信息用 Conventional Commits：`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`ci:`、`chore:`；
  标题英文、正文中文说明“为什么改”。
- 推送以 `v` 开头的 tag（如 `v1.2.5`）会触发 `release.yml`：质量闸门 → 端到端 → 三平台并行构建
  → 创建 Release 并上传资产（含 `.sha256` 与差量块表）。
- 发版前必须让这三处版本一致，CI 有守卫会校验：`package.json`、`extension/manifest.json`、
  `.github/release-notes.md` 首行（`# vX.Y.Z 更新日志`）。
- 更新日志面向普通用户写：说清“以前怎样、现在怎样”，不要写内部实现细节。
- Windows 安装包使用 SignPath Foundation 免费开源签名；申请条件、secrets 配置与验证方法见 [docs/code-signing.md](docs/code-signing.md)，对外政策见 [docs/code-signing-policy.md](docs/code-signing-policy.md)。
