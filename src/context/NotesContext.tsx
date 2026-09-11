import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createEmptyNote,
  deriveTitleFromMarkdown,
  loadNotesState,
  saveNotesState,
  type NoteItem,
  type NotesState,
} from '../utils/notesStore'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type ViewMode = 'code' | 'split' | 'preview'

interface NotesContextType {
  ready: boolean
  notes: NoteItem[]
  activeId: string | null
  activeNote: NoteItem | null
  saveStatus: SaveStatus
  message: string
  keyword: string
  setKeyword: (kw: string) => void
  filteredNotes: NoteItem[]
  handleCreate: () => void
  handleSelect: (id: string) => void
  handleDelete: (id: string) => void
  handleContentChange: (content: string) => void
  handleExport: () => Promise<void>
  handleImport: () => Promise<void>
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  splitPercent: number
  setSplitPercent: (pct: number) => void
  statusCounter: { words: number; lines: number }
  setStatusCounter: (counter: { words: number; lines: number }) => void
  insertText: (prefix: string, suffix?: string) => void
  registerInsertHandler: (fn: (prefix: string, suffix?: string) => void) => void
}

const NotesContext = createContext<NotesContextType | null>(null)

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [message, setMessage] = useState('已保存')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [splitPercent, setSplitPercent] = useState<number>(50)
  const [statusCounter, setStatusCounter] = useState({ words: 0, lines: 0 })

  const saveTimerRef = useRef<number | null>(null)
  const stateRef = useRef<NotesState>({ notes: [], activeId: null })
  const insertHandlerRef = useRef<((prefix: string, suffix?: string) => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const state = await loadNotesState()
      if (cancelled) return
      setNotes(state.notes)
      setActiveId(state.activeId)
      stateRef.current = state
      setReady(true)
    })()

    return () => {
      cancelled = true
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const persist = useCallback((next: NotesState, immediate = false) => {
    stateRef.current = next
    setSaveStatus('saving')
    setMessage('同步中...')

    const run = async () => {
      try {
        await saveNotesState(next)
        setSaveStatus('saved')
        setMessage('已保存')
      } catch (error) {
        console.error(error)
        setSaveStatus('error')
        setMessage('保存失败')
      }
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    if (immediate) {
      void run()
      return
    }

    saveTimerRef.current = window.setTimeout(() => {
      void run()
    }, 400)
  }, [])

  const updateState = useCallback(
    (updater: (prev: NotesState) => NotesState, immediate = false) => {
      const prev = stateRef.current
      const next = updater(prev)
      setNotes(next.notes)
      setActiveId(next.activeId)
      persist(next, immediate)
    },
    [persist]
  )

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeId) || null,
    [notes, activeId]
  )

  const filteredNotes = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const list = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return list
    return list.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.content.toLowerCase().includes(q)
    )
  }, [notes, keyword])

  const handleCreate = useCallback(() => {
    const newDoc = createEmptyNote({
      title: '未命名笔记 ' + (notes.length + 1),
      content: '# 未命名笔记\n\n开始记录你的思路...\n',
    })
    updateState(
      (prev) => ({
        notes: [newDoc, ...prev.notes],
        activeId: newDoc.id,
      }),
      true
    )
  }, [notes.length, updateState])

  const handleSelect = useCallback(
    (id: string) => {
      if (id === activeId) return
      updateState((prev) => ({ ...prev, activeId: id }), true)
    },
    [activeId, updateState]
  )

  const handleDelete = useCallback(
    (id: string) => {
      if (notes.length <= 1) {
        window.alert('请至少保留一个文档！')
        return
      }
      const target = notes.find((note) => note.id === id)
      if (!target) return
      const ok = window.confirm(`确定删除笔记「${target.title}」吗？`)
      if (!ok) return

      updateState((prev) => {
        const remain = prev.notes.filter((note) => note.id !== id)
        const nextActive =
          prev.activeId === id
            ? remain[0]?.id || null
            : prev.activeId && remain.some((n) => n.id === prev.activeId)
              ? prev.activeId
              : remain[0]?.id || null
        return { notes: remain, activeId: nextActive }
      }, true)
    },
    [notes, updateState]
  )

  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeId) return
      updateState((prev) => ({
        ...prev,
        notes: prev.notes.map((note) =>
          note.id === activeId
            ? {
                ...note,
                content,
                title: deriveTitleFromMarkdown(content, note.title || '未命名笔记'),
                updatedAt: Date.now(),
              }
            : note
        ),
      }))
    },
    [activeId, updateState]
  )

  const handleExport = useCallback(async () => {
    if (!activeNote) return
    const defaultName = `${activeNote.title || '未命名笔记'}.md`
    try {
      if (window.electronAPI?.notesSaveFile) {
        const result = await window.electronAPI.notesSaveFile({
          content: activeNote.content,
          defaultPath: defaultName,
        })
        if (!result) return
        return
      }

      const blob = new Blob([activeNote.content], { type: 'text/markdown;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = defaultName
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (error) {
      console.error(error)
    }
  }, [activeNote])

  const handleImport = useCallback(async () => {
    try {
      if (window.electronAPI?.notesOpenFile) {
        const file = await window.electronAPI.notesOpenFile()
        if (!file) return
        const note = createEmptyNote({
          title: deriveTitleFromMarkdown(file.content, file.name.replace(/\.(md|markdown|txt)$/i, '')),
          content: file.content,
        })
        updateState(
          (prev) => ({
            notes: [note, ...prev.notes],
            activeId: note.id,
          }),
          true
        )
        return
      }

      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,.markdown,.txt,text/markdown,text/plain'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const content = await file.text()
        const note = createEmptyNote({
          title: deriveTitleFromMarkdown(content, file.name.replace(/\.(md|markdown|txt)$/i, '')),
          content,
        })
        updateState(
          (prev) => ({
            notes: [note, ...prev.notes],
            activeId: note.id,
          }),
          true
        )
      }
      input.click()
    } catch (error) {
      console.error(error)
    }
  }, [updateState])

  const registerInsertHandler = useCallback(
    (fn: (prefix: string, suffix?: string) => void) => {
      insertHandlerRef.current = fn
    },
    []
  )

  const insertText = useCallback((prefix: string, suffix = '') => {
    if (insertHandlerRef.current) {
      insertHandlerRef.current(prefix, suffix)
    }
  }, [])

  return (
    <NotesContext.Provider
      value={{
        ready,
        notes,
        activeId,
        activeNote,
        saveStatus,
        message,
        keyword,
        setKeyword,
        filteredNotes,
        handleCreate,
        handleSelect,
        handleDelete,
        handleContentChange,
        handleExport,
        handleImport,
        viewMode,
        setViewMode,
        splitPercent,
        setSplitPercent,
        statusCounter,
        setStatusCounter,
        insertText,
        registerInsertHandler,
      }}
    >
      {children}
    </NotesContext.Provider>
  )
}

export function useNotes() {
  const context = useContext(NotesContext)
  if (!context) {
    throw new Error('useNotes must be used within a NotesProvider')
  }
  return context
}
