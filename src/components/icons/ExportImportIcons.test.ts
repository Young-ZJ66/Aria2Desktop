import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { ExportIcon, ImportIcon } from './ExportImportIcons'

interface VNodeLike {
  type: string
  props: Record<string, unknown>
  children: unknown[] | null
}

function render(component: { render?: unknown }) {
  const renderer = component.render as (this: unknown) => unknown
  return renderer.call({}) as VNodeLike
}

function paths(node: VNodeLike): string[] {
  const list = Array.isArray(node.children) ? (node.children as VNodeLike[]) : []
  return list.filter(child => child && child.type === 'path').map(child => String(child.props.d))
}

describe('导出/导入任务列表图标', () => {
  it('两个图标都用托盘 + 箭头的同一套骨架', () => {
    for (const component of [ExportIcon, ImportIcon]) {
      const node = render(component)
      expect(node.type).toBe('svg')
      expect(node.props.viewBox).toBe('0 0 24 24')
      expect(node.props.width).toBe('1em')
      expect(node.props.height).toBe('1em')
      expect(node.props.fill).toBe('none')
      expect(node.props.stroke).toBe('currentColor')
      expect(node.props['stroke-width']).toBe('1.8')
      expect(node.props['stroke-linecap']).toBe('round')
      expect(node.props['stroke-linejoin']).toBe('round')
      expect(paths(node)).toHaveLength(2)
    }
  })

  it('托盘形状两条图标一致，只有箭头方向不同', () => {
    const exportPaths = paths(render(ExportIcon))
    const importPaths = paths(render(ImportIcon))
    expect(exportPaths[0]).toBe(importPaths[0])
    expect(exportPaths[1]).not.toBe(importPaths[1])
  })

  it('导出箭头朝上、导入箭头朝下', () => {
    const [exportArrow] = paths(render(ExportIcon)).slice(1)
    const [importArrow] = paths(render(ImportIcon)).slice(1)
    // 导出：从 y=15 向上到 y=3，箭头头部在顶部（y 更小的坐标）
    expect(exportArrow.startsWith('M12 15V3')).toBe(true)
    expect(exportArrow).toContain('M7.5 7.5 12 3l4.5 4.5')
    // 导入：从 y=3 向下到 y=15，箭头头部在底部
    expect(importArrow.startsWith('M12 3v12')).toBe(true)
    expect(importArrow).toContain('M7.5 10.5 12 15l4.5-4.5')
  })

  it('组件名可用于调试与 devtools 定位', () => {
    expect(ExportIcon.name).toBe('ExportIcon')
    expect(ImportIcon.name).toBe('ImportIcon')
  })

  it('渲染结果与直接调用 h 等价（无额外包裹层）', () => {
    const viaComponent = render(ExportIcon)
    const direct = h('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 24 24',
      width: '1em',
      height: '1em',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    })
    expect(viaComponent.type).toBe(direct.type)
    expect(Object.keys(viaComponent.props).sort()).toEqual(Object.keys(direct.props as Record<string, unknown>).sort())
  })
})
