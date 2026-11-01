/**
 * 常见浏览器 User-Agent 预设（参考 Motrix 的做法）。
 * 同时供「新建任务 → 高级设置」与「设置 → 下载设置（默认 UA）」使用。
 */
export interface UserAgentPreset {
  key: string
  label: string
  value: string
}

export const USER_AGENT_PRESETS: UserAgentPreset[] = [
  {
    key: 'chrome-windows',
    label: 'Chrome · Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  },
  {
    key: 'chrome-macos',
    label: 'Chrome · macOS',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  },
  {
    key: 'edge-windows',
    label: 'Edge · Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'
  },
  {
    key: 'firefox-windows',
    label: 'Firefox · Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0'
  },
  {
    key: 'safari-macos',
    label: 'Safari · macOS',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
  },
  {
    key: 'chrome-android',
    label: 'Chrome · Android',
    value: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'
  }
]

/** aria2 的默认 UA（`aria2/<版本>`）；拿不到版本时退回 `aria2` */
export function aria2DefaultUserAgent(version?: string | null): string {
  return version ? `aria2/${version}` : 'aria2'
}
