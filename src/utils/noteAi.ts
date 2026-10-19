/*
 * 笔记里的 AI 改写动作。
 *
 * 只负责「选中的这段文字 → 系统提示词 + 用户文本 → 新文字」这一件事，
 * 不在编辑器里做任何 DOM 操作 —— 替换/插入由调用方用 Milkdown 命令完成，
 * 这样 Cherry 内核以后要接也能复用同一份提示词与流程。
 */

import {
  buildChatUrl,
  chatCompletion,
  getCachedAiChannel,
  type AiChatMessage,
} from './aiChannel'

export type NoteAiActionId =
  | 'polish'
  | 'continue'
  | 'summarize'
  | 'expand'
  | 'translate'
  | 'custom'

export interface NoteAiAction {
  id: NoteAiActionId
  label: string
  /** 浮层里的一句话说明 */
  hint: string
  /**
   * 结果怎么落回文档。
   * - replace：替换选中的文字（润色、翻译、总结）
   * - append：接在选中文字后面（续写、扩写）
   */
  mode: 'replace' | 'append'
  /** 需要用户再填一句话的（自定义指令、翻译目标语言） */
  needsInput?: boolean
  inputLabel?: string
  inputPlaceholder?: string
}

export const NOTE_AI_ACTIONS: NoteAiAction[] = [
  {
    id: 'polish',
    label: '润色',
    hint: '修正错别字与语病，保持原意',
    mode: 'replace',
  },
  {
    id: 'continue',
    label: '续写',
    hint: '顺着当前内容往下写',
    mode: 'append',
  },
  {
    id: 'summarize',
    label: '总结',
    hint: '压缩成要点',
    mode: 'replace',
  },
  {
    id: 'expand',
    label: '扩写',
    hint: '补充细节、展开论述',
    mode: 'append',
  },
  {
    id: 'translate',
    label: '翻译',
    hint: '译成目标语言并替换',
    mode: 'replace',
    needsInput: true,
    inputLabel: '目标语言',
    inputPlaceholder: '如：英文、日文',
  },
  {
    id: 'custom',
    label: '自定义',
    hint: '用自己的指令改写',
    mode: 'replace',
    needsInput: true,
    inputLabel: '指令',
    inputPlaceholder: '如：改成正式邮件口吻',
  },
]

const BASE_RULE =
  '你是文本编辑助手。只输出改写后的正文本身，不要解释、不要加引号、不要前后缀说明。' +
  '保留原文的 Markdown 结构（标题、列表、代码块等）。'

/** 拼出每个动作对应的系统提示词 */
function buildSystemPrompt(action: NoteAiAction, extra: string): string {
  switch (action.id) {
    case 'polish':
      return `${BASE_RULE}任务：润色下面的文字，修正错别字、病句和标点，不改变原意和篇幅。`
    case 'continue':
      return `${BASE_RULE}任务：顺着下面的内容自然地续写一到两段，风格与原文一致，不要重复已有内容。`
    case 'summarize':
      return `${BASE_RULE}任务：把下面的内容总结成简洁的 Markdown 要点列表。`
    case 'expand':
      return `${BASE_RULE}任务：把下面的内容扩写得更充分，补充细节、例子或论证，保持原意。`
    case 'translate':
      return `${BASE_RULE}任务：把下面的内容翻译成${extra || '英文'}，只输出译文。`
    case 'custom':
      return `${BASE_RULE}任务：按下面的要求改写文字。\n要求：${extra}`
  }
}

export interface RunNoteAiOptions {
  action: NoteAiAction
  /** 选中的原文 */
  text: string
  /** 自定义指令 / 目标语言 */
  extra?: string
  /** 用于「续写」时带上选区前面的上下文 */
  contextBefore?: string
}

export interface RunNoteAiResult {
  ok: boolean
  text: string
  error?: string
  elapsedMs: number
}

/**
 * 执行一次笔记 AI 改写。
 *
 * 走项目级 AI 渠道配置（设置 → AI 渠道），与翻译接口分开。
 */
export async function runNoteAi(options: RunNoteAiOptions): Promise<RunNoteAiResult> {
  const { action, text, extra = '', contextBefore = '' } = options

  const messages: AiChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(action, extra) },
  ]

  // 续写需要前文，否则模型不知道「接着什么写」
  if (action.id === 'continue' && contextBefore.trim()) {
    messages.push({
      role: 'user',
      content: `前文（仅供理解上下文，不要重复输出）：\n${contextBefore}\n\n请接着最后这部分继续写：\n${text}`,
    })
  } else {
    messages.push({ role: 'user', content: text })
  }

  const result = await chatCompletion(messages, { temperature: 0.7, maxTokens: 2048 })

  if (!result.ok) {
    return { ok: false, text: '', error: result.error, elapsedMs: result.elapsedMs }
  }

  // 模型偶尔会包一层代码块或引号，去掉以避免污染正文
  const cleaned = stripWrapper(result.text)
  return { ok: true, text: cleaned, elapsedMs: result.elapsedMs }
}

export interface RunNoteAiStreamOptions extends RunNoteAiOptions {
  /** 每收到一段增量文本就回调一次，用于边生成边显示 */
  onDelta: (fullText: string) => void
  /** 取消 */
  signal?: AbortSignal
}

/**
 * 流式版本：边生成边把累积的文本回调出去。
 *
 * 复用翻译那套主进程 SSE 代理（startTranslateStream），返回结构与非流式版本一致，
 * 调用方可以无感替换。推理模型的 reasoning_content 不计入正文 —— 用户要的是结果，
 * 把思考过程混进来反而看不懂；但若整个请求只有思考没有正文，会把思考内容兜底返回。
 */
export async function runNoteAiStream(
  options: RunNoteAiStreamOptions
): Promise<RunNoteAiResult> {
  const { action, text, extra = '', contextBefore = '', onDelta, signal } = options
  const startedAt = Date.now()

  const messages: AiChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(action, extra) },
  ]
  if (action.id === 'continue' && contextBefore.trim()) {
    messages.push({
      role: 'user',
      content: `前文（仅供理解上下文，不要重复输出）：\n${contextBefore}\n\n请接着最后这部分继续写：\n${text}`,
    })
  } else {
    messages.push({ role: 'user', content: text })
  }

  const api = window.electronAPI
  if (!api?.startTranslateStream) {
    // 没有流式通道（如某些浏览器环境）就退回普通请求，功能不至于缺失
    const fallback = await runNoteAi(options)
    if (fallback.ok) onDelta(fallback.text)
    return fallback
  }

  const config = getCachedAiChannel()
  const url = buildChatUrl(config.baseUrl)
  if (!url) return { ok: false, text: '', error: '未配置 AI 渠道', elapsedMs: 0 }
  if (!config.model.trim()) return { ok: false, text: '', error: '未选择模型', elapsedMs: 0 }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`

  const requestId = `note-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let content = ''
  let reasoning = ''
  let buffer = ''
  let failure: string | undefined

  return new Promise<RunNoteAiResult>((resolve) => {
    const offs: Array<() => void> = []
    const done = (ok: boolean) => {
      offs.forEach((off) => off())
      const final = (ok ? content : '').trim() || (ok ? reasoning.trim() : '')
      resolve({
        ok: ok && !!final,
        text: ok ? stripWrapper(final) : '',
        error: ok ? (final ? undefined : '返回中没有回复内容') : failure || '请求失败',
        elapsedMs: Date.now() - startedAt,
      })
    }

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') {
        done(true)
        return
      }
      try {
        const parsed = JSON.parse(payload)
        if (parsed?.error) {
          failure = parsed.error.message || '服务端返回错误'
          done(false)
          return
        }
        const delta = parsed?.choices?.[0]?.delta
        const piece = typeof delta?.content === 'string' ? delta.content : ''
        const think = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : ''
        if (think) reasoning += think
        if (piece) {
          content += piece
          onDelta(content)
        }
      } catch {
        // 半行 JSON，等下一次 chunk 拼完整
      }
    }

    offs.push(
      api.onTranslateStreamChunk!(({ requestId: id, chunk }) => {
        if (id !== requestId) return
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        lines.forEach(handleLine)
      })
    )
    offs.push(
      api.onTranslateStreamEnd!(({ requestId: id, error }) => {
        if (id !== requestId) return
        if (error) failure = error
        // 末尾残留的半行也要处理
        if (buffer) handleLine(buffer)
        done(!error)
      })
    )

    const abort = () => {
      void api.abortTranslateStream?.(requestId)
      failure = '已取消'
      done(false)
    }
    signal?.addEventListener('abort', abort, { once: true })

    void api.startTranslateStream!({
      requestId,
      url,
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 2048,
      }),
      timeout: 180000,
    })
  })
}

/** 去掉模型自作主张包的 markdown 围栏与整体引号 */
function stripWrapper(raw: string): string {
  let out = raw.trim()
  const fence = out.match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  if (fence) out = fence[1].trim()
  if (
    out.length > 1 &&
    ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith('“') && out.endsWith('”')))
  ) {
    out = out.slice(1, -1).trim()
  }
  return out
}
