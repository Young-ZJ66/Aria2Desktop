/**
 * 浏览器扩展 E2E：用真实的 Chromium（Chrome for Testing）加载扩展，验证：
 * 1. MV3 service worker 能注册（manifest 被真实浏览器接受）
 * 2. 浏览器内读到的版本与权限声明与仓库 manifest 完全一致
 * 3. popup 能渲染、关键文案存在、无 JS 异常（并输出截图）
 *
 * 为什么必须用 Chrome for Testing：Google Chrome 137+ 已拒绝 --load-extension，
 * 仅 Chromium / Chrome for Testing 支持加载未打包扩展。因此本检查在未提供可用
 * 浏览器时明确 SKIP，而不是用普通 Chrome 得到"扩展没加载"的假失败。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { capture, collectErrors, connect, evalIn, httpJson, killTree, removeDirWithRetry, sleep, waitFor } from './lib/cdp.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const DEFAULT_CHROME_CANDIDATES = [
  // 项目内缓存（把官方 Chrome for Testing 包解压到此处，随 node_modules 一起被忽略；
  // CI 由 .github/workflows/e2e.yml 的"准备 Chrome for Testing"步骤下载后经 E2E_CHROME_PATH 传入）
  path.join(root, 'node_modules', '.cache', 'chrome-for-testing', 'chrome-win64', 'chrome.exe'),
  path.join(root, 'node_modules', '.cache', 'chrome-for-testing', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
  path.join(root, 'node_modules', '.cache', 'chrome-for-testing', 'chrome-linux64', 'chrome'),
  // 开发者手动解压到固定位置
  path.join(os.homedir(), 'chrome-for-testing', 'chrome-win64', 'chrome.exe'),
  path.join(os.homedir(), 'chrome-for-testing', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
  path.join(os.homedir(), 'chrome-for-testing', 'chrome-linux64', 'chrome')
]

/** Playwright 自带的 Chromium（本机已有此缓存时直接复用，无需额外下载） */
function findPlaywrightChromium() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  try {
    for (const dir of fs.readdirSync(base)) {
      if (!dir.startsWith('chromium-')) continue
      const exe = path.join(base, dir, 'chrome-win64', 'chrome.exe')
      if (fs.existsSync(exe)) return exe
    }
  } catch {
    // 未安装 playwright
  }
  return null
}

export function resolveChromePath() {
  const explicit = process.env.E2E_CHROME_PATH
  if (explicit) return fs.existsSync(explicit) ? explicit : null
  return DEFAULT_CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? findPlaywrightChromium()
}

/**
 * 在 CDP 目标里找到"本扩展"的 service worker：逐个求值 manifest，版本匹配才算命中。
 *
 * 不能按"列表里出现任意 chrome-extension:// 目标"判断——Chromium 自带的组件扩展
 * 也有 service worker（且可能先于本扩展出现），按顺序取会把它们当成本扩展，
 * 后续 popup 地址、manifest 断言全部落到别的扩展上。
 *
 * @returns {Promise<{extensionId: string, browserManifest: object} | null>}
 */
export async function findExtensionServiceWorker(port, expectedVersion, { timeoutMs = 30000 } = {}) {
  return waitFor(
    async () => {
      const list = await httpJson(`http://127.0.0.1:${port}/json/list`)
      const swTargets = Array.isArray(list)
        ? list.filter((t) => t.type === 'service_worker' && String(t.url).startsWith('chrome-extension://'))
        : []
      for (const target of swTargets) {
        const session = await connect(target.webSocketDebuggerUrl)
        try {
          // 上下文未初始化时 chrome.runtime 可能还不可用，异常留到下一轮重试
          const raw = await evalIn(
            session,
            `JSON.stringify({
              name: chrome.runtime.getManifest().name,
              version: chrome.runtime.getManifest().version,
              permissions: chrome.runtime.getManifest().permissions,
              optional: chrome.runtime.getManifest().optional_permissions
            })`
          )
          const parsed = raw ? JSON.parse(raw) : null
          if (parsed?.version === expectedVersion) {
            return { extensionId: new URL(target.url).host, browserManifest: parsed }
          }
        } catch {
          // 非本扩展 / 尚未就绪：继续下一个目标或下一轮
        } finally {
          session.close()
        }
      }
      return null
    },
    { timeoutMs, intervalMs: 500, label: '扩展 service worker 就绪' }
  ).catch(() => null)
}

export async function runExtensionCheck({ extensionDir, outDir, reporter, port = 9444 }) {
  const chromePath = resolveChromePath()
  if (!chromePath) {
    console.log('SKIP 扩展 E2E：未提供 E2E_CHROME_PATH（需要 Chrome for Testing / Chromium）')
    return { skipped: true }
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'))
  const expectedPermissions = [...(manifest.permissions ?? [])].sort()
  const expectedOptional = [...(manifest.optional_permissions ?? [])].sort()

  const profile = path.join(os.tmpdir(), `aria2-ext-e2e-profile-${Date.now()}`)
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions-except=' + extensionDir,
      '--load-extension=' + extensionDir,
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  try {
    // 等"能读到自己 manifest 的那个 SW"，理由见 findExtensionServiceWorker
    const found = await findExtensionServiceWorker(port, manifest.version)

    if (!found) {
      throw new Error(
        `扩展未在浏览器中加载。--load-extension 可能被该浏览器忽略（Google Chrome 137+ 不支持），请改用 Chrome for Testing。stderr=${stderr
          .split('\n')
          .slice(-3)
          .join(' | ')}`
      )
    }

    const { extensionId, browserManifest } = found
    reporter.check('扩展在真实浏览器中注册了 service worker', Boolean(extensionId), extensionId)

    const actualPermissions = [...(browserManifest.permissions ?? [])].sort()
    const actualOptional = [...(browserManifest.optional ?? [])].sort()
    reporter.check(
      '浏览器内权限与 manifest 一致',
      JSON.stringify(actualPermissions) === JSON.stringify(expectedPermissions),
      actualPermissions.join(',')
    )
    reporter.check(
      '可选权限与 manifest 一致',
      JSON.stringify(actualOptional) === JSON.stringify(expectedOptional),
      actualOptional.join(',')
    )

    // popup 渲染
    const popup = await httpJson(`http://127.0.0.1:${port}/json/new?chrome-extension://${extensionId}/popup.html`, 'PUT')
    if (!popup?.webSocketDebuggerUrl) throw new Error(`无法打开 popup：${JSON.stringify(popup)}`)
    const session = await connect(popup.webSocketDebuggerUrl)
    await session.send('Runtime.enable')
    await session.send('Log.enable')
    await session.send('Page.enable')
    await session.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 600, deviceScaleFactor: 1, mobile: false })
    // 固定 sleep 不够：popup 的 init() 先填 i18n 文案、绑定导航事件，再 await loadConfig /
    // refreshStatus 等存储与网络调用。机器忙时 1.5s 内这些可能还没跑完，于是文案取到空串、
    // 点击导航也没有监听器（表现为「文案不存在」+「pane 没切换」这类看不出因果的断言失败）。
    // 这里等 init 真正走到绑定事件之后：tab 文案由 initI18n 填充，bindEvents 是紧跟其后的
    // 同步语句，所以文案非空即代表导航已经可点击。
    await waitFor(
      async () =>
        await evalIn(
          session,
          "document.readyState === 'complete' && document.querySelectorAll('.nav-item span').length === 3 && Array.from(document.querySelectorAll('.nav-item span')).every((el) => el.textContent.trim().length > 0)"
        ),
      { timeoutMs: 20000, intervalMs: 200, label: '扩展 popup 初始化完成' }
    )

    const popupInfo = await evalIn(
      session,
      `JSON.stringify({
        text: document.body.innerText,
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        bodyHeight: Math.round(document.body.getBoundingClientRect().height),
        bodyWidth: Math.round(document.body.getBoundingClientRect().width),
        activePane: document.querySelector('.pane.active')?.dataset.pane,
        navCount: document.querySelectorAll('.nav-item').length
      })`
    )
    const info = JSON.parse(popupInfo)
    reporter.check('popup 已渲染', info.width >= 390 && info.height >= 590, `${info.width}x${info.height}`)
    reporter.check('popup 包含原型主界面文案', /Aria2 Desktop/.test(info.text) && /任务|Tasks/.test(info.text) && /嗅探|Sniffer/.test(info.text) && /设置|Settings/.test(info.text))
    reporter.check('popup 默认展示任务页', info.activePane === 'tasks' && info.navCount === 3, JSON.stringify({ activePane: info.activePane, navCount: info.navCount }))
    reporter.check('popup 内容高度不超过 600px', info.bodyHeight > 0 && info.bodyHeight <= 600, `body ${info.bodyHeight}px`)
    reporter.check('popup 无横向溢出', info.bodyWidth <= 401, `body ${info.bodyWidth}px`)
    reporter.check('popup 无运行时异常', collectErrors(session).length === 0)
    await capture(session, path.join(outDir, '07-extension-popup.png'))

    const taskLayout = await evalIn(
      session,
      `(() => {
        const btn = document.getElementById('newDownloadBtn').getBoundingClientRect()
        const metrics = document.querySelectorAll('.metric').length
        const filters = document.querySelectorAll('#taskFilter button').length
        return {
          bodyHeight: Math.round(document.body.getBoundingClientRect().height),
          buttonWidth: Math.round(btn.width),
          buttonHeight: Math.round(btn.height),
          metrics,
          filters
        }
      })()`
    )
    reporter.check('任务页包含四项状态指标', taskLayout?.metrics === 4, JSON.stringify(taskLayout))
    reporter.check('任务页包含三种筛选与新建入口', taskLayout?.filters === 3 && taskLayout?.buttonHeight >= 28, JSON.stringify(taskLayout))
    await capture(session, path.join(outDir, '07b-extension-popup-tasks.png'))

    await evalIn(session, `document.getElementById('navSniffer').click()`)
    // 点击后等 pane 真的切过去再读布局，否则读到的还是切换前的任务页
    await waitFor(async () => await evalIn(session, "document.querySelector('.pane.active')?.dataset.pane === 'sniffer'"), {
      timeoutMs: 10000,
      intervalMs: 100,
      label: '切到网络嗅探页'
    })
    const snifferLayout = await evalIn(
      session,
      `(() => ({
        activePane: document.querySelector('.pane.active')?.dataset.pane,
        filterCount: document.querySelectorAll('#snifferFilter .filter-chip').length,
        resourceList: Boolean(document.getElementById('resourceList')),
        videoAction: document.getElementById('pageVideoTitle')?.innerText || ''
      }))()`
    )
    // 6 个筛选块：全部 / 播放列表 / 视频 / 音频 / 图片 / 其它。播放列表筛选是 1.5.0 新增的，
    // 数字写死容易被功能新增打红，但这里就是要盯住"筛选块数量与 popup.html 一致"，改功能时同步改这里。
    reporter.check('网络嗅探页完整渲染', snifferLayout?.activePane === 'sniffer' && snifferLayout?.filterCount === 6 && snifferLayout?.resourceList === true, JSON.stringify(snifferLayout))
    reporter.check('网络嗅探页包含智能视频解析入口', /智能解析本页视频|Smart video resolver/i.test(String(snifferLayout?.videoAction)), JSON.stringify(snifferLayout))
    await capture(session, path.join(outDir, '07c-extension-popup-sniffer.png'))

    await evalIn(session, `document.getElementById('navSettings').click()`)
    await waitFor(async () => await evalIn(session, "document.querySelector('.pane.active')?.dataset.pane === 'settings'"), {
      timeoutMs: 10000,
      intervalMs: 100,
      label: '切到设置页'
    })
    const settingsLayout = await evalIn(
      session,
      `(() => ({
        activePane: document.querySelector('.pane.active')?.dataset.pane,
        toggles: document.querySelectorAll('.settings-card .switch').length,
        hasConnection: Boolean(document.getElementById('pairBtn')) && Boolean(document.getElementById('testBtn'))
      }))()`
    )
    reporter.check('设置页完整渲染', settingsLayout?.activePane === 'settings' && settingsLayout?.toggles === 3 && settingsLayout?.hasConnection === true, JSON.stringify(settingsLayout))
    await capture(session, path.join(outDir, '07d-extension-popup-settings.png'))

    // 弹窗是主要建任务入口：这里只验证真实渲染与尺寸，不依赖当前是否已配对
    const dialogLayout = await evalIn(
      session,
      `(() => {
        const dialog = document.getElementById('newDownloadDialog')
        dialog.showModal()
        const rect = dialog.getBoundingClientRect()
        const body = document.querySelector('.dialog-body')
        return {
          open: dialog.open,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          bodyOverflowX: body.scrollWidth - body.clientWidth,
          title: document.getElementById('newDownloadTitle').innerText,
          submitText: document.getElementById('newDownloadSubmitText').innerText
        }
      })()`
    )
    reporter.check(
      '新建下载弹窗可打开且尺寸合理',
      dialogLayout?.open === true && dialogLayout.width >= 360 && dialogLayout.width <= 400 && dialogLayout.height > 300 && dialogLayout.height <= 620,
      JSON.stringify(dialogLayout)
    )
    reporter.check('新建下载弹窗无横向溢出', dialogLayout?.bodyOverflowX === 0, JSON.stringify(dialogLayout))
    await capture(session, path.join(outDir, '07e-extension-popup-dialog.png'))
    await evalIn(session, `document.getElementById('newDownloadDialog').close()`)
    session.close()

    return { skipped: false }
  } finally {
    killTree(child.pid)
    await sleep(300)
    await removeDirWithRetry(profile)
  }
}
