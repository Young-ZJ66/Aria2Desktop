<template>
  <n-form ref="formRef" :model="form" :rules="rules">
    <n-form-item path="uris" :label="t('newTask.urisLabel')" label-placement="top">
      <!-- 固定 6 行：既能完整显示占位提示，又不会随输入内容拉伸（也不允许手动拖拽改高） -->
      <n-input
        v-model:value="form.uris"
        type="textarea"
        :rows="6"
        :resizable="false"
        :placeholder="t('newTask.urlsPlaceholder')"
        @blur="parseCurlIfPresent"
      />
    </n-form-item>
    <n-form-item path="dir" :label="t('newTask.downloadDir')" label-placement="top">
      <n-input v-model:value="form.dir" :placeholder="t('newTask.dirPlaceholder')">
        <template #suffix>
          <n-button text :disabled="!isElectron" @click="selectDir">
            <template #icon><n-icon><FolderOutline /></n-icon></template>
          </n-button>
        </template>
      </n-input>
    </n-form-item>
    <n-form-item path="category" :label="t('newTask.categoryLabel')" label-placement="top">
      <n-select v-model:value="form.category" :options="categoryOptions" />
    </n-form-item>
    <div v-if="targetDir" class="dir-tip">
      {{ autoClassifyFailed
        ? t('newTask.saveToUnclassified', { dir: targetDir })
        : `${t('newTask.saveTo')}：${targetDir}` }}
    </div>
    <n-form-item path="fileName" :label="t('newTask.fileName')" label-placement="top">
      <n-input v-model:value="form.fileName" :placeholder="t('newTask.fileNamePlaceholder')" />
    </n-form-item>
    <!-- 任务选项与请求头都属于低频设置，折叠起来避免默认视图过长 -->
    <n-collapse class="advanced-collapse">
      <n-collapse-item :title="t('newTask.advancedSettings')" name="advanced">
        <div class="advanced-body">
          <div class="advanced-section-title">{{ t('newTask.options') }}</div>
          <div class="option-row">
            <div class="option-item">
              <span class="option-item-label">{{ t('newTask.maxConnectionPerServer') }}</span>
              <n-input-number v-model:value="form.maxConnectionPerServer" :min="1" :max="16" />
            </div>
            <div class="option-item">
              <span class="option-item-label">{{ t('newTask.minSplitSize') }}</span>
              <n-select v-model:value="form.minSplitSize" :options="minSplitSizeOptions" />
            </div>
            <div class="option-item option-item--switch">
              <span class="option-item-label">{{ t('newTask.autoStart') }}</span>
              <AppSwitch v-model:value="form.autoStart" />
            </div>
          </div>
          <div class="option-row">
            <div class="option-item">
              <span class="option-item-label">{{ t('newTask.maxDownloadLimit') }}</span>
              <n-input-number v-model:value="form.maxDownloadLimitKB" :min="0" :suffix="'KB/s'" />
            </div>
            <div class="option-item">
              <span class="option-item-label">{{ t('newTask.maxUploadLimit') }}</span>
              <n-input-number v-model:value="form.maxUploadLimitKB" :min="0" :suffix="'KB/s'" />
            </div>
            <div class="option-item">
              <span class="option-item-label">{{ t('newTask.allProxy') }}</span>
              <n-input v-model:value="form.allProxy" :placeholder="t('newTask.proxyPlaceholder')" />
            </div>
          </div>
          <div class="advanced-section-title">{{ t('newTask.advancedOptions') }}</div>
          <div class="advanced-tip">{{ t('newTask.advancedOptionsTip') }}</div>
          <div class="option-item">
            <span class="option-item-label">{{ t('newTask.referer') }}</span>
            <n-input v-model:value="form.referer" :placeholder="t('newTask.refererPlaceholder')" />
          </div>
          <div class="option-item">
            <div class="option-item-head">
              <span class="option-item-label">{{ t('newTask.userAgent') }}</span>
              <n-select
                class="ua-preset-select"
                size="tiny"
                :options="userAgentPresetOptions"
                :value="matchedUserAgentPreset"
                :placeholder="t('newTask.userAgentPreset')"
                @update:value="applyUserAgentPreset"
              />
            </div>
            <n-input v-model:value="form.userAgent" :placeholder="t('newTask.userAgentPlaceholder')" />
          </div>
          <div class="option-item">
            <span class="option-item-label">{{ t('newTask.customHeaders') }}</span>
            <n-input
              v-model:value="form.customHeaders"
              type="textarea"
              :rows="3"
              :placeholder="t('newTask.customHeadersPlaceholder')"
            />
          </div>
        </div>
      </n-collapse-item>
    </n-collapse>
  </n-form>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOutline } from '@vicons/ionicons5'
import type { FormInst, FormRules, SelectOption } from 'naive-ui'
import { confirm, message } from '@/utils/feedback'
import AppSwitch from '@/components/AppSwitch.vue'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNewTaskSubmit } from '@/composables/useNewTaskSubmit'
import { CATEGORY_AUTO, CATEGORY_GENERAL, getFileNameHintFromUri, resolveCategory } from '@/shared/fileCategories'
import { parseCurlCommand } from '@/utils/curlCommand'
import { USER_AGENT_PRESETS } from '@/shared/userAgents'
import type { Aria2Option } from '@/types/aria2'
import type { CategoryOption, ComputeTargetDir } from './types'

interface Props {
  /** 分类下拉选项（壳按用户配置生成） */
  categoryOptions: CategoryOption[]
  /** 目标目录计算（壳注入，闭包了分类规则与自动分类开关） */
  computeTargetDir: ComputeTargetDir
  /** 是否处于 Electron 环境（决定能否调起系统目录选择框） */
  isElectron: boolean
  /** 剪贴板检测到的 URL（非空时自动填入 URIs 输入框） */
  prefilledUrl: string
}

const props = defineProps<Props>()

const { t } = useI18n()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const { submitting, runSubmit } = useNewTaskSubmit()

const formRef = ref<FormInst>()

const form = reactive({
  uris: '',
  dir: '',
  fileName: '',
  maxConnectionPerServer: 5,
  minSplitSize: '20M',
  autoStart: true,
  category: CATEGORY_AUTO,
  // 单任务限速与代理（0 表示不限制；代理仅对本任务生效）
  maxDownloadLimitKB: 0,
  maxUploadLimitKB: 0,
  allProxy: '',
  // 请求头（可选）：需要登录的站点必须带 Cookie/Referer，否则服务器直接 403
  referer: '',
  userAgent: '',
  customHeaders: ''
})

const rules: FormRules = {
  uris: [
    { required: true, message: () => t('newTask.requireUrl'), trigger: 'blur' }
  ]
}

const minSplitSizeOptions = [
  { label: '1M', value: '1M' },
  { label: '5M', value: '5M' },
  { label: '10M', value: '10M' },
  { label: '20M', value: '20M' },
  { label: '50M', value: '50M' },
  { label: '100M', value: '100M' }
]

/** UA 预设下拉选项（选中即填入输入框，仍可手动改） */
const userAgentPresetOptions: SelectOption[] = USER_AGENT_PRESETS.map(preset => ({
  label: preset.label,
  value: preset.key
}))

/** 当前 UA 与某个预设完全一致时，下拉框回显该预设；否则显示占位提示 */
const matchedUserAgentPreset = computed(() => {
  const found = USER_AGENT_PRESETS.find(preset => preset.value === form.userAgent)
  return found ? found.key : null
})

function applyUserAgentPreset(key: string | null) {
  const preset = USER_AGENT_PRESETS.find(item => item.key === key)
  form.userAgent = preset ? preset.value : ''
}

/** aria2 支持的下载协议白名单 */
const SUPPORTED_URI_SCHEMES = ['http:', 'https:', 'ftp:', 'sftp:', 'magnet:']

/**
 * 粘贴 cURL 命令时自动拆出 URL 与请求头。
 * 只在失焦时执行一次：用户仍可在提交前检查/修改解析结果。
 */
function parseCurlIfPresent() {
  const raw = form.uris.trim()
  if (!/^curl(\s|$)/i.test(raw)) return
  const parsed = parseCurlCommand(raw)
  if (!parsed) return

  form.uris = parsed.url
  if (parsed.referer) form.referer = parsed.referer
  if (parsed.userAgent) form.userAgent = parsed.userAgent
  if (parsed.fileName) form.fileName = parsed.fileName

  const extraHeaders = Object.entries(parsed.headers)
    .filter(([name]) => !/^(referer|user-agent|cookie)$/i.test(name))
    .map(([name, value]) => `${name}: ${value}`)
  if (parsed.cookie) extraHeaders.push(`Cookie: ${parsed.cookie}`)
  if (extraHeaders.length > 0) form.customHeaders = extraHeaders.join('\n')

  message.success(t('newTask.curlParsed'))
}

/** 校验单个下载 URI：协议合法且（http/https/ftp/sftp）能被 URL 解析；magnet 为特殊格式 */
function isSupportedDownloadUri(uri: string): boolean {
  if (uri.startsWith('magnet:')) return true
  try {
    const { protocol } = new URL(uri)
    return SUPPORTED_URI_SCHEMES.includes(protocol)
  } catch {
    return false
  }
}

const firstUri = computed(() => (form.uris.split('\n').find(u => u.trim()) || '').trim())

const fileNameHint = computed(() => form.fileName || (firstUri.value ? getFileNameHintFromUri(firstUri.value) : ''))

/** 提示将保存到的目录（baseDir = 手动指定目录，否则基础目录） */
const targetDir = computed(() => {
  const baseDir = form.dir || settingsStore.taskBaseDir
  if (!baseDir) return ''
  return props.computeTargetDir(baseDir, form.category, fileNameHint.value)
})

/**
 * 智能识别模式下无法从链接识别文件类型（网盘直链/跳转链接的 URL 往往没有文件名，
 * 如 https://d.pcs.baidu.com/file/<hash>?...，真实文件名只在服务器的响应头里）。
 * 此时提交前会先探测真实文件名（见 perform），探测失败则按常规目录处理。
 */
const autoClassifyFailed = computed(() => {
  if (form.category !== CATEGORY_AUTO) return false
  return resolveCategory(fileNameHint.value, settingsStore.categoryConfig.categories ?? []).id === CATEGORY_GENERAL
})

// 剪贴板检测到 URL 时自动填入（标签页切换由壳负责）。
// immediate：本页挂载时若预填值已存在（弹窗内容尚未挂载期间就写入），也要消费掉，不能只等变化。
watch(() => props.prefilledUrl, (url) => {
  if (url) form.uris = url
}, { immediate: true })

async function handleSubmit() {
  // 保留旧实现的守卫：表单未挂载时不提交
  if (!formRef.value) return

  await runSubmit<string[]>({
    validate: async () => await formRef.value?.validate(),

    precheck: () => {
      const uris = form.uris.split('\n')
        .map(uri => uri.trim())
        .filter(uri => uri.length > 0)

      if (uris.length === 0) {
        message.error(t('newTask.invalidUrl'))
        return null
      }

      // 校验 URL 协议：仅允许 aria2 支持的下载协议，拦截 javascript:/file: 等非法输入
      const invalidUris = uris.filter(uri => !isSupportedDownloadUri(uri))
      if (invalidUris.length > 0) {
        console.warn('[UriPane] Blocked unsupported URIs:', invalidUris)
        message.error(t('newTask.invalidUrlCount', { count: invalidUris.length }))
        return null
      }

      return uris
    },

    perform: async (uris) => {
      const options: Aria2Option = {}
      const baseDir = form.dir || settingsStore.taskBaseDir
      // precheck 已保证 uris 非空，`?? ''` 只是满足 noUncheckedIndexedAccess
      let fileNameHint = form.fileName || getFileNameHintFromUri(uris[0] ?? '')

      // 网盘直链/跳转链接的 URL 里没有文件名，分类无从下手：
      // 先向文件服务器探测真实文件名（主进程只取响应头、不下载正文），失败则维持原行为
      const unclassified =
        form.category === CATEGORY_AUTO &&
        resolveCategory(fileNameHint, settingsStore.categoryConfig.categories ?? []).id === CATEGORY_GENERAL
      let probedName = ''
      if (unclassified && window.electronAPI?.probeDownloadName) {
        probedName = await window.electronAPI.probeDownloadName(uris[0] ?? '')
      }
      if (!form.fileName && probedName) fileNameHint = probedName

      const resolvedDir = props.computeTargetDir(baseDir, form.category, fileNameHint)
      if (resolvedDir) options.dir = resolvedDir

      // 重名处理：目标文件已存在且无 .aria2 控制文件时，aria2 会因 continue=true 把它当作
      // "可续传的已完成任务"而秒结束（auto-file-renaming 的改名分支走不到）。
      // 是否下载新副本交给用户选择：下载为新副本（自动加序号）/ 取消本次任务。
      let outName = ''
      let cancelled = false
      const baseName = form.fileName || probedName || fileNameHint
      if (baseName && resolvedDir && window.electronAPI?.resolveDownloadConflict) {
        try {
          const resolved = await window.electronAPI.resolveDownloadConflict(resolvedDir, baseName)
          if (resolved?.conflict) {
            const chosen = await askConflictChoice(baseName, resolved.fileName)
            if (chosen === null) {
              cancelled = true
            } else {
              outName = chosen
            }
          }
        } catch { /* 检测失败时按原名提交（保持原行为） */ }
      }
      // 空串 = 用户取消了本次任务（不提示成功、不关弹窗）
      if (cancelled) return ''
      if (outName) options.out = outName
      else if (form.fileName) options.out = form.fileName
      else if (probedName) options.out = probedName

      options['max-connection-per-server'] = form.maxConnectionPerServer.toString()
      options['min-split-size'] = form.minSplitSize
      if (!form.autoStart) options.pause = 'true'
      // 单任务限速 / 代理（0 与空串表示不限制/不设置）
      if (form.maxDownloadLimitKB > 0) options['max-download-limit'] = `${form.maxDownloadLimitKB}K`
      if (form.maxUploadLimitKB > 0) options['max-upload-limit'] = `${form.maxUploadLimitKB}K`
      if (form.allProxy.trim()) options['all-proxy'] = form.allProxy.trim()

      // 请求头：Referer / User-Agent 有专用选项，其余按 `Name: value` 走 header 数组。
      // 这里不做净化：值来自用户本人输入，且 aria2 侧会原样发出（与浏览器扩展入口不同，
      // 后者是外部调用方，必须在主进程净化）。
      if (form.referer.trim()) options.referer = form.referer.trim()
      if (form.userAgent.trim()) options['user-agent'] = form.userAgent.trim()
      const extraHeaders = form.customHeaders
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.includes(':'))
      if (extraHeaders.length > 0) options.header = extraHeaders

      await taskStore.addUri(uris, options)
      return t('newTask.addedCount', { count: uris.length })
    },

    fallbackError: t('newTask.addFailed'),
    logLabel: 'UriPane'
  })
}

/**
 * 重名确认：目标文件已存在时，让用户选择是否下载一份带序号的新副本。
 * 返回新文件名（选择下载新副本）或 null（取消 / 直接关闭确认框）。
 * onClose 与 onEsc 必须同样 resolve(null)——用户点 X 或按 ESC 关闭确认框等同于取消
 * （naive-ui 中两者是独立回调），否则提交流程会一直挂起。
 */
function askConflictChoice(baseName: string, suggestedName: string): Promise<string | null> {
  return new Promise((resolve) => {
    confirm({
      title: t('newTask.conflictTitle'),
      content: t('newTask.conflictContent', { name: baseName }),
      type: 'warning',
      positiveText: t('newTask.conflictNewCopy'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => resolve(suggestedName),
      onNegativeClick: () => resolve(null),
      onClose: () => resolve(null),
      onEsc: () => resolve(null)
    })
  })
}

function handleReset() {
  formRef.value?.restoreValidation()
  form.uris = ''
  form.dir = ''
  form.fileName = ''
  form.maxConnectionPerServer = 5
  form.minSplitSize = '20M'
  form.autoStart = true
  form.maxDownloadLimitKB = 0
  form.maxUploadLimitKB = 0
  form.allProxy = ''
  form.referer = ''
  form.userAgent = ''
  form.customHeaders = ''
}

/** 选择保存目录（系统目录选择框） */
async function selectDir() {
  if (!window.electronAPI) return
  try {
    const result = await window.electronAPI.showOpenDialog({
      title: t('newTask.selectDirTitle'),
      properties: ['openDirectory'],
      defaultPath: form.dir || undefined
    })
    if (!result.canceled && result.filePaths.length > 0) {
      // `?? ''`：长度已校验，这里只是满足 noUncheckedIndexedAccess
      form.dir = result.filePaths[0] ?? ''
    }
  } catch (_error) {
    message.error(t('newTask.selectDirFailed'))
  }
}

// 按钮由弹窗 footer 统一渲染（滚动内容时始终可见）
defineExpose({
  submit: handleSubmit,
  reset: handleReset,
  submitting,
  actionVisible: true,
  actionDisabled: false,
  actionLabel: computed(() => t('newTask.startDownload'))
})
</script>

<style scoped>
.dir-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin: -6px 0 10px;
  word-break: break-all;
  line-height: 1.6;
}

/* 表单项间距收紧。
 * Naive UI 每个 form-item 下方都有校验反馈区，即使没有错误也固定预留 24px
 * （--n-feedback-height，写在元素内联样式里，必须 !important 才能覆盖），
 * 这才是「标题与上一个输入框」距离过大的真正来源。
 * 置 0 后反馈为空时不占位；出现错误文案时所在网格行会自动撑高，不会遮挡后续内容。 */
:deep(.n-form-item) {
  --n-feedback-height: 0 !important;
  margin-bottom: 12px;
}

.option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  width: 100%;
}

.option-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 0;
  min-width: 160px;
}

.option-item--switch {
  justify-content: center;
}

.option-item-label {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 标签 + 右侧小操作（如 User-Agent 预设入口） */
.option-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 20px;
}

.advanced-collapse {
  margin-bottom: 4px;
}

.advanced-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.advanced-section-title {
  font-size: 13px;
  font-weight: 500;
}

.ua-preset-select {
  width: 132px;
}

.advanced-tip {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}
</style>
