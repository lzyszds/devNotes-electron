import { useState, useEffect } from 'react'
import Home from './pages/Home'
import DashboardLayout from './components/layout/DashboardLayout'
import Stats from './pages/Stats'

export type ViewMode = 'hub' | 'dashboard' | 'stats'

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('hub')
  const [openTabIds, setOpenTabIds] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [usageStats, setUsageStats] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('fehelper-usage-stats')
    return saved ? JSON.parse(saved) : {}
  })

  useEffect(() => {
    localStorage.setItem('fehelper-usage-stats', JSON.stringify(usageStats))
  }, [usageStats])

  const openTool = (toolId: string) => {
    // Increment usage
    setUsageStats(prev => ({
      ...prev,
      [toolId]: (prev[toolId] || 0) + 1
    }))

    // Add to tabs if not already present
    if (!openTabIds.includes(toolId)) {
      setOpenTabIds([...openTabIds, toolId])
    }
    
    setActiveTabId(toolId)
    setViewMode('dashboard')
  }

  const closeTab = (toolId: string) => {
    const remaining = openTabIds.filter(id => id !== toolId)
    setOpenTabIds(remaining)
    
    if (remaining.length === 0) {
      setViewMode('hub')
      setActiveTabId(null)
    } else if (activeTabId === toolId) {
      setActiveTabId(remaining[remaining.length - 1])
    }
  }

  const navigateToHub = () => setViewMode('hub')
  const navigateToStats = () => setViewMode('stats')

  if (viewMode === 'stats') {
    return <Stats usageStats={usageStats} onBack={navigateToHub} />
  }

  if (viewMode === 'dashboard' && activeTabId) {
    return (
      <DashboardLayout
        openTabIds={openTabIds}
        activeTabId={activeTabId}
        setActiveTabId={setActiveTabId}
        onCloseTab={closeTab}
        onOpenTool={openTool}
        onBackToHub={navigateToHub}
        onOpenStats={navigateToStats}
      />
    )
  }

  return (
    <Home 
      onOpenTool={openTool} 
      onOpenStats={navigateToStats} 
      usageStats={usageStats}
    />
  )
}

export default App
