import { useState, useRef, useEffect } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  PanelLeft,
  ChevronRight,
  Search,
  Moon,
  Sun,
  Download,
  FileText,
  Braces,
  Radio,
  QrCode,
  LayoutGrid,
  BarChart3,
  Plus,
  Trash2,
  Pencil,
  FileCode,
  ArrowLeftRight,
  Languages,
  X,
  PlusCircle,
  GitBranch,
  Clock,
  Cloud,
  CloudUpload,
  CloudDownload,
  Loader2,
  FolderOpen,
  Copy,
} from 'lucide-react'
import { tools, toolCategories } from '../../types'
import ToolPage from '../../pages/ToolPage'
import { useNotes } from '../../context/NotesContext'
import CloudflareSyncModal from '../modals/CloudflareSyncModal'
import { useContextMenu } from '../ui/ContextMenu'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'
import logo from '../../assets/logo.png'
import WindowControls from './WindowControls'

interface DashboardLayoutProps {
  openTabIds: string[]
  activeTabId: string
  setActiveTabId: (id: string) => void
  onCloseTab: (id: string) => void
  onCloseOtherTabs: (id: string) => void
  onCloseAllTabs: () => void
  onOpenTool: (id: string) => void
  onBackToHub: () => void
  onOpenStats: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export default function DashboardLayout({
  openTabIds,
  activeTabId,
  setActiveTabId,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onOpenTool,
  onBackToHub,
  onOpenStats,
  theme,
  onToggleTheme,
}: DashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isCmdOpen, setIsCmdOpen] = useState(false)
  const [cmdSearch, setCmdSearch] = useState('')
  const [toolFilter, setToolFilter] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  // 文档重命名：就地编辑中的文档 id 与草稿名称
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const cmdInputRef = useRef<HTMLInputElement>(null)
  const tabScrollRef = useRef<HTMLDivElement>(null)
  // Esc 取消时置位，避免随后的 blur 把旧草稿又提交回去
  const skipRenameCommitRef = useRef(false)

  // 获取全局 Notes 状态
  const {
    activeNote,
    saveStatus,
    message: saveMessage,
    keyword: noteKeyword,
    setKeyword: setNoteKeyword,
    filteredNotes,
    handleCreate: handleCreateNote,
    handleSelect: handleSelectNote,
    handleDelete: handleDeleteNote,
    handleRename: handleRenameNote,
    handleExport: handleExportNote,
    insertText,
    cfConfig,
    cfSyncStatus,
    setIsCfModalOpen,
    triggerCfBackup,
    triggerCfPull,
  } = useNotes()

  const isMarkdownActive = activeTabId === 'markdown-notes'

  const { openContextMenu } = useContextMenu()
  const { showToast } = useToast()

  // 复制并给出轻量提示:提示是 fixed 浮层,不参与布局,因此不会造成任何位移
  const copyWithToast = async (text: string, label = '已复制') => {
    if (!text) {
      showToast('没有可复制的内容', 'error')
      return
    }
    const ok = await copyText(text)
    showToast(ok ? label : '复制失败', ok ? 'default' : 'error')
  }

  // 文档标题改为自定义：双击标题或点击铅笔图标就地重命名
  const startRenameNote = (id: string, title: string) => {
    skipRenameCommitRef.current = false
    setRenamingNoteId(id)
    setRenameDraft(title || '')
  }

  const commitRenameNote = () => {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false
      return
    }
    const id = renamingNoteId
    setRenamingNoteId(null)
    if (!id) return
    const next = renameDraft.trim()
    if (next) handleRenameNote(id, next)
  }

  const cancelRenameNote = () => {
    skipRenameCommitRef.current = true
    setRenamingNoteId(null)
  }

  // 快捷键监听：⌘K (命令面板), ⌘B (折叠侧边栏)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey

      if (isCmd && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setIsCmdOpen((prev) => !prev)
      } else if (isCmd && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        setIsSidebarOpen((prev) => !prev)
      } else if (isCmd && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        if (isMarkdownActive) {
          handleCreateNote()
        } else {
          onOpenTool('markdown-notes')
        }
      } else if (e.key === 'Escape' && isCmdOpen) {
        setIsCmdOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleCreateNote, isCmdOpen, isMarkdownActive, onOpenTool])

  // 打开指令面板时自动聚焦
  useEffect(() => {
    if (isCmdOpen) {
      setTimeout(() => cmdInputRef.current?.focus(), 50)
    } else {
      setCmdSearch('')
    }
  }, [isCmdOpen])

  // 窗口控制（顶栏三个圆点由 WindowControls 自己调 IPC，这里只留双击要用的最大化）
  const handleMaximize = () => window.electronAPI?.maximizeWindow()

  // 无边框窗口没有系统标题栏，「双击标题栏最大化」这条系统行为得自己补回来。
  // 落在交互控件上时不触发 —— 红绿灯、搜索框、各个按钮都带 no-drag。
  const handleTopbarDoubleClick = (event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest('.no-drag')) return
    handleMaximize()
  }

  // 侧边栏所有组件过滤
  const filteredTools = tools.filter((tool) => {
    const matchesSearch =
      tool.name.toLowerCase().includes(toolFilter.toLowerCase()) ||
      tool.description.toLowerCase().includes(toolFilter.toLowerCase())
    const matchesCategory = activeCategory === 'all' || tool.category === activeCategory
    return matchesSearch && matchesCategory
  })

  // 指令面板指令过滤
  const commandList = [
    {
      id: 'cmd-new-note',
      title: '新建 Markdown 笔记',
      shortcut: '⌘N',
      icon: PlusCircle,
      action: () => {
        onOpenTool('markdown-notes')
        handleCreateNote()
      },
    },
    {
      id: 'cmd-mermaid',
      title: '插入 Mermaid 时序图',
      shortcut: '/mermaid',
      icon: GitBranch,
      action: () => {
        onOpenTool('markdown-notes')
        const demo = `\n\`\`\`mermaid\nsequenceDiagram\n    autonumber\n    A->>B: 发送数据请求\n    B-->>A: 返回处理结果\n\`\`\`\n`
        insertText(demo, '')
      },
    },
    {
      id: 'cmd-timeline',
      title: '插入 Timeline 时间线',
      shortcut: '/timeline',
      icon: Clock,
      action: () => {
        onOpenTool('markdown-notes')
        const demo = `\n::: timeline 时间线\n:: [done] 2024-01-15 项目立项\n  完成需求评审\n:: [doing] 2024-03-20 Alpha 版本\n  正在联调\n:: [todo] 2024-06-01 正式上线\n:: [error] 2024-07-01 严重回滚事件\n:: [milestone] 2024-08-01 用户破万\n:::\n`
        insertText(demo, '')
      },
    },
    {
      id: 'cmd-cf-settings',
      title: 'Cloudflare 云端同步设置',
      shortcut: '⌘U',
      icon: Cloud,
      action: () => {
        setIsCfModalOpen(true)
      },
    },
    {
      id: 'cmd-cf-backup',
      title: '立即备份至 Cloudflare 云端',
      shortcut: '',
      icon: CloudUpload,
      action: () => {
        void triggerCfBackup()
      },
    },
    {
      id: 'cmd-cf-pull',
      title: '从 Cloudflare 同步拉取并合并笔记',
      shortcut: '',
      icon: CloudDownload,
      action: () => {
        void triggerCfPull('merge')
      },
    },
    {
      id: 'cmd-export-md',
      title: '导出为 .md 文件',
      shortcut: '⌘E',
      icon: Download,
      action: () => {
        handleExportNote()
      },
    },
    {
      id: 'cmd-toggle-theme',
      title: theme === 'dark' ? '切换为浅色主题' : '切换为深色主题',
      shortcut: '⌘D',
      icon: theme === 'dark' ? Sun : Moon,
      action: () => {
        onToggleTheme()
      },
    },
    ...tools.map((tool) => ({
      id: `cmd-tool-${tool.id}`,
      title: `打开 ${tool.name}`,
      shortcut: '',
      icon: FileCode,
      action: () => {
        onOpenTool(tool.id)
      },
    })),
  ].filter((item) => item.title.toLowerCase().includes(cmdSearch.toLowerCase()))

  const currentTool = tools.find((t) => t.id === activeTabId)

  // 顶栏标题右键菜单:笔记视图给出文档动作,工具视图给出工具动作
  const handleBreadcrumbContextMenu = (e: ReactMouseEvent) => {
    if (isMarkdownActive) {
      const note = activeNote
      openContextMenu(e, [
        {
          id: 'bc-rename',
          label: '重命名文档',
          icon: <Pencil className="w-3.5 h-3.5" />,
          disabled: !note,
          onSelect: () => note && startRenameNote(note.id, note.title),
        },
        {
          id: 'bc-copy-content',
          label: '复制全文',
          icon: <Copy className="w-3.5 h-3.5" />,
          disabled: !note,
          onSelect: () => void copyWithToast(note?.content ?? '', '已复制全文'),
        },
        {
          id: 'bc-export',
          label: '导出 .md',
          icon: <Download className="w-3.5 h-3.5" />,
          disabled: !note,
          onSelect: () => void handleExportNote(note ?? undefined),
        },
        { id: 'bc-sep', separator: true },
        {
          id: 'bc-delete',
          label: '删除文档',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          disabled: !note,
          onSelect: () => note && handleDeleteNote(note.id),
        },
      ])
      return
    }

    openContextMenu(e, [
      {
        id: 'bc-hub',
        label: '返回工具中心',
        icon: <LayoutGrid className="w-3.5 h-3.5" />,
        onSelect: onBackToHub,
      },
      ...(currentTool
        ? [
            {
              id: 'bc-copy-tool-name',
              label: '复制工具名称',
              icon: <Copy className="w-3.5 h-3.5" />,
              onSelect: () => void copyWithToast(currentTool.name, '已复制名称'),
            },
          ]
        : []),
    ])
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-white dark:bg-dark-bg text-slate-800 dark:text-slate-200 font-sans flex flex-col antialiased select-none transition-colors duration-200">
      {/* ================= 1. 顶部栏 (Unified Topbar - 44px) ================= */}
      <header
        onDoubleClick={handleTopbarDoubleClick}
        className="drag-region h-11 bg-white/95 dark:bg-dark-panel/95 backdrop-blur border-b border-slate-200/80 dark:border-dark-border px-4 flex items-center justify-between z-30 flex-shrink-0"
      >
        {/*
          左侧这块不再整体 no-drag：无边框下这片空白是最好用的拖拽区，
          只把真正要响应点击的元素标成 no-drag，剩下的交给顶栏的 drag-region。
        */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <WindowControls className="mr-1" />

          <button
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className="no-drag p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
            title={isSidebarOpen ? '折叠侧边栏 (⌘B)' : '展开侧边栏 (⌘B)'}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="h-4 w-[1px] bg-slate-200 dark:bg-dark-border" />

          {/* 面包屑 */}
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span
              onClick={onBackToHub}
              className="no-drag hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors"
            >
              DevNotes
            </span>
            <ChevronRight className="w-3 h-3 text-slate-400" />
            <span onContextMenu={handleBreadcrumbContextMenu} className="no-drag text-slate-900 dark:text-white font-semibold flex items-center gap-1.5 w-[200px] min-w-0">
              {isMarkdownActive ? (
                <>
                  <FileCode className="w-3.5 h-3.5 text-brand-600 dark:text-indigo-400 flex-shrink-0" />
                  <span className="min-w-0 truncate">{activeNote?.title || '欢迎使用 Markdown 笔记'}</span>
                </>
              ) : (
                <>
                  <span className="text-brand-600 dark:text-indigo-400 font-bold text-xs flex-shrink-0">
                    {currentTool?.icon.length || 0 <= 3 ? currentTool?.icon : currentTool?.icon.charAt(0)}
                  </span>
                  <span className="min-w-0 truncate">{currentTool?.name || '工具'}</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* 中部全局指令触发器 (⌘K) */}
        <div className="flex-1 max-w-sm mx-6">
          <button
            onClick={() => setIsCmdOpen(true)}
            className="no-drag w-full flex items-center justify-between px-3 py-1 bg-slate-100/80 dark:bg-dark-hover/60 hover:bg-slate-100 dark:hover:bg-dark-hover border border-slate-200/60 dark:border-dark-border rounded-lg text-xs text-slate-400 transition-all shadow-2xs group"
          >
            <span className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
              <span className="text-slate-500 dark:text-slate-400">搜索功能或笔记...</span>
            </span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white dark:bg-dark-panel border border-slate-200 dark:border-dark-border rounded text-slate-400">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* 右侧功能区 */}
        <div className="flex items-center gap-2.5 text-xs">
          {/* 自动保存微呼吸状态胶囊 */}
          {isMarkdownActive && (
            <div
              className={`flex items-center justify-center gap-1.5 w-[104px] px-2 py-0.5 rounded-full border transition-all font-medium ${
                saveStatus === 'saving'
                  ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200/50 dark:border-amber-900/50'
                  : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/50 dark:border-emerald-900/50'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  saveStatus === 'saving'
                    ? 'bg-amber-500 animate-ping'
                    : 'bg-emerald-500 animate-pulse'
                }`}
              />
              <span className="min-w-0 truncate" title={saveMessage}>{saveMessage}</span>
            </div>
          )}

          {/* Cloudflare 云同步状态微按钮 */}
          <button
            onClick={() => setIsCfModalOpen(true)}
            className={`no-drag flex items-center justify-center gap-1.5 w-[124px] px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
              cfConfig.enabled
                ? 'border-orange-200 dark:border-orange-900/50 bg-orange-50/70 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40 shadow-2xs'
                : 'border-slate-200/80 dark:border-dark-border text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-dark-hover'
            }`}
            title="Cloudflare 云端备份与同步"
          >
            <Cloud className="w-3.5 h-3.5 text-orange-500" />
            <span>{cfConfig.enabled ? 'CF 云同步' : 'CF 同步'}</span>
            {cfSyncStatus === 'syncing' ? (
              <Loader2 className="w-3 h-3 animate-spin text-orange-500" />
            ) : cfSyncStatus === 'success' ? (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            ) : null}
          </button>

          {/* 深色/浅色模式切换 */}
          <button
            onClick={onToggleTheme}
            className="no-drag p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover rounded-lg transition-colors"
            title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          >
            {theme === 'dark' ? (
              <Moon className="w-4 h-4 text-indigo-400" />
            ) : (
              <Sun className="w-4 h-4 text-amber-500" />
            )}
          </button>

          <div className="h-4 w-[1px] bg-slate-200 dark:bg-dark-border" />

          {/* 右侧主操作动作 */}
          {isMarkdownActive ? (
            <button
              onClick={() => void handleExportNote()}
              className="no-drag flex items-center gap-1.5 px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg shadow-xs shadow-brand-500/20 transition-all"
              title="导出当前 Markdown 文件"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出 .md</span>
            </button>
          ) : (
            <button
              onClick={onBackToHub}
              className="no-drag flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-dark-hover hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium rounded-lg border border-slate-200 dark:border-dark-border transition-all"
            >
              <span>工具中心</span>
            </button>
          )}
        </div>
      </header>

      {/* ================= 2. 主体三栏布局 ================= */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 2.1 工具箱极简侧边栏 (56px / w-14) */}
        <aside className="w-14 bg-slate-50 dark:bg-dark-sidebar border-r border-slate-200/80 dark:border-dark-border flex flex-col items-center py-3 gap-4 flex-shrink-0 z-20">
          {/* 品牌 Logo */}
          <img
            src={logo}
            alt="DevNotes"
            onClick={onBackToHub}
            title="DevNotes 工具中心"
            className="w-8 h-8 object-contain cursor-pointer transition-transform hover:scale-105 active:scale-95"
          />

          {/* 常用小工具 Rail 导航 */}
          <nav className="flex-1 flex flex-col gap-2 w-full px-2">
            {/* Markdown 笔记 */}
            <button
              onClick={() => onOpenTool('markdown-notes')}
              className={`relative group w-full aspect-square flex items-center justify-center rounded-xl transition-all ${
                activeTabId === 'markdown-notes'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border text-brand-600 dark:text-indigo-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
              }`}
              title="Markdown 笔记"
            >
              <FileText className="w-4 h-4" />
              {activeTabId === 'markdown-notes' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-brand-600 rounded-r-md" />
              )}
            </button>

            {/* JSON 格式化 */}
            <button
              onClick={() => onOpenTool('json-format')}
              className={`relative group w-full aspect-square flex items-center justify-center rounded-xl transition-all ${
                activeTabId === 'json-format'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border text-brand-600 dark:text-indigo-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
              }`}
              title="JSON 格式化"
            >
              <Braces className="w-4 h-4" />
              {activeTabId === 'json-format' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-brand-600 rounded-r-md" />
              )}
            </button>

            {/* WebSocket 测试 */}
            <button
              onClick={() => onOpenTool('websocket')}
              className={`relative group w-full aspect-square flex items-center justify-center rounded-xl transition-all ${
                activeTabId === 'websocket'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border text-brand-600 dark:text-indigo-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
              }`}
              title="WebSocket 测试"
            >
              <Radio className="w-4 h-4" />
              {activeTabId === 'websocket' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-brand-600 rounded-r-md" />
              )}
            </button>

            {/* 二维码工具 */}
            <button
              onClick={() => onOpenTool('qr-code')}
              className={`relative group w-full aspect-square flex items-center justify-center rounded-xl transition-all ${
                activeTabId === 'qr-code'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border text-brand-600 dark:text-indigo-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
              }`}
              title="二维码工具"
            >
              <QrCode className="w-4 h-4" />
              {activeTabId === 'qr-code' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-brand-600 rounded-r-md" />
              )}
            </button>

            {/* 编码转换 */}
            <button
              onClick={() => onOpenTool('en-decode')}
              className={`relative group w-full aspect-square flex items-center justify-center rounded-xl transition-all ${
                activeTabId === 'en-decode'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border text-brand-600 dark:text-indigo-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
              }`}
              title="编码转换"
            >
              <ArrowLeftRight className="w-4 h-4" />
              {activeTabId === 'en-decode' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-brand-600 rounded-r-md" />
              )}
            </button>

            {/* JSON 翻译 */}
            <button
              onClick={() => onOpenTool('json-i18n')}
              className={`relative group w-full aspect-square flex items-center justify-center rounded-xl transition-all ${
                activeTabId === 'json-i18n'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border text-brand-600 dark:text-indigo-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
              }`}
              title="JSON 翻译"
            >
              <Languages className="w-4 h-4" />
              {activeTabId === 'json-i18n' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-brand-600 rounded-r-md" />
              )}
            </button>
          </nav>

          {/* 底部使用统计与全部组件按钮 */}
          <div className="flex flex-col gap-2 w-full px-2">
            <button
              onClick={onOpenStats}
              className="w-full aspect-square flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover transition-all"
              title="使用统计"
            >
              <BarChart3 className="w-4 h-4" />
            </button>
            <button
              onClick={onBackToHub}
              className="w-full aspect-square flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover transition-all"
              title="全部小工具库"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </aside>

        {/* 2.2 二级侧边栏 (240px / w-60，可折叠) */}
        <section
          className={`${
            isSidebarOpen ? 'w-60 opacity-100' : 'w-0 opacity-0 overflow-hidden border-r-0'
          } bg-white dark:bg-dark-panel border-r border-slate-200/80 dark:border-dark-border flex flex-col flex-shrink-0 transition-all duration-300`}
        >
          {isMarkdownActive ? (
            /* Markdown 知识库文档列表视图 */
            <>
              <div className="p-3 border-b border-slate-100 dark:border-dark-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    知识库文档
                  </span>
                  <button
                    onClick={handleCreateNote}
                    className="flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-dark-hover hover:bg-brand-50 hover:text-brand-600 dark:hover:text-indigo-400 rounded-md text-xs font-medium transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> 新建
                  </button>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={noteKeyword}
                    onChange={(e) => setNoteKeyword(e.target.value)}
                    placeholder="过滤文档..."
                    className="w-full pl-8 pr-3 py-1 text-xs bg-slate-50 dark:bg-dark-sidebar border border-slate-200 dark:border-dark-border rounded-lg outline-none focus:border-brand-500 dark:focus:border-indigo-500 transition-all text-slate-800 dark:text-slate-200 placeholder-slate-400"
                  />
                </div>
              </div>

              {/* 动态文档列表流 */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredNotes.map((note) => {
                  const isActive = note.id === activeNote?.id
                  return (
                    <div
                      key={note.id}
                      onClick={() => handleSelectNote(note.id)}
                      onContextMenu={(e) =>
                        openContextMenu(e, [
                          {
                            id: 'note-open',
                            label: '打开文档',
                            icon: <FolderOpen className="w-3.5 h-3.5" />,
                            onSelect: () => handleSelectNote(note.id),
                          },
                          {
                            id: 'note-rename',
                            label: '重命名',
                            icon: <Pencil className="w-3.5 h-3.5" />,
                            shortcut: '双击标题',
                            onSelect: () => startRenameNote(note.id, note.title),
                          },
                          { id: 'note-sep-1', separator: true },
                          {
                            id: 'note-copy-content',
                            label: '复制正文',
                            icon: <Copy className="w-3.5 h-3.5" />,
                            disabled: !note.content,
                            onSelect: () => void copyWithToast(note.content, '已复制正文'),
                          },
                          {
                            id: 'note-copy-title',
                            label: '复制标题',
                            icon: <Copy className="w-3.5 h-3.5" />,
                            disabled: !note.title,
                            onSelect: () => void copyWithToast(note.title, '已复制标题'),
                          },
                          { id: 'note-sep-2', separator: true },
                          {
                            id: 'note-export',
                            label: '导出 .md',
                            icon: <Download className="w-3.5 h-3.5" />,
                            onSelect: () => void handleExportNote(note),
                          },
                          {
                            id: 'note-delete',
                            label: '删除文档',
                            icon: <Trash2 className="w-3.5 h-3.5" />,
                            danger: true,
                            onSelect: () => handleDeleteNote(note.id),
                          },
                        ])
                      }
                      className={`group p-2.5 rounded-xl cursor-pointer transition-all border ${
                        isActive
                          ? 'bg-brand-50/70 dark:bg-brand-500/10 border-brand-100 dark:border-indigo-500/20'
                          : 'hover:bg-slate-50 dark:hover:bg-dark-hover/60 border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1 gap-1">
                        {renamingNoteId === note.id ? (
                          <input
                            autoFocus
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
                                cancelRenameNote()
                              }
                            }}
                            onBlur={commitRenameNote}
                            className="flex-1 min-w-0 h-4 -mx-[5px] px-1 py-0 text-xs leading-none bg-white dark:bg-dark-sidebar border border-brand-400 dark:border-indigo-500 rounded-md outline-none text-slate-800 dark:text-slate-200 placeholder-slate-400"
                          />
                        ) : (
                          <h4
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              startRenameNote(note.id, note.title)
                            }}
                            title={`${note.title || '未命名笔记'}（双击重命名）`}
                            className={`flex-1 min-w-0 h-4 leading-4 truncate text-xs ${
                              isActive
                                ? 'font-semibold text-slate-900 dark:text-white'
                                : 'font-medium text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {note.title || '未命名笔记'}
                          </h4>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              startRenameNote(note.id, note.title)
                            }}
                            className={`p-0.5 hover:text-brand-600 dark:hover:text-indigo-400 text-slate-400 transition-opacity ${
                              renamingNoteId === note.id
                                ? 'invisible'
                                : 'opacity-0 group-hover:opacity-100'
                            }`}
                            title="重命名文档"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteNote(note.id)
                            }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-500 text-slate-400 transition-opacity"
                            title="删除笔记"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1 font-mono">
                        {note.content.substring(0, 40)}...
                      </p>
                      <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400">
                        <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                        <span className="font-mono">{note.content.length} 字</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            /* 其它工具时的侧边栏：分类与工具列表导航 */
            <>
              <div className="p-3 border-b border-slate-100 dark:border-dark-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    组件工具库
                  </span>
                  <span className="text-[10px] text-slate-400">{filteredTools.length} 个</span>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={toolFilter}
                    onChange={(e) => setToolFilter(e.target.value)}
                    placeholder="搜索组件..."
                    className="w-full pl-8 pr-3 py-1 text-xs bg-slate-50 dark:bg-dark-sidebar border border-slate-200 dark:border-dark-border rounded-lg outline-none focus:border-brand-500 dark:focus:border-indigo-500 transition-all text-slate-800 dark:text-slate-200 placeholder-slate-400"
                  />
                </div>
                <div className="flex gap-1 overflow-x-auto scrollbar-hide py-1">
                  {toolCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap transition-all ${
                        activeCategory === cat.id
                          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-dark-hover'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredTools.map((tool) => {
                  const isActive = tool.id === activeTabId
                  return (
                    <div
                      key={tool.id}
                      onClick={() => onOpenTool(tool.id)}
                      onContextMenu={(e) =>
                        openContextMenu(e, [
                          {
                            id: 'tool-open',
                            label: '打开',
                            icon: <FolderOpen className="w-3.5 h-3.5" />,
                            onSelect: () => onOpenTool(tool.id),
                          },
                          { id: 'tool-sep', separator: true },
                          {
                            id: 'tool-copy-name',
                            label: '复制名称',
                            icon: <Copy className="w-3.5 h-3.5" />,
                            onSelect: () => void copyWithToast(tool.name, '已复制名称'),
                          },
                          {
                            id: 'tool-copy-desc',
                            label: '复制描述',
                            icon: <Copy className="w-3.5 h-3.5" />,
                            disabled: !tool.description,
                            onSelect: () => void copyWithToast(tool.description, '已复制描述'),
                          },
                          {
                            id: 'tool-copy-id',
                            label: '复制 ID',
                            icon: <Copy className="w-3.5 h-3.5" />,
                            onSelect: () => void copyWithToast(tool.id, '已复制 ID'),
                          },
                        ])
                      }
                      className={`group p-2 rounded-xl cursor-pointer transition-all border flex items-center justify-between ${
                        isActive
                          ? 'bg-brand-50/70 dark:bg-brand-500/10 border-brand-100 dark:border-indigo-500/20 text-slate-900 dark:text-white font-semibold'
                          : 'hover:bg-slate-50 dark:hover:bg-dark-hover/60 border-transparent text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-5 h-5 flex items-center justify-center rounded-md bg-slate-100 dark:bg-dark-sidebar text-[10px] font-mono flex-shrink-0">
                          {tool.icon.length <= 3 ? tool.icon : tool.icon.charAt(0)}
                        </span>
                        <span className="text-xs truncate">{tool.name}</span>
                      </div>
                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </section>

        {/* 2.3 编辑器 / 工具主工作台 (Editor Workspace) */}
        <main className="flex-1 flex flex-col bg-white dark:bg-dark-panel overflow-hidden min-w-0">
          {/* Tab 栏（如果打开了多个工具） */}
          {openTabIds.length > 1 && (
            <div
              ref={tabScrollRef}
              className="h-8 bg-slate-50/70 dark:bg-dark-sidebar/60 border-b border-slate-200/70 dark:border-dark-border flex items-center px-2 gap-1 overflow-x-auto scrollbar-hide flex-shrink-0"
            >
              {openTabIds.map((id) => {
                const tool = tools.find((t) => t.id === id)
                if (!tool) return null
                const isActive = activeTabId === id
                return (
                  <div
                    key={id}
                    onClick={() => setActiveTabId(id)}
                    onContextMenu={(e) =>
                      openContextMenu(e, [
                        {
                          id: 'tab-close',
                          label: '关闭',
                          icon: <X className="w-3.5 h-3.5" />,
                          disabled: openTabIds.length <= 1,
                          onSelect: () => onCloseTab(id),
                        },
                        {
                          id: 'tab-close-others',
                          label: '关闭其他',
                          icon: <X className="w-3.5 h-3.5" />,
                          disabled: openTabIds.length <= 1,
                          onSelect: () => onCloseOtherTabs(id),
                        },
                        { id: 'tab-sep', separator: true },
                        {
                          id: 'tab-close-all',
                          label: '关闭全部',
                          icon: <Trash2 className="w-3.5 h-3.5" />,
                          danger: true,
                          onSelect: onCloseAllTabs,
                        },
                      ])
                    }
                    className={`group flex items-center gap-1.5 h-6 px-2.5 rounded-md cursor-pointer text-xs transition-all border ${
                      isActive
                        ? 'bg-white dark:bg-dark-panel border-slate-200 dark:border-dark-border text-slate-900 dark:text-white font-semibold shadow-2xs'
                        : 'border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
                    }`}
                  >
                    <span className="text-[10px] font-mono">
                      {tool.icon.length <= 3 ? tool.icon : tool.icon.charAt(0)}
                    </span>
                    <span className="truncate max-w-[100px]">{tool.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onCloseTab(id)
                      }}
                      className="ml-1 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-dark-hover text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* 渲染当前工具内容 */}
          <div className="flex-1 overflow-hidden relative">
            <ToolPage toolId={activeTabId} />
          </div>
        </main>
      </div>

      {/* ================= 3. ⌘K 全局指令面板 (Command Palette Modal) ================= */}
      {isCmdOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCmdOpen(false)
          }}
          className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs z-50 flex items-start justify-center pt-24 animate-in fade-in duration-150"
        >
          <div className="w-full max-w-lg bg-white dark:bg-dark-panel rounded-2xl shadow-2xl border border-slate-200 dark:border-dark-border overflow-hidden">
            {/* 搜索框 */}
            <div className="p-3.5 border-b border-slate-100 dark:border-dark-border flex items-center gap-3">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                ref={cmdInputRef}
                type="text"
                value={cmdSearch}
                onChange={(e) => setCmdSearch(e.target.value)}
                placeholder="输入指令或搜索动作..."
                className="flex-1 text-sm bg-transparent outline-none text-slate-800 dark:text-white placeholder-slate-400"
              />
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-dark-hover border border-slate-200 dark:border-dark-border rounded text-slate-400">
                ESC
              </kbd>
            </div>

            {/* 指令列表 */}
            <div className="p-2 max-h-72 overflow-y-auto space-y-1 text-xs">
              {commandList.map((item) => {
                const IconComponent = item.icon
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      item.action()
                      setIsCmdOpen(false)
                    }}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-brand-50 dark:hover:bg-dark-hover hover:text-brand-600 dark:hover:text-indigo-400 cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200 group-hover:text-inherit">
                      <IconComponent className="w-4 h-4 text-slate-400" />
                      <span>{item.title}</span>
                    </span>
                    {item.shortcut && (
                      <span className="text-[10px] text-slate-400 font-mono bg-slate-50 dark:bg-dark-sidebar px-1.5 py-0.5 rounded border border-slate-100 dark:border-dark-border">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                )
              })}

              {commandList.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-400">未找到匹配的动作</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cloudflare 同步管理模态框 */}
      <CloudflareSyncModal />
    </div>
  )
}
