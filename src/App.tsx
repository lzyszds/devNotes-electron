import { useState, useEffect, useRef } from 'react'
import DashboardLayout from './components/layout/DashboardLayout'
import Stats from './pages/Stats'
import { NotesProvider } from './context/NotesContext'
import { TranslateProvider } from './context/TranslateContext'
import { ContextMenuProvider } from './components/ui/ContextMenu'
import { ToastProvider } from './components/ui/Toast'
import { requestOcr } from './utils/ocrBus'
import { recordDailyUse, recordToolUse } from './utils/usageLog'
import { jsonToolboxAliases } from './types'
import { requestJsonToolboxMode } from './components/tools/JsonToolbox'

export type ViewMode = 'dashboard' | 'stats'
function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [activeTabId, setActiveTabId] = useState<string>('markdown-notes')

  const [usageStats, setUsageStats] = useState<Record<string, number>>(() => {
    let saved: Record<string, number> = {}
    try {
      const raw = localStorage.getItem('fehelper-usage-stats')
      if (raw) saved = JSON.parse(raw)
    } catch {
      saved = {}
    }
    // 旧 json 三件套的计数合并进工具箱，排行里才不会凭空丢历史
    let legacy = 0
    for (const key of Object.keys(jsonToolboxAliases)) {
      legacy += saved[key] ?? 0
      delete saved[key]
    }
    if (legacy > 0) saved['json-toolbox'] = (saved['json-toolbox'] ?? 0) + legacy
    return saved
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

  const tallyTool = (toolId: string) => {
    setUsageStats((prev) => ({
      ...prev,
      [toolId]: (prev[toolId] || 0) + 1,
    }))
    // 统计页的时效性内容（趋势 / 今日用量 / 连续天数 / 最近使用）靠这两笔日志
    recordDailyUse()
    recordToolUse(toolId)
  }

  const openTool = (toolId: string) => {
    // 旧 json 三件套的 id 解析成工具箱子模式：快捷键、⌘K、旧数据里的深链接都还能用
    const aliasMode = jsonToolboxAliases[toolId]
    if (aliasMode) {
      requestJsonToolboxMode(aliasMode)
      toolId = 'json-toolbox'
    }
    tallyTool(toolId)

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
              <Stats
                usageStats={usageStats}
                onBack={navigateToDashboard}
                onOpenTool={openTool}
              />
            )}

            {viewMode === 'dashboard' && (
              <DashboardLayout
                activeTabId={activeTabId || 'markdown-notes'}
                onOpenTool={openTool}
                onOpenStats={navigateToStats}
                onTallyTool={tallyTool}
              />
            )}
          </TranslateProvider>
        </NotesProvider>
      </ContextMenuProvider>
    </ToastProvider>
  )
}

export default App
