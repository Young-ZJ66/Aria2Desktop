/**
 * Aria2 Desktop Extension - Popup Script
 * 页面结构对应扩展原型：任务 / 网络嗅探 / 设置，底部导航切换。
 */
const $ = (id) => document.getElementById(id)
const i18n = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

let feedbackTimer = null
let unpairArmTimer = null
let unpairArmed = false
let isPaired = false
let activeTabUrl = ''
let activeTabTitle = ''
let currentTab = 'tasks'
let taskFilter = 'active'
let taskPollTimer = null
let taskLoading = false
let taskStats = { downloadSpeed: '0', uploadSpeed: '0', numActive: '0', numWaiting: '0' }
let lastTasks = []
let snifferPaused = false
let snifferFilter = 'all'
let snifferItems = []
const snifferSelected = new Set()
let snifferPollTimer = null
let snifferLoading = false
let snifferPermissionGranted = false
let configCache = null

function sendMessage(message) { return chrome.runtime.sendMessage(message) }
function setText(id, key, substitutions) { const el = $(id); if (el) el.textContent = i18n(key, substitutions) }
function setTitle(id, key) { const el = $(id); if (el) el.title = i18n(key) }

function showFeedback(text, isError = false) {
  const el = $('feedback')
  if (!el) return
  el.textContent = text
  el.className = 'feedback' + (text ? ' show' : '') + (isError ? ' error' : ' success')
  if (feedbackTimer) clearTimeout(feedbackTimer)
  if (text && !isError) feedbackTimer = setTimeout(() => { el.textContent = ''; el.className = 'feedback' }, 4000)
}

function setStatus(state, text, detail) {
  const el = $('status')
  if (!el) return
  el.className = 'conn-pill' + (state === 'connected' ? '' : state === 'disconnected' ? ' offline' : ' loading')
  $('statusText').textContent = text
  $('statusText').title = detail || text
}

function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => { document.documentElement.dataset.theme = media.matches ? 'dark' : 'light' }
  apply()
  if (media.addEventListener) media.addEventListener('change', apply)
}

function initI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage()
  const manifest = chrome.runtime.getManifest()
  setText('newDownloadBtnText', 'newDownload')
  setText('newDownloadTitle', 'newDownload')
  setText('newDownloadDesc', 'newDownloadDesc')
  setText('newDownloadUrlLabel', 'downloadUrlLabel')
  setText('newDownloadNameLabel', 'fileNameLabel')
  setText('saveToLabel', 'saveToLabel')
  setText('saveToValue', 'saveToDefault')
  setText('requestOptions', 'requestOptions')
  setText('userAgentLabel', 'userAgentLabel')
  setText('refererLabel', 'refererLabel')
  setText('newDownloadCancel', 'cancel')
  setText('newDownloadSubmitText', 'addDownload')
  $('newTaskUrl').placeholder = i18n('downloadUrlPlaceholder')
  $('newTaskName').placeholder = i18n('fileNamePlaceholder')
  $('newTaskUserAgent').placeholder = i18n('userAgentPlaceholder')
  $('newTaskReferer').placeholder = i18n('refererPlaceholder')
  $('newDownloadClose').setAttribute('aria-label', i18n('close'))
  setText('pasteBtn', 'paste')
  setText('metricDownloadLabel', 'metricDownload')
  setText('metricUploadLabel', 'metricUpload')
  setText('metricActiveLabel', 'metricActive')
  setText('metricWaitingLabel', 'metricWaiting')
  setText('tasksTitle', 'tasksTitle')
  setText('tasksNote', 'tasksNote')
  setText('taskFilterActive', 'taskFilterActive')
  setText('taskFilterWaiting', 'taskFilterWaiting')
  setText('taskFilterCompleted', 'taskFilterCompleted')
  setText('pairBannerText', 'sendNeedPairing')
  setText('unpairBtn', 'unpair')
  setText('bannerPairBtn', 'goPair')
  setText('snifferTitle', 'snifferTitle')
  setText('pageVideoTitle', 'pageVideoTitle')
  setText('pageVideoDesc', 'pageVideoDesc')
  setText('snifferFilterAll', 'snifferFilterAll')
  setText('snifferFilterVideo', 'snifferFilterVideo')
  setText('snifferFilterAudio', 'snifferFilterAudio')
  setText('snifferFilterImage', 'snifferFilterImage')
  setText('snifferFilterOther', 'snifferFilterOther')
  setText('snifferHint', 'snifferHint')
  setText('snifferPairBannerText', 'sendNeedPairing')
  setText('snifferPairBtn', 'goPair')
  setText('settingsTitle', 'settingsTitle')
  setText('extensionVersion', 'versionNote', [manifest.version || '1.4.0'])
  setText('behaviorTitle', 'behaviorTitle')
  setText('enableLabel', 'enableExt')
  setText('enableDesc', 'enableExtDesc')
  setText('interceptLabel', 'interceptAll')
  setText('interceptDesc', 'interceptAllDesc')
  setText('allowCookiesLabel', 'allowCookies')
  setText('allowCookiesDesc', 'allowCookiesDesc')
  setText('manualTitle', 'manualTitle')
  setText('manualHint', 'manualHint')
  setText('hostLabel', 'host')
  setText('portLabel', 'port')
  setText('secretLabel', 'secret')
  setText('saveBtn', 'saveSettings')
  setText('testBtn', 'testConnection')
  setText('settingsHint', 'settingsHint')
  setText('tabTasks', 'tabTasks')
  setText('tabSniffer', 'tabSniffer')
  setText('tabSettings', 'tabSettings')
  setText('statusText', 'testing')
  setTitle('refreshStatusBtn', 'refreshStatus')
  setTitle('snifferPauseBtn', 'snifferPause')
}

function formatBytes(value) {
  let n = Number(value) || 0
  if (n < 1024) return Math.round(n) + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let unit = -1
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++ }
  return (n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[unit]
}

function speedParts(value) {
  const n = Number(value) || 0
  if (n <= 0) return { number: '0', unit: 'B/s' }
  if (n < 1024) return { number: String(Math.round(n)), unit: 'B/s' }
  const units = ['KB/s', 'MB/s', 'GB/s']
  let v = n
  let i = -1
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return { number: v >= 10 ? v.toFixed(1) : v.toFixed(2), unit: units[i] }
}

function setMetric(id, value, unit) {
  const el = $(id)
  if (!el) return
  el.textContent = ''
  el.appendChild(document.createTextNode(String(value)))
  if (unit) { const em = document.createElement('em'); em.textContent = unit; el.appendChild(em) }
}

function updateMetrics() {
  const download = speedParts(taskStats.downloadSpeed)
  const upload = speedParts(taskStats.uploadSpeed)
  setMetric('metricDownload', download.number, download.unit)
  setMetric('metricUpload', upload.number, upload.unit)
  setMetric('metricActive', String(taskStats.numActive || 0), '')
  setMetric('metricWaiting', String(taskStats.numWaiting || 0), '')
}

async function getConfigSafe() { try { return await sendMessage({ action: 'getConfig' }) } catch { return null } }

async function loadConfig() {
  const cfg = await getConfigSafe()
  if (!cfg) return null
  configCache = cfg
  $('host').value = cfg.host || 'localhost'
  $('port').value = cfg.port || 6800
  $('secret').value = cfg.secret || ''
  $('enabled').checked = cfg.enabled !== false
  $('interceptAll').checked = cfg.interceptAll === true
  $('allowCookies').checked = cfg.allowCookies === true
  applyPairingUi(!!cfg.secret)
  updateEndpoint()
  return cfg
}

function updateEndpoint() {
  const host = ($('host').value || 'localhost').trim()
  const port = ($('port').value || '6800').trim()
  $('endpointLabel').textContent = host + ':' + port
}

function resetUnpairArm() {
  unpairArmed = false
  if (unpairArmTimer) { clearTimeout(unpairArmTimer); unpairArmTimer = null }
  const btn = $('unpairBtn')
  if (btn) btn.classList.remove('armed')
}

function applyPairingUi(paired) {
  isPaired = paired
  document.body.dataset.state = paired ? 'paired' : 'unpaired'
  const pairBtn = $('pairBtn')
  resetUnpairArm()
  pairBtn.disabled = false
  pairBtn.textContent = i18n(paired ? 'rePair' : 'pairWithApp')
  pairBtn.className = 'btn ' + (paired ? 'btn-ghost' : 'btn-primary')
  $('unpairBtn').hidden = !paired
  $('newDownloadBtn').disabled = !paired
  $('pageVideoBtn').disabled = !paired
  $('pairBanner').hidden = paired
  $('snifferPairBanner').hidden = paired
  $('connectionStatus').textContent = i18n(paired ? 'connectionStatusPaired' : 'connectionStatusUnpaired')
  if (!paired) {
    setStatus('disconnected', i18n('notConnectedShort'))
    taskStats = { downloadSpeed: '0', uploadSpeed: '0', numActive: '0', numWaiting: '0' }
    updateMetrics()
    lastTasks = []
    renderTasks()
  }
}

async function refreshStatus() {
  const cfg = configCache || await getConfigSafe()
  if (!cfg?.secret) { setStatus('disconnected', i18n('notConnectedShort')); return }
  setStatus('loading', i18n('testing'))
  try {
    const appStatus = await sendMessage({ action: 'getAppStatus' })
    if (appStatus?.handled) {
      if (appStatus.engineRunning) {
        setStatus('connected', appStatus.engineVersion ? i18n('connectedVersion', [appStatus.engineVersion]) : i18n('engineReady'))
        $('connectionStatus').textContent = appStatus.engineVersion ? i18n('connectionStatusEngine', [appStatus.engineVersion]) : i18n('connectionStatusPaired')
      } else {
        setStatus('disconnected', i18n('engineNotRunning'))
        $('connectionStatus').textContent = i18n('connectionStatusEngineOff')
      }
      return
    }
  } catch { /* fall through */ }
  try {
    const response = await sendMessage({ action: 'testConnection' })
    if (response?.success) {
      setStatus('connected', response.version ? i18n('connectedVersion', [String(response.version)]) : i18n('engineReady'))
      $('connectionStatus').textContent = response.version ? i18n('connectionStatusEngine', [String(response.version)]) : i18n('connectionStatusPaired')
    } else {
      setStatus('disconnected', i18n('notConnectedShort'), response?.error)
      $('connectionStatus').textContent = i18n('connectionStatusUnpaired')
    }
  } catch {
    setStatus('disconnected', i18n('notConnectedShort'))
    $('connectionStatus').textContent = i18n('connectionStatusUnpaired')
  }
}

function startPairing() {
  const btn = $('pairBtn')
  btn.disabled = true
  btn.textContent = i18n('pairingWaiting')
  showFeedback(i18n('pairingInBackground'))
  chrome.runtime.sendMessage({ action: 'startPairing' }).catch(() => {})
}

async function unpair() {
  if (!unpairArmed) {
    unpairArmed = true
    const btn = $('unpairBtn')
    btn.classList.add('armed')
    btn.textContent = i18n('unpairReconfirm')
    unpairArmTimer = setTimeout(() => {
      unpairArmed = false
      btn.classList.remove('armed')
      btn.textContent = i18n('unpair')
    }, 3000)
    return
  }
  resetUnpairArm()
  const btn = $('unpairBtn')
  btn.disabled = true
  $('secret').value = ''
  $('host').value = 'localhost'
  $('port').value = 6800
  await saveConfig()
  showFeedback(i18n('unpairDone'))
  await loadConfig()
  await refreshStatus()
  btn.disabled = false
}

async function saveConfig() {
  const host = $('host').value.trim() || 'localhost'
  const port = parseInt($('port').value, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) { showFeedback(i18n('invalidPort'), true); return false }
  if (!LOCAL_HOSTS.has(host.toLowerCase()) && chrome.permissions?.request) {
    try {
      const granted = await chrome.permissions.request({ origins: ['http://' + host + '/*', 'https://' + host + '/*'] })
      if (!granted) { showFeedback(i18n('permissionDenied', [host]), true); return false }
    } catch { showFeedback(i18n('permissionDenied', [host]), true); return false }
  }
  const btn = $('saveBtn')
  btn.disabled = true
  try {
    const config = { host, port, secret: $('secret').value.trim(), enabled: $('enabled').checked, interceptAll: $('interceptAll').checked, allowCookies: $('allowCookies').checked }
    const response = await sendMessage({ action: 'saveConfig', config })
    if (response?.success) {
      configCache = config
      showFeedback(i18n('settingsSaved'))
      applyPairingUi(!!config.secret)
      updateEndpoint()
      await refreshStatus()
      return true
    }
    showFeedback(response?.error || i18n('errUnknown'), true)
    return false
  } catch { showFeedback(i18n('errUnknown'), true); return false }
  finally { btn.disabled = false }
}

async function patchConfig(patch) {
  const current = await getConfigSafe()
  if (!current) return false
  const config = Object.assign({}, current, patch)
  try {
    const response = await sendMessage({ action: 'saveConfig', config })
    if (response?.success) { configCache = config; return true }
    showFeedback(response?.error || i18n('errUnknown'), true)
  } catch { showFeedback(i18n('errUnknown'), true) }
  return false
}

async function requestSiteAccess(enabled, event, deniedKey, permissions) {
  try {
    if (enabled) {
      const granted = await chrome.permissions.request(Object.assign({ origins: ['http://*/*', 'https://*/*'] }, permissions?.length ? { permissions } : {}))
      if (!granted) { event.target.checked = false; showFeedback(i18n(deniedKey), true); return false }
      return true
    }
    const removeSpec = permissions?.length ? { permissions } : { origins: ['http://*/*', 'https://*/*'] }
    await chrome.permissions.remove(removeSpec).catch(() => {})
    return true
  } catch { event.target.checked = false; showFeedback(i18n(deniedKey), true); return false }
}

function taskStatusKey(status) {
  if (status === 'active') return 'taskStatusActive'
  if (status === 'waiting') return 'taskStatusWaiting'
  if (status === 'paused') return 'taskStatusPaused'
  if (status === 'complete') return 'taskStatusDone'
  if (status === 'error') return 'taskStatusError'
  return 'taskStatusRemoved'
}

function taskIcon(status) {
  if (status === 'active') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m9 15 3 3 3-3"/><path d="M12 12v6"/></svg>'
  if (status === 'waiting' || status === 'paused') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m8.5 14.5 2.5 2.5 4.5-5"/></svg>'
}

function taskIconClass(status) { return status === 'active' ? 'download' : status === 'waiting' || status === 'paused' ? 'waiting' : status === 'complete' ? 'done' : 'waiting' }

async function loadTasks() {
  if (!isPaired || taskLoading) return
  taskLoading = true
  try {
    const response = await sendMessage({ action: 'getTasks' })
    if (response?.success) {
      taskStats = response.stats || taskStats
      updateMetrics()
      lastTasks = Array.isArray(response.tasks) ? response.tasks : []
      renderTasks()
    }
  } catch { /* 短暂失败不打扰用户 */ }
  finally { taskLoading = false }
}

function renderTasks() {
  const list = $('taskList')
  if (!list) return
  list.textContent = ''
  const filtered = lastTasks.filter(task => {
    if (taskFilter === 'active') return task.status === 'active'
    if (taskFilter === 'waiting') return task.status === 'waiting' || task.status === 'paused'
    return task.status === 'complete' || task.status === 'error' || task.status === 'removed'
  })
  if (filtered.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = i18n(taskFilter === 'active' ? 'taskEmptyActive' : taskFilter === 'waiting' ? 'taskEmptyWaiting' : 'taskEmptyStopped')
    list.appendChild(empty)
    $('taskFooter').hidden = true
    return
  }
  for (const task of filtered) {
    const row = document.createElement('div')
    row.className = 'task-row'
    const icon = document.createElement('span')
    icon.className = 'task-icon ' + taskIconClass(task.status)
    icon.innerHTML = taskIcon(task.status)
    const main = document.createElement('div')
    main.className = 'task-main'
    const name = document.createElement('div')
    name.className = 'task-name'
    name.textContent = task.name || task.gid
    name.title = task.name || task.gid
    const meta = document.createElement('div')
    meta.className = 'task-meta'
    const total = Number(task.totalLength) || 0
    const completed = Number(task.completedLength) || 0
    let metaText = i18n(taskStatusKey(task.status))
    if (total > 0) metaText += ' · ' + formatBytes(completed) + ' / ' + formatBytes(total)
    if (task.status === 'active' && Number(task.downloadSpeed) > 0) metaText += ' · ' + formatBytes(task.downloadSpeed) + '/s'
    if (task.errorMessage) metaText += ' · ' + task.errorMessage
    meta.textContent = metaText
    const progress = document.createElement('div')
    progress.className = 'task-progress ' + (task.status === 'complete' ? 'done' : task.status === 'waiting' || task.status === 'paused' ? 'waiting' : '')
    const bar = document.createElement('i')
    bar.style.width = (total > 0 ? Math.min(100, completed / total * 100) : task.status === 'complete' ? 100 : 0) + '%'
    progress.appendChild(bar)
    main.appendChild(name); main.appendChild(meta); main.appendChild(progress)
    const actions = document.createElement('div')
    actions.className = 'task-actions'
    if (task.status === 'active') actions.appendChild(miniButton('pause', 'taskActionPause', () => taskAction('pause', task.gid)))
    else if (task.status === 'waiting' || task.status === 'paused') actions.appendChild(miniButton('play', 'taskActionResume', () => taskAction('resume', task.gid)))
    actions.appendChild(miniButton('remove', 'taskActionRemove', () => taskAction('remove', task.gid)))
    row.appendChild(icon); row.appendChild(main); row.appendChild(actions)
    list.appendChild(row)
  }
  $('taskFooter').hidden = taskFilter !== 'stopped'
  if (taskFilter === 'stopped') $('taskFooterText').textContent = i18n('taskFooterCount', [String(filtered.length)])
}

function miniButton(kind, titleKey, handler) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'mini-btn' + (kind === 'remove' ? ' danger' : '')
  btn.title = i18n(titleKey)
  btn.setAttribute('aria-label', i18n(titleKey))
  if (kind === 'play') btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 4 12 8-12 8V4Z"/></svg>'
  else if (kind === 'pause') btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 5v14M15 5v14"/></svg>'
  else btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/><path d="M10 11v5M14 11v5"/></svg>'
  btn.addEventListener('click', async () => { btn.disabled = true; await handler(); btn.disabled = false })
  return btn
}

async function taskAction(operation, gid) {
  try {
    const response = await sendMessage({ action: 'taskAction', operation, gid })
    if (!response?.success) showFeedback(response?.error || i18n('errUnknown'), true)
    await loadTasks()
  } catch { showFeedback(i18n('errUnknown'), true) }
}

function setTaskFilter(filter) {
  taskFilter = filter
  for (const btn of $('taskFilter').querySelectorAll('button')) {
    const active = btn.dataset.filter === filter
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-selected', String(active))
  }
  renderTasks()
}

async function prefillFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const url = tab?.url || ''
    if (/^https?:\/\//i.test(url)) { activeTabUrl = url; activeTabTitle = tab.title || '' }
  } catch { /* 无权限时留空 */ }
}

function refererFor(url) {
  try {
    const target = new URL(url)
    const page = activeTabUrl ? new URL(activeTabUrl) : null
    return page && page.origin === target.origin ? page.href : ''
  } catch { return '' }
}

function newDownloadDialog() { return $('newDownloadDialog') }
function newTaskUrl() { return $('newTaskUrl') }
function newTaskError() { return $('newTaskError') }

function clearDialogError() {
  newTaskError().hidden = true
  for (const input of [newTaskUrl(), $('newTaskName'), $('newTaskUserAgent'), $('newTaskReferer')]) input.removeAttribute('aria-invalid')
}

function showDialogError(message, field) {
  const error = newTaskError()
  error.textContent = message
  error.hidden = false
  field.setAttribute('aria-invalid', 'true')
  field.focus()
}

function openDownloadDialog() {
  if (!isPaired || newDownloadDialog().open) return
  clearDialogError()
  $('newDownloadBtn').setAttribute('aria-expanded', 'true')
  newDownloadDialog().showModal()
  window.requestAnimationFrame(() => newTaskUrl().focus())
}

function closeDownloadDialog() { if (newDownloadDialog().open) newDownloadDialog().close() }

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text?.trim()) { showDialogError(i18n('pasteEmpty'), newTaskUrl()); return }
    newTaskUrl().value = text.trim()
    clearDialogError()
    newTaskUrl().focus()
  } catch { showDialogError(i18n('pasteFailed'), newTaskUrl()) }
}

function sendSuccessMessage(response) {
  if (response?.conflict && response?.renamed) return i18n('sendSuccessRenamed')
  if (response?.subdir) return i18n('sendSuccessSubdir')
  return i18n('sendSuccessUnclassified')
}

async function submitDownload() {
  const url = newTaskUrl().value.trim()
  if (!/^(?:https?:\/\/|magnet:\?)/i.test(url)) { showDialogError(i18n('invalidDownloadUrl'), newTaskUrl()); return }
  const referer = $('newTaskReferer').value.trim()
  if (referer && !/^https?:\/\//i.test(referer)) { showDialogError(i18n('invalidReferer'), $('newTaskReferer')); return }
  const btn = $('newDownloadSubmit')
  const btnText = $('newDownloadSubmitText')
  btn.disabled = true
  btnText.textContent = i18n('sending')
  try {
    const fileName = $('newTaskName').value.trim()
    const userAgent = $('newTaskUserAgent').value.trim()
    const options = fileName ? { out: fileName } : {}
    const headers = userAgent ? ['User-Agent: ' + userAgent] : []
    const response = await sendMessage({ action: 'sendToAria2', url, options, pageUrl: referer || refererFor(url), headers })
    if (response?.success) {
      showFeedback(sendSuccessMessage(response))
      $('newDownloadForm').reset()
      clearDialogError()
      closeDownloadDialog()
      if (currentTab === 'tasks') await loadTasks()
    } else showDialogError(response?.error || i18n('errUnknown'), newTaskUrl())
  } catch { showDialogError(i18n('errUnknown'), newTaskUrl()) }
  finally { btn.disabled = false; btnText.textContent = i18n('addDownload') }
}

async function downloadPageVideo() {
  if (!isPaired) return
  if (!activeTabUrl) { showFeedback(i18n('streamPageUnsupported'), true); return }
  const btn = $('pageVideoBtn')
  btn.disabled = true
  showFeedback(i18n('pageVideoWorking'))
  try {
    const result = await sendMessage({ action: 'streamPageVideo', pageUrl: activeTabUrl, title: activeTabTitle })
    if (result?.success) showFeedback(i18n('pageVideoSent'))
    else showFeedback(result?.error || i18n('streamPageFailed', ['']), true)
  } catch { showFeedback(i18n('streamPageUnreachable'), true) }
  finally { btn.disabled = !isPaired }
}

async function checkSnifferPermission() {
  try {
    if (!chrome.permissions?.contains) return true
    snifferPermissionGranted = await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] })
    return snifferPermissionGranted
  } catch { return false }
}

async function enableSniffer() {
  try {
    const granted = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })
    if (!granted) { showFeedback(i18n('snifferPermissionDenied'), true); return }
    snifferPermissionGranted = true
    await loadSniffer()
    startSnifferPolling()
  } catch { showFeedback(i18n('snifferPermissionDenied'), true) }
}

function updateSnifferStatus() {
  if (!snifferPermissionGranted) { $('snifferStatusText').textContent = i18n('snifferPermissionShort'); return }
  $('snifferStatusText').textContent = i18n(snifferPaused ? 'snifferPausedText' : 'snifferStatusText', [String(snifferItems.length)])
}

async function loadSniffer() {
  if (snifferLoading) return
  if (!await checkSnifferPermission()) { snifferPermissionGranted = false; snifferItems = []; renderResources(); updateSnifferStatus(); return }
  snifferPermissionGranted = true
  snifferLoading = true
  try {
    const response = await sendMessage({ action: 'getSnifferData' })
    if (response?.success) {
      snifferItems = Array.isArray(response.items) ? response.items : []
      renderResources()
      updateSnifferStatus()
    }
  } catch { /* 短暂失败不打扰 */ }
  finally { snifferLoading = false }
}

function startSnifferPolling() {
  if (snifferPollTimer) clearInterval(snifferPollTimer)
  snifferPollTimer = setInterval(() => { if (!snifferPaused && document.visibilityState === 'visible') loadSniffer() }, 1000)
}
function stopSnifferPolling() { if (snifferPollTimer) { clearInterval(snifferPollTimer); snifferPollTimer = null } }

function resourceKindLabel(kind) {
  if (kind === 'video') return i18n('snifferFilterVideo')
  if (kind === 'audio') return i18n('snifferFilterAudio')
  if (kind === 'image') return i18n('snifferFilterImage')
  return i18n('snifferFilterOther')
}

function resourceThumb(kind) {
  if (kind === 'video') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m10 9 5 3-5 3V9Z"/></svg>'
  if (kind === 'audio') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
  if (kind === 'image') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m13 5-2 14"/></svg>'
}

function resourceName(item) {
  try { return decodeURIComponent(new URL(item.url).pathname.split('/').filter(Boolean).pop() || '') || item.url } catch { return item.url }
}
function resourceHost(item) { try { return new URL(item.url).host } catch { return '' } }

function renderResources() {
  const list = $('resourceList')
  if (!list) return
  list.textContent = ''
  if (!snifferPermissionGranted) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = i18n('snifferPermissionNeeded')
    const button = document.createElement('button')
    button.className = 'btn btn-primary'
    button.style.marginTop = '10px'
    button.textContent = i18n('snifferEnable')
    button.addEventListener('click', enableSniffer)
    empty.appendChild(document.createElement('br'))
    empty.appendChild(button)
    list.appendChild(empty)
    $('selectionBar').hidden = true
    return
  }
  const filtered = snifferItems.filter(item => snifferFilter === 'all' || item.kind === snifferFilter)
  if (filtered.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = i18n('snifferEmpty')
    list.appendChild(empty)
    $('selectionBar').hidden = true
    return
  }
  for (const item of filtered) {
    const row = document.createElement('label')
    row.className = 'resource-row'
    const check = document.createElement('input')
    check.className = 'resource-check'
    check.type = 'checkbox'
    check.checked = snifferSelected.has(item.url)
    check.addEventListener('change', () => { if (check.checked) snifferSelected.add(item.url); else snifferSelected.delete(item.url); updateSelectionBar() })
    const thumb = document.createElement('span')
    thumb.className = 'resource-thumb ' + item.kind
    thumb.innerHTML = resourceThumb(item.kind)
    const copy = document.createElement('span')
    copy.className = 'resource-copy'
    const name = document.createElement('span')
    name.className = 'resource-name'
    name.textContent = resourceName(item)
    name.title = item.url
    const meta = document.createElement('span')
    meta.className = 'resource-meta'
    meta.textContent = (item.method || 'GET') + ' · ' + resourceHost(item) + ' · ' + resourceKindLabel(item.kind)
    copy.appendChild(name); copy.appendChild(meta)
    const download = document.createElement('button')
    download.className = 'resource-dl'
    download.type = 'button'
    download.title = i18n('mediaSend')
    download.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>'
    download.addEventListener('click', async (event) => {
      event.preventDefault(); event.stopPropagation(); download.disabled = true
      try {
        const result = await sendMessage({ action: 'sendToAria2', url: item.url, pageUrl: refererFor(item.url) })
        if (result?.success) showFeedback(i18n('sendSuccessUnclassified'))
        else showFeedback(result?.error || i18n('errUnknown'), true)
      } finally { download.disabled = false }
    })
    row.appendChild(check); row.appendChild(thumb); row.appendChild(copy); row.appendChild(download)
    list.appendChild(row)
  }
  updateSelectionBar()
}

function updateSelectionBar() {
  const count = snifferSelected.size
  $('selectionBar').hidden = count === 0
  $('selectedCount').textContent = i18n('snifferSelected', [String(count)])
  $('batchDownload').textContent = i18n('snifferDownload', [String(count)])
}

async function sendSelectedResources() {
  const links = [...snifferSelected]
  if (links.length === 0) return
  const btn = $('batchDownload')
  btn.disabled = true
  btn.textContent = i18n('sending')
  try {
    const response = await sendMessage({ action: 'sendGrabbedLinks', links, pageUrl: activeTabUrl })
    if (response?.sent > 0) { showFeedback(i18n('grabSentCount', [String(response.sent)])); snifferSelected.clear(); await loadSniffer() }
    else showFeedback(i18n('errUnknown'), true)
  } catch { showFeedback(i18n('errUnknown'), true) }
  finally { btn.disabled = false; updateSelectionBar() }
}

function switchTab(name) {
  currentTab = name
  for (const pane of document.querySelectorAll('.pane')) pane.classList.toggle('active', pane.dataset.pane === name)
  for (const nav of document.querySelectorAll('.nav-item')) nav.classList.toggle('active', nav.dataset.tab === name)
  if (name === 'tasks') { startTaskPolling(); loadTasks() } else stopTaskPolling()
  if (name === 'sniffer') {
    checkSnifferPermission().then(granted => { snifferPermissionGranted = granted; renderResources(); updateSnifferStatus(); if (granted) loadSniffer() })
    startSnifferPolling()
  } else stopSnifferPolling()
}

function startTaskPolling() {
  if (taskPollTimer) clearInterval(taskPollTimer)
  taskPollTimer = setInterval(() => { if (document.visibilityState === 'visible') loadTasks() }, 2000)
}
function stopTaskPolling() { if (taskPollTimer) { clearInterval(taskPollTimer); taskPollTimer = null } }

function bindEvents() {
  for (const nav of document.querySelectorAll('.nav-item')) nav.addEventListener('click', () => switchTab(nav.dataset.tab))
  for (const btn of document.querySelectorAll('#taskFilter button')) btn.addEventListener('click', () => setTaskFilter(btn.dataset.filter))
  for (const btn of document.querySelectorAll('#snifferFilter .filter-chip')) btn.addEventListener('click', () => {
    snifferFilter = btn.dataset.kind
    for (const chip of document.querySelectorAll('#snifferFilter .filter-chip')) { chip.classList.toggle('active', chip === btn); chip.setAttribute('aria-selected', String(chip === btn)) }
    renderResources()
  })
  $('refreshStatusBtn').addEventListener('click', () => { refreshStatus(); if (currentTab === 'tasks') loadTasks() })
  $('newDownloadBtn').addEventListener('click', openDownloadDialog)
  $('newDownloadClose').addEventListener('click', closeDownloadDialog)
  $('newDownloadCancel').addEventListener('click', closeDownloadDialog)
  $('newDownloadDialog').addEventListener('click', (event) => {
    const dialog = $('newDownloadDialog')
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDownloadDialog()
  })
  $('newDownloadDialog').addEventListener('close', () => { $('newDownloadBtn').setAttribute('aria-expanded', 'false'); $('newDownloadBtn').focus() })
  $('newDownloadForm').addEventListener('submit', (event) => { event.preventDefault(); submitDownload() })
  for (const input of [$('newTaskUrl'), $('newTaskName'), $('newTaskUserAgent'), $('newTaskReferer')]) input.addEventListener('input', () => { if (!$('newTaskError').hidden) clearDialogError() })
  $('pasteBtn').addEventListener('click', pasteFromClipboard)
  $('pageVideoBtn').addEventListener('click', downloadPageVideo)
  $('snifferPauseBtn').addEventListener('click', () => {
    snifferPaused = !snifferPaused
    $('snifferPauseBtn').innerHTML = snifferPaused
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m7 4 12 8-12 8V4Z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M9 5v14M15 5v14"/></svg>'
    $('snifferPauseBtn').title = i18n(snifferPaused ? 'snifferResume' : 'snifferPause')
    $('snifferPauseBtn').setAttribute('aria-label', $('snifferPauseBtn').title)
    updateSnifferStatus()
    if (!snifferPaused) loadSniffer()
  })
  $('batchDownload').addEventListener('click', sendSelectedResources)
  $('pairBtn').addEventListener('click', startPairing)
  $('unpairBtn').addEventListener('click', unpair)
  $('bannerPairBtn').addEventListener('click', () => switchTab('settings'))
  $('snifferPairBtn').addEventListener('click', () => switchTab('settings'))
  $('testBtn').addEventListener('click', async () => {
    const btn = $('testBtn')
    btn.disabled = true
    try {
      const response = await sendMessage({ action: 'testConnection' })
      if (response?.success) showFeedback(i18n('connectedVersion', [String(response.version || '')]))
      else showFeedback(response?.error || i18n('errCannotConnect', ['localhost:6800']), true)
    } catch { showFeedback(i18n('errCannotConnect', ['localhost:6800']), true) }
    finally { btn.disabled = false }
    refreshStatus()
  })
  $('saveBtn').addEventListener('click', saveConfig)
  for (const id of ['host', 'port', 'secret']) $(id).addEventListener('input', updateEndpoint)
  $('enabled').addEventListener('change', async (event) => { const saved = await patchConfig({ enabled: event.target.checked }); if (!saved) event.target.checked = !event.target.checked })
  $('interceptAll').addEventListener('change', async (event) => { const saved = await patchConfig({ interceptAll: event.target.checked }); if (!saved) event.target.checked = !event.target.checked })
  $('allowCookies').addEventListener('change', async (event) => {
    const enabled = event.target.checked
    if (!(await requestSiteAccess(enabled, event, 'cookiesPermissionDenied', ['cookies']))) return
    const saved = await patchConfig({ allowCookies: enabled })
    if (saved) showFeedback(i18n(enabled ? 'cookiesEnabled' : 'cookiesDisabled'))
  })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.config) loadConfig().then(() => refreshStatus())
    if (changes.lastPairing && changes.lastPairing.newValue) {
      const result = changes.lastPairing.newValue
      const btn = $('pairBtn')
      btn.disabled = false
      if (result.ok) {
        showFeedback(i18n('pairingSuccess'))
        loadConfig().then(() => refreshStatus())
      } else {
        btn.textContent = i18n('pairWithApp')
        showFeedback(result.error || i18n('pairingFailed'), true)
      }
    }
  })
}

async function init() {
  initTheme()
  initI18n()
  bindEvents()
  await loadConfig()
  await prefillFromActiveTab()
  await refreshStatus()
  switchTab('tasks')
}

init().catch(() => { /* popup 初始化失败时保留静态界面 */ })
