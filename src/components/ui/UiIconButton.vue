<template>
  <n-tooltip :delay="500" :disabled="!label">
    <template #trigger>
      <button
        type="button"
        class="ui-icon-btn"
        :class="[`ui-icon-btn--${size}`, `ui-icon-btn--${tone}`, { 'is-active': active }]"
        :aria-label="label"
        :aria-pressed="active ? 'true' : undefined"
        :title="label"
        :disabled="disabled"
        @click="emit('click', $event)"
      >
        <n-icon :size="size === 'sm' ? 15 : 17">
          <component :is="icon" />
        </n-icon>
      </button>
    </template>
    {{ label }}
  </n-tooltip>
</template>

<script setup lang="ts">
import { NIcon, NTooltip } from 'naive-ui'
import type { Component } from 'vue'

/**
 * 图标按钮：label 是必填的。
 *
 * v1 的图标按钮只写了原生 title（部分连 title 都没有），读屏完全读不出用途——
 * 侧栏 5 个底部控件 aria-label 全空就是这么来的。把 label 设为必填参数后，
 * title 与 aria-label 由组件统一补齐，调用方想漏都漏不掉。
 */
withDefaults(
  defineProps<{
    /** 无障碍名称，同时作为 tooltip 文案 */
    label: string
    icon: Component
    size?: 'sm' | 'md'
    tone?: 'default' | 'danger' | 'accent'
    active?: boolean
    disabled?: boolean
  }>(),
  { size: 'md', tone: 'default', active: false, disabled: false }
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()
</script>

<style scoped>
.ui-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--ds-radius-md);
  background: transparent;
  color: var(--ds-text-muted);
  cursor: pointer;
  transition:
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.ui-icon-btn--sm {
  width: 26px;
  height: 26px;
  border-radius: var(--ds-radius-sm);
}

.ui-icon-btn:hover:not(:disabled) {
  background: var(--ds-bg-hover);
  color: var(--ds-text-strong);
}

.ui-icon-btn:active:not(:disabled) {
  background: var(--ds-bg-active);
}

.ui-icon-btn:disabled {
  color: var(--ds-text-faint);
  opacity: 0.55;
  cursor: not-allowed;
}

.ui-icon-btn.is-active {
  background: var(--ds-accent-subtle);
  color: var(--ds-accent-text);
}

.ui-icon-btn--danger:hover:not(:disabled) {
  background: var(--ds-status-danger-subtle);
  color: var(--ds-status-danger-text);
}

.ui-icon-btn:focus-visible {
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 2px;
}
</style>
