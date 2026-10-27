import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Star, Tags, X } from 'lucide-react'
import { ToolEmpty } from '../../ui'
import { useSnippets, filterSnippets, type Snippet } from './useSnippets'
import SnippetListContextMenu from './SnippetListContextMenu'

interface SnippetsSidebarProps {
  onAfterSelect?: () => void
  onCollapse?: () => void
  isFolderTreeOpen?: boolean
  onToggleFolderTree?: () => void
}

export default function SnippetsSidebar({
  onAfterSelect,
  isFolderTreeOpen: externalFolderTreeOpen,
}: SnippetsSidebarProps) {
  const { snippets, loaded, allTags } = useSnippets()
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState('全部')

  const [internalTreeOpen] = useState(false)
  const isFolderTreeOpen =
    externalFolderTreeOpen !== undefined ? externalFolderTreeOpen : internalTreeOpen

  const filtered = useMemo(
    () => filterSnippets(snippets, keyword, activeTag),
    [snippets, keyword, activeTag],
  )

  return (
    <div className="flex flex-row h-full w-full select-none overflow-hidden">
      {/* ================= 第 2 栏：标签分类栏 (w-52 = 208px，按需展开) ================= */}
      <aside
        style={{ width: isFolderTreeOpen ? 208 : 0 }}
        className={`bg-[#F3F3F1] border-r border-[#E6E6E3] flex flex-col h-full flex-shrink-0 overflow-hidden ${isFolderTreeOpen ? 'opacity-100' : 'w-0 opacity-0 border-r-0'
          }`}
      >
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
            const count =
              tag === '全部'
                ? snippets.length
                : snippets.filter((s) => s.tags.includes(tag)).length
            const initialBadge = tag.trim().slice(0, 1) || '标'

            return (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 transition-all text-xs font-medium cursor-pointer ${isSelected
                  ? 'bg-[#EAEAE7] text-[#191918] font-bold rounded-lg shadow-2xs'
                  : 'text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7]/60 rounded-lg'
                  }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-[#1C1C1C] text-white' : 'bg-[#EAEAE7] text-[#191918]'
                      }`}
                  >
                    {initialBadge}
                  </span>
                  <span className="truncate">{tag}</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full text-[#787774]">
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ================= 第 3 栏：片段记录列表栏 (w-72 = 288px) ================= */}
      <section className="w-72 bg-[#F9F9F8] border-r border-black/[0.06] flex flex-col h-full flex-shrink-0">
        <div className="h-11 px-2.5 flex items-center gap-1.5 flex-shrink-0">
          <div className="relative flex-1 flex items-center">
            <Search className="w-3 h-3 text-[#9A9996] absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜标题、正文或标签…"
              className="w-full pl-6 pr-5 h-7 text-xs bg-black/[0.035] hover:bg-black/[0.05] focus:bg-white rounded-md outline-none text-[#191918] placeholder-[#9A9996] focus:ring-1 focus:ring-black/[0.12] transition-all border-none"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword('')}
                className="absolute right-1.5 text-[#9A9996] hover:text-[#191918]"
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
            className="h-7 px-2.5 bg-[#1C1C1C] hover:bg-neutral-800 text-white rounded-md text-xs font-medium flex items-center gap-1 flex-shrink-0 transition-colors shadow-2xs cursor-pointer"
            title="新增片段"
          >
            <Plus className="w-3 h-3" />
            <span>新增</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
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
        className={`group relative px-2.5 py-2 rounded-lg transition-all cursor-pointer ${isActive
          ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_1px_rgba(0,0,0,0.02)] ring-1 ring-black/[0.08]'
          : 'bg-transparent hover:bg-black/[0.035] text-[#191918]'
          }`}
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <span
            className={`text-xs truncate flex-1 min-w-0 ${isActive ? 'font-semibold text-[#191918]' : 'font-normal text-[#191918]'
              }`}
          >
            {item.title || '未命名片段'}
          </span>
          {starred && (
            <Star className="w-2.5 h-2.5 shrink-0 text-amber-500 fill-amber-500" />
          )}
        </div>

        <p className="font-mono text-[11px] truncate leading-relaxed text-[#787774] mt-0.5">
          {item.code.split('\n')[0] || '空代码片段'}
        </p>

        {item.tags.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-md bg-black/[0.04] text-[#787774]"
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
const listeners = new Set<(id: string | null) => void>()

export function getSelectedSnippetId(): string | null {
  return selectedId
}

export function setSelectedSnippetId(id: string | null): void {
  selectedId = id
  listeners.forEach((fn) => fn(selectedId))
  window.dispatchEvent(new CustomEvent('snippets:select', { detail: id }))
}

function useSelectedSnippetId() {
  const [id, setId] = useState<string | null>(selectedId)
  useEffect(() => {
    listeners.add(setId)
    return () => {
      listeners.delete(setId)
    }
  }, [])
  return id
}

if (typeof window !== 'undefined') {
  window.addEventListener('snippets:select', ((e: CustomEvent<string>) => {
    selectedId = e.detail
    listeners.forEach((fn) => fn(selectedId))
  }) as EventListener)
}
