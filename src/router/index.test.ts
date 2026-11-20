import { describe, it, expect, vi } from 'vitest'

interface CapturedRouterOptions {
  history: unknown
  routes: Array<{
    path: string
    name?: string
    redirect?: string
    props?: Record<string, unknown>
    component?: () => Promise<unknown>
  }>
}

const h = vi.hoisted(() => ({ options: null as unknown as CapturedRouterOptions, historyFactory: vi.fn() }))

vi.mock('vue-router', () => ({
  createWebHashHistory: () => {
    h.historyFactory()
    return 'hash-history'
  },
  createRouter: (options: CapturedRouterOptions) => {
    h.options = options
    return { options }
  }
}))

const router = (await import('./index')).default as unknown as { options: CapturedRouterOptions }
const routes = router.options.routes

function route(path: string) {
  const found = routes.find((item) => item.path === path)
  if (!found) throw new Error('路由不存在: ' + path)
  return found
}

describe('路由表', () => {
  it('使用 hash 路由（Electron 里没有服务器做 history 回退）', () => {
    expect(router.options.history).toBe('hash-history')
  })

  it('根路径重定向到下载页', () => {
    expect(route('/').redirect).toBe('/downloading')
  })

  it('旧的 /stopped 路径仍重定向到 /completed（外部深链不会 404）', () => {
    expect(route('/stopped').redirect).toBe('/completed')
  })

  it('下载页与完成页复用 TaskList，用 taskType 区分', () => {
    expect(route('/downloading').name).toBe('downloading')
    expect(route('/downloading').props).toEqual({ taskType: 'active-and-waiting' })
    expect(route('/completed').name).toBe('completed')
    expect(route('/completed').props).toEqual({ taskType: 'stopped' })
  })

  it('每个页面组件都是懒加载函数（首屏不必加载全部视图）', () => {
    const pageRoutes = routes.filter((item) => item.name)
    expect(pageRoutes.length).toBeGreaterThanOrEqual(8)
    for (const item of pageRoutes) {
      expect(typeof item.component).toBe('function')
    }
  })

  it('侧边栏可达的页面都有对应路由', () => {
    const expected = [
      '/downloading', '/completed', '/queue', '/status',
      '/instances', '/bt-insights', '/automation', '/workflow'
    ]
    for (const path of expected) {
      expect(routes.map((item) => item.path)).toContain(path)
    }
  })

  it('路由名唯一（重复名会让命名导航跳到错的页面）', () => {
    const names = routes.map((item) => item.name).filter((name): name is string => Boolean(name))
    expect(new Set(names).size).toBe(names.length)
  })
})
