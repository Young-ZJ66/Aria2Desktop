/**
 * 剪贴板下载链接智能检测
 *
 * 当窗口重新获得焦点时，读取剪贴板内容，如果包含下载链接（http/https/ftp/magnet），
 * 且与上次检测到的不同，则自动打开新建下载弹窗并填入链接。
 * 使用 document.addEventListener('visibilitychange') 和 window.addEventListener('focus')
 * 双重监听，覆盖 Alt+Tab、点击任务栏、最小化恢复等场景。
 *
 * 读取方式：经主进程 IPC（window.electronAPI.readClipboard）——sandbox:true 下
 * preload 无法直接使用 electron clipboard 模块（官方白名单不含 clipboard）。
 */

import { useUiStore } from '@/stores/uiStore'

/** 支持自动检测的下载协议 */
const DOWNLOAD_URL_PATTERN = /^(https?|ftp|magnet):/i

export function useClipboardMonitor() {
  // 状态收在闭包内，避免模块级可变状态在多实例/HMR 场景下互相干扰
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
    debounceTimer = setTimeout(() => { void checkClipboard() }, 300)
  }

  async function checkClipboard() {
    if (!active) return

    let clipboardText = ''
    try {
      if (window.electronAPI?.readClipboard) {
        // 主进程 IPC 读取（异步）
        clipboardText = await window.electronAPI.readClipboard()
      } else {
        // 非 Electron 环境，跳过
        return
      }
    } catch {
      return
    }

    // 等待 IPC 期间可能已 stop()（断开连接）：避免停止后仍弹出新建任务弹窗
    if (!active) return

    if (!clipboardText || !isDownloadUrl(clipboardText)) return
    const url = clipboardText.trim()

    // 与上次检测到的相同，跳过
    if (url === lastDetectedUrl) return
    lastDetectedUrl = url

    // 打开新建下载弹窗并填入 URL
    const uiStore = useUiStore()
    uiStore.openNewTaskWithUrl(url)
  }

  function start() {
    if (active) return
    active = true
    // 监听 visibilitychange（最小化/切标签页）和 focus（Alt+Tab/点击任务栏）
    document.addEventListener('visibilitychange', debouncedCheck)
    window.addEventListener('focus', debouncedCheck)
    // 页面刚加载时如果已是可见状态，延迟检测一次
    if (document.visibilityState === 'visible') {
      setTimeout(() => { void checkClipboard() }, 500)
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

  return { start, stop, handleDetectedUrl }
}
