import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyDocumentDirection, isRtlLocale } from '../composables/useDirection'

/**
 * RTL（从右到左）适配的护栏测试。
 *
 * 背景：ar-SA 语言包早就在，但此前没有任何方向适配——选阿拉伯语后侧边栏描边、
 * 开关滑块、激活指示条全停在 LTR 的一侧。这类问题在中文/英文环境下永远看不见，
 * 只能靠测试守住两条不变式：
 *   1. 方向判定只认白名单，其它 20 种语言必须是 LTR；
 *   2. 镜像样式表必须真的覆盖到那些写死方向的组件，且不能混进 Vue 的 :deep()。
 */

const cssPath = fileURLToPath(new URL('./rtl.css', import.meta.url))
// Windows 的 checkout 可能把文件换成 CRLF，比较前统一行尾
const css = readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n')

/** 极简根元素替身：node 环境没有 document，用它验证写入行为 */
function fakeRoot(): { lang: string; dir: string; dataset: Record<string, string | undefined> } {
  return { lang: '', dir: '', dataset: {} }
}

describe('文字方向', () => {
  it('只有阿拉伯语是 RTL，其它语言都是 LTR', () => {
    expect(isRtlLocale('ar-SA')).toBe(true)
    for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES',
      'pt-BR', 'it-IT', 'ru-RU', 'hi-IN', 'th-TH', 'vi-VN', 'id-ID', 'tr-TR', 'nl-NL', 'pl-PL',
      'uk-UA', 'cs-CZ']) {
      expect(isRtlLocale(locale), locale).toBe(false)
    }
  })

  it('阿拉伯语写入 dir="rtl"，并同步 lang 与 data-dir', () => {
    const root = fakeRoot()
    expect(applyDocumentDirection('ar-SA', root)).toBe('rtl')
    expect(root.dir).toBe('rtl')
    expect(root.lang).toBe('ar-SA')
    expect(root.dataset.dir).toBe('rtl')
  })

  it('切回从左到右的语言时把 dir 改回 ltr（不能残留 rtl）', () => {
    const root = fakeRoot()
    applyDocumentDirection('ar-SA', root)
    expect(applyDocumentDirection('en-US', root)).toBe('ltr')
    expect(root.dir).toBe('ltr')
    expect(root.lang).toBe('en-US')
    expect(root.dataset.dir).toBe('ltr')
  })

  it('没有 DOM 时只返回方向，不抛错', () => {
    expect(applyDocumentDirection('ar-SA', null)).toBe('rtl')
    expect(applyDocumentDirection('zh-CN', null)).toBe('ltr')
  })
})

describe('RTL 镜像样式', () => {
  it('所有规则都以 html[dir=rtl] 前缀限定，不影响 LTR', () => {
    // 逐条检查选择器：去掉注释后按 { } 切块，每条选择器都必须以 html[dir='rtl'] 开头
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors: string[] = []
    for (const block of withoutComments.split('}')) {
      const head = block.split('{')[0]?.trim()
      if (!head) continue
      selectors.push(...head.split(',').map((part) => part.trim()).filter(Boolean))
    }
    expect(selectors.length).toBeGreaterThan(20)
    const offenders = selectors.filter((selector) => !selector.startsWith("html[dir='rtl']"))
    expect(offenders).toEqual([])
  })

  it('没有混进 Vue 的 :deep()（全局样式表不会被 SFC 编译器处理）', () => {
    // 只看规则体：文件头注释里会提到 :deep() 这个词，不算违规
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments.includes(':deep(')).toBe(false)
  })

  it('花括号配对，不会截断后续样式', () => {
    const open = (css.match(/\{/g) ?? []).length
    const close = (css.match(/\}/g) ?? []).length
    expect(open).toBe(close)
  })

  it('覆盖了写死方向的关键组件', () => {
    // 每个条目对应一处 LTR 硬编码：缺了它，对应组件在阿拉伯语下就会错位
    const required = [
      '.sidebar',               // AppSidebar 的 border-right
      '.nav-item.is-active',    // 侧栏激活指示条的 left: 0
      '.nav-item__dot',         // 未读小圆点的 right: 9px
      '.settings-search-panel', // 搜索面板的 left: 0 / right: auto
      '.notification-item',     // 通知行的 text-align: left 与左侧 36px 内边距
      '.notification-delete',   // 删除按钮的 right: 8px
      '.trash-hint',            // 删除对话框的 padding-left: 24px
      '.dialog-footer',         // 对话框底栏的 text-align: right
      '.progress-text',         // 任务进度的 text-align: right
      '.stat-cell',             // 指标带的分隔线 border-left
      '.queue-table',           // 队列表头的 text-align: left
      '.instance-note',         // 实例备注的 border-left
      '.plugin-hint',           // 插件提示的 border-left
      '.mcp-copy-btn',          // 复制按钮的 right: 6px
      '.app-switch__knob'       // 开关滑块的 left 定位
    ]
    for (const selector of required) {
      expect(css.includes(selector), selector).toBe(true)
    }
  })
})
