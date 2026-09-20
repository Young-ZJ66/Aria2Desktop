import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * 单元测试配置。
 *
 * 设计取舍：
 * - **扩展名用 .mts**：项目 package.json 未声明 `"type": "module"`，`.ts` 配置会被按 CJS 加载
 *   （Vite 已就此告警，未来将直接报错）；`.mts` 明确 ESM，与既有 `vite.config.mts` 保持一致。
 * - **不复用 `vite.config.mts`**：那里挂着 Vue 插件与组件自动导入，单测目标是纯逻辑模块，
 *   单独配置更轻，也避免测试被构建侧变更波及。
 * - 环境默认 `node`：覆盖 `electron/utils`、`src/shared`、`src/utils` 等无 DOM 依赖的纯逻辑。
 *   将来若要测需要 DOM 的代码，在该测试文件头加 `// @vitest-environment happy-dom` 单独切换。
 * - 测试文件与源码同目录（`*.test.ts`），并被 `tsconfig.electron.json` 排除，
 *   避免被编译进主进程产物 `dist/electron`。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node'
  }
})
