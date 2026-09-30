/*
 * OpenAI 兼容接口的流式翻译。
 *
 * 走主进程代理（绕 CORS），响应按 SSE 分块推回来。这里负责：
 *  1. 把 HTTP 分块拼成完整的 SSE 事件（网络分块不按事件边界切，一行会被劈成两半）
 *  2. 从每个事件的 delta 里取出增量文本，回调给调用方
 *  3. 在收到 [DONE] 或出错时收尾
 */

import { buildThinkingOffParams, type OpenAICompatibleConfig } from './translateConfig'

export interface StreamTranslateOptions {
  text: string
  sourceLang: string
  targetLang: string
  config: OpenAICompatibleConfig
  /** 每收到一段增量文本回调一次 */
  onDelta: (delta: string, full: string) => void
  /** 收到第一段文字的耗时（毫秒）。流式体验的快慢主要看它，不是总耗时 */
  onFirstToken?: (elapsedMs: number) => void
  signal?: AbortSignal
}

export interface StreamTranslateResult {
  ok: boolean
  /** 完整译文 */
  text: string
  error?: string
}

/** 生成一个够用的唯一 id：并发请求靠它对上号 */
function makeRequestId(): string {
  return `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 与 translateProviders 里的同名函数保持一致：补上 /v1 后缀 */
function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  // 已经带了版本段就不再补，否则 https://x/v1 会变成 https://x/v1/v1
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`
}

function buildSystemPrompt(sourceLang: string, targetLang: string): string {
  const from = sourceLang === 'auto' ? '自动检测的源语言' : sourceLang
  return [
    `你是翻译引擎。把用户给出的文本从${from}翻译成${targetLang}。`,
    '只输出译文本身，不要解释、不要加引号、不要重复原文。',
    '保留原文的换行与段落结构。',
  ].join('')
}

/**
 * 流式翻译一段文本。
 *
 * 返回的 Promise 在流结束（或出错）时 resolve，期间通过 onDelta 持续回调。
 * 中途 abort 会以 ok:false 结束，已收到的部分保留在 text 里 —— 用户改了输入
 * 导致中断时，那半截译文还有用。
 */
export async function translateStream(
  options: StreamTranslateOptions,
): Promise<StreamTranslateResult> {
  const { text, sourceLang, targetLang, config, onDelta, onFirstToken, signal } = options
  const startedAt = performance.now()
  /** 首字只报一次 */
  let firstTokenReported = false

  const url = buildChatCompletionsUrl(config.baseUrl)
  if (!url) return { ok: false, text: '', error: '未填写 Base URL' }
  if (!config.model.trim()) return { ok: false, text: '', error: '未填写模型名' }

  const api = window.electronAPI
  const startStream = api?.startTranslateStream
  if (!api || !startStream) {
    return { ok: false, text: '', error: '当前环境不支持流式翻译' }
  }

  const requestId = makeRequestId()
  let full = ''
  /** 未处理完的行缓冲。网络分块不按行切，必须自己攒 */
  let buffer = ''
  let done = false
  let failure: string | undefined

  return new Promise<StreamTranslateResult>((resolve) => {
    const cleanup = () => {
      offChunk?.()
      offEnd?.()
      offAbort?.()
    }

    const finish = () => {
      if (done) return
      done = true
      cleanup()
      resolve(failure ? { ok: false, text: full, error: failure } : { ok: true, text: full })
    }

    /** 处理一行 SSE。只认 data: 开头的行，其余（event:/id:/注释）忽略 */
    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) return
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') {
        finish()
        return
      }
      try {
        const parsed = JSON.parse(payload)
        // 有些兼容网关把错误塞在流里，得先看这个
        if (parsed?.error) {
          failure = parsed.error.message || '服务端返回错误'
          finish()
          return
        }
        const delta = parsed?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) {
          full += delta
          if (!firstTokenReported) {
            firstTokenReported = true
            onFirstToken?.(Math.round(performance.now() - startedAt))
          }
          onDelta(delta, full)
        }
      } catch {
        // 半行 JSON：留在 buffer 里等下一块补齐，这里静默跳过
      }
    }

    const offChunk = api.onTranslateStreamChunk?.((payload) => {
      if (payload.requestId !== requestId) return
      buffer += payload.chunk
      /*
       * 按行切分，最后一段留在 buffer —— 它可能是被网络切开的半行。
       * 只有收到换行才认为这行完整。
       */
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(handleLine)
    })

    const offEnd = api.onTranslateStreamEnd?.((payload) => {
      if (payload.requestId !== requestId) return
      // 收尾时把残留的 buffer 也处理掉：最后一行可能没有换行结尾
      if (buffer.trim()) handleLine(buffer)
      if (payload.error) failure = payload.error
      else if (!full) failure = '服务端没有返回任何内容'
      finish()
    })

    // 外部中断：请求主进程停止，并把已收到的部分交出去
    const offAbort = signal
      ? (() => {
          const onAbort = () => {
            void api.abortTranslateStream?.(requestId)
            failure = '已取消'
            finish()
          }
          signal.addEventListener('abort', onAbort)
          return () => signal.removeEventListener('abort', onAbort)
        })()
      : undefined

    // 真发请求。放最后，避免监听还没挂上就开始推分块
    void startStream({
      requestId,
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
        // 显式要 SSE，有些网关不带这个头就不开流
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: config.model.trim(),
        temperature: 0,
        stream: true,
        messages: [
          { role: 'system', content: buildSystemPrompt(sourceLang, targetLang) },
          { role: 'user', content: text },
        ],
        // 关掉推理模型的思考过程，否则首个可见字符要等好几秒
        ...buildThinkingOffParams(config),
      }),
    })
  })
}
