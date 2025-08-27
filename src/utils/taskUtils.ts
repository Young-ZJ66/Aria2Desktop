import type { Aria2Task } from '@/types/aria2'

export interface FilterOptions {
  searchText: string
  statusFilter: string
  sizeFilter: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
}

// 获取任务名称
export function getTaskName(task: Aria2Task): string {
  if (task.files && task.files.length > 0) {
    const fileName = task.files[0].path.split('/').pop() || task.files[0].path
    return fileName
  }
  if (task.bittorrent?.info?.name) {
    return task.bittorrent.info.name
  }
  return task.gid
}

// 获取任务大小（字节）
export function getTaskSize(task: Aria2Task): number {
  return parseInt(task.totalLength) || 0
}

// 获取任务进度（百分比）
export function getTaskProgress(task: Aria2Task): number {
  const total = parseInt(task.totalLength)
  const completed = parseInt(task.completedLength)
  
  if (total === 0) return 0
  return Math.round((completed / total) * 100)
}

// 获取下载速度（字节/秒）
export function getTaskSpeed(task: Aria2Task): number {
  return parseInt(task.downloadSpeed) || 0
}

// 计算剩余时间（秒）
export function getTaskRemainingTime(task: Aria2Task): number {
  const total = parseInt(task.totalLength)
  const completed = parseInt(task.completedLength)
  const speed = parseInt(task.downloadSpeed)
  
  if (speed === 0 || completed >= total) return 0
  return Math.round((total - completed) / speed)
}

// 格式化文件大小
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// 格式化速度
export function formatSpeed(bytesPerSecond: number): string {
  return formatSize(bytesPerSecond) + '/s'
}

// 格式化时间
export function formatTime(seconds: number): string {
  if (seconds === 0) return '--'
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }
}

// 搜索过滤
export function searchTasks(tasks: Aria2Task[], searchText: string): Aria2Task[] {
  if (!searchText.trim()) return tasks
  
  const text = searchText.toLowerCase()
  return tasks.filter(task => {
    const name = getTaskName(task).toLowerCase()
    const gid = task.gid.toLowerCase()
    
    // 搜索文件名、GID
    if (name.includes(text) || gid.includes(text)) {
      return true
    }
    
    // 搜索文件路径
    if (task.files?.some(file => file.path.toLowerCase().includes(text))) {
      return true
    }
    
    // 搜索 URI
    if (task.files?.some(file => 
      file.uris?.some(uri => uri.uri.toLowerCase().includes(text))
    )) {
      return true
    }
    
    return false
  })
}

// 状态过滤
export function filterByStatus(tasks: Aria2Task[], status: string): Aria2Task[] {
  if (!status) return tasks
  return tasks.filter(task => task.status === status)
}

// 大小过滤
export function filterBySize(tasks: Aria2Task[], sizeFilter: string): Aria2Task[] {
  if (!sizeFilter) return tasks
  
  return tasks.filter(task => {
    const size = getTaskSize(task)
    const sizeMB = size / (1024 * 1024)
    const sizeGB = size / (1024 * 1024 * 1024)
    
    switch (sizeFilter) {
      case 'small': return sizeMB < 100
      case 'medium': return sizeMB >= 100 && sizeGB < 1
      case 'large': return sizeGB >= 1 && sizeGB < 10
      case 'huge': return sizeGB >= 10
      default: return true
    }
  })
}

// 任务排序
export function sortTasks(tasks: Aria2Task[], sortBy: string, sortOrder: 'asc' | 'desc'): Aria2Task[] {
  const sorted = [...tasks].sort((a, b) => {
    let aValue: any
    let bValue: any
    
    switch (sortBy) {
      case 'name':
        aValue = getTaskName(a).toLowerCase()
        bValue = getTaskName(b).toLowerCase()
        break
      case 'size':
        aValue = getTaskSize(a)
        bValue = getTaskSize(b)
        break
      case 'progress':
        aValue = getTaskProgress(a)
        bValue = getTaskProgress(b)
        break
      case 'speed':
        aValue = getTaskSpeed(a)
        bValue = getTaskSpeed(b)
        break
      case 'remaining':
        aValue = getTaskRemainingTime(a)
        bValue = getTaskRemainingTime(b)
        break
      case 'addTime':
      default:
        // 使用 GID 作为添加时间的近似值（GID 通常是递增的）
        aValue = a.gid
        bValue = b.gid
        break
    }
    
    if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1
    if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1
    return 0
  })
  
  return sorted
}

// 综合过滤和排序
export function filterAndSortTasks(tasks: Aria2Task[], filters: FilterOptions): Aria2Task[] {
  let result = tasks
  
  // 应用搜索过滤
  if (filters.searchText) {
    result = searchTasks(result, filters.searchText)
  }
  
  // 应用状态过滤
  if (filters.statusFilter) {
    result = filterByStatus(result, filters.statusFilter)
  }
  
  // 应用大小过滤
  if (filters.sizeFilter) {
    result = filterBySize(result, filters.sizeFilter)
  }
  
  // 应用排序
  result = sortTasks(result, filters.sortBy, filters.sortOrder)
  
  return result
}

// 获取任务统计信息
export function getTaskStats(tasks: Aria2Task[]) {
  const stats = {
    total: tasks.length,
    active: 0,
    waiting: 0,
    paused: 0,
    complete: 0,
    error: 0,
    totalSize: 0,
    completedSize: 0,
    totalSpeed: 0
  }
  
  tasks.forEach(task => {
    switch (task.status) {
      case 'active':
        stats.active++
        break
      case 'waiting':
        stats.waiting++
        break
      case 'paused':
        stats.paused++
        break
      case 'complete':
        stats.complete++
        break
      case 'error':
        stats.error++
        break
    }
    
    stats.totalSize += getTaskSize(task)
    stats.completedSize += parseInt(task.completedLength)
    stats.totalSpeed += getTaskSpeed(task)
  })
  
  return stats
}
