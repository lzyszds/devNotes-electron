import { useState } from 'react'
import { ChevronRight, Copy, History, Shuffle, Trash2, TriangleAlert } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import {
  BODY_OUTPUT,
  BODY_TEXTAREA,
  BTN,
  Segmented,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolHistoryOverlay,
  ToolNotice,
  ToolShell,
  ToolTag,
  iconButtonClass,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'

const encodeTypes = [
  { id: 'base64', name: 'Base64', icon: 'B64', encode: (s: string) => btoa(unescape(encodeURIComponent(s))), decode: (s: string) => decodeURIComponent(escape(atob(s))) },
  { id: 'url', name: 'URL', icon: 'URL', encode: encodeURIComponent, decode: decodeURIComponent },
  { id: 'unicode', name: 'Unicode', icon: '\\u', encode: (s: string) => s.split('').map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''), decode: (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) },
  {
    id: 'html',
    name: 'HTML',
    icon: '<>',
    encode: (s: string) =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)),
    decode: (s: string) =>
      s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: 'amp' | 'lt' | 'gt' | 'quot' | '#39') => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e])),
  },
]

export default function EncodeTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [activeType, setActiveType] = useState('base64')
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const { showToast } = useToast()

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('encode')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setInput(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  const currentType = encodeTypes.find((t) => t.id === activeType) ?? encodeTypes[0]

  const handleEncode = () => {
    if (!input.trim()) return
    try {
      setOutput(currentType.encode(input))
      setError('')
      saveHistory(input, `${currentType.name} 编码`)
    } catch (e) {
      setError('编码失败: ' + (e as Error).message)
    }
  }

  const handleDecode = () => {
    if (!input.trim()) return
    try {
      setOutput(currentType.decode(input))
      setError('')
      saveHistory(input, `${currentType.name} 解码`)
    } catch (e) {
      setError('解码失败: ' + (e as Error).message)
    }
  }

  const clearAll = () => {
    setInput('')
    setOutput('')
    setError('')
  }

  const copyOutput = async () => {
    if (!output) return
    const ok = await copyText(output)
    showToast(ok ? '已复制结果' : '复制失败', ok ? 'default' : 'error')
  }

  return (
    <ToolShell
      icon={Shuffle}
      title="万能编解码工作室"
      subtitle="支持 Base64、URL、Unicode 及 HTML 实体转换"
      badge={<ToolBadge tone="emerald" className="hidden sm:flex">{currentType.name} · 就绪</ToolBadge>}
      actions={
        <>
          {/* 编码方式切换 */}
          <Segmented
            value={activeType}
            onChange={(id) => {
              setActiveType(id)
              setError('')
            }}
            options={encodeTypes.map((type) => ({ value: type.id, label: type.name }))}
          />

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`tool-button-secondary h-9 ${
              showHistory
                ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'
                : ''
            }`}
          >
            <History size={15} />
            <span>历史记录</span>
          </button>
        </>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="历史文本片段"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setInput(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
        />
      }
    >
      {error && (
        <ToolNotice tone="error" icon={TriangleAlert}>
          <p className="whitespace-pre-line">{error}</p>
        </ToolNotice>
      )}

      <div className="tool-cascade flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[440px]">
        {/* ---------------- 原始内容 ---------------- */}
        <ToolCard>
          <ToolCardHeader
            title="原始内容"
            actions={
              <Tooltip content="清空输入与结果">
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={!input && !output}
                  className={iconButtonClass('danger')}
                >
                  <Trash2 size={15} />
                </button>
              </Tooltip>
            }
          />

          <div className="flex-1 min-h-0 p-4 flex flex-col">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="在这里输入需要转换的文本…"
              className={BODY_TEXTAREA}
            />
          </div>

          <ToolCardFooter>
            <span className="font-mono">{input.length} 字符</span>
          </ToolCardFooter>
        </ToolCard>

        {/* ---------------- 处理结果 ---------------- */}
        <ToolCard>
          <ToolCardHeader
            title="处理结果"
            meta={<ToolTag tone="brand">{currentType.name}</ToolTag>}
            actions={
              <Tooltip content="复制结果">
                <button
                  type="button"
                  onClick={() => void copyOutput()}
                  disabled={!output}
                  className={iconButtonClass('brand')}
                >
                  <Copy size={15} />
                </button>
              </Tooltip>
            }
          />

          <div className="flex-1 min-h-0 p-4 flex flex-col">
            <div className={BODY_OUTPUT}>
              {output || (
                <span className="text-slate-300 dark:text-slate-600 not-italic">
                  转换结果将在此呈现…
                </span>
              )}
            </div>
          </div>

          <ToolCardFooter>
            <span className="font-mono">{output.length} 字符</span>
          </ToolCardFooter>
        </ToolCard>
      </div>

      {/* 底部动作条 */}
      <ToolActionBar
        info={
          <>
            当前方式：
            <span className="font-semibold text-slate-600 dark:text-slate-300">
              {currentType.name}
            </span>
            ，编码把原文转成该格式，解码反过来
          </>
        }
      >
        <button type="button" onClick={handleDecode} disabled={!input.trim()} className={BTN.secondary}>
          解码
        </button>
        <button type="button" onClick={handleEncode} disabled={!input.trim()} className={BTN.primary}>
          <span>编码</span>
          <ChevronRight size={14} />
        </button>
      </ToolActionBar>
    </ToolShell>
  )
}
