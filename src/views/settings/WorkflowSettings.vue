<template>
  <div class="workflow-settings">
    <n-tabs v-model:value="activeSection" type="line" animated class="workflow-tabs">
      <n-tab-pane name="templates" :tab="templateTab">
        <n-card :bordered="false" class="section-card">
          <template #header>
            <div class="section-header">
              <div>
                <div class="section-title">{{ t('workflow.templatesTitle') }}</div>
                <div class="section-desc">{{ t('workflow.templatesDesc') }}</div>
              </div>
              <n-button size="small" @click="addTemplate">
                {{ t('workflow.addTemplate') }}
              </n-button>
            </div>
          </template>

          <n-empty v-if="templates.length === 0" :description="t('workflow.noTemplates')" />
          <div v-for="(template, index) in templates" :key="template.id" class="editor-block">
            <div class="block-head">
              <n-input v-model:value="template.name" size="small" :placeholder="t('workflow.templateName')" class="name-input" />
              <n-button size="tiny" quaternary type="error" @click="removeTemplate(index)">
                {{ t('workflow.delete') }}
              </n-button>
            </div>
            <n-grid :cols="2" :x-gap="12" :y-gap="8">
              <n-grid-item>
                <n-form-item :label="t('workflow.dir')" :show-feedback="false">
                  <n-input v-model:value="template.dir" size="small" :placeholder="t('workflow.dirPlaceholder')" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('workflow.proxy')" :show-feedback="false">
                  <n-input v-model:value="template.proxy" size="small" placeholder="http://127.0.0.1:7890" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('workflow.userAgent')" :show-feedback="false">
                  <n-input v-model:value="template.userAgent" size="small" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('workflow.referer')" :show-feedback="false">
                  <n-input v-model:value="template.referer" size="small" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('workflow.cookie')" :show-feedback="false">
                  <n-input v-model:value="template.cookie" size="small" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('workflow.maxConnection')" :show-feedback="false">
                  <n-input-number v-model:value="template.maxConnectionPerServer" size="small" :min="1" :max="16" />
                </n-form-item>
              </n-grid-item>
            </n-grid>
            <n-form-item :label="t('workflow.headers')" :show-feedback="false">
              <n-input v-model:value="template.headers" type="textarea" :rows="2" :placeholder="t('workflow.headersPlaceholder')" />
            </n-form-item>
          </div>
          <div v-if="templates.length > 0" class="section-actions">
            <n-button type="primary" :loading="saving" @click="saveTemplates">{{ t('workflow.saveTemplates') }}</n-button>
          </div>
        </n-card>
      </n-tab-pane>

      <n-tab-pane name="rules" :tab="ruleTab">
        <n-card :bordered="false" class="section-card">
          <template #header>
            <div class="section-header">
              <div>
                <div class="section-title">{{ t('workflow.rulesTitle') }}</div>
                <div class="section-desc">{{ t('workflow.rulesDesc') }}</div>
              </div>
              <n-button size="small" @click="addRule">
                {{ t('workflow.addRule') }}
              </n-button>
            </div>
          </template>

          <n-empty v-if="rules.length === 0" :description="t('workflow.noRules')" />
          <div v-for="(rule, index) in rules" :key="rule.id" class="editor-block">
            <div class="block-head">
              <div class="block-title-row">
                <n-switch v-model:value="rule.enabled" size="small" />
                <n-input v-model:value="rule.name" size="small" :placeholder="t('workflow.ruleName')" class="name-input" />
              </div>
              <n-button size="tiny" quaternary type="error" @click="removeRule(index)">
                {{ t('workflow.delete') }}
              </n-button>
            </div>

            <div class="sub-title">{{ t('workflow.conditions') }}</div>
            <n-grid :cols="3" :x-gap="12" :y-gap="8">
              <n-grid-item>
                <n-form-item :label="t('workflow.conditionCategory')" :show-feedback="false">
                  <n-input v-model:value="rule.conditionCategory" size="small" :placeholder="t('workflow.anyCategory')" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('workflow.conditionExtensions')" :show-feedback="false">
                  <n-input v-model:value="rule.conditionExtensions" size="small" placeholder="mp4, mkv" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('workflow.conditionStatus')" :show-feedback="false">
                  <n-select v-model:value="rule.conditionStatus" size="small" :options="statusOptions" :placeholder="t('workflow.anyStatus')" clearable />
                </n-form-item>
              </n-grid-item>
            </n-grid>

            <div class="sub-title">{{ t('workflow.actions') }}</div>
            <div v-for="(action, actionIndex) in rule.actions" :key="actionIndex" class="action-block">
              <div class="action-row">
                <n-select v-model:value="action.type" size="small" :options="actionTypeOptions" class="action-type" />
                <n-input v-if="action.type === 'move'" v-model:value="action.targetDir" size="small" :placeholder="t('workflow.targetDir')" />
                <n-input v-if="action.type === 'rename'" v-model:value="action.pattern" size="small" :placeholder="t('workflow.renamePattern')" />
                <n-input v-if="action.type === 'webhook'" v-model:value="action.url" size="small" :placeholder="t('workflow.webhookUrl')" />
                <n-select v-if="action.type === 'webhook'" v-model:value="action.method" size="small" :options="methodOptions" class="method-select" />
                <n-input v-if="action.type === 'notify'" v-model:value="action.title" size="small" :placeholder="t('workflow.notifyTitle')" />
                <n-input v-if="action.type === 'notify'" v-model:value="action.body" size="small" :placeholder="t('workflow.notifyBody')" />
                <n-button size="tiny" quaternary type="error" @click="rule.actions.splice(actionIndex, 1)">
                  {{ t('workflow.delete') }}
                </n-button>
              </div>
              <!-- Webhook 的签名与重试参数单独占一行：和地址挤在一起会让输入框窄到无法辨认 -->
              <div v-if="action.type === 'webhook'" class="action-extra">
                <n-form-item :label="t('workflow.webhookSecret')" :show-feedback="false" class="extra-secret">
                  <n-input
                    v-model:value="action.secret"
                    size="small"
                    type="password"
                    show-password-on="click"
                    :placeholder="t('workflow.webhookSecretPlaceholder')"
                  />
                </n-form-item>
                <n-form-item :label="t('workflow.webhookMaxRetries')" :show-feedback="false" class="extra-number">
                  <n-input-number
                    :value="action.maxRetries ?? 4"
                    size="small"
                    :min="0"
                    :max="10"
                    @update:value="(value) => setWebhookMaxRetries(action, value)"
                  />
                </n-form-item>
                <n-form-item :label="t('workflow.webhookRetryDelay')" :show-feedback="false" class="extra-number">
                  <n-input-number
                    :value="action.retryDelaySeconds ?? 60"
                    size="small"
                    :min="5"
                    :max="3600"
                    @update:value="(value) => setWebhookRetryDelay(action, value)"
                  >
                    <template #suffix>{{ t('workflow.webhookRetryDelayUnit') }}</template>
                  </n-input-number>
                </n-form-item>
              </div>
            </div>
            <n-button size="tiny" dashed @click="addAction(rule)">{{ t('workflow.addAction') }}</n-button>
          </div>
          <div v-if="rules.length > 0" class="section-actions">
            <n-button type="primary" :loading="saving" @click="saveRules">{{ t('workflow.saveRules') }}</n-button>
          </div>
        </n-card>
      </n-tab-pane>
    </n-tabs>

    <!-- Webhook 投递队列：规则触发的投递失败后会按指数退避自动重试，超过上限的条目在这里手动处理 -->
    <n-card :bordered="false" class="section-card queue-card">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-title">{{ t('settings.webhookQueue.title') }}</div>
            <div class="section-desc">{{ t('settings.webhookQueue.description') }}</div>
          </div>
          <n-space>
            <n-button size="small" :loading="queueLoading" @click="refreshQueue()">
              {{ t('settings.webhookQueue.refresh') }}
            </n-button>
            <n-popconfirm @positive-click="clearQueue">
              <template #trigger>
                <n-button size="small" type="error" secondary :disabled="queueEntries.length === 0">
                  {{ t('settings.webhookQueue.clear') }}
                </n-button>
              </template>
              {{ t('settings.webhookQueue.clearConfirm', { count: queueEntries.length }) }}
            </n-popconfirm>
          </n-space>
        </div>
      </template>

      <n-empty v-if="queueEntries.length === 0" :description="t('settings.webhookQueue.empty')" />
      <n-data-table
        v-else
        :columns="queueColumns"
        :data="queueEntries"
        :row-key="(row: WebhookQueueEntry) => row.id"
        :bordered="false"
        size="small"
        :scroll-x="860"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useSettingsStore } from '@/stores/settingsStore'
import type { CompletionRule, TaskTemplate } from '@/shared/appSettings'
import type { WebhookQueueEntry } from '@/shared/webhookQueue'
import { formatCompleteTime } from '@/utils/taskFormatters'

interface EditableAction {
  type: 'move' | 'rename' | 'open' | 'notify' | 'webhook' | 'extract'
  targetDir?: string
  pattern?: string
  url?: string
  method?: 'POST' | 'GET'
  secret?: string
  maxRetries?: number
  retryDelaySeconds?: number
  title?: string
  body?: string
}

interface RuleDraft {
  id: string
  name: string
  enabled: boolean
  conditionCategory: string
  conditionExtensions: string
  conditionStatus: '' | 'complete' | 'error'
  actions: EditableAction[]
}

const { t } = useI18n()
const message = useMessage()
const settingsStore = useSettingsStore()
const saving = ref(false)
const templates = ref<TaskTemplate[]>([])
const rules = ref<RuleDraft[]>([])
const activeSection = ref<'templates' | 'rules'>('templates')
const templateTab = computed(() => `${t('workflow.templatesTitle')} (${templates.value.length})`)
const ruleTab = computed(() => `${t('workflow.rulesTitle')} (${rules.value.length})`)

// 选项标签跟随语言实时切换，避免切换语言后下拉框文案不更新
const statusOptions = computed(() => [
  { label: t('workflow.statusComplete'), value: 'complete' },
  { label: t('workflow.statusError'), value: 'error' }
])
const actionTypeOptions = computed(() => [
  { label: t('workflow.actionMove'), value: 'move' },
  { label: t('workflow.actionRename'), value: 'rename' },
  { label: t('workflow.actionOpen'), value: 'open' },
  { label: t('workflow.actionNotify'), value: 'notify' },
  { label: t('workflow.actionWebhook'), value: 'webhook' },
  { label: t('workflow.actionExtract'), value: 'extract' }
])
const methodOptions = [
  { label: 'POST', value: 'POST' },
  { label: 'GET', value: 'GET' }
]

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toDraft(rule: CompletionRule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    conditionCategory: rule.condition?.category ?? '',
    conditionExtensions: (rule.condition?.extensions ?? []).join(', '),
    conditionStatus: rule.condition?.status ?? '',
    actions: rule.actions.map(action => ({ ...action }))
  }
}

// 动作对象直接展开会带上 UI 的默认值（secret 空串、4/60 的重试参数），落盘前清理成引擎认识的形态：
// 空密钥不写（等价于不签名），重试参数保留用户看到的显式值，避免「界面显示 4、配置里没有」的歧义
function normalizeAction(action: EditableAction): CompletionRule['actions'][number] {
  const next = { ...action } as EditableAction
  if (next.type === 'webhook') {
    const secret = next.secret?.trim() ?? ''
    if (secret) next.secret = secret
    else delete next.secret
  }
  return next as CompletionRule['actions'][number]
}

function fromDraft(rule: RuleDraft): CompletionRule {
  const extensions = rule.conditionExtensions.split(',').map(value => value.trim().replace(/^\./, '')).filter(Boolean)
  const condition: CompletionRule['condition'] = {}
  if (rule.conditionCategory.trim()) condition.category = rule.conditionCategory.trim()
  if (extensions.length > 0) condition.extensions = extensions
  if (rule.conditionStatus) condition.status = rule.conditionStatus
  return {
    id: rule.id,
    name: rule.name.trim() || 'rule',
    enabled: rule.enabled,
    condition: Object.keys(condition).length > 0 ? condition : undefined,
    actions: rule.actions.map(normalizeAction)
  }
}

function load(): void {
  templates.value = JSON.parse(JSON.stringify(settingsStore.settings.taskTemplates ?? []))
  rules.value = (settingsStore.settings.completionRules ?? []).map(toDraft)
}

function addTemplate(): void {
  templates.value.push({ id: uid(), name: t('workflow.newTemplateName') })
}

function removeTemplate(index: number): void {
  templates.value.splice(index, 1)
}

function addRule(): void {
  rules.value.push({
    id: uid(),
    name: t('workflow.newRuleName'),
    enabled: true,
    conditionCategory: '',
    conditionExtensions: '',
    conditionStatus: '',
    actions: [{ type: 'notify', title: t('workflow.defaultNotifyTitle'), body: '{name}' }]
  })
}

function removeRule(index: number): void {
  rules.value.splice(index, 1)
}

function addAction(rule: RuleDraft): void {
  rule.actions.push({ type: 'notify', title: t('workflow.defaultNotifyTitle'), body: '{name}' })
}

async function saveTemplates(): Promise<void> {
  saving.value = true
  try {
    await settingsStore.updateSetting('taskTemplates', templates.value)
    message.success(t('workflow.saved'))
  } catch (error) {
    message.error(String(error))
  } finally {
    saving.value = false
  }
}

function actionIncomplete(action: EditableAction): boolean {
  if (action.type === 'move') return !action.targetDir?.trim()
  if (action.type === 'rename') return !action.pattern?.trim()
  if (action.type === 'webhook') return !/^https?:\/\//i.test(action.url?.trim() || '')
  return false
}

async function saveRules(): Promise<void> {
  const invalidRule = rules.value.find(rule => rule.actions.some(actionIncomplete))
  if (invalidRule) {
    message.error(t('workflow.invalidAction', { name: invalidRule.name }))
    return
  }
  saving.value = true
  try {
    await settingsStore.updateSetting('completionRules', rules.value.map(fromDraft))
    message.success(t('workflow.saved'))
  } catch (error) {
    message.error(String(error))
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------- Webhook 参数

// NInputNumber 在清空时会给出 null，这里把空值还原为缺省语义（0 / 60），避免写进配置的 undefined 被引擎当成默认值之外的脏数据
function setWebhookMaxRetries(action: EditableAction, value: number | null): void {
  action.maxRetries = value ?? 4
}

function setWebhookRetryDelay(action: EditableAction, value: number | null): void {
  action.retryDelaySeconds = value ?? 60
}

// ---------------------------------------------------------------- 投递队列

const QUEUE_POLL_INTERVAL_MS = 15000
const queueEntries = ref<WebhookQueueEntry[]>([])
const queueLoading = ref(false)
const queueRetryingId = ref('')
// 轮询与手动刷新共用一把「在途」锁，避免定时器叠加请求；loading 只用于按钮反馈
let queueRefreshing = false
let queueTimer: ReturnType<typeof setInterval> | undefined

const queueStatusText: Record<WebhookQueueEntry['status'], string> = {
  pending: 'settings.webhookQueue.statusPending',
  delivering: 'settings.webhookQueue.statusDelivering',
  failed: 'settings.webhookQueue.statusFailed'
}

const queueStatusType: Record<WebhookQueueEntry['status'], 'info' | 'warning' | 'error'> = {
  pending: 'info',
  delivering: 'warning',
  failed: 'error'
}

async function refreshQueue(force = false): Promise<void> {
  if (queueRefreshing && !force) return
  queueRefreshing = true
  queueLoading.value = true
  try {
    const result = await window.electronAPI?.webhookQueueList?.()
    queueEntries.value = result?.entries ?? []
  } catch (error) {
    console.error('[WorkflowSettings] 读取 Webhook 投递队列失败:', error)
    message.error(t('settings.webhookQueue.loadFailed', { error: error instanceof Error ? error.message : String(error) }))
  } finally {
    queueRefreshing = false
    queueLoading.value = false
  }
}

async function retryQueueEntry(entry: WebhookQueueEntry): Promise<void> {
  queueRetryingId.value = entry.id
  try {
    const result = await window.electronAPI?.webhookQueueRetry?.(entry.id)
    if (result?.success === false) {
      message.error(t('settings.webhookQueue.retryFailed', { error: result.error ?? t('settings.unknownError') }))
      return
    }
    message.success(t('settings.webhookQueue.retrySuccess'))
    await refreshQueue(true)
  } catch (error) {
    console.error('[WorkflowSettings] 重试 Webhook 投递失败:', error)
    message.error(t('settings.webhookQueue.retryFailed', { error: error instanceof Error ? error.message : String(error) }))
  } finally {
    queueRetryingId.value = ''
  }
}

async function clearQueue(): Promise<void> {
  try {
    const result = await window.electronAPI?.webhookQueueClear?.()
    if (result?.success === false) {
      message.error(t('settings.webhookQueue.clearFailed', { error: t('settings.unknownError') }))
      return
    }
    message.success(t('settings.webhookQueue.cleared', { count: result?.cleared ?? 0 }))
    await refreshQueue(true)
  } catch (error) {
    console.error('[WorkflowSettings] 清空 Webhook 投递队列失败:', error)
    message.error(t('settings.webhookQueue.clearFailed', { error: error instanceof Error ? error.message : String(error) }))
  }
}

// 失败条目不再自动调度，下次投递时间没有意义，统一显示占位横线
function formatNextAttempt(entry: WebhookQueueEntry): string {
  if (entry.status === 'failed' || !Number.isFinite(entry.nextAttemptAt)) return '--'
  return formatCompleteTime(entry.nextAttemptAt)
}

const queueColumns = computed<DataTableColumns<WebhookQueueEntry>>(() => [
  { title: t('settings.webhookQueue.colEvent'), key: 'event', width: 130, ellipsis: { tooltip: true } },
  { title: t('settings.webhookQueue.colUrl'), key: 'url', minWidth: 240, ellipsis: { tooltip: true } },
  {
    title: t('settings.webhookQueue.colStatus'),
    key: 'status',
    width: 110,
    render: row => h(NTag, { size: 'tiny', bordered: false, type: queueStatusType[row.status] }, { default: () => t(queueStatusText[row.status]) })
  },
  {
    title: t('settings.webhookQueue.colAttempts'),
    key: 'attempts',
    width: 90,
    render: row => `${row.attempts}/${row.maxRetries}`
  },
  {
    title: t('settings.webhookQueue.colNextAttempt'),
    key: 'nextAttemptAt',
    width: 170,
    render: row => formatNextAttempt(row)
  },
  {
    title: t('settings.webhookQueue.colLastError'),
    key: 'lastError',
    minWidth: 200,
    ellipsis: { tooltip: true },
    render: row => row.lastError?.trim() || '--'
  },
  {
    title: t('automation.colActions'),
    key: 'actions',
    width: 90,
    render: row => row.status === 'failed'
      ? h(NButton, {
        size: 'tiny',
        loading: queueRetryingId.value === row.id,
        onClick: () => { void retryQueueEntry(row) }
      }, { default: () => t('settings.webhookQueue.retry') })
      : '--'
  }
])

onMounted(() => {
  load()
  void refreshQueue()
  queueTimer = setInterval(() => { void refreshQueue() }, QUEUE_POLL_INTERVAL_MS)
})

onUnmounted(() => {
  if (queueTimer !== undefined) {
    clearInterval(queueTimer)
    queueTimer = undefined
  }
})
</script>

<style scoped>
.workflow-settings {
  display: flex;
  flex-direction: column;
}
.workflow-tabs {
  margin-top: -2px;
}
.workflow-tabs :deep(.n-tabs-nav) {
  margin-bottom: 2px;
}
.section-card {
  border-radius: 10px;
}
.section-card + .section-card {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}
.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.section-title {
  font-size: 15px;
  font-weight: 600;
}
.section-desc {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.65;
  line-height: 1.5;
}
.editor-block {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.block-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.name-input {
  max-width: 320px;
}
.sub-title {
  margin: 8px 0 6px;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
}
.action-block {
  margin-bottom: 8px;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.action-type {
  width: 130px;
  flex-shrink: 0;
}
.method-select {
  width: 90px;
  flex-shrink: 0;
}
.action-extra {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}
.extra-secret {
  flex: 1 1 260px;
  min-width: 200px;
}
.extra-number {
  flex: 0 0 140px;
}
.extra-number :deep(.n-input-number) {
  width: 100%;
}
.section-actions {
  display: flex;
  justify-content: flex-start;
}
.queue-card {
  margin-top: 16px;
}
</style>
