/**
 * 下载文件名探测。
 *
 * 背景：很多真实下载链接（网盘直链、跳转链接）的 URL 里没有文件名
 * （如 https://d.pcs.baidu.com/file/<hash>?...），真实文件名在服务器响应的
 * Content-Disposition 头里。URL 无扩展名时自动分类必然失效，
 * 因此在提交前向文件服务器探测一次真实文件名：只取响应头，不下载正文。
 *
 * 刻意不 import electron：纯 Node 能力（全局 fetch），便于单元测试与脚本复用。
 */
import * as fs from 'fs'
import * as path from 'path'
// 探测目标策略（回环/链路本地/云元数据不探）与扩展本地接口共用同一份纯函数。
// 注意：这里**不是**为了扩展接口，而是因为"由本机向调用方给的地址发请求"这一行为
// 在两个入口（IPC 与 /api/resolve）都存在，策略必须只有一份，否则必然漂移。
import { isProbeAllowed } from './extensionApiCore'

const PROBE_DEFAULT_TIMEOUT_MS = 6000
/** 手动跟随重定向的次数上限（探测只需要最终的 Content-Disposition，跳太多说明目标不正常） */
const MAX_PROBE_REDIRECTS = 5

/** 清理文件名：去掉路径分隔符/引号/控制符与首尾空白，避免写进 out 后出现非法内容 */
function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '').replace(/["'\r\n]/g, '').trim()
}

/**
 * 解析 Content-Disposition 头中的 filename。兼容三种常见形态：
 *  1. `filename*=UTF-8''%E6%96%87%E4%BB%B6.rar`   （RFC 5987，优先）
 *  2. `filename="PPT.rar"`                        （值可能是百分号编码，或原始 UTF-8 字节被按 latin1 误读）
 *  3. `filename=PPT.rar`                          （无引号）
 * 解析不出返回空串。
 */
export function parseContentDisposition(header: string): string {
  if (!header) return ''

  // 1) RFC 5987：filename*=charset'lang'value
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;\s]+)/i.exec(header)
  if (star && star[2]) {
    try {
      return sanitizeFileName(decodeURIComponent(star[2]))
    } catch { /* 解码失败继续尝试普通形态 */ }
  }

  // 2) 3) filename="..." / filename=xxx
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header)
  if (plain && plain[1]) {
    let value = plain[1].trim()
    if (value.includes('%')) {
      try {
        value = decodeURIComponent(value)
      } catch { /* 保持原样 */ }
    }
    // 服务器直接发原始 UTF-8 字节时，Node 按 latin1 解码会得到乱码；能无损修复就用修复值
    const repaired = Buffer.from(value, 'latin1').toString('utf8')
    if (!repaired.includes('\uFFFD')) value = repaired
    return sanitizeFileName(value)
  }
  return ''
}

/**
 * 探测下载 URL 的真实文件名。
 * 用 GET + Range: bytes=0-0（部分服务器不支持 HEAD）：响应头一到手立刻取消正文流。
 * 任何失败（超时/非 2xx/无文件名头）都返回空串，调用方按"未探测到"降级处理，绝不阻塞任务创建。
 */
export async function probeDownloadFileName(url: string, timeoutMs = PROBE_DEFAULT_TIMEOUT_MS): Promise<string> {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return ''

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // 自己跟跳并**逐跳校验**：原先用 redirect: 'follow' 只挡了首跳，
    // 一个公网地址完全可以 302 到 127.0.0.1 / 169.254.169.254，从而绕过策略。
    // 校验放在本函数内部（而不是各调用方）是为了让 IPC 与扩展接口拿到同一等级的保护。
    let target = trimmed
    for (let hop = 0; hop <= MAX_PROBE_REDIRECTS; hop++) {
      if (!isProbeAllowed(target)) return ''

      const response = await fetch(target, {
        method: 'GET',
        headers: {
          Range: 'bytes=0-0',
          // 与实际下载者保持一致的 UA，避免服务器对无 UA 请求区别对待
          'User-Agent': 'aria2/1.37.0'
        },
        redirect: 'manual',
        signal: controller.signal
      })
      // 响应头一到手就断开正文，避免真的把文件拉下来
      response.body?.cancel().catch(() => {})

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return ''
        try {
          target = new URL(location, target).toString()
        } catch {
          return ''
        }
        continue
      }

      if (!response.ok) return ''
      return parseContentDisposition(response.headers.get('content-disposition') ?? '')
    }
    return ''
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 处理下载重名。
 *
 * 背景：aria2.conf 里 `continue=true` + `always-resume=true` 时，重复添加同一 URL 的任务，
 * aria2 会把**已存在的同名完整文件**当作"这个任务之前下载过、已经完成"——比对大小一致就
 * 0 字节可下、**秒完成**；`auto-file-renaming=true` 只在"从头开始下载且路径被占用"时改名，
 * 续传分支优先级更高，根本走不到改名那一步。用户预期却是"重新下载一份带序号的新副本"。
 *
 * 因此在提交前调用本函数：目标文件已存在且**没有 .aria2 控制文件**时，分配一个
 * 带序号的空闲文件名（浏览器风格：`xxx (1).rar`）；
 * 存在 .aria2 控制文件说明上次下载被中断——保持原名，让 aria2 正常断点续传。
 */
export function resolveConflictingFileName(dir: string, fileName: string): { fileName: string; conflict: boolean } {
  const cleanName = sanitizeFileName(fileName)
  if (!dir || !cleanName) return { fileName: cleanName || fileName, conflict: false }

  const target = path.join(dir, cleanName)
  if (!fs.existsSync(target)) return { fileName: cleanName, conflict: false }
  // 上次下载被中断（有控制文件）：保持原名，aria2 会续传
  if (fs.existsSync(`${target}.aria2`)) return { fileName: cleanName, conflict: false }

  const ext = path.extname(cleanName)
  const stem = cleanName.slice(0, cleanName.length - ext.length)
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    const candidatePath = path.join(dir, candidate)
    if (!fs.existsSync(candidatePath) && !fs.existsSync(`${candidatePath}.aria2`)) {
      return { fileName: candidate, conflict: true }
    }
  }
  return { fileName: cleanName, conflict: false }
}
