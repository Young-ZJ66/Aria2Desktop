/**
 * UPnP 端口映射服务（BT 连通性增强）
 *
 * 流程：SSDP 发现网关 → 读设备描述 → 提取控制 URL → 对 aria2 的 BT/DHT 端口
 * 逐个 AddPortMapping（TCP+UDP）→ 定时续租 → 退出时尽力删除映射。
 *
 * 设计约束：
 * - 纯 JS（dgram + http），无原生依赖（打包约束）
 * - 所有失败静默降级：路由器不支持 UPnP / 未启用 / 无网关时只记日志，
 *   状态经 IPC 查询展示在 BT 设置页
 * - 只映射 http 的 LAN 地址（upnpCore 校验），绝不把 SSDP 响应当任意 URL 用
 */

import dgram from 'dgram'
import http from 'http'
import { createLogger } from '../utils/logger'
import { getSettingsFresh } from '../utils/settingsAccessor'
import {
  addPortMappingSoapAction,
  buildAddPortMappingBody,
  buildDeletePortMappingBody,
  buildMappingPorts,
  buildSsdpSearchRequest,
  extractControlUrls,
  isSoapSuccess,
  isValidDeviceLocation,
  joinControlUrl,
  parseExternalIp,
  parseSsdpLocation
} from '../utils/upnpCore'

const logger = createLogger('')

/** SSDP 组播地址与端口（UPnP 标准） */
const SSDP_ADDR = '239.255.255.250'
const SSDP_PORT = 1900
const SSDP_TIMEOUT_MS = 3000
/** SOAP 请求超时 */
const SOAP_TIMEOUT_MS = 5000
/** 映射租期（秒）与续租间隔：租期 30 分钟，每 10 分钟续 */
const LEASE_SECONDS = 1800
const RENEW_INTERVAL_MS = 10 * 60 * 1000

export interface UpnpStatus {
  /** 当前状态：idle=未启用/未尝试，mapping=映射中，ok=已映射，unsupported=网关不支持 */
  state: 'idle' | 'mapping' | 'ok' | 'unsupported' | 'error'
  /** 外部 IP（网关报告的公网地址） */
  externalIp?: string
  /** 已映射端口 */
  ports?: number[]
  /** 失败/不支持的原因摘要 */
  message?: string
}

export class UpnpService {
  private renewTimer: NodeJS.Timeout | null = null
  private status: UpnpStatus = { state: 'idle' }
  /** 已建立的映射（退出时删除用） */
  private activeMappings: Array<{ controlUrl: string; externalPort: number; protocol: 'TCP' | 'UDP' }> = []
  private inFlight = false

  getStatus(): UpnpStatus {
    return { ...this.status }
  }

  /** 应用启动/设置启用时调用；已启用则映射，未启用则清理状态 */
  async start(): Promise<void> {
    const enabled = getSettingsFresh()?.bt?.upnpEnabled === true
    if (!enabled) {
      this.status = { state: 'idle' }
      return
    }
    await this.mapNow()
  }

  stop(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer)
      this.renewTimer = null
    }
    // 尽力删除映射（退出时不阻塞、失败不重试）
    for (const m of this.activeMappings) {
      httpSoap(m.controlUrl, buildDeletePortMappingBody(m.externalPort, m.protocol), addPortMappingSoapAction()).catch(
        () => {}
      )
    }
    this.activeMappings = []
    this.status = { state: 'idle' }
  }

  /** 设置页"立即映射"按钮：重新执行映射并返回最新状态 */
  async mapNow(): Promise<UpnpStatus> {
    if (this.inFlight) return this.getStatus()
    this.inFlight = true
    try {
      this.status = { state: 'mapping' }
      const result = await this.mapAll()
      if (result.ok) {
        this.status = { state: 'ok', externalIp: result.externalIp, ports: result.ports }
        // 续租定时器
        if (this.renewTimer) clearInterval(this.renewTimer)
        this.renewTimer = setInterval(() => {
          void this.mapNow()
        }, RENEW_INTERVAL_MS)
      } else {
        this.status = { state: 'unsupported', message: result.message }
      }
    } catch (error) {
      this.status = { state: 'error', message: String(error).slice(0, 200) }
    } finally {
      this.inFlight = false
    }
    return this.getStatus()
  }

  private async mapAll(): Promise<{ ok: boolean; externalIp?: string; ports?: number[]; message?: string }> {
    // 1) SSDP 发现网关
    const location = await discoverGateway().catch(() => null)
    if (!location || !isValidDeviceLocation(location)) {
      return { ok: false, message: '未发现支持 UPnP 的路由器' }
    }
    // 2) 设备描述 → 控制 URL
    const deviceXml = await httpGet(location).catch(() => null)
    if (!deviceXml) {
      return { ok: false, message: '路由器设备描述不可读' }
    }
    const controlPaths = extractControlUrls(deviceXml)
    const controlUrl = controlPaths.map(p => joinControlUrl(location, p)).find(Boolean)
    if (!controlUrl) {
      return { ok: false, message: '路由器不支持 WANIPConnection 映射服务' }
    }
    // 3) 本机局域网 IP（映射目标）
    const internalIp = await getLocalLanIp()
    if (!internalIp) {
      return { ok: false, message: '未获取到局域网地址' }
    }
    // 4) 端口清单：读引擎全局选项的 bt-listen-port / dht-port
    const settings = getSettingsFresh()
    const port = Number(settings.aria2?.port) || 6800
    const secret = String(settings.aria2?.secret || '')
    const { callAria2Rpc } = await import('../utils/aria2Rpc')
    let btListen = 6881
    let dht = 6881
    try {
      const opts = (await callAria2Rpc({ port, secret, method: 'aria2.getGlobalOption' })) as Record<string, string>
      btListen = Number(String(opts?.['bt-listen-port'] ?? '6881').split(',')[0]) || 6881
      dht = Number(String(opts?.['dht-listen-port'] ?? '6881').split(',')[0]) || 6881
    } catch {
      // 引擎未运行时用默认端口
    }
    const ports = buildMappingPorts(btListen, dht)
    // 5) 逐端口 TCP+UDP 映射
    const mapped: number[] = []
    for (const p of ports) {
      for (const proto of ['TCP', 'UDP'] as const) {
        const body = buildAddPortMappingBody(
          { externalPort: p, internalPort: p, protocol: proto, description: 'Aria2Desktop', leaseDuration: LEASE_SECONDS },
          internalIp
        )
        const resp = await httpSoap(controlUrl, body, addPortMappingSoapAction()).catch(() => null)
        if (!resp) continue
        const verdict = isSoapSuccess(resp.statusCode, resp.body)
        if (verdict.ok) {
          if (!mapped.includes(p)) mapped.push(p)
          this.activeMappings.push({ controlUrl, externalPort: p, protocol: proto })
        }
      }
    }
    if (mapped.length === 0) {
      return { ok: false, message: '端口映射被路由器拒绝' }
    }
    // 6) 查询外部 IP（失败不影响映射结果）
    let externalIp: string | undefined
    try {
      const ipBody = buildGetExternalIpBody()
      const resp = await httpSoap(controlUrl, ipBody, '"urn:schemas-upnp-org:service:WANIPConnection:1#GetExternalIPAddress"')
      if (resp) externalIp = parseExternalIp(resp.body) ?? undefined
    } catch {
      // 外部 IP 查询失败不影响映射
    }
    logger.info(`[UpnpService] 端口映射完成: ${mapped.join(',')} 外部IP=${externalIp ?? '未知'}`)
    return { ok: true, externalIp, ports: mapped }
  }
}

/** SSDP 组播搜索：发 M-SEARCH，收集 3 秒内的首个有效响应 */
async function discoverGateway(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      try { socket.close() } catch { /* 已关闭 */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), SSDP_TIMEOUT_MS)
    socket.on('error', () => { clearTimeout(timer); finish(null) })
    socket.on('message', (msg) => {
      const location = parseSsdpLocation(msg.toString('utf8'))
      if (location) { clearTimeout(timer); finish(location) }
    })
    socket.bind(() => {
      const req = buildSsdpSearchRequest('urn:schemas-upnp-org:device:InternetGatewayDevice:1')
      socket.send(req, SSDP_PORT, SSDP_ADDR)
    })
  })
}

/** 简易 http GET（设备描述文档） */
function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: SOAP_TIMEOUT_MS }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => { data += c.toString('utf8') })
      res.on('end', () => resolve(data))
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

/** 简易 http POST SOAP */
function httpSoap(controlUrl: string, body: string, soapAction: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      controlUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          SOAPAction: soapAction,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: SOAP_TIMEOUT_MS
      },
      (res) => {
        let data = ''
        res.on('data', (c: Buffer) => { data += c.toString('utf8') })
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }))
      }
    )
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function buildGetExternalIpBody(): string {
  return [
    '<?xml version="1.0"?>',
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<SOAP-ENV:Body>',
    '<m:GetExternalIPAddress xmlns:m="urn:schemas-upnp-org:service:WANIPConnection:1">',
    '</m:GetExternalIPAddress>',
    '</SOAP-ENV:Body>',
    '</SOAP-ENV:Envelope>'
  ].join('\r\n')
}

/** 取本机局域网 IPv4（第一个非回环的 IPv4 地址） */
async function getLocalLanIp(): Promise<string | null> {
  const os = await import('os')
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return null
}

/** 模块级单例：主进程与 IpcController 共用同一状态与续租定时器 */
export const upnpService = new UpnpService()
