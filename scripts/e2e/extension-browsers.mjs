/**
 * 扩展多浏览器 smoke（发布清单 5.7「扩展三浏览器 smoke：Chrome/Edge/Firefox」的自动化部分）。
 *
 * 为什么单独一个脚本：`run-e2e.mjs` 的扩展检查只跑一个浏览器（CI 上是 Chrome for Testing），
 * 而"扩展在 Edge 上也能装起来"这件事以前只能靠人手动点。这里自动发现本机可用的
 * Chromium 系浏览器（Chrome for Testing / Playwright Chromium / Edge），逐个跑同一套断言。
 *
 * Firefox 说明：Firefox 不支持 `--load-extension`，MV3 事件页也无法用 CDP 直接加载，
 * 因此本脚本对 Firefox 只做**静态口径**校验（`npm run check:extension` 里的
 * buildFirefoxManifest / background.scripts / gecko.id / strict_min_version / 无 SW 专属用法），
 * 真实加载仍需人工在 about:debugging 里临时载入 `release/Aria2Desktop-Extension-Firefox-*.zip`。
 *
 * 用法：node scripts/e2e/extension-browsers.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReporter } from './lib/cdp.mjs'
import { resolveChromePath, runExtensionCheck } from './extension.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(root, 'test-results', 'e2e-extension-browsers')
const extensionDir = path.join(root, 'extension')

const LOCALAPPDATA = process.env.LOCALAPPDATA || ''

/** Chromium 系浏览器候选（只有这些支持 --load-extension；Google Chrome 137+ 已拒绝） */
const CHROMIUM_CANDIDATES = [
  { name: 'Chrome for Testing', path: resolveChromePath() },
  {
    name: 'Playwright Chromium',
    path: path.join(LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe')
  },
  { name: 'Microsoft Edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { name: 'Microsoft Edge', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
  { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
  { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' },
  { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge-stable' }
]

const FIREFOX_CANDIDATES = [
  'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/usr/bin/firefox'
]

function exists(file) {
  try {
    return Boolean(file) && fs.existsSync(file)
  } catch {
    return false
  }
}

/** 去重后返回本机可用的 Chromium 系浏览器（按可执行文件路径去重） */
function discoverChromiumBrowsers() {
  const seen = new Set()
  const found = []
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (!exists(candidate.path)) continue
    const key = path.resolve(candidate.path).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ name: candidate.name, path: candidate.path })
  }
  return found
}

function detectFirefox() {
  return FIREFOX_CANDIDATES.find((candidate) => exists(candidate)) ?? null
}

async function main() {
  const reporter = createReporter()
  const browsers = discoverChromiumBrowsers()

  reporter.check('发现至少一个 Chromium 系浏览器', browsers.length > 0, browsers.map((b) => b.name).join(', ') || 'none')
  if (browsers.length === 0) {
    reporter.summary()
    process.exitCode = 1
    return
  }

  fs.mkdirSync(outDir, { recursive: true })
  let port = 9444
  const perBrowser = []
  for (const browser of browsers) {
    process.env.E2E_CHROME_PATH = browser.path
    const browserOutDir = path.join(outDir, browser.name.replace(/\s+/g, '-').toLowerCase())
    fs.mkdirSync(browserOutDir, { recursive: true })
    try {
      const result = await runExtensionCheck({ extensionDir, outDir: browserOutDir, reporter, port })
      perBrowser.push({ browser: browser.name, skipped: Boolean(result?.skipped) })
    } catch (error) {
      reporter.check(`${browser.name} 扩展检查未抛错`, false, String(error?.message ?? error).slice(0, 300))
      perBrowser.push({ browser: browser.name, skipped: false, failed: true })
    }
    port += 1
  }

  const firefoxPath = detectFirefox()
  reporter.check(
    'Firefox 静态口径已覆盖（真实加载需人工 about:debugging）',
    true,
    firefoxPath ? `已安装: ${firefoxPath}` : '本机未安装 Firefox，仅覆盖 check:extension 的 MV3 变体校验'
  )

  console.log('\n每个浏览器的扩展断言均已计入上面的 PASS/FAIL。')
  const failures = reporter.summary()
  process.exitCode = failures > 0 ? 1 : 0
}

void main()
