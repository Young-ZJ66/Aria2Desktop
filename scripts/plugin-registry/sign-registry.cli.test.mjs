import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { main, parseArgs, signRegistry } from './sign-registry.mjs'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const dirs = []

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-registry-cli-'))
  dirs.push(dir)
  return dir
}

function writeFile(name, content) {
  const file = path.join(tmpDir(), name)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

function sampleRegistry() {
  return {
    version: 1,
    plugins: [
      {
        id: 'demo-plugin',
        name: 'Demo',
        version: '1.0.0',
        entryUrl: 'https://example.com/demo.js',
        sha256: 'a'.repeat(64)
      }
    ]
  }
}

let logs
let errors

beforeEach(() => {
  logs = []
  errors = []
  vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')))
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('parseArgs', () => {
  it('拆出命令、文件与 -- 选项', () => {
    expect(parseArgs(['sign', 'r.json', '--key', 'k.pem', '--out', 's.json'])).toEqual({
      command: 'sign',
      file: 'r.json',
      options: { key: 'k.pem', out: 's.json' }
    })
  })

  it('裸参数不占位，后面的选项仍能正确配对', () => {
    const parsed = parseArgs(['verify', 'r.json', 'stray', '--pubkey', 'p.pem'])
    expect(parsed.options).toEqual({ pubkey: 'p.pem' })
  })

  it('裸参数在末尾时也不影响前面的选项', () => {
    const parsed = parseArgs(['verify', 'r.json', '--pubkey', 'p.pem', 'stray'])
    expect(parsed.options).toEqual({ pubkey: 'p.pem' })
  })

  it('没有任何参数时字段为 undefined', () => {
    expect(parseArgs([])).toEqual({ command: undefined, file: undefined, options: {} })
  })
})

describe('main 的用法与结构闸门', () => {
  it('命令缺失或非法时返回 2 并打印用法', () => {
    expect(main([])).toBe(2)
    expect(main(['frobnicate', 'r.json'])).toBe(2)
    expect(errors.join('\n')).toContain('用法')
  })

  it('registry 结构不合法时返回 1 并给出错误码', () => {
    const file = writeFile('bad.json', JSON.stringify({ version: 999, plugins: [] }))
    expect(main(['sign', file, '--key', 'k.pem'])).toBe(1)
    expect(errors.join('\n')).toContain('UNSUPPORTED_REGISTRY_VERSION')
  })

  it('registry 不是合法 JSON 时抛出解析错误', () => {
    const file = writeFile('broken.json', '{ not json')
    expect(() => main(['sign', file, '--key', 'k.pem'])).toThrow()
  })
})

describe('main 的签名分支', () => {
  it('缺 --key 时返回 2', () => {
    const file = writeFile('r.json', JSON.stringify(sampleRegistry()))
    expect(main(['sign', file])).toBe(2)
    expect(errors.join('\n')).toContain('签名需要 --key')
  })

  it('签名后写回同一文件并保留可验证的 signature', () => {
    const file = writeFile('r.json', JSON.stringify(sampleRegistry()))
    const keyFile = writeFile('private.pem', PRIVATE_PEM)
    expect(main(['sign', file, '--key', keyFile])).toBe(0)
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(typeof written.signature).toBe('string')
    expect(logs.join('\n')).toContain('已签名并写入')
  })

  it('--out 指定输出文件时原文件保持不变', () => {
    const original = JSON.stringify(sampleRegistry())
    const file = writeFile('r.json', original)
    const keyFile = writeFile('private.pem', PRIVATE_PEM)
    const out = path.join(tmpDir(), 'signed.json')
    expect(main(['sign', file, '--key', keyFile, '--out', out])).toBe(0)
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).signature).toBeTruthy()
  })

  it('签名文件末尾补换行（与仓库里其它 JSON 一致）', () => {
    const file = writeFile('r.json', JSON.stringify(sampleRegistry()))
    const keyFile = writeFile('private.pem', PRIVATE_PEM)
    main(['sign', file, '--key', keyFile])
    expect(fs.readFileSync(file, 'utf8').endsWith('}\n')).toBe(true)
  })
})

describe('main 的校验分支', () => {
  it('缺 --pubkey 时返回 2', () => {
    const file = writeFile('r.json', JSON.stringify(sampleRegistry()))
    expect(main(['verify', file])).toBe(2)
    expect(errors.join('\n')).toContain('校验需要 --pubkey')
  })

  it('签名有效时返回 0', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    const file = writeFile('r.json', JSON.stringify(signed))
    const pubFile = writeFile('public.pem', PUBLIC_PEM)
    expect(main(['verify', file, '--pubkey', pubFile])).toBe(0)
    expect(logs.join('\n')).toContain('签名有效')
  })

  it('签名无效时返回 1', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    signed.plugins[0].sha256 = 'b'.repeat(64)
    const file = writeFile('r.json', JSON.stringify(signed))
    const pubFile = writeFile('public.pem', PUBLIC_PEM)
    expect(main(['verify', file, '--pubkey', pubFile])).toBe(1)
    expect(logs.join('\n')).toContain('签名无效或缺失')
  })

  it('完全没签名的 registry 校验返回 1', () => {
    const file = writeFile('r.json', JSON.stringify(sampleRegistry()))
    const pubFile = writeFile('public.pem', PUBLIC_PEM)
    expect(main(['verify', file, '--pubkey', pubFile])).toBe(1)
  })
})
