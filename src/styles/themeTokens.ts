/**
 * Naive UI 主题覆盖 —— 由设计系统角色「投影」生成，不再手写色值清单。
 *
 * v1 的问题是这里的键名与 --ds-* 变量各自维护：改一次主色要动两处，深色还要再来一遍。
 * v2 只做一件事：把 designSystem 里的角色映射到 naive 的键上，深浅色共用同一段逻辑。
 */
import type { GlobalThemeOverrides } from 'naive-ui'
import { roles, radius, control, font, fontWeight } from './designSystem'

export function buildThemeOverrides(isDark: boolean): GlobalThemeOverrides {
  const r = isDark ? roles.dark : roles.light
  return {
    common: {
      // 品牌与状态色
      primaryColor: r.accent,
      primaryColorHover: r.accentHover,
      primaryColorPressed: r.accentPressed,
      primaryColorSuppl: r.accent,
      successColor: r.success.solid,
      warningColor: r.warning.solid,
      errorColor: r.danger.solid,
      infoColor: r.info.solid,
      // 文字
      textColorBase: r.textStrong,
      textColor1: r.textStrong,
      textColor2: r.textBase,
      textColor3: r.textMuted,
      textColorDisabled: r.textMuted,
      placeholderColor: r.textMuted,
      placeholderColorDisabled: r.textMuted,
      iconColor: r.textMuted,
      iconColorHover: r.textBase,
      iconColorPressed: r.textStrong,
      iconColorDisabled: r.textFaint,
      // 表面
      bodyColor: r.bgApp,
      cardColor: r.bgSurface,
      modalColor: r.bgRaised,
      popoverColor: r.bgRaised,
      tableColor: r.bgSurface,
      tableHeaderColor: r.bgSunken,
      inputColor: r.bgSurface,
      inputColorDisabled: r.bgSunken,
      tagColor: r.bgSunken,
      actionColor: r.bgSunken,
      hoverColor: r.bgHover,
      pressedColor: r.bgActive,
      // 描边
      borderColor: r.borderBase,
      dividerColor: r.borderSubtle,
      // 几何与字体
      borderRadius: radius.md,
      borderRadiusSmall: radius.sm,
      fontFamily: font.sans,
      fontFamilyMono: font.mono,
      fontSize: '13px',
      fontWeightStrong: '600',
      heightMedium: control.heightMd,
      heightLarge: control.heightLg,
      // 滚动条：与全局 ::-webkit-scrollbar 保持一致
      scrollbarColor: r.borderStrong,
      scrollbarColorHover: r.textFaint,
      scrollbarWidth: '10px',
      scrollbarHeight: '10px',
      scrollbarBorderRadius: radius.pill
    },
    Card: {
      color: r.bgSurface,
      borderColor: r.borderSubtle,
      borderRadius: radius.lg,
      titleFontSize: '16px',
      titleFontWeight: '600',
      paddingMedium: '20px'
    },
    Button: {
      borderRadiusTiny: radius.sm,
      borderRadiusSmall: radius.sm,
      borderRadiusMedium: radius.md,
      borderRadiusLarge: radius.md,
      heightTiny: '24px',
      heightSmall: '28px',
      heightMedium: '34px',
      heightLarge: '38px',
      fontWeight: '500',
      // 实心主按钮：底色 accent + 白字（深色主题的 accent 已按白字 4.96:1 校准）
      colorPrimary: r.accent,
      colorHoverPrimary: r.accentHover,
      colorPressedPrimary: r.accentPressed,
      colorFocusPrimary: r.accentHover,
      textColorPrimary: r.textOnAccent,
      textColorHoverPrimary: r.textOnAccent,
      textColorPressedPrimary: r.textOnAccent,
      textColorFocusPrimary: r.textOnAccent,
      borderPrimary: '1px solid ' + r.accent,
      borderHoverPrimary: '1px solid ' + r.accentHover,
      borderPressedPrimary: '1px solid ' + r.accentPressed,
      borderFocusPrimary: '1px solid ' + r.accentHover,
      // 默认按钮：实心表面色，不再透明（v1 遗留的有效决策，保留）
      color: r.bgSurface,
      colorHover: r.bgSurface,
      colorPressed: r.bgActive,
      colorFocus: r.bgSurface,
      textColor: r.textBase,
      textColorHover: r.textStrong,
      textColorPressed: r.textStrong,
      border: '1px solid ' + r.borderBase,
      borderHover: '1px solid ' + r.borderStrong,
      borderPressed: '1px solid ' + r.borderStrong,
      // 文字按钮用 accent-text：深色主题下它与实心按钮底不是同一个值
      textColorText: r.accentText,
      textColorTextHover: r.accentText,
      textColorTextPressed: r.accentText,
      textColorTextFocus: r.accentText,
      textColorGhost: r.accentText,
      textColorGhostHover: r.accentText
    },
    Input: {
      color: r.bgSurface,
      colorFocus: r.bgSurface,
      border: '1px solid ' + r.borderBase,
      borderHover: '1px solid ' + r.borderStrong,
      borderFocus: '1px solid ' + r.accent,
      boxShadowFocus: 'none',
      borderRadius: radius.md,
      heightMedium: control.heightMd,
      textColor: r.textStrong,
      placeholderColor: r.textMuted,
      caretColor: r.accent
    },
    InternalSelection: {
      color: r.bgSurface,
      colorActive: r.bgSurface,
      border: '1px solid ' + r.borderBase,
      borderHover: '1px solid ' + r.borderStrong,
      borderActive: '1px solid ' + r.accent,
      borderFocus: '1px solid ' + r.accent,
      boxShadowActive: 'none',
      boxShadowFocus: 'none',
      borderRadius: radius.md,
      heightMedium: control.heightMd,
      textColor: r.textStrong,
      placeholderColor: r.textMuted,
      arrowColor: r.textMuted
    },
    InternalSelectMenu: {
      color: r.bgRaised,
      optionTextColor: r.textBase,
      optionTextColorActive: r.accentText,
      optionColorPending: r.bgHover,
      optionColorActive: r.accentSubtle,
      optionCheckColor: r.accent,
      borderRadius: radius.lg
    },
    DataTable: {
      thColor: r.bgSunken,
      thColorHover: r.bgHover,
      thTextColor: r.textMuted,
      thFontWeight: '500',
      thPaddingMedium: '10px 12px',
      tdColor: r.bgSurface,
      tdColorHover: r.bgHover,
      tdColorStriped: r.bgSunken,
      tdTextColor: r.textBase,
      tdPaddingMedium: '10px 12px',
      borderColor: r.borderSubtle,
      borderRadius: radius.lg,
      fontSizeMedium: '13px'
    },
    Menu: {
      itemColorHover: r.bgHover,
      itemColorActive: r.accentSubtle,
      itemColorActiveHover: r.accentSubtle,
      itemTextColor: r.textBase,
      itemTextColorHover: r.textStrong,
      itemTextColorActive: r.accentText,
      itemTextColorActiveHover: r.accentText,
      itemIconColor: r.textMuted,
      itemIconColorActive: r.accentText,
      itemHeight: control.navItem,
      borderRadius: radius.md,
      fontSize: '13px'
    },
    Tabs: {
      tabTextColorActiveLine: r.accentText,
      tabTextColorHoverLine: r.accentText,
      tabTextColorActiveCard: r.accentText,
      tabTextColorHoverCard: r.accentText,
      barColor: r.accent,
      tabFontWeightActive: '600',
      tabFontSizeMedium: '13px'
    },
    Tag: {
      borderRadius: radius.sm,
      heightSmall: '22px',
      fontSizeSmall: '12px',
      // 语义文字色：naive 默认拿 successColor 当文字，在淡色底上只有 3.04:1
      textColorSuccess: r.success.text,
      textColorWarning: r.warning.text,
      textColorError: r.danger.text,
      textColorInfo: r.info.text,
      colorSuccess: r.success.subtle,
      colorWarning: r.warning.subtle,
      colorError: r.danger.subtle,
      colorInfo: r.info.subtle,
      borderSuccess: '1px solid transparent',
      borderWarning: '1px solid transparent',
      borderError: '1px solid transparent',
      borderInfo: '1px solid transparent'
    },
    Modal: {
      color: r.bgRaised,
      maskColor: r.bgOverlay,
      borderRadius: radius.xl,
      titleFontSize: '16px',
      titleFontWeight: '600',
      boxShadow: isDark ? '0 0 0 1px ' + r.borderBase + ', 0 24px 56px -16px rgba(0,0,0,0.78)' : '0 16px 40px -12px rgba(16,20,28,0.22)'
    },
    Dialog: {
      color: r.bgRaised,
      titleTextColor: r.textStrong,
      textColor: r.textBase,
      borderRadius: radius.xl,
      titleFontSize: '16px',
      titleFontWeight: '600'
    },
    Drawer: {
      color: r.bgRaised,
      boxShadow: isDark ? '-1px 0 0 ' + r.borderBase : '-1px 0 0 ' + r.borderSubtle
    },
    Dropdown: {
      color: r.bgRaised,
      optionTextColor: r.textBase,
      optionTextColorHover: r.textStrong,
      optionTextColorActive: r.accentText,
      optionColorHover: r.bgHover,
      borderRadius: radius.lg,
      boxShadow: isDark ? '0 0 0 1px ' + r.borderBase + ', 0 16px 40px -12px rgba(0,0,0,0.7)' : '0 12px 32px -8px rgba(16,20,28,0.18)'
    },
    Popover: {
      color: r.bgRaised,
      borderRadius: radius.lg,
      boxShadow: isDark ? '0 0 0 1px ' + r.borderBase + ', 0 16px 40px -12px rgba(0,0,0,0.7)' : '0 12px 32px -8px rgba(16,20,28,0.18)'
    },
    Tooltip: {
      color: r.bgRaised,
      textColor: r.textBase,
      borderRadius: radius.md,
      boxShadow: isDark ? '0 0 0 1px ' + r.borderBase + ', 0 8px 24px -8px rgba(0,0,0,0.7)' : '0 8px 24px -8px rgba(16,20,28,0.18)'
    },
    Checkbox: {
      colorChecked: r.accent,
      borderChecked: '1px solid ' + r.accent,
      border: '1px solid ' + r.borderStrong,
      borderHover: '1px solid ' + r.accent,
      borderFocus: '1px solid ' + r.accent,
      boxShadowFocus: 'none',
      borderRadius: radius.xs
    },
    Switch: {
      railColorActive: r.accent,
      railColor: r.borderStrong,
      boxShadowFocus: 'none'
    },
    Progress: {
      railColor: r.bgSunken,
      textColorLineInner: r.textOnAccent,
      textColorLineOuter: r.textMuted
    },
    Empty: {
      textColor: r.textMuted,
      iconColor: r.textFaint,
      iconSizeMedium: '40px'
    },
    Statistic: {
      labelTextColor: r.textMuted,
      valueTextColor: r.textStrong,
      valueFontSize: '22px'
    },
    Divider: { color: r.borderSubtle },
    Notification: { color: r.bgRaised, borderRadius: radius.lg, boxShadow: '0 16px 40px -12px rgba(0,0,0,0.3)' },
    Message: { color: r.bgRaised, borderRadius: radius.md, boxShadow: '0 12px 32px -8px rgba(0,0,0,0.25)' },
    Alert: { color: r.bgSunken, borderRadius: radius.md },
    Spin: { color: r.accent },
    Slider: { fillColor: r.accent, railColor: r.bgActive, handleColor: r.bgSurface }
  }
}

/** 供非组件场景（message/dialog 的独立 provider）复用同一套角色 */
export function designRoles(isDark: boolean) {
  return isDark ? roles.dark : roles.light
}

export const NAV_ITEM_HEIGHT = control.navItem
export const FONT_WEIGHT_SEMIBOLD = fontWeight.semibold
