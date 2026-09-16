/**
 * 全局键盘快捷键
 * 在应用级别监听键盘事件，提供常用操作的快捷键支持。
 * 仅在非输入元素上触发，避免与文本输入冲突。
 */

import { useUiStore } from '@/stores/uiStore'
import { useTaskStore } from '@/stores/taskStore'

/** 检查当前焦点是否在输入元素上 */
function isInputElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
    el.isContentEditable || el.closest('.n-input') !== null ||
    el.closest('.n-select') !== null
}

export function useKeyboardShortcuts() {
  const uiStore = useUiStore()
  const taskStore = useTaskStore()

  function handleKeyDown(event: KeyboardEvent) {
    // 输入元素中不拦截快捷键
    if (isInputElement(event.target)) return

    // Ctrl/Cmd + N: 新建下载
    if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
      event.preventDefault()
      uiStore.openNewTask()
      return
    }

    // Ctrl/Cmd + ,: 打开设置
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault()
      uiStore.openSettings()
      return
    }

    // Ctrl/Cmd + F: 聚焦搜索框
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault()
      const searchInput = document.querySelector('.task-actions .n-input input') as HTMLInputElement
      if (searchInput) {
        searchInput.focus()
        searchInput.select()
      }
      return
    }

    // Ctrl/Cmd + Shift + P: 暂停全部
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'P') {
      event.preventDefault()
      void taskStore.pauseAllTasks()
      return
    }

    // Ctrl/Cmd + Shift + R: 恢复全部
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'R') {
      event.preventDefault()
      void taskStore.unpauseAllTasks()
      return
    }

    // Escape: 关闭当前弹窗（优先级：新建 > 设置 > 连接 > 任务详情 > 更新）
    if (event.key === 'Escape') {
      if (uiStore.showNewTask) { uiStore.closeNewTask(); return }
      if (uiStore.showSettings) { uiStore.closeSettings(); return }
      if (uiStore.showTaskDetail) { uiStore.closeTaskDetail(); return }
      if (uiStore.showUpdateDialog) { uiStore.closeUpdateDialog(); return }
    }
  }

  function start() {
    document.addEventListener('keydown', handleKeyDown)
  }

  function stop() {
    document.removeEventListener('keydown', handleKeyDown)
  }

  return { start, stop }
}
