import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronUp, PanelLeft, RotateCcw, X } from 'lucide-react'
import ToolIcon from '../ui/ToolIcon'
import { allModules } from '../../types'
import {
  DEFAULT_RAIL_TOOL_IDS,
  RAIL_CANDIDATES,
  RAIL_MAX_ITEMS,
  getCachedRailToolIds,
  saveRailToolIds,
  subscribeRailToolIds,
} from '../../utils/sidebarLayout'

/**
 * 设置 · 左侧菜单栏：自定义那条 56px 工具 Rail 上放哪些工具。
 *
 * 分成上下两块：上面是「已显示」（可排序、可移除），下面是「可添加」。
 * 不用拖拽排序 —— 上下箭头点起来更准，也不需要在设置弹窗里再引一套
 * 拖拽依赖；工具数量是十来这个量级，点两下就调好。
 */
export default function SidebarLayoutPanel() {
  const [selected, setSelected] = useState<string[]>(() => getCachedRailToolIds())
  /** 最近一次操作的结果，用来给成功/失败一个即时反馈 */
  const [notice, setNotice] = useState('')

  // 别处改了配置（云端同步写回）也跟着刷新
  useEffect(() => subscribeRailToolIds(setSelected), [])

  const apply = async (next: string[]) => {
    const saved = await saveRailToolIds(next)
    setSelected(saved)
    setNotice('已保存，左侧菜单栏即刻生效')
    window.setTimeout(() => setNotice(''), 2200)
  }

  const isMaxed = selected.length >= RAIL_MAX_ITEMS

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= selected.length) return
    const next = [...selected]
    ;[next[index], next[target]] = [next[target], next[index]]
    void apply(next)
  }

  const remove = (id: string) => {
    // 允许清空：normalizeRailToolIds 会把空数组当「没配过」并回退到默认值，
    // 所以这里至少留一个，否则用户点掉最后一个会看到它又冒出来，像坏了
    if (selected.length <= 1) return
    void apply(selected.filter((item) => item !== id))
  }

  const meta = (id: string) => allModules.find((item) => item.id === id)
  const available = RAIL_CANDIDATES.filter((id) => !selected.includes(id))

  return (
    <div className="space-y-6">
      <section className="space-y-3.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
              <PanelLeft className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
              <span>左侧菜单栏</span>
              <span className="text-[10px] font-normal text-slate-400 lowercase">
                ({selected.length} / {RAIL_MAX_ITEMS} 项)
              </span>
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              决定那条竖排快捷栏上放哪些工具。只放常用的，其余仍可从工具中心与 ⌘K 指令面板进入
            </p>
          </div>

          <button
            type="button"
            onClick={() => void apply(DEFAULT_RAIL_TOOL_IDS)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-slate-200 dark:border-dark-border text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:border-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>恢复默认</span>
          </button>
        </div>

        {notice && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Check className="w-3 h-3" />
            {notice}
          </p>
        )}

        {/* 已显示 */}
        <div className="rounded-xl border border-slate-200 dark:border-dark-border overflow-hidden divide-y divide-slate-100 dark:divide-dark-border">
          {selected.map((id, index) => {
            const item = meta(id)
            if (!item) return null
            return (
              <div
                key={id}
                className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-dark-panel"
              >
                <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-dark-hover flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                  <ToolIcon toolId={id} className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {item.name}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">{item.description}</p>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    title="上移"
                    className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === selected.length - 1}
                    onClick={() => move(index, 1)}
                    title="下移"
                    className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={selected.length <= 1}
                    onClick={() => remove(id)}
                    title={selected.length <= 1 ? '至少保留一项' : '从菜单栏移除'}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 可添加 */}
      <section className="space-y-3">
        <div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider">
            可添加的工具
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {isMaxed
              ? `已达上限 ${RAIL_MAX_ITEMS} 项，先移除一个再加`
              : '点一下即添加到菜单栏末尾'}
          </p>
        </div>

        {!available.length ? (
          <p className="text-[11px] text-slate-400">能加的工具都已经在菜单栏上了。</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {available.map((id) => {
              const item = meta(id)
              if (!item) return null
              return (
                <button
                  key={id}
                  type="button"
                  disabled={isMaxed}
                  onClick={() => void apply([...selected, id])}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-dark-border text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:hover:bg-brand-500/5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-dark-hover flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                    <ToolIcon toolId={id} className="w-3.5 h-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {item.name}
                    </span>
                    <span className="block text-[10px] text-slate-400 truncate">
                      {item.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
