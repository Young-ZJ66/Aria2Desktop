import { describe, expect, it } from 'vitest'
import { EXTENSION_STORE_URL, isExtensionStoreAvailable } from './extensionStore'

/**
 * 扩展商店入口。
 *
 * 这里锁的是两件容易被误改的事：
 * 1) 商店链接结尾必须是商店版扩展 ID（与旁加载 .crx 的 ID 不同，改错了按钮会 404）；
 * 2) 商店未上架时入口必须自动置灰——保留开关而不是硬编码 true，下架时改一行就能回退。
 */
describe('扩展商店入口', () => {
  it('商店链接指向 Edge 加载项的商店版 ID', () => {
    expect(EXTENSION_STORE_URL).toBe(
      'https://microsoftedge.microsoft.com/addons/detail/aria2-desktop/fmjmpbnokancjlangmmepdpdebafkngp'
    )
  })

  it('链接使用 https 且不带查询串/尾部斜杠', () => {
    expect(EXTENSION_STORE_URL.startsWith('https://')).toBe(true)
    expect(EXTENSION_STORE_URL).not.toContain('?')
    expect(EXTENSION_STORE_URL.endsWith('/')).toBe(false)
  })

  it('商店 ID 是 32 位小写字母（a-p 的 Chrome 扩展 ID 字符集）', () => {
    const id = EXTENSION_STORE_URL.split('/').pop() as string
    expect(id).toMatch(/^[a-p]{32}$/)
  })

  it('商店已上架，入口可用', () => {
    expect(isExtensionStoreAvailable()).toBe(true)
  })
})
