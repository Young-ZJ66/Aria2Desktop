/**
 * 已完成任务删除服务
 * 专门处理已完成任务的删除，包括文件删除
 */

import type { Aria2Task } from '@/types/aria2'
import { taskPersistenceService } from './taskPersistenceService'
import { taskTimeService } from './taskTimeService'

export interface DeleteResult {
  success: boolean
  taskId: string
  taskName: string
  filesDeleted: number
  errors: string[]
}

export interface BatchDeleteResult {
  totalTasks: number
  successfulTasks: number
  failedTasks: number
  totalFilesDeleted: number
  results: DeleteResult[]
  errors: string[]
}

class CompletedTaskDeleteService {
  
  /**
   * 获取任务的所有文件路径
   */
  getTaskFilePaths(task: Aria2Task): string[] {
    const filePaths: string[] = []
    
    console.log(`Getting file paths for task ${task.gid}:`, {
      status: task.status,
      dir: task.dir,
      files: task.files,
      filesLength: task.files?.length || 0
    })
    
    if (task.files && task.files.length > 0) {
      task.files.forEach((file, index) => {
        console.log(`  File ${index}:`, {
          path: file.path,
          selected: file.selected,
          length: file.length,
          completedLength: file.completedLength
        })
        
        if (file.path && file.path.trim()) {
          let fullPath = file.path.trim()
          const isAbsolute = this.isAbsolutePath(fullPath)

          console.log(`    Original file path: "${fullPath}"`)
          console.log(`    Is absolute path: ${isAbsolute}`)
          console.log(`    Task dir: "${task.dir}"`)

          // 如果路径不是绝对路径，尝试与下载目录组合
          if (!isAbsolute && task.dir) {
            const originalPath = fullPath
            fullPath = this.joinPath(task.dir, fullPath)
            console.log(`    Combined path: "${originalPath}" + "${task.dir}" = "${fullPath}"`)
          } else if (isAbsolute) {
            console.log(`    Using absolute path as-is: "${fullPath}"`)
          } else {
            console.log(`    No task.dir available, using path as-is: "${fullPath}"`)
          }

          // 规范化路径，处理可能的重复目录问题
          const normalizedPath = this.normalizePath(fullPath)
          filePaths.push(normalizedPath)
          console.log(`    Final file path: "${normalizedPath}"`)
        }
      })
    }

    // 添加对应的.aria2文件
    const aria2Files = filePaths
      .filter(path => !path.endsWith('.aria2')) // 避免重复添加
      .map(path => path + '.aria2')

    const allFiles = [...filePaths, ...aria2Files]

    // 如果没有找到文件，尝试从下载目录推断
    if (filePaths.length === 0 && task.dir) {
      console.log(`No files found in task.files, checking download directory: ${task.dir}`)
      // 这里可以添加从下载目录推断文件的逻辑
    }

    console.log(`Final file paths for task ${task.gid} (including .aria2 files):`, allFiles)
    return allFiles
  }
  
  /**
   * 检查路径是否为绝对路径
   */
  private isAbsolutePath(path: string): boolean {
    // Windows: C:\ 或 D:\ 等盘符开头，或 \\ 网络路径
    // Unix: / 开头
    return /^([a-zA-Z]:[\\\/]|\\\\|\/)/i.test(path)
  }
  
  /**
   * 连接路径
   */
  private joinPath(dir: string, file: string): string {
    const separator = dir.includes('\\') ? '\\' : '/'
    return dir.endsWith(separator) ? dir + file : dir + separator + file
  }

  /**
   * 规范化路径，处理重复的目录问题
   */
  private normalizePath(path: string): string {
    // 将所有斜杠统一为反斜杠（Windows）或正斜杠（Unix）
    const isWindows = path.includes('\\') || /^[a-zA-Z]:/.test(path)
    const separator = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/[\\\/]+/g, separator)

    // 检查是否有重复的目录路径
    if (isWindows) {
      // Windows 路径：检查是否有重复的盘符路径
      const match = normalizedPath.match(/^([a-zA-Z]:[\\\/][^\\\/]+)[\\\/]\1(.*)$/i)
      if (match) {
        const duplicatedPart = match[1]
        const remainingPart = match[2]
        const correctedPath = duplicatedPart + (remainingPart ? separator + remainingPart : '')
        console.log(`    Detected duplicate path: "${normalizedPath}" -> "${correctedPath}"`)
        return correctedPath
      }
    }

    return normalizedPath
  }
  
  /**
   * 验证文件路径是否有效
   */
  private async validateFilePath(filePath: string): Promise<boolean> {
    try {
      // 在桌面环境中，可以尝试检查文件是否存在
      if (window.electronAPI?.openPath) {
        // 这里可以添加文件存在性检查的逻辑
        // 暂时返回 true，让删除操作去处理不存在的文件
        return true
      }
      return true
    } catch (error) {
      console.warn(`Failed to validate file path: ${filePath}`, error)
      return true // 即使验证失败，也让删除操作去处理
    }
  }

  /**
   * 获取任务显示名称
   */
  getTaskDisplayName(task: Aria2Task): string {
    if (task.bittorrent?.info?.name) {
      return task.bittorrent.info.name
    }
    
    if (task.files && task.files.length > 0) {
      const file = task.files[0]
      const path = file.path
      if (path) {
        return path.split('/').pop() || path.split('\\').pop() || 'Unknown'
      }
    }
    
    return `Task ${task.gid}`
  }
  
  /**
   * 删除单个已完成任务
   */
  async deleteCompletedTask(
    task: Aria2Task, 
    deleteFiles: boolean = false
  ): Promise<DeleteResult> {
    const taskName = this.getTaskDisplayName(task)
    const result: DeleteResult = {
      success: false,
      taskId: task.gid,
      taskName,
      filesDeleted: 0,
      errors: []
    }
    
    console.log(`Deleting completed task ${task.gid} (${taskName}), deleteFiles: ${deleteFiles}`)
    
    try {
      // 如果需要删除文件
      if (deleteFiles && window.electronAPI?.deleteFiles) {
        const filePaths = this.getTaskFilePaths(task)
        
        if (filePaths.length > 0) {
          console.log(`Attempting to delete ${filePaths.length} files for task ${task.gid}`)
          
          try {
            const deleteResult = await window.electronAPI.deleteFiles(filePaths)
            console.log(`File deletion result for task ${task.gid}:`, deleteResult)
            
            if (deleteResult.success && deleteResult.results) {
              const successfulDeletes = deleteResult.results.filter(r => r.success)
              result.filesDeleted = successfulDeletes.length
              
              const failedDeletes = deleteResult.results.filter(r => !r.success)
              if (failedDeletes.length > 0) {
                failedDeletes.forEach(failed => {
                  result.errors.push(`删除文件失败: ${failed.path} - ${failed.error}`)
                })
              }
            } else {
              result.errors.push(`文件删除操作失败: ${deleteResult.error}`)
            }
          } catch (error) {
            const errorMsg = `删除文件时发生错误: ${error instanceof Error ? error.message : String(error)}`
            result.errors.push(errorMsg)
            console.error(errorMsg, error)
          }
        } else {
          console.log(`Task ${task.gid} has no files to delete`)
        }
      }
      
      // 删除任务记录
      try {
        // 1. 尝试从 Aria2 中删除任务（如果任务仍在 Aria2 中）
        try {
          // 动态导入 aria2Store 来删除任务
          const { useAria2Store } = await import('@/stores/aria2Store')
          const aria2Store = useAria2Store()

          if (aria2Store.service && aria2Store.isConnected) {
            console.log(`Attempting to remove task ${task.gid} from Aria2`)

            // 先尝试从下载结果中删除（适用于已完成的任务）
            try {
              await aria2Store.service.removeDownloadResult(task.gid)
              console.log(`Successfully removed task ${task.gid} from Aria2 download results`)
            } catch (resultError) {
              // 如果从下载结果删除失败，尝试常规删除
              console.log(`Failed to remove from download results, trying regular remove:`, resultError)
              try {
                await aria2Store.service.remove(task.gid)
                console.log(`Successfully removed task ${task.gid} from Aria2 (regular remove)`)
              } catch (removeError) {
                console.log(`Failed to remove task ${task.gid} from Aria2 (may not exist):`, removeError)
              }
            }
          } else {
            console.log(`Aria2 not connected, skipping Aria2 deletion for task ${task.gid}`)
          }
        } catch (aria2Error) {
          // Aria2 删除失败不影响整体删除流程，可能任务已经不在 Aria2 中了
          console.log(`Failed to remove task ${task.gid} from Aria2:`, aria2Error)
        }

        // 2. 从持久化存储中删除
        taskPersistenceService.removePersistedTask(task.gid)
        console.log(`Removed task ${task.gid} from persistence storage`)

        // 3. 从时间记录中删除
        taskTimeService.removeTaskTime(task.gid)
        console.log(`Removed task ${task.gid} time record`)

        result.success = true
        console.log(`Successfully deleted task record for ${task.gid}`)
      } catch (error) {
        const errorMsg = `删除任务记录失败: ${error instanceof Error ? error.message : String(error)}`
        result.errors.push(errorMsg)
        console.error(errorMsg, error)
      }
      
    } catch (error) {
      const errorMsg = `删除任务时发生未知错误: ${error instanceof Error ? error.message : String(error)}`
      result.errors.push(errorMsg)
      console.error(errorMsg, error)
    }
    
    return result
  }
  
  /**
   * 批量删除已完成任务
   */
  async batchDeleteCompletedTasks(
    tasks: Aria2Task[], 
    deleteFiles: boolean = false
  ): Promise<BatchDeleteResult> {
    console.log(`Batch deleting ${tasks.length} completed tasks, deleteFiles: ${deleteFiles}`)
    
    const batchResult: BatchDeleteResult = {
      totalTasks: tasks.length,
      successfulTasks: 0,
      failedTasks: 0,
      totalFilesDeleted: 0,
      results: [],
      errors: []
    }
    
    for (const task of tasks) {
      try {
        const result = await this.deleteCompletedTask(task, deleteFiles)
        batchResult.results.push(result)
        
        if (result.success) {
          batchResult.successfulTasks++
          batchResult.totalFilesDeleted += result.filesDeleted
        } else {
          batchResult.failedTasks++
          batchResult.errors.push(...result.errors)
        }
      } catch (error) {
        batchResult.failedTasks++
        const errorMsg = `处理任务 ${task.gid} 时发生错误: ${error instanceof Error ? error.message : String(error)}`
        batchResult.errors.push(errorMsg)
        console.error(errorMsg, error)
      }
    }
    
    console.log('Batch delete completed:', batchResult)
    return batchResult
  }
  
  /**
   * 检查任务是否有可删除的文件
   */
  hasDeleteableFiles(task: Aria2Task): boolean {
    const filePaths = this.getTaskFilePaths(task)
    return filePaths.length > 0
  }
  
  /**
   * 获取任务文件信息摘要
   */
  getTaskFilesSummary(task: Aria2Task): { fileCount: number; filePaths: string[] } {
    const filePaths = this.getTaskFilePaths(task)
    return {
      fileCount: filePaths.length,
      filePaths
    }
  }
}

// 创建单例实例
export const completedTaskDeleteService = new CompletedTaskDeleteService()
