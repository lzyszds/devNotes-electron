import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import {
  CHUNK_BYTE_LIMIT,
  toSegments,
  unwrapHardBreaks,
} from '../src/utils/translateTextSegments.ts'

const encoder = new TextEncoder()
const bytes = (text) => encoder.encode(text).length

// 保留旧实现作为行为基准，避免优化时悄悄改变标点、空白或极小上限的切分规则。
function legacySegments(text, byteLimit) {
  function hardSplit(text) {
    const pieces = []
    let current = ''
    for (const char of text) {
      if (bytes(current + char) > byteLimit) {
        pieces.push(current)
        current = char
      } else {
        current += char
      }
    }
    if (current) pieces.push(current)
    return pieces
  }

  function splitLongText(paragraph) {
    if (bytes(paragraph) <= byteLimit) return [paragraph]
    const sentences = paragraph.split(/(?<=[。！？!?；;])(?=[^\n])|(?<=\n)/)
    const pieces = []
    let buffer = ''
    const flush = () => {
      if (buffer) {
        pieces.push(buffer)
        buffer = ''
      }
    }
    for (const sentence of sentences) {
      if (bytes(sentence) > byteLimit) {
        flush()
        pieces.push(...hardSplit(sentence))
        continue
      }
      if (bytes(buffer) + bytes(sentence) > byteLimit) {
        flush()
        buffer = sentence
      } else {
        buffer += sentence
      }
    }
    flush()
    return pieces
  }

  return text.split(/(\n[ \t]*\n+)/).flatMap((part, index) => {
    if (!part) return []
    if (index % 2 === 1 || !part.trim()) return [{ text: part, translate: false }]
    return splitLongText(part).map((piece) => ({ text: piece, translate: !!piece.trim() }))
  })
}

function check(text, byteLimit) {
  const segments = toSegments(text, byteLimit)
  assert.deepEqual(segments, legacySegments(text, byteLimit))
  assert.equal(segments.map(({ text }) => text).join(''), text)
  for (const segment of segments) {
    assert.equal(segment.translate, !!segment.text.trim())
    // 纯空白保留原样；上限小于单个码点时沿用旧实现，不劈开代理对。
    if (segment.translate && byteLimit >= 4) assert.ok(bytes(segment.text) <= byteLimit)
  }
  return segments
}

test('各引擎的字节上限保持不变', () => {
  assert.deepEqual(CHUNK_BYTE_LIMIT, {
    gtx: 3600,
    mymemory: 480,
    openai: 3600,
    libretranslate: 3600,
  })
})

test('中英文按句末标点、换行贪心合并，英文句号不新增切点', () => {
  assert.deepEqual(check('甲。乙！丙？', 12), [
    { text: '甲。乙！', translate: true },
    { text: '丙？', translate: true },
  ])
  assert.deepEqual(check('ab.cd!ef', 4), [
    { text: 'ab.c', translate: true },
    { text: 'd!', translate: true },
    { text: 'ef', translate: true },
  ])
  for (const limit of [4, 8, 16, 24, 480]) {
    check('你好，世界！Hello world;再见。\nNext line?最后一句；结束', limit)
  }
})

test('空文本、纯空白、空行分隔符原样保留且不送翻译', () => {
  assert.deepEqual(check('', 4), [])
  for (const text of [' \t\r\n ', '\n\n\n', '\u00a0\u3000', ' '.repeat(5000)]) {
    assert.deepEqual(check(text, 4), [{ text, translate: false }])
  }
  assert.deepEqual(check('甲\n \t\n\n乙\n\n尾', 480), [
    { text: '甲', translate: true },
    { text: '\n \t\n\n', translate: false },
    { text: '乙', translate: true },
    { text: '\n\n', translate: false },
    { text: '尾', translate: true },
  ])
  check('\n\n开头\n\t\n中间\r\n\r\n末尾\n\n', 8)
})

test('UTF-8 精确边界：ASCII、双字节、中文、emoji 和混合文本', () => {
  for (const char of ['a', 'é', '中', '😀', '\ud800', '\udc00']) {
    const width = bytes(char)
    for (const count of [1, 2, 7]) {
      const exact = char.repeat(count)
      assert.deepEqual(check(exact, width * count), [{ text: exact, translate: true }])
      assert.deepEqual(check(exact + char, width * count), [
        { text: exact, translate: true },
        { text: char, translate: true },
      ])
    }
  }
  assert.deepEqual(check('aé中😀x', 10), [
    { text: 'aé中😀', translate: true },
    { text: 'x', translate: true },
  ])
  for (const limit of [479, 480, 481, 3599, 3600, 3601]) {
    check('a中😀é'.repeat(700), limit)
  }
})

test('emoji 代理对不劈开，孤立代理项与 TextEncoder 的三字节替换规则一致', () => {
  assert.deepEqual(check('😀😀😀', 5).map(({ text }) => text), ['😀', '😀', '😀'])
  for (const text of [
    '\ud800a\udc00',
    '\ud800\ud800\udc00\udc00',
    '👨‍👩‍👧‍👦👍🏽🇨🇳e\u0301',
    '\udfff;\ud800!😀\n\udbff中\udc00',
  ]) {
    for (const limit of [1, 2, 3, 4, 5, 7, 12]) check(text, limit)
  }
  // 每个 UTF-16 码元后插入 ASCII 分隔，孤立代理项不会意外组成合法代理对。
  const allCodeUnits = Array.from({ length: 65536 }, (_, index) => String.fromCharCode(index) + '|').join('')
  check(allCodeUnits, 480)
})

test('无标点长文与大量短句均可重组原文', () => {
  for (const text of [
    'a'.repeat(50000),
    '中'.repeat(20000),
    'aé中😀'.repeat(5000),
    '甲！a;😀？\n'.repeat(3000),
  ]) {
    check(text, 480)
    check(text, 3600)
  }
})

test('确定性混合输入与旧算法逐段一致，拼回原文不丢字符', () => {
  const alphabet = ['a', 'é', '中', '😀', '\ud800', '\udc00', ' ', '\t', '\r', '\n', '。', '!', ';', '.', '？']
  let seed = 20261029
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  for (let sample = 0; sample < 150; sample++) {
    let text = ''
    for (let index = 0; index < 160; index++) text += alphabet[next() % alphabet.length]
    for (const limit of [1, 3, 4, 13, 64, 480]) check(text, limit)
  }
})

test('合并硬换行保持现有正则语义，包括相邻匹配不重叠', () => {
  for (const [input, expected] of [
    ['', ''],
    ['你好\n世界', '你好 世界'],
    ['a\nb\nc\nd', 'a b\nc d'],
    ['a\n\nb', 'a\n\nb'],
    ['\na\n', '\na\n'],
    ['a\n \nb', 'a  \nb'],
    ['a\r\nb', 'a\r b'],
  ]) {
    assert.equal(unwrapHardBreaks(input), expected)
  }
})

// 手动比较耗时：TRANSLATE_SEGMENTS_BENCH=1 node --test scripts/translate-text-segments.test.mjs
// 不断言毫秒数或倍率，避免机器负载、JIT 和 Node 版本造成脆弱的 CI 测试。
test('手动 benchmark：无标点长文 / 大量短句', { skip: !process.env.TRANSLATE_SEGMENTS_BENCH }, () => {
  const results = []
  for (const [scenario, unit] of [['无标点', 'a中😀é'], ['短句', '甲！a;😀？\n']]) {
    for (const repeats of [4000, 8000, 16000]) {
      const text = unit.repeat(repeats)
      for (const [implementation, split] of [['原实现', legacySegments], ['新实现', toSegments]]) {
        split(text, 3600)
        const samples = []
        let chunks = 0
        for (let run = 0; run < 3; run++) {
          const start = performance.now()
          chunks = split(text, 3600).length
          samples.push(performance.now() - start)
        }
        samples.sort((a, b) => a - b)
        results.push({ scenario, implementation, bytes: bytes(text), chunks, medianMs: samples[1].toFixed(2) })
      }
    }
  }
  console.table(results)
})
