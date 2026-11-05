import { describe, expect, it } from 'vitest'
import {
  buildAddPortMappingBody,
  addPortMappingSoapAction,
  buildDeletePortMappingBody,
  buildMappingPorts,
  buildSsdpSearchRequest,
  extractControlUrls,
  isSoapSuccess,
  isValidDeviceLocation,
  joinControlUrl,
  parseExternalIp,
  parseSsdpLocation
} from './upnpCore'

describe('buildSsdpSearchRequest', () => {
  it('标准 M-SEARCH 报文', () => {
    const req = buildSsdpSearchRequest('urn:schemas-upnp-org:device:InternetGatewayDevice:1')
    expect(req).toContain('M-SEARCH * HTTP/1.1')
    expect(req).toContain('HOST: 239.255.255.250:1900')
    expect(req).toContain('ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1')
    expect(req).toContain('MX: 3')
  })
})

describe('parseSsdpLocation', () => {
  it('提取 Location 头（大小写不敏感）', () => {
    const resp = 'HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.1.1:5000/desc.xml\r\nST: urn:...\r\n'
    expect(parseSsdpLocation(resp)).toBe('http://192.168.1.1:5000/desc.xml')
  })

  it('无 Location 返回 null', () => {
    expect(parseSsdpLocation('HTTP/1.1 200 OK\r\nST: x\r\n')).toBeNull()
  })
})

describe('isValidDeviceLocation', () => {
  it('仅接受 http 且带主机；根路径也合法', () => {
    expect(isValidDeviceLocation('http://192.168.1.1:5000/desc.xml')).toBe(true)
    expect(isValidDeviceLocation('http://192.168.1.1:5000')).toBe(true)
    expect(isValidDeviceLocation('https://example.com/x')).toBe(false)
    expect(isValidDeviceLocation('file:///c:/x')).toBe(false)
    expect(isValidDeviceLocation('not a url')).toBe(false)
  })
})

describe('extractControlUrls', () => {
  it('提取 WANIPConnection 与 WANPPPConnection 的 controlURL', () => {
    const xml = `
    <service>
      <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
      <controlURL>/ctl/IPConn</controlURL>
    </service>
    <service>
      <serviceType>urn:schemas-upnp-org:service:WANPPPConnection:1</serviceType>
      <controlURL>/ctl/PPPConn</controlURL>
    </service>`
    expect(extractControlUrls(xml)).toEqual(['/ctl/IPConn', '/ctl/PPPConn'])
  })

  it('其他服务（如 WANCommonInterfaceConfig）不提取', () => {
    const xml = '<serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType><controlURL>/x</controlURL>'
    expect(extractControlUrls(xml)).toEqual([])
  })

  it('控制 URL 含空白与大小写变体时仍可提取', () => {
    const xml = '<serviceType>urn:schemas-upnp-org:service:WANIPConnection:2</serviceType><CONTROLURL> /y </CONTROLURL>'
    expect(extractControlUrls(xml)).toEqual(['/y'])
  })
})

describe('joinControlUrl', () => {
  it('拼接设备地址与相对控制路径', () => {
    expect(joinControlUrl('http://192.168.1.1:5000/desc.xml', '/ctl/IPConn')).toBe(
      'http://192.168.1.1:5000/ctl/IPConn'
    )
  })

  it('路径已带斜杠时不重复拼接', () => {
    expect(joinControlUrl('http://192.168.1.1:5000/desc.xml', '/ctl/IPConn')).toBe(
      'http://192.168.1.1:5000/ctl/IPConn'
    )
  })

  it('拒绝 https 设备地址（UPnP 是 LAN 明文协议）', () => {
    expect(joinControlUrl('https://x/desc', '/y')).toBeNull()
  })
})

describe('buildAddPortMappingBody', () => {
  it('包含全部 New* 字段且 XML 转义描述', () => {
    const body = buildAddPortMappingBody(
      { externalPort: 6881, internalPort: 6881, protocol: 'TCP', description: 'Aria2 "BT" <test>', leaseDuration: 1800 },
      '192.168.1.66'
    )
    expect(body).toContain('<NewExternalPort>6881</NewExternalPort>')
    expect(body).toContain('<NewProtocol>TCP</NewProtocol>')
    expect(body).toContain('<NewInternalClient>192.168.1.66</NewInternalClient>')
    expect(body).toContain('Aria2 &quot;BT&quot; &lt;test&gt;')
    expect(body).toContain('<NewLeaseDuration>1800</NewLeaseDuration>')
  })
})

describe('addPortMappingSoapAction', () => {
  it('带引号的标准 SOAPAction', () => {
    expect(addPortMappingSoapAction()).toBe('"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping"')
  })
})

describe('buildDeletePortMappingBody', () => {
  it('包含端口与协议', () => {
    const body = buildDeletePortMappingBody(6881, 'UDP')
    expect(body).toContain('<NewExternalPort>6881</NewExternalPort>')
    expect(body).toContain('<NewProtocol>UDP</NewProtocol>')
  })
})

describe('isSoapSuccess', () => {
  it('200 且无 Fault → 成功', () => {
    expect(isSoapSuccess(200, '<AddPortMappingResponse/>')).toEqual({ ok: true, alreadyExists: false })
  })

  it('Fault 且 errorCode 718 → 已存在（视为成功）', () => {
    const body = '<SOAP-ENV:Fault><errorCode>718</errorCode></SOAP-ENV:Fault>'
    expect(isSoapSuccess(500, body)).toEqual({ ok: true, alreadyExists: true })
  })

  it('Fault 其他错误码 → 失败', () => {
    const body = '<s:Fault><errorCode>402</errorCode></s:Fault>'
    expect(isSoapSuccess(500, body)).toEqual({ ok: false, alreadyExists: false })
  })

  it('非 200 无 Fault → 失败', () => {
    expect(isSoapSuccess(404, 'not found')).toEqual({ ok: false, alreadyExists: false })
  })
})

describe('parseExternalIp', () => {
  it('提取外部 IP', () => {
    expect(parseExternalIp('<NewExternalIPAddress>1.2.3.4</NewExternalIPAddress>')).toBe('1.2.3.4')
    expect(parseExternalIp('none')).toBeNull()
  })
})

describe('buildMappingPorts', () => {
  it('BT 与 DHT 端口去重合并', () => {
    expect(buildMappingPorts(6881, 6881)).toEqual([6881])
    expect(buildMappingPorts(6881, 6888)).toEqual([6881, 6888])
  })

  it('非法端口过滤', () => {
    expect(buildMappingPorts(0, 70000)).toEqual([])
  })
})
