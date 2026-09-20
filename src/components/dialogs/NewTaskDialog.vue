<template>
  <n-modal
    v-model:show="visible"
    :title="t('newTask.title')"
    preset="card"
    style="width: 620px"
    :bordered="false"
    :mask-closable="true"
    display-directive="show"
  >
    <!--
      display-directive="show"（弹窗与标签页都用）——两处都是**行为保持**所需，不是随手加的：
      1) n-modal 默认 "if"：关闭时销毁内容；而拆分前表单状态都在壳的 setup 里、不随弹窗销毁，
         所以"填了一半关掉再打开"时内容还在。内容常驻才能保持这一点。
      2) n-tabs 默认懒渲染：未激活的页在首次切换前不存在，会让预填（剪贴板 URL / 拖入文件）丢事件。
    -->
    <n-tabs v-model:value="activeTab" type="line" animated display-directive="show">
      <n-tab-pane name="uri" :tab="t('newTask.uriTab')">
        <UriPane
          :category-options="categoryOptions"
          :compute-target-dir="computeTargetDir"
          :is-electron="isElectron"
          :prefilled-url="uiStore.newTaskPrefilledUrl"
        />
      </n-tab-pane>

      <n-tab-pane name="torrent" :tab="t('newTask.torrentTab')">
        <TorrentPane
          :category-options="categoryOptions"
          :compute-target-dir="computeTargetDir"
          :check-file-size="checkFileSize"
          :read-file-as-base64="readFileAsBase64"
          :request-pick-file="requestPickFile"
          :prefilled-file="torrentPrefilledFile"
        />
      </n-tab-pane>

      <n-tab-pane name="metalink" :tab="t('newTask.metalinkTab')">
        <MetalinkPane
          :category-options="categoryOptions"
          :compute-target-dir="computeTargetDir"
          :check-file-size="checkFileSize"
          :read-file-as-base64="readFileAsBase64"
          :request-pick-file="requestPickFile"
          :prefilled-file="metalinkPrefilledFile"
        />
      </n-tab-pane>

      <n-tab-pane name="stream" :tab="t('newTask.streamTab')">
        <StreamPane />
      </n-tab-pane>
    </n-tabs>

    <!-- 隐藏的文件输入框：由壳持有（只有一个），各 pane 通过 requestPickFile 借用 -->
    <input
      ref="fileInputRef"
      type="file"
      hidden
      @change="handleFileInputChange"
    />
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { CATEGORY_AUTO, CATEGORY_GENERAL, resolveDownloadDir } from '@/shared/fileCategories'
import UriPane from '@/components/newTask/UriPane.vue'
import TorrentPane from '@/components/newTask/TorrentPane.vue'
import MetalinkPane from '@/components/newTask/MetalinkPane.vue'
import StreamPane from '@/components/newTask/StreamPane.vue'

/**
 * 新建任务弹窗（壳）。
 *
 * 职责：只负责「弹窗外壳 + 标签页 + 跨页共享能力」，四个标签页的内容在 components/newTask/ 下各自成组件。
 * 共享能力（分类选项、目标目录计算、文件大小校验、base64 读取、文件选择）由壳持有并经 props 下发，
 * 避免各页各写一份、将来分叉。
 *
 * 各页的表单状态与提交逻辑都留在各自 pane 内（原先 743 行单文件的核心问题就是这些状态全挤在一起）。
 */

const uiStore = useUiStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

const activeTab = ref('uri')

const isElectron = computed(() => !!window.electronAPI)

const visible = computed({
  get: () => uiStore.showNewTask,
  set: (value: boolean) => {
    if (!value) uiStore.closeNewTask()
  }
})

/** aria2 rpc-max-request-size 默认 1MiB，超出上限的种子/metalink 经 base64 上传必然失败 */
const MAX_UPLOAD_FILE_BYTES = 1 * 1024 * 1024

function checkFileSize(file: File): boolean {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    message.error(t('newTask.fileTooLarge'))
    return false
  }
  return true
}

/** 读取文件为 Base64（aria2 的 addTorrent/addMetalink 以 base64 传输文件内容） */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // `?? ''`：data URL 必然含逗号，这里只是满足 noUncheckedIndexedAccess
      const base64 = result.split(',')[1] ?? ''
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** 分类下拉选项：智能识别 + 各分类（内置六类 + 用户自定义）+ 常规 */
const categoryOptions = computed(() => {
  const options: Array<{ label: string; value: string }> = [
    { label: t('newTask.categoryAuto'), value: CATEGORY_AUTO }
  ]
  for (const c of settingsStore.categoryConfig.categories ?? []) {
    if (c.id === CATEGORY_GENERAL) {
      options.push({ label: t('newTask.categoryGeneral'), value: CATEGORY_GENERAL })
    } else {
      options.push({ label: c.name || t(`newTask.category.${c.id}`), value: c.id })
    }
  }
  return options
})

/** 按给定条件算出最终保存目录（URI 页用于实时提示，各页提交时也用它） */
function computeTargetDir(
  baseDir: string,
  category: string,
  fileNameHint: string
): string {
  return resolveDownloadDir(
    baseDir,
    category,
    fileNameHint,
    settingsStore.categoryConfig.categories ?? [],
    // ?? true：与 defaultSettings / settingsStore 自身的回退一致（设置项缺失时仍按"自动分类"处理）
    settingsStore.categoryConfig.autoClassify ?? true
  )
}

// ── 预填：壳只负责把用户带到正确的标签页，表单内容由各 pane 自己消费 ──

// 剪贴板检测到 URL 时切到 URI 页
watch(() => uiStore.newTaskPrefilledUrl, (url) => {
  if (url) activeTab.value = 'uri'
})

// 拖拽 .torrent/.metalink 到主窗口时切到对应页
watch(() => uiStore.newTaskPrefilledFile, (file) => {
  if (!file) return
  const name = file.name.toLowerCase()
  if (name.endsWith('.torrent')) {
    activeTab.value = 'torrent'
  } else if (name.endsWith('.metalink') || name.endsWith('.meta4')) {
    activeTab.value = 'metalink'
  } else {
    // 非 torrent/metalink 文件，尝试作为 URI（不太可能，但兜底）
    activeTab.value = 'uri'
  }
})

/**
 * 按类型筛出预填文件再下发：
 * 这样各 pane 只需"非空即填入"，类型判断集中在这一处，不会两边各写一遍扩展名逻辑。
 */
const torrentPrefilledFile = computed(() => {
  const file = uiStore.newTaskPrefilledFile
  return file && file.name.toLowerCase().endsWith('.torrent') ? file : null
})

const metalinkPrefilledFile = computed(() => {
  const file = uiStore.newTaskPrefilledFile
  if (!file) return null
  const name = file.name.toLowerCase()
  return name.endsWith('.metalink') || name.endsWith('.meta4') ? file : null
})

// ── 隐藏文件输入框：各 pane 通过 requestPickFile 借用，选中后回调交回给发起方 ──

const fileInputRef = ref<HTMLInputElement>()
let onFilePicked: ((file: File) => void) | null = null

function requestPickFile(onPicked: (file: File) => void) {
  onFilePicked = onPicked
  fileInputRef.value?.click()
}

function handleFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file && onFilePicked) {
    onFilePicked(file)
  }
  // 清空 value，保证再次选择同一个文件也能触发 change
  input.value = ''
  onFilePicked = null
}
</script>
