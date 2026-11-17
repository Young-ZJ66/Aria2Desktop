<template>
  <div class="queue-view">
    <PageHeader class="page-head" :title="t('queue.title')" :description="t('queue.description')">
      <template #actions>
        <n-button size="small" :loading="refreshing" @click="refresh">
          {{ t('queue.refresh') }}
        </n-button>
      </template>
    </PageHeader>

    <!--
      指标带：三项都是「此刻有多少」的同一语义层级，并排成一排指标。
      v1 把「最大并发数」输入框塞进同一行——大数字与 28px 输入框基线永远对不齐，
      而且一个可编辑控件混在只读指标里，读起来像「最大并发数 = 5 个任务」。
    -->
    <UiPanel flush>
      <div class="metric-band">
        <div class="stat-cell">
          <UiStat :label="t('queue.activeCount')" :value="taskStore.activeTasks.length" />
        </div>
        <div class="stat-cell">
          <UiStat :label="t('queue.waitingCount')" :value="taskStore.waitingTasks.length" />
        </div>
        <div class="stat-cell">
          <UiStat :label="t('queue.totalSpeed')" :value="speedDisplay.value" :unit="speedDisplay.unit" />
        </div>
      </div>
    </UiPanel>

    <!--
      队列设置：并发数与重试策略都是「引擎行为开关」，归到同一面板；
      标签在上、控件在下，四个字段共用同一基线，控件统一 --ds-control-height-md。
    -->
    <UiPanel :title="t('queue.settings')" divided>
      <div class="settings-grid">
        <label class="setting">
          <span class="setting__label">{{ t('queue.maxConcurrent') }}</span>
          <n-input-number
            v-model:value="maxConcurrent"
            class="setting__control setting__control--number"
            :min="1"
            :max="16"
            @update:value="scheduleMaxConcurrent"
          />
        </label>

        <div class="setting">
          <span class="setting__label">{{ t('queue.retryEnabled') }}</span>
          <div class="setting__control">
            <n-switch
              v-model:value="retryEnabled"
              :aria-label="t('queue.retryEnabled')"
              @update:value="scheduleRetryPolicy"
            />
          </div>
        </div>

        <label class="setting">
          <span class="setting__label">{{ t('queue.retryMaxAttempts') }}</span>
          <n-input-number
            v-model:value="retryMaxAttempts"
            class="setting__control setting__control--number"
            :min="1"
            :max="20"
            :disabled="!retryEnabled"
            @update:value="scheduleRetryPolicy"
          />
        </label>

        <label class="setting">
          <span class="setting__label">{{ t('queue.retryDelaySeconds') }}</span>
          <n-input-number
            v-model:value="retryDelaySeconds"
            class="setting__control setting__control--number"
            :min="0"
            :max="3600"
            :disabled="!retryEnabled"
            @update:value="scheduleRetryPolicy"
          />
        </label>
      </div>
    </UiPanel>

    <!--
      队列表：按内容高度排布，不再把容器高度均摊给仅有的几行（v1 两行任务每行约 200px）。
      空态同样不撑满，留给「为什么是空的 + 现在能做什么」。
    -->
    <UiPanel flush>
      <div v-if="taskStore.waitingTasks.length > 0" class="queue-table-scroll">
        <n-table :bordered="false" class="queue-table">
          <thead>
            <tr>
              <th class="col-pos">{{ t('queue.position') }}</th>
              <th>{{ t('queue.taskName') }}</th>
              <th class="col-size">{{ t('queue.size') }}</th>
              <th class="col-actions">{{ t('queue.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(task, index) in taskStore.waitingTasks" :key="task.gid">
              <td class="col-pos ds-tnum">{{ index + 1 }}</td>
              <td class="col-name" :title="getTaskName(task)">{{ getTaskName(task) }}</td>
              <td class="col-size ds-tnum">{{ formatSize(task.totalLength) }}</td>
              <td class="col-actions">
                <div class="row-actions">
                  <UiIconButton
                    :icon="ArrowUpOutline"
                    size="sm"
                    :label="t('queue.moveTop')"
                    :disabled="index === 0"
                    @click="move(task.gid, 'top')"
                  />
                  <UiIconButton
                    :icon="ChevronUpOutline"
                    size="sm"
                    :label="t('queue.moveUp')"
                    :disabled="index === 0"
                    @click="move(task.gid, 'up')"
                  />
                  <UiIconButton
                    :icon="ChevronDownOutline"
                    size="sm"
                    :label="t('queue.moveDown')"
                    :disabled="index === taskStore.waitingTasks.length - 1"
                    @click="move(task.gid, 'down')"
                  />
                  <UiIconButton
                    :icon="ArrowDownOutline"
                    size="sm"
                    :label="t('queue.moveBottom')"
                    :disabled="index === taskStore.waitingTasks.length - 1"
                    @click="move(task.gid, 'bottom')"
                  />
                  <UiIconButton
                    :icon="TrashOutline"
                    size="sm"
                    tone="danger"
                    :label="t('queue.remove')"
                    @click="remove(task.gid)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </n-table>
      </div>

      <!-- 断连时队列同样被清空，空态要说明是「未连接」而不是「队列为空」 -->
      <UiEmpty v-else :icon="ListOutline" :title="emptyTitle" :description="emptyHint">
        <template #actions>
          <n-button v-if="isDisconnected" type="primary" size="small" @click="openConnectionDialog">
            {{ t('connection.connect') }}
          </n-button>
          <n-button v-else type="primary" size="small" @click="uiStore.openNewTask()">
            {{ t('task.newDownload') }}
          </n-button>
        </template>
      </UiEmpty>
    </UiPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import {
  ArrowDownOutline,
  ArrowUpOutline,
  ChevronDownOutline,
  ChevronUpOutline,
  ListOutline,
  TrashOutline
} from '@vicons/ionicons5'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'
import PageHeader from '@/components/layout/PageHeader.vue'
import { UiEmpty, UiIconButton, UiPanel, UiStat } from '@/components/ui'
import { runWithMinimumLoading } from '@/composables/useMinimumLoading'
import { getTaskName } from '@/utils/taskUtils'
import { formatSize } from '@/utils/taskFormatters'

const { t } = useI18n()
const message = useMessage()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()
const uiStore = useUiStore()

// 断连时队列会被清空，空态需说明是「未连接」并给出连接入口，而不是笼统的「队列为空」
const isDisconnected = computed(() => !connectionStore.isConnected)
const emptyTitle = computed(() =>
  isDisconnected.value ? t('settings.notConnectedTitle') : t('queue.empty')
)
const emptyHint = computed(() =>
  isDisconnected.value ? t('queue.disconnectedHint') : t('queue.emptyHint')
)

function openConnectionDialog(): void {
  connectionStore.showConnectionDialog = true
}

const maxConcurrent = ref(settingsStore.settings.download?.maxConcurrentDownloads ?? 5)
const retryEnabled = ref(settingsStore.settings.queue?.retryEnabled ?? false)
const retryMaxAttempts = ref(settingsStore.settings.queue?.retryMaxAttempts ?? 3)
const retryDelaySeconds = ref(settingsStore.settings.queue?.retryDelaySeconds ?? 30)
let concurrencyTimer: ReturnType<typeof setTimeout> | null = null
let retryPolicyTimer: ReturnType<typeof setTimeout> | null = null

function scheduleMaxConcurrent(value: number | null): void {
  if (!value) return
  if (concurrencyTimer) clearTimeout(concurrencyTimer)
  concurrencyTimer = setTimeout(() => {
    concurrencyTimer = null
    void applyMaxConcurrent(value)
  }, 500)
}

function scheduleRetryPolicy(): void {
  if (retryPolicyTimer) clearTimeout(retryPolicyTimer)
  retryPolicyTimer = setTimeout(() => {
    retryPolicyTimer = null
    void saveRetryPolicy()
  }, 500)
}

const totalDownloadSpeed = computed(() =>
  taskStore.activeTasks.reduce((sum, task) => sum + Number(task.downloadSpeed || 0), 0)
)

// formatSize 返回「1.5 MB」这种带单位的字符串：拆成数值 + 单位，数值走等宽数字、单位降级成小字
const speedDisplay = computed(() => {
  const formatted = formatSize(totalDownloadSpeed.value)
  const match = /^([\d.]+)\s*(.*)$/.exec(formatted)
  const unit = match?.[2]
  return {
    value: match?.[1] ?? formatted,
    unit: unit && unit.length > 0 ? `${unit}/s` : '/s'
  }
})

const refreshing = ref(false)

async function refresh(): Promise<void> {
  try {
    await runWithMinimumLoading(refreshing, () => taskStore.loadAllTasks())
  } catch (error) {
    message.error(String(error))
  }
}

async function applyMaxConcurrent(value: number | null): Promise<void> {
  if (!value) return
  try {
    await settingsStore.updateSetting('download', {
      ...settingsStore.settings.download,
      maxConcurrentDownloads: value
    })
    await connectionStore.service?.changeGlobalOption({
      'max-concurrent-downloads': String(value)
    })
  } catch (error) {
    message.error(String(error))
  }
}

async function saveRetryPolicy(): Promise<void> {
  try {
    await settingsStore.updateSetting('queue', {
      ...settingsStore.settings.queue,
      retryEnabled: retryEnabled.value,
      retryMaxAttempts: retryMaxAttempts.value ?? 3,
      retryDelaySeconds: retryDelaySeconds.value ?? 30
    })
  } catch (error) {
    message.error(String(error))
  }
}

async function move(gid: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<void> {
  try {
    await taskStore.moveInQueue(gid, direction)
  } catch (error) {
    message.error(String(error))
  }
}

async function remove(gid: string): Promise<void> {
  try {
    await taskStore.removeTask(gid, false)
  } catch (error) {
    message.error(String(error))
  }
}

// keep-alive 下首次挂载时 onMounted 与 onActivated 都会触发，用这个标记跳过第一次，
// 避免刚进页面就重复拉一遍
let activatedOnce = false

onMounted(() => {
  void refresh()
})

// 页面被 keep-alive 缓存，切回来时不会重新挂载：这里补一次静默刷新，
// 不走 refresh() 以免按钮转圈（最短 450ms 的加载态在切页时反而像在重新加载）
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  void taskStore.loadAllTasks().catch(() => {})
})

onBeforeUnmount(() => {
  if (concurrencyTimer) clearTimeout(concurrencyTimer)
  if (retryPolicyTimer) clearTimeout(retryPolicyTimer)
})
</script>

<style scoped>
.queue-view {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-16);
}

.metric-band {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--ds-space-24);
  padding: var(--ds-space-20);
}

/* 指标之间用发丝线分隔：三列并排时靠线读「这是三个独立数字」，靠留白读「这是同一组」 */
.stat-cell + .stat-cell {
  border-left: 1px solid var(--ds-border-subtle);
  padding-left: var(--ds-space-24);
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--ds-space-16) var(--ds-space-24);
  align-items: start;
}

/* 标签在上、控件在下：四个字段的标签行高一致，控件因此落在同一条基线上 */
.setting {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-6);
  min-width: 0;
}

.setting__label {
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 开关只有 22px 高，用等高容器把它对齐到和输入框同一条基线 */
.setting__control {
  display: flex;
  align-items: center;
  min-height: var(--ds-control-height-md);
}

.setting__control--number {
  width: 120px;
}

.queue-table-scroll {
  overflow-x: auto;
}

.queue-table :deep(table) {
  width: 100%;
  min-width: 560px;
  table-layout: fixed;
  border-collapse: collapse;
}

.queue-table :deep(th) {
  height: 36px;
  padding: 0 var(--ds-space-12);
  background: var(--ds-bg-sunken);
  color: var(--ds-text-muted);
  font-size: var(--ds-text-small-size);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--ds-border-subtle);
}

.queue-table :deep(td) {
  height: var(--ds-control-row-comfortable);
  padding: 0 var(--ds-space-12);
  color: var(--ds-text-base);
  font-size: var(--ds-text-body-size);
  border-bottom: 1px solid var(--ds-border-subtle);
  vertical-align: middle;
}

.queue-table :deep(tbody tr:last-child td) {
  border-bottom: none;
}

.queue-table :deep(tbody tr:hover td) {
  background: var(--ds-bg-hover);
}

/* 列宽固定：大小列右对齐收在操作列旁边，不再把「大小」推到页面最右侧 */
.queue-table :deep(.col-pos) {
  width: 56px;
  text-align: center;
}

.queue-table :deep(.col-size) {
  width: 96px;
  text-align: right;
}

.queue-table :deep(.col-actions) {
  width: 168px;
}

.queue-table :deep(.col-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--ds-space-2);
}

/* UiIconButton 的禁用态是 opacity .55 + 最淡的文字色，表格里几乎等于消失；
   队列首尾行的「置顶/置底」长期禁用，需要读得出「按钮还在、只是现在不能用」 */
.queue-table :deep(.row-actions .ui-icon-btn:disabled) {
  opacity: 1;
  color: var(--ds-text-faint);
  cursor: not-allowed;
}
</style>
