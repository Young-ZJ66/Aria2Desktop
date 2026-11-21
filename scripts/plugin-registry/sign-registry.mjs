#!/usr/bin/env node
/**
 * 插件注册表（plugin-registry.json）签名与校验工具。
 *
 * 背景：客户端默认从固定 tag 拉取 registry，但"从哪个 URL 拉"只能防替换地址，
 * 防不了 registry 内容被篡改（仓库被接管、CDN 被劫持）。因此 registry 本身也带
 * Ed25519 签名：维护者用私钥签名，客户端用内置公钥校验，签名不通过直接拒绝整个列表。
 *
 * 规范（客户端必须一致实现，否则签名对不上）：
 *   - 参与签名的载荷 = registry 去掉 signature 字段后的**规范化 JSON**；
 *   - 规范化规则：对象键按字典序排序、数组保持原顺序、无多余空白、UTF-8 编码；
 *   - 签名算法：Ed25519（crypto.sign(null, payload, privateKey)），签名以 base64 存入 signature。
 *
 * 用法：
 *   node scripts/plugin-registry/sign-registry.mjs sign plugin-registry.json \
 *     --key private-key.pem --out plugin-registry.signed.json
 *   node scripts/plugin-registry/sign-registry.mjs verify plugin-registry.json \
 *     --pubkey public-key.pem
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import process from 'node:process'

/** registry 顶层结构版本号；客户端遇到未知版本应拒绝加载 */
export const REGISTRY_SCHEMA_VERSION = 1

/** 签名所在的字段名；该字段本身不参与签名计算 */
export const REGISTRY_SIGNATURE_FIELD = 'signature'

/**
 * 稳定序列化：对象键排序、丢弃 undefined，数组保持顺序。
 * 必须与客户端校验实现完全一致，任何差异都会导致签名验证失败。
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')
  return `{${body}}`
}

/** 取参与签名的字节：去掉 signature 字段后规范化 */
export function registryPayload(registry) {
  const rest = { ...(registry ?? {}) }
  delete rest[REGISTRY_SIGNATURE_FIELD]
  return Buffer.from(canonicalize(rest), 'utf8')
}

/** 用 Ed25519 私钥（PEM）签名，返回带 signature 字段的新 registry 对象 */
export function signRegistry(registry, privateKeyPem) {
  const signature = crypto.sign(null, registryPayload(registry), privateKeyPem).toString('base64')
  return { ...registry, [REGISTRY_SIGNATURE_FIELD]: signature }
}

/**
 * 用 Ed25519 公钥（PEM）校验签名。
 * 只接受 Ed25519：RSA 之类的密钥会让 crypto.verify 抛错，这里统一按"验证失败"处理，
 * 避免出现"换个算法也能过"的降级路径。
 */
export function verifyRegistrySignature(registry, publicKeyPem) {
  const signature = registry?.[REGISTRY_SIGNATURE_FIELD]
  if (typeof signature !== 'string' || signature.length === 0) return false
  try {
    const key = crypto.createPublicKey(publicKeyPem)
    if (key.asymmetricKeyType !== 'ed25519') return false
    return crypto.verify(null, registryPayload(registry), key, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

/**
 * 结构校验：形状不对的 registry 直接拒绝，避免客户端拿着半截数据去装插件。
 * 返回 { ok: true } 或 { ok: false, error: '...' }。
 */
export function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return { ok: false, error: 'INVALID_REGISTRY' }
  }
  if (registry.version !== REGISTRY_SCHEMA_VERSION) {
    return { ok: false, error: 'UNSUPPORTED_REGISTRY_VERSION' }
  }
  if (!Array.isArray(registry.plugins)) return { ok: false, error: 'INVALID_REGISTRY' }
  for (const plugin of registry.plugins) {
    if (!plugin || typeof plugin !== 'object') return { ok: false, error: 'INVALID_ENTRY' }
    if (typeof plugin.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/.test(plugin.id)) {
      return { ok: false, error: 'INVALID_ENTRY_ID' }
    }
    if (typeof plugin.version !== 'string' || plugin.version.length === 0) {
      return { ok: false, error: 'INVALID_ENTRY_VERSION' }
    }
    if (typeof plugin.entryUrl !== 'string' || !/^https:\/\//i.test(plugin.entryUrl)) {
      return { ok: false, error: 'INVALID_ENTRY_URL' }
    }
    if (typeof plugin.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(plugin.sha256)) {
      return { ok: false, error: 'INVALID_ENTRY_SHA256' }
    }
  }
  return { ok: true }
}

/** 读取 PEM 文件内容（去掉 BOM，保留换行） */
export function readPem(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
}

export function parseArgs(argv) {
  const [command, file, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; ) {
    const key = rest[i]
    // 裸参数（不是 --xxx）不能占掉后面那个位置，否则 `--pubkey` 会被错配成它的值，
    // 最终变成 readPem(undefined) 抛一个和用法无关的 TypeError。
    if (!key?.startsWith('--')) { i += 1; continue }
    options[key.slice(2)] = rest[i + 1]
    i += 2
  }
  return { command, file, options }
}

export function main(argv) {
  const { command, file, options } = parseArgs(argv)
  if (!command || !file || (command !== 'sign' && command !== 'verify')) {
    console.error('用法: sign-registry.mjs <sign|verify> <registry.json> [--key pem] [--pubkey pem] [--out file]')
    return 2
  }
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'))
  const shape = validateRegistry(registry)
  if (!shape.ok) {
    console.error(`registry 结构校验失败: ${shape.error}`)
    return 1
  }
  if (command === 'sign') {
    if (!options.key) {
      console.error('签名需要 --key <Ed25519 私钥 PEM>')
      return 2
    }
    const signed = signRegistry(registry, readPem(options.key))
    const out = options.out || file
    fs.writeFileSync(out, `${JSON.stringify(signed, null, 2)}\n`, 'utf8')
    console.log(`已签名并写入 ${out}`)
    return 0
  }
  if (!options.pubkey) {
    console.error('校验需要 --pubkey <Ed25519 公钥 PEM>')
    return 2
  }
  const ok = verifyRegistrySignature(registry, readPem(options.pubkey))
  console.log(ok ? '签名有效' : '签名无效或缺失')
  return ok ? 0 : 1
}

// 仅在被直接执行时跑 CLI，被测试 import 时不触发
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  process.exitCode = main(process.argv.slice(2))
}
