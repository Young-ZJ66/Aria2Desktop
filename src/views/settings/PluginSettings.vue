<template>
  <SettingsPage
    :title="t('nav.pluginSettings')"
    :description="t('settings.plugins.description')"
    :show-connect-alert="false"
    :connected="true"
    :show-actions="false"
  >
    <n-tabs
      v-model:value="pluginTab"
      type="line"
      size="medium"
      animated
      class="plugin-tabs"
      pane-style="padding: 14px 0 0;"
    >
      <n-tab-pane name="installed" :tab="t('settings.plugins.tabInstalled')" display-directive="show">
        <n-card :title="t('settings.plugins.listTitle')" class="setting-group">
          <!-- 打开插件目录与卡片标题同级：提示关闭后仍能一键进入插件目录 -->
          <template #header-extra>
            <n-button size="small" @click="openPluginDir">
              <template #icon><n-icon><FolderOpenOutline /></n-icon></template>
              {{ t('settings.plugins.openDir') }}
            </n-button>
          </template>

          <DismissibleAlert v-if="!isDesktop" storage-key="settings.plugins.desktopOnly" type="warning" style="margin-bottom: 12px;">
            {{ t('settings.plugins.desktopOnly') }}
          </DismissibleAlert>

          <!--
            安全提醒 + 安装说明：可临时关闭（本次运行内保持关闭，下次启动重新出现），
            也可「不再显示」永久关闭。
          -->
          <div v-if="hintVisible" class="plugin-hint">
            <div class="plugin-hint-main">
              <p class="plugin-hint-warning">{{ t('settings.plugins.securityWarning') }}</p>
              <p>{{ t('settings.plugins.installHint1') }}</p>
              <p class="mono">{{ pluginDirHint }}</p>
              <p>{{ t('settings.plugins.installHint2') }}</p>
            </div>
            <div class="plugin-hint-actions">
              <n-button text size="tiny" @click="hideHintForever">
                {{ t('settings.plugins.dontShowAgain') }}
              </n-button>
              <n-button
                quaternary
                circle
                size="tiny"
                :title="t('common.close')"
                :aria-label="t('common.close')"
                @click="closeHintForSession"
              >
                <template #icon><n-icon><CloseOutline /></n-icon></template>
              </n-button>
            </div>
          </div>

          <n-empty v-if="!loading && plugins.length === 0" :description="t('settings.plugins.empty')" size="small" style="padding: 32px 0;" />
          <div v-else class="plugin-list">
            <div v-for="plugin in plugins" :key="plugin.manifest.id" class="plugin-item">
              <div class="plugin-main">
                <div class="plugin-name-row">
                  <span class="plugin-name">{{ plugin.manifest.name }}</span>
                  <n-tag size="tiny" :bordered="false" round :type="plugin.enabled ? 'success' : 'default'">
                    {{ plugin.enabled ? t('settings.plugins.enabled') : t('settings.plugins.disabled') }}
                  </n-tag>
                  <n-tag v-if="plugin.runtime" size="tiny" :bordered="false" round>
                    {{ plugin.runtime }}
                  </n-tag>
                  <n-tag v-if="plugin.error" size="tiny" type="error" :bordered="false" round>{{ t('status.error') }}</n-tag>
                  <span class="plugin-version">v{{ plugin.manifest.version }}</span>
                </div>
                <div class="plugin-desc">{{ plugin.manifest.description || t('settings.plugins.noDescription') }}</div>
                <div class="plugin-meta">
                  <span>{{ plugin.manifest.author || t('settings.plugins.unknownAuthor') }}</span>
                  <span v-if="plugin.manifest.permissions?.length" class="plugin-perms">
                    {{ t('settings.plugins.permissions') }}: {{ plugin.manifest.permissions.join(', ') }}
                  </span>
                </div>
                <div v-if="plugin.error" class="plugin-error">{{ plugin.error }}</div>
              </div>
              <div class="plugin-actions">
                <n-switch
                  :value="plugin.enabled"
                  size="small"
                  :loading="switchingId === plugin.manifest.id"
                  @update:value="(v: boolean) => togglePlugin(plugin, v)"
                />
                <n-button
                  size="tiny"
                  quaternary
                  type="error"
                  :loading="uninstallingId === plugin.manifest.id"
                  @click="confirmUninstall(plugin)"
                >
                  {{ t('settings.plugins.uninstall') }}
                </n-button>
              </div>
            </div>
          </div>
        </n-card>
      </n-tab-pane>

      <n-tab-pane name="market" :tab="t('settings.plugins.tabMarket')" display-directive="show">
        <n-card :title="t('settings.plugins.marketTitle')" class="setting-group market-card">
          <template #header-extra>
            <n-button size="small" :loading="marketLoading" @click="loadMarket(true)">
              {{ t('settings.plugins.marketRefresh') }}
            </n-button>
          </template>
          <DismissibleAlert storage-key="settings.plugins.marketDesc" type="info" style="margin-bottom: 12px;">
            {{ t('settings.plugins.marketDesc') }}
          </DismissibleAlert>
          <n-collapse class="market-settings">
            <n-collapse-item name="market-settings" :title="t('settings.plugins.marketSettings')">
              <div class="market-config">
                <div class="market-config-row">
                  <span class="market-config-label">{{ t('settings.plugins.marketEnabled') }}</span>
                  <n-switch v-model:value="marketEnabled" size="small" />
                </div>
                <div class="market-config-row">
                  <span class="market-config-label">{{ t('settings.plugins.marketRegistryUrl') }}</span>
                  <n-input v-model:value="marketRegistryUrl" size="small" :placeholder="t('settings.plugins.marketRegistryPlaceholder')" />
                </div>
                <div class="market-config-actions">
                  <n-button size="small" :loading="savingMarketSettings" @click="saveMarketSettings">
                    {{ t('common.save') }}
                  </n-button>
                </div>
              </div>

              <n-divider class="market-settings-divider" />

              <div class="market-publishers">
                <div class="market-publishers-title">{{ t('settings.plugins.trustedPublishers') }}</div>
                <p class="plugin-desc">{{ t('settings.plugins.trustedPublishersDesc') }}</p>
                <n-input
                  v-model:value="publisherKeys"
                  type="textarea"
                  :rows="5"
                  :placeholder="t('settings.plugins.trustedPublishersPlaceholder')"
                />
                <div class="publishers-actions">
                  <n-button size="small" :loading="savingPublishers" @click="savePublishers">
                    {{ t('settings.plugins.savePublishers') }}
                  </n-button>
                </div>
              </div>
            </n-collapse-item>
          </n-collapse>
          <DismissibleAlert v-if="marketError && marketError !== 'MARKET_DISABLED'" storage-key="settings.plugins.marketError" type="error" style="margin: 12px 0;">
            {{ marketErrorText }}
          </DismissibleAlert>
          <n-spin :show="marketLoading">
            <n-empty
              v-if="!marketLoading && marketPlugins.length === 0"
              :description="marketError === 'MARKET_DISABLED' ? t('settings.plugins.marketDisabledEmpty') : t('settings.plugins.marketEmpty')"
              size="small"
              style="padding: 24px 0;"
            />
            <div v-else class="plugin-list">
              <div v-for="item in marketPlugins" :key="item.id" class="plugin-item">
                <div class="plugin-main">
                  <div class="plugin-name-row">
                    <span class="plugin-name">{{ item.name }}</span>
                    <n-tag size="tiny" :bordered="false" round>{{ 'v' + item.version }}</n-tag>
                    <n-tag v-if="item.installed" size="tiny" type="success" :bordered="false" round>
                      {{ t('settings.plugins.marketInstalled', { version: item.installedVersion || item.version }) }}
                    </n-tag>
                  </div>
                  <div class="plugin-desc">{{ item.description || t('settings.plugins.noDescription') }}</div>
                  <div class="plugin-meta">
                    <span>{{ item.author || t('settings.plugins.unknownAuthor') }}</span>
                    <span v-if="item.publisher" class="plugin-perms">{{ t('settings.plugins.marketPublisher') }}: {{ item.publisher }}</span>
                  </div>
                </div>
                <div class="plugin-actions">
                  <n-button
                    v-if="!item.installed || item.installedVersion !== item.version"
                    size="tiny"
                    type="primary"
                    :loading="installingMarketId === item.id"
                    @click="installMarketPlugin(item)"
                  >
                    {{ item.installed ? t('settings.plugins.marketUpdate') : t('settings.plugins.marketInstall') }}
                  </n-button>
                  <n-button size="tiny" quaternary type="warning" @click="reportMarketPlugin(item)">
                    {{ t('settings.plugins.marketReport') }}
                  </n-button>
                </div>
              </div>
            </div>
          </n-spin>

        </n-card>
      </n-tab-pane>
    </n-tabs>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloseOutline, FolderOpenOutline } from '@vicons/ionicons5'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'
import { message, confirm } from '@/utils/feedback'
import { useSettingsStore } from '@/stores/settingsStore'
import { runWithMinimumLoading } from '@/composables/useMinimumLoading'

interface PluginInfo {
  manifest: {
    id: string
    name: string
    version: string
    description?: string
    author?: string
    permissions?: string[]
  }
  enabled: boolean
  path: string
  error?: string
  runtime?: 'utilityProcess' | 'vm' | 'none'
  status?: 'running' | 'stopped' | 'disabled' | 'error'
  restarts?: number
}

interface MarketPlugin {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  publisher?: string
  installed?: boolean
  installedVersion?: string
}

const { t } = useI18n()
const settingsStore = useSettingsStore()
const plugins = ref<PluginInfo[]>([])
const loading = ref(false)
const pluginTab = ref<'installed' | 'market'>('installed')
const switchingId = ref<string | null>(null)
const uninstallingId = ref<string | null>(null)
const marketPlugins = ref<MarketPlugin[]>([])
const marketLoading = ref(false)
const marketError = ref('')
const installingMarketId = ref<string | null>(null)
const publisherKeys = ref((settingsStore.settings.trustedPluginPublishers ?? []).join('\n\n'))
const savingPublishers = ref(false)
const marketEnabled = ref(settingsStore.settings.pluginMarket?.enabled !== false)
const marketRegistryUrl = ref(settingsStore.settings.pluginMarket?.registryUrl || '')
const savingMarketSettings = ref(false)

/** 把插件市场的技术错误码映射为用户能理解的原因，而不是直接暴露 INVALID_REGISTRY_URL 之类的字符串 */
const marketErrorText = computed(() => {
  const code = marketError.value
  if (!code) return ''
  const httpMatch = /^HTTP_(\d+)$/.exec(code)
  if (httpMatch) return t('settings.plugins.marketErrorHttp', { status: httpMatch[1] })
  switch (code) {
    case 'MARKET_DISABLED':
      return t('settings.plugins.marketErrorDisabled')
    case 'INVALID_REGISTRY_URL':
      return t('settings.plugins.marketErrorInvalidUrl')
    case 'REGISTRY_TOO_LARGE':
      return t('settings.plugins.marketErrorTooLarge')
    case 'INVALID_REGISTRY':
      return t('settings.plugins.marketErrorInvalidRegistry')
    case 'NETWORK_ERROR':
      return t('settings.plugins.marketErrorNetwork')
    default:
      return t('settings.plugins.marketLoadFailed', { error: code })
  }
})

/** 插件目录真实路径：页面挂载后向主进程查询；查询失败时退回通用提示文本 */
const pluginDirHint = ref('%APPDATA%/aria2-desktop/plugins/')

/**
 * 插件提示（安全提醒 + 安装说明）的关闭状态：
 * - 点击 X：只记到 sessionStorage，本次运行内不再出现，下次启动应用重新显示；
 * - 点击「不再显示」：写入 localStorage，永久隐藏。
 */
const HINT_SESSION_KEY = 'aria2-desktop-plugin-hint-dismissed'
const HINT_FOREVER_KEY = 'aria2-desktop-plugin-hint-hidden'

const hintClosedThisSession = ref(readFlag(sessionStorage, HINT_SESSION_KEY))
const hintHiddenForever = ref(readFlag(localStorage, HINT_FOREVER_KEY))

/** 存储不可用（隐私模式等）时按未关闭处理，不影响页面功能 */
function readFlag(storage: Storage | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === '1'
  } catch {
    return false
  }
}

const hintVisible = computed(() => !hintClosedThisSession.value && !hintHiddenForever.value)

function closeHintForSession() {
  hintClosedThisSession.value = true
  try {
    sessionStorage.setItem(HINT_SESSION_KEY, '1')
  } catch { /* sessionStorage 不可用时仅本次页面实例生效 */ }
}

function hideHintForever() {
  hintHiddenForever.value = true
  try {
    localStorage.setItem(HINT_FOREVER_KEY, '1')
  } catch { /* localStorage 不可用时仅本次页面实例生效 */ }
}

/** 类型收窄：本页所有操作都依赖桌面 API，无 API 时页面已渲染警告横幅 */
function api(): NonNullable<Window['electronAPI']> {
  return window.electronAPI!
}

const isDesktop = !!window.electronAPI

async function loadPlugins() {
  if (!window.electronAPI?.pluginsList) return
  loading.value = true
  try {
    plugins.value = (await api().pluginsList()) ?? []
  } catch {
    message.error(t('settings.plugins.loadFailed'))
  } finally {
    loading.value = false
  }
}

/** 启用前的权限确认：列出 manifest 声明的权限并提示运行位置 */
function confirmPermissions(plugin: PluginInfo): Promise<boolean> {
  return new Promise((resolve) => {
    confirm({
      title: t('settings.plugins.permissionTitle'),
      content: t('settings.plugins.permissionConfirm', {
        name: plugin.manifest.name,
        permissions: plugin.manifest.permissions?.join(', ') || t('settings.plugins.noPermissions')
      }),
      positiveText: t('settings.plugins.enableAnyway'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onEsc: () => resolve(false)
    })
  })
}

async function togglePlugin(plugin: PluginInfo, enable: boolean) {
  // 启用前先展示权限清单：插件运行在独立 utilityProcess，权限标签不是安全沙箱
  if (enable && !(await confirmPermissions(plugin))) return
  switchingId.value = plugin.manifest.id
  try {
    const result = enable
      ? await api().pluginsEnable(plugin.manifest.id)
      : await api().pluginsDisable(plugin.manifest.id)
    if (result?.success) {
      plugin.enabled = enable
      message.success(t(enable ? 'settings.plugins.enableSuccess' : 'settings.plugins.disableSuccess', { name: plugin.manifest.name }))
    } else {
      message.error(t('settings.plugins.switchFailed'))
    }
  } catch {
    message.error(t('settings.plugins.switchFailed'))
  } finally {
    switchingId.value = null
  }
}

function confirmUninstall(plugin: PluginInfo) {
  confirm({
    title: t('settings.plugins.uninstallTitle'),
    content: t('settings.plugins.uninstallConfirm', { name: plugin.manifest.name }),
    positiveText: t('settings.plugins.uninstall'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      uninstallingId.value = plugin.manifest.id
      try {
        const result = await api().pluginsUninstall(plugin.manifest.id)
        if (result?.success) {
          plugins.value = plugins.value.filter(p => p.manifest.id !== plugin.manifest.id)
          message.success(t('settings.plugins.uninstallSuccess', { name: plugin.manifest.name }))
        } else {
          message.error(t('settings.plugins.uninstallFailed'))
        }
      } catch {
        message.error(t('settings.plugins.uninstallFailed'))
      } finally {
        uninstallingId.value = null
      }
    }
  })
}

async function loadMarket(force = false) {
  const api = window.electronAPI
  if (!api?.pluginsMarketList) return
  await runWithMinimumLoading(marketLoading, async () => {
    marketError.value = ''
    try {
      const result = await api.pluginsMarketList(force)
      if (result?.success) {
        marketPlugins.value = result.plugins ?? []
      } else {
        marketError.value = result?.error || 'unknown'
      }
    } catch {
      marketError.value = 'NETWORK_ERROR'
    }
  })
}

async function installMarketPlugin(item: MarketPlugin) {
  const api = window.electronAPI
  if (!api?.pluginsMarketInstall) return
  const upgrading = !!item.installed
  const confirmed = await new Promise<boolean>((resolve) => {
    confirm({
      title: t(upgrading ? 'settings.plugins.marketUpdateTitle' : 'settings.plugins.marketInstallTitle'),
      content: t(upgrading ? 'settings.plugins.marketUpdateConfirm' : 'settings.plugins.marketInstallConfirm', {
        name: item.name,
        version: item.version,
        from: item.installedVersion || ''
      }),
      positiveText: t(upgrading ? 'settings.plugins.marketUpdate' : 'settings.plugins.marketInstall'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onEsc: () => resolve(false)
    })
  })
  if (!confirmed) return
  installingMarketId.value = item.id
  try {
    const result = await api.pluginsMarketInstall(item.id)
    if (result?.success) {
      item.installed = true
      item.installedVersion = item.version
      message.success(t(upgrading ? 'settings.plugins.marketUpdateSuccess' : 'settings.plugins.marketInstallSuccess', {
        name: item.name,
        version: item.version
      }))
      await loadPlugins()
    } else {
      message.error(t('settings.plugins.marketInstallFailed', { error: result?.error || 'unknown' }))
    }
  } catch (error) {
    message.error(t('settings.plugins.marketInstallFailed', { error: String(error) }))
  } finally {
    installingMarketId.value = null
  }
}

/** 举报走公开 issue：插件市场本身不做内容审核，至少给用户一个可追踪的反馈入口。 */
async function reportMarketPlugin(item: MarketPlugin) {
  const title = encodeURIComponent(`[Plugin Market] ${item.name} (${item.id})`)
  const body = encodeURIComponent([
    `Plugin: ${item.name} (${item.id})`,
    `Version: ${item.version}`,
    item.publisher ? `Publisher: ${item.publisher}` : '',
    '',
    'Describe the problem (malicious behavior, broken install, policy violation, ...):'
  ].filter(Boolean).join('\n'))
  const result = await window.electronAPI?.openExternalUrl?.(
    `https://github.com/Young-ZJ66/Aria2Desktop/issues/new?title=${title}&body=${body}`
  )
  if (!result?.success) message.error(result?.error || t('settings.plugins.marketReportFailed'))
}

async function saveMarketSettings() {
  savingMarketSettings.value = true
  try {
    await settingsStore.updateSetting('pluginMarket', {
      enabled: marketEnabled.value,
      registryUrl: marketRegistryUrl.value.trim()
    })
    message.success(t('settings.plugins.marketSettingsSaved'))
    await loadMarket(true)
  } catch (error) {
    message.error(String(error))
  } finally {
    savingMarketSettings.value = false
  }
}

async function savePublishers() {
  savingPublishers.value = true
  try {
    const keys = publisherKeys.value.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean)
    await settingsStore.updateSetting('trustedPluginPublishers', keys)
    message.success(t('settings.plugins.savePublishersSuccess'))
  } catch (error) {
    message.error(String(error))
  } finally {
    savingPublishers.value = false
  }
}

async function openPluginDir() {
  const api = window.electronAPI
  if (!api) return
  // 旧 preload（改完主进程但没有重启应用）没有该方法：明确提示重启，而不是抛未捕获异常
  if (typeof api.pluginsOpenDir !== 'function') {
    message.warning(t('settings.plugins.needRestart'))
    return
  }
  // 由主进程用真实路径打开（渲染层的 %APPDATA% 只是提示文本，不能直接当路径用）
  const result = await api.pluginsOpenDir()
  if (!result?.success) message.error(t('settings.plugins.openDirFailed'))
}

/** 查询插件目录真实路径用于页面展示（跨平台一致） */
async function loadPluginDir() {
  const api = window.electronAPI
  if (!api || typeof api.pluginsDir !== 'function') return
  try {
    const result = await api.pluginsDir()
    if (result?.success && result.path) pluginDirHint.value = result.path
  } catch { /* 查询失败时保留通用提示文本 */ }
}

onMounted(() => {
  void loadPlugins()
  void loadPluginDir()
  void loadMarket()
})
</script>

<style scoped>
.market-settings {
  margin-bottom: 14px;
}

.market-settings :deep(.n-collapse-item__header) {
  font-size: 13px;
  font-weight: 600;
}

.market-settings-divider {
  margin: 14px 0 12px;
}

.market-publishers-title {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.market-config {
  margin-bottom: 0;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.market-config-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.market-config-label {
  flex: none;
  width: 150px;
  font-size: 12px;
  color: var(--text-secondary);
}

.market-config-actions {
  display: flex;
  justify-content: flex-start;
}

.publishers-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 8px;
}

.plugin-tabs {
  margin-top: -2px;
}

.plugin-tabs :deep(.n-tabs-nav) {
  margin-bottom: 2px;
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.plugin-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.plugin-main {
  flex: 1;
  min-width: 0;
}

.plugin-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
}

.plugin-version {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', monospace;
}

.plugin-desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  word-break: break-word;
}

.plugin-meta {
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 11px;
  color: var(--text-secondary);
}

.plugin-perms {
  font-family: 'Monaco', 'Menlo', monospace;
  word-break: break-all;
}

.plugin-error {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--color-danger, #d32f2f);
  word-break: break-word;
}

.plugin-actions {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.plugin-hint {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 12px;
  background: var(--bg-tertiary, rgba(128, 128, 128, 0.06));
  border-left: 3px solid var(--color-warning, #d97706);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.plugin-hint-main {
  flex: 1;
  min-width: 0;
}

.plugin-hint-main p {
  margin: 0 0 4px;
}

.plugin-hint-main p:last-child {
  margin-bottom: 0;
}

.plugin-hint-warning {
  color: var(--color-warning, #d97706);
  font-weight: 600;
}

.plugin-hint-main .mono {
  font-family: 'Monaco', 'Menlo', monospace;
  user-select: all;
  word-break: break-all;
}

.plugin-hint-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
