<template>
  <div class="automation-view">
    <PageHeader :title="t('automation.title')" :description="t('automation.description')">
      <template #actions>
        <n-button size="small" :loading="autoImportStore.loading" @click="handleRefresh">
          {{ t('automation.refresh') }}
        </n-button>
      </template>
    </PageHeader>

    <!-- 引擎不向渲染层推送事件，轮询失败只能靠这一条横幅暴露（成功时会自动清除） -->
    <n-alert v-if="autoImportStore.lastError" type="error" class="load-error">
      {{ t('automation.loadFailed', { error: autoImportStore.lastError }) }}
    </n-alert>

    <!-- RSS / Atom 订阅 -->
    <n-card :bordered="false" class="section-card" :title="t('automation.rssTitle')">
      <template #header-extra>
        <n-button size="small" type="primary" @click="openRssForm()">
          {{ t('automation.rssAdd') }}
        </n-button>
      </template>
      <div class="section-desc">{{ t('automation.rssDescription') }}</div>
      <n-empty v-if="autoImportStore.subscriptions.length === 0" :description="t('automation.rssEmpty')" class="section-empty" />
      <n-data-table
        v-else
        :columns="rssColumns"
        :data="autoImportStore.subscriptions"
        :row-key="(row: RssSubscription) => row.id"
        :bordered="false"
        size="small"
        :scroll-x="1180"
      />
    </n-card>

    <!-- 监听文件夹 -->
    <n-card :bordered="false" class="section-card" :title="t('automation.watchTitle')">
      <template #header-extra>
        <n-button size="small" type="primary" @click="openWatchForm()">
          {{ t('automation.watchAdd') }}
        </n-button>
      </template>
      <div class="section-desc">{{ t('automation.watchDescription') }}</div>
      <n-empty v-if="autoImportStore.watchFolders.length === 0" :description="t('automation.watchEmpty')" class="section-empty" />
      <n-data-table
        v-else
        :columns="watchColumns"
        :data="autoImportStore.watchFolders"
        :row-key="(row: WatchFolderConfig) => row.id"
        :bordered="false"
        size="small"
        :scroll-x="1080"
      />
    </n-card>

    <!-- 导入日志 -->
    <n-card :bordered="false" class="section-card" :title="t('automation.logTitle')">
      <div class="section-desc">{{ t('automation.logDescription') }}</div>
      <n-empty v-if="autoImportStore.logEntries.length === 0" :description="t('automation.logEmpty')" class="section-empty" />
      <n-data-table
        v-else
        :columns="logColumns"
        :data="autoImportStore.logEntries"
        :row-key="(row: AutoImportLogEntry) => row.id"
        :bordered="false"
        size="small"
        :scroll-x="900"
      />
    </n-card>

    <!-- RSS 订阅表单 -->
    <n-modal
      v-model:show="rssFormVisible"
      :title="rssForm.id === '' ? t('automation.rssFormAddTitle') : t('automation.rssFormEditTitle')"
      preset="card"
      style="width: 560px"
      :bordered="false"
      :mask-closable="true"
    >
      <n-form ref="rssFormRef" :model="rssForm" :rules="rssRules" label-placement="top">
        <n-form-item :label="t('automation.rssFieldName')" path="name">
          <n-input v-model:value="rssForm.name" :placeholder="t('automation.rssNamePlaceholder')" :maxlength="100" />
        </n-form-item>
        <n-form-item :label="t('automation.rssFieldUrl')" path="url">
          <n-input v-model:value="rssForm.url" :placeholder="t('automation.rssUrlPlaceholder')" />
        </n-form-item>
        <n-grid :cols="2" :x-gap="12">
          <n-form-item :label="t('automation.rssFieldInterval')" path="intervalMinutes">
            <n-input-number v-model:value="rssForm.intervalMinutes" :min="5" :max="10080" class="full-width" />
          </n-form-item>
          <n-form-item :label="t('automation.rssFieldMaxPerFetch')" path="maxPerFetch">
            <n-input-number v-model:value="rssForm.maxPerFetch" :min="1" :max="50" class="full-width" />
          </n-form-item>
        </n-grid>
        <n-form-item :label="t('automation.rssFieldInclude')" path="includePattern">
          <n-input v-model:value="rssForm.includePattern" :placeholder="t('automation.rssFieldPatternPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('automation.rssFieldExclude')" path="excludePattern">
          <n-input v-model:value="rssForm.excludePattern" :placeholder="t('automation.rssFieldPatternPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('automation.rssFieldDir')" path="dir">
          <n-input v-model:value="rssForm.dir" :placeholder="t('automation.fieldDirPlaceholder')">
            <template #suffix>
              <n-button size="tiny" quaternary @click="pickDirectory('rssDir')">
                {{ t('automation.pickDir') }}
              </n-button>
            </template>
          </n-input>
        </n-form-item>
        <n-form-item :label="t('automation.fieldEnabled')" path="enabled">
          <n-switch v-model:value="rssForm.enabled" size="small" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button size="small" @click="rssFormVisible = false">{{ t('common.cancel') }}</n-button>
          <n-button size="small" type="primary" :loading="savingRss" @click="submitRssForm">
            {{ t('common.save') }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 监听文件夹表单 -->
    <n-modal
      v-model:show="watchFormVisible"
      :title="watchForm.id === '' ? t('automation.watchFormAddTitle') : t('automation.watchFormEditTitle')"
      preset="card"
      style="width: 560px"
      :bordered="false"
      :mask-closable="true"
    >
      <n-form ref="watchFormRef" :model="watchForm" :rules="watchRules" label-placement="top">
        <n-form-item :label="t('automation.watchFieldPath')" path="path">
          <n-input v-model:value="watchForm.path" :placeholder="t('automation.pickDir')">
            <template #suffix>
              <n-button size="tiny" quaternary @click="pickDirectory('watchPath')">
                {{ t('automation.pickDir') }}
              </n-button>
            </template>
          </n-input>
        </n-form-item>
        <n-form-item :label="t('automation.watchFieldExtensions')" path="extensions">
          <n-input v-model:value="watchForm.extensions" :placeholder="t('automation.watchFieldExtensionsPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('automation.watchFieldDir')" path="dir">
          <n-input v-model:value="watchForm.dir" :placeholder="t('automation.fieldDirPlaceholder')">
            <template #suffix>
              <n-button size="tiny" quaternary @click="pickDirectory('watchDir')">
                {{ t('automation.pickDir') }}
              </n-button>
            </template>
          </n-input>
        </n-form-item>
        <n-form-item :label="t('automation.watchFieldAction')" path="deleteAfterImport">
          <n-radio-group v-model:value="watchForm.deleteAfterImport">
            <n-radio :value="false">{{ t('automation.watchActionArchiveAfter') }}</n-radio>
            <n-radio :value="true">{{ t('automation.watchActionDeleteAfter') }}</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item :label="t('automation.fieldEnabled')" path="enabled">
          <n-switch v-model:value="watchForm.enabled" size="small" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button size="small" @click="watchFormVisible = false">{{ t('common.cancel') }}</n-button>
          <n-button size="small" type="primary" :loading="savingWatch" @click="submitWatchForm">
            {{ t('common.save') }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 立即抓取的匹配条目预览 -->
    <n-modal
      v-model:show="previewVisible"
      :title="t('automation.rssFetchPreviewTitle', { count: previewItems.length })"
      preset="card"
      style="width: 560px"
      :bordered="false"
      :mask-closable="true"
    >
      <div class="preview-list">
        <div v-for="(item, index) in previewItems" :key="index" class="preview-item">
          <a v-if="item.link" :href="item.link" target="_blank" rel="noreferrer noopener" class="preview-link">{{ item.title }}</a>
          <span v-else class="preview-title">{{ item.title }}</span>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, ref, type VNode } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NRadio,
  NRadioGroup,
  NSwitch,
  NTag,
  type DataTableColumns,
  type FormInst,
  type FormRules
} from 'naive-ui'
import PageHeader from '@/components/layout/PageHeader.vue'
import { message } from '@/utils/feedback'
import { useAutoImportStore } from '@/stores/autoImportStore'
import { formatCompleteTime } from '@/utils/taskFormatters'
import type { AutoImportLogEntry, RssSubscription, WatchFolderConfig } from '@/shared/autoImport'

const { t } = useI18n()
const autoImportStore = useAutoImportStore()

/** 轮询周期：与"上次抓取时间"的刷新节奏对齐，30 秒足够让日志区看起来是实时的 */
const POLL_INTERVAL_MS = 30000
let pollTimer: ReturnType<typeof setInterval> | undefined

// ---------------- RSS 订阅表格 ----------------

/** 单行的"上次抓取"单元格：状态徽标 + 时间（出错时悬停看错误全文） */
function renderRssLastFetch(row: RssSubscription): VNode {
  const children: VNode[] = []
  if (row.lastStatus === 'ok') {
    children.push(h(NTag, { type: 'success', size: 'tiny', bordered: false }, { default: () => t('automation.rssStatusOk') }))
  } else if (row.lastStatus === 'error') {
    children.push(h(NTag, { type: 'error', size: 'tiny', bordered: false, title: row.lastError ?? '' }, { default: () => t('automation.rssStatusError') }))
  } else {
    children.push(h(NTag, { size: 'tiny', bordered: false }, { default: () => t('automation.rssStatusNever') }))
  }
  if (row.lastFetchAt) {
    children.push(h('span', { class: 'cell-time' }, formatCompleteTime(new Date(row.lastFetchAt).getTime())))
  }
  return h('div', { class: 'cell-stack' }, children)
}

const rssColumns = computed<DataTableColumns<RssSubscription>>(() => [
  { title: t('automation.rssColName'), key: 'name', minWidth: 130, ellipsis: { tooltip: true } },
  { title: t('automation.rssColUrl'), key: 'url', minWidth: 220, ellipsis: { tooltip: true } },
  {
    title: t('automation.rssColInterval'),
    key: 'intervalMinutes',
    width: 90,
    render: row => row.intervalMinutes ?? '—'
  },
  {
    title: t('automation.rssColMaxPerFetch'),
    key: 'maxPerFetch',
    width: 90,
    render: row => row.maxPerFetch ?? '—'
  },
  {
    title: t('automation.rssColFilters'),
    key: 'filters',
    minWidth: 150,
    render: row => {
      // 包含/排除各占一行，悬停提示全文；两者都空时显示占位符
      const lines: VNode[] = []
      if (row.includePattern) lines.push(h('div', { class: 'cell-sub', title: row.includePattern }, '+ ' + row.includePattern))
      if (row.excludePattern) lines.push(h('div', { class: 'cell-sub', title: row.excludePattern }, '- ' + row.excludePattern))
      return lines.length > 0 ? h('div', { class: 'cell-stack' }, lines) : h('span', { class: 'cell-muted' }, '—')
    }
  },
  {
    title: t('automation.colDir'),
    key: 'dir',
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: row => row.dir || t('automation.dirDefault')
  },
  {
    title: t('automation.colEnabled'),
    key: 'enabled',
    width: 70,
    render: row => h(NSwitch, {
      value: row.enabled,
      size: 'small',
      'onUpdate:value': (value: boolean) => { void toggleRssEnabled(row, value) }
    })
  },
  {
    title: t('automation.rssColLastFetch'),
    key: 'lastFetchAt',
    width: 150,
    render: renderRssLastFetch
  },
  {
    title: t('automation.colActions'),
    key: 'actions',
    width: 200,
    render: row => h('div', { class: 'cell-actions' }, [
      h(NButton, {
        size: 'tiny',
        loading: fetchBusyId.value === row.id,
        onClick: () => { void fetchNow(row) }
      }, { default: () => t('automation.rssActionFetchNow') }),
      h(NButton, { size: 'tiny', onClick: () => openRssForm(row) }, { default: () => t('automation.edit') }),
      h(NPopconfirm, { onPositiveClick: () => { void deleteRss(row) } }, {
        trigger: () => h(NButton, { size: 'tiny', loading: deletingRssId.value === row.id }, { default: () => t('automation.delete') }),
        default: () => t('automation.rssConfirmDelete')
      })
    ])
  }
])

const fetchBusyId = ref('')
const deletingRssId = ref('')

async function fetchNow(row: RssSubscription): Promise<void> {
  fetchBusyId.value = row.id
  try {
    const result = await autoImportStore.fetchNow(row.id)
    if (!result.success) {
      message.error(result.error || t('automation.operationFailed', { error: '' }))
      return
    }
    if (result.added > 0) {
      message.success(t('automation.rssFetchAdded', { count: result.added }))
      if (result.items && result.items.length > 0) {
        previewItems.value = result.items
        previewVisible.value = true
      }
    } else {
      message.info(t('automation.rssFetchNone'))
    }
  } finally {
    fetchBusyId.value = ''
  }
}

async function toggleRssEnabled(row: RssSubscription, enabled: boolean): Promise<void> {
  // 只改开关，其余字段原样回传：主进程 upsert 会保留 last* 运行时字段
  const result = await autoImportStore.saveSubscription({ ...row, enabled })
  if (!result.success) {
    message.error(t('automation.saveFailed', { error: result.error ?? '' }))
    return
  }
  if (!enabled) return
  void autoImportStore.refreshLog()
}

async function deleteRss(row: RssSubscription): Promise<void> {
  deletingRssId.value = row.id
  try {
    const result = await autoImportStore.deleteSubscription(row.id)
    if (result.success) message.success(t('automation.deleted'))
    else message.error(t('automation.deleteFailed', { error: result.error ?? '' }))
  } finally {
    deletingRssId.value = ''
  }
}

// ---------------- RSS 表单 ----------------

interface RssFormState {
  id: string
  name: string
  url: string
  intervalMinutes: number | null
  maxPerFetch: number | null
  includePattern: string
  excludePattern: string
  dir: string
  enabled: boolean
}

const rssFormVisible = ref(false)
const savingRss = ref(false)
const rssFormRef = ref<FormInst>()
const rssForm = reactive<RssFormState>({
  id: '',
  name: '',
  url: '',
  intervalMinutes: 60,
  maxPerFetch: 10,
  includePattern: '',
  excludePattern: '',
  dir: '',
  enabled: true
})

/** 与主进程校验口径一致的前端预检：让用户在保存前就拿到本地化错误提示 */
const rssRules = computed<FormRules>(() => ({
  name: [
    { required: true, message: () => t('automation.rssFieldNameRequired'), trigger: 'blur' },
    { validator: (_rule, value: string) => value.trim().length <= 100, message: () => t('automation.rssFieldNameTooLong'), trigger: 'blur' }
  ],
  url: [
    { required: true, message: () => t('automation.rssFieldUrlRequired'), trigger: 'blur' },
    { validator: (_rule, value: string) => /^https?:\/\//i.test(value.trim()), message: () => t('automation.rssFieldUrlInvalid'), trigger: 'blur' }
  ],
  intervalMinutes: [
    { required: true, type: 'number', message: () => t('automation.rssFieldIntervalRequired'), trigger: 'blur' },
    { type: 'number', min: 5, max: 10080, message: () => t('automation.rssFieldIntervalRange'), trigger: 'blur' }
  ],
  maxPerFetch: [
    { required: true, type: 'number', message: () => t('automation.rssFieldMaxPerFetchRange'), trigger: 'blur' },
    { type: 'number', min: 1, max: 50, message: () => t('automation.rssFieldMaxPerFetchRange'), trigger: 'blur' }
  ],
  includePattern: [{ validator: validatePattern, trigger: 'blur' }],
  excludePattern: [{ validator: validatePattern, trigger: 'blur' }],
  dir: [{ validator: validateOptionalAbsolutePath, trigger: 'blur' }]
}))

/** 包含/排除正则的共用校验：可编译且 ≤200 字符（主进程同一口径） */
function validatePattern(_rule: unknown, value: string | null): boolean | Error {
  const pattern = (value ?? '').trim()
  if (pattern === '') return true
  if (pattern.length > 200) return new Error(t('automation.fieldPatternTooLong'))
  try {
    new RegExp(pattern)
    return true
  } catch {
    return new Error(t('automation.fieldPatternInvalid'))
  }
}

/** 可选目录必须绝对路径：Windows 盘符 / UNC / POSIX 三种形态都认 */
function validateOptionalAbsolutePath(_rule: unknown, value: string | null): boolean | Error {
  const dir = (value ?? '').trim()
  if (dir === '') return true
  return isAbsoluteLike(dir) ? true : new Error(t('automation.fieldDirInvalid'))
}

function isAbsoluteLike(dir: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(dir)
}

function openRssForm(row?: RssSubscription): void {
  rssForm.id = row?.id ?? ''
  rssForm.name = row?.name ?? ''
  rssForm.url = row?.url ?? ''
  rssForm.intervalMinutes = row?.intervalMinutes ?? 60
  rssForm.maxPerFetch = row?.maxPerFetch ?? 10
  rssForm.includePattern = row?.includePattern ?? ''
  rssForm.excludePattern = row?.excludePattern ?? ''
  rssForm.dir = row?.dir ?? ''
  rssForm.enabled = row?.enabled ?? true
  rssFormVisible.value = true
}

async function submitRssForm(): Promise<void> {
  if (!rssFormRef.value) return
  try {
    await rssFormRef.value.validate()
  } catch {
    return
  }
  savingRss.value = true
  try {
    const subscription: RssSubscription = {
      id: rssForm.id,
      name: rssForm.name.trim(),
      url: rssForm.url.trim(),
      enabled: rssForm.enabled,
      intervalMinutes: rssForm.intervalMinutes ?? undefined,
      maxPerFetch: rssForm.maxPerFetch ?? undefined,
      includePattern: rssForm.includePattern.trim() || undefined,
      excludePattern: rssForm.excludePattern.trim() || undefined,
      dir: rssForm.dir.trim() || undefined
    }
    const result = await autoImportStore.saveSubscription(subscription)
    if (!result.success) {
      message.error(t('automation.saveFailed', { error: result.error ?? '' }))
      return
    }
    message.success(t('automation.saved'))
    rssFormVisible.value = false
  } finally {
    savingRss.value = false
  }
}

// ---------------- 监听文件夹表格 ----------------

const scanBusyId = ref('')

const watchColumns = computed<DataTableColumns<WatchFolderConfig>>(() => [
  { title: t('automation.watchColPath'), key: 'path', minWidth: 220, ellipsis: { tooltip: true } },
  {
    title: t('automation.watchColExtensions'),
    key: 'extensions',
    minWidth: 160,
    render: row => h('div', { class: 'cell-stack' }, (row.extensions ?? ['.torrent', '.metalink', '.txt']).map(ext =>
      h(NTag, { size: 'tiny', bordered: false, class: 'cell-tag' }, { default: () => ext })
    ))
  },
  {
    title: t('automation.watchColAction'),
    key: 'deleteAfterImport',
    width: 180,
    render: row => row.deleteAfterImport === true
      ? t('automation.watchActionDeleteAfter')
      : t('automation.watchActionArchiveAfter')
  },
  {
    title: t('automation.colDir'),
    key: 'dir',
    minWidth: 150,
    ellipsis: { tooltip: true },
    render: row => row.dir || t('automation.dirDefault')
  },
  {
    title: t('automation.colEnabled'),
    key: 'enabled',
    width: 70,
    render: row => h(NSwitch, {
      value: row.enabled,
      size: 'small',
      'onUpdate:value': (value: boolean) => { void toggleWatchEnabled(row, value) }
    })
  },
  {
    title: t('automation.watchColLastScan'),
    key: 'lastScanAt',
    width: 150,
    render: row => row.lastScanAt
      ? h('div', { class: 'cell-stack' }, [
        row.lastError
          ? h(NTag, { type: 'error', size: 'tiny', bordered: false, title: row.lastError }, { default: () => t('automation.rssStatusError') })
          : h(NTag, { type: 'success', size: 'tiny', bordered: false }, { default: () => t('automation.rssStatusOk') }),
        h('span', { class: 'cell-time' }, formatCompleteTime(new Date(row.lastScanAt).getTime()))
      ])
      : h(NTag, { size: 'tiny', bordered: false }, { default: () => t('automation.watchStatusNever') })
  },
  {
    title: t('automation.colActions'),
    key: 'actions',
    width: 200,
    render: row => h('div', { class: 'cell-actions' }, [
      h(NButton, {
        size: 'tiny',
        loading: scanBusyId.value === row.id,
        onClick: () => { void scanNow(row) }
      }, { default: () => t('automation.watchActionScanNow') }),
      h(NButton, { size: 'tiny', onClick: () => openWatchForm(row) }, { default: () => t('automation.edit') }),
      h(NPopconfirm, { onPositiveClick: () => { void deleteWatch(row) } }, {
        trigger: () => h(NButton, { size: 'tiny', loading: deletingWatchId.value === row.id }, { default: () => t('automation.delete') }),
        default: () => t('automation.watchConfirmDelete')
      })
    ])
  }
])

const deletingWatchId = ref('')

async function scanNow(row: WatchFolderConfig): Promise<void> {
  scanBusyId.value = row.id
  try {
    const result = await autoImportStore.scanNow(row.id)
    if (!result.success) {
      message.error(result.error || t('automation.operationFailed', { error: '' }))
      return
    }
    if (result.imported > 0) message.success(t('automation.watchScanImported', { count: result.imported }))
    else message.info(t('automation.watchScanNone'))
  } finally {
    scanBusyId.value = ''
  }
}

async function toggleWatchEnabled(row: WatchFolderConfig, enabled: boolean): Promise<void> {
  const result = await autoImportStore.saveFolder({ ...row, enabled })
  if (!result.success) message.error(t('automation.saveFailed', { error: result.error ?? '' }))
}

async function deleteWatch(row: WatchFolderConfig): Promise<void> {
  deletingWatchId.value = row.id
  try {
    const result = await autoImportStore.deleteFolder(row.id)
    if (result.success) message.success(t('automation.deleted'))
    else message.error(t('automation.deleteFailed', { error: result.error ?? '' }))
  } finally {
    deletingWatchId.value = ''
  }
}

// ---------------- 监听文件夹表单 ----------------

interface WatchFormState {
  id: string
  path: string
  extensions: string
  dir: string
  deleteAfterImport: boolean
  enabled: boolean
}

const watchFormVisible = ref(false)
const savingWatch = ref(false)
const watchFormRef = ref<FormInst>()
const watchForm = reactive<WatchFormState>({
  id: '',
  path: '',
  extensions: '.torrent,.metalink,.txt',
  dir: '',
  deleteAfterImport: false,
  enabled: true
})

const watchRules = computed<FormRules>(() => ({
  path: [
    { required: true, message: () => t('automation.watchFieldPathRequired'), trigger: 'blur' },
    { validator: (_rule, value: string) => isAbsoluteLike(value.trim()), message: () => t('automation.fieldDirInvalid'), trigger: 'blur' }
  ],
  dir: [{ validator: validateOptionalAbsolutePath, trigger: 'blur' }]
}))

function openWatchForm(row?: WatchFolderConfig): void {
  watchForm.id = row?.id ?? ''
  watchForm.path = row?.path ?? ''
  watchForm.extensions = (row?.extensions ?? ['.torrent', '.metalink', '.txt']).join(',')
  watchForm.dir = row?.dir ?? ''
  watchForm.deleteAfterImport = row?.deleteAfterImport === true
  watchForm.enabled = row?.enabled ?? true
  watchFormVisible.value = true
}

/**
 * 扩展名归一：按逗号/空白拆分 → 去点 → 小写 → 补点 → 去重。
 * 与主进程同口径，提前在 UI 层做一遍是为了让"torrent, .MP4"这类输入
 * 保存后回显成规整的 ".torrent,.mp4"，而不是等下一轮 list 才纠正。
 */
function normalizeExtensions(input: string): string[] {
  const seen = new Set<string>()
  for (const token of input.split(/[,，\s]+/)) {
    const ext = token.trim().toLowerCase().replace(/^\.+/, '')
    if (ext === '') continue
    seen.add('.' + ext)
  }
  return [...seen]
}

async function submitWatchForm(): Promise<void> {
  if (!watchFormRef.value) return
  try {
    await watchFormRef.value.validate()
  } catch {
    return
  }
  savingWatch.value = true
  try {
    const extensions = normalizeExtensions(watchForm.extensions)
    const folder: WatchFolderConfig = {
      id: watchForm.id,
      path: watchForm.path.trim(),
      enabled: watchForm.enabled,
      deleteAfterImport: watchForm.deleteAfterImport,
      extensions: extensions.length > 0 ? extensions : undefined,
      dir: watchForm.dir.trim() || undefined
    }
    const result = await autoImportStore.saveFolder(folder)
    if (!result.success) {
      message.error(t('automation.saveFailed', { error: result.error ?? '' }))
      return
    }
    message.success(t('automation.saved'))
    watchFormVisible.value = false
  } finally {
    savingWatch.value = false
  }
}

// ---------------- 导入日志表格 ----------------

const logColumns = computed<DataTableColumns<AutoImportLogEntry>>(() => [
  {
    title: t('automation.logColTime'),
    key: 'importedAt',
    width: 150,
    render: row => formatCompleteTime(new Date(row.importedAt).getTime())
  },
  {
    title: t('automation.logColSource'),
    key: 'sourceName',
    width: 200,
    render: row => h('div', { class: 'cell-stack' }, [
      h(NTag, {
        size: 'tiny',
        bordered: false,
        type: row.kind === 'watch-folder' ? 'info' : 'warning'
      }, { default: () => row.kind === 'watch-folder' ? t('automation.logKindWatch') : t('automation.logKindRss') }),
      h('span', { class: 'cell-sub', title: row.sourceName }, row.sourceName)
    ])
  },
  {
    title: t('automation.logColTitle'),
    key: 'title',
    minWidth: 260,
    ellipsis: { tooltip: true }
  },
  {
    title: t('automation.logColStatus'),
    key: 'status',
    width: 90,
    render: row => {
      if (row.status === 'added') return h(NTag, { type: 'success', size: 'tiny', bordered: false }, { default: () => t('automation.logStatusAdded') })
      if (row.status === 'skipped') return h(NTag, { size: 'tiny', bordered: false }, { default: () => t('automation.logStatusSkipped') })
      return h(NTag, { type: 'error', size: 'tiny', bordered: false }, { default: () => t('automation.logStatusError') })
    }
  },
  {
    title: t('automation.logColMessage'),
    key: 'message',
    minWidth: 200,
    ellipsis: { tooltip: true },
    render: row => row.message ?? '—'
  }
])

// ---------------- 通用：目录选择 / 刷新 / 轮询 / 预览 ----------------

const previewVisible = ref(false)
const previewItems = ref<{ title: string; link: string }[]>([])

/** 复用 preload 暴露的原生目录选择器；拿不到 API（如纯浏览器环境）时静默降级为手输 */
async function pickDirectory(target: 'rssDir' | 'watchPath' | 'watchDir'): Promise<void> {
  if (!window.electronAPI?.showOpenDialog) return
  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openDirectory'],
      title: t('automation.pickDir')
    })
    if (result.canceled) return
    const picked = result.filePaths[0]
    if (!picked) return
    if (target === 'rssDir') rssForm.dir = picked
    else if (target === 'watchPath') watchForm.path = picked
    else watchForm.dir = picked
  } catch {
    // 选择器被拒/取消都不算错误，不打扰用户
  }
}

async function handleRefresh(): Promise<void> {
  await autoImportStore.loadAll()
  if (autoImportStore.lastError) message.error(t('automation.loadFailed', { error: autoImportStore.lastError }))
  else message.success(t('automation.refreshed'))
}

onMounted(() => {
  void autoImportStore.loadAll()
  // 引擎无推送事件：页面可见期间以 30 秒轮询代替订阅，卸载时必须清理避免定时器泄漏
  pollTimer = setInterval(() => { void autoImportStore.pollRefresh() }, POLL_INTERVAL_MS)
})

onUnmounted(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer)
  pollTimer = undefined
})
</script>

<style scoped>
.automation-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.load-error {
  margin-top: 0;
}

.section-card {
  border-radius: 10px;
  border: 1px solid var(--border-light);
}

.section-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.section-empty {
  padding: 32px 0;
}

.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cell-sub {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-time {
  font-size: 12px;
  color: var(--text-secondary);
}

.cell-muted {
  color: var(--text-secondary);
}

.cell-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.full-width {
  width: 100%;
}

.preview-list {
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-item {
  font-size: 13px;
  line-height: 1.5;
}

.preview-link {
  color: var(--color-primary);
  text-decoration: none;
  word-break: break-all;
}

.preview-link:hover {
  text-decoration: underline;
}

.preview-title {
  word-break: break-all;
}
</style>
