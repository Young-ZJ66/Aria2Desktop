/**
 * Aria2 Desktop Browser Extension - Background Service Worker
 * Intercepts downloads and sends them to Aria2 Desktop via JSON-RPC
 */

const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 6800,
  secret: '',
  path: '/jsonrpc',
  enabled: true,
  interceptAll: false
}

// Load config from storage
async function getConfig() {
  const result = await chrome.storage.local.get('config')
  return { ...DEFAULT_CONFIG, ...result.config }
}

// Save config to storage
async function saveConfig(config) {
  await chrome.storage.local.set({ config })
}

// Build Aria2 JSON-RPC request
function buildRpcRequest(method, params = [], secret = '') {
  const rpcParams = secret ? [`token:${secret}`, ...params] : params
  return {
    jsonrpc: '2.0',
    id: Date.now().toString(36),
    method,
    params: rpcParams
  }
}

// Send download to Aria2
async function sendToAria2(url, options = {}) {
  const config = await getConfig()
  if (!config.enabled) return { success: false, error: 'Extension disabled' }

  const rpcUrl = `http://${config.host}:${config.port}${config.path}`
  const request = buildRpcRequest('aria2.addUri', [[url], options], config.secret)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    })

    const data = await response.json()
    if (data.error) {
      return { success: false, error: data.error.message }
    }
    return { success: true, gid: data.result }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Test connection to Aria2
async function testConnection() {
  const config = await getConfig()
  const rpcUrl = `http://${config.host}:${config.port}${config.path}`
  const request = buildRpcRequest('aria2.getVersion', [], config.secret)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    })
    const data = await response.json()
    if (data.error) return { success: false, error: data.error.message }
    return { success: true, version: data.result.version }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Show notification (using i18n)
function showNotification(titleKey, messageKey, isError = false) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: chrome.i18n.getMessage(titleKey) || titleKey,
    message: chrome.i18n.getMessage(messageKey) || messageKey,
    priority: isError ? 2 : 1
  })
}

// Context menu: Download link with Aria2
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'download-with-aria2',
    title: 'Aria2 Desktop',
    contexts: ['link', 'video', 'audio']
  })
})

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'download-with-aria2') return

  const url = info.linkUrl || info.srcUrl
  if (!url) return

  const result = await sendToAria2(url)
  if (result.success) {
    showNotification('downloadSent', 'downloadSentDesc')
  } else {
    showNotification('downloadFailed', result.error, true)
  }
})

// Intercept downloads when enabled
chrome.downloads.onDeterminingFilename.addListener(async (downloadItem, suggest) => {
  const config = await getConfig()
  if (!config.enabled || !config.interceptAll) return
  if (downloadItem.url.startsWith('chrome-extension://')) return
  if (downloadItem.url.startsWith('about:')) return
  if (downloadItem.url.startsWith('blob:')) return

  // Cancel browser download and send to Aria2
  chrome.downloads.cancel(downloadItem.id)

  const result = await sendToAria2(downloadItem.url, {
    out: downloadItem.filename
  })

  if (result.success) {
    showNotification('intercepted', 'interceptedDesc')
  } else {
    showNotification('interceptFailed', result.error, true)
    // Resume browser download if Aria2 fails
    chrome.downloads.resume(downloadItem.id)
  }
})

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getConfig') {
    getConfig().then(sendResponse)
    return true
  }

  if (message.action === 'saveConfig') {
    saveConfig(message.config).then(() => sendResponse({ success: true }))
    return true
  }

  if (message.action === 'testConnection') {
    testConnection().then(sendResponse)
    return true
  }

  if (message.action === 'sendToAria2') {
    sendToAria2(message.url, message.options || {}).then(sendResponse)
    return true
  }
})