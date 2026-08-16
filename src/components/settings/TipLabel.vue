<template>
  <span class="tip-label">
    <span class="tip-label-text">{{ label }}</span>
    <n-tooltip v-if="tip" trigger="hover" placement="top">
      <template #trigger>
        <n-icon class="tip-icon"><HelpCircleOutline /></n-icon>
      </template>
      <div class="tip-content">{{ tip }}</div>
    </n-tooltip>
  </span>
</template>

<script setup lang="ts">
import { HelpCircleOutline } from '@vicons/ionicons5'

defineProps<{
  label: string
  tip?: string
}>()
</script>

<style scoped>
.tip-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 1.2;
}

.tip-label-text {
  color: var(--text-primary);
}

.tip-icon {
  font-size: 15px;
  color: var(--text-secondary);
  cursor: help;
  transition: color 0.2s ease;
  flex-shrink: 0;
}

.tip-icon:hover {
  color: var(--color-primary);
}

.tip-content {
  max-width: 320px;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-line;
  word-break: break-word;
}
</style>