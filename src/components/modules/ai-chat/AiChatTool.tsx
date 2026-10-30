/*
 * AI 在线会话工作台（AiChatTool）
 *
 * 融合 devNotes 极简桌面工作台与现代化 AI 研发助手 UI 设计：
 * 1. 布局架构：左侧会话检索与分类列表 (w-[268px]) + 中间主交互画布 (flex-1)；
 * 2. 全局自动知识库联动：全文档自动智能关联，无需手动逐篇添加绑定；
 * 3. 严格遵循纯 SVG Icon 设计体系，全面剔除所有 Emoji 图标；
 * 4. 极客暗色代码块：自适应语言标识、一键复制代码、一键插入到当前笔记；
 * 5. 深度思考 (CoT) 可视化：耗时统计、动态收折、思考过程与正文严密隔离；
 * 6. 极致性能保障：React.memo 消息隔离、剔除 highlightAuto 全量正则扫描、60FPS RAF 渲染节流缓冲。
 */

import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertCircle,
  Bot,
  Braces,
  BrainCircuit,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FileDown,
  FileText,
  Globe,
  Layers,
  Layout,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/common'
import Tooltip from '../../ui/Tooltip'
import { useToast } from '../../ui/Toast'
import { useNotes } from '../../../context/NotesContext'
import {
  getCachedAiChannel,
  isAiChannelConfigured,
  loadAiChannel,
  subscribeAiChannel,
  type AiChannelConfig,
} from '../../../utils/aiChannel'
import {
  AI_CHAT_PRESETS,
  getPresetById,
  type AiChatPreset,
} from '../../../utils/aiChatPresets'
import {
  createNewSession,
  downloadFile,
  exportSessionAsJson,
  exportSessionAsMarkdown,
  getCachedActiveSessionId,
  getCachedChatSessions,
  loadActiveSessionId,
  flushChatSessions,
  loadChatSessions,
  saveActiveSessionId,
  saveChatSessions,
  type AiChatMessage,
  type AiChatSession,
} from '../../../utils/aiChatStorage'
import { chatStream } from '../../../utils/aiChatStream'
import { openAppSettings } from '../../../utils/settingsBus'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** 角色预设与对应的高精度 SVG 图标映射 */
function getPresetIcon(presetId: string, className = 'w-4 h-4') {
  switch (presetId) {
    case 'developer':
      return <Code2 className={className} />
    case 'architect':
      return <Layers className={className} />
    case 'frontend':
      return <Layout className={className} />
    case 'reviewer':
      return <ShieldCheck className={className} />
    case 'bug-fixer':
      return <Bug className={className} />
    case 'writer':
      return <FileText className={className} />
    case 'general':
    default:
      return <Bot className={className} />
  }
}

/**
 * 语法高亮缓存与 Markdown 渲染全局缓存池。
 * 彻底消灭初次进入与反复切换会话时的重复编译高亮开销，保证切换会话 0ms 纯内存命中。
 */
const MARKDOWN_CACHE = new Map<string, string>()
const CODE_HIGHLIGHT_CACHE = new Map<string, string>()

/**
 * 单次挂载消息窗口大小。
 *
 * 切换会话时 React 必须在「一次同步提交」里卸载旧会话整棵消息 DOM、再挂载新会话
 * 整棵消息 DOM —— 这是切换瞬间主线程被堵死几百 ms 的根源（content-visibility 只省
 * 排版与绘制，省不掉 DOM 挂载成本）。只渲染末尾一个窗口，「加载更早」按钮按此步长
 * 向上增量补载，让每次切换/进入永远是轻量提交。
 */
const MESSAGE_WINDOW_STEP = 40

/** 配置 marked 的代码块高亮与终端极客深色主题 */
const customRenderer = new marked.Renderer()

customRenderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = (lang || '').trim().toLowerCase()
  const cacheKey = `${language}:${text}`
  const cached = CODE_HIGHLIGHT_CACHE.get(cacheKey)
  if (cached) return cached

  let highlighted = escapeHtml(text)

  // 严格只对合法已知语言进行语法高亮，坚决不触发 highlightAuto 全量正则轮询
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value
    } catch {
      // 容错回退
    }
  }

  const encoded = encodeURIComponent(text)
  const displayLang = language || 'code'

  const html = `
    <div class="fe-chat-code-block rounded-xl overflow-hidden border border-zinc-800 bg-[#18181B] text-zinc-100 shadow-md my-3 text-[12px] font-mono">
      <div class="px-3.5 py-2 bg-[#27272A]/70 border-b border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400 font-mono select-none">
        <span class="text-zinc-300 font-medium">${displayLang}</span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="fe-copy-code-btn hover:text-white transition-colors cursor-pointer"
            data-code="${encoded}"
          >
            复制代码
          </button>
          <span class="text-zinc-600">·</span>
          <button
            type="button"
            class="fe-insert-code-btn hover:text-white transition-colors cursor-pointer"
            data-code="${encoded}"
          >
            插入到当前笔记
          </button>
        </div>
      </div>
      <pre class="p-3.5 text-xs font-mono leading-relaxed overflow-x-auto text-zinc-200"><code>${highlighted}</code></pre>
    </div>
  `

  if (CODE_HIGHLIGHT_CACHE.size > 800) {
    const firstKey = CODE_HIGHLIGHT_CACHE.keys().next().value
    if (firstKey) CODE_HIGHLIGHT_CACHE.delete(firstKey)
  }
  CODE_HIGHLIGHT_CACHE.set(cacheKey, html)
  return html
}

marked.setOptions({
  renderer: customRenderer,
  gfm: true,
  breaks: true,
})

function renderMarkdown(content: string): string {
  if (!content) return ''
  const cached = MARKDOWN_CACHE.get(content)
  if (cached) return cached

  try {
    const res = marked.parse(content)
    const html = typeof res === 'string' ? res : ''
    if (MARKDOWN_CACHE.size > 800) {
      const firstKey = MARKDOWN_CACHE.keys().next().value
      if (firstKey) MARKDOWN_CACHE.delete(firstKey)
    }
    MARKDOWN_CACHE.set(content, html)
    return html
  } catch {
    return escapeHtml(content)
  }
}

/**
 * 消息项纯组件（React.memo 缓存）：
 * 彻底隔离历史消息的 Markdown 解析与重绘。新流式输入或输入框敲字时，历史气泡一概 0 开销。
 */
interface ChatMessageItemProps {
  msg: AiChatMessage
  isThinkingExpanded: boolean
  onToggleThinking: (msgId: string) => void
  onCopy: (content: string) => void
  onInsertToNote: (content: string) => void
  onRegenerate: (msgId: string) => void
  onDelete: (msgId: string) => void
  /** 是否正在生成。用 ref 而不是布尔值：流式开关一次不该让所有历史消息重渲 */
  isStreamingRef: React.MutableRefObject<boolean>
}

const ChatMessageItem = React.memo(function ChatMessageItem({
  msg,
  isThinkingExpanded,
  onToggleThinking,
  onCopy,
  onInsertToNote,
  onRegenerate,
  onDelete,
  isStreamingRef,
}: ChatMessageItemProps) {
  const isUser = msg.role === 'user'

  const renderedContentHtml = useMemo(() => {
    if (isUser) return ''
    return renderMarkdown(msg.content || '')
  }, [isUser, msg.content])

  if (isUser) {
    return (
      <div className="fe-chat-msg flex justify-end">
        <div className="max-w-2xl">
          {/* 引用上下文小标签（纯 SVG 图标，无 Emoji） */}
          {msg.contextPills && msg.contextPills.length > 0 && (
            <div className="flex justify-end gap-1.5 mb-1.5 flex-wrap">
              {msg.contextPills.map((pill, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-100 text-[11px] text-zinc-600 border border-zinc-200/60"
                >
                  <FileText size={11} className="text-zinc-500" />
                  <span>{pill.label}</span>
                </span>
              ))}
            </div>
          )}
          {/* 消息气泡 */}
          <div className="bg-zinc-900 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-xs leading-relaxed shadow-sm whitespace-pre-wrap break-words">
            {msg.content}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fe-chat-msg flex items-start gap-3.5 max-w-3xl">
      {/* AI 头像 */}
      <div className="w-8 h-8 rounded-xl bg-zinc-100 border border-zinc-200/80 flex items-center justify-center shrink-0 shadow-sm">
        <Bot size={15} className="text-zinc-800" />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        {/* 可折叠的深度思考过程 (CoT) */}
        {msg.reasoningContent?.trim() && (
          <div className="bg-zinc-50 border border-zinc-200/70 rounded-xl px-3.5 py-2 text-xs">
            <button
              type="button"
              onClick={() => onToggleThinking(msg.id)}
              className="w-full flex items-center justify-between cursor-pointer text-zinc-500 font-medium list-none text-left"
            >
              <div className="flex items-center gap-2">
                <BrainCircuit size={13} className="text-zinc-500" />
                <span>
                  {msg.elapsedMs
                    ? `已思考 ${(msg.elapsedMs / 1000).toFixed(1)} 秒 · 深度逻辑推理`
                    : '已完成深度思考与分析'}
                </span>
              </div>
              <ChevronDown
                size={12}
                className={`text-zinc-400 transition-transform duration-200 ${isThinkingExpanded ? 'rotate-180' : ''
                  }`}
              />
            </button>

            {isThinkingExpanded && (
              <div className="mt-2 pt-2 border-t border-zinc-200/60 select-text text-[11px] text-zinc-500 leading-relaxed font-mono whitespace-pre-wrap">
                {msg.reasoningContent.trim()}
              </div>
            )}
          </div>
        )}

        {/* 正文排版 */}
        <div
          className="text-[13px] text-zinc-800 select-text leading-relaxed space-y-3 break-words prose prose-zinc max-w-none prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-li:my-0.5"
          dangerouslySetInnerHTML={{
            __html: renderedContentHtml,
          }}
        />

        {/* 底部消息操作栏 */}
        <div className="flex items-center gap-3 pt-1 text-[11px] text-zinc-400 flex-wrap">
          <button
            type="button"
            onClick={() => onCopy(msg.content)}
            className="hover:text-zinc-800 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Copy size={13} />
            <span>复制</span>
          </button>

          <button
            type="button"
            onClick={() => onInsertToNote(msg.content)}
            className="hover:text-zinc-800 flex items-center gap-1 transition-colors cursor-pointer"
            title="追加正文到当前正在编辑的笔记"
          >
            <FileText size={13} />
            <span>追加到笔记</span>
          </button>

          <button
            type="button"
            onClick={() => onRegenerate(msg.id)}
            // 用 ref 读「是否在生成」，回调本身不再依赖状态 —— 否则这个回调
            // 每次流式开关一变就换 identity，整批消息的 memo 全被击穿
            disabled={isStreamingRef.current}
            className={`hover:text-zinc-800 flex items-center gap-1 transition-colors cursor-pointer ${isStreamingRef.current ? 'opacity-40 cursor-not-allowed' : ''
              }`}
          >
            <RotateCcw size={13} />
            <span>重新生成</span>
          </button>

          <button
            type="button"
            onClick={() => onDelete(msg.id)}
            className="hover:text-rose-600 flex items-center gap-1 transition-colors cursor-pointer ml-1"
          >
            <Trash2 size={13} />
            <span>删除</span>
          </button>

          <div className="ml-auto flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
            {msg.model && <span>{msg.model}</span>}
            {msg.firstTokenMs && <span>首字 {msg.firstTokenMs}ms</span>}
            {msg.elapsedMs && (
              <span>耗时 {(msg.elapsedMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

interface SessionItemProps {
  session: AiChatSession
  isSelected: boolean
  isEditing: boolean
  editingTitle: string
  onSelect: (id: string) => void
  onTogglePin: (id: string, e: React.MouseEvent) => void
  onToggleStar: (id: string, e: React.MouseEvent) => void
  onStartRename: (session: AiChatSession, e: React.MouseEvent) => void
  onSaveRename: (id: string) => void
  onCancelRename: () => void
  onDelete: (id: string, e: React.MouseEvent) => void
  onTitleChange: (title: string) => void
}

/**
 * 侧边栏普通会话卡片（React.memo 缓存）：
 * 切换会话时仅旧会话与新会话触发重绘，其他几十个会话完全跳过 diff。
 * 预览文本严格截取前 50 字，杜绝向 truncate 容器传递几万字导致的 DOM 布局重测卡死。
 */
const SessionItem = React.memo(function SessionItem({
  session,
  isSelected,
  isEditing,
  editingTitle,
  onSelect,
  onTogglePin,
  onToggleStar,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onDelete,
  onTitleChange,
}: SessionItemProps) {
  const lastMsg = session.messages[session.messages.length - 1]
  const preset = getPresetById(session.presetId)

  const previewText = useMemo(() => {
    if (!lastMsg?.content) return preset.description || '暂无内容'
    return lastMsg.content.slice(0, 50).replace(/\s+/g, ' ')
  }, [lastMsg?.content, preset.description])

  return (
    <div
      onClick={() => onSelect(session.id)}
      className={`group relative p-2.5 rounded-xl cursor-pointer transition-all ${
        isSelected
          ? 'bg-white border border-zinc-200/90 shadow-sm'
          : 'hover:bg-zinc-200/40'
      }`}
    >
      <div className="flex items-center justify-between">
        {isEditing ? (
          <input
            type="text"
            value={editingTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={() => onSaveRename(session.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveRename(session.id)
              if (e.key === 'Escape') onCancelRename()
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-medium text-zinc-900 bg-white border border-zinc-900 rounded px-1 outline-none w-full mr-2"
          />
        ) : (
          <h4
            className={`text-xs truncate ${
              isSelected ? 'font-bold text-zinc-900' : 'font-medium text-zinc-800'
            }`}
          >
            {session.title}
          </h4>
        )}

        {/* 悬浮操作图标 */}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => onTogglePin(session.id, e)}
            className="p-0.5 text-zinc-400 hover:text-zinc-800 cursor-pointer"
            title={session.pinned ? '取消置顶' : '置顶'}
          >
            <Pin size={11} className={session.pinned ? 'fill-zinc-800' : ''} />
          </button>
          <button
            type="button"
            onClick={(e) => onToggleStar(session.id, e)}
            className="p-0.5 text-zinc-400 hover:text-amber-500 cursor-pointer"
            title={session.starred ? '取消收藏' : '收藏'}
          >
            <Star size={11} className={session.starred ? 'fill-amber-400 text-amber-500' : ''} />
          </button>
          <button
            type="button"
            onClick={(e) => onStartRename(session, e)}
            className="p-0.5 text-zinc-400 hover:text-zinc-800 cursor-pointer"
            title="重命名"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => onDelete(session.id, e)}
            className="p-0.5 text-zinc-400 hover:text-rose-600 cursor-pointer"
            title="删除"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 truncate mt-1">
        {previewText}
      </p>
    </div>
  )
})

/**
 * 侧边栏置顶会话卡片（React.memo 缓存）
 */
const PinnedSessionItem = React.memo(function PinnedSessionItem({
  session,
  isSelected,
  onSelect,
  onTogglePin,
}: {
  session: AiChatSession
  isSelected: boolean
  onSelect: (id: string) => void
  onTogglePin: (id: string, e: React.MouseEvent) => void
}) {
  const lastMsg = session.messages[session.messages.length - 1]
  const preset = getPresetById(session.presetId)

  const previewText = useMemo(() => {
    if (!lastMsg?.content) return preset.description
    return lastMsg.content.slice(0, 50).replace(/\s+/g, ' ')
  }, [lastMsg?.content, preset.description])

  return (
    <div
      onClick={() => onSelect(session.id)}
      className={`group relative p-2.5 rounded-2xl flex items-center gap-2.5 cursor-pointer transition-all ${
        isSelected
          ? 'bg-white border border-zinc-200/90 shadow-sm'
          : 'hover:bg-zinc-200/40'
      }`}
    >
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
          isSelected
            ? 'bg-zinc-900 text-white'
            : 'bg-zinc-200/70 text-zinc-700'
        }`}
      >
        {getPresetIcon(session.presetId, 'w-4 h-4')}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-zinc-900 truncate">
            {session.title}
          </h4>
          <button
            type="button"
            onClick={(e) => onTogglePin(session.id, e)}
            className="text-zinc-400 hover:text-zinc-800 cursor-pointer"
            title="取消置顶"
          >
            <Pin size={11} className="fill-zinc-400" />
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 truncate mt-0.5">
          {previewText}
        </p>
      </div>
    </div>
  )
})

export default function AiChatTool() {
  const { showToast } = useToast()
  const { insertText, activeNote, notes } = useNotes()

  // 1. AI 渠道与模型配置
  const [aiConfig, setAiConfig] = useState<AiChannelConfig>(() => getCachedAiChannel())
  useEffect(() => {
    loadAiChannel().then(setAiConfig)
    return subscribeAiChannel(setAiConfig)
  }, [])
  const isConfigured = isAiChannelConfigured(aiConfig)

  // 2. 会话列表与当前活跃会话（同步从本地缓存即刻初始化，消除初次进入页面的异步延迟与白屏闪烁）
  const [sessions, setSessions] = useState<AiChatSession[]>(() => getCachedChatSessions())
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const cachedId = getCachedActiveSessionId()
    const initialList = getCachedChatSessions()
    if (cachedId && initialList.some((s) => s.id === cachedId)) {
      return cachedId
    }
    return initialList[0]?.id || ''
  })
  const [sidebarTab, setSidebarTab] = useState<'all' | 'presets' | 'starred'>('all')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  // 3. 用户输入与流式响应状态
  const [inputText, setInputText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  /*
   * isStreaming 的 ref 副本：给「一次生成期间不该重建」的回调用（消息操作栏、
   * 渲染列表）。用 state 做依赖的话，生成开始/结束各让整批历史消息重渲一次，
   * 长会话里这就是一次可感知的停顿。
   */
  const isStreamingRef = useRef(false)
  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [streamingContent, setStreamingContent] = useState('')
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // 4. 交互开关（深度思考、联网检索）
  const [enableThinking, setEnableThinking] = useState(true)
  const [enableWebSearch, setEnableWebSearch] = useState(false)

  // 深度思考折叠状态字典（消息 ID -> 是否展开）
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})

  // 性能优化：历史消息只挂尾部一个窗口，更早的历史按 MESSAGE_WINDOW_STEP 增量补载。
  // 一次性全员挂载会让切换会话的同步 commit 大到把主线程堵死几百 ms。
  const [visibleMessageCount, setVisibleMessageCount] = useState(MESSAGE_WINDOW_STEP)

  // 用 ref 侧记当前活跃会话 ID：handleSelectSession / handleDeleteSession 不再依赖
  // activeSessionId 这个 state。该依赖一变回调 identity 就变，侧栏几十个
  // SessionItem 的 React.memo 会被整批击穿重绘，是切换路径上的一笔无效开销。
  const activeSessionIdRef = useRef(activeSessionId)
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  // 切换活跃会话时重置窗口：保证每次切换后的首次提交永远是「尾部一个窗口」。
  // （同时兜底覆盖异步恢复 activeId 等非用户点击路径的会话变更）
  useEffect(() => {
    setVisibleMessageCount(MESSAGE_WINDOW_STEP)
  }, [activeSessionId])

  /*
   * 会话落盘是 300ms 防抖的（见 saveChatSessions），窗口隐藏 / 关闭时
   * 防抖窗口内最后一句还在内存里 —— 这里补一次同步 flush。
   */
  useEffect(() => {
    const flush = () => flushChatSessions()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  // 5. 显式引用知识库文章状态与弹窗控制（不再全自动静默关联，改由用户按需选配）
  const [selectedRefNoteIds, setSelectedRefNoteIds] = useState<string[]>([])
  const [isRefModalOpen, setIsRefModalOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const refModalContainerRef = useRef<HTMLDivElement>(null)

  // 消息滚动容器与 RAF 节流缓冲
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingContentRef = useRef('')
  const pendingReasoningRef = useRef('')
  const rafPendingRef = useRef(false)
  const isNearBottomRef = useRef(true)

  // 性能优化：流式正文 Markdown 解析节流（~60ms 间隔），避免每次 60fps RAF 跑全量正则与 hljs
  const [streamingHtml, setStreamingHtml] = useState('')
  const lastMarkdownParseTimeRef = useRef(0)
  const markdownTimerRef = useRef<any>(null)

  // 点击外部或按下 ESC 键自动关闭引用弹窗
  useEffect(() => {
    if (!isRefModalOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        refModalContainerRef.current &&
        !refModalContainerRef.current.contains(e.target as Node)
      ) {
        setIsRefModalOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsRefModalOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isRefModalOpen])

  // 性能优化：流式传输时的 Markdown 渲染限频，保障长文本高频输出时不卡死主线程。
  // 60ms 是「一半帧率」—— SSE 每来一小段就全量重解析整篇 markdown，长回复后期
  // 每次解析都是几十 ms，频率再高就把主线程喂满了；再低则肉眼能看出卡顿。
  useEffect(() => {
    if (!streamingContent) {
      setStreamingHtml('')
      if (markdownTimerRef.current) {
        clearTimeout(markdownTimerRef.current)
        markdownTimerRef.current = null
      }
      return
    }

    // 定时器已挂上说明这一帧的解析正在排队，别重复安排
    if (markdownTimerRef.current) return

    const now = performance.now()
    const wait = Math.max(0, 60 - (now - lastMarkdownParseTimeRef.current))
    if (wait === 0) {
      lastMarkdownParseTimeRef.current = now
      setStreamingHtml(renderMarkdown(streamingContent))
      return
    }
    markdownTimerRef.current = setTimeout(() => {
      lastMarkdownParseTimeRef.current = performance.now()
      markdownTimerRef.current = null
      // 取 ref 里的最新全文：定时器等待期间内容可能又长了几段，用旧的会往回跳
      setStreamingHtml(renderMarkdown(pendingContentRef.current || streamingContent))
    }, wait)
  }, [streamingContent])

  // 活跃未删除文档列表
  const activeNotesList = useMemo(() => {
    return notes.filter((n) => !n.deletedAt)
  }, [notes])

  // 当前已选中的引用笔记对象
  const selectedRefNotes = useMemo(() => {
    if (selectedRefNoteIds.length === 0) return []
    return activeNotesList.filter((n) => selectedRefNoteIds.includes(n.id))
  }, [activeNotesList, selectedRefNoteIds])

  // 引用选择弹窗中的筛选笔记列表（截取前 40 篇以保障海量笔记下的流畅渲染）
  const filteredPickerNotes = useMemo(() => {
    const kw = pickerSearch.trim().toLowerCase()
    if (!kw) return activeNotesList.slice(0, 40)
    return activeNotesList
      .filter((n) => {
        const titleMatch = (n.title || '').toLowerCase().includes(kw)
        const contentMatch = (n.content || '').toLowerCase().includes(kw)
        return titleMatch || contentMatch
      })
      .slice(0, 40)
  }, [activeNotesList, pickerSearch])

  // 引用笔记的选择与移除操作
  const handleToggleRefNote = useCallback((noteId: string) => {
    setSelectedRefNoteIds((prev) =>
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId],
    )
  }, [])

  const handleRemoveRefNote = useCallback((noteId: string) => {
    setSelectedRefNoteIds((prev) => prev.filter((id) => id !== noteId))
  }, [])

  const handleClearRefNotes = useCallback(() => {
    setSelectedRefNoteIds([])
  }, [])

  // 快速挂载/取消挂载当前正在编辑的笔记
  const handleQuickMountActiveNote = useCallback(() => {
    if (!activeNote) {
      showToast('当前知识库中暂未打开任何笔记', 'default')
      return
    }
    setSelectedRefNoteIds((prev) => {
      if (prev.includes(activeNote.id)) {
        showToast(`已取消引用《${activeNote.title}》`, 'default')
        return prev.filter((id) => id !== activeNote.id)
      } else {
        showToast(`已添加引用《${activeNote.title}》`, 'default')
        return [...prev, activeNote.id]
      }
    })
  }, [activeNote, showToast])

  // 后台与持久化存储静默同步（仅在发现差异时更新，避免无意义的二次渲染）
  useEffect(() => {
    let isMounted = true
    Promise.all([loadChatSessions(), loadActiveSessionId()]).then(([loadedSessions, savedActiveId]) => {
      if (!isMounted) return
      setSessions((prev) => {
        if (
          prev.length === loadedSessions.length &&
          prev[0]?.id === loadedSessions[0]?.id &&
          prev[0]?.updatedAt === loadedSessions[0]?.updatedAt
        ) {
          return prev
        }
        return loadedSessions
      })
      if (savedActiveId && loadedSessions.some((s) => s.id === savedActiveId)) {
        setActiveSessionId((prev) => prev || savedActiveId)
      }
    })
    return () => {
      isMounted = false
    }
  }, [])

  // 当前选中的会话实体
  const activeSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId) || sessions[0] || null
  }, [sessions, activeSessionId])

  /*
   * 并发优先级拆分（切换会话流畅度的核心）：
   *
   * 侧栏高亮 / 标题 / 输入区都是轻量 UI，必须跟着 activeSessionId 同步立即提交，
   * 点哪立刻亮哪；而整份历史消息列表是重量级渲染，改走 useDeferredValue 延后一拍、
   * 由 React 并发切片渲染，期间输入框与点击始终可响应。
   *
   * 原方案把两者一起包在 startTransition 里 —— transition 会把同一次更新里
   * 「所有消费方」整体延迟提交，结果是点击高亮也要等几百条消息渲染完才出现，
   * 正是切会话「等几百 ms 才有反应」的体感来源。
   */
  const deferredActiveSessionId = useDeferredValue(activeSessionId)
  const deferredSession = useMemo(() => {
    return sessions.find((s) => s.id === deferredActiveSessionId) || activeSession
  }, [sessions, deferredActiveSessionId, activeSession])

  // 当前会话的角色预设
  const activePreset: AiChatPreset = useMemo(() => {
    return getPresetById(activeSession?.presetId || 'general')
  }, [activeSession?.presetId])

  // 持久化更新所有会话
  const updateAndSaveSessions = useCallback((updater: (prev: AiChatSession[]) => AiChatSession[]) => {
    setSessions((prev) => {
      const next = updater(prev)
      saveChatSessions(next)
      return next
    })
  }, [])

  // 切换活跃会话。轻量 UI（侧栏高亮/标题/输入区）用普通 setState 立即提交，点击即刻反馈；
  // 重量级的消息列表经 useDeferredValue 延后渲染（见 deferredSession 处注释）。
  const handleSelectSession = useCallback(
    (id: string) => {
      if (isStreaming) {
        showToast('请先等待当前 AI 回答完毕或点击停止', 'default')
        return
      }
      // ref 侧记最新值：即使快速连点，比较的也始终是最新会话 ID
      if (id === activeSessionIdRef.current) return
      activeSessionIdRef.current = id
      setActiveSessionId(id)
      setVisibleMessageCount(MESSAGE_WINDOW_STEP)
      saveActiveSessionId(id)
    },
    [isStreaming, showToast],
  )

  // 新建会话
  const handleCreateSession = useCallback((presetId = 'general') => {
    if (isStreaming) {
      showToast('正在生成中，请稍后再新建会话', 'default')
      return
    }
    const preset = getPresetById(presetId)
    const newSession = createNewSession(presetId, `${preset.name}对话`)
    updateAndSaveSessions((prev) => [newSession, ...prev])
    activeSessionIdRef.current = newSession.id
    setActiveSessionId(newSession.id)
    setVisibleMessageCount(MESSAGE_WINDOW_STEP)
    saveActiveSessionId(newSession.id)
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
  }, [isStreaming, updateAndSaveSessions, showToast])

  // 切换当前会话的角色预设
  const handleChangePreset = useCallback((presetId: string) => {
    if (!activeSession) return
    const preset = getPresetById(presetId)
    updateAndSaveSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
            ...s,
            presetId,
            customSystemPrompt: preset.systemPrompt,
            updatedAt: Date.now(),
          }
          : s,
      ),
    )
    showToast(`已切换角色为「${preset.name}」`, 'default')
  }, [activeSession, updateAndSaveSessions, showToast])

  // 置顶 / 取消置顶会话
  const handleTogglePin = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    updateAndSaveSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, pinned: !s.pinned } : s)),
    )
  }, [updateAndSaveSessions])

  // 收藏 / 取消收藏会话
  const handleToggleStar = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    updateAndSaveSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, starred: !s.starred } : s)),
    )
  }, [updateAndSaveSessions])

  // 重命名会话
  const handleStartRename = useCallback((session: AiChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditingTitle(session.title)
  }, [])

  const handleSaveRename = useCallback((sessionId: string) => {
    const trimmed = editingTitle.trim()
    if (trimmed) {
      updateAndSaveSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: trimmed, updatedAt: Date.now() } : s)),
      )
    }
    setEditingSessionId(null)
  }, [editingTitle, updateAndSaveSessions])

  const handleCancelRename = useCallback(() => {
    setEditingSessionId(null)
  }, [])

  const handleTitleChange = useCallback((val: string) => {
    setEditingTitle(val)
  }, [])

  // 删除单场会话。读取「当前会话」走 ref 而非 state 依赖，避免击穿侧栏整排 memo；
  // 切换目标会话同样走普通 setState 立即提交（消息列表由 deferred 延后渲染）。
  const handleDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSessions((currentSessions) => {
      if (currentSessions.length <= 1) {
        const fresh = createNewSession('general', '日常全能问答')
        saveChatSessions([fresh])
        activeSessionIdRef.current = fresh.id
        setActiveSessionId(fresh.id)
        setVisibleMessageCount(MESSAGE_WINDOW_STEP)
        saveActiveSessionId(fresh.id)
        return [fresh]
      }
      const nextSessions = currentSessions.filter((s) => s.id !== sessionId)
      saveChatSessions(nextSessions)
      if (activeSessionIdRef.current === sessionId) {
        const nextActive = nextSessions[0].id
        activeSessionIdRef.current = nextActive
        setActiveSessionId(nextActive)
        setVisibleMessageCount(MESSAGE_WINDOW_STEP)
        saveActiveSessionId(nextActive)
      }
      return nextSessions
    })
  }, [])

  // 清空当前会话的消息记录
  const handleClearCurrentMessages = useCallback(() => {
    if (!activeSession || activeSession.messages.length === 0) return
    updateAndSaveSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, messages: [], updatedAt: Date.now() } : s)),
    )
    showToast('已清空当前会话的上下文记录', 'default')
  }, [activeSession, updateAndSaveSessions, showToast])

  // 滚动到底部（延迟一帧等浏览器布局完成，杜绝强制同步布局测量 Forced Synchronous Layout）
  const scrollToBottom = useCallback((_smooth = false) => {
    requestAnimationFrame(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
      }
    })
  }, [])

  // 依赖 deferredActiveSessionId：等延后的新会话消息列表真正提交后再滚到底，
  // 否则会在还挂着旧列表时提前滚动，新列表提交后位置又归零。
  useEffect(() => {
    scrollToBottom(false)
    isNearBottomRef.current = true
  }, [deferredActiveSessionId, scrollToBottom])

  // 切换单条消息的推理思考折叠
  const handleToggleThinking = useCallback((msgId: string) => {
    setExpandedThinking((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }))
  }, [])

  // 复制消息正文
  const handleCopyMessage = useCallback(
    (content: string) => {
      navigator.clipboard.writeText(content)
      showToast('已复制正文至剪贴板', 'default')
    },
    [showToast],
  )

  /*
   * 插入到当前 Markdown 笔记。
   *
   * 笔记标题走 ref 读：原来把它列在依赖里，笔记标题一变（或切文档）这个回调
   * 就换 identity，进而让整批历史消息的 memo 全部失效重渲。提示文案里的标题
   * 不需要「实时准确到字」，用最新值即可。
   */
  const activeNoteTitleRef = useRef(activeNote?.title)
  useEffect(() => {
    activeNoteTitleRef.current = activeNote?.title
  }, [activeNote?.title])

  const handleInsertToNote = useCallback(
    (content: string) => {
      if (!insertText) {
        showToast('当前没有打开可用的 Markdown 编辑器', 'error')
        return
      }
      insertText(`\n\n> **AI 会话引用**：\n\n${content}\n\n`)
      showToast(`已插入到笔记「${activeNoteTitleRef.current || '当前文档'}」`, 'default')
    },
    [insertText, showToast],
  )

  // 代理全局复制代码与插入笔记按钮
  const handleChatContainerClick = useCallback(
    (e: React.MouseEvent) => {
      const copyTarget = (e.target as HTMLElement).closest('.fe-copy-code-btn')
      if (copyTarget) {
        const code = copyTarget.getAttribute('data-code')
        if (code) {
          navigator.clipboard.writeText(decodeURIComponent(code))
          const oldText = copyTarget.textContent
          copyTarget.textContent = '已复制'
          setTimeout(() => {
            copyTarget.textContent = oldText || '复制代码'
          }, 1500)
        }
        return
      }

      const insertTarget = (e.target as HTMLElement).closest('.fe-insert-code-btn')
      if (insertTarget) {
        const code = insertTarget.getAttribute('data-code')
        if (code) {
          handleInsertToNote(`\`\`\`\n${decodeURIComponent(code)}\n\`\`\``)
        }
        return
      }
    },
    [handleInsertToNote],
  )

  // 发送消息
  const handleSendMessage = useCallback(
    async (textToSend?: string) => {
      const content = (textToSend ?? inputText).trim()
      if (!content || isStreaming) return

      if (!isConfigured) {
        showToast('请先配置 AI 渠道（Base URL 及 API Key）', 'error')
        return
      }

      if (!activeSession) return

      setInputText('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }

      // 1. 构建显式引用的文档上下文与用户消息的小药丸标签
      const contextPills: { icon?: string; label: string }[] = []
      let refContext = ''

      if (selectedRefNotes.length > 0) {
        selectedRefNotes.forEach((n, idx) => {
          contextPills.push({ label: `《${n.title || '未命名文档'}》` })
          refContext += `\n【参考引用文档 ${idx + 1}：《${n.title || '未命名文档'}》】:\n${(n.content || '').slice(0, 4000)}\n`
        })
      }

      // 发送后清空本次已选引用（避免后续提问无意识带上旧文章上下文）
      setSelectedRefNoteIds([])

      // 2. 构建 User 消息
      const userMsg: AiChatMessage = {
        id: `msg_${Date.now()}_u`,
        role: 'user',
        content,
        createdAt: Date.now(),
        contextPills: contextPills.length > 0 ? contextPills : undefined,
      }

      // 自动更新会话标题（若仍是默认标题则提取前 18 个字符）
      const isDefaultTitle =
        activeSession.title === '新对话' ||
        activeSession.title.endsWith('对话') ||
        activeSession.messages.length === 0
      const nextTitle = isDefaultTitle
        ? content.slice(0, 18).replace(/\n/g, ' ')
        : activeSession.title

      const nextMessages = [...activeSession.messages, userMsg]

      updateAndSaveSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                title: nextTitle,
                messages: nextMessages,
                updatedAt: Date.now(),
              }
            : s,
        ),
      )

      // 3. 准备流式请求
      setIsStreaming(true)
      setStreamingReasoning('')
      setStreamingContent('')
      setFirstTokenMs(null)

      const currentAssistantMsgId = `msg_${Date.now()}_a`
      setExpandedThinking((prev) => ({ ...prev, [currentAssistantMsgId]: true }))

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      let fullSystemPrompt = activeSession.customSystemPrompt || activePreset.systemPrompt
      if (refContext) {
        fullSystemPrompt += `\n\n【用户指定的知识库参考文档】：\n${refContext}\n请务必优先基于用户引用的上述文档内容进行精准分析、回答与代码生成。`
      }

      if (enableThinking) {
        fullSystemPrompt +=
          '\n\n【推理指令】：请充分利用深层逻辑思考（Reasoning），分步骤严密分析用户的问题与代码，再输出最终严谨结论。'
      }

      const requestMessages = [
        { role: 'system' as const, content: fullSystemPrompt },
        ...nextMessages.slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ]

      const startedTime = Date.now()

      try {
        const result = await chatStream({
          messages: requestMessages,
          config: aiConfig,
          temperature: activeSession.temperature ?? 0.7,
          signal: abortController.signal,
          onDelta: (_delta, full) => {
            pendingContentRef.current = full
            if (!rafPendingRef.current) {
              rafPendingRef.current = true
              requestAnimationFrame(() => {
                setStreamingContent(pendingContentRef.current)
                rafPendingRef.current = false
                if (isNearBottomRef.current && chatContainerRef.current) {
                  chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
                }
              })
            }
          },
          onReasoningDelta: (_delta, full) => {
            pendingReasoningRef.current = full
            if (!rafPendingRef.current) {
              rafPendingRef.current = true
              requestAnimationFrame(() => {
                setStreamingReasoning(pendingReasoningRef.current)
                rafPendingRef.current = false
                if (isNearBottomRef.current && chatContainerRef.current) {
                  chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
                }
              })
            }
          },
          onFirstToken: (ms) => {
            setFirstTokenMs(ms)
          },
        })

        const assistantMsg: AiChatMessage = {
          id: currentAssistantMsgId,
          role: 'assistant',
          content:
            result.text ||
            result.reasoning ||
            (result.error ? `请求失败：${result.error}` : ''),
          reasoningContent: result.reasoning || undefined,
          createdAt: Date.now(),
          model: aiConfig.model,
          elapsedMs: result.elapsedMs || Date.now() - startedTime,
          firstTokenMs: firstTokenMs || undefined,
        }

        updateAndSaveSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? {
                  ...s,
                  messages: [...s.messages, assistantMsg],
                  updatedAt: Date.now(),
                }
              : s,
          ),
        )
      } catch (err: any) {
        showToast(err?.message || '生成失败', 'error')
      } finally {
        setIsStreaming(false)
        setStreamingReasoning('')
        setStreamingContent('')
        pendingContentRef.current = ''
        pendingReasoningRef.current = ''
        rafPendingRef.current = false
        abortControllerRef.current = null
        if (isNearBottomRef.current && chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
        }
      }
    },
    [
      inputText,
      isStreaming,
      isConfigured,
      activeSession,
      selectedRefNotes,
      updateAndSaveSessions,
      activePreset.systemPrompt,
      enableThinking,
      aiConfig,
      firstTokenMs,
      showToast,
    ],
  )

  // 停止生成
  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsStreaming(false)
  }, [])

  // 重新生成最后一次回复
  const handleRegenerate = useCallback(
    (targetMsgId: string) => {
      if (isStreamingRef.current || !activeSession) return
      const msgIndex = activeSession.messages.findIndex((m) => m.id === targetMsgId)
      if (msgIndex === -1) return

      let userPrompt = ''
      for (let i = msgIndex; i >= 0; i--) {
        if (activeSession.messages[i].role === 'user') {
          userPrompt = activeSession.messages[i].content
          break
        }
      }

      if (!userPrompt) return

      const trimmedMessages = activeSession.messages.slice(0, msgIndex)
      updateAndSaveSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, messages: trimmedMessages } : s)),
      )

      handleSendMessage(userPrompt)
    },
    // isStreaming 用 ref 读，不再作为依赖：否则生成开始/结束都会重建这个回调
    [activeSession, updateAndSaveSessions, handleSendMessage],
  )

  // 删除单条消息
  const handleDeleteMessage = useCallback(
    (msgId: string) => {
      if (isStreamingRef.current || !activeSessionId) return
      updateAndSaveSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: s.messages.filter((m) => m.id !== msgId),
              }
            : s,
        ),
      )
    },
    [activeSessionId, updateAndSaveSessions],
  )

  // 导出整场会话
  const handleExportMarkdown = useCallback(() => {
    if (!activeSession) return
    const md = exportSessionAsMarkdown(activeSession)
    downloadFile(md, `${activeSession.title || '智聊'}.md`, 'text/markdown;charset=utf-8')
    showToast('已导出 Markdown 文档', 'default')
  }, [activeSession, showToast])

  const handleExportJson = useCallback(() => {
    if (!activeSession) return
    const json = exportSessionAsJson(activeSession)
    downloadFile(json, `${activeSession.title || '智聊'}.json`, 'application/json;charset=utf-8')
    showToast('已导出 JSON 结构化数据', 'default')
  }, [activeSession, showToast])

  // 快捷标签插入输入框
  const handleInsertQuickTag = useCallback((tagText: string) => {
    setInputText((prev) => (prev ? `${prev} ${tagText}` : tagText))
    textareaRef.current?.focus()
  }, [])

  // 滚动位置监听（仅当用户处于底部附近时才在打字时自动锁定底部，防止打扰用户上滑阅读）
  const handleChatScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    isNearBottomRef.current = nearBottom
  }, [])

  // 输入框自增高
  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [])

  // 键盘回车发送
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendMessage()
      }
    },
    [handleSendMessage],
  )

  // 尾部窗口之外被隐藏的更早消息条数（供顶部「加载更早」按钮展示）
  const earlierHiddenCount = deferredSession
    ? Math.max(0, deferredSession.messages.length - visibleMessageCount)
    : 0

  // 增量补载更早的历史消息。新内容全部插在滚动容器顶部，直接放开会让视口内容
  // 整体「跳走」；挂载前记下 scrollHeight，提交后的下一帧把总增量补回 scrollTop。
  const handleLoadEarlier = useCallback(() => {
    const prevHeight = chatContainerRef.current?.scrollHeight ?? 0
    setVisibleMessageCount((prev) => prev + MESSAGE_WINDOW_STEP)
    requestAnimationFrame(() => {
      const el = chatContainerRef.current
      if (el && el.scrollHeight > prevHeight) {
        el.scrollTop = el.scrollTop + (el.scrollHeight - prevHeight)
      }
    })
  }, [])

  // 性能优化：会话历史列表组件 Memo 缓存，用户在输入框打字时不触发历史消息重复 diff 重绘。
  // 渲染源用 deferredSession（延后一拍、并发切片），并只挂 MESSAGE_WINDOW_STEP 尾部窗口。
  const renderedMessages = useMemo(() => {
    if (!deferredSession) return null
    return deferredSession.messages.slice(-visibleMessageCount).map((msg) => (
      <ChatMessageItem
        key={msg.id}
        msg={msg}
        isThinkingExpanded={expandedThinking[msg.id] ?? false}
        onToggleThinking={handleToggleThinking}
        onCopy={handleCopyMessage}
        onInsertToNote={handleInsertToNote}
        onRegenerate={handleRegenerate}
        onDelete={handleDeleteMessage}
        isStreamingRef={isStreamingRef}
      />
    ))
  }, [
    deferredSession,
    visibleMessageCount,
    expandedThinking,
    handleToggleThinking,
    handleCopyMessage,
    handleInsertToNote,
    handleRegenerate,
    handleDeleteMessage,
  ])

  // 过滤后的会话列表（置顶/普通已经在这里分好，避免在渲染体里再 filter 两遍）
  const filteredSessions = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase()
    let list = sessions
    if (sidebarTab === 'starred') {
      list = list.filter((s) => s.starred)
    }
    if (kw) list = list.filter((s) => s.title.toLowerCase().includes(kw))
    return list
  }, [sessions, searchKeyword, sidebarTab])

  // 置顶会话与普通会话拆分
  const pinnedSessions = useMemo(() => {
    return filteredSessions.filter((s) => s.pinned)
  }, [filteredSessions])

  const recentSessions = useMemo(() => {
    return filteredSessions.filter((s) => !s.pinned)
  }, [filteredSessions])

  return (
    <div className="flex h-full w-full overflow-hidden bg-white select-none">
      {/* ================= 1. 左侧栏：AI 会话列表与置顶助手 (w-[268px]) ================= */}
      <section className="w-[268px] bg-zinc-50/70 border-r border-zinc-200/70 flex flex-col shrink-0">
        {/* 顶部搜索 + 新建会话按钮 */}
        <div className="p-3 flex items-center gap-2">
          <div className="flex-1 bg-zinc-200/60 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <Search size={13} className="text-zinc-400 shrink-0" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索会话..."
              className="bg-transparent outline-none w-full text-zinc-800 placeholder-zinc-400 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => handleCreateSession(activePreset.id)}
            className="bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium px-3 py-1.5 rounded-xl shadow-sm flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
          >
            <Plus size={13} />
            <span>新对话</span>
          </button>
        </div>

        {/* 分类胶囊切换 */}
        <div className="px-3 pb-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSidebarTab('all')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${sidebarTab === 'all'
              ? 'bg-zinc-900 text-white'
              : 'text-zinc-500 hover:bg-zinc-200/60'
              }`}
          >
            全部会话
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab('presets')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${sidebarTab === 'presets'
              ? 'bg-zinc-900 text-white'
              : 'text-zinc-500 hover:bg-zinc-200/60'
              }`}
          >
            预设助手 ({AI_CHAT_PRESETS.length})
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab('starred')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${sidebarTab === 'starred'
              ? 'bg-zinc-900 text-white'
              : 'text-zinc-500 hover:bg-zinc-200/60'
              }`}
          >
            收藏
          </button>
        </div>

        {/* 会话列表滚动区 */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-2.5 py-1 space-y-4">
          {sidebarTab === 'presets' ? (
            /* 预设专家助手卡片列表（纯 SVG 图标展示） */
            <div className="space-y-1.5">
              <div className="px-2 pb-1 text-[11px] font-medium text-zinc-400">
                点击切换当前角色或开启专属对话
              </div>
              {AI_CHAT_PRESETS.map((preset) => {
                const isCurrent = activePreset.id === preset.id
                return (
                  <div
                    key={preset.id}
                    onClick={() => {
                      handleChangePreset(preset.id)
                    }}
                    className={`p-2.5 rounded-2xl flex items-center gap-2.5 cursor-pointer transition-all ${isCurrent
                      ? 'bg-white border border-zinc-200/90 shadow-sm'
                      : 'hover:bg-zinc-200/40'
                      }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${isCurrent
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-200/70 text-zinc-700'
                        }`}
                    >
                      {getPresetIcon(preset.id, 'w-4 h-4')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-zinc-900 truncate">
                          {preset.name}
                        </h4>
                        <span className="text-[10px] text-zinc-400 shrink-0">
                          {preset.roleTitle.slice(0, 6)}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {preset.description}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* 会话模式：置顶工作流 + 最近会话 */
            <>
              {/* 分组 1：置顶工作流 (PINNED) */}
              {pinnedSessions.length > 0 && (
                <div>
                  <div className="px-2 pb-1.5 text-[11px] font-medium text-zinc-400 flex items-center justify-between">
                    <span>置顶工作流</span>
                    <span className="text-[10px]">PINNED</span>
                  </div>
                  <div className="space-y-1.5">
                    {pinnedSessions.map((session) => (
                      <PinnedSessionItem
                        key={session.id}
                        session={session}
                        isSelected={activeSessionId === session.id}
                        onSelect={handleSelectSession}
                        onTogglePin={handleTogglePin}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 分组 2：所有对话列表 */}
              <div>
                <div className="px-2 pb-1.5 text-[11px] font-medium text-zinc-400 flex items-center justify-between">
                  <span>最近会话</span>
                  <span className="text-[10px]">{filteredSessions.length} 条</span>
                </div>
                <div className="space-y-1">
                  {recentSessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isSelected={activeSessionId === session.id}
                      isEditing={editingSessionId === session.id}
                      editingTitle={editingTitle}
                      onSelect={handleSelectSession}
                      onTogglePin={handleTogglePin}
                      onToggleStar={handleToggleStar}
                      onStartRename={handleStartRename}
                      onSaveRename={handleSaveRename}
                      onCancelRename={handleCancelRename}
                      onDelete={handleDeleteSession}
                      onTitleChange={handleTitleChange}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 底部信息条 */}
        <div className="p-3 border-t border-zinc-200/70 flex items-center justify-between text-[11px] text-zinc-400">
          <span>共 {sessions.length} 场对话</span>
          <button
            type="button"
            onClick={handleClearCurrentMessages}
            className="hover:text-rose-600 transition-colors cursor-pointer"
          >
            清空当前会话
          </button>
        </div>
      </section>

      {/* ================= 2. 核心主区：AI 会话交互区 (flex-1 满宽) ================= */}
      <main className="flex-1 flex flex-col bg-white overflow-hidden relative min-w-0">
        {/* 会话区顶部 Header（精简大方，无多余标签） */}
        <div className="h-14 border-b border-zinc-100 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-bold text-zinc-900 truncate max-w-[280px]">
              {activeSession?.title || '未命名对话'}
            </h2>

            {/* 模型切换胶囊 */}
            <Tooltip placement="bottom" content="点击打开渠道与模型设置">
              <button
                type="button"
                onClick={() => openAppSettings('general')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/70 text-xs font-medium text-zinc-700 cursor-pointer transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-zinc-900"></span>
                <span className="truncate max-w-[160px] font-mono">
                  {aiConfig.model || '未选择模型'}
                </span>
                <ChevronDown size={12} className="text-zinc-400" />
              </button>
            </Tooltip>
          </div>

          {/* 右侧快捷操作 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="px-2.5 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs text-zinc-600 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="导出为 Markdown 文档"
            >
              <FileDown size={14} />
              <span>导出 MD</span>
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              className="px-2 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs text-zinc-600 flex items-center gap-1 transition-colors cursor-pointer"
              title="导出为 JSON 结构化数据"
            >
              <Download size={13} />
              <span>JSON</span>
            </button>

            <button
              type="button"
              onClick={handleClearCurrentMessages}
              className="p-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-500 transition-colors cursor-pointer"
              title="清空当前上下文"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {/* 渠道未配置强提示 */}
        {!isConfigured && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-amber-600 shrink-0" />
              <span>尚未配置 AI 渠道凭据，请在设置中填写 Base URL、API Key 与 Model。</span>
            </div>
            <button
              type="button"
              onClick={() => openAppSettings('general')}
              className="text-amber-800 font-semibold underline text-[11px] cursor-pointer hover:text-amber-900"
            >
              打开设置 (⌘,)
            </button>
          </div>
        )}

        {/* 消息流滚动区 */}
        <div
          ref={chatContainerRef}
          onScroll={handleChatScroll}
          onClick={handleChatContainerClick}
          className="flex-1 overflow-y-auto no-scrollbar px-6 py-6 space-y-6"
        >
          {/* 空白会话欢迎与快捷启动卡片 */}
          {(!activeSession || activeSession.messages.length === 0) && (
            <div className="max-w-2xl mx-auto py-10 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-900 mb-4 shadow-sm">
                <Sparkles size={24} />
              </div>
              <h2 className="text-lg font-bold text-zinc-900 mb-1">
                {activePreset.name} · {activePreset.roleTitle}
              </h2>
              <p className="text-xs text-zinc-500 max-w-md mb-8 leading-relaxed">
                {activePreset.description}。支持在输入框左下角随时选择引用知识库文章，结合多篇上下文精准分析。
              </p>

              {/* 4 个预设推荐提问卡片 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
                {activePreset.starterPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(prompt)}
                    className="group p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/50 hover:bg-white hover:border-zinc-900 transition-all cursor-pointer shadow-2xs flex flex-col justify-between"
                  >
                    <span className="text-xs text-zinc-900 font-medium group-hover:text-black line-clamp-2 leading-relaxed">
                      {prompt}
                    </span>
                    <div className="mt-3 flex items-center gap-1 text-[11px] text-zinc-400 group-hover:text-zinc-900">
                      <span>立即提问</span>
                      <ChevronRight
                        size={12}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 更早的历史按窗口增量补载：一次性全员挂载会把切会话的同步提交放大到几百 ms */}
          {earlierHiddenCount > 0 && (
            <div className="flex justify-center pb-1">
              <button
                type="button"
                onClick={handleLoadEarlier}
                className="px-3 py-1 rounded-full text-[11px] text-zinc-500 bg-zinc-100 hover:bg-zinc-200/70 transition-colors cursor-pointer"
              >
                加载更早消息（还有 {earlierHiddenCount} 条）
              </button>
            </div>
          )}

          {/* 会话历史列表（使用 useMemo 纯组件隔离重绘） */}
          {renderedMessages}

          {/* 正在流式打字的消息项展示 */}
          {isStreaming && (
            <div className="flex items-start gap-3.5 max-w-3xl">
              <div className="w-8 h-8 rounded-xl bg-zinc-900 text-white flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                <Bot size={15} className="text-white" />
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                {/* 实时深度思考流 */}
                {streamingReasoning && (
                  <div className="bg-zinc-50 border border-zinc-200/70 rounded-xl px-3.5 py-2 text-xs">
                    <div className="flex items-center gap-2 text-zinc-600 font-medium">
                      <BrainCircuit size={13} className="text-emerald-600 animate-pulse" />
                      <span>正在深度思考与逻辑分析中…</span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-zinc-200/60 select-text text-[11px] text-zinc-500 leading-relaxed font-mono whitespace-pre-wrap">
                      {streamingReasoning}
                    </div>
                  </div>
                )}

                {/* 实时正文流（限频解析 Markdown，保障 60fps 流畅） */}
                {streamingContent ? (
                  <div
                    className="text-[13px] text-zinc-800 leading-relaxed space-y-3 break-words prose prose-zinc max-w-none"
                    // 正文 HTML 只由上面的节流 effect 产出；这里不再兜底同步解析
                    // renderMarkdown(streamingContent)，否则每次渲染都白解析一遍整篇
                    dangerouslySetInnerHTML={{
                      __html: streamingHtml,
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                    <span className="w-2 h-2 rounded-full bg-zinc-900 animate-bounce"></span>
                    <span>正在构思回复…</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 底部悬浮的多功能输入控制台 */}
        <div className="px-6 pb-5 pt-2 bg-gradient-to-t from-white via-white to-white/80 shrink-0">
          <div className="max-w-3xl mx-auto">
            {/* 快捷调用工具栏（纯 SVG 图标，无 Emoji） */}
            <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
              <span className="text-[11px] text-zinc-400 mr-1 shrink-0">快捷挂载:</span>

              <button
                type="button"
                onClick={handleQuickMountActiveNote}
                className={`px-2.5 py-1 rounded-lg text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeNote && selectedRefNoteIds.includes(activeNote.id)
                    ? 'bg-zinc-900 text-white shadow-sm'
                    : 'bg-zinc-100 hover:bg-zinc-200/70 text-zinc-700'
                }`}
              >
                <FileText
                  size={13}
                  className={
                    activeNote && selectedRefNoteIds.includes(activeNote.id)
                      ? 'text-zinc-300 shrink-0'
                      : 'text-zinc-600 shrink-0'
                  }
                />
                <span>
                  {activeNote ? `引用当前笔记《${activeNote.title.slice(0, 10)}》` : '引用当前笔记'}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleInsertQuickTag('请帮我分析并优化以下 JSON 数据结构：\n```json\n\n```')
                }
                className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/70 text-[11px] text-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <Braces size={13} className="text-zinc-600 shrink-0" />
                <span>优化 JSON 数据</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleInsertQuickTag('请帮我排查以下网络与请求日志，给出容灾与重连方案：\n')
                }
                className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/70 text-[11px] text-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <Radio size={13} className="text-zinc-600 shrink-0" />
                <span>分析网络与请求日志</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleInsertQuickTag('请根据开发记录与讨论要点，整理成一份可落地的开发周报：\n')
                }
                className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/70 text-[11px] text-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <Sparkles size={13} className="text-zinc-600 shrink-0" />
                <span>生成开发周报</span>
              </button>
            </div>

            {/* 输入框大容器 */}
            <div className="rounded-2xl border border-zinc-300/90 bg-zinc-50/50 focus-within:bg-white focus-within:border-zinc-900 focus-within:ring-2 focus-within:ring-zinc-900/5 shadow-sm transition-all p-3">
              {/* 已选引用文章徽章行 */}
              {selectedRefNotes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pb-2 mb-2 border-b border-zinc-200/60">
                  <span className="text-[10px] text-zinc-400 font-medium shrink-0">
                    已引用文档 ({selectedRefNotes.length})：
                  </span>
                  {selectedRefNotes.map((note) => (
                    <span
                      key={note.id}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-zinc-200/70 text-[11px] text-zinc-800 font-medium max-w-[220px]"
                    >
                      <FileText size={11} className="text-zinc-600 shrink-0" />
                      <span className="truncate">{note.title || '未命名文档'}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRefNote(note.id)}
                        className="text-zinc-400 hover:text-rose-600 p-0.5 rounded cursor-pointer transition-colors"
                        title="移除此引用"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={handleClearRefNotes}
                    className="text-[10px] text-zinc-400 hover:text-rose-600 transition-colors ml-1 cursor-pointer"
                  >
                    清空
                  </button>
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder={
                  selectedRefNotes.length > 0
                    ? `输入问题，将参考已引用的 ${selectedRefNotes.length} 篇文档进行专业解答...`
                    : '输入问题，Shift+Enter 换行，可通过左下角选择引用知识库文章...'
                }
                className="w-full bg-transparent outline-none resize-none text-xs text-zinc-900 placeholder-zinc-400 leading-relaxed"
              />

              {/* 输入框底部操作条 */}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-zinc-200/60">
                <div className="flex items-center gap-1.5">
                  {/* 知识库文档引用选择器与弹窗列表 */}
                  <div className="relative" ref={refModalContainerRef}>
                    <Tooltip placement="top" content="选择引用的知识库文章">
                      <button
                        type="button"
                        onClick={() => setIsRefModalOpen((v) => !v)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                          selectedRefNoteIds.length > 0
                            ? 'bg-zinc-900 text-white shadow-sm'
                            : isRefModalOpen
                            ? 'bg-zinc-200/80 text-zinc-900'
                            : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
                        }`}
                      >
                        <Paperclip
                          size={13}
                          className={selectedRefNoteIds.length > 0 ? 'text-zinc-200' : 'text-zinc-500'}
                        />
                        <span>
                          {selectedRefNoteIds.length > 0
                            ? `已引用 (${selectedRefNoteIds.length})`
                            : '引用文档'}
                        </span>
                      </button>
                    </Tooltip>

                    {/* 可选文章弹窗列表 (Popover) */}
                    {isRefModalOpen && (
                      <div className="absolute bottom-full left-0 mb-2.5 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-zinc-200/90 flex flex-col z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        {/* 弹窗头部 */}
                        <div className="px-3.5 py-2.5 bg-zinc-50/80 border-b border-zinc-200/70 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-zinc-200/70 flex items-center justify-center text-zinc-700">
                              <FileText size={13} />
                            </div>
                            <span className="text-xs font-semibold text-zinc-800">
                              引用知识库文章
                            </span>
                            {selectedRefNoteIds.length > 0 && (
                              <span className="px-1.5 py-0.5 rounded-full bg-zinc-900 text-white text-[10px] font-medium">
                                已选 {selectedRefNoteIds.length}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsRefModalOpen(false)}
                            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/50 transition-colors cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        {/* 搜索框 */}
                        <div className="p-2.5 border-b border-zinc-200/60">
                          <div className="bg-zinc-100/80 rounded-xl px-2.5 py-1.5 flex items-center gap-2 text-xs">
                            <Search size={13} className="text-zinc-400 shrink-0" />
                            <input
                              type="text"
                              value={pickerSearch}
                              onChange={(e) => setPickerSearch(e.target.value)}
                              placeholder="搜索文章标题或关键词..."
                              className="bg-transparent outline-none w-full text-zinc-800 placeholder-zinc-400 text-xs"
                              autoFocus
                            />
                            {pickerSearch && (
                              <button
                                type="button"
                                onClick={() => setPickerSearch('')}
                                className="text-zinc-400 hover:text-zinc-700 cursor-pointer"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 当前工作区正在编辑的笔记快捷卡片 */}
                        {activeNote && !activeNote.deletedAt && !pickerSearch && (
                          <div className="px-2.5 pt-2 pb-1 border-b border-zinc-100">
                            <div className="text-[10px] text-zinc-400 font-medium px-1 mb-1">
                              当前正在编辑
                            </div>
                            <div
                              onClick={() => handleToggleRefNote(activeNote.id)}
                              className={`p-2 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                                selectedRefNoteIds.includes(activeNote.id)
                                  ? 'bg-zinc-900 text-white'
                                  : 'bg-zinc-100/70 hover:bg-zinc-200/60 text-zinc-800'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 pr-2">
                                <FileText
                                  size={13}
                                  className={
                                    selectedRefNoteIds.includes(activeNote.id)
                                      ? 'text-zinc-300'
                                      : 'text-zinc-500'
                                  }
                                />
                                <span className="text-xs font-medium truncate">
                                  {activeNote.title || '当前文档'}
                                </span>
                              </div>
                              <div className="shrink-0 flex items-center">
                                {selectedRefNoteIds.includes(activeNote.id) ? (
                                  <Check size={14} className="text-white" />
                                ) : (
                                  <span className="text-[10px] text-zinc-400">点击引用</span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 候选文章列表 */}
                        <div className="flex-1 overflow-y-auto no-scrollbar p-1.5 space-y-1 max-h-56 min-h-32">
                          {filteredPickerNotes.length === 0 ? (
                            <div className="py-8 text-center text-xs text-zinc-400">
                              未找到匹配的文章
                            </div>
                          ) : (
                            filteredPickerNotes.map((note) => {
                              const isSelected = selectedRefNoteIds.includes(note.id)
                              const dateStr = note.updatedAt
                                ? new Date(note.updatedAt).toLocaleDateString('zh-CN', {
                                    month: 'numeric',
                                    day: 'numeric',
                                  })
                                : ''
                              const preview = note.content
                                ? note.content.slice(0, 60).replace(/\s+/g, ' ')
                                : ''

                              return (
                                <div
                                  key={note.id}
                                  onClick={() => handleToggleRefNote(note.id)}
                                  className={`px-2.5 py-2 rounded-xl flex items-start gap-2.5 cursor-pointer transition-all ${
                                    isSelected
                                      ? 'bg-zinc-900 text-white shadow-sm'
                                      : 'hover:bg-zinc-100 text-zinc-800'
                                  }`}
                                >
                                  <div className="pt-0.5 shrink-0">
                                    <div
                                      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                        isSelected
                                          ? 'bg-white border-white text-zinc-900'
                                          : 'border-zinc-300 bg-white'
                                      }`}
                                    >
                                      {isSelected && <Check size={11} strokeWidth={3} />}
                                    </div>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <h5
                                        className={`text-xs font-medium truncate ${
                                          isSelected ? 'text-white' : 'text-zinc-800'
                                        }`}
                                      >
                                        {note.title || '无标题文档'}
                                      </h5>
                                      {dateStr && (
                                        <span
                                          className={`text-[10px] shrink-0 font-mono ${
                                            isSelected ? 'text-zinc-400' : 'text-zinc-400'
                                          }`}
                                        >
                                          {dateStr}
                                        </span>
                                      )}
                                    </div>
                                    {preview && (
                                      <p
                                        className={`text-[11px] truncate mt-0.5 ${
                                          isSelected ? 'text-zinc-300' : 'text-zinc-400'
                                        }`}
                                      >
                                        {preview}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>

                        {/* 弹窗底部操作条 */}
                        <div className="p-2.5 bg-zinc-50 border-t border-zinc-200/70 flex items-center justify-between text-xs">
                          <button
                            type="button"
                            onClick={handleClearRefNotes}
                            disabled={selectedRefNoteIds.length === 0}
                            className="text-[11px] text-zinc-500 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-zinc-500 cursor-pointer transition-colors"
                          >
                            清空全部
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsRefModalOpen(false)}
                            className="px-3 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium transition-colors cursor-pointer"
                          >
                            确定 ({selectedRefNoteIds.length})
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setEnableThinking(!enableThinking)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${enableThinking
                      ? 'bg-zinc-900 text-white'
                      : 'text-zinc-600 hover:bg-zinc-200/60'
                      }`}
                  >
                    <BrainCircuit size={13} />
                    <span>深度思考</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEnableWebSearch(!enableWebSearch)
                      showToast(
                        enableWebSearch ? '已关闭联网搜索' : '已开启联网增强模式',
                        'default',
                      )
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${enableWebSearch
                      ? 'bg-zinc-900 text-white'
                      : 'text-zinc-600 hover:bg-zinc-200/60'
                      }`}
                  >
                    <Globe size={13} />
                    <span>联网检索</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-400 hidden sm:inline">
                    Enter 发送 · Shift+Enter 换行
                  </span>

                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={handleStopGeneration}
                      className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                    >
                      <Square size={12} className="fill-white" />
                      <span>停止</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSendMessage()}
                      disabled={!inputText.trim()}
                      className={`bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 shadow-sm transition-all cursor-pointer ${!inputText.trim() ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                    >
                      <span>发送</span>
                      <Send size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
