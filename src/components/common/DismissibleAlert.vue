<template>
  <n-alert
    v-if="visible"
    :type="type"
    :bordered="bordered"
    :show-icon="showIcon"
    :title="title"
    class="dismissible-alert"
    :class="{ 'dismissible-alert--has-forever': showForever }"
  >
    <div class="dismissible-alert-row">
      <div class="dismissible-alert-message">
        <slot />
      </div>
      <!-- 「不再显示」与关闭按钮放在同一行右侧，不再靠绝对定位对齐关闭叉 -->
      <div class="dismissible-alert-actions">
        <n-button
          v-if="showForever"
          class="dismissible-alert-forever"
          text
          size="tiny"
          @click="hideForever"
        >
          {{ t('common.dontShowAgain') }}
        </n-button>
        <n-button
          class="dismissible-alert-close"
          text
          size="tiny"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          @click="closeForSession"
        >
          <template #icon>
            <n-icon><CloseOutline /></n-icon>
          </template>
        </n-button>
      </div>
    </div>
  </n-alert>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloseOutline } from '@vicons/ionicons5'

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
/* 提示正文与右侧操作组同一行排布：操作组始终贴右，正文换行不会把按钮挤走 */
.dismissible-alert-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.dismissible-alert-message {
  flex: 1 1 auto;
  min-width: 0;
}

.dismissible-alert-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  /* 与 Naive UI 关闭叉原来距顶部的距离保持一致 */
  margin-top: -2px;
}

.dismissible-alert-forever {
  height: 20px;
  padding: 0 4px;
  line-height: 20px;
  white-space: nowrap;
  /* 提示条底色是 #edf5fe，--text-secondary(#6b7280) 在此只有 4.4:1；
     改用正文级颜色后达到 7:1 以上 */
  color: var(--text-regular);
}

.dismissible-alert-forever:hover {
  color: var(--color-primary-text);
}

.dismissible-alert-close {
  width: 20px;
  height: 20px;
  color: var(--text-regular);
}

.dismissible-alert-close:hover {
  color: var(--color-primary-text);
}
</style>
