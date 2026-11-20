/**
 * 版本一致性校验的规则用例。
 *
 * 为什么值得单测：这些规则的价值全在"发版那一刻"才体现——而那一刻不能靠试错。
 * 尤其是 PLUGIN_REGISTRY_PINNED_TAG：漏改它本地一切正常，用户拉到的却是上一版注册表。
 * 这里把每条规则单独钉死，避免以后放宽成"看起来差不多就行"。
 */
import { describe, expect, it } from 'vitest'
import { checkVersions, collectVersions, expectedPinnedTag, extensionVersionFor } from './check-versions.mjs'

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
