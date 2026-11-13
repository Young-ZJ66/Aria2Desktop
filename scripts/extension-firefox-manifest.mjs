#!/usr/bin/env node
/**
 * Firefox（AMO 上架）manifest 变体构建 —— 供 pack-extension-firefox 与 check-extension 复用。
 *
 * 为什么需要变体：Firefox MV3（109+）不支持 background.service_worker，事件页要用
 * background.scripts 数组；上架 AMO 还必须带 browser_specific_settings.gecko.id
 * （无固定 ID 无法签名与自动更新）。变换规则只在这一个模块里定义，
 * 打包与校验共用同一份逻辑，两处口径不会漂移。
 *
 * 其余 permissions / host_permissions / optional_* / action / CSP 在 Firefox 115+ 均受
 * 支持，原样保留即可，不做增删。
 */

/** AMO 固定扩展 ID（email 形态；不写死的话 AMO 每次审核都会分配新 ID，自动更新就断了） */
export const FIREFOX_GECKO_ID = 'aria2-desktop@young-zj66.github.io'

/**
 * 最低支持版本：MV3 事件页（background.scripts）要 109，optional_host_permissions 要 102，
 * 取 115（首个支持完整 MV3 事件页语义的 ESR 基线），下限校验按 ≥109 把关。
 */
export const FIREFOX_STRICT_MIN_VERSION = '115.0'

const GECKO_ID_RE = /^[\w.-]+@[\w.-]+$/
const GUID_RE = /^\{[0-9a-fA-F-]{36}\}$/

/**
 * 把 Chromium manifest 变换为 Firefox 可上架的 manifest。
 *
 * @param {object} chromiumManifest extension/manifest.json 解析出的对象（不会被修改）
 * @returns {object} Firefox 变体（深拷贝，与入参不共享任何引用）
 * @throws 变换后字段不合法 / 无法序列化时抛错（调用方：打包脚本不产出、校验脚本标 FAIL）
 */
export function buildFirefoxManifest(chromiumManifest) {
  if (!chromiumManifest || typeof chromiumManifest !== 'object') {
    throw new Error('传入的 chromium manifest 不是对象')
  }
  // 深拷贝：绝不能让变换污染 extension/manifest.json 的解析结果（打包脚本随后还要用它读版本号）
  const manifest = JSON.parse(JSON.stringify(chromiumManifest))

  const background = manifest.background
  if (typeof background?.service_worker !== 'string' || !background.service_worker) {
    throw new Error('chromium manifest 缺少 background.service_worker，无法转换为 Firefox 事件页脚本')
  }
  // service_worker（Chromium 单文件后台）→ scripts（Firefox MV3 事件页唯一受支持形态）。
  // 直接复用 service_worker 的值作为脚本入口，两边入口文件天然保持一致。
  const scriptEntry = background.service_worker
  delete background.service_worker
  background.scripts = [scriptEntry]

  // AMO 必需的固定 ID + 最低版本。合并写法：将来若加 gecko 其它字段（如 update_url）不会被覆盖
  manifest.browser_specific_settings = {
    ...(manifest.browser_specific_settings ?? {}),
    gecko: {
      ...(manifest.browser_specific_settings?.gecko ?? {}),
      id: FIREFOX_GECKO_ID,
      strict_min_version: FIREFOX_STRICT_MIN_VERSION
    }
  }

  // 产出合法性自检：调用方拿到的对象保证"能 JSON.stringify 且必填字段齐全"
  const errors = []
  if (manifest.manifest_version !== 3) errors.push(`manifest_version 应为 3，实际 ${manifest.manifest_version}`)
  if (!manifest.name) errors.push('缺少 name')
  if (!manifest.version) errors.push('缺少 version')
  if (!Array.isArray(manifest.background?.scripts) || !manifest.background.scripts.includes(scriptEntry)) {
    errors.push('background.scripts 缺少后台脚本入口')
  }
  if (manifest.background?.service_worker) errors.push('background 不应残留 service_worker')
  const gecko = manifest.browser_specific_settings?.gecko
  const id = gecko?.id
  if (!id || !(GECKO_ID_RE.test(id) || GUID_RE.test(id))) {
    errors.push(`gecko.id 为空或格式非法: ${id}`)
  }
  const minVersion = String(gecko?.strict_min_version ?? '')
  const minMajor = parseInt(minVersion.split('.')[0], 10)
  if (!(Number.isInteger(minMajor) && minMajor >= 109)) {
    errors.push(`gecko.strict_min_version 应 >= 109（MV3 事件页基线），实际 ${minVersion}`)
  }
  try {
    JSON.stringify(manifest)
  } catch (error) {
    errors.push(`产出无法 JSON.stringify: ${error.message}`)
  }
  if (errors.length) throw new Error('Firefox manifest 变换校验失败: ' + errors.join('; '))

  return manifest
}
