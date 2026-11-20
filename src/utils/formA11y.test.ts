import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 用最小假 DOM 驱动 formA11y。真实项目没装 happy-dom，而 formA11y 只用到
 * querySelector/querySelectorAll/hasAttribute/setAttribute/matches/instanceof HTMLElement，
 * 这些都能用下面的 FakeElement 精确复现——同时把传进来的选择器记下来，
 * 顺带守住「控件选择器必须覆盖输入框、文本域、下拉、开关、复选框、单选框」。
 */
class FakeElement {
  nodeType = 1
  id = ''
  textContent = ''
  matchesItem = false
  attributes = new Map<string, string>()
  label: FakeElement | null = null
  control: FakeElement | null = null
  optionBoxes: FakeElement[] = []
  scanned: FakeElement[] = []
  seen: string[] = []

  querySelector(selector: string): FakeElement | null {
    this.seen.push(selector)
    if (selector.includes('n-checkbox__label')) return this.label
    if (selector.includes('n-form-item-label')) return this.label
    if (selector.includes('input:not')) return this.control
    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    this.seen.push(selector)
    if (selector.includes('role="checkbox"')) return this.optionBoxes
    if (selector === '.n-form-item') return this.scanned
    return []
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  matches(selector: string): boolean {
    return selector === '.n-form-item' && this.matchesItem
  }
}

class FakeObserver {
  static instances: FakeObserver[] = []
  callback: (records: Array<{ addedNodes: unknown[] }>) => void
  observed: unknown = null
  options: unknown = null

  constructor(callback: (records: Array<{ addedNodes: unknown[] }>) => void) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }

  observe(target: unknown, options: unknown): void {
    this.observed = target
    this.options = options
  }
}

const state = {
  docItems: [] as FakeElement[],
  docScanCount: 0,
  hasDocument: true
}

function installGlobals(hasDocument = true) {
  state.hasDocument = hasDocument
  vi.stubGlobal('Node', { ELEMENT_NODE: 1 })
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('MutationObserver', FakeObserver)
  if (!hasDocument) {
    vi.stubGlobal('document', undefined)
    return
  }
  vi.stubGlobal('document', {
    body: {},
    querySelectorAll: (selector: string) => {
      state.docScanCount += 1
      return selector === '.n-form-item' ? state.docItems : []
    }
  })
}

async function loadFormA11y() {
  vi.resetModules()
  return import('./formA11y')
}

function makeControl(): FakeElement {
  const control = new FakeElement()
  control.attributes.set('data-control', '1')
  return control
}

function makeItem(options: { label?: boolean, control?: boolean } = {}): FakeElement {
  const item = new FakeElement()
  if (options.label !== false) {
    const label = new FakeElement()
    label.textContent = '下载目录'
    item.label = label
  }
  if (options.control !== false) item.control = makeControl()
  return item
}

function makeOptionBox(text: string): FakeElement {
  const box = new FakeElement()
  const boxLabel = new FakeElement()
  boxLabel.textContent = text
  box.label = boxLabel
  return box
}

beforeEach(() => {
  state.docItems = []
  state.docScanCount = 0
  FakeObserver.instances = []
  installGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('安装与扫描', () => {
  it('安装时补全文档里已有的表单项', async () => {
    const item = makeItem()
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(item.label?.id).toBe('a11y-form-label-1')
    expect(item.control?.attributes.get('aria-labelledby')).toBe('a11y-form-label-1')
  })

  it('重复安装不会重复扫描（幂等）', async () => {
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    installFormA11y()
    expect(state.docScanCount).toBe(1)
    expect(FakeObserver.instances).toHaveLength(1)
  })

  it('没有 document 时安静返回，不注册观察器', async () => {
    installGlobals(false)
    const { installFormA11y } = await loadFormA11y()
    expect(() => installFormA11y()).not.toThrow()
    expect(FakeObserver.instances).toHaveLength(0)
  })

  it('观察器监听 body 的子树新增', async () => {
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    const observer = FakeObserver.instances[0]
    expect(observer.options).toEqual({ childList: true, subtree: true })
    expect(observer.observed).toBeTruthy()
  })
})

describe('单字段命名', () => {
  it('标签已有 id 时复用，不覆盖', async () => {
    const item = makeItem()
    if (item.label) item.label.id = 'custom-label'
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(item.label?.id).toBe('custom-label')
    expect(item.control?.attributes.get('aria-labelledby')).toBe('custom-label')
  })

  it('控件已有 aria-label 时不覆盖（尊重显式命名）', async () => {
    const item = makeItem()
    item.control?.attributes.set('aria-label', '自定义名称')
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(item.control?.attributes.get('aria-label')).toBe('自定义名称')
    expect(item.control?.attributes.has('aria-labelledby')).toBe(false)
  })

  it('控件已有 aria-labelledby 时不覆盖', async () => {
    const item = makeItem()
    item.control?.attributes.set('aria-labelledby', 'existing')
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(item.control?.attributes.get('aria-labelledby')).toBe('existing')
  })

  it('没有标签的项跳过（不生成空命名）', async () => {
    const item = makeItem({ label: false })
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(item.control?.attributes.has('aria-labelledby')).toBe(false)
  })

  it('没有控件的项只给标签补 id，不抛错', async () => {
    const item = makeItem({ control: false })
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    expect(() => installFormA11y()).not.toThrow()
    expect(item.label?.id).toBe('a11y-form-label-1')
  })

  it('多个表单项生成的 id 互不相同', async () => {
    const first = makeItem()
    const second = makeItem()
    state.docItems = [first, second]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(first.label?.id).toBe('a11y-form-label-1')
    expect(second.label?.id).toBe('a11y-form-label-2')
  })

  it('控件选择器覆盖输入框、文本域、下拉、开关、复选框与单选框', async () => {
    const item = makeItem()
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    const controlSelector = item.seen.find((selector) => selector.includes('input:not')) || ''
    const parts = ['input:not([type="hidden"])', 'textarea', 'select', '[role="switch"]', '[role="checkbox"]', '[role="radio"]']
    const missing = parts.filter((part) => !controlSelector.includes(part))
    expect(missing).toEqual([])
    expect(controlSelector.length).toBeGreaterThan(0)
  })
})

describe('复选框/单选框组', () => {
  it('每一项用自己的文案命名，而不是全部指向字段名', async () => {
    const item = makeItem({ control: false })
    const first = makeOptionBox('官方来源')
    const second = makeOptionBox('镜像来源')
    item.optionBoxes = [first, second]
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(first.attributes.get('aria-labelledby')).toBe('a11y-form-option-2')
    expect(second.attributes.get('aria-labelledby')).toBe('a11y-form-option-3')
    expect(first.label?.id).not.toBe(second.label?.id)
  })

  it('已有 aria-label 的选项跳过', async () => {
    const item = makeItem({ control: false })
    const box = makeOptionBox('官方来源')
    box.attributes.set('aria-label', '已有名称')
    item.optionBoxes = [box]
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(box.attributes.has('aria-labelledby')).toBe(false)
  })

  it('文案为空白的选项跳过', async () => {
    const item = makeItem({ control: false })
    const box = makeOptionBox('   ')
    item.optionBoxes = [box]
    state.docItems = [item]
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    expect(box.attributes.has('aria-labelledby')).toBe(false)
  })
})

describe('动态渲染兜底', () => {
  it('新增元素节点会被扫描', async () => {
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    const later = makeItem()
    later.scanned = [later]
    FakeObserver.instances[0].callback([{ addedNodes: [later] }])
    expect(later.label?.id).toBe('a11y-form-label-1')
    expect(later.control?.attributes.get('aria-labelledby')).toBe('a11y-form-label-1')
  })

  it('新增节点本身是表单项时直接处理（不依赖子查询）', async () => {
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    const later = makeItem()
    later.matchesItem = true
    FakeObserver.instances[0].callback([{ addedNodes: [later] }])
    expect(later.label?.id).toBe('a11y-form-label-1')
  })

  it('文本节点等非元素节点被忽略且不抛错', async () => {
    const { installFormA11y } = await loadFormA11y()
    installFormA11y()
    const textNode = { nodeType: 3 }
    expect(() => FakeObserver.instances[0].callback([{ addedNodes: [textNode] }])).not.toThrow()
  })
})
