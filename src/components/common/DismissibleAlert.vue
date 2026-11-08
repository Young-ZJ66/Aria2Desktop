<template>
  <n-alert
    v-if="visible"
    :type="type"
    :bordered="bordered"
    :show-icon="showIcon"
    :title="title"
    closable
    class="dismissible-alert"
    @close="closeForSession"
  >
    <div class="dismissible-alert-content">
      <div class="dismissible-alert-message">
        <slot />
      </div>
      <n-button
        v-if="showForever"
        class="dismissible-alert-forever"
        text
        size="tiny"
        @click="hideForever"
      >
        {{ t('common.dontShowAgain') }}
      </n-button>
    </div>
  </n-alert>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  /** 唯一标识：用于保存普通关闭（sessionStorage）与不再显示（localStorage）状态 */
  storageKey: string
  type?: 'default' | 'info' | 'success' | 'warning' | 'error'
  title?: string
  showIcon?: boolean
  bordered?: boolean
  /** 是否提供「不再显示」；动态错误提示可只保留普通关闭 */
  showForever?: boolean
}>(), {
  type: 'info',
  title: undefined,
  showIcon: true,
  bordered: false,
  showForever: true
})

const { t } = useI18n()

/** 存储不可用（隐私模式等）时按未关闭处理，不影响页面功能 */
function readFlag(storage: Storage | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === '1'
  } catch {
    return false
  }
}

const sessionKey = `${props.storageKey}.session`
const foreverKey = `${props.storageKey}.forever`
const visible = ref(!readFlag(sessionStorage, sessionKey) && !readFlag(localStorage, foreverKey))

function closeForSession() {
  visible.value = false
  try {
    sessionStorage.setItem(sessionKey, '1')
  } catch { /* sessionStorage 不可用时仅本次页面实例生效 */ }
}

function hideForever() {
  visible.value = false
  try {
    localStorage.setItem(foreverKey, '1')
  } catch { /* localStorage 不可用时仅本次页面实例生效 */ }
}
</script>

<style scoped>
/* 说明文字占满剩余宽度，「不再显示」固定在右侧，与右上角关闭按钮互不遮挡 */
.dismissible-alert-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.dismissible-alert-message {
  flex: 1;
  min-width: 0;
}

.dismissible-alert-forever {
  flex: none;
  margin-top: 1px;
  color: var(--text-secondary);
}

.dismissible-alert-forever:hover {
  color: var(--color-primary);
}
</style>
