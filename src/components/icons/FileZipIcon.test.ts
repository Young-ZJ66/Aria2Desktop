import { describe, expect, it } from 'vitest'
import type { VNode } from 'vue'
import { FileZipIcon } from './FileZipIcon'

interface VNodeLike {
  type: string
  props: Record<string, unknown>
  children: VNodeLike[]
}

function render(component: { render?: unknown }): VNodeLike {
  const renderer = component.render as (this: unknown) => VNode
  return renderer.call({}) as unknown as VNodeLike
}

describe('FileZipIcon', () => {
  it('是带名字的组件，根节点是 24×24 的描边 svg', () => {
    expect(FileZipIcon.name).toBe('FileZipIcon')
    const vnode = render(FileZipIcon)
    expect(vnode.type).toBe('svg')
    expect(vnode.props.viewBox).toBe('0 0 24 24')
    expect(vnode.props.width).toBe('1em')
    expect(vnode.props.height).toBe('1em')
    expect(vnode.props.fill).toBe('none')
    expect(vnode.props.stroke).toBe('currentColor')
    expect(vnode.props['stroke-width']).toBe('1.8')
  })

  it('文件轮廓 + 折角 + 拉链中轴 + 拉链齿四段路径', () => {
    const paths = render(FileZipIcon).children
    expect(paths).toHaveLength(4)
    expect(paths.every((p) => p.type === 'path')).toBe(true)
    expect(paths.map((p) => p.props.d)).toEqual([
      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
      'M14 2v6h6',
      'M11 10v11',
      'M11 12H9M11 14h2M11 16H9M11 18h2'
    ])
  })

  it('拉链齿是左右交错的短横，不是三条平行横线', () => {
    const d = render(FileZipIcon).children.map((p) => p.props.d)
    const teeth = d[3] as string
    expect(teeth).toContain('M11 12H9')
    expect(teeth).toContain('M11 14h2')
    expect(teeth).toContain('M11 16H9')
    expect(teeth).toContain('M11 18h2')
  })
})
