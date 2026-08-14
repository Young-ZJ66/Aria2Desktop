/**
 * Vue 单文件组件类型声明
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/**
 * CSS 模块类型声明（副作用导入）
 */
declare module '*.css'
declare module '*.scss'
declare module '*.sass'
