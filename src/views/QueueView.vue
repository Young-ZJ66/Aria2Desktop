<template>
  <div class="queue-view">
    <PageHeader :title="t('queue.title')" :description="t('queue.description')">
      <template #actions>
        <n-button size="small" :loading="taskStore.isLoading" @click="refresh">
          {{ t('queue.refresh') }}
        </n-button>
      </template>
    </PageHeader>

    <n-card :bordered="false" class="queue-card">

      <n-grid :cols="4" :x-gap="12" :y-gap="12" responsive="screen" item-responsive>
        <n-grid-item span="1 s:1 m:1 l:1">
          <n-statistic :label="t('queue.activeCount')" :value="taskStore.activeTasks.length" />
        </n-grid-item>
        <n-grid-item span="1 s:1 m:1 l:1">
          <n-statistic :label="t('queue.waitingCount')" :value="taskStore.waitingTasks.length" />
        </n-grid-item>
        <n-grid-item span="1 s:1 m:1 l:1">
          <n-statistic :label="t('queue.totalSpeed')" :value="formatSpeed(totalDownloadSpeed)" />
        </n-grid-item>
        <n-grid-item span="1 s:1 m:1 l:1">
          <n-form-item :label="t('queue.maxConcurrent')" :show-feedback="false" class="concurrency-field">
            <n-input-number
              v-model:value="maxConcurrent"
              size="small"
              :min="1"
              :max="16"
              @update:value="scheduleMaxConcurrent"
            />
          </n-form-item>
        </n-grid-item>
      </n-grid>

      <n-divider />

      <div class="retry-panel">
        <n-switch v-model:value="retryEnabled" size="small" @update:value="scheduleRetryPolicy" />
        <span class="retry-label">{{ t('queue.retryEnabled') }}</span>
        <n-input-number
          v-model:value="retryMaxAttempts"
          size="small"
          :min="1"
          :max="20"
          :disabled="!retryEnabled"
          @update:value="scheduleRetryPolicy"
        />
        <span class="retry-hint">{{ t('queue.retryMaxAttempts') }}</span>
        <n-input-number
          v-model:value="retryDelaySeconds"
          size="small"
          :min="0"
          :max="3600"
          :disabled="!retryEnabled"
          @update:value="scheduleRetryPolicy"
        />
        <span class="retry-hint">{{ t('queue.retryDelaySeconds') }}</span>
      </div>

      <n-table :bordered="false" size="small" class="queue-table">
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
            <td class="col-pos">{{ index + 1 }}</td>
            <td class="task-name" :title="getTaskName(task)">{{ getTaskName(task) }}</td>
            <td class="col-size">{{ formatSize(task.totalLength) }}</td>
            <td class="col-actions">
              <n-space :size="4" justify="end">
                <n-button size="tiny" secondary :disabled="index === 0" @click="move(task.gid, 'top')">
                  {{ t('queue.moveTop') }}
                </n-button>
                <n-button size="tiny" secondary :disabled="index === 0" @click="move(task.gid, 'up')">
                  {{ t('queue.moveUp') }}
                </n-button>
                <n-button size="tiny" secondary :disabled="index === taskStore.waitingTasks.length - 1" @click="move(task.gid, 'down')">
                  {{ t('queue.moveDown') }}
                </n-button>
                <n-button size="tiny" secondary :disabled="index === taskStore.waitingTasks.length - 1" @click="move(task.gid, 'bottom')">
                  {{ t('queue.moveBottom') }}
                </n-button>
                <n-button size="tiny" secondary type="error" @click="remove(task.gid)">
                  {{ t('queue.remove') }}
                </n-button>
              </n-space>
            </td>
          </tr>
          <tr v-if="taskStore.waitingTasks.length === 0">
            <td colspan="4" class="empty-row">{{ t('queue.empty') }}</td>
          </tr>
        </tbody>
      </n-table>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import PageHeader from '@/components/layout/PageHeader.vue'
import { getTaskName } from '@/utils/taskUtils'
import { formatSize, formatSpeed } from '@/utils/taskFormatters'

const { t } = useI18n()
const message = useMessage()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()

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

async function refresh(): Promise<void> {
  try {
    await taskStore.loadAllTasks()
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

onMounted(() => {
  void refresh()
})

onBeforeUnmount(() => {
  if (concurrencyTimer) clearTimeout(concurrencyTimer)
  if (retryPolicyTimer) clearTimeout(retryPolicyTimer)
})
</script>

<style scoped>
.queue-card {
  border-radius: 10px;
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-light);
}
.concurrency-field {
  padding-top: 6px;
}
.retry-panel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.retry-label {
  font-size: 13px;
  font-weight: 500;
}
.retry-hint {
  font-size: 12px;
  opacity: 0.65;
}
.queue-table {
  margin-top: 4px;
}
.col-pos {
  width: 64px;
  text-align: center;
}
.col-size {
  width: 110px;
  white-space: nowrap;
}
.col-actions {
  width: 340px;
}
.task-name {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-row {
  text-align: center;
  padding: 32px 0;
  opacity: 0.6;
}
</style>
