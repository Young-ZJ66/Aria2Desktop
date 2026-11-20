import { describe, expect, it, vi } from 'vitest'
import { applyDocumentDirection, isRtlLocale, useDirection } from './useDirection'

// vue-i18n 的 useI18n 只能在组件 setup 里用，这里用一个真正的 ref 顶替：
// watch 只对响应式来源生效，普通对象 { value } 改了不会触发回调。
const state = vi.hoisted(() => ({ locale: undefined as unknown }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: state.locale }) }))

function fakeRoot() {
  return { lang: '', dir: '', dataset: {} as Record<string, string | undefined> }
}

describe('isRtlLocale', () => {
  it('只有阿拉伯语是从右到左', () => {
    expect(isRtlLocale('ar-SA')).toBe(true)
  })

  it('其余语言（含简体中文、英文、希伯来语未收录）一律从左到右', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU', 'hi-IN']) {
      expect(isRtlLocale(locale)).toBe(false)
    }
    expect(isRtlLocale('he-IL')).toBe(false)
    expect(isRtlLocale('')).toBe(false)
  })
})

describe('applyDocumentDirection', () => {
  it('阿拉伯语写 rtl，并把 lang/dir/data-dir 三处一起写上', () => {
    const root = fakeRoot()
    expect(applyDocumentDirection('ar-SA', root)).toBe('rtl')
    expect(root).toEqual({ lang: 'ar-SA', dir: 'rtl', dataset: { dir: 'rtl' } })
  })

  it('从 rtl 切回中文时三个属性都回到 ltr（不留残值）', () => {
    const root = fakeRoot()
    applyDocumentDirection('ar-SA', root)
    expect(applyDocumentDirection('zh-CN', root)).toBe('ltr')
    expect(root.lang).toBe('zh-CN')
    expect(root.dir).toBe('ltr')
    expect(root.dataset.dir).toBe('ltr')
  })

  it('没有根元素时只返回方向，不抛错（node 环境无 DOM）', () => {
    expect(applyDocumentDirection('ar-SA', null)).toBe('rtl')
    expect(applyDocumentDirection('en-US', null)).toBe('ltr')
  })
})

describe('useDirection', () => {
  it('初始方向跟随当前语言，切换语言后 computed 与 <html> 同步更新', async () => {
    const { ref, nextTick } = await import('vue')
    const localeRef = ref('zh-CN')
    state.locale = localeRef
    const root = fakeRoot()
    // 把默认根元素指到假对象上：useDirection 内部调用 applyDocumentDirection 时取默认参数
    const previousDocument = (globalThis as { document?: unknown }).document
    ;(globalThis as { document?: unknown }).document = { documentElement: root }
    try {
      const { dir, isRtl } = useDirection()
      expect(dir.value).toBe('ltr')
      expect(isRtl.value).toBe(false)
      // immediate: true，所以挂上时就已经写过一次
      expect(root.dir).toBe('ltr')
      localeRef.value = 'ar-SA'
      await nextTick()
      expect(dir.value).toBe('rtl')
      expect(isRtl.value).toBe(true)
      expect(root.dir).toBe('rtl')
      expect(root.lang).toBe('ar-SA')
      expect(root.dataset.dir).toBe('rtl')
    } finally {
      ;(globalThis as { document?: unknown }).document = previousDocument
    }
  })
})
