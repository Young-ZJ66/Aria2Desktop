/**
 * Vite 注入的 `import.meta.env`（只声明本项目用到的字段）。
 *
 * 为什么不用 `/// <reference types="vite/client" />`：它会附带一堆资源模块 shim
 * （`*.css` / `*.png` 等），与本仓 src/shims-vue.d.ts 里已有的声明重复，
 * 反而会引入"重复标识符"类型错误。这里按需声明，范围最小。
 */
interface ImportMetaEnv {
  /** 开发态为 true；生产构建时被静态替换为 false（见 src/utils/devLog.ts） */
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
