/**
 * 根据目标架构准备 aria2c.exe
 * 用法: node scripts/prepare-aria2c.mjs <x64|x86>
 * 将 resources/aria2c-<arch>.exe 复制为 resources/aria2c.exe 供 electron-builder 打包
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const arch = process.argv[2] || 'x64'

if (!['x64', 'x86'].includes(arch)) {
  console.error(`不支持的架构: ${arch}（仅支持 x64 / x86）`)
  process.exit(1)
}

const resourcesDir = path.join(__dirname, '..', 'resources')
const src = path.join(resourcesDir, `aria2c-${arch}.exe`)
const dest = path.join(resourcesDir, 'aria2c.exe')

if (!fs.existsSync(src)) {
  console.error(`未找到 ${arch} 架构的 aria2c 文件: ${src}`)
  process.exit(1)
}

fs.copyFileSync(src, dest)
console.log(`已准备 aria2c.exe（${arch}）用于打包`)
