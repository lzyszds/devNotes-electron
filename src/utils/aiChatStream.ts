/*
 * AI 在线会话：流式 SSE 通信核心驱动。
 *
 * 核心特性：
 * 1. 深度适配 Electron 主进程代理（绕过浏览器 CORS，统一走系统/手动代理网络链路）；
 * 2. 具备浏览器端 Web fetch ReadableStream 降级兜底能力；
 * 3. 完美支持 DeepSeek-R1、Qwen-Thinking 等推理模型的深度思考（Reasoning Content / <think>）；
 * 4. 统计首字命中耗时（First Token Latency），保障极致的打字机交互质感；
 * 5. 健壮的网络分块（Chunk）拼帧算法，杜绝多字节字符与拆行 JSON 乱码。
 */

import { buildChatUrl, type AiChannelConfig } from './aiChannel'

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChatOptions {
  messages: ChatMessagePayload[]
  config: AiChannelConfig
  temperature?: number
  /** 每次收到增量正文时的回调 */
  onDelta: (delta: string, full: string) => void
  /** 收到深度思考（DeepSeek-R1 等推理模型）增量时的回调 */
  onReasoningDelta?: (deltaReasoning: string, fullReasoning: string) => void
  /** 首字返回耗时（毫秒） */
  onFirstToken?: (elapsedMs: number) => void
  /** 中断信号 */
  signal?: AbortSignal
}

export interface StreamChatResult {
  ok: boolean
  text: string
  reasoning: string
  error?: string
  elapsedMs: number
}

function makeRequestId(): string {
  return `ai-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function chatStream(options: StreamChatOptions): Promise<StreamChatResult> {
  const {
    messages,
    config,
    temperature = 0.7,
    onDelta,
    onReasoningDelta,
    onFirstToken,
    signal,
  } = options

  const startedAt = performance.now()
  let firstTokenReported = false

  const url = buildChatUrl(config.baseUrl)
  if (!url) {
    return {
      ok: false,
      text: '',
      reasoning: '',
      error: '请先在「系统设置 → AI 渠道」中配置 Base URL 与模型',
      elapsedMs: 0,
    }
  }
  if (!config.model.trim()) {
    return {
      ok: false,
      text: '',
      reasoning: '',
      error: '当前 AI 渠道未指定模型名称',
      elapsedMs: 0,
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`
  }

  const requestBody = JSON.stringify({
    model: config.model.trim(),
    messages,
    stream: true,
    temperature,
  })

  let fullText = ''
  let fullReasoning = ''
  let buffer = ''
  let isDone = false
  let failure: string | undefined

  // 内部思考标签状态检测（针对部分模型将 <think> 直接拼在 content 里的情况）
  let isInsideThinkTag = false

  const reportFirstToken = () => {
    if (!firstTokenReported) {
      firstTokenReported = true
      onFirstToken?.(Math.round(performance.now() - startedAt))
    }
  }

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') {
      isDone = true
      return
    }

    try {
      const parsed = JSON.parse(payload)
      if (parsed?.error) {
        failure = parsed.error.message || '服务商返回错误'
        isDone = true
        return
      }

      const choice = parsed?.choices?.[0]
      const delta = choice?.delta

      // 1. 优先提取专门的 reasoning_content（DeepSeek-R1 / NVIDIA NIM 等官方规范）
      const reasoningDelta = delta?.reasoning_content
      if (typeof reasoningDelta === 'string' && reasoningDelta) {
        reportFirstToken()
        fullReasoning += reasoningDelta
        onReasoningDelta?.(reasoningDelta, fullReasoning)
      }

      // 2. 提取正文 delta
      const contentDelta = delta?.content
      if (typeof contentDelta === 'string' && contentDelta) {
        reportFirstToken()

        // 容错处理：若模型将 <think> 放在 content 中
        if (contentDelta.includes('<think>')) {
          isInsideThinkTag = true
          const parts = contentDelta.split('<think>')
          if (parts[0]) {
            fullText += parts[0]
            onDelta(parts[0], fullText)
          }
          if (parts[1]) {
            fullReasoning += parts[1]
            onReasoningDelta?.(parts[1], fullReasoning)
          }
          return
        }

        if (contentDelta.includes('</think>')) {
          isInsideThinkTag = false
          const parts = contentDelta.split('</think>')
          if (parts[0]) {
            fullReasoning += parts[0]
            onReasoningDelta?.(parts[0], fullReasoning)
          }
          if (parts[1]) {
            fullText += parts[1]
            onDelta(parts[1], fullText)
          }
          return
        }

        if (isInsideThinkTag) {
          fullReasoning += contentDelta
          onReasoningDelta?.(contentDelta, fullReasoning)
        } else {
          fullText += contentDelta
          onDelta(contentDelta, fullText)
        }
      }
    } catch {
      // 遇到被截断的 JSON 碎片，留在 buffer 下一个 chunk 拼合
    }
  }

  // ================= 优先走 Electron 原生 Stream 代理 =================
  const api = window.electronAPI
  if (api?.startTranslateStream && api?.onTranslateStreamChunk && api?.onTranslateStreamEnd) {
    const startTranslateStream = api.startTranslateStream
    const onTranslateStreamChunk = api.onTranslateStreamChunk
    const onTranslateStreamEnd = api.onTranslateStreamEnd
    const abortTranslateStream = api.abortTranslateStream
    const requestId = makeRequestId()

    return new Promise<StreamChatResult>((resolve) => {
      const cleanup = () => {
        offChunk?.()
        offEnd?.()
        offAbort?.()
      }

      const finish = () => {
        cleanup()
        const elapsedMs = Math.round(performance.now() - startedAt)
        if (failure) {
          resolve({ ok: false, text: fullText, reasoning: fullReasoning, error: failure, elapsedMs })
        } else if (!fullText && !fullReasoning) {
          resolve({ ok: false, text: '', reasoning: '', error: 'AI 模型未返回任何回复内容', elapsedMs })
        } else {
          resolve({ ok: true, text: fullText, reasoning: fullReasoning, elapsedMs })
        }
      }

      const offChunk = onTranslateStreamChunk((data) => {
        if (data.requestId !== requestId) return
        buffer += data.chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        lines.forEach(handleLine)
        if (isDone) finish()
      })

      const offEnd = onTranslateStreamEnd((data) => {
        if (data.requestId !== requestId) return
        if (buffer.trim()) handleLine(buffer)
        if (data.error) failure = data.error
        finish()
      })

      const offAbort = signal
        ? (() => {
            const onAbort = () => {
              void abortTranslateStream?.(requestId)
              failure = '对话已中止'
              finish()
            }
            signal.addEventListener('abort', onAbort)
            return () => signal.removeEventListener('abort', onAbort)
          })()
        : undefined

      void startTranslateStream({
        requestId,
        url,
        method: 'POST',
        headers,
        body: requestBody,
        timeout: 180000,
      })
    })
  }

  // ================= 浏览器 / Web 降级实现 (fetch ReadableStream) =================
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: requestBody,
      signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return {
        ok: false,
        text: '',
        reasoning: '',
        error: `HTTP ${response.status}：${errText.slice(0, 300) || response.statusText}`,
        elapsedMs: Math.round(performance.now() - startedAt),
      }
    }

    if (!response.body) {
      return {
        ok: false,
        text: '',
        reasoning: '',
        error: '当前环境不支持 ReadableStream 流式响应',
        elapsedMs: Math.round(performance.now() - startedAt),
      }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(handleLine)
      if (isDone) break
    }

    if (buffer.trim()) handleLine(buffer)

    const elapsedMs = Math.round(performance.now() - startedAt)
    return {
      ok: !failure && (!!fullText || !!fullReasoning),
      text: fullText,
      reasoning: fullReasoning,
      error: failure,
      elapsedMs,
    }
  } catch (err: any) {
    const elapsedMs = Math.round(performance.now() - startedAt)
    if (signal?.aborted) {
      return { ok: false, text: fullText, reasoning: fullReasoning, error: '对话已中止', elapsedMs }
    }
    return {
      ok: false,
      text: fullText,
      reasoning: fullReasoning,
      error: err?.message || '网络连接异常',
      elapsedMs,
    }
  }
}

