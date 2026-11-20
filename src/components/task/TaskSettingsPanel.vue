<template>
  <div class="task-settings">
    <n-alert v-if="disabled" type="info" :bordered="false" class="task-settings__alert">
      {{ t('taskDetail.taskSettingsUnavailable') }}
    </n-alert>

    <n-spin :show="loading">
      <n-form label-placement="left" label-width="auto" label-align="left" :disabled="disabled || saving">
        <n-form-item :label="t('newTask.maxDownloadLimit')">
          <n-input-number v-model:value="form.maxDownloadLimitKB" :min="0" :precision="0" style="width: 100%">
            <template #suffix>KB/s</template>
          </n-input-number>
        </n-form-item>

        <n-form-item :label="t('newTask.maxUploadLimit')">
          <n-input-number v-model:value="form.maxUploadLimitKB" :min="0" :precision="0" style="width: 100%">
            <template #suffix>KB/s</template>
          </n-input-number>
        </n-form-item>

        <n-form-item :label="t('newTask.maxConnectionPerServer')">
          <n-input-number
            v-model:value="form.maxConnectionPerServer"
            :min="1"
            :max="MAX_CONNECTION_PER_SERVER_LIMIT"
            :precision="0"
            style="width: 100%"
          />
        </n-form-item>

        <n-form-item :label="t('newTask.allProxy')">
          <n-input v-model:value="form.allProxy" clearable :placeholder="t('newTask.proxyPlaceholder')" />
        </n-form-item>
      </n-form>

      <p class="task-settings__hint">{{ t('taskDetail.taskSettingsUnlimitedHint') }}</p>
      <p class="task-settings__hint">{{ t('taskDetail.taskSettingsHint') }}</p>

      <div class="task-settings__actions">
        <n-button :disabled="saving" @click="load">{{ t('common.refresh') }}</n-button>
        <n-button type="primary" :loading="saving" :disabled="disabled" @click="save">
          {{ t('common.save') }}
        </n-button>
      </div>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import { taskSourceService } from '@/services/taskSourceService'
import type { Aria2Option, Aria2Task } from '@/types/aria2'
import {
  EMPTY_TASK_SETTINGS_FORM,
  MAX_CONNECTION_PER_SERVER_LIMIT,
  buildTaskOptions,
  mergeTaskSourceOptions,
  parseTaskSettings,
  type TaskSettingsForm
} from './taskSettingsOptions'

/**
 * D-23 任务设置面板。
 *
 * 为什么放在详情抽屉里而不是只在新建任务表单里：单任务限速、每服务器连接数、
 * 任务代理在下载过程中经常需要临时调整（某个任务抢满带宽、某个源必须走代理）。
 * aria2 支持对运行中的任务调用 changeOption 立即生效，但此前界面没有任何入口，
 * 用户只能删掉任务重下。
 *
 * 双写策略：
 * 1. changeOption 让当前任务立即生效；
 * 2. 同时把选项合并进 taskSourceService 的来源记录——重试（retryErrorTask）
 *    会读取这份记录，因此重启后重新添加的任务仍然带着同样的设置。
 */

interface Props {
  /** 任务 gid */
  gid: string
  /** 任务对象：用于在缺少来源记录时构造可持久化的来源 */
  task: Aria2Task | null
}

const props = defineProps<Props>()

const { t } = useI18n()
const connectionStore = useConnectionStore()

const loading = ref(false)
const saving = ref(false)
const form = ref<TaskSettingsForm>({ ...EMPTY_TASK_SETTINGS_FORM })

/** 已完成/已移除的任务取不到 option，展示只读提示而不是空白表单 */
const disabled = ref(false)

async function load() {
  const service = connectionStore.service
  if (!service || !props.gid) return
  loading.value = true
  try {
    form.value = parseTaskSettings(await service.getOption(props.gid))
    disabled.value = false
  } catch (error) {
    disabled.value = true
    console.warn('读取任务设置失败:', error)
  } finally {
    loading.value = false
  }
}

/** 把本次修改合并进来源记录，供重试时复用（重启后依旧生效） */
function persistOptions(options: Aria2Option) {
  try {
    const record = taskSourceService.get(props.gid)
    const merged = mergeTaskSourceOptions(record?.options, options)
    if (record) {
      taskSourceService.record(props.gid, record.source, merged)
      return
    }
    // 没有来源记录（例如外部添加的任务）：尽量从任务自身还原一个可重试的来源
    const uris = (props.task?.files || [])
      .flatMap(file => (file.uris || []).map(item => item.uri))
      .filter(Boolean)
    if (uris.length > 0) {
      taskSourceService.record(props.gid, { kind: 'uri', uris }, merged)
      return
    }
    const infoHash = props.task?.infoHash
    if (infoHash) {
      taskSourceService.record(
        props.gid,
        { kind: 'uri', uris: [`magnet:?xt=urn:btih:${infoHash}`] },
        merged
      )
    }
  } catch (error) {
    console.warn('保存任务设置到来源记录失败:', error)
  }
}

async function save() {
  const service = connectionStore.service
  if (!service || !props.gid) return

  const options = buildTaskOptions(form.value)
  saving.value = true
  try {
    await service.changeOption(props.gid, options)
    persistOptions(options)
    message.success(t('taskDetail.taskSettingsSaved'))
  } catch (error) {
    console.error('修改任务设置失败:', error)
    message.error(
      t('taskDetail.taskSettingsSaveFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
    )
  } finally {
    saving.value = false
  }
}

watch(
  () => props.gid,
  gid => {
    if (gid) void load()
  },
  { immediate: true }
)
</script>

<style scoped>
.task-settings {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-12);
  padding-bottom: var(--ds-space-16);
}

.task-settings__alert {
  margin-bottom: var(--ds-space-4);
}

.task-settings__hint {
  margin: 0;
  font-size: var(--ds-text-micro-size);
  color: var(--ds-text-faint);
  line-height: 1.6;
}

.task-settings__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ds-space-8);
  margin-top: var(--ds-space-8);
}
</style>
