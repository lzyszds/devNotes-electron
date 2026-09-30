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
  createFolder,
  deriveTitleFromMarkdown,
  loadNotesState,
  saveNotesState,
  sortNotes,
  trashedNotes,
  visibleFolders,
  visibleNotes,
  DEFAULT_CONTENT,
  type FolderItem,
  type NoteItem,
  type NotesState,
  type ReadingBookmark,
} from '../utils/notesStore'
import {
  loadCloudflareConfig,
  saveCloudflareConfig,
  pushToCloudflare,
  pullFromCloudflare,
  applySettings,
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

/** 侧栏当前在看哪个列表 —— 决定 filteredNotes 的内容与空状态文案 */
export type NoteScope =
  | { type: 'all' }
  /** 只看被收藏的文档（跨文件夹，与「全部」同级） */
  | { type: 'bookmarks' }
  | { type: 'folder'; folderId: string }
  | { type: 'trash' }

interface NotesContextType {
  ready: boolean
  notes: NoteItem[]
  activeId: string | null
  activeNote: NoteItem | null
  saveStatus: SaveStatus
  message: string
  keyword: string
  setKeyword: (kw: string) => void
  /** 当前视图范围内的文档（已排除回收站 / 已按书签分组排序） */
  filteredNotes: NoteItem[]
  /** 回收站里的文档，最近删除的在前 */
  trashed: NoteItem[]
  /** 全部未删除文档（跨文件夹，供「全部文档」与计数使用） */
  aliveCount: number
  scope: NoteScope
  setScope: (scope: NoteScope) => void
  folders: FolderItem[]
  handleCreateFolder: (name?: string) => string
  handleRenameFolder: (id: string, name: string) => void
  handleDeleteFolder: (id: string) => void
  handleToggleBookmark: (id: string) => void
  handleMoveToFolder: (id: string, folderId: string | null) => void
  /** 新增或更新一条阅读位置书签（同 id 覆盖） */
  handleSaveReadingBookmark: (noteId: string, bookmark: ReadingBookmark) => void
  /** 删除一条阅读位置书签 */
  handleDeleteReadingBookmark: (noteId: string, bookmarkId: string) => void
  // 回收站
  handleRestoreFromTrash: (id: string) => void
  handlePurgeFromTrash: (id: string) => void
  handleEmptyTrash: () => void
  handleCreate: (folderId?: string | null) => void
  handleOpenSampleNote: () => void
  handleSelect: (id: string) => void
  /** 软删除：移入回收站 */
  handleDelete: (id: string) => void
  /** 直接从回收站删除，不再二次确认（供右键「彻底删除」在已确认后调用） */
  handlePurge: (id: string) => void
  /** 把回收站里的一篇文档按原 id 放回 */
  handleRestore: (id: string) => void
  handleRename: (id: string, title: string) => void
  handleContentChange: (content: string) => void
  handleExport: (note?: NoteItem) => Promise<void>
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
  // 含墓碑的完整列表（合并与持久化需要它），对外暴露的是过滤后的 folders
  const [allFolders, setAllFolders] = useState<FolderItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [scope, setScope] = useState<NoteScope>({ type: 'all' })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [message, setMessage] = useState('已保存')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [splitPercent, setSplitPercent] = useState<number>(50)
  const [statusCounter, setStatusCounter] = useState({ words: 0, lines: 0 })

  // Cloudflare 备份与同步状态
  const [cfConfig, setCfConfig] = useState<CloudflareSyncConfig>(DEFAULT_CF_CONFIG)
  const [cfSyncStatus, setCfSyncStatus] = useState<CfSyncStatus>('idle')
  const [cfSyncMessage, setCfSyncMessage] = useState<string>('')
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([])

  const saveTimerRef = useRef<number | null>(null)
  const cfAutoSyncTimerRef = useRef<number | null>(null)
  const stateRef = useRef<NotesState>({ notes: [], folders: [], activeId: null })
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
      setAllFolders(state.folders)
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
          // 开机同步正是「换台机器接着用」的场景，设置要一并落回本地
          let appliedSettings = 0
          if (res.remoteSettings) {
            appliedSettings = await applySettings(res.remoteSettings)
          }
          const { mergedState, addedFromRemote, updatedFromRemote, removedFolders } =
            smartMergeNotes(stateRef.current, res.remoteState)
          setNotes(mergedState.notes)
          setAllFolders(mergedState.folders)
          setActiveId(mergedState.activeId)
          stateRef.current = mergedState
          await saveNotesState(mergedState)
          const now = Date.now()
          const updatedCfg = { ...cfg, lastSyncTime: now }
          setCfConfig(updatedCfg)
          await saveCloudflareConfig(updatedCfg)
          setCfSyncStatus('success')
          setCfSyncMessage(
            `启动同步完成：新增 ${addedFromRemote} 篇，更新 ${updatedFromRemote} 篇` +
              // 文件夹在别处被删会让一批文档落回未分类，值得单独说一句
              (removedFolders > 0 ? `，${removedFolders} 个文件夹已被其他设备删除` : '') +
              (appliedSettings > 0 ? `，已恢复 ${appliedSettings} 项设置` : '')
          )
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
      setAllFolders(next.folders)
      setActiveId(next.activeId)
      persist(next, immediate)
    },
    [persist]
  )

  /* 活动文档必须还在（不是回收站里的）：被删进回收站的那一瞬 activeId 会被顺移，
     但同步合并等路径可能把 activeId 指到一篇已删文档上，这里兜一层 */
  const activeNote = useMemo(() => {
    if (!activeId) return null
    const found = notes.find((note) => note.id === activeId)
    return found && !found.deletedAt ? found : null
  }, [notes, activeId])

  const trashed = useMemo(() => trashedNotes(notes), [notes])

  const aliveCount = useMemo(() => visibleNotes(notes).length, [notes])

  /* 对外只给未删除的文件夹：墓碑是实现细节，UI 不该看见它们 */
  const folders = useMemo(() => visibleFolders(allFolders), [allFolders])

  /*
   * 当前所在的文件夹被删掉时把视图退回「全部」。
   *
   * 放在这里而不是各个删除动作里 —— 文件夹消失的路径不止一条：
   * 本机删除、云同步合并时对端删的、覆盖式拉取整份换掉。
   * 只盯着本机那条会让用户在同步之后停在一个已经不存在的文件夹里。
   */
  useEffect(() => {
    if (scope.type !== 'folder') return
    if (!folders.some((folder) => folder.id === scope.folderId)) {
      setScope({ type: 'all' })
    }
  }, [folders, scope])

  /**
   * 侧栏列表数据源。范围（全部 / 书签 / 某文件夹 / 回收站）先过一遍，
   * 再套关键词，最后统一按「书签优先 + 更新时间倒序」排。
   * 关键词命中标题或正文，与旧行为一致。
   */
  const filteredNotes = useMemo(() => {
    const base =
      scope.type === 'trash'
        ? trashed
        : visibleNotes(notes).filter((note) => {
            if (scope.type === 'folder') return note.folderId === scope.folderId
            // 书签视图跨文件夹，只按收藏与否筛
            if (scope.type === 'bookmarks') return Boolean(note.bookmarked)
            return true
          })

    const q = keyword.trim().toLowerCase()
    const matched = q
      ? base.filter(
          (note) =>
            note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q)
        )
      : base

    // 回收站按删除时间排（trashedNotes 已经排好），其余走统一口径
    return scope.type === 'trash' ? matched : sortNotes(matched)
  }, [notes, trashed, scope, keyword])

  const handleCreate = useCallback(
    (folderId?: string | null) => {
      const newDoc = createEmptyNote({
        title: '未命名笔记 ' + (visibleNotes(notes).length + 1),
        content: '# 未命名笔记\n\n开始记录你的思路...\n',
        folderId: folderId ?? null,
        /*
         * 在书签视图里新建就顺手加书签。否则新文档不带书签、被当前视图过滤掉，
         * 用户点了「新建」却什么也没出现，像是按钮坏了。
         */
        bookmarked: scope.type === 'bookmarks' ? true : undefined,
      })
      updateState(
        (prev) => ({
          ...prev,
          notes: [newDoc, ...prev.notes],
          activeId: newDoc.id,
        }),
        true
      )
    },
    [notes, scope, updateState]
  )

  /** 快速打开或创建「全功能与工具支持全景样板」文档 */
  const handleOpenSampleNote = useCallback(() => {
    const existing = stateRef.current.notes.find(
      (n) =>
        n.title.includes('全景样板') ||
        n.title.includes('全特性') ||
        n.content.includes('Markdown 全特性与工具支持全景样板')
    )
    // 书签视图下「样板」也该留在当前列表里，否则打开后它不出现，像是没生效
    const bookmarkIt = scope.type === 'bookmarks'

    if (existing) {
      updateState(
        (prev) => ({
          ...prev,
          activeId: existing.id,
          notes: bookmarkIt
            ? prev.notes.map((n) => (n.id === existing.id ? { ...n, bookmarked: true } : n))
            : prev.notes,
        }),
        true
      )
      return
    }

    const sampleDoc = createEmptyNote({
      title: '✨ Markdown 全特性与工具支持全景样板',
      content: DEFAULT_CONTENT,
      bookmarked: bookmarkIt ? true : undefined,
    })
    updateState(
      (prev) => ({
        ...prev,
        notes: [sampleDoc, ...prev.notes],
        activeId: sampleDoc.id,
      }),
      true
    )
  }, [scope, updateState])

  const handleSelect = useCallback(
    (id: string) => {
      if (id === activeId) return
      updateState((prev) => ({ ...prev, activeId: id }), true)
    },
    [activeId, updateState]
  )

  /**
   * 删除 = 软删除（移入回收站）。不再要求「至少保留一篇」——
   * 删光了列表空着也没关系，回收站里都还在；要真正腾空间走回收站的彻底删除。
   *
   * activeId 顺移到「原位置的下一个可见文档」（不足则取上一个），
   * 而不是整个知识库排完序的第一篇 —— 后者会让删完瞬间跳到某个书签文档上，
   * 与用户当时列表里看到的位置对不上。
   */
  const handleDelete = useCallback(
    (id: string) => {
      const target = stateRef.current.notes.find((note) => note.id === id)
      if (!target || target.deletedAt) return

      updateState((prev) => {
        const nextNotes = prev.notes.map((note) =>
          note.id === id
            ? { ...note, deletedAt: Date.now(), bookmarked: false }
            : note
        )

        let nextActive = prev.activeId
        if (prev.activeId === id) {
          // 按当前列表口径排出「删除前」的视图顺序，定位被删文档当时在第几位
          const orderBefore = sortNotes(
            visibleNotes(prev.notes).filter((note) => note.folderId === target.folderId)
          )
          const goneIndex = orderBefore.findIndex((note) => note.id === id)
          const nextInPlace = orderBefore[goneIndex + 1]
          const prevInPlace = orderBefore[goneIndex - 1]
          const fallback = sortNotes(visibleNotes(nextNotes))[0]
          // 优先「原位置下一项」，被删的正好是最后一项才回退到上一项
          nextActive = (nextInPlace || prevInPlace || fallback)?.id ?? null
        }
        return { ...prev, notes: nextNotes, activeId: nextActive }
      }, true)
    },
    [updateState]
  )

  /** 从回收站彻底删除（调用方负责先确认） */
  const handlePurge = useCallback(
    (id: string) => {
      updateState((prev) => {
        const nextNotes = prev.notes.filter((note) => note.id !== id)
        // 彻底删掉的正好是当前活动文档时顺移，否则 activeId 会悬空一整个会话
        const nextActive =
          prev.activeId === id
            ? sortNotes(visibleNotes(nextNotes))[0]?.id ?? null
            : prev.activeId
        return { ...prev, notes: nextNotes, activeId: nextActive }
      }, true)
    },
    [updateState]
  )

  /**
   * 还原：清掉 deletedAt 并激活它。软删除保留了 folderId，所以归属原样回去。
   *
   * 刻意**不**离开回收站视图 —— 还原常常是连着做的（清一批误删的），
   * 每还原一篇就被踢回「全部」得重新点进来，很难用。
   * 这里只把它从当前列表里移除（它已不再是回收站文档），视图留在原地。
   */
  const handleRestore = useCallback(
    (id: string) => {
      updateState(
        (prev) => ({
          ...prev,
          notes: prev.notes.map((note) =>
            note.id === id ? { ...note, deletedAt: undefined } : note
          ),
          activeId: id,
        }),
        true
      )
    },
    [updateState]
  )

  const handleEmptyTrash = useCallback(() => {
    updateState((prev) => {
      const nextNotes = prev.notes.filter((note) => !note.deletedAt)
      return {
        ...prev,
        notes: nextNotes,
        activeId:
          prev.activeId && nextNotes.some((note) => note.id === prev.activeId)
            ? prev.activeId
            : sortNotes(visibleNotes(nextNotes))[0]?.id ?? null,
      }
    }, true)
  }, [updateState])

  /** 书签开关。取消书签时不动 updatedAt —— 它不是内容变更，不该顶到列表前面 */
  const handleToggleBookmark = useCallback(
    (id: string) => {
      updateState((prev) => ({
        ...prev,
        notes: prev.notes.map((note) =>
          note.id === id ? { ...note, bookmarked: !note.bookmarked } : note
        ),
      }))
    },
    [updateState]
  )

  /**
   * 保存一条阅读位置书签。同 id 覆盖，否则追加。
   *
   * 与归类同理，**刻意不动 updatedAt** —— 记一次书签不是内容变更，不该把这篇
   * 顶到列表最前，更不该白白触发一次云端内容合并。合并时按各自的 bookmark.at 单独比。
   * 落盘走立即写：记完书签往往就直接关窗口了，防抖窗口内退出会把这次记录丢掉。
   */
  const handleSaveReadingBookmark = useCallback(
    (noteId: string, bookmark: ReadingBookmark) => {
      updateState(
        (prev) => ({
          ...prev,
          notes: prev.notes.map((note) => {
            if (note.id !== noteId) return note
            const rest = (note.readingBookmarks ?? []).filter((item) => item.id !== bookmark.id)
            // 最近记的排在最前，与合并函数给出的顺序一致
            return { ...note, readingBookmarks: [bookmark, ...rest] }
          }),
        }),
        true
      )
    },
    [updateState]
  )

  const handleDeleteReadingBookmark = useCallback(
    (noteId: string, bookmarkId: string) => {
      updateState(
        (prev) => ({
          ...prev,
          notes: prev.notes.map((note) => {
            if (note.id !== noteId) return note
            const rest = (note.readingBookmarks ?? []).filter((item) => item.id !== bookmarkId)
            // 空数组不写出去，与 normalizeState 的口径一致
            return { ...note, readingBookmarks: rest.length ? rest : undefined }
          }),
        }),
        true
      )
    },
    [updateState]
  )

  /**
   * 移动到文件夹；folderId 传 null 表示移出到未分类。
   *
   * 刻意不动 updatedAt —— 归类不是内容变更，不该把文档顶到列表最前。
   * 改用 folderMovedAt 单独记录归类时间，合并时按它逐字段比，
   * 这样远端拖进文件夹的动作不会丢，本地的归类也不会被内容更新盖掉。
   */
  const handleMoveToFolder = useCallback(
    (id: string, folderId: string | null) => {
      updateState((prev) => ({
        ...prev,
        notes: prev.notes.map((note) =>
          note.id === id ? { ...note, folderId, folderMovedAt: Date.now() } : note
        ),
      }))
    },
    [updateState]
  )

  // ================= 文件夹 =================
  const handleCreateFolder = useCallback(
    (name?: string) => {
      /*
       * id 要在**这里**定下来、而不是在 updater 里，因为调用方要靠返回的 id
       * 立刻进入改名态（见 NotesSidebar.newFolder）。
       *
       * 跟完整列表（含墓碑）比 —— 墓碑永久保留，若新文件夹恰好撞上某个墓碑的 id，
       * 同一 id 会同时存在存活与墓碑两条：合并按 id 覆盖，React 的 key 也会重复。
       * 撞了就换一个再试（现实中几乎不会发生，是兜底）。
       */
      const taken = new Set(stateRef.current.folders.map((item) => item.id))
      let folder = createFolder(name ?? `新建文件夹 ${folders.length + 1}`)
      for (let guard = 0; taken.has(folder.id) && guard < 10; guard++) {
        folder = createFolder(folder.name)
      }
      const created = folder
      updateState((prev) => ({ ...prev, folders: [...prev.folders, created] }), true)
      return created.id
    },
    [folders.length, updateState]
  )

  const handleRenameFolder = useCallback(
    (id: string, name: string) => {
      const next = name.trim().slice(0, 40)
      if (!next) return
      // 必须推进 updatedAt：合并靠它判「谁的名字更新」，否则改名在另一端会被当成旧数据
      updateState((prev) => ({
        ...prev,
        folders: prev.folders.map((folder) =>
          folder.id === id ? { ...folder, name: next, updatedAt: Date.now() } : folder
        ),
      }))
    },
    [updateState]
  )

  /**
   * 删除文件夹：里面的文档归还「未分类」而不是一起删掉。
   * 文件夹只是个标签，误删文件夹连坐几十篇文档是不可接受的。
   *
   * 删的是**标记**不是条目 —— 条目留在数组里当墓碑，合并时才能告诉另一台
   * 「这个文件夹是被删了」，否则对面那份活着的老数据会把它复活。
   */
  const handleDeleteFolder = useCallback(
    (id: string) => {
      // 一次会改写这个文件夹下的全部文档，走立即落盘而不是 400ms 防抖 ——
      // 延迟窗口内退出会把「指向已删文件夹」的 folderId 留在本地
      updateState((prev) => ({
        ...prev,
        folders: prev.folders.map((folder) =>
          folder.id === id ? { ...folder, deletedAt: Date.now(), updatedAt: Date.now() } : folder
        ),
        notes: prev.notes.map((note) =>
          // 一并推进 folderMovedAt，否则这次「清空归属」会被远端更旧的归类盖回去
          note.folderId === id
            ? { ...note, folderId: null, folderMovedAt: Date.now() }
            : note
        ),
      }), true)
      setScope((prev) =>
        prev.type === 'folder' && prev.folderId === id ? { type: 'all' } : prev
      )
    },
    [updateState]
  )

  // 重命名文档:标题一旦手动指定,此后不再随正文首行变化
  const handleRename = useCallback(
    (id: string, title: string) => {
      const next = title.trim().slice(0, 80)
      const target = stateRef.current.notes.find((note) => note.id === id)
      if (!target || target.deletedAt || !next || target.title === next) return
      updateState(
        (prev) => ({
          ...prev,
          notes: prev.notes.map((note) => (note.id === id ? { ...note, title: next } : note)),
        }),
        true
      )
    },
    [updateState]
  )

  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeId) return
      // 若当前笔记内容未发生任何改变，坚决不触发 updatedAt 更新与自动保存，防止切笔记时目录误跳动
      const currentNote = stateRef.current.notes.find((note) => note.id === activeId)
      if (!currentNote || currentNote.deletedAt) return
      if (currentNote.content === content) return

      updateState((prev) => {
        const target = prev.notes.find((note) => note.id === activeId)
        if (!target || target.content === content) return prev

        return {
          ...prev,
          notes: prev.notes.map((note) =>
            note.id === activeId
              ? {
                  ...note,
                  content,
                  updatedAt: Date.now(),
                }
              : note
          ),
        }
      })
    },
    [activeId, updateState]
  )

  // 未传参时导出当前文档;右键菜单可显式指定要导出的文档
  const handleExport = useCallback(async (target?: NoteItem) => {
    const note = target ?? activeNote
    if (!note) return
    const defaultName = `${note.title || '未命名笔记'}.md`
    try {
      if (window.electronAPI?.notesSaveFile) {
        const result = await window.electronAPI.notesSaveFile({
          content: note.content,
          defaultPath: defaultName,
        })
        if (!result) return
        return
      }

      const blob = new Blob([note.content], { type: 'text/markdown;charset=utf-8;' })
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
      // 标题优先取文件名(而非正文首行),导入后用户也可随时自定义
      const nameTitle = file.name.replace(/\.(md|markdown|txt)$/i, '').trim()
      const fallbackTitle = nameTitle || deriveTitleFromMarkdown(content, '未命名笔记')
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
                      title: note.title || fallbackTitle,
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
          title: fallbackTitle,
          content,
          sourcePath: file.path,
          sourceMtime: mtime,
        })
        updateState(
          (prev) => ({
            ...prev,
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
        const fileNameTitle = file.name.replace(/\.(md|markdown|txt)$/i, '').trim()
        const note = createEmptyNote({
          title: fileNameTitle || deriveTitleFromMarkdown(content, '未命名笔记'),
          content,
        })
        updateState(
          (prev) => ({
            ...prev,
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

      /*
       * 设置从云端写回本地。
       *
       * 放在笔记处理之前：设置里包含主题、快捷键这些「下次进入就该生效」的
       * 项，笔记合并失败也不该把它们漏掉。
       *
       * 只有拉到设置时才写 —— 旧版本推的备份没有这个字段，不能因为「远端
       * 没有」就把本地设置清空。
       */
      let appliedSettings = 0
      if (res.remoteSettings) {
        appliedSettings = await applySettings(res.remoteSettings)
      }

      if (mode === 'merge') {
        const { mergedState, addedFromRemote, updatedFromRemote, removedFolders } =
          smartMergeNotes(stateRef.current, res.remoteState)
        setNotes(mergedState.notes)
        setAllFolders(mergedState.folders)
        setActiveId(mergedState.activeId)
        stateRef.current = mergedState
        await saveNotesState(mergedState)
        const now = Date.now()
        const nextCfg = { ...cfConfig, lastSyncTime: now }
        setCfConfig(nextCfg)
        await saveCloudflareConfig(nextCfg)
        setCfSyncStatus('success')
        const msg =
          `合并成功：新增 ${addedFromRemote} 篇，更新 ${updatedFromRemote} 篇` +
          (removedFolders > 0 ? `，${removedFolders} 个文件夹已被其他设备删除` : '') +
          (appliedSettings > 0 ? `，已恢复 ${appliedSettings} 项设置` : '')
        setCfSyncMessage(msg)
        return { success: true, message: msg, remoteTime: res.remoteTime }
      } else {
        /*
         * 覆盖：云端整份替换本地。文件夹也一起换 —— 覆盖的语义就是「完全听云端的」，
         * 这里若还保留本地 folders，就会留下「云端的文档 + 本地的文件夹」这种
         * 半吊子状态，文档的 folderId 大量对不上而全部落回未分类。
         */
        const overwritten: NotesState = {
          ...res.remoteState,
          folders: res.remoteState.folders || [],
        }
        setNotes(overwritten.notes)
        setAllFolders(overwritten.folders)
        setActiveId(overwritten.activeId)
        stateRef.current = overwritten
        await saveNotesState(overwritten)
        const now = Date.now()
        const nextCfg = { ...cfConfig, lastSyncTime: now }
        setCfConfig(nextCfg)
        await saveCloudflareConfig(nextCfg)
        setCfSyncStatus('success')
        const msg =
          `覆盖成功：已恢复 ${overwritten.notes.length} 篇文档` +
          (appliedSettings > 0 ? `，已恢复 ${appliedSettings} 项设置` : '')
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

      /*
       * 文件夹一起回滚：快照是「整份状态」，只回滚文档不回滚文件夹会留下
       * 「旧文档 + 新文件夹」的错位。
       *
       * 但 folders 字段是后加的，老快照里可能根本没存（undefined）。
       * 那种情况保留当前文件夹 —— 总好过把用户的文件夹一次清空。
       */
      const restored: NotesState = {
        ...target.state,
        folders: Array.isArray(target.state.folders)
          ? target.state.folders
          : stateRef.current.folders,
      }
      setNotes(restored.notes)
      setAllFolders(restored.folders)
      setActiveId(restored.activeId)
      stateRef.current = restored
      await saveNotesState(restored)
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
        trashed,
        aliveCount,
        scope,
        setScope,
        folders,
        handleCreateFolder,
        handleRenameFolder,
        handleDeleteFolder,
        handleToggleBookmark,
        handleMoveToFolder,
        handleSaveReadingBookmark,
        handleDeleteReadingBookmark,
        handleRestoreFromTrash: handleRestore,
        handlePurgeFromTrash: handlePurge,
        handleEmptyTrash,
        handleCreate,
        handleOpenSampleNote,
        handleSelect,
        handleDelete,
        handlePurge,
        handleRestore,
        handleRename,
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
