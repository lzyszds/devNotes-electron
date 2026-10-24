import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Star, Tags, X } from 'lucide-react'
import { ToolEmpty } from '../../ui'
import { useSnippets, filterSnippets, type Snippet } from './useSnippets'
import SnippetListContextMenu from './SnippetListContextMenu'

interface SnippetsSidebarProps {
  onAfterSelect?: () => void
  onCollapse?: () => void
}

export default function SnippetsSidebar({
  onAfterSelect,
}: SnippetsSidebarProps) {
  const { snippets, loaded, allTags } = useSnippets()
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState('全部')

  const filtered = useMemo(
    () => filterSnippets(snippets, keyword, activeTag),
    [snippets, keyword, activeTag],
  )

  return (
    <div className="flex flex-row h-full w-full select-none overflow-hidden">
      {/* ================= 第 2 栏：标签分类栏 (w-52 = 208px) ================= */}
      <aside className="w-52 bg-[#F3F3F1] border-r border-[#E6E6E3] flex flex-col h-full flex-shrink-0">
        <div className="h-12 px-3 border-b border-[#E6E6E3] flex items-center justify-between flex-shrink-0">
          <span className="font-bold text-sm text-[#191918] tracking-tight">代码片段</span>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('snippets:new'))
            }}
            className="flex items-center gap-1 bg-[#1C1C1C] hover:bg-neutral-800 text-white rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors shadow-2xs"
            title="新建代码片段"
          >
            <Plus className="w-3 h-3" />
            <span>新建</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          <div className="pb-1 px-1">
            <span className="text-[10px] font-semibold text-[#787774] tracking-wider uppercase">
              标签分类
            </span>
          </div>

          {allTags.map((tag) => {
            const isSelected = activeTag === tag
            const count = tag === '全部' 
              ? snippets.length 
              : snippets.filter((s) => s.tags.includes(tag)).length
            const initialBadge = tag.trim().slice(0, 1) || '标'

            return (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 transition-all text-xs font-medium ${
                  isSelected
                    ? 'bg-[#1C1C1C] text-white rounded-full shadow-2xs'
                    : 'text-[#191918] hover:bg-[#EAEAE7] rounded-lg'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                      isSelected ? 'bg-white text-[#1C1C1C]' : 'bg-[#1C1C1C] text-white'
                    }`}
                  >
                    {initialBadge}
                  </span>
                  <span className="truncate">{tag}</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    isSelected ? 'text-[#D4D4D0]' : 'text-[#787774]'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ================= 第 3 栏：片段记录列表栏 (w-72 = 288px) ================= */}
      <section className="w-72 bg-[#F9F9F8] border-r border-[#E6E6E3] flex flex-col h-full flex-shrink-0">
        <div className="h-12 px-3 border-b border-[#E6E6E3] flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1 flex items-center">
            <Search className="w-3.5 h-3.5 text-[#787774] absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜标题、正文或标签…"
              className="w-full pl-8 pr-6 h-8 text-xs bg-white border border-[#E6E6E3] rounded-lg outline-none text-[#191918] placeholder-[#787774] focus:border-[#1C1C1C] transition-colors"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword('')}
                className="absolute right-2 text-[#787774] hover:text-[#191918]"
                title="清空"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('snippets:new'))
            }}
            className="h-8 px-2.5 bg-[#1C1C1C] hover:bg-neutral-800 text-white rounded-lg text-xs font-medium flex items-center gap-1 flex-shrink-0 transition-colors shadow-2xs cursor-pointer"
            title="新增片段"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新增</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {!loaded ? (
            <p className="text-xs text-[#787774] p-4 text-center">正在载入…</p>
          ) : !filtered.length ? (
            <div className="h-48 flex flex-col items-center justify-center text-center px-4 text-xs text-[#787774]">
              <ToolEmpty
                icon={Tags}
                title={snippets.length ? '没有匹配的片段' : '还没有片段'}
                hint={
                  snippets.length
                    ? '换个关键词，或切到「全部」标签'
                    : '点右上角「新增」收藏第一条命令'
                }
              />
            </div>
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
      </section>
    </div>
  )
}

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
  const dotColor = starred ? '#EC4899' : '#22C55E'

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
        className={`group relative p-3 rounded-xl transition-all cursor-pointer ${
          isActive
            ? 'bg-[#1C1C1C] text-white shadow-2xs'
            : 'bg-transparent hover:bg-[#F3F3F1] text-[#191918]'
        }`}
      >
        {/* 8px 状态小圆点 */}
        <span
          style={{ backgroundColor: dotColor }}
          className="absolute top-3 right-3 w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white/50"
          title="状态小圆点"
        />

        <div className="flex items-center justify-between gap-1.5 pr-4 mb-1">
          <span
            className={`text-xs font-semibold truncate ${
              isActive ? 'text-white' : 'text-[#191918]'
            }`}
          >
            {item.title || '未命名片段'}
          </span>
          {starred && (
            <Star
              className={`w-2.5 h-2.5 shrink-0 ${
                isActive ? 'text-[#D4D4D0] fill-[#D4D4D0]' : 'text-amber-500 fill-amber-500'
              }`}
            />
          )}
        </div>

        <p
          className={`font-mono text-[11px] truncate leading-relaxed ${
            isActive ? 'text-[#D4D4D0]' : 'text-[#787774]'
          }`}
        >
          {item.code.split('\n')[0] || '空代码片段'}
        </p>

        {item.tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-neutral-800 text-[#D4D4D0]' : 'bg-[#EAEAE7] text-[#787774]'
                }`}
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
