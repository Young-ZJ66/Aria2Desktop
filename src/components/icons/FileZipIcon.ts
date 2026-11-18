/**
 * 压缩包文件图标。
 * Ionicons 的 ArchiveOutline 是一个"归档盒"（带向下箭头），在 16px 行内更像操作按钮；
 * FileTrayStacked 又像收件箱。这里用带折角和拉链齿的文件轮廓，让 .zip/.rar/.7z 一眼可辨。
 */
import { defineComponent, h } from 'vue'

export const FileZipIcon = defineComponent({
  name: 'FileZipIcon',
  render() {
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
      h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
      h('path', { d: 'M14 2v6h6' }),
      // 中央竖向拉链：短横齿交错分布，比三条横线更像压缩包
      h('path', { d: 'M11 10v11' }),
      h('path', { d: 'M11 12H9M11 14h2M11 16H9M11 18h2' })
    ])
  }
})
