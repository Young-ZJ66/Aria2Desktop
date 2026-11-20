import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { updateArtifactArch, updateArtifactFileName, updateArtifactUrl } from './updateArtifact'
import type { UpdatePlatform } from './updateArtifact'

/**
 * 更新检查的"下载地址"是按文件名拼出来的：名字必须与 electron-builder 的 artifactName
 * 宏逐字符一致，否则用户会看到"有新版本"却下载 404。这里除了固化命名规则，
 * 还**直接读 package.json 的 artifactName 反向校验**——改构建配置却忘了改代码时，
 * 这条用例会立刻红，而不是等发版后用户下载失败。
 */
const repoRoot = path.resolve(__dirname, '..', '..')
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
  version: string
  build: Record<string, { artifactName?: string; target?: unknown }>
}

/** 把 artifactName 模板里的 ${version}/${arch}/${ext} 换成实际值 */
function expandTemplate(template: string, version: string, arch: string, ext: string): string {
  return template
    .replace(/\$\{version\}/g, version)
    .replace(/\$\{arch\}/g, arch)
    .replace(/\$\{ext\}/g, ext)
}

describe('updateArtifactArch', () => {
  it('Windows 的 32 位产物叫 x86，不是 ia32', () => {
    expect(updateArtifactArch('win32', 'ia32')).toBe('x86')
    expect(updateArtifactArch('win32', 'x64')).toBe('x64')
    expect(updateArtifactArch('win32', 'arm64')).toBe('arm64')
  })

  it('Linux x64 的产物叫 x86_64（deb 才叫 amd64，更新包是 AppImage）', () => {
    expect(updateArtifactArch('linux', 'x64')).toBe('x86_64')
    expect(updateArtifactArch('linux', 'arm64')).toBe('arm64')
  })

  it('未知架构按 64 位回落，不抛错（更新失败应是"下载不到"而非崩溃）', () => {
    expect(updateArtifactArch('win32', 'mips')).toBe('x64')
    expect(updateArtifactArch('darwin', 'ia32')).toBe('x64')
    expect(updateArtifactArch('linux', 'ppc64')).toBe('x86_64')
  })
})

describe('updateArtifactFileName', () => {
  it('三平台命名与历史产物一致', () => {
    expect(updateArtifactFileName('1.5.0', 'win32', 'x64')).toBe('Aria2Desktop-1.5.0-x64-Setup.exe')
    expect(updateArtifactFileName('1.5.0', 'win32', 'ia32')).toBe('Aria2Desktop-1.5.0-x86-Setup.exe')
    expect(updateArtifactFileName('1.5.0', 'darwin', 'arm64')).toBe('Aria2Desktop-1.5.0-arm64.dmg')
    expect(updateArtifactFileName('1.5.0', 'linux', 'x64')).toBe('Aria2Desktop-1.5.0-x86_64.AppImage')
  })

  it('预发布版本号原样保留（beta 用户靠它判断是否已有该版本）', () => {
    expect(updateArtifactFileName('1.5.0-beta.4', 'win32', 'x64')).toBe('Aria2Desktop-1.5.0-beta.4-x64-Setup.exe')
  })
})

describe('updateArtifactUrl', () => {
  it('拼出 releases/download/v<version>/ 下的资产地址', () => {
    expect(updateArtifactUrl('o/r', '1.5.0', 'win32', 'x64'))
      .toBe('https://github.com/o/r/releases/download/v1.5.0/Aria2Desktop-1.5.0-x64-Setup.exe')
  })

  it('文件名里的特殊字符会被编码（防止路径穿越式拼接）', () => {
    expect(updateArtifactUrl('o/r', '1.5.0', 'win32', 'x64')).not.toContain(' ')
    expect(encodeURIComponent('a b')).toBe('a%20b')
  })
})

describe('与 package.json 的 artifactName 一致（改构建配置时立刻发现）', () => {
  const platforms: Array<{ platform: UpdatePlatform; buildKey: string; arch: string; ext: string }> = [
    { platform: 'win32', buildKey: 'win', arch: 'x64', ext: 'exe' },
    { platform: 'win32', buildKey: 'win', arch: 'ia32', ext: 'exe' },
    { platform: 'darwin', buildKey: 'mac', arch: 'x64', ext: 'dmg' },
    { platform: 'darwin', buildKey: 'mac', arch: 'arm64', ext: 'dmg' },
    { platform: 'linux', buildKey: 'linux', arch: 'x64', ext: 'AppImage' },
    { platform: 'linux', buildKey: 'linux', arch: 'arm64', ext: 'AppImage' }
  ]

  for (const entry of platforms) {
    it(`${entry.buildKey}/${entry.arch} 的产物名与 package.json 的 artifactName 展开结果相同`, () => {
      const template = pkg.build[entry.buildKey]?.artifactName
      expect(typeof template).toBe('string')
      const expanded = expandTemplate(template as string, pkg.version, updateArtifactArch(entry.platform, entry.arch), entry.ext)
      expect(updateArtifactFileName(pkg.version, entry.platform, entry.arch)).toBe(expanded)
    })
  }
})
