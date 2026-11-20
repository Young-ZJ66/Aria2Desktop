import { describe, expect, it } from 'vitest'

import { buildAuditEnv, summarizeAudit } from './verify-audit.mjs'

describe('生产依赖漏洞闸门', () => {
  it('摘掉 allow-scripts 变量（否则嵌套 npm 会报 EALLOWSCRIPTS）', () => {
    const env = buildAuditEnv({ npm_config_allow_scripts: 'opencode-ai', NPM_CONFIG_ALLOW_SCRIPTS: 'x', PATH: '/bin' })
    expect(env.npm_config_allow_scripts).toBeUndefined()
    expect(env.NPM_CONFIG_ALLOW_SCRIPTS).toBeUndefined()
    // 其它变量必须原样保留，不能顺手清掉 registry / 代理
    expect(env.PATH).toBe('/bin')
  })

  it('不动传入对象本身', () => {
    const base = { npm_config_allow_scripts: 'x' }
    buildAuditEnv(base)
    expect(base.npm_config_allow_scripts).toBe('x')
  })

  it('0 漏洞判通过并给出计数摘要', () => {
    const verdict = summarizeAudit({
      metadata: { vulnerabilities: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 } },
      vulnerabilities: {}
    })
    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toBe('clean')
    expect(verdict.summary).toContain('critical 0')
  })

  it('有漏洞判失败并逐项列出 via', () => {
    const verdict = summarizeAudit({
      metadata: { vulnerabilities: { total: 1, critical: 0, high: 1, moderate: 0, low: 0, info: 0 } },
      vulnerabilities: {
        'some-pkg': { severity: 'high', via: ['ghsa-1', { title: 'ReDoS in foo' }] }
      }
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('vulnerable')
    expect(verdict.total).toBe(1)
    expect(verdict.lines.join('\n')).toContain('some-pkg [high] ghsa-1 | ReDoS in foo')
  })

  it('报告缺 metadata 时不当作通过（读不到不等于没问题）', () => {
    expect(summarizeAudit({}).ok).toBe(false)
    expect(summarizeAudit(null).reason).toBe('missing-metadata')
  })
})
