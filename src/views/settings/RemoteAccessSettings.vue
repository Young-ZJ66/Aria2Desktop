<template>
  <SettingsPage
    :title="t('nav.remoteAccess')"
    :show-actions="false"
  >
    <!-- 与其他设置页保持一致：左对齐标签、固定标签列宽、无校验反馈占位 -->
    <n-form label-placement="left" :label-width="180" label-align="left" :show-feedback="false">
      <!-- Headless Web 控制台：应用自身功能，不依赖 aria2 连接 -->
      <n-card class="setting-group">
        <template #header>
          <TipLabel :label="t('settings.webConsole.title')" :tip="t('settings.webConsole.description')" />
        </template>

        <n-form-item :label="t('settings.webConsole.enabled')">
          <AppSwitch v-model:value="webConsole.enabled" />
        </n-form-item>

        <!-- 运行状态放在监听端口上方一行：与「本地引擎」页保持一致的阅读顺序 -->
        <n-form-item :label="t('localService.runStatus')">
          <n-space align="center" :size="8">
            <n-tag v-if="webConsoleStatus" :type="webConsoleStatus.running ? 'success' : 'error'" size="small">
              {{ webConsoleStatus.running ? t('localService.running') : t('localService.stopped') }}
            </n-tag>
            <n-tag v-else size="small" type="default">{{ t('common.unknown') }}</n-tag>
            <span v-if="webConsoleStatus?.url" class="runtime-url">{{ webConsoleStatus.url }}</span>
          </n-space>
        </n-form-item>

        <n-form-item :label="t('settings.webConsole.port')">
          <n-input-number v-model:value="webConsole.port" :min="1024" :max="65535" />
        </n-form-item>
        <n-form-item>
          <template #label>
            <TipLabel
              :label="t('settings.webConsole.token')"
              :tip="t('settings.webConsole.masterTokenHint')"
            />
          </template>
          <n-input
            v-model:value="webConsole.token"
            :placeholder="t('settings.webConsole.tokenPlaceholder')"
            show-password-on="click"
            type="password"
          />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.allowedIps')">
          <n-input
            v-model:value="webConsole.allowedIps"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :placeholder="t('settings.webConsole.allowedIpsPlaceholder')"
          />
        </n-form-item>

        <!-- LAN 访问必须加密：明文 HTTP 下同网段可直接嗅探到 Bearer 令牌 -->
        <n-form-item :label="t('settings.webConsole.tlsCertPath')">
          <n-input
            v-model:value="webConsole.tlsCertPath"
            :placeholder="t('settings.webConsole.tlsPathPlaceholder')"
          />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.tlsKeyPath')">
          <n-input
            v-model:value="webConsole.tlsKeyPath"
            :placeholder="t('settings.webConsole.tlsPathPlaceholder')"
          />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.tlsStatus')">
          <n-tag :type="webConsoleStatus?.tls ? 'success' : 'warning'" size="small">
            {{ webConsoleStatus?.tls ? t('settings.webConsole.tlsEnabled') : t('settings.webConsole.tlsDisabled') }}
          </n-tag>
          <span class="runtime-url">{{ t('settings.webConsole.tlsHint') }}</span>
        </n-form-item>

        <n-form-item v-if="webConsoleStatus?.token" :label="t('settings.webConsole.activeToken')">
          <code class="runtime-token">{{ webConsoleStatus.token }}</code>
        </n-form-item>
        <n-form-item v-if="webConsoleStatus?.error" :label="t('settings.webConsole.error')">
          <n-tag type="error" size="small">{{ webConsoleStatus.error }}</n-tag>
        </n-form-item>

        <n-space class="form-actions">
          <n-button type="primary" :loading="webConsoleSaving" @click="saveWebConsole">
            {{ t('common.save') }}
          </n-button>
          <n-button :loading="webConsoleLoading" @click="refreshWebConsole">
            {{ t('settings.webConsole.refresh') }}
          </n-button>
        </n-space>

        <n-table v-if="webConsoleStatus?.audit?.length" :single-line="false" size="small" class="web-console-audit">
          <thead>
            <tr>
              <th>{{ t('settings.webConsole.auditTime') }}</th>
              <th>{{ t('settings.webConsole.auditIp') }}</th>
              <th>{{ t('settings.webConsole.auditAction') }}</th>
              <th>{{ t('settings.webConsole.auditDetail') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in webConsoleStatus.audit.slice(0, 20)" :key="index">
              <td>{{ entry.time }}</td>
              <td>{{ entry.ip }}</td>
              <td>{{ entry.action }}</td>
              <td>{{ entry.detail }}</td>
            </tr>
          </tbody>
        </n-table>
      </n-card>

      <!-- 细粒度 API 令牌：主令牌仍兼容旧客户端，新客户端按需分配最小权限 -->
      <n-card class="setting-group">
        <template #header>
          <TipLabel :label="t('settings.webConsole.tokensTitle')" :tip="t('settings.webConsole.tokensDesc')" />
        </template>
        <template #header-extra>
          <n-button size="small" type="primary" @click="openTokenModal()">
            {{ t('settings.webConsole.tokenAdd') }}
          </n-button>
        </template>

        <n-table v-if="webConsoleTokens.length" :single-line="false" size="small" class="web-console-audit">
          <thead>
            <tr>
              <th>{{ t('settings.webConsole.tokenName') }}</th>
              <th>{{ t('settings.webConsole.tokenScopes') }}</th>
              <th>{{ t('settings.webConsole.tokenLastUsed') }}</th>
              <th>{{ t('settings.webConsole.tokenCreatedAt') }}</th>
              <th class="token-action-col">{{ t('settings.webConsole.tokenDelete') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in webConsoleTokens" :key="token.id">
              <td>{{ token.name }}</td>
              <td>
                <n-space :size="4">
                  <n-tag
                    v-for="scope in token.scopes"
                    :key="scope"
                    size="small"
                    :type="scope === 'admin' ? 'warning' : 'default'"
                  >
                    {{ scopeLabel(scope) }}
                  </n-tag>
                </n-space>
              </td>
              <td>{{ token.lastUsedAt ? formatDateTime(token.lastUsedAt) : '—' }}</td>
              <td>{{ token.createdAt ? formatDateTime(token.createdAt) : '—' }}</td>
              <td>
                <n-space :size="4">
                  <n-button size="tiny" @click="openTokenModal(token)">
                    {{ t('settings.webConsole.tokenEdit') }}
                  </n-button>
                  <n-popconfirm @positive-click="deleteToken(token.id)">
                    <template #trigger>
                      <n-button size="tiny" type="error" quaternary>
                        {{ t('settings.webConsole.tokenDelete') }}
                      </n-button>
                    </template>
                    {{ t('settings.webConsole.tokenDeleteConfirm', { name: token.name }) }}
                  </n-popconfirm>
                </n-space>
              </td>
            </tr>
          </tbody>
        </n-table>
        <UiEmpty v-else size="sm" :icon="KeyOutline" :title="t('settings.webConsole.tokenEmpty')" />
      </n-card>
    </n-form>

    <!-- 新增/编辑令牌 -->
    <n-modal
      v-model:show="tokenModalVisible"
      preset="card"
      :title="tokenEditingId ? t('settings.webConsole.tokenEdit') : t('settings.webConsole.tokenAdd')"
      class="token-modal"
    >
      <n-form label-placement="top">
        <n-form-item :label="t('settings.webConsole.tokenName')">
          <n-input
            v-model:value="tokenForm.name"
            :maxlength="50"
            show-count
            :placeholder="t('settings.webConsole.tokenNamePlaceholder')"
          />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.tokenScopes')">
          <n-select
            v-model:value="tokenForm.scopes"
            multiple
            :options="scopeOptions"
            :placeholder="t('settings.webConsole.tokenScopesPlaceholder')"
          />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.tokenValue')">
          <n-input-group>
            <n-input v-model:value="tokenForm.token" readonly />
            <n-button v-if="!tokenEditingId" @click="regenerateToken">
              {{ t('settings.webConsole.tokenRegenerate') }}
            </n-button>
            <n-button @click="copyTokenValue">
              {{ t('common.copy') }}
            </n-button>
          </n-input-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="tokenModalVisible = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="tokenSaving" @click="saveToken">
            {{ t('common.save') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onActivated } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import { KeyOutline } from '@vicons/ionicons5'
import { useSettingsStore } from '@/stores/settingsStore'
import { formatDateTime } from '@/utils/taskFormatters'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import { UiEmpty } from '@/components/ui'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { withMinimumDuration, ensureMinimumDuration } from '@/composables/useMinimumLoading'
import type { WebConsoleScope, WebConsoleToken } from '@/shared/appSettings'

const { t } = useI18n()
const settingsStore = useSettingsStore()

interface WebConsoleAuditEntry {
  time: string
  ip: string
  action: string
  detail: string
  success: boolean
}

interface WebConsoleStatus {
  running: boolean
  port: number
  url: string
  /** 是否以 HTTPS 监听（局域网访问必须为 true） */
  tls?: boolean
  token: string
  error?: string
  audit?: WebConsoleAuditEntry[]
}

const webConsole = reactive({
  enabled: false,
  port: 6802,
  token: '',
  allowedIps: '',
  tlsCertPath: '',
  tlsKeyPath: ''
})
const webConsoleStatus = ref<WebConsoleStatus | null>(null)
const webConsoleLoading = ref(false)
const webConsoleSaving = ref(false)

// 细粒度令牌：与主令牌同存于 settings.webConsole.tokens
const webConsoleTokens = ref<WebConsoleToken[]>([])
const tokenModalVisible = ref(false)
const tokenEditingId = ref('')
const tokenSaving = ref(false)
const tokenForm = reactive({
  name: '',
  scopes: [] as WebConsoleScope[],
  token: ''
})

const SCOPE_VALUES: WebConsoleScope[] = ['tasks:read', 'tasks:write', 'tasks:control', 'audit:read', 'admin']
const scopeOptions = computed(() =>
  SCOPE_VALUES.map((value) => ({
    label: t('settings.webConsole.' + scopeKey(value)),
    value
  }))
)

function scopeKey(scope: WebConsoleScope): string {
  const map: Record<WebConsoleScope, string> = {
    'tasks:read': 'scopeTasksRead',
    'tasks:write': 'scopeTasksWrite',
    'tasks:control': 'scopeTasksControl',
    'audit:read': 'scopeAuditRead',
    admin: 'scopeAdmin'
  }
  return map[scope]
}

function scopeLabel(scope: WebConsoleScope): string {
  return t('settings.webConsole.' + scopeKey(scope))
}

/** 生成 18 字节随机数的 hex（36 位），满足主进程 >= 16 位的下限 */
function generateTokenValue(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function openTokenModal(token?: WebConsoleToken): void {
  tokenEditingId.value = token?.id ?? ''
  tokenForm.name = token?.name ?? ''
  tokenForm.scopes = token ? [...token.scopes] : ['tasks:read']
  // 编辑时令牌值不可改：客户端已经在用，换值等于让对端立即失效
  tokenForm.token = token?.token ?? generateTokenValue()
  tokenModalVisible.value = true
}

function regenerateToken(): void {
  tokenForm.token = generateTokenValue()
}

async function copyTokenValue(): Promise<void> {
  try {
    await navigator.clipboard.writeText(tokenForm.token)
    message.success(t('common.copied'))
  } catch (error) {
    console.error('[RemoteAccessSettings] 复制令牌失败:', error)
    message.error(t('settings.webConsole.tokenSaveFailed'))
  }
}

async function persistTokens(next: WebConsoleToken[]): Promise<boolean> {
  const current = settingsStore.settings.webConsole
  await settingsStore.updateSetting('webConsole', {
    enabled: current?.enabled === true,
    port: current?.port ?? 6802,
    token: current?.token ?? '',
    allowedIps: current?.allowedIps ?? [],
    tlsCertPath: current?.tlsCertPath ?? '',
    tlsKeyPath: current?.tlsKeyPath ?? '',
    tokens: next
  })
  webConsoleTokens.value = next
  return true
}

async function saveToken(): Promise<void> {
  const name = tokenForm.name.trim()
  if (!name) {
    message.error(t('settings.webConsole.tokenNameRequired'))
    return
  }
  if (name.length > 50) {
    message.error(t('settings.webConsole.tokenNameTooLong'))
    return
  }
  if (tokenForm.scopes.length === 0) {
    message.error(t('settings.webConsole.tokenScopesRequired'))
    return
  }
  if (tokenForm.token.length < 16) {
    message.error(t('settings.webConsole.tokenTooShort'))
    return
  }

  // 本地写配置通常瞬间完成，补齐最短时长让保存按钮的加载动画可见
  const startedAt = Date.now()
  tokenSaving.value = true
  try {
    const now = new Date().toISOString()
    let next: WebConsoleToken[]
    if (tokenEditingId.value) {
      next = webConsoleTokens.value.map((item) =>
        item.id === tokenEditingId.value
          ? { ...item, name, scopes: [...tokenForm.scopes] }
          : item
      )
    } else {
      next = [
        ...webConsoleTokens.value,
        {
          id: generateTokenValue().slice(0, 16),
          name,
          token: tokenForm.token,
          scopes: [...tokenForm.scopes],
          createdAt: now
        }
      ]
    }
    await persistTokens(next)
    tokenModalVisible.value = false
    message.success(t('settings.webConsole.tokenSaved'))
    await refreshWebConsole()
  } catch (error) {
    console.error('[RemoteAccessSettings] 保存令牌失败:', error)
    message.error(t('settings.webConsole.tokenSaveFailed'))
  } finally {
    await ensureMinimumDuration(startedAt)
    tokenSaving.value = false
  }
}

async function deleteToken(id: string): Promise<void> {
  try {
    await persistTokens(webConsoleTokens.value.filter((item) => item.id !== id))
    message.success(t('settings.webConsole.tokenDeleted'))
    await refreshWebConsole()
  } catch (error) {
    console.error('[RemoteAccessSettings] 删除令牌失败:', error)
    message.error(t('settings.webConsole.tokenDeleteFailed'))
  }
}

function syncWebConsoleFromSettings(): void {
  const current = settingsStore.settings.webConsole
  webConsole.enabled = current?.enabled === true
  webConsole.port = current?.port ?? 6802
  webConsole.token = current?.token ?? ''
  webConsole.allowedIps = (current?.allowedIps ?? []).join('\n')
  webConsole.tlsCertPath = current?.tlsCertPath ?? ''
  webConsole.tlsKeyPath = current?.tlsKeyPath ?? ''
  webConsoleTokens.value = (current?.tokens ?? []).map((token) => ({ ...token }))
}

async function refreshWebConsole(): Promise<void> {
  webConsoleLoading.value = true
  try {
    const status = await withMinimumDuration(async () => window.electronAPI?.webConsoleStatus?.())
    if (status) webConsoleStatus.value = status
  } catch (error) {
    console.error('[RemoteAccessSettings] 读取 Web 控制台状态失败:', error)
  } finally {
    webConsoleLoading.value = false
  }
}

async function saveWebConsole(): Promise<void> {
  webConsoleSaving.value = true
  try {
    const allowedIps = webConsole.allowedIps
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
    await settingsStore.updateSetting('webConsole', {
      enabled: webConsole.enabled,
      port: Math.min(65535, Math.max(1024, Number(webConsole.port) || 6802)),
      token: webConsole.token.trim(),
      allowedIps,
      tlsCertPath: webConsole.tlsCertPath.trim(),
      tlsKeyPath: webConsole.tlsKeyPath.trim(),
      // 整键替换语义：不带上 tokens 会把已配置的细粒度令牌抹掉
      tokens: webConsoleTokens.value
    })
    const result = await window.electronAPI?.webConsoleRestart?.()
    await refreshWebConsole()
    if (result?.error) {
      message.error(result.error)
    } else {
      message.success(t('settings.webConsole.saved'))
    }
  } catch (error) {
    console.error('[RemoteAccessSettings] 保存 Web 控制台设置失败:', error)
    message.error(t('settings.webConsole.saveFailed'))
  } finally {
    webConsoleSaving.value = false
  }
}

onMounted(() => {
  syncWebConsoleFromSettings()
  void refreshWebConsole()
})

// 设置页签是 keep-alive 懒挂载：从配置备份导入后设置可能已变化，重新进入本页时同步一次
onActivated(() => {
  syncWebConsoleFromSettings()
})
</script>

<style scoped>
.form-actions {
  margin-top: var(--ds-space-4);
}

.runtime-url,
.runtime-token {
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-faint);
  word-break: break-all;
}

.web-console-audit {
  margin-top: var(--ds-space-12);
}

.token-action-col {
  width: 140px;
}

.token-modal {
  width: min(560px, 92vw);
}
</style>
