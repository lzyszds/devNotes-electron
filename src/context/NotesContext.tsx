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
import {
  loadCloudflareConfig,
  saveCloudflareConfig,
  pushToCloudflare,
  pullFromCloudflare,
  smartMergeNotes,
  testCloudflareConnection,
  loadBackupSnapshots,
  saveBackupSnapshots,
  createSnapshotFromState,
  DEFAULT_CF_CONFIG,
  type CloudflareSyncConfig,
  type SyncResult,
  type BackupSnapshot,
} from '../utils/cloudflareSync'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type ViewMode = 'code' | 'split' | 'preview'
export type CfSyncStatus = 'idle' | 'syncing' | 'success' | 'error'

// 与 electron/preload.ts 的 OpenFilePayload 保持一致(渲染层不直接 import electron 模块)
interface OpenFilePayload {
  path: string
  name: string
  content?: string
  mtimeMs?: number
  error?: string
}

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
  // Cloudflare 同步能力
  cfConfig: CloudflareSyncConfig
  cfSyncStatus: CfSyncStatus
  cfSyncMessage: string
  isCfModalOpen: boolean
  setIsCfModalOpen: (open: boolean) => void
  updateCfConfig: (cfg: Partial<CloudflareSyncConfig>) => Promise<void>
  triggerCfTest: (customConfig?: CloudflareSyncConfig) => Promise<{ ok: boolean; message: string }>
  triggerCfBackup: () => Promise<SyncResult>
  triggerCfPull: (mode?: 'merge' | 'overwrite') => Promise<SyncResult>
  // 自动备份快照能力
  snapshots: BackupSnapshot[]
  restoreSnapshot: (id: string) => Promise<boolean>
  deleteSnapshot: (id: string) => Promise<void>
  clearAllSnapshots: () => Promise<void>
  createManualSnapshot: () => Promise<BackupSnapshot>
}

const NotesContext = createContext<NotesContextType | null>(null)

interface NotesProviderProps {
  children: React.ReactNode
  // 外部打开 md 文件导入成功后的导航回调(如切换到笔记 tab)
  onFileOpenNavigate?: () => void
}

export function NotesProvider({ children, onFileOpenNavigate }: NotesProviderProps) {
  const [ready, setReady] = useState(false)
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [message, setMessage] = useState('已保存')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [splitPercent, setSplitPercent] = useState<number>(50)
  const [statusCounter, setStatusCounter] = useState({ words: 0, lines: 0 })

  // Cloudflare 备份与同步状态
  const [cfConfig, setCfConfig] = useState<CloudflareSyncConfig>(DEFAULT_CF_CONFIG)
  const [cfSyncStatus, setCfSyncStatus] = useState<CfSyncStatus>('idle')
  const [cfSyncMessage, setCfSyncMessage] = useState<string>('')
  const [isCfModalOpen, setIsCfModalOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([])

  const saveTimerRef = useRef<number | null>(null)
  const cfAutoSyncTimerRef = useRef<number | null>(null)
  const stateRef = useRef<NotesState>({ notes: [], activeId: null })
  const insertHandlerRef = useRef<((prefix: string, suffix?: string) => void) | null>(null)
  const onFileOpenNavigateRef = useRef<(() => void) | undefined>(undefined)
  const importExternalFileRef = useRef<(file: OpenFilePayload) => void>(() => {})

  const appendSnapshot = useCallback(
    async (
      state: NotesState,
      trigger: 'auto' | 'manual' | 'startup' | 'rollback_guard'
    ): Promise<BackupSnapshot> => {
      const snap = createSnapshotFromState(state, trigger)
      setSnapshots((prev) => {
        // 如果是自动定时/编辑备份，且与最新快照笔记内容完全一致，避免冗余快照
        if (trigger === 'auto' && prev.length > 0) {
          const latest = prev[0]
          if (
            latest.state.notes.length === state.notes.length &&
            JSON.stringify(latest.state.notes) === JSON.stringify(state.notes)
          ) {
            return prev
          }
        }
        const maxCount = cfConfig.maxSnapshots || 20
        const nextList = [snap, ...prev.filter((item) => item.id !== snap.id)].slice(0, maxCount)
        void saveBackupSnapshots(nextList)
        return nextList
      })
      const now = Date.now()
      setCfConfig((prev) => {
        const next = { ...prev, lastBackupTime: now }
        void saveCloudflareConfig(next)
        return next
      })
      return snap
    },
    [cfConfig.maxSnapshots]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const state = await loadNotesState()
      if (cancelled) return
      setNotes(state.notes)
      setActiveId(state.activeId)
      stateRef.current = state
      setReady(true)

      // 载入历史快照
      const storedSnapshots = await loadBackupSnapshots()
      if (cancelled) return
      setSnapshots(storedSnapshots)

      // 载入 Cloudflare 同步配置
      const cfg = await loadCloudflareConfig()
      if (cancelled) return
      setCfConfig(cfg)

      // 启动时自动同步拉取
      if (
        cfg.enabled &&
        cfg.autoSyncOnStartup &&
        (cfg.workerUrl || (cfg.kvAccountId && cfg.kvNamespaceId))
      ) {
        setCfSyncStatus('syncing')
        setCfSyncMessage('正在从 Cloudflare 同步...')
        const res = await pullFromCloudflare(cfg)
        if (cancelled) return
        if (res.success && res.remoteState) {
          const { mergedState, addedFromRemote, updatedFromRemote } = smartMergeNotes(
            stateRef.current,
            res.remoteState
          )
          setNotes(mergedState.notes)
          setActiveId(mergedState.activeId)
          stateRef.current = mergedState
          await saveNotesState(mergedState)
          const now = Date.now()
          const updatedCfg = { ...cfg, lastSyncTime: now }
          setCfConfig(updatedCfg)
          await saveCloudflareConfig(updatedCfg)
          setCfSyncStatus('success')
          setCfSyncMessage(`启动同步完成：新增 ${addedFromRemote} 篇，更新 ${updatedFromRemote} 篇`)
        } else {
          setCfSyncStatus('idle')
        }
      }
    })()

    return () => {
      cancelled = true
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
      if (cfAutoSyncTimerRef.current) {
        window.clearTimeout(cfAutoSyncTimerRef.current)
      }
    }
  }, [])

  // 周期性定时自动备份
  useEffect(() => {
    if (!cfConfig.autoBackupEnabled) return

    const intervalMinutes = Math.max(1, cfConfig.autoBackupIntervalMinutes || 10)
    const intervalMs = intervalMinutes * 60 * 1000

    const timer = window.setInterval(async () => {
      if (!stateRef.current.notes.length) return
      await appendSnapshot(stateRef.current, 'auto')
      if (
        cfConfig.enabled &&
        (cfConfig.workerUrl || (cfConfig.kvAccountId && cfConfig.kvNamespaceId))
      ) {
        await pushToCloudflare(stateRef.current, cfConfig)
      }
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [
    cfConfig.autoBackupEnabled,
    cfConfig.autoBackupIntervalMinutes,
    cfConfig.enabled,
    cfConfig.workerUrl,
    cfConfig.kvAccountId,
    cfConfig.kvNamespaceId,
    appendSnapshot,
  ])

  // 当笔记被修改，若开启 autoSync，则防抖 3 秒自动上报到 Cloudflare 并生成本地备份快照
  const scheduleAutoSync = useCallback(
    (nextState: NotesState) => {
      if (cfAutoSyncTimerRef.current) {
        window.clearTimeout(cfAutoSyncTimerRef.current)
        cfAutoSyncTimerRef.current = null
      }

      cfAutoSyncTimerRef.current = window.setTimeout(async () => {
        // 1. 防抖生成本地快照
        if (cfConfig.autoBackupOnEdit !== false) {
          void appendSnapshot(nextState, 'auto')
        }

        // 2. 如果开启了云端自动同步则推送到 Cloudflare
        if (!cfConfig.enabled || !cfConfig.autoSync) return
        if (cfConfig.mode === 'worker' && !cfConfig.workerUrl) return
        if (cfConfig.mode === 'kv' && (!cfConfig.kvAccountId || !cfConfig.kvNamespaceId)) return

        setCfSyncStatus('syncing')
        setCfSyncMessage('自动备份至 Cloudflare...')
        const res = await pushToCloudflare(nextState, cfConfig)
        if (res.success) {
          setCfSyncStatus('success')
          setCfSyncMessage('已自动同步到云端')
          const now = Date.now()
          setCfConfig((prev) => {
            const next = { ...prev, lastSyncTime: now, lastBackupTime: now }
            void saveCloudflareConfig(next)
            return next
          })
        } else {
          setCfSyncStatus('error')
          setCfSyncMessage(res.message)
        }
      }, 3000)
    },
    [cfConfig, appendSnapshot]
  )

  const persist = useCallback((next: NotesState, immediate = false) => {
    stateRef.current = next
    setSaveStatus('saving')
    setMessage('同步中...')

    const run = async () => {
      try {
        await saveNotesState(next)
        setSaveStatus('saved')
        setMessage('已保存')
        scheduleAutoSync(next)
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
  }, [scheduleAutoSync])

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

  // 导入外部 md 文件(文件关联打开 / 对话框导入共用):按 sourcePath 去重,mtime 更新时刷新
  const importExternalFile = useCallback(
    (file: OpenFilePayload) => {
      if (file.error || typeof file.content !== 'string') {
        setSaveStatus('error')
        setMessage(`打开文件失败:${file.name}`)
        return
      }

      const content = file.content
      const mtime = file.mtimeMs ?? Date.now()
      const fallbackTitle = file.name.replace(/\.(md|markdown|txt)$/i, '')
      const existing = stateRef.current.notes.find((note) => note.sourcePath === file.path)

      if (existing) {
        if (typeof existing.sourceMtime === 'number' && mtime <= existing.sourceMtime) {
          // 磁盘文件未更新,仅激活该笔记
          updateState((prev) => ({ ...prev, activeId: existing.id }), true)
        } else {
          // 磁盘文件已更新,以磁盘内容刷新(自动快照兜底)
          updateState(
            (prev) => ({
              ...prev,
              activeId: existing.id,
              notes: prev.notes.map((note) =>
                note.id === existing.id
                  ? {
                      ...note,
                      content,
                      title: deriveTitleFromMarkdown(content, note.title || fallbackTitle),
                      sourceMtime: mtime,
                      updatedAt: Date.now(),
                    }
                  : note
              ),
            }),
            true
          )
        }
      } else {
        const note = createEmptyNote({
          title: deriveTitleFromMarkdown(content, fallbackTitle),
          content,
          sourcePath: file.path,
          sourceMtime: mtime,
        })
        updateState(
          (prev) => ({
            notes: [note, ...prev.notes],
            activeId: note.id,
          }),
          true
        )
      }

      onFileOpenNavigateRef.current?.()
    },
    [updateState]
  )

  // 保持 handler 引用最新,避免因依赖链变化反复退订/重订导致主进程 send 丢失
  useEffect(() => {
    importExternalFileRef.current = importExternalFile
  }, [importExternalFile])

  useEffect(() => {
    onFileOpenNavigateRef.current = onFileOpenNavigate
  }, [onFileOpenNavigate])

  // 笔记状态加载完成后,订阅主进程的外部打开文件请求并通知就绪
  // (必须 gate 在 ready 之后,否则 flush 时 stateRef 还是空列表,会覆盖用户真实笔记)
  useEffect(() => {
    if (!ready) return
    const api = window.electronAPI
    if (!api?.onOpenFileRequest || !api?.notifyRendererReady) return

    const off = api.onOpenFileRequest((payload) => importExternalFileRef.current(payload))
    void api.notifyRendererReady()
    return off
  }, [ready])

  const handleImport = useCallback(async () => {
    try {
      if (window.electronAPI?.notesOpenFile) {
        const file = await window.electronAPI.notesOpenFile()
        if (!file) return
        importExternalFile({
          path: file.path,
          name: file.name,
          content: file.content,
          mtimeMs: file.mtimeMs,
        })
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

  // ================= Cloudflare 同步控制操作 =================
  const updateCfConfig = useCallback(async (partial: Partial<CloudflareSyncConfig>) => {
    setCfConfig((prev) => {
      const next = { ...prev, ...partial }
      void saveCloudflareConfig(next)
      return next
    })
  }, [])

  const triggerCfTest = useCallback(
    async (customConfig?: CloudflareSyncConfig) => {
      return await testCloudflareConnection(customConfig || cfConfig)
    },
    [cfConfig]
  )

  const triggerCfBackup = useCallback(async (): Promise<SyncResult> => {
    setCfSyncStatus('syncing')
    setCfSyncMessage('正在备份到 Cloudflare...')
    const res = await pushToCloudflare(stateRef.current, cfConfig)
    if (res.success) {
      const now = Date.now()
      setCfSyncStatus('success')
      setCfSyncMessage(res.message)
      const nextCfg = { ...cfConfig, lastSyncTime: now }
      setCfConfig(nextCfg)
      await saveCloudflareConfig(nextCfg)
    } else {
      setCfSyncStatus('error')
      setCfSyncMessage(res.message)
    }
    return res
  }, [cfConfig])

  const triggerCfPull = useCallback(
    async (mode: 'merge' | 'overwrite' = 'merge'): Promise<SyncResult> => {
      setCfSyncStatus('syncing')
      setCfSyncMessage('正在从 Cloudflare 获取最新数据...')
      const res = await pullFromCloudflare(cfConfig)
      if (!res.success || !res.remoteState) {
        setCfSyncStatus('error')
        setCfSyncMessage(res.message)
        return { success: false, message: res.message }
      }

      if (mode === 'merge') {
        const { mergedState, addedFromRemote, updatedFromRemote } = smartMergeNotes(
          stateRef.current,
          res.remoteState
        )
        setNotes(mergedState.notes)
        setActiveId(mergedState.activeId)
        stateRef.current = mergedState
        await saveNotesState(mergedState)
        const now = Date.now()
        const nextCfg = { ...cfConfig, lastSyncTime: now }
        setCfConfig(nextCfg)
        await saveCloudflareConfig(nextCfg)
        setCfSyncStatus('success')
        const msg = `合并成功：新增 ${addedFromRemote} 篇，更新 ${updatedFromRemote} 篇`
        setCfSyncMessage(msg)
        return { success: true, message: msg, remoteTime: res.remoteTime }
      } else {
        // overwrite
        setNotes(res.remoteState.notes)
        setActiveId(res.remoteState.activeId)
        stateRef.current = res.remoteState
        await saveNotesState(res.remoteState)
        const now = Date.now()
        const nextCfg = { ...cfConfig, lastSyncTime: now }
        setCfConfig(nextCfg)
        await saveCloudflareConfig(nextCfg)
        setCfSyncStatus('success')
        const msg = `覆盖成功：已恢复 ${res.remoteState.notes.length} 篇文档`
        setCfSyncMessage(msg)
        return { success: true, message: msg, remoteTime: res.remoteTime }
      }
    },
    [cfConfig]
  )

  const restoreSnapshot = useCallback(
    async (id: string): Promise<boolean> => {
      const target = snapshots.find((s) => s.id === id)
      if (!target) return false

      // 恢复前先为当前状态创建一个 rollback_guard 备份，防止误操作
      await appendSnapshot(stateRef.current, 'rollback_guard')

      setNotes(target.state.notes)
      setActiveId(target.state.activeId)
      stateRef.current = target.state
      await saveNotesState(target.state)
      return true
    },
    [snapshots, appendSnapshot]
  )

  const deleteSnapshot = useCallback(async (id: string) => {
    setSnapshots((prev) => {
      const next = prev.filter((item) => item.id !== id)
      void saveBackupSnapshots(next)
      return next
    })
  }, [])

  const clearAllSnapshots = useCallback(async () => {
    setSnapshots([])
    await saveBackupSnapshots([])
  }, [])

  const createManualSnapshot = useCallback(async (): Promise<BackupSnapshot> => {
    return await appendSnapshot(stateRef.current, 'manual')
  }, [appendSnapshot])

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
        // Cloudflare
        cfConfig,
        cfSyncStatus,
        cfSyncMessage,
        isCfModalOpen,
        setIsCfModalOpen,
        updateCfConfig,
        triggerCfTest,
        triggerCfBackup,
        triggerCfPull,
        // 快照能力
        snapshots,
        restoreSnapshot,
        deleteSnapshot,
        clearAllSnapshots,
        createManualSnapshot,
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
