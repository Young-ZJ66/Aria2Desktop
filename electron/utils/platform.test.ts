import { describe, expect, it } from 'vitest'
import { getEngineArchDir } from './platform'

/**
 * 引擎子目录名要同时与三处对齐：package.json 的 extraResources（${arch} 宏）、
 * scripts/verify-engine.mjs 的 ARCH_MAP、以及运行时这里的 getEngineArchDir。
 * 三者给出不同答案时，打包产物里引擎缺失，而开发环境却找得到 ——
 * 问题只在用户机器上暴露，所以这里把口径钉死。
 */
describe('getEngineArchDir 引擎子目录名', () => {
  it('Windows：ia32 保留，arm64 复用 x64 引擎（Windows on ARM 可跑 x64，与 Motrix 同策略）', () => {
    expect(getEngineArchDir('win32', 'x64')).toBe('x64')
    expect(getEngineArchDir('win32', 'ia32')).toBe('ia32')
    expect(getEngineArchDir('win32', 'arm64')).toBe('x64')
  })

  it('macOS：x64 与 arm64 各自一套引擎', () => {
    expect(getEngineArchDir('darwin', 'x64')).toBe('x64')
    expect(getEngineArchDir('darwin', 'arm64')).toBe('arm64')
  })

  it('macOS：其他架构（如 ia32）回落 x64', () => {
    expect(getEngineArchDir('darwin', 'ia32')).toBe('x64')
  })

  it('Linux：arm 归一为 armv7l（Node 里 arm 即 armv7l）', () => {
    expect(getEngineArchDir('linux', 'arm')).toBe('armv7l')
    expect(getEngineArchDir('linux', 'arm64')).toBe('arm64')
    expect(getEngineArchDir('linux', 'x64')).toBe('x64')
  })

  it('未知平台原样返回架构（打包时因目录不存在而明确失败，而不是静默回落到 x64）', () => {
    expect(getEngineArchDir('freebsd', 'arm64')).toBe('arm64')
  })
})
