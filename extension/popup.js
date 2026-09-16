/**
 * Aria2 Desktop Extension - Popup Script
 * 使用 chrome.i18n API 支持多语言
 */

const $ = (id) => document.getElementById(id)
const i18n = (key) => chrome.i18n.getMessage(key) || key

// 初始化界面文本
function initI18n() {
  document.getElementById('connectionTitle').textContent = i18n('host')
  document.getElementById('hostLabel').textContent = i18n('host')
  document.getElementById('portLabel').textContent = i18n('port')
  document.getElementById('secretLabel').textContent = i18n('secret')
  document.getElementById('settingsTitle').textContent = i18n('enableExt')
  document.getElementById('enableLabel').textContent = i18n('enableExt')
  document.getElementById('interceptLabel').textContent = i18n('interceptAll')
  document.getElementById('saveBtn').textContent = i18n('saveSettings')
  document.getElementById('testBtn').textContent = i18n('testConnection')
  document.getElementById('footerHint').textContent = i18n('rightClickHint')
  $('statusText').textContent = i18n('notConnected')
}

// Load saved config
async function loadConfig() {
  const response = await chrome.runtime.sendMessage({ action: 'getConfig' })
  if (response) {
    $('host').value = response.host || 'localhost'
    $('port').value = response.port || 6800
    $('secret').value = response.secret || ''
    $('enabled').checked = response.enabled !== false
    $('interceptAll').checked = response.interceptAll === true
  }
}

// Save config
async function saveConfig() {
  const config = {
    host: $('host').value.trim() || 'localhost',
    port: parseInt($('port').value) || 6800,
    secret: $('secret').value.trim(),
    enabled: $('enabled').checked,
    interceptAll: $('interceptAll').checked
  }

  const response = await chrome.runtime.sendMessage({
    action: 'saveConfig',
    config
  })

  if (response?.success) {
    updateStatus()
    showFeedback(i18n('settingsSaved'))
  }
}

// Test connection
async function testConnection() {
  $('status').className = 'status disconnected'
  $('statusText').textContent = i18n('testing')

  const response = await chrome.runtime.sendMessage({ action: 'testConnection' })

  if (response?.success) {
    $('status').className = 'status connected'
    $('statusText').textContent = i18n('connectedVersion').replace('$VERSION$', response.version)
  } else {
    $('status').className = 'status disconnected'
    $('statusText').textContent = i18n('failedPrefix').replace('$ERROR$', response?.error || i18n('notConnectedShort'))
  }
}

// Update connection status
async function updateStatus() {
  const response = await chrome.runtime.sendMessage({ action: 'testConnection' })
  if (response?.success) {
    $('status').className = 'status connected'
    $('statusText').textContent = i18n('connectedVersion').replace('$VERSION$', response.version)
  } else {
    $('status').className = 'status disconnected'
    $('statusText').textContent = i18n('notConnectedShort')
  }
}

// Show brief feedback
function showFeedback(text) {
  const btn = $('saveBtn')
  const original = btn.textContent
  btn.textContent = text
  btn.style.background = '#4caf50'
  setTimeout(() => {
    btn.textContent = original
    btn.style.background = ''
  }, 1500)
}

// Event listeners
$('saveBtn').addEventListener('click', saveConfig)
$('testBtn').addEventListener('click', testConnection)

// Initialize
initI18n()
loadConfig()
updateStatus()