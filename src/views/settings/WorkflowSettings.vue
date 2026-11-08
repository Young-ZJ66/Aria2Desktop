<template>
  <div class="workflow-settings">
    <n-card :bordered="false" class="section-card">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-title">{{ t('workflow.templatesTitle') }}</div>
            <div class="section-desc">{{ t('workflow.templatesDesc') }}</div>
          </div>
          <n-button size="small" type="primary" secondary @click="addTemplate">
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
      <div class="section-actions">
        <n-button type="primary" :loading="saving" @click="saveTemplates">{{ t('workflow.saveTemplates') }}</n-button>
      </div>
    </n-card>

    <n-card :bordered="false" class="section-card">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-title">{{ t('workflow.rulesTitle') }}</div>
            <div class="section-desc">{{ t('workflow.rulesDesc') }}</div>
          </div>
          <n-button size="small" type="primary" secondary @click="addRule">
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
        <div v-for="(action, actionIndex) in rule.actions" :key="actionIndex" class="action-row">
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
        <n-button size="tiny" dashed @click="addAction(rule)">{{ t('workflow.addAction') }}</n-button>
      </div>
      <div class="section-actions">
        <n-button type="primary" :loading="saving" @click="saveRules">{{ t('workflow.saveRules') }}</n-button>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { useSettingsStore } from '@/stores/settingsStore'
import type { CompletionRule, TaskTemplate } from '@/shared/appSettings'

interface EditableAction {
  type: 'move' | 'rename' | 'open' | 'notify' | 'webhook' | 'extract'
  targetDir?: string
  pattern?: string
  url?: string
  method?: 'POST' | 'GET'
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

const statusOptions = [
  { label: t('workflow.statusComplete'), value: 'complete' },
  { label: t('workflow.statusError'), value: 'error' }
]
const actionTypeOptions = [
  { label: t('workflow.actionMove'), value: 'move' },
  { label: t('workflow.actionRename'), value: 'rename' },
  { label: t('workflow.actionOpen'), value: 'open' },
  { label: t('workflow.actionNotify'), value: 'notify' },
  { label: t('workflow.actionWebhook'), value: 'webhook' },
  { label: t('workflow.actionExtract'), value: 'extract' }
]
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
    actions: rule.actions.map(action => ({ ...action })) as CompletionRule['actions']
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

onMounted(load)
</script>

<style scoped>
.workflow-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.section-card {
  border-radius: 10px;
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
.action-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.action-type {
  width: 130px;
  flex-shrink: 0;
}
.method-select {
  width: 90px;
  flex-shrink: 0;
}
.section-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
