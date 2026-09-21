import { useState, useEffect } from 'react'
import Home from './pages/Home'
import DashboardLayout from './components/layout/DashboardLayout'
import Stats from './pages/Stats'
import { NotesProvider } from './context/NotesContext'
import { TranslateProvider } from './context/TranslateContext'
import { ContextMenuProvider } from './components/ui/ContextMenu'
import { ToastProvider } from './components/ui/Toast'
import {
  getCachedTheme,
  getOppositeTheme,
  isDarkTheme,
  saveTheme,
  type ThemeId,
} from './utils/theme'

export type ViewMode = 'hub' | 'dashboard' | 'stats'

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [activeTabId, setActiveTabId] = useState<string>('markdown-notes')
  const [theme, setTheme] = useState<ThemeId>(() => getCachedTheme())

  const [usageStats, setUsageStats] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('fehelper-usage-stats')
    return saved ? JSON.parse(saved) : {}
  })

  // 同步主题到 documentElement：
  // 换肤瞬间添加 disable-transitions 锁，确保所有 DOM 节点在同一物理帧完成颜色切换，杜绝目录延迟
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('disable-transitions')
    root.setAttribute('data-theme', theme)
    if (isDarkTheme(theme)) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    saveTheme(theme)

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove('disable-transitions')
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [theme])

  // ⌘D：在同色系的对偶主题之间来回切（浅色 ↔ 深色）
  const toggleTheme = () => {
    setTheme((prev) => getOppositeTheme(prev))
  }

  const selectTheme = (next: ThemeId) => setTheme(next)

  useEffect(() => {
    localStorage.setItem('fehelper-usage-stats', JSON.stringify(usageStats))
  }, [usageStats])

  const openTool = (toolId: string) => {
    // 增加使用计数
    setUsageStats((prev) => ({
      ...prev,
      [toolId]: (prev[toolId] || 0) + 1,
    }))

    setActiveTabId(toolId)
    setViewMode('dashboard')
  }

  const navigateToHub = () => setViewMode('hub')
  const navigateToStats = () => setViewMode('stats')

  // 外部打开 md 文件导入成功后,切回 Markdown 笔记页并选中
  const navigateToNotes = () => {
    setActiveTabId('markdown-notes')
    setViewMode('dashboard')
  }

  return (
    <ToastProvider>
      <ContextMenuProvider>
        <NotesProvider onFileOpenNavigate={navigateToNotes}>
          {/* 文本翻译是独立模块：语言偏好、输入输出、历史放在自己的 Provider 里，
              翻译页与它的专属二级侧边栏共用同一份状态 */}
          <TranslateProvider>
            {viewMode === 'stats' && (
              <Stats usageStats={usageStats} onBack={navigateToHub} />
            )}

            {viewMode === 'dashboard' && (
              <DashboardLayout
                activeTabId={activeTabId || 'markdown-notes'}
                onOpenTool={openTool}
                onBackToHub={navigateToHub}
                onOpenStats={navigateToStats}
                theme={theme}
                onToggleTheme={toggleTheme}
                onSelectTheme={selectTheme}
              />
            )}

            {viewMode === 'hub' && (
              <Home
                onOpenTool={openTool}
                onOpenStats={navigateToStats}
                onBack={() => setViewMode('dashboard')}
                usageStats={usageStats}
              />
            )}
          </TranslateProvider>
        </NotesProvider>
      </ContextMenuProvider>
    </ToastProvider>
  )
}

export default App
