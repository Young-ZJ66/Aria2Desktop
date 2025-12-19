import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useConnectionStore } from './connectionStore'
import { taskTimeService } from '@/services/taskTimeService'
import { taskPersistenceService } from '@/services/taskPersistenceService'
import { sessionManager } from '@/services/sessionManager'
import type { Aria2Task, Aria2Option } from '@/types/aria2'

export const useTaskStore = defineStore('task', () => {
    const connectionStore = useConnectionStore()

    // 状态
    const activeTasks = ref<Aria2Task[]>([])
    const waitingTasks = ref<Aria2Task[]>([])
    const stoppedTasks = ref<Aria2Task[]>([])
    const selectedTaskGids = ref<Set<string>>(new Set())

    // 计算属性
    const allTasks = computed(() => [
        ...activeTasks.value,
        ...waitingTasks.value,
        ...stoppedTasks.value
    ])

    const totalTasks = computed(() => allTasks.value.length)

    const downloadingTasks = computed(() =>
        activeTasks.value.filter(task => task.status === 'active')
    )

    const completedTasks = computed(() =>
        stoppedTasks.value.filter(task => task.status === 'complete')
    )

    const errorTasks = computed(() =>
        stoppedTasks.value.filter(task => task.status === 'error')
    )

    const hasSelectedTasks = computed(() => selectedTaskGids.value.size > 0)

    // 操作方法
    async function loadAllTasks() {
        if (!connectionStore.service) return

        try {
            const previousStopped = new Set(stoppedTasks.value.map(task => task.gid))
            const previousActive = new Set(activeTasks.value.map(task => task.gid))

            const [active, waiting, stopped] = await Promise.all([
                connectionStore.service.tellActive(),
                connectionStore.service.tellWaiting(0, 1000),
                connectionStore.service.tellStopped(0, 1000)
            ])

            // 记录新的活动任务
            active.forEach(task => {
                if (!previousActive.has(task.gid)) {
                    const fileName = getTaskName(task)
                    taskTimeService.recordTaskAdd(task.gid, fileName)
                }
            })

            // 详细的停止任务处理逻辑
            stopped.forEach(task => {
                if (!previousStopped.has(task.gid) && task.status === 'complete') {
                    const fileName = getTaskName(task)
                    const existingCompleteTime = taskTimeService.getCompleteTime(task.gid)
                    if (!existingCompleteTime) {
                        taskTimeService.recordTaskComplete(task.gid, fileName)
                    }

                    if (!taskPersistenceService.isTaskPersisted(task.gid)) {
                        const completeTime = taskTimeService.getCompleteTime(task.gid) || Date.now()
                        taskPersistenceService.persistCompletedTask(task, completeTime)
                    }
                }
            })

            // 同步现有已完成任务
            stopped.forEach(task => {
                if (task.status === 'complete' && !taskPersistenceService.isTaskPersisted(task.gid)) {
                    const existingCompleteTime = taskTimeService.getCompleteTime(task.gid)
                    if (existingCompleteTime) {
                        taskPersistenceService.persistCompletedTask(task, existingCompleteTime)
                    } else {
                        const estimatedTime = Date.now() - (24 * 60 * 60 * 1000)
                        taskPersistenceService.persistCompletedTask(task, estimatedTime)
                    }
                }
            })

            const errorTasksList = stopped.filter(task => task.status === 'error')
            const actuallyStoppedTasks = stopped.filter(task => task.status !== 'error')
            const mergedStoppedTasks = taskPersistenceService.mergeWithAria2Tasks(actuallyStoppedTasks)

            activeTasks.value = [...active, ...errorTasksList]
            waitingTasks.value = waiting
            stoppedTasks.value = mergedStoppedTasks

        } catch (error) {
            console.error('Failed to load tasks:', error)
        }
    }

    function getTaskName(task: Aria2Task): string {
        if (task.bittorrent?.info?.name) return task.bittorrent.info.name
        if (task.files && task.files.length > 0) {
            const file = task.files[0]
            const path = file.path
            return path.split('/').pop() || path.split('\\').pop() || 'Unknown'
        }
        return `Task ${task.gid}`
    }

    async function addUri(uris: string[], options?: Aria2Option) {
        if (!connectionStore.service) throw new Error('Not connected')

        const gid = await connectionStore.service.addUri(uris, options)

        const fileName = uris[0]?.split('/').pop() || uris[0]?.split('\\').pop() || 'Unknown'
        taskTimeService.recordTaskAdd(gid, fileName)
        sessionManager.markTaskForSave(gid)

        try {
            await connectionStore.service.saveSession()
        } catch (error) {
            console.warn('Failed to save session immediately:', error)
        }

        await loadAllTasks()
        return gid
    }

    async function addTorrent(torrent: string, uris?: string[], options?: Aria2Option) {
        if (!connectionStore.service) throw new Error('Not connected')

        const gid = await connectionStore.service.addTorrent(torrent, uris, options)

        try {
            await sessionManager.saveSessionImmediate()
        } catch (error) {
            console.warn('Failed to save session:', error)
        }

        taskTimeService.recordTaskAdd(gid, 'Torrent Task')
        sessionManager.markTaskForSave(gid)

        try {
            await connectionStore.service.saveSession()
        } catch (error) {
            console.warn('Failed to save session:', error)
        }

        await loadAllTasks()
        return gid
    }

    async function removeTask(gid: string, force = false, deleteFiles = false) {
        if (!connectionStore.service) throw new Error('Not connected')

        const isPersistedTask = taskPersistenceService.isTaskPersisted(gid)
        if (isPersistedTask) {
            taskPersistenceService.removePersistedTask(gid)
            taskTimeService.removeTaskTime(gid)
            await loadAllTasks()
            return true
        }

        // 验证任务是否存在的逻辑...
        let taskExists = false
        try {
            await connectionStore.service.tellStatus(gid)
            taskExists = true
        } catch {
            taskExists = false
        }

        // 文件删除逻辑
        let taskFiles: string[] = []
        if (deleteFiles && window.electronAPI) {
            try {
                // 我们需要先找到任务以获取文件
                // 由于 `loadAllTasks` 更新本地状态，我们可以在 stores 中查找
                const task = [...activeTasks.value, ...waitingTasks.value, ...stoppedTasks.value].find(t => t.gid === gid)
                if (task && task.files) {
                    taskFiles = task.files.map(f => f.path).filter(p => p && p !== '')
                    // 添加 .aria2 文件
                    const aria2Files = taskFiles.map(p => p + '.aria2')
                    taskFiles = [...taskFiles, ...aria2Files]
                }
            } catch (error) {
                console.warn('Failed to get files for deletion:', error)
            }
        }

        if (taskExists) {
            try {
                let taskStatus = 'unknown'
                try {
                    const info = await connectionStore.service.tellStatus(gid, ['status'])
                    taskStatus = info.status
                } catch { }

                if (taskStatus === 'error') {
                    try { await connectionStore.service.removeDownloadResult(gid) } catch {
                        try { await connectionStore.service.forceRemove(gid) } catch { }
                    }
                } else if (force || taskStatus === 'active' || taskStatus === 'waiting' || taskStatus === 'paused') {
                    await connectionStore.service.forceRemove(gid)
                } else {
                    await connectionStore.service.remove(gid)
                }

                try { await connectionStore.service.removeDownloadResult(gid) } catch { }
            } catch (e) {
                console.warn('Removal failed:', e)
            }
        }

        if (deleteFiles && taskFiles.length > 0 && window.electronAPI && window.electronAPI.deleteFiles) {
            await window.electronAPI.deleteFiles(taskFiles)
        }

        // 本地清理
        activeTasks.value = activeTasks.value.filter(t => t.gid !== gid)
        waitingTasks.value = activeTasks.value.filter(t => t.gid !== gid)
        stoppedTasks.value = stoppedTasks.value.filter(t => t.gid !== gid)

        taskPersistenceService.removePersistedTask(gid)
        taskTimeService.removeTaskTime(gid)

        try { await connectionStore.service.saveSession() } catch { }
        await loadAllTasks()
    }

    // 其他操作
    async function pauseTask(gid: string, force = false) {
        if (!connectionStore.service) throw new Error('Not connected')
        if (force) await connectionStore.service.forcePause(gid)
        else await connectionStore.service.pause(gid)
        await loadAllTasks()
    }

    async function unpauseTask(gid: string) {
        if (!connectionStore.service) throw new Error('Not connected')
        await connectionStore.service.unpause(gid)
        await loadAllTasks()
    }

    async function retryErrorTask(gid: string) {
        if (!connectionStore.service) throw new Error('Not connected')
        // 重用原始逻辑：tellStatus -> 获取 URIs -> 删除 -> addUri
        const taskInfo = await connectionStore.service.tellStatus(gid)
        const uris = taskInfo.files?.flatMap(f => f.uris || []).map(u => u.uri).filter(Boolean) || []
        if (uris.length === 0) throw new Error('No URIs found')
        const dir = taskInfo.dir

        // 删除旧任务
        try { await connectionStore.service.forceRemove(gid) } catch { }
        try { await connectionStore.service.removeDownloadResult(gid) } catch { }

        // 添加新任务
        const newGid = await connectionStore.service.addUri(uris, { dir })

        // 清理本地
        taskPersistenceService.removePersistedTask(gid)
        await loadAllTasks()
        return newGid
    }

    async function pauseAllTasks() {
        if (!connectionStore.service) return
        await connectionStore.service.pauseAll()
        await loadAllTasks()
    }

    async function unpauseAllTasks() {
        if (!connectionStore.service) return
        await connectionStore.service.unpauseAll()
        await loadAllTasks()
    }

    // 选择操作
    function selectTask(gid: string) { selectedTaskGids.value.add(gid) }
    function unselectTask(gid: string) { selectedTaskGids.value.delete(gid) }
    function toggleTaskSelection(gid: string) {
        if (selectedTaskGids.value.has(gid)) selectedTaskGids.value.delete(gid)
        else selectedTaskGids.value.add(gid)
    }

    async function pauseSelectedTasks() {
        if (!connectionStore.service || selectedTaskGids.value.size === 0) return
        await Promise.all(Array.from(selectedTaskGids.value).map(gid => pauseTask(gid, true).catch(console.error)))
    }

    async function unpauseSelectedTasks() {
        if (!connectionStore.service || selectedTaskGids.value.size === 0) return
        await Promise.all(Array.from(selectedTaskGids.value).map(gid => unpauseTask(gid).catch(console.error)))
    }

    async function removeSelectedTasks(force = false, deleteFiles = false) {
        if (!connectionStore.service || selectedTaskGids.value.size === 0) return
        await Promise.all(Array.from(selectedTaskGids.value).map(gid => removeTask(gid, force, deleteFiles).catch(console.error)))
        selectedTaskGids.value.clear()
    }

    // 监听器
    watch(() => connectionStore.service, (service) => {
        if (service) {
            service.on('downloadStart', loadAllTasks)
            service.on('downloadPause', loadAllTasks)
            service.on('downloadStop', loadAllTasks)
            service.on('downloadComplete', loadAllTasks)
            service.on('downloadError', loadAllTasks)
        }
    })

    return {
        activeTasks,
        waitingTasks,
        stoppedTasks,
        selectedTaskGids,
        allTasks,
        totalTasks,
        downloadingTasks,
        completedTasks,
        errorTasks,
        hasSelectedTasks,
        loadAllTasks,
        addUri,
        addTorrent,
        removeTask,
        pauseTask,
        unpauseTask,
        retryErrorTask,
        pauseAllTasks,
        unpauseAllTasks,
        selectTask,
        unselectTask,
        toggleTaskSelection,
        pauseSelectedTasks,
        unpauseSelectedTasks,
        removeSelectedTasks
    }
})
