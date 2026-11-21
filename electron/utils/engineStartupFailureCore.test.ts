/**
 * 引擎启动失败分类的单元测试。
 *
 * 这些断言锁的是「错误文案 → 建议动作」的映射：对话框按钮顺序、默认项与是否可重试
 * 都直接由这里决定，改动分类规则时测试会立刻报红。
 */
import { describe, expect, it } from 'vitest'
import {
  ENGINE_STARTUP_ACTION_LABELS,
  buildEngineStartupFailureInfo,
  classifyEngineStartupError,
  extractPortFromError
} from './engineStartupFailureCore'

describe('extractPortFromError', () => {
  it('从中文字错误文案里抠出端口', () => {
    expect(extractPortFromError('RPC 端口 6800 已被另一个 aria2 实例占用')).toBe(6800)
  })

  it('支持英文 port 写法', () => {
    expect(extractPortFromError('listen failed on port 16800')).toBe(16800)
  })

  it('没有端口或越界时返回 null', () => {
    expect(extractPortFromError('')).toBeNull()
    expect(extractPortFromError('Aria2 启动超时')).toBeNull()
    expect(extractPortFromError('port 99999')).toBeNull()
  })
})

describe('classifyEngineStartupError', () => {
  it('端口被别的 aria2 占用', () => {
    const error = new Error('RPC 端口 6800 已被另一个 aria2 实例占用（不认可本机密钥）')
    expect(classifyEngineStartupError(error)).toBe('port-occupied-other-aria2')
  })

  it('端口上是非 aria2 服务', () => {
    const error = new Error('RPC 端口 6800 上监听的服务不是 aria2（响应不是 JSON-RPC）')
    expect(classifyEngineStartupError(error)).toBe('port-non-aria2')
  })

  it('本应用遗留引擎未退出', () => {
    const error = new Error('RPC 端口 6800 上的遗留 aria2 实例未能退出，请手动结束残留的 aria2c 进程后重试')
    expect(classifyEngineStartupError(error)).toBe('leftover-engine')
  })

  it('端口被占但没有更细结论', () => {
    const error = new Error('Aria2 RPC 服务未就绪（端口 6800）。请检查该端口是否被其它程序占用')
    expect(classifyEngineStartupError(error)).toBe('port-in-use-unknown')
    expect(classifyEngineStartupError(new Error('listen EADDRINUSE'))).toBe('port-in-use-unknown')
  })

  it('可执行文件缺失或不可执行', () => {
    expect(classifyEngineStartupError(new Error('Aria2 可执行文件不存在: /opt/aria2c'))).toBe('missing-executable')
    expect(classifyEngineStartupError(new Error('可执行文件不可执行'))).toBe('missing-executable')
    expect(classifyEngineStartupError(new Error('spawn ENOENT'))).toBe('missing-executable')
  })

  it('配置文件读写异常', () => {
    expect(classifyEngineStartupError(new Error('配置文件同步验证失败'))).toBe('config-error')
    expect(classifyEngineStartupError(new Error('aria2 配置读取失败，已拒绝写入'))).toBe('config-error')
  })

  it('英文界面的错误文案同样能分类（文案表产出英文串）', () => {
    expect(
      classifyEngineStartupError(new Error('RPC port 6800 is already used by another aria2 instance that does not accept this app secret.'))
    ).toBe('port-occupied-other-aria2')
    expect(classifyEngineStartupError(new Error('The service listening on RPC port 6800 is not aria2 (its response is not JSON-RPC).'))).toBe(
      'port-non-aria2'
    )
    expect(classifyEngineStartupError(new Error('The leftover aria2 instance on RPC port 6800 did not exit'))).toBe('leftover-engine')
    expect(
      classifyEngineStartupError(
        new Error('The aria2 RPC service is not ready (port 6800). Check whether another program is using that port')
      )
    ).toBe('port-in-use-unknown')
    expect(classifyEngineStartupError(new Error('The aria2 executable does not exist: /opt/aria2c'))).toBe('missing-executable')
    expect(classifyEngineStartupError(new Error('Configuration file sync verification failed'))).toBe('config-error')
  })

  it('无法归类的错误落到 unknown', () => {
    expect(classifyEngineStartupError(new Error('Aria2 启动超时'))).toBe('unknown')
    expect(classifyEngineStartupError(undefined)).toBe('unknown')
    expect(classifyEngineStartupError('')).toBe('unknown')
  })
})

describe('buildEngineStartupFailureInfo', () => {
  it('端口冲突类优先给出「更换端口」并允许重试', () => {
    const info = buildEngineStartupFailureInfo(new Error('RPC 端口 6800 已被另一个 aria2 实例占用'))
    expect(info.kind).toBe('port-occupied-other-aria2')
    expect(info.actions[0]).toBe('change-port')
    expect(info.actions).toContain('retry')
    expect(info.retryable).toBe(true)
    expect(info.summary).toContain('6800')
  })

  it('遗留引擎类优先建议重试', () => {
    const info = buildEngineStartupFailureInfo(new Error('RPC 端口 6800 上的遗留 aria2 实例未能退出'))
    expect(info.kind).toBe('leftover-engine')
    expect(info.actions[0]).toBe('retry')
    expect(info.actions).toContain('change-port')
  })

  it('可执行文件缺失时不再宣传「重试」是首选', () => {
    const info = buildEngineStartupFailureInfo(new Error('Aria2 可执行文件不存在: aria2c'))
    expect(info.kind).toBe('missing-executable')
    expect(info.actions[0]).toBe('open-logs')
    expect(info.retryable).toBe(false)
  })

  it('portHint 覆盖错误文案里的端口', () => {
    // 错误文案里没写端口时，调用方（AppLifecycle）会把设置里的端口作为 hint 传进来
    const info = buildEngineStartupFailureInfo(new Error('请检查该端口是否被其它程序占用'), 16800)
    expect(info.kind).toBe('port-in-use-unknown')
    expect(info.summary).toContain('16800')
  })

  it('每个动作都有按钮文案', () => {
    const info = buildEngineStartupFailureInfo(new Error('boom'))
    for (const action of info.actions) {
      expect(ENGINE_STARTUP_ACTION_LABELS[action].length).toBeGreaterThan(0)
    }
    // 兜底路径必须允许用户继续使用应用（不能只有退出）
    expect(info.actions).toContain('continue')
  })
})

describe('英文界面的失败文案', () => {
  it('每类失败都给出英文 summary / hint，且带上端口标签', () => {
    const cases: Array<[Error, string]> = [
      [new Error('RPC port 6800 is already used by another aria2 instance that does not accept this app secret.'), 'port-occupied-other-aria2'],
      [new Error('The service listening on RPC port 6800 is not aria2'), 'port-non-aria2'],
      [new Error('The leftover aria2 instance on RPC port 6800 did not exit'), 'leftover-engine'],
      [new Error('The aria2 RPC service is not ready (port 6800). Check whether another program is using that port'), 'port-in-use-unknown'],
      [new Error('The aria2 executable does not exist: /opt/aria2c'), 'missing-executable'],
      [new Error('Configuration file sync verification failed'), 'config-error'],
      [new Error('boom'), 'unknown']
    ]
    for (const [error, kind] of cases) {
      const info = buildEngineStartupFailureInfo(error, undefined, 'en')
      expect(info.kind).toBe(kind)
      // 英文文案不能混进中文：中文界面的文案在英文环境下会露馅
      expect(/[\u4e00-\u9fa5]/.test(info.summary)).toBe(false)
      expect(/[\u4e00-\u9fa5]/.test(info.hint)).toBe(false)
      expect(info.summary.length).toBeGreaterThan(0)
      expect(info.hint.length).toBeGreaterThan(0)
    }
  })

  it('英文环境下端口标签用 "port N"，没有端口时用 "the current port"', () => {
    // 只有端口类失败的 summary 会带端口标签；unknown 类的 summary 是固定文案
    const withPort = buildEngineStartupFailureInfo(new Error('another program is using that port'), 7000, 'en')
    expect(withPort.kind).toBe('port-in-use-unknown')
    expect(withPort.summary).toContain('port 7000')
    const withoutPort = buildEngineStartupFailureInfo(new Error('another program is using that port'), undefined, 'en')
    expect(withoutPort.summary).toContain('the current port')
  })

  it('中文环境下同样给端口标签', () => {
    const withPort = buildEngineStartupFailureInfo(new Error('端口已被占用'), 7001, 'zh')
    expect(withPort.kind).toBe('port-in-use-unknown')
    expect(withPort.summary).toContain('端口 7001')
    const withoutPort = buildEngineStartupFailureInfo(new Error('端口已被占用'), undefined, 'zh')
    expect(withoutPort.summary).toContain('当前端口')
  })

  it('portHint 优先于错误文案里的端口（设置里的端口才是用户要改的那个）', () => {
    const info = buildEngineStartupFailureInfo(new Error('RPC 端口 6800 已被另一个 aria2 实例占用'), 9999, 'zh')
    expect(info.summary).toContain('9999')
    expect(info.summary).not.toContain('6800')
    // 没给 portHint 时才从错误文案里抠
    const fromMessage = buildEngineStartupFailureInfo(new Error('RPC 端口 6800 已被另一个 aria2 实例占用'))
    expect(fromMessage.summary).toContain('6800')
  })

  it('每类失败的中英文动作序列都一致（只有文案不同）', () => {
    const errors = [
      new Error('RPC 端口 6800 已被另一个 aria2 实例占用'),
      new Error('RPC 端口 6800 上监听的服务不是 aria2'),
      new Error('RPC 端口 6800 上的遗留 aria2 实例未能退出'),
      new Error('Aria2 RPC 服务未就绪（端口 6800）'),
      new Error('Aria2 可执行文件不存在: aria2c'),
      new Error('配置文件同步验证失败'),
      new Error('boom')
    ]
    for (const error of errors) {
      const zh = buildEngineStartupFailureInfo(error, 6800, 'zh')
      const en = buildEngineStartupFailureInfo(error, 6800, 'en')
      expect(en.actions).toEqual(zh.actions)
      expect(en.retryable).toBe(zh.retryable)
    }
  })
})
