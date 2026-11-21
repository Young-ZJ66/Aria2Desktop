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

const holder = vi.hoisted(() => ({ spawnCalls: [], spawnSyncCalls: [], platform: process.platform }))

vi.mock('node:child_process', () => ({
  spawn: (...args) => {
    holder.spawnCalls.push(args)
    return { pid: 999, exitCode: null }
  },
  spawnSync: (...args) => {
    holder.spawnSyncCalls.push(args)
    return { status: 0 }
  }
}))

let workDir = ''

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-helpers-'))
  holder.spawnCalls = []
  holder.spawnSyncCalls = []
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
