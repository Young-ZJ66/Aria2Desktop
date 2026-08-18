/**
 * 全局反馈工具：提供可在组件 setup 之外（store/composable）使用的 message 与 confirm
 * 通过 createDiscreteApi 实现；按应用当前主题（深浅色 + 主色/圆角覆盖）构建，
 * 保证确认弹窗/消息的配色、圆角、按钮风格与应用整体一致。
 *
 * confirm 使用自定义 action 渲染按钮：
 *  - 确认（positive）按钮固定为蓝色主按钮
 *  - 取消（negative）按钮固定为默认样式（灰边框 + 深色文字 + 悬浮变蓝）
 */
import {
  createDiscreteApi,
  darkTheme,
  NButton,
  type GlobalThemeOverrides,
  type MessageOptions,
  type DialogReactive
} from 'naive-ui'
import { h } from 'vue'

/** 与 App.vue 的 themeOverrides 保持一致的主色与圆角 */
function buildThemeOverrides(isDark: boolean): GlobalThemeOverrides {
  return {
    common: {
      primaryColor: isDark ? '#6c86f5' : '#4f6ef2',
      primaryColorHover: isDark ? '#8499f7' : '#6279f4',
      primaryColorPressed: isDark ? '#5465d8' : '#3d56d0',
      primaryColorSuppl: isDark ? '#6c86f5' : '#4f6ef2',
      borderRadius: '8px'
    },
    Card: { borderRadius: '10px' }
  }
}

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark') ||
    document.documentElement.getAttribute('data-theme') === 'dark'
}

type DiscreteApi = ReturnType<typeof createDiscreteApi<['message', 'dialog']>>

let cached: DiscreteApi | null = null
let cachedIsDark: boolean | null = null

function getDiscreteApi(): DiscreteApi {
  const isDark = isDarkMode()
  // 主题切换后重建一次，确保颜色/圆角与当前主题一致
  if (!cached || cachedIsDark !== isDark) {
    cachedIsDark = isDark
    cached = createDiscreteApi(['message', 'dialog'], {
      configProviderProps: {
        theme: isDark ? darkTheme : undefined,
        themeOverrides: buildThemeOverrides(isDark)
      }
    })
  }
  return cached
}

export const message = {
  success: (content: string, options?: MessageOptions) => getDiscreteApi().message.success(content, options),
  error: (content: string, options?: MessageOptions) => getDiscreteApi().message.error(content, options),
  warning: (content: string, options?: MessageOptions) => getDiscreteApi().message.warning(content, options)
}

export interface ConfirmOptions {
  title: string
  content: string
  /** 图标类型：仅影响左侧图标/标题配色，不影响按钮颜色 */
  type?: 'default' | 'warning' | 'error' | 'info' | 'success'
  positiveText?: string
  negativeText?: string
  /** 返回 false 时保持弹窗不关闭（与 Naive UI 语义一致） */
  onPositiveClick?: () => void | boolean
  onNegativeClick?: () => void
}

/** 统一风格的确认弹窗：确认=蓝色，取消=灰底，可经右上角关闭按钮关闭 */
export function confirm(options: ConfirmOptions): void {
  const { dialog } = getDiscreteApi()
  let instance: DialogReactive | null = null
  instance = dialog.create({
    type: options.type ?? 'warning',
    title: options.title,
    content: options.content,
    closable: true,
    action: () => h('div', { style: 'display: flex; justify-content: flex-end; gap: 12px;' }, [
      options.negativeText
        ? h(NButton, {
          size: 'small',
          onClick: () => {
            options.onNegativeClick?.()
            instance?.destroy()
          }
        }, { default: () => options.negativeText })
        : null,
      options.positiveText
        ? h(NButton, {
          size: 'small',
          type: 'primary',
          onClick: () => {
            const result = options.onPositiveClick?.()
            if (result !== false) instance?.destroy()
          }
        }, { default: () => options.positiveText })
        : null
    ])
  })
}
