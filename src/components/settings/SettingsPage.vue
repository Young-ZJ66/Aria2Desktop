<template>
  <div ref="pageRef" class="settings-page">
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

    <div v-if="showActions" ref="actionsRef" class="settings-actions">
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

    <!-- 悬浮操作按钮：仅当页面内容超出滚动区域、未到达底部时显示 -->
    <div class="float-actions-anchor">
      <transition name="float-actions">
        <div v-if="showActions && showFloatActions" class="float-actions-bar">
          <div class="float-actions-bar__inner">
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
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'

const props = defineProps<{
  title: string
  description?: string
  showConnectAlert?: boolean
  connected?: boolean
  showActions?: boolean
  saving?: boolean
  loading?: boolean
  disabled?: boolean
}>()

defineEmits<{
  (e: 'save'): void
  (e: 'reload'): void
  (e: 'reset'): void
}>()

const { t } = useI18n()

const pageRef = ref<HTMLElement | null>(null)
const actionsRef = ref<HTMLElement | null>(null)
const showFloatActions = ref(false)
let scrollContainer: HTMLElement | null = null
let actionsObserver: IntersectionObserver | null = null

// 向上查找最近的滚动容器（兼容路由页面与设置对话框两种承载方式）
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node
    node = node.parentElement
  }
  return null
}

onMounted(() => {
  if (props.showActions && pageRef.value && actionsRef.value) {
    scrollContainer = findScrollContainer(pageRef.value)
    if (scrollContainer) {
      // 捕获为局部常量：闭包里 TS 无法保证外部 let 变量仍非空
      const container = scrollContainer
      // 底部操作按钮不可见时显示悬浮栏；一旦按钮进入视口（含到达底部）立即隐藏，避免下滑闪烁
      actionsObserver = new IntersectionObserver(([entry]) => {
        if (!entry) return
        const scrollable = container.scrollHeight > container.clientHeight + 4
        showFloatActions.value = scrollable && !entry.isIntersecting
      }, { root: container, threshold: 0 })
      actionsObserver.observe(actionsRef.value)
    }
  }
})

onBeforeUnmount(() => {
  actionsObserver?.disconnect()
  actionsObserver = null
})
</script>

<style scoped>
.settings-page {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 2px 0 10px;
}

.settings-header {
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}

.settings-header h2 {
  margin: 0 0 5px 0;
  font-size: 18px;
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
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: center;
}

/* 悬浮操作按钮栏：零高度锚点吸附在滚动区底部，按钮在锚点内绝对定位。
   这样到达底部时悬浮栏只会就地淡出，而不会被推到操作按钮下方造成闪烁 */
.float-actions-anchor {
  position: sticky;
  bottom: 16px;
  height: 0;
  z-index: 10;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.float-actions-bar {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100vw - 48px);
  pointer-events: auto;
  padding: 12px 0 2px;
}

.float-actions-bar__inner {
  padding: 8px 14px;
  border-radius: 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
}

.float-actions-bar__inner :deep(.n-space) {
  flex-wrap: nowrap;
}

.float-actions-bar__inner :deep(.n-button) {
  white-space: nowrap;
}

.float-actions-enter-active,
.float-actions-leave-active {
  transition: opacity 0.15s ease;
}

.float-actions-enter-from,
.float-actions-leave-to {
  opacity: 0;
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

/* 统一设置项之间的垂直间距，保证输入框/选择框行之间不紧贴 */
.settings-page .n-form-item {
  margin-bottom: 24px;
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
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-light);
}

.settings-page .setting-group .n-card-header {
  padding: 0 0 10px;
}

.settings-page .setting-group .n-card-header__main {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-page .setting-group .n-card__content {
  padding: 0;
}

.settings-page .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
