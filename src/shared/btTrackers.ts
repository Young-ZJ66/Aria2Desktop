/**
 * 内置的 BT 默认 Tracker 列表（渲染层与主进程共用）。
 *
 * 来源：ngosang/trackerslist 的 best 级别公共 tracker，精选多协议（udp http https）、
 * 长期稳定的一批作为内置默认值。用户可在 BT 设置页编辑，也可通过订阅每日更新拉取最新列表。
 */

/** 内置默认 Tracker（每行一条，均为公共可用的短链接） */
export const DEFAULT_BT_TRACKERS: string[] = [
  'udp://zer0day.ch:1337/announce',
  'udp://tracker.therarbg.to:6969/announce',
  'udp://tracker.publictracker.xyz:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.corpscorp.online:80/announce',
  'udp://tracker.auctor.tv:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://leet-tracker.moe:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce',
  'udp://tracker.tiny-vips.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.cyberia.is:6969/announce',
  'udp://tracker.tamersunion.org:1210/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'https://tracker.zhuqiy.com:443/announce',
  'https://tracker.pmman.tech:443/announce',
  'https://tracker.nekomi.cn:443/announce',
  'https://tracker.bt4g.com:443/announce',
  'https://ht.therarbg.to:443/announce',
  'https://004430.xyz:443/announce',
  'https://tracker.nanoha.org:443/announce',
  'http://tracker.files.fm:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.openbittorrent.com:6969/announce'
]

/** aria2 bt-tracker 选项使用逗号分隔的列表 */
export const DEFAULT_BT_TRACKERS_CSV = DEFAULT_BT_TRACKERS.join(',')

/** Tracker 订阅源（依次尝试，直到成功），每日拉取最新列表 */
export const TRACKER_SUBSCRIPTION_SOURCES: string[] = [
  'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt',
  'https://ngosang-trackerslist.pages.dev/best.txt',
  'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt'
]

/** 订阅源返回内容的合法 Tracker 地址协议前缀 */
const TRACKER_SCHEME_PREFIXES = ['udp://', 'http://', 'https://', 'wss://'] as const

/**
 * 解析订阅源返回的文本为 tracker 列表（每行一条或逗号分隔均兼容）。
 * 过滤非法协议、空行，按出现顺序去重。
 */
export function parseTrackerText(text: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of text.split(/[\r\n,]+/)) {
    const line = raw.trim()
    if (!line) continue
    if (!TRACKER_SCHEME_PREFIXES.some(p => line.startsWith(p))) continue
    if (seen.has(line)) continue
    seen.add(line)
    result.push(line)
  }
  return result
}
