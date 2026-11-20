#!/usr/bin/env node
/**
 * 插件注册表发布前校验：确认「客户端拿到的那份 registry 会被接受」。
 *
 * 背景：v1.5.0 起客户端（electron/services/pluginMarketService.ts）在注册表非空时必须
 * 能用内置公钥验签，验不过就整份列表拒绝（D-02）。但签名只靠人工流程
 * （sign-registry.mjs），CI 里没有任何一步验证「tag 下那份注册表确实签对了」——
 * 私钥只在维护者本机，签错 / 忘签 / 签完又改内容，都要等用户装上才发现市场是空的。
 *
 * 默认只做离线校验（无网络依赖，CI 可跑）：
 *   1. 结构校验（复用 sign-registry.mjs 的 validateRegistry）；
 *   2. 非空清单必须能被 DEFAULT_TRUSTED_PLUGIN_PUBLISHERS 验签通过；空清单免签
 *      （与客户端 pluginMarketService.list 的口径一致：无条目就无代码可装）；
 *   3. PLUGIN_REGISTRY_PINNED_TAG 必须等于 package.json 版本的 v 前缀形式——
 *      版本升了 tag 忘了改，用户会拉到上一版的注册表。
 *
 * 加 --online 额外拉取 tag 下已发布的注册表，比对签名载荷逐字节一致（发版前用）。
 *
 * 用法：
 *   npm run verify:registry              # 离线校验（CI 用）
 *   npm run verify:registry -- --online  # 加做已发布内容比对（发版前用）
 *   npm run verify:registry -- --file other.json --timeout 60000
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PLUGIN_REGISTRY_URL,
  DEFAULT_TRUSTED_PLUGIN_PUBLISHERS,
  PLUGIN_REGISTRY_PINNED_TAG
} from '../../src/shared/appSettings.ts'
import { registryPayload, validateRegistry, verifyRegistrySignature } from './sign-registry.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

/** 注册表固定 tag 应当等于 package.json 版本的 v 前缀形式 */
export function expectedTagForVersion(version) {
  return 'v' + String(version || '').trim()
}

/**
 * 校验一份注册表能否被客户端接受。
 * 返回 { ok, error?, empty, signed }，error 为稳定标识，便于测试断言。
 */
export function inspectRegistry(registry, trustedPublishers = DEFAULT_TRUSTED_PLUGIN_PUBLISHERS) {
  const shape = validateRegistry(registry)
  if (!shape.ok) return { ok: false, error: shape.error, empty: false, signed: false }
  const plugins = Array.isArray(registry.plugins) ? registry.plugins : []
  const signed = typeof registry.signature === 'string' && registry.signature.length > 0
  const verified = signed
    ? trustedPublishers.some(publicKey => verifyRegistrySignature(registry, publicKey))
    : false
  if (plugins.length === 0) {
    // 空清单免签；但若带了签名，签错说明维护者流程出了问题，同样报错。
    if (!signed || verified) return { ok: true, empty: true, signed }
    return { ok: false, error: 'REGISTRY_SIGNATURE_INVALID', empty: true, signed }
  }
  if (!signed) return { ok: false, error: 'REGISTRY_UNSIGNED', empty: false, signed }
  if (!verified) return { ok: false, error: 'REGISTRY_SIGNATURE_INVALID', empty: false, signed }
  return { ok: true, empty: false, signed }
}

/** 两份注册表的「参与签名的载荷」是否一致（忽略 signature 与 JSON 格式差异） */
export function payloadsMatch(a, b) {
  return registryPayload(a).equals(registryPayload(b))
}

function parseArgs(argv) {
  const options = {
    online: false,
    timeout: 30000,
    file: path.join(repoRoot, 'plugin-registry.json'),
    url: DEFAULT_PLUGIN_REGISTRY_URL
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--online') options.online = true
    else if (arg === '--file') options.file = path.resolve(argv[++i])
    else if (arg === '--url') options.url = argv[++i]
    else if (arg === '--timeout') options.timeout = Number(argv[++i]) || options.timeout
  }
  return options
}

/** 拉取已发布注册表；raw.githubusercontent 偶发连接超时，重试三次 */
async function fetchPublishedRegistry(url, timeoutMs, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return JSON.parse(await response.text())
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

export async function main(argv) {
  const options = parseArgs(argv)
  const failures = []

  let registry
  try {
    registry = JSON.parse(fs.readFileSync(options.file, 'utf8'))
  } catch (error) {
    console.error('✗ 无法解析 ' + options.file + ': ' + error.message)
    return 1
  }

  const inspected = inspectRegistry(registry)
  if (inspected.ok) {
    console.log(inspected.empty
      ? '✓ 结构合法；空清单（无条目可安装，免签）'
      : '✓ 结构合法；非空清单签名可被内置公钥验证')
  } else {
    failures.push('注册表校验失败: ' + inspected.error)
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const expectedTag = expectedTagForVersion(pkg.version)
  if (PLUGIN_REGISTRY_PINNED_TAG === expectedTag) {
    console.log('✓ 固定 tag 与 package.json 版本一致（' + expectedTag + '）')
  } else {
    failures.push('固定 tag 与版本不一致: PLUGIN_REGISTRY_PINNED_TAG=' + PLUGIN_REGISTRY_PINNED_TAG +
      '，package.json=' + pkg.version + '（期望 ' + expectedTag + '）')
  }

  if (!options.online) {
    console.log('· 未指定 --online，跳过已发布注册表的网络比对')
  } else {
    try {
      const published = await fetchPublishedRegistry(options.url, options.timeout)
      const publishedInspect = inspectRegistry(published)
      if (!publishedInspect.ok) {
        failures.push('已发布注册表无法被客户端接受: ' + publishedInspect.error + '（' + options.url + '）')
      } else if (payloadsMatch(published, registry)) {
        console.log('✓ 已发布注册表与仓库文件内容一致（' + options.url + '）')
      } else {
        failures.push('已发布注册表与仓库文件内容不一致（' + options.url + '）：tag 不可变，改了注册表就必须发新版本')
      }
    } catch (error) {
      failures.push('无法拉取已发布注册表（' + options.url + '）: ' + (error && error.message) + '；网络受限时先离线校验')
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error('✗ ' + failure)
    return 1
  }
  console.log('插件注册表校验通过')
  return 0
}

// 仅在被直接执行时跑 CLI，被测试 import 时不触发
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href) {
  process.exitCode = await main(process.argv.slice(2))
}
