#!/usr/bin/env node
/**
 * 把 extension/ 打包成**已签名**的 .crx（CRX3），供用户旁加载安装。
 *
 * 为什么用浏览器自带的打包器：
 * CRX3 的签名头（protobuf + RSA 签名）手写容易出错，而 Chrome / Edge 均内置
 * `--pack-extension`，产出格式一定正确，且不需要额外依赖。
 *
 * 关键约束（务必遵守）：
 * 1) **签名密钥必须固定**：扩展 ID 由密钥决定，密钥一变，老用户无法升级、App 侧的
 *    Origin 白名单也会失效；因此密钥存在 `.crx/extension-key.pem`（已 gitignore），
 *    CI 上由 GitHub Secret 注入。
 * 2) 密钥**绝不能进仓库**：泄露等同于任何人都能签发"同 ID"的扩展。
 *
 * 用法：
 *   node scripts/pack-extension-crx.mjs                  # 用默认密钥（缺失则首次生成）
 *   CRX_KEY_PATH=... CRX_BROWSER=... node scripts/...    # 自定义密钥/打包器
 */

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = path.join(root, 'extension')
const outDir = path.join(root, 'release')
const keyPath = path.resolve(process.env.CRX_KEY_PATH || path.join(root, '.crx', 'extension-key.pem'))

/** 打进 crx 的文件（与商店打包保持一致，README 之类不进去） */
const PACK_ENTRIES = ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'icons', '_locales']

const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
]

function findBrowser() {
  if (process.env.CRX_BROWSER) {
    if (!fs.existsSync(process.env.CRX_BROWSER)) {
      throw new Error(`CRX_BROWSER 指定的打包器不存在：${process.env.CRX_BROWSER}`)
    }
    return process.env.CRX_BROWSER
  }
  const found = BROWSER_CANDIDATES.find((p) => fs.existsSync(p))
  if (!found) {
    throw new Error(
      '未找到 Chrome / Edge 可执行文件。请安装其中之一，或用 CRX_BROWSER 指定打包器路径。\n' +
      '（也可以用 Chromium：只要支持 --pack-extension 即可）'
    )
  }
  return found
}

/** 扩展 ID：公钥 DER 的 SHA256 前 16 字节，每个 nibble 映射到 a-p */
function extensionIdFromKey(pemContent) {
  const der = crypto.createPublicKey(pemContent).export({ type: 'spki', format: 'der' })
  const hash = crypto.createHash('sha256').update(der).digest()
  let id = ''
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4)) + String.fromCharCode(97 + (hash[i] & 0x0f))
  }
  return id
}

/** 把需要打包的文件复制到临时目录（浏览器只会把 crx/pem 写在扩展目录的同级） */
function stageExtension(targetDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'))
  for (const entry of PACK_ENTRIES) {
    const from = path.join(extensionDir, entry)
    if (!fs.existsSync(from)) throw new Error(`扩展缺少必需文件：${entry}`)
    fs.cpSync(from, path.join(targetDir, entry), { recursive: true })
  }
  return manifest
}

function main() {
  const browser = findBrowser()
  const hasKey = fs.existsSync(keyPath)

  // 全部在临时目录里操作：浏览器会把 crx 与（首次生成的）pem 写到扩展目录的同级，
  // 直接对仓库目录打包会把这两个文件丢在仓库根目录
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-crx-pack-'))
  const stagedDir = path.join(workDir, 'extension')
  fs.mkdirSync(stagedDir)
  const manifest = stageExtension(stagedDir)

  const args = [`--pack-extension=${stagedDir}`, '--no-message-box', `--user-data-dir=${path.join(workDir, 'profile')}`]
  // 已有密钥则复用（ID 不变）；否则让浏览器生成，之后再搬走保存
  if (hasKey) args.push(`--pack-extension-key=${keyPath}`)

  console.log(`打包器: ${browser}`)
  console.log(`密钥: ${hasKey ? keyPath : '(首次生成)'}`)
  // stdio 必须忽略：Chrome/Edge 是 GUI 子系统程序，用管道会触发 EBUSY，
  // 打包结果以「是否产出 crx」为准（下面会校验文件头）
  const result = spawnSync(browser, args, { stdio: 'ignore', timeout: 120000 })
  if (result.error) throw result.error

  const crxSource = path.join(workDir, 'extension.crx')
  if (!fs.existsSync(crxSource)) {
    throw new Error(
      `打包失败：未生成 crx（退出码 ${result.status ?? '未知'}）。\n` +
      '提示：确认打包器支持 --pack-extension（Chrome/Edge/Chromium 均支持），或用 CRX_BROWSER 指定其它浏览器。'
    )
  }

  // 首次生成密钥：搬到固定位置保存（CI 上则由 Secret 预先写好，不走这里）
  if (!hasKey) {
    const pemSource = path.join(workDir, 'extension.pem')
    if (!fs.existsSync(pemSource)) throw new Error('打包器未生成密钥文件，无法固定扩展 ID')
    fs.mkdirSync(path.dirname(keyPath), { recursive: true })
    fs.copyFileSync(pemSource, keyPath)
    console.log(`\n[重要] 已生成签名密钥：${keyPath}`)
    console.log('      请立即备份，并加入 GitHub Secret（EXTENSION_CRX_KEY）——密钥丢失或更换会导致扩展 ID 变化，')
    console.log('      已安装的用户将无法升级。该文件已被 .gitignore 忽略，切勿提交。')
  }

  // 结构自检：CRX3 = "Cr24" + uint32 LE 版本号 3
  const crx = fs.readFileSync(crxSource)
  if (crx.subarray(0, 4).toString('ascii') !== 'Cr24' || crx.readUInt32LE(4) !== 3) {
    throw new Error('生成的 crx 头部不是合法 CRX3')
  }

  fs.mkdirSync(outDir, { recursive: true })
  const target = path.join(outDir, `Aria2Desktop-Extension-v${manifest.version}.crx`)
  fs.copyFileSync(crxSource, target)
  fs.rmSync(workDir, { recursive: true, force: true })

  const pemContent = fs.readFileSync(keyPath, 'utf8')
  console.log(`\n已生成: ${target}  (${(crx.length / 1024).toFixed(1)} KB，扩展版本 ${manifest.version})`)
  console.log(`扩展 ID: ${extensionIdFromKey(pemContent)}`)
  console.log('\n安装方式：开发者模式下把 .crx 拖入 chrome://extensions/ ；Edge 亦可在扩展页直接拖入。')
}

try {
  main()
} catch (error) {
  console.error(`打包扩展失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
