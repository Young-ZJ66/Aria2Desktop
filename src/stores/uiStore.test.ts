import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from './uiStore'

describe('uiStore 设置弹窗关闭守卫', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('注册守卫后 requestCloseSettings 交给守卫处理，不直接关闭', () => {
    const store = useUiStore()
    const guard = vi.fn()
    store.registerSettingsCloseGuard(guard)
    store.openSettings()

    store.requestCloseSettings()

    expect(guard).toHaveBeenCalledTimes(1)
    expect(store.showSettings).toBe(true)
  })

  it('没有守卫时回退为直接关闭', () => {
    const store = useUiStore()
    store.openSettings()

    store.requestCloseSettings()

    expect(store.showSettings).toBe(false)
  })
})
