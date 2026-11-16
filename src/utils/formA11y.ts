/**
 * 表单可访问名称补全。
 *
 * 背景：naive-ui 的 `n-form-item` 只把字段名渲染成 `<label class="n-form-item-label">`，
 * 但没有生成 `for`/`id` 关联，读屏软件聚焦输入框时读不到字段名（WCAG 4.1.2 名称、角色、值）。
 * 项目里设置页有上百个字段，逐个加 `aria-label` 既啰嗦又容易漏；这里在应用挂载后统一补
 * `aria-labelledby`：给标签生成 id，再把同一个 form-item 内第一个可交互控件指过去。
 *
 * 标签文字会随语言切换变化，但 `aria-labelledby` 指向的是同一个元素，文字更新后自动生效；
 * 动态渲染（切页签、打开弹窗、懒加载）由 MutationObserver 兜底。
 */

let labelSeq = 0

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE
}

function enhanceFormItem(item: Element): void {
  if (!(item instanceof HTMLElement)) return
  const label = item.querySelector(':scope > .n-form-item-label')
  if (!(label instanceof HTMLElement)) return
  if (!label.id) label.id = `a11y-form-label-${++labelSeq}`

  // 复选框/单选框组：一个 form-item 里常有多项，每一项都应该用自己的文案命名，
  // 不能全部指向字段名（否则读屏逐个读出来都是「官方来源」）。
  item.querySelectorAll(':scope > .n-form-item-blank [role="checkbox"], :scope > .n-form-item-blank [role="radio"]').forEach((box) => {
    if (box.hasAttribute('aria-label') || box.hasAttribute('aria-labelledby')) return
    const boxLabel = box.querySelector(':scope > .n-checkbox__label, :scope > .n-radio__label')
    if (boxLabel instanceof HTMLElement && (boxLabel.textContent || '').trim()) {
      if (!boxLabel.id) boxLabel.id = `a11y-form-option-${++labelSeq}`
      box.setAttribute('aria-labelledby', boxLabel.id)
    }
  })

  const control = item.querySelector<HTMLElement>(
    ':scope > .n-form-item-blank input:not([type="hidden"]), ' +
      ':scope > .n-form-item-blank textarea, ' +
      ':scope > .n-form-item-blank select, ' +
      ':scope > .n-form-item-blank [role="switch"], ' +
      ':scope > .n-form-item-blank [role="checkbox"], ' +
      ':scope > .n-form-item-blank [role="radio"]'
  )
  if (!control) return
  // 已有显式名称就不覆盖（有些控件会自己传 aria-label）
  if (control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby')) return
  control.setAttribute('aria-labelledby', label.id)
}

function scan(root: ParentNode): void {
  if (isElement(root) && root.matches('.n-form-item')) enhanceFormItem(root)
  root.querySelectorAll?.('.n-form-item').forEach(enhanceFormItem)
}

let installed = false

export function installFormA11y(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  scan(document)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (isElement(node)) scan(node)
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
