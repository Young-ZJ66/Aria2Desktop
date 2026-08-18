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
        <div
          v-for="profile in connectionStore.profiles"
          :key="profile.id"
          class="profile-item"
          :class="{ connected: isProfileConnected(profile.id) }"
          @click="openProfile(profile.id)"
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
        :label-width="100"
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
            <n-button
              type="primary"
              :loading="connecting"
              @click="handleConnect"
            >
              {{ connecting ? t('connection.connectingText') : t('connection.connect') }}
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
import type { FormInst, FormRules, SelectOption } from 'naive-ui'
import { ArrowBackOutline, AddOutline, CreateOutline, TrashOutline } from '@vicons/ionicons5'
import { useConnectionStore } from '@/stores/connectionStore'
import type { Aria2Config, ConnectionProfile } from '@/types/aria2'

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
    { type: 'number', min: 1, max: 65535, message: () => t('connection.portRange'), trigger: 'blur' }
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

    connectionStore.setActiveProfile(selectedProfileId.value)
    await connectionStore.connect({ ...form })

    message.success(t('connection.connectSuccess'))
    visible.value = false
  } catch (error) {
    console.error('Connection failed:', error)
    message.error(error instanceof Error ? error.message : t('connection.connectionFailed'))
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
  gap: 4px;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.list-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.profile-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
}

.profile-item:hover {
  border-color: var(--color-primary);
  background: var(--bg-hover);
}

.profile-item.connected {
  border-color: var(--color-success);
}

.profile-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-item-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.profile-item-endpoint {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-item-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile-edit-view {
  display: flex;
  flex-direction: column;
}

.profile-manager {
  margin-bottom: 4px;
}

.profile-select-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 统一现代化操作按钮：圆角、语义色光晕、悬停轻微浮起（与系统风格一致） */
:deep(.app-action-btn) {
  height: 30px;
  border-radius: 8px;
  font-weight: 500;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

:deep(.app-action-btn:hover:not([disabled])) {
  transform: translateY(-1px);
}

:deep(.app-action-btn:active:not([disabled])) {
  transform: translateY(0);
}

:deep(.app-action-btn--primary-type) {
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 25%, transparent);
}

/* 断开按钮：灰边框+红字，悬浮时边框与字体变红 */
:deep(.disconnect-btn) {
  color: var(--color-danger) !important;
}

:deep(.disconnect-btn:hover:not([disabled])) {
  color: var(--color-danger) !important;
}

:deep(.disconnect-btn:hover:not([disabled]) .n-button__state-border) {
  border-color: var(--color-danger);
}

/* 断开按钮点击后的 focus 状态不显示蓝色边框，仅悬浮时边框变红 */
:deep(.disconnect-btn:focus:not(:hover) .n-button__state-border) {
  border-color: transparent;
}
</style>
