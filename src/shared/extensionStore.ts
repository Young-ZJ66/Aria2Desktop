/**
 * 浏览器扩展的安装入口（App 侧唯一事实来源）。
 *
 * 商店信息（已与线上核对）：
 * - **商店地址**：见下方 `EXTENSION_STORE_URL`。URL 里的 `aria2-desktop` 是商店按扩展名
 *   生成的**可读 slug**——2026-10-14 上架后与线上地址逐字比对一致（关键是结尾的 ID）。
 * - **商店版扩展 ID**：`fmjmpbnokancjlangmmepdpdebafkngp`（来源：Edge 合作伙伴中心）
 *   已用后台给出的公钥反算校验：`SHA-256(公钥 DER) 前 16 字节 → 每个 nibble 映射 a–p`
 *   得到的值与后台的 CRX ID 完全一致（算法同 scripts/pack-extension-crx.mjs）。
 * - **旁加载 `.crx` 的 ID 是另一个**：`ndikflbmajhflfndbjblihkifnfbmdon`（见
 *   electron/utils/extensionApiCore.ts）。两者不同属预期——扩展接口不按 ID 放行
 *   （只要求 `chrome-extension://` + RPC 密钥），所以商店版照样能连上 App；
 *   只是用 `.crx` 装过的用户要切商店版时得先卸载。
 */
export const EXTENSION_STORE_URL =
  'https://microsoftedge.microsoft.com/addons/detail/aria2-desktop/fmjmpbnokancjlangmmepdpdebafkngp'

/**
 * 商店是否已上架。
 *
 * **2026-10-14 审核通过，已置 true**。上架前这里是 false：那时页面还不存在，
 * 按钮做成可点只会把用户送到商店的 404 页面。
 *
 * 保留这个开关而不是删掉判断：商店条目若被下架/重建（页面暂时不可访问），
 * 把它改回 false，设置页按钮立刻回到「置灰 + 提示」的安全状态，不需要动组件代码。
 */
const STORE_PUBLISHED = true

/**
 * 商店入口是否可用（链接已就位 **且** 已上架）。
 * 渲染层据它决定按钮可点、还是置灰并提示。
 */
export function isExtensionStoreAvailable(): boolean {
  return STORE_PUBLISHED
}
