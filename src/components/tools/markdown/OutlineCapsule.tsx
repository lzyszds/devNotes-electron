import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  ArrowUpToLine,
  Bookmark,
  Download,
  ListTree,
  Maximize2,
  Minimize2,
  Presentation,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import Tooltip from '../../ui/Tooltip'
import type { OutlineItem } from '../../../utils/milkdownOutline'
import type { ReadingBookmark } from '../../../utils/notesStore'
import { useIsMobile } from '../../../hooks/useIsMobile'

export type OutlineCapsuleProps = {
  items: OutlineItem[]
  /** 当前阅读到的条目下标，-1 表示还没进入正文 */
  activeIndex: number
  /** 已读百分比，0 ~ 100 */
  readPercent: number
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onPick: (index: number) => void
  onScrollTop: () => void
  /** 这篇笔记记下的书签，最近记的在前 */
  bookmarks?: ReadingBookmark[]
  /** 跳回某条书签 */
  onJumpBookmark?: (bookmark: ReadingBookmark) => void
  /** 删除某条书签 */
  onDeleteBookmark?: (bookmark: ReadingBookmark) => void
  /** 判断某条书签是否还认得回正文（认不回则置灰并标注失效） */
  isBookmarkStale?: (bookmark: ReadingBookmark) => boolean
  /** 右侧功能按钮：搜索 */
  searchOpen?: boolean
  onToggleSearch?: () => void
  /** 右侧功能按钮：全屏 */
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  /** 右侧功能按钮：预览 */
  preview?: boolean
  onTogglePreview?: () => void
  /** 右侧功能按钮：导出 */
  onExport?: () => void
}

/** 折叠态每条骨架占的高度（含间距），用来把胶囊高度撑到刚好装下 */
const SLOT_HEIGHT = 16
const CAPSULE_MIN = 64
const CAPSULE_MAX = 300

/**
 * 右侧悬浮大纲（折叠时是一条骨架胶囊，展开后是 265×480 的卡片）。
 *
 * 与旧版 EditorOutline 的区别：旧版是盖在正文右上角的浮层，打开就挡住内容；
 * 这条常态收成 30px 宽的细胶囊贴在右边缘，只有真正要看目录时才展开，
 * 并且折叠态本身就能显示「读到第几节」+ 一键跳转。
 *
 * 数据全部由宿主（MilkdownMarkdownEditor）喂进来 —— 滚动同步、阅读进度都需要
 * 编辑器的滚动容器，放在这里拿不到。
 */
export default function OutlineCapsule({
  items,
  activeIndex,
  readPercent,
  expanded,
  onExpandedChange,
  onPick,
  onScrollTop,
  bookmarks,
  onJumpBookmark,
  onDeleteBookmark,
  isBookmarkStale,
  searchOpen,
  onToggleSearch,
  fullscreen,
  onToggleFullscreen,
  preview,
  onTogglePreview,
  onExport,
}: OutlineCapsuleProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  // 移动端换成底部 sheet：右侧浮层在手机上既挤又挡正文
  const isMobile = useIsMobile()

  // 展开态点空白处收起。折叠态不监听 —— 那时点正文是正常编辑行为
  useEffect(() => {
    if (!expanded) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) onExpandedChange(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [expanded, onExpandedChange])

  // 果冻滑块：跟着当前条目跑。要等 DOM 量出 offsetTop/offsetHeight 才准，所以用 layout effect
  useLayoutEffect(() => {
    const pill = pillRef.current
    const list = listRef.current
    if (!pill || !list || !expanded) return

    if (activeIndex < 0) {
      pill.style.opacity = '0'
      return
    }
    const target = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    if (!target) {
      pill.style.opacity = '0'
      return
    }
    pill.style.opacity = '1'
    pill.style.top = `${target.offsetTop}px`
    pill.style.height = `${target.offsetHeight}px`
  }, [activeIndex, expanded, items])

  /*
   * 哪些大纲条目上挂着书签，用标题文本对齐。
   *
   * 不用下标对齐：书签存的是标题文本，而下标会随「前面插了/删了标题」整体错位。
   * 文本撞名（同一篇里两个「注意事项」）时两条都会打上标记 —— 那也比不打标记好，
   * 反正点的是书签列表里的那条，标记只是个提示。
   *
   * 必须放在下面那些提前 return **之前**：无标题的笔记会走 `return null`，
   * 若 hook 在它后面，切换「有标题/没标题」的笔记时 hook 数量就对不上了
   * （React 报 "Rendered more hooks than during the previous render"）。
   */
  const bookmarkedHeadings = useMemo(() => {
    const set = new Set<string>()
    bookmarks?.forEach((bookmark) => set.add(bookmark.heading.trim()))
    return set
  }, [bookmarks])

  const hasOutline = items.length > 0

  /*
   * 胶囊高度按条目数撑开，并夹在上下限之间。
   * 标题特别多时不能只是把高度顶到上限就完事 —— 那样超出的骨架条会被 overflow 裁掉，
   * 「读到第几节」就看不全了。所以超出上限时改为压缩每条的行高，保证每一条都露出来。
   */
  const perItem = Math.max(
    6,
    Math.min(SLOT_HEIGHT, Math.floor((CAPSULE_MAX - 18) / Math.max(items.length, 1)))
  )
  const capsuleHeight = Math.min(
    Math.max(items.length * perItem + 18, CAPSULE_MIN),
    CAPSULE_MAX
  )
  // 一级/二级标题的流水号（01、02…），更深层的条目显示圆点
  const topLevelSeen = items.reduce<number[]>((acc, item) => {
    const prev = acc[acc.length - 1] ?? 0
    acc.push(item.level <= 2 ? prev + 1 : prev)
    return acc
  }, [])

  // 移动端：底部 sheet，由顶栏的「大纲」按钮驱动
  if (isMobile) {
    return (
      <>
        {expanded && (
          <div
            onClick={() => onExpandedChange(false)}
            className="absolute inset-0 z-40 bg-slate-900/50"
          />
        )}

        <div
          className={`absolute inset-x-0 bottom-0 z-50 flex max-h-[75%] flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] dark:border-dark-border dark:bg-dark-panel ${
            expanded ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="mx-auto my-2.5 h-1 w-10 flex-shrink-0 rounded-full bg-slate-300 dark:bg-dark-hover" />

          <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-5 pb-3 dark:border-dark-border">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              本文目录大纲
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500 dark:bg-dark-hover dark:text-slate-400">
                {items.length} 节
              </span>
            </h3>
            <button
              type="button"
              onClick={() => onExpandedChange(false)}
              className="text-xs text-slate-400 active:text-slate-600 dark:active:text-slate-200"
            >
              完成
            </button>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
            {items.map((item, index) => {
              const active = index === activeIndex
              const isTop = item.level <= 2
              return (
                <button
                  key={`${item.pos}-${item.level}`}
                  type="button"
                  onClick={() => onPick(index)}
                  className={`flex w-full items-center gap-2 rounded-lg p-2.5 text-left text-xs transition-colors ${
                    active
                      ? 'bg-brand-500/10 font-semibold text-brand-600 dark:text-brand-400'
                      : 'text-slate-700 active:bg-slate-100 dark:text-slate-300 dark:active:bg-dark-hover'
                  }`}
                >
                  {isTop ? (
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold tabular-nums ${
                        active
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-400 dark:bg-dark-hover dark:text-slate-500'
                      }`}
                    >
                      {topLevelSeen[index] ? String(topLevelSeen[index]).padStart(2, '0') : ''}
                    </span>
                  ) : (
                    <span className="ml-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                  )}
                  <span className="truncate text-[13px] font-medium">{item.text}</span>
                  {bookmarkedHeadings.has(item.text.trim()) && (
                    <Bookmark className="h-3 w-3 flex-shrink-0 fill-brand-500 text-brand-500" />
                  )}
                </button>
              )
            })}
          </nav>

          {/* 移动端同样列出书签。sheet 高度是自适应的，可以放心铺满 */}
          {bookmarks && bookmarks.length > 0 && (
            <div className="flex flex-shrink-0 flex-col border-t border-slate-100 dark:border-dark-border">
              <div className="flex items-center gap-1 px-5 pt-2 text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                <Bookmark className="h-2.5 w-2.5 fill-current" />
                阅读书签
              </div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto px-3 py-1.5">
                {bookmarks.map((bookmark) => {
                  const stale = isBookmarkStale?.(bookmark) ?? false
                  return (
                    <div key={bookmark.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={stale}
                        onClick={() => onJumpBookmark?.(bookmark)}
                        className="flex min-w-0 flex-1 flex-col items-start gap-px rounded-lg p-2 text-left active:bg-slate-100 dark:active:bg-dark-hover"
                      >
                        <span
                          className={`w-full truncate text-[13px] font-medium ${
                            stale
                              ? 'text-slate-400 line-through dark:text-slate-500'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {bookmark.heading}
                          {bookmark.percent > 0 && (
                            <span className="ml-1 font-normal tabular-nums text-slate-400">
                              {bookmark.percent}%
                            </span>
                          )}
                        </span>
                        {bookmark.note && (
                          <span className="w-full truncate text-[11px] text-slate-400 dark:text-slate-500">
                            {bookmark.note}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="删除书签"
                        onClick={() => onDeleteBookmark?.(bookmark)}
                        className="flex-shrink-0 rounded p-1.5 text-slate-300 active:text-rose-500 dark:text-slate-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-100 px-5 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-[11px] text-slate-400 dark:border-dark-border dark:text-slate-500">
            <span>已读 {readPercent}%</span>
            <button
              type="button"
              onClick={onScrollTop}
              className="flex items-center gap-1 active:text-brand-600 dark:active:text-brand-400"
            >
              <ArrowUpToLine className="h-3 w-3" />
              置顶
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-y-0 right-4 z-20 flex flex-col items-end justify-center gap-2 py-3 select-none"
    >
      {/* ---------------------------------------------------------------- 胶囊本体 (有大纲或展开时显示) */}
      {(hasOutline || expanded) && (
        <div
          role={expanded ? undefined : 'button'}
          title={expanded ? undefined : '点击展开大纲'}
          onClick={() => {
            if (!expanded) onExpandedChange(true)
          }}
          style={{ height: expanded ? undefined : capsuleHeight }}
          className={`relative overflow-hidden border border-black/[0.08] bg-white/95 backdrop-blur-xl transition-[width,height,box-shadow,border-color,border-radius] duration-300 ease-[cubic-bezier(0.34,1.25,0.64,1)] ${
            expanded
              ? 'h-[340px] max-h-full w-[212px] rounded-[16px] shadow-2xl ring-1 ring-black/[0.06]'
              : 'w-[30px] cursor-pointer rounded-[15px] shadow-sm hover:shadow-md'
          }`}
        >
          {/* ------------------------------------------------ 折叠态：骨架细线 */}
          {!expanded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center py-1.5">
              {items.map((item, index) => {
                const active = index === activeIndex
                const isTop = item.level <= 2
                // 这一节挂着书签：骨架条端头点一颗小圆点，不展开也能看出「这儿记过」
                const marked = bookmarkedHeadings.has(item.text.trim())
                return (
                  <Tooltip
                    key={`${item.pos}-${item.level}`}
                    content={marked ? `${item.text}（有书签）` : item.text}
                    // 侧向弹出：胶囊只有 30px 宽，浮在上方会盖住相邻的骨架条
                    placement="right"
                  >
                    <div
                      onClick={(event) => {
                        event.stopPropagation()
                        onPick(index)
                      }}
                      style={{ height: perItem }}
                      className="group relative flex w-full cursor-pointer items-center justify-center"
                    >
                      <span
                        className={`rounded-full transition-all duration-200 ease-[cubic-bezier(0.34,1.25,0.64,1)] ${
                          active
                            ? 'h-[3px] w-5 bg-[#1C1C1C] shadow-sm'
                            : isTop
                              ? 'h-[2px] w-3.5 bg-black/20 group-hover:w-4 group-hover:bg-black/40'
                              : 'h-[2px] w-2 bg-black/15 group-hover:w-3'
                        }`}
                      />
                      {marked && (
                        <span className="pointer-events-none absolute left-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-amber-500" />
                      )}
                    </div>
                  </Tooltip>
                )
              })}
            </div>
          )}

          {/* ------------------------------------------------ 展开态：目录卡片 */}
          {expanded && (
            <div className="relative flex h-full w-full flex-col p-3 pb-2.5 pt-3.5">
              {/* 顶部能量条 */}
              <div className="absolute left-3 right-3 top-0 h-[2.5px] overflow-hidden rounded-full bg-black/[0.05]">
                <div
                  className="h-full rounded-full bg-[#1C1C1C] transition-[width] duration-150"
                  style={{ width: `${readPercent}%` }}
                />
              </div>

              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#191918]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1C1C1C]" />
                  目录脉络
                </div>
                <Tooltip content="收起大纲">
                  <button
                    type="button"
                    onClick={() => onExpandedChange(false)}
                    className="rounded p-0.5 text-[#787774] transition-colors hover:bg-black/[0.05] hover:text-[#191918] cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>

              {items.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                  <ListTree className="w-6 h-6 text-[#787774] opacity-40 mb-2" />
                  <p className="text-xs text-[#787774]">当前正文暂无标题</p>
                  <p className="text-[10px] text-[#787774]/70 mt-1">使用 # 标题自动生成脉络</p>
                </div>
              ) : (
                <nav
                  ref={listRef}
                  className="relative flex flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5 [scrollbar-gutter:stable]"
                >
                  <div
                    ref={pillRef}
                    className="pointer-events-none absolute left-0 right-0.5 z-0 h-[32px] rounded-lg border border-black/[0.06] bg-black/[0.04] opacity-0 shadow-sm transition-[top,height,opacity] duration-300 ease-[cubic-bezier(0.2,0.9,0.3,1.25)]"
                  />
                  {items.map((item, index) => {
                    const active = index === activeIndex
                    const isTop = item.level <= 2
                    return (
                      <div
                        key={`${item.pos}-${item.level}`}
                        data-index={index}
                        onClick={() => onPick(index)}
                        className={`relative z-10 flex cursor-pointer items-center gap-2 rounded-lg p-1.5 transition-colors duration-150 hover:bg-black/[0.035] ${
                          active
                            ? 'font-bold text-[#191918]'
                            : isTop
                              ? 'text-[#191918]'
                              : 'pl-5 text-[11.5px] text-[#787774]'
                        }`}
                      >
                        {isTop ? (
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold tabular-nums transition-all duration-150 ${
                              active
                                ? 'bg-[#1C1C1C] text-white shadow-sm'
                                : 'bg-black/[0.05] text-[#787774]'
                            }`}
                          >
                            {topLevelSeen[index] ? String(topLevelSeen[index]).padStart(2, '0') : ''}
                          </span>
                        ) : (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-black/20" />
                        )}
                        <span className="truncate text-[12px] font-medium">{item.text}</span>
                        {bookmarkedHeadings.has(item.text.trim()) && (
                          <Bookmark className="h-2.5 w-2.5 shrink-0 fill-amber-500 text-amber-500" />
                        )}
                      </div>
                    )
                  })}
                </nav>
              )}

              {/* 书签区 */}
              {bookmarks && bookmarks.length > 0 && (
                <div className="mt-1.5 flex max-h-[40%] flex-shrink-0 flex-col border-t border-black/[0.06] pt-1.5">
                  <div className="mb-1 flex items-center justify-between pr-[7px] text-[10px] font-bold uppercase tracking-wider text-[#191918]">
                    <span className="flex items-center gap-1">
                      <Bookmark className="h-2.5 w-2.5 fill-current" />
                      阅读书签
                    </span>
                    <span className="font-normal text-[#787774]">
                      {bookmarks.length}
                    </span>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5 [scrollbar-gutter:stable]">
                    {bookmarks.map((bookmark) => {
                      const stale = isBookmarkStale?.(bookmark) ?? false
                      return (
                        <div
                          key={bookmark.id}
                          className="group flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-black/[0.04]"
                        >
                          <button
                            type="button"
                            disabled={stale}
                            onClick={() => onJumpBookmark?.(bookmark)}
                            title={
                              stale
                                ? '原标题已被修改或删除，无法定位'
                                : `回到「${bookmark.heading}」${bookmark.note ? `：${bookmark.note}` : ''}`
                            }
                            className={`flex min-w-0 flex-1 flex-col items-start gap-px text-left ${
                              stale ? 'cursor-default' : ''
                            }`}
                          >
                            <span
                              className={`w-full truncate text-[11.5px] font-medium ${
                                stale
                                  ? 'text-[#787774]/50 line-through'
                                  : 'text-[#191918]'
                              }`}
                            >
                              {bookmark.heading}
                              {bookmark.percent > 0 && (
                                <span className="ml-1 font-normal tabular-nums text-[#787774]">
                                  {bookmark.percent}%
                                </span>
                              )}
                            </span>
                            {bookmark.note && (
                              <span className="w-full truncate text-[10.5px] text-[#787774]">
                                {bookmark.note}
                              </span>
                            )}
                          </button>
                          <Tooltip content="删除这条书签" placement="left">
                            <button
                              type="button"
                              aria-label="删除书签"
                              onClick={() => onDeleteBookmark?.(bookmark)}
                              className="flex-shrink-0 rounded p-0.5 text-[#787774]/40 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </Tooltip>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 右侧内边距与 nav 对齐：0.5 的自身留白 + 5px 的滚动条留槽 */}
              <div className="mt-1.5 flex items-center justify-between border-t border-black/[0.06] pt-1.5 pr-[7px] text-[10.5px] text-[#787774]">
                <span>已读 {readPercent}%</span>
                <button
                  type="button"
                  onClick={onScrollTop}
                  className="flex items-center gap-1 transition-colors hover:text-[#191918] cursor-pointer"
                >
                  <ArrowUpToLine className="h-3 w-3" />
                  置顶
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- 迷你悬浮功能操作胶囊 */}
      <div className="w-[32px] flex flex-col items-center gap-1 p-1 rounded-xl border border-black/[0.08] bg-white/95 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-md select-none">
        {/* 大纲开关 */}
        <Tooltip content={expanded ? "收起目录大纲" : "目录大纲"} placement="right">
          <button
            type="button"
            aria-label="目录大纲"
            onClick={() => onExpandedChange(!expanded)}
            className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors cursor-pointer ${
              expanded
                ? "bg-[#1C1C1C] text-white"
                : "text-[#787774] hover:bg-black/[0.05] hover:text-[#191918]"
            }`}
          >
            <ListTree className="h-3.5 w-3.5" />
          </button>
        </Tooltip>

        <span className="w-4 h-px bg-black/[0.06] my-0.5" />

        {/* 搜索替换 */}
        {onToggleSearch && (
          <Tooltip content="搜索替换 (⌘F)" placement="right">
            <button
              type="button"
              aria-label="搜索替换"
              onClick={onToggleSearch}
              className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                searchOpen
                  ? "bg-[#1C1C1C] text-white"
                  : "text-[#787774] hover:bg-black/[0.05] hover:text-[#191918]"
              }`}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}

        {/* 全屏编辑 */}
        {onToggleFullscreen && (
          <Tooltip content={fullscreen ? "退出全屏 (F11)" : "全屏沉浸 (F11)"} placement="right">
            <button
              type="button"
              aria-label="全屏"
              onClick={onToggleFullscreen}
              className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                fullscreen
                  ? "bg-[#1C1C1C] text-white"
                  : "text-[#787774] hover:bg-black/[0.05] hover:text-[#191918]"
              }`}
            >
              {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>
        )}

        {/* 预览阅读 */}
        {onTogglePreview && (
          <Tooltip content="预览阅读" placement="right">
            <button
              type="button"
              aria-label="预览阅读"
              onClick={onTogglePreview}
              className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                preview
                  ? "bg-[#1C1C1C] text-white"
                  : "text-[#787774] hover:bg-black/[0.05] hover:text-[#191918]"
              }`}
            >
              <Presentation className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}

        {/* 导出 */}
        {onExport && (
          <>
            <span className="w-4 h-px bg-black/[0.06] my-0.5" />
            <Tooltip content="导出为 Markdown" placement="right">
              <button
                type="button"
                aria-label="导出"
                onClick={onExport}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[#787774] hover:bg-black/[0.05] hover:text-[#191918] transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}
