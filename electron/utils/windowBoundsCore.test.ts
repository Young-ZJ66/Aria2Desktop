import { describe, expect, it } from 'vitest'
import { isPlausibleBounds, pickStoredBounds } from './windowBoundsCore'

const normal = { x: 168, y: 8, width: 1200, height: 800 }
const maximized = { x: -7, y: -7, width: 1552, height: 832 }

describe('窗口边界记忆', () => {
  it('正常态就记当前边界', () => {
    const bounds = pickStoredBounds({
      current: normal,
      lastNormal: null,
      normalFromElectron: null,
      isMaximized: false,
      isFullScreen: false
    })
    expect(bounds).toEqual(normal)
  })

  it('最大化时记缓存的正常态边界，而不是整屏矩形', () => {
    const bounds = pickStoredBounds({
      current: maximized,
      lastNormal: normal,
      normalFromElectron: null,
      isMaximized: true,
      isFullScreen: false
    })
    expect(bounds).toEqual(normal)
  })

  it('没有缓存时退回 getNormalBounds()', () => {
    const bounds = pickStoredBounds({
      current: maximized,
      lastNormal: null,
      normalFromElectron: normal,
      isMaximized: true,
      isFullScreen: false
    })
    expect(bounds).toEqual(normal)
  })

  it('缓存和系统都给不出时，宁可记整屏也不要空着', () => {
    const bounds = pickStoredBounds({
      current: maximized,
      lastNormal: null,
      normalFromElectron: null,
      isMaximized: true,
      isFullScreen: false
    })
    expect(bounds).toEqual(maximized)
  })

  it('全屏与最大化同一套规则', () => {
    const bounds = pickStoredBounds({
      current: maximized,
      lastNormal: normal,
      normalFromElectron: null,
      isMaximized: false,
      isFullScreen: true
    })
    expect(bounds).toEqual(normal)
  })

  it('0×0 或 NaN 的"正常态"不可信，会被跳过', () => {
    const bounds = pickStoredBounds({
      current: maximized,
      lastNormal: { x: 0, y: 0, width: 0, height: 0 },
      normalFromElectron: { x: -32000, y: -32000, width: 160, height: 28 },
      isMaximized: true,
      isFullScreen: false
    })
    expect(bounds).toEqual(maximized)
  })

  it('阈值判定只挡明显不合理的尺寸', () => {
    expect(isPlausibleBounds(normal)).toBe(true)
    expect(isPlausibleBounds(null)).toBe(false)
    expect(isPlausibleBounds({ x: 0, y: 0, width: Number.NaN, height: 800 })).toBe(false)
    expect(isPlausibleBounds({ x: 0, y: 0, width: 800, height: 600 })).toBe(true)
  })
})
