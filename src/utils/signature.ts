/*
 * 签名工具的算法实现：HMAC 生成、摘要计算、常量时间比对。
 *
 * 分两类：
 *  - HMAC / SHA-1 / SHA-256 / SHA-512 走 Web Crypto（crypto.subtle），异步
 *  - MD5 不在 Web Crypto 的摘要清单里，只能自己实现一份
 *
 * 比对单独成函数（timingSafeEqual）：它不是「== 的更快版本」，而是
 * 长度固定、逐字节走完全程、不提前返回 —— 用来避免按响应时间逐位试出正确签名。
 */

/* ---------------- 可选的算法 ---------------- */

export type HmacAlgorithm = 'SHA-256' | 'SHA-1' | 'SHA-512' | 'MD5'
export type DigestAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-512'
export type OutputEncoding = 'hex' | 'base64'

export const HMAC_ALGORITHMS: HmacAlgorithm[] = ['SHA-256', 'SHA-1', 'SHA-512', 'MD5']
export const DIGEST_ALGORITHMS: DigestAlgorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-512']

/* ---------------- 共同的字节工具 ---------------- */

const textEncoder = new TextEncoder()

const HEX = '0123456789abcdef'

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += HEX[byte >> 4] + HEX[byte & 15]
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // 分块拼接，避免超长输入把 apply 的参数栈撑爆
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function bytesToOutput(bytes: Uint8Array, encoding: OutputEncoding): string {
  return encoding === 'base64' ? bytesToBase64(bytes) : bytesToHex(bytes)
}

/* ---------------- MD5（Web Crypto 不含，自行实现） ---------------- */

/**
 * MD5 用的每轮左移位数与常量表。
 *
 * 常量是 floor(2^32 × abs(sin(i + 1))) 的整数部分，照着标准写死即可 ——
 * 运行时算正弦会引入浮点误差，取整后未必落在正确值上。
 */
const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const MD5_CONSTANTS = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

/**
 * 标准 MD5。
 *
 * 全程按 32 位无符号走：每步结果都过一遍 `>>> 0`，否则 JS 的位运算会
 * 溢出成负数，后续加法带进符号位就全错了。
 */
export function md5(input: Uint8Array | string): Uint8Array {
  const message = typeof input === 'string' ? textEncoder.encode(input) : input
  const byteLength = message.length

  // 补位：先补 0x80，再补 0 到 (56 mod 64)，最后 8 字节小端写原始比特长度
  const paddedLength = (((byteLength + 8) >> 6) + 1) << 6
  const buffer = new Uint8Array(paddedLength)
  buffer.set(message)
  buffer[byteLength] = 0x80

  const bitLength = byteLength * 8
  const view = new DataView(buffer.buffer)
  // 高 32 位放偏移 56，低 32 位放 60 —— 都是小端
  view.setUint32(paddedLength - 8, bitLength >>> 0, true)
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(16)
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, true)

    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }

      const temp = d
      d = c
      c = b
      b = (b + rotl((a + f + MD5_CONSTANTS[i] + words[g]) >>> 0, MD5_SHIFTS[i])) >>> 0
      a = temp
    }

    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  const digest = new Uint8Array(16)
  const out = new DataView(digest.buffer)
  out.setUint32(0, a0, true)
  out.setUint32(4, b0, true)
  out.setUint32(8, c0, true)
  out.setUint32(12, d0, true)
  return digest
}

/* ---------------- Web Crypto 摘要与 HMAC ---------------- */

/**
 * TS 5.7 起 Uint8Array 带上 ArrayBufferLike 泛型，而 Web Crypto 只收
 * ArrayBuffer 支撑的视图。统一在这里过一道断言。
 */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>
}

async function subtleDigest(algorithm: DigestAlgorithm, bytes: Uint8Array): Promise<Uint8Array> {
  const result = await crypto.subtle.digest(algorithm, toBufferSource(bytes))
  return new Uint8Array(result)
}

/** 计算摘要，输出 hex / base64 */
export async function digest(
  algorithm: DigestAlgorithm,
  message: string,
  encoding: OutputEncoding = 'hex',
): Promise<string> {
  return digestBytes(algorithm, textEncoder.encode(message), encoding)
}

/**
 * 摘要的字节版。
 *
 * 文件签名必须走这条：文本路径会把输入按 UTF-8 编解码，而二进制文件
 * （APK、图片、压缩包）里存在非法的 UTF-8 字节序列，解码时会被替换成
 * U+FFFD，签出来的是另一份数据 —— 看着有结果，实际全错。
 */
export async function digestBytes(
  algorithm: DigestAlgorithm,
  bytes: Uint8Array,
  encoding: OutputEncoding = 'hex',
): Promise<string> {
  const hash = algorithm === 'MD5' ? md5(bytes) : await subtleDigest(algorithm, bytes)
  return bytesToOutput(hash, encoding)
}

/**
 * 计算 HMAC。
 *
 * MD5 这条分支不能用 Web Crypto —— 它只认 SHA 系列做 HMAC 的哈希，
 * 传 'MD5' 会直接抛 NotSupportedError。所以按 RFC 2104 自己拼：
 *   HMAC(K, m) = H((K' ⊕ opad) ‖ H((K' ⊕ ipad) ‖ m))
 * K' 是密钥补齐/截断到分组长度的结果（MD5 分组 64 字节）。
 */
export async function hmac(
  algorithm: HmacAlgorithm,
  key: string,
  message: string,
  encoding: OutputEncoding = 'hex',
): Promise<string> {
  return hmacBytes(algorithm, textEncoder.encode(key), textEncoder.encode(message), encoding)
}

/**
 * HMAC 的字节版，文件签名用。
 *
 * 注意 Web Crypto 的 sign **不支持流式** —— 整个文件要一次性读进内存。
 * 几十 MB 没问题，上到 GB 级别会有明显的内存峰值；真要流式得自己实现
 * 对应哈希的压缩函数，那是另一件事，这里不做。
 */
export async function hmacBytes(
  algorithm: HmacAlgorithm,
  keyBytes: Uint8Array,
  messageBytes: Uint8Array,
  encoding: OutputEncoding = 'hex',
): Promise<string> {
  if (algorithm === 'MD5') {
    return bytesToOutput(hmacMd5(keyBytes, messageBytes), encoding)
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(keyBytes),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, toBufferSource(messageBytes))
  return bytesToOutput(new Uint8Array(signature), encoding)
}

/** RFC 2104 里的 ipad / opad：0x36 与 0x5c 重复 64 次 */
const MD5_BLOCK_SIZE = 64

function hmacMd5(key: Uint8Array, message: Uint8Array): Uint8Array {
  // 密钥长于分组就先摘要；短于分组就右侧补零
  let normalizedKey = key
  if (normalizedKey.length > MD5_BLOCK_SIZE) normalizedKey = md5(normalizedKey)
  const padded = new Uint8Array(MD5_BLOCK_SIZE)
  padded.set(normalizedKey)

  const inner = new Uint8Array(MD5_BLOCK_SIZE + message.length)
  const outer = new Uint8Array(MD5_BLOCK_SIZE + 16)
  for (let i = 0; i < MD5_BLOCK_SIZE; i++) {
    inner[i] = padded[i] ^ 0x36
    outer[i] = padded[i] ^ 0x5c
  }
  inner.set(message, MD5_BLOCK_SIZE)
  outer.set(md5(inner), MD5_BLOCK_SIZE)
  return md5(outer)
}

/* ---------------- 签名比对 ---------------- */

/**
 * 归一化：去空白 + 转小写。
 *
 * 签名从聊天窗口、日志、文档里复制过来时常带首尾空格或中间换行，
 * hex 的大小写也常不一致 —— 这些都不该判为「签名不匹配」，
 * 否则用户会去查算法，而问题其实出在复制粘贴上。
 */
export function normalizeSignature(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

/**
 * 常量时间比对。
 *
 * 先各自摘要成等长指纹再逐字节异或 —— 直接把两个长度可能不等的字符串
 * 逐位比较会提前 return，比较耗时随「前多少位相同」变化，攻击者能靠
 * 计时逐位试出正确签名。这里固定走完 32 字节，长度差异也熵进结果里。
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const left = textEncoder.encode(normalizeSignature(a))
  const right = textEncoder.encode(normalizeSignature(b))
  const [leftPrint, rightPrint] = await Promise.all([
    subtleDigest('SHA-256', left),
    subtleDigest('SHA-256', right),
  ])

  let diff = 0
  for (let i = 0; i < leftPrint.length; i++) diff |= leftPrint[i] ^ rightPrint[i]
  return diff === 0
}

/**
 * 找出两串签名第一个与最后一个不一致的位置。
 *
 * 不做最长公共子序列 —— 签名是一串等长的十六进制/base64，逐位对齐即可，
 * 真正的用途是让用户一眼看到「差在第 7 位」而不是只被告知「不匹配」。
 * 长度不同时以较长的一侧为准。
 */
/** 人类可读的体积，用于文件卡片上的角标 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`
}

export function diffPositions(a: string, b: string): { first: number; last: number } | null {
  const left = normalizeSignature(a)
  const right = normalizeSignature(b)
  const maxLength = Math.max(left.length, right.length)

  let first = -1
  let last = -1
  for (let i = 0; i < maxLength; i++) {
    if (left[i] !== right[i]) {
      if (first === -1) first = i
      last = i
    }
  }
  return first === -1 ? null : { first, last }
}
