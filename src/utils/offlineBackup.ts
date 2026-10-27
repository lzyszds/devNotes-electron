import JSZip from 'jszip'
import {
  loadNotesState,
  saveNotesState,
  type NotesState,
  type NoteItem,
  type FolderItem,
} from './notesStore'
import {
  SNIPPETS_STORE_KEY,
  reloadSnippets,
  type Snippet,
} from '../components/modules/snippets/useSnippets'

/** 备份清单元数据 */
export interface BackupManifest {
  app: string
  version: string
  createdAt: number
  notesCount: number
  foldersCount: number
  snippetsCount: number
  historiesCount: number
}

/** 备份中包含的所有工具历史 Key */
export const BACKUP_TOOL_HISTORY_KEYS = [
  'history-text-translate',
  'history-encode',
  'history-json-diff',
  'history-json-format',
  'history-json-i18n',
  'history-password',
  'history-qrcode',
  'history-regexp',
  'history-timestamp',
  'history-websocket',
  'history-color-palette',
]

/** 备份中包含的系统设置 Key */
export const BACKUP_SETTING_KEYS = [
  'ai-channel-config',
  'fehelper-shortcuts',
  'devnotes-code-block-theme',
  'fehelper-translate-config',
]

/** 辅助：下载 Blob 文件 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 格式化日期时间用于备份文件名（如 2026-10-27_16-30-00） */
function getBackupTimestampString(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const Y = now.getFullYear()
  const M = pad(now.getMonth() + 1)
  const D = pad(now.getDate())
  const h = pad(now.getHours())
  const m = pad(now.getMinutes())
  const s = pad(now.getSeconds())
  return `${Y}-${M}-${D}_${h}-${m}-${s}`
}

/**
 * 一键将全站数据打包导出为离线 ZIP 归档。
 */
export async function exportOfflineBackupZip(): Promise<{
  filename: string
  notesCount: number
  snippetsCount: number
  historiesCount: number
}> {
  const zip = new JSZip()

  // 1. 采集 Markdown 笔记
  const notesState = await loadNotesState()
  const notes = notesState.notes || []
  const folders = notesState.folders || []

  const notesFolder = zip.folder('notes')!
  notesFolder.file('notes-meta.json', JSON.stringify(notesState, null, 2))

  notes.forEach((note) => {
    const safeTitle = (note.title || 'untitled')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 50)
    const filename = `${safeTitle || 'note'}_${note.id.slice(0, 6)}.md`
    const frontmatter = [
      '---',
      `id: "${note.id}"`,
      `title: "${(note.title || '').replace(/"/g, '\\"')}"`,
      `createdAt: ${note.createdAt}`,
      `updatedAt: ${note.updatedAt}`,
      `bookmarked: ${Boolean(note.bookmarked)}`,
      note.folderId ? `folderId: "${note.folderId}"` : null,
      '---',
      '',
      note.content || '',
    ]
      .filter((line) => line !== null)
      .join('\n')

    notesFolder.file(filename, frontmatter)
  })

  // 2. 采集代码片段库
  let snippets: Snippet[] = []
  try {
    const saved = await window.electronAPI?.storeGet(SNIPPETS_STORE_KEY)
    if (Array.isArray(saved)) snippets = saved
  } catch {
    // ignore
  }
  const snippetsFolder = zip.folder('snippets')!
  snippetsFolder.file('snippets.json', JSON.stringify(snippets, null, 2))

  // 3. 采集各工具历史记录
  const histories: Record<string, unknown> = {}
  let totalHistoryItems = 0
  for (const key of BACKUP_TOOL_HISTORY_KEYS) {
    try {
      const data = await window.electronAPI?.storeGet(key)
      if (Array.isArray(data) && data.length > 0) {
        histories[key] = data
        totalHistoryItems += data.length
      }
    } catch {
      // ignore
    }
  }
  const historyFolder = zip.folder('history')!
  historyFolder.file('histories.json', JSON.stringify(histories, null, 2))

  // 4. 采集系统设置
  const settings: Record<string, unknown> = {}
  for (const key of BACKUP_SETTING_KEYS) {
    try {
      const data = await window.electronAPI?.storeGet(key)
      if (data !== undefined && data !== null) {
        settings[key] = data
      } else {
        const local = localStorage.getItem(key)
        if (local) {
          try {
            settings[key] = JSON.parse(local)
          } catch {
            settings[key] = local
          }
        }
      }
    } catch {
      // ignore
    }
  }
  const settingsFolder = zip.folder('settings')!
  settingsFolder.file('settings.json', JSON.stringify(settings, null, 2))

  // 5. 写入清单 Manifest
  const manifest: BackupManifest = {
    app: 'devNotes',
    version: '2.0',
    createdAt: Date.now(),
    notesCount: notes.length,
    foldersCount: folders.length,
    snippetsCount: snippets.length,
    historiesCount: totalHistoryItems,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  // 6. 生成 Zip 二进制并下载
  const content = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const filename = `devnotes-backup-${getBackupTimestampString()}.zip`
  downloadBlob(content, filename)

  return {
    filename,
    notesCount: notes.length,
    snippetsCount: snippets.length,
    historiesCount: totalHistoryItems,
  }
}

/** 预读并校验备份包信息 */
export async function previewBackupZip(file: File): Promise<BackupManifest> {
  const zip = await JSZip.loadAsync(file)

  const manifestFile = zip.file('manifest.json')
  if (manifestFile) {
    const text = await manifestFile.async('text')
    try {
      const parsed = JSON.parse(text) as BackupManifest
      if (parsed.app === 'devNotes') return parsed
    } catch {
      // ignore
    }
  }

  // 兜底：若没有标准 manifest，手动探查内部文件数量
  let notesCount = 0
  let snippetsCount = 0

  const notesMetaFile = zip.file('notes/notes-meta.json')
  if (notesMetaFile) {
    try {
      const meta = JSON.parse(await notesMetaFile.async('text'))
      notesCount = Array.isArray(meta.notes) ? meta.notes.length : 0
    } catch {
      // ignore
    }
  }

  const snippetsFile = zip.file('snippets/snippets.json')
  if (snippetsFile) {
    try {
      const snips = JSON.parse(await snippetsFile.async('text'))
      snippetsCount = Array.isArray(snips) ? snips.length : 0
    } catch {
      // ignore
    }
  }

  return {
    app: 'devNotes',
    version: '1.0',
    createdAt: file.lastModified || Date.now(),
    notesCount,
    foldersCount: 0,
    snippetsCount,
    historiesCount: 0,
  }
}

/**
 * 导入并还原备份包。
 *
 * @param file 上传的 zip 归档
 * @param mode 'merge'（合并导入，保留现有并去重追加）或 'overwrite'（完全替换还原）
 */
export async function importOfflineBackupZip(
  file: File,
  mode: 'merge' | 'overwrite' = 'merge'
): Promise<{
  notesCount: number
  snippetsCount: number
  historiesCount: number
}> {
  const zip = await JSZip.loadAsync(file)

  let importedNotes = 0
  let importedSnippets = 0
  let importedHistories = 0

  // 1. 还原 Markdown 笔记
  const notesMetaFile = zip.file('notes/notes-meta.json')
  if (notesMetaFile) {
    const text = await notesMetaFile.async('text')
    try {
      const backupNotesState = JSON.parse(text) as NotesState
      const backupNotes: NoteItem[] = backupNotesState.notes || []
      const backupFolders: FolderItem[] = backupNotesState.folders || []

      if (mode === 'overwrite') {
        await saveNotesState(backupNotesState)
        importedNotes = backupNotes.length
      } else {
        // 合并模式：以 id 为键合并，更新时间较新的胜出
        const currentState = await loadNotesState()
        const noteMap = new Map<string, NoteItem>()
        currentState.notes.forEach((n) => noteMap.set(n.id, n))
        backupNotes.forEach((n) => {
          const exist = noteMap.get(n.id)
          if (!exist || (n.updatedAt && n.updatedAt > (exist.updatedAt || 0))) {
            noteMap.set(n.id, n)
          }
        })

        const folderMap = new Map<string, FolderItem>()
        currentState.folders.forEach((f) => folderMap.set(f.id, f))
        backupFolders.forEach((f) => folderMap.set(f.id, f))

        const mergedNotes = Array.from(noteMap.values())
        const mergedFolders = Array.from(folderMap.values())

        await saveNotesState({
          ...currentState,
          notes: mergedNotes,
          folders: mergedFolders,
        })
        importedNotes = backupNotes.length
      }
    } catch (e) {
      console.error('还原笔记失败:', e)
    }
  }

  // 2. 还原代码片段
  const snippetsFile = zip.file('snippets/snippets.json')
  if (snippetsFile) {
    const text = await snippetsFile.async('text')
    try {
      const backupSnippets = JSON.parse(text) as Snippet[]
      if (Array.isArray(backupSnippets)) {
        if (mode === 'overwrite') {
          await window.electronAPI?.storeSet(SNIPPETS_STORE_KEY, backupSnippets)
          importedSnippets = backupSnippets.length
        } else {
          let currentSnippets: Snippet[] = []
          try {
            const cur = await window.electronAPI?.storeGet(SNIPPETS_STORE_KEY)
            if (Array.isArray(cur)) currentSnippets = cur
          } catch {
            // ignore
          }
          const snipMap = new Map<string, Snippet>()
          currentSnippets.forEach((s) => snipMap.set(s.id, s))
          backupSnippets.forEach((s) => snipMap.set(s.id, s))
          const merged = Array.from(snipMap.values())
          await window.electronAPI?.storeSet(SNIPPETS_STORE_KEY, merged)
          importedSnippets = backupSnippets.length
        }
        await reloadSnippets()
      }
    } catch (e) {
      console.error('还原代码片段失败:', e)
    }
  }

  // 3. 还原各工具历史记录
  const historyFile = zip.file('history/histories.json')
  if (historyFile) {
    const text = await historyFile.async('text')
    try {
      const backupHistories = JSON.parse(text) as Record<string, unknown[]>
      for (const [key, items] of Object.entries(backupHistories)) {
        if (!Array.isArray(items)) continue
        if (mode === 'overwrite') {
          await window.electronAPI?.storeSet(key, items)
          importedHistories += items.length
        } else {
          let current: any[] = []
          try {
            const cur = await window.electronAPI?.storeGet(key)
            if (Array.isArray(cur)) current = cur
          } catch {
            // ignore
          }
          const existingIds = new Set(current.map((c) => c?.id))
          const additions = (items as Array<{ id?: string }>).filter(
            (item) => item?.id && !existingIds.has(item.id)
          )
          const merged = [...current, ...additions].slice(0, 50)
          await window.electronAPI?.storeSet(key, merged)
          importedHistories += additions.length
        }
      }
    } catch (e) {
      console.error('还原工具历史失败:', e)
    }
  }

  // 4. 还原配置
  const settingsFile = zip.file('settings/settings.json')
  if (settingsFile) {
    const text = await settingsFile.async('text')
    try {
      const backupSettings = JSON.parse(text) as Record<string, unknown>
      for (const [key, val] of Object.entries(backupSettings)) {
        await window.electronAPI?.storeSet(key, val)
        if (typeof val === 'string') {
          localStorage.setItem(key, val)
        } else {
          localStorage.setItem(key, JSON.stringify(val))
        }
      }
    } catch (e) {
      console.error('还原设置失败:', e)
    }
  }

  return {
    notesCount: importedNotes,
    snippetsCount: importedSnippets,
    historiesCount: importedHistories,
  }
}
