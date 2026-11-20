import { describe, expect, it } from 'vitest'
import { hasRestartRequiredOption, RESTART_REQUIRED_OPTIONS } from './aria2RestartOptions'

/**
 * 「需要重启 aria2 才生效」的选项集合回归测试。
 *
 * 集合漏项 → 用户改了选项、看到「已保存」，实际引擎仍按旧参数跑；
 * 集合多项 → 每次保存都弹「需要重启」的提示，用户会习惯性忽略真正的提醒。
 */
describe('RESTART_REQUIRED_OPTIONS：集合本身', () => {
  it('包含 RPC 启动项（只能靠配置文件 + 重启生效）', () => {
    for (const key of ['enable-rpc', 'rpc-listen-port', 'rpc-listen-all', 'rpc-allow-origin-all', 'rpc-secret', 'rpc-secure', 'rpc-certificate', 'rpc-private-key']) {
      expect(RESTART_REQUIRED_OPTIONS.has(key)).toBe(true)
    }
  })

  it('包含 DHT 与 BT 监听相关启动项', () => {
    for (const key of ['enable-dht', 'enable-dht6', 'dht-listen-port', 'dht-file-path', 'dht-file-path6', 'dht-entry-point', 'dht-entry-point6', 'bt-enable-lpd', 'listen-port', 'bt-external-ip']) {
      expect(RESTART_REQUIRED_OPTIONS.has(key)).toBe(true)
    }
  })

  it('不包含可运行时修改的下载参数（否则每次保存都误报需要重启）', () => {
    for (const key of ['max-concurrent-downloads', 'max-overall-download-limit', 'max-overall-upload-limit', 'continue', 'split', 'max-connection-per-server', 'dir']) {
      expect(RESTART_REQUIRED_OPTIONS.has(key)).toBe(false)
    }
  })
})

describe('hasRestartRequiredOption：选项集判定', () => {
  it('命中任一项即为真', () => {
    expect(hasRestartRequiredOption({ 'listen-port': '6881' })).toBe(true)
    expect(hasRestartRequiredOption({ 'max-concurrent-downloads': '5', 'rpc-secret': 'x' })).toBe(true)
  })

  it('全部是运行时选项时为假', () => {
    expect(hasRestartRequiredOption({ 'max-concurrent-downloads': '5', dir: '/tmp' })).toBe(false)
  })

  it('空对象为假（保存空变更不应弹重启提示）', () => {
    expect(hasRestartRequiredOption({})).toBe(false)
  })

  it('只看键名，不看值是否为 undefined', () => {
    expect(hasRestartRequiredOption({ 'listen-port': undefined })).toBe(true)
  })
})
