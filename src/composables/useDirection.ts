/**
 * 文字方向（LTR / RTL）同步。
 *
 * 背景：阿拉伯语（ar-SA）语言包早就存在，但仓库里此前没有任何方向适配。
 * src/i18n/index.ts 的 syncDocumentLang 只负责把 <html lang> 与 <html dir> 写上，
 * 而组件样式里的 margin-left / border-right / left: 0 全是按 LTR 写死的：
 * 选中阿拉伯语时侧边栏描边、开关滑块、激活指示条会停在错误的一侧。
 *
 * 这里负责「方向状态」这一层，镜像样式本体在 src/styles/rtl.css：
 *   1. 把方向同时写到 <html> 的 lang / dir / data-dir 三个属性上；
 *   2. 暴露 useDirection() 供组件读取（例如图表要把图例挪到另一侧）。
 *
 * 为什么还要自己写一次 dir：i18n 的 syncDocumentLang 只在初始化与 setLocale() 里调用，
 * 而方向还可能被别的入口改动（主进程推送语言、测试直接改 locale ref）。
 * 这里以 i18n 的当前 locale 为唯一事实来源，重复写入是幂等的。
 */

import { computed, watch, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'

/** 文字方向 */
export type TextDirection = 'rtl' | 'ltr'

/**
 * 从右到左书写的语言白名单。
 *
 * 只列 ar-SA：其余 20 种语言都是从左到右。
 * 新增 RTL 语言（例如 he-IL、fa-IR）时只需在这里补一项，
 * src/styles/rtl.test.ts 会守住「白名单之外的语言一律 LTR」这条不变式。
 */
const RTL_LOCALES: ReadonlySet<string> = new Set(['ar-SA'])

/** 该语言是否从右到左书写 */
export function isRtlLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale)
}

/**
 * 需要写入方向属性的根元素。
 *
 * 不直接依赖 HTMLElement：单元测试跑在 node 环境（无 DOM），
 * 用一个最小结构即可验证写入行为。
 */
export interface DirectionRoot {
  lang: string
  dir: string
  dataset: Record<string, string | undefined>
}

function defaultDirectionRoot(): DirectionRoot | null {
  if (typeof document === 'undefined') return null
  return document.documentElement
}

/**
 * 把语言对应的方向写到根元素。
 *
 * 返回实际方向，便于调用方（以及测试）在无 DOM 环境下拿到结果。
 */
export function applyDocumentDirection(
  locale: string,
  root: DirectionRoot | null = defaultDirectionRoot()
): TextDirection {
  const dir: TextDirection = isRtlLocale(locale) ? 'rtl' : 'ltr'
  if (!root) return dir
  root.lang = locale
  root.dir = dir
  // data-dir 与 dir 同值：CSS 里用 [dir='rtl'] 选择即可，这里多留一份给脚本与调试面板
  root.dataset.dir = dir
  return dir
}

/**
 * 组件内使用：拿到当前方向，并在语言切换时保持 <html> 同步。
 *
 * 必须在 setup() 中调用（内部用了 useI18n 与 watch）。
 */
export function useDirection(): { dir: ComputedRef<TextDirection>; isRtl: ComputedRef<boolean> } {
  const { locale } = useI18n()
  const dir = computed<TextDirection>(() => (isRtlLocale(String(locale.value)) ? 'rtl' : 'ltr'))
  watch(locale, (value) => {
    applyDocumentDirection(String(value))
  }, { immediate: true })
  return {
    dir,
    isRtl: computed(() => dir.value === 'rtl')
  }
}
