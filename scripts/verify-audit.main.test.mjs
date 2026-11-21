import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  plan: []
}))

vi.mock('node:child_process', () => ({
  spawnSync: (command, args, options) => {
    const entry = h.plan.shift() || { status: 0, stdout: '{}', stderr: '' }
    return { ...entry, args, options, command }
  }
}))

const { main } = await import('./verify-audit.mjs')

const CLEAN = JSON.stringify({
  metadata: { vulnerabilities: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 } },
  vulnerabilities: {}
})

let logs
let errors

beforeEach(() => {
  h.plan = []
  logs = []
  errors = []
  vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')))
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.npm_config_allow_scripts
})

describe('verify-audit 入口', () => {
  it('干净报告返回 0 并打印计数摘要', () => {
    h.plan.push({ status: 0, stdout: CLEAN, stderr: '' })
    expect(main()).toBe(0)
    expect(logs.join('\n')).toContain('生产依赖无已知漏洞')
    expect(logs.join('\n')).toContain('critical 0')
  })

  it('有漏洞返回 1 并逐项列出包名与来源', () => {
    h.plan.push({
      status: 1,
      stdout: JSON.stringify({
        metadata: { vulnerabilities: { total: 1, critical: 0, high: 1, moderate: 0, low: 0, info: 0 } },
        vulnerabilities: { 'bad-pkg': { severity: 'high', via: ['GHSA-xxxx'] } }
      }),
      stderr: ''
    })
    expect(main()).toBe(1)
    expect(errors.join('\n')).toContain('生产依赖存在 1 个已知漏洞')
    expect(errors.join('\n')).toContain('bad-pkg [high] GHSA-xxxx')
  })

  it('npm 执行失败时返回 1 并带出原因', () => {
    h.plan.push({ status: null, stdout: '', stderr: '', error: new Error('spawn npm ENOENT') })
    expect(main()).toBe(1)
    expect(errors.join('\n')).toContain('无法执行 npm audit')
    expect(errors.join('\n')).toContain('spawn npm ENOENT')
  })

  it('输出不是合法 JSON 时返回 1 并截断打印原文', () => {
    h.plan.push({ status: 0, stdout: 'not-json-at-all', stderr: '' })
    expect(main()).toBe(1)
    expect(errors.join('\n')).toContain('不是合法 JSON')
    expect(errors.join('\n')).toContain('not-json-at-all')
  })

  it('缺少 metadata.vulnerabilities 时不当作通过', () => {
    h.plan.push({ status: 0, stdout: JSON.stringify({ vulnerabilities: {} }), stderr: 'npm warn' })
    expect(main()).toBe(1)
    expect(errors.join('\n')).toContain('缺少 metadata.vulnerabilities')
    expect(errors.join('\n')).toContain('npm warn')
  })

  it('空 stdout 按空对象处理，判为无法判定', () => {
    h.plan.push({ status: 0, stdout: '', stderr: '' })
    expect(main()).toBe(1)
    expect(errors.join('\n')).toContain('缺少 metadata.vulnerabilities')
  })
})
