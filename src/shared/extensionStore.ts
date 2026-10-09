/**
 * 浏览器扩展的安装入口（App 侧唯一事实来源）。
 *
 * 已确认的商店信息（来源：Edge 合作伙伴中心）：
 * - **商店版扩展 ID**：`fmjmpbnokancjlangmmepdpdebafkngp`
 *   已用后台给出的公钥反算校验：`SHA-256(公钥 DER) 前 16 字节 → 每个 nibble 映射 a–p`
 *   得到的值与后台的 CRX ID 完全一致（算法同 scripts/pack-extension-crx.mjs）。
 * - **旁加载 `.crx` 的 ID 是另一个**：`ndikflbmajhflfndbjblihkifnfbmdon`（见
 *   electron/utils/extensionApiCore.ts）。两者不同属预期——扩展接口不按 ID 放行
 *   （只要求 `chrome-extension://` + RPC 密钥），所以商店版照样能连上 App；
 *   只是用 `.crx` 装过的用户要切商店版时得先卸载。
 *
 * ⚠️ 上架后请做两件事：
 * 1. 在浏览器里核对下面的链接能打开。URL 里的 `aria2-desktop` 是**可读 slug**
 *    （由商店按扩展名生成，可能与这里不同），关键是结尾的 ID 正确；
 * 2. 把 `STORE_PUBLISHED` 改成 `true` —— 这是唯一需要动的地方，设置页的「获取浏览器扩展」
 *    按钮会随之由置灰变为可点，不需要改任何组件代码。
 */
export const EXTENSION_STORE_URL =
  'https://microsoftedge.microsoft.com/addons/detail/aria2-desktop/fmjmpbnokancjlangmmepdpdebafkngp'

/**
 * 商店是否已上架。
 *
 * 为什么需要这个开关：审核通过前该页面还不存在（合作伙伴中心里 URL 一栏写的就是
 * "发布扩展后将可用"），若按钮此时可点，用户点开只会看到商店的 404 页面。
 * 上架后置为 `true` 即可。
 */
const STORE_PUBLISHED = false

/**
 * 商店入口是否可用（链接已就位 **且** 已上架）。
 * 渲染层据它决定按钮可点还是置灰并提示「审核中」。
 */
export function isExtensionStoreAvailable(): boolean {
  return STORE_PUBLISHED
}
