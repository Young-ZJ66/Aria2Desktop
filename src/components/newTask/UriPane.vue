<template>
  <n-form ref="formRef" :model="form" :rules="rules">
    <n-form-item path="uris" :label="t('newTask.urisLabel')" label-placement="top">
      <n-input
        v-model:value="form.uris"
        type="textarea"
        :rows="5"
        :placeholder="t('newTask.urlsPlaceholder')"
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
    <div v-if="targetDir" class="dir-tip">{{ t('newTask.saveTo') }}：{{ targetDir }}</div>
    <div v-if="targetDir && autoClassifyFailed" class="dir-tip">{{ t('newTask.autoClassifyFailed') }}</div>
    <n-form-item path="fileName" :label="t('newTask.fileName')" label-placement="top">
      <n-input v-model:value="form.fileName" :placeholder="t('newTask.fileNamePlaceholder')" />
    </n-form-item>
    <n-form-item>
      <template #label>
        <span class="option-label">{{ t('newTask.options') }}</span>
      </template>
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
    </n-form-item>
    <div class="form-actions">
      <n-space>
        <n-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ t('newTask.startDownload') }}
        </n-button>
        <n-button @click="handleReset">{{ t('newTask.reset') }}</n-button>
      </n-space>
    </div>
  </n-form>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOutline } from '@vicons/ionicons5'
import type { FormInst, FormRules } from 'naive-ui'
import { confirm, message } from '@/utils/feedback'
import AppSwitch from '@/components/AppSwitch.vue'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNewTaskSubmit } from '@/composables/useNewTaskSubmit'
import { CATEGORY_AUTO, CATEGORY_GENERAL, getFileNameHintFromUri, resolveCategory } from '@/shared/fileCategories'
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
  category: CATEGORY_AUTO
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

/** aria2 支持的下载协议白名单 */
const SUPPORTED_URI_SCHEMES = ['http:', 'https:', 'ftp:', 'sftp:', 'magnet:']

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
      const invalidUri = uris.find(uri => !isSupportedDownloadUri(uri))
      if (invalidUri) {
        console.warn('[UriPane] Blocked unsupported URI:', invalidUri)
        message.error(t('newTask.invalidUrl'))
        return null
      }

      return uris
    },

    perform: async (uris) => {
      const options: Record<string, string> = {}
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
</script>

<style scoped>
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.dir-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin: -8px 0 12px;
  word-break: break-all;
  line-height: 1.6;
}

.option-label {
  font-weight: 500;
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
</style>
