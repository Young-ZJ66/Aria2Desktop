<template>
  <n-modal
    v-model:show="visible"
    :title="t('connection.title')"
    preset="card"
    style="width: 560px"
    :bordered="false"
    :mask-closable="true"
  >

    <!-- 一级：连接配置列表 -->
    <div v-if="view === 'list'" class="profile-list-view">
      <!-- 首次使用引导 -->
      <DismissibleAlert v-if="!connectionStore.isConnected" storage-key="connection.firstTimeGuide" type="info" style="margin-bottom: 12px;">
        {{ t('connection.firstTimeGuide') }}
      </DismissibleAlert>
      <div class="list-header">
        <span class="list-title">{{ t('connection.profileList') }}</span>
        <n-button size="small" type="primary" class="app-action-btn" @click="openNameDialog('new')">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          {{ t('connection.newProfile') }}
        </n-button>
      </div>

      <div class="profile-list">
        <n-empty
          v-if="connectionStore.profiles.length === 0"
          :description="t('connection.noProfiles')"
          size="small"
          style="padding: 32px 0;"
        />
        <div
          v-for="profile in connectionStore.profiles"
          :key="profile.id"
          class="profile-item"
          :class="{ connected: isProfileConnected(profile.id) }"
          role="button"
          tabindex="0"
          :aria-label="`${t('connection.editProfile')}: ${profile.name || t('connection.defaultProfileName')}`"
          @click="openProfile(profile.id)"
          @keydown.enter="openProfile(profile.id)"
          @keydown.space.prevent
          @keyup.space="openProfile(profile.id)"
        >
          <div class="profile-item-main">
            <div class="profile-item-name">
              <span>{{ profile.name || t('connection.defaultProfileName') }}</span>
              <n-tag
                v-if="isProfileConnected(profile.id)"
                type="success"
                size="tiny"
                :bordered="false"
                round
              >
                {{ t('connection.connected') }}
              </n-tag>
            </div>
            <div class="profile-item-endpoint">{{ profileEndpoint(profile) }}</div>
          </div>
          <div class="profile-item-actions" @click.stop>
            <n-button
              v-if="isProfileConnected(profile.id)"
              size="small"
              type="default"
              class="app-action-btn disconnect-btn"
              @click="handleDisconnect"
            >
              {{ t('connection.disconnect') }}
            </n-button>
            <n-button
              v-else
              size="small"
              type="primary"
              class="app-action-btn"
              :loading="connectingProfileId === profile.id"
              :disabled="connectionStore.isConnecting && connectingProfileId !== profile.id"
              @click="handleConnectProfile(profile)"
            >
              {{ t('connection.connect') }}
            </n-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 二级：配置详情编辑 -->
    <div v-else class="profile-edit-view">
      <div class="profile-manager">
        <div class="profile-select-row">
          <n-select
            v-model:value="selectedProfileId"
            :options="profileOptions"
            @update:value="handleProfileChange"
            style="flex: 1"
          />
          <n-button size="small" quaternary :title="t('connection.renameProfile')" @click="openNameDialog('rename')">
            <template #icon>
              <n-icon><CreateOutline /></n-icon>
            </template>
          </n-button>
          <n-button
            size="small"
            quaternary
            :title="t('connection.deleteProfile')"
            :disabled="connectionStore.profiles.length <= 1"
            @click="handleDeleteProfile"
          >
            <template #icon>
              <n-icon><TrashOutline /></n-icon>
            </template>
          </n-button>
        </div>
      </div>

      <n-divider style="margin: 12px 0 16px;" />

      <n-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-placement="left"
        label-width="auto"
        label-align="left"
      >
        <n-form-item :label="t('connection.protocol')" path="protocol">
          <n-select v-model:value="form.protocol" :options="protocolOptions" style="width: 100%" />
        </n-form-item>
        <n-form-item :label="t('connection.host')" path="host">
          <n-input v-model:value="form.host" :placeholder="t('connection.hostPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('connection.port')" path="port">
          <n-input-number
            v-model:value="form.port"
            :min="1"
            :max="65535"
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item :label="t('connection.path')" path="path">
          <n-input v-model:value="form.path" :placeholder="t('connection.pathPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('connection.secret')" path="secret">
          <n-input
            v-model:value="form.secret"
            type="password"
            :placeholder="t('connection.secretPlaceholder')"
            show-password-on="click"
          />
        </n-form-item>
      </n-form>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <n-space justify="end">
          <template v-if="view === 'list'">
            <n-button @click="visible = false">{{ t('common.close') }}</n-button>
          </template>
          <template v-else>
            <n-button @click="goBackToList">
              <template #icon>
                <n-icon><ArrowBackOutline /></n-icon>
              </template>
              {{ t('connection.back') }}
            </n-button>
            <n-button :loading="saving" @click="handleSave">{{ t('connection.save') }}</n-button>
            <!-- 文案保持固定：加载态由全局样式把文字换成加载圈，若在此切换成更长的
                 「连接中...」，隐藏的文字仍会撑开按钮宽度，违反"按钮长宽不变" -->
            <n-button
              type="primary"
              :loading="connecting"
              @click="handleConnect"
            >
              {{ t('connection.connect') }}
            </n-button>
          </template>
        </n-space>
      </div>
    </template>
  </n-modal>

  <!-- 新建/重命名配置名称对话框 -->
  <n-modal
    v-model:show="nameDialogVisible"
    :title="nameMode === 'new' ? t('connection.newProfile') : t('connection.renameProfile')"
    preset="card"
    style="width: 400px"
    :bordered="false"
    :mask-closable="false"
  >
    <n-input
      v-model:value="nameInput"
      :placeholder="t('connection.profileNamePlaceholder')"
      @keyup.enter="confirmName"
    />
    <template #footer>
      <n-space justify="end">
        <n-button @click="nameDialogVisible = false">{{ t('common.cancel') }}</n-button>
        <n-button type="primary" :loading="nameLoading" @click="confirmName">{{ t('common.confirm') }}</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message, confirm } from '@/utils/feedback'
import { getUserFriendlyError } from '@/utils/errorMessages'
import { buildConnectionFailureMessage } from '@/shared/connectionDiagnostics'
import type { FormInst, FormRules, SelectOption } from 'naive-ui'
import { ArrowBackOutline, AddOutline, CreateOutline, TrashOutline } from '@vicons/ionicons5'
import { useConnectionStore } from '@/stores/connectionStore'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'
import type { Aria2Config, ConnectionProfile } from '@/types/aria2'
import { isReservedSecretPrefix } from '@/shared/secretPrefix'
import { withMinimumDuration } from '@/composables/useMinimumLoading'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const { t } = useI18n()
const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const connectionStore = useConnectionStore()
const formRef = ref<FormInst>()
const connecting = ref(false)
const saving = ref(false)
// 一级列表中正在连接的那一项（逐项 loading，避免所有按钮一起转圈）
const connectingProfileId = ref('')

// 对话框内部视图：list=配置列表（一级），edit=配置详情（二级）
const view = ref<'list' | 'edit'>('list')

const protocolOptions = [
  { label: 'HTTP', value: 'http' },
  { label: 'HTTPS', value: 'https' },
  { label: 'WebSocket', value: 'ws' },
  { label: 'WebSocket Secure', value: 'wss' }
]

const form = reactive<Aria2Config>({
  protocol: 'http',
  host: 'localhost',
  port: 6800,
  path: '/jsonrpc',
  secret: ''
})

const rules = computed<FormRules>(() => ({
  host: [
    { required: true, message: () => t('connection.requireHost'), trigger: 'blur' }
  ],
  port: [
    { required: true, type: 'number', message: () => t('connection.requirePort'), trigger: 'blur' },
    { type: 'number', min: 1024, max: 65535, message: () => t('connection.portRange'), trigger: 'blur' }
  ],
  secret: [
    {
      // `v1:` 是主进程密文存储的保留前缀：以它开头的"密钥"会被幂等护栏原样存储、
      // 再被解密器当密文处理而清空，必须在入口拒绝。判定与主进程共用
      // src/shared/secretPrefix，避免两边各写一份正则而失配
      validator: (_rule, value: string) =>
        !value || !isReservedSecretPrefix(value) ? true : new Error(t('connection.reservedSecretPrefix')),
      trigger: 'blur'
    }
  ]
}))

// 配置名称对话框状态
const nameDialogVisible = ref(false)
const nameMode = ref<'new' | 'rename'>('new')
const nameInput = ref('')
const nameLoading = ref(false)

// 当前正在编辑的配置预设
const selectedProfileId = ref<string>('default')

const profileOptions = computed<SelectOption[]>(() =>
  connectionStore.profiles.map(p => ({
    label: p.name || t('connection.defaultProfileName'),
    value: p.id
  }))
)

// v-model 转发
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => {
    emit('update:modelValue', value)
  }
})

// 每次打开对话框重置到一级配置列表，避免停留在上次关闭时的二级界面
watch(() => props.modelValue, (value) => {
  if (value) {
    view.value = 'list'
    selectedProfileId.value = connectionStore.activeProfileId
  }
})

// ── 一级列表视图 ──

function profileEndpoint(profile: ConnectionProfile): string {
  return `${profile.config.protocol}://${profile.config.host}:${profile.config.port}`
}

function isProfileConnected(profileId: string): boolean {
  return connectionStore.isConnected && connectionStore.activeProfileId === profileId
}

function openProfile(profileId: string) {
  selectedProfileId.value = profileId
  loadProfileToForm(profileId)
  view.value = 'edit'
}

function goBackToList() {
  view.value = 'list'
}

function handleDisconnect() {
  connectionStore.disconnect()
  message.success(t('connection.disconnected'))
}

// 一级列表里直接连接某个配置：不进入二级编辑，直接用该配置的已保存参数连接
async function handleConnectProfile(profile: ConnectionProfile) {
  connectingProfileId.value = profile.id
  try {
    // 按预设连接：成功后才把该预设切成「当前」，失败不会改动当前连接。
    // 并发点另一个实例时，新的连接会接管，旧尝试返回 false 后静默退出。
    const connected = await withMinimumDuration(() => connectionStore.connect({ ...profile.config }, profile.id))
    if (!connected) return
    message.success(t('connection.connectSuccess'))
  } catch (error) {
    console.error('Connection failed:', error)
    message.error(
      buildConnectionFailureMessage({
        host: profile.config.host,
        error,
        baseMessage: getUserFriendlyError(error, t('connection.connectionFailed')),
        proxyHint: t('connection.proxyHint')
      })
    )
  } finally {
    // 并发连接时状态可能已被另一个预设接管，只有仍归自己时才清空
    if (connectingProfileId.value === profile.id) connectingProfileId.value = ''
  }
}

// ── 二级编辑视图 ──

function loadProfileToForm(profileId: string) {
  const profile = connectionStore.profiles.find(p => p.id === profileId)
  const config = profile?.config || connectionStore.config
  Object.assign(form, {
    protocol: config.protocol,
    host: config.host,
    port: config.port,
    path: config.path || '/jsonrpc',
    secret: config.secret || ''
  })
}

function handleProfileChange() {
  loadProfileToForm(selectedProfileId.value)
}

async function handleSave() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
    saving.value = true

    // 仅保存配置，不切换激活连接（避免已连接的配置被标记为未连接）
    await connectionStore.updateProfileConfig(selectedProfileId.value, { ...form })

    message.success(t('connection.saved'))
  } catch (error) {
    console.error('Failed to save profile:', error)
  } finally {
    saving.value = false
  }
}

async function handleConnect() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()

    connecting.value = true

    // 按当前编辑的预设连接：成功后才切换「当前」预设
    const connected = await withMinimumDuration(() => connectionStore.connect({ ...form }, selectedProfileId.value))
    if (!connected) return

    message.success(t('connection.connectSuccess'))
    visible.value = false
  } catch (error) {
    console.error('Connection failed:', error)
    // 主机是环回 IP 字面量且是网络层失败时，追加"试试 localhost"（系统代理会拦 IP 字面量，实测见 src/shared/connectionDiagnostics.ts）
    message.error(
      buildConnectionFailureMessage({
        host: form.host,
        error,
        baseMessage: getUserFriendlyError(error, t('connection.connectionFailed')),
        proxyHint: t('connection.proxyHint')
      })
    )
  } finally {
    connecting.value = false
  }
}

function openNameDialog(mode: 'new' | 'rename') {
  nameMode.value = mode
  nameInput.value = mode === 'rename' ? (connectionStore.profiles.find(p => p.id === selectedProfileId.value)?.name || '') : ''
  nameDialogVisible.value = true
}

async function confirmName() {
  const name = nameInput.value.trim()
  if (!name) {
    message.warning(t('connection.profileNameRequired'))
    return
  }

  nameLoading.value = true
  try {
    if (nameMode.value === 'new') {
      const profile = await connectionStore.createProfile(name, { ...form })
      selectedProfileId.value = profile.id
      loadProfileToForm(profile.id)
      // 从列表新建后进入该配置的详情编辑页
      if (view.value === 'list') {
        view.value = 'edit'
      }
    } else {
      await connectionStore.renameProfile(selectedProfileId.value, name)
    }
    nameDialogVisible.value = false
  } catch (error) {
    console.error('Failed to save profile name:', error)
  } finally {
    nameLoading.value = false
  }
}

function handleDeleteProfile() {
  const profile = connectionStore.profiles.find(p => p.id === selectedProfileId.value)
  const name = profile?.name || t('connection.defaultProfileName')
  confirm({
    title: t('connection.deleteProfileTitle'),
    content: t('connection.confirmDeleteProfile', { name }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await connectionStore.deleteProfile(selectedProfileId.value)
        // 删除后返回一级配置列表，而不是停留在自动切换的默认配置编辑页
        selectedProfileId.value = connectionStore.activeProfileId
        goBackToList()
      } catch (error) {
        console.error('Failed to delete profile:', error)
      }
    }
  })
}
</script>

<style scoped>
.profile-list-view {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-4);
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--ds-space-12);
}

.list-title {
  font-size: var(--ds-text-body-size);
  font-weight: 600;
  color: var(--ds-text-strong);
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-8);
}

/* v2：卡片静置无阴影、无浮起位移；hover 只换底与描边。位移留给真正可拖拽的元素 */
.profile-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-12);
  padding: var(--ds-space-12) var(--ds-space-16);
  background: var(--ds-bg-sunken);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg);
  cursor: pointer;
  transition:
    border-color var(--ds-motion-dur-2) var(--ds-motion-ease-out),
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-out);
}

.profile-item:hover {
  border-color: var(--ds-border-strong);
  background: var(--ds-bg-hover);
}

/* 已连接用 3px 左侧指示条（和侧栏/设置导航同一套「当前项」语言），不再只靠描边变色 */
.profile-item.connected {
  border-color: var(--ds-accent-border);
  box-shadow: inset 3px 0 0 var(--ds-status-success-solid);
}

.profile-item.connected {
  border-color: var(--ds-status-success-solid);
}

.profile-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-2);
}

.profile-item-name {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  font-size: var(--ds-text-body-size);
  font-weight: 600;
  color: var(--ds-text-strong);
}

.profile-item-endpoint {
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
  font-family: var(--ds-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-item-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
}

.profile-edit-view {
  display: flex;
  flex-direction: column;
}

.profile-manager {
  margin-bottom: var(--ds-space-4);
}

.profile-select-row {
  display: flex;
  align-items: center;
  gap: var(--ds-space-4);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--ds-space-8);
}

:deep(.app-action-btn) {
  height: var(--ds-control-height-sm);
  border-radius: var(--ds-radius-md);
  font-weight: 500;
}

/* 断开按钮：灰边框+红字，悬浮时边框与字体变红 */
:deep(.disconnect-btn) {
  color: var(--ds-status-danger-text) !important;
}

:deep(.disconnect-btn:hover:not([disabled])) {
  color: var(--ds-status-danger-text) !important;
}

:deep(.disconnect-btn:hover:not([disabled]) .n-button__state-border) {
  border-color: var(--ds-status-danger-solid);
}

/* 断开按钮点击后的 focus 状态不显示蓝色边框，仅悬浮时边框变红 */
:deep(.disconnect-btn:focus:not(:hover) .n-button__state-border) {
  border-color: transparent;
}
</style>
