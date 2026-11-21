import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aria2.conf 读写的失败路径。
 *
 * 这里锁的是「读不出来时绝不能写」这条红线，以及写盘的两级兜底：
 * 原子写（临时文件 + rename）失败要退回直接覆盖，连直接覆盖都失败则抛给调用方，
 * 合批写盘（微任务）失败必须留痕而不是变成未处理的 Promise 拒绝。
 */

const holder = vi.hoisted(() => ({
  readThrows: false,
  writeThrows: false,
  renameThrows: false,
  logs: { warn: [] as unknown[][], error: [] as unknown[][] }
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/Users/test/Downloads'), isPackaged: false }
}))

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: (...args: unknown[]) => { holder.logs.warn.push(args) },
    error: (...args: unknown[]) => { holder.logs.error.push(args) }
  })
}))

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')

// 工厂函数会被提升到文件顶部执行，不能引用模块级变量 → 用 importOriginal 拿真实实现
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (holder.readThrows) throw new Error('EBUSY: resource busy or locked')
      return actual.readFileSync(...args)
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (holder.writeThrows) throw new Error('EACCES: permission denied')
      return actual.writeFileSync(...args)
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (holder.renameThrows) throw new Error('EPERM: operation not permitted')
      return actual.renameSync(...args)
    }
  }
})

import { Aria2ConfigManager } from './aria2ConfigManager'

let dir = ''
let configPath = ''

function writeConfig(text: string) {
  fs.writeFileSync(configPath, text, 'utf-8')
}

function readConfig() {
  return fs.readFileSync(configPath, 'utf-8')
}

function warnText(): string {
  return holder.logs.warn.map(args => args.map(String).join(' ')).join('\n')
}

function errorText(): string {
  return holder.logs.error.map(args => args.map(String).join(' ')).join('\n')
}

beforeEach(() => {
  dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'aria2-conf-cov-'))
  configPath = path.join(dir, 'aria2.conf')
  holder.readThrows = false
  holder.writeThrows = false
  holder.renameThrows = false
  holder.logs.warn.length = 0
  holder.logs.error.length = 0
})

afterEach(() => {
  realFs.rmSync(dir, { recursive: true, force: true })
})

describe('Aria2ConfigManager 的读失败自愈', () => {
  it('重载失败时恢复内存里的旧基线并返回 false', () => {
    writeConfig(['dir=D:/Downloads', 'rpc-listen-port=6800', ''].join('\n'))
    const manager = new Aria2ConfigManager(configPath)
    expect(manager.getConfigValue('dir')).toBe('D:/Downloads')

    holder.readThrows = true
    expect(manager.reload()).toBe(false)
    // 一次瞬时读失败不该把内存里本来可用的配置清空
    expect(manager.getConfigValue('dir')).toBe('D:/Downloads')
    expect(manager.getConfigValue('rpc-listen-port')).toBe('6800')
    expect(errorText()).toContain('Failed to load Aria2 config:')
    expect(warnText()).toContain('保留内存现状并禁止写盘')
  })

  it('读失败后拒绝写盘，等下一次重载成功才恢复', () => {
    writeConfig(['dir=D:/Downloads', ''].join('\n'))
    const manager = new Aria2ConfigManager(configPath)

    holder.readThrows = true
    expect(manager.reload()).toBe(false)
    manager.setConfigValue('dir', 'E:/Other')
    expect(() => manager.flushSave()).toThrow()
    expect(readConfig()).toContain('dir=D:/Downloads')

    holder.readThrows = false
    expect(manager.reload()).toBe(true)
    manager.setConfigValue('dir', 'E:/Other')
    manager.flushSave()
    expect(readConfig()).toContain('dir=E:/Other')
  })

  it('默认配置都写不出去时同样禁止后续写盘', () => {
    holder.writeThrows = true
    const manager = new Aria2ConfigManager(configPath)
    expect(fs.existsSync(configPath)).toBe(false)
    expect(errorText()).toContain('Failed to create default config:')

    manager.setConfigValue('dir', 'E:/Other')
    expect(() => manager.flushSave()).toThrow()
  })

  it('空基线但有待写内容时拒绝覆盖整份配置', () => {
    writeConfig(['dir=D:/Downloads', ''].join('\n'))
    const manager = new Aria2ConfigManager(configPath)
    const internals = manager as unknown as {
      rawLines: string[]
      configContent: Map<string, string>
      baselineUnreadable: boolean
    }
    internals.rawLines = []
    internals.baselineUnreadable = false
    internals.configContent.set('dir', 'E:/Other')

    expect(() => manager.flushSave()).not.toThrow()
    manager.setConfigValue('dir', 'E:/Other')
    expect(() => manager.flushSave()).toThrow()
  })
})

describe('Aria2ConfigManager 的写盘兜底', () => {
  it('原子写失败时退回直接覆盖，配置仍然落盘', () => {
    writeConfig(['dir=D:/Downloads', ''].join('\n'))
    const manager = new Aria2ConfigManager(configPath)

    holder.renameThrows = true
    manager.setConfigValue('rpc-listen-port', 6810)
    manager.flushSave()

    expect(warnText()).toContain('原子写入 aria2 配置失败，退回直接覆盖:')
    expect(readConfig()).toContain('rpc-listen-port=6810')
    expect(fs.existsSync(`${configPath}.tmp`)).toBe(false)
  })

  it('合批写盘失败只记日志，不变成未处理的拒绝', async () => {
    writeConfig(['dir=D:/Downloads', ''].join('\n'))
    const manager = new Aria2ConfigManager(configPath)

    holder.writeThrows = true
    manager.setConfigValue('dir', 'E:/Other')
    await Promise.resolve()
    await Promise.resolve()

    expect(errorText()).toContain('合批写入 aria2 配置失败:')
  })

  it('同一同步帧内的多次修改只落盘一次，flushSave 后微任务不再重复写', async () => {
    writeConfig(['dir=D:/Downloads', ''].join('\n'))
    const manager = new Aria2ConfigManager(configPath)

    manager.setConfigValue('dir', 'E:/One')
    manager.setConfigValue('rpc-listen-port', 6900)
    manager.flushSave()
    const afterFlush = readConfig()
    await Promise.resolve()
    await Promise.resolve()
    expect(readConfig()).toBe(afterFlush)
    expect(readConfig()).toContain('rpc-listen-port=6900')
  })

  it('新增键追加到末尾前先补空行，且返回配置文件路径', () => {
    // 末行没有换行：追加前必须补一个空行，避免新键粘在最后一行后面
    writeConfig(['dir=D:/Downloads'].join('\n'))
    const manager = new Aria2ConfigManager(configPath)
    expect(manager.getConfigFilePath()).toBe(configPath)

    manager.setConfigValue('rpc-secret', 'token')
    manager.flushSave()

    const lines = readConfig().split('\n')
    expect(lines[0]).toBe('dir=D:/Downloads')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('rpc-secret=token')
  })

  it('注释配置项时跳过空行与注释行，只改第一处匹配', () => {
    writeConfig([
      '# 顶部的说明',
      '',
      'dir=D:/Downloads',
      'rpc-secret=abc',
      'dir=E:/Second',
      ''
    ].join('\n'))
    const manager = new Aria2ConfigManager(configPath)

    manager.commentConfigValue('dir')
    manager.flushSave()

    const lines = readConfig().split('\n')
    expect(lines[0]).toBe('# 顶部的说明')
    expect(lines[2]).toBe('#dir=D:/Downloads')
    // 只改第一处，后面的同键行原样保留
    expect(lines[4]).toBe('dir=E:/Second')
    expect(manager.getConfigValue('dir')).toBeUndefined()
  })

  it('removeConfigKey 只在真的删掉行时才落盘', () => {
    writeConfig([
      '# 说明',
      'max-piece-length=1M',
      '#max-piece-length=2M',
      'dir=D:/Downloads',
      ''
    ].join('\n'))
    const manager = new Aria2ConfigManager(configPath)

    expect(manager.removeConfigKey('max-piece-length')).toBe(true)
    manager.flushSave()
    expect(readConfig()).not.toContain('max-piece-length')
    expect(readConfig()).toContain('dir=D:/Downloads')

    expect(manager.removeConfigKey('max-piece-length')).toBe(false)
  })
})
