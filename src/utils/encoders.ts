/*
 * 编解码工具的全部转换实现。
 *
 * 分两类：
 *  - 同步的对称编解码（Base64 / Hex / 摩斯码…），encode/decode 一一对应
 *  - 需要 Web Crypto 的 AES，Promise 异步，单独放 aesTypes
 *
 * 加新编码只需在对应表里补一项，UI 会自动出现（见 EncodeTool 的 Segmented）。
 * 需要密钥/参数的，把参数字段写进 type，UI 统一从 params 里取。
 */

/* ---------------- 字节数组小工具 ---------------- */

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: false })

/**
 * TS 5.7 起 Uint8Array 带上 ArrayBufferLike 泛型，而 Web Crypto 只收
 * ArrayBuffer 支撑的视图（不收 SharedArrayBuffer）。统一在这里过一道，
 * 省得每个 crypto 调用点都要断言。
 */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>
}

function bytesToText(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}

function textToBytes(text: string): Uint8Array {
  return textEncoder.encode(text)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // 分块拼接，避免超长文本把 apply 的参数栈撑爆
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.trim())
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const HEX = '0123456789abcdef'

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += HEX[byte >> 4] + HEX[byte & 15]
  return out
}

function hexToBytes(hex: string): Uint8Array {
  // 容忍空格、冒号、0x 前缀这些常见分隔写法
  const clean = hex.replace(/0x/gi, '').replace(/[\s:,]/g, '')
  if (clean.length % 2 !== 0) throw new Error('十六进制长度必须是偶数')
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('含非十六进制字符')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return bytes
}

/* ---------------- Base32 ---------------- */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  // 不足 5 位的补零凑一个字符，再按 8 的倍数补齐「=」
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  while (out.length % 8 !== 0) out += '='
  return out
}

function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = B32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error(`非法 Base32 字符：${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/* ---------------- 摩斯电码 ---------------- */

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
}

const MORSE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE).map(([char, code]) => [code, char]),
)

/* ---------------- 凯撒 / ROT ---------------- */

/** 只挪字母，保留大小写；不属于 A-Z/a-z 的字符原样留下 */
function caesarShift(text: string, shift: number): string {
  const step = ((shift % 26) + 26) % 26
  return text.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97
    return String.fromCharCode(((char.charCodeAt(0) - base + step) % 26) + base)
  })
}

/** ROT5 只挪数字，跟 ROT13 组合就是 ROT18 */
function rot5(text: string): string {
  return text.replace(/[0-9]/g, (char) => String.fromCharCode(((char.charCodeAt(0) - 48 + 5) % 10) + 48))
}

const ATBASH = 'ZYXWVUTSRQPONMLKJIHGFEDCBA'

export interface EncoderType {
  id: string
  name: string
  /** 分组名，UI 上分段显示 */
  group: string
  encode: (input: string) => string
  decode: (input: string) => string
  hint?: string
  /**
   * 编码不可完全还原（摩斯码丢大小写与非字母、camelCase 转换丢分隔符）。
   * 解码按钮仍然可用，但标记出来，免得用户以为原文能原样回来。
   */
  lossy?: boolean
}

/**
 * 对称编解码表。encode / decode 必须互逆，否则 UI 上两个按钮会打架。
 * 顺序即 UI 顺序，同 group 的排在一起。
 */
export const encoderTypes: EncoderType[] = [
  {
    id: 'base64',
    name: 'Base64',
    group: '常用',
    encode: (s) => bytesToBase64(textToBytes(s)),
    decode: (s) => bytesToText(base64ToBytes(s)),
    hint: '标准 Base64，UTF-8 安全',
  },
  {
    id: 'base64url',
    name: 'Base64URL',
    group: '常用',
    encode: (s) => bytesToBase64(textToBytes(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    decode: (s) => bytesToText(base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/'))),
    hint: '把 +/ 换成 -_ 并去掉结尾的 =，可直接放进 URL 和 JWT',
  },
  {
    id: 'url',
    name: 'URL',
    group: '常用',
    encode: encodeURIComponent,
    decode: decodeURIComponent,
    hint: '标准 URL 编码，保留 :/?#[]@ 等结构字符',
  },
  {
    id: 'url-all',
    name: 'URL 全编码',
    group: '常用',
    encode: (s) => textToBytes(s).reduce((acc, b) => acc + '%' + bytesToHex(new Uint8Array([b])).toUpperCase(), ''),
    decode: (s) => bytesToText(hexToBytes(s.replace(/%/g, ''))),
    hint: '所有字符都转 %XX，连字母数字也不留',
  },
  {
    id: 'unicode',
    name: 'Unicode',
    group: '常用',
    encode: (s) =>
      s.split('').map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
    decode: (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
    hint: '转成 \\uXXXX 转义',
  },
  {
    id: 'unicode-cp',
    name: '码位 U+',
    group: '常用',
    // 空格分隔多个码位，解码时连分隔符一起吃掉，否则会残留空格
    encode: (s) =>
      Array.from(s)
        .map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
        .join(' '),
    decode: (s) =>
      s
        .replace(/U\+([0-9a-fA-F]{4,6})\s*/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .trimEnd(),
    hint: 'Unicode 码位写法，能正确处理 emoji 这类代理对',
  },
  {
    id: 'html',
    name: 'HTML 实体',
    group: '常用',
    encode: (s) =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)),
    decode: (s) =>
      s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }[e] as string)),
    hint: '转义 & < > " 和单引号',
  },
  {
    id: 'html-all',
    name: 'HTML 全实体',
    group: '常用',
    encode: (s) => Array.from(s).map((c) => `&#${c.codePointAt(0)};`).join(''),
    decode: (s) => s.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10))),
    hint: '每个字符都转成 &#数字; 十进制实体',
  },
  {
    id: 'hex',
    name: 'Hex',
    group: '进制与数值',
    encode: (s) => bytesToHex(textToBytes(s)),
    decode: (s) => bytesToText(hexToBytes(s)),
    hint: '十六进制，容忍空格和 0x 前缀',
  },
  {
    id: 'base32',
    name: 'Base32',
    group: '进制与数值',
    encode: (s) => base32Encode(textToBytes(s)),
    decode: (s) => bytesToText(base32Decode(s)),
    hint: 'RFC 4648，大写字母配 2-7',
  },
  {
    id: 'binary',
    name: '二进制',
    group: '进制与数值',
    encode: (s) => textToBytes(s).reduce((acc, b) => acc + b.toString(2).padStart(8, '0') + ' ', '').trim(),
    decode: (s) => {
      const clean = s.replace(/[^01]/g, '')
      if (clean.length % 8 !== 0) throw new Error('二进制位数不是 8 的倍数')
      const bytes = new Uint8Array(clean.length / 8)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 8, 8), 2)
      return bytesToText(bytes)
    },
    hint: '每字节 8 位，空格分隔',
  },
  {
    id: 'decimal',
    name: '十进制',
    group: '进制与数值',
    encode: (s) => textToBytes(s).reduce((acc, b) => acc + b + ' ', '').trim(),
    decode: (s) => {
      const parts = s.trim().split(/[\s,]+/).filter(Boolean)
      const bytes = new Uint8Array(parts.length)
      parts.forEach((part, i) => {
        const n = Number(part)
        if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`不是合法字节：${part}`)
        bytes[i] = n
      })
      return bytesToText(bytes)
    },
    hint: '每字节的 ASCII 码，空格分隔',
  },
  {
    id: 'octal',
    name: '八进制',
    group: '进制与数值',
    encode: (s) => textToBytes(s).reduce((acc, b) => acc + b.toString(8).padStart(3, '0') + ' ', '').trim(),
    decode: (s) => {
      const parts = s.trim().split(/[\s,]+/).filter(Boolean)
      const bytes = new Uint8Array(parts.length)
      parts.forEach((part, i) => {
        const n = parseInt(part, 8)
        if (Number.isNaN(n) || n < 0 || n > 255) throw new Error(`不是合法八进制字节：${part}`)
        bytes[i] = n
      })
      return bytesToText(bytes)
    },
    hint: '每字节 3 位八进制',
  },
  {
    id: 'reverse',
    name: '反转字符串',
    group: '文本处理',
    // 用 Array.from 按码点切，免得把 emoji 的代理对劈成两半
    encode: (s) => Array.from(s).reverse().join(''),
    decode: (s) => Array.from(s).reverse().join(''),
    hint: '自逆：编解码做的是同一件事',
  },
  {
    id: 'case',
    name: '大小写互换',
    group: '文本处理',
    encode: (s) => s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())),
    decode: (s) => s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())),
    hint: '自逆：大写变小写，小写变大写',
  },
  {
    id: 'snake',
    name: '驼峰 ↔ 下划线',
    group: '文本处理',
    encode: (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase(),
    decode: (s) => s.toLowerCase().replace(/[_\s-]+(.)/g, (_, c: string) => c.toUpperCase()),
    hint: '编码转 snake_case，解码转 camelCase；分隔符信息会丢失，不能原样还原',
    lossy: true,
  },
  {
    id: 'morse',
    name: '摩斯电码',
    group: '趣味/古典密码',
    encode: (s) =>
      Array.from(s.toUpperCase())
        .map((c) => (c === ' ' || c === '\n' ? '/' : MORSE[c] || ''))
        .filter(Boolean)
        .join(' '),
    decode: (s) =>
      s
        .trim()
        .split(/\s+/)
        .map((token) => (token === '/' ? ' ' : MORSE_REVERSE[token] ?? ''))
        .join(''),
    hint: '字母用空格分隔，单词用 / 分隔；只知道大写字母，中文等非字母字符会被丢弃',
    lossy: true,
  },
  {
    id: 'rot13',
    name: 'ROT13',
    group: '趣味/古典密码',
    encode: (s) => caesarShift(s, 13),
    decode: (s) => caesarShift(s, 13),
    hint: '自逆：挪 13 位，再来一次就还原',
  },
  {
    id: 'rot18',
    name: 'ROT18',
    group: '趣味/古典密码',
    encode: (s) => rot5(caesarShift(s, 13)),
    decode: (s) => caesarShift(rot5(s), 13),
    hint: 'ROT13 管字母 + ROT5 管数字',
  },
  {
    id: 'caesar',
    name: '凯撒密码',
    group: '趣味/古典密码',
    // 用 ROT13 做位移基准，好让解码是纯函数逆运算
    encode: (s) => caesarShift(s, 13 + 3),
    decode: (s) => caesarShift(s, -(13 + 3)),
    hint: '字母挪 3 位（在 ROT13 基础上再挪 3）',
  },
  {
    id: 'atbash',
    name: 'Atbash',
    group: '趣味/古典密码',
    encode: (s) =>
      s.replace(/[a-z]/gi, (c) => {
        const upper = c === c.toUpperCase()
        const idx = c.toUpperCase().charCodeAt(0) - 65
        const mapped = ATBASH[idx]
        return upper ? mapped : mapped.toLowerCase()
      }),
    decode: (s) =>
      s.replace(/[a-z]/gi, (c) => {
        const upper = c === c.toUpperCase()
        const idx = ATBASH.indexOf(c.toUpperCase())
        const mapped = String.fromCharCode(65 + idx)
        return upper ? mapped : mapped.toLowerCase()
      }),
    hint: '自逆：A↔Z、B↔Y 首尾对折',
  },
]

/* ---------------- AES（Web Crypto，异步） ---------------- */

export type AesMode = 'CBC' | 'GCM' | 'CTR'
export type AesKeySize = 128 | 192 | 256
/** 密钥从哪来：直接给十六进制，或从口令派生（PBKDF2） */
export type AesKeySource = 'hex' | 'passphrase'

export interface AesParams {
  mode: AesMode
  keySize: AesKeySize
  keySource: AesKeySource
  key: string
  /** 仅 passphrase 模式用得到 */
  iterations: number
}

export const AES_MODES: AesMode[] = ['GCM', 'CBC', 'CTR']
export const AES_KEY_SIZES: AesKeySize[] = [128, 192, 256]

const PBKDF2_SALT = textToBytes('devnotes-encode-tool')

async function resolveAesKey(params: AesParams): Promise<CryptoKey> {
  const { keySource, key, keySize, iterations } = params
  const algorithm = { name: 'AES-' + params.mode, length: keySize }

  if (keySource === 'hex') {
    const bytes = hexToBytes(key)
    const expected = keySize / 8
    if (bytes.length !== expected) {
      throw new Error(`${keySize} 位密钥需要 ${expected} 字节，即 ${expected * 2} 个十六进制字符，当前是 ${bytes.length} 字节`)
    }
    return crypto.subtle.importKey('raw', toBufferSource(bytes), algorithm, false, ['encrypt', 'decrypt'])
  }

  if (!key.trim()) throw new Error('口令不能为空')
  const material = await crypto.subtle.importKey('raw', toBufferSource(textToBytes(key)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toBufferSource(PBKDF2_SALT), iterations, hash: 'SHA-256' },
    material,
    algorithm,
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 把字节拼成 "iv的hex:密文的hex"，自描述，解码时不用额外问用户要 IV */
function packIvAndData(iv: Uint8Array, data: Uint8Array): string {
  return `${bytesToHex(iv)}:${bytesToHex(data)}`
}

function unpackIvAndData(input: string): { iv: Uint8Array; data: Uint8Array } {
  const separator = input.indexOf(':')
  if (separator === -1) throw new Error('密文格式应为「IV:密文」，两段都是十六进制')
  const ivPart = input.slice(0, separator).trim()
  // 密文段允许为空：加密空明文时它就是空的，不能当成格式错误
  const dataPart = input.slice(separator + 1).trim()
  if (!ivPart) throw new Error('密文里缺少 IV')
  return { iv: hexToBytes(ivPart), data: hexToBytes(dataPart) }
}

/**
 * 拼出 Web Crypto 要的算法参数。
 *
 * GCM 的 IV 是 12 字节，CBC / CTR 是 16 字节 —— 长度对不上会直接报
 * 「iv length」错误。CTR 还额外要求一个 counter，这里直接用同一份 IV：
 * 反正是每次随机生成的，一个块值即可。
 */
function buildAesAlgorithm(mode: AesMode, iv: Uint8Array): AesCbcParams | AesGcmParams | AesCtrParams {
  if (mode === 'GCM') return { name: 'AES-GCM', iv: toBufferSource(iv) }
  if (mode === 'CTR') return { name: 'AES-CTR', counter: toBufferSource(iv), length: 64 }
  return { name: 'AES-CBC', iv: toBufferSource(iv) }
}

export async function aesEncrypt(input: string, params: AesParams): Promise<string> {
  const key = await resolveAesKey(params)
  const iv = crypto.getRandomValues(new Uint8Array(params.mode === 'GCM' ? 12 : 16))
  const encrypted = await crypto.subtle.encrypt(
    buildAesAlgorithm(params.mode, iv),
    key,
    toBufferSource(textToBytes(input)),
  )
  return packIvAndData(iv, new Uint8Array(encrypted))
}

export async function aesDecrypt(input: string, params: AesParams): Promise<string> {
  const key = await resolveAesKey(params)
  const { iv, data } = unpackIvAndData(input)
  try {
    const decrypted = await crypto.subtle.decrypt(
      buildAesAlgorithm(params.mode, iv),
      key,
      toBufferSource(data),
    )
    return bytesToText(new Uint8Array(decrypted))
  } catch {
    // GCM 的认证标签对不上、或密钥/模式选错，Web Crypto 一律抛同一个错
    throw new Error('解密失败：密钥、模式不对，或密文被改动过')
  }
}
