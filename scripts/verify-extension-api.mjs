#!/usr/bin/env node
/**
 * 本地接口的端到端验证脚手架（`npm run verify:extension-api`）
 *
 * 为什么长这样（本环境/CI 都跑不了 Electron GUI，所以不能靠启动应用来验）：
 * 1) 桩掉 `require('electron')`（logger 等模块需要）；
 * 2) 用 module cache 替换 settings 访问器（真实实现要 safeStorage 解密，纯 Node 下拿不到密钥），
 *    喂入自制设置：临时下载目录 + 自制 RPC 密钥 + 一份"自定义分类表"（用来证明自定义规则真的生效）；
 * 3) 起一个**真实 aria2 引擎**（仓库自带 resources/aria2c.exe，务必 --no-conf 以免读到用户配置）；
 * 4) 加载**编译产物** dist/electron/**，打真实 HTTP/RPC 请求逐项断言。
 *
 * 端口说明：服务端用 6809 而不是默认的 6801——**用户本机应用可能正开着并占用 6801**，
 * 那样请求会打到真实应用上、用假密钥全 401，产生一堆"假失败"。
 *
 * 前置：需先 `npm run build:electron`（本脚本验证的是编译产物，不是源码）。
 * 平台：目前依赖 Windows 的 resources/aria2c.exe。
 */
import Module from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(root, 'dist/electron/electron')
const AUTH_SECRET = 'harness-secret-abc123'
const HARNESS_PORT = 6809
const ARIA2_PORT = 6800

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-api-verify-'))
const downloadDir = path.join(work, 'downloads')
fs.mkdirSync(downloadDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)

// ---- 前置检查 ----
if (!fs.existsSync(path.join(DIST, 'services/extensionApiServer.js'))) {
  console.error('未找到编译产物，请先运行: npm run build:electron')
  process.exit(2)
}
const aria2Exe = path.join(root, 'resources/aria2c.exe')
if (!fs.existsSync(aria2Exe)) {
  console.error(`未找到 aria2: ${aria2Exe}（本脚本目前依赖 Windows 版 aria2）`)
  process.exit(2)
}

// ---- 1) 桩掉 electron ----
const fakeElectron = { app: { isPackaged: false, getVersion: () => '1.0.8', getPath: () => work } }
const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron
  return originalLoad.call(this, request, ...rest)
}

// ---- 2) 替换 settings 访问器 ----
const harnessSettings = {
  aria2: { port: ARIA2_PORT, secret: AUTH_SECRET, downloadDir },
  download: { defaultDir: downloadDir, maxConnectionPerServer: 4, minSplitSize: '1M', autoStart: true },
  category: {
    autoClassify: true,
    categories: [
      { id: 'general', dir: '', extensions: [] },
      { id: 'video', dir: 'Video', extensions: ['mp4', 'mkv'] },
      { id: 'music', dir: 'Music', extensions: ['mp3'] },
      { id: 'images', dir: 'Images', extensions: ['jpg', 'png'] },
      { id: 'documents', dir: 'Documents', extensions: ['pdf', 'txt'] },
      { id: 'compressed', dir: 'Compressed', extensions: ['zip', 'rar', '7z'] },
      // 与内置默认不同：用于证明"你在 App 里自定义的目录名确实生效"
      { id: 'programs', dir: 'MySetup', extensions: ['exe', 'msi'] }
    ]
  }
}
const accessorPath = require.resolve(path.join(DIST, 'utils/settingsAccessor.js'))
require.cache[accessorPath] = {
  id: accessorPath,
  filename: accessorPath,
  loaded: true,
  exports: {
    getSettingsFresh: () => harnessSettings,
    getSettings: () => harnessSettings,
    saveSettings: () => {},
    bindSettingsStore: () => {}
  }
}

// ---- 3) 起真实 aria2 ----
// 启动参数分两组：基础参数 + 可选日志参数。
// 为什么把 --log 独立出来：某些环境下 aria2 打不开临时目录里的日志文件
// （已实测：`[Logger.cc:73] errorCode=1 Failed to open the file ...`），会**立即以 code 1 退出**，
// 于是整轮验证级联出一堆"引擎不可达"的误报。日志只是诊断便利，不该让验证失败。
const ARIA2_BASE_ARGS = [
  '--no-conf=true',
  '--enable-rpc=true',
  '--rpc-listen-all=false',
  `--rpc-listen-port=${ARIA2_PORT}`,
  `--rpc-secret=${AUTH_SECRET}`,
  `--dir=${downloadDir}`,
  '--continue=true',
  '--auto-file-renaming=true',
  '--quiet=true'
]

let aria2ErrorLog = ''
function startAria2(withLogFile) {
  const args = [...ARIA2_BASE_ARGS]
  if (withLogFile) args.push(`--log=${path.join(work, 'aria2.log')}`)
  const proc = spawn(aria2Exe, args, { stdio: 'ignore' })
  let exited = null
  proc.on('exit', (code, signal) => { exited = `code=${code} signal=${signal}` })
  proc.on('error', (error) => { exited = `spawn error: ${error.message}` })
  return { proc, lastExit: () => exited }
}

let aria2 = startAria2(true)

const API = `http://127.0.0.1:${HARNESS_PORT}`
const request = async (url, init) => {
  try {
    const response = await fetch(url, init)
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON 响应 */ }
    return { status: response.status, json, text }
  } catch (error) {
    // 网络层异常也让整轮跑完，便于一次看清所有失败项
    return { status: 0, json: null, text: `NETWORK ERROR: ${error.message}` }
  }
}
/**
 * 裸 socket 发原始请求：用于构造 fetch 无法表达的**畸形请求目标**
 * （fetch/undici 会先把 URL 规范化，`//`、`http://[` 这类目标发不出去）。
 */
const rawRequest = (payload) => new Promise((resolve) => {
  const socket = net.connect(HARNESS_PORT, '127.0.0.1', () => socket.write(payload))
  let buf = ''
  socket.on('data', (chunk) => { buf += chunk.toString() })
  socket.on('close', () => resolve(buf || 'NO RESPONSE'))
  socket.on('error', (error) => resolve(`SOCKET ERROR: ${error.message}`))
  socket.setTimeout(3000, () => { socket.destroy(); resolve(buf || 'TIMEOUT') })
})

const rpc = async (method, params = []) => {
  const response = await fetch(`http://127.0.0.1:${ARIA2_PORT}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'verify', method, params: [`token:${AUTH_SECRET}`, ...params] })
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.result
}
const withAuth = (extra = {}) => ({ Authorization: `Bearer ${AUTH_SECRET}`, ...extra })
const jsonHeaders = { 'Content-Type': 'application/json' }

const run = async () => {
  /** 等引擎 RPC 就绪；返回是否成功（不再无条件 PASS——那会让"引擎没起来"伪装成 11 个业务失败） */
  const waitForEngine = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { await rpc('aria2.getVersion'); return true } catch { await new Promise((r) => setTimeout(r, 300)) }
    }
    return false
  }

  let engineUp = await waitForEngine()
  if (!engineUp) {
    // 带 --log 启动失败时退回不带日志再试一次（见 ARIA2_BASE_ARGS 上方的说明）
    aria2ErrorLog = `首次启动退出信息: ${aria2.lastExit() ?? '（未退出，但 RPC 无响应）'}`
    try { aria2.proc.kill() } catch { /* 已退出 */ }
    aria2 = startAria2(false)
    engineUp = await waitForEngine()
  }
  check('aria2 引擎已启动', engineUp, engineUp ? '' : aria2ErrorLog)
  if (!engineUp) {
    // 引擎不可用时后续每一项都会失败，徒增噪音：直接以明确原因终止
    throw new Error(`aria2 引擎未能就绪（${ARIA2_PORT} 端口无 RPC 响应）。${aria2ErrorLog}`)
  }

  const { ExtensionApiServer } = require(path.join(DIST, 'services/extensionApiServer.js'))
  let pairDecision = true // 模拟用户在应用弹窗中点"允许 / 拒绝"
  const server = new ExtensionApiServer({
    getAppVersion: () => '1.0.8',
    getEngineProcessInfo: () => ({ isRunning: true, pid: aria2.proc.pid }),
    confirmPairing: async () => {
      // 弹窗文案为固定提示语、不携带请求侧数据（扩展 ID 只进日志），这里只断言"弹窗被触发"
      check('配对: 应用弹出确认框询问用户', true)
      return pairDecision
    }
  })
  server.start(HARNESS_PORT)
  await new Promise((r) => setTimeout(r, 400))

  // ---- A. 鉴权 ----
  const extOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
  check('无密钥 → 401', (await request(`${API}/api/status`)).status === 401)
  check('错误密钥 → 401', (await request(`${API}/api/status`, { headers: { Authorization: 'Bearer wrong' } })).status === 401)
  check('网页来源 → 401（即便密钥正确）',
    (await request(`${API}/api/status`, { headers: withAuth({ Origin: 'https://evil.example.com' }) })).status === 401)
  check('扩展来源 + 正确密钥 → 200', (await request(`${API}/api/status`, { headers: withAuth({ Origin: extOrigin }) })).status === 200)

  const status = await request(`${API}/api/status`, { headers: withAuth() })
  check('status 返回真实引擎版本', typeof status.json?.engine?.version === 'string' && status.json.engine.version.startsWith('1.37'),
    `version=${status.json?.engine?.version}`)
  check('status 返回应用版本', status.json?.appVersion === '1.0.8')

  // ---- B. 路由与方法 ----
  check('未知路径 → 404', (await request(`${API}/api/nope`, { headers: withAuth() })).status === 404)
  check('GET /api/add → 405', (await request(`${API}/api/add`, { headers: withAuth() })).status === 405)
  check('非法协议 file:// → 400', (await request(`${API}/api/add`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: 'file:///C:/Windows/System32/calc.exe' })
  })).status === 400)
  check('超大请求体 → 400（且能正常收到响应，不是 socket 错误）', (await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders),
    body: JSON.stringify({ url: 'https://a.example.com/x.rar', pad: 'a'.repeat(20 * 1024) })
  })).status === 400)

  // ---- C. 解析（URL 自带后缀，不需要联网） ----
  const rar = await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: 'https://example.com/files/test.rar' })
  })
  check('resolve: .rar → Compressed 子目录', rar.json?.resolved?.subdir === 'Compressed', `dir=${rar.json?.resolved?.dir}`)
  check('resolve: 目录落在基础目录之下', String(rar.json?.resolved?.dir).replace(/\\/g, '/').endsWith('/downloads/Compressed'))
  const exe = await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: 'https://example.com/setup.exe' })
  })
  check('resolve: 自定义规则生效（exe → MySetup 而非内置 Programs）', exe.json?.resolved?.subdir === 'MySetup',
    `subdir=${exe.json?.resolved?.subdir}`)

  // ---- D. 真实文件名探测（真实网络：GitHub Release 带 Content-Disposition） ----
  const zipUrl = 'https://github.com/Young-ZJ66/Aria2Desktop/releases/download/v1.0.7/Aria2Desktop-1.0.7-x64-portable.zip'
  const probed = await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: zipUrl })
  })
  check('resolve: 无文件名链接探测出真实文件名',
    typeof probed.json?.resolved?.fileName === 'string' && probed.json.resolved.fileName.endsWith('.zip'),
    `fileName=${probed.json?.resolved?.fileName}`)
  check('resolve: 探测后按真实后缀归类', probed.json?.resolved?.subdir === 'Compressed')

  // ---- E. 建任务（真实 aria2） ----
  const small = 'https://raw.githubusercontent.com/nodejs/node/main/LICENSE'
  const added = await request(`${API}/api/add`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: small })
  })
  check('add: 返回 gid 且任务真的进了引擎', added.status === 200 && typeof added.json?.gid === 'string', `gid=${added.json?.gid}`)
  const options = added.json?.gid ? await rpc('aria2.getOption', [added.json.gid]) : {}
  check('add: 套用设置里的最大连接数', options['max-connection-per-server'] === '4', `实际=${options['max-connection-per-server']}`)
  check('add: 套用设置里的最小分片（1M）', Number(options['min-split-size']) === 1024 * 1024, `实际=${options['min-split-size']}`)
  check('add: dir 指向解析出的目录', String(options.dir).replace(/\\/g, '/').includes('/downloads'))
  const task = added.json?.gid ? await rpc('aria2.tellStatus', [added.json.gid, ['status']]) : null
  check('add: 任务在引擎中可见', Boolean(task?.status), `status=${task?.status}`)

  // ---- E2. 引擎不可用 → 502 + 错误码（扩展据此提示"请先启动引擎"） ----
  const savedPort = harnessSettings.aria2.port
  harnessSettings.aria2.port = 6899
  const down = await request(`${API}/api/add`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: small })
  })
  check('引擎不可用 → 502', down.status === 502, `status=${down.status}`)
  check('引擎不可用 → 带 engine_unavailable 错误码', down.json?.code === 'engine_unavailable', `code=${down.json?.code}`)
  harnessSettings.aria2.port = savedPort

  // ---- E3. magnet：无文件名、无探测，落到基础目录 ----
  const magnet = await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders),
    body: JSON.stringify({ url: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567' })
  })
  check('magnet: 接受且落到基础目录（不报错、不分类）',
    magnet.status === 200 && magnet.json?.resolved?.category === 'general' &&
    String(magnet.json?.resolved?.dir).replace(/\\/g, '/').endsWith('/downloads'), `dir=${magnet.json?.resolved?.dir}`)

  // ---- E4. 探测的 SSRF 边界：回环地址不探测 ----
  const loopback = await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: 'http://127.0.0.1:9999/no-extension-name' })
  })
  check('回环地址：跳过探测（fileName 未被探测填充）',
    loopback.json?.resolved?.fileName === 'no-extension-name', `fileName=${loopback.json?.resolved?.fileName}`)

  // ---- F. 重名与续传 ----
  // 用独立文件名，避免与上面正在下载的 LICENSE 互相干扰
  const readmeUrl = 'https://raw.githubusercontent.com/nodejs/node/main/README.md'
  fs.writeFileSync(path.join(downloadDir, 'README.md'), 'existing content')
  const conflict = await request(`${API}/api/add`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: readmeUrl })
  })
  check('重名: 识别到冲突', conflict.json?.conflict === true)
  check('重名: 给出带序号的新名字', conflict.json?.renamed === 'README (1).md', `renamed=${conflict.json?.renamed}`)
  const conflictOptions = conflict.json?.gid ? await rpc('aria2.getOption', [conflict.json.gid]) : {}
  check('重名: 新任务使用改后的 out', conflictOptions.out === 'README (1).md', `out=${conflictOptions.out}`)

  fs.writeFileSync(path.join(downloadDir, 'resume-test.zip'), 'partial')
  fs.writeFileSync(path.join(downloadDir, 'resume-test.zip.aria2'), 'control')
  const resume = await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders), body: JSON.stringify({ url: 'https://example.com/resume-test.zip' })
  })
  check('续传场景: 不改名（保留 .aria2 控制文件的下载）',
    resume.json?.resolved?.conflict === false && resume.json?.resolved?.out === '',
    `conflict=${resume.json?.resolved?.conflict}`)

  // ---- H. 一键配对（唯一免密端点，来源必须从严） ----
  const pairUrl = `${API}/api/pair`
  const pairBody = { method: 'POST', headers: jsonHeaders, body: '{}' }
  check('配对: GET 方法 → 405', (await request(pairUrl)).status === 405)
  check('配对: 无 Origin → 403', (await request(pairUrl, pairBody)).status === 403)
  check('配对: 网页来源 → 403', (await request(pairUrl, { ...pairBody, headers: { ...jsonHeaders, Origin: 'https://evil.example.com' } })).status === 403)
  const allowed = await request(pairUrl, { ...pairBody, headers: { ...jsonHeaders, Origin: extOrigin } })
  check('配对: 允许 → 返回密钥与端口',
    allowed.status === 200 && allowed.json?.ok === true && allowed.json?.secret === AUTH_SECRET && allowed.json?.port === ARIA2_PORT,
    `port=${allowed.json?.port}`)
  pairDecision = false
  const denied = await request(pairUrl, { ...pairBody, headers: { ...jsonHeaders, Origin: extOrigin } })
  check('配对: 拒绝 → 403 + pairing_denied', denied.status === 403 && denied.json?.code === 'pairing_denied', `code=${denied.json?.code}`)
  pairDecision = true
  const savedSecret = harnessSettings.aria2.secret
  harnessSettings.aria2.secret = ''
  const noSecret = await request(pairUrl, { ...pairBody, headers: { ...jsonHeaders, Origin: extOrigin } })
  check('配对: 引擎未设密钥 → 直接成功且不触发弹窗',
    noSecret.status === 200 && noSecret.json?.ok === true && noSecret.json?.secret === '' && noSecret.json?.note === 'no_secret')
  harnessSettings.aria2.secret = savedSecret

  // ---- G. 畸形请求目标：曾让主进程按"未处理的 Promise 拒绝"直接退出（本轮修复） ----
  // `//` 是最普通的 origin-form 目标，浏览器/curl 随手就能发出；
  // 而 new URL('//' | 'http://[', base) 会抛 TypeError，且解析发生在鉴权之前。
  for (const target of ['//', 'http://[', '//[']) {
    const raw = await rawRequest(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
    check(`畸形请求目标 ${target} → 400（不再抛错）`, raw.startsWith('HTTP/1.1 400'), raw.split('\r\n')[0])
  }
  check('畸形请求之后接口仍可用（进程未被异常终止）',
    (await request(`${API}/api/status`, { headers: withAuth() })).status === 200)

  // ---- G2. fileName 注入面：不得逃出下载目录（本轮修复） ----
  // 该值会作为 aria2 的 out 下发，实测未净化时 `../escape.txt` 能写到下载目录之外。
  const traversal = await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders),
    body: JSON.stringify({ url: 'https://example.com/whatever', fileName: '../escape.txt' })
  })
  check('fileName 目录穿越 → 收敛为纯文件名',
    traversal.json?.resolved?.fileName === 'escape.txt', `fileName=${traversal.json?.resolved?.fileName}`)

  const absName = await request(`${API}/api/resolve`, {
    method: 'POST', headers: withAuth(jsonHeaders),
    body: JSON.stringify({ url: 'https://example.com/whatever', fileName: 'C:\\Users\\x\\Downloads\\video.mp4' })
  })
  check('fileName 绝对路径 → 只保留文件名（扩展拦截下载给的就是这种）',
    absName.json?.resolved?.fileName === 'video.mp4', `fileName=${absName.json?.resolved?.fileName}`)

  const escapeAdd = await request(`${API}/api/add`, {
    method: 'POST', headers: withAuth(jsonHeaders),
    body: JSON.stringify({ url: small, fileName: '../escape-add.txt' })
  })
  const escapeOptions = escapeAdd.json?.gid ? await rpc('aria2.getOption', [escapeAdd.json.gid]) : {}
  check('add: 下发的 out 已净化为纯文件名', escapeOptions.out === 'escape-add.txt', `out=${escapeOptions.out}`)
  check('add: out 不含任何路径成分（穿越与绝对路径都被消除）',
    !String(escapeOptions.out).includes('..') && !String(escapeOptions.out).includes('/') &&
    !String(escapeOptions.out).includes('\\'))
  check('add: dir 仍在下载目录之下（文件名净化不影响目录解析）',
    String(escapeOptions.dir).replace(/\\/g, '/').includes('/downloads'))

  // ---- 收尾 ----
  server.stop()
  await new Promise((r) => setTimeout(r, 200))
}

const cleanup = () => {
  try { aria2.proc.kill() } catch { /* 已退出 */ }
  try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* 占用时留给系统清理 */ }
}

run()
  .then(() => {
    for (const line of results) console.log(line)
    const failed = results.filter((line) => line.startsWith('FAIL')).length
    console.log(`\n结果: ${results.length - failed} 项通过，${failed} 项失败`)
    cleanup()
    process.exit(failed ? 1 : 0)
  })
  .catch((error) => {
    for (const line of results) console.log(line)
    console.error('\n脚手架异常:', error)
    cleanup()
    process.exit(2)
  })
