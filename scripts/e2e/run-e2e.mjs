/**
 * E2E 编排器：一条命令跑完"真实应用 UI + 插件运行时 + 自动解压 + 浏览器扩展"检查。
 *
 * 用法：
 *   npm run test:e2e                 # 应用 UI 必跑；找到 Chrome for Testing 时附带扩展检查
 *   npm run test:e2e -- --skip-extension
 *   E2E_CHROME_PATH=/path/to/chrome npm run test:e2e
 *
 * 环境隔离：Electron 使用本次运行独立的 userData 目录（Windows 改 APPDATA、
 * Linux 改 XDG_CONFIG_HOME、macOS 改 HOME），不会读写开发者真实的设置与插件。
 */

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { collectErrors, connect, createReporter, httpJson, killTree, sleep, waitFor } from './lib/cdp.mjs'
import { runAppUi } from './app-ui.mjs'
import { runExtensionCheck, resolveChromePath } from './extension.mjs'
import { runPairingCheck } from './pairing.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const outDir = path.join(root, 'test-results', 'e2e', stamp)
const userDataRoot = path.join(outDir, 'userdata')
const vitePort = Number(process.env.E2E_VITE_PORT || 5173)
const cdpPort = Number(process.env.E2E_CDP_PORT || 9334)
const skipExtension = process.argv.includes('--skip-extension') || process.env.E2E_SKIP_EXTENSION === '1'

fs.mkdirSync(outDir, { recursive: true })
const reporter = createReporter()
const children = []
let downloadServer = null

function logFile(name) {
  return fs.createWriteStream(path.join(outDir, `log-${name}.log`), { flags: 'a' })
}

function httpStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', () => resolve(0))
    req.setTimeout(2000, () => req.destroy())
  })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  })
  if (result.status !== 0) throw new Error(`命令失败（${command} ${args.join(' ')}）退出码 ${result.status}`)
}

function start(command, args, name, env = {}) {
  // 剔除 ELECTRON_RUN_AS_NODE：某些终端/工具链派生的 shell 会带上它（本仓开发机上就出现过），
  // 一旦带了，electron.exe 会以 Node 身份启动，崩在 appEnv.js 的 app.isPackaged 上并打印
  // "Node.js vXX" 版本号——看起来像应用自身的 bug，实际只是启动方式不对。
  const childEnv = { ...process.env, ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(command, args, {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    // 仅 .cmd/.bat 包装器需要 shell；electron.exe 直接执行，避免 shell 解析路径
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    detached: process.platform !== 'win32'
  })
  child.stdout.pipe(logFile(`${name}-out`))
  child.stderr.pipe(logFile(`${name}-err`))
  children.push({ name, child })
  return child
}

/**
 * 预置隔离 userData 的设置与引擎配置。
 *
 * 为什么不给应用加测试专用环境变量：设置、aria2.conf、连接预设才是引擎端口的
 * 真实来源，直接在隔离数据里写成 6810，主进程与渲染层两侧自然一致；
 * 也避免为测试在正式代码里留下分支。
 */
function prepareIsolatedUserData({ rpcPort, downloadDir }) {
  const userData = path.join(userDataRoot, 'aria2-desktop')
  fs.mkdirSync(userData, { recursive: true })
  // 阻止旧版数据迁移把仓库 data/ 下的真实任务复制进来（迁移逻辑见 electron/main.ts）
  fs.writeFileSync(path.join(userData, '.legacy-data-migrated'), 'e2e')

  // electron-store 数据（路径见 electron/main.ts 的 configDir）
  const settingsDir = path.join(userData, 'config')
  fs.mkdirSync(settingsDir, { recursive: true })
  const localConfig = {
    host: 'localhost',
    port: rpcPort,
    protocol: 'http',
    secret: '',
    path: '/jsonrpc'
  }
  fs.writeFileSync(
    path.join(settingsDir, 'aria2-desktop-settings.json'),
    JSON.stringify(
      {
        settings: {
          aria2: { ...localConfig },
          connectionProfiles: [{ id: 'default', name: '', config: { ...localConfig } }],
          activeProfileId: 'default'
        }
      },
      null,
      2
    )
  )

  // 引擎配置（路径见 electron/utils/resourceManager.ts）
  const aria2Dir = path.join(userData, 'aria2')
  fs.mkdirSync(aria2Dir, { recursive: true })
  fs.writeFileSync(
    path.join(aria2Dir, 'aria2.conf'),
    `# Aria2 Configuration File (E2E)
dir=${downloadDir.replace(/\\/g, '/')}
rpc-listen-port=${rpcPort}
rpc-allow-origin-all=true
enable-rpc=true
event-poll=select
max-concurrent-downloads=5
max-connection-per-server=16
min-split-size=10M
split=16
continue=true
save-session-interval=60
log-level=warn
max-mmap-limit=0
`,
    { encoding: 'utf-8', mode: 0o600 }
  )
  const pluginDir = path.join(userData, 'plugins', 'e2e-runtime')
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify(
      {
        id: 'com.e2e.runtime',
        name: 'E2E Runtime Plugin',
        version: '1.0.0',
        description: 'E2E runtime verification plugin',
        author: 'e2e',
        main: 'index.js',
        permissions: ['notify', 'settings:read']
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(pluginDir, 'index.js'),
    `module.exports = {
  onActivate() { console.log('E2E plugin activated') },
  onDeactivate() { console.log('E2E plugin deactivated') }
}
`
  )
  // 应用启动时读取该变量并把 userData 指向隔离目录（见 electron/main.ts 顶部）
  return { ARIA2_E2E_USER_DATA: userData }
}

async function main() {
  // 前置：编译主进程
  console.log('==> 编译主进程')
  run('npm', ['run', 'build:electron'])

  // 5173 被开发中的 `npm run dev` 占用时直接复用：Electron 的开发地址是写死的
  // http://localhost:5173（见 WindowController），另起端口既没用也不必要。
  const viteRunning = (await httpStatus(`http://localhost:${vitePort}/`)) === 200
  if (viteRunning) {
    console.log(`==> 检测到已运行的 Vite dev server（${vitePort}），直接复用`)
    reporter.check('Vite dev server 就绪（复用已运行实例）', true)
  } else {
    const viteBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
    console.log('==> 启动 Vite dev server')
    start(viteBin, ['--port', String(vitePort), '--strictPort'], 'vite')

    await waitFor(async () => (await httpStatus(`http://localhost:${vitePort}/`)) === 200, {
      timeoutMs: 90000,
      label: 'Vite dev server 就绪'
    })
    reporter.check('Vite dev server 就绪', true)
  }

  const tempDownloadDir = path.join(outDir, 'downloads')
  fs.mkdirSync(tempDownloadDir, { recursive: true })
  // 正式版可能正在运行并占用 6800：隔离数据里的引擎改用 6810
  const isolatedEnv = prepareIsolatedUserData({ rpcPort: 6810, downloadDir: tempDownloadDir })
  const electronPath = require('electron')
  console.log('==> 启动 Electron（隔离 userData）')
  const electron = start(electronPath, ['.', `--remote-debugging-port=${cdpPort}`], 'electron', {
    NODE_ENV: 'development',
    ...isolatedEnv
  })

  // 本地下载源：让 E2E 真正走一遍"新建任务 → 引擎下载 → 完成"的链路。
  // 分块慢速发送（8KB / 200ms），保证任务在列表里可见，避免"瞬间完成"导致误判。
  const downloadBytes = 64 * 1024
  const downloadBody = Buffer.alloc(downloadBytes, 7)
  downloadServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': downloadBody.length,
      'Accept-Ranges': 'none'
    })
    let offset = 0
    const step = 8 * 1024
    const timer = setInterval(() => {
      res.write(downloadBody.subarray(offset, offset + step))
      offset += step
      if (offset >= downloadBody.length) {
        clearInterval(timer)
        res.end()
      }
    }, 200)
    req.on('close', () => clearInterval(timer))
  })
  await new Promise((resolve) => downloadServer.listen(0, '127.0.0.1', resolve))
  const downloadUrl = `http://127.0.0.1:${downloadServer.address().port}/e2e-${stamp}.bin`

  const target = await waitFor(
    async () => {
      const list = await httpJson(`http://127.0.0.1:${cdpPort}/json/list`)
      if (!Array.isArray(list)) return null
      return list.find((t) => t.type === 'page' && String(t.url).startsWith(`http://localhost:${vitePort}`)) ?? null
    },
    { timeoutMs: 90000, label: 'Electron 渲染层出现' }
  )
  reporter.check('Electron 渲染层已连接', true)

  const session = await connect(target.webSocketDebuggerUrl)
  await session.send('Runtime.enable')
  await session.send('Log.enable')
  await session.send('Page.enable')

  await runAppUi({
    session,
    reporter,
    outDir,
    expectedVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    pluginName: 'E2E Runtime Plugin',
    stamp,
    downloadUrl,
    downloadBytes,
    tempDownloadDir
  })

  reporter.check('渲染层无未捕获异常 / error 级日志', collectErrors(session).length === 0)
  session.close()

  if (skipExtension) {
    console.log('SKIP 扩展 E2E：按参数跳过')
  } else if (!resolveChromePath()) {
    console.log('SKIP 扩展 E2E：未找到 Chrome for Testing（设置 E2E_CHROME_PATH 后启用）')
  } else {
    console.log('==> 扩展 E2E（Chrome for Testing）')
    await runExtensionCheck({ extensionDir: path.join(root, 'extension'), outDir, reporter })
    console.log('==> 配对回归（等待 35s，覆盖 MV3 SW 回收场景）')
    await runPairingCheck({ extensionDir: path.join(root, 'extension'), outDir, reporter })
  }

  // 应用进程异常退出也算失败（例如主进程崩溃但断言已跑完）
  reporter.check('Electron 进程在测试期间保持运行', electron.exitCode === null)
  return reporter.summary()
}

let exitCode = 1
try {
  exitCode = await main()
} catch (error) {
  console.error(`\nE2E 运行失败：${error instanceof Error ? error.message : error}`)
  exitCode = 1
} finally {
  if (downloadServer) downloadServer.close()
  for (const { name, child } of children.reverse()) {
    console.log(`==> 清理 ${name}`)
    killTree(child.pid)
  }
  await sleep(500)
  console.log(`\n截图与日志：${outDir}`)
}
process.exit(exitCode ? 1 : 0)
