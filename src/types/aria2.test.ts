import { describe, expect, it } from 'vitest'
import { Aria2Methods } from './aria2'

describe('Aria2Methods 枚举', () => {
  it('每个成员的值都是 aria2.<camelCase> 形式的 RPC 方法名', () => {
    for (const [key, value] of Object.entries(Aria2Methods)) {
      expect(typeof value).toBe('string')
      expect(value.startsWith('aria2.') || value === 'system.multicall').toBe(true)
      expect(value).toMatch(/^(aria2\.[a-zA-Z]+|system\.multicall)$/)
      // 枚举键名与值必须对应，防止 COPY 粘贴后忘记改名
      if (value.startsWith('aria2.')) {
        const camel = key
          .toLowerCase()
          .replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())
        expect(value).toBe('aria2.' + camel)
      }
    }
  })

  it('值唯一——两个成员共用同一方法名会让调用静默走错分支', () => {
    const values = Object.values(Aria2Methods)
    expect(new Set(values).size).toBe(values.length)
  })

  it('任务生命周期方法齐全', () => {
    expect(Aria2Methods.ADD_URI).toBe('aria2.addUri')
    expect(Aria2Methods.ADD_TORRENT).toBe('aria2.addTorrent')
    expect(Aria2Methods.ADD_METALINK).toBe('aria2.addMetalink')
    expect(Aria2Methods.PAUSE).toBe('aria2.pause')
    expect(Aria2Methods.PAUSE_ALL).toBe('aria2.pauseAll')
    expect(Aria2Methods.FORCE_PAUSE).toBe('aria2.forcePause')
    expect(Aria2Methods.FORCE_PAUSE_ALL).toBe('aria2.forcePauseAll')
    expect(Aria2Methods.UNPAUSE).toBe('aria2.unpause')
    expect(Aria2Methods.UNPAUSE_ALL).toBe('aria2.unpauseAll')
    expect(Aria2Methods.REMOVE).toBe('aria2.remove')
    expect(Aria2Methods.FORCE_REMOVE).toBe('aria2.forceRemove')
  })

  it('查询与设置类方法名大小写正确（aria2 对方法名大小写敏感）', () => {
    expect(Aria2Methods.TELL_STATUS).toBe('aria2.tellStatus')
    expect(Aria2Methods.TELL_ACTIVE).toBe('aria2.tellActive')
    expect(Aria2Methods.TELL_WAITING).toBe('aria2.tellWaiting')
    expect(Aria2Methods.TELL_STOPPED).toBe('aria2.tellStopped')
    expect(Aria2Methods.GET_GLOBAL_OPTION).toBe('aria2.getGlobalOption')
    expect(Aria2Methods.CHANGE_GLOBAL_OPTION).toBe('aria2.changeGlobalOption')
    expect(Aria2Methods.GET_GLOBAL_STAT).toBe('aria2.getGlobalStat')
    expect(Aria2Methods.PURGE_DOWNLOAD_RESULT).toBe('aria2.purgeDownloadResult')
    expect(Aria2Methods.REMOVE_DOWNLOAD_RESULT).toBe('aria2.removeDownloadResult')
    expect(Aria2Methods.CHANGE_POSITION).toBe('aria2.changePosition')
  })

  it('系统与会话方法齐全，多播是 system.multicall', () => {
    expect(Aria2Methods.GET_VERSION).toBe('aria2.getVersion')
    expect(Aria2Methods.GET_SESSION_INFO).toBe('aria2.getSessionInfo')
    expect(Aria2Methods.SHUTDOWN).toBe('aria2.shutdown')
    expect(Aria2Methods.FORCE_SHUTDOWN).toBe('aria2.forceShutdown')
    expect(Aria2Methods.SAVE_SESSION).toBe('aria2.saveSession')
    expect(Aria2Methods.MULTICALL).toBe('system.multicall')
  })
})
