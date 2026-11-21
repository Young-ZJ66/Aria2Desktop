import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { EventEmitter } from 'events'

/**
 * 解压失败路径的回归测试（用可控的假子进程替代真实 tar）。
 *
 * 真实 tar 只会在"成功解压"这条路上走一遍，而用户真正会遇到的是：
 * 系统没有 tar（ENOENT）、压缩包损坏（非 0 退出）、超大归档卡死（超时）。
 * 这几种情况下必须**只清理本次解出来的半成品**，不能动同目录里已有的文件，
 * 也不能把"没有 tar"报成"解压失败"（前者要提示装工具，后者让用户以为文件坏了）。
 */
const holder = vi.hoisted(() => ({
  calls: [] as Array<{ command: string, args: string[], cwd: string }>,
  /** 每次 spawn 的行为：'list-ok' 表示 tar -t 正常，其余按 plan 顺序消费 */
  plan: [] as Array<{
    kind: 'exit'
    code: number
    stdout?: string
    stderr?: string
    /** 退出前在 cwd 里创建的文件（模拟解出一半） */
    createFiles?: string[]
  } | { kind: 'error', code?: string, message?: string } | { kind: 'hang' }>
}))

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), transports: { file: {}, console: {} } }
}))

vi.mock('child_process', async () => {
  const { EventEmitter: Emitter } = await import('events')
  const { writeFileSync } = await import('fs')
  const { join } = await import('path')
  return {
    spawn: (command: string, args: string[], options: { cwd: string }) => {
      holder.calls.push({ command, args, cwd: options.cwd })
      const child = new Emitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        kill: (signal?: string) => void
      }
      child.stdout = new Emitter()
      child.stderr = new Emitter()
      child.kill = vi.fn()
      const entry = holder.plan.shift()
      setImmediate(() => {
        if (!entry) {
          child.emit('exit', 0)
          return
        }
        if (entry.kind === 'hang') return
        if (entry.kind === 'error') {
          child.emit('error', Object.assign(new Error(entry.message ?? 'spawn failed'), { code: entry.code }))
          return
        }
        if (entry.stderr) child.stderr.emit('data', Buffer.from(entry.stderr))
        if (entry.stdout) child.stdout.emit('data', Buffer.from(entry.stdout))
        for (const file of entry.createFiles ?? []) writeFileSync(join(options.cwd, file), 'partial')
        child.emit('exit', entry.code)
      })
      return child
    }
  }
})

const { extractArchiveTo } = await import('./archiveService')

let workDir = ''
let archivePath = ''

function makeArchive(name = 'bundle.tar.gz'): string {
  const target = path.join(workDir, name)
  fs.writeFileSync(target, 'not a real archive')
  return target
}

beforeEach(() => {
  holder.calls.length = 0
  holder.plan.length = 0
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-errors-'))
  archivePath = makeArchive()
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe('extractArchiveTo 的失败路径', () => {
  it('目标不是普通文件时拒绝（不把目录当压缩包）', async () => {
    const dirAsArchive = path.join(workDir, 'fake.tar.gz')
    fs.mkdirSync(dirAsArchive)
    const result = await extractArchiveTo(dirAsArchive, workDir)
    expect(result).toEqual({ success: false, extracted: false, reason: 'not_a_file' })
    expect(holder.calls).toHaveLength(0)
  })

  it('系统没有 tar 时报"不可用"而不是"解压失败"', async () => {
    holder.plan.push({ kind: 'exit', code: 0, stdout: '' })
    holder.plan.push({ kind: 'error', code: 'ENOENT', message: 'spawn tar ENOENT' })
    const result = await extractArchiveTo(archivePath, workDir)
    expect(result.success).toBe(false)
    expect(result.reason).toBe('tar_not_available')
  })

  it('压缩包损坏（非 0 退出）时把 tar 的 stderr 带出来', async () => {
    holder.plan.push({ kind: 'exit', code: 0, stdout: '' })
    holder.plan.push({ kind: 'exit', code: 2, stderr: 'tar: Unrecognized archive format' })
    const result = await extractArchiveTo(archivePath, workDir)
    expect(result.success).toBe(false)
    expect(result.reason).toBe('tar: Unrecognized archive format')
  })

  it('tar 卡死时超时并强杀，原因是 extract_timeout', async () => {
    vi.useFakeTimers()
    holder.plan.push({ kind: 'exit', code: 0, stdout: '' })
    holder.plan.push({ kind: 'hang' })
    const pending = extractArchiveTo(archivePath, workDir)
    // 分两步，避免"时间没推进够/推进过头"的时序脆弱（曾因此在全量跑时超时）：
    // 1) advanceTimersByTimeAsync(0) 只清空当前时刻的队列，让假子进程的 exit（setImmediate）
    //    跑完、5 分钟超时计时器装上，不推进时间；
    for (let round = 0; round < 20 && holder.calls.length < 2; round += 1) {
      await vi.advanceTimersByTimeAsync(0)
    }
    // 2) 一次性跨过超时阈值，触发强杀与 reject。
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    const result = await pending
    expect(result.success).toBe(false)
    expect(result.reason).toBe('extract_timeout')
    // 覆盖率插桩下每轮 advanceTimersByTimeAsync 都要走一遍被插桩的微任务队列，
    // 60 轮在慢机器上可能超过默认的 5s；这条用例本身是确定性的，给足预算即可。
  }, 30000)

  it('列举条目失败不影响解压（按无法统计处理）', async () => {
    fs.writeFileSync(path.join(workDir, 'existing.txt'), 'keep me')
    holder.plan.push({ kind: 'exit', code: 2, stderr: 'tar: bad option' })
    holder.plan.push({ kind: 'exit', code: 0 })
    const result = await extractArchiveTo(archivePath, workDir)
    expect(result).toEqual({ success: true, extracted: true, targetDir: workDir, skipped: 0 })
  })

  it('解压失败只清理本次新增的顶层条目，原有文件与压缩包都保留', async () => {
    fs.writeFileSync(path.join(workDir, 'existing.txt'), 'keep me')
    holder.plan.push({ kind: 'exit', code: 0, stdout: 'bundle/\n' })
    holder.plan.push({ kind: 'exit', code: 2, stderr: 'tar: broken', createFiles: ['bundle', 'unrelated.tmp'] })
    const result = await extractArchiveTo(archivePath, workDir)
    expect(result.success).toBe(false)
    expect(fs.existsSync(path.join(workDir, 'existing.txt'))).toBe(true)
    expect(fs.existsSync(archivePath)).toBe(true)
    // 属于归档的顶层条目被清掉
    expect(fs.existsSync(path.join(workDir, 'bundle'))).toBe(false)
    // 不在归档条目里的新增文件不动（可能是另一个下载刚写出的）
    expect(fs.existsSync(path.join(workDir, 'unrelated.tmp'))).toBe(true)
  })

  it('统计出已存在的条目数并在日志里如实告知', async () => {
    fs.writeFileSync(path.join(workDir, 'bundle'), 'already here')
    holder.plan.push({ kind: 'exit', code: 0, stdout: 'bundle\nother.txt\n' })
    holder.plan.push({ kind: 'exit', code: 0 })
    const result = await extractArchiveTo(archivePath, workDir)
    expect(result).toEqual({ success: true, extracted: true, targetDir: workDir, skipped: 1 })
  })

  it('不支持的格式按跳过处理（不算失败）', async () => {
    const rarPath = path.join(workDir, 'movie.rar')
    fs.writeFileSync(rarPath, 'x')
    const result = await extractArchiveTo(rarPath, workDir)
    expect(result).toEqual({ success: true, extracted: false, reason: 'unsupported_format' })
    expect(holder.calls).toHaveLength(0)
  })

  it('相对路径与非绝对目标目录都被拒绝', async () => {
    expect(await extractArchiveTo('relative.tar.gz', workDir)).toEqual({ success: false, extracted: false, reason: 'invalid_path' })
    expect(await extractArchiveTo(archivePath, 'relative-dir')).toEqual({ success: false, extracted: false, reason: 'invalid_target' })
  })
})

describe('tar 候选路径与平台', () => {
  it('非 Windows 平台不构造候选路径', async () => {
    const { resolveTarCommandForTest } = await import('./archiveService')
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      expect(resolveTarCommandForTest()).toEqual([])
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })

  it('Windows 候选必须包含 Windows\\System32 段（历史教训：丢了这段会退回 GNU tar）', async () => {
    const { resolveTarCommandForTest } = await import('./archiveService')
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const candidates = resolveTarCommandForTest()
      expect(candidates.length).toBeGreaterThanOrEqual(2)
      for (const candidate of candidates) {
        expect(candidate).toMatch(/^[A-Z]:\\Windows\\System32\\tar\.exe$/)
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })
})
