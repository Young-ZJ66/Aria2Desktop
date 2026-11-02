/**
 * 可执行文件权限位的纯逻辑（不依赖 electron / fs，便于单测）。
 *
 * 背景：内置 aria2 引擎随安装包分发时是带执行位的。但 macOS 的 zip 包、或者用户用
 * 不支持权限位的工具解压/复制产物（部分解压软件、从 Windows 拷到 macOS），文件会变成
 * 0644 —— `spawn` 直接抛 EACCES，界面只显示"启动失败"，用户完全无从下手。
 *
 * 这里只负责判断"要不要补"和"怎么补最小权限"，真正改权限在调用方（主进程）做。
 */

/** 是否需要补执行位：Windows 没有这个概念；POSIX 上只要三个执行位全为 0 就需要补 */
export function needsExecutableBit(platform: NodeJS.Platform, mode: number): boolean {
  if (platform === 'win32') return false
  return (mode & 0o111) === 0
}

/**
 * 补执行位时的新权限：只加"所有者可执行"，其余位原样保留。
 *
 * 不直接写 0o755 是有意的——那会顺手放宽组/其他人的权限，属于越权修改用户文件；
 * 所有者执行位足够本应用启动引擎。
 */
export function executableModeFor(mode: number): number {
  return mode | 0o100
}

/** 自动补权限失败时给用户看的原因（日志与界面共用一句，避免两处措辞漂移） */
export function describeMissingExecutableBit(filePath: string): string {
  return `内置 aria2 引擎没有执行权限，自动修复也失败：${filePath}（请手动执行 chmod +x "${filePath}"，或以能保留权限的方式重新解压安装包）`
}
