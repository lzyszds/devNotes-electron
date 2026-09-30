import { useEffect, useMemo, useState } from 'react'
import {
  Copy,
  Download,
  FileCode2,
  Pencil,
  Plus,
  Star,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  BTN,
  META,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolEmpty,
  ToolShell,
  ToolTag,
  buttonClass,
  iconButtonClass,
} from '../../ui'
import Tooltip from '../../ui/Tooltip'
import { useToast } from '../../ui/Toast'
import { copyText } from '../../../utils/clipboard'
import {
  createSnippetId,
  filterSnippets,
  PLACEHOLDER_RE,
  useSnippets,
  type Snippet,
} from './useSnippets'
import { getSelectedSnippetId, setSelectedSnippetId } from './SnippetsSidebar'

/**
 * 代码片段库（独立模块）。
 *
 * 列表与筛选归二级侧边栏（SnippetsSidebar），这一层只负责选中项的详情与编辑。
 * 两者之间靠三条自定义事件通信，见下方 SNIPPET_EVENTS —— 侧栏在
 * DashboardLayout 下、主区在 ToolPage 里，跨了两棵组件树，props 传不过去。
 */
const EVENT_SELECT = 'snippets:select'
const EVENT_EDIT = 'snippets:edit'
const EVENT_NEW = 'snippets:new'

export default function SnippetsTool() {
  const { showToast } = useToast()
  const api = window.electronAPI
  const { snippets, loaded, upsert, remove, toggleStar, importFrom } = useSnippets()

  /**
   * 当前选中项。初值取侧栏那份共享状态 —— 从别的页面切回来时，
   * 侧栏还记着上次选到哪条，主区得跟着显示同一条，而不是跳回第一条。
   */
  const [selectedId, setSelectedId] = useState<string | null>(() => getSelectedSnippetId())
  const [draft, setDraft] = useState<Snippet | null>(null)

  const selected = useMemo(
    () => snippets.find((item) => item.id === selectedId) ?? null,
    [snippets, selectedId],
  )

  // 侧栏点选 → 主区跟着换；顺便把编辑态收掉，避免编辑到一半被切走
  useEffect(() => {
    const onSelect = (e: Event) => {
      setSelectedId((e as CustomEvent<string>).detail)
      setDraft(null)
    }
    window.addEventListener(EVENT_SELECT, onSelect)
    return () => window.removeEventListener(EVENT_SELECT, onSelect)
  }, [])

  // 右键「编辑」→ 把那条拉进编辑态
  useEffect(() => {
    const onEdit = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const target = snippets.find((item) => item.id === id)
      if (target) {
        setSelectedId(id)
        setDraft({ ...target, tags: [...target.tags] })
      }
    }
    window.addEventListener(EVENT_EDIT, onEdit)
    return () => window.removeEventListener(EVENT_EDIT, onEdit)
  }, [snippets])

  // 侧栏底部「新建片段」
  useEffect(() => {
    const onNew = () => {
      setDraft({
        id: '',
        title: '',
        code: '',
        language: 'bash',
        tags: [],
        createdAt: 0,
        updatedAt: 0,
      })
    }
    window.addEventListener(EVENT_NEW, onNew)
    return () => window.removeEventListener(EVENT_NEW, onNew)
  }, [])

  // 首次载入且没有选中项时，默认落在第一条（排序后最靠上的那条）
  useEffect(() => {
    if (!loaded || selectedId) return
    const first = filterSnippets(snippets, '', '全部')[0]
    if (first) {
      setSelectedId(first.id)
      setSelectedSnippetId(first.id)
    }
  }, [loaded, selectedId, snippets])

  const select = (id: string | null) => {
    setSelectedId(id)
    setSelectedSnippetId(id)
  }

  const commitDraft = async () => {
    if (!draft) return
    const title = draft.title.trim()
    if (!title && !draft.code.trim()) {
      showToast('标题和内容至少填一个', 'error')
      return
    }
    const id = draft.id || createSnippetId()
    await upsert({ ...draft, id, title })
    setDraft(null)
    select(id)
    showToast(draft.id ? '已保存修改' : '已新增片段')
  }

  const copySnippet = async (item: Snippet) => {
    const ok = await copyText(item.code)
    if (!ok) {
      showToast('复制失败', 'error')
      return
    }
    const placeholders = item.code.match(PLACEHOLDER_RE)
    showToast(
      placeholders?.length
        ? `已复制，记得替换 ${Array.from(new Set(placeholders)).join('、')}`
        : '已复制到剪贴板',
    )
  }

  const exportAll = async () => {
    if (!api?.notesSaveFile) {
      showToast('当前环境不支持导出文件', 'error')
      return
    }
    const result = await api.notesSaveFile({
      content: JSON.stringify({ version: 1, snippets }, null, 2),
      defaultPath: `snippets-${new Date().toISOString().slice(0, 10)}.json`,
    })
    if (result) showToast(`已导出到 ${result.name}`)
  }

  const importAll = async () => {
    if (!api?.notesOpenFile) {
      showToast('当前环境不支持导入文件', 'error')
      return
    }
    const file = await api.notesOpenFile()
    if (!file) return
    try {
      const { added } = await importFrom(JSON.parse(file.content))
      showToast(`导入完成，新增 ${added} 条`)
    } catch {
      showToast('文件不是有效的片段 JSON', 'error')
    }
  }

  return (
    <ToolShell
      icon={FileCode2}
      title="代码片段库"
      subtitle="把常用的命令、配置模板收在这里，随时搜、随时复制"
      badge={<ToolBadge tone="brand">{snippets.length} 条片段</ToolBadge>}
      actions={
        <>
          <Tooltip content="从 JSON 导入">
            <button onClick={() => void importAll()} className={BTN.secondary}>
              <Upload size={14} />
              <span className="hidden sm:inline">导入</span>
            </button>
          </Tooltip>
          <Tooltip content="导出全部为 JSON">
            <button onClick={() => void exportAll()} className={BTN.secondary}>
              <Download size={14} />
              <span className="hidden sm:inline">导出</span>
            </button>
          </Tooltip>
          <button
            onClick={() =>
              setDraft({
                id: '',
                title: '',
                code: '',
                language: 'bash',
                tags: [],
                createdAt: 0,
                updatedAt: 0,
              })
            }
            className={BTN.primary}
          >
            <Plus size={14} />
            <span>新建片段</span>
          </button>
        </>
      }
      scroll={false}
    >
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {draft ? (
          <SnippetEditor
            draft={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSubmit={() => void commitDraft()}
          />
        ) : !selected ? (
          <ToolEmpty
            className="m-auto"
            icon={FileCode2}
            title={loaded ? '左侧选一条片段查看' : '正在载入…'}
            hint="片段库在左边那一栏，选中的条目会显示在这里；也可以直接新建一条"
          />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200/70 dark:border-dark-border shrink-0">
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-slate-900 dark:text-white truncate">
                  {selected.title || '未命名片段'}
                </h3>
                <p className={`${META} mt-0.5`}>
                  {selected.tags.join(' · ') || '无标签'} · 更新于{' '}
                  {new Date(selected.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Tooltip content={selected.starred ? '取消收藏' : '收藏置顶'}>
                  <button
                    onClick={() => void toggleStar(selected.id)}
                    className={iconButtonClass(selected.starred ? 'brand' : 'neutral')}
                  >
                    <Star size={15} className={selected.starred ? 'fill-current' : ''} />
                  </button>
                </Tooltip>
                <Tooltip content="编辑">
                  <button
                    onClick={() => setDraft({ ...selected, tags: [...selected.tags] })}
                    className={iconButtonClass('neutral')}
                  >
                    <Pencil size={15} />
                  </button>
                </Tooltip>
                <Tooltip content="删除">
                  <button
                    onClick={() => {
                      if (!window.confirm(`删除片段「${selected.title || '未命名'}」？此操作不可撤销。`))
                        return
                      void remove(selected.id)
                      select(null)
                      showToast('已删除')
                    }}
                    className={iconButtonClass('danger')}
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
                <button onClick={() => void copySnippet(selected)} className={BTN.primary}>
                  <Copy size={14} />
                  <span>复制代码</span>
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <pre className="font-mono text-[13px] leading-6 whitespace-pre-wrap break-words select-text text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-dark-hover/40 rounded-xl border border-slate-200/70 dark:border-dark-border px-3.5 py-3">
                {selected.code}
              </pre>
              {PLACEHOLDER_RE.test(selected.code) && (
                <p className={`${META} mt-2`}>
                  这条片段里有 <span className="font-mono">{'{{占位符}}'}</span>
                  ，复制后记得替换成实际值。
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </ToolShell>
  )
}

/* ==================== 编辑面板 ==================== */

function SnippetEditor({
  draft,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: Snippet
  onChange: (next: Snippet) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const [tagInput, setTagInput] = useState('')

  const addTag = () => {
    const value = tagInput.trim().replace(/^#/, '')
    if (!value || draft.tags.includes(value)) {
      setTagInput('')
      return
    }
    onChange({ ...draft, tags: [...draft.tags, value] })
    setTagInput('')
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ToolCard fill={false} className="m-4 flex-1 min-h-0">
        <ToolCardHeader
          title={draft.id ? '编辑片段' : '新建片段'}
          icon={Pencil}
          actions={<ToolTag tone="slate">使用 {'{{占位符}}'} 标出待替换的值</ToolTag>}
        />

        <div className="flex-1 min-h-0 flex flex-col gap-3 p-4 overflow-y-auto">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              标题
            </span>
            <input
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder="例如：Docker 全量清理"
              className="h-9 px-3 rounded-[10px] border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-[13px] outline-none focus:border-brand-400 dark:focus:border-brand-500 transition-colors text-slate-800 dark:text-slate-100"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              标签
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {draft.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-slate-100 dark:bg-dark-hover text-[11px] text-slate-600 dark:text-slate-300"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...draft, tags: draft.tags.filter((t) => t !== tag) })
                    }
                    className="text-slate-400 hover:text-rose-500"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                onBlur={addTag}
                placeholder="回车添加"
                className="h-6 w-24 px-2 rounded-md border border-slate-200 dark:border-dark-border bg-transparent text-[11px] outline-none focus:border-brand-400 text-slate-700 dark:text-slate-200"
              />
            </div>
          </div>

          <label className="flex flex-col gap-1.5 flex-1 min-h-0">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              内容
            </span>
            <textarea
              value={draft.code}
              onChange={(e) => onChange({ ...draft, code: e.target.value })}
              onKeyDown={(e) => {
                // ⌘/Ctrl + Enter 提交，长内容用鼠标点按钮太远
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  onSubmit()
                }
              }}
              spellCheck={false}
              placeholder={'docker system prune -a -f\n\n# {{端口}} 之类的位置用占位符标出来'}
              className="flex-1 min-h-[200px] w-full resize-none rounded-xl border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-dark-hover/40 px-3.5 py-3 font-mono text-[13px] leading-6 outline-none focus:border-brand-400 dark:focus:border-brand-500 transition-colors text-slate-800 dark:text-slate-100"
            />
          </label>
        </div>
      </ToolCard>

      <ToolActionBar info="按 ⌘/Ctrl + Enter 也可以直接保存">
        <button onClick={onCancel} className={buttonClass('secondary')}>
          取消
        </button>
        <button onClick={onSubmit} className={BTN.primary}>
          保存片段
        </button>
      </ToolActionBar>
    </div>
  )
}
