/**
 * 扩展配对回归：验证「用户切到 App 点允许」耗时超过 MV3 Service Worker 空闲回收时间（约 30s）
 * 时，配对结果仍能写入 storage，弹窗重新打开后显示已配对。
 *
 * 为什么单独做：这是真实发生过的缺陷——App 日志已显示「允许配对」，但扩展没保存密钥，
 * 用户看到的是"配对成功却仍提示未配对，再点又重复弹窗"。根因是等待期间 SW 被回收、
 * 进行中的 fetch 被中断；background.startPairing 用定时 API 调用保活修复。
 *
 * 为了不改仓库里的 APP_API_BASE，这里把扩展复制到临时目录并只替换该常量，
 * 指向一个延迟 35s 才返回的 /api/pair 桩（延迟 > 30s 才能覆盖到回收场景）。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { capture, connect, evalIn, httpJson, killTree, sleep, waitFor } from './lib/cdp.mjs'
import { findExtensionServiceWorker, resolveChromePath } from './extension.mjs'

const PAIR_DELAY_MS = 35000

/** 打开 popup 后等 DOM 就绪：固定 sleep 在机器繁忙时可能取到还没加载完的页面 */
async function waitForPopupReady(session) {
  await waitFor(
    async () => await evalIn(session, `document.readyState === 'complete' && !!document.getElementById('pairBtn')`),
    { timeoutMs: 15000, intervalMs: 300, label: '配对弹窗就绪' }
  )
}

export async function runPairingCheck({ extensionDir, outDir, reporter }) {
  const chromePath = resolveChromePath()
  if (!chromePath) {
    console.log('SKIP 配对回归：未提供 Chromium/Chrome for Testing')
    return { skipped: true }
  }

  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, origin: req.headers.origin })
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, secret: 'e2e-pair-secret', port: 6800 }))
    }, PAIR_DELAY_MS)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const stubPort = server.address().port

  const extDir = path.join(os.tmpdir(), `aria2-ext-pair-${Date.now()}`)
  fs.cpSync(extensionDir, extDir, { recursive: true })
  const bgPath = path.join(extDir, 'background.js')
  const patched = fs
    .readFileSync(bgPath, 'utf8')
    .replace('http://127.0.0.1:6801', `http://127.0.0.1:${stubPort}`)
  fs.writeFileSync(bgPath, patched)

  const profile = path.join(os.tmpdir(), `aria2-ext-pair-profile-${Date.now()}`)
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=9473',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )

  try {
    // 只认"manifest 版本与本扩展一致"的 SW：Chromium 自带组件扩展也有 background.js，
    // 按 URL/顺序挑选会误取到别的扩展，后续打开的 popup 里根本没有配对按钮
    const manifestVersion = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8')).version
    const found = await findExtensionServiceWorker(9473, manifestVersion, { timeoutMs: 20000 })
    if (!found) throw new Error('扩展 service worker 未就绪')
    const { extensionId } = found

    const popup = await httpJson(`http://127.0.0.1:9473/json/new?chrome-extension://${extensionId}/popup.html`, 'PUT')
    const session = await connect(popup.webSocketDebuggerUrl)
    await session.send('Runtime.enable')
    await waitForPopupReady(session)
    await evalIn(session, `document.getElementById('pairBtn').click()`)
    // 模拟真实操作：点完配对后弹窗失焦关闭，用户切到 App 点「允许」
    await sleep(300)
    await httpJson(`http://127.0.0.1:9473/json/close/${popup.id}`).catch(() => {})
    session.close()

    await sleep(PAIR_DELAY_MS + 5000)

    const reopened = await httpJson(`http://127.0.0.1:9473/json/new?chrome-extension://${extensionId}/popup.html`, 'PUT')
    const verifySession = await connect(reopened.webSocketDebuggerUrl)
    await verifySession.send('Runtime.enable')
    await waitForPopupReady(verifySession)

    const stored = await evalIn(verifySession, `chrome.storage.local.get('config').then(JSON.stringify)`)
    const config = JSON.parse(stored)
    reporter.check('配对请求到达 App 且来源为扩展', requests.some((r) => r.url === '/api/pair' && r.origin?.startsWith('chrome-extension://')), JSON.stringify(requests))
    reporter.check('等待超过 30s 后配对结果仍写入 storage', config?.config?.secret === 'e2e-pair-secret', stored)
    // 必须断言**实际可见性**：只看 hidden 属性会漏掉 CSS display 覆盖（.banner{display:flex}），
    // 那正是"已配对却仍显示未配对横幅"的真实原因
    const bannerVisible = await evalIn(
      verifySession,
      `(() => { const el = document.getElementById('pairBanner'); return el.offsetParent !== null && getComputedStyle(el).display !== 'none' })()`
    )
    reporter.check('重新打开弹窗不再显示未配对横幅', bannerVisible === false)
    // 同一个按钮应切换成「解除配对」，而不是额外出现第二个按钮
    const pairBtnText = await evalIn(verifySession, `document.getElementById('pairBtn').textContent`)
    reporter.check('配对按钮切换为解除配对', /解除配对|Unpair/i.test(String(pairBtnText)), String(pairBtnText))
    const hasExtraUnpair = await evalIn(verifySession, `document.getElementById('unpairBtn') !== null`)
    reporter.check('不存在额外的解除配对按钮', hasExtraUnpair === false)
    await capture(verifySession, path.join(outDir, '08-extension-paired.png'))
    verifySession.close()
  } catch (error) {
    reporter.check('配对回归执行完成', false, error instanceof Error ? error.message : String(error))
  } finally {
    killTree(chrome.pid)
    server.close()
    await sleep(300)
    fs.rmSync(profile, { recursive: true, force: true })
    fs.rmSync(extDir, { recursive: true, force: true })
  }

  return { skipped: false }
}
