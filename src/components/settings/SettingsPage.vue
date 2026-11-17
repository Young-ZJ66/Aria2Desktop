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

const props = defineProps<{
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
/* 与 SettingsDialog 外壳保持一致：宽度交给弹窗内容区，页面自身不再限宽 */
.settings-page {
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  padding: var(--ds-space-2) 0 var(--ds-space-4);
}

/* 带底部操作栏的页面：给悬浮栏留出高度，否则滚动时最后一行会被浮条压住。
   悬浮栏约 56px（按钮 34 + 内边距/阴影），多留一点余量。 */
.settings-page.settings-page--with-actions {
  padding-bottom: var(--ds-space-24);
}

.settings-header {
  margin-bottom: var(--ds-space-20);
  padding-bottom: 0;
  border-bottom: 0;
}

.settings-header h2 {
  margin: 0;
  font-size: var(--ds-text-h1-size);
  line-height: var(--ds-text-h1-leading);
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--ds-text-strong);
}

.settings-description {
  margin: var(--ds-space-6) 0 0;
  color: var(--ds-text-muted);
  font-size: var(--ds-text-body-size);
  line-height: var(--ds-text-body-leading);
  max-width: 68ch;
}

.connect-alert {
  margin-bottom: var(--ds-space-16);
}

/* 吸底操作条：数值与 SettingsDialog 外壳一致，避免两处规则互相覆盖时视觉跳动 */
.settings-actions {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  margin-top: var(--ds-space-16);
  padding: var(--ds-space-12) 0;
  border-top: 1px solid var(--ds-border-subtle);
  background: var(--ds-bg-raised);
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

/* 统一设置项之间的垂直间距。数值与 SettingsDialog 的 160px/1fr 表单栅格一致，
   两处规则谁生效结果都相同，避免出现 12px 与 24px 打架 */
.settings-page .n-form-item {
  margin-bottom: var(--ds-space-12);
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

/* 设置分组改为扁平小节：去掉一层层白卡边框/阴影，用标题与分隔线建立层级。
   弹窗本身已是白色表面，卡片套卡片会产生过多边框和无效留白。 */
.settings-page .setting-group.n-card {
  margin-bottom: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.settings-page .setting-group.n-card + .setting-group.n-card {
  margin-top: var(--ds-space-20);
  padding-top: var(--ds-space-16);
  border-top: 1px solid var(--ds-border-subtle);
}

.settings-page .setting-group .n-card-header {
  padding: 0 0 var(--ds-space-8);
}

/* 分组标题：比正文强半级、比页标题弱一级。此前用 12px 弱化色，
   与 20px 页标题之间出现断层，整页只剩一堆漂浮的表单行。 */
.settings-page .setting-group .n-card-header__main {
  font-size: var(--ds-text-body-size);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ds-text-regular);
}

.settings-page .setting-group .n-card__content {
  padding: 0;
}

.settings-page .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
