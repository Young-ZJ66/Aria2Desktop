<template>
  <SettingsPage
    :title="t('nav.pluginSettings')"
    :description="t('settings.plugins.description')"
    :show-connect-alert="false"
    :connected="true"
    :show-actions="false"
  >
    <n-card :title="t('settings.plugins.listTitle')" class="setting-group">
      <!-- 打开插件目录与卡片标题同级：提示关闭后仍能一键进入插件目录 -->
      <template #header-extra>
        <n-button size="small" @click="openPluginDir">
          <template #icon><n-icon><FolderOpenOutline /></n-icon></template>
          {{ t('settings.plugins.openDir') }}
        </n-button>
      </template>

      <n-alert v-if="!isDesktop" type="warning" :bordered="false" style="margin-bottom: 12px;">
        {{ t('settings.plugins.desktopOnly') }}
      </n-alert>

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
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloseOutline, FolderOpenOutline } from '@vicons/ionicons5'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import { message, confirm } from '@/utils/feedback'

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
}

const { t } = useI18n()
const plugins = ref<PluginInfo[]>([])
const loading = ref(false)
const switchingId = ref<string | null>(null)
const uninstallingId = ref<string | null>(null)

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
  // 启用前先展示权限清单：插件在主进程运行，权限标签不是安全沙箱
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
})
</script>

<style scoped>
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
