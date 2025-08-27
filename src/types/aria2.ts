// Aria2 RPC接口类型定义

export interface Aria2Config {
  host: string
  port: number
  protocol: 'http' | 'https' | 'ws' | 'wss'
  secret?: string
  path?: string
}

export interface Aria2Task {
  gid: string
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed'
  totalLength: string
  completedLength: string
  uploadLength: string
  bitfield?: string
  downloadSpeed: string
  uploadSpeed: string
  infoHash?: string
  numSeeders?: string
  seeder?: string
  pieceLength?: string
  numPieces?: string
  connections: string
  errorCode?: string
  errorMessage?: string
  followedBy?: string[]
  following?: string
  belongsTo?: string
  dir: string
  files: Aria2File[]
  bittorrent?: Aria2BitTorrent
  verifiedLength?: string
  verifyIntegrityPending?: string
  // 时间相关字段（可能存在）
  creationTime?: string
  completionTime?: string
  startTime?: string
  endTime?: string
}

export interface Aria2File {
  index: string
  path: string
  length: string
  completedLength: string
  selected: string
  uris: Aria2Uri[]
}

export interface Aria2Uri {
  uri: string
  status: 'used' | 'waiting'
}

export interface Aria2BitTorrent {
  announceList?: string[][]
  comment?: string
  creationDate?: number
  mode?: string
  info?: {
    name: string
  }
}

export interface Aria2GlobalStat {
  downloadSpeed: string
  uploadSpeed: string
  numActive: string
  numWaiting: string
  numStopped: string
  numStoppedTotal: string
}

export interface Aria2Version {
  version: string
  enabledFeatures: string[]
}

export interface Aria2Option {
  [key: string]: string
}

export interface Aria2Peer {
  peerId: string
  ip: string
  port: string
  bitfield: string
  amChoking: string
  peerChoking: string
  downloadSpeed: string
  uploadSpeed: string
  seeder: string
}

export interface Aria2Server {
  index: string
  servers: Array<{
    uri: string
    currentUri: string
    downloadSpeed: string
  }>
}

// RPC请求和响应类型
export interface Aria2RpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any[]
}

export interface Aria2RpcResponse<T = any> {
  jsonrpc: '2.0'
  id: string | number
  result?: T
  error?: {
    code: number
    message: string
  }
}

export interface Aria2RpcNotification {
  jsonrpc: '2.0'
  method: string
  params: any[]
}

// 常用的RPC方法名
export enum Aria2Methods {
  // 任务管理
  ADD_URI = 'aria2.addUri',
  ADD_TORRENT = 'aria2.addTorrent',
  ADD_METALINK = 'aria2.addMetalink',
  REMOVE = 'aria2.remove',
  FORCE_REMOVE = 'aria2.forceRemove',
  PAUSE = 'aria2.pause',
  PAUSE_ALL = 'aria2.pauseAll',
  FORCE_PAUSE = 'aria2.forcePause',
  FORCE_PAUSE_ALL = 'aria2.forcePauseAll',
  UNPAUSE = 'aria2.unpause',
  UNPAUSE_ALL = 'aria2.unpauseAll',
  
  // 任务信息
  TELL_STATUS = 'aria2.tellStatus',
  GET_URIS = 'aria2.getUris',
  GET_FILES = 'aria2.getFiles',
  GET_PEERS = 'aria2.getPeers',
  GET_SERVERS = 'aria2.getServers',
  TELL_ACTIVE = 'aria2.tellActive',
  TELL_WAITING = 'aria2.tellWaiting',
  TELL_STOPPED = 'aria2.tellStopped',
  
  // 位置控制
  CHANGE_POSITION = 'aria2.changePosition',
  
  // 选项设置
  CHANGE_OPTION = 'aria2.changeOption',
  GET_OPTION = 'aria2.getOption',
  GET_GLOBAL_OPTION = 'aria2.getGlobalOption',
  CHANGE_GLOBAL_OPTION = 'aria2.changeGlobalOption',
  
  // 统计信息
  GET_GLOBAL_STAT = 'aria2.getGlobalStat',
  PURGE_DOWNLOAD_RESULT = 'aria2.purgeDownloadResult',
  REMOVE_DOWNLOAD_RESULT = 'aria2.removeDownloadResult',
  
  // 系统信息
  GET_VERSION = 'aria2.getVersion',
  GET_SESSION_INFO = 'aria2.getSessionInfo',
  SHUTDOWN = 'aria2.shutdown',
  FORCE_SHUTDOWN = 'aria2.forceShutdown',
  
  // 会话管理
  SAVE_SESSION = 'aria2.saveSession',
  
  // 多播
  MULTICALL = 'system.multicall'
}
