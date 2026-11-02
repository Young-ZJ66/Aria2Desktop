import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Aria2ConfigManager } from './aria2ConfigManager'

/**
 * aria2.conf 读写用例。
 *
 * 这份文件是用户可能手写过多年的配置（注释、空行、自己的键都在里面），
 * 应用只该"改它想改的那几行"，绝不能整体重写。历史事故正是：
 * 读取失败后降级成"写一份默认配置"，一次瞬时文件锁就把整份配置覆盖掉了。
 * 所以这里既验正常改写，也验**拒绝写盘**那条红线。
 */

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/Users/test/Downloads'), isPackaged: false }
}))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), transports: { file: {}, console: {} } }
}))

let dir = ''
let configPath = ''

function writeConfig(text: string) {
  fs.writeFileSync(configPath, text, 'utf-8')
}

function readConfig() {
  return fs.readFileSync(configPath, 'utf-8')
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-conf-test-'))
  configPath = path.join(dir, 'aria2.conf')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Aria2ConfigManager', () => {
  it('配置文件不存在时生成默认配置，并带上下载目录与 RPC 端口', () => {
    const manager = new Aria2ConfigManager(configPath)
    const text = readConfig()
    expect(text).toContain('dir=C:/Users/test/Downloads')
    expect(text).toContain('rpc-listen-port=6800')
    expect(text).toContain('bt-tracker=')
    expect(manager.getConfigValue('rpc-listen-port')).toBe('6800')
  })

  it('改写已存在的键时保留注释与空行（不整体重写）', () => {
    writeConfig([
      '# 我自己写的注释',
      'dir=D:/Downloads',
      '',
      'rpc-listen-port=6800',
      '# 下面这行是手工备注',
      'continue=true',
      ''
    ].join('\n'))
    const manager = new Aria2ConfigManager(configPath)

    manager.setConfigValue('rpc-listen-port', 6810)
    manager.flushSave()

    const lines = readConfig().split('\n')
    expect(lines[0]).toBe('# 我自己写的注释')
    expect(lines[1]).toBe('dir=D:/Downloads')
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('rpc-listen-port=6810')
    expect(lines[4]).toBe('# 下面这行是手工备注')
    expect(lines[5]).toBe('continue=true')
  })

  it('新增的键追加到文件末尾', () => {
    writeConfig('dir=D:/Downloads\nrpc-listen-port=6800\n')
    const manager = new Aria2ConfigManager(configPath)

    manager.setConfigValue('seed-time', 0)
    manager.flushSave()

    const text = readConfig()
    expect(text).toContain('seed-time=0')
    expect(text.indexOf('seed-time=0')).toBeGreaterThan(text.indexOf('rpc-listen-port=6800'))
  })

  it('被注释的键在赋值后取消注释并写入新值', () => {
    writeConfig('dir=D:/Downloads\n#rpc-secret=old\n')
    const manager = new Aria2ConfigManager(configPath)

    manager.setConfigValue('rpc-secret', 'new-secret')
    manager.flushSave()

    const text = readConfig()
    expect(text).toContain('rpc-secret=new-secret')
    expect(text).not.toContain('#rpc-secret=old')
    expect(manager.getConfigValue('rpc-secret')).toBe('new-secret')
  })

  it('值里含等号时不会被截断', () => {
    writeConfig('dir=D:/Downloads\nbt-tracker=udp://a.example:1/announce,udp://b.example:2/announce\n')
    const manager = new Aria2ConfigManager(configPath)
    expect(manager.getConfigValue('bt-tracker')).toBe('udp://a.example:1/announce,udp://b.example:2/announce')
  })

  it('CRLF 文件解析时不留回车符', () => {
    writeConfig('dir=D:/Downloads\r\nrpc-listen-port=6800\r\n')
    const manager = new Aria2ConfigManager(configPath)
    expect(manager.getConfigValue('rpc-listen-port')).toBe('6800')
  })

  it('注释掉的键不再被读出，但文件里保留原值', () => {
    writeConfig('dir=D:/Downloads\nrpc-secret=keep-me\n')
    const manager = new Aria2ConfigManager(configPath)

    manager.commentConfigValue('rpc-secret')
    manager.flushSave()

    expect(manager.getConfigValue('rpc-secret')).toBeUndefined()
    expect(readConfig()).toContain('#rpc-secret=keep-me')
  })

  it('removeConfigKey 同时清掉正常行与注释行', () => {
    writeConfig('dir=D:/Downloads\nmax-mmap-limit=0\n#max-mmap-limit=1073741824\n')
    const manager = new Aria2ConfigManager(configPath)

    expect(manager.removeConfigKey('max-mmap-limit')).toBe(true)
    manager.flushSave()

    const text = readConfig()
    expect(text).not.toContain('max-mmap-limit')
    expect(text).toContain('dir=D:/Downloads')
    expect(manager.removeConfigKey('not-exist-key')).toBe(false)
  })

  it('读取失败时拒绝写盘，绝不覆盖用户配置', () => {
    // 把配置路径指向目录：existsSync 为真但 readFileSync 抛错（模拟被杀软/同步盘占用）
    const brokenPath = path.join(dir, 'as-directory')
    fs.mkdirSync(brokenPath)
    writeConfig('dir=D:/Downloads\nrpc-listen-port=6800\n')

    const manager = new Aria2ConfigManager(brokenPath)
    // 内存里没有可用基线，写入应当抛错而不是静默生成默认配置
    expect(() => manager.flushSave()).not.toThrow()
    manager.setConfigValue('rpc-listen-port', 6810)
    expect(() => manager.flushSave()).toThrow(/基线不可读/)
    // 目录里没有生成任何文件
    expect(fs.readdirSync(brokenPath)).toEqual([])
  })

  it('reload 成功后可正常写盘，失败时恢复上一次的内存态', () => {
    writeConfig('dir=D:/Downloads\nrpc-listen-port=6800\n')
    const manager = new Aria2ConfigManager(configPath)
    expect(manager.getConfigValue('rpc-listen-port')).toBe('6800')

    // 外部改文件后再重载：拿到新值
    writeConfig('dir=D:/Downloads\nrpc-listen-port=6820\n')
    expect(manager.reload()).toBe(true)
    expect(manager.getConfigValue('rpc-listen-port')).toBe('6820')

    // 文件被删掉后 reload 会重建默认配置（不算失败）
    fs.unlinkSync(configPath)
    expect(manager.reload()).toBe(true)
    expect(readConfig()).toContain('rpc-listen-port=6800')
  })

  it('同一帧内的多次修改合并成一次完整写入', () => {
    writeConfig('dir=D:/Downloads\n')
    const manager = new Aria2ConfigManager(configPath)

    manager.setMultipleConfigs({ 'rpc-listen-port': 6810, 'max-concurrent-downloads': 8 })
    manager.setConfigValue('continue', 'true')
    manager.flushSave()

    const text = readConfig()
    expect(text).toContain('rpc-listen-port=6810')
    expect(text).toContain('max-concurrent-downloads=8')
    expect(text).toContain('continue=true')
    expect(text).toContain('dir=D:/Downloads')
  })

  it('getRelevantConfigs 只挑出目录 / 端口 / 密钥三项', () => {
    writeConfig('dir=D:/Downloads\nrpc-listen-port=6800\nrpc-secret=s1\nmax-concurrent-downloads=5\n')
    const manager = new Aria2ConfigManager(configPath)
    expect(manager.getRelevantConfigs()).toEqual({ dir: 'D:/Downloads', port: '6800', secret: 's1' })
  })
})
