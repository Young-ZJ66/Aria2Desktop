import { describe, it, expect } from 'vitest'
import {
  needsExecutableBit,
  executableModeFor,
  describeMissingExecutableBit
} from './executablePermissionCore'

describe('needsExecutableBit（决定要不要补执行位）', () => {
  it('Windows 上从不要求执行位', () => {
    expect(needsExecutableBit('win32', 0o644)).toBe(false)
    expect(needsExecutableBit('win32', 0o000)).toBe(false)
  })

  it('Linux 上 0644 需要补（安装包被不保留权限的工具解压后就是这样）', () => {
    expect(needsExecutableBit('linux', 0o644)).toBe(true)
  })

  it('任一执行位已存在就不动它', () => {
    expect(needsExecutableBit('linux', 0o755)).toBe(false)
    expect(needsExecutableBit('darwin', 0o700)).toBe(false)
    expect(needsExecutableBit('darwin', 0o001)).toBe(false)
  })

  it('只读文件同样需要补', () => {
    expect(needsExecutableBit('linux', 0o400)).toBe(true)
  })
})

describe('executableModeFor（补权限时只加所有者执行位）', () => {
  it('0644 → 0744，读写位不变', () => {
    expect(executableModeFor(0o644)).toBe(0o744)
    expect(executableModeFor(0o644) & 0o666).toBe(0o644)
  })

  it('不放宽组/其他人的权限', () => {
    const next = executableModeFor(0o600)
    expect(next).toBe(0o700)
    expect(next & 0o077).toBe(0)
  })

  it('已经可执行时保持原样', () => {
    expect(executableModeFor(0o755)).toBe(0o755)
  })
})

describe('describeMissingExecutableBit（失败原因要能照着做）', () => {
  it('给出文件路径与可照抄的命令', () => {
    const message = describeMissingExecutableBit('/opt/app/resources/aria2c')
    expect(message).toContain('/opt/app/resources/aria2c')
    expect(message).toContain('chmod +x')
  })
})
