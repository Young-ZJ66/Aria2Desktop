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

/** 测试专用 bencode 编码 + 构造一个含 2 个文件的最小种子（验证下载前文件勾选） */
function bencode(value) {
  if (typeof value === 'number') return `i${value}e`
  if (typeof value === 'string') return `${Buffer.byteLength(value)}:${value}`
  if (Array.isArray(value)) return `l${value.map(bencode).join('')}e`
  return `d${Object.entries(value).map(([k, v]) => `${bencode(k)}${bencode(v)}`).join('')}e`
}

function torrentBase64() {
  const torrent = {
    announce: 'http://tracker.example/announce',
    info: {
      name: 'e2e-torrent',
      files: [
        { length: 1024, path: ['video.mp4'] },
        { length: 2048, path: ['doc.pdf'] }
      ]
    }
  }
  return Buffer.from(bencode(torrent), 'utf8').toString('base64')
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
  const filterText = await evalIn(
    session,
    `(() => [...document.querySelectorAll('.task-actions .n-select')].map((s) => (s.innerText || '').trim()).join('|'))()`
  )
  reporter.check(
    '任务列表提供分类与类型筛选',
    /全部分类|All categories/i.test(String(filterText)) && /全部类型|All types/i.test(String(filterText)),
    String(filterText)
  )
  const tableHeaders = await evalIn(
    session,
    `(() => [...document.querySelectorAll('.n-data-table-th')].map((th) => (th.innerText || '').trim()).join('|'))()`
  )
  reporter.check('任务列表默认不显示 GID 列', !/GID/i.test(String(tableHeaders)), String(tableHeaders))
  await capture(session, path.join(outDir, '01-main.png'))

  // —— 设置：打开、版本号、自动解压开关 ——
  const settingsOpenStart = Date.now()
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
  // 记录首屏渲染耗时（仅输出，不作为断言：CI 机器速度波动大）
  let settingsFirstPaintMs = -1
  for (let attempt = 0; attempt < 100; attempt++) {
    const painted = await evalIn(session, `!!document.querySelector('.settings-dialog-body .settings-page')`)
    if (painted) {
      settingsFirstPaintMs = Date.now() - settingsOpenStart
      break
    }
    await sleep(20)
  }
  console.log(`    首次打开设置页首屏渲染耗时：${settingsFirstPaintMs}ms`)
  await sleep(900)
  const settingsText = await evalIn(
    session,
    `(() => { const m = document.querySelector('.settings-dialog-body'); return m ? m.innerText : '(no settings)' })()`
  )
  reporter.check('设置弹窗可打开', settingsText !== '(no settings)')
  // 打开设置页时不应自动聚焦搜索框（从搜索框开始输入会误导用户）
  const settingsAutoFocus = await evalIn(
    session,
    `(() => {
      const input = [...document.querySelectorAll('.settings-dialog-body input')].find((el) => /搜索设置项|Search settings/i.test(el.placeholder || ''))
      return { activeIsSearch: !!input && document.activeElement === input }
    })()`
  )
  reporter.check(
    '打开设置页不自动聚焦搜索框',
    !!settingsAutoFocus && settingsAutoFocus.activeIsSearch === false,
    JSON.stringify(settingsAutoFocus)
  )
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

  // 高级页签直接显示：不再有「显示高级设置」开关
  const advancedToggleExists = await evalIn(session, `!!document.querySelector('.settings-advanced-toggle')`)
  reporter.check('设置页无「显示高级设置」开关', advancedToggleExists === false)
  const settingsNavText = await evalIn(
    session,
    `(() => [...document.querySelectorAll('.settings-dialog-body .n-tabs-tab')].map((tab) => (tab.innerText || '').trim()).join('|'))()`
  )
  reporter.check(
    '设置页直接显示 RPC 与高级页签',
    /RPC/i.test(String(settingsNavText)) && /高级|Advanced/i.test(String(settingsNavText)),
    String(settingsNavText)
  )

  // 首次打开只挂载当前页签：避免一次性渲染 11 个设置页导致打开卡顿
  const lazyPaneState = await evalIn(
    session,
    `(() => {
      const panes = [...document.querySelectorAll('.settings-dialog-body .n-tab-pane')]
      return { total: panes.length, mounted: panes.filter((p) => !!p.querySelector('.settings-page')).length }
    })()`
  )
  reporter.check(
    '首次打开设置页只挂载当前页签',
    !!lazyPaneState && lazyPaneState.total === 1 && lazyPaneState.mounted === 1,
    JSON.stringify(lazyPaneState)
  )

  // —— 设置项搜索：跨页签模糊查找 → 点击结果跳转并高亮 ——
  const searchInputFound = await evalIn(
    session,
    `(() => {
      const input = [...document.querySelectorAll('.settings-dialog-body input')].find((el) => /搜索设置项|Search settings/i.test(el.placeholder || ''))
      return input ? 'found' : 'no-input'
    })()`
  )
  reporter.check('设置弹窗提供设置项搜索', searchInputFound === 'found', String(searchInputFound))

  const searchFocused = await evalIn(
    session,
    `(() => {
      const input = [...document.querySelectorAll('.settings-dialog-body input')].find((el) => /搜索设置项|Search settings/i.test(el.placeholder || ''))
      if (!input) return 'no-input'
      input.focus()
      return document.activeElement === input ? 'focused' : 'not-focused'
    })()`
  )
  reporter.check('设置搜索框可聚焦', searchFocused === 'focused', String(searchFocused))

  // 输入任意字符触发按需挂载：跨页签搜索必须先让所有页签渲染出来
  await session.send('Input.insertText', { text: 'a' })
  let mountedPanesState = null
  for (let attempt = 0; attempt < 30; attempt++) {
    mountedPanesState = await evalIn(
      session,
      `(() => {
        const panes = [...document.querySelectorAll('.settings-dialog-body .n-tab-pane')]
        return { total: panes.length, mounted: panes.filter((p) => !!p.querySelector('.settings-page')).length }
      })()`
    )
    if (mountedPanesState && mountedPanesState.total >= 11 && mountedPanesState.mounted >= 11) break
    await sleep(100)
  }
  reporter.check(
    '搜索时按需挂载全部页签',
    !!mountedPanesState && mountedPanesState.total >= 11 && mountedPanesState.mounted >= 11,
    JSON.stringify(mountedPanesState)
  )
  // 设置页（下载设置）提供默认 User-Agent 选项（需在全部页签挂载后检查）
  const settingsPanesText = await evalIn(
    session,
    `(() => [...document.querySelectorAll('.settings-dialog-body .n-tab-pane')].map((pane) => pane.textContent || '').join('\\n'))()`
  )
  reporter.check(
    '设置页支持默认 User-Agent',
    /默认\s*User-Agent|Default User-Agent/i.test(String(settingsPanesText))
  )
  // 清空输入，恢复干净状态后再取关键词
  await evalIn(
    session,
    `(() => {
      const input = [...document.querySelectorAll('.settings-dialog-body input')].find((el) => /搜索设置项|Search settings/i.test(el.placeholder || ''))
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`
  )
  await sleep(200)

  // 从「非当前页签」里取一个真实标签作为关键词，验证搜索能跨页命中
  const searchQueryInfo = await evalIn(
    session,
    `(() => {
      const panes = [...document.querySelectorAll('.settings-dialog-body .n-tab-pane')]
      const activeIndex = panes.findIndex((pane) => pane.offsetParent !== null)
      let query = ''
      for (let i = 0; i < panes.length && !query; i++) {
        if (i === activeIndex) continue
        // 隐藏页签用 textContent：innerText 在未渲染元素上取不到
        const label = [...panes[i].querySelectorAll('.n-form-item-label')]
          .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
          .find((text) => text && text.length >= 2)
        if (label) query = label
      }
      return JSON.stringify({
        query,
        paneCount: panes.length,
        activeIndex,
        labels: panes.map((pane) => pane.querySelectorAll('.n-form-item-label').length)
      })
    })()`
  )
  const searchQueryState = JSON.parse(String(searchQueryInfo || '{}'))
  const searchQuery = searchQueryState.query || ''
  reporter.check('可提取跨页签的搜索关键词', typeof searchQuery === 'string' && searchQuery.length >= 2, String(searchQueryInfo))

  // 用真实输入事件（而非 JS 直接改 value），确保 v-model 正常更新
  await session.send('Input.insertText', { text: searchQuery })
  await sleep(600)
  const searchPanel = await evalIn(
    session,
    `(() => {
      const panel = document.querySelector('.settings-search-panel')
      if (!panel) return null
      const items = [...panel.querySelectorAll('.settings-search-item')].map((el) => (el.innerText || '').replace(/\\n/g, '|'))
      return { count: items.length, first: items[0] || '' }
    })()`
  )
  reporter.check('设置搜索返回匹配结果', !!searchPanel && searchPanel.count > 0, JSON.stringify(searchPanel))
  await capture(session, path.join(outDir, '02b-settings-search.png'))

  const searchClicked = await evalIn(
    session,
    `(() => {
      const item = document.querySelector('.settings-search-panel .settings-search-item')
      if (!item) return 'no-item'
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      item.click()
      return 'clicked'
    })()`
  )
  reporter.check('设置搜索结果可点击跳转', searchClicked === 'clicked', String(searchClicked))
  await sleep(800)
  const searchJump = await evalIn(
    session,
    `(() => {
      const hit = document.querySelector('.settings-search-hit')
      const activeTab = document.querySelector('.n-tabs-tab--active')
      return {
        hasHit: !!hit,
        hitText: hit ? (hit.innerText || '').replace(/\\n/g, '|').slice(0, 60) : '',
        tab: activeTab ? (activeTab.innerText || '').trim() : ''
      }
    })()`
  )
  reporter.check('搜索跳转后目标项高亮', !!searchJump && searchJump.hasHit === true, JSON.stringify(searchJump))

  // —— 常规设置页：窗口位置记忆开关（用户可以关掉"记住窗口位置和大小"） ——
  const clickedGeneralTab = await evalIn(
    session,
    `(() => {
      const tab = [...document.querySelectorAll('.settings-dialog-body .n-tabs-tab')]
        .find((e) => /常规设置|General/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到「常规设置」页', clickedGeneralTab === 'clicked', String(clickedGeneralTab))
  await sleep(900)
  const keepWindowStateRow = await evalIn(
    session,
    `(() => {
      const item = [...document.querySelectorAll('.settings-dialog-body .n-form-item')]
        .find((el) => /记住窗口位置和大小|Remember window position/i.test(el.innerText || ''))
      if (!item) return null
      const sw = item.querySelector('.app-switch')
      return { hasSwitch: !!sw, checked: sw ? sw.getAttribute('aria-checked') : null }
    })()`
  )
  reporter.check(
    '常规设置提供窗口位置记忆开关',
    !!keepWindowStateRow && keepWindowStateRow.hasSwitch === true,
    JSON.stringify(keepWindowStateRow)
  )

  // —— 工具与扩展页：浏览器扩展卡片要显示连接状态（扩展版本可见） ——
  const clickedExtensionTab = await evalIn(
    session,
    `(() => {
      const tab = [...document.querySelectorAll('.settings-dialog-body .n-tabs-tab')]
        .find((e) => /工具与扩展|Tools|Extensions/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到「工具与扩展」页', clickedExtensionTab === 'clicked', String(clickedExtensionTab))
  await sleep(1200)
  const extensionCardText = await evalIn(
    session,
    `(() => {
      const card = [...document.querySelectorAll('.settings-dialog-body .n-card')]
        .find((c) => /浏览器扩展|Browser Extension/i.test(c.innerText || ''))
      return card ? card.innerText : '(no card)'
    })()`
  )
  // 状态行有三种合法文案（未连接 / 已连接 / 旧版不上报版本），任一出现即说明 IPC 接线成功
  reporter.check(
    '扩展卡片显示连接状态',
    /扩展已连接|还没有记录到扩展的连接|Extension connected|No connection from the extension/i.test(String(extensionCardText)),
    String(extensionCardText).replace(/\n/g, '|').slice(0, 140)
  )

  // —— 高级设置页：应用日志目录（报障时用户得能一键找到 main.log） ——
  const clickedAdvancedTab = await evalIn(
    session,
    `(() => {
      const tab = [...document.querySelectorAll('.settings-dialog-body .n-tabs-tab')]
        .find((e) => /高级设置|Advanced/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到「高级设置」页', clickedAdvancedTab === 'clicked', String(clickedAdvancedTab))
  await sleep(1200)
  const logsRow = await evalIn(
    session,
    `(() => {
      const body = document.querySelector('.settings-dialog-body')
      if (!body) return { label: false, path: '' }
      const labels = [...body.querySelectorAll('.n-form-item-label')].map((e) => (e.textContent || '').trim())
      const inputs = [...body.querySelectorAll('input')].map((i) => i.value || '')
      return {
        label: labels.some((l) => /应用日志目录|Application Log Directory/i.test(l)),
        path: inputs.find((v) => /logs[\\\\/]?$/i.test(v)) || ''
      }
    })()`
  )
  reporter.check(
    '高级设置显示应用日志目录',
    logsRow?.label === true && !!logsRow?.path,
    JSON.stringify(logsRow).slice(0, 160)
  )

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
  await sleep(700)
  const permissionDialogText = await evalIn(
    session,
    `(() => {
      const dialog = [...document.querySelectorAll('.n-dialog')].find((el) => el.offsetParent !== null)
      return dialog ? dialog.innerText : ''
    })()`
  )
  reporter.check(
    '启用插件时展示权限确认',
    /权限|permissions/i.test(String(permissionDialogText)),
    String(permissionDialogText).slice(0, 80)
  )
  const permissionConfirmed = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.n-dialog .n-button')].find((el) => /仍要启用|Enable anyway/i.test(el.innerText || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('权限确认后可启用插件', permissionConfirmed === 'clicked', String(permissionConfirmed))
  await sleep(1600)
  const enabledText = await evalIn(session, readPlugin)
  reporter.check('插件可重新启用', /已启用|Enabled/.test(String(enabledText)))
  await capture(session, path.join(outDir, '03-settings-plugins.png'))

  // —— 插件页：打开目录按钮与卡片标题同级；提示可临时关闭（本次运行）或永久「不再显示」 ——
  const pluginPageState = () => evalIn(
    session,
    `(() => {
      const pane = [...document.querySelectorAll('.n-tab-pane')].find((e) => e.offsetParent !== null && /插件|Plugins/i.test(e.innerText || ''))
      if (!pane) return null
      const header = pane.querySelector('.n-card-header')
      const extra = pane.querySelector('.n-card-header__extra')
      const hint = pane.querySelector('.plugin-hint')
      const list = pane.querySelector('.plugin-list')
      return {
        hasHeader: !!header,
        hasDirButton: !!(extra && [...extra.querySelectorAll('.n-button')].some((b) => /打开插件目录|Open folder/i.test(b.innerText || ''))),
        headerBeforeList: !!(header && list && (header.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)),
        hasHint: !!hint,
        hasDontShowAgain: !!(hint && [...hint.querySelectorAll('.n-button')].some((b) => /不再显示|Don't show again/i.test(b.innerText || '')))
      }
    })()`
  )
  const initialHintState = await pluginPageState()
  reporter.check(
    '插件页打开目录按钮位于卡片标题行',
    !!initialHintState && initialHintState.hasDirButton === true && initialHintState.headerBeforeList === true,
    JSON.stringify(initialHintState)
  )
  reporter.check(
    '插件提示提供关闭与「不再显示」',
    !!initialHintState && initialHintState.hasHint === true && initialHintState.hasDontShowAgain === true,
    JSON.stringify(initialHintState)
  )
  // 打开目录失败的原根因：渲染层拿 '%APPDATA%/...' 提示文本当路径。现在路径由主进程解析
  const pluginDirInfo = await evalIn(session, `window.electronAPI.pluginsDir()`)
  reporter.check(
    '插件目录由主进程返回真实路径',
    !!pluginDirInfo && pluginDirInfo.success === true && fs.existsSync(String(pluginDirInfo.path)),
    JSON.stringify(pluginDirInfo)
  )

  const closedHint = await evalIn(
    session,
    `(() => {
      const pane = [...document.querySelectorAll('.n-tab-pane')].find((e) => e.offsetParent !== null && /插件|Plugins/i.test(e.innerText || ''))
      const hint = pane ? pane.querySelector('.plugin-hint') : null
      const btn = hint ? [...hint.querySelectorAll('.n-button')].find((b) => /关闭|Close/i.test(b.title || b.getAttribute('aria-label') || '')) : null
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('插件提示可临时关闭', closedHint === 'clicked', String(closedHint))
  await sleep(300)
  const afterCloseState = await pluginPageState()
  reporter.check('临时关闭后提示立即隐藏', !!afterCloseState && afterCloseState.hasHint === false, JSON.stringify(afterCloseState))

  // 关闭设置再重新打开：提示应保持隐藏（sessionStorage 生效）
  await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(800)
  const reopenedForSession = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.footer-btn')].find((b) => /设置|Settings/i.test(b.title || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('重新打开设置弹窗（验证临时关闭）', reopenedForSession === 'clicked', String(reopenedForSession))
  await sleep(1400)
  const reopenedTab = await evalIn(
    session,
    `(() => {
      const pane = [...document.querySelectorAll('.n-tab-pane')].find((e) => e.offsetParent !== null && e.querySelector('.plugin-toolbar'))
      if (pane) return 'already'
      const tab = [...document.querySelectorAll('.n-tabs-tab')].find((e) => /插件|Plugins/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  if (reopenedTab === 'clicked') await sleep(1200)
  const sessionState = await pluginPageState()
  reporter.check('本次运行内重新进入插件页仍不显示提示', !!sessionState && sessionState.hasHint === false, JSON.stringify(sessionState))

  // 清掉 sessionStorage 等价于「下次启动应用」：提示应重新出现
  await evalIn(session, `(() => { sessionStorage.clear(); return true })()`)
  await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(800)
  await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.footer-btn')].find((b) => /设置|Settings/i.test(b.title || ''))
      if (btn) btn.click()
      return true
    })()`
  )
  await sleep(1400)
  await evalIn(
    session,
    `(() => {
      const pane = [...document.querySelectorAll('.n-tab-pane')].find((e) => e.offsetParent !== null && e.querySelector('.plugin-toolbar'))
      if (pane) return 'already'
      const tab = [...document.querySelectorAll('.n-tabs-tab')].find((e) => /插件|Plugins/i.test(e.textContent || ''))
      if (tab) tab.click()
      return 'clicked'
    })()`
  )
  await sleep(1200)
  const restoredState = await pluginPageState()
  reporter.check('下次启动后插件提示重新显示', !!restoredState && restoredState.hasHint === true, JSON.stringify(restoredState))

  const hiddenForever = await evalIn(
    session,
    `(() => {
      const pane = [...document.querySelectorAll('.n-tab-pane')].find((e) => e.offsetParent !== null && /插件|Plugins/i.test(e.innerText || ''))
      const hint = pane ? pane.querySelector('.plugin-hint') : null
      const btn = hint ? [...hint.querySelectorAll('.n-button')].find((b) => /不再显示|Don't show again/i.test(b.innerText || '')) : null
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('点击「不再显示」可永久关闭提示', hiddenForever === 'clicked', String(hiddenForever))
  await sleep(300)
  const foreverState = await pluginPageState()
  reporter.check('永久关闭后提示隐藏', !!foreverState && foreverState.hasHint === false, JSON.stringify(foreverState))
  const foreverFlag = await evalIn(
    session,
    `(() => { try { return localStorage.getItem('aria2-desktop-plugin-hint-hidden') } catch { return null } })()`
  )
  reporter.check('永久关闭已写入 localStorage', foreverFlag === '1', String(foreverFlag))


  // —— 工具与扩展页：yt-dlp / ffmpeg 安装入口 + 浏览器扩展 ——
  const componentsTab = await evalIn(
    session,
    `(() => {
      const tab = [...document.querySelectorAll('.n-tabs-tab')].find((e) => /工具与扩展|Tools & Extension/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到工具与扩展页', componentsTab === 'clicked', String(componentsTab))
  await sleep(1200)
  const componentsText = await evalIn(
    session,
    `(() => {
      const pane = [...document.querySelectorAll('.n-tab-pane')].find((e) => e.offsetParent !== null && /yt-dlp/i.test(e.innerText || ''))
      return pane ? pane.innerText : '(no pane)'
    })()`
  )
  reporter.check(
    '组件页包含 yt-dlp 与 ffmpeg',
    typeof componentsText === 'string' && /yt-dlp/i.test(componentsText) && /ffmpeg/i.test(componentsText),
    String(componentsText).slice(0, 80)
  )
  reporter.check(
    '组件页包含浏览器扩展入口',
    typeof componentsText === 'string' && /浏览器扩展|Browser extension|Get Extension|获取浏览器扩展/i.test(componentsText)
  )
  reporter.check(
    '组件页分组已更名为媒体工具',
    typeof componentsText === 'string' && /媒体工具|Media Tools/i.test(componentsText),
    String(componentsText).slice(0, 80)
  )
  await capture(session, path.join(outDir, '03-settings-components.png'))

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
  // 新建任务弹窗的几何断言一律在固定视口下做：内容区用的是 `100vh - 170px`，
  // CI runner 只有 720p、本地多为 1080p+，同一份布局在不同高度下 vh 取值不同，
  // 结论会相反（GitHub Actions run 20261102150813 就是因为这个红的：517 > 511）。
  // 1200×800 取的是应用默认窗口尺寸（electron/controllers/WindowController.ts:177-178）。
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const newTaskText = await evalIn(
    session,
    `(() => { const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null && el.querySelector('textarea')); return m ? m.innerText : '(no modal)' })()`
  )
  reporter.check('新建任务弹窗可打开', /新建|New|链接|URL/i.test(String(newTaskText)))
  // 布局诊断：确认页签容器与输入框的边界（用于排查右侧被裁切）
  const paneMetrics = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return ''
      const pick = (sel) => {
        const el = modal.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return {
          left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
          boxSizing: s.boxSizing, cssWidth: s.width, padding: s.padding, overflow: s.overflow
        }
      }
      return JSON.stringify({
        content: pick('.n-card-content'),
        wrapper: pick('.n-tabs-pane-wrapper'),
        pane: pick('.n-tab-pane'),
        input: pick('.n-form-item .n-input')
      })
    })()`
  )
  const layoutState = JSON.parse(String(paneMetrics || '{}'))
  reporter.check(
    '输入框未超出页签容器（右侧无裁切）',
    !!layoutState.input && !!layoutState.wrapper
      && layoutState.input.right <= layoutState.wrapper.right
      && layoutState.input.left >= layoutState.wrapper.left
      && layoutState.wrapper.right - layoutState.input.right >= 6,
    String(paneMetrics)
  )
  // 字段间距：n-form-item 默认还有 24px 的空校验反馈区，必须一起量出来才可信
  const fieldGap = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return null
      const items = [...modal.querySelectorAll('.n-form-item')]
      const dirItem = items.find((el) => /保存目录|Download directory/i.test(el.innerText || ''))
      const catItem = items.find((el) => /分类|Category/i.test(el.innerText || ''))
      if (!dirItem || !catItem) return null
      const dirBlank = dirItem.querySelector('.n-form-item-blank')
      const catLabel = catItem.querySelector('.n-form-item-label')
      const dirRect = dirBlank.getBoundingClientRect()
      const catRect = catLabel.getBoundingClientRect()
      return {
        gap: Math.round(catRect.top - dirRect.bottom),
        dirMarginBottom: getComputedStyle(dirItem).marginBottom,
        feedbackHeight: getComputedStyle(dirItem).getPropertyValue('--n-feedback-height').trim()
      }
    })()`
  )
  reporter.check(
    '字段标题与上一个输入框间距已收紧（≤16px）',
    !!fieldGap && fieldGap.feedbackHeight === '0' && fieldGap.gap >= 4 && fieldGap.gap <= 16,
    JSON.stringify(fieldGap)
  )
  // 聚焦输入框截图：用于检查焦点光晕是否被容器裁切
  await evalIn(session, `(() => { const ta = document.querySelector('.n-modal textarea'); if (ta) ta.focus(); return true })()`)
  await sleep(400)
  await capture(session, path.join(outDir, '04c-focus.png'))
  // 单行输入框聚焦截图：检查左右光晕是否完整
  await evalIn(
    session,
    `(() => {
      const input = [...document.querySelectorAll('.n-modal input')].find((el) => /留空使用默认目录|Leave empty/i.test(el.placeholder || ''))
      if (input) input.focus()
      return true
    })()`
  )
  await sleep(300)
  await capture(session, path.join(outDir, '04d-focus-dir.png'))
  // 放大截图：确认焦点光晕四边粗细一致（左右不再被 tab pane 裁切）
  const focusRect = await evalIn(
    session,
    `(() => {
      const active = document.activeElement
      const root = active && active.closest ? active.closest('.n-input') : null
      if (!root) return null
      const r = root.getBoundingClientRect()
      return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }
    })()`
  )
  if (focusRect) {
    const shot = await session.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: focusRect.x, y: focusRect.y, width: focusRect.width, height: focusRect.height, scale: 4 }
    })
    fs.writeFileSync(path.join(outDir, '04e-focus-zoom.png'), Buffer.from(shot.result.data, 'base64'))
  }

  // 高级设置保持折叠：空表单（未填链接时不含目录提示）应一屏放得下
  const clearedUrl = await evalIn(
    session,
    `(() => {
      const ta = document.querySelector('.n-modal textarea')
      if (!ta) return 'no-textarea'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 'cleared'
    })()`
  )
  if (clearedUrl === 'cleared') await sleep(300)
  const uriLayout = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return null
      const content = modal.querySelector('.n-card-content')
      const submitBtn = [...modal.querySelectorAll('.n-button')].find((el) => /开始下载|Start download/i.test(el.innerText || ''))
      const collapseHeader = [...modal.querySelectorAll('.n-collapse-item__header-main')].some((e) => /高级设置|Advanced/i.test(e.textContent || ''))
      return {
        found: !!content,
        scrolls: !!content && content.scrollHeight > content.clientHeight + 1,
        clientHeight: content ? content.clientHeight : 0,
        scrollHeight: content ? content.scrollHeight : 0,
        hasSubmit: !!submitBtn,
        hasCollapseHeader: collapseHeader
      }
    })()`
  )
  reporter.check('操作按钮位于弹窗 footer', uriLayout?.hasSubmit === true)
  reporter.check('高级设置提供折叠入口', uriLayout?.hasCollapseHeader === true, JSON.stringify(uriLayout))
  reporter.check('收起高级设置时内容无需滚动', uriLayout?.found === true && uriLayout?.scrolls === false, JSON.stringify(uriLayout))

  // 未识别文件类型时，目录提示合并为一行（不再是「保存到」+「未能识别」两行）
  await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return false
      const ta = modal.querySelector('textarea')
      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, 'https://example.com/video/123')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const dirItem = [...modal.querySelectorAll('.n-form-item')].find((el) => /保存目录|Download directory/i.test(el.innerText || ''))
      const dirInput = dirItem ? dirItem.querySelector('input') : null
      if (dirInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(dirInput, ${JSON.stringify(tempDownloadDir)})
        dirInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return true
    })()`
  )
  await sleep(350)
  const dirTipState = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return null
      const tips = [...modal.querySelectorAll('.dir-tip')].map((el) => (el.innerText || '').trim())
      return { count: tips.length, text: tips.join(' | ') }
    })()`
  )
  reporter.check(
    '未识别类型的目录提示合并为一行',
    !!dirTipState && dirTipState.count === 1 && /类型待识别|type unknown/i.test(dirTipState.text),
    JSON.stringify(dirTipState)
  )
  await capture(session, path.join(outDir, '04f-dir-tip.png'))
  // 放大截图：核对字段间距确实收紧（含默认被隐藏的校验反馈区）
  const spacingRect = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return null
      const items = [...modal.querySelectorAll('.n-form-item')]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return null
      const r1 = first.getBoundingClientRect()
      const r2 = last.getBoundingClientRect()
      return { x: r1.x - 8, y: r1.y - 8, width: r1.width + 16, height: r2.bottom - r1.top + 16 }
    })()`
  )
  if (spacingRect) {
    const shot = await session.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...spacingRect, scale: 1.5 }
    })
    fs.writeFileSync(path.join(outDir, '04g-field-gap.png'), Buffer.from(shot.result.data, 'base64'))
  }

  const advancedExpanded = await evalIn(
    session,
    `(() => {
      const header = [...document.querySelectorAll('.n-modal .n-collapse-item__header-main')].find((e) => /高级设置|Advanced/i.test(e.textContent || ''))
      if (!header) return 'no-header'
      header.click()
      return 'clicked'
    })()`
  )
  reporter.check('高级设置可展开', advancedExpanded === 'clicked', String(advancedExpanded))
  await sleep(700)
  const advancedText = await evalIn(
    session,
    `(() => { const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null && el.querySelector('textarea')); return m ? m.innerText : '(no modal)' })()`
  )
  reporter.check('高级设置包含请求头区域', /请求头|Request headers|Referer|User-Agent/i.test(String(advancedText)))
  reporter.check(
    '高级设置包含单任务限速与代理',
    /单任务下载限速|Download Limit/i.test(String(advancedText)) && /任务代理|Task Proxy/i.test(String(advancedText))
  )

  // User-Agent 预设：下拉选择框选 Chrome → 输入框被填入浏览器 UA
  const uaPresetOpened = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return 'no-modal'
      const select = modal.querySelector('.ua-preset-select')
      if (!select) return 'no-select'
      const trigger = select.querySelector('.n-base-selection') || select
      trigger.click()
      return 'clicked'
    })()`
  )
  reporter.check('User-Agent 提供预设下拉选择框', uaPresetOpened === 'clicked', String(uaPresetOpened))
  await sleep(500)
  const uaPresetPicked = await evalIn(
    session,
    `(() => {
      const options = [...document.querySelectorAll('.n-base-select-option')].filter((el) => el.offsetParent !== null)
      const chrome = options.find((el) => /Chrome/i.test(el.innerText || ''))
      if (!chrome) return 'no-option'
      chrome.click()
      return 'clicked'
    })()`
  )
  reporter.check('可选择常用 User-Agent 预设', uaPresetPicked === 'clicked', String(uaPresetPicked))
  await sleep(300)
  const uaPresetValue = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return ''
      const item = [...modal.querySelectorAll('.option-item')].find((el) => /User-Agent/i.test(el.innerText || ''))
      const input = item ? item.querySelector('input') : null
      return input ? input.value : ''
    })()`
  )
  reporter.check(
    '预设 User-Agent 已填入输入框',
    typeof uaPresetValue === 'string' && /^Mozilla\/5\.0 .+?Chrome\//.test(uaPresetValue),
    String(uaPresetValue).slice(0, 60)
  )
  const modalFits = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return null
      const rect = modal.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= window.innerHeight + 1
    })()`
  )
  reporter.check('新建任务弹窗不超出窗口高度', modalFits === true)
  const footerVisible = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return null
      const btn = [...modal.querySelectorAll('.n-button')].find((el) => /开始下载|Start download/i.test(el.innerText || ''))
      if (!btn) return 'no-btn'
      const br = btn.getBoundingClientRect()
      const mr = modal.getBoundingClientRect()
      return br.top >= mr.top && br.bottom <= mr.bottom + 1 && br.bottom <= window.innerHeight + 1
    })()`
  )
  reporter.check('展开高级设置后操作按钮仍可见', footerVisible === true, String(footerVisible))

  // 小屏兜底：内容允许出现少量滚动，但主操作按钮不能被挤出视口——
  // 顺带守住 `100vh - 170px` 这个经验值预算，头部/底部改高了会在这里露出来。
  // 720 = 常见 720p；681 = GitHub Actions runner 的真实高度（720 再被标题栏吃掉 39px），
  // 就是 run 20261102150813 失败时那块画布，固定下来就不再依赖"碰巧被发现"。
  for (const height of [720, 681]) {
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1280, height, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const smallScreen = await evalIn(
      session,
      `(() => {
        const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
        const btn = modal && [...modal.querySelectorAll('.n-button')].find((el) => /开始下载|Start download/i.test(el.innerText || ''))
        if (!modal || !btn) return { ok: false, reason: 'missing' }
        const br = btn.getBoundingClientRect()
        return {
          ok: br.top >= 0 && br.bottom <= window.innerHeight,
          viewport: window.innerHeight,
          btnBottom: Math.round(br.bottom),
          modalBottom: Math.round(modal.getBoundingClientRect().bottom)
        }
      })()`
    )
    // 同时断言视口真的被改成了目标高度：emulate 失效时会停在真实窗口高度（如 800），一眼能看出来。
    // 允许 ±1：Chromium 报回的 innerHeight 与请求值可能差 1px（681 实测 682），这不是失败。
    const viewportApplied = Math.abs(Number(smallScreen?.viewport) - height) <= 1
    reporter.check(
      `${height}px 高视口下主操作按钮仍在视口内`,
      smallScreen?.ok === true && viewportApplied,
      JSON.stringify(smallScreen)
    )
  }
  await session.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)

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
  // 检测完成前只显示「正在检测 yt-dlp」，不会先闪出下载按钮
  const streamChecked = await (async () => {
    for (let i = 0; i < 20; i++) {
      const checking = await evalIn(session, `!!document.querySelector('.n-modal .ytdlp-checking')`)
      if (!checking) return true
      await sleep(500)
    }
    return false
  })()
  reporter.check('流媒体页 yt-dlp 检测完成', streamChecked === true)
  const streamText = await evalIn(
    session,
    `(() => { const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null); return m ? m.innerText : '(no modal)' })()`
  )
  reporter.check(
    '流媒体页提供按需下载或已安装表单',
    /下载 yt-dlp|Download yt-dlp|当前平台暂不支持|does not support automatic|输入视频|Enter video|前往设置|Open Settings|工具与扩展|Tools & Extension/i.test(String(streamText)),
    String(streamText).slice(0, 80)
  )
  const streamFooter = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return null
      const buttons = [...modal.querySelectorAll('.dialog-footer .n-button')].map((el) => (el.innerText || '').trim())
      return { buttons, text: buttons.join('|') }
    })()`
  )
  reporter.check(
    '流媒体页使用开始下载与重置按钮',
    !!streamFooter && /开始下载|Start Download/i.test(streamFooter.text) && /重置|Reset/i.test(streamFooter.text),
    JSON.stringify(streamFooter)
  )
  reporter.check(
    '流媒体页不再使用「下载视频」按钮',
    !!streamFooter && !/下载视频|Download Video/i.test(streamFooter.text),
    JSON.stringify(streamFooter)
  )
  // —— 种子文件：下载前勾选文件（真实 bencode 解析 + 分类快筛）——
  const torrentTab = await evalIn(
    session,
    `(() => {
      const tab = [...document.querySelectorAll('.n-modal .n-tabs-tab')].find((e) => /种子文件|Torrent File/i.test(e.textContent || ''))
      if (!tab) return 'no-tab'
      tab.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到种子文件页', torrentTab === 'clicked', String(torrentTab))
  await sleep(700)
  const torrentDropped = await evalIn(
    session,
    `(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(torrentBase64())}), (c) => c.charCodeAt(0))
      const file = new File([bytes], 'e2e.torrent', { type: 'application/x-bittorrent' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const area = document.querySelector('.n-modal .file-drop-area')
      if (!area) return 'no-area'
      area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
      return 'dropped'
    })()`
  )
  reporter.check('种子文件可拖入解析', torrentDropped === 'dropped', String(torrentDropped))
  await sleep(900)
  const torrentText = await evalIn(
    session,
    `(() => { const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null); return m ? m.innerText : '' })()`
  )
  reporter.check(
    '种子文件解析出文件列表',
    /种子内容|Torrent contents/i.test(String(torrentText)) && String(torrentText).includes('video.mp4') && String(torrentText).includes('doc.pdf'),
    String(torrentText).slice(0, 120)
  )
  await capture(session, path.join(outDir, '04b-torrent-files.png'))
  const videoFilter = await evalIn(
    session,
    `(() => {
      const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!m) return 'no-modal'
      const btn = [...m.querySelectorAll('.torrent-file-actions .n-button')].find((el) => /视频|Video/i.test(el.innerText || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('种子文件分类快筛可点击', videoFilter === 'clicked', String(videoFilter))
  await sleep(400)
  const filteredSummary = await evalIn(
    session,
    `(() => { const el = document.querySelector('.n-modal .torrent-files-summary'); return el ? el.innerText : '' })()`
  )
  reporter.check('快筛后只选中视频文件', /1 个|1 selected/i.test(String(filteredSummary)), String(filteredSummary))
  const clearedSelection = await evalIn(
    session,
    `(() => {
      const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!m) return 'no-modal'
      const btn = [...m.querySelectorAll('.torrent-file-actions .n-button')].find((el) => /清空|Clear/i.test(el.innerText || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('种子文件可清空选择', clearedSelection === 'clicked', String(clearedSelection))
  await sleep(400)
  const clearedSummary = await evalIn(
    session,
    `(() => { const el = document.querySelector('.n-modal .torrent-files-summary'); return el ? el.innerText : '' })()`
  )
  reporter.check('清空后选中数为 0', /0 个|0 selected/i.test(String(clearedSummary)), String(clearedSummary))

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

  // —— cURL 命令解析：自动填链接与请求头 ——
  const curlText = "curl 'https://example.com/curl-file.zip' -H 'Referer: https://example.com/page' -H 'User-Agent: E2E-UA' -o 'curl-file.zip'"
  const curlFilled = await evalIn(
    session,
    `(() => {
      const ta = document.querySelector('.n-modal textarea')
      if (!ta) return 'no-textarea'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(curlText)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.dispatchEvent(new Event('blur'))
      return 'done'
    })()`
  )
  reporter.check('填写 cURL 命令', curlFilled === 'done', String(curlFilled))
  await sleep(500)
  // 高级设置在切换标签后可能已收起；请求头字段只有展开时才在 DOM 中
  const advancedOpen = await evalIn(session, `!!document.querySelector('.n-modal .advanced-body')`)
  if (!advancedOpen) {
    await evalIn(
      session,
      `(() => {
        const header = [...document.querySelectorAll('.n-modal .n-collapse-item__header-main')].find((e) => /高级设置|Advanced/i.test(e.textContent || ''))
        if (header) header.click()
        return !!header
      })()`
    )
    await sleep(1200)
  }
  const curlParsed = await evalIn(
    session,
    `(() => {
      const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!m) return null
      const ta = m.querySelector('textarea')
      const items = [...m.querySelectorAll('.option-item')]
      const referer = items.find((e) => /^Referer/i.test(e.querySelector('.option-item-label') ? e.querySelector('.option-item-label').innerText : ''))
      const ua = items.find((e) => /^User-Agent/i.test(e.querySelector('.option-item-label') ? e.querySelector('.option-item-label').innerText : ''))
      return {
        url: ta ? ta.value : '',
        referer: referer && referer.querySelector('input') ? referer.querySelector('input').value : '',
        ua: ua && ua.querySelector('input') ? ua.querySelector('input').value : ''
      }
    })()`
  )
  reporter.check('cURL 命令解析为下载链接', curlParsed?.url === 'https://example.com/curl-file.zip', String(curlParsed?.url))
  reporter.check(
    'cURL 命令填充请求头',
    curlParsed?.referer === 'https://example.com/page' && curlParsed?.ua === 'E2E-UA',
    JSON.stringify(curlParsed)
  )

  // 重置表单，避免 cURL 解析出的文件名/请求头影响后续真实下载
  const resetClicked = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.n-modal .n-button')].find((el) => /重置|Reset/i.test(el.innerText || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('新建任务可重置 cURL 解析结果', resetClicked === 'clicked', String(resetClicked))
  await sleep(400)

  // 链接输入框固定高度：填入多行内容后高度不得变化（不得按内容自适应拉伸）
  const multiLineFilled = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      const ta = modal ? modal.querySelector('textarea') : null
      if (!ta) return 'no-textarea'
      window.__e2eTaHeight = ta.getBoundingClientRect().height
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, Array.from({ length: 10 }, (_, i) => 'https://example.com/file' + i).join('\\n'))
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 'filled'
    })()`
  )
  await sleep(350)
  const fixedHeight = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      const ta = modal ? modal.querySelector('textarea') : null
      if (!ta) return null
      return { before: window.__e2eTaHeight, after: ta.getBoundingClientRect().height }
    })()`
  )
  reporter.check(
    '链接输入框多行内容不拉伸高度',
    multiLineFilled === 'filled' && !!fixedHeight && Math.abs(fixedHeight.after - fixedHeight.before) <= 1,
    JSON.stringify(fixedHeight)
  )

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

  // —— 失败任务：详情要说人话，而不是把 errorCode 甩给用户 ——
  // 用一个一定解析不了的主机名，让引擎自己报 errorCode 19（DNS 失败）。
  const failUrl = 'http://nonexistent-host-aria2-e2e.invalid/probe-fail.zip'
  await evalIn(session, `(() => { const btn = document.querySelector('.app-action-btn'); if (btn) btn.click(); return !!btn })()`)
  await sleep(1300)
  const failFilled = await evalIn(
    session,
    `(() => {
      const modal = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!modal) return 'no-modal'
      const ta = modal.querySelector('textarea')
      if (!ta) return 'no-textarea'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(failUrl)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      const item = [...modal.querySelectorAll('.n-form-item')].find((e) => /保存目录|Download directory|Save to/i.test(e.innerText || ''))
      const input = item && item.querySelector('input')
      if (input) {
        const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        inputSetter.call(input, ${JSON.stringify(tempDownloadDir)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return 'filled'
    })()`
  )
  reporter.check('填写会失败的任务链接', failFilled === 'filled', String(failFilled))
  const failSubmitted = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.n-modal .n-button')].find((e) => /开始下载|Start download/i.test(e.innerText || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('提交会失败的任务', failSubmitted === 'clicked', String(failSubmitted))
  await sleep(1500)
  // 表格开了 virtual-scroll，DOM 里只渲染可见行：先用任务搜索框把这条过滤出来，
  // 既能保证它被渲染，也能顺带验证"搜索能找到失败任务"。
  const failSearched = await evalIn(
    session,
    `(() => {
      const input = [...document.querySelectorAll('.action-right input')].find((el) => /搜索|Search/i.test(el.placeholder || ''))
      if (!input) return 'no-input'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'probe-fail')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 'filled'
    })()`
  )
  reporter.check('任务搜索框可用', failSearched === 'filled', String(failSearched))
  const failRowFound = await (async () => {
    for (let i = 0; i < 30; i++) {
      const text = await evalIn(session, 'document.body.innerText')
      if (typeof text === 'string' && text.includes('probe-fail.zip')) return true
      await sleep(500)
    }
    return false
  })()
  reporter.check('失败任务出现在列表里', failRowFound === true)
  const failOpened = await evalIn(
    session,
    `(() => {
      const row = [...document.querySelectorAll('tr')].find((tr) => /probe-fail/.test(tr.innerText || ''))
      if (!row) return 'no-row'
      const btn = [...row.querySelectorAll('button')].find((b) => /查看详情|View detail|Details/i.test(b.getAttribute('aria-label') || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('打开失败任务的详情', failOpened === 'clicked', String(failOpened))
  const failDetail = await (async () => {
    for (let i = 0; i < 60; i++) {
      const text = await evalIn(
        session,
        `(() => { const d = [...document.querySelectorAll('.n-drawer')].find((el) => el.offsetParent !== null); return d ? d.innerText : '' })()`
      )
      if (typeof text === 'string' && /域名解析失败|Name resolution|Domain name/i.test(text)) return text
      await sleep(500)
    }
    return ''
  })()
  reporter.check(
    '失败详情给出可读原因',
    /域名解析失败/.test(String(failDetail)),
    String(failDetail).slice(0, 120)
  )
  reporter.check(
    '失败详情仍保留引擎原话',
    /Name resolution|Domain name|CUID/i.test(String(failDetail)),
    String(failDetail).slice(0, 160)
  )
  await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(700)
  await evalIn(
    session,
    `(() => {
      const input = [...document.querySelectorAll('.action-right input')].find((el) => /搜索|Search/i.test(el.placeholder || ''))
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`
  )
  await sleep(500)


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

  // —— 应用内通知中心：下载完成记录可查看 ——
  const bellClicked = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.footer-actions .footer-btn')].find((b) => /通知|Notifications/i.test(b.title || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('侧边栏通知入口可点击', bellClicked === 'clicked', String(bellClicked))
  await sleep(700)
  const notificationText = await evalIn(
    session,
    `(() => {
      const drawer = [...document.querySelectorAll('.n-drawer')].find((el) => el.offsetParent !== null)
      return drawer ? drawer.innerText : ''
    })()`
  )
  reporter.check(
    '通知中心记录下载完成',
    String(notificationText).includes(fileName),
    String(notificationText).slice(0, 100)
  )
  // 批量操作固定在标题栏最上方：不随列表滚动，符合通知中心的常规操作位置
  const notificationHeaderActions = await evalIn(
    session,
    `(() => {
      const drawer = [...document.querySelectorAll('.n-drawer')].find((el) => el.offsetParent !== null)
      if (!drawer) return null
      const header = drawer.querySelector('.n-drawer-header')
      const buttons = header ? [...header.querySelectorAll('.n-button')] : []
      // 有填充/边框才像按钮：纯文字按钮在标题栏里辨识度太低
      const styled = buttons.length > 0 && buttons.every((el) => {
        // Naive UI 的边框画在子元素 .n-button__border 上，根元素 border 恒为 none
        const borderEl = el.querySelector('.n-button__border')
        const borderStyle = borderEl ? getComputedStyle(borderEl) : null
        const hasBorder = !!borderStyle && borderStyle.borderStyle !== 'none' && parseFloat(borderStyle.borderWidth) > 0
        const style = getComputedStyle(el)
        const filled = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
        return hasBorder || filled
      })
      return {
        hasHeader: !!header,
        buttons: buttons.map((el) => (el.innerText || '').trim()),
        text: buttons.map((el) => (el.innerText || '').trim()).join('|'),
        // 置灰检测：Naive UI 禁用时根元素带 n-button--disabled 类
        disabled: buttons.map((el) => el.classList.contains('n-button--disabled')),
        styled
      }
    })()`
  )
  reporter.check(
    '通知批量操作位于标题栏最上方',
    !!notificationHeaderActions
      && /全部已读|Mark all read/i.test(notificationHeaderActions.text)
      && /清空|Clear/i.test(notificationHeaderActions.text),
    JSON.stringify(notificationHeaderActions)
  )
  reporter.check(
    '通知批量操作具备按钮外观',
    !!notificationHeaderActions && notificationHeaderActions.styled === true,
    JSON.stringify(notificationHeaderActions)
  )
  reporter.check(
    '通知批量操作默认不置灰',
    !!notificationHeaderActions && notificationHeaderActions.disabled.every((value) => value === false),
    JSON.stringify(notificationHeaderActions.disabled)
  )
  // 点击「全部已读」后已无未读项：按钮仍应保持可用外观，而不是变成置灰
  await evalIn(
    session,
    `(() => {
      const drawer = [...document.querySelectorAll('.n-drawer')].find((el) => el.offsetParent !== null)
      const btn = drawer ? [...drawer.querySelectorAll('.n-drawer-header .n-button')].find((el) => /全部已读|Mark all read/i.test(el.innerText || '')) : null
      if (btn) btn.click()
      return !!btn
    })()`
  )
  await sleep(300)
  const notificationActionsAfterRead = await evalIn(
    session,
    `(() => {
      const drawer = [...document.querySelectorAll('.n-drawer')].find((el) => el.offsetParent !== null)
      const buttons = drawer ? [...drawer.querySelectorAll('.n-drawer-header .n-button')] : []
      return { disabled: buttons.map((el) => el.classList.contains('n-button--disabled')) }
    })()`
  )
  reporter.check(
    '全部已读后批量按钮仍不置灰',
    !!notificationActionsAfterRead && notificationActionsAfterRead.disabled.every((value) => value === false),
    JSON.stringify(notificationActionsAfterRead)
  )
  await capture(session, path.join(outDir, '07-notifications.png'))
  await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(700)

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

  // —— 删除确认：文件默认移入系统回收站 ——
  await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(700)
  const deleteClicked = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.task-action-btn')].find((b) => /删除|Delete/i.test(b.title || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('任务行内删除按钮可点击', deleteClicked === 'clicked', String(deleteClicked))
  await sleep(800)
  const deleteDialog = await evalIn(
    session,
    `(() => {
      const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!m) return null
      const checkbox = [...m.querySelectorAll('.n-checkbox')].find((el) => /同时删除文件|Also delete files/i.test(el.innerText || ''))
      return {
        hasCheckbox: !!checkbox,
        checked: !!(checkbox && checkbox.querySelector('input') && checkbox.querySelector('input').checked),
        text: m.innerText
      }
    })()`
  )
  reporter.check('删除确认框提供删除文件选项且默认不勾选', deleteDialog?.hasCheckbox === true && deleteDialog?.checked === false, JSON.stringify(deleteDialog?.checked))
  const checkClicked = await evalIn(
    session,
    `(() => {
      const m = [...document.querySelectorAll('.n-modal')].find((el) => el.offsetParent !== null)
      if (!m) return 'no-modal'
      const checkbox = [...m.querySelectorAll('.n-checkbox')].find((el) => /同时删除文件|Also delete files/i.test(el.innerText || ''))
      if (!checkbox) return 'no-checkbox'
      checkbox.click()
      return 'clicked'
    })()`
  )
  reporter.check('可勾选同时删除文件', checkClicked === 'clicked', String(checkClicked))
  await sleep(500)
  const trashHint = await evalIn(session, 'document.body.innerText')
  reporter.check('勾选删除文件后提示移入回收站', /回收站|trash/i.test(String(trashHint)))
  const cancelled = await evalIn(
    session,
    `(() => {
      const btn = [...document.querySelectorAll('.n-modal .n-button')].find((el) => /取消|Cancel/i.test(el.innerText || ''))
      if (!btn) return 'no-btn'
      btn.click()
      return 'clicked'
    })()`
  )
  reporter.check('删除确认可取消', cancelled === 'clicked', String(cancelled))
  await sleep(500)

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

    // —— 删除文件：走系统回收站（验证主进程 trashItem 链路）——
    const trashPath = path.join(downloadDir, `e2e-trash-${stamp}.bin`)
    fs.writeFileSync(trashPath, `e2e trash ${stamp}`)
    try {
      const trashed = await evalIn(session, `window.electronAPI.deleteFiles([${JSON.stringify(trashPath)}])`)
      reporter.check(
        '删除文件移入系统回收站',
        trashed?.success === true && trashed?.results?.[0]?.success === true,
        JSON.stringify(trashed)
      )
      reporter.check('删除后原路径不再存在', !fs.existsSync(trashPath), trashPath)
    } finally {
      fs.rmSync(trashPath, { force: true })
    }
  }

  // —— 状态页摘要：今日/累计下载量（下载完成时已记录）——
  const statusNav = await evalIn(
    session,
    `(() => {
      const item = [...document.querySelectorAll('.n-menu-item-content')].find((e) => /Aria2 状态|Aria2 Status/i.test(e.textContent || ''))
      if (!item) return 'no-menu'
      item.click()
      return 'clicked'
    })()`
  )
  reporter.check('切换到状态页', statusNav === 'clicked', String(statusNav))
  await sleep(1000)
  const statusText = await evalIn(session, 'document.body.innerText')
  reporter.check(
    '状态页显示今日与累计下载量',
    /今日下载量|Downloaded Today/i.test(String(statusText)) && /累计下载量|Total Downloaded/i.test(String(statusText)),
    String(statusText).slice(0, 120)
  )
  await capture(session, path.join(outDir, '08-status-summary.png'))
}
