import { describe, expect, it } from 'vitest'
import { isSenderAuthorized, wrapSecureHandler, wrapSecureListener } from './ipcSecurityCore'

/**
 * IPC 来源判定是安全边界（决定哪些页面/进程能调用主进程 IPC）。
 * 这段逻辑此前埋在 `ipcSecurity.ts` 里（顶层 import electron），单测无法加载，
 * 因此长期缺少覆盖。本文件把"判定口径"与"失败的包裹语义"都锁死：
 * 任何放宽（例如把 origin 精确匹配改成前缀匹配）都必须先改这里。
 */

const MAIN_WINDOW = { isMainWindow: true }

describe('isSenderAuthorized', () => {
  it('非主窗口一律拒绝（即使页面来源合法）', () => {
    expect(isSenderAuthorized({
      isMainWindow: false, senderUrl: 'file:///app/index.html', isPackaged: true
    })).toBe(false)
    expect(isSenderAuthorized({
      isMainWindow: false, senderUrl: 'http://localhost:5173/', isPackaged: false
    })).toBe(false)
  })

  it('开发环境：精确命中所允许的 dev server origin', () => {
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'http://localhost:5173/', isPackaged: false
    })).toBe(true)
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'http://127.0.0.1:5173/index.html', isPackaged: false
    })).toBe(true)
  })

  it('开发环境：拒绝域名前缀碰撞、协议不符与端口不符', () => {
    // 以下是真实存在的绕过手法：origin 必须精确比较，不能 startsWith
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'http://localhost:5173.evil.com/', isPackaged: false
    })).toBe(false)
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'https://localhost:5173/', isPackaged: false
    })).toBe(false)
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'http://localhost:5174/', isPackaged: false
    })).toBe(false)
  })

  it('开发环境：非法 URL 一律拒绝', () => {
    expect(isSenderAuthorized({ ...MAIN_WINDOW, senderUrl: '', isPackaged: false })).toBe(false)
    expect(isSenderAuthorized({ ...MAIN_WINDOW, senderUrl: 'not a url', isPackaged: false })).toBe(false)
  })

  it('生产环境：只接受 file:// 页面', () => {
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'file:///C:/app/resources/app.asar/dist/vue/index.html', isPackaged: true
    })).toBe(true)
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'http://localhost:5173/', isPackaged: true
    })).toBe(false)
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'https://evil.example/', isPackaged: true
    })).toBe(false)
  })
})

describe('wrapSecureHandler', () => {
  const always = () => true
  const never = () => false

  it('来源不可信时返回指定值，且不执行 handler', () => {
    let called = false
    const wrapped = wrapSecureHandler((_event: string, _n: number) => {
      called = true
      return 'ok'
    }, never, '')
    expect(wrapped('evt', 1)).toBe('')
    expect(called).toBe(false)
  })

  it('来源可信时原样透传参数与返回值（含多参数）', () => {
    const wrapped = wrapSecureHandler(
      (_event: string, a: number, b: string, c: boolean) => ({ a, b, c }),
      always,
      null
    )
    expect(wrapped('evt', 1, 'x', true)).toEqual({ a: 1, b: 'x', c: true })
  })

  it('失败值支持任意形态（undefined / 对象 / 数组）', () => {
    expect(wrapSecureHandler(() => 'ok', never, undefined)('evt')).toBeUndefined()
    expect(wrapSecureHandler(() => 'ok', never, { canceled: true })('evt')).toEqual({ canceled: true })
    expect(wrapSecureHandler(() => 'ok', never, [])('evt')).toEqual([])
  })

  it('异步 handler 的结果同样被透传', async () => {
    const wrapped = wrapSecureHandler(async (_event: string) => 'done', always, '')
    await expect(wrapped('evt')).resolves.toBe('done')
  })
})

describe('wrapSecureListener', () => {
  it('来源不可信时丢弃本次调用', () => {
    let calls = 0
    const wrapped = wrapSecureListener((_event: string) => { calls += 1 }, () => false)
    wrapped('evt')
    expect(calls).toBe(0)
  })

  it('来源可信时执行并透传参数', () => {
    const seen: Array<[string, number]> = []
    const wrapped = wrapSecureListener((event: string, n: number) => { seen.push([event, n]) }, () => true)
    wrapped('evt', 7)
    expect(seen).toEqual([['evt', 7]])
  })
})
