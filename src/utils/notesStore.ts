export interface NoteItem {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  // 来源磁盘文件(通过文件关联/导入打开时记录,用于去重与磁盘更新检测)
  sourcePath?: string
  sourceMtime?: number
}

export interface NotesState {
  notes: NoteItem[]
  activeId: string | null
}

const STORE_KEY = 'fehelper-markdown-notes'
const LEGACY_LOCAL_KEY = 'fehelper-markdown-notes'

const DEFAULT_CONTENT = `### 欢迎使用 Markdown 笔记

这是一款基于现代设计语言重构的轻量级 Markdown 工作台。支持实时双向渲染、Mermaid 矢量图编译与本地持久化。

\`\`\`mermaid
sequenceDiagram
    autonumber
    actor 开发者 as 💻 开发者
    participant 编辑器 as 📝 现代工作台
    participant 编译器 as ⚡ Marked/Mermaid
    
    开发者->>编辑器: 输入 Markdown / 图表代码
    编辑器->>编译器: 触发防抖编译 (Debounce)
    编译器-->>编辑器: 渲染矢量图与排版
    编辑器-->>开发者: 实时双栏反馈
\`\`\`

## 快捷功能特性
1. **真实图表解析**：支持标准 Mermaid 语法与 Cherry 矢量引擎。
2. **Timeline 时间线**：支持节点状态与脉冲动画标记。
3. **全局快捷键**：按下 \`⌘K\` 或 \`Ctrl+K\` 呼出指令浮窗。

::: timeline 项目推进时间线
:: [done] 2024-01-15 项目立项
  完成需求评审
:: [doing] 2024-03-20 Alpha 版本
  正在联调
:: [todo] 2024-06-01 正式上线
:: [error] 2024-07-01 严重回滚事件
:: [milestone] 2024-08-01 用户破万
:::

\`\`\`javascript
// 简单示例代码
const app = new DevNotes({
  theme: 'modern-slate',
  autoSave: true
});
console.log('Happy Writing!');
\`\`\`
`

function createId() {
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyNote(partial?: Partial<NoteItem>): NoteItem {
  const now = Date.now()
  return {
    id: createId(),
    title: partial?.title || '未命名笔记',
    content: partial?.content ?? DEFAULT_CONTENT,
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
    sourcePath: partial?.sourcePath,
    sourceMtime: partial?.sourceMtime,
  }
}

export function deriveTitleFromMarkdown(content: string, fallback = '未命名笔记') {
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/)
    if (heading?.[1]) {
      return heading[1].trim().slice(0, 80) || fallback
    }
    return trimmed.replace(/^[-*+>\s`#]+/, '').slice(0, 80) || fallback
  }
  return fallback
}

function normalizeState(raw: unknown): NotesState {
  if (!raw || typeof raw !== 'object') {
    const note = createEmptyNote()
    return { notes: [note], activeId: note.id }
  }

  const data = raw as Partial<NotesState>
  const notes = Array.isArray(data.notes)
    ? data.notes
        .filter((item): item is NoteItem => Boolean(item && typeof item.id === 'string'))
        .map((item) => ({
          id: item.id,
          title: item.title || deriveTitleFromMarkdown(item.content || ''),
          content: typeof item.content === 'string' ? item.content : '',
          createdAt: item.createdAt || Date.now(),
          updatedAt: item.updatedAt || Date.now(),
          // 透传来源文件字段,否则保存重载后去重信息会丢失
          ...(typeof item.sourcePath === 'string' ? { sourcePath: item.sourcePath } : {}),
          ...(typeof item.sourceMtime === 'number' ? { sourceMtime: item.sourceMtime } : {}),
        }))
    : []

  if (notes.length === 0) {
    const note = createEmptyNote()
    return { notes: [note], activeId: note.id }
  }

  const activeId =
    data.activeId && notes.some((note) => note.id === data.activeId)
      ? data.activeId
      : notes[0].id

  return { notes, activeId }
}

async function readFromElectron(): Promise<NotesState | null> {
  try {
    if (!window.electronAPI?.storeGet) return null
    const raw = await window.electronAPI.storeGet(STORE_KEY)
    return raw == null ? null : normalizeState(raw)
  } catch {
    return null
  }
}

function readFromLocalStorage(): NotesState | null {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_KEY)
    if (!raw) return null
    return normalizeState(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function loadNotesState(): Promise<NotesState> {
  const fromElectron = await readFromElectron()
  if (fromElectron) return fromElectron

  const fromLocal = readFromLocalStorage()
  if (fromLocal) {
    await saveNotesState(fromLocal)
    return fromLocal
  }

  const note = createEmptyNote()
  const initial = { notes: [note], activeId: note.id }
  await saveNotesState(initial)
  return initial
}

export async function saveNotesState(state: NotesState): Promise<void> {
  const payload = normalizeState(state)
  try {
    if (window.electronAPI?.storeSet) {
      await window.electronAPI.storeSet(STORE_KEY, payload)
    }
  } catch {
    // fallback below
  }

  try {
    localStorage.setItem(LEGACY_LOCAL_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota errors
  }
}
