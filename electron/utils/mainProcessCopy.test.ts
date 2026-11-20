import { describe, expect, it } from 'vitest'
import { mainLocaleFrom, resolveMainLocale } from './mainLocale'
import {
  defaultExtensionName,
  downloadNotificationTitle,
  extensionPairingCopy,
  rendererCrashCopy,
  streamDownloadError,
  upnpFailureMessage,
  webConsoleTlsError
} from './mainProcessCopy'

const CJK = /[\u4e00-\u9fff]/

describe('resolveMainLocale', () => {
  it('中文各变体归一为 zh', () => {
    expect(resolveMainLocale('zh-CN')).toBe('zh')
    expect(resolveMainLocale('zh-TW')).toBe('zh')
    expect(resolveMainLocale('ZH')).toBe('zh')
  })

  it('其余语言与空值归一为 en', () => {
    expect(resolveMainLocale('en-US')).toBe('en')
    expect(resolveMainLocale('ja-JP')).toBe('en')
    expect(resolveMainLocale('')).toBe('en')
    expect(resolveMainLocale(undefined)).toBe('en')
    expect(resolveMainLocale(null)).toBe('en')
  })
})

describe('mainLocaleFrom', () => {
  it('读取取语言函数的结果', () => {
    expect(mainLocaleFrom(() => 'zh-CN')).toBe('zh')
    expect(mainLocaleFrom(() => 'de-DE')).toBe('en')
  })

  it('取语言函数缺失或抛错时退回中文', () => {
    expect(mainLocaleFrom(undefined)).toBe('zh')
    expect(mainLocaleFrom(() => { throw new Error('no app') })).toBe('zh')
  })
})

describe('主进程文案表', () => {
  it('渲染进程崩溃对话框两语言齐全', () => {
    for (const locale of ['zh', 'en'] as const) {
      const copy = rendererCrashCopy(locale)
      expect(copy.title.length).toBeGreaterThan(0)
      expect(copy.message.length).toBeGreaterThan(0)
      expect(copy.detail.length).toBeGreaterThan(0)
      expect(copy.restart.length).toBeGreaterThan(0)
      expect(copy.close.length).toBeGreaterThan(0)
    }
    expect(rendererCrashCopy('zh').title).toMatch(CJK)
    expect(rendererCrashCopy('en').title).not.toMatch(CJK)
    expect(rendererCrashCopy('en').detail).not.toMatch(CJK)
  })

  it('扩展配对框两语言齐全且英文不含中文', () => {
    for (const locale of ['zh', 'en'] as const) {
      const copy = extensionPairingCopy(locale)
      const fields = [
        copy.title, copy.message, copy.allow, copy.deny,
        copy.labelName, copy.labelExtensionId, copy.labelOrigin, copy.labelVersion,
        copy.unknown, copy.canDo, copy.cannotDo
      ]
      for (const field of fields) expect(field.length).toBeGreaterThan(0)
    }
    const en = extensionPairingCopy('en')
    for (const field of [en.title, en.message, en.allow, en.deny, en.canDo, en.cannotDo]) {
      expect(field).not.toMatch(CJK)
    }
    expect(extensionPairingCopy('zh').title).toMatch(CJK)
  })

  it('下载通知标题按语言与成败区分', () => {
    expect(downloadNotificationTitle('zh', true)).toBe('下载完成')
    expect(downloadNotificationTitle('zh', false)).toBe('下载失败')
    expect(downloadNotificationTitle('en', true)).toBe('Download complete')
    expect(downloadNotificationTitle('en', false)).toBe('Download failed')
  })

  it('扩展默认展示名按语言区分', () => {
    expect(defaultExtensionName('zh')).toMatch(CJK)
    expect(defaultExtensionName('en')).not.toMatch(CJK)
  })

  it('UPnP 失败原因两种语言齐全且英文不含中文', () => {
    const reasons = [
      'no-gateway',
      'device-description-unreadable',
      'wanipconnection-unsupported',
      'no-lan-address',
      'remote-engine',
      'rejected'
    ] as const
    for (const reason of reasons) {
      expect(upnpFailureMessage('zh', reason)).toMatch(CJK)
      expect(upnpFailureMessage('en', reason).length).toBeGreaterThan(0)
      expect(upnpFailureMessage('en', reason)).not.toMatch(CJK)
    }
  })

  it('Web 控制台 TLS 错误两语言齐全且英文不含中文', () => {
    const kinds = ['pair-required', 'absolute-path', 'load-failed', 'lan-requires-tls'] as const
    for (const kind of kinds) {
      expect(webConsoleTlsError('zh', kind)).toMatch(CJK)
      expect(webConsoleTlsError('en', kind)).not.toMatch(CJK)
    }
    // 带详情时用全角冒号拼接，两种语言都不该出现空详情残留
    expect(webConsoleTlsError('zh', 'load-failed', 'ENOENT')).toContain('ENOENT')
    expect(webConsoleTlsError('en', 'load-failed', 'ENOENT')).toContain('ENOENT')
  })

  it('流媒体下载失败文案按语言区分并带上限值', () => {
    expect(streamDownloadError('zh', 'too-many', '', 3)).toContain('3')
    expect(streamDownloadError('en', 'too-many', '', 3)).toContain('3')
    expect(streamDownloadError('zh', 'too-many', '', 3)).toMatch(CJK)
    expect(streamDownloadError('en', 'too-many', '', 3)).not.toMatch(CJK)
    expect(streamDownloadError('zh', 'ffmpeg-missing')).toMatch(CJK)
    expect(streamDownloadError('en', 'ffmpeg-missing')).not.toMatch(CJK)
    expect(streamDownloadError('zh', 'no-output-file')).toMatch(CJK)
    expect(streamDownloadError('en', 'no-output-file')).not.toMatch(CJK)
    expect(streamDownloadError('zh', 'create-output-dir', 'EACCES')).toContain('EACCES')
    expect(streamDownloadError('en', 'create-temp-dir', 'EACCES')).toContain('EACCES')
    expect(streamDownloadError('en', 'create-temp-dir', 'EACCES')).not.toMatch(CJK)
  })
})
