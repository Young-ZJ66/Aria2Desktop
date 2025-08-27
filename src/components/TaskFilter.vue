<template>
  <div class="task-filter">
    <el-row :gutter="16" align="middle">
      <!-- 搜索框 -->
      <el-col :span="8">
        <el-input
          v-model="searchText"
          placeholder="搜索任务名称、文件名或链接..."
          :prefix-icon="Search"
          clearable
          @input="handleSearch"
        />
      </el-col>
      
      <!-- 状态过滤 -->
      <el-col :span="4">
        <el-select
          v-model="statusFilter"
          placeholder="状态过滤"
          clearable
          @change="handleStatusFilter"
        >
          <el-option label="全部状态" value="" />
          <el-option label="下载中" value="active" />
          <el-option label="等待中" value="waiting" />
          <el-option label="已暂停" value="paused" />
          <el-option label="已完成" value="complete" />
          <el-option label="错误" value="error" />
          <el-option label="已删除" value="removed" />
        </el-select>
      </el-col>
      
      <!-- 大小过滤 -->
      <el-col :span="4">
        <el-select
          v-model="sizeFilter"
          placeholder="文件大小"
          clearable
          @change="handleSizeFilter"
        >
          <el-option label="全部大小" value="" />
          <el-option label="< 100MB" value="small" />
          <el-option label="100MB - 1GB" value="medium" />
          <el-option label="1GB - 10GB" value="large" />
          <el-option label="> 10GB" value="huge" />
        </el-select>
      </el-col>
      
      <!-- 排序 -->
      <el-col :span="4">
        <el-select
          v-model="sortBy"
          placeholder="排序方式"
          @change="handleSort"
        >
          <el-option label="添加时间" value="addTime" />
          <el-option label="文件名" value="name" />
          <el-option label="文件大小" value="size" />
          <el-option label="下载进度" value="progress" />
          <el-option label="下载速度" value="speed" />
          <el-option label="剩余时间" value="remaining" />
        </el-select>
      </el-col>
      
      <!-- 排序方向 -->
      <el-col :span="2">
        <el-button
          :icon="sortOrder === 'asc' ? SortUp : SortDown"
          @click="toggleSortOrder"
          :title="sortOrder === 'asc' ? '升序' : '降序'"
        />
      </el-col>
      
      <!-- 重置按钮 -->
      <el-col :span="2">
        <el-button :icon="Refresh" @click="resetFilters" title="重置过滤器" />
      </el-col>
    </el-row>
    
    <!-- 过滤结果统计 -->
    <div class="filter-stats" v-if="hasActiveFilters">
      <el-tag size="small" type="info">
        找到 {{ filteredCount }} 个任务
        <el-button
          link
          size="small"
          @click="resetFilters"
          style="margin-left: 8px"
        >
          清除过滤器
        </el-button>
      </el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Search, SortUp, SortDown, Refresh } from '@element-plus/icons-vue'

interface FilterOptions {
  searchText: string
  statusFilter: string
  sizeFilter: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
}

interface Props {
  filteredCount?: number
}

interface Emits {
  (e: 'filter-change', filters: FilterOptions): void
  (e: 'search', text: string): void
  (e: 'status-filter', status: string): void
  (e: 'size-filter', size: string): void
  (e: 'sort', sortBy: string, sortOrder: 'asc' | 'desc'): void
  (e: 'reset'): void
}

const props = withDefaults(defineProps<Props>(), {
  filteredCount: 0
})

const emit = defineEmits<Emits>()

// 过滤器状态
const searchText = ref('')
const statusFilter = ref('')
const sizeFilter = ref('')
const sortBy = ref('addTime')
const sortOrder = ref<'asc' | 'desc'>('desc')

// 计算属性
const hasActiveFilters = computed(() => {
  return searchText.value || statusFilter.value || sizeFilter.value
})

const currentFilters = computed((): FilterOptions => ({
  searchText: searchText.value,
  statusFilter: statusFilter.value,
  sizeFilter: sizeFilter.value,
  sortBy: sortBy.value,
  sortOrder: sortOrder.value
}))

// 监听过滤器变化
watch(currentFilters, (newFilters) => {
  emit('filter-change', newFilters)
}, { deep: true })

// 事件处理
function handleSearch(text: string) {
  emit('search', text)
}

function handleStatusFilter(status: string) {
  emit('status-filter', status)
}

function handleSizeFilter(size: string) {
  emit('size-filter', size)
}

function handleSort(sort: string) {
  emit('sort', sort, sortOrder.value)
}

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  emit('sort', sortBy.value, sortOrder.value)
}

function resetFilters() {
  searchText.value = ''
  statusFilter.value = ''
  sizeFilter.value = ''
  sortBy.value = 'addTime'
  sortOrder.value = 'desc'
  emit('reset')
}

// 暴露方法给父组件
defineExpose({
  resetFilters
})
</script>

<style scoped>
.task-filter {
  padding: 16px;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 16px;
}

.filter-stats {
  margin-top: 12px;
  display: flex;
  align-items: center;
}

:deep(.el-input__wrapper) {
  border-radius: 6px;
}

:deep(.el-select) {
  width: 100%;
}
</style>
