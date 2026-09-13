/**
 * 自定义在线翻译接口（OpenAI 兼容 / LibreTranslate）的单元测试。
 *
 * 只覆盖纯函数与「不发网络请求」的控制流分支：适配器的 URL 构造、响应解析、
 * 输出清洗，以及配置合并/校验。跑法：npm run test:unit
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  buildChatCompletionsUrl,
  buildLibreTranslateUrl,
  toLibreLangCode,
  llmLangName,
  cleanLLMOutput,
  extractErrorMessage,
  parseOpenAIResponse,
  parseLibreTranslateResponse,
} = await import('../../src/utils/translateProviders.ts')

const {
  DEFAULT_TRANSLATE_CONFIG,
  mergeTranslateConfig,
  isProviderConfigured,
  describeProvider,
} = await import('../../src/utils/translateConfig.ts')

const { LANG_CODE_MAP, translateTextBatch } = await import(
  '../../src/utils/jsonI18nTranslate.ts'
)

// ================= URL 构造 =================

test('buildChatCompletionsUrl 拼接 /chat/completions', () => {
  assert.equal(
    buildChatCompletionsUrl('https://api.openai.com/v1'),
    'https://api.openai.com/v1/chat/completions'
  )
})

test('buildChatCompletionsUrl 容忍尾部斜杠与空白', () => {
  assert.equal(
    buildChatCompletionsUrl('  https://api.deepseek.com/v1///  '),
    'https://api.deepseek.com/v1/chat/completions'
  )
})

test('buildChatCompletionsUrl 用户已填完整路径时不重复追加', () => {
  assert.equal(
    buildChatCompletionsUrl('https://gw.example.com/v1/chat/completions'),
    'https://gw.example.com/v1/chat/completions'
  )
})

test('buildChatCompletionsUrl 空地址返回空串', () => {
  assert.equal(buildChatCompletionsUrl('   '), '')
})

test('buildLibreTranslateUrl 拼接 /translate', () => {
  assert.equal(
    buildLibreTranslateUrl('http://127.0.0.1:5000'),
    'http://127.0.0.1:5000/translate'
  )
  assert.equal(
    buildLibreTranslateUrl('http://127.0.0.1:5000/'),
    'http://127.0.0.1:5000/translate'
  )
  assert.equal(
    buildLibreTranslateUrl('https://libretranslate.com/translate'),
    'https://libretranslate.com/translate'
  )
})

// ================= 语言码 =================

test('toLibreLangCode 使用 ISO 639-1 码', () => {
  assert.equal(toLibreLangCode('zh'), 'zh')
  assert.equal(toLibreLangCode('zh-TW'), 'zt')
  assert.equal(toLibreLangCode('en'), 'en')
  assert.equal(toLibreLangCode('xx-YY'), 'xx-YY')
})

test('LibreTranslate 语言码不沿用 GTX 的 zh-CN 映射', () => {
  assert.equal(LANG_CODE_MAP['zh'], 'zh-CN')
  assert.notEqual(toLibreLangCode('zh'), LANG_CODE_MAP['zh'])
})

test('llmLangName 使用英文语言名', () => {
  assert.equal(llmLangName('zh'), 'Simplified Chinese')
  assert.equal(llmLangName('zh-TW'), 'Traditional Chinese')
  assert.equal(llmLangName('unknown'), 'unknown')
})

// ================= LLM 输出清洗 =================

test('cleanLLMOutput 纯文本原样返回', () => {
  assert.equal(cleanLLMOutput('你好，世界'), '你好，世界')
})

test('cleanLLMOutput 剥掉整体包裹的引号', () => {
  assert.equal(cleanLLMOutput('"你好"'), '你好')
  assert.equal(cleanLLMOutput('“你好”'), '你好')
  assert.equal(cleanLLMOutput('「你好」'), '你好')
})

test('cleanLLMOutput 剥掉代码围栏', () => {
  assert.equal(cleanLLMOutput('```json\n你好\n```'), '你好')
  assert.equal(cleanLLMOutput('```\n你好\n```'), '你好')
})

test('cleanLLMOutput 剥掉「译文：」前缀', () => {
  assert.equal(cleanLLMOutput('译文：你好'), '你好')
  assert.equal(cleanLLMOutput('Translation: Hello'), 'Hello')
})

test('cleanLLMOutput 不破坏正文内部引号与句尾标点', () => {
  assert.equal(cleanLLMOutput('他说"你好"'), '他说"你好"')
  assert.equal(cleanLLMOutput('Hello, world!'), 'Hello, world!')
})

// ================= 错误信息 =================

test('extractErrorMessage 解析 OpenAI 与 LibreTranslate 的错误体', () => {
  assert.equal(
    extractErrorMessage(401, '{"error":{"message":"Incorrect API key provided"}}'),
    'HTTP 401：Incorrect API key provided'
  )
  assert.equal(
    extractErrorMessage(400, '{"error":"target is not supported"}'),
    'HTTP 400：target is not supported'
  )
})

test('extractErrorMessage 处理空响应与非 JSON 响应', () => {
  assert.equal(extractErrorMessage(500, ''), 'HTTP 500')
  assert.equal(
    extractErrorMessage(502, '<html>Bad Gateway</html>'),
    'HTTP 502：<html>Bad Gateway</html>'
  )
  assert.equal(extractErrorMessage(0, 'socket hang up'), 'socket hang up')
})

// ================= 响应解析 =================

test('parseOpenAIResponse 解析标准字符串 content', () => {
  const r = parseOpenAIResponse('{"choices":[{"message":{"content":"你好"}}]}')
  assert.equal(r.ok, true)
  assert.equal(r.text, '你好')
})

test('parseOpenAIResponse 兼容多模态数组 content', () => {
  const r = parseOpenAIResponse(
    '{"choices":[{"message":{"content":[{"type":"text","text":"你好"}]}}]}'
  )
  assert.equal(r.ok, true)
  assert.equal(r.text, '你好')
})

test('parseOpenAIResponse 对 content 为 null 或缺 choices 报错', () => {
  assert.equal(parseOpenAIResponse('{"choices":[{"message":{"content":null}}]}').ok, false)
  assert.equal(parseOpenAIResponse('{"choices":[]}').ok, false)
  assert.equal(parseOpenAIResponse('{"error":{"message":"bad model"}}').ok, false)
  assert.equal(parseOpenAIResponse('not json').ok, false)
})

test('parseLibreTranslateResponse 解析译文与服务端错误', () => {
  const ok = parseLibreTranslateResponse('{"translatedText":"你好"}')
  assert.equal(ok.ok, true)
  assert.equal(ok.text, '你好')

  const bad = parseLibreTranslateResponse('{"error":"target is not supported"}')
  assert.equal(bad.ok, false)
  assert.match(bad.error, /not supported/)
})

// ================= 配置合并与校验 =================

test('mergeTranslateConfig 深合并，缺字段时保留另一组默认值', () => {
  const merged = mergeTranslateConfig({ libretranslate: { baseUrl: 'http://127.0.0.1:5000' } })
  assert.deepEqual(merged.openai, DEFAULT_TRANSLATE_CONFIG.openai)
  assert.equal(merged.libretranslate.baseUrl, 'http://127.0.0.1:5000')
  assert.equal(merged.libretranslate.apiKey, '')
  assert.equal(merged.provider, 'openai')
})

test('mergeTranslateConfig 处理空值与非法 provider', () => {
  assert.deepEqual(mergeTranslateConfig(undefined), DEFAULT_TRANSLATE_CONFIG)
  assert.equal(mergeTranslateConfig({ provider: 'bogus' }).provider, 'openai')
})

test('isProviderConfigured 按当前 provider 校验必填项', () => {
  assert.equal(isProviderConfigured(DEFAULT_TRANSLATE_CONFIG), false)
  assert.equal(isProviderConfigured(null), false)

  const openaiFull = mergeTranslateConfig({
    provider: 'openai',
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', model: 'gpt-4o-mini' },
  })
  assert.equal(isProviderConfigured(openaiFull), true)

  const openaiNoKey = mergeTranslateConfig({
    provider: 'openai',
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  })
  assert.equal(isProviderConfigured(openaiNoKey), false)

  // LibreTranslate 的 apiKey 可空
  const libre = mergeTranslateConfig({
    provider: 'libretranslate',
    libretranslate: { baseUrl: 'http://127.0.0.1:5000' },
  })
  assert.equal(isProviderConfigured(libre), true)

  const blank = mergeTranslateConfig({
    provider: 'openai',
    openai: { baseUrl: '   ', apiKey: '  ', model: ' ' },
  })
  assert.equal(isProviderConfigured(blank), false)
})

test('describeProvider 给出可读的接口摘要', () => {
  const openai = mergeTranslateConfig({
    provider: 'openai',
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  })
  assert.equal(describeProvider(openai), 'OpenAI 兼容 · gpt-4o-mini')

  const libre = mergeTranslateConfig({
    provider: 'libretranslate',
    libretranslate: { baseUrl: 'http://127.0.0.1:5000' },
  })
  assert.equal(describeProvider(libre), 'LibreTranslate · 127.0.0.1:5000')
})

// ================= 批处理控制流 =================

test('自定义接口未配置时失败且不降级到 MyMemory', async () => {
  const r = await translateTextBatch({
    texts: ['hello'],
    sourceLang: 'en',
    targetLang: 'zh',
    api: 'openai',
  })

  assert.equal(r.ok, false)
  assert.deepEqual(r.results, ['hello'])
  assert.equal(r.apiUsed, '未配置')
  assert.doesNotMatch(r.apiUsed, /MyMemory/)
  assert.match(r.error, /尚未配置/)
})

test('provider 与配置不匹配时同样不降级', async () => {
  const libreOnly = mergeTranslateConfig({
    provider: 'libretranslate',
    libretranslate: { baseUrl: 'http://127.0.0.1:5000' },
  })

  const r = await translateTextBatch({
    texts: ['hello'],
    sourceLang: 'en',
    targetLang: 'zh',
    api: 'openai',
    providerConfig: libreOnly,
  })

  assert.equal(r.ok, false)
  assert.doesNotMatch(r.apiUsed, /MyMemory/)
})
