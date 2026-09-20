#!/usr/bin/env node
/**
 * 从 build/Icon.ico 抽帧，生成浏览器扩展所需的 PNG 图标。
 *
 * 为什么不直接把 .ico 填进 manifest：
 * Chrome 官方支持 ICO（Blink 支持的位图格式均可，PNG 只是因为透明度支持最好而被推荐），
 * 但 manifest 的 icons 是「尺寸 → 文件」的映射，把一个多尺寸容器 ICO 填进去后，
 * 工具栏(24px)/Windows(32px) 这类未声明尺寸需要 Chrome 自行挑帧或缩放，行为不可控、高分屏易糊；
 * 且 Chrome Web Store 上传还需要单独的 128×128 PNG。因此扩展侧的惯例是每个尺寸一个 PNG。
 *
 * 本脚本把 ICO 里的对应帧解码并转存为 PNG（16/48/128），保证扩展图标与 App 图标一致。
 * ICO 换图后重跑一次即可：`node scripts/sync-extension-icons.mjs`
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const icoPath = path.join(root, 'build', 'Icon.ico')
const outDir = path.join(root, 'extension', 'icons')

/** 需要生成的尺寸 */
const TARGETS = [16, 48, 128]

// ── PNG 最小编码器（RGBA8，filter 全 0）──

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 像素行前置 filter 字节（0 = None）
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** 解码 PNG（仅支持本脚本产出的形态：RGBA8、filter 全 0），用于写盘前自校验 */
function decodePng(png) {
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('PNG 签名不正确')
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset < png.length) {
    const len = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    offset += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    raw.copy(rgba, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1))
  }
  return { width, height, rgba }
}

// ── ICO 解析 ──

/**
 * 读取 ICO 的所有帧。
 * ICO 帧有两种形态：PNG 压缩帧（原样返回）与 BMP/DIB 帧（解码为 RGBA 后重编码为 PNG）。
 * 返回值中的 rgba 是「编码前」的像素，供写盘前自校验比对。
 */
function readIcoFrames(buf) {
  const count = buf.readUInt16LE(4)
  const frames = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    let width = buf[entry]
    let height = buf[entry + 1]
    if (width === 0) width = 256
    if (height === 0) height = 256
    const size = buf.readUInt32LE(entry + 8)
    const offset = buf.readUInt32LE(entry + 12)
    const data = buf.subarray(offset, offset + size)

    if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
      const decoded = decodePng(Buffer.from(data))
      frames.push({ width, height, rgba: decoded.rgba, png: Buffer.from(data) })
      continue
    }

    // BMP/DIB 帧：BITMAPINFOHEADER(40) + 自底向上的 BGRA 像素行 + AND 掩码
    const rowBytes = width * 4 // 32bpp 天然 4 字节对齐
    const rgba = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      // ICO 的 DIB 行是自底向上的，PNG 需要 top-down，因此翻转
      const src = 40 + (height - 1 - y) * rowBytes
      for (let x = 0; x < width; x++) {
        const p = src + x * 4
        const dst = (y * width + x) * 4
        rgba[dst] = data[p + 2] // R
        rgba[dst + 1] = data[p + 1] // G
        rgba[dst + 2] = data[p] // B
        rgba[dst + 3] = data[p + 3] // A
      }
    }
    frames.push({ width, height, rgba, png: encodePng(width, height, rgba) })
  }
  return frames
}

// ── 主流程 ──

if (!fs.existsSync(icoPath)) {
  console.error(`找不到 ${icoPath}，请先在 build/Icon.ico 放置应用图标`)
  process.exit(1)
}

const frames = readIcoFrames(fs.readFileSync(icoPath))
const results = []

for (const size of TARGETS) {
  const frame = frames.find(f => f.width === size && f.height === size)
  if (!frame) {
    console.error(`ICO 中没有 ${size}x${size} 的帧，跳过`)
    continue
  }

  // 自校验：把刚编码的 PNG 解码回来，与编码前的像素逐字节比对，确保没有写坏
  const decoded = decodePng(frame.png)
  if (decoded.width !== frame.width || decoded.height !== frame.height) {
    console.error(`自校验失败：${size}x${size} 尺寸不符`)
    process.exit(1)
  }
  if (Buffer.compare(decoded.rgba, frame.rgba) !== 0) {
    console.error(`自校验失败：${size}x${size} 像素不一致`)
    process.exit(1)
  }

  const outPath = path.join(outDir, `icon${size}.png`)
  fs.writeFileSync(outPath, frame.png)
  results.push(`  icon${size}.png  ${frame.width}x${frame.height}  ${frame.png.length} bytes`)
}

console.log(`已从 build/Icon.ico 生成扩展图标：\n${results.join('\n')}\n输出目录: ${outDir}`)
