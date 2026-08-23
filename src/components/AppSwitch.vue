<template>
  <button
    type="button"
    class="app-switch"
    :class="{ 'app-switch--active': value, 'app-switch--disabled': disabled }"
    role="switch"
    :aria-checked="value"
    :aria-label="ariaLabel"
    :aria-disabled="disabled"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="app-switch__rail">
      <span class="app-switch__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
        </svg>
      </span>
      <span class="app-switch__knob" aria-hidden="true"/>
    </span>
  </button>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ value?: boolean; disabled?: boolean; ariaLabel?: string }>(), {
  value: false,
  disabled: false,
  ariaLabel: undefined
})

const emit = defineEmits<{ (e: 'update:value', value: boolean): void }>()

function toggle() {
  if (props.disabled) return
  emit('update:value', !props.value)
}
</script>

<style scoped>
.app-switch {
  --sw-active: var(--color-primary);
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  /* 透明 outline 兜底：支持 :focus-visible 时显示主色 outline，不支持时退化为无视觉边框 */
  outline: 2px solid transparent;
  -webkit-appearance: none;
  user-select: none;
  -webkit-user-select: none;
}

.app-switch:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.app-switch:focus-visible .app-switch__rail {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sw-active) 25%, transparent);
}

.app-switch--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.app-switch__rail {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 9px;
  background-color: var(--border-base);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
  transition: background-color 0.25s ease, box-shadow 0.25s ease;
}

.app-switch--active .app-switch__rail {
  background-image: linear-gradient(135deg, var(--sw-active), color-mix(in srgb, var(--sw-active) 78%, #ffffff));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.02);
}

.app-switch__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background-color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
  transition: left 0.28s cubic-bezier(0.34, 1.45, 0.64, 1), width 0.2s ease;
}

.app-switch--active .app-switch__knob {
  left: 23px;
}

.app-switch__rail:active .app-switch__knob {
  width: 22px;
}

.app-switch--active .app-switch__rail:active .app-switch__knob {
  left: 19px;
}

.app-switch__check {
  position: absolute;
  top: 5px;
  left: 5px;
  color: #ffffff;
  opacity: 0;
  transform: scale(0.4);
  transition: opacity 0.2s ease, transform 0.22s ease;
}

.app-switch--active .app-switch__check {
  opacity: 1;
  transform: scale(1);
}
</style>
