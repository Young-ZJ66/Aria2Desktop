/**
 * 流媒体（yt-dlp）画质预设（渲染层与主进程共用）。
 *
 * 为什么放 src/shared：预设既要驱动新建任务页的下拉（渲染层），
 * 又要作为 yt-dlp 参数构造的依据被主进程引用（streamDownloadService 经相对路径引入，
 * 与 fileCategories 的先例一致——主进程产物是 CJS，无法解析 @/ 别名）。
 *
 * label 存的是 i18n 键而非最终文案：本文件被主进程共用，不能耦合任何具体语言，
 * 由渲染层用 vue-i18n 翻译，其余 19 种语言补齐键后预设文案自动跟随。
 */

export interface StreamFormatPreset {
  /** 预设标识（稳定值，作为下拉的 value，勿改动已有值） */
  id: string
  /** 展示文案的 i18n 键（newTask.streamPreset*） */
  label: string
  /**
   * yt-dlp 格式选择器表达式（-f 的值）。
   * 注意它不是单个格式 id，而是完整选择器语法（如 bestvideo*[height<=1080]+bestaudio/best），
   * 主进程侧用放宽后的 FORMAT_EXPR_PATTERN 校验。
   */
  format: string
  /** 是否需要合并最佳音轨（需要 ffmpeg） */
  merge: boolean
  /** 是否提取音频并转 MP3（yt-dlp -x --audio-format mp3，需要 ffmpeg） */
  extractAudio?: boolean
}

export const STREAM_FORMAT_PRESETS: StreamFormatPreset[] = [
  {
    id: 'best',
    label: 'newTask.streamPresetBest',
    format: 'bestvideo*+bestaudio/best',
    merge: true
  },
  {
    id: '1080p',
    label: 'newTask.streamPreset1080p',
    format: 'bestvideo*[height<=1080]+bestaudio/best[height<=1080]',
    merge: true
  },
  {
    id: '720p',
    label: 'newTask.streamPreset720p',
    format: 'bestvideo*[height<=720]+bestaudio/best[height<=720]',
    merge: true
  },
  {
    id: '480p',
    label: 'newTask.streamPreset480p',
    format: 'bestvideo*[height<=480]+bestaudio/best[height<=480]',
    merge: true
  },
  {
    id: 'audio-best',
    label: 'newTask.streamPresetAudioBest',
    format: 'bestaudio/best',
    merge: false
  },
  {
    id: 'audio-mp3',
    label: 'newTask.streamPresetAudioMp3',
    format: 'bestaudio/best',
    merge: false,
    extractAudio: true
  }
]

/** 下拉里「自定义」项的特殊值（沿用解析出的格式列表自己选） */
export const STREAM_PRESET_CUSTOM = '__custom__'

/** 播放列表模式的默认预设：列表页没有逐条格式信息，自动从「自定义」切回预设 */
export const STREAM_PRESET_DEFAULT = 'best'
