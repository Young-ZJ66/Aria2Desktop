import { spawn, type ChildProcess } from 'node:child_process'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * 更新重启压力测试（发布清单 5.7「50 次更新重启压力测试，无孤儿进程」的自动化版本）。
 *
 * 为什么单独放一个被环境变量门控的测试文件，而不是普通单测：
 * 每次迭代都会 spawn 真实子进程 + 真实 TCP 监听 + 真实 taskkill/SIGKILL，
 * 慢且依赖 OS，不适合进常规套件（CI 上易 flaky）。默认跳过，
 * 需要时显式跑：STRESS_ENGINE_RESTART=1 npx vitest run electron/services/engineShutdownService.stress.test.ts
 *
 * 覆盖点：
 * 1. 引擎收到 quit 后自行退出、端口释放（正常路径）；
 * 2. 引擎赖着不走时由 EngineShutdownService 强杀进程树、端口仍能释放（超时路径）；
 * 3. N 轮之后没有残留监听端口、没有孤儿进程。
 */

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import { EngineShutdownService, probeLocalPortInUse } from './engineShutdownService'

const ENABLED = process.env.STRESS_ENGINE_RESTART === '1'
const ITERATIONS = Number(process.env.STRESS_ENGINE_RESTART_ROUNDS ?? 50)
const BASE_PORT = 6811
const PORT_SPAN = 4
/** 每 N 轮模拟一次「引擎赖着不走」，验证强杀路径 */
const STUBBORN_EVERY = 10

/** 子进程脚本：监听一个端口，收到 quit 时（非赖着模式）退出 */
const ENGINE_SCRIPT = `
const net = require('node:net')
const server = net.createServer((socket) => socket.end())
server.listen(Number(process.env.STRESS_PORT), '127.0.0.1')
const stubborn = process.env.STRESS_STUBBORN === '1'
process.stdin.on('data', (chunk) => {
  if (!stubborn && String(chunk).includes('quit')) {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 200)
  }
})
process.stdin.resume()
setInterval(() => {}, 1000)
`

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const spawned: ChildProcess[] = []

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPort(port: number, inUse: boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await probeLocalPortInUse(port, 200)) === inUse) return true
    await sleep(50)
  }
  return false
}

interface RoundResult {
  iteration: number
  port: number
  stubborn: boolean
  success: boolean
  forced: boolean
  waitedMs: number
}

async function runRound(iteration: number): Promise<RoundResult> {
  const port = BASE_PORT + (iteration % PORT_SPAN)
  const stubborn = iteration % STUBBORN_EVERY === 0
  const child = spawn(process.execPath, ['-e', ENGINE_SCRIPT], {
    env: { ...process.env, STRESS_PORT: String(port), STRESS_STUBBORN: stubborn ? '1' : '0' },
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true
  })
  spawned.push(child)

  let exited = false
  child.once('exit', () => {
    exited = true
  })

  try {
    // 等引擎真正开始监听，否则「端口已释放」会被误判为成功
    await waitForPort(port, true)

    const service = new EngineShutdownService({
      getProcessManager: () => ({
        isRunning: () => !exited,
        stop: async () => {
          child.stdin?.write('quit\\n')
          const deadline = Date.now() + 800
          while (!exited && Date.now() < deadline) await sleep(25)
          return exited
        },
        getProcessInfo: () => ({ isRunning: !exited, pid: child.pid ?? null })
      }),
      getPort: () => port,
      pollIntervalMs: 50,
      forceKillWaitMs: 2000
    })

    const result = await service.requestShutdownAndWait(3000)
    return {
      iteration,
      port,
      stubborn,
      success: result.success,
      forced: result.forced,
      waitedMs: result.waitedMs
    }
  } finally {
    child.stdin?.destroy()
    if (!exited) child.kill()
    await sleep(50)
  }
}

describe.skipIf(!ENABLED)('引擎重启压力测试（无孤儿进程）', () => {
  afterAll(() => {
    for (const child of spawned) {
      if (child.exitCode === null && child.pid) {
        try {
          process.kill(child.pid)
        } catch {
          // 已退出
        }
      }
    }
  })

  it(
    `连续 ${ITERATIONS} 轮关闭引擎后无残留端口与孤儿进程`,
    async () => {
      const results: RoundResult[] = []
      for (let i = 0; i < ITERATIONS; i += 1) {
        results.push(await runRound(i))
      }

      // 1. 每一轮都必须成功关闭（含被强杀的轮次：强杀后仍需等到端口释放）
      const failed = results.filter((r) => !r.success)
      expect(failed.map((r) => `第 ${r.iteration} 轮（端口 ${r.port}）`)).toEqual([])

      // 2. 至少触发过一次强杀，否则说明超时路径没被覆盖到
      expect(results.some((r) => r.forced)).toBe(true)

      // 3. 结束后所有用到的端口都已释放
      const leakedPorts: number[] = []
      for (let offset = 0; offset < PORT_SPAN; offset += 1) {
        const port = BASE_PORT + offset
        if (await probeLocalPortInUse(port, 300)) leakedPorts.push(port)
      }
      expect(leakedPorts).toEqual([])

      // 4. 没有孤儿进程
      const orphans = spawned.map((child) => child.pid).filter((pid): pid is number => typeof pid === 'number' && isAlive(pid))
      expect(orphans).toEqual([])
    },
    10 * 60 * 1000
  )
})
