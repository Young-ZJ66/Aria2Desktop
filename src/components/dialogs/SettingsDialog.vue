<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="t('app.settings')"
    :bordered="false"
    :mask-closable="true"
    :auto-focus="false"
    class="settings-modal"
    style="width: min(1040px, calc(100vw - 48px));"
    content-style="padding: 0;"
    :header-style="{
      padding: '16px 24px 14px',
      borderBottom: '1px solid var(--ds-border-subtle)'
    }"
    :title-style="{
      fontSize: '18px',
      fontWeight: '650',
      letterSpacing: '-0.01em',
      color: 'var(--ds-text-strong)'
    }"
  >
    <div ref="bodyRef" class="settings-dialog-body">
      <h1 class="sr-only">{{ t('app.settings') }}</h1>
      <n-tabs
        v-model:value="activeGroup"
        class="settings-main-tabs"
        type="line"
        placement="left"
        animated
        size="small"
      >
        <template #prefix>
          <div class="settings-search">
            <n-input
              v-model:value="searchQuery"
              size="small"
              clearable
              :placeholder="t('settings.searchPlaceholder')"
              @keydown.enter="jumpToFirstResult"
            >
              <template #prefix>
                <n-icon><SearchOutline /></n-icon>
              </template>
            </n-input>
            <div v-if="searchQuery.trim()" class="settings-search-panel">
              <button
                v-for="(item, index) in searchResults"
                :key="item.id"
                type="button"
                class="settings-search-item"
                @mousedown.prevent
                @click="jumpTo(item)"
              >
                <span class="settings-search-label">{{ item.label }}</span>
                <!-- 同一页签的连续结果只在第一行标注归属，避免整列重复同一个词 -->
                <span
                  v-if="index === 0 || item.tabLabel !== searchResults[index - 1]?.tabLabel"
                  class="settings-search-tab"
                >{{ item.tabLabel }}</span>
              </button>
              <div v-if="searchPending" class="settings-search-empty">
                {{ t('settings.searchLoading') }}
              </div>
              <div v-else-if="searchResults.length === 0" class="settings-search-empty">
                {{ t('settings.searchNoResult') }}
              </div>
            </div>
          </div>
        </template>
        <n-tab-pane
          class="settings-main-pane settings-leaf-pane"
          data-settings-tab="general"
          data-settings-group="general"
          :display-directive="paneDirective('general')"
          name="general"
          :tab="t('nav.generalSettings')"
        >
          <GeneralSettings />
        </n-tab-pane>
        <n-tab-pane
          class="settings-main-pane settings-leaf-pane"
          data-settings-tab="engine"
          data-settings-group="engine"
          :display-directive="paneDirective('engine')"
          name="engine"
          :tab="t('nav.engineSettings')"
        >
          <EngineSettings />
        </n-tab-pane>
        <n-tab-pane
          class="settings-main-pane settings-leaf-pane"
          data-settings-tab="download"
          data-settings-group="download"
          :display-directive="paneDirective('download')"
          name="download"
          :tab="t('nav.downloadSettings')"
        >
          <DownloadSettings />
        </n-tab-pane>
        <n-tab-pane class="settings-main-pane" :display-directive="paneDirective('network')" name="network" :tab="t('nav.networkProtocolGroup')">
          <n-tabs v-model:value="networkSubTab" class="settings-subtabs" type="segment" size="small" justify-content="center" pane-style="padding: 0;">
            <n-tab-pane
              class="settings-leaf-pane"
              data-settings-tab="network"
              data-settings-group="network"
              :display-directive="paneDirective('network')"
              name="network"
              :tab="t('nav.networkSettings')"
            >
              <NetworkSettings />
            </n-tab-pane>
            <n-tab-pane
              class="settings-leaf-pane"
              data-settings-tab="protocol"
              data-settings-group="network"
              :display-directive="paneDirective('protocol')"
              name="protocol"
              :tab="t('nav.protocolSettings')"
            >
              <ProtocolSettings />
            </n-tab-pane>
            <n-tab-pane
              class="settings-leaf-pane"
              data-settings-tab="metalink"
              data-settings-group="network"
              :display-directive="paneDirective('metalink')"
              name="metalink"
              :tab="t('nav.metalinkSettings')"
            >
              <MetalinkSettings />
            </n-tab-pane>
          </n-tabs>
        </n-tab-pane>
        <n-tab-pane
          class="settings-main-pane settings-leaf-pane"
          data-settings-tab="bt"
          data-settings-group="bt"
          :display-directive="paneDirective('bt')"
          name="bt"
          :tab="t('nav.btSettings')"
        >
          <BtSettings />
        </n-tab-pane>
        <n-tab-pane class="settings-main-pane" :display-directive="paneDirective('components')" name="components" :tab="t('nav.toolsPluginsGroup')">
          <n-tabs v-model:value="componentsSubTab" class="settings-subtabs" type="segment" size="small" justify-content="center" pane-style="padding: 0;">
            <n-tab-pane
              class="settings-leaf-pane"
              data-settings-tab="components"
              data-settings-group="components"
              :display-directive="paneDirective('components')"
              name="components"
              :tab="t('nav.componentSettings')"
            >
              <ComponentSettings />
            </n-tab-pane>
            <n-tab-pane
              class="settings-leaf-pane"
              data-settings-tab="plugins"
              data-settings-group="components"
              :display-directive="paneDirective('plugins')"
              name="plugins"
              :tab="t('nav.pluginSettings')"
            >
              <PluginSettings />
            </n-tab-pane>
          </n-tabs>
        </n-tab-pane>
        <n-tab-pane
          class="settings-main-pane settings-leaf-pane"
          data-settings-tab="remote-access"
          data-settings-group="remoteAccess"
          :display-directive="paneDirective('remote-access')"
          name="remote-access"
          :tab="t('nav.remoteAccess')"
        >
          <RemoteAccessSettings />
        </n-tab-pane>
        <n-tab-pane
          class="settings-main-pane settings-leaf-pane"
          data-settings-tab="logs"
          data-settings-group="logs"
          :display-directive="paneDirective('logs')"
          name="logs"
          :tab="t('nav.logs')"
        >
          <LogsSettings />
        </n-tab-pane>
        <n-tab-pane
          class="settings-main-pane settings-leaf-pane"
          data-settings-tab="reset-backup"
          data-settings-group="resetBackup"
          :display-directive="paneDirective('reset-backup')"
          name="reset-backup"
          :tab="t('nav.resetBackup')"
        >
          <ResetBackupSettings />
        </n-tab-pane>
        <n-tab-pane class="settings-main-pane" :display-directive="paneDirective('rpc-security')" name="security" :tab="t('nav.securityMaintenanceGroup')">
          <n-tabs v-model:value="securitySubTab" class="settings-subtabs" type="segment" size="small" justify-content="center" pane-style="padding: 0;">
            <n-tab-pane
              class="settings-leaf-pane"
              data-settings-tab="rpc-security"
              data-settings-group="security"
              :display-directive="paneDirective('rpc-security')"
              name="rpc-security"
              :tab="t('nav.rpcSecuritySettings')"
            >
              <RpcSecuritySettings />
            </n-tab-pane>
            <n-tab-pane
              class="settings-leaf-pane"
              data-settings-tab="advanced"
              data-settings-group="security"
              :display-directive="paneDirective('advanced')"
              name="advanced"
              :tab="t('nav.advancedSettings')"
            >
              <AdvancedSettings />
            </n-tab-pane>
            <n-tab-pane
              class="settings-leaf-pane"
              data-settings-tab="diagnostics"
              data-settings-group="security"
              :display-directive="paneDirective('diagnostics')"
              name="diagnostics"
              :tab="t('nav.diagnostics')"
            >
              <DiagnosticsSettings />
            </n-tab-pane>
          </n-tabs>
        </n-tab-pane>
      </n-tabs>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SearchOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/uiStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { confirm } from '@/utils/feedback'
import { getDirtyPages, saveDirtyPage } from '@/composables/useGlobalSettingsForm'

// 设置页面按需加载，保持与原有路由懒加载一致，避免全部打进首屏包。
// 同时保留 loader：应用空闲时预取，首次打开设置页不必再等动态 import。
const settingsLoaders = {
  general: () => import('@/views/settings/GeneralSettings.vue'),
  engine: () => import('@/views/settings/EngineSettings.vue'),
  download: () => import('@/views/settings/DownloadSettings.vue'),
  network: () => import('@/views/settings/NetworkSettings.vue'),
  protocol: () => import('@/views/settings/ProtocolSettings.vue'),
  bt: () => import('@/views/settings/BtSettings.vue'),
  metalink: () => import('@/views/settings/MetalinkSettings.vue'),
  components: () => import('@/views/settings/ComponentSettings.vue'),
  plugins: () => import('@/views/settings/PluginSettings.vue'),
  rpcSecurity: () => import('@/views/settings/RpcSecuritySettings.vue'),
  remoteAccess: () => import('@/views/settings/RemoteAccessSettings.vue'),
  resetBackup: () => import('@/views/settings/ResetBackupSettings.vue'),
  advanced: () => import('@/views/settings/AdvancedSettings.vue'),
  diagnostics: () => import('@/views/settings/DiagnosticsSettings.vue'),
  logs: () => import('@/views/settings/LogsSettings.vue')
} as const

const GeneralSettings = defineAsyncComponent(settingsLoaders.general)
const EngineSettings = defineAsyncComponent(settingsLoaders.engine)
const DownloadSettings = defineAsyncComponent(settingsLoaders.download)
const NetworkSettings = defineAsyncComponent(settingsLoaders.network)
const ProtocolSettings = defineAsyncComponent(settingsLoaders.protocol)
const BtSettings = defineAsyncComponent(settingsLoaders.bt)
const MetalinkSettings = defineAsyncComponent(settingsLoaders.metalink)
const ComponentSettings = defineAsyncComponent(settingsLoaders.components)
const PluginSettings = defineAsyncComponent(settingsLoaders.plugins)
const RpcSecuritySettings = defineAsyncComponent(settingsLoaders.rpcSecurity)
const RemoteAccessSettings = defineAsyncComponent(settingsLoaders.remoteAccess)
const ResetBackupSettings = defineAsyncComponent(settingsLoaders.resetBackup)
const AdvancedSettings = defineAsyncComponent(settingsLoaders.advanced)
const DiagnosticsSettings = defineAsyncComponent(settingsLoaders.diagnostics)
const LogsSettings = defineAsyncComponent(settingsLoaders.logs)

const uiStore = useUiStore()
const connectionStore = useConnectionStore()
const { t, locale } = useI18n()

interface SettingsLeaf {
  name: string
  labelKey: string
}

interface SettingsGroup {
  name: string
  labelKey: string
  pages: SettingsLeaf[]
}

/**
 * 设置页分组：侧边栏只保留 8 个一级入口，互相关联的页面收进二级 Tab。
 * 这样在 1200×800 等常见窗口下左侧导航不需要上下滚动；
 * 每个子页面仍是独立组件，保存/重载/恢复默认按钮各管各的，互不影响。
 */
const SETTINGS_GROUPS: SettingsGroup[] = [
  { name: 'general', labelKey: 'nav.generalSettings', pages: [{ name: 'general', labelKey: 'nav.generalSettings' }] },
  { name: 'engine', labelKey: 'nav.engineSettings', pages: [{ name: 'engine', labelKey: 'nav.engineSettings' }] },
  { name: 'download', labelKey: 'nav.downloadSettings', pages: [{ name: 'download', labelKey: 'nav.downloadSettings' }] },
  {
    name: 'network',
    labelKey: 'nav.networkProtocolGroup',
    pages: [
      { name: 'network', labelKey: 'nav.networkSettings' },
      { name: 'protocol', labelKey: 'nav.protocolSettings' },
      { name: 'metalink', labelKey: 'nav.metalinkSettings' }
    ]
  },
  { name: 'bt', labelKey: 'nav.btSettings', pages: [{ name: 'bt', labelKey: 'nav.btSettings' }] },
  {
    name: 'components',
    labelKey: 'nav.toolsPluginsGroup',
    pages: [
      { name: 'components', labelKey: 'nav.componentSettings' },
      { name: 'plugins', labelKey: 'nav.pluginSettings' }
    ]
  },
  { name: 'remote-access', labelKey: 'nav.remoteAccess', pages: [{ name: 'remote-access', labelKey: 'nav.remoteAccess' }] },
  { name: 'logs', labelKey: 'nav.logs', pages: [{ name: 'logs', labelKey: 'nav.logs' }] },
  { name: 'reset-backup', labelKey: 'nav.resetBackup', pages: [{ name: 'reset-backup', labelKey: 'nav.resetBackup' }] },
  {
    name: 'security',
    labelKey: 'nav.securityMaintenanceGroup',
    pages: [
      { name: 'rpc-security', labelKey: 'nav.rpcSecuritySettings' },
      { name: 'advanced', labelKey: 'nav.advancedSettings' },
      { name: 'diagnostics', labelKey: 'nav.diagnostics' }
    ]
  }
]

const SETTINGS_LEAVES = SETTINGS_GROUPS.flatMap(group => group.pages)

function groupOfLeaf(name: string): SettingsGroup {
  return SETTINGS_GROUPS.find(group => group.pages.some(page => page.name === name)) ?? SETTINGS_GROUPS[0]!
}

function leafMetaOf(name: string): SettingsLeaf | undefined {
  return SETTINGS_LEAVES.find(page => page.name === name)
}

function groupLabelOf(name: string): string {
  const group = SETTINGS_GROUPS.find(item => item.name === name)
  return group ? t(group.labelKey) : ''
}

function leafLabelOf(name: string): string {
  const page = leafMetaOf(name)
  return page ? t(page.labelKey) : ''
}

/** 最近访问的二级页签；从外部（例如流媒体页）打开设置时也能落到正确子页 */
const subTabState = ref<Record<string, string>>({
  network: 'network',
  components: 'components',
  security: 'rpc-security'
})

function createSubTabModel(groupName: string) {
  return computed({
    get: () => {
      const group = SETTINGS_GROUPS.find(item => item.name === groupName)
      const saved = subTabState.value[groupName]
      return saved && group?.pages.some(page => page.name === saved) ? saved : group?.pages[0]?.name ?? ''
    },
    set: (value: string) => {
      subTabState.value = { ...subTabState.value, [groupName]: value }
      uiStore.settingsTab = value
    }
  })
}

const networkSubTab = createSubTabModel('network')
const componentsSubTab = createSubTabModel('components')
const securitySubTab = createSubTabModel('security')

/** 一级页签绑定到分组；uiStore 仍保存具体子页名，便于外部跳转与 E2E 定位 */
const activeGroup = computed({
  get: () => groupOfLeaf(uiStore.settingsTab).name,
  set: (groupName: string) => {
    const group = SETTINGS_GROUPS.find(item => item.name === groupName)
    if (group) uiStore.settingsTab = subTabState.value[groupName] ?? group.pages[0]!.name
  }
})

watch(
  () => uiStore.settingsTab,
  (tab) => {
    const group = groupOfLeaf(tab)
    if (group.pages.length > 1) {
      subTabState.value = { ...subTabState.value, [group.name]: tab }
    }
  },
  { immediate: true }
)

// ── 设置项搜索：扫描已挂载的各页 DOM（标签 + 说明），支持多关键词模糊匹配 ──

const bodyRef = ref<HTMLElement | null>(null)
const searchQuery = ref('')

interface SearchEntry {
  id: string
  label: string
  tabName: string
  tabLabel: string
  searchText: string
}

/** 需要挂载的页签名：一级分组 + 全部子页（搜索索引要求所有子页都在 DOM 中） */
const tabNames = computed(() => {
  const names: string[] = []
  for (const group of SETTINGS_GROUPS) {
    names.push(group.name)
    for (const page of group.pages) names.push(page.name)
  }
  return [...new Set(names)]
})

/**
 * 页签按需挂载：默认 show:lazy，打开设置页时只渲染当前页签。
 * 此前 11 个页面（合计约 170 个表单项）在首次打开时一次性挂载，
 * 这才是"首次打开卡顿、内容要等零点几秒"的主因。
 * 访问过的页签会保持挂载，切回时无需重建。
 */
const mountedPanes = ref<Set<string>>(new Set())
const allPanesMounted = ref(false)
const searchIndexReady = ref(false)
const searchPending = ref(false)

/** 单个页签用哪种渲染指令：未挂载的保持惰性，已挂载的常驻 */
function paneDirective(name: string): 'show' | 'show:lazy' {
  return mountedPanes.value.has(name) ? 'show' : 'show:lazy'
}

/** 逐帧挂载全部页签：一次性挂载会阻塞主线程，每帧只挂一个 */
async function mountAllPanes(): Promise<void> {
  if (allPanesMounted.value) return
  for (const name of tabNames.value) {
    if (mountedPanes.value.has(name)) continue
    // Set 原地修改不会被依赖追踪，必须整体替换
    mountedPanes.value = new Set(mountedPanes.value).add(name)
    await nextTick()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  allPanesMounted.value = true
}

/**
 * 首次搜索时把所有页签挂载出来再建索引（隐藏页签未挂载时取不到文本）。
 * 页签代码块已在应用空闲时预取，这里通常只花几帧；索引建好后常驻复用。
 */
async function ensureSearchIndex(): Promise<void> {
  if (searchIndexReady.value || searchPending.value) return
  searchPending.value = true
  try {
    await mountAllPanes()
    // 等全部页签的代码块解析完（模块缓存命中时立即返回），
    // 再等一帧让异步组件真正挂载，避免索引漏掉尚未渲染的页签
    await Promise.allSettled(Object.values(settingsLoaders).map(load => load()))
    await nextTick()
    rebuildSearchIndex()
    searchIndexReady.value = true
  } finally {
    searchPending.value = false
  }
}

const searchEntries = ref<SearchEntry[]>([])
const searchElementRefs = new Map<string, HTMLElement>()

/**
 * 重建索引：每个 n-form-item 取标签 + 整行文本（含说明/提示），卡片标题也纳入。
 * 建索引前所有页签都已挂载（见 ensureSearchIndex），因此隐藏页的项也能被搜索到。
 * 只遍历叶子页（.settings-leaf-pane）：分组页本身没有内容，避免重复收录。
 */
function rebuildSearchIndex() {
  const body = bodyRef.value
  if (!body) return
  const panes = [...body.querySelectorAll<HTMLElement>('.settings-leaf-pane')]
  const entries: SearchEntry[] = []
  searchElementRefs.clear()

  panes.forEach((pane) => {
    const tabName = pane.dataset.settingsTab
    if (!tabName) return
    const groupName = pane.dataset.settingsGroup || tabName
    const leafLabel = leafLabelOf(tabName)
    const groupLabel = groupLabelOf(groupName)
    const tabLabel = groupName === tabName ? leafLabel : `${groupLabel} / ${leafLabel}`
    // 页签名本身参与匹配（S1）：搜"工具与扩展"这类页签名此前会零结果，
    // 因为索引只收表单项 label 与卡片标题，不含页签名
    entries.push({
      id: `${tabName}-tab`,
      label: leafLabel,
      tabName,
      tabLabel,
      searchText: `${groupLabel}\n${leafLabel}`.toLowerCase()
    })
    searchElementRefs.set(`${tabName}-tab`, pane)

    pane.querySelectorAll<HTMLElement>('.n-form-item').forEach((item, itemIndex) => {
      // 隐藏页签（v-show=false）用 textContent 取文本：innerText 在未渲染元素上不可靠
      const label = (item.querySelector<HTMLElement>('.n-form-item-label')?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!label) return
      const id = `${tabName}-f${itemIndex}`
      entries.push({
        id,
        label,
        tabName,
        tabLabel,
        searchText: `${label}\n${item.textContent || ''}`.toLowerCase()
      })
      searchElementRefs.set(id, item)
    })

    // 卡片标题 + 卡片整体文本（S2）：工具/插件页是卡片+列表布局，没有 n-form-item，
    // 不收卡片文本的话 "yt-dlp" "ffmpeg" 这些关键词完全搜不到
    pane.querySelectorAll<HTMLElement>('.n-card').forEach((card, cardIndex) => {
      const cardTitle = (card.querySelector<HTMLElement>('.n-card-header__main')?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!cardTitle) return
      const id = `${tabName}-c${cardIndex}`
      entries.push({
        id,
        label: cardTitle,
        tabName,
        tabLabel,
        searchText: `${cardTitle}\n${card.textContent || ''}`.toLowerCase()
      })
      searchElementRefs.set(id, card)
    })

    // 列表型页面的插件/组件条目（n-card 之外的独立条目）：按 class 特征兜底收录
    pane.querySelectorAll<HTMLElement>('.plugin-item, .component-item').forEach((item, itemIndex) => {
      const label = (item.querySelector('.plugin-name, .component-name')?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!label) return
      const id = `${tabName}-i${itemIndex}`
      entries.push({
        id,
        label,
        tabName,
        tabLabel,
        searchText: `${label}\n${item.textContent || ''}`.toLowerCase()
      })
      searchElementRefs.set(id, item)
    })
  })

  searchEntries.value = entries
}

const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return []
  // 空格分词，各词都命中即视为匹配（中文按子串，英文忽略大小写）
  const tokens = query.split(/\s+/).filter(Boolean)
  return searchEntries.value
    .filter(entry => tokens.every(token => entry.searchText.includes(token)))
    .slice(0, 20)
})

function jumpTo(entry: SearchEntry) {
  const target = searchElementRefs.get(entry.id)
  // 同时切换一级分组与二级子页，避免搜索结果落在隐藏的旧子页上
  uiStore.settingsTab = entry.tabName
  searchQuery.value = ''
  void nextTick(() => {
    // 页签切换后再等一帧，确保目标项的滚动容器已可见
    setTimeout(() => {
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target.classList.add('settings-search-hit')
      setTimeout(() => target.classList.remove('settings-search-hit'), 1800)
    }, 60)
  })
}

function jumpToFirstResult() {
  const first = searchResults.value[0]
  if (first) jumpTo(first)
}

/** 点击搜索区域之外时收起结果面板（不依赖输入框焦点，避免点击结果项时先闪退） */
function handleOutsideClick(event: MouseEvent) {
  if (!searchQuery.value.trim()) return
  const target = event.target as HTMLElement | null
  if (!target?.closest('.settings-search')) searchQuery.value = ''
}

/**
 * 应用空闲时预取各页签代码块：
 * 首次打开设置页的"内容要等零点几秒"来自这些动态 import，预取后直接命中模块缓存。
 */
function preloadSettingsChunks() {
  const loadAll = () => {
    for (const load of Object.values(settingsLoaders)) void load()
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(loadAll, { timeout: 1500 })
  } else {
    setTimeout(loadAll, 1000)
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick)
  preloadSettingsChunks()
})
onBeforeUnmount(() => document.removeEventListener('mousedown', handleOutsideClick))

watch(searchQuery, (value) => {
  if (value.trim()) void ensureSearchIndex()
})

// 切换语言后标签文本变化，重建索引以保证搜索结果准确
watch(locale, () => {
  if (searchIndexReady.value) rebuildSearchIndex()
})

const visible = computed({
  get: () => uiStore.showSettings,
  set: (value: boolean) => {
    if (!value) void requestClose()
  }
})

/**
 * 关闭前检查未保存修改：各设置页经 useGlobalSettingsForm({ dirtyTracking }) 注册，
 * 有脏页时询问「保存并关闭 / 放弃修改 / 继续编辑」。
 * 无脏页直接关闭，零打扰；引擎未连接时存不了盘，但也不能装作没这回事——
 * 至少让用户明确知道关闭等于丢弃。
 */
const closing = ref(false)
async function requestClose() {
  if (closing.value) return
  const dirty = getDirtyPages()
  if (dirty.length === 0) {
    uiStore.closeSettings()
    return
  }
  closing.value = true
  try {
    if (!connectionStore.isConnected) {
      const discard = await new Promise<boolean>((resolve) => {
        confirm({
          title: t('settings.unsavedTitle'),
          content: t('settings.unsavedDisconnected'),
          type: 'warning',
          positiveText: t('settings.unsavedDiscard'),
          negativeText: t('common.cancel'),
          onPositiveClick: () => resolve(true),
          onNegativeClick: () => resolve(false),
          onClose: () => resolve(false),
          onEsc: () => resolve(false)
        })
      })
      if (discard) uiStore.closeSettings()
      return
    }
    const action = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
      confirm({
        title: t('settings.unsavedTitle'),
        content: t('settings.unsavedContent'),
        type: 'warning',
        positiveText: t('settings.unsavedSaveClose'),
        negativeText: t('settings.unsavedDiscard'),
        onPositiveClick: () => resolve('save'),
        onNegativeClick: () => resolve('discard'),
        onClose: () => resolve('cancel'),
        onEsc: () => resolve('cancel')
      })
    })
    if (action === 'cancel') return
    if (action === 'save') {
      // 逐页保存：脏页通常只有当前浏览页；某页保存失败则不关闭，让用户处理
      for (const pageId of dirty) {
        const ok = await saveDirtyPage(pageId)
        if (ok === false) return
      }
    }
    uiStore.closeSettings()
  } finally {
    closing.value = false
  }
}

/**
 * 弹窗关闭后 Naive UI 会卸载内容（display-directive 默认 if），
 * 此时必须重置挂载/索引状态，否则下次打开会把已记录的页签全部重新挂载。
 * 延迟到离场动画结束再重置；期间若重新打开则取消计时，保留已挂载的页签。
 */
let closeResetTimer: ReturnType<typeof setTimeout> | null = null
watch(visible, (show) => {
  if (show) {
    if (closeResetTimer) {
      clearTimeout(closeResetTimer)
      closeResetTimer = null
    }
    return
  }
  closeResetTimer = setTimeout(() => {
    closeResetTimer = null
    mountedPanes.value = new Set()
    allPanesMounted.value = false
    searchIndexReady.value = false
    searchEntries.value = []
    searchElementRefs.clear()
    searchQuery.value = ''
  }, 600)
})
</script>

<style scoped>
/* 弹窗主体：左导航固定，右栏内容区内部滚动（原来外层 overflow:hidden 会把底部内容直接裁掉） */
.settings-dialog-body {
  height: min(82vh, 900px);
  max-height: calc(100vh - 112px);
  overflow: hidden;
  border-radius: 0 0 var(--ds-radius-lg) var(--ds-radius-lg);
  display: flex;
  flex-direction: column;
}

/* 搜索框沿用改版前的通栏位置：放在页签上方，不挤进标题行 */
.settings-search {
  position: relative;
  z-index: 6;
  flex: none;
  width: 100%;
  padding: 0 0 var(--ds-space-8);
}

.settings-search .n-input {
  width: 100%;
}

.settings-search-panel {
  position: absolute;
  top: calc(100% - 2px);
  left: 0;
  right: auto;
  width: 260px;
  max-width: 72vw;
  max-height: 320px;
  overflow-y: auto;
  padding: var(--ds-space-4);
  background: var(--ds-bg-raised);
  border: 1px solid var(--ds-border-base);
  border-radius: var(--ds-radius-lg);
  box-shadow: var(--ds-elev-3);
}

.settings-search-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-8);
  width: 100%;
  min-height: var(--ds-control-height-sm);
  padding: var(--ds-space-4) var(--ds-space-8);
  border: none;
  border-radius: var(--ds-radius-sm);
  background: transparent;
  color: var(--ds-text-base);
  font-family: inherit;
  font-size: var(--ds-text-body-size);
  line-height: var(--ds-text-body-leading);
  text-align: left;
  cursor: pointer;
}

.settings-search-item:hover {
  background: var(--ds-bg-hover);
  color: var(--ds-text-strong);
}

.settings-search-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-search-tab {
  flex: none;
  padding: 0 var(--ds-space-6);
  border-radius: var(--ds-radius-pill);
  background: var(--ds-bg-sunken);
  font-size: var(--ds-text-micro-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-muted);
}

.settings-search-empty {
  padding: var(--ds-space-8);
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

/* 搜索框挂在左侧导航的 prefix 里；下拉需要溢出到内容区，所以 nav 本身不裁切 */
.settings-dialog-body :deep(.settings-main-tabs > .n-tabs-nav .n-tabs-nav__prefix) {
  flex: none;
  width: 100%;
  padding: 0;
  margin: 0 0 var(--ds-space-4);
  border-right: none;
}

/* 左侧导航固定宽度，右侧内容区独占剩余空间 */
.settings-dialog-body :deep(.settings-main-tabs) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 一级导航：与主侧栏 AppSidebar 同一套选中态——accent-subtle 底 + 3px 主色指示条 + accent-text 文字。
   原来只有「淡灰底 + 蓝字」，10 个条目里很难一眼定位当前页。 */
.settings-dialog-body :deep(.settings-main-tabs > .n-tabs-nav.n-tabs-nav--left) {
  flex: 0 0 208px;
  width: 208px;
  padding: var(--ds-space-8) var(--ds-space-12);
  border-right: 1px solid var(--ds-border-subtle);
  background: var(--ds-bg-surface);
  display: flex;
  flex-direction: column;
  overflow: visible;
}

/* naive 自带的细竖线指示器隐藏，改用条目内部的 3px 主色条 */
.settings-dialog-body :deep(.settings-main-tabs > .n-tabs-nav .n-tabs-bar) {
  display: none;
}

/* naive 在 placement=left 时会给滚动内容加 1px 右边线，与外层 nav 的 border-right 叠成双线；
   同时它的 scroll-content 默认 min-width:100%，条目被拉满宽度，这里改为纵向整列排布 */
.settings-dialog-body :deep(.settings-main-tabs > .n-tabs-nav .n-tabs-nav-scroll-content) {
  flex-direction: column;
  width: 100%;
  min-width: 0;
  border-right: none;
}

.settings-dialog-body :deep(.settings-main-tabs > .n-tabs-nav .n-tabs-tab) {
  position: relative;
  display: flex;
  align-items: center;
  height: var(--ds-control-nav-item);
  padding: 0 var(--ds-space-12);
  border-radius: var(--ds-radius-md);
  font-size: var(--ds-text-body-size);
  font-weight: 450;
  color: var(--ds-text-base);
  transition:
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.settings-dialog-body :deep(.settings-main-tabs > .n-tabs-nav .n-tabs-tab:hover) {
  background-color: var(--ds-bg-hover);
  color: var(--ds-text-strong);
}

.settings-dialog-body :deep(.settings-main-tabs > .n-tabs-nav .n-tabs-tab.n-tabs-tab--active) {
  background-color: var(--ds-accent-subtle);
  color: var(--ds-accent-text);
  font-weight: 550;
}

.settings-dialog-body
  :deep(.settings-main-tabs > .n-tabs-nav .n-tabs-tab.n-tabs-tab--active::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 16px;
  transform: translateY(-50%);
  border-radius: var(--ds-radius-pill);
  background: var(--ds-accent);
}

/* 10 项导航的语义分组：应用与引擎 / 下载与网络 / 组件与连接 / 维护与安全。
   加文字小标题需要 24 个 locale 的新 key（见报告 TODO(i18n)），这里先用 1px 细线分隔；
   :has() 不受支持时整条规则失效，不会破坏布局。 */
.settings-dialog-body
  :deep(
    .settings-main-tabs > .n-tabs-nav .n-tabs-tab-wrapper:has(> .n-tabs-tab[data-name='download'])
  ),
.settings-dialog-body
  :deep(
    .settings-main-tabs > .n-tabs-nav .n-tabs-tab-wrapper:has(> .n-tabs-tab[data-name='components'])
  ),
.settings-dialog-body
  :deep(.settings-main-tabs > .n-tabs-nav .n-tabs-tab-wrapper:has(> .n-tabs-tab[data-name='logs'])) {
  margin-top: var(--ds-space-8);
  padding-top: var(--ds-space-8);
  border-top: 1px solid var(--ds-border-subtle);
}

/* 内容区内部滚动：长页面（下载/网络/BT）底部不再被弹窗裁掉。
   placement=left 时 naive 不生成 pane-wrapper，pane 直接是 tabs 的 flex 子项，
   必须自己拿 flex:1 + min-width:0，否则长表单会把弹窗横向撑开。 */
.settings-dialog-body :deep(.settings-main-tabs > .n-tabs-tab-pane) {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.settings-dialog-body :deep(.settings-main-pane) {
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--ds-space-8) var(--ds-space-40) var(--ds-space-24);
  background: var(--ds-bg-surface);
}

@media (max-width: 900px) {
  .settings-dialog-body :deep(.settings-main-pane) {
    padding: var(--ds-space-8) var(--ds-space-24) var(--ds-space-20);
  }
}

/* 有底部保存条的设置页：面板底部内边距与保存条外边距统一为 8px，避免上下空白过大 */
.settings-dialog-body :deep(.settings-main-pane:has(.settings-actions)) {
  padding-bottom: var(--ds-space-8);
}

/* 二级分组页签：v2 的分段控件（sunken 轨道 + surface 选中块 + accent-text） */
.settings-dialog-body :deep(.settings-subtabs) {
  margin: 0 0 var(--ds-space-24);
}

.settings-dialog-body :deep(.settings-subtabs > .n-tabs-nav) {
  margin-bottom: 0;
}

.settings-dialog-body :deep(.settings-subtabs .n-tabs-rail) {
  display: flex;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  padding: 2px;
  background: var(--ds-bg-sunken);
  border-radius: var(--ds-radius-md);
}

.settings-dialog-body :deep(.settings-subtabs .n-tabs-capsule) {
  border-radius: var(--ds-radius-sm);
  background-color: var(--ds-bg-surface);
  box-shadow: var(--ds-elev-1);
}

.settings-dialog-body :deep(.settings-subtabs .n-tabs-tab) {
  flex: 0 0 auto;
  height: var(--ds-control-height-sm);
  padding: 0 var(--ds-space-16);
  font-size: var(--ds-text-body-size);
  color: var(--ds-text-muted);
}

.settings-dialog-body :deep(.settings-subtabs .n-tabs-tab.n-tabs-tab--active) {
  color: var(--ds-accent-text);
  font-weight: 600;
}

/* 左侧一级导航与二级页签已经说明当前页面：隐藏每个设置页重复的标题和描述，
   只保留在无障碍树里，页面直接从分组内容开始（与改版前一致）。 */
.settings-dialog-body :deep(.settings-page .settings-header) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

</style>

<style>
/* 全局样式：高亮类加到子页面（异步组件）的 DOM 上，scoped 样式作用不到 */
.settings-search-hit {
  outline: 2px solid var(--ds-accent);
  outline-offset: var(--ds-space-4);
  border-radius: var(--ds-radius-sm);
}
</style>
