import { app } from 'electron'

/**
 * 运行环境判定的**唯一口径**（主进程各处不要再直接读 app.isPackaged）。
 *
 * 为什么不能直接用 `app.isPackaged`：实测 Electron 43.4.0 下，用 `electron.exe <项目目录>`
 * 加载本地项目时（`process.defaultApp === true`）`app.isPackaged` **仍然返回 true**。
 * 直接采信的后果（均已实测复现）：
 * - `ResourceManager` 去 `process.resourcesPath` 找 aria2c → 引擎启动失败；
 * - `resolvePaths` 按 asar 布局找渲染层/图标 → 路径不存在；
 * - `ipcSecurity` 判定来源为"打包态"，不再放行 Vite dev server 的 http origin →
 *   **所有 IPC 返回 Unauthorized**（界面能开，版本号显示成一段 JSON 错误对象）。
 *
 * 因此开发态的判定以显式的 `NODE_ENV=development` 为准（`npm run dev` / `dev:electron` 都会设置）。
 * 打包产物运行时不会带这个变量，`app.isPackaged` 为 true，与安装包路径一致。
 */
export const isDevMode = process.env.NODE_ENV === 'development'

/** 是否运行在真正的安装包（或 asar 产物）中：打包态且非显式开发态 */
export const isPackagedApp = app.isPackaged && !isDevMode
