/**
 * 已完成任务删除服务
 * 专门处理已完成任务的删除，包括文件删除
 */

import type { Aria2Task } from '@/types/aria2'
import { getTaskName } from '@/utils/taskUtils'
import { taskPersistenceService } from './taskPersistenceService'
import { taskTimeService } from './taskTimeService'

/** 文件删除单项结果 */
interface FileDeleteItemResult {
  success: boolean
  path: string
  error?: string
}

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

/** 由调用方（taskStore / 组件）注入的 Aria2 删除能力，避免 service 层反向依赖 store */
export interface TaskRemovalService {
  removeDownloadResult(gid: string): Promise<string>
  remove(gid: string): Promise<string>
}

class CompletedTaskDeleteService {

  /**
   * 获取任务的所有文件路径
   */
  getTaskFilePaths(task: Aria2Task): string[] {
    const filePaths: string[] = []

    if (task.files && task.files.length > 0) {
      task.files.forEach((file) => {
        if (file.path && file.path.trim()) {
          let fullPath = file.path.trim()
          const isAbsolute = this.isAbsolutePath(fullPath)

          // 如果路径不是绝对路径，尝试与下载目录组合
          if (!isAbsolute && task.dir) {
            fullPath = this.joinPath(task.dir, fullPath)
          }

          // 规范化路径，处理可能的重复目录问题
          const normalizedPath = this.normalizePath(fullPath)
          filePaths.push(normalizedPath)
        }
      })
    }

    // 添加对应的.aria2文件
    const aria2Files = filePaths
      .filter(path => !path.endsWith('.aria2')) // 避免重复添加
      .map(path => path + '.aria2')

    return [...filePaths, ...aria2Files]
  }

  /**
   * 检查路径是否为绝对路径
   */
  private isAbsolutePath(path: string): boolean {
    // Windows: C:\ 或 D:\ 等盘符开头，或 \\ 网络路径
    // Unix: / 开头
    return /^([a-zA-Z]:[\\/]|\\\\|\/)/i.test(path)
  }

  /**
   * 连接路径
   */
  private joinPath(dir: string, file: string): string {
    const separator = dir.includes('\\') ? '\\' : '/'
    return dir.endsWith(separator) ? dir + file : dir + separator + file
  }

  /**
   * 规范化路径，处理 aria2 在 Windows 下偶发的首层目录重复问题
   * （如 C:\dir\dir\file -> C:\dir\file）
   */
  private normalizePath(path: string): string {
    // 将所有斜杠统一为反斜杠（Windows）或正斜杠（Unix）
    const isWindows = path.includes('\\') || /^[a-zA-Z]:/.test(path)
    const separator = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/[\\/]+/g, separator)

    // 检查是否有重复的目录路径（仅处理"盘符根后第一层目录紧接着重复"的已知 aria2 缺陷形态）
    if (isWindows) {
      const match = normalizedPath.match(/^([a-zA-Z]:[\\/][^\\/]+)[\\/]\1(?:[\\/](.*))?$/i)
      if (match) {
        const duplicatedPart = match[1]
        const remainingPart = match[2]
        const correctedPath = remainingPart !== undefined
          ? duplicatedPart + separator + remainingPart
          : duplicatedPart
        console.warn(`Detected duplicate path: "${normalizedPath}" -> "${correctedPath}"`)
        return correctedPath
      }
    }

    return normalizedPath
  }

  /**
   * 获取任务显示名称（统一委托 taskUtils，避免多处实现行为不一致）
   */
  getTaskDisplayName(task: Aria2Task): string {
    return getTaskName(task)
  }

  /**
   * 删除单个已完成任务
   * @param service 可选的 Aria2 删除能力（由调用方注入）；缺省时跳过 Aria2 侧清理
   */
  async deleteCompletedTask(
    task: Aria2Task,
    deleteFiles: boolean = false,
    service?: TaskRemovalService | null
  ): Promise<DeleteResult> {
    const taskName = this.getTaskDisplayName(task)
    const result: DeleteResult = {
      success: false,
      taskId: task.gid,
      taskName,
      filesDeleted: 0,
      errors: []
    }

    try {
      // 如果需要删除文件
      if (deleteFiles && window.electronAPI?.deleteFiles) {
        const filePaths = this.getTaskFilePaths(task)

        if (filePaths.length > 0) {
          try {
            // 第二参数传任务实际目录，主进程据此放宽白名单（任务可下载到非默认目录）
            const deleteResult = await window.electronAPI.deleteFiles(filePaths, task.dir)

            if (deleteResult.success && deleteResult.results) {
              const successfulDeletes = deleteResult.results.filter((r: FileDeleteItemResult) => r.success)
              result.filesDeleted = successfulDeletes.length

              const failedDeletes = deleteResult.results.filter((r: FileDeleteItemResult) => !r.success)
              if (failedDeletes.length > 0) {
                failedDeletes.forEach((failed: FileDeleteItemResult) => {
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
        }
      }

      // 删除任务记录
      try {
        // 1. 尝试从 Aria2 中删除任务（如果任务仍在 Aria2 中）
        if (service) {
          // 先尝试从下载结果中删除（适用于已完成的任务）
          try {
            await service.removeDownloadResult(task.gid)
          } catch {
            // 如果从下载结果删除失败，尝试常规删除（任务可能仍处于活动状态）
            try {
              await service.remove(task.gid)
            } catch {
              // 任务可能已不在 Aria2 中，忽略
            }
          }
        }

        // 2. 从持久化存储中删除
        taskPersistenceService.removePersistedTask(task.gid)

        // 3. 从时间记录中删除
        taskTimeService.removeTaskTime(task.gid)

        result.success = true
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
   * @param service 可选的 Aria2 删除能力（由调用方注入）；缺省时跳过 Aria2 侧清理
   */
  async batchDeleteCompletedTasks(
    tasks: Aria2Task[],
    deleteFiles: boolean = false,
    service?: TaskRemovalService | null
  ): Promise<BatchDeleteResult> {
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
        const result = await this.deleteCompletedTask(task, deleteFiles, service)
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
