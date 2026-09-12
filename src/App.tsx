import { useState, useEffect } from 'react'
import Home from './pages/Home'
import DashboardLayout from './components/layout/DashboardLayout'
import Stats from './pages/Stats'
import { NotesProvider } from './context/NotesContext'
import { ContextMenuProvider } from './components/ui/ContextMenu'
import { ToastProvider } from './components/ui/Toast'

export type ViewMode = 'hub' | 'dashboard' | 'stats'

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [openTabIds, setOpenTabIds] = useState<string[]>(['markdown-notes'])
  const [activeTabId, setActiveTabId] = useState<string>('markdown-notes')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('fehelper-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return 'light' // 参考 HTML 默认为 class="light"
  })

  const [usageStats, setUsageStats] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('fehelper-usage-stats')
    return saved ? JSON.parse(saved) : {}
  })

  // 同步明暗主题到 documentElement
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('fehelper-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  useEffect(() => {
    localStorage.setItem('fehelper-usage-stats', JSON.stringify(usageStats))
  }, [usageStats])

  const openTool = (toolId: string) => {
    // 增加使用计数
    setUsageStats((prev) => ({
      ...prev,
      [toolId]: (prev[toolId] || 0) + 1,
    }))

    // 添加到已打开的 tabs
    if (!openTabIds.includes(toolId)) {
      setOpenTabIds((prev) => [...prev, toolId])
    }

    setActiveTabId(toolId)
    setViewMode('dashboard')
  }

  const closeTab = (toolId: string) => {
    const remaining = openTabIds.filter((id) => id !== toolId)
    setOpenTabIds(remaining)

    if (remaining.length === 0) {
      setViewMode('hub')
      setActiveTabId('')
    } else if (activeTabId === toolId) {
      setActiveTabId(remaining[remaining.length - 1])
    }
  }

  // 关闭其他标签页:仅保留目标页
  const closeOtherTabs = (toolId: string) => {
    setOpenTabIds([toolId])
    setActiveTabId(toolId)
  }

  // 关闭全部标签页:回到工具中心
  const closeAllTabs = () => {
    setOpenTabIds([])
    setActiveTabId('')
    setViewMode('hub')
  }

  const navigateToHub = () => setViewMode('hub')
  const navigateToStats = () => setViewMode('stats')

  // 外部打开 md 文件导入成功后,切回 Markdown 笔记页并选中
  const navigateToNotes = () => {
    setOpenTabIds((prev) =>
      prev.includes('markdown-notes') ? prev : [...prev, 'markdown-notes']
    )
    setActiveTabId('markdown-notes')
    setViewMode('dashboard')
  }

  return (
    <ToastProvider>
      <ContextMenuProvider>
        <NotesProvider onFileOpenNavigate={navigateToNotes}>
          {viewMode === 'stats' && (
            <Stats usageStats={usageStats} onBack={navigateToHub} />
          )}

          {viewMode === 'dashboard' && (
            <DashboardLayout
              openTabIds={openTabIds}
              activeTabId={activeTabId || 'markdown-notes'}
              setActiveTabId={setActiveTabId}
              onCloseTab={closeTab}
              onCloseOtherTabs={closeOtherTabs}
              onCloseAllTabs={closeAllTabs}
              onOpenTool={openTool}
              onBackToHub={navigateToHub}
              onOpenStats={navigateToStats}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          )}

          {viewMode === 'hub' && (
            <Home
              onOpenTool={openTool}
              onOpenStats={navigateToStats}
              usageStats={usageStats}
            />
          )}
        </NotesProvider>
      </ContextMenuProvider>
    </ToastProvider>
  )
}

export default App
