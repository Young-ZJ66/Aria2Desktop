import { describe, expect, it } from 'vitest'
import { parseMetalinkFiles } from './metalinkFileList'

describe('parseMetalinkFiles', () => {
  it('解析 Metalink 4.0 的属性写法并累加总大小', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<metalink xmlns="urn:ietf:params:xml:ns:metalink">
  <file name="ubuntu.iso" size="1024">
    <url>https://example.com/ubuntu.iso</url>
  </file>
  <file name="docs/a.pdf" size="2048" />
</metalink>`
    expect(parseMetalinkFiles(text)).toEqual({
      files: [
        { name: 'ubuntu.iso', size: 1024 },
        { name: 'docs/a.pdf', size: 2048 }
      ],
      totalSize: 3072
    })
  })

  it('兼容 Metalink 3.0（.meta4）的子元素大小写法', () => {
    const text = `<metalink xmlns="urn:ietf:params:xml:ns:metalink">
  <file name="a.iso">
    <size>4096</size>
  </file>
</metalink>`
    expect(parseMetalinkFiles(text).files).toEqual([{ name: 'a.iso', size: 4096 }])
  })

  it('反转义文件名里的 XML 实体', () => {
    const text = '<metalink><file name="a &amp; b.iso" size="1" /></metalink>'
    expect(parseMetalinkFiles(text).files[0]?.name).toBe('a & b.iso')
  })

  it('缺少 metalink 根节点时抛错', () => {
    expect(() => parseMetalinkFiles('<html><body>not metalink</body></html>')).toThrow()
  })

  it('没有声明任何文件时抛错', () => {
    expect(() => parseMetalinkFiles('<metalink><files /></metalink>')).toThrow()
  })

  it('未声明大小的文件按 0 计', () => {
    const text = '<metalink><file name="a.iso" /></metalink>'
    expect(parseMetalinkFiles(text)).toEqual({ files: [{ name: 'a.iso', size: 0 }], totalSize: 0 })
  })
})

describe('parseMetalinkFiles 的缺名条目', () => {
  it('没有 name 属性的 file 节点被跳过，其余照常解析', () => {
    const text = [
      '<metalink>',
      '  <file size="10" />',
      '  <file name="b.iso" size="20" />',
      '</metalink>'
    ].join('\n')
    const parsed = parseMetalinkFiles(text)
    expect(parsed.files).toEqual([{ name: 'b.iso', size: 20 }])
    expect(parsed.totalSize).toBe(20)
  })
})

