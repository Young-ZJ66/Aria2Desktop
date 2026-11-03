import { describe, expect, it } from 'vitest'
import {
  buildConnectionFailureMessage,
  isLoopbackLiteral,
  shouldSuggestProxyHint
} from './connectionDiagnostics'

describe('isLoopbackLiteral', () => {
  it.each([
    ['127.0.0.1', true],
    [' 127.0.0.1 ', true],
    ['127.0.0.1.', false],
    ['[::1]', true],
    ['::1', true],
    ['localhost', false],
    ['192.168.1.1', false],
    ['', false]
  ])('isLoopbackLiteral(%j) → %j', (host, expected) => {
    expect(isLoopbackLiteral(host)).toBe(expected)
  })
})

describe('shouldSuggestProxyHint', () => {
  it('环回 IP + 网络层失败 → 建议', () => {
    expect(shouldSuggestProxyHint({ host: '127.0.0.1', errorMessage: 'HTTP Error: Failed to fetch' })).toBe(true)
  })

  it('环回 IP + ECONNREFUSED → 建议', () => {
    expect(shouldSuggestProxyHint({ host: '127.0.0.1', errorMessage: 'connect ECONNREFUSED 127.0.0.1:6800' })).toBe(true)
  })

  it('密钥错误（Unauthorized）不是网络失败 → 不建议', () => {
    expect(shouldSuggestProxyHint({ host: '127.0.0.1', errorMessage: 'Aria2 RPC Error (1): Unauthorized' })).toBe(false)
  })

  it('主机是 localhost → 不建议（本就未被拦）', () => {
    expect(shouldSuggestProxyHint({ host: 'localhost', errorMessage: 'Failed to fetch' })).toBe(false)
  })

  it('非环回 IP → 不建议', () => {
    expect(shouldSuggestProxyHint({ host: '192.168.1.10', errorMessage: 'ETIMEDOUT' })).toBe(false)
  })
})

describe('buildConnectionFailureMessage', () => {
  it('命中时在基础消息后追加提示', () => {
    const message = buildConnectionFailureMessage({
      host: '127.0.0.1',
      error: new Error('HTTP Error: Failed to fetch'),
      baseMessage: '无法连接到服务器',
      proxyHint: '试试 localhost'
    })
    expect(message).toBe('无法连接到服务器\n试试 localhost')
  })

  it('未命中时原样返回基础消息', () => {
    const message = buildConnectionFailureMessage({
      host: 'localhost',
      error: new Error('HTTP Error: Failed to fetch'),
      baseMessage: '无法连接到服务器',
      proxyHint: '试试 localhost'
    })
    expect(message).toBe('无法连接到服务器')
  })

  it('提示为空时原样返回基础消息', () => {
    const message = buildConnectionFailureMessage({
      host: '127.0.0.1',
      error: 'Failed to fetch',
      baseMessage: '无法连接到服务器',
      proxyHint: ''
    })
    expect(message).toBe('无法连接到服务器')
  })

  it('错误是字符串时同样参与判定', () => {
    const message = buildConnectionFailureMessage({
      host: '127.0.0.1',
      error: 'Failed to fetch',
      baseMessage: '连接失败',
      proxyHint: '试试 localhost'
    })
    expect(message).toBe('连接失败\n试试 localhost')
  })
})
