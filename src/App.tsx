import { useState, useEffect, useRef } from 'react'
import DashboardLayout from './components/layout/DashboardLayout'
import Stats from './pages/Stats'
import { NotesProvider } from './context/NotesContext'
import { TranslateProvider } from './context/TranslateContext'
import { ContextMenuProvider } from './components/ui/ContextMenu'
import { ToastProvider } from './components/ui/Toast'
import { requestOcr } from './utils/ocrBus'

export type ViewMode = 'dashboard' | 'stats'

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [activeTabId, setActiveTabId] = useState<string>('markdown-notes')

  const [usageStats, setUsageStats] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('fehelper-usage-stats')
    return saved ? JSON.parse(saved) : {}
  })

  // 固化全局唯一的 Notion 极简暖灰阶工作台，彻底移除 dark 与多主题切换
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark')
    root.setAttribute('data-theme', 'notion-warm')
    try {
      localStorage.removeItem('fehelper-theme')
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('fehelper-usage-stats', JSON.stringify(usageStats))
  }, [usageStats])

  const openToolRef = useRef<(toolId: string) => void>(() => {})
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onToolOpenRequest) return
    return api.onToolOpenRequest((toolId) => openToolRef.current(toolId))
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onCaptureOcrRequest) return
    return api.onCaptureOcrRequest((dataUrl) => {
      openToolRef.current('text-translate')
      window.setTimeout(() => requestOcr(dataUrl), 0)
    })
  }, [])

  const openTool = (toolId: string) => {
    setUsageStats((prev) => ({
      ...prev,
      [toolId]: (prev[toolId] || 0) + 1,
    }))

    setActiveTabId(toolId)
    setViewMode('dashboard')
  }

  openToolRef.current = openTool

  const navigateToDashboard = () => setViewMode('dashboard')
  const navigateToStats = () => setViewMode('stats')

  const navigateToNotes = () => {
    setActiveTabId('markdown-notes')
    setViewMode('dashboard')
  }

  return (
    <ToastProvider>
      <ContextMenuProvider>
        <NotesProvider onFileOpenNavigate={navigateToNotes}>
          <TranslateProvider>
            {viewMode === 'stats' && (
              <Stats usageStats={usageStats} onBack={navigateToDashboard} />
            )}

            {viewMode === 'dashboard' && (
              <DashboardLayout
                activeTabId={activeTabId || 'markdown-notes'}
                onOpenTool={openTool}
                onOpenStats={navigateToStats}
              />
            )}
          </TranslateProvider>
        </NotesProvider>
      </ContextMenuProvider>
    </ToastProvider>
  )
}

export default App
