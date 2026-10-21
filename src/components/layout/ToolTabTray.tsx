import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Eraser, Trash2 } from 'lucide-react'
import { allModules } from '../../types'
import ToolIcon from '../ui/ToolIcon'
import Tooltip from '../ui/Tooltip'
import { closeToolTab, keepToolTabs, useToolTabs } from '../../utils/toolTabs'

/** 托盘默认显示的个数，超出的收进「+N」下拉；下拉里每行也是 8 个 */
const VISIBLE_COUNT = 8
const ROW_SIZE = 8
/** 长按多久算「删除」 */
const LONG_PRESS_MS = 600
/** 一键清空后回到的标签，与 DashboardLayout 的默认工具保持一致 */
const DEFAULT_TAB_ID = 'markdown-notes'
const CLEAR_BUTTON_BASE =
  'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40'
const CLEAR_OTHERS_CLASS = `${CLEAR_BUTTON_BASE} text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10`
const KEEP_NOTES_CLASS = `${CLEAR_BUTTON_BASE} text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10`

interface ToolTabTrayProps {
  activeId: string
  onSelect: (id: string) => void
}

function nameOf(id: string) {
  return allModules.find((item) => item.id === id)?.name ?? id
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

interface TabIconProps {
  id: string
  active: boolean
  busy: boolean
  pressing: boolean
  onSelect: () => void
  onPressStart: () => void
  onPressEnd: () => void
}

function TabIcon({ id, active, busy, pressing, onSelect, onPressStart, onPressEnd }: TabIconProps) {
  const name = nameOf(id)
  return (
    <Tooltip content={busy ? `${name} · 工作中` : name} placement="bottom">
      <button
        type="button"
        onClick={onSelect}
        onPointerDown={onPressStart}
        onPointerUp={onPressEnd}
        onPointerLeave={onPressEnd}
        onPointerCancel={onPressEnd}
        onContextMenu={(event) => event.preventDefault()}
        className={`relative flex h-6 w-7 shrink-0 select-none items-center justify-center rounded-full transition-colors ${
          active
            ? 'bg-white text-brand-600 shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-dark-panel dark:text-brand-400'
            : 'text-slate-400 hover:bg-white/70 hover:text-slate-700 dark:hover:bg-dark-panel/60 dark:hover:text-slate-200'
        }`}
      >
        <ToolIcon toolId={id} className="h-3.5 w-3.5" />
        {busy && (
          <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-slate-100 dark:ring-dark-hover" />
        )}
        {pressing && (
          <span
            className="pointer-events-none absolute inset-x-1.5 bottom-0 h-[2px] origin-left rounded-full bg-rose-500"
            style={{ animation: `tool-tab-press ${LONG_PRESS_MS}ms linear forwards` }}
          />
        )}
      </button>
    </Tooltip>
  )
}

/**
 * 顶栏的工具标签托盘。
 *
 * - 默认显示 8 个图标，超出部分收进「+N」下拉，下拉里按每行 8 个分多行排列
 * - 工作中的工具右下角带绿点
 * - 长按图标 600ms 直接关闭该标签（进度条满了即生效）
 */
export default function ToolTabTray({ activeId, onSelect }: ToolTabTrayProps) {
  const { tabs: rawTabs, busy } = useToolTabs()
  const tabs = useMemo(
    () => rawTabs.filter((id) => allModules.some((item) => item.id === id)),
    [rawTabs],
  )

  const [moreOpen, setMoreOpen] = useState(false)
  const [pressingId, setPressingId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pressTimerRef = useRef<number | null>(null)
  /** 长按已经触发过，紧跟着的那次 click 要吞掉，不然会顺手切换工具 */
  const firedRef = useRef(false)

  // 超出显示数量时也要保证当前工具可见：挤掉最后一个，把它换进来
  const visible = useMemo(() => {
    const head = tabs.slice(0, VISIBLE_COUNT)
    if (head.length > 0 && tabs.includes(activeId) && !head.includes(activeId)) {
      head[head.length - 1] = activeId
    }
    return head
  }, [tabs, activeId])
  // 下拉只放胶囊里没显示的标签，避免和胶囊里的图标重复
  const hiddenTabs = useMemo(() => tabs.filter((id) => !visible.includes(id)), [tabs, visible])
  const hiddenCount = hiddenTabs.length

  const cancelPress = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    setPressingId(null)
  }

  useEffect(() => cancelPress, [])

  const removeTab = (id: string) => {
    const idx = tabs.indexOf(id)
    if (id === activeId) {
      // 关的是当前工具：先切到相邻的标签
      const next = tabs[idx + 1] ?? tabs[idx - 1]
      if (next) onSelect(next)
    }
    closeToolTab(id)
  }

  const startPress = (id: string) => {
    // 只剩一个标签时不允许删，免得托盘空掉
    if (tabs.length <= 1) return
    firedRef.current = false
    setPressingId(id)
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null
      firedRef.current = true
      setPressingId(null)
      removeTab(id)
    }, LONG_PRESS_MS)
  }

  const handleClick = (id: string) => {
    if (firedRef.current) {
      firedRef.current = false
      return
    }
    onSelect(id)
  }

  // 下拉：点外面或按 Esc 关闭
  useEffect(() => {
    if (!moreOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMoreOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  if (tabs.length === 0) return null

  const renderIcon = (id: string) => (
    <TabIcon
      key={id}
      id={id}
      active={id === activeId}
      busy={busy.has(id)}
      pressing={pressingId === id}
      onSelect={() => handleClick(id)}
      onPressStart={() => startPress(id)}
      onPressEnd={cancelPress}
    />
  )

  return (
    <div ref={rootRef} className="no-drag relative hidden md:flex items-center">
      <div className="flex h-8 items-center gap-0.5 rounded-full border border-slate-200/60 bg-slate-100/80 px-1 dark:border-dark-border dark:bg-dark-hover/60">
        {visible.map(renderIcon)}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            className="flex h-6 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-dark-panel/60 dark:hover:text-slate-200"
          >
            +{hiddenCount}
            <ChevronDown size={10} />
          </button>
        )}
      </div>

      {moreOpen && (
        <div className="absolute right-0 top-full z-[55] mt-2 rounded-xl border border-slate-200/80 bg-white p-2 shadow-xl dark:border-dark-border dark:bg-dark-panel">
          <div className="mb-1.5 flex items-center justify-between gap-6 px-1">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              更多标签 · {hiddenCount}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={tabs.length <= VISIBLE_COUNT}
                title="只保留托盘上显示的 8 个标签，其余全部关闭"
                onClick={() => {
                  // 只留托盘上显示的这 8 个（当前工具一定在其中），其余全部去掉
                  keepToolTabs(visible)
                  setMoreOpen(false)
                }}
                className={CLEAR_OTHERS_CLASS}
              >
                <Eraser size={11} />
                保留前8个
              </button>
              <button
                type="button"
                disabled={tabs.length === 1 && tabs[0] === DEFAULT_TAB_ID}
                title="只保留「Markdown 笔记」标签，其余全部关闭，并切换到笔记页"
                onClick={() => {
                  // 全部关掉后回到默认的笔记页，它本身就是个标签，不会留下空托盘
                  onSelect(DEFAULT_TAB_ID)
                  keepToolTabs([DEFAULT_TAB_ID])
                  setMoreOpen(false)
                }}
                className={KEEP_NOTES_CLASS}
              >
                <Trash2 size={11} />
                只留笔记
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {chunk(hiddenTabs, ROW_SIZE).map((row, index) => (
              <div key={index} className="flex gap-1">
                {row.map((id) => (
                  <div key={id} onClick={() => setMoreOpen(false)}>
                    {renderIcon(id)}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-2 px-1 text-[10px] text-slate-400 dark:text-slate-500">
            长按图标可关闭标签
          </p>
        </div>
      )}
    </div>
  )
}
