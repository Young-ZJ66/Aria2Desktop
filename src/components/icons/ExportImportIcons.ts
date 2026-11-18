/**
 * 导出 / 导入任务列表图标。
 * 用「向上箭头出托盘 / 向下箭头入托盘」这一对通用语义：
 * 旧版的文件轮廓 + 横向箭头在两个小尺寸按钮上几乎同形，分不清方向。
 */
import { defineComponent, h } from 'vue'

function renderTray(arrowPath: string) {
  return h('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    width: '1em',
    height: '1em',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  }, [
    h('path', { d: 'M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4' }),
    h('path', { d: arrowPath })
  ])
}

export const ExportIcon = defineComponent({
  name: 'ExportIcon',
  render() {
    return renderTray('M12 15V3M7.5 7.5 12 3l4.5 4.5')
  }
})

export const ImportIcon = defineComponent({
  name: 'ImportIcon',
  render() {
    return renderTray('M12 3v12M7.5 10.5 12 15l4.5-4.5')
  }
})
