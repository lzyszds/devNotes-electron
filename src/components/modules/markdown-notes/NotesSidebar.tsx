import { useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import {
  Archive,
  ArchiveRestore,
  BookmarkPlus,
  BookmarkMinus,
  Copy,
  Download,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Inbox,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useNotes } from '../../../context/NotesContext'
import { useToast } from '../../ui/Toast'
import { useContextMenu } from '../../ui/ContextMenu'
import Tooltip from '../../ui/Tooltip'
import type { NoteItem } from '../../../utils/notesStore'

/** 侧栏时间戳：今天给时分，昨天给「昨天」，今年给月日，更早给年月日 */
function formatNoteTime(timestamp: number | string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isToday) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  if (isYesterday) return '昨天'

  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/** 列表第二行的轻量摘要：剥掉 Markdown 标记只留正文 */
function getNotePreviewSnippet(content: string): string {
  if (!content) return '暂无内容'
  const clean = content
    .replace(/^[#>-]+\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .trim()
  return clean.slice(0, 60) || '暂无内容'
}

interface NotesSidebarProps {
  /** 移动端从抽屉里选中文档后自动收起 */
  onAfterSelect?: () => void
}

/**
 * 「全部」页签在拖拽落点里的占位 id。
 * 不能直接用 null —— settleDrag 用 null 表示「没有落点」，
 * 拖到「全部」上松手要能表达出「落点就是移出未分类」这个明确意图。
 */
const ALL_TAB = '__all__'

/**
 * Markdown 知识库的二级侧边栏：文件夹横条 + 文档列表 + 回收站入口。
 *
 * 从 DashboardLayout 抽出来独立成模块 —— 那块 JSX 原本和工具库列表挤在同一个
 * 条件分支里，加上文件夹与回收站之后已经不适合继续留在布局文件里。
 */
export default function NotesSidebar({ onAfterSelect }: NotesSidebarProps) {
  const {
    notes,
    activeNote,
    filteredNotes,
    trashed,
    keyword,
    setKeyword,
    scope,
    setScope,
    folders,
    handleCreate,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleToggleBookmark,
    handleMoveToFolder,
    handleSelect,
    handleRename,
    handleDelete,
    handlePurge,
    handleRestore,
    handleEmptyTrash,
    handleExport,
    handleOpenSampleNote,
  } = useNotes()

  const { showToast } = useToast()
  const { openContextMenu } = useContextMenu()

  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [folderDraft, setFolderDraft] = useState('')
  /** 正在被拖拽的文档 id（原生 DnD 的 dataTransfer 读不到数据，只能自己记） */
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null)
  /** 当前鼠标悬停在哪个文件夹上 —— 高亮它，并在松手时作为落点 */
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingNoteId) renameInputRef.current?.focus()
  }, [renamingNoteId])

  // 切走范围时把编辑态收干净，免得回来时还挂着一个输入框
  useEffect(() => {
    setRenamingNoteId(null)
    setRenamingFolderId(null)
  }, [scope])

  const selectNote = (id: string) => {
    handleSelect(id)
    onAfterSelect?.()
  }

  const startRenameNote = (id: string, title: string) => {
    setRenamingNoteId(id)
    setRenameDraft(title)
  }

  const commitRenameNote = () => {
    const id = renamingNoteId
    const next = renameDraft.trim()
    setRenamingNoteId(null)
    if (id && next) handleRename(id, next)
  }

  const startRenameFolder = (id: string, name: string) => {
    setRenamingFolderId(id)
    setFolderDraft(name)
  }

  const commitRenameFolder = () => {
    const id = renamingFolderId
    const next = folderDraft.trim()
    setRenamingFolderId(null)
    if (id && next) handleRenameFolder(id, next)
  }

  /** 右键菜单：普通文档（全部 / 文件夹视图下） */
  const openNoteMenu = (e: ReactMouseEvent, note: NoteItem) => {
    /*
     * 「移动到」收成子菜单，不再把每个文件夹平铺在顶层 ——
     * 文件夹一多，右键菜单会被撑成一长条，找「复制标题」得往下翻半天。
     */
    const moveTargets = [
      ...(note.folderId
        ? [
            {
              id: 'note-move-out',
              label: '移出到未分类',
              icon: <Inbox className="w-3.5 h-3.5" />,
              onSelect: () => handleMoveToFolder(note.id, null),
            },
          ]
        : []),
      ...folders
        .filter((folder) => folder.id !== note.folderId)
        .map((folder) => ({
          id: `note-move-${folder.id}`,
          label: folder.name,
          icon: <FolderClosed className="w-3.5 h-3.5" />,
          onSelect: () => handleMoveToFolder(note.id, folder.id),
        })),
    ]

    openContextMenu(e, [
      {
        id: 'note-open',
        label: '打开文档',
        icon: <FolderOpen className="w-3.5 h-3.5" />,
        onSelect: () => selectNote(note.id),
      },
      {
        id: 'note-rename',
        label: '重命名',
        icon: <Pencil className="w-3.5 h-3.5" />,
        shortcut: '双击标题',
        onSelect: () => startRenameNote(note.id, note.title),
      },
      {
        id: 'note-bookmark',
        label: note.bookmarked ? '移除书签' : '加入书签',
        icon: note.bookmarked ? (
          <BookmarkMinus className="w-3.5 h-3.5" />
        ) : (
          <BookmarkPlus className="w-3.5 h-3.5" />
        ),
        onSelect: () => {
          handleToggleBookmark(note.id)
          showToast(note.bookmarked ? '已移除书签' : '已加入书签')
        },
      },
      /* 没有文件夹时连「移动到」都不给 —— 没有可去的地方，
         唯一的动作「移出到未分类」对未分类文档也没有意义 */
      ...(moveTargets.length > 0
        ? [
            {
              id: 'note-move-to',
              label: '移动到',
              icon: <FolderClosed className="w-3.5 h-3.5" />,
              children: moveTargets,
            },
          ]
        : []),
      { id: 'note-sep-1', separator: true },
      {
        id: 'note-copy-content',
        label: '复制正文',
        icon: <Copy className="w-3.5 h-3.5" />,
        disabled: !note.content,
        onSelect: () => void copyNote(note.content, '已复制正文'),
      },
      {
        id: 'note-copy-title',
        label: '复制标题',
        icon: <Copy className="w-3.5 h-3.5" />,
        disabled: !note.title,
        onSelect: () => void copyNote(note.title, '已复制标题'),
      },
      { id: 'note-sep-2', separator: true },
      {
        id: 'note-export',
        label: '导出 .md',
        icon: <Download className="w-3.5 h-3.5" />,
        onSelect: () => void handleExport(note),
      },
      {
        id: 'note-delete',
        label: '移入回收站',
        icon: <Trash2 className="w-3.5 h-3.5" />,
        danger: true,
        onSelect: () => {
          handleDelete(note.id)
          showToast('已移入回收站')
        },
      },
    ])
  }

  /** 右键菜单：回收站里的文档，动作完全不同 */
  const openTrashMenu = (e: ReactMouseEvent, note: NoteItem) => {
    openContextMenu(e, [
      {
        id: 'trash-restore',
        label: '还原',
        icon: <ArchiveRestore className="w-3.5 h-3.5" />,
        onSelect: () => {
          handleRestore(note.id)
          showToast('已还原到全部文档')
        },
      },
      {
        id: 'trash-copy-title',
        label: '复制标题',
        icon: <Copy className="w-3.5 h-3.5" />,
        disabled: !note.title,
        onSelect: () => void copyNote(note.title, '已复制标题'),
      },
      { id: 'trash-sep', separator: true },
      {
        id: 'trash-purge',
        label: '彻底删除',
        icon: <Trash2 className="w-3.5 h-3.5" />,
        danger: true,
        onSelect: () => purgeOne(note),
      },
    ])
  }

  const purgeOne = (note: NoteItem) => {
    if (!window.confirm(`彻底删除「${note.title}」？此操作不可恢复。`)) return
    handlePurge(note.id)
    showToast('已彻底删除')
  }

  const emptyTrash = () => {
    if (trashed.length === 0) return
    if (!window.confirm(`彻底删除回收站中的 ${trashed.length} 篇文档？此操作不可恢复。`)) return
    handleEmptyTrash()
    showToast('回收站已清空')
  }

  const copyNote = async (text: string, okMessage: string) => {
    try {
      if (window.electronAPI?.clipboardWrite) await window.electronAPI.clipboardWrite(text)
      else await navigator.clipboard.writeText(text)
      showToast(okMessage)
    } catch {
      showToast('复制失败')
    }
  }

  /** 文件夹 id → 名字，用于回收站里标注原属文件夹 */
  const folderNameOf = (folderId: string): string | undefined =>
    folders.find((folder) => folder.id === folderId)?.name

  /*
   * 拖拽归类：列表项拖起，文件夹横条接收，列表空白处 = 移出到未分类。
   *
   * 用原生 HTML5 DnD 而不是手动 mousedown 追踪 —— 编辑器那边的块拖拽之所以自绘，
   * 是因为手柄按下必须 preventDefault 保住焦点与选区；侧栏列表没有这个约束，
   * 原生拖拽自带拖影与跨元素 hover，代码也更少。
   *
   * 落点与"是否已处理"都记在 ref 里，不依赖 state：
   * drop / dragLeave / dragEnd 三者的触发顺序在不同浏览器、不同松手位置上并不一致，
   * 而 setState 要下一次渲染才生效，闭包里读到的会是旧值 —— 之前正是这样导致
   * 「拖到文件夹上松手」时 dragLeave 先把落点清掉、dragEnd 读到 null 而静默失败。
   */
  const dropFolderIdRef = useRef<string | null>(null)
  /** 一次拖拽只允许结算一次，避免 drop 与 dragEnd 各动一次 */
  const dragHandledRef = useRef(false)

  const handleDragStart = (event: ReactDragEvent, note: NoteItem) => {
    dragHandledRef.current = false
    dropFolderIdRef.current = null
    setDraggingNoteId(note.id)
    event.dataTransfer.effectAllowed = 'move'
    // 必须给 dataTransfer 设点东西，否则部分环境下拖拽根本不会启动
    event.dataTransfer.setData('text/plain', note.id)
  }

  /** 结算一次拖拽：folderId 为 null 表示落到空白处（移出到未分类） */
  const settleDrag = (rawFolderId: string | null) => {
    if (dragHandledRef.current) return
    // 「全部」占位与「没有落点」在调用侧都是没有归属，落点本身由两者区分：
    // 落在「全部」页签上 = 明确的移出意图，落在真正的空白处不触发 drop
    const folderId = rawFolderId === ALL_TAB ? null : rawFolderId
    /*
     * 标位放在 finally：这一次拖拽已经被消费掉了，无论往下走哪条早退路径，
     * 都不能让浏览器稍后补发的 dragEnd 再拿同一份落点结算第二次。
     */
    try {
      const noteId = draggingNoteId
      if (!noteId) return

      const note = notes.find((item) => item.id === noteId)
      if (!note) return
      // 拖回它原本就在的文件夹 / 本来就在未分类又丢到空白处，都没必要写一次盘
      if ((note.folderId ?? null) === folderId) return

      handleMoveToFolder(note.id, folderId)
      showToast(
        folderId
          ? `已将「${note.title || '未命名笔记'}」移入「${folderNameOf(folderId) || '文件夹'}」`
          : '已移出到未分类'
      )
    } finally {
      dragHandledRef.current = true
      dropFolderIdRef.current = null
      setDraggingNoteId(null)
      setDropFolderId(null)
    }
  }

  const handleDragEnd = () => {
    // 已经由 drop 结算过就什么都不做（settleDrag 内部早退）；
    // 否则（落在窗口外、或没有触发 drop 的位置）用最后一次记录的落点兜底
    settleDrag(dropFolderIdRef.current)
  }

  const newFolder = () => {
    const id = handleCreateFolder()
    // 建完立刻进入改名态，省一次右键
    startRenameFolder(id, `新建文件夹 ${folders.length + 1}`)
    showToast('已新建文件夹')
  }

  return (
    <>
      {/* ============ 顶部：标题 + 视图级动作 ============ */}
      <div className="p-3 border-b border-slate-100 dark:border-dark-border space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* 标题固定不随页签变 —— 位置感由下面的页签自己表达，
                这里再跟着改一次就成了「进入文件夹」那套层级语义 */}
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tracking-tight truncate">
              {scope.type === 'trash' ? '回收站' : '知识库文档'}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-dark-hover text-slate-500 dark:text-slate-400 flex-shrink-0">
              {scope.type === 'trash' ? trashed.length : filteredNotes.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* 回收站图标常驻：在回收站视图里点它回「全部」，这就是出口本身。
                之前把它放在底部当普通条目，进了回收站就只剩列表、没有回头路 */}
            <Tooltip
              content={scope.type === 'trash' ? '返回全部文档' : '回收站'}
            >
              <button
                // 就地开关：在回收站里点它回「全部」，在外面点它进回收站。
                // 这样一颗图标既是入口也是出口 —— 之前只当入口用，
                // 进去之后整个侧栏没有任何回头的路径
                onClick={() =>
                  setScope(scope.type === 'trash' ? { type: 'all' } : { type: 'trash' })
                }
                className={`relative flex items-center justify-center p-1.5 rounded-lg transition-all ${
                  scope.type === 'trash'
                    ? 'bg-brand-600 text-white shadow-xs hover:bg-brand-700 dark:bg-brand-500'
                    : 'bg-slate-100 dark:bg-dark-hover hover:bg-slate-200 dark:hover:bg-dark-border text-slate-600 dark:text-slate-300'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {/* 有内容才点，一个小圆点，不占额外宽度 */}
                {trashed.length > 0 && scope.type !== 'trash' && (
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
                )}
              </button>
            </Tooltip>

            {/* 回收站视图下其余动作全部收起 —— 在那儿只能还原或删除 */}
            {scope.type !== 'trash' && (
              <>
                <Tooltip content="新建文件夹">
                  <button
                    onClick={newFolder}
                    className="flex items-center justify-center p-1.5 bg-slate-100 dark:bg-dark-hover hover:bg-slate-200 dark:hover:bg-dark-border text-slate-600 dark:text-slate-300 rounded-lg transition-all"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content="打开或新建「全特性与工具支持全景样板」">
                  <button
                    onClick={handleOpenSampleNote}
                    className="flex items-center justify-center p-1.5 bg-slate-100 dark:bg-dark-hover hover:bg-slate-200 dark:hover:bg-dark-border text-slate-600 dark:text-slate-300 rounded-lg transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  </button>
                </Tooltip>
                <Tooltip content="新建文档 (⌘N)">
                  <button
                    onClick={() => handleCreate(scope.type === 'folder' ? scope.folderId : null)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-medium transition-all shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>新建</span>
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </div>

        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={scope.type === 'trash' ? '在回收站中过滤...' : '过滤文档...'}
            className="w-full pl-8 pr-7 h-7 text-xs bg-slate-50 dark:bg-dark-sidebar border border-slate-200 dark:border-dark-border rounded-lg outline-none focus:border-brand-500 dark:focus:border-brand-500 transition-all text-slate-800 dark:text-slate-200 placeholder-slate-400"
          />
          {keyword && (
            <button
              onClick={() => setKeyword('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="清空"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/*
          知识库页签：全部 / 各文件夹。回收站是另一种视图，不给它页签。

          它**始终显示**（不再只在「全部」时露出）—— 点文件夹页签只是把下面的列表
          换成该文件夹的内容，位置感由这里的高亮表达，而不是进入另一层。
          横向滚动不换行、隐藏滚动条；同时是拖拽的放置目标。
        */}
        {scope.type !== 'trash' && (
          <div className="flex gap-1 overflow-x-auto scrollbar-hide py-0.5">
            {/* 「全部」固定占首位；它同时也是「移出到未分类」的落点 */}
            <button
              onClick={() => setScope({ type: 'all' })}
              onDragOver={(e) => {
                if (!draggingNoteId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                dropFolderIdRef.current = ALL_TAB
                setDropFolderId(ALL_TAB)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropFolderId(null)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                settleDrag(null)
              }}
              title="全部文档（把文档拖到这里可移出文件夹）"
              aria-current={scope.type === 'all' ? 'page' : undefined}
              className={`flex-shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                dropFolderId === ALL_TAB
                  ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-500 dark:bg-brand-500/20 dark:text-brand-300 dark:ring-brand-400'
                  : scope.type === 'all'
                    ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-dark-hover dark:hover:text-slate-200'
              }`}
            >
              全部
            </button>

            {/* 书签：跨文件夹的一个视图，与「全部」同级，所以排在文件夹之前。
                书签是文档自身的属性，没有文件夹那种「归属」含义，
                因此它不做拖拽落点 —— 拖到它上面没有合理的语义 */}
            <button
              onClick={() => setScope({ type: 'bookmarks' })}
              title="只看已加书签的文档"
              aria-current={scope.type === 'bookmarks' ? 'page' : undefined}
              className={`flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                scope.type === 'bookmarks'
                  ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-dark-hover dark:hover:text-slate-200'
              }`}
            >
              <Star className="w-3 h-3" />
              书签
            </button>
            {folders.map((folder) => {
              // 点它只换列表内容，不改变「我在哪一层」—— 所以选中态必须是实心的
              const isCurrent = scope.type === 'folder' && scope.folderId === folder.id
              return renamingFolderId === folder.id ? (
                <input
                  key={folder.id}
                  autoFocus
                  value={folderDraft}
                  maxLength={40}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRenameFolder()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setRenamingFolderId(null)
                    }
                  }}
                  onBlur={commitRenameFolder}
                  className="w-24 h-6 px-2 text-[11px] bg-white dark:bg-dark-sidebar border border-brand-500 rounded-lg outline-none text-slate-900 dark:text-white flex-shrink-0"
                />
              ) : (
                <button
                  key={folder.id}
                  onClick={() => setScope({ type: 'folder', folderId: folder.id })}
                  onDoubleClick={() => startRenameFolder(folder.id, folder.name)}
                  onDragOver={(e) => {
                    // 不接受拖拽时浏览器不触发 drop，高亮也就无从谈起
                    if (!draggingNoteId) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    dropFolderIdRef.current = folder.id
                    if (dropFolderId !== folder.id) setDropFolderId(folder.id)
                  }}
                  onDragLeave={(e) => {
                    /*
                     * 只把高亮（state）清掉，**不动** dropFolderIdRef：
                     * 松手前光标移出 chip 也会走到这里，落点信息得留到 dragEnd 用。
                     */
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropFolderId(null)
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    settleDrag(folder.id)
                  }}
                  onContextMenu={(e) =>
                    openContextMenu(e, [
                      {
                        id: `folder-rename-${folder.id}`,
                        label: '重命名文件夹',
                        icon: <Pencil className="w-3.5 h-3.5" />,
                        onSelect: () => startRenameFolder(folder.id, folder.name),
                      },
                      {
                        id: `folder-delete-${folder.id}`,
                        label: '删除文件夹',
                        icon: <Trash2 className="w-3.5 h-3.5" />,
                        danger: true,
                        onSelect: () => {
                          if (
                            !window.confirm(
                              `删除文件夹「${folder.name}」？其中的文档会回到「未分类」，不会被删除。`
                            )
                          )
                            return
                          handleDeleteFolder(folder.id)
                          showToast('文件夹已删除，文档已回到未分类')
                        },
                      },
                    ])
                  }
                  title={`${folder.name}（双击重命名，可把文档拖进来）`}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                    dropFolderId === folder.id
                      ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-500 dark:bg-brand-500/20 dark:text-brand-300 dark:ring-brand-400'
                      : isCurrent
                        ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-dark-hover dark:hover:text-slate-200'
                  }`}
                >
                  <FolderClosed className="w-3 h-3" />
                  <span className="max-w-[88px] truncate">{folder.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ============ 文档列表流 ============ */}
      {/* 空白处可拖回来 = 移出当前文件夹。回收站里的文档不参与拖拽 */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-1.5"
        onDragOver={(e) => {
          /*
           * 只有「全部文档」视图接受拖到空白处 —— 那是「移出到未分类」的唯一入口。
           * 文件夹视图里不 preventDefault，浏览器就不会给 drop 光标，
           * 用户能直接看出这里放不下；否则松手会静默无事发生（文档本来就在该文件夹里，
           * settleDrag 会因归属未变而早退），比不接受更让人困惑。
           */
          if (!draggingNoteId || scope.type !== 'all') return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          settleDrag(null)
        }}
      >
        {filteredNotes.map((note) => {
          const isActive = note.id === activeNote?.id && scope.type !== 'trash'
          const inTrash = scope.type === 'trash'
          return (
            <div
              key={note.id}
              // 回收站与「全部文档」视图下都能拖：后者用于拖进文件夹
              draggable={!inTrash}
              onDragStart={(e) => handleDragStart(e, note)}
              onDragEnd={handleDragEnd}
              onClick={() => (inTrash ? undefined : selectNote(note.id))}
              onContextMenu={(e) =>
                inTrash ? openTrashMenu(e, note) : openNoteMenu(e, note)
              }
              className={`group relative px-3 py-2.5 rounded-xl transition-colors ${
                inTrash ? 'cursor-default' : 'cursor-pointer'
              } ${
                draggingNoteId === note.id ? 'opacity-40' : ''
              } ${
                isActive
                  ? 'bg-brand-500/10 dark:bg-brand-500/15 text-slate-900 dark:text-white'
                  : 'hover:bg-slate-100/80 dark:hover:bg-dark-hover/70 text-slate-700 dark:text-slate-300'
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-[3.5px] bg-brand-600 dark:bg-brand-400 rounded-r" />
              )}

              <div className="flex items-center justify-between gap-1.5 mb-1">
                {/* 书签星标常驻在标题左侧，不占 hover 才出现的位 */}
                {note.bookmarked && !inTrash && (
                  <Star className="w-3 h-3 flex-shrink-0 text-amber-500 fill-amber-500" />
                )}
                {renamingNoteId === note.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameDraft}
                    maxLength={80}
                    placeholder="输入文档名称"
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitRenameNote()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setRenamingNoteId(null)
                      }
                    }}
                    onBlur={commitRenameNote}
                    className="flex-1 min-w-0 h-6 px-1.5 text-[13.5px] leading-none bg-white dark:bg-dark-sidebar border border-brand-500 rounded outline-none text-slate-900 dark:text-white"
                  />
                ) : (
                  <h4
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (!inTrash) startRenameNote(note.id, note.title)
                    }}
                    title={
                      inTrash
                        ? `${note.title || '未命名笔记'}（右键可还原）`
                        : `${note.title || '未命名笔记'}（双击重命名）`
                    }
                    className={`flex-1 min-w-0 truncate text-[13.5px] leading-snug ${
                      isActive
                        ? 'font-bold text-slate-900 dark:text-white'
                        : 'font-medium text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    {note.title || '未命名笔记'}
                  </h4>
                )}
                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono shrink-0 select-none">
                  {formatNoteTime(inTrash ? note.deletedAt || note.updatedAt : note.updatedAt)}
                </span>
              </div>

              <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-1 leading-snug">
                {getNotePreviewSnippet(note.content)}
              </p>

              {/* 回收站里标出原属文件夹：还原后会回到那儿，用户需要知道。
                  文件夹若已被删除，也要说清楚，而不是让标注整条消失 */}
              {inTrash && note.folderId && (
                <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                  <FolderClosed className="w-2.5 h-2.5" />
                  {folderNameOf(note.folderId)
                    ? `原属 ${folderNameOf(note.folderId)}`
                    : '原属文件夹已删除'}
                </span>
              )}
            </div>
          )
        })}

        {filteredNotes.length === 0 && (
          <div className="h-40 flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400">
            {scope.type === 'trash' ? (
              <Archive className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2 stroke-[1.5]" />
            ) : scope.type === 'bookmarks' ? (
              <Star className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2 stroke-[1.5]" />
            ) : (
              <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2 stroke-[1.5]" />
            )}
            {keyword ? (
              <>
                <p className="font-medium text-slate-500 dark:text-slate-400">无匹配文档</p>
                <p className="text-[11px] text-slate-400 mt-0.5">尝试使用其他关键词搜索</p>
              </>
            ) : scope.type === 'trash' ? (
              <>
                <p className="font-medium text-slate-500 dark:text-slate-400">回收站是空的</p>
                <p className="text-[11px] text-slate-400 mt-0.5">删除的文档会先到这里</p>
              </>
            ) : scope.type === 'bookmarks' ? (
              <>
                <p className="font-medium text-slate-500 dark:text-slate-400">还没有书签</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  右键文档「加入书签」，或按 ⌘⇧B
                </p>
              </>
            ) : scope.type === 'folder' ? (
              <>
                <p className="font-medium text-slate-500 dark:text-slate-400">这个文件夹还是空的</p>
                <p className="text-[11px] text-slate-400 mt-0.5">把文档拖到上方页签即可归类</p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-500 dark:text-slate-400">暂无知识库文档</p>
                <p className="text-[11px] text-slate-400 mt-0.5">点击右上角「新建」开启记录</p>
              </>
            )}
          </div>
        )}
      </div>

      {/*
        回收站在回收站视图里才露出「清空」动作条。
        入口本身已经移到顶部工具行（那颗垃圾桶图标），这里只留清空按钮，
        不再放一行常驻条目 —— 底部原来是回收站 + 本机备份两行，压着列表高度。
      */}
      {scope.type === 'trash' && (
        <div className="flex-shrink-0 border-t border-slate-100 dark:border-dark-border p-2">
          <button
            onClick={emptyTrash}
            disabled={trashed.length === 0}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清空回收站
          </button>
        </div>
      )}
    </>
  )
}
