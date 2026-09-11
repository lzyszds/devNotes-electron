import { useState, useEffect } from 'react'
import Home from './pages/Home'
import DashboardLayout from './components/layout/DashboardLayout'
import Stats from './pages/Stats'
import { NotesProvider } from './context/NotesContext'

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

  const navigateToHub = () => setViewMode('hub')
  const navigateToStats = () => setViewMode('stats')

  return (
    <NotesProvider>
      {viewMode === 'stats' && (
        <Stats usageStats={usageStats} onBack={navigateToHub} />
      )}

      {viewMode === 'dashboard' && (
        <DashboardLayout
          openTabIds={openTabIds}
          activeTabId={activeTabId || 'markdown-notes'}
          setActiveTabId={setActiveTabId}
          onCloseTab={closeTab}
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
  )
}

export default App
