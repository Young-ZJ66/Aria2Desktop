#!/usr/bin/env node
/**
 * 打包产物冒烟：启动真正打包出来的可执行文件，等它在隔离数据里把引擎与本地接口拉起来。
 *
 * 为什么开发态 E2E 覆盖不到：那层跑的是源码与 dist/，而 asar 里漏文件、
 * 引擎可执行文件没被带进包、资源路径按 process.resourcesPath 解析这类问题，
 * 只有"装完之后再启动一次"才会暴露——v1.2.0 的自动解压事故就是同一个教训：
 * 类型检查、单测、扩展校验全绿，坏在没人把成品跑一遍。
 *
 * 用法：
 *   node scripts/smoke-packaged.mjs                     # 默认 release/win-unpacked/Aria2Desktop.exe
 *   node scripts/smoke-packaged.mjs --exe <路径> --timeout 120000 --keep
 *   node scripts/smoke-packaged.mjs --retries 0         # CI 里想一次定生死时用
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

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

/**
 * electron-builder 的免安装目录按架构分家：x64 是 `win-unpacked`，32 位是
 * `win-ia32-unpacked`（arm64 同理）。发版矩阵里两个架构各跑一次冒烟，
 * 写死一个目录就会在其中一侧找不到文件——所以默认按已有目录推断。
 */
const UNPACKED_DIR_RE = /^win(-[a-z0-9]+)?-unpacked$/

function resolveDefaultExe() {
  const releaseDir = path.join(root, 'release')
  const candidates = fs.existsSync(releaseDir)
    ? fs
        .readdirSync(releaseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && UNPACKED_DIR_RE.test(entry.name))
        .map((entry) => path.join(releaseDir, entry.name, 'Aria2Desktop.exe'))
        .filter((file) => fs.existsSync(file))
    : []
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    // 同时存在多个架构时优先 x64（正是默认构建产物），其余靠 --exe 指定
    return candidates.find((file) => /win-unpacked/.test(file)) ?? candidates[0]
  }
  return path.join(releaseDir, 'win-unpacked', 'Aria2Desktop.exe')
}

const exePath = argValue('exe')
  ? path.resolve(root, argValue('exe'))
  : resolveDefaultExe()
const timeoutMs = Number(argValue('timeout', '90000'))
const keepData = args.includes('--keep')
const retries = Number(argValue('retries', '1'))

/** 启动成功的判据：引擎起来了，扩展本地接口也起来了（两条都在主进程日志里） */
const EXPECTED_MARKERS = [
  { name: '打包后的应用拉起了内置 aria2', pattern: /Aria2 进程启动成功/ },
  { name: '扩展本地接口已在监听', pattern: /浏览器扩展本地接口已启动/ }
]

if (!fs.existsSync(exePath)) {
  console.error(`找不到打包产物：${exePath}`)
  console.error('先跑一次 `npm run dist:win64:nsis`（或 `npx electron-builder --win --x64 --dir`）再执行冒烟。')
  process.exit(2)
}

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
  } else {
    child.kill('SIGTERM')
  }
}

async function runAttempt(attempt, attemptCount) {
  const rpcPort = await findFreePort()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-smoke-'))
  seedUserData(userData, rpcPort)
  const logFile = path.join(userData, 'logs', 'main.log')

  console.log(`\n=== 打包产物冒烟${attemptCount > 1 ? `（第 ${attempt}/${attemptCount} 次尝试）` : ''}`)
  console.log(`可执行文件: ${exePath}`)
  console.log(`隔离数据: ${userData}（RPC ${rpcPort}）`)

  const env = { ...process.env, ARIA2_E2E_USER_DATA: userData }
  // 在 DSH 这类环境里该变量会让 electron 以 Node 身份启动（app 未定义，直接崩）
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(exePath, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
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
      }, { timeout: timeoutMs })

      if (hit) {
        results.push({ name: marker.name, ok: true, detail: hit })
      } else {
        // 三种失败要分开说：启动即退（exitCode 有值）、起来了但没就绪、连日志都没写
        const hasLog = readLog(logFile).length > 0
        const detail = exited
          ? `应用在等待期间退出（exitCode=${child.exitCode}）`
          : hasLog
            ? `超时 ${timeoutMs}ms 未出现`
            : `超时 ${timeoutMs}ms，应用没有写出日志（可能启动即退出）`
        results.push({ name: marker.name, ok: false, detail })
        break
      }
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
function reportFailure(outcome, attempt, attemptCount) {
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

  if (outcome.exitCode === 2147483651) {
    // 0x80000003：启动即崩，且日志文件都没生成。常见于受限沙箱/ACL 拒绝执行工作区内的文件，
    // 与产品无关；把免安装目录复制到工作区外再跑一次即可区分。
    console.error('\n提示：0x80000003 多为沙箱/ACL 拒绝执行，先把 release/win-unpacked 复制到工作区外再试：')
    console.error('  node scripts/smoke-packaged.mjs --exe <工作区外的 Aria2Desktop.exe>')
  }
}

function cleanup(userData) {
  if (keepData) {
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
  const attemptCount = retries + 1
  let lastOutcome = null

  for (let attempt = 1; attempt <= attemptCount; attempt++) {
    if (attempt > 1) await sleep(5000)

    const outcome = await runAttempt(attempt, attemptCount)
    lastOutcome = outcome

    if (outcome.ok) {
      if (attempt > 1) {
        // 抖动不该悄悄过去：第二次才通过说明这次运行的启动存在不确定性
        console.log(`::warning::打包产物冒烟第 ${attempt} 次才通过（首次失败，多为环境抖动）`)
      }
      console.log(`\n结果：${outcome.results.length} 项通过，0 项失败`)
      cleanup(outcome.userData)
      return 0
    }

    reportFailure(outcome, attempt, attemptCount)
    if (attempt < attemptCount) console.log(`\n第 ${attempt} 次失败，重试以排除环境抖动`)
    cleanup(outcome.userData)
  }

  const passed = lastOutcome ? lastOutcome.results.length - lastOutcome.failed.length : 0
  const failedCount = lastOutcome ? lastOutcome.failed.length : 1
  console.log(`\n结果：${passed} 项通过，${failedCount} 项失败`)
  return 1
}

// 等待退出，避免任务在子进程还活着时先结束
process.on('exit', () => {
  // 兜底：正常路径已在 runAttempt 的 finally 里停过
})

process.exitCode = await main()
