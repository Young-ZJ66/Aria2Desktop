<template>
  <div class="settings-page">
    <div class="settings-header">
      <h2>{{ title }}</h2>
      <p v-if="description" class="settings-description">{{ description }}</p>
    </div>

    <n-alert
      v-if="showConnectAlert && !connected"
      :title="t('settings.notConnectedTitle')"
      type="warning"
      :bordered="false"
      class="connect-alert"
    >
      {{ t('settings.notConnectedDesc') }}
    </n-alert>

    <slot />

    <div v-if="showActions" class="settings-actions">
      <n-space>
        <n-button type="primary" :loading="saving" :disabled="disabled" @click="$emit('save')">
          {{ t('settings.save') }}
        </n-button>
        <n-button :disabled="disabled" @click="$emit('reload')">
          {{ t('settings.reload') }}
        </n-button>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button :disabled="disabled" @click="$emit('reset')">
              {{ t('settings.restoreDefaults') }}
            </n-button>
          </template>
          {{ t('settings.restoreDefaultsTip') }}
        </n-tooltip>
      </n-space>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  title: string
  description?: string
  showConnectAlert?: boolean
  connected?: boolean
  showActions?: boolean
  saving?: boolean
  disabled?: boolean
}>()

defineEmits<{
  (e: 'save'): void
  (e: 'reload'): void
  (e: 'reset'): void
}>()

const { t } = useI18n()
</script>

<style scoped>
.settings-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 4px 0 8px;
}

.settings-header {
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-light);
}

.settings-header h2 {
  margin: 0 0 6px 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.connect-alert {
  margin-bottom: 16px;
}

.settings-actions {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: center;
}
</style>

<style>
/* 统一设置页控件宽度：单行输入框/数字框/选择框/文本域统一为 80%，与标签列形成均衡布局 */
.settings-page .n-input:not(.n-input-group .n-input):not(.n-input--textarea):not(.n-input-number .n-input),
.settings-page .n-input-number,
.settings-page .n-select {
  width: 80%;
}

/* 数字输入框内部输入框填满外层容器，避免 80% × 80% 导致内部宽度缩小 */
.settings-page .n-input-number .n-input {
  width: 100%;
}

.settings-page .n-input--textarea {
  width: 80%;
}

/* 分组输入框（文件选择按钮等）整体 80%，内部元素自动伸缩 */
.settings-page .n-input-group {
  width: 80%;
}

.settings-page .n-input-group .n-input,
.settings-page .n-input-group .n-input-number,
.settings-page .n-input-group .n-select {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
}

/* 统一设置项之间的垂直间距，保证输入框/选择框行之间不紧贴 */
.settings-page .n-form-item {
  margin-bottom: 24px;
}

.settings-page .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
