<template>
  <SettingsPage
    :title="t('nav.pluginSettings')"
    :description="t('settings.plugins.description')"
    :show-connect-alert="false"
    :connected="true"
    :show-actions="false"
  >
    <n-card :title="t('settings.plugins.listTitle')" class="setting-group">
      <n-alert v-if="!isDesktop" type="warning" :bordered="false" style="margin-bottom: 12px;">
        {{ t('settings.plugins.desktopOnly') }}
      </n-alert>

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

      <div class="install-hint">
        <p>{{ t('settings.plugins.installHint1') }}</p>
        <p class="mono">{{ pluginDirHint }}</p>
        <p>{{ t('settings.plugins.installHint2') }}</p>
        <n-button size="tiny" quaternary @click="openPluginDir">
          <template #icon><n-icon><FolderOpenOutline /></n-icon></template>
          {{ t('settings.plugins.openDir') }}
        </n-button>
      </div>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline } from '@vicons/ionicons5'
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

const pluginDirHint = '%APPDATA%/aria2-desktop/plugins/'

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

async function togglePlugin(plugin: PluginInfo, enable: boolean) {
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
  // 打开插件目录（存在则直接打开，不存在时主进程回退打开父目录）
  const result = await api().openPath(pluginDirHint)
  if (!result?.success) message.error(t('settings.plugins.openDirFailed'))
}

onMounted(loadPlugins)
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

.install-hint {
  margin-top: 16px;
  padding: 10px 12px;
  background: var(--bg-tertiary, rgba(128, 128, 128, 0.06));
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.install-hint p {
  margin: 0 0 4px;
}

.install-hint .mono {
  font-family: 'Monaco', 'Menlo', monospace;
  user-select: all;
}
</style>
