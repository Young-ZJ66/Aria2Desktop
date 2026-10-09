import { describe, expect, it } from 'vitest'
import { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl } from './externalUrlCore'
import { EXTENSION_STORE_URL } from '../../src/shared/extensionStore'

/**
 * 这条校验是"渲染层能要求主进程打开哪些外部站点"的边界。
 * 放宽它（例如允许任意 https）等于把 `shell.openExternal` 变成渲染层手里的任意跳转能力，
 * 因此把口径连同仿冒域名的反例一起锁在这里。
 */
describe('isAllowedExternalUrl', () => {
  it('放行扩展商店链接（含仍在占位状态的常量）', () => {
    expect(isAllowedExternalUrl(EXTENSION_STORE_URL)).toBe(true)
  })

  it('白名单主机及其子域放行', () => {
    expect(isAllowedExternalUrl('https://microsoftedge.microsoft.com/addons/detail/x/y')).toBe(true)
    expect(isAllowedExternalUrl('https://www.microsoftedge.microsoft.com/x')).toBe(true)
    expect(isAllowedExternalUrl('https://MICROSOFTEDGE.MICROSOFT.COM/x')).toBe(true)
  })

  it('仿冒域名一律拒绝（白名单匹配必须是完整标签，不能只看前缀/后缀）', () => {
    // 经典混淆：真域名出现在前半段
    expect(isAllowedExternalUrl('https://microsoftedge.microsoft.com.evil.com/x')).toBe(false)
    // 把白名单主机当子域拼在别的域名下
    expect(isAllowedExternalUrl('https://evil.com/microsoftedge.microsoft.com')).toBe(false)
    expect(isAllowedExternalUrl('https://notmicrosoftedge.microsoft.com/x')).toBe(false)
  })

  it('白名单之外的站点拒绝', () => {
    expect(isAllowedExternalUrl('https://github.com/Young-ZJ66/Aria2Desktop')).toBe(false)
    expect(isAllowedExternalUrl('https://chromewebstore.google.com/detail/x/y')).toBe(false)
  })

  it('只放行 https：http 与文件/脚本/自定义协议一律拒绝', () => {
    expect(isAllowedExternalUrl('http://microsoftedge.microsoft.com/x')).toBe(false)
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    // 自定义协议会被交给系统处理程序，等同唤起本机其它程序
    expect(isAllowedExternalUrl('ms-settings:')).toBe(false)
  })

  it('畸形/空/非字符串输入拒绝（不抛异常）', () => {
    expect(isAllowedExternalUrl('')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
    expect(isAllowedExternalUrl('//microsoftedge.microsoft.com')).toBe(false)
    expect(isAllowedExternalUrl(undefined)).toBe(false)
    expect(isAllowedExternalUrl(null)).toBe(false)
    expect(isAllowedExternalUrl({ url: EXTENSION_STORE_URL })).toBe(false)
  })

  it('白名单本身只含主机名（写进协议/路径会静默失配）', () => {
    for (const host of ALLOWED_EXTERNAL_HOSTS) {
      expect(host).toBe(host.toLowerCase().trim())
      expect(host).not.toContain('/')
      expect(host).not.toContain(':')
      expect(host.split('.').length).toBeGreaterThanOrEqual(2)
    }
  })
})
