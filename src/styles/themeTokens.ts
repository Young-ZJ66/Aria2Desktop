/**
 * Naive UI 主题覆盖的单一事实来源。
 *
 * 此前 useThemeManager 与 utils/feedback.ts 各自维护一份主色/圆角常量，
 * 修改主题色需同步两处。现统一由本文件导出：
 * - THEME_TOKENS：深浅色主色与圆角
 * - buildThemeOverrides(isDark)：直接生成 GlobalThemeOverrides
 */
import type { GlobalThemeOverrides } from 'naive-ui'

export const THEME_TOKENS = {
  light: {
    // 主色取 #4560e0 而非更亮的 #4f6ef2：后者在白色与选中底色(#f0f4ff)上
    // 分别只有 4.33 / 3.94 的对比度，低于 WCAG AA 的 4.5，而主色被用在
    // 侧边栏当前项、页签标签、蓝底白字主按钮上，覆盖面积很大。
    // #4560e0 在白底 5.25、#f0f4ff 上 4.77、#f6f7f9 上 4.89，全部达标。
    primaryColor: '#4560e0',
    primaryColorHover: '#5a74e6',
    primaryColorPressed: '#3750c4',
    primaryColorSuppl: '#4560e0'
  },
  dark: {
    primaryColor: '#6c86f5',
    primaryColorHover: '#8499f7',
    primaryColorPressed: '#5465d8',
    primaryColorSuppl: '#6c86f5'
  },
  borderRadius: '8px',
  cardBorderRadius: '10px',
  /** 默认（无 type）按钮的底色：浅色主题白底，深色主题用比页面略亮的表面色 */
  buttonSurface: {
    light: { color: '#ffffff', colorHover: '#ffffff', colorPressed: '#eef2ff', colorFocus: '#ffffff' },
    dark: { color: '#1e222b', colorHover: '#1e222b', colorPressed: '#262b36', colorFocus: '#1e222b' }
  },
  /**
   * 文字类弱化色。naive 默认的 placeholderColor / textColorDisabled 是
   * neutral(alpha4) ≈ rgb(194,194,194)，白底上只有 1.78:1，
   * 输入框占位符与空态说明基本看不清。这里统一提到 4.8:1 以上。
   */
  textMuted: {
    light: '#6b7280',
    dark: '#8b93a5'
  },
  /**
   * 语义色（tag 文字、状态文字等）的 AA 版本。
   * naive 默认的 success #18a058 在白底 3.38:1、在自己 10% 淡色底上只有 3.04:1；
   * warning #f0a020 更差（白底 2.15、淡底 2.01）。这些值用在 tag 文字上必须提深。
   * 数字来自对实际淡色底（10% 混白）的实测对比度。
   */
  semanticText: {
    light: {
      success: '#15803d',
      warning: '#b45309',
      error: '#c81e1e',
      info: '#1d4ed8'
    },
    dark: {
      success: '#63e2b7',
      warning: '#f2c97d',
      error: '#ff8b8b',
      info: '#8ab4f8'
    }
  }
} as const

export function buildThemeOverrides(isDark: boolean): GlobalThemeOverrides {
  const tokens = isDark ? THEME_TOKENS.dark : THEME_TOKENS.light
  const surface = isDark ? THEME_TOKENS.buttonSurface.dark : THEME_TOKENS.buttonSurface.light
  const muted = isDark ? THEME_TOKENS.textMuted.dark : THEME_TOKENS.textMuted.light
  const semantic = isDark ? THEME_TOKENS.semanticText.dark : THEME_TOKENS.semanticText.light
  return {
    common: {
      primaryColor: tokens.primaryColor,
      primaryColorHover: tokens.primaryColorHover,
      primaryColorPressed: tokens.primaryColorPressed,
      primaryColorSuppl: tokens.primaryColorSuppl,
      borderRadius: THEME_TOKENS.borderRadius,
      // 弱化文字统一提到 AA：占位符、禁用态文字、空态说明都吃这个值。
      // naive 默认 neutral(alpha4)≈rgb(194,194,194)，白底仅 1.78:1。
      placeholderColor: muted,
      placeholderColorDisabled: muted,
      textColorDisabled: muted,
      // textColor3 是 tag/统计标签等使用的次级正文色，naive 默认 rgb(118,124,130)，
      // 在卡片底色上只有 4.2 左右，统一到 muted（白底 4.83）
      textColor3: muted
    },
    Card: { borderRadius: THEME_TOKENS.cardBorderRadius },
    // 默认按钮（无 type）改为实心表面色：Naive UI 默认是透明底 + 灰边，
    // 在弹窗/卡片上会和背景混在一起，层级不清。文字与边框的 hover 反馈
    // 沿用 Naive UI 默认值（textColorHover / borderHover = 主色）。
    Button: {
      color: surface.color,
      colorHover: surface.colorHover,
      colorPressed: surface.colorPressed,
      colorFocus: surface.colorFocus
    },
    // 空态描述文字默认取 textColorDisabled（很淡），单列出来保证可读
    Empty: { textColor: muted },
    Input: { placeholderColor: muted },
    // Select 的占位层由 InternalSelection 渲染，用的是自身的 placeholderColor
    InternalSelection: { placeholderColor: muted },
    // 统计标签用 textColor3（比正文更淡），实测 4.22:1，提深到 muted
    Statistic: { labelTextColor: muted },
    // Tag 的语义文字：naive 直接用 successColor 当文字，在淡色底上只有 3.04:1
    Tag: {
      textColorSuccess: semantic.success,
      textColorWarning: semantic.warning,
      textColorError: semantic.error,
      textColorInfo: semantic.info
    }
  }
}
