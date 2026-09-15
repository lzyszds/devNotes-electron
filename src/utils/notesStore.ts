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

export const DEFAULT_CONTENT = `# ✨ Markdown 全特性与工具支持全景样板

欢迎使用现代 Markdown 工作台！本文档汇总了当前编辑器原生支持的**所有排版元素、快捷指令、格式化语法与开发工具特性**，方便您随时查阅与对照渲染效果。

[TOC]

---

## 一、 丰富排版与行内格式 (Typography)

* **粗体文本**：\`**加粗强调**\` ➔ **极客加粗文本**
* *斜体文本*：\`*斜体着重*\` ➔ *优雅倾斜字型*
* ~~删除线~~：\`~~删除线~~\` ➔ ~~已废弃或已完成任务~~
* <u>下划线</u>：\`<u>下划线</u>\` ➔ <u>重要重点提示</u>
* <mark>高亮标记</mark>：\`<mark>高亮文本</mark>\` ➔ <mark>醒目背景记号</mark>
* 上标与下标：\`x<sup>2</sup>\` ➔ x<sup>2</sup> + y<sup>2</sup> = r<sup>2</sup>；\`H<sub>2</sub>O\` ➔ H<sub>2</sub>O (水分子)
* 行内代码：\`\` \`const version = '2.0.0';\` \`\` ➔ \`const version = '2.0.0';\`（自动适配当前品牌主题色）
* 外部超链接：\`[DevNotes 官方仓库](https://github.com)\` ➔ [DevNotes 官方仓库](https://github.com)（点击可在系统外部浏览器中安全打开）

---

## 二、 交互式任务清单 (Task Lists / GFM)

支持鼠标直接点击切换完成状态，删除线伴随丝滑贝塞尔曲线划过：

- [x] 搭建现代流式分屏工作台布局与智能侧栏
- [x] 接入 Shiki 现代代码高亮引擎与 20 套深浅主题色板
- [x] 修复选中文本背景高亮与光标品牌色跟随
- [x] 支持 [TOC] 嵌入式目录大纲平滑跳转
- [x] 容器面板语法 ::: info 与手风琴折叠卡片 ::: accordion
- [ ] 接入多标签页快捷拖拽排序 (Tabs Drag & Drop)
- [ ] 支持本地 Markdown 批量导出为 PDF 与长图

---

## 三、 结构化多级列表 (Nested Lists)

### 1. 无序嵌套列表
* 核心工程架构
  * 前端基础设施
    * Vite 构建体系与 TailwindCSS 原子样式
    * Milkdown 所见即所得编辑引擎
  * 跨平台桌面端
    * Electron 主进程与 Preload 桥接安全隔离

### 2. 有序编号列表
1. 需求分析与架构评审
2. 交互原型与设计系统制定
3. 核心功能编码与模块测试
4. 打包分发与自动升级部署

---

## 四、 高级信息面板与容器语法 (Containers & Callouts)

同时支持两套主流语法，编辑器自动即时编译为高保真彩色卡片：

### 1. 容器块语法 (::: info / warning / tip / danger)

::: info 架构核心设计原则
工具的终极形态是“透明”——在开发者专注思考与创作时隐退于幕后，在需要辅助时一键触达。
:::

::: tip 生产力加速技巧
推荐使用 \`⌘K\` 唤出全局指令面板，可极速穿梭于各类开发小工具之间。
:::

::: warning 兼容性注意事项
在所见即所得模式下编辑时，系统会自动将扩展容器解析为标准结构，防止源码被误伤。
:::

::: danger 风险敏感操作
清空本地知识库快照属于不可逆行为，请提前在设置中配置 Cloudflare 云端同步。
:::

### 2. 手风琴折叠卡片 (::: accordion)

::: accordion 为什么选择多内核编辑器设计？
Milkdown（所见即所得）为日常写作与快速记录提供沉浸无干扰的排版视野；Cherry（双栏模式）为复杂语法精准排错与对照提供硬核支持。两者互为补充，自由切换。
:::

### 3. GitHub 标准 Alert 语法 (> [!NOTE])

> [!NOTE]
> **GitHub 官方标准**：在任何不支持扩展的纯文本环境中也能优雅降级为标准引用块。

> [!TIP]
> **最佳实践技巧**：推荐使用 \`⌘K\` 唤出全局指令面板，可极速穿梭于各类开发小工具之间。

> [!WARNING]
> **注意事项警告**：编辑含专有语法的历史文档时，请确保在标准 Markdown 规范下保存。

> [!CAUTION]
> **风险操作警示**：清空本地知识库快照属于不可逆行为，请提前在设置中配置 Cloudflare 云端同步。

### 4. 折叠内容用 ::: accordion

::: accordion 点这里展开（手风琴）
这里是折叠在面板内部的隐藏内容，支持存放较长的日志、排查记录或配置清单，保持笔记正文清爽整洁。
:::

---

## 五、 矢量图表与多维时间线 (Mermaid Diagrams & Timeline)

编辑器内置集成实时 Mermaid 矢量编译器，会自动将图表编译为高清矢量 SVG，并在右上角提供一键折叠/展开源码开关：

### 1. 架构流向流程图 (Flowchart)

\`\`\`mermaid
graph TD
    A[用户输入 Markdown] --> B{解析引擎判断}
    B -->|标准语法| C[Milkdown ProseMirror AST]
    B -->|代码块| D[Shiki 语法染色]
    B -->|图表/时间线| E[Mermaid 矢量编译器]
    C --> F[高保真交互画布]
    D --> F
    E --> F
\`\`\`

### 2. 交互式时序图 (Sequence Diagram)

\`\`\`mermaid
sequenceDiagram
    autonumber
    actor 开发者 as 💻 开发者
    participant 侧栏 as 📂 智能侧栏
    participant 编辑器 as 📝 工作台
    participant 云端 as ☁️ Cloudflare

    开发者->>侧栏: 选中知识库文档
    侧栏->>编辑器: 加载文档并挂载 ProseMirror
    开发者->>编辑器: 敲字编辑正文
    编辑器-->>云端: 防抖自动同步 (Auto Sync)
\`\`\`

### 3. 项目演进时间线 (Timeline)

\`\`\`mermaid
timeline
    title 2026 技术演进与架构重构里程碑
    2026 Q1 : 所见即所得编辑内核升级 : 品牌色治理与主题接入
    2026 Q2 : 动态双栏协同分屏工作台 : 性能调优 300%
    2026 Q3 : 全语法特性与矢量图表支持 : 多端增量云备份
\`\`\`

---

## 六、 多语言 Shiki 代码块高亮 (Code Blocks)

当前内置支持 TypeScript、JavaScript、Python、Rust、JSON、HTML、CSS、SQL、Bash、YAML 等 50+ 种编程语言高亮，并在右上角提供**一键复制代码**与**语言下拉切换**按钮：

\`\`\`typescript
interface WorkspaceConfig {
  /** 当前活动的主题标识 */
  theme: 'default' | 'paper' | 'tokyo-night' | 'dracula' | 'forest';
  /** 是否开启双栏协同分屏 */
  splitView: boolean;
  /** 自动云备份配置 */
  cloudSync: {
    provider: 'cloudflare';
    intervalMinutes: number;
  };
}

export function initializeDevNotes(): Promise<boolean> {
  console.log('⚡ DevNotes 2.0 就绪，享受沉浸式编码与写作');
  return Promise.resolve(true);
}
\`\`\`

\`\`\`json
{
  "project": "DevNotes",
  "status": "production",
  "capabilities": ["wysiwyg", "code-block-highlight", "cloud-sync", "mermaid"]
}
\`\`\`

---

## 七、 数据表格排版 (GFM Tables)

| 功能特性模块 | 所属分类 | 支持引擎 | 实时状态 |
| :--- | :---: | :---: | ---: |
| 所见即所得编辑 | 核心能力 | Milkdown | 🟢 完全支持 |
| 双栏源码对比 | 核心能力 | Cherry | 🟢 完全支持 |
| 语法高亮引擎 | 开发辅助 | Shiki Core | 🟢 50+ 语言 |
| 矢量图表与时间线 | 扩展渲染 | Mermaid | 🟢 流程图/时序图/时间线 |
| 多端云端备份 | 效率工具 | Cloudflare | 🟢 毫秒级增量 |

---

## 八、 编辑器快捷交互说明书 (Cheatsheet)

1. **斜杠菜单 (Slash Command)**：在空行输入 \`/\`，可快速唤起插入块菜单（标题、代码块、引用、任务列表等）。
2. **划词悬浮浮条 (Selection Toolbar)**：选中文本时自动在上方浮现微型格式化面板（加粗、斜体、删除线、下划线、高亮色）。
3. **块级悬停手柄 (Block Handle)**：光标所在行左侧会自动浮现操作手柄，支持快捷拖动、新建与删除当前块。
4. **代码块右上角**：代码块右上角支持一键复制代码与语言下拉切换。
5. **全局快捷键速查**：
   * <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd>：唤出全局功能指令面板
   * <kbd>⌘B</kbd> / <kbd>Ctrl+B</kbd>：折叠 / 展开左侧文档目录
   * <kbd>⌘D</kbd> / <kbd>Ctrl+D</kbd>：快捷切换深色 / 浅色模式
   * <kbd>⌘F</kbd> / <kbd>Ctrl+F</kbd>：调出编辑器内查找替换面板
   * <kbd>⌘E</kbd> / <kbd>Ctrl+E</kbd>：导出当前笔记为 <kbd>.md</kbd> 本地文件
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
        .map((item) => {
          let content = typeof item.content === 'string' ? item.content : ''
          let title = item.title || deriveTitleFromMarkdown(content)
          // 若为旧版简陋初始欢迎词，或未包含时间线/面板/TOC的早期样板，平滑升级为最新完整样板
          if (
            content.startsWith('### 欢迎使用 Markdown 笔记\n\n这是一款基于现代设计语言') ||
            (content.startsWith('# ✨ Markdown 全特性与工具支持全景样板') &&
              !content.includes('<kbd>'))
          ) {
            content = DEFAULT_CONTENT
            title = '✨ Markdown 全特性与工具支持全景样板'
          }
          return {
            id: item.id,
            title,
            content,
            createdAt: item.createdAt || Date.now(),
            updatedAt: item.updatedAt || Date.now(),
            // 透传来源文件字段,否则保存重载后去重信息会丢失
            ...(typeof item.sourcePath === 'string' ? { sourcePath: item.sourcePath } : {}),
            ...(typeof item.sourceMtime === 'number' ? { sourceMtime: item.sourceMtime } : {}),
          }
        })
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
