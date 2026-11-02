import { describe, expect, it, vi } from 'vitest'
import { removeFromEngine, type TaskRemovalService } from './taskRemovalCore'

const gid = '2089b05ecca3d829'

function serviceWith(overrides: Partial<TaskRemovalService>): TaskRemovalService {
  return {
    removeDownloadResult: vi.fn(async () => 'OK'),
    remove: vi.fn(async () => 'OK'),
    ...overrides
  }
}

describe('从引擎里摘掉任务', () => {
  it('removeDownloadResult 成功就算删掉了，不再调 remove', async () => {
    const service = serviceWith({})
    const outcome = await removeFromEngine(service, gid)

    expect(outcome).toEqual({ ok: true })
    expect(service.removeDownloadResult).toHaveBeenCalledWith(gid)
    expect(service.remove).not.toHaveBeenCalled()
  })

  it('下载结果删不掉时退回 remove（任务还在活动列表里的情况）', async () => {
    const service = serviceWith({
      removeDownloadResult: vi.fn(async () => {
        throw new Error('RPC Error: Cannot remove download result')
      })
    })
    const outcome = await removeFromEngine(service, gid)

    expect(outcome).toEqual({ ok: true })
    expect(service.remove).toHaveBeenCalledWith(gid)
  })

  it('两个接口都失败但引擎里查不到这个任务：视为已经删掉（引擎重启后的常态）', async () => {
    const service = serviceWith({
      removeDownloadResult: vi.fn(async () => {
        throw new Error('RPC Error: GID 2089b05ecca3d829 is not found')
      }),
      remove: vi.fn(async () => {
        throw new Error('RPC Error: GID 2089b05ecca3d829 is not found')
      }),
      tellStatus: vi.fn(async () => {
        throw new Error('RPC Error: GID 2089b05ecca3d829 is not found')
      })
    })

    expect(await removeFromEngine(service, gid)).toEqual({ ok: true })
    expect(service.tellStatus).toHaveBeenCalledWith(gid)
  })

  it('两个接口都失败、任务却还在引擎里：不能报成功，否则删了又回来', async () => {
    const service = serviceWith({
      removeDownloadResult: vi.fn(async () => {
        throw new Error('RPC Error: timeout')
      }),
      remove: vi.fn(async () => {
        throw new Error('RPC Error: timeout')
      }),
      tellStatus: vi.fn(async () => ({ gid, status: 'complete' }))
    })

    const outcome = await removeFromEngine(service, gid)

    expect(outcome.ok).toBe(false)
    expect(String((outcome as { error: unknown }).error)).toContain('timeout')
  })

  it('注入方没有 tellStatus 时保持旧行为（视为已删除），不因为接口缺省就报错', async () => {
    const service = serviceWith({
      removeDownloadResult: vi.fn(async () => {
        throw new Error('boom')
      }),
      remove: vi.fn(async () => {
        throw new Error('boom')
      })
    })

    expect(await removeFromEngine(service, gid)).toEqual({ ok: true })
  })
})
