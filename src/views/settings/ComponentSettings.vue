<template>
  <SettingsPage
    :title="t('nav.componentSettings')"
    :description="t('settings.components.description')"
  >
    <!-- 外部下载组件：安装入口集中在这里，流媒体页只做状态提示 -->
    <n-card :title="t('settings.components.groupTools')" class="setting-group">
      <div class="component-item">
        <div class="component-info">
          <div class="component-head">
            <span class="component-name">{{ t('settings.components.ytdlpName') }}</span>
            <n-tag size="small" :type="componentStore.ytdlp.available ? 'success' : 'default'" :title="statusText(componentStore.ytdlp)">
              <span class="component-status-text">{{ statusText(componentStore.ytdlp) }}</span>
            </n-tag>
          </div>
          <p class="component-desc">{{ t('settings.components.ytdlpDesc') }}</p>
          <!-- 版本单独一行完整展示：构建号可能很长，放进状态标签会被截断 -->
          <p v-if="componentStore.ytdlp.available && componentStore.ytdlp.version" class="component-version">
            {{ t('settings.components.versionLine', { version: componentStore.ytdlp.version }) }}
          </p>
          <p
            v-if="componentStore.ytdlp.checked && !componentStore.ytdlp.available && !componentStore.ytdlp.installable"
            class="component-hint"
          >
            {{ t('newTask.streamYtdlpUnsupported') }}
          </p>
          <n-progress
            v-if="componentStore.ytdlp.installing && componentStore.ytdlp.installPercent > 0"
            type="line"
            :percentage="componentStore.ytdlp.installPercent"
            :height="5"
            :show-indicator="false"
            class="component-progress"
          />
        </div>
        <div class="component-actions">
          <n-button
            v-if="!componentStore.ytdlp.available && componentStore.ytdlp.installable"
            type="primary"
            :loading="componentStore.ytdlp.installing"
            :disabled="componentStore.ytdlp.installing"
            @click="installYtdlp"
          >
            {{ componentStore.ytdlp.installing
              ? t('newTask.streamYtdlpInstalling')
              : t('newTask.streamYtdlpInstall', { size: componentStore.ytdlp.approxSizeMB ?? '—' }) }}
          </n-button>
          <n-space v-else-if="componentStore.ytdlp.available" :size="8">
            <n-button
              v-if="updateState.ytdlp.available"
              type="primary"
              size="small"
              :loading="componentStore.ytdlp.installing"
              :disabled="componentStore.ytdlp.installing"
              @click="installYtdlp"
            >
              {{ t('settings.components.updateTo', { version: updateState.ytdlp.latest }) }}
            </n-button>
            <n-button
              v-else
              size="small"
              :loading="updateState.ytdlp.checking"
              @click="checkUpdate('ytdlp')"
            >
              {{ t('settings.components.checkUpdate') }}
            </n-button>
            <n-button size="small" @click="componentStore.checkYtdlp(true)">
              {{ t('settings.components.recheck') }}
            </n-button>
          </n-space>
        </div>
      </div>

      <n-divider class="component-divider" />

      <div class="component-item">
        <div class="component-info">
          <div class="component-head">
            <span class="component-name">{{ t('settings.components.ffmpegName') }}</span>
            <n-tag size="small" :type="componentStore.ffmpeg.available ? 'success' : 'default'" :title="statusText(componentStore.ffmpeg)">
              <span class="component-status-text">{{ statusText(componentStore.ffmpeg) }}</span>
            </n-tag>
          </div>
          <p class="component-desc">{{ t('settings.components.ffmpegDesc') }}</p>
          <p v-if="componentStore.ffmpeg.available && componentStore.ffmpeg.version" class="component-version">
            {{ t('settings.components.versionLine', { version: componentStore.ffmpeg.version }) }}
          </p>
          <p
            v-if="componentStore.ffmpeg.checked && !componentStore.ffmpeg.available && !componentStore.ffmpeg.installable"
            class="component-hint"
          >
            {{ t('newTask.streamFfmpegManual') }}
          </p>
          <n-progress
            v-if="componentStore.ffmpeg.installing && componentStore.ffmpeg.installPercent > 0"
            type="line"
            :percentage="componentStore.ffmpeg.installPercent"
            :height="5"
            :show-indicator="false"
            class="component-progress"
          />
        </div>
        <div class="component-actions">
          <n-button
            v-if="!componentStore.ffmpeg.available && componentStore.ffmpeg.installable"
            type="primary"
            :loading="componentStore.ffmpeg.installing"
            :disabled="componentStore.ffmpeg.installing"
            @click="installFfmpeg"
          >
            {{ componentStore.ffmpeg.installing
              ? t('newTask.streamFfmpegInstalling')
              : t('newTask.streamFfmpegInstall', { size: componentStore.ffmpeg.approxSizeMB ?? '—' }) }}
          </n-button>
          <n-space v-else-if="componentStore.ffmpeg.available" :size="8">
            <n-button
              v-if="updateState.ffmpeg.available"
              type="primary"
              size="small"
              :loading="componentStore.ffmpeg.installing"
              :disabled="componentStore.ffmpeg.installing"
              @click="installFfmpeg"
            >
              {{ t('settings.components.updateTo', { version: updateState.ffmpeg.latest }) }}
            </n-button>
            <n-button
              v-else
              size="small"
              :loading="updateState.ffmpeg.checking"
              @click="checkUpdate('ffmpeg')"
            >
              {{ t('settings.components.checkUpdate') }}
            </n-button>
            <n-button size="small" @click="componentStore.checkFfmpeg(true)">
              {{ t('settings.components.recheck') }}
            </n-button>
          </n-space>
        </div>
      </div>
    </n-card>

    <!-- 浏览器扩展：一键跳到商店安装（链接与"是否已上架"的判断见 shared/extensionStore） -->
    <n-card :title="t('settings.rpc.groupExtension')" class="setting-group">
      <p class="extension-desc">{{ t('settings.rpc.extensionDesc') }}</p>
      <n-space align="center" :size="12">
        <n-button type="primary" :disabled="!storeUrlReady" @click="openExtensionStore">
          <template #icon>
            <n-icon><ExtensionPuzzleOutline /></n-icon>
          </template>
          {{ t('settings.rpc.getExtension') }}
        </n-button>
        <span v-if="!storeUrlReady" class="pending-hint">{{ t('settings.rpc.storePending') }}</span>
      </n-space>
      <!-- 连接状态：扩展每次调用都带版本头，据此判断"商店里是不是已经出了新版" -->
      <p class="extension-status" :class="`is-${extensionStatusTone}`">
        <span class="extension-status-text">{{ extensionStatusText }}</span>
        <n-button text size="tiny" :loading="extensionStatusLoading" @click="refreshExtensionStatus">
          {{ t('settings.rpc.extensionStatusRefresh') }}
        </n-button>
      </p>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ExtensionPuzzleOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import { useComponentStore, type ComponentStatus } from '@/stores/componentStore'
import { EXTENSION_STORE_URL, isExtensionStoreAvailable } from '@/shared/extensionStore'
import {
  MIN_SUPPORTED_EXTENSION_VERSION,
  isExtensionOutdated,
  type ExtensionConnection
} from '@/shared/extensionVersion'

const { t } = useI18n()
const componentStore = useComponentStore()

// 商店入口是否可用（扩展已于 2026-10-14 上架，即为 true；若商店下架，把它改回 false
// 按钮就会回到「置灰 + 提示」，见 shared/extensionStore）
const storeUrlReady = isExtensionStoreAvailable()

onMounted(() => {
  // 首次进入才真正执行检测；之后复用 store 里已检测的结果
  void componentStore.checkYtdlp()
  void componentStore.checkFfmpeg()
  void refreshExtensionStatus()
})

/** 扩展最近一次连接：主进程在每次已鉴权的扩展调用后更新，这里只是取快照 */
const extensionStatus = ref<{ appVersion: string; connection: ExtensionConnection } | null>(null)
const extensionStatusLoading = ref(false)

const extensionStatusText = computed(() => {
  const snapshot = extensionStatus.value
  // lastSeenAt 为 null = 装好应用后还没被扩展调用过；不是错误，只是没配对或没打开过
  if (!snapshot || snapshot.connection.lastSeenAt === null) {
    return t('settings.rpc.extensionStatusNever')
  }
  const { version } = snapshot.connection
  // 旧版扩展不带 X-Extension-Version：只能确认连上了，判断不了新旧
  if (!version) return t('settings.rpc.extensionStatusUnknown')
  if (isExtensionOutdated(version)) {
    return t('settings.rpc.extensionStatusOutdated', {
      extension: version,
      required: MIN_SUPPORTED_EXTENSION_VERSION
    })
  }
  return t('settings.rpc.extensionStatusSeen', { version })
})

/** 只有"确认落后"才用警告色；未知/未连接保持中性，避免设置页到处是橙色 */
const extensionStatusTone = computed(() => {
  const snapshot = extensionStatus.value
  if (!snapshot?.connection.version) return 'idle'
  return isExtensionOutdated(snapshot.connection.version) ? 'warn' : 'ok'
})

async function refreshExtensionStatus() {
  const api = window.electronAPI
  // 防御：旧版 preload 没有该方法（升级后未重启时会走到这里）
  if (typeof api?.getExtensionStatus !== 'function') return
  extensionStatusLoading.value = true
  try {
    extensionStatus.value = await api.getExtensionStatus()
  } catch {
    // 取不到就保留上一次显示：这只是辅助信息，不值得弹错误打断用户
  } finally {
    extensionStatusLoading.value = false
  }
}

function statusText(status: ComponentStatus): string {
  if (!status.checked) return t('settings.components.checking')
  return status.available ? t('settings.components.installed') : t('settings.components.notInstalled')
}

/** 两个组件的更新检查状态（检查中 / 有新版本 / 最新版本号） */
interface UpdateState {
  checking: boolean
  available: boolean
  latest: string
}

const updateState = reactive<Record<'ytdlp' | 'ffmpeg', UpdateState>>({
  ytdlp: { checking: false, available: false, latest: '' },
  ffmpeg: { checking: false, available: false, latest: '' }
})

async function checkUpdate(kind: 'ytdlp' | 'ffmpeg') {
  const api = window.electronAPI
  if (!api) return
  const state = updateState[kind]
  state.checking = true
  try {
    const result = kind === 'ytdlp'
      ? await api.ytdlpCheckUpdate()
      : await api.ffmpegCheckUpdate()
    if (!result?.success) {
      state.available = false
      message.error(result?.error || t('settings.components.updateCheckFailed', { error: '' }))
      return
    }
    if (!result.updateAvailable) {
      state.available = false
      message.success(t('settings.components.upToDate'))
      return
    }
    state.available = true
    state.latest = result.latestVersion || ''
  } catch {
    message.error(t('settings.components.updateCheckFailed', { error: '' }))
  } finally {
    state.checking = false
  }
}

async function installYtdlp() {
  const result = await componentStore.installYtdlp()
  if (result.success) {
    updateState.ytdlp.available = false
    message.success(t('newTask.streamYtdlpInstallSuccess', { version: result.version || '—' }))
  } else {
    message.error(t('newTask.streamYtdlpInstallFailed', { error: result.error || '' }))
  }
}

async function installFfmpeg() {
  const result = await componentStore.installFfmpeg()
  if (result.success) {
    updateState.ffmpeg.available = false
    message.success(t('newTask.streamFfmpegInstallSuccess', { version: result.version || '—' }))
  } else {
    message.error(t('newTask.streamFfmpegInstallFailed', { error: result.error || '' }))
  }
}

/**
 * 跳转浏览器扩展商店。
 *
 * 链接与"是否已上架"的判断都在 shared/extensionStore（App 侧唯一事实来源）：
 * 未上架时按钮是置灰的，不会把用户带到 404 页面。
 */
async function openExtensionStore() {
  if (!storeUrlReady) return
  // 防御：旧版 preload 没有该方法（升级后未重启时会走到这里），此时退化为提示手动访问
  if (typeof window.electronAPI?.openExternalUrl !== 'function') {
    message.warning(t('settings.rpc.extensionOpenFailed'))
    return
  }
  const result = await window.electronAPI.openExternalUrl(EXTENSION_STORE_URL)
  if (!result?.success) message.error(t('settings.rpc.extensionOpenFailed'))
}
</script>

<style scoped>
.setting-group {
  margin-bottom: 16px;
}

.component-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.component-info {
  flex: 1;
  min-width: 0;
}

.component-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.component-name {
  flex: none;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
}

/* 状态标签只显示「已安装 / 未安装」，版本号在下方单独一行完整展示 */
.component-status-text {
  display: inline-block;
  white-space: nowrap;
  vertical-align: bottom;
}

.component-version {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  word-break: break-all;
}

.component-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.component-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.component-progress {
  margin-top: 8px;
}

.component-actions {
  flex: none;
  padding-top: 2px;
}

.component-divider {
  margin: 18px 0;
}

/* 与 SettingsPage 的 .settings-description 同口径，保持卡片内说明文字一致 */
.extension-desc {
  margin: 0 0 12px 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.pending-hint {
  color: var(--text-secondary);
  font-size: 13px;
}

/* 扩展连接状态：中性信息在左，重新检测在右，整行不抢按钮视觉重量 */
.extension-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.extension-status-text {
  min-width: 0;
  word-break: break-word;
}

.extension-status.is-warn {
  color: var(--color-warning);
}

.extension-status.is-ok .extension-status-text {
  color: var(--color-success);
}
</style>
