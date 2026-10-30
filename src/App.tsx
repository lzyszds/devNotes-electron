import { useState, useEffect, useRef } from 'react'
import DashboardLayout from './components/layout/DashboardLayout'
import Stats from './pages/Stats'
import { NotesProvider } from './context/NotesContext'
import { TranslateProvider } from './context/TranslateContext'
import { ContextMenuProvider } from './components/ui/ContextMenu'
import { ToastProvider } from './components/ui/Toast'
import { pushTranslateRequest } from './utils/translateInbox'
import { dlog } from './utils/debugLog'
import { TranslateBridge } from './components/bridge/TranslateBridge'
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

  /*
   * 截图结果的唯一入口。
   *
   * 主进程只在「渲染层没在听」时才暂存截图；监听一挂好就发 ready 信号，
   * 主进程据此补推暂存的那张，并从此改成直推、不再留缓存。
   * 所以这里只剩一件事：把收到的图放进 translateInbox 队列。翻译页在不在、
   * 加载没加载，这里完全不管 —— 队列是唯一事实源。
   *
   * ⚠️ 不要再加「挂载时主动拉一次」。那一版会让每次刷新页面都把主进程里
   * 残留的上一次截图重新识别一遍（详见 electron/main.ts 的 pendingCapture）。
   */
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    const accept = (dataUrl: string, via: string) => {
      if (!dataUrl) return
      dlog(`[app] 收到截图结果（${via}），${Math.round(dataUrl.length / 1024)}KB`)
      pushTranslateRequest({ kind: 'ocr', dataUrl })
    }

    dlog('[app] 订阅 capture:ocr-request')
    const off = api.onCaptureOcrRequest?.((dataUrl) => accept(dataUrl, '推送')) ?? (() => {})

    /*
     * 监听挂好之后再告诉主进程。必须是同步的 send：invoke 回来的那张图会
     * 走上面这条推送路，不需要额外的返回值通道。
     */
    api.notifyCaptureOcrReady?.()

    return off
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
    dlog('[app] 切页 →', toolId)
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
      {/*
        总线消费者常驻在根部：翻译页是 lazy 的，没进过一次就不存在，
        截图结果不能指望它来订阅（见 components/bridge/TranslateBridge）。
      */}
      <TranslateBridge onOpenTool={(toolId) => openToolRef.current(toolId)} />
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
