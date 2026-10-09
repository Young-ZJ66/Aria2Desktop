/* eslint-disable no-console -- 这里是渲染层唯一的控制台出口。规则的本意是"别到处 console.log"，
   而不是"永远不输出调试信息"；集中在一处才能统一控制（生产态静默），也不会被误当成漏改的调试语句。 */
/**
 * 渲染层调试日志：开发态输出，生产态静默。
 *
 * 为什么需要：主进程有 electron-log，渲染层没有对应设施，于是各服务直接写 `console.log`——
 * 而打包后的应用用户打不开控制台，这些输出在生产里毫无用处，却会在"每完成一个任务"这类
 * 热路径上执行（见 services/taskPersistenceService.ts）。
 *
 * 注意只收敛 info 级：`console.warn` / `console.error` 仍直接调用（eslint 也允许），
 * 因为异常路径需要在用户开着 devtools 排障时始终可见。
 */
/**
 * 是否开发态。
 *
 * 必须写成 `import.meta.env.DEV` 的**精确形态**（既不要加可选链，也不要包进函数）：
 * Vite 按表达式文本做静态替换，只有精确形态才会被替换成字面量 `false`，
 * 进而让 `if (isDev)` 被判定为死代码、把调试字符串从产物里摇掉。
 *
 * 本文件只被渲染层引用（Vite 与 Vitest 都会注入 import.meta.env），故不做兜底判断。
 */
const isDev = import.meta.env.DEV

export function devLog(...args: unknown[]): void {
  if (isDev) console.log(...args)
}
