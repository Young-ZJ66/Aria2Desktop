/**
 * 构建产物校验：确保主进程与渲染层的入口文件确实产出。
 *
 * 为什么需要：生产环境的资源路径是硬编码相对位置（见 electron/utils/resolvePaths.ts），
 * 若打包布局或产物目录发生变化，只有用户启动时才会暴露（白屏 / 图标缺失）。
 * 这里在构建期直接断言，把问题提前。
 *
 * 用法：由 `npm run build` 的最后一步自动调用；也可单独执行 `node scripts/verify-resources.mjs`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

/** 必须存在，缺失即构建失败 */
const required = [
  { file: 'dist/electron/electron/main.js', why: '主进程入口（package.json 的 main）' },
  { file: 'dist/electron/electron/preload.js', why: 'preload 脚本（contextBridge 暴露面）' },
  { file: 'dist/electron/electron/utils/resolvePaths.js', why: '资源路径解析模块（主进程编译产物）' },
  { file: 'dist/vue/index.html', why: '渲染层入口（生产环境唯一加载路径）' },
  { file: 'build/Icon.ico', why: '窗口/托盘图标（extraResources 映射为 Icon.ico）' }
]

/**
 * 允许缺失但给出提示：内置 aria2 引擎由 prepare-aria2c.mjs 按架构生成，
 * 打包脚本（dist:win64 / dist:win32）在 build 之后才调用它，因此纯 `npm run build` 阶段缺失属正常。
 */
const warnIfMissing = [
  { file: 'resources/aria2c.exe', why: '内置 aria2 引擎（打包前需运行 node scripts/prepare-aria2c.mjs <x64|x86>）' }
]

const missing = required.filter(({ file }) => !fs.existsSync(path.join(root, file)))

if (missing.length > 0) {
  console.error('[verify-resources] 构建产物缺失，构建终止：')
  for (const { file, why } of missing) {
    console.error(`  ✗ ${file} —— ${why}`)
  }
  process.exit(1)
}

for (const { file, why } of warnIfMissing) {
  if (!fs.existsSync(path.join(root, file))) {
    console.warn(`[verify-resources] 提示：${file} 暂不存在 —— ${why}`)
  }
}

console.log(`[verify-resources] 构建产物校验通过（${required.length} 项必须项）`)
