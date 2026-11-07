<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="t('app.settings')"
    :bordered="false"
    :mask-closable="true"
    :auto-focus="false"
    style="width: 900px;"
    content-style="padding: 0;"
  >
    <div ref="bodyRef" class="settings-dialog-body">
      <!-- 设置项模糊搜索：跨页签按名称/说明匹配，点击结果直接跳转并高亮 -->
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
            v-for="item in searchResults"
            :key="item.id"
            type="button"
            class="settings-search-item"
            @mousedown.prevent
            @click="jumpTo(item)"
          >
            <span class="settings-search-label">{{ item.label }}</span>
            <span class="settings-search-tab">{{ item.tabLabel }}</span>
          </button>
          <div v-if="searchPending" class="settings-search-empty">
            {{ t('settings.searchLoading') }}
          </div>
          <div v-else-if="searchResults.length === 0" class="settings-search-empty">
            {{ t('settings.searchNoResult') }}
          </div>
        </div>
      </div>

      <n-tabs
        v-model:value="activeTab"
        type="line"
        placement="left"
        animated
        size="medium"
        pane-style="padding: 0 16px 0 20px;"
      >
        <n-tab-pane :display-directive="paneDirective('general')" name="general" :tab="t('nav.generalSettings')">
          <GeneralSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('engine')" name="engine" :tab="t('nav.engineSettings')">
          <EngineSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('download')" name="download" :tab="t('nav.downloadSettings')">
          <DownloadSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('network')" name="network" :tab="t('nav.networkSettings')">
          <NetworkSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('protocol')" name="protocol" :tab="t('nav.protocolSettings')">
          <ProtocolSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('bt')" name="bt" :tab="t('nav.btSettings')">
          <BtSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('metalink')" name="metalink" :tab="t('nav.metalinkSettings')">
          <MetalinkSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('components')" name="components" :tab="t('nav.componentSettings')">
          <ComponentSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('plugins')" name="plugins" :tab="t('nav.pluginSettings')">
          <PluginSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('rpc-security')" name="rpc-security" :tab="t('nav.rpcSecuritySettings')">
          <RpcSecuritySettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('advanced')" name="advanced" :tab="t('nav.advancedSettings')">
          <AdvancedSettings />
        </n-tab-pane>
        <n-tab-pane :display-directive="paneDirective('diagnostics')" name="diagnostics" :tab="t('nav.diagnostics')">
          <DiagnosticsSettings />
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
  advanced: () => import('@/views/settings/AdvancedSettings.vue'),
  diagnostics: () => import('@/views/settings/DiagnosticsSettings.vue')
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
const AdvancedSettings = defineAsyncComponent(settingsLoaders.advanced)
const DiagnosticsSettings = defineAsyncComponent(settingsLoaders.diagnostics)

const uiStore = useUiStore()
const connectionStore = useConnectionStore()
const { t, locale } = useI18n()

const activeTab = computed({
  get: () => uiStore.settingsTab,
  set: (value: string) => { uiStore.settingsTab = value }
})

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

/** 顺序必须与模板中 n-tab-pane 的声明顺序一致（搜索索引按 DOM 顺序映射页签） */
const BASE_TABS: Array<{ name: string; labelKey: string }> = [
  { name: 'general', labelKey: 'nav.generalSettings' },
  { name: 'engine', labelKey: 'nav.engineSettings' },
  { name: 'download', labelKey: 'nav.downloadSettings' },
  { name: 'network', labelKey: 'nav.networkSettings' },
  { name: 'protocol', labelKey: 'nav.protocolSettings' },
  { name: 'bt', labelKey: 'nav.btSettings' },
  { name: 'metalink', labelKey: 'nav.metalinkSettings' },
  { name: 'components', labelKey: 'nav.componentSettings' },
  { name: 'plugins', labelKey: 'nav.pluginSettings' }
]
const EXTRA_TABS: Array<{ name: string; labelKey: string }> = [
  { name: 'rpc-security', labelKey: 'nav.rpcSecuritySettings' },
  { name: 'advanced', labelKey: 'nav.advancedSettings' },
  { name: 'diagnostics', labelKey: 'nav.diagnostics' }
]

const tabNames = computed(() => [...BASE_TABS, ...EXTRA_TABS].map(tab => tab.name))

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

function tabLabelOf(name: string): string {
  const meta = [...BASE_TABS, ...EXTRA_TABS].find(tab => tab.name === name)
  return meta ? t(meta.labelKey) : ''
}

/**
 * 重建索引：每个 n-form-item 取标签 + 整行文本（含说明/提示），卡片标题也纳入。
 * 建索引前所有页签都已挂载（见 ensureSearchIndex），因此隐藏页的项也能被搜索到。
 */
function rebuildSearchIndex() {
  const body = bodyRef.value
  if (!body) return
  const panes = [...body.querySelectorAll<HTMLElement>('.n-tabs .n-tab-pane')]
  const names = tabNames.value
  const entries: SearchEntry[] = []
  searchElementRefs.clear()

  panes.forEach((pane, paneIndex) => {
    const tabName = names[paneIndex]
    if (!tabName) return
    const tabLabel = tabLabelOf(tabName)
    // 页签名本身参与匹配（S1）：搜"工具与扩展"这类页签名此前会零结果，
    // 因为索引只收表单项 label 与卡片标题，不含页签名
    entries.push({
      id: `${tabName}-tab`,
      label: tabLabel,
      tabName,
      tabLabel,
      searchText: tabLabel.toLowerCase()
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
  activeTab.value = entry.tabName
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
.settings-dialog-body {
  height: 70vh;
  max-height: 70vh;
  overflow: hidden;
  padding: 4px 0 16px 16px;
  display: flex;
  flex-direction: column;
}

/* 搜索框固定在页签上方，结果面板浮在内容之上。
   左内边距为 0：滚动容器本身已有 16px 左内边距，再加会左右不对称 */
.settings-search {
  position: relative;
  z-index: 2;
  flex: none;
  padding: 0 16px 8px 0;
}

.settings-search-panel {
  position: absolute;
  top: calc(100% - 2px);
  left: 16px;
  right: 16px;
  max-height: 300px;
  overflow-y: auto;
  padding: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.settings-search-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.settings-search-item:hover {
  background: var(--bg-tertiary);
}

.settings-search-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text-primary);
}

.settings-search-tab {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-secondary);
  font-size: 11px;
  color: var(--text-secondary);
}

.settings-search-empty {
  padding: 10px 9px;
  font-size: 12px;
  color: var(--text-secondary);
}

/* 左侧标签栏固定不动，仅右侧内容区独立滚动 */
.settings-dialog-body :deep(.n-tabs) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.settings-dialog-body :deep(.n-tabs .n-tab-pane) {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>

<style>
/* 全局样式：高亮类加到子页面（异步组件）的 DOM 上，scoped 样式作用不到 */
.settings-search-hit {
  outline: 2px solid var(--color-primary);
  outline-offset: 4px;
  border-radius: 6px;
}
</style>
