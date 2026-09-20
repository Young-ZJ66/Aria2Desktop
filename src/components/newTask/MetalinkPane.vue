<template>
  <n-form ref="formRef" :model="form" :rules="rules">
    <n-form-item path="metalinkFile">
      <div
        class="file-drop-area"
        :class="{ 'drag-active': dragging }"
        role="button"
        tabindex="0"
        :aria-label="t('newTask.selectMetalinkFile')"
        @click="pickFile"
        @keydown.enter="pickFile"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="handleDrop"
      >
        <n-icon size="34"><CloudUploadOutline /></n-icon>
        <div class="drop-text">
          {{ form.metalinkFile ? form.metalinkFile.name : t('newTask.dropMetalinkHint') }}
        </div>
      </div>
    </n-form-item>
    <n-form-item :label="t('newTask.categoryLabel')" label-placement="top">
      <n-select v-model:value="form.category" :options="categoryOptions" />
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
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudUploadOutline } from '@vicons/ionicons5'
import type { FormInst, FormRules } from 'naive-ui'
import { message } from '@/utils/feedback'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNewTaskSubmit } from '@/composables/useNewTaskSubmit'
import { CATEGORY_AUTO } from '@/shared/fileCategories'
import type { Aria2Option } from '@/types/aria2'
import type { CategoryOption, ComputeTargetDir, RequestPickFile } from './types'

interface Props {
  categoryOptions: CategoryOption[]
  computeTargetDir: ComputeTargetDir
  /** 壳注入：超过 aria2 RPC 上限的文件直接拒绝（内部已提示并返回 false） */
  checkFileSize: (file: File) => boolean
  /** 壳注入：读取文件为 base64（上传给 aria2 需要） */
  readFileAsBase64: (file: File) => Promise<string>
  /** 壳注入：请求打开隐藏的 file input */
  requestPickFile: RequestPickFile
  /** 拖拽 .metalink/.meta4 到主窗口时的预填文件（由壳筛过类型，非空即应填入） */
  prefilledFile: File | null
}

const props = defineProps<Props>()

const { t } = useI18n()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const { submitting, runSubmit } = useNewTaskSubmit()

const formRef = ref<FormInst>()

const form = reactive({
  metalinkFile: null as File | null,
  category: CATEGORY_AUTO
})

const rules: FormRules = {
  metalinkFile: [
    { required: true, message: () => t('newTask.requireMetalink'), trigger: 'change' }
  ]
}

const dragging = ref(false)

// 拖拽文件到主窗口时自动填入（标签页切换由壳负责）。
// immediate：本页挂载时若预填值已存在，也要消费掉，不能只等变化。
watch(() => props.prefilledFile, (file) => {
  if (file) form.metalinkFile = file
}, { immediate: true })

function pickFile() {
  props.requestPickFile((file) => { form.metalinkFile = file })
}

function handleDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  form.metalinkFile = file
  message.success(t('newTask.metalinkDropped', { name: file.name }))
}

async function handleSubmit() {
  // 保留旧实现的守卫：表单未挂载时不提交
  if (!formRef.value) return

  await runSubmit<File>({
    validate: async () => await formRef.value?.validate(),

    precheck: () => {
      const file = form.metalinkFile
      if (!file) {
        message.error(t('newTask.invalidMetalink'))
        return null
      }
      // 超过 aria2 RPC 大小上限的文件直接拒绝，避免大文件上传失败
      if (!props.checkFileSize(file)) return null
      return file
    },

    perform: async (file) => {
      const metalinkData = await props.readFileAsBase64(file)

      const options: Aria2Option = {}
      const downloadConfig = settingsStore.downloadConfig
      const targetDir = props.computeTargetDir(settingsStore.taskBaseDir, form.category, file.name)
      if (targetDir) options.dir = targetDir
      // 注意：是否暂停由「下载设置」的 autoStart 决定（URI 页则是表单上的开关）
      if (downloadConfig && !downloadConfig.autoStart) options.pause = 'true'

      const gids = await taskStore.addMetalink(metalinkData, options)
      return t('newTask.metalinkAdded', { count: gids.length })
    },

    fallbackError: t('newTask.addMetalinkFailed'),
    logLabel: 'MetalinkPane'
  })
}

function handleReset() {
  formRef.value?.restoreValidation()
  form.metalinkFile = null
}
</script>

<style scoped>
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.file-drop-area {
  width: 100%;
  height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--border-base);
  border-radius: 8px;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, transform 0.18s var(--ease-out);
}

.file-drop-area:hover,
.file-drop-area.drag-active {
  border-color: var(--color-primary);
  background-color: var(--bg-hover);
  color: var(--color-primary);
  transform: scale(1.012);
}

.drop-text {
  font-size: 13px;
  text-align: center;
  padding: 0 16px;
  word-break: break-all;
}
</style>
