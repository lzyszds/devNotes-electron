import { Fragment, useState, useRef, useEffect, useMemo } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  Menu,
  ListTree,
  MoreVertical,
  Search,
  Moon,
  Sun,
  Download,
  LayoutGrid,
  BarChart3,
  Trash2,
  Pencil,
  BookmarkPlus,
  BookmarkMinus,
  FileCode,
  Languages,
  PlusCircle,
  GitBranch,
  Clock,
  Cloud,
  CloudUpload,
  CloudDownload,
  FolderOpen,
  Copy,
  Settings,
  Sparkles,
  Network,
  StickyNote,
} from 'lucide-react'
import { allModules, standaloneModules, tools, toolCategories } from '../../types'
import NotesSidebar from '../modules/markdown-notes/NotesSidebar'
import SnippetsSidebar from '../modules/snippets/SnippetsSidebar'
import ToolPage from '../../pages/ToolPage'
import { useNotes } from '../../context/NotesContext'
import SettingsModal, { type SettingsSection } from '../modals/SettingsModal'
import { useContextMenu } from '../ui/ContextMenu'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'
import { usePresence } from '../../hooks/usePresence'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useSlideTransition } from '../../hooks/useSlideTransition'
import { useShortcutSettings } from '../../hooks/useShortcutSettings'
import {
  SHORTCUT_BINDINGS,
  eventToAccelerator,
  isRecordingShortcut,
} from '../../utils/shortcutSettings'
import { subscribeAppSettings } from '../../utils/settingsBus'
import { getCachedRailToolIds, subscribeRailToolIds } from '../../utils/sidebarLayout'
import { requestOutline, subscribeDocStats } from '../../utils/editorBus'
import { isDarkTheme, THEMES, type ThemeId } from '../../utils/theme'
import logo from '../../assets/logo.png'
import WindowControls from './WindowControls'
import ThemeQuickMenu from './ThemeQuickMenu'
import ToolIcon from '../ui/ToolIcon'

/** 是否是独立模块。Rail 上独立模块与普通小工具之间要画一条分隔线 */
function isStandalone(id: string | undefined): boolean {
  return Boolean(id && standaloneModules.some((item) => item.id === id))
}

// 二级侧边栏（文档目录）宽度的持久化配置
const SIDEBAR_WIDTH_KEY = 'fehelper-sidebar-width'
const SIDEBAR_DEFAULT_WIDTH = 320
const SIDEBAR_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 480

/** 读取上次保存的侧边栏宽度，非法值时回退到默认宽度 */
function readSidebarWidth(): number {
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (!Number.isFinite(saved) || saved <= 0) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(Math.max(saved, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH)
}


interface DashboardLayoutProps {
  activeTabId: string
  onOpenTool: (id: string) => void
  onBackToHub: () => void
  onOpenStats: () => void
  theme: ThemeId
  onToggleTheme: () => void
  onSelectTheme: (id: ThemeId) => void
}

export default function DashboardLayout({
  activeTabId,
  onOpenTool,
  onBackToHub,
  onOpenStats,
  theme,
  onToggleTheme,
  onSelectTheme,
}: DashboardLayoutProps) {
  // 当前主题是否属于深色系，决定顶栏图标与提示文案
  const isDark = isDarkTheme(theme)
  // < 768px 走移动端外壳：目录改抽屉、顶栏精简
  const isMobile = useIsMobile()
  /*
   * 切工具的竖滑转场。顺序取工具在 allModules 里的下标 —— 用它判断这次是
   * 「往后跳」还是「往回跳」，据此决定新页从下方上来还是从上方压下来。
   */
  const slide = useSlideTransition(
    activeTabId,
    (id) => allModules.findIndex((t) => t.id === id),
  )

  // 移动端初值就得是收起：若先以展开态挂载、再由 effect 改成收起，
  // 每次切回笔记都会看到目录滑出一下（300ms 过渡）。
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobile)
  // 文档目录宽度与拖拽态
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isCmdOpen, setIsCmdOpen] = useState(false)
  /** 当前生效的快捷键映射（设置面板可改，用 useShortcutSettings 订阅） */
  const shortcutMap = useShortcutSettings()
  // 面板退出动画 160ms，遮罩 150ms，取长者
  const { mounted: cmdMounted, state: cmdState } = usePresence(isCmdOpen, 160)
  // 全局设置弹窗：打开时停在哪个分类
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [cmdSearch, setCmdSearch] = useState('')
  const [toolFilter, setToolFilter] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')

  const cmdInputRef = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  // 获取全局 Notes 状态
  const {
    activeNote,
    saveStatus,
    handleCreate: handleCreateNote,
    handleOpenSampleNote,
    handleDelete: handleDeleteNote,
    handleRename: handleRenameNote,
    handleToggleBookmark,
    scope,
    handleExport: handleExportNote,
    insertText,
    cfConfig,
    cfSyncStatus,
    cfSyncMessage,
    triggerCfBackup,
    triggerCfPull,
  } = useNotes()

  const isMarkdownActive = activeTabId === 'markdown-notes'
  // 文本翻译是独立模块，二级侧边栏换成它自己的「翻译方向 + 历史」面板
  const isTranslateActive = activeTabId === 'text-translate'
  // 代码片段库同样是独立模块，有自己的二级导航
  const isSnippetsActive = activeTabId === 'snippets'
  /*
   * 左侧菜单栏的默认项。存一份在内存里并订阅变化 —— 设置面板里勾一下，
   * Rail 要当场跟着变，不能等重新进页面。
   */
  const [railToolIds, setRailToolIds] = useState<string[]>(() => getCachedRailToolIds())
  useEffect(() => subscribeRailToolIds(setRailToolIds), [])
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false)
  // 移动端顶栏的「已保存 · N 字」胶囊。字数走编辑器总线，
  // 免得顶栏和底部状态栏各算一套、口径对不上。
  const [docCharCount, setDocCharCount] = useState(0)
  useEffect(() => subscribeDocStats(setDocCharCount), [])

  // 移动端进入时目录默认收起：抽屉一上来就盖住内容，会让人以为页面是空的
  useEffect(() => {
    if (isMobile) setIsSidebarOpen(false)
  }, [isMobile])

  const { openContextMenu } = useContextMenu()
  const { showToast } = useToast()

  // 拖拽调整文档目录宽度：以侧边栏左边缘为基准计算指针横坐标
  const handleSidebarResizeStart = (e: ReactMouseEvent) => {
    const section = sidebarRef.current
    if (!section) return

    e.preventDefault()
    const left = section.getBoundingClientRect().left
    let latest = sidebarWidth
    setIsResizingSidebar(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (ev: MouseEvent) => {
      latest = Math.min(Math.max(ev.clientX - left, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH)
      setSidebarWidth(latest)
    }

    const handleMouseUp = () => {
      setIsResizingSidebar(false)
      document.body.style.cursor = 'default'
      document.body.style.userSelect = 'auto'
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      // 仅在拖拽结束时落盘，避免过程中高频写入
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(latest))
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // 双击分割线恢复默认宽度
  const resetSidebarWidth = () => {
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT_WIDTH))
  }

  // 复制并给出轻量提示:提示是 fixed 浮层,不参与布局,因此不会造成任何位移
  const copyWithToast = async (text: string, label = '已复制') => {
    if (!text) {
      showToast('没有可复制的内容', 'error')
      return
    }
    const ok = await copyText(text)
    showToast(ok ? label : '复制失败', ok ? 'default' : 'error')
  }

  // 打开全局设置弹窗，并直接定位到指定分类
  /**
   * 应用内快捷键 id -> 动作。
   *
   * 用 useMemo 而不是每次渲染重建：它进不了 effect 依赖（对象每次都是新的），
   * 而 effect 里要按 id 查表，所以表达成「依赖都齐了才重算」。
   */
  const appShortcutActions = useMemo<Record<string, () => void>>(
    () => ({
      'command-palette': () => setIsCmdOpen((prev) => !prev),
      'toggle-sidebar': () => {
        // 翻译页没有侧边栏，别让它切换一个看不见的状态
        if (isTranslateActive) return
        setIsSidebarOpen((prev) => !prev)
      },
      'new-note': () => {
        if (isMarkdownActive) {
          // 在某个文件夹视图下新建，直接归到该文件夹，省一次「移动到」
          handleCreateNote(scope.type === 'folder' ? scope.folderId : null)
        } else {
          onOpenTool('markdown-notes')
        }
      },
      'toggle-bookmark': () => {
        if (isMarkdownActive && activeNote) {
          handleToggleBookmark(activeNote.id)
          showToast(activeNote.bookmarked ? '已移除书签' : '已加入书签')
        }
      },
      'export-note': () => {
        if (isMarkdownActive) void handleExportNote()
      },
      'toggle-theme': () => onToggleTheme(),
      'open-settings': () => {
        setSettingsSection('general')
        setIsSettingsOpen(true)
      },
      'cloud-sync-settings': () => {
        setSettingsSection('cloud-sync')
        setIsSettingsOpen(true)
      },
    }),
    [
      activeNote,
      handleCreateNote,
      handleExportNote,
      handleToggleBookmark,
      isMarkdownActive,
      isTranslateActive,
      onOpenTool,
      onToggleTheme,
      scope,
      showToast,
    ],
  )

  const openSettings = (section: SettingsSection = 'general') => {
    setSettingsSection(section)
    setIsSettingsOpen(true)
  }

  /**
   * 快捷键监听。
   *
   * 键位从配置读（设置面板可改），所以不能像原来那样写一串
   * `e.key === 'k'` 的 if-else —— 改成「按下的事件转成 accelerator，
   * 再查表找对应动作」。匹配用的是归一化后的字符串，用户把 ⌘K 改成
   * ⌘J 之后这里不用动。
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 录制快捷键时全部让路：用户要按 ⌘K 来录它，这条要是还生效，
      // 命令面板会当场弹出来盖住设置面板，根本录不下去。
      // 放在最前面判断，连 Esc 也不处理，让录制框独占这次的按键。
      if (isRecordingShortcut()) return

      // 命令面板开着时 Esc 先关它，这条不参与自定义
      if (e.key === 'Escape' && isCmdOpen) {
        setIsCmdOpen(false)
        return
      }

      const pressed = eventToAccelerator(e)
      if (!pressed) return

      // 只匹配应用内快捷键；全局键由主进程的 globalShortcut 处理，
      // 那里在窗口没聚焦时也生效，这里再拦一次会重复触发
      for (const binding of SHORTCUT_BINDINGS) {
        if (binding.scope !== 'app') continue
        if (shortcutMap[binding.id] !== pressed) continue

        // 归一化后仍要按顺序比：配置里是 CommandOrControl+B，事件转出来
        // 也是这个写法，直接相等即命中
        const handler = appShortcutActions[binding.id]
        if (!handler) continue
        e.preventDefault()
        handler()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [appShortcutActions, isCmdOpen, shortcutMap])

  // 打开指令面板时自动聚焦
  useEffect(() => {
    if (isCmdOpen) {
      setTimeout(() => cmdInputRef.current?.focus(), 50)
    } else {
      setCmdSearch('')
    }
  }, [isCmdOpen])

  // 工具内部想打开全局设置（如翻译工具提示「去配置」）时，通过事件总线通知这里
  useEffect(() => {
    return subscribeAppSettings((topic) => openSettings(topic))
  }, [])

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
      id: 'cmd-text-translate',
      title: '打开文本翻译',
      shortcut: '⌘T',
      icon: Languages,
      action: () => {
        onOpenTool('text-translate')
      },
    },
    {
      id: 'cmd-scratchpad-window',
      title: '打开草稿纸置顶小窗',
      shortcut: '⌥⇧N',
      icon: StickyNote,
      action: () => {
        if (!window.electronAPI?.scratchOpen) {
          onOpenTool('scratchpad')
          return
        }
        void window.electronAPI.scratchOpen()
      },
    },
    {
      id: 'cmd-scratchpad-page',
      title: '打开草稿纸（页内编辑）',
      shortcut: '',
      icon: StickyNote,
      action: () => {
        onOpenTool('scratchpad')
      },
    },
    {
      id: 'cmd-open-settings',
      title: '打开全局设置',
      shortcut: '⌘,',
      icon: Settings,
      action: () => {
        openSettings('general')
      },
    },
    {
      id: 'cmd-interface-settings',
      title: '界面设置（左侧菜单栏自定义）',
      shortcut: '',
      icon: PanelLeft,
      action: () => {
        openSettings('interface')
      },
    },
    {
      id: 'cmd-cf-settings',
      title: 'Cloudflare 云端同步设置',
      shortcut: '⌘U',
      icon: Cloud,
      action: () => {
        openSettings('cloud-sync')
      },
    },
    {
      id: 'cmd-translate-api-settings',
      title: '在线翻译接口设置',
      shortcut: '',
      icon: Languages,
      action: () => {
        openSettings('translate-api')
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
      id: 'cmd-sample-md',
      title: '打开 / 新建「Markdown 全特性与工具样板」',
      shortcut: '',
      icon: Sparkles,
      action: () => {
        onOpenTool('markdown-notes')
        handleOpenSampleNote()
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
      title: isDark ? '快捷切换为对偶浅色主题' : '快捷切换为对偶深色主题',
      shortcut: '⌘D',
      icon: isDark ? Sun : Moon,
      action: () => {
        onToggleTheme()
      },
    },
    ...THEMES.map((t) => ({
      id: `cmd-theme-${t.id}`,
      title: `切换主题：${t.name} (${t.englishName} · ${t.mode === 'dark' ? '深色' : '浅色'})`,
      shortcut: t.id === theme ? '当前' : '',
      icon: t.mode === 'dark' ? Moon : Sun,
      action: () => {
        onSelectTheme(t.id)
      },
    })),
    /*
     * 工具库 + 独立模块都要列。
     *
     * 原来只遍历 tools，片段库升成独立模块后就从指令面板里消失了 ——
     * 用户搜不到自己收藏的片段入口，只能从侧栏绕。两头都得覆盖。
     */
    ...allModules.map((tool) => ({
      id: `cmd-tool-${tool.id}`,
      title: `打开 ${tool.name}`,
      shortcut: '',
      icon: (props: any) => <ToolIcon toolId={tool.id} {...props} />,
      action: () => {
        // 草稿纸在指令面板里有单独的两条（小窗 / 页内），这里不再重复
        if (tool.id === 'scratchpad') return
        onOpenTool(tool.id)
      },
    })).filter((item) => !item.id.endsWith('scratchpad')),
  ].filter((item) => item.title.toLowerCase().includes(cmdSearch.toLowerCase()))

  // 独立模块不在工具库里，得一起查，否则面包屑上的名字会掉成「工具」
  const currentTool = allModules.find((t) => t.id === activeTabId)


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
          onSelect: () => {
            if (!note) return
            const next = window.prompt('重命名文档', note.title)
            if (next === null) return
            const trimmed = next.trim()
            if (!trimmed || trimmed === note.title) return
            handleRenameNote(note.id, trimmed)
          },
        },
        {
          id: 'bc-bookmark',
          label: note?.bookmarked ? '移除书签' : '加入书签',
          icon: note?.bookmarked ? (
            <BookmarkMinus className="w-3.5 h-3.5" />
          ) : (
            <BookmarkPlus className="w-3.5 h-3.5" />
          ),
          disabled: !note,
          onSelect: () => {
            if (!note) return
            handleToggleBookmark(note.id)
            showToast(note.bookmarked ? '已移除书签' : '已加入书签')
          },
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
          label: '移入回收站',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          disabled: !note,
          onSelect: () => {
            if (!note) return
            handleDeleteNote(note.id)
            showToast('已移入回收站')
          },
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
    <div className="h-screen w-screen overflow-hidden bg-white dark:bg-dark-bg text-slate-800 dark:text-slate-200 font-sans flex flex-col antialiased select-none">
      {/* ================= 1. 顶部栏 (Unified Topbar - 44px) ================= */}
      {/*
        顶栏取 sidebar 色，而不是 bg-white/95：带透明度的类名（.bg-white\/95）
        命中不了 html[data-theme='…'] .bg-white 那批主题覆盖，所以此前 20 套主题下顶栏恒为纯白。
        同时去掉 backdrop-blur —— 顶栏是 flex 纵列里固定高度的子项，没有内容从它下面滚过，
        模糊本来就不生效；背景转实色后更是纯开销。

        z-50（原 40）是修主题面板被挡的关键：z-index 会创建层叠上下文，
        顶栏内 ThemeQuickMenu 自己的 z-50 被锁死在顶栏这一层里，
        而编辑器的各条工具栏是文档流里更靠后的 z-40，于是反过来盖住了主题面板。
        50 仍低于浮动工具条(80)/块拖拽指示线(85)/Tooltip(90)；
        需要盖住顶栏的浮层已同步提到 60：命令面板与 SettingsModal。
      */}
      <header
        onDoubleClick={handleTopbarDoubleClick}
        className="drag-region h-11 bg-slate-50 dark:bg-dark-sidebar border-b border-slate-200/80 dark:border-dark-border px-3 md:px-4 flex items-center justify-between gap-2 z-50 flex-shrink-0"
      >
        {isMobile ? (
          <>
            {/* 左：笔记页与翻译模块有二级侧边栏，其余工具返回工具中心 */}
            {isMarkdownActive || isTranslateActive ? (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="no-drag -ml-1.5 p-1.5 rounded-lg text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-dark-hover"
                title={
                  isMarkdownActive
                    ? '打开文档列表'
                    : isSnippetsActive
                      ? '打开片段列表'
                      : '打开翻译面板'
                }
              >
                <Menu className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={onBackToHub}
                className="no-drag -ml-1.5 p-1.5 rounded-lg text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-dark-hover"
                title="返回工具中心"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            {/* 中：标题 + 自动保存状态 */}
            <div className="flex min-w-0 flex-1 flex-col items-center">
              <span className="w-full truncate text-center text-xs font-bold text-slate-800 dark:text-slate-100">
                {isMarkdownActive ? activeNote?.title || '未命名文档' : currentTool?.name || '工具'}
              </span>
              {isMarkdownActive && (
                <span
                  className={`flex items-center gap-1 text-[10px] font-medium ${
                    saveStatus === 'error'
                      ? 'text-rose-600 dark:text-rose-400'
                      : saveStatus === 'saving'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      saveStatus === 'error'
                        ? 'bg-rose-500'
                        : saveStatus === 'saving'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-emerald-500'
                    }`}
                  />
                  {saveStatus === 'saving' ? '保存中' : saveStatus === 'error' ? '保存失败' : '已保存'} ·{' '}
                  {docCharCount.toLocaleString()} 字
                </span>
              )}
            </div>

            {/* 右：大纲 + 更多 */}
            <div className="flex flex-shrink-0 items-center gap-0.5">
              {isMarkdownActive && (
                <button
                  onClick={() => requestOutline(true)}
                  className="no-drag p-1.5 rounded-lg text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-dark-hover"
                  title="目录大纲"
                >
                  <ListTree className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setIsMobileMoreOpen(true)}
                className="no-drag p-1.5 rounded-lg text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-dark-hover"
                title="更多"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>
          </>
        ) : (
          <>
            {/*
              左侧这块不再整体 no-drag：无边框下这片空白是最好用的拖拽区，
              只把真正要响应点击的元素标成 no-drag，剩下的交给顶栏的 drag-region。
            */}
            <div className="flex items-center gap-3 flex-shrink-0 min-w-0 flex-1 md:flex-none">
              <WindowControls className="mr-1 hidden md:flex" />

          {/* 移动端：层级返回，回到工具中心 */}
          <button
            onClick={onBackToHub}
            className="no-drag md:hidden p-1 -ml-1 rounded-md text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-dark-hover"
            title="返回工具中心"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          {/* 只有笔记页有可折叠的二级面板。翻译页原先也有（方向 + 历史），
              现已移除 —— 那里两个区块在右侧输入区与顶栏都有等价入口 */}
          {!isTranslateActive && (!isMobile || isMarkdownActive) && (
            <Tooltip content={isSidebarOpen ? '折叠侧边栏 (⌘B)' : '展开侧边栏 (⌘B)'}>
              <button
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                className="no-drag p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            </Tooltip>
          )}

          <div className="hidden md:block h-4 w-[1px] bg-slate-200 dark:bg-dark-border" />

          {/* 面包屑：移动端只留当前文档名，把宽度让给标题 */}
          <div className="flex items-center gap-2 text-[13px] font-medium text-slate-500 dark:text-slate-400 min-w-0 flex-1 md:flex-none">
            <span
              onClick={onBackToHub}
              className="no-drag hidden md:inline hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors"
            >
              devNotes
            </span>
            <ChevronRight className="hidden md:block w-3.5 h-3.5 text-slate-300 dark:text-slate-600" />
            {/*
              这一层本来就能弹右键菜单（handleBreadcrumbContextMenu），说明它的指针事件
              一定是通的 —— 把「点击进编辑」挂在这里，是挂在一块已证实可交互的区域上，
              而不是赌某个子孙元素的 no-drag 生效。
            */}
            <span
              onContextMenu={handleBreadcrumbContextMenu}
              className="no-drag text-slate-900 dark:text-white font-semibold flex items-center gap-1.5 min-w-0 flex-1 md:flex-none md:w-[200px]"
            >
              {/*
                key 绑当前工具：名字换了就重挂载一次，让 fe-rise 重播一段淡入。
                包在外层 span 里而不是给 span 加 key —— 外层带 onContextMenu 与
                宽度约束，跟着重挂会把这几个布局属性一起重建，顶栏会闪一下。
              */}
              <span
                key={currentTool?.id || 'none'}
                className="fe-rise flex items-center gap-1.5 min-w-0"
              >
                {isMarkdownActive ? (
                  <>
                    <FileCode className="w-4 h-4 text-brand-600 dark:text-brand-400 flex-shrink-0" />
                    <FileCode className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 flex-shrink-0" />
                    <span className="min-w-0 truncate">{activeNote?.title || '未命名笔记'}</span>
                  </>
                ) : (
                  <>
                    <ToolIcon toolId={currentTool?.id || ''} className="w-4 h-4 text-brand-600 dark:text-brand-400 flex-shrink-0" />
                    <span className="min-w-0 truncate">{currentTool?.name || '工具'}</span>
                  </>
                )}
              </span>
            </span>
          </div>
        </div>

        {/* 中部全局指令触发器 (⌘K) */}
        <div className="hidden md:block flex-1 max-w-[260px] mx-4">
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
        <div className="flex items-center gap-1.5 text-xs">
          {/* 主题入口：移动端不在顶栏出现，统一收进「设置 → 通用」 */}
          <div className="hidden md:flex items-center gap-1.5">
            <ThemeQuickMenu
              theme={theme}
              onSelectTheme={onSelectTheme}
              onOpenSettings={() => {
                setSettingsSection('general')
                setIsSettingsOpen(true)
              }}
            />

            {/* 快捷对偶深浅切换 */}
            <Tooltip content={isDark ? '快捷切换为浅色模式 (⌘D)' : '快捷切换为深色模式 (⌘D)'}>
              <button
                onClick={onToggleTheme}
                className="no-drag p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover rounded-lg transition-colors"
              >
                {isDark ? (
                  <Moon className="w-4 h-4 text-brand-400" />
                ) : (
                  <Sun className="w-4 h-4 text-amber-500" />
                )}
              </button>
            </Tooltip>

            <div className="h-4 w-[1px] bg-slate-200 dark:bg-dark-border" />
          </div>

          {/* 常用工具快捷入口：端口被占用、临时记一笔都属于「不想先切页」的操作，
              放顶栏一键直达，比从工具中心绕一圈快 */}
          <Tooltip content="打开草稿纸置顶小窗 (⌥⇧N)">
            <button
              onClick={() => {
                if (!window.electronAPI?.scratchOpen) {
                  onOpenTool('scratchpad')
                  return
                }
                void window.electronAPI.scratchOpen()
              }}
              className="no-drag p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover rounded-lg transition-colors"
            >
              <StickyNote className="w-4 h-4" />
            </button>
          </Tooltip>

          <Tooltip content="排查端口占用">
            <button
              onClick={() => onOpenTool('port-killer')}
              className="no-drag p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover rounded-lg transition-colors"
            >
              <Network className="w-4 h-4" />
            </button>
          </Tooltip>


          {/* 右侧主操作动作 */}
          {isMarkdownActive ? (
            <Tooltip content="导出当前 Markdown 文件">
              <button
                onClick={() => void handleExportNote()}
                className="no-drag flex items-center gap-1.5 px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg shadow-xs shadow-brand-500/20 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden md:inline">导出 .md</span>
              </button>
            </Tooltip>
          ) : (
            <button
              onClick={onBackToHub}
              className="no-drag flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-dark-hover hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium rounded-lg border border-slate-200 dark:border-dark-border transition-all"
            >
              <span>工具中心</span>
            </button>
          )}
        </div>
          </>
        )}
      </header>

      {/* ================= 2. 主体三栏布局 ================= */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 2.1 工具箱极简侧边栏 (56px / w-14) */}
        <aside className="hidden md:flex w-14 bg-slate-50 dark:bg-dark-sidebar border-r border-slate-200/80 dark:border-dark-border flex-col items-center py-3 gap-4 flex-shrink-0 z-20 overflow-y-auto scrollbar-hide">
          {/* 品牌 Logo */}
          <Tooltip content="devNotes 工具中心">
            <img
              src={logo}
              alt="devNotes"
              onClick={onBackToHub}
              className="w-8 h-8 object-contain cursor-pointer transition-[transform,filter] duration-200 hover:scale-105 active:scale-95 drop-shadow-[0_0_10px_rgba(80,189,207,0.35)] hover:drop-shadow-[0_0_16px_rgba(80,189,207,0.6)]"
            />
          </Tooltip>

          {/* 常用小工具 Rail 导航。
              默认项可在「设置 → 通用 → 左侧菜单栏」里改，配置见 sidebarLayout.ts */}
          <nav className="flex-1 flex flex-col gap-2 w-full px-2">
            {railToolIds.map((toolId, index) => {
              const meta = allModules.find((item) => item.id === toolId)
              if (!meta) return null
              const isActive = activeTabId === toolId
              return (
                <Fragment key={toolId}>
                  {/* 独立模块（笔记 / 翻译 / 片段库）与普通小工具之间留一条分隔线 */}
                  {index > 0 && isStandalone(railToolIds[index - 1]) !== isStandalone(toolId) && (
                    <div className="h-[1px] w-6 mx-auto bg-slate-200 dark:bg-dark-border" />
                  )}
                  <Tooltip content={meta.name}>
                    <button
                      onClick={() => {
                        // 草稿纸的形态是置顶小窗，Rail 上点它就直接把小窗调出来；
                        // 页内编辑版仍可从工具中心进入
                        if (toolId === 'scratchpad' && window.electronAPI?.scratchOpen) {
                          void window.electronAPI.scratchOpen()
                          return
                        }
                        onOpenTool(toolId)
                      }}
                      className={`relative group w-full aspect-square flex items-center justify-center rounded-xl transition-all ${isActive
                        ? 'bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border text-brand-600 dark:text-brand-400'
                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
                        }`}
                    >
                      <ToolIcon toolId={toolId} className="w-4 h-4" />
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-brand-600 rounded-r-md" />
                      )}
                    </button>
                  </Tooltip>
                </Fragment>
              )
            })}

          </nav>

          {/* 底部：云同步状态灯 + 统计 + 工具库 + 设置 */}
          <div className="flex flex-col gap-2 w-full px-2">
            {/* 云同步状态灯（开启云同步后才出现），点击进入云同步设置 */}
            {cfConfig.enabled && (
              <Tooltip content={cfSyncMessage || 'Cloudflare 云同步'}>
                <button
                  onClick={() => openSettings('cloud-sync')}
                  className={`relative w-full aspect-square flex items-center justify-center rounded-xl transition-all ${cfSyncStatus === 'error'
                    ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30'
                    : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover'
                    }`}
                >
                  <Cloud className="w-4 h-4" />
                  <span
                    className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${cfSyncStatus === 'syncing'
                      ? 'bg-orange-500 animate-pulse'
                      : cfSyncStatus === 'error'
                        ? 'bg-rose-500'
                        : 'bg-emerald-500'
                      }`}
                  />
                </button>
              </Tooltip>
            )}

            <Tooltip content="使用统计">
              <button
                onClick={onOpenStats}
                className="w-full aspect-square flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover transition-all"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip content="全部小工具库">
              <button
                onClick={onBackToHub}
                className="w-full aspect-square flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover transition-all"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </Tooltip>
            {/* 全局设置入口：云同步、翻译接口、外观等统一收在这里 */}
            <Tooltip content="设置 (⌘,)">
              <button
                onClick={() => openSettings('general')}
                className="w-full aspect-square flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover transition-all"
              >
                <Settings className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </aside>

        {/* 移动端目录抽屉的遮罩：点空白处收起 */}
        {isMobile && isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="absolute inset-0 z-[45] bg-slate-900/40"
          />
        )}

        {/* 2.2 二级侧边栏（文档目录，宽度可拖拽调整 / 可折叠） */}
        {/* 翻译页不挂侧边栏：它原来那两个区块（翻译方向、翻译历史）在右侧
            输入区与顶栏都有等价入口，留着只占地方。
            笔记与片段库则相反 —— 它们的列表就住在这条侧栏里，必须留着 */}
        {!isTranslateActive && (
        <section
          ref={sidebarRef}
          style={isMobile ? undefined : { width: isSidebarOpen ? sidebarWidth : 0 }}
          className={`bg-white dark:bg-dark-panel border-r border-slate-200/80 dark:border-dark-border flex flex-col ${isMobile
            ? `absolute inset-y-0 left-0 z-50 w-[82vw] max-w-[320px] shadow-2xl transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
            : `flex-shrink-0 ${isSidebarOpen ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden border-r-0'} ${isResizingSidebar ? '' : 'transition-[width,opacity] duration-300'}`
            }`}
        >
          {isMarkdownActive ? (
            <NotesSidebar onAfterSelect={() => isMobile && setIsSidebarOpen(false)} />
          ) : isSnippetsActive ? (
            <SnippetsSidebar onAfterSelect={() => isMobile && setIsSidebarOpen(false)} />
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
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={toolFilter}
                    onChange={(e) => setToolFilter(e.target.value)}
                    placeholder="搜索组件..."
                    className="w-full pl-8 pr-7 h-7 text-xs bg-slate-50 dark:bg-dark-sidebar border border-slate-200 dark:border-dark-border rounded-lg outline-none focus:border-brand-500 dark:focus:border-brand-500 transition-all text-slate-800 dark:text-slate-200 placeholder-slate-400"
                  />
                  {toolFilter && (
                    <button
                      onClick={() => setToolFilter('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
                      title="清空"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="flex gap-1 overflow-x-auto scrollbar-hide py-1">
                  {toolCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap transition-all ${activeCategory === cat.id
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
                      className={`group p-2 rounded-xl cursor-pointer transition-all border flex items-center justify-between ${isActive
                        ? 'bg-brand-50/70 dark:bg-brand-500/10 border-brand-100 dark:border-brand-500/20 text-slate-900 dark:text-white font-semibold'
                        : 'hover:bg-slate-50 dark:hover:bg-dark-hover/60 border-transparent text-slate-600 dark:text-slate-300'
                        }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-5 h-5 flex items-center justify-center rounded-md bg-slate-100 dark:bg-dark-sidebar flex-shrink-0">
                          <ToolIcon toolId={tool.id} className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 group-hover:text-brand-500 transition-colors" />
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

          {/* 移动端抽屉底部：状态 + 主入口。移动端顶栏没有标签栏，导航统一收在这里 */}
          {isMobile && (
            <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200/80 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-dark-border dark:bg-dark-panel">
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${
                    cfSyncStatus === 'error'
                      ? 'bg-rose-500'
                      : cfSyncStatus === 'syncing'
                        ? 'bg-orange-500 animate-pulse'
                        : 'bg-emerald-500'
                  }`}
                />
                <span className="truncate">
                  {cfConfig.enabled ? cfSyncMessage || '云同步已就绪' : '本地存储'}
                </span>
              </span>
              <div className="flex flex-shrink-0 items-center gap-0.5">
                <button
                  onClick={() => {
                    setIsSidebarOpen(false)
                    onBackToHub()
                  }}
                  className="p-1.5 rounded-lg text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-dark-hover"
                  title="工具中心"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setIsSidebarOpen(false)
                    onOpenStats()
                  }}
                  className="p-1.5 rounded-lg text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-dark-hover"
                  title="使用统计"
                >
                  <BarChart3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setIsSidebarOpen(false)
                    openSettings('general')
                  }}
                  className="p-1.5 rounded-lg text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-dark-hover"
                  title="设置"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </section>
        )}

        {/* 2.2.1 文档目录宽度分割线：负边距覆盖在侧边栏右边框上，不挤占主工作台 */}
        {!isTranslateActive && !isMobile && isSidebarOpen && (
          <Tooltip content="拖动调整文档目录宽度，双击恢复默认">
            <div
              onMouseDown={handleSidebarResizeStart}
              onDoubleClick={resetSidebarWidth}
              className={`-ml-[5px] w-[5px] flex-shrink-0 cursor-col-resize relative z-30 transition-colors ${isResizingSidebar
                ? 'bg-brand-500'
                : 'hover:bg-brand-400/70 dark:hover:bg-brand-500/70'
                }`}
            />
          </Tooltip>
        )}

        {/* 2.3 编辑器 / 工具主工作台 (Editor Workspace) */}
        <main className="flex-1 flex flex-col bg-white dark:bg-dark-panel overflow-hidden min-w-0">
          {/* 渲染当前工具内容 */}
          {/*
            主工作台：切工具时上下滑动切换。
            旧页往上走（并压远一点点）、新页从下方推上来，方向跟着「在工具列表里
            往前还是往后跳」变 —— 用 Tab 循环切标签时的空间感就来自这里。

            两页都是 absolute 铺满：动画期间它们必须重叠才能各播各的，
            留在文档流里的话会一上一下把容器撑成两倍高，滚一下整页就抖。
          */}
          <div className="flex-1 overflow-hidden relative" data-dir={slide.direction}>
            {slide.leaving && (
              <div
                key={`out-${slide.leaving.key}`}
                className="fe-slide-out absolute inset-0 pointer-events-none"
                aria-hidden
              >
                <ToolPage toolId={slide.leaving.value} />
              </div>
            )}
            <div key={`in-${activeTabId}`} className="fe-slide-in absolute inset-0">
              <ToolPage toolId={activeTabId} />
            </div>
          </div>
        </main>
      </div>

      {/* 移动端「更多」动作面板 */}
      {isMobile && isMobileMoreOpen && (
        <div
          onClick={() => setIsMobileMoreOpen(false)}
          className="fixed inset-0 z-[70] flex items-end bg-slate-900/50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-2xl border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-dark-border dark:bg-dark-panel"
          >
            <div className="mx-auto my-2.5 h-1 w-10 rounded-full bg-slate-300 dark:bg-dark-hover" />
            <div className="px-3 pb-2">
              {isMarkdownActive && (
                <button
                  onClick={() => {
                    setIsMobileMoreOpen(false)
                    void handleExportNote()
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-dark-hover"
                >
                  <Download className="w-4 h-4 flex-shrink-0 text-slate-400" />
                  导出 .md
                </button>
              )}
              <button
                onClick={() => {
                  setIsMobileMoreOpen(false)
                  onBackToHub()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-dark-hover"
              >
                <LayoutGrid className="w-4 h-4 flex-shrink-0 text-slate-400" />
                工具中心
              </button>
              <button
                onClick={() => {
                  setIsMobileMoreOpen(false)
                  onOpenStats()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-dark-hover"
              >
                <BarChart3 className="w-4 h-4 flex-shrink-0 text-slate-400" />
                使用统计
              </button>
              <button
                onClick={() => {
                  setIsMobileMoreOpen(false)
                  openSettings('general')
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-dark-hover"
              >
                <Settings className="w-4 h-4 flex-shrink-0 text-slate-400" />
                设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 3. ⌘K 全局指令面板 (Command Palette Modal) ================= */}
      {cmdMounted && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCmdOpen(false)
          }}
          data-state={cmdState}
          className="fe-fade fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs z-[60] flex items-start justify-center pt-24"
        >
          <div
            data-state={cmdState}
            className="fe-modal w-full max-w-lg bg-white dark:bg-dark-panel rounded-2xl shadow-2xl border border-slate-200 dark:border-dark-border overflow-hidden"
          >
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
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-brand-50 dark:hover:bg-dark-hover hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer transition-colors"
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

      {/* 全局设置弹窗：云同步 / AI 与翻译 / 通用外观 */}
      <SettingsModal
        open={isSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        onSelectTheme={onSelectTheme}
        onResetSidebarWidth={resetSidebarWidth}
      />
    </div>
  )
}
