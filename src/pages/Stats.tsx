import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { allModules, toolCategories } from '../types'
import { useNotes } from '../context/NotesContext'
import { useSnippets } from '../components/modules/snippets/useSnippets'
import { dayKey, readDailyLog, readLastUsed, readToolActions, readUsageTime } from '../utils/usageLog'
import ToolIcon from '../components/ui/ToolIcon'
import CountUp from '../components/ui/CountUp'
import WindowControls from '../components/layout/WindowControls'
import Tooltip from '../components/ui/Tooltip'

interface StatsProps {
  usageStats: Record<string, number>
  onBack: () => void
  /** 点排行/最近笔记直达（照常计一次使用） */
  onOpenTool?: (toolId: string) => void
}

/** 相对时刻：统计页里全是「x 天前用过」，绝对日期反而没感觉 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day === 1) return '昨天'
  if (day < 30) return `${day} 天前`
  return `${Math.floor(day / 30)} 个月前`
}

/** 字符数的人类说法：过万用「万」 */
function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return String(n)
}

/** 时长的人类说法：秒 → 分 → 小时，剥掉零头 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const min = Math.floor(seconds / 60)
  if (min < 60) return `${min} 分钟`
  const hour = Math.floor(min / 60)
  return `${hour} 小时 ${min % 60} 分`
}

/** 连续使用天数：从今天（今天没用则从昨天）往前数连续非零的天数 */
function calcStreak(dailyLog: Record<string, number>): number {
  const now = new Date()
  const offset = (dailyLog[dayKey(now)] ?? 0) > 0 ? 0 : 1
  let streak = 0
  for (let i = offset; i < 3660; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    if ((dailyLog[dayKey(d)] ?? 0) <= 0) break
    streak++
  }
  return streak
}

const TREND_DAYS = 14

/**
 * 使用统计与分析页。
 *
 * 数据全部来自本地三处：usageStats（累计计数）、usageLog（按日/最近时刻日志）、
 * NotesContext + useSnippets（知识库与片段库实况）。没有伪造的数据源，
 * 页面上出现的每个数字都能对上真实存储。
 */
export default function Stats({ usageStats, onBack, onOpenTool }: StatsProps) {
  const { notes, folders, handleSelect } = useNotes()
  const { snippets } = useSnippets()

  // 两份 localStorage 日志进页读一次就够（页面每次进入都是重挂载）
  const [dailyLog] = useState(() => readDailyLog())
  const [lastUsed] = useState(() => readLastUsed())
  const [usageTime] = useState(() => readUsageTime())
  const [toolActions] = useState(() => readToolActions())

  const totalTime = useMemo(
    () => Object.values(usageTime).reduce((sum, s) => sum + s, 0),
    [usageTime]
  )

  const model = useMemo(() => {
    const entries = allModules
      .map((mod) => ({
        mod,
        count: usageStats[mod.id] ?? 0,
        lastAt: lastUsed[mod.id] ?? 0,
      }))
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    const used = entries.filter((e) => e.count > 0)
    const total = used.reduce((sum, e) => sum + e.count, 0)
    const max = used[0]?.count ?? 0

    // 使用次数按分类归组：看「哪类工具在工作里占大头」比单看某工具有用
    const catNameById = new Map(toolCategories.map((c) => [c.id, c.name]))
    const catMap = new Map<string, number>()
    used.forEach(({ mod, count }) => {
      const name = catNameById.get(mod.category) ?? mod.category
      catMap.set(name, (catMap.get(name) ?? 0) + count)
    })
    const categories = Array.from(catMap, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
    const catMax = categories[0]?.count ?? 0

    const aliveNotes = notes.filter((n) => !n.deletedAt)
    const totalChars = aliveNotes.reduce((sum, n) => sum + n.content.length, 0)

    // 片段标签 Top N：聚合所有片段的 tags
    const tagMap = new Map<string, number>()
    snippets.forEach((s) => s.tags.forEach((t) => tagMap.set(t, (tagMap.get(t) ?? 0) + 1)))
    const topTags = Array.from(tagMap, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)

    return {
      used,
      total,
      max,
      categories,
      catMax,
      unusedCount: entries.length - used.length,
      aliveNotes,
      totalChars,
      noteCount: aliveNotes.length,
      bookmarkCount: aliveNotes.filter((n) => n.bookmarked).length,
      trashCount: notes.length - aliveNotes.length,
      snippetCount: snippets.length,
      starredSnippetCount: snippets.filter((s) => s.starred).length,
      topTags,
      tagMax: topTags[0]?.count ?? 0,
    }
  }, [usageStats, lastUsed, notes, snippets])

  // 近 14 天趋势（含今天）与今日用量、连续天数
  const trend = useMemo(() => {
    const out: { key: string; label: string; count: number; isToday: boolean }[] = []
    const now = new Date()
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = dayKey(d)
      out.push({
        key,
        // 只标「日」——14 列在窄窗口也放得下；完整日期在悬停提示里
        label: String(d.getDate()),
        count: dailyLog[key] ?? 0,
        isToday: i === 0,
      })
    }
    return out
  }, [dailyLog])
  const dayMax = Math.max(1, ...trend.map((d) => d.count))
  const todayCount = trend[trend.length - 1]?.count ?? 0
  const streak = calcStreak(dailyLog)

  // 最近更新的笔记（最多 4 条，点了直达那篇）
  const recentNotes = useMemo(
    () =>
      model.aliveNotes
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4),
    [model.aliveNotes]
  )
  const openNote = (id: string) => {
    // 先选中再切页：选中只改 context 内存态，切回去时笔记页读到的就是这一篇
    handleSelect(id)
    onOpenTool?.('markdown-notes')
  }

  // 排行与分类的横条从 0 长到目标宽度 —— 只影响条自身，不挤动别的列
  const [barsIn, setBarsIn] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setBarsIn(true), 60)
    return () => window.clearTimeout(timer)
  }, [])

  // 无边框窗口没有系统标题栏，「双击标题栏最大化」这条系统行为得自己补回来。
  // 落在交互控件上时不触发（返回按钮与红绿灯都带 no-drag）。
  const handleTopbarDoubleClick = (event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest('.no-drag')) return
    void window.electronAPI?.maximizeWindow()
  }

  const top = model.used[0]

  return (
    <div className="h-screen bg-[#F3F3F1] flex flex-col overflow-hidden text-[#191918] font-sans antialiased select-none">
      {/* ================= 标题栏：与工作台同款暖灰细条 ================= */}
      <header
        onDoubleClick={handleTopbarDoubleClick}
        className="drag-region h-11 bg-[#F3F3F1] px-3 flex items-center justify-between shrink-0"
      >
        <div className="no-drag flex items-center gap-1 min-w-0">
          <Tooltip content="返回工作台">
            <button
              type="button"
              onClick={onBack}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[#787774] hover:text-[#191918] hover:bg-black/[0.04] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <div className="h-3.5 w-px bg-black/[0.08] mx-1.5" />
          <span className="text-xs text-[#787774]">使用统计与分析</span>
          <span className="text-[10px] text-[#9A9996]">/</span>
          <span className="text-xs text-[#191918] font-medium">总览</span>
        </div>
        {/* 无边框之后系统标题栏没了，这一页原本一条窗口控制都没有，等于关不掉也最小化不了 */}
        <WindowControls className="no-drag hidden md:flex" />
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 md:p-6 flex flex-col gap-4 pb-8">
          {/* ================= 概览四卡 ================= */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-[#E6E6E3] rounded-2xl p-4">
              <p className="text-[11px] font-medium text-[#787774]">累计使用</p>
              <p className="mt-2 text-2xl font-bold leading-none text-[#191918]">
                <CountUp value={model.total} />
                <span className="text-xs font-medium text-[#787774] ml-1.5">次</span>
              </p>
              <p className="mt-2 text-[11px] text-[#9A9996]">
                覆盖 {model.used.length} / {allModules.length} 个模块
              </p>
              <p className="mt-1 text-[11px] text-[#9A9996]">
                共使用 {formatDuration(totalTime)}
              </p>
            </div>

            <div className="bg-white border border-[#E6E6E3] rounded-2xl p-4">
              <p className="text-[11px] font-medium text-[#787774]">今日活跃</p>
              <p className="mt-2 text-2xl font-bold leading-none text-[#191918]">
                <CountUp value={todayCount} />
                <span className="text-xs font-medium text-[#787774] ml-1.5">次</span>
              </p>
              <p className="mt-2 text-[11px] text-[#9A9996]">
                打开 + 操作 · 连续 {streak} 天
              </p>
            </div>

            <div className="bg-white border border-[#E6E6E3] rounded-2xl p-4">
              <p className="text-[11px] font-medium text-[#787774]">最常用</p>
              {top ? (
                <div className="mt-2 flex items-center gap-2 min-w-0">
                  <span className="w-7 h-7 rounded-lg bg-[#1C1C1C] text-white flex items-center justify-center flex-shrink-0">
                    <ToolIcon toolId={top.mod.id} className="w-3.5 h-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-[#191918] truncate leading-tight">
                      {top.mod.name}
                    </span>
                    <span className="block text-[11px] text-[#9A9996] mt-0.5">
                      {top.count} 次 · 占 {Math.round((top.count / (model.total || 1)) * 100)}%
                    </span>
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-sm font-bold text-[#9A9996]">暂无数据</p>
              )}
            </div>

            <div className="bg-white border border-[#E6E6E3] rounded-2xl p-4">
              <p className="text-[11px] font-medium text-[#787774]">本机资料</p>
              <p className="mt-2 text-2xl font-bold leading-none text-[#191918]">
                <CountUp value={model.noteCount + model.snippetCount} />
                <span className="text-xs font-medium text-[#787774] ml-1.5">条内容</span>
              </p>
              <p className="mt-2 text-[11px] text-[#9A9996]">
                {model.noteCount} 篇笔记 · {model.snippetCount} 条片段
              </p>
            </div>
          </div>

          {/* ================= 近 14 天活跃趋势 ================= */}
          <div className="bg-white border border-[#E6E6E3] rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E6E6E3] flex items-baseline justify-between">
              <h2 className="text-sm font-bold tracking-tight">近 14 天活跃</h2>
              <span className="text-[11px] text-[#9A9996]">
                {trend.reduce((sum, d) => sum + d.count, 0)} 次打开
              </span>
            </div>
            <div className="p-5">
              <div className="flex items-end gap-1.5 h-24">
                {trend.map((day) => (
                  <Tooltip
                    key={day.key}
                    content={`${day.isToday ? '今天' : day.label + ' 日'} · ${day.count} 次`}
                  >
                    <div className="flex-1 min-w-0 h-full flex flex-col justify-end items-stretch gap-1.5 cursor-default">
                      <div
                        className={`rounded-[3px] transition-[height] duration-500 ease-out ${day.isToday
                          ? "bg-[#1C1C1C]"
                          : "bg-black/[0.15] hover:bg-black/[0.25]"
                          }`}
                        style={{
                          height: barsIn
                            ? `${Math.max(day.count > 0 ? 8 : 3, (day.count / dayMax) * 100)}%`
                            : '0%',
                        }}
                      />
                      <span
                        className={`text-center text-[9px] font-mono leading-none ${day.isToday
                          ? "text-[#191918] font-bold"
                          : "text-[#9A9996]"
                          }`}
                      >
                        {day.label}
                      </span>
                    </div>
                  </Tooltip>
                ))}
              </div>
              {trend.every((d) => d.count === 0) && (
                <p className="mt-3 text-[11px] text-[#9A9996] text-center">
                  这两周还没有打开记录 —— 回工作台用几下，这里就会长出柱子
                </p>
              )}
            </div>
          </div>

          {/* ================= 排行 + 分类分布 ================= */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 bg-white border border-[#E6E6E3] rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E6E6E3] flex items-baseline justify-between">
                <h2 className="text-sm font-bold tracking-tight">模块使用排行</h2>
                <span className="text-[11px] text-[#9A9996]">
                  {model.used.length} / {allModules.length} 个模块用过
                </span>
              </div>

              {model.used.length === 0 ? (
                <p className="px-5 py-12 text-center text-xs text-[#9A9996]">
                  还没有使用记录 —— 回工作台用几次工具，这里就会有排行了
                </p>
              ) : (
                <div className="divide-y divide-black/[0.04]">
                  {model.used.map((item, index) => {
                    const share = Math.round((item.count / (model.total || 1)) * 100)
                    return (
                      <button
                        key={item.mod.id}
                        type="button"
                        onClick={() => onOpenTool?.(item.mod.id)}
                        className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-black/[0.03] transition-colors cursor-pointer group"
                      >
                        <span className="w-4 text-[11px] font-mono text-[#9A9996] flex-shrink-0 text-right">
                          {index + 1}
                        </span>
                        <span
                          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${index === 0
                            ? "bg-[#1C1C1C] text-white"
                            : "bg-black/[0.04] text-[#787774] group-hover:text-[#191918]"
                            }`}
                        >
                          <ToolIcon toolId={item.mod.id} className="w-4 h-4" />
                        </span>
                        <span className="w-32 flex-shrink-0 min-w-0">
                          <span className="block text-xs font-semibold text-[#191918] truncate">
                            {item.mod.name}
                          </span>
                          <span className="block text-[10px] text-[#9A9996] mt-0.5 truncate">
                            {[
                              item.lastAt ? relativeTime(item.lastAt) : '较早使用',
                              (toolActions[item.mod.id] ?? 0) > 0 &&
                                `${toolActions[item.mod.id]} 次操作`,
                              (usageTime[item.mod.id] ?? 0) > 0 &&
                                `用过 ${formatDuration(usageTime[item.mod.id])}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="flex-1 h-1.5 rounded-full bg-black/[0.05] overflow-hidden">
                          <span
                            className="block h-full rounded-full bg-[#1C1C1C] transition-[width] duration-500 ease-out"
                            style={{
                              width: barsIn
                                ? `${Math.max(4, (item.count / (model.max || 1)) * 100)}%`
                                : '0%',
                            }}
                          />
                        </span>
                        <span className="w-16 text-right flex-shrink-0 tabular-nums">
                          <span className="text-xs font-bold text-[#191918]">{item.count}</span>
                          <span className="text-[10px] font-mono text-[#9A9996] ml-1.5">{share}%</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="px-5 py-3 border-t border-[#E6E6E3] bg-[#F9F9F8] flex items-center justify-between gap-3">
                <p className="text-[11px] text-[#787774]">
                  {model.unusedCount > 0
                    ? `还有 ${model.unusedCount} 个模块从未打开过`
                    : '所有模块都用过了'}
                </p>
                {onOpenTool && model.used.length > 0 && (
                  <p className="text-[11px] text-[#9A9996]">点击任意一行直达该工具</p>
                )}
              </div>
            </div>

            <div className="bg-white border border-[#E6E6E3] rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E6E6E3]">
                <h2 className="text-sm font-bold tracking-tight">分类使用分布</h2>
              </div>
              {model.categories.length === 0 ? (
                <p className="px-5 py-12 text-center text-xs text-[#9A9996]">暂无数据</p>
              ) : (
                <div className="p-4 flex flex-col gap-3">
                  {model.categories.map((cat) => (
                    <div key={cat.name} className="flex items-center gap-3">
                      <span className="w-20 flex-shrink-0 text-xs text-[#191918] truncate">
                        {cat.name}
                      </span>
                      <span className="flex-1 h-1.5 rounded-full bg-black/[0.05] overflow-hidden">
                        <span
                          className="block h-full rounded-full bg-black/[0.35] transition-[width] duration-500 ease-out"
                          style={{
                            width: barsIn
                              ? `${Math.max(4, (cat.count / (model.catMax || 1)) * 100)}%`
                              : '0%',
                          }}
                        />
                      </span>
                      <span className="w-12 text-right text-[11px] font-mono text-[#787774] flex-shrink-0 tabular-nums">
                        {cat.count} 次
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="px-5 py-3 border-t border-[#E6E6E3] bg-[#F9F9F8] flex items-center gap-1.5 text-[#9A9996]">
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                <p className="text-[11px]">所有数据仅存于本机，不上传任何服务器</p>
              </div>
            </div>
          </div>

          {/* ================= 知识库 + 片段库实况 ================= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="bg-white border border-[#E6E6E3] rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E6E6E3] flex items-baseline justify-between">
                <h2 className="text-sm font-bold tracking-tight">知识库</h2>
                <span className="text-[11px] text-[#9A9996]">
                  {model.noteCount} 篇 · {folders.length} 个文件夹
                </span>
              </div>
              <div className="p-4 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-lg font-bold text-[#191918] leading-none tabular-nums">
                    {formatChars(model.totalChars)}
                  </p>
                  <p className="mt-1.5 text-[11px] text-[#787774]">累计字数</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-[#191918] leading-none tabular-nums">
                    {model.bookmarkCount}
                  </p>
                  <p className="mt-1.5 text-[11px] text-[#787774]">收藏标星</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-[#191918] leading-none tabular-nums">
                    {model.trashCount}
                  </p>
                  <p className="mt-1.5 text-[11px] text-[#787774]">回收站</p>
                </div>
              </div>
              <div className="border-t border-[#E6E6E3]">
                <div className="px-5 py-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#787774]">最近更新的笔记</span>
                  {onOpenTool && (
                    <span className="text-[10px] text-[#9A9996]">点击直达</span>
                  )}
                </div>
                {recentNotes.length === 0 ? (
                  <p className="px-5 pb-5 text-xs text-[#9A9996]">知识库还是空的</p>
                ) : (
                  <div className="pb-2">
                    {recentNotes.map((note) => (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => openNote(note.id)}
                        className="w-full px-5 py-2 flex items-center justify-between gap-3 text-left hover:bg-black/[0.03] transition-colors cursor-pointer group"
                      >
                        <span className="text-xs text-[#191918] truncate group-hover:font-semibold transition-all">
                          {note.title || '未命名笔记'}
                        </span>
                        <span className="text-[10px] font-mono text-[#9A9996] flex-shrink-0">
                          {relativeTime(note.updatedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white border border-[#E6E6E3] rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E6E6E3] flex items-baseline justify-between">
                <h2 className="text-sm font-bold tracking-tight">片段库</h2>
                <span className="text-[11px] text-[#9A9996]">
                  {model.snippetCount} 条 · {snippets.filter((s) => s.starred).length} 条收藏
                </span>
              </div>
              <div className="p-4">
                {model.topTags.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[#9A9996]">
                    还没有片段 —— 去片段库里攒几条常用命令
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {model.topTags.map((tag) => (
                      <div key={tag.name} className="flex items-center gap-3">
                        <span className="w-24 flex-shrink-0 text-xs text-[#191918] truncate">
                          {tag.name}
                        </span>
                        <span className="flex-1 h-1.5 rounded-full bg-black/[0.05] overflow-hidden">
                          <span
                            className="block h-full rounded-full bg-black/[0.35] transition-[width] duration-500 ease-out"
                            style={{
                              width: barsIn
                                ? `${Math.max(4, (tag.count / (model.tagMax || 1)) * 100)}%`
                                : '0%',
                            }}
                          />
                        </span>
                        <span className="w-10 text-right text-[11px] font-mono text-[#787774] flex-shrink-0 tabular-nums">
                          {tag.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-5 py-3 border-t border-[#E6E6E3] bg-[#F9F9F8]">
                <p className="text-[11px] text-[#787774]">
                  标签 Top {model.topTags.length || 0} · 片段按收藏与更新时间排序
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
