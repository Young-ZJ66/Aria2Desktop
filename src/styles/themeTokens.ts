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
  cardBorderRadius: '10px'
} as const

export function buildThemeOverrides(isDark: boolean): GlobalThemeOverrides {
  const tokens = isDark ? THEME_TOKENS.dark : THEME_TOKENS.light
  return {
    common: {
      primaryColor: tokens.primaryColor,
      primaryColorHover: tokens.primaryColorHover,
      primaryColorPressed: tokens.primaryColorPressed,
      primaryColorSuppl: tokens.primaryColorSuppl,
      borderRadius: THEME_TOKENS.borderRadius
    },
    Card: { borderRadius: THEME_TOKENS.cardBorderRadius }
  }
}
