/*
 * AI 在线会话：会话持久化存储与会话生命周期管理。
 *
 * 优先持久化至 electron-store，降级兜底至 localStorage。
 * 允许用户新建、切换、重命名、删除会话，以及将整场会话一键导出为 Markdown 或 JSON。
 */

import { getPresetById } from './aiChatPresets'

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 深度思考内容（针对 DeepSeek-R1 / Qwen-Thinking 等模型） */
  reasoningContent?: string
  createdAt: number
  model?: string
  elapsedMs?: number
  firstTokenMs?: number
  /** 用户消息引用的上下文小标签（如关联笔记、关联工具等） */
  contextPills?: { icon?: string; label: string }[]
}

export interface AiChatSession {
  id: string
  title: string
  presetId: string
  messages: AiChatMessage[]
  createdAt: number
  updatedAt: number
  /** 是否置顶在顶部工作流卡片区 */
  pinned?: boolean
  /** 是否收藏 */
  starred?: boolean
  /** 关联绑定的知识库笔记 ID 列表 */
  attachedNoteIds?: string[]
  /** 会话自定义覆盖的 System Prompt */
  customSystemPrompt?: string
  /** 严谨度参数 0.0 ~ 1.0 */
  temperature?: number
  /** 附带历史消息数 */
  historyLimit?: number
}

export const AI_CHAT_SESSIONS_STORAGE_KEY = 'devnotes-ai-chat-sessions'
export const AI_CHAT_ACTIVE_ID_KEY = 'devnotes-ai-chat-active-id'

export function createNewSession(presetId = 'general', title = '新对话'): AiChatSession {
  const now = Date.now()
  return {
    id: `session_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    presetId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** 同步读取缓存的历史会话列表（供组件初次挂载时即刻渲染，消除空白闪烁与异步延迟） */
export function getCachedChatSessions(): AiChatSession[] {
  try {
    const local = localStorage.getItem(AI_CHAT_SESSIONS_STORAGE_KEY)
    if (local) {
      const parsed = JSON.parse(local)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as AiChatSession[]
      }
    }
  } catch {
    // ignore
  }
  return [createNewSession('general', '日常全能问答')]
}

/** 同步读取缓存的当前活跃会话 ID */
export function getCachedActiveSessionId(): string {
  try {
    const id = localStorage.getItem(AI_CHAT_ACTIVE_ID_KEY)
    if (typeof id === 'string') return id
  } catch {
    // ignore
  }
  return ''
}

/** 读取所有历史会话列表（异步 IPC 兜底） */
export async function loadChatSessions(): Promise<AiChatSession[]> {
  try {
    let stored: unknown = null
    if (window.electronAPI?.storeGet) {
      stored = await window.electronAPI.storeGet(AI_CHAT_SESSIONS_STORAGE_KEY)
    }
    if (!stored || !Array.isArray(stored)) {
      const local = localStorage.getItem(AI_CHAT_SESSIONS_STORAGE_KEY)
      if (local) stored = JSON.parse(local)
    }

    if (Array.isArray(stored) && stored.length > 0) {
      return stored as AiChatSession[]
    }
  } catch {
    // ignore
  }

  // 默认赠送一个初始空会话
  const defaultSession = createNewSession('general', '日常全能问答')
  return [defaultSession]
}

let saveSessionsTimer: any = null

/** 持久化保存所有会话列表（防抖 300ms 异步持久化至磁盘，避免高频 IPC 阻塞主线程） */
export function saveChatSessions(sessions: AiChatSession[]): void {
  // 先同步写 localStorage，保障即使立刻刷新也不丢失状态
  try {
    localStorage.setItem(AI_CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // ignore
  }

  // 磁盘文件与 electron-store 采用 300ms 防抖写入
  if (saveSessionsTimer) clearTimeout(saveSessionsTimer)
  saveSessionsTimer = setTimeout(() => {
    if (window.electronAPI?.storeSet) {
      window.electronAPI.storeSet(AI_CHAT_SESSIONS_STORAGE_KEY, sessions).catch(() => {})
    }
  }, 300)
}

/** 读取上次停留的会话 ID */
export async function loadActiveSessionId(): Promise<string | null> {
  try {
    if (window.electronAPI?.storeGet) {
      const stored = await window.electronAPI.storeGet(AI_CHAT_ACTIVE_ID_KEY)
      if (typeof stored === 'string') return stored
    }
    return localStorage.getItem(AI_CHAT_ACTIVE_ID_KEY)
  } catch {
    return null
  }
}

/** 保存当前停留的会话 ID */
export async function saveActiveSessionId(id: string): Promise<void> {
  try {
    if (window.electronAPI?.storeSet) {
      await window.electronAPI.storeSet(AI_CHAT_ACTIVE_ID_KEY, id)
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(AI_CHAT_ACTIVE_ID_KEY, id)
  } catch {
    // ignore
  }
}

/** 将会话格式化为美观的 Markdown 文本 */
export function exportSessionAsMarkdown(session: AiChatSession): string {
  const preset = getPresetById(session.presetId)
  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push(`> **角色设定**：${preset.name} (${preset.roleTitle})`)
  lines.push(`> **导出时间**：${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  session.messages.forEach((msg, idx) => {
    const isUser = msg.role === 'user'
    const roleLabel = isUser ? '**User**' : `**AI 助手** (${msg.model || 'Default'})`
    const timeStr = new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour12: false })

    lines.push(`### ${idx + 1}. ${roleLabel}  \`${timeStr}\``)
    lines.push('')

    if (msg.reasoningContent?.trim()) {
      lines.push('<details><summary>展开思考过程</summary>')
      lines.push('')
      lines.push(msg.reasoningContent.trim())
      lines.push('')
      lines.push('</details>')
      lines.push('')
    }

    lines.push(msg.content.trim())
    lines.push('')
    lines.push('---')
    lines.push('')
  })

  return lines.join('\n')
}

/** 将会话导出为 JSON 字符串 */
export function exportSessionAsJson(session: AiChatSession): string {
  return JSON.stringify(session, null, 2)
}

/** 前端通用文件下载触发器 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

