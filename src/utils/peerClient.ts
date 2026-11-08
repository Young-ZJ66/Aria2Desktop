/**
 * 解析 BitTorrent Peer ID 中的客户端标识。
 *
 * Azureus 风格：-XX1234-，XX 为客户端代码。aria2 返回的 peerId 可能是
 * percent-encoded，先尝试解码；无法识别时回显原始 ID，方便排障。
 */
const CLIENT_CODES: Record<string, string> = {
  AZ: 'Azureus/Vuze',
  BT: 'BitTorrent',
  DE: 'Deluge',
  FD: 'Free Download Manager',
  KT: 'KTorrent',
  LT: 'libtorrent',
  qB: 'qBittorrent',
  QD: 'QQDownload',
  RN: 'Rain',
  TR: 'Transmission',
  UM: 'µTorrent Mac',
  UT: 'µTorrent',
  XL: 'Xunlei',
  UE: 'µTorrent'
}

export function getPeerClientName(peerId: string | undefined | null): string {
  if (!peerId) return ''
  let raw = peerId.trim()
  if (!raw) return ''
  try {
    if (raw.includes('%')) raw = decodeURIComponent(raw)
  } catch {
    // 非法 percent 序列时保留原值
  }
  const match = /^-([A-Za-z0-9]{2})[A-Za-z0-9]{4}-/.exec(raw)
  const code = match?.[1]
  if (code) {
    return CLIENT_CODES[code] ?? code
  }
  return raw
}

/** 把两位国家代码转成旗帜 emoji；非法输入返回空串。 */
export function countryCodeToFlag(code: string | undefined | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map(char => 0x1f1e6 + char.charCodeAt(0) - 65))
}
