#!/usr/bin/env node
/**
 * 打包产物冒烟：启动真正打包出来的可执行文件，等它在隔离数据里把引擎与本地接口拉起来。
 *
 * 为什么开发态 E2E 覆盖不到：那层跑的是源码与 dist/，而 asar 里漏文件、
 * 引擎可执行文件没被带进包、资源路径按 process.resourcesPath 解析这类问题，
 * 只有"装完之后再启动一次"才会暴露——v1.2.0 的自动解压事故就是同一个教训：
 * 类型检查、单测、扩展校验全绿，坏在没人把成品跑一遍。
 *
 * 三个平台都支持：Windows 读 `release/win-unpacked`，macOS 读 `release/mac-arm64`
 * （或 mac / mac-universal）下的 `Aria2Desktop.app/Contents/MacOS/Aria2Desktop`，
 * Linux 读 `release/linux-unpacked` 里那个主可执行文件。macOS/Linux 的产物一直在发，
 * 却从来没被真正启动过——本脚本就是给它们补上这最后一步。
 *
 * 用法：
 *   node scripts/smoke-packaged.mjs                     # 按平台挑默认的免安装产物
 *   node scripts/smoke-packaged.mjs --exe <路径> --timeout 120000 --keep
 *   node scripts/smoke-packaged.mjs --retries 0         # CI 里想一次定生死时用
 *   node scripts/smoke-packaged.mjs --fresh             # 空白数据目录，模拟全新安装
 *   xvfb-run -a node scripts/smoke-packaged.mjs --spawn-args=--no-sandbox   # 无显示的 Linux
 *
 * `--fresh` 走的是新用户唯一会走的那条路：不预置设置文件，让应用自己生成默认配置。
 * 老用户的数据目录里早就有配置，所以这条路径平时永远测不到——少写一个默认 conf，
 * 结果就是所有人第一次打开都起不来引擎。该模式用的是产品默认 RPC 端口（通常是 6800
 * 与本机正在运行的正式版冲突时请先退出它），CI 上没有这个顾虑。
 *
 * 默认失败后重试一次：Windows 上首次启动 200 MB 级的未签名 exe 会被 Defender 拦一下、
 * 磁盘缓存也还是冷的，历史上真出现过"同代码第二次就过"的抖动（dc5620a）。
 * 重试成功会打 GitHub 的 warning 注释，不会被悄悄吞掉。
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * electron-builder 的免安装目录按平台与架构分家：
 * - Windows：`win-unpacked` / `win-ia32-unpacked`，可执行文件固定叫 Aria2Desktop.exe；
 * - macOS：`mac` / `mac-arm64` / `mac-universal`，可执行文件藏在 .app/Contents/MacOS 里；
 * - Linux：`linux-unpacked`，可执行文件名由 executableName 推导，不写死、直接按"可执行的
 *   大文件"认领（chrome-sandbox、crashpad 这些同名候选都小于 10 MB）。
 * 发版矩阵里每个平台各有自己的目录，写死一个就会在其中一侧找不到文件。
 */
const WIN_UNPACKED_DIR_RE = /^win(-[a-z0-9]+)?-unpacked$/
const MAC_UNPACKED_DIR_RE = /^mac(-[a-z0-9]+)?$/

function listDirectories(parent) {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name))
  } catch {
    return []
  }
}

function resolveWindowsExecutable(releaseDir) {
  const candidates = listDirectories(releaseDir)
    .filter((dir) => WIN_UNPACKED_DIR_RE.test(path.basename(dir)))
    .map((dir) => path.join(dir, 'Aria2Desktop.exe'))
    .filter((file) => fs.existsSync(file))
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    // 同时存在多个架构时优先 x64（正是默认构建产物），其余靠 --exe 指定
    return candidates.find((file) => /win-unpacked/.test(file)) ?? candidates[0]
  }
  return path.join(releaseDir, 'win-unpacked', 'Aria2Desktop.exe')
}

function resolveMacExecutable(releaseDir) {
  const candidates = listDirectories(releaseDir)
    .filter((dir) => MAC_UNPACKED_DIR_RE.test(path.basename(dir)))
    .map((dir) => path.join(dir, 'Aria2Desktop.app', 'Contents', 'MacOS', 'Aria2Desktop'))
    .filter((file) => fs.existsSync(file))
  if (candidates.length) {
    return candidates.find((file) => /mac-arm64/.test(file)) ?? candidates[0]
  }
  return path.join(releaseDir, 'mac-arm64', 'Aria2Desktop.app', 'Contents', 'MacOS', 'Aria2Desktop')
}

const LINUX_MAIN_BINARY_MIN_BYTES = 10 * 1024 * 1024

/**
 * 执行位判定单独抽出来：Windows 上 chmod 不映射成 POSIX 执行位，
 * 这层可替换才能在 Windows 开发机上把 Linux 分支的用例也跑起来。
 */
function hasExecutableBit(mode) {
  return (mode & 0o111) !== 0
}

function resolveLinuxExecutable(releaseDir, isExecutable = hasExecutableBit) {
  const unpacked = path.join(releaseDir, 'linux-unpacked')
  for (const entry of fs.existsSync(unpacked) ? fs.readdirSync(unpacked, { withFileTypes: true }) : []) {
    if (!entry.isFile()) continue
    const file = path.join(unpacked, entry.name)
    try {
      const stat = fs.statSync(file)
      // 主可执行文件几十 MB；chrome-sandbox(≈15KB)、chrome_crashpad_handler(≈1MB) 都远小于此
      if (stat.size >= LINUX_MAIN_BINARY_MIN_BYTES && isExecutable(stat.mode)) return file
    } catch {
      // 读不到的条目直接跳过，交给下面的兜底
    }
  }
  return path.join(unpacked, 'aria2-desktop')
}

function resolveDefaultExe(releaseDir = path.join(root, 'release')) {
  if (process.platform === 'darwin') return resolveMacExecutable(releaseDir)
  if (process.platform === 'linux') return resolveLinuxExecutable(releaseDir)
  return resolveWindowsExecutable(releaseDir)
}

const BUILD_HINT =
  process.platform === 'darwin'
    ? 'npx electron-builder --mac --publish never'
    : process.platform === 'linux'
      ? 'npx electron-builder --linux --x64 --publish never'
      : 'npm run dist:win64:nsis（或 npx electron-builder --win --x64 --dir）'

/** 启动成功的判据：引擎起来了，扩展本地接口也起来了（两条都在主进程日志里） */
const EXPECTED_MARKERS = [
  { name: '打包后的应用拉起了内置 aria2', pattern: /Aria2 进程启动成功/ },
  { name: '扩展本地接口已在监听', pattern: /浏览器扩展本地接口已启动/ }
]

/**
 * 解析命令行选项并校验产物存在。
 * 单独成函数是为了让本文件可以被测试 import：顶层不再有副作用，
 * 产物路径推断（尤其 macOS/Linux 那两支）才能被单元测试覆盖。
 */
function readOptions(argv = process.argv.slice(2)) {
  const value = (name, fallback) => {
    // 同时支持 `--timeout 120000` 与 `--spawn-args=--no-sandbox` 两种写法
    const inline = argv.find((argument) => argument.startsWith(`--${name}=`))
    if (inline) return inline.slice(name.length + 3)
    const index = argv.indexOf(`--${name}`)
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
  }
  const exePath = value('exe') ? path.resolve(root, value('exe')) : resolveDefaultExe()
  const options = {
    exePath,
    timeoutMs: Number(value('timeout', '90000')),
    keepData: argv.includes('--keep'),
    /** 不预置设置与 aria2.conf：模拟全新安装，让应用自己长默认配置 */
    fresh: argv.includes('--fresh'),
    retries: Number(value('retries', '1')),
    /** 额外的启动参数：Linux 容器里无 user namespace 时需要 --no-sandbox */
    spawnArgs: value('spawn-args', '')
      .split(/\s+/)
      .filter(Boolean)
  }

  if (!fs.existsSync(exePath)) {
    console.error(`找不到打包产物：${exePath}`)
    console.error(`先跑一次 ${BUILD_HINT} 再执行冒烟。`)
    process.exit(2)
  }
  if (process.platform !== 'win32' && (fs.statSync(exePath).mode & 0o111) === 0) {
    console.error(`打包产物没有执行权限：${exePath}`)
    console.error('解压/拷贝过程可能丢了 +x，先 chmod +x 再执行冒烟。')
    process.exit(2)
  }
  return options
}

export { resolveWindowsExecutable, resolveMacExecutable, resolveLinuxExecutable, resolveDefaultExe, readOptions }

/** 借系统拿一个空闲端口，避免和本机正在运行的正式版抢 6800 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * 预置隔离数据：设置、aria2.conf 才是引擎端口的真实来源（与开发态 E2E 同一套路），
 * 这样冒烟跑的是真实启动路径，不需要为测试在正式代码里留分支。
 */
function seedUserData(userData, rpcPort) {
  fs.mkdirSync(userData, { recursive: true })
  // 阻止旧版数据迁移把仓库 data/ 下的真实任务复制进来（迁移逻辑见 electron/main.ts）
  fs.writeFileSync(path.join(userData, '.legacy-data-migrated'), 'smoke')

  const settingsDir = path.join(userData, 'config')
  fs.mkdirSync(settingsDir, { recursive: true })
  const localConfig = { host: 'localhost', port: rpcPort, protocol: 'http', secret: '', path: '/jsonrpc' }
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

  const downloadDir = path.join(userData, 'downloads')
  fs.mkdirSync(downloadDir, { recursive: true })
  const aria2Dir = path.join(userData, 'aria2')
  fs.mkdirSync(aria2Dir, { recursive: true })
  fs.writeFileSync(
    path.join(aria2Dir, 'aria2.conf'),
    [
      '# Aria2 Configuration File (smoke)',
      `dir=${downloadDir.replace(/\\/g, '/')}`,
      `rpc-listen-port=${rpcPort}`,
      'rpc-allow-origin-all=true',
      'enable-rpc=true',
      'event-poll=select',
      'max-concurrent-downloads=5',
      'continue=true',
      'log-level=warn',
      'max-mmap-limit=0',
      ''
    ].join('\n')
  )
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, { timeout, intervalMs = 500 }) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await sleep(intervalMs)
  }
  return null
}

function readLog(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    // 应用会派生 aria2 子进程，只杀父进程会留下孤儿引擎
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  // POSIX 上 detached 让子进程自成进程组，按 -pid 一次性收掉它和它拉起的 aria2
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // 已经退出
    }
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // 正常退出后进程组已不存在
    }
  }, 1500).unref()
}

/**
 * 首次启动该自己长出来的东西：老用户的数据目录里早就有配置，这条路径平时测不到。
 */
export function checkFreshDefaults(userData) {
  const settingsPath = path.join(userData, 'config', 'aria2-desktop-settings.json')
  const confPath = path.join(userData, 'aria2', 'aria2.conf')
  const results = [{ name: '首次启动写出了默认设置文件', ok: fs.existsSync(settingsPath), detail: settingsPath }]

  let confText = ''
  try {
    confText = fs.readFileSync(confPath, 'utf-8')
  } catch {
    // 缺失会在下面断言里体现
  }
  results.push({
    name: '首次启动生成了 aria2.conf（含会话文件配置）',
    ok: /^save-session=/m.test(confText) && /^input-file=/m.test(confText),
    detail: confText ? `${confText.split('\n').length} 行` : '(缺失)'
  })
  return results
}

async function runAttempt(options, attempt, attemptCount) {
  const rpcPort = await findFreePort()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-smoke-'))
  if (options.fresh) {
    console.log('\n（--fresh：数据目录保持空白，模拟全新安装）')
  } else {
    seedUserData(userData, rpcPort)
  }
  const logFile = path.join(userData, 'logs', 'main.log')

  console.log(`\n=== 打包产物冒烟${attemptCount > 1 ? `（第 ${attempt}/${attemptCount} 次尝试）` : ''}`)
  console.log(`可执行文件: ${options.exePath}`)
  console.log(`隔离数据: ${userData}（RPC ${rpcPort}）`)

  const env = { ...process.env, ARIA2_E2E_USER_DATA: userData }
  // 在 DSH 这类环境里该变量会让 electron 以 Node 身份启动（app 未定义，直接崩）
  delete env.ELECTRON_RUN_AS_NODE

  if (options.spawnArgs.length) console.log(`启动参数: ${options.spawnArgs.join(' ')}`)

  const child = spawn(options.exePath, options.spawnArgs, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX 上自成进程组，停止时能连引擎子进程一起收掉
    detached: process.platform !== 'win32'
  })
  let stderr = ''
  let stdout = ''
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8000)
  })
  // 打包后的 Electron 在 Windows 上没有控制台，但仍可能往 stdout 写；CI 里这是唯一的旁证
  child.stdout?.on('data', (chunk) => {
    stdout = (stdout + chunk.toString()).slice(-8000)
  })
  let exited = false
  child.on('exit', () => {
    exited = true
  })

  const results = []
  try {
    for (const marker of EXPECTED_MARKERS) {
      const hit = await waitFor(() => {
        const line = readLog(logFile).split('\n').find((text) => marker.pattern.test(text))
        return line ? line.trim() : null
      }, { timeout: options.timeoutMs })

      if (hit) {
        results.push({ name: marker.name, ok: true, detail: hit })
      } else {
        // 三种失败要分开说：启动即退（exitCode 有值）、起来了但没就绪、连日志都没写
        const hasLog = readLog(logFile).length > 0
        const detail = exited
          ? `应用在等待期间退出（exitCode=${child.exitCode}）`
          : hasLog
            ? `超时 ${options.timeoutMs}ms 未出现`
            : `超时 ${options.timeoutMs}ms，应用没有写出日志（可能启动即退出）`
        results.push({ name: marker.name, ok: false, detail })
        break
      }
    }

    // 引擎起来了才谈"它自己长出的配置对不对"；前面失败的话这里没必要再报一遍
    if (options.fresh && results.every((result) => result.ok)) {
      results.push(...checkFreshDefaults(userData))
    }
  } finally {
    stopProcess(child)
  }

  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name} :: ${result.detail}`)
  }

  const failed = results.filter((result) => !result.ok)
  return { ok: failed.length === 0, results, failed, userData, logFile, exitCode: child.exitCode, stdout, stderr }
}

/** 失败现场：打印日志尾部与子进程输出，并落一份到 test-results/ 供 CI 作为 artifact 上传 */
function reportFailure(options, outcome, attempt, attemptCount) {
  const fullLog = readLog(outcome.logFile)
  const tail = fullLog.split('\n').slice(-120).join('\n')
  console.error(`\n--- 主进程日志尾部（第 ${attempt}/${attemptCount} 次尝试，最多 120 行）---`)
  console.error(tail || '(日志文件为空)')
  if (outcome.stdout.trim()) {
    console.error('\n--- 标准输出 ---')
    console.error(outcome.stdout.trim())
  }
  if (outcome.stderr.trim()) {
    console.error('\n--- 标准错误 ---')
    console.error(outcome.stderr.trim())
  }

  try {
    const reportDir = path.join(root, 'test-results')
    fs.mkdirSync(reportDir, { recursive: true })
    fs.writeFileSync(path.join(reportDir, 'smoke-packaged.json'), JSON.stringify({
      exePath,
      userData: outcome.userData,
      attempt,
      attemptCount,
      exitCode: outcome.exitCode,
      results: outcome.results,
      stdout: outcome.stdout,
      stderr: outcome.stderr
    }, null, 2))
    if (fullLog) fs.writeFileSync(path.join(reportDir, 'smoke-packaged-main.log'), fullLog)
    console.error(`\n诊断已写入 test-results/smoke-packaged.json（隔离数据：${outcome.userData}）`)
  } catch (error) {
    console.error(`诊断写入失败：${error.message}`)
  }

  if (process.platform === 'win32' && outcome.exitCode === 2147483651) {
    // 0x80000003：启动即崩，且日志文件都没生成。常见于受限沙箱/ACL 拒绝执行工作区内的文件，
    // 与产品无关；把免安装目录复制到工作区外再跑一次即可区分。
    console.error('\n提示：0x80000003 多为沙箱/ACL 拒绝执行，先把 release/win-unpacked 复制到工作区外再试：')
    console.error('  node scripts/smoke-packaged.mjs --exe <工作区外的 Aria2Desktop.exe>')
  }
}

function cleanup(options, userData) {
  if (options.keepData) {
    console.log(`\n按 --keep 保留隔离数据：${userData}`)
    return
  }
  try {
    fs.rmSync(userData, { recursive: true, force: true })
  } catch {
    // 应用退出后句柄释放存在延迟，清不掉也不影响结论
  }
}

async function main() {
  const options = readOptions()
  const attemptCount = options.retries + 1
  let lastOutcome = null

  for (let attempt = 1; attempt <= attemptCount; attempt++) {
    if (attempt > 1) await sleep(5000)

    const outcome = await runAttempt(options, attempt, attemptCount)
    lastOutcome = outcome

    if (outcome.ok) {
      if (attempt > 1) {
        // 抖动不该悄悄过去：第二次才通过说明这次运行的启动存在不确定性
        console.log(`::warning::打包产物冒烟第 ${attempt} 次才通过（首次失败，多为环境抖动）`)
      }
      console.log(`\n结果：${outcome.results.length} 项通过，0 项失败`)
      cleanup(options, outcome.userData)
      return 0
    }

    reportFailure(options, outcome, attempt, attemptCount)
    if (attempt < attemptCount) console.log(`\n第 ${attempt} 次失败，重试以排除环境抖动`)
    cleanup(options, outcome.userData)
  }

  const passed = lastOutcome ? lastOutcome.results.length - lastOutcome.failed.length : 0
  const failedCount = lastOutcome ? lastOutcome.failed.length : 1
  console.log(`\n结果：${passed} 项通过，${failedCount} 项失败`)
  return 1
}

// 只有被直接执行时才跑冒烟；被测试 import 时只取上面的纯函数
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  // 等待退出，避免任务在子进程还活着时先结束
  process.on('exit', () => {
    // 兜底：正常路径已在 runAttempt 的 finally 里停过
  })

  process.exitCode = await main()
}
