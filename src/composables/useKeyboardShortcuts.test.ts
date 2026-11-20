import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 全局快捷键。
 *
 * 最容易出问题的是「优先级」和「输入框豁免」：
 * - 在输入框里按 Ctrl+N 必须让浏览器/输入法处理，不能抢走；
 * - Esc 一次只关最上层弹窗（新建 > 设置 > 详情 > 更新），不能一口气全关；
 * - 「暂停全部」必须连流媒体任务一起暂停，否则名不副实（D-10）。
 */
const ui = vi.hoisted(() => ({
  openNewTask: vi.fn(),
  openSettings: vi.fn(),
  requestCloseSettings: vi.fn(),
  closeNewTask: vi.fn(),
  closeTaskDetail: vi.fn(),
  closeUpdateDialog: vi.fn(),
  showNewTask: false,
  showSettings: false,
  showTaskDetail: false,
  showUpdateDialog: false
}))
const pauseAllTasks = vi.hoisted(() => vi.fn())
const unpauseAllTasks = vi.hoisted(() => vi.fn())
const streamPauseAll = vi.hoisted(() => vi.fn())
const streamResumeAll = vi.hoisted(() => vi.fn())

vi.mock('@/stores/uiStore', () => ({ useUiStore: () => ui }))
vi.mock('@/stores/taskStore', () => ({ useTaskStore: () => ({ pauseAllTasks, unpauseAllTasks }) }))
vi.mock('@/stores/streamTaskStore', () => ({
  useStreamTaskStore: () => ({ pauseAllTasks: streamPauseAll, resumeAllTasks: streamResumeAll })
}))

import { useKeyboardShortcuts } from './useKeyboardShortcuts'

class FakeElement {
  tagName: string
  isContentEditable = false
  constructor(tagName: string) { this.tagName = tagName }
  closest(): FakeElement | null { return null }
}

interface FakeDoc {
  handlers: Map<string, (event: KeyboardEvent) => void>
  addEventListener: (type: string, handler: (event: KeyboardEvent) => void) => void
  removeEventListener: (type: string) => void
  querySelector: (selector: string) => unknown
}

let doc: FakeDoc
let searchInput: { focused: boolean, selected: boolean, focus: () => void, select: () => void }

function resetUi(): void {
  Object.assign(ui, {
    showNewTask: false,
    showSettings: false,
    showTaskDetail: false,
    showUpdateDialog: false
  })
  for (const key of ['openNewTask', 'openSettings', 'requestCloseSettings', 'closeNewTask', 'closeTaskDetail', 'closeUpdateDialog'] as const) {
    ui[key].mockClear()
  }
}

beforeEach(() => {
  resetUi()
  pauseAllTasks.mockClear()
  unpauseAllTasks.mockClear()
  streamPauseAll.mockClear()
  streamResumeAll.mockClear()
  searchInput = {
    focused: false,
    selected: false,
    focus() { searchInput.focused = true },
    select() { searchInput.selected = true }
  }
  doc = {
    handlers: new Map(),
    addEventListener(type, handler) { doc.handlers.set(type, handler) },
    removeEventListener(type) { doc.handlers.delete(type) },
    querySelector: () => searchInput
  }
  ;(globalThis as unknown as { document: unknown }).document = doc
  ;(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as unknown as { document?: unknown }).document
  delete (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement
})

type PressInit = Omit<Partial<KeyboardEvent>, 'target'> & { key: string, target?: unknown }

function press(init: PressInit): { prevented: boolean } {
  const shortcuts = useKeyboardShortcuts()
  shortcuts.start()
  let prevented = false
  const event = {
    key: init.key,
    ctrlKey: init.ctrlKey === true,
    metaKey: init.metaKey === true,
    shiftKey: init.shiftKey === true,
    target: (init.target ?? null) as EventTarget | null,
    preventDefault() { prevented = true }
  } as unknown as KeyboardEvent
  doc.handlers.get('keydown')?.(event)
  shortcuts.stop()
  return { prevented }
}

describe('组合键', () => {
  it('Ctrl+N 打开新建下载并阻止默认行为', () => {
    const { prevented } = press({ key: 'n', ctrlKey: true })
    expect(ui.openNewTask).toHaveBeenCalledTimes(1)
    expect(prevented).toBe(true)
  })

  it('Cmd+N（macOS）同样生效', () => {
    press({ key: 'n', metaKey: true })
    expect(ui.openNewTask).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+, 打开设置', () => {
    press({ key: ',', ctrlKey: true })
    expect(ui.openSettings).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+F 聚焦并全选搜索框', () => {
    press({ key: 'f', ctrlKey: true })
    expect(searchInput.focused).toBe(true)
    expect(searchInput.selected).toBe(true)
  })

  it('Ctrl+Shift+P 同时暂停 aria2 与流媒体任务（D-10）', () => {
    press({ key: 'P', ctrlKey: true, shiftKey: true })
    expect(pauseAllTasks).toHaveBeenCalledTimes(1)
    expect(streamPauseAll).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Shift+R 同时恢复两边', () => {
    press({ key: 'R', ctrlKey: true, shiftKey: true })
    expect(unpauseAllTasks).toHaveBeenCalledTimes(1)
    expect(streamResumeAll).toHaveBeenCalledTimes(1)
  })
})

describe('输入框豁免', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('%s 里的按键不拦截', (tag) => {
    const { prevented } = press({ key: 'n', ctrlKey: true, target: new FakeElement(tag) })
    expect(ui.openNewTask).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  it('contenteditable 元素里的按键不拦截', () => {
    const editable = new FakeElement('DIV')
    editable.isContentEditable = true
    press({ key: 'n', ctrlKey: true, target: editable })
    expect(ui.openNewTask).not.toHaveBeenCalled()
  })

  it('非元素目标（如 document）照常响应', () => {
    press({ key: 'n', ctrlKey: true, target: { tagName: 'DIV' } })
    expect(ui.openNewTask).toHaveBeenCalledTimes(1)
  })
})

describe('Esc 的关闭优先级', () => {
  it('新建弹窗在最上层时只关它', () => {
    ui.showNewTask = true
    ui.showSettings = true
    press({ key: 'Escape' })
    expect(ui.closeNewTask).toHaveBeenCalledTimes(1)
    expect(ui.requestCloseSettings).not.toHaveBeenCalled()
  })

  it('没有新建弹窗时关设置（走脏页守卫，不直接关）', () => {
    ui.showSettings = true
    press({ key: 'Escape' })
    expect(ui.requestCloseSettings).toHaveBeenCalledTimes(1)
  })

  it('再往下依次是任务详情与更新弹窗', () => {
    ui.showTaskDetail = true
    press({ key: 'Escape' })
    expect(ui.closeTaskDetail).toHaveBeenCalledTimes(1)
    resetUi()
    ui.showUpdateDialog = true
    press({ key: 'Escape' })
    expect(ui.closeUpdateDialog).toHaveBeenCalledTimes(1)
  })

  it('没有任何弹窗时 Esc 什么都不做', () => {
    press({ key: 'Escape' })
    expect(ui.closeNewTask).not.toHaveBeenCalled()
    expect(ui.requestCloseSettings).not.toHaveBeenCalled()
    expect(ui.closeTaskDetail).not.toHaveBeenCalled()
    expect(ui.closeUpdateDialog).not.toHaveBeenCalled()
  })
})

describe('监听生命周期', () => {
  it('start 注册 keydown，stop 摘掉', () => {
    const shortcuts = useKeyboardShortcuts()
    shortcuts.start()
    expect(doc.handlers.has('keydown')).toBe(true)
    shortcuts.stop()
    expect(doc.handlers.has('keydown')).toBe(false)
  })
})
