import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import i18n from './i18n'
import './styles/theme.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

// ── 渲染层异常上报（落主进程 electron-log）──
// 打包后用户打不开 devtools，未捕获的异常完全不可见；统一转发到主进程日志文件，
// 用户报障时可以直接拿日志定位。此处只做通道，不做 UI 打扰。
/**
 * 同一异常的抑制窗口：错误钩子可能被高频触发（例如一个失败的轮询在定时器里反复拒绝），
 * 不去重会把日志文件刷满、把更早的排障信息挤掉（electron-log 虽有轮转，历史仍会丢）。
 * 同一条（kind + message）在窗口内只上报一次。
 */
const REPORT_DEDUPE_MS = 5000
const recentlyReported = new Map<string, number>()

function reportError(kind: string, err: unknown): void {
  try {
    const error = err instanceof Error ? err : new Error(String(err))
    const dedupeKey = `${kind}|${error.message}`
    const now = Date.now()
    const last = recentlyReported.get(dedupeKey)
    if (last !== undefined && now - last < REPORT_DEDUPE_MS) return

    // 顺手清掉过期项，避免 Map 无界增长（每次都只有极少数条目，成本可忽略）
    for (const [key, ts] of recentlyReported) {
      if (now - ts >= REPORT_DEDUPE_MS) recentlyReported.delete(key)
    }
    recentlyReported.set(dedupeKey, now)

    window.electronAPI?.reportRendererError({
      kind,
      message: error.message,
      stack: error.stack
    })
  } catch { /* 上报本身失败时保持静默（避免错误处理循环） */ }
}

// Vue 组件树内的渲染错误（生命周期钩子、渲染函数、watcher 等）
app.config.errorHandler = (err, _instance, info) => {
  reportError(`vue:${info}`, err)
  // 控制台仍输出一份：开发态排障依赖它（生产态 devtools 关闭时无害）
  console.error(err)
}
// 组件树之外的 Promise 拒绝（事件回调、异步初始化等）
window.addEventListener('unhandledrejection', (event) => {
  reportError('unhandledrejection', event.reason)
})
// 全局同步异常（非 Vue 上下文的运行时错误）
window.addEventListener('error', (event) => {
  // 资源加载错误（img/script 的 target 错误）不含 error 对象，单独标注
  if (!event.error && event.target) return
  reportError('window.onerror', event.error ?? event.message)
})

app.mount('#app')
