#!/usr/bin/env node
/**
 * 生产依赖漏洞闸门：`npm audit --omit=dev` 必须为 0。
 *
 * 为什么单独写一个脚本而不是直接在 package.json 里调 `npm audit`：
 * 父级 `npm run` 会把 .npmrc 的 `allow-scripts` 以 `npm_config_allow_scripts` 环境变量
 * 传进子进程，嵌套的 npm 会因此报 EALLOWSCRIPTS 直接失败（与漏洞本身无关）。
 * 这里先把这个变量摘掉，再跑一次 npm audit --json，按 JSON 判定，
 * 不依赖 npm 自己的退出码约定（它在只读/离线等情形下也会给非零）。
 *
 * 用法：
 *   npm run verify:audit
 *   node scripts/verify-audit.mjs
 */

import { spawnSync } from 'node:child_process'
import process from 'node:process'

/**
 * 去掉会让嵌套 npm 报 EALLOWSCRIPTS 的变量。
 * 只摘这一个：其它 npm_config_* 可能承载用户有意设置的 registry / 代理。
 */
export function buildAuditEnv(base = process.env) {
  const env = { ...base }
  delete env.npm_config_allow_scripts
  delete env.NPM_CONFIG_ALLOW_SCRIPTS
  return env
}

/**
 * 把 `npm audit --json` 的报告折算成判定结果。
 * report 为 null/非法（例如 npm 崩了、输出被截断）时 ok=false，避免"读不到就当没事"。
 */
export function summarizeAudit(report) {
  const counts = report?.metadata?.vulnerabilities
  if (!counts) {
    return { ok: false, reason: 'missing-metadata', total: 0, summary: '', lines: [] }
  }
  const total = counts.total || 0
  const summary = `critical ${counts.critical} / high ${counts.high} / moderate ${counts.moderate} / low ${counts.low} / info ${counts.info}`
  const lines = []
  for (const [name, item] of Object.entries(report.vulnerabilities || {})) {
    const via = (item.via || []).map(v => (typeof v === 'string' ? v : v.title)).join(' | ')
    lines.push(`  - ${name} [${item.severity}] ${via}`)
  }
  return { ok: total === 0, reason: total === 0 ? 'clean' : 'vulnerable', total, summary, lines }
}

export function main() {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    env: buildAuditEnv(),
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })

  if (result.error) {
    console.error(`✗ 无法执行 npm audit：${result.error.message}`)
    return 1
  }

  let report = null
  try {
    report = JSON.parse(result.stdout || '{}')
  } catch {
    console.error('✗ npm audit 输出不是合法 JSON，无法判定')
    console.error((result.stdout || '').slice(0, 2000))
    return 1
  }

  const verdict = summarizeAudit(report)
  if (verdict.reason === 'missing-metadata') {
    console.error('✗ npm audit 输出缺少 metadata.vulnerabilities，无法判定')
    console.error((result.stderr || '').slice(0, 2000))
    return 1
  }
  if (verdict.ok) {
    console.log(`✓ 生产依赖无已知漏洞（${verdict.summary}）`)
    return 0
  }
  console.error(`✗ 生产依赖存在 ${verdict.total} 个已知漏洞（${verdict.summary}）`)
  for (const line of verdict.lines) console.error(line)
  return 1
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href) {
  process.exit(main())
}
