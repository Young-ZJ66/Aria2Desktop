<template>
  <div class="ui-empty" :class="[`ui-empty--${size}`]">
    <div v-if="icon" class="ui-empty__icon" aria-hidden="true">
      <n-icon :size="size === 'sm' ? 20 : 24"><component :is="icon" /></n-icon>
    </div>
    <p class="ui-empty__title">{{ title }}</p>
    <div v-if="$slots.actions" class="ui-empty__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { NIcon } from 'naive-ui'
import type { Component } from 'vue'

/**
 * 空态：图标放进淡色圆形容器里，标题给一句「现在能做什么」而不是「什么都没有」。
 * v1 的空态是 naive 默认的一行灰字，8 个页面里有 5 个看起来像加载失败。
 */
withDefaults(
  defineProps<{
    title: string
    icon?: Component
    size?: 'sm' | 'md'
  }>(),
  { size: 'md' }
)
</script>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ds-space-4);
  padding: var(--ds-space-40) var(--ds-space-24);
  text-align: center;
}

.ui-empty--sm {
  padding: var(--ds-space-24) var(--ds-space-16);
}

.ui-empty__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--ds-space-8);
  border-radius: var(--ds-radius-lg);
  background: var(--ds-bg-sunken);
  color: var(--ds-text-faint);
}

.ui-empty--sm .ui-empty__icon {
  width: 40px;
  height: 40px;
  border-radius: var(--ds-radius-md);
}

.ui-empty__title {
  margin: 0;
  font-size: var(--ds-text-body-size);
  font-weight: 500;
  color: var(--ds-text-base);
}

.ui-empty__actions {
  display: flex;
  gap: var(--ds-space-8);
  margin-top: var(--ds-space-12);
}
</style>
