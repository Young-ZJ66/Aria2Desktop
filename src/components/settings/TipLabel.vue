<template>
  <span class="tip-label">
    <span class="tip-label-text">{{ label }}</span>
    <n-tooltip v-if="tip || requiresRestart" trigger="hover" placement="top">
      <template #trigger>
        <n-icon class="tip-icon"><HelpCircleOutline /></n-icon>
      </template>
      <div class="tip-content">
        <div v-if="tip">{{ tip }}</div>
        <div v-if="requiresRestart" class="restart-hint">{{ t('settings.restartRequiredHint') }}</div>
      </div>
    </n-tooltip>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { HelpCircleOutline } from '@vicons/ionicons5'
import { RESTART_REQUIRED_OPTIONS } from '@/utils/aria2RestartOptions'

const props = defineProps<{
  label: string
  tip?: string
  /** aria2 选项名；若该选项需重启 Aria2 服务才生效，问号提示中会自动附加说明 */
  option?: string
}>()

const { t } = useI18n()
const requiresRestart = computed(() =>
  props.option ? RESTART_REQUIRED_OPTIONS.has(props.option) : false
)
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

.restart-hint {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border-light);
  color: var(--color-warning);
  font-size: 11px;
}
</style>
