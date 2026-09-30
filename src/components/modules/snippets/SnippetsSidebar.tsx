import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Star, Tags } from 'lucide-react'
import { META, ToolEmpty, pillClass } from '../../ui'
import { useSnippets, filterSnippets, type Snippet } from './useSnippets'
import SnippetListContextMenu from './SnippetListContextMenu'

/**
 * 代码片段模块的二级侧边栏。
 *
 * 和 Markdown 笔记模块一个待遇：左侧留一块常驻的导航，能搜、能按标签筛、
 * 能一眼看到哪些是收藏的，选中的那条在主区展开。片段往往有几十条，
 * 没有这层列表就只能靠主区里的搜索框反复查。
 */
export default function SnippetsSidebar({
  onAfterSelect,
}: {
  /** 移动端抽屉里选中后要关掉抽屉 */
  onAfterSelect?: () => void
}) {
  const { snippets, loaded, allTags } = useSnippets()
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState('全部')

  const filtered = useMemo(
    () => filterSnippets(snippets, keyword, activeTag),
    [snippets, keyword, activeTag],
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2.5 border-b border-slate-100 dark:border-dark-border space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            片段库
          </span>
          <span className="text-[10px] text-slate-400">{filtered.length} / {snippets.length}</span>
        </div>

        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜标题、正文或标签…"
            className="w-full pl-8 pr-7 h-7 text-xs bg-slate-50 dark:bg-dark-sidebar border border-slate-200 dark:border-dark-border rounded-lg outline-none focus:border-brand-500 transition-colors text-slate-800 dark:text-slate-200 placeholder-slate-400"
          />
          {keyword && (
            <button
              onClick={() => setKeyword('')}
              className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
              title="清空"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-0.5">
          {allTags.map((tag) => (
            <button key={tag} onClick={() => setActiveTag(tag)} className={pillClass(activeTag === tag)}>
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {!loaded ? (
          <p className={`${META} px-2 py-4`}>正在载入…</p>
        ) : !filtered.length ? (
          <ToolEmpty
            icon={Tags}
            title={snippets.length ? '没有匹配的片段' : '还没有片段'}
            hint={
              snippets.length
                ? '换个关键词，或切到「全部」标签'
                : '点右上角「新建片段」收藏第一条命令'
            }
          />
        ) : (
          filtered.map((item) => (
            <SnippetListRow
              key={item.id}
              item={item}
              onAfterSelect={onAfterSelect}
            />
          ))
        )}
      </div>

      <div className="p-2 border-t border-slate-100 dark:border-dark-border shrink-0">
        <button
          onClick={() => {
            // 侧栏只负责「点名要新建」，真正的编辑面板归主区管
            window.dispatchEvent(new CustomEvent('snippets:new'))
          }}
          className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          <Plus size={14} />
          <span>新建片段</span>
        </button>
      </div>
    </div>
  )
}

/**
 * 列表里的一行。
 *
 * 侧栏与主区共享「当前选中项」的方式是 URL 无关的一条自定义事件 ——
 * 选中动作会广播出去，主区的 SnippetsTool 监听后切到对应片段。
 */
function SnippetListRow({
  item,
  onAfterSelect,
}: {
  item: Snippet
  onAfterSelect?: () => void
}) {
  const { toggleStar } = useSnippets()
  const [starred, setStarred] = useState(Boolean(item.starred))
  const selectedId = useSelectedSnippetId()
  const isActive = selectedId === item.id

  return (
    <SnippetListContextMenu
      item={item}
      onStar={() => {
        setStarred((prev) => !prev)
        void toggleStar(item.id)
      }}
    >
      <div
        onClick={() => {
          window.dispatchEvent(new CustomEvent('snippets:select', { detail: item.id }))
          onAfterSelect?.()
        }}
        className={`group p-2.5 rounded-xl border cursor-pointer transition-colors ${
          isActive
            ? 'bg-brand-50/70 dark:bg-brand-500/10 border-brand-100 dark:border-brand-500/20'
            : 'border-transparent hover:bg-slate-50 dark:hover:bg-dark-hover/60'
        }`}
      >
        <div className="flex items-start gap-1.5">
          {item.starred && (
            <Star size={12} className="text-amber-500 fill-amber-500 shrink-0 mt-0.5" />
          )}
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 line-clamp-2 min-w-0 flex-1">
            {item.title || '未命名片段'}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setStarred((prev) => !prev)
              void toggleStar(item.id)
            }}
            title={starred ? '取消收藏' : '收藏置顶'}
            className={`shrink-0 transition-opacity ${
              starred ? 'text-amber-500' : 'text-slate-300 opacity-0 group-hover:opacity-100'
            }`}
          >
            <Star size={12} className={starred ? 'fill-current' : ''} />
          </button>
        </div>
        <p className={`${META} font-mono mt-1 truncate`}>{item.code.split('\n')[0]}</p>
        {item.tags.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 rounded bg-slate-100 dark:bg-dark-hover text-slate-500 dark:text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </SnippetListContextMenu>
  )
}

/**
 * 当前选中的片段 id。
 *
 * 侧边栏与主区是两棵互不相识的组件树（侧栏挂在 DashboardLayout 下，
 * 主区在 ToolPage 里），选中状态没法靠 props 传。这里用一个模块级的
 * 值 + 订阅 —— 和 useSnippets 里那套是同样的思路，规模上够用，
 * 不值得为它再引一层 context。
 */
let selectedId: string | null = null
const selectionListeners = new Set<(id: string | null) => void>()

export function setSelectedSnippetId(id: string | null) {
  selectedId = id
  selectionListeners.forEach((listener) => listener(id))
}

export function getSelectedSnippetId(): string | null {
  return selectedId
}

export function subscribeSelectedSnippet(listener: (id: string | null) => void): () => void {
  selectionListeners.add(listener)
  return () => {
    selectionListeners.delete(listener)
  }
}

function useSelectedSnippetId(): string | null {
  const [value, setValue] = useState(selectedId)
  useEffect(() => subscribeSelectedSnippet(setValue), [])
  return value
}
