import { describe, expect, it } from 'vitest'
import { ICON_192_PNG_B64, ICON_512_PNG_B64 } from './webConsoleAssets'

// 这两个图标是 PWA 安装的必需项：损坏的 base64 不会报错，只会让「安装到桌面」按钮永远灰着。
// 因此直接解 PNG 头，校验签名与真实宽高，而不是只看字符串非空。

function decodePng(base64: string): { width: number; height: number } {
  const buffer = Buffer.from(base64, 'base64')
  // PNG 签名 89 50 4E 47 0D 0A 1A 0A，随后是 IHDR 长度与类型，再后是宽高（大端 uint32）
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

describe('Web 控制台 PWA 图标', () => {
  it('192 图标是合法 PNG 且尺寸为 192x192', () => {
    expect(decodePng(ICON_192_PNG_B64)).toEqual({ width: 192, height: 192 })
  })

  it('512 图标是合法 PNG 且尺寸为 512x512', () => {
    expect(decodePng(ICON_512_PNG_B64)).toEqual({ width: 512, height: 512 })
  })

  it('两个图标内容不同（避免误把 192 复制成 512）', () => {
    expect(ICON_192_PNG_B64).not.toBe(ICON_512_PNG_B64)
  })

  it('base64 不含 data: 前缀（服务端会自己拼 Content-Type 头）', () => {
    expect(ICON_192_PNG_B64.startsWith('data:')).toBe(false)
    expect(ICON_512_PNG_B64.startsWith('data:')).toBe(false)
  })

  it('图标体积合理（几 KB 级，避免把整张桌面截图塞进内嵌资源）', () => {
    for (const icon of [ICON_192_PNG_B64, ICON_512_PNG_B64]) {
      const bytes = Buffer.from(icon, 'base64').length
      expect(bytes).toBeGreaterThan(1000)
      expect(bytes).toBeLessThan(200 * 1024)
    }
  })
})
