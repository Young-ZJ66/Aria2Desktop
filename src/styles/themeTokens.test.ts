import { describe, it, expect } from 'vitest'
import { buildThemeOverrides, designRoles, NAV_ITEM_HEIGHT, FONT_WEIGHT_SEMIBOLD } from './themeTokens'
import { roles, radius, control, font, fontWeight, text } from './designSystem'

const light = buildThemeOverrides(false)
const dark = buildThemeOverrides(true)

describe('主题覆盖由设计角色投影生成', () => {
  it('浅色/深色的主色与状态色都来自 roles', () => {
    expect(light.common?.primaryColor).toBe(roles.light.accent)
    expect(dark.common?.primaryColor).toBe(roles.dark.accent)
    expect(light.common?.primaryColorHover).toBe(roles.light.accentHover)
    expect(dark.common?.primaryColorPressed).toBe(roles.dark.accentPressed)
    expect(light.common?.successColor).toBe(roles.light.success.solid)
    expect(dark.common?.warningColor).toBe(roles.dark.warning.solid)
    expect(light.common?.errorColor).toBe(roles.light.danger.solid)
    expect(dark.common?.infoColor).toBe(roles.dark.info.solid)
  })

  it('表面色与描边色随主题切换', () => {
    expect(light.common?.bodyColor).toBe(roles.light.bgApp)
    expect(dark.common?.bodyColor).toBe(roles.dark.bgApp)
    expect(light.common?.cardColor).toBe(roles.light.bgSurface)
    expect(dark.common?.modalColor).toBe(roles.dark.bgRaised)
    expect(light.common?.borderColor).toBe(roles.light.borderBase)
    expect(dark.common?.dividerColor).toBe(roles.dark.borderSubtle)
  })

  it('深浅两套覆盖的组件块完全一致（不会漏配某个组件）', () => {
    const lightKeys = Object.keys(light).sort()
    const darkKeys = Object.keys(dark).sort()
    expect(darkKeys).toEqual(lightKeys)
  })

  it('每个组件块的键在深浅两套里一一对应', () => {
    for (const block of Object.keys(light) as Array<keyof typeof light>) {
      const lightBlock = light[block] as Record<string, unknown> | undefined
      const darkBlock = dark[block] as Record<string, unknown> | undefined
      if (!lightBlock || !darkBlock) continue
      expect(Object.keys(darkBlock).sort()).toEqual(Object.keys(lightBlock).sort())
    }
  })

  it('浅色与深色的主色确实不同（否则说明没跟随主题）', () => {
    expect(light.common?.primaryColor).not.toBe(dark.common?.primaryColor)
    expect(light.common?.bodyColor).not.toBe(dark.common?.bodyColor)
  })

  it('表头不铺底色，避免在卡片上切出色带', () => {
    expect(light.common?.tableHeaderColor).toBe('transparent')
    expect(dark.common?.tableHeaderColor).toBe('transparent')
  })

  it('几何与字体沿用设计系统令牌', () => {
    expect(light.common?.borderRadius).toBe(radius.md)
    expect(light.common?.borderRadiusSmall).toBe(radius.sm)
    expect(light.common?.fontFamily).toBe(font.sans)
    expect(light.common?.fontFamilyMono).toBe(font.mono)
    expect(light.common?.heightMedium).toBe(control.heightMd)
    expect(light.common?.heightLarge).toBe(control.heightLg)
    expect(light.common?.scrollbarBorderRadius).toBe(radius.pill)
  })

  it('字号阶梯与 designSystem.text 对齐', () => {
    expect(light.common?.fontSize).toBe(text.body.size)
    expect(light.common?.fontSizeMini).toBe(text.micro.size)
    expect(light.common?.fontSizeTiny).toBe(text.small.size)
    expect(light.common?.fontSizeSmall).toBe(text.body.size)
    expect(light.common?.fontSizeMedium).toBe(text.body.size)
    expect(light.common?.fontSizeLarge).toBe(text.bodyLg.size)
    expect(light.common?.fontSizeHuge).toBe(text.title.size)
  })

  it('实心主按钮用白字配主色（深色主题已按对比度校准）', () => {
    expect(light.Button?.colorPrimary).toBe(roles.light.accent)
    expect(light.Button?.textColorPrimary).toBe(roles.light.textOnAccent)
    expect(dark.Button?.textColorPrimary).toBe(roles.dark.textOnAccent)
  })

  it('导出给非组件场景的常量与设计系统一致', () => {
    expect(NAV_ITEM_HEIGHT).toBe(control.navItem)
    expect(FONT_WEIGHT_SEMIBOLD).toBe(fontWeight.semibold)
    expect(designRoles(false)).toBe(roles.light)
    expect(designRoles(true)).toBe(roles.dark)
  })

  it('覆盖的组件块覆盖了所有实际用到的 naive 组件', () => {
    const expected = [
      'common', 'Card', 'Form', 'Button', 'Input', 'InternalSelection', 'InternalSelectMenu',
      'DataTable', 'Menu', 'Tabs', 'Tag', 'Modal', 'Dialog', 'Drawer', 'Dropdown', 'Popover',
      'Tooltip', 'Checkbox', 'Switch', 'Progress', 'Empty', 'Statistic', 'Divider',
      'Notification', 'Message', 'Alert', 'Spin', 'Slider'
    ]
    for (const block of expected) {
      expect(Object.keys(light)).toContain(block)
    }
  })
})
