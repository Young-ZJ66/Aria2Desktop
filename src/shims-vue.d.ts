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

/**
 * 静态资源类型声明：Vite 构建时会把这类导入解析为资源 URL 字符串。
 * 此前缺了这些声明，`import appIcon from '@/../build/Icon.ico'`（侧边栏 Logo）在类型检查里报
 * "Cannot find module"，而运行时其实是正常的。
 */
declare module '*.ico' {
  const src: string
  export default src
}
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}
declare module '*.jpg' {
  const src: string
  export default src
}
