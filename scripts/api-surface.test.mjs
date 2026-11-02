/**
 * 渲染层 ↔ 主进程接口面的静态一致性检查。
 *
 * 这三个文件是"同一份接口"的三处表述，改一处忘了另一处，TypeScript 也发现不了：
 * - `electron/preload.ts`：真正暴露给渲染层的对象（少一个键，渲染层调用就是 undefined）
 * - `src/types/electron.d.ts`：渲染层看到的类型（多一个键，编译通过但运行时炸）
 * - `electron/controllers/*.ts`：真正注册的 IPC 通道（改名不同步就是 "No handler registered"）
 *
 * 这里用静态解析做双向比对。它不是万能替代品（不校验参数与返回值类型），
 * 但能挡住最常见的一类事故：只改了一边。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

/** 递归收集主进程源码（不含测试与 preload 自身） */
function mainProcessSources() {
  const files = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('preload.ts')) files.push(full)
    }
  }
  walk(path.join(root, 'electron'))
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n')
}

/** preload 暴露的对象键名 */
function preloadApiKeys() {
  const source = read('electron/preload.ts')
  const body = source.slice(
    source.indexOf('const electronAPI = {'),
    source.indexOf('contextBridge.exposeInMainWorld')
  )
  return [...body.matchAll(/^ {2}([A-Za-z]\w*):/gm)].map(match => match[1])
}

/** electron.d.ts 里 ElectronAPI 接口声明的键名 */
function declaredApiKeys() {
  const source = read('src/types/electron.d.ts')
  const start = source.indexOf('export interface ElectronAPI {')
  const block = source.slice(start, source.indexOf('\n}', start))
  return [...block.matchAll(/^ {2}([A-Za-z]\w*)\??:/gm)].map(match => match[1])
}

function invokedChannels() {
  return [...read('electron/preload.ts').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1])
}

/** 主进程注册的通道名：泛型参数里可能含 '>'，所以不解析泛型，只取调用后的第一个字符串字面量 */
function registeredChannels() {
  const source = mainProcessSources()
  return [...source.matchAll(/registerSecureHandler[\s\S]{0,300}?'([\w:-]+)'/g)].map(m => m[1])
}

describe('preload 与类型声明的接口面', () => {
  it('两边键名完全一致（多一个少一个都算错）', () => {
    const exposed = preloadApiKeys().sort()
    const declared = declaredApiKeys().sort()
    expect(exposed.length).toBeGreaterThan(50)
    expect(exposed).toEqual(declared)
  })
})

describe('IPC 通道：preload 调用与主进程注册', () => {
  it('每个 invoke 通道都在主进程注册过', () => {
    const registered = registeredChannels()
    const missing = invokedChannels().filter(channel => !registered.includes(channel))
    expect(missing).toEqual([])
  })

  it('没有注册了却没人调用的通道（死通道容易掩盖漏改）', () => {
    const invoked = invokedChannels()
    const unused = [...new Set(registeredChannels())].filter(channel => !invoked.includes(channel))
    expect(unused).toEqual([])
  })

  it('没有两个方法共用同一个通道名（会互相串参数）', () => {
    const channels = invokedChannels()
    expect(channels.length).toBe(new Set(channels).size)
  })
})

describe('主进程推送的事件', () => {
  it('preload 监听的每个事件都有主进程在发', () => {
    const listened = [...read('electron/preload.ts').matchAll(/ipcRenderer\.on\('([^']+)'/g)].map(m => m[1])
    const source = mainProcessSources()
    const emitted = new Set([...source.matchAll(/\.send\('([^']+)'/g)].map(m => m[1]))
    expect(listened.length).toBeGreaterThan(0)
    expect(listened.filter(event => !emitted.has(event))).toEqual([])
  })
})
