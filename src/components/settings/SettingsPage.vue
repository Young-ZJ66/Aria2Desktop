<template>
  <div class="settings-page" :class="{ 'settings-page--with-actions': showActions }">
    <div class="settings-header">
      <h2>{{ title }}</h2>
      <p v-if="description" class="settings-description">{{ description }}</p>
    </div>

    <DismissibleAlert
      v-if="showConnectAlert && !connected"
      storage-key="settings.connectAlert"
      :title="t('settings.notConnectedTitle')"
      type="warning"
      class="connect-alert"
    >
      {{ t('settings.notConnectedDesc') }}
    </DismissibleAlert>

    <n-spin :show="loading">
      <slot />
    </n-spin>

    <div v-if="showActions" class="settings-actions">
      <n-space>
        <n-button type="primary" :loading="saving" :disabled="disabled" @click="$emit('save')">
          {{ t('settings.save') }}
        </n-button>
        <n-button :loading="reloading" :disabled="disabled" @click="$emit('reload')">
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
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'

defineProps<{
  title: string
  description?: string
  showConnectAlert?: boolean
  connected?: boolean
  showActions?: boolean
  saving?: boolean
  /** 「重新加载」按钮自身的加载态：加载期间由全局样式把文字换成加载圈，按钮尺寸不变 */
  reloading?: boolean
  loading?: boolean
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
/* 页内仍是改版前的扁平结构：标题下方一条细线，分组靠留白与分隔线区分，不用卡片 */
.settings-page {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: var(--ds-space-2) 0 var(--ds-space-10);
}

.settings-page.settings-page--with-actions {
  padding-bottom: var(--ds-space-16);
}

.settings-header {
  margin-bottom: 18px;
  padding-bottom: var(--ds-space-12);
  border-bottom: 1px solid var(--ds-border-subtle);
}

.settings-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ds-text-strong);
}

.settings-description {
  margin: var(--ds-space-6) 0 0;
  color: var(--ds-text-muted);
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  max-width: 68ch;
}

.connect-alert {
  margin-bottom: var(--ds-space-16);
}

/* 底部操作：与改版前一致，居中排列，靠一条分隔线与表单分开 */
.settings-actions {
  display: flex;
  justify-content: center;
  gap: var(--ds-space-12);
  margin-top: var(--ds-space-24);
  padding-top: 18px;
  border-top: 1px solid var(--ds-border-subtle);
}

</style>

<style>
/* 设置页控件统一占满卡片可用宽度：输入框、选择框和数字框的左右边缘保持一致，
   避免同一表单里短数字框和长文本框参差排布 */
.settings-page .n-input:not(.n-input-group .n-input):not(.n-input--textarea):not(.n-input-number .n-input),
.settings-page .n-select,
.settings-page .n-input-number {
  width: 100%;
}

/* 数字输入框内部输入框填满外层容器 */
.settings-page .n-input-number .n-input {
  width: 100%;
}

.settings-page .n-input--textarea {
  width: 100%;
}

/* 分组输入框（文件选择按钮等）整体占满可用宽度，内部元素自动伸缩 */
.settings-page .n-input-group {
  width: 100%;
}

.settings-page .n-input-group .n-input,
.settings-page .n-input-group .n-input-number,
.settings-page .n-input-group .n-select {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
}

/* 统一设置项之间的垂直间距，使用改版前的 24px 行距 */
.settings-page .n-form-item {
  margin-bottom: var(--ds-space-24);
}

/* 控件尺寸统一：表单行内的输入框 / 选择器 / 数字框统一为 md 控件高度，
   行内垂直居中由外壳的 160px + 1fr 栅格负责。textarea 与工具条里的 size="small"
   紧凑控件不受影响（工具条本来就该比表单行更矮）。 */
.settings-page .n-form-item .n-input:not(.n-input--textarea),
.settings-page .n-form-item .n-select,
.settings-page .n-form-item .n-input-number {
  --n-height: var(--ds-control-height-md);
  height: var(--ds-control-height-md);
}

/* 设置分组：透明、无边框，和改版前一样用一条分隔线连接 */
.settings-page .setting-group.n-card {
  margin: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.settings-page .setting-group + .setting-group {
  margin-top: var(--ds-space-20);
  padding-top: var(--ds-space-20);
  border-top: 1px solid var(--ds-border-subtle);
}

.settings-page .setting-group .n-card-header {
  padding: 0 0 var(--ds-space-10);
}

.settings-page .setting-group .n-card-header__main {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ds-text-strong);
}

.settings-page .setting-group .n-card__content {
  padding: 0;
}

.settings-page .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
