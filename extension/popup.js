/**
 * Aria2 Desktop Extension - Popup Script
 *
 * 交互原则：
 * - 常用动作（发送下载）放最上面，打开弹窗就能用；
 * - 每个动作都有"进行中 / 成功 / 失败"三种可见反馈，不留"点了没反应"的状态；
 * - 失败信息说人话，并告诉用户下一步怎么做。
 */

const $ = (id) => document.getElementById(id)
const i18n = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key

/** 本机地址默认已授权（见 manifest host_permissions），无需在运行时申请 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

let feedbackTimer = null

// 初始化界面文本
function initI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage()

  $('quickSendTitle').textContent = i18n('quickSendTitle')
  $('quickUrlLabel').textContent = i18n('quickSendTitle')
  $('quickUrl').placeholder = i18n('quickSendPlaceholder')
  $('sendBtn').textContent = i18n('sendBtn')

  $('connectionTitle').textContent = i18n('sectionConnection')
  $('hostLabel').textContent = i18n('host')
  $('portLabel').textContent = i18n('port')
  $('secretLabel').textContent = i18n('secret')
  $('secretHint').textContent = i18n('secretHint')

  $('optionsTitle').textContent = i18n('sectionOptions')
  $('enableLabel').textContent = i18n('enableExt')
  $('interceptLabel').textContent = i18n('interceptAll')
  $('allowProbeLabel').textContent = i18n('allowProbe')
  $('allowProbeHint').textContent = i18n('allowProbeHint')

  $('saveBtn').textContent = i18n('saveSettings')
  $('testBtn').textContent = i18n('testConnection')
  $('footerHint').textContent = i18n('rightClickHint')

  $('statusText').textContent = i18n('notConnected')
}

/** 统一反馈：成功/失败都走这里（不再改写按钮文字，避免按钮语义被临时替换掉） */
function showFeedback(text, isError = false) {
  const el = $('feedback')
  el.textContent = text
  el.className = isError ? 'feedback error' : text ? 'feedback success' : 'feedback'
  if (feedbackTimer) clearTimeout(feedbackTimer)
  if (text) {
    feedbackTimer = setTimeout(() => {
      el.textContent = ''
      el.className = 'feedback'
    }, 4000)
  }
}

function setStatus(connected, text) {
  $('status').className = connected ? 'status connected' : 'status disconnected'
  $('statusText').textContent = text
}

/** 读取当前标签页地址填入快捷发送框（仅 http/https，避免填入 chrome:// 这类无意义地址） */
async function prefillFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const url = tab?.url || ''
    if (/^https?:\/\//i.test(url)) {
      $('quickUrl').value = url
    }
  } catch { /* 无权限或取不到时留空即可 */ }
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
    $('allowProbe').checked = response.allowProbe === true
  }
}

// 刷新连接状态
async function refreshStatus() {
  setStatus(false, i18n('testing'))
  try {
    const response = await chrome.runtime.sendMessage({ action: 'testConnection' })
    if (response?.success) {
      setStatus(true, i18n('connectedVersion', [String(response.version ?? '')]))
      // 连得上但扩展被停用时，明确说出来，否则用户会奇怪"为什么右键没反应"
      if (response.enabled === false) showFeedback(i18n('connectedButDisabled'), true)
    } else {
      setStatus(false, response?.error || i18n('notConnectedShort'))
    }
  } catch {
    setStatus(false, i18n('notConnectedShort'))
  }
}

/** 发送一个下载链接到 Aria2（弹窗里的主要动作） */
async function sendCurrentUrl() {
  const url = $('quickUrl').value.trim()
  if (!url) {
    showFeedback(i18n('sendEmpty'), true)
    return
  }

  const btn = $('sendBtn')
  btn.disabled = true
  btn.textContent = i18n('sending')
  try {
    const response = await chrome.runtime.sendMessage({ action: 'sendToAria2', url })
    if (response?.success) {
      // 分类结果直接可见：进了哪个子目录一目了然；没识别到分类也明确说明，不让人猜
      showFeedback(
        response.subdir ? i18n('sendSuccessSubdir', [response.subdir]) : i18n('sendSuccessUnclassified')
      )
      $('quickUrl').value = ''
    } else {
      showFeedback(response?.error || i18n('errUnknown'), true)
    }
  } catch {
    showFeedback(i18n('errUnknown'), true)
  } finally {
    btn.disabled = false
    btn.textContent = i18n('sendBtn')
  }
}

// Save config
async function saveConfig() {
  const host = $('host').value.trim() || 'localhost'
  const port = parseInt($('port').value, 10)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    showFeedback(i18n('invalidPort'), true)
    return
  }

  // 非本机地址按需申请访问权限：安装时只申请本机，避免出现"此扩展可读取所有网站数据"的吓人提示。
  // 必须在这一步（用户手势内）直接调用 chrome.permissions.request，不能在后台脚本里代为申请。
  if (!LOCAL_HOSTS.has(host.toLowerCase()) && chrome.permissions?.request) {
    try {
      const granted = await chrome.permissions.request({
        origins: [`http://${host}/*`, `https://${host}/*`]
      })
      if (!granted) {
        showFeedback(i18n('permissionDenied', [host]), true)
        return
      }
    } catch {
      showFeedback(i18n('permissionDenied', [host]), true)
      return
    }
  }

  const btn = $('saveBtn')
  btn.disabled = true
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'saveConfig',
      config: {
        host,
        port,
        secret: $('secret').value.trim(),
        enabled: $('enabled').checked,
        interceptAll: $('interceptAll').checked,
        allowProbe: $('allowProbe').checked
      }
    })
    if (response?.success) {
      showFeedback(i18n('settingsSaved'))
      refreshStatus()
    } else {
      showFeedback(response?.error || i18n('errUnknown'), true)
    }
  } catch {
    showFeedback(i18n('errUnknown'), true)
  } finally {
    btn.disabled = false
  }
}

// Test connection
async function testConnection() {
  const btn = $('testBtn')
  btn.disabled = true
  await refreshStatus()
  btn.disabled = false
}

/**
 * 「探测真实文件名」开关。
 * 开启需要授予全站访问权限——权限申请必须由扩展界面上的这次点击直接发起，
 * 不能后台代办；关闭时收回授权，避免留下不再需要的权限。
 */
$('allowProbe').addEventListener('change', async (event) => {
  const enabled = event.target.checked
  if (enabled) {
    try {
      const granted = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })
      if (!granted) {
        event.target.checked = false
        showFeedback(i18n('probePermissionDenied'), true)
        return
      }
    } catch {
      event.target.checked = false
      showFeedback(i18n('probePermissionDenied'), true)
      return
    }
  } else {
    try {
      await chrome.permissions.remove({ origins: ['http://*/*', 'https://*/*'] })
    } catch { /* 忽略 */ }
  }
  await persistAllowProbe(enabled)
})

/** 只持久化 allowProbe 标志（读取已保存的配置，避免误存表单里尚未保存的其他输入） */
async function persistAllowProbe(enabled) {
  const current = await chrome.runtime.sendMessage({ action: 'getConfig' })
  const config = {
    host: current?.host || 'localhost',
    port: current?.port || 6800,
    secret: current?.secret || '',
    enabled: current?.enabled !== false,
    interceptAll: current?.interceptAll === true,
    allowProbe: enabled
  }
  const saved = await chrome.runtime.sendMessage({ action: 'saveConfig', config })
  if (saved?.success) showFeedback(i18n(enabled ? 'probeEnabled' : 'probeDisabled'))
}

// Event listeners
$('sendBtn').addEventListener('click', sendCurrentUrl)
$('quickUrl').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendCurrentUrl()
})
$('saveBtn').addEventListener('click', saveConfig)
$('testBtn').addEventListener('click', testConnection)

// Initialize
initI18n()
loadConfig()
prefillFromActiveTab()
refreshStatus()
