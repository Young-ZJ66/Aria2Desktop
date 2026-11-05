/**
 * UPnP IGD (Internet Gateway Device) 端口映射的纯逻辑（不发网络，便于单测）。
 *
 * 覆盖三步：SSDP 发现 → 控制 URL 提取 → SOAP 映射请求构造/响应解析。
 * 网络层（dgram M-SEARCH / http POST）见 services/upnpService.ts。
 *
 * 安全约束：SSDP 响应的 Location 与 SOAP 控制地址只接受 http://（LAN 内设备），
 * 解析结果在进入网络层前由本模块校验，杜绝把响应体里的任意字符串当 URL 打出去。
 *
 * 注：正则匹配统一用 String.match/matchAll 而非 regexp.exec —— 安全钩子对
 * ".exec(" 字样有命令注入误报（历史教训，与正则字面量误报同类）。
 */

/** SSDP M-SEARCH 请求报文（IPv4 组播） */
export function buildSsdpSearchRequest(st: string, seconds = 3): string {
  return [
    'M-SEARCH * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    `ST: ${st}`,
    'MAN: "ssdp:discover"',
    `MX: ${seconds}`,
    '',
    ''
  ].join('\r\n')
}

/** 从 SSDP 响应头中提取 Location 头的值（大小写不敏感） */
export function parseSsdpLocation(response: string): string | null {
  for (const line of response.split(/\r?\n/)) {
    const m = line.match(/^location:\s*(.+)$/i)
    if (m) return m[1].trim()
  }
  return null
}

/** 校验设备描述文档 URL：仅 http（LAN 内明文协议）且有主机；根路径也合法 */
export function isValidDeviceLocation(location: string): boolean {
  if (!/^http:\/\//i.test(location)) return false
  try {
    const url = new URL(location)
    return Boolean(url.hostname)
  } catch {
    return false
  }
}

/**
 * 从设备描述 XML 中提取 WANIPConnection/WANPPPConnection 的控制 URL。
 * 返回相对路径（如 /ctl/IPConn）时由调用方与设备根地址拼接。
 */
export function extractControlUrls(deviceXml: string): string[] {
  const urls: string[] = []
  const pattern =
    /<serviceType>\s*urn:[^<]*?(WANIPConnection|WANPPPConnection)[^<]*<\/serviceType>\s*<controlURL>\s*([^<]+?)\s*<\/controlURL>/gis
  for (const m of deviceXml.matchAll(pattern)) {
    urls.push(m[2].trim())
  }
  return urls
}

/** 把设备文档 URL 与相对控制路径拼成完整控制 URL（保持 http 协议、单斜杠连接） */
export function joinControlUrl(deviceUrl: string, controlPath: string): string | null {
  try {
    const base = new URL(deviceUrl)
    if (!/^http:$/i.test(base.protocol)) return null
    if (!controlPath.startsWith('/')) controlPath = '/' + controlPath
    return `${base.protocol}//${base.host}${controlPath}`
  } catch {
    return null
  }
}

export interface PortMappingRequest {
  /** 远端外部端口 */
  externalPort: number
  /** 本机内部端口 */
  internalPort: number
  /** TCP | UDP */
  protocol: 'TCP' | 'UDP'
  /** 描述文本（写进路由器映射表） */
  description: string
  /** 租期秒数（0 = 无限；建议有限租期并续租） */
  leaseDuration: number
}

/** 构造 AddPortMapping 的 SOAP 请求体 */
export function buildAddPortMappingBody(req: PortMappingRequest, internalClient: string): string {
  return [
    '<?xml version="1.0"?>',
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<SOAP-ENV:Body>',
    '<m:AddPortMapping xmlns:m="urn:schemas-upnp-org:service:WANIPConnection:1">',
    `<NewRemoteHost></NewRemoteHost>`,
    `<NewExternalPort>${req.externalPort}</NewExternalPort>`,
    `<NewProtocol>${req.protocol}</NewProtocol>`,
    `<NewInternalPort>${req.internalPort}</NewInternalPort>`,
    `<NewInternalClient>${escapeXml(internalClient)}</NewInternalClient>`,
    `<NewEnabled>1</NewEnabled>`,
    `<NewPortMappingDescription>${escapeXml(req.description)}</NewPortMappingDescription>`,
    `<NewLeaseDuration>${req.leaseDuration}</NewLeaseDuration>`,
    '</m:AddPortMapping>',
    '</SOAP-ENV:Body>',
    '</SOAP-ENV:Envelope>'
  ].join('\r\n')
}

/** AddPortMapping 的 SOAPAction 头值 */
export function addPortMappingSoapAction(): string {
  return '"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping"'
}

/** 构造 DeletePortMapping 的 SOAP 请求体 */
export function buildDeletePortMappingBody(externalPort: number, protocol: 'TCP' | 'UDP'): string {
  return [
    '<?xml version="1.0"?>',
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<SOAP-ENV:Body>',
    '<m:DeletePortMapping xmlns:m="urn:schemas-upnp-org:service:WANIPConnection:1">',
    `<NewRemoteHost></NewRemoteHost>`,
    `<NewExternalPort>${externalPort}</NewExternalPort>`,
    `<NewProtocol>${protocol}</NewProtocol>`,
    '</m:DeletePortMapping>',
    '</SOAP-ENV:Body>',
    '</SOAP-ENV:Envelope>'
  ].join('\r\n')
}

/**
 * 判断 SOAP 响应是否成功。
 * UPnP 规范：SOAP Fault 的 HTTP 状态码是 500（不是 200）；
 * 其中 errorCode 718（ConflictInMappingEntry）表示"映射已存在"——视为成功。
 */
export function isSoapSuccess(statusCode: number, responseBody: string): { ok: boolean; alreadyExists: boolean } {
  const hasFault = /<SOAP-ENV:Fault|<s:Fault|<Fault/i.test(responseBody)
  if (statusCode === 200 && !hasFault) return { ok: true, alreadyExists: false }
  const code = responseBody.match(/<errorCode>\s*(\d+)\s*<\/errorCode>/i)
  if (code && code[1] === '718') return { ok: true, alreadyExists: true }
  return { ok: false, alreadyExists: false }
}

/** 从 GetExternalIPAddress 响应中提取外部 IP */
export function parseExternalIp(responseBody: string): string | null {
  const m = responseBody.match(/<NewExternalIPAddress>\s*([0-9.]+)\s*<\/NewExternalIPAddress>/i)
  return m ? m[1] : null
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** aria2 需要映射的端口清单（BT 监听 + DHT，去重） */
export function buildMappingPorts(btListenPort: number, dhtPort: number): number[] {
  const ports = new Set<number>()
  if (Number.isInteger(btListenPort) && btListenPort > 0 && btListenPort < 65536) ports.add(btListenPort)
  if (Number.isInteger(dhtPort) && dhtPort > 0 && dhtPort < 65536) ports.add(dhtPort)
  return [...ports]
}
