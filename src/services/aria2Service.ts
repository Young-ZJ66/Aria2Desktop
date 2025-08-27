import { Aria2Client } from './aria2Client'
import type {
  Aria2Config,
  Aria2Task,
  Aria2GlobalStat,
  Aria2Version,
  Aria2Option,
  Aria2File,
  Aria2Peer,
  Aria2Server
} from '@/types/aria2'
import { Aria2Methods } from '@/types/aria2'

export class Aria2Service {
  private client: Aria2Client

  constructor(config: Aria2Config) {
    this.client = new Aria2Client(config)
  }

  // 连接管理
  async connect(): Promise<void> {
    return this.client.connectWebSocket()
  }

  disconnect(): void {
    this.client.disconnect()
  }

  isConnected(): boolean {
    return this.client.isConnected()
  }

  updateConfig(config: Partial<Aria2Config>): void {
    this.client.updateConfig(config)
  }

  // 事件监听
  on(event: string, listener: Function): void {
    this.client.on(event, listener)
  }

  off(event: string, listener: Function): void {
    this.client.off(event, listener)
  }

  // === 任务管理 ===

  // 添加URI下载
  async addUri(uris: string[], options?: Aria2Option, position?: number): Promise<string> {
    const params: any[] = [uris]
    if (options && Object.keys(options).length > 0) {
      params.push(options)
    } else {
      params.push({}) // 空选项对象
    }
    if (position !== undefined) params.push(position)

    console.log('Adding URI with params:', params)
    return this.client.call<string>(Aria2Methods.ADD_URI, params)
  }

  // 添加种子下载
  async addTorrent(torrent: string, uris?: string[], options?: Aria2Option, position?: number): Promise<string> {
    const params = [torrent]
    if (uris) params.push(uris)
    if (options) params.push(options)
    if (position !== undefined) params.push(position)
    
    return this.client.call<string>(Aria2Methods.ADD_TORRENT, params)
  }

  // 添加Metalink下载
  async addMetalink(metalink: string, options?: Aria2Option, position?: number): Promise<string[]> {
    const params = [metalink]
    if (options) params.push(options)
    if (position !== undefined) params.push(position)
    
    return this.client.call<string[]>(Aria2Methods.ADD_METALINK, params)
  }

  // 删除任务
  async remove(gid: string): Promise<string> {
    return this.client.call<string>(Aria2Methods.REMOVE, [gid])
  }

  // 强制删除任务
  async forceRemove(gid: string): Promise<string> {
    return this.client.call<string>(Aria2Methods.FORCE_REMOVE, [gid])
  }

  // 暂停任务
  async pause(gid: string): Promise<string> {
    return this.client.call<string>(Aria2Methods.PAUSE, [gid])
  }

  // 暂停所有任务
  async pauseAll(): Promise<string> {
    return this.client.call<string>(Aria2Methods.PAUSE_ALL)
  }

  // 强制暂停任务
  async forcePause(gid: string): Promise<string> {
    return this.client.call<string>(Aria2Methods.FORCE_PAUSE, [gid])
  }

  // 强制暂停所有任务
  async forcePauseAll(): Promise<string> {
    return this.client.call<string>(Aria2Methods.FORCE_PAUSE_ALL)
  }

  // 恢复任务
  async unpause(gid: string): Promise<string> {
    return this.client.call<string>(Aria2Methods.UNPAUSE, [gid])
  }

  // 恢复所有任务
  async unpauseAll(): Promise<string> {
    return this.client.call<string>(Aria2Methods.UNPAUSE_ALL)
  }

  // === 任务信息 ===

  // 获取任务状态
  async tellStatus(gid: string, keys?: string[]): Promise<Aria2Task> {
    const params = [gid]
    if (keys) params.push(keys)
    
    return this.client.call<Aria2Task>(Aria2Methods.TELL_STATUS, params)
  }

  // 获取活动任务列表
  async tellActive(keys?: string[]): Promise<Aria2Task[]> {
    const params = keys ? [keys] : []
    return this.client.call<Aria2Task[]>(Aria2Methods.TELL_ACTIVE, params)
  }

  // 获取等待任务列表
  async tellWaiting(offset: number, num: number, keys?: string[]): Promise<Aria2Task[]> {
    const params = [offset, num]
    if (keys) params.push(keys)
    
    return this.client.call<Aria2Task[]>(Aria2Methods.TELL_WAITING, params)
  }

  // 获取已停止任务列表
  async tellStopped(offset: number, num: number, keys?: string[]): Promise<Aria2Task[]> {
    const params = [offset, num]
    // 如果没有指定字段，获取所有可能的字段包括时间信息
    if (keys) {
      params.push(keys)
    } else {
      // 请求所有可能的字段，包括时间相关字段
      params.push([
        'gid', 'status', 'totalLength', 'completedLength', 'uploadLength',
        'downloadSpeed', 'uploadSpeed', 'dir', 'files', 'numSeeders',
        'connections', 'errorCode', 'errorMessage', 'followedBy', 'following',
        'belongsTo', 'bitfield', 'verifiedLength', 'verifyIntegrityPending',
        // 尝试获取时间相关字段
        'creationTime', 'completionTime', 'startTime', 'endTime'
      ])
    }

    return this.client.call<Aria2Task[]>(Aria2Methods.TELL_STOPPED, params)
  }

  // 获取任务文件列表
  async getFiles(gid: string): Promise<Aria2File[]> {
    return this.client.call<Aria2File[]>(Aria2Methods.GET_FILES, [gid])
  }

  // 获取任务URI列表
  async getUris(gid: string): Promise<any[]> {
    return this.client.call<any[]>(Aria2Methods.GET_URIS, [gid])
  }

  // 获取任务Peer列表
  async getPeers(gid: string): Promise<Aria2Peer[]> {
    return this.client.call<Aria2Peer[]>(Aria2Methods.GET_PEERS, [gid])
  }

  // 获取任务服务器列表
  async getServers(gid: string): Promise<Aria2Server[]> {
    return this.client.call<Aria2Server[]>(Aria2Methods.GET_SERVERS, [gid])
  }

  // === 选项设置 ===

  // 获取任务选项
  async getOption(gid: string): Promise<Aria2Option> {
    return this.client.call<Aria2Option>(Aria2Methods.GET_OPTION, [gid])
  }

  // 修改任务选项
  async changeOption(gid: string, options: Aria2Option): Promise<string> {
    return this.client.call<string>(Aria2Methods.CHANGE_OPTION, [gid, options])
  }

  // 获取全局选项
  async getGlobalOption(): Promise<Aria2Option> {
    return this.client.call<Aria2Option>(Aria2Methods.GET_GLOBAL_OPTION)
  }

  // 修改全局选项
  async changeGlobalOption(options: Aria2Option): Promise<string> {
    return this.client.call<string>(Aria2Methods.CHANGE_GLOBAL_OPTION, [options])
  }

  // === 统计信息 ===

  // 获取全局统计
  async getGlobalStat(): Promise<Aria2GlobalStat> {
    return this.client.call<Aria2GlobalStat>(Aria2Methods.GET_GLOBAL_STAT)
  }

  // 获取版本信息
  async getVersion(): Promise<Aria2Version> {
    return this.client.call<Aria2Version>(Aria2Methods.GET_VERSION)
  }

  // === 会话管理 ===

  // 保存会话
  async saveSession(): Promise<string> {
    return this.client.call<string>(Aria2Methods.SAVE_SESSION)
  }

  // 清除下载结果
  async purgeDownloadResult(): Promise<string> {
    return this.client.call<string>(Aria2Methods.PURGE_DOWNLOAD_RESULT)
  }

  // 删除下载结果
  async removeDownloadResult(gid: string): Promise<string> {
    return this.client.call<string>(Aria2Methods.REMOVE_DOWNLOAD_RESULT, [gid])
  }

  // === 位置控制 ===

  // 改变任务位置
  async changePosition(gid: string, pos: number, how: 'POS_SET' | 'POS_CUR' | 'POS_END'): Promise<number> {
    return this.client.call<number>(Aria2Methods.CHANGE_POSITION, [gid, pos, how])
  }

  // === 系统控制 ===

  // 关闭Aria2
  async shutdown(): Promise<string> {
    return this.client.call<string>(Aria2Methods.SHUTDOWN)
  }

  // 强制关闭Aria2
  async forceShutdown(): Promise<string> {
    return this.client.call<string>(Aria2Methods.FORCE_SHUTDOWN)
  }

  // === 批量操作 ===

  // 多重调用
  async multicall(calls: Array<{ methodName: string; params: any[] }>): Promise<any[]> {
    return this.client.call<any[]>(Aria2Methods.MULTICALL, [calls])
  }
}
