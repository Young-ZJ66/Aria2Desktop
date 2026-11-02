/**
 * 窗口状态里"该记哪一组边界"的判定（纯函数，便于单测）。
 *
 * 背景：`BrowserWindow.getBounds()` 在最大化状态下返回的是**最大化后的矩形**
 * （Windows 上实测 `{x:-7,y:-7,width:1552,height:832}`，含边框外扩）。
 * 如果直接把它当成"上次的位置和大小"存下来，恢复时会用整屏尺寸建窗口再最大化，
 * 用户点「向下还原」就得到一个和屏幕一样大的普通窗口，之前 1200×800 的尺寸再也回不去。
 *
 * 所以最大化/全屏时优先记"正常态"的边界：先看自己在 resize/move 里存下的缓存
 * （不依赖平台 API），再退回 Electron 的 getNormalBounds()。
 */

export interface BoundsRect {
  x: number
  y: number
  width: number
  height: number
}

/** 低于这个尺寸的边界视为不可信（0×0、NaN、被最小化的残值） */
const MIN_PLAUSIBLE_WIDTH = 400
const MIN_PLAUSIBLE_HEIGHT = 300

export function isPlausibleBounds(bounds: BoundsRect | null | undefined): bounds is BoundsRect {
  if (!bounds) return false
  const { x, y, width, height } = bounds
  return (
    [x, y, width, height].every(value => Number.isFinite(value)) &&
    width >= MIN_PLAUSIBLE_WIDTH &&
    height >= MIN_PLAUSIBLE_HEIGHT
  )
}

export interface PickStoredBoundsInput {
  /** 当前 getBounds() 的结果 */
  current: BoundsRect
  /** 最近一次在"正常态"下观测到的边界（resize/move 时记录） */
  lastNormal: BoundsRect | null
  /** getNormalBounds() 的结果，拿不到时为 null */
  normalFromElectron: BoundsRect | null
  isMaximized: boolean
  isFullScreen: boolean
}

/**
 * 决定这次该把哪组边界写进 windowState。
 *
 * - 正常态：就是当前边界；
 * - 最大化/全屏：优先用缓存的正常态边界，其次用 getNormalBounds()，
 *   两者都没有才退回当前边界（总比不存强）。
 */
export function pickStoredBounds(input: PickStoredBoundsInput): BoundsRect {
  const { current, lastNormal, normalFromElectron, isMaximized, isFullScreen } = input

  if (!isMaximized && !isFullScreen) return current
  if (isPlausibleBounds(lastNormal)) return lastNormal
  if (isPlausibleBounds(normalFromElectron)) return normalFromElectron
  return current
}
