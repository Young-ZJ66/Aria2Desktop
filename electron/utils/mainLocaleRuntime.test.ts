import { describe, expect, it, vi } from 'vitest'

// mainLocaleRuntime 是「主进程当前语言」的唯一 electron 依赖点。
// 它的存在意义是：拿不到语言时退中文而不是抛错——历史中文断言全靠这条。
const state = vi.hoisted(() => ({ locale: 'zh-CN' as string | undefined, throwOnGet: false }))

vi.mock('electron', () => ({
  app: {
    getLocale: () => {
      if (state.throwOnGet) throw new Error('app 未就绪')
      return state.locale
    }
  }
}))

const { runtimeMainLocale } = await import('./mainLocaleRuntime')

describe('runtimeMainLocale', () => {
  it('系统语言为中文时返回 zh', () => {
    state.locale = 'zh-CN'
    state.throwOnGet = false
    expect(runtimeMainLocale()).toBe('zh')
  })

  it('系统语言为英文时返回 en', () => {
    state.locale = 'en-US'
    state.throwOnGet = false
    expect(runtimeMainLocale()).toBe('en')
  })

  it('app.getLocale 抛错时退回中文（不把异常抛给调用方）', () => {
    state.throwOnGet = true
    expect(runtimeMainLocale()).toBe('zh')
    state.throwOnGet = false
  })

  it('app.getLocale 返回空串时退回中文', () => {
    state.locale = ''
    state.throwOnGet = false
    expect(runtimeMainLocale()).toBe('zh')
  })
})
