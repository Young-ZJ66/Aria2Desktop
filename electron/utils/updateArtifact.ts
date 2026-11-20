/**
 * 更新安装包的产物命名（纯函数，禁止 import electron）。
 *
 * 为什么单独抽出来：更新检查里"发现新版本 → 下载安装包"的地址是**按名字拼出来的**，
 * 这个名字必须与 electron-builder 的 artifactName 宏逐字符一致，否则用户会看到
 * "有新版本"却下载 404。命名规则原本只存在于 package.json 的 build 段与
 * UpdateController 的一段 if/else 里，改构建配置时极易漏改后者——所以这里把规则
 * 固化成纯函数，并由单测**直接读 package.json 的 artifactName 反向校验**。
 *
 * 宏与目标架构的映射来自 builder-util 的 getArtifactArchName：
 * Windows 的 32 位产物叫 x86（不是 ia32），Linux x64 的产物叫 x86_64（不是 x64）。
 */

export type UpdatePlatform = 'win32' | 'darwin' | 'linux'

/** 各平台把 Node 的 process.arch 映射成产物名里的架构串；未列出的组合回落默认架构 */
const ARTIFACT_ARCH: Record<UpdatePlatform, Record<string, string>> = {
  win32: { x64: 'x64', ia32: 'x86', arm64: 'arm64' },
  darwin: { x64: 'x64', arm64: 'arm64' },
  linux: { x64: 'x86_64', arm64: 'arm64' }
}

/** 产物后缀：Windows 是安装器，macOS 是 dmg，Linux 是 AppImage */
const ARTIFACT_EXT: Record<UpdatePlatform, string> = {
  win32: 'exe',
  darwin: 'dmg',
  linux: 'AppImage'
}

/** 各平台的产物名模板，与 package.json 的 build.<platform>.artifactName 一一对应 */
const ARTIFACT_TEMPLATE: Record<UpdatePlatform, string> = {
  win32: 'Aria2Desktop-{version}-{arch}-Setup.{ext}',
  darwin: 'Aria2Desktop-{version}-{arch}.{ext}',
  linux: 'Aria2Desktop-{version}-{arch}.{ext}'
}

/**
 * 把 process.arch 归一成产物名里的架构串。
 *
 * 与旧实现保持同一回落语义：拿不到已知架构时按 64 位处理（而不是抛错），
 * 因为更新检查失败应表现为"下载不到"，不该让一个枚举之外的值把整个检查打断。
 */
export function updateArtifactArch(platform: UpdatePlatform, arch: string): string {
  const table = ARTIFACT_ARCH[platform]
  return table[arch] ?? table.x64
}

/** 当前平台/架构对应的安装包文件名（版本号不带 v 前缀，与 package.json 的 version 一致） */
export function updateArtifactFileName(
  version: string,
  platform: UpdatePlatform,
  arch: string
): string {
  const template = ARTIFACT_TEMPLATE[platform]
  return template
    .replace('{version}', version)
    .replace('{arch}', updateArtifactArch(platform, arch))
    .replace('{ext}', ARTIFACT_EXT[platform])
}

/** 安装包在 GitHub Release 上的下载地址 */
export function updateArtifactUrl(
  repo: string,
  version: string,
  platform: UpdatePlatform,
  arch: string
): string {
  const fileName = updateArtifactFileName(version, platform, arch)
  return `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(fileName)}`
}
