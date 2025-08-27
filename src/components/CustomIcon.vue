<template>
  <img 
    :src="iconSrc" 
    :alt="name"
    :class="['custom-icon', `custom-icon-${size}`]"
    :style="{ filter: colorFilter }"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  name: 'start' | 'pause' | 'delete' | 'download' | 'open' | 'detail'
  size?: 'small' | 'medium' | 'large'
  color?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 'medium',
  color: '#909399'
})

// 图标文件映射
const iconMap = {
  start: '开始.png',
  pause: '暂停.png',
  delete: '删除.png',
  download: '下载.png',
  open: '打开.png',
  detail: '详情.png'
}

// 图标路径
const iconSrc = computed(() => {
  const fileName = iconMap[props.name]
  return new URL(`../icon/${fileName}`, import.meta.url).href
})

// 颜色滤镜（将图标颜色改为指定颜色）
const colorFilter = computed(() => {
  if (props.color === '#909399') {
    // 灰色滤镜
    return 'brightness(0) saturate(100%) invert(64%) sepia(8%) saturate(255%) hue-rotate(202deg) brightness(95%) contrast(89%)'
  } else if (props.color === '#409eff') {
    // 蓝色滤镜
    return 'brightness(0) saturate(100%) invert(58%) sepia(96%) saturate(1458%) hue-rotate(204deg) brightness(97%) contrast(100%)'
  } else if (props.color === '#67c23a') {
    // 绿色滤镜
    return 'brightness(0) saturate(100%) invert(64%) sepia(88%) saturate(394%) hue-rotate(76deg) brightness(94%) contrast(86%)'
  } else if (props.color === '#e6a23c') {
    // 橙色滤镜
    return 'brightness(0) saturate(100%) invert(71%) sepia(77%) saturate(1284%) hue-rotate(12deg) brightness(94%) contrast(89%)'
  } else if (props.color === '#f56c6c') {
    // 红色滤镜
    return 'brightness(0) saturate(100%) invert(58%) sepia(89%) saturate(2142%) hue-rotate(329deg) brightness(102%) contrast(94%)'
  }
  return 'none'
})
</script>

<style scoped>
.custom-icon {
  display: inline-block;
  transition: filter 0.2s ease;
}

.custom-icon-small {
  width: 14px;
  height: 14px;
}

.custom-icon-medium {
  width: 16px;
  height: 16px;
}

.custom-icon-large {
  width: 20px;
  height: 20px;
}
</style>
