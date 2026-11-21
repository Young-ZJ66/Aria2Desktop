/**
 * 版本一致性校验的规则用例。
 *
 * 为什么值得单测：这些规则的价值全在"发版那一刻"才体现——而那一刻不能靠试错。
 * 尤其是 PLUGIN_REGISTRY_PINNED_TAG：漏改它本地一切正常，用户拉到的却是上一版注册表。
 * 这里把每条规则单独钉死，避免以后放宽成"看起来差不多就行"。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkVersions, collectVersions, expectedPinnedTag, extensionVersionFor, main } from './check-versions.mjs'

/**
 * main() 的失败分支只能在"仓库自身不自洽"时触发，而那种状态不该被提交。
 * 所以这里只替换 package.json 的 version 读取，其余文件照旧从磁盘读。
 */
const fsState = vi.hoisted(() => ({ overridePackageVersion: null }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  const patched = (file, encoding) => {
    const text = actual.default.readFileSync(file, encoding)
    if (fsState.overridePackageVersion && String(file).endsWith('package.json')) {
      const pkg = JSON.parse(String(text))
      pkg.version = fsState.overridePackageVersion
      return JSON.stringify(pkg)
    }
    return text
  }
  return { ...actual, default: { ...actual.default, readFileSync: patched }, readFileSync: patched }
})

/** 一份完全自洽的输入，用例只改其中一处 */
function healthy(overrides = {}) {
  return {
    pkgVersion: '1.5.0-beta.3',
    lockRootVersion: '1.5.0-beta.3',
    lockPackageVersion: '1.5.0-beta.3',
    pinnedTag: 'v1.5.0-beta.3',
    extensionVersion: '1.5.0',
    releaseNotesFirstLine: '# v1.5.0-beta.3 更新日志',
    ...overrides
  }
}

describe('版本一致性校验', () => {
  it('全部一致时通过', () => {
    expect(checkVersions(healthy())).toEqual([])
  })

  it('稳定版同样通过（无预发布后缀）', () => {
    expect(checkVersions(healthy({
      pkgVersion: '1.5.0',
      lockRootVersion: '1.5.0',
      lockPackageVersion: '1.5.0',
      pinnedTag: 'v1.5.0',
      extensionVersion: '1.5.0',
      releaseNotesFirstLine: '# v1.5.0 更新日志'
    }))).toEqual([])
  })

  it('package.json 版本非法时只报这一条（后续推导无意义）', () => {
    const failures = checkVersions(healthy({ pkgVersion: '1.5' }))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('不是合法 semver')
  })

  it('lockfile 两处版本都要跟着改', () => {
    const failures = checkVersions(healthy({ lockPackageVersion: '1.5.0-beta.2' }))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('packages[""].version')
  })

  it('lockfile 顶层版本漏改也要报', () => {
    const failures = checkVersions(healthy({ lockRootVersion: '1.5.0-beta.2' }))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('顶层 version')
  })

  it('注册表固定 tag 漏改时报错并指出要改哪个文件', () => {
    const failures = checkVersions(healthy({ pinnedTag: 'v1.5.0-beta.2' }))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('PLUGIN_REGISTRY_PINNED_TAG')
    expect(failures[0]).toContain('src/shared/appSettings.ts')
  })

  it('扩展版本必须是三段稳定号（商店不接受预发布后缀）', () => {
    const failures = checkVersions(healthy({ extensionVersion: '1.5.0-beta.3' }))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('三段稳定号')
  })

  it('扩展版本与 App 主版本不一致要报', () => {
    const failures = checkVersions(healthy({ extensionVersion: '1.4.0' }))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('扩展版本与 App 主版本不一致')
  })

  it('更新日志首行缺版本号时报错（release.yml 会拒绝创建 Release）', () => {
    const failures = checkVersions(healthy({ releaseNotesFirstLine: '# v1.5.0-beta.2 更新日志' }))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('release-notes.md')
  })

  it('多处不一致时全部列出，不只报第一条', () => {
    const failures = checkVersions(healthy({
      lockRootVersion: 'x',
      pinnedTag: 'v0',
      extensionVersion: 'nope'
    }))
    expect(failures).toHaveLength(3)
  })

  it('expectedPinnedTag 是 v 前缀形式', () => {
    expect(expectedPinnedTag('1.5.0')).toBe('v1.5.0')
    expect(expectedPinnedTag(' 1.5.0-beta.1 ')).toBe('v1.5.0-beta.1')
  })

  // 仓库自身也必须自洽：这条会在 CI 与本地 test:run 里跑，等价于"提交前先验一遍"
  it('当前仓库的版本号彼此一致', () => {
    expect(checkVersions(collectVersions())).toEqual([])
  })

  it('extensionVersionFor 去掉预发布后缀', () => {
    expect(extensionVersionFor('1.5.0-beta.3')).toBe('1.5.0')
    expect(extensionVersionFor('1.5.0')).toBe('1.5.0')
  })
})

describe('CLI 入口 main', () => {
  afterEach(() => {
    fsState.overridePackageVersion = null
    vi.restoreAllMocks()
  })

  it('仓库自洽时退出码 0，并打印五个版本来源', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(main()).toBe(0)
    const text = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(text).toContain('package.json')
    expect(text).toContain('package-lock.json')
    expect(text).toContain('PLUGIN_REGISTRY_TAG')
    expect(text).toContain('extension/manifest')
    expect(text).toContain('release-notes 首行')
    expect(text).toContain('版本一致性校验通过')
    expect(error).not.toHaveBeenCalled()
  })

  it('版本号对不上时退出码 1，并逐条打印失败项', () => {
    fsState.overridePackageVersion = '9.9.9'
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(main()).toBe(1)
    const lines = error.mock.calls.map((call) => String(call[0]))
    expect(lines.length).toBeGreaterThanOrEqual(4)
    expect(lines.every((line) => line.startsWith('✗ '))).toBe(true)
    expect(lines.join('\n')).toContain('package-lock.json')
    expect(lines.join('\n')).toContain('PLUGIN_REGISTRY_PINNED_TAG')
  })
})
