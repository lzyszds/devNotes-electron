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
  FolderTree,
  Inbox,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useNotes } from '../../../context/NotesContext'
import { useToast } from '../../ui/Toast'
import { useContextMenu } from '../../ui/ContextMenu'
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
  return clean.slice(0, 50) || '暂无内容'
}

interface NotesSidebarProps {
  onAfterSelect?: () => void
  onCollapse?: () => void
  isFolderTreeOpen?: boolean
  onToggleFolderTree?: () => void
}

const ALL_TAB = '__all__'

export default function NotesSidebar({
  onAfterSelect,
  onCollapse: _onCollapse,
  isFolderTreeOpen: externalFolderTreeOpen,
  onToggleFolderTree: externalToggleFolderTree,
}: NotesSidebarProps) {
  const [internalTreeOpen, setInternalTreeOpen] = useState(false)
  const isFolderTreeOpen = externalFolderTreeOpen !== undefined ? externalFolderTreeOpen : internalTreeOpen
  const toggleFolderTree = externalToggleFolderTree || (() => setInternalTreeOpen((prev) => !prev))
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
  } = useNotes()

  const { showToast } = useToast()
  const { openContextMenu } = useContextMenu()

  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [folderDraft, setFolderDraft] = useState('')
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null)
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingNoteId) renameInputRef.current?.focus()
  }, [renamingNoteId])

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

  const openNoteMenu = (e: ReactMouseEvent, note: NoteItem) => {
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

  const dropFolderIdRef = useRef<string | null>(null)
  const dragHandledRef = useRef(false)

  const handleDragStart = (event: ReactDragEvent, note: NoteItem) => {
    dragHandledRef.current = false
    dropFolderIdRef.current = null
    setDraggingNoteId(note.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', note.id)
  }

  const settleDrag = (rawFolderId: string | null) => {
    if (dragHandledRef.current) return
    const folderId = rawFolderId === ALL_TAB ? null : rawFolderId
    try {
      const noteId = draggingNoteId
      if (!noteId) return

      const note = notes.find((item) => item.id === noteId)
      if (!note) return
      if ((note.folderId ?? null) === folderId) return

      handleMoveToFolder(note.id, folderId)
      showToast(
        folderId
          ? `已将「${note.title || '未命名笔记'}」移入文件夹`
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
    settleDrag(dropFolderIdRef.current)
  }

  const newFolder = () => {
    const id = handleCreateFolder()
    startRenameFolder(id, `新建文件夹 ${folders.length + 1}`)
    showToast('已新建文件夹')
  }

  // 统计各分类数目
  const bookmarkedCount = notes.filter((n) => n.bookmarked).length

  return (
    <div className="flex flex-row h-full w-full select-none overflow-hidden">
      {/* ================= 第 2 栏：分类目录栏 (w-52 = 208px，按需展开) ================= */}
      <aside
        style={{ width: isFolderTreeOpen ? 208 : 0 }}
        className={`bg-[#F3F3F1] border-r border-[#E6E6E3] flex flex-col h-full flex-shrink-0 transition-[width] duration-200 overflow-hidden ${isFolderTreeOpen ? 'opacity-100' : 'w-0 opacity-0 border-r-0'
          }`}
      >
        {/* 顶部：48px 对齐，左侧粗体标题，右侧炭黑新建胶囊按钮 */}
        <div className="h-12 px-3 border-b border-[#E6E6E3] flex items-center justify-between flex-shrink-0">
          <span className="font-bold text-sm text-[#191918] tracking-tight">知识库</span>
          <button
            type="button"
            onClick={newFolder}
            className="flex items-center gap-1 bg-[#1C1C1C] hover:bg-neutral-800 text-white rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors shadow-2xs"
            title="新建分类文件夹"
          >
            <Plus className="w-3 h-3" />
            <span>新建</span>
          </button>
        </div>

        {/* 分类项垂直列表 */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {/* 1. 全部文档 */}
          {(() => {
            const isSelected = scope.type === 'all'
            return (
              <button
                type="button"
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
                    全
                  </span>
                  <span className="truncate">全部文档</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full text-[#787774]">
                  {notes.length}
                </span>
              </button>
            )
          })()}

          {/* 2. 收藏文档 */}
          {(() => {
            const isSelected = scope.type === 'bookmarks'
            return (
              <button
                type="button"
                onClick={() => setScope({ type: 'bookmarks' })}
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
                    星
                  </span>
                  <span className="truncate">收藏标星</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full text-[#787774]">
                  {bookmarkedCount}
                </span>
              </button>
            )
          })()}

          {/* 4. 自定义文件夹列表 */}
          <div className="pt-2 pb-1 px-1">
            <span className="text-[10px] font-semibold text-[#787774] tracking-wider uppercase">
              分类目录
            </span>
          </div>

          {folders.map((folder) => {
            const isSelected = scope.type === 'folder' && scope.folderId === folder.id
            const folderCount = notes.filter((n) => n.folderId === folder.id).length
            const initialBadge = folder.name.trim().slice(0, 1) || '目'

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
                className="w-full h-7 px-2.5 text-xs bg-white border border-[#1C1C1C] rounded-lg outline-none text-[#191918]"
              />
            ) : (
              <button
                key={folder.id}
                type="button"
                onClick={() => setScope({ type: 'folder', folderId: folder.id })}
                onDoubleClick={() => startRenameFolder(folder.id, folder.name)}
                onDragOver={(e) => {
                  if (!draggingNoteId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  dropFolderIdRef.current = folder.id
                  if (dropFolderId !== folder.id) setDropFolderId(folder.id)
                }}
                onDragLeave={(e) => {
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
                className={`w-full flex items-center justify-between px-2.5 py-1.5 transition-all text-xs font-medium cursor-pointer ${dropFolderId === folder.id
                    ? 'ring-1 ring-[#1C1C1C] bg-white text-[#191918] rounded-lg'
                    : isSelected
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
                  <span className="truncate">{folder.name}</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full text-[#787774]">
                  {folderCount}
                </span>
              </button>
            )
          })}

          {/* 5. 回收站 */}
          {(() => {
            const isSelected = scope.type === 'trash'
            return (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setScope(scope.type === 'trash' ? { type: 'all' } : { type: 'trash' })
                  }
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
                      垃
                    </span>
                    <span className="truncate">回收站</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full text-[#787774]">
                    {trashed.length}
                  </span>
                </button>
              </div>
            )
          })()}
        </div>
      </aside>

      {/* ================= 第 3 栏：记录列表栏 (w-72 = 288px) ================= */}
      <section className="w-72 bg-[#F9F9F8] flex flex-col h-full flex-shrink-0">
        {/* 顶部：目录展开按钮 + 现代极简微型搜索框 + 炭黑 +新增 按钮 */}
        <div className="h-11 px-2.5 flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={toggleFolderTree}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors cursor-pointer shrink-0 ${isFolderTreeOpen
                ? 'bg-[#EAEAE7] text-[#191918]'
                : 'text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7]/60'
              }`}
            title={isFolderTreeOpen ? '收起分类目录' : '展开分类目录'}
          >
            <FolderTree className="w-3.5 h-3.5" />
          </button>

          <div className="relative flex-1 flex items-center">
            <Search className="w-3 h-3 text-[#9A9996] absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索文档..."
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
          {scope.type !== 'trash' && (
            <button
              type="button"
              onClick={() => handleCreate(scope.type === 'folder' ? scope.folderId : null)}
              className="h-7 px-2.5 bg-[#1C1C1C] hover:bg-neutral-800 text-white rounded-md text-xs font-medium flex items-center gap-1 flex-shrink-0 transition-colors cursor-pointer shadow-2xs"
              title="新建文档 (⌘N)"
            >
              <Plus className="w-3 h-3" />
              <span>新增</span>
            </button>
          )}
        </div>

        {/* 记录列表流：现代原生卡片清单 */}
        <div
          className="flex-1 overflow-y-auto p-1.5 space-y-1"
          onDragOver={(e) => {
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
                draggable={!inTrash}
                onDragStart={(e) => handleDragStart(e, note)}
                onDragEnd={handleDragEnd}
                onClick={() => (inTrash ? undefined : selectNote(note.id))}
                onContextMenu={(e) =>
                  inTrash ? openTrashMenu(e, note) : openNoteMenu(e, note)
                }
                className={`group relative px-2.5 py-2 rounded-lg transition-all ${inTrash ? 'cursor-default' : 'cursor-pointer'
                  } ${draggingNoteId === note.id ? 'opacity-30' : ''} ${isActive
                    ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_1px_rgba(0,0,0,0.02)] ring-1 ring-black/[0.08]'
                    : 'bg-transparent hover:bg-black/[0.035] text-[#191918]'
                  }`}
              >
                {/* 第一行：标题 + 右侧时间/星标 */}
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <div className="min-w-0 flex-1">
                    {renamingNoteId === note.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameDraft}
                        maxLength={80}
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
                        className="w-full h-5 px-1 text-xs bg-white text-[#191918] border border-black/20 rounded outline-none"
                      />
                    ) : (
                      <h4
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          if (!inTrash) startRenameNote(note.id, note.title)
                        }}
                        className={`truncate text-xs ${isActive ? 'font-semibold text-[#191918]' : 'font-normal text-[#191918]'
                          }`}
                      >
                        {note.title || '未命名笔记'}
                      </h4>
                    )}
                  </div>

                  {/* 右侧微型时间与标星 */}
                  <div className="flex items-center gap-1 shrink-0 text-[10px] font-mono text-[#8A8987]">
                    <span>
                      {formatNoteTime(inTrash ? note.deletedAt || note.updatedAt : note.updatedAt)}
                    </span>
                    {note.bookmarked && !inTrash && (
                      <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500 shrink-0" />
                    )}
                  </div>
                </div>

                {/* 第二行：正文摘要单行平滑展示 */}
                <p className="text-[11px] line-clamp-1 leading-relaxed mt-0.5 text-[#787774]">
                  {getNotePreviewSnippet(note.content)}
                </p>
              </div>
            )
          })}

          {filteredNotes.length === 0 && (
            <div className="h-48 flex flex-col items-center justify-center text-center px-4 text-xs text-[#787774]">
              {scope.type === 'trash' ? (
                <Archive className="w-8 h-8 text-[#D4D4D0] mb-2 stroke-[1.5]" />
              ) : scope.type === 'bookmarks' ? (
                <Star className="w-8 h-8 text-[#D4D4D0] mb-2 stroke-[1.5]" />
              ) : (
                <FileText className="w-8 h-8 text-[#D4D4D0] mb-2 stroke-[1.5]" />
              )}
              <p className="font-medium text-[#191918]">暂无相关文档</p>
              <p className="text-[11px] text-[#787774] mt-0.5">
                {keyword ? '尝试不同关键词' : '点击右上角「新增」开始编写'}
              </p>
            </div>
          )}
        </div>

        {/* 回收站清空按钮 */}
        {scope.type === 'trash' && (
          <div className="p-2.5 border-t border-[#E6E6E3] bg-[#F9F9F8]">
            <button
              type="button"
              onClick={emptyTrash}
              disabled={trashed.length === 0}
              className="w-full py-1.5 px-3 rounded-lg text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              清空回收站 ({trashed.length})
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
