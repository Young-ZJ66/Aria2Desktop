import { describe, expect, it } from 'vitest'
import { classifyUpdateError, COMPONENT_ERROR_MESSAGE_KEYS, UPDATE_ERROR_MESSAGE_KEYS } from './updateError'

describe('classifyUpdateError', () => {
  it('DNS/连接类错误归为网络问题', () => {
    expect(classifyUpdateError('getaddrinfo ENOTFOUND github.com')).toBe('network')
    expect(classifyUpdateError('connect ETIMEDOUT 20.205.243.166:443')).toBe('network')
    expect(classifyUpdateError('read ECONNRESET')).toBe('network')
    expect(classifyUpdateError('socket hang up')).toBe('network')
  })

  it('403/429 归为限流', () => {
    expect(classifyUpdateError('Unexpected status from releases/latest: 403')).toBe('rateLimited')
    expect(classifyUpdateError('Download failed: 429')).toBe('rateLimited')
  })

  it('安装包 404 归为缺少产物', () => {
    expect(classifyUpdateError('Download failed: 404')).toBe('assetMissing')
  })

  it('校验失败单独一类', () => {
    expect(classifyUpdateError('SHA-256 校验失败：期望 aaaa，实际 bbbb')).toBe('checksum')
    expect(classifyUpdateError('SHA-256 校验文件格式异常，已拒绝自动安装')).toBe('checksum')
  })

  it('语义化标记不当作未知错误', () => {
    expect(classifyUpdateError('manual_download_required')).toBe('manualDownload')
    expect(classifyUpdateError('Development mode does not support auto update')).toBe('devMode')
    expect(classifyUpdateError('Download already in progress')).toBe('busy')
    expect(classifyUpdateError('No update available')).toBe('noUpdate')
  })

  it('跳转异常归为 redirect', () => {
    expect(classifyUpdateError('Too many redirects')).toBe('redirect')
    expect(classifyUpdateError('No release tag found in redirect Location')).toBe('redirect')
  })

  it('认不出来时返回 unknown，交给调用方决定是否展示原串', () => {
    expect(classifyUpdateError('something odd happened')).toBe('unknown')
    expect(classifyUpdateError('')).toBe('unknown')
    expect(classifyUpdateError(undefined)).toBe('unknown')
  })

  it('网络错误不会盖住 5xx 之类的服务端状态', () => {
    expect(classifyUpdateError('Download failed: 502')).toBe('unknown')
  })

  it('每种分类都有对应的文案键（键本身存在性由 scripts/i18n-keys.test.mjs 对账）', () => {
    for (const kind of Object.keys(UPDATE_ERROR_MESSAGE_KEYS)) {
      expect(classifyUpdateError('unknown thing')).not.toBe(kind)
    }
    expect(Object.keys(UPDATE_ERROR_MESSAGE_KEYS).length).toBe(9)
  })

  it('组件下载失败只挑用户能处理的几类，其余保留原串', () => {
    expect(Object.keys(COMPONENT_ERROR_MESSAGE_KEYS).sort()).toEqual(
      ['assetMissing', 'checksum', 'network', 'rateLimited', 'redirect']
    )
    // 这几类对"下载 yt-dlp / ffmpeg 失败"没有意义，不能把用户引到错误的建议上
    expect(COMPONENT_ERROR_MESSAGE_KEYS.devMode).toBeUndefined()
    expect(COMPONENT_ERROR_MESSAGE_KEYS.noUpdate).toBeUndefined()
    expect(COMPONENT_ERROR_MESSAGE_KEYS.unknown).toBeUndefined()
    expect(classifyUpdateError('getaddrinfo ENOTFOUND github.com')).toBe('network')
    expect(classifyUpdateError('Download failed: 404')).toBe('assetMissing')
  })
})
