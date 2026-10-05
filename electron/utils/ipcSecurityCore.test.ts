import { describe, expect, it } from 'vitest'
import { isSenderAuthorized, normalizeFileUrl, wrapSecureHandler, wrapSecureListener } from './ipcSecurityCore'

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

  it('生产环境：给出入口时与入口精确比对（本地其它 HTML 不再放行）', () => {
    const entry = 'file:///C:/app/resources/app.asar/dist/vue/index.html'

    // 入口本身：必须放行——否则整个应用的 IPC 会被自己的加固锁死
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: entry, isPackaged: true, allowedFileUrl: entry
    })).toBe(true)
    // 哈希路由（vue-router）与查询串不影响判定
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: `${entry}#/downloading`, isPackaged: true, allowedFileUrl: entry
    })).toBe(true)
    // 盘符大小写与百分号编码差异不影响判定（loadFile 与 pathToFileURL 可能不同）
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'file:///c:/app/resources/app.asar/dist/vue/index.html', isPackaged: true,
      allowedFileUrl: 'file:///C:/app/resources/app.asar/dist/vue/index.html'
    })).toBe(process.platform === 'win32')
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'file:///C:/app%20dir/dist/vue/index.html', isPackaged: true,
      allowedFileUrl: 'file:///C:/app dir/dist/vue/index.html'
    })).toBe(true)

    // 同一目录下的其它文件（应用自身的前端产物）：放行——只比对入口文件过于脆弱，
    // URL 形态的细微差异会让生产环境 IPC 全部失效；而能写入安装目录的攻击者本就能替换入口
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'file:///C:/app/resources/app.asar/dist/vue/other.html', isPackaged: true,
      allowedFileUrl: entry, allowedFileDirUrl: 'file:///C:/app/resources/app.asar/dist/vue'
    })).toBe(true)

    // 但应用目录**之外**的本地页面必须拒绝（这才是要挡的风险场景）
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'file:///C:/Users/x/Downloads/evil.html', isPackaged: true,
      allowedFileUrl: entry, allowedFileDirUrl: 'file:///C:/app/resources/app.asar/dist/vue'
    })).toBe(false)
    // 上级目录、以及另一个 asar 里的页面同样拒绝
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'file:///C:/app/resources/app.asar/dist/index.html', isPackaged: true,
      allowedFileUrl: entry, allowedFileDirUrl: 'file:///C:/app/resources/app.asar/dist/vue'
    })).toBe(false)
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'file:///C:/other/resources/app.asar/dist/vue/index.html', isPackaged: true,
      allowedFileUrl: entry, allowedFileDirUrl: 'file:///C:/app/resources/app.asar/dist/vue'
    })).toBe(false)
  })

  it('生产环境：未给出入口时回退为"任意 file://"（拿不到入口路径不能锁死应用）', () => {
    expect(isSenderAuthorized({
      ...MAIN_WINDOW, senderUrl: 'file:///anywhere/index.html', isPackaged: true, allowedFileUrl: undefined
    })).toBe(true)
  })
})

describe('normalizeFileUrl', () => {
  it('去除 hash 与 query、解码百分号编码、统一分隔符', () => {
    expect(normalizeFileUrl('file:///C:/a/b/index.html#/route?x=1')).toBe(
      normalizeFileUrl('file:///C:/a/b/index.html')
    )
    expect(normalizeFileUrl('file:///C:/a%20b/index.html')).toBe(normalizeFileUrl('file:///C:/a b/index.html'))
    expect(normalizeFileUrl('file:///C:/a\\b/index.html')).toBe(normalizeFileUrl('file:///C:/a/b/index.html'))
  })

  it('非法输入原样返回（不抛错）', () => {
    expect(normalizeFileUrl('not a url')).toBe('not a url')
    expect(normalizeFileUrl('')).toBe('')
  })

  it('file:// 的两种合法写法归一为同一路径（判错会让整个应用 IPC 失效）', () => {
    // 盘符落在 host 段的写法与三斜杠写法必须等价
    expect(normalizeFileUrl('file://C:/app/dist/vue/index.html')).toBe(
      normalizeFileUrl('file:///C:/app/dist/vue/index.html')
    )
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
