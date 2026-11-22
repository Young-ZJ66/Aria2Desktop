import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { runtimeMainLocale, setRuntimeLocaleProvider } = await import('./mainLocaleRuntime')

describe('runtimeMainLocale', () => {
  beforeEach(() => setRuntimeLocaleProvider(null))

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

  it('应用设置里的语言优先于系统语言（英文界面在中文系统上不再出中文通知）', () => {
    state.locale = 'zh-CN'
    setRuntimeLocaleProvider(() => 'en-US')
    expect(runtimeMainLocale()).toBe('en')
  })

  it('应用设置为中文时即使系统是英文也返回 zh', () => {
    state.locale = 'en-US'
    setRuntimeLocaleProvider(() => 'zh-CN')
    expect(runtimeMainLocale()).toBe('zh')
  })

  it('其余 19 种语言在主进程统一按英文处理', () => {
    state.locale = 'zh-CN'
    setRuntimeLocaleProvider(() => 'ja-JP')
    expect(runtimeMainLocale()).toBe('en')
  })

  it('provider 抛错时退回系统语言', () => {
    state.locale = 'en-US'
    setRuntimeLocaleProvider(() => { throw new Error('settings 未绑定') })
    expect(runtimeMainLocale()).toBe('en')
  })

  it('provider 返回空串时退回系统语言', () => {
    state.locale = 'en-US'
    setRuntimeLocaleProvider(() => '')
    expect(runtimeMainLocale()).toBe('en')
  })
})
