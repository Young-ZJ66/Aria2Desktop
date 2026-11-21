/**
 * 冒烟脚本里"准备现场"与"收尾"两段逻辑的用例。
 *
 * 为什么单独成文件：这些函数会真的碰磁盘与进程（造隔离数据目录、杀进程树、清目录），
 * 和 renderer 判定那组（mock 掉 CDP）放在一起会让桩互相干扰。
 * 它们出错的方式很隐蔽——预置的设置少了 aria2.conf，冒烟会在"引擎起不来"上误判成产品回归；
 * 清理失败则会把上一轮的隔离数据留给下一轮，出现"本地过、CI 不过"。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, findFreePort, main, readLog, seedUserData, stopProcess, waitFor } from './smoke-packaged.mjs'

const holder = vi.hoisted(() => ({
  spawnCalls: [],
  spawnSyncCalls: [],
  platform: process.platform,
  /** 造完子进程后的钩子：runAttempt 的用例靠它在 spawn 时把日志落到隔离数据里 */
  onSpawn: null,
  /** 最近一次 spawn 出来的假子进程：用例要靠它回放 stdout/stderr/exit */
  lastChild: null
}))

vi.mock('node:child_process', () => ({
  spawn: (...args) => {
    holder.spawnCalls.push(args)
    // 只实现 runAttempt 真正用到的表面：两路输出流、exit 监听、exitCode
    const listeners = new Map()
    const child = {
      pid: 999,
      exitCode: null,
      stderr: { on: (event, callback) => listeners.set('stderr', callback) },
      stdout: { on: (event, callback) => listeners.set('stdout', callback) },
      on: (event, callback) => listeners.set(event, callback),
      emit: (event, payload) => listeners.get(event)?.(payload)
    }
    holder.lastChild = child
    if (holder.onSpawn) holder.onSpawn(args, child)
    return child
  },
  spawnSync: (...args) => {
    holder.spawnSyncCalls.push(args)
    return { status: 0 }
  }
}))

// runAttempt 起完进程后要连调试端口看窗口是否白屏；这里把 CDP 整体换掉，
// 让 main() 的完整路径能在没有浏览器的测试进程里跑通。
vi.mock('./e2e/lib/cdp.mjs', () => ({
  httpJson: async () => [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1' }],
  connect: async () => ({ send: async () => ({}), close: () => {} }),
  evalIn: async () => ({
    title: 'Aria2 Desktop',
    text: '正在下载 3 个任务，总速度 1.2 MB/s',
    url: 'file:///app/index.html'
  })
}))

let workDir = ''

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-helpers-'))
  holder.spawnCalls = []
  holder.spawnSyncCalls = []
  holder.onSpawn = null
  holder.lastChild = null
})

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('seedUserData', () => {
  it('预置设置、连接预设与 aria2.conf，端口用的是本次分配的 RPC 端口', () => {
    const userData = path.join(workDir, 'data')
    seedUserData(userData, 39123)

    // 迁移标记：否则应用会把仓库 data/ 下的真实任务搬进来，冒烟结果不可信
    expect(fs.existsSync(path.join(userData, '.legacy-data-migrated'))).toBe(true)

    const settings = JSON.parse(
      fs.readFileSync(path.join(userData, 'config', 'aria2-desktop-settings.json'), 'utf8')
    )
    expect(settings.settings.aria2.port).toBe(39123)
    expect(settings.settings.activeProfileId).toBe('default')
    expect(settings.settings.connectionProfiles).toHaveLength(1)
    expect(settings.settings.connectionProfiles[0].config.port).toBe(39123)

    const conf = fs.readFileSync(path.join(userData, 'aria2', 'aria2.conf'), 'utf8')
    expect(conf).toContain('rpc-listen-port=39123')
    expect(conf).toContain('enable-rpc=true')
    // 目录一律用正斜杠：conf 里写反斜杠会被 aria2 当成转义
    expect(conf).toContain('dir=' + path.join(userData, 'downloads').replace(/\\/g, '/'))
    // 故意不写 save-session / input-file：那是应用启动时该自己补上的
    expect(conf).not.toMatch(/^save-session=/m)
    expect(fs.existsSync(path.join(userData, 'downloads'))).toBe(true)
  })

  it('目录已存在时不报错（重试用例会复用同一路径）', () => {
    const userData = path.join(workDir, 'data')
    seedUserData(userData, 39124)
    expect(() => seedUserData(userData, 39124)).not.toThrow()
  })
})

describe('findFreePort', () => {
  it('拿到一个能再次监听的端口', async () => {
    const port = await findFreePort()
    expect(Number.isInteger(port)).toBe(true)
    expect(port).toBeGreaterThan(0)
    // 关掉后应当能重新占用，说明确实空闲
    const net = await import('node:net')
    const server = net.createServer()
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    await new Promise((resolve) => server.close(resolve))
  })
})

describe('waitFor', () => {
  it('判据为真时立刻返回该值', async () => {
    expect(await waitFor(() => 'hit', { timeout: 1000 })).toBe('hit')
  })

  it('先假后真时轮询到真值', async () => {
    let calls = 0
    const value = await waitFor(() => (++calls >= 3 ? 'ready' : null), { timeout: 5000, intervalMs: 1 })
    expect(value).toBe('ready')
    expect(calls).toBe(3)
  })

  it('超时返回 null 而不是抛错（调用方据此出结论）', async () => {
    vi.useFakeTimers()
    const pending = waitFor(() => null, { timeout: 100, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(200)
    expect(await pending).toBeNull()
  })
})

describe('readLog', () => {
  it('日志存在时返回原文', () => {
    const file = path.join(workDir, 'main.log')
    fs.writeFileSync(file, 'Aria2 进程启动成功\n')
    expect(readLog(file)).toContain('Aria2 进程启动成功')
  })

  it('日志还没生成时返回空串（启动早期读不到是常态）', () => {
    expect(readLog(path.join(workDir, 'missing.log'))).toBe('')
  })
})

describe('stopProcess', () => {
  it('子进程已退出时什么都不做', () => {
    stopProcess({ pid: 1, exitCode: 0 })
    expect(holder.spawnSyncCalls).toHaveLength(0)
  })

  it('没有子进程时不抛错', () => {
    expect(() => stopProcess(null)).not.toThrow()
  })

  it('Windows 上用 taskkill /T 连引擎子进程一起收掉', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      stopProcess({ pid: 4321, exitCode: null })
      expect(holder.spawnSyncCalls).toEqual([
        ['taskkill', ['/PID', '4321', '/T', '/F'], { stdio: 'ignore' }]
      ])
    } finally {
      Object.defineProperty(process, 'platform', { value: holder.platform, configurable: true })
    }
  })

  it('POSIX 上按进程组发 SIGTERM，并在 1.5 秒后补 SIGKILL', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    vi.useFakeTimers()
    try {
      stopProcess({ pid: 4322, exitCode: null })
      expect(kill).toHaveBeenCalledWith(-4322, 'SIGTERM')
      vi.advanceTimersByTime(1600)
      expect(kill).toHaveBeenCalledWith(-4322, 'SIGKILL')
    } finally {
      Object.defineProperty(process, 'platform', { value: holder.platform, configurable: true })
    }
  })

  it('进程组已消失时退化成按 pid 发信号，不抛错', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const kill = vi.spyOn(process, 'kill').mockImplementation((target) => {
      if (Number(target) < 0) throw new Error('ESRCH')
      return true
    })
    const child = { pid: 4323, exitCode: null, kill: vi.fn() }
    vi.useFakeTimers()
    try {
      expect(() => stopProcess(child)).not.toThrow()
      // 进程组发不出去时退化成只杀父进程
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      expect(kill).toHaveBeenCalledWith(-4323, 'SIGTERM')
      expect(() => vi.advanceTimersByTime(1600)).not.toThrow()
    } finally {
      Object.defineProperty(process, 'platform', { value: holder.platform, configurable: true })
    }
  })
})

describe('cleanup', () => {
  it('默认删掉隔离数据目录', () => {
    const userData = path.join(workDir, 'to-remove')
    fs.mkdirSync(userData, { recursive: true })
    cleanup({ keepData: false }, userData)
    expect(fs.existsSync(userData)).toBe(false)
  })

  it('--keep 时保留现场并打印路径', () => {
    const userData = path.join(workDir, 'to-keep')
    fs.mkdirSync(userData, { recursive: true })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    cleanup({ keepData: true }, userData)
    expect(fs.existsSync(userData)).toBe(true)
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('按 --keep 保留隔离数据')
  })

  it('删除失败不抛错（应用刚退出时句柄可能还没释放）', () => {
    const userData = path.join(workDir, 'busy')
    fs.mkdirSync(userData, { recursive: true })
    const rm = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('EBUSY')
    })
    try {
      expect(() => cleanup({ keepData: false }, userData)).not.toThrow()
    } finally {
      rm.mockRestore()
    }
  })
})

describe('main 的入口失败路径', () => {
  it('产物不存在时打印原因并以退出码 2 结束，而不是抛错杀进程', async () => {
    // main() 从 process.argv 读参数，这里换成一个必然不存在的产物路径
    const originalArgv = process.argv
    process.argv = ['node', 'smoke-packaged.mjs', '--exe', 'release/definitely-missing/Aria2Desktop.exe']
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await main()).toBe(2)
    } finally {
      process.argv = originalArgv
    }
    expect(String(error.mock.calls[0][0])).toContain('找不到打包产物')
  })
})

/** 把日志与（可选的）默认配置写进 spawn 时拿到的隔离数据目录 */
function writeAttemptArtifacts(env, logText, { freshDefaults = false } = {}) {
  const userData = env.ARIA2_E2E_USER_DATA
  const logFile = path.join(userData, 'logs', 'main.log')
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  fs.writeFileSync(logFile, logText)
  if (!freshDefaults) return
  fs.mkdirSync(path.join(userData, 'config'), { recursive: true })
  fs.mkdirSync(path.join(userData, 'aria2'), { recursive: true })
  fs.writeFileSync(path.join(userData, 'config', 'aria2-desktop-settings.json'), '{}')
  fs.writeFileSync(
    path.join(userData, 'aria2', 'aria2.conf'),
    'dir=D:/Downloads\nsave-session=D:/x/aria2.session\ninput-file=D:/x/aria2.session\n'
  )
}

const READY_LOG = [
  '[main] Aria2 进程启动成功',
  '[main] 浏览器扩展本地接口已启动',
  ''
].join('\n')

function runMainWith(argv) {
  const originalArgv = process.argv
  process.argv = ['node', 'smoke-packaged.mjs', ...argv]
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return {
    log,
    error,
    async finish() {
      try {
        return await main()
      } finally {
        process.argv = originalArgv
      }
    }
  }
}

describe('main 的完整运行路径', () => {
  it('引擎与扩展接口都起来、窗口也渲染出来时判通过，并按 --keep 保留现场', async () => {
    const exe = path.join(workDir, 'Aria2Desktop.exe')
    fs.writeFileSync(exe, 'stub')
    holder.onSpawn = (args) => writeAttemptArtifacts(args[2].env, READY_LOG)
    const run = runMainWith(['--exe', exe, '--timeout', '1000', '--retries', '0', '--keep'])
    const code = await run.finish()

    expect(code).toBe(0)
    expect(holder.spawnCalls).toHaveLength(1)
    const [spawnExe, spawnArgs, spawnOptions] = holder.spawnCalls[0]
    expect(spawnExe).toBe(path.resolve(exe))
    // 额外开调试端口，并把 ELECTRON_RUN_AS_NODE 从环境里摘掉
    expect(spawnArgs.some((argument) => argument.startsWith('--remote-debugging-port='))).toBe(true)
    expect(spawnOptions.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(spawnOptions.env.ARIA2_E2E_USER_DATA).toBeTruthy()
    // --keep：隔离数据留着，并在日志里指出路径
    expect(fs.existsSync(spawnOptions.env.ARIA2_E2E_USER_DATA)).toBe(true)
    const printed = run.log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('PASS 打包后的应用拉起了内置 aria2')
    expect(printed).toContain('PASS 窗口渲染出了界面（不是白屏）')
    expect(printed).toContain('结果：3 项通过，0 项失败')
  })

  it('--fresh 时额外校验应用自己长出的默认配置', async () => {
    const exe = path.join(workDir, 'Aria2Desktop.exe')
    fs.writeFileSync(exe, 'stub')
    holder.onSpawn = (args) => writeAttemptArtifacts(args[2].env, READY_LOG, { freshDefaults: true })
    const run = runMainWith(['--exe', exe, '--timeout', '1000', '--retries', '0', '--fresh'])
    const code = await run.finish()

    expect(code).toBe(0)
    const printed = run.log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('--fresh：数据目录保持空白')
    expect(printed).toContain('PASS 首次启动写出了默认设置文件')
    expect(printed).toContain('结果：5 项通过，0 项失败')
  })

  it('判据没出现时打印失败现场与根因线索，并以退出码 1 结束', async () => {
    const exe = path.join(workDir, 'Aria2Desktop.exe')
    fs.writeFileSync(exe, 'stub')
    // 只留致命行：两条判据都不会命中，diagnoseStartupFailure 能认出根因
    holder.onSpawn = (args) => writeAttemptArtifacts(args[2].env, '[main] Aria2 initialization failed\n')
    const run = runMainWith(['--exe', exe, '--timeout', '200', '--retries', '0'])
    const code = await run.finish()

    expect(code).toBe(1)
    const printed = run.error.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('根因线索')
    expect(printed).toContain('引擎初始化失败')
    expect(printed).toContain('主进程日志尾部')
    expect(printed).toContain('诊断已写入 test-results/smoke-packaged.json')
    // 失败时不留现场（没有 --keep）
    expect(fs.existsSync(holder.spawnCalls[0][2].env.ARIA2_E2E_USER_DATA)).toBe(false)
  })

  it('首次失败第二次通过时打 ::warning::，并把额外启动参数与子进程输出带进日志', async () => {
    const exe = path.join(workDir, 'Aria2Desktop.exe')
    fs.writeFileSync(exe, 'stub')
    let attempts = 0
    holder.onSpawn = (args) => {
      attempts += 1
      writeAttemptArtifacts(args[2].env, attempts === 1 ? '' : READY_LOG)
    }
    const run = runMainWith([
      '--exe',
      exe,
      '--timeout',
      '100',
      '--retries',
      '1',
      '--spawn-args=--no-sandbox --disable-gpu'
    ])
    const code = await run.finish()

    expect(code).toBe(0)
    expect(attempts).toBe(2)
    // 两次尝试之间会睡 5 秒排除环境抖动；重试成功要留下 GitHub warning 而不是静默放过
    const printed = run.log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('启动参数: --no-sandbox --disable-gpu')
    expect(printed).toContain('第 2/2 次尝试')
    expect(printed).toContain('第 1 次失败，重试以排除环境抖动')
    expect(printed).toContain('::warning::打包产物冒烟第 2 次才通过')
    expect(printed).toContain('结果：3 项通过，0 项失败')
  }, 30000)

  it('子进程的 stdout/stderr 与退出码都进失败现场，0x80000003 额外给沙箱提示', async () => {
    const exe = path.join(workDir, 'Aria2Desktop.exe')
    fs.writeFileSync(exe, 'stub')
    holder.onSpawn = (args, child) => {
      writeAttemptArtifacts(args[2].env, '[main] 应用初始化失败\n')
      // 启动即崩：exitCode 为 0x80000003（Windows 上表现为 2147483651）
      child.exitCode = 2147483651
      // runAttempt 在 spawn 返回后才注册监听器，所以回放要排到微任务里
      queueMicrotask(() => {
        child.emit('stdout', Buffer.from('stdout 旁证'))
        child.emit('stderr', Buffer.from('stderr 旁证'))
        child.emit('exit')
      })
    }
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const run = runMainWith(['--exe', exe, '--timeout', '100', '--retries', '0'])
      const code = await run.finish()

      expect(code).toBe(1)
      const printed = run.error.mock.calls.map((call) => String(call[0])).join('\n')
      expect(printed).toContain('标准输出')
      expect(printed).toContain('stdout 旁证')
      expect(printed).toContain('标准错误')
      expect(printed).toContain('stderr 旁证')
      expect(printed).toContain('应用初始化失败')
      expect(printed).toContain('0x80000003 多为沙箱/ACL 拒绝执行')
    } finally {
      if (original) Object.defineProperty(process, 'platform', original)
    }
  })

  it('诊断写盘失败时只打日志，不改变退出码', async () => {
    const exe = path.join(workDir, 'Aria2Desktop.exe')
    fs.writeFileSync(exe, 'stub')
    holder.onSpawn = (args) => writeAttemptArtifacts(args[2].env, '')
    const realWriteFileSync = fs.writeFileSync
    const writeFile = vi.spyOn(fs, 'writeFileSync').mockImplementation((target, data, options) => {
      // 只让诊断报告那一次失败，隔离数据目录里的文件仍要照常写出
      if (String(target).includes('smoke-packaged.json')) throw new Error('EACCES: test-results')
      return realWriteFileSync(target, data, options)
    })
    try {
      const run = runMainWith(['--exe', exe, '--timeout', '100', '--retries', '0'])
      expect(await run.finish()).toBe(1)
      const printed = run.error.mock.calls.map((call) => String(call[0])).join('\n')
      expect(printed).toContain('诊断写入失败')
      expect(printed).toContain('EACCES')
    } finally {
      writeFile.mockRestore()
    }
  }, 20000)
})
