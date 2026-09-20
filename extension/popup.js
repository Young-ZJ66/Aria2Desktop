/**
 * Aria2 Desktop Extension - Popup Script
 *
 * 交互原则：
 * - 常用动作（发送下载）放最上面，打开弹窗就能用；未配对时直接给出下一步引导；
 * - 每个动作都有"进行中 / 成功 / 失败"三种可见反馈，不留"点了没反应"的状态；
 * - 失败信息说人话，并告诉用户下一步怎么做；错误不自动消失（避免没看清就没了）；
 * - 开关类设置切换即保存（与 allowProbe 的既有行为一致），不留"忘了点保存"的坑；
 * - 弹窗不直接访问网络：状态查询与配对都由 Service Worker 代执行，
 *   弹窗可关闭/最小化而不中断任何流程（配对流程的关键保障）。
 */

const $ = (id) => document.getElementById(id)
const i18n = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key

/** 本机地址默认已授权（见 manifest host_permissions），无需在运行时申请 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

let feedbackTimer = null
/** 两段式解除配对的定时器（3 秒内再次点击才执行） */
let unpairArmTimer = null
let unpairArmed = false

// 初始化界面文本
function initI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage()

  $('quickSendTitle').textContent = i18n('quickSendTitle')
  $('quickUrlLabel').textContent = i18n('quickSendTitle')
  $('quickUrl').placeholder = i18n('quickSendPlaceholder')
  $('sendBtn').textContent = i18n('sendBtn')
  $('pasteBtn').textContent = i18n('paste')
  $('pasteBtn').title = i18n('paste')

  $('pairingTitle').textContent = i18n('sectionPairing')
  $('pairBtn').textContent = i18n('pairWithApp')
  $('pairHint').textContent = i18n('pairHint')

  $('optionsTitle').textContent = i18n('sectionOptions')
  $('enableLabel').textContent = i18n('enableExt')
  $('interceptLabel').textContent = i18n('interceptAll')
  $('interceptDesc').textContent = i18n('interceptAllDesc')
  $('allowProbeLabel').textContent = i18n('allowProbe')
  $('allowProbeDesc').textContent = i18n('allowProbeDesc')

  $('manualTitle').textContent = i18n('manualTitle')
  $('hostLabel').textContent = i18n('host')
  $('portLabel').textContent = i18n('port')
  $('secretLabel').textContent = i18n('secret')
  $('secretHint').textContent = i18n('secretHint')

  $('saveBtn').textContent = i18n('saveSettings')
  $('testBtn').textContent = i18n('testConnection')
  $('unpairBtn').textContent = i18n('unpair')
  $('footerHint').textContent = i18n('rightClickHint')
  $('tabSend').textContent = i18n('tabSend')
  $('tabConnect').textContent = i18n('tabConnect')
  $('pairBannerText').textContent = i18n('sendNeedPairing')
  $('bannerPairBtn').textContent = i18n('goPair')

  $('statusText').textContent = i18n('testing')
}

/**
 * 统一反馈：成功 4 秒自动消失；错误**保留**直到下一次操作覆盖——
 * 错误往往包含下一步指引（去哪里改密钥），闪没了用户就得重试一遍才能再看一次。
 */
function showFeedback(text, isError = false) {
  const el = $('feedback')
  el.textContent = text
  el.className = isError ? 'feedback error' : text ? 'feedback success' : 'feedback'
  if (feedbackTimer) clearTimeout(feedbackTimer)
  if (text && !isError) {
    feedbackTimer = setTimeout(() => {
      el.textContent = ''
      el.className = 'feedback'
    }, 4000)
  }
}

/** 状态条三态：loading（脉冲）/ connected（绿）/ disconnected（红） */
function setStatus(state, text) {
  const cls = state === 'connected'
    ? 'status connected'
    : state === 'disconnected' ? 'status disconnected' : 'status loading'
  $('status').className = cls
  $('statusText').textContent = text
}

/** 根据是否有密钥切换"已配对/未配对"的界面形态（发送页横幅 + 解除按钮显隐 + 发送可用性） */
function applyPairingUi(paired) {
  $('pairBanner').hidden = paired
  $('unpairBtn').hidden = !paired
  $('sendBtn').disabled = !paired
  $('quickUrl').disabled = !paired
  $('pasteBtn').disabled = !paired
}

/**
 * 两种模式：`send`（日常发送）/ `connect`（配对与设置）。
 * 拆开的原因：发送是每次都用的一步操作，配对与连接/开关配置是装好后只做一次的设置，
 * 混在一页会让日常操作被配置项淹没。首次未配对时自动停在 connect，配好即跳回 send。
 */
function switchTab(name) {
  const isSend = name !== 'connect'
  $('paneSend').classList.toggle('active', isSend)
  $('paneConnect').classList.toggle('active', !isSend)
  $('tabSend').classList.toggle('active', isSend)
  $('tabConnect').classList.toggle('active', !isSend)
  $('tabSend').setAttribute('aria-selected', String(isSend))
  $('tabConnect').setAttribute('aria-selected', String(!isSend))
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
  applyPairingUi(!!response?.secret)
  return response
}

async function getConfigSafe() {
  try {
    return await chrome.runtime.sendMessage({ action: 'getConfig' })
  } catch {
    return null
  }
}

/**
 * 刷新连接状态：优先走后台的 App 本地接口（能区分"引擎未启动"和"接口不可达"），
 * 后台不可用时回落到直连 RPC 检测，保住"App 没开但引擎在跑也能用"的能力。
 */
async function refreshStatus() {
  setStatus('loading', i18n('testing'))
  const config = await getConfigSafe()
  if (config?.secret) {
    const appStatus = await chrome.runtime.sendMessage({ action: 'getAppStatus' })
    if (appStatus?.handled) {
      if (appStatus.engineRunning) {
        setStatus('connected', appStatus.engineVersion
          ? i18n('connectedVersion', [appStatus.engineVersion])
          : i18n('engineReady'))
      } else {
        setStatus('disconnected', i18n('engineNotRunning'))
      }
      if (config.enabled === false) showFeedback(i18n('connectedButDisabled'), true)
      return
    }
  }
  await refreshStatusViaRpc()
}

/** 回落路径：直接问本机 aria2 的 RPC（App 侧接口不可用时仍可用） */
async function refreshStatusViaRpc() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'testConnection' })
    if (response?.success) {
      setStatus('connected', i18n('connectedVersion', [String(response.version ?? '')]))
      // 连得上但扩展被停用时，明确说出来，否则用户会奇怪"为什么右键没反应"
      if (response.enabled === false) showFeedback(i18n('connectedButDisabled'), true)
    } else {
      setStatus('disconnected', response?.error || i18n('notConnectedShort'))
    }
  } catch {
    setStatus('disconnected', i18n('notConnectedShort'))
  }
}

/** 粘贴剪贴板内容到输入框（manifest 已声明 clipboardRead） */
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text?.trim()) {
      showFeedback(i18n('pasteEmpty'), true)
      return
    }
    $('quickUrl').value = text.trim()
    $('quickUrl').focus()
  } catch {
    showFeedback(i18n('pasteFailed'), true)
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
      // 结果直接可见：重名改名 > 分类子目录 > 未识别到分类，不让人猜
      if (response.conflict && response.renamed) {
        showFeedback(i18n('sendSuccessRenamed', [response.renamed]))
      } else if (response.subdir) {
        showFeedback(i18n('sendSuccessSubdir', [response.subdir]))
      } else {
        showFeedback(i18n('sendSuccessUnclassified'))
      }
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

/**
 * 一键配对：**请求由 Service Worker 执行**（关键修复）。
 * 点击后用户要切到 Aria2 Desktop 点「允许」，而浏览器 action 弹窗一失去焦点就被销毁——
 * 在弹窗里发请求会随之中止，配对永远无法完成。挪到 SW 后弹窗可关、浏览器可最小化；
 * 结果写入 storage（配对成功还会发系统通知），本弹窗通过 storage 变更事件实时感知。
 */
function startPairing() {
  const btn = $('pairBtn')
  btn.disabled = true
  btn.textContent = i18n('pairingWaiting')
  showFeedback(i18n('pairingInBackground'))

  chrome.runtime.sendMessage({ action: 'startPairing' }).catch(() => { /* popup 关闭时无所谓 */ })
}

/** 配对结果落库后（无论弹窗是否还开着）统一刷新界面 */
function onPairingResult(result) {
  const btn = $('pairBtn')
  btn.disabled = false
  btn.textContent = i18n('pairWithApp')
  if (result?.ok) {
    showFeedback(i18n('pairingSuccess'))
    // 配对是"一次性设置"，完成后自动回到日常的发送模式，减少一次多余点击
    switchTab('send')
  } else if (result?.error) {
    showFeedback(result.error, true)
  }
  refreshStatus()
}

// 解除配对（两段式确认，替代 window.confirm——MV3 弹窗里原生 confirm 会被直接关闭）：
// 清除扩展侧保存的连接凭据（host/port/密钥恢复默认值）。
// 注意：这只影响扩展本地；如需**彻底撤销授权**（让旧密钥作废），
// 要在 Aria2 Desktop 的「设置 → RPC 安全设置」中更换访问密钥，之后所有客户端都需重新配对。
async function unpair() {
  const btn = $('unpairBtn')
  if (!unpairArmed) {
    unpairArmed = true
    btn.classList.add('armed')
    btn.textContent = i18n('unpairReconfirm')
    unpairArmTimer = setTimeout(() => resetUnpairArm(btn), 3000)
    return
  }
  resetUnpairArm(btn)
  btn.disabled = true
  $('secret').value = ''
  $('host').value = 'localhost'
  $('port').value = 6800
  await saveConfig()
  showFeedback(i18n('unpairDone'))
  applyPairingUi(false)
  refreshStatus()
}

function resetUnpairArm(btn) {
  unpairArmed = false
  if (unpairArmTimer) { clearTimeout(unpairArmTimer); unpairArmTimer = null }
  btn.classList.remove('armed')
  btn.textContent = i18n('unpair')
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
      applyPairingUi(!!$('secret').value.trim())
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

/**
 * 开关切换即保存：读取已保存配置 → 只替换开关字段 → 存回。
 * enabled / interceptAll 两个开关共用这一个入口（allowProbe 因涉及权限申请单独处理）。
 */
async function persistToggle(key, value) {
  const current = await getConfigSafe()
  const config = {
    host: current?.host || 'localhost',
    port: current?.port || 6800,
    secret: current?.secret || '',
    enabled: current?.enabled !== false,
    interceptAll: current?.interceptAll === true,
    allowProbe: current?.allowProbe === true
  }
  config[key] = value
  await chrome.runtime.sendMessage({ action: 'saveConfig', config })
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
$('pasteBtn').addEventListener('click', pasteFromClipboard)
$('tabSend').addEventListener('click', () => switchTab('send'))
$('tabConnect').addEventListener('click', () => switchTab('connect'))
$('bannerPairBtn').addEventListener('click', () => {
  switchTab('connect')
  startPairing()
})
$('pairBtn').addEventListener('click', startPairing)
$('unpairBtn').addEventListener('click', unpair)
$('saveBtn').addEventListener('click', saveConfig)
$('testBtn').addEventListener('click', testConnection)

// 开关即时保存（allowProbe 因涉及权限申请单独处理，见上）
$('enabled').addEventListener('change', async (event) => {
  await persistToggle('enabled', event.target.checked)
  if (!event.target.checked) showFeedback(i18n('errDisabled'), true)
})
$('interceptAll').addEventListener('change', (event) => persistToggle('interceptAll', event.target.checked))

// 配对结果由后台写入 storage：监听变化，弹窗开着就实时刷新（关了也不影响配对本身）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.config) {
    applyPairingUi(!!changes.config.newValue?.secret)
  }
  if (changes.lastPairing?.newValue) {
    onPairingResult(changes.lastPairing.newValue)
  }
})

// Initialize
initI18n()
// 未配对（没有密钥）时直接停在「配对与设置」，省得用户还要自己找入口；已配好则停在日常发送
loadConfig().then((config) => {
  switchTab(config?.secret ? 'send' : 'connect')
})
prefillFromActiveTab()
refreshStatus()
