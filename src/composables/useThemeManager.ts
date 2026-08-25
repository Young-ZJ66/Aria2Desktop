import { computed, ref } from 'vue'
import { darkTheme, zhCN, enUS, type GlobalThemeOverrides } from 'naive-ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { getLocale } from '@/i18n'
import { buildThemeOverrides } from '@/styles/themeTokens'

/**
 * Naive UI 主题管理：跟随 data-theme 设置（theme=auto 时实时跟随系统深浅色）。
 * matchMedia 不是响应式的，用 ref + change 事件监听让 computed 能在系统主题变化时重算。
 */
export function useThemeManager() {
  const settingsStore = useSettingsStore()

  const systemDark = ref(false)
  let mql: MediaQueryList | null = null
  let mqlChangeHandler: ((e: MediaQueryListEvent) => void) | null = null

  function initSystemThemeListener(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mql.matches
    mqlChangeHandler = (e: MediaQueryListEvent) => { systemDark.value = e.matches }
    mql.addEventListener('change', mqlChangeHandler)
  }

  function disposeSystemThemeListener(): void {
    if (mql && mqlChangeHandler) {
      mql.removeEventListener('change', mqlChangeHandler)
      mql = null
      mqlChangeHandler = null
    }
  }

  const isDark = computed(() => {
    const theme = settingsStore.settings.theme
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return systemDark.value
  })

  const currentTheme = computed(() => (isDark.value ? darkTheme : null))

  // 主题覆盖：主色与圆角（单一来源：src/styles/themeTokens.ts）
  const themeOverrides = computed<GlobalThemeOverrides>(() => buildThemeOverrides(isDark.value))

  // Naive UI 组件语言（跟随应用当前语言设置）
  const naiveLocale = computed(() => (getLocale() === 'zh-CN' ? zhCN : enUS))

  return {
    systemDark,
    initSystemThemeListener,
    disposeSystemThemeListener,
    isDark,
    currentTheme,
    themeOverrides,
    naiveLocale
  }
}
