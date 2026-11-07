#!/usr/bin/env node
/**
 * 扩展静态校验（`npm run check:extension`）
 *
 * 为什么需要：扩展有两类问题**只能在浏览器里才暴露**，而它们都能在构建期静态拦住——
 * 1) 语言包结构错误：`_locales/<locale>/messages.json` 要求每个键的值是 `{ message: "..." }` 对象，
 *    写成纯字符串会报 "Not a valid tree for key XXX" 并**导致整个扩展加载失败**；
 * 2) manifest 引用的文件缺失（service_worker / popup / 图标），同样表现为"无法加载扩展"。
 * 此外还校验：JS 语法、权限与 host_permissions 是否符合预期、语言键一致性、
 * 代码用到的 i18n key 是否存在、扩展与主进程的接口端口是否一致。
 *
 * 用法：node scripts/check-extension.mjs（失败时退出码 1，可直接接进 CI）
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = path.join(root, 'extension')

const results = []
const fail = (msg) => results.push('FAIL ' + msg)
const ok = (msg) => results.push('ok   ' + msg)

// ---- JS 语法 ----
for (const file of ['background.js', 'popup.js']) {
  try {
    new vm.Script(fs.readFileSync(path.join(extensionDir, file), 'utf8'), { filename: file })
    ok(`${file} 语法通过`)
  } catch (error) {
    fail(`${file} 语法错误: ${error.message}`)
  }
}

// ---- manifest 与语言包 ----
const readJson = (relative, label) => {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(extensionDir, relative), 'utf8'))
    ok(`${label} 是合法 JSON`)
    return value
  } catch (error) {
    fail(`${label}: ${error.message}`)
    return null
  }
}

const manifest = readJson('manifest.json', 'manifest.json')
const locales = {
  zh_CN: readJson('_locales/zh_CN/messages.json', 'zh_CN/messages.json'),
  en: readJson('_locales/en/messages.json', 'en/messages.json')
}

if (manifest) {
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {})
  ].filter(Boolean)
  const missing = referenced.filter((rel) => !fs.existsSync(path.join(extensionDir, rel)))
  if (missing.length) fail('manifest 引用的文件不存在: ' + missing.join(', '))
  else ok(`manifest 引用的 ${referenced.length} 个文件均存在`)

  for (const [field, value] of Object.entries(manifest)) {
    const match = typeof value === 'string' && value.match(/^__MSG_(\w+)__$/)
    if (match && !locales.zh_CN?.[match[1]]) fail(`manifest.${field} 引用了默认语言包中不存在的 key: ${match[1]}`)
  }

  const permissions = JSON.stringify(manifest.permissions ?? [])
  const hosts = JSON.stringify(manifest.host_permissions ?? [])
  if (hosts.includes('<all_urls>')) fail('host_permissions 仍含 <all_urls>')
  const popupSource = fs.readFileSync(path.join(extensionDir, 'popup.js'), 'utf8')
  if (popupSource.includes('navigator.clipboard.readText') && !permissions.includes('clipboardRead')) {
    fail('popup.js 使用 navigator.clipboard.readText，但 manifest 缺少 clipboardRead')
  }
  if (!permissions.includes('notifications')) fail('permissions 缺少 notifications（通知会静默失败）')
  ok(`权限: ${permissions}`)
  ok(`host_permissions: ${hosts}`)

  // 版本号必须是 semver（商店上传要求；漏 bump 时至少不会带着非法版本号提交）
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version ?? ''))) {
    fail(`manifest.version 不是合法 semver: ${manifest.version}`)
  } else {
    ok(`扩展版本: ${manifest.version}`)
  }

  const optional = Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : []
  const required = Array.isArray(manifest.permissions) ? manifest.permissions : []
  // 同一个权限不能既必选又可选项（Chrome 会加载失败）
  const overlap = optional.filter((p) => required.includes(p))
  if (overlap.length) fail('权限同时出现在 permissions 与 optional_permissions: ' + overlap.join(', '))
  else ok(`可选权限: ${JSON.stringify(optional)}`)

  /**
   * 代码用到的 chrome API 与权限声明必须对得上。
   *
   * 为什么需要：把权限从必选改成可选后，`chrome.cookies` / `chrome.scripting` 在未授权时是
   * undefined——代码里照旧调用就会在运行时静默失败（TS 管不到扩展的纯 JS）。
   * 这条断言至少保证"用了的 API 一定声明过"，漏声明会在这里红。
   */
  const API_PERMISSION = {
    cookies: 'cookies',
    scripting: 'scripting',
    downloads: 'downloads',
    contextMenus: 'contextMenus',
    notifications: 'notifications',
    storage: 'storage',
    // tabs.query 读取 URL 依赖 activeTab（用户点击图标/右键时临时授予），不需要 tabs 必选权限
    tabs: 'activeTab'
  }
  const declared = new Set([...required, ...optional])
  const sources = ['background.js', 'popup.js'].map((file) => ({
    file,
    code: fs.readFileSync(path.join(extensionDir, file), 'utf8')
  }))
  const missingApiPerms = []
  for (const [api, permission] of Object.entries(API_PERMISSION)) {
    const pattern = new RegExp(`chrome\\.${api}\\b`)
    const usedIn = sources.filter(({ code }) => pattern.test(code)).map(({ file }) => file)
    if (usedIn.length && !declared.has(permission)) {
      missingApiPerms.push(`chrome.${api}（${usedIn.join('/')}）需要权限 ${permission}`)
    }
  }
  if (missingApiPerms.length) fail('API 与权限声明不一致: ' + missingApiPerms.join('; '))
  else ok(`代码使用的 chrome API 均有对应权限声明（${Object.keys(API_PERMISSION).length} 类）`)
}

// ---- 语言包结构（最容易导致"扩展无法加载"的一类） ----
for (const [name, locale] of Object.entries(locales)) {
  if (!locale) continue
  const badStructure = Object.entries(locale).filter(
    ([, value]) => !(value && typeof value === 'object' && typeof value.message === 'string')
  )
  if (badStructure.length) {
    fail(`${name} 语言包结构非法（必须是 {message:"..."}）: ` + badStructure.map(([key]) => key).join(', '))
  } else {
    ok(`${name} 语言包结构合法（${Object.keys(locale).length} 键均为 {message} 形态）`)
  }
  for (const [key, value] of Object.entries(locale)) {
    if (value?.placeholders && typeof value.placeholders !== 'object') fail(`${name}.${key} 的 placeholders 必须是对象`)
  }
}

const [zh, en] = [locales.zh_CN, locales.en]
if (zh && en) {
  const onlyZh = Object.keys(zh).filter((key) => !en[key])
  const onlyEn = Object.keys(en).filter((key) => !zh[key])
  if (onlyZh.length) fail('仅 zh_CN 有: ' + onlyZh.join(', '))
  if (onlyEn.length) fail('仅 en 有: ' + onlyEn.join(', '))
  if (!onlyZh.length && !onlyEn.length) ok(`语言包 key 一致（各 ${Object.keys(zh).length} 项）`)
}

// ---- 代码用到的 i18n key 是否都存在 ----
const used = new Set()
for (const file of ['background.js', 'popup.js']) {
  const code = fs.readFileSync(path.join(extensionDir, file), 'utf8')
  for (const match of code.matchAll(/\bi18n\(\s*'([A-Za-z0-9_]+)'/g)) used.add(match[1])
  for (const match of code.matchAll(/showNotification\(\s*'([A-Za-z0-9_]+)'/g)) used.add(match[1])
}
if (zh && en) {
  const missing = [...used].filter((key) => !zh[key] || !en[key])
  if (missing.length) fail('代码使用但语言包缺失的 key: ' + missing.join(', '))
  else ok(`代码使用的 ${used.size} 个 i18n key 均存在于两种语言`)
}

// ---- 扩展与主进程的接口地址必须一致（端口是两端硬编码，容易漂移） ----
// popup 不直接访问 App 接口（状态/配对均由 background 代执行），只需校验 background
const corePath = path.join(root, 'electron/utils/extensionApiCore.ts')
if (fs.existsSync(corePath)) {
  const port = /EXTENSION_API_PORT\s*=\s*(\d+)/.exec(fs.readFileSync(corePath, 'utf8'))
  if (!port) {
    fail('未能在 electron/utils/extensionApiCore.ts 中定位 EXTENSION_API_PORT')
  } else {
    const found = /APP_API_BASE\s*=\s*'http:\/\/localhost:(\d+)'/.exec(
      fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8')
    )
    if (!found) fail('background.js 中未找到 APP_API_BASE')
    else if (found[1] !== port[1]) fail(`接口端口不一致：主进程 ${port[1]} vs background.js ${found[1]}`)
    else ok(`App 接口端口一致（主进程与 background.js）: ${found[1]}`)
  }
}

// ---- 输出 ----
for (const line of results) console.log(line)
const failed = results.filter((line) => line.startsWith('FAIL')).length
console.log(`\n结果: ${results.length - failed} 项通过，${failed} 项失败`)
process.exit(failed ? 1 : 0)
