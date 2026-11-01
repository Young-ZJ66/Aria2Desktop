<template>
  <n-card size="small" :bordered="false">
    <div class="files-toolbar">
      <n-space :size="6">
        <n-button size="tiny" secondary @click="selectAll">{{ t('newTask.selectAllFiles') }}</n-button>
        <n-button size="tiny" secondary @click="clearAll">{{ t('newTask.clearFileSelection') }}</n-button>
        <n-button
          v-for="filter in quickFilters"
          :key="filter.id"
          size="tiny"
          quaternary
          @click="selectCategory(filter.id)"
        >
          {{ filter.label }}
        </n-button>
      </n-space>
      <span class="summary">{{ t('newTask.torrentSelected', { count: selected.size, size: formatSize(selectedBytes) }) }}</span>
    </div>

    <div class="file-list">
      <div v-for="file in files" :key="file.index" class="file-row" :title="file.path">
        <n-checkbox
          :checked="selected.has(file.index)"
          @update:checked="(checked: boolean) => toggle(file.index, checked)"
        />
        <span class="file-name">{{ file.path }}</span>
        <span class="file-size">{{ formatSize(file.length) }}</span>
      </div>
    </div>

    <div class="files-footer">
      <span class="hint">{{ t('taskDetail.fileSelectionHint') }}</span>
      <n-button type="primary" size="small" :disabled="!dirty" :loading="applying" @click="apply">
        {{ t('taskDetail.applyFileSelection') }}
      </n-button>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveCategory } from '@/shared/fileCategories'
import { formatSize } from '@/utils/taskFormatters'
import type { Aria2Task } from '@/types/aria2'

const props = defineProps<{ task: Aria2Task }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const { t } = useI18n()
const connectionStore = useConnectionStore()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()

interface FileRow {
  index: number
  path: string
  length: number
}

const files = computed<FileRow[]>(() =>
  (props.task.files ?? [])
    .map(file => ({
      index: Number(file.index),
      path: file.path,
      length: Number(file.length) || 0
    }))
    .filter(file => file.index > 0)
)

const selected = ref<Set<number>>(new Set())
let initial = new Set<number>()
const applying = ref(false)

/** 从 aria2 的 selected 字段初始化（未使用 select-file 时全部为 true） */
function resetSelection() {
  const next = new Set<number>()
  for (const file of props.task.files ?? []) {
    if (file.selected === 'true') next.add(Number(file.index))
  }
  selected.value = next
  initial = new Set(next)
}

watch(
  () => (props.task.files ?? []).map(file => `${file.index}:${file.selected}`).join('|'),
  resetSelection,
  { immediate: true }
)

const dirty = computed(() => {
  if (selected.value.size !== initial.size) return true
  for (const index of selected.value) {
    if (!initial.has(index)) return true
  }
  return false
})

const selectedBytes = computed(() =>
  files.value.filter(file => selected.value.has(file.index)).reduce((total, file) => total + file.length, 0)
)

const quickFilters = computed(() => [
  { id: 'video', label: t('newTask.category.video') },
  { id: 'music', label: t('newTask.category.music') },
  { id: 'images', label: t('newTask.category.images') },
  { id: 'documents', label: t('newTask.category.documents') }
])

function fileCategoryId(path: string): string {
  const name = path.split(/[\\/]/).pop() || path
  return resolveCategory(name, settingsStore.categoryConfig.categories ?? []).id
}

function toggle(index: number, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) next.add(index)
  else next.delete(index)
  selected.value = next
}

function selectAll() {
  selected.value = new Set(files.value.map(file => file.index))
}

function clearAll() {
  selected.value = new Set()
}

function selectCategory(categoryId: string) {
  const matched = files.value.filter(file => fileCategoryId(file.path) === categoryId)
  if (matched.length === 0) {
    message.info(t('newTask.noFilesInCategory'))
    return
  }
  selected.value = new Set(matched.map(file => file.index))
}

/**
 * 应用文件选择：aria2 的 select-file 属于可动态修改的 Input File 选项，
 * 修改后引擎会自行重启该 BT 任务。
 */
async function apply() {
  const service = connectionStore.service
  if (!service || selected.value.size === 0) return
  applying.value = true
  try {
    await service.changeOption(props.task.gid, {
      'select-file': [...selected.value].sort((a, b) => a - b).join(',')
    })
    message.success(t('taskDetail.fileSelectionApplied'))
    emit('changed')
  } catch (error) {
    message.error(t('taskDetail.fileSelectionFailed'))
    console.warn('[TaskFilesInfo] change select-file failed:', error)
  } finally {
    applying.value = false
    // 任务可能被 aria2 重启，刷新列表以便拿到最新状态
    await taskStore.loadAllTasks()
  }
}
</script>

<style scoped>
.files-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.summary {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.file-list {
  max-height: 260px;
  overflow-y: auto;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  font-size: 12.5px;
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-regular);
}

.file-size {
  flex: none;
  font-size: 12px;
  color: var(--text-secondary);
}

.files-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-light);
}

.hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
</style>
