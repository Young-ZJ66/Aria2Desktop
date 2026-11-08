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
            <n-button size="small" :loading="componentStore.ytdlp.checking" @click="componentStore.checkYtdlp(true)">
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
            <n-button size="small" :loading="componentStore.ffmpeg.checking" @click="componentStore.checkFfmpeg(true)">
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
        <n-button :disabled="!storeUrlReady" @click="openExtensionStore">
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

    <!-- MCP：让 AI 助手（Claude Desktop / Cursor 等）直接驱动下载 -->
    <n-card :title="t('settings.rpc.groupMcp')" class="setting-group">
      <p class="extension-desc">{{ t('settings.rpc.mcpDesc') }}</p>
      <div class="mcp-code-wrap">
        <code class="mcp-endpoint">{{ mcpEndpoint }}</code>
        <n-button
          class="mcp-copy-btn"
          size="tiny"
          quaternary
          :circle="copiedTarget !== 'endpoint'"
          :aria-label="t('settings.rpc.mcpCopyEndpoint')"
          @click="copyText(mcpEndpoint, 'endpoint')"
        >
          <template #icon>
            <n-icon>
              <CheckmarkOutline v-if="copiedTarget === 'endpoint'" />
              <CopyOutline v-else />
            </n-icon>
          </template>
          <template v-if="copiedTarget === 'endpoint'">{{ t('settings.rpc.mcpCopied') }}</template>
        </n-button>
      </div>
      <p class="extension-desc mcp-hint">{{ t('settings.rpc.mcpAuthHint') }}</p>
      <div class="mcp-code-wrap mcp-json-wrap">
        <pre class="mcp-json">{{ mcpConfigSample }}</pre>
        <n-button
          class="mcp-copy-btn"
          size="tiny"
          quaternary
          :circle="copiedTarget !== 'config'"
          :aria-label="t('settings.rpc.mcpCopyConfig')"
          @click="copyText(mcpConfigSample, 'config')"
        >
          <template #icon>
            <n-icon>
              <CheckmarkOutline v-if="copiedTarget === 'config'" />
              <CopyOutline v-else />
            </n-icon>
          </template>
          <template v-if="copiedTarget === 'config'">{{ t('settings.rpc.mcpCopied') }}</template>
        </n-button>
      </div>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckmarkOutline, CopyOutline, ExtensionPuzzleOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import { useComponentStore, type ComponentStatus } from '@/stores/componentStore'
import { withMinimumDuration } from '@/composables/useMinimumLoading'
import { EXTENSION_STORE_URL, isExtensionStoreAvailable } from '@/shared/extensionStore'
import {
  MIN_SUPPORTED_EXTENSION_VERSION,
  isExtensionOutdated,
  type ExtensionConnection
} from '@/shared/extensionVersion'
import { classifyUpdateError, COMPONENT_ERROR_MESSAGE_KEYS } from '@/shared/updateError'

const { t } = useI18n()
const componentStore = useComponentStore()

/**
 * 组件下载失败的提示：先认清是不是"连不上 GitHub / 被限流 / 这个标签没有该平台的包"，
 * 认识就把技术串换成人话（原串仍附在后面，方便排查），认不出才原样给出去。
 * 之前这里直接把 `getaddrinfo ENOTFOUND github.com` 甩给用户。
 */
function describeComponentFailure(fallbackKey: string, raw?: string): string {
  const key = COMPONENT_ERROR_MESSAGE_KEYS[classifyUpdateError(raw)]
  // 认不出就原样给出去：组件名已经由 fallbackKey 的句子带着，这里只替换原因部分
  if (!key) return t(fallbackKey, { error: raw || '' })
  const reason = t(`settings.components.${key}`)
  return t(fallbackKey, { error: raw ? `${reason}（${raw}）` : reason })
}

// 商店入口是否可用（扩展已于 2026-10-14 上架，即为 true；若商店下架，把它改回 false
// 按钮就会回到「置灰 + 提示」，见 shared/extensionStore）
const storeUrlReady = isExtensionStoreAvailable()

// ---------- MCP（AI 助手接入）----------
// 端点固定在扩展本地接口（端口与 electron/utils/extensionApiCore 一致），
// Bearer 鉴权用当前 RPC 密钥；示例配置写给用户复制，不包含真实密钥值。
const mcpEndpoint = 'http://localhost:6801/api/mcp'
const mcpConfigSample = computed(() => `{
  "mcpServers": {
    "aria2-desktop": {
      "type": "http",
      "url": "${mcpEndpoint}",
      "headers": { "Authorization": "Bearer <${t('settings.rpc.mcpSecretPlaceholder')}>" }
    }
  }
}`)

/** 最近一次复制目标：按钮内显示「已复制」约 1.8 秒，不使用全局消息横幅 */
const copiedTarget = ref<'endpoint' | 'config' | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyText(text: string, target: 'endpoint' | 'config'): Promise<void> {
  try {
    const api = window.electronAPI
    if (api?.writeClipboard) {
      await api.writeClipboard(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    copiedTarget.value = target
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedTarget.value = null
      copiedTimer = null
    }, 1800)
  } catch {
    message.error(t('settings.unknownError'))
  }
}

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
    extensionStatus.value = await withMinimumDuration(() => api.getExtensionStatus())
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
    const result = await withMinimumDuration(() => (
      kind === 'ytdlp' ? api.ytdlpCheckUpdate() : api.ffmpegCheckUpdate()
    ))
    if (!result?.success) {
      state.available = false
      message.error(describeComponentFailure('settings.components.updateCheckFailed', result?.error))
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
    message.error(describeComponentFailure('newTask.streamYtdlpInstallFailed', result.error))
  }
}

async function installFfmpeg() {
  const result = await componentStore.installFfmpeg()
  if (result.success) {
    updateState.ffmpeg.available = false
    message.success(t('newTask.streamFfmpegInstallSuccess', { version: result.version || '—' }))
  } else {
    message.error(describeComponentFailure('newTask.streamFfmpegInstallFailed', result.error))
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

/* MCP 接入信息：端点与示例配置用等宽字体，便于肉眼核对/复制 */
.mcp-code-wrap {
  position: relative;
}

.mcp-endpoint {
  display: block;
  padding: 10px 40px 10px 12px;
  border-radius: 6px;
  background: var(--bg-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-regular);
  overflow-x: auto;
  white-space: nowrap;
}

.mcp-hint {
  margin: 10px 0 6px;
}

.mcp-json {
  margin: 0;
  padding: 10px 40px 10px 12px;
  border-radius: 6px;
  background: var(--bg-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-regular);
  overflow-x: auto;
  white-space: pre;
}

.mcp-copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: var(--bg-primary);
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
