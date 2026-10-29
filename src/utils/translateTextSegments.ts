import type { TranslationAPI } from './jsonI18nTranslate'

/**
 * GTX 与 MyMemory 用 GET query 传正文，需要按 UTF-8 字节数限制每块大小。
 * MyMemory 的官方上限是 500 字节，留少量余量以免中文长文整段失败。
 */
export const CHUNK_BYTE_LIMIT: Record<TranslationAPI, number> = {
  gtx: 3600,
  mymemory: 480,
  openai: 3600,
  libretranslate: 3600,
}

/** for...of 保留完整代理对；孤立代理项按 TextEncoder 的替换字符计为三字节。 */
function codePointByteLength(char: string): number {
  const codePoint = char.codePointAt(0)!
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

function byteLength(text: string): number {
  let bytes = 0
  for (const char of text) bytes += codePointByteLength(char)
  return bytes
}

/** 没有句末标点时按码点硬切，累计字节数，避免反复编码越来越长的前缀。 */
function hardSplit(text: string, byteLimit: number): string[] {
  const pieces: string[] = []
  let current = ''
  let currentBytes = 0
  for (const char of text) {
    const charBytes = codePointByteLength(char)
    if (currentBytes + charBytes > byteLimit) {
      pieces.push(current)
      current = char
      currentBytes = charBytes
    } else {
      current += char
      currentBytes += charBytes
    }
  }
  if (current) pieces.push(current)
  return pieces
}

/** 零宽切点保留原文；优先按句末标点 / 换行切句，再贪心合并到字节上限。 */
function splitLongText(paragraph: string, byteLimit: number): string[] {
  if (byteLength(paragraph) <= byteLimit) return [paragraph]

  const sentences = paragraph.split(/(?<=[。！？!?；;])(?=[^\n])|(?<=\n)/)
  const pieces: string[] = []
  let buffer = ''
  let bufferBytes = 0

  const flush = () => {
    if (buffer) {
      pieces.push(buffer)
      buffer = ''
      bufferBytes = 0
    }
  }

  for (const sentence of sentences) {
    const sentenceBytes = byteLength(sentence)
    if (sentenceBytes > byteLimit) {
      flush()
      // 长文可能拆出很多块，逐块追加避免展开参数触及引擎的参数数量上限。
      for (const piece of hardSplit(sentence, byteLimit)) pieces.push(piece)
      continue
    }
    if (bufferBytes + sentenceBytes > byteLimit) flush()
    buffer += sentence
    bufferBytes += sentenceBytes
  }
  flush()
  return pieces
}

/** 待翻译的正文，或必须原样保留的空白分隔符。 */
interface Segment {
  text: string
  translate: boolean
}

export function toSegments(text: string, byteLimit: number): Segment[] {
  // 捕获式切分保留空行，避免译文凭空多出或少掉段落分隔符。
  const raw = text.split(/(\n[ \t]*\n+)/)
  const segments: Segment[] = []

  raw.forEach((part, index) => {
    if (!part) return
    if (index % 2 === 1 || !part.trim()) {
      segments.push({ text: part, translate: false })
      return
    }
    for (const piece of splitLongText(part, byteLimit)) {
      segments.push({ text: piece, translate: !!piece.trim() })
    }
  })

  return segments
}

/** PDF 复制文本常带行尾硬断行；保留空行，只合并原规则匹配到的单个换行。 */
export function unwrapHardBreaks(text: string): string {
  return text.replace(/([^\n])\n([^\n])/g, '$1 $2')
}
