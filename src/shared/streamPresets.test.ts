import { describe, expect, it } from 'vitest'
import {
  STREAM_FORMAT_PRESETS,
  STREAM_PRESET_CUSTOM,
  STREAM_PRESET_DEFAULT
} from './streamPresets'

/**
 * 流媒体画质预设的回归测试。
 *
 * 这些预设同时被渲染层下拉与主进程 yt-dlp 参数构造使用：id 是下拉的 value、
 * label 是 i18n 键、format 是 `-f` 的值。任何一处写错都会让下载「成功但画质不对」，
 * 或者让下拉出现空文案，故逐项锁死。
 */
describe('STREAM_FORMAT_PRESETS：画质预设', () => {
  it('提供 6 个预设且 id 互不重复', () => {
    expect(STREAM_FORMAT_PRESETS).toHaveLength(6)
    const ids = STREAM_FORMAT_PRESETS.map(preset => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('默认预设 best 存在并排在下拉第一位', () => {
    expect(STREAM_PRESET_DEFAULT).toBe('best')
    expect(STREAM_FORMAT_PRESETS[0]?.id).toBe(STREAM_PRESET_DEFAULT)
  })

  it('自定义项的哨兵值不与任何预设 id 冲突', () => {
    expect(STREAM_PRESET_CUSTOM).toBe('__custom__')
    expect(STREAM_FORMAT_PRESETS.some(preset => preset.id === STREAM_PRESET_CUSTOM)).toBe(false)
  })

  it('label 一律是 i18n 键而非最终文案（主进程共用，不能耦合语言）', () => {
    for (const preset of STREAM_FORMAT_PRESETS) {
      expect(preset.label).toMatch(/^newTask\.streamPreset[A-Za-z0-9]+$/)
    }
    const labels = STREAM_FORMAT_PRESETS.map(preset => preset.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('每个预设都有非空的 -f 表达式', () => {
    for (const preset of STREAM_FORMAT_PRESETS) {
      expect(preset.format.trim().length).toBeGreaterThan(0)
      expect(preset.format).toContain('best')
    }
  })

  it('视频预设都要求合并音轨，并按 height 限制分辨率', () => {
    const expected: Record<string, number> = { '1080p': 1080, '720p': 720, '480p': 480 }
    for (const [id, height] of Object.entries(expected)) {
      const preset = STREAM_FORMAT_PRESETS.find(item => item.id === id)
      expect(preset).toBeTruthy()
      expect(preset?.merge).toBe(true)
      expect(preset?.extractAudio).toBeUndefined()
      expect(preset?.format).toContain('height<=' + height)
      // 回退分支同样要限制分辨率，否则拿不到合流时会把 4K 原片拖下来
      expect(preset?.format.split('/')[1]).toContain('height<=' + height)
    }
    const best = STREAM_FORMAT_PRESETS.find(item => item.id === 'best')
    expect(best?.merge).toBe(true)
    expect(best?.format).not.toContain('height<=')
  })

  it('音频预设不合并音轨，MP3 预设额外要求提取音频', () => {
    const audioBest = STREAM_FORMAT_PRESETS.find(item => item.id === 'audio-best')
    expect(audioBest?.merge).toBe(false)
    expect(audioBest?.extractAudio).toBeUndefined()
    expect(audioBest?.format).toBe('bestaudio/best')

    const audioMp3 = STREAM_FORMAT_PRESETS.find(item => item.id === 'audio-mp3')
    expect(audioMp3?.merge).toBe(false)
    expect(audioMp3?.extractAudio).toBe(true)
    expect(audioMp3?.format).toBe('bestaudio/best')
  })
})
