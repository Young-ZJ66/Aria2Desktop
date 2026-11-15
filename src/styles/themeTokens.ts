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
    primaryColor: '#4f6ef2',
    primaryColorHover: '#6279f4',
    primaryColorPressed: '#3d56d0',
    primaryColorSuppl: '#4f6ef2'
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
  }
} as const

export function buildThemeOverrides(isDark: boolean): GlobalThemeOverrides {
  const tokens = isDark ? THEME_TOKENS.dark : THEME_TOKENS.light
  const surface = isDark ? THEME_TOKENS.buttonSurface.dark : THEME_TOKENS.buttonSurface.light
  return {
    common: {
      primaryColor: tokens.primaryColor,
      primaryColorHover: tokens.primaryColorHover,
      primaryColorPressed: tokens.primaryColorPressed,
      primaryColorSuppl: tokens.primaryColorSuppl,
      borderRadius: THEME_TOKENS.borderRadius
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
    }
  }
}
