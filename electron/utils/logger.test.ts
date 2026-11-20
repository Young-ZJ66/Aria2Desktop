import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'node:path'

// logger 是 electron-log 的薄封装，价值全在「前缀怎么拼」「重复初始化会不会重复配置」这两点，
// 所以这里把 electron-log 换成一个记录调用的假对象来断言。
const log = vi.hoisted(() => {
  const file = { path: 'E:\\data\\logs\\main.log' }
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: {
      file: {
        level: 'silly',
        maxSize: 0,
        resolvePathFn: undefined as undefined | ((variables: Record<string, string>) => string),
        getFile: () => file
      },
      console: { level: 'silly' }
    }
  }
})

vi.mock('electron-log/main', () => ({ default: log }))
vi.mock('./appEnv', () => ({ isDevMode: false, isPackagedApp: true }))

const { createLogger, getLogFilePaths, setupLogging } = await import('./logger')

beforeEach(() => {
  log.info.mockClear()
  log.warn.mockClear()
  log.error.mockClear()
  log.debug.mockClear()
})

describe('createLogger', () => {
  it('把模块名拼成固定前缀（与项目既有日志风格一致）', () => {
    createLogger('WindowController').info('窗口已创建')
    expect(log.info).toHaveBeenCalledWith('[WindowController] 窗口已创建')
  })

  it('四个级别都带前缀', () => {
    const logger = createLogger('Engine')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(log.debug).toHaveBeenCalledWith('[Engine] d')
    expect(log.info).toHaveBeenCalledWith('[Engine] i')
    expect(log.warn).toHaveBeenCalledWith('[Engine] w')
    expect(log.error).toHaveBeenCalledWith('[Engine] e')
  })

  it('附加参数原样透传（对象/错误不被字符串化）', () => {
    const error = new Error('boom')
    createLogger('Engine').error('启动失败', error)
    expect(log.error).toHaveBeenCalledWith('[Engine] 启动失败', error)
  })

  it('scope 为空时不加前缀（历史文案自带前缀的模块依赖这点避免重复）', () => {
    createLogger('').info('[ResourceManager] 路径已解析')
    expect(log.info).toHaveBeenCalledWith('[ResourceManager] 路径已解析')
  })
})

describe('setupLogging', () => {
  it('文件级别固定 info、5MB 轮转（用户报障要能回溯完整流程）', () => {
    setupLogging()
    expect(log.transports.file.level).toBe('info')
    expect(log.transports.file.maxSize).toBe(5 * 1024 * 1024)
  })

  it('生产态控制台只留 warn（避免刷屏）', () => {
    setupLogging()
    expect(log.transports.console.level).toBe('warn')
  })

  it('日志固定写到 userData/logs 下（macOS 默认路径不同，必须显式覆盖）', () => {
    setupLogging()
    const resolve = log.transports.file.resolvePathFn!
    expect(resolve({ userData: path.join(path.sep, 'data'), fileName: 'main.log' } as never)).toBe(
      path.join(path.sep, 'data', 'logs', 'main.log')
    )
  })

  it('未传 fileName 时回落到 main.log', () => {
    setupLogging()
    const resolved = log.transports.file.resolvePathFn!({ userData: '/data' } as never)
    expect(resolved.endsWith('main.log')).toBe(true)
  })

  it('重复调用只初始化一次（不重复写配置与初始化日志）', () => {
    setupLogging()
    const firstCallCount = log.info.mock.calls.length
    setupLogging()
    setupLogging()
    expect(log.info.mock.calls.length).toBe(firstCallCount)
  })
})

describe('getLogFilePaths', () => {
  it('返回文件绝对路径与所在目录（设置页「打开日志目录」直接用它，不自己拼）', () => {
    const result = getLogFilePaths()
    expect(result.file).toBe('E:\\data\\logs\\main.log')
    expect(result.dir).toBe('E:\\data\\logs')
  })
})
