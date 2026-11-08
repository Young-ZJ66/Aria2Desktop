export interface PeerLocation {
  country: string
  countryCode: string
}

interface IpApiRow {
  status?: string
  query?: string
  country?: string
  countryCode?: string
}

/**
 * 批量查询 IP 地理位置（仅用于 BT Peer 面板，由用户显式点击触发）。
 * 使用 ip-api.com 免费批量接口；失败时返回空对象，面板保持“未知”，不影响任务详情。
 */
export async function lookupPeerLocations(
  ips: string[],
  fetcher: typeof fetch = fetch
): Promise<Record<string, PeerLocation>> {
  const unique = [...new Set(ips.filter(ip => typeof ip === 'string' && ip.trim()))].slice(0, 100)
  if (unique.length === 0) return {}

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetcher('https://ip-api.com/batch?fields=status,message,query,country,countryCode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unique),
      signal: controller.signal
    })
    if (!response.ok) return {}
    const rows = await response.json() as IpApiRow[]
    const result: Record<string, PeerLocation> = {}
    for (const row of rows) {
      if (row.status === 'success' && row.query && row.countryCode) {
        result[row.query] = {
          country: row.country || row.countryCode,
          countryCode: row.countryCode.toUpperCase()
        }
      }
    }
    return result
  } catch {
    return {}
  } finally {
    clearTimeout(timer)
  }
}
