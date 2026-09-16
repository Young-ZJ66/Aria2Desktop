/**
 * 剪贴板下载链接智能检测
 *
 * 当窗口重新获得焦点时，读取剪贴板内容，如果包含下载链接（http/https/ftp/magnet），
 * 且与上次检测到的不同，则自动打开新建下载弹窗并填入链接。
 * 使用 document.addEventListener('visibilitychange') 和 window.addEventListener('focus')
 * 双重监听，覆盖 Alt+Tab、点击任务栏、最小化恢复等场景。
 */

import { useUiStore } from '@/stores/uiStore'

/** 支持自动检测的下载协议 */
const DOWNLOAD_URL_PATTERN = /^(https?|ftp|magnet):/i

let lastDetectedUrl = ''
let active = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function isDownloadUrl(text: string): boolean {
  const trimmed = text.trim()
  // 单行文本且匹配下载协议
  if (trimmed.includes('\n')) return false
  if (trimmed.length > 2048) return false // 过长文本不是 URL
  return DOWNLOAD_URL_PATTERN.test(trimmed)
}

/** 防抖处理，避免短时间内重复触发 */
function debouncedCheck() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(checkClipboard, 300)
}

function checkClipboard() {
  if (!active) return

  let clipboardText = ''
  try {
    if (window.electronAPI?.readClipboard) {
      clipboardText = window.electronAPI.readClipboard()
    } else {
      // 非 Electron 环境，跳过
      return
    }
  } catch {
    return
  }

  if (!clipboardText || !isDownloadUrl(clipboardText)) return
  const url = clipboardText.trim()

  // 与上次检测到的相同，跳过
  if (url === lastDetectedUrl) return
  lastDetectedUrl = url

  // 打开新建下载弹窗并填入 URL
  const uiStore = useUiStore()
  uiStore.openNewTaskWithUrl(url)
}

export function useClipboardMonitor() {
  function start() {
    if (active) return
    active = true
    // 监听 visibilitychange（最小化/切标签页）和 focus（Alt+Tab/点击任务栏）
    document.addEventListener('visibilitychange', debouncedCheck)
    window.addEventListener('focus', debouncedCheck)
    // 页面刚加载时如果已是可见状态，延迟检测一次
    if (document.visibilityState === 'visible') {
      setTimeout(checkClipboard, 500)
    }
  }

  function stop() {
    active = false
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    document.removeEventListener('visibilitychange', debouncedCheck)
    window.removeEventListener('focus', debouncedCheck)
  }

  /** 外部标记 URL 已被使用（如用户提交了下载任务），避免重复提示 */
  function markUrlUsed(url: string) {
    if (url === lastDetectedUrl) {
      lastDetectedUrl = ''
    }
  }

  /** 处理主进程推送的剪贴板 URL（WindowController 窗口焦点事件触发） */
  function handleDetectedUrl(url: string) {
    if (!active) return
    if (!url || !isDownloadUrl(url)) return
    const trimmed = url.trim()
    if (trimmed === lastDetectedUrl) return
    lastDetectedUrl = trimmed
    const uiStore = useUiStore()
    uiStore.openNewTaskWithUrl(trimmed)
  }

  return { start, stop, markUrlUsed, handleDetectedUrl }
}
