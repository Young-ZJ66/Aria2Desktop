/**
 * 应用 UI / 功能 E2E（真实 Electron 渲染层，经 CDP 驱动）。
 *
 * 覆盖：主界面、设置页（版本号、自动解压开关）、插件页（加载/停用/启用）、
 * 新建任务（请求头区域）、任务详情抽屉、自动解压 IPC（成功 + 目录外拒绝 + 不存在）。
 *
 * 文案匹配同时兼容中英文，避免 CI runner 语言不同导致误报。
 */

import fs from 'node:fs'
import path from 'node:path'
import { capture, evalIn, sleep } from './lib/cdp.mjs'

/** CRC32（ZIP 存储格式需要） */
function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 生成"仅存储"（不压缩）的最小 ZIP，避免为测试引入压缩库 */
export function createZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data)
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += 30 + name.length + data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

/** 目录外、但一定存在的文件（用于验证解压路径白名单） */
function outsideExistingFile() {
  if (process.platform === 'win32') return 'C:\\Windows\\notepad.exe'
  if (process.platform === 'darwin') return '/etc/hosts'
  return '/etc/hosts'
}

export async function runAppUi({ session, reporter, outDir, expectedVersion, pluginName, stamp, downloadUrl, downloadBytes, tempDownloadDir }) {
  await evalIn(session, 'document.readyState')
  await sleep(3500)

  // —— 主界面 ——
  const mainText = await evalIn(session, 'document.body.innerText')
  reporter.check('主界面已渲染', typeof mainText === 'string' && mainText.length > 50, String(mainText).slice(0, 80))
  reporter.check(
    '主界面包含侧边栏与任务区',
    typeof mainText === 'string' && /下载|Download|设置|Settings/.test(mainText)
  )
  await capture(session, path.join(outDir, '01-main.png'))

  // —— 设置：打开、版本号、自动解压开关 ——
  const openedSettings = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.footer-btn')].find((b) => /设置|Settings/i.test(b.title || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('点击侧边栏设置按钮', openedSettings === 'clicked', String(openedSettings))
  await sleep(1400)
  const settingsText = await evalIn(
    session,
    `(() => { const m = document.querySelector('.settings-dialog-body'); return m ? m.innerText : '(no settings)' })()`
  )
  reporter.check('设置弹窗可打开', settingsText !== '(no settings)')
  reporter.check(
    `设置页显示当前版本 ${expectedVersion}`,
    typeof settingsText === 'string' && settingsText.includes(expectedVersion),
    String(settingsText).match(/当前版本|Current version[^\n]*/)?.[0] ?? ''
  )
  reporter.check(
    '自动解压开关存在',
    typeof settingsText === 'string' && /自动解压|Extract archives/i.test(settingsText)
  )
  await capture(session, path.join(outDir, '02-settings-general.png'))

  // —— 插件页：列表加载、启停 ——
  const clickedPluginTab = await evalIn(
    session,
    `(() => {
      const tab = [...document.querySelectorAll('.n-tabs-tab')].find((e) => /插件|Plugins/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到插件设置页', clickedPluginTab === 'clicked', String(clickedPluginTab))
  await sleep(1800)
  const pluginText = await evalIn(
    session,
    `(() => {
      const pane = [...document.querySelectorAll('.n-tab-pane')].find((e) => e.offsetParent !== null && /插件|Plugins/i.test(e.innerText || ''))
      return pane ? pane.innerText : '(no pane)'
    })()`
  )
  reporter.check('插件页内容已渲染', typeof pluginText === 'string' && pluginText !== '(no pane)')
  reporter.check('测试插件出现在列表', typeof pluginText === 'string' && pluginText.includes(pluginName), pluginName)
  reporter.check('测试插件默认启用', typeof pluginText === 'string' && /已启用|Enabled/.test(pluginText))

  const readPlugin = `(() => {
    const item = [...document.querySelectorAll('.plugin-item')].find((e) => /${pluginName}/.test(e.innerText || ''))
    return item ? item.innerText : '(no item)'
  })()`
  const toggleSwitch = `(() => {
    const item = [...document.querySelectorAll('.plugin-item')].find((e) => /${pluginName}/.test(e.innerText || ''))
    const sw = item && item.querySelector('[role="switch"]')
    if (!sw) return 'no-switch'
    sw.click()
    return 'clicked'
  })()`

  reporter.check('插件开关可点击（停用）', (await evalIn(session, toggleSwitch)) === 'clicked')
  await sleep(1600)
  const disabledText = await evalIn(session, readPlugin)
  reporter.check('插件可停用', /已停用|Disabled/.test(String(disabledText)))

  reporter.check('插件开关可再次点击（启用）', (await evalIn(session, toggleSwitch)) === 'clicked')
  await sleep(1600)
  const enabledText = await evalIn(session, readPlugin)
  reporter.check('插件可重新启用', /已启用|Enabled/.test(String(enabledText)))
  await capture(session, path.join(outDir, '03-settings-plugins.png'))

  // —— 关闭设置、新建任务、请求头 ——
  await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(900)
  reporter.check('设置弹窗可按 Esc 关闭', (await evalIn(session, `!document.querySelector('.settings-dialog-body')`)) === true)

  const newTaskOpen = await evalIn(
    session,
    `(() => {
      const btn = document.querySelector('.app-action-btn')
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('点击新建任务按钮', newTaskOpen === 'clicked', String(newTaskOpen))
  await sleep(1400)
  const newTaskText = await evalIn(
    session,
    `(() => { const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null && el.querySelector('textarea')); return m ? m.innerText : '(no modal)' })()`
  )
  reporter.check('新建任务弹窗可打开', /新建|New|链接|URL/i.test(String(newTaskText)))
  reporter.check('新建任务包含请求头区域', /请求头|Request headers|Referer|User-Agent/i.test(String(newTaskText)))

  // —— 流媒体页：验证 yt-dlp 入口（已安装显示表单 / 未安装显示按需下载）——
  const streamTab = await evalIn(
    session,
    `(() => {
      const tab = [...document.querySelectorAll('.n-modal .n-tabs-tab')].find((e) => /流媒体|Streaming/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到流媒体页', streamTab === 'clicked', String(streamTab))
  await sleep(900)
  const streamText = await evalIn(
    session,
    `(() => { const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null); return m ? m.innerText : '(no modal)' })()`
  )
  reporter.check(
    '流媒体页提供按需下载或已安装表单',
    /下载 yt-dlp|Download yt-dlp|当前平台暂不支持|does not support automatic|输入视频|Enter video/i.test(String(streamText)),
    String(streamText).slice(0, 80)
  )
  // 回到链接下载页，后续仍按原流程提交真实下载任务
  const backToUriTab = await evalIn(
    session,
    `(() => {
      const tab = [...document.querySelectorAll('.n-modal .n-tabs-tab')].find((e) => /链接下载|URL Download/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  reporter.check('切回链接下载页', backToUriTab === 'clicked', String(backToUriTab))
  await sleep(600)
  await capture(session, path.join(outDir, '04-new-task.png'))

  // —— 真实下载：填 URL + 临时目录并提交，等待引擎完成 ——
  const filledUrl = await evalIn(
    session,
    `(() => {
      const ta = document.querySelector('.n-modal textarea')
      if (!ta) return 'no-textarea'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(downloadUrl)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 'filled'
    })()`
  )
  reporter.check('填写下载链接', filledUrl === 'filled', String(filledUrl))

  const filledDir = await evalIn(
    session,
    `(() => {
      const item = [...document.querySelectorAll('.n-form-item')].find((e) => /保存目录|Download directory|Save to/i.test(e.innerText || ''))
      const input = item && item.querySelector('input')
      if (!input) return 'no-dir-input'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(tempDownloadDir)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 'filled'
    })()`
  )
  reporter.check('填写保存目录', filledDir === 'filled', String(filledDir))

  const submitted = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.n-modal .n-button')].find((e) => /开始下载|Start download/i.test(e.innerText || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('提交下载任务', submitted === 'clicked', String(submitted))

  const modalClosed = await (async () => {
    for (let i = 0; i < 20; i++) {
      await sleep(500)
      if (await evalIn(session, `![...document.querySelectorAll('.n-modal')].some((el) => el.offsetParent !== null)`)) return true
    }
    return false
  })()
  reporter.check('提交后弹窗自动关闭', modalClosed === true)

  const fileName = path.basename(new URL(downloadUrl).pathname)
  const downloadedPath = path.join(tempDownloadDir, fileName)
  const taskVisible = await (async () => {
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      const text = await evalIn(session, 'document.body.innerText')
      if (typeof text === 'string' && text.includes(fileName)) return true
    }
    return false
  })()
  reporter.check('下载列表出现新任务', taskVisible === true, fileName)
  await capture(session, path.join(outDir, '05-task-downloading.png'))

  let completed = false
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(downloadedPath) && !fs.existsSync(`${downloadedPath}.aria2`)) {
      completed = true
      break
    }
    await sleep(1000)
  }
  const size = completed ? fs.statSync(downloadedPath).size : 0
  reporter.check('任务实际下载完成', completed && size === downloadBytes, `${downloadedPath}（${size} bytes）`)

  // —— 任务详情抽屉（切到"下载完成"列表）——
  const nav = await evalIn(
    session,
    `(() => {
      const item = [...document.querySelectorAll('.n-menu-item-content')].find((e) => /下载完成|Completed/i.test(e.textContent || ''))
      if (!item) return 'no-menu'
      item.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到下载完成列表', nav === 'clicked', String(nav))
  await sleep(1500)
  const detailClicked = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.task-action-btn')].find((b) => /详情|View detail|Details/i.test(b.title || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('任务行内详情按钮可点击', detailClicked === 'clicked', String(detailClicked))
  await sleep(1500)
  const drawerText = await evalIn(
    session,
    `(() => { const d = document.querySelector('.n-drawer'); return d ? d.innerText : '(no drawer)' })()`
  )
  reporter.check('任务详情抽屉可打开', typeof drawerText === 'string' && drawerText !== '(no drawer)', String(drawerText).slice(0, 80))
  reporter.check('详情包含刚下载的文件名', typeof drawerText === 'string' && drawerText.includes(fileName))
  await capture(session, path.join(outDir, '06-task-detail.png'))

  // —— 自动解压：真实 zip 走 IPC ——
  const dirInfo = await evalIn(session, 'window.electronAPI.getDefaultDownloadDir()')
  const downloadDir = dirInfo && typeof dirInfo.path === 'string' ? dirInfo.path : ''
  reporter.check('能取得默认下载目录', Boolean(downloadDir), JSON.stringify(dirInfo))
  if (downloadDir) {
    const helloName = `e2e-hello-${stamp}.txt`
    const helloPayload = `aria2-desktop e2e ${stamp}`
    const zipPath = path.join(downloadDir, `e2e-extract-${stamp}.zip`)
    const helloPath = path.join(downloadDir, helloName)
    try {
      fs.writeFileSync(zipPath, createZip([{ name: helloName, data: helloPayload }]))
      const extracted = await evalIn(session, `window.electronAPI.extractArchive(${JSON.stringify(zipPath)})`)
      reporter.check('下载目录内 zip 解压成功', extracted?.success === true && extracted?.extracted === true, JSON.stringify(extracted))
      const contentOk = fs.existsSync(helloPath) && fs.readFileSync(helloPath, 'utf8').trim() === helloPayload
      reporter.check('解压出的文件内容正确', contentOk, helloPath)
    } finally {
      fs.rmSync(zipPath, { force: true })
      fs.rmSync(helloPath, { force: true })
    }

    const outside = await evalIn(
      session,
      `window.electronAPI.extractArchive(${JSON.stringify(outsideExistingFile())})`
    )
    reporter.check('下载目录外文件被拒绝解压', outside?.success === false && outside?.reason === 'path_not_allowed', JSON.stringify(outside))

    const missingPath = path.join(downloadDir, `e2e-missing-${stamp}.zip`)
    const missing = await evalIn(session, `window.electronAPI.extractArchive(${JSON.stringify(missingPath)})`)
    reporter.check('不存在的压缩包返回 not_found', missing?.success === false && missing?.reason === 'not_found', JSON.stringify(missing))
  }
}
