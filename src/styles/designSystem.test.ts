import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrastRatio, cssVars, roles, themeCss } from './designSystem'

/**
 * 设计系统的护栏测试。
 *
 * v1 的令牌是手写两份（浅色一份、深色一份、naive overrides 再一份），
 * 改一次主色要同步三处，漏一处就出现「按钮是新的、链接还是旧的」。
 * v2 把 CSS 变量变成生成物，这里守住两件事：
 *   1. 生成物不能和本源漂移（改了 designSystem.ts 却忘了跑 theme:css）；
 *   2. 关键配色的对比度不能悄悄掉到 AA 以下。
 */

const cssPath = fileURLToPath(new URL('./tokens.generated.css', import.meta.url))

describe('设计令牌', () => {
  it('theme.css 与 designSystem.ts 同步（改了令牌需执行 npm run theme:css）', () => {
    expect(readFileSync(cssPath, 'utf8')).toBe(themeCss())
  })

  it('浅色与深色暴露同一组变量名', () => {
    expect(Object.keys(cssVars('light')).sort()).toEqual(Object.keys(cssVars('dark')).sort())
  })

  it('正文与弱化文字在各自表面色上达到 WCAG AA', () => {
    for (const mode of ['light', 'dark'] as const) {
      const r = roles[mode]
      expect(contrastRatio(r.textBase, r.bgSurface), `${mode}.textBase`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(r.textMuted, r.bgSurface), `${mode}.textMuted`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(r.textStrong, r.bgApp), `${mode}.textStrong`).toBeGreaterThanOrEqual(7)
    }
  })

  it('主色按钮上的白字达到 AA', () => {
    expect(contrastRatio(roles.light.textOnAccent, roles.light.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(roles.dark.textOnAccent, roles.dark.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('语义文字色在面板底色上达到 AA', () => {
    for (const mode of ['light', 'dark'] as const) {
      const r = roles[mode]
      for (const key of ['success', 'warning', 'danger', 'info'] as const) {
        expect(contrastRatio(r[key].text, r.bgSurface), `${mode}.${key}.text`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('深色三级表面之间有可辨识的明度差', () => {
    // v1 深色 --bg-primary/#171a21 与 --bg-secondary/#1e222b 只有 1.09:1，
    // 卡片完全糊在背景里，只能靠 1px 描边找边界。
    const r = roles.dark
    expect(contrastRatio(r.bgSurface, r.bgApp)).toBeGreaterThanOrEqual(1.15)
    expect(contrastRatio(r.bgRaised, r.bgSurface)).toBeGreaterThanOrEqual(1.15)
  })
})
