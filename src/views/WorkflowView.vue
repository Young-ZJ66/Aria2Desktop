<template>
  <div class="workflow-view">
    <PageHeader :title="t('nav.workflowSettings')" />
    <!-- tab 已经说明「这是哪一页」，面板里不再重复标题：左说明、右主操作、下面内容 -->
    <n-tabs v-model:value="activeSection" type="line" animated class="workflow-tabs">
      <n-tab-pane name="templates">
        <template #tab>
          <span class="tab-label">
            {{ t('workflow.templatesTitle') }}
            <span class="tab-count ds-tnum">{{ templates.length }}</span>
          </span>
        </template>

        <!-- 空态统一成「标题 + 一句解释 + 主操作」：只写「暂无模板」时用户不知道该点哪里 -->
        <UiPanel
          v-if="templates.length === 0"
          class="section-panel section-panel--fill section-panel--empty"
        >
          <UiEmpty
            :title="t('workflow.noTemplates')"
            :icon="AlbumsOutline"
          >
            <template #actions>
              <n-button size="small" type="primary" @click="addTemplate">
                {{ t('workflow.addTemplate') }}
              </n-button>
            </template>
          </UiEmpty>
        </UiPanel>
        <UiPanel v-else class="section-panel section-panel--fill">
          <template #actions>
            <n-button size="small" type="primary" @click="addTemplate">
              {{ t('workflow.addTemplate') }}
            </n-button>
          </template>

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

          <template #footer>
            <div class="panel-footer-actions">
              <n-button type="primary" :loading="saving" @click="saveTemplates">{{ t('workflow.saveTemplates') }}</n-button>
            </div>
          </template>
        </UiPanel>
      </n-tab-pane>

      <n-tab-pane name="rules">
        <template #tab>
          <span class="tab-label">
            {{ t('workflow.rulesTitle') }}
            <span class="tab-count ds-tnum">{{ rules.length }}</span>
          </span>
        </template>

        <UiPanel
          v-if="rules.length === 0"
          class="section-panel section-panel--fill section-panel--empty"
        >
          <UiEmpty
            :title="t('workflow.noRules')"
            :icon="GitBranchOutline"
          >
            <template #actions>
              <n-button size="small" type="primary" @click="addRule">
                {{ t('workflow.addRule') }}
              </n-button>
            </template>
          </UiEmpty>
        </UiPanel>
        <UiPanel v-else class="section-panel section-panel--fill">
          <template #actions>
            <n-button size="small" type="primary" @click="addRule">
              {{ t('workflow.addRule') }}
            </n-button>
          </template>

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

          <template #footer>
            <div class="panel-footer-actions">
              <n-button type="primary" :loading="saving" @click="saveRules">{{ t('workflow.saveRules') }}</n-button>
            </div>
          </template>
        </UiPanel>
      </n-tab-pane>

      <!-- Webhook 投递队列：规则触发的投递失败后会按指数退避自动重试，超过上限的条目在这里手动处理 -->
      <n-tab-pane name="queue">
        <template #tab>
          <span class="tab-label">
            {{ t('settings.webhookQueue.title') }}
            <span class="tab-count ds-tnum">{{ queueEntries.length }}</span>
          </span>
        </template>

        <UiPanel
          v-if="queueLoading && queueEntries.length === 0"
          class="section-panel section-panel--fill section-panel--empty"
        >
          <div class="panel-state">{{ t('common.loading') }}</div>
        </UiPanel>
        <UiPanel
          v-else-if="queueEntries.length === 0"
          class="section-panel section-panel--fill section-panel--empty"
        >
          <UiEmpty
            :title="t('settings.webhookQueue.empty')"
            :icon="CloudUploadOutline"
          >
            <template #actions>
              <n-button size="small" :loading="queueLoading" @click="refreshQueue()">
                {{ t('settings.webhookQueue.refresh') }}
              </n-button>
            </template>
          </UiEmpty>
        </UiPanel>
        <UiPanel v-else flush class="section-panel section-panel--fill">
          <template #actions>
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
          </template>
          <n-data-table
            :columns="queueColumns"
            :data="queueEntries"
            :row-key="(row: WebhookQueueEntry) => row.id"
            :bordered="false"
            size="small"
            :scroll-x="860"
          />
        </UiPanel>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import { UiEmpty, UiPanel } from '@/components/ui'
import { AlbumsOutline, CloudUploadOutline, GitBranchOutline } from '@vicons/ionicons5'
import { getUserFriendlyError } from '@/utils/errorMessages'
import { NButton, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useSettingsStore } from '@/stores/settingsStore'
import type { CompletionRule, TaskTemplate } from '@/shared/appSettings'
import type { WebhookQueueEntry } from '@/shared/webhookQueue'
import { formatCompleteTime } from '@/utils/taskFormatters'
import { withMinimumDuration } from '@/composables/useMinimumLoading'

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
// 三个分区各占一个标签页：模板条目一多，规则会被挤到首屏之外，分页后每块都能直接看到
const activeSection = ref<'templates' | 'rules' | 'queue'>('templates')

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
    // 原始错误可能是 window.electronAPI is not available 这类内部串，只进控制台
    console.error('[WorkflowView] 保存失败', error)
    message.error(getUserFriendlyError(error))
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
    // 原始错误可能是 window.electronAPI is not available 这类内部串，只进控制台
    console.error('[WorkflowView] 保存失败', error)
    message.error(getUserFriendlyError(error))
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
    // 本地读取队列通常瞬间返回，补齐最短时长让刷新动画可见
    const result = await withMinimumDuration(async () => window.electronAPI?.webhookQueueList?.())
    queueEntries.value = result?.entries ?? []
  } catch (error) {
    console.error('[WorkflowView] 读取 Webhook 投递队列失败:', error)
    message.error(t('settings.webhookQueue.loadFailed', { error: getUserFriendlyError(error) }))
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
      message.error(t('settings.webhookQueue.retryFailed', { error: getUserFriendlyError(result.error, t('settings.unknownError')) }))
      return
    }
    message.success(t('settings.webhookQueue.retrySuccess'))
    await refreshQueue(true)
  } catch (error) {
    console.error('[WorkflowView] 重试 Webhook 投递失败:', error)
    message.error(t('settings.webhookQueue.retryFailed', { error: getUserFriendlyError(error) }))
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
    console.error('[WorkflowView] 清空 Webhook 投递队列失败:', error)
    message.error(t('settings.webhookQueue.clearFailed', { error: getUserFriendlyError(error) }))
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
    width: 96,
    align: 'right',
    render: row => h('span', { class: 'ds-tnum' }, `${row.attempts}/${row.maxRetries}`)
  },
  {
    title: t('settings.webhookQueue.colNextAttempt'),
    key: 'nextAttemptAt',
    width: 170,
    render: row => h('span', { class: 'cell-time' }, formatNextAttempt(row))
  },
  {
    title: t('settings.webhookQueue.colLastError'),
    key: 'lastError',
    minWidth: 200,
    ellipsis: { tooltip: true },
    render: row => h('span', { class: 'cell-sub' }, row.lastError?.trim() || '--')
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

// 投递队列轮询：keep-alive 下页面不会被卸载，改为随「激活 / 失活」启停
function startQueuePolling(): void {
  if (queueTimer !== undefined) return
  queueTimer = setInterval(() => { void refreshQueue() }, QUEUE_POLL_INTERVAL_MS)
}

function stopQueuePolling(): void {
  if (queueTimer !== undefined) {
    clearInterval(queueTimer)
    queueTimer = undefined
  }
}

let activatedOnce = false

onMounted(() => {
  load()
  void refreshQueue()
})

// keep-alive 下切回来时组件不重新挂载：恢复轮询并静默刷新一次队列。
// 首次进入时 onMounted 已拉过数据，用 activatedOnce 跳过，避免重复请求。
onActivated(() => {
  startQueuePolling()
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  void refreshQueue()
})

// 切走时停表：页面被缓存着，不停表会一直轮询
onDeactivated(() => {
  stopQueuePolling()
})

onUnmounted(() => {
  stopQueuePolling()
})
</script>

<style scoped>
.workflow-view {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-16);
  height: 100%;
  min-height: 0;
}

/* ---------------- tab 栏 ---------------- */
.workflow-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.workflow-tabs :deep(.n-tabs-nav) {
  flex: none;
}

.workflow-tabs :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
}

.workflow-tabs :deep(.n-tab-pane) {
  height: 100%;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-space-6);
}

/* 计数从标题字符串里拆出来做成 pill：不切页也能读出这一页有多少条 */
.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--ds-radius-pill);
  background: var(--ds-bg-sunken);
  color: var(--ds-text-muted);
  font-size: var(--ds-text-micro-size);
  font-weight: 500;
  transition:
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.workflow-tabs :deep(.n-tabs-tab--active) .tab-count {
  background: var(--ds-accent-subtle);
  color: var(--ds-accent-text);
}

/* 表单控件铺满栅格单元（flex 尺寸见 .action-type / .method-select） */
.workflow-view :deep(.n-input),
.workflow-view :deep(.n-select),
.workflow-view :deep(.n-input-number) {
  width: 100%;
}

/* ---------------- 面板 ---------------- */
.section-panel--fill {
  height: 100%;
}

.section-panel--fill :deep(.ui-panel__body) {
  overflow: auto;
}

.section-panel--empty :deep(.ui-panel__body) {
  display: flex;
  align-items: center;
  justify-content: center;
}

.section-panel :deep(.n-data-table-th),
.section-panel :deep(.n-data-table-td) {
  padding: var(--ds-space-12) var(--ds-space-16);
}

/* 行悬停走 v2 的 hover 表面，深色下不会出现 naive 默认的浅灰 */
.section-panel :deep(.n-data-table-tr:hover .n-data-table-td) {
  background-color: var(--ds-bg-hover);
}

.panel-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ds-space-8);
}

.panel-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ds-space-32);
  color: var(--ds-text-muted);
  font-size: var(--ds-text-small-size);
}

/* ---------------- 编辑块 ---------------- */
/* 块与块之间用一条细线分隔，而不是再套一层盒子（v2 只保留一种表面） */
.editor-block {
  padding: var(--ds-space-16) 0;
  border-top: 1px solid var(--ds-border-subtle);
}

.editor-block:first-child {
  padding-top: 0;
  border-top: none;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-8);
  margin-bottom: var(--ds-space-12);
}

.block-title-row {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--ds-space-8);
  min-width: 0;
}

.name-input {
  max-width: 320px;
}

/* 小节标签：11px 大写感的小标题，把「条件 / 动作」从字段里拎出来 */
.sub-title {
  margin: var(--ds-space-12) 0 var(--ds-space-6);
  font-size: var(--ds-text-micro-size);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ds-text-muted);
}

.action-block {
  padding: var(--ds-space-12);
  border-radius: var(--ds-radius-sm);
  background: var(--ds-bg-sunken);
}

.action-block + .action-block {
  margin-top: var(--ds-space-8);
}

.action-row {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
}

/* 用 flex-basis 固定宽度，避免被上面的 width:100% 覆盖 */
.action-type {
  flex: 0 0 130px;
}

.method-select {
  flex: 0 0 90px;
}

.action-extra {
  display: flex;
  align-items: flex-end;
  gap: var(--ds-space-8);
  margin-top: var(--ds-space-8);
}

.extra-secret {
  flex: 1 1 260px;
  min-width: 0;
}

.extra-number {
  flex: 0 0 140px;
}

/* ---------------- 单元格 ---------------- */
.cell-time {
  font-size: var(--ds-text-small-size);
  font-variant-numeric: tabular-nums;
  color: var(--ds-text-muted);
}

.cell-sub {
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}
</style>
