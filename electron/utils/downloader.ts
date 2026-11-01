/**
 * 主进程通用网络下载（Electron `net`，走 Chromium 网络栈 → 自动使用系统代理）。
 *
 * 为什么不用 Node 原生 https：国内用户多数只配置系统代理，Node 不会读取它；
 * Electron `net` 与浏览器共用代理设置，下载 GitHub 资产才不会"浏览器能开、应用连不上"。
 */

import * as fs from 'fs'
import { net, session, type Session } from 'electron'

export interface DownloadProgress {
  percent: number
  transferred: number
  total: number
}

/** 30 秒无数据视为断流（GitHub 直连被重置时能尽快给出可行动的提示） */
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
/** 文本响应（校验文件）较小，10 秒足够 */
const TEXT_IDLE_TIMEOUT_MS = 10_000
/** 校验文件防御性上限（正常约 1–2 KB） */
const MAX_TEXT_BYTES = 64 * 1024
/** 瞬时网络失败的重试次数（GitHub 在国内常出现连接重置） */
const DOWNLOAD_ATTEMPTS = 3
const TEXT_ATTEMPTS = 3

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 下载专用会话。
 *
 * 默认跟随系统代理（与浏览器一致）；若用户没有开启系统代理、只在本机起了
 * 代理端口（常见于 Clash 等），可通过 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量显式指定。
 * 独立会话同时避免下载流量与页面会话的缓存/凭据互相影响。
 */
let downloadSessionPromise: Promise<Session> | null = null

function getDownloadSession(): Promise<Session> {
  if (downloadSessionPromise) return downloadSessionPromise
  downloadSessionPromise = (async () => {
    // 不带 persist: 前缀 = 内存会话，不落盘
    const target = session.fromPartition('aria2-desktop-downloads', { cache: false })
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy
    if (proxy) {
      try {
        await target.setProxy({ proxyRules: proxy })
      } catch {
        // 代理设置失败时退回系统代理，真正失败会由请求报错暴露
      }
    }
    return target
  })()
  return downloadSessionPromise
}

/** 空闲超时守卫：一段时间内没有任何数据回调就触发失败（避免请求永久挂起） */
function startIdleTimer(timeoutMs: number, onTimeout: () => void): { reset: () => void; clear: () => void } {
  let timer: NodeJS.Timeout | null = null
  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const reset = () => {
    clear()
    timer = setTimeout(onTimeout, timeoutMs)
  }
  reset()
  return { reset, clear }
}

/**
 * 下载到文件，带进度回调。重定向由 `redirect: 'follow'` 处理（GitHub 资产会 302 到 CDN）。
 *
 * 国内网络访问 GitHub 时常出现瞬时重置，因此失败后重试（每次从头下载，
 * 避免把半截文件当完整文件校验）。
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      await downloadOnce(url, destPath, onProgress)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      fs.rmSync(destPath, { force: true })
      if (attempt < DOWNLOAD_ATTEMPTS) {
        console.warn(`[downloader] 下载失败（第 ${attempt} 次），重试: ${lastError.message}`)
        await delay(attempt * 1000)
      }
    }
  }
  throw lastError ?? new Error('下载失败')
}

async function downloadOnce(
  url: string,
  destPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const downloadSession = await getDownloadSession()
  return new Promise((resolve, reject) => {
    const request = net.request({ session: downloadSession, url, redirect: 'follow', useSessionCookies: false })
    let settled = false
    let fileStream: fs.WriteStream | null = null
    let idle: ReturnType<typeof startIdleTimer> | null = null

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      idle?.clear()
      try { request.abort() } catch { /* 已结束的请求忽略 */ }
      fileStream?.destroy()
      reject(error)
    }

    const succeed = () => {
      if (settled) return
      settled = true
      idle?.clear()
      resolve()
    }

    idle = startIdleTimer(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
      fail(new Error('下载超时（30 秒无数据），请检查网络或系统代理'))
    })

    request.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))

    request.on('response', (response) => {
      const status = response.statusCode ?? 0
      if (status < 200 || status >= 300) {
        fail(new Error(`下载失败：HTTP ${status}`))
        return
      }

      const total = Number(String(response.headers['content-length'] ?? 0)) || 0
      let transferred = 0
      let lastReportAt = 0
      fileStream = fs.createWriteStream(destPath, { flags: 'w' })
      fileStream.on('error', fail)

      // Electron 的 IncomingMessage 不暴露 pause/resume，无法做背压控制；
      // 单文件几十 MB，让 WriteStream 内部缓冲即可（内存占用可控且实现更简单）。
      response.on('data', (chunk: Buffer) => {
        if (settled) return
        idle?.reset()
        transferred += chunk.length
        fileStream?.write(chunk)

        const now = Date.now()
        if (onProgress && total > 0 && (now - lastReportAt >= 100 || transferred >= total)) {
          lastReportAt = now
          onProgress({
            percent: Math.min(100, Math.round((transferred / total) * 100)),
            transferred,
            total
          })
        }
      })

      response.on('end', () => {
        if (settled) return
        fileStream!.end(() => {
          onProgress?.({ percent: 100, transferred, total: total || transferred })
          succeed()
        })
      })

      response.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
    })

    request.end()
  })
}

/** GET 文本（用于官方校验文件）。同样走系统代理与自动重定向；瞬时失败重试 */
export async function fetchText(url: string): Promise<string> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= TEXT_ATTEMPTS; attempt++) {
    try {
      return await fetchTextOnce(url)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < TEXT_ATTEMPTS) {
        console.warn(`[downloader] 获取文本失败（第 ${attempt} 次），重试: ${lastError.message}`)
        await delay(attempt * 1000)
      }
    }
  }
  throw lastError ?? new Error('获取文本失败')
}

async function fetchTextOnce(url: string): Promise<string> {
  const downloadSession = await getDownloadSession()
  return new Promise((resolve, reject) => {
    const request = net.request({ session: downloadSession, url, redirect: 'follow', useSessionCookies: false })
    let settled = false
    let idle: ReturnType<typeof startIdleTimer> | null = null

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      idle?.clear()
      try { request.abort() } catch { /* 已结束的请求忽略 */ }
      reject(error)
    }

    idle = startIdleTimer(TEXT_IDLE_TIMEOUT_MS, () => {
      fail(new Error('获取校验文件超时，请检查网络或系统代理'))
    })

    request.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))

    request.on('response', (response) => {
      const status = response.statusCode ?? 0
      if (status < 200 || status >= 300) {
        fail(new Error(`获取校验文件失败：HTTP ${status}`))
        return
      }
      let body = ''
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        idle?.reset()
        bytes += chunk.length
        if (bytes > MAX_TEXT_BYTES) {
          fail(new Error('校验文件异常（响应体过大）'))
          return
        }
        body += chunk.toString()
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        idle?.clear()
        resolve(body)
      })
      response.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
    })

    request.end()
  })
}
