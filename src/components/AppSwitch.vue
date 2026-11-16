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
  --sw-active: var(--ds-accent);
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
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 2px;
  border-radius: var(--ds-radius-xs);
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
  border-radius: var(--ds-radius-sm);
  background-color: var(--ds-border-base);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ds-text-strong) 8%, transparent);
  transition:
    background-color var(--ds-motion-dur-4) var(--ds-motion-ease-in-out),
    box-shadow var(--ds-motion-dur-4) var(--ds-motion-ease-in-out);
}

.app-switch--active .app-switch__rail {
  background-image: linear-gradient(
    135deg,
    var(--sw-active),
    color-mix(in srgb, var(--sw-active) 78%, var(--ds-text-on-accent))
  );
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ds-text-strong) 4%, transparent);
}

.app-switch__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: var(--ds-radius-sm);
  background-color: var(--ds-text-on-accent);
  box-shadow:
    0 1px 3px color-mix(in srgb, var(--ds-text-strong) 32%, transparent),
    0 0 0 0.5px color-mix(in srgb, var(--ds-text-strong) 8%, transparent);
  transition:
    left var(--ds-motion-dur-4) var(--ds-motion-ease-out),
    width var(--ds-motion-dur-3) var(--ds-motion-ease-in-out);
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
  color: var(--ds-text-on-accent);
  opacity: 0;
  transform: scale(0.4);
  transition:
    opacity var(--ds-motion-dur-3) var(--ds-motion-ease-in-out),
    transform var(--ds-motion-dur-3) var(--ds-motion-ease-out);
}

.app-switch--active .app-switch__check {
  opacity: 1;
  transform: scale(1);
}
</style>
