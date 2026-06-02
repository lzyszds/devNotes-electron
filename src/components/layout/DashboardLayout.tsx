import { useState, useRef } from 'react'
import {
  X,
  Minus,
  Search,
  ChevronLeft,
  BarChart3,
  LayoutGrid,
} from 'lucide-react'
import { tools, toolCategories } from '../../types'
import ToolPage from '../../pages/ToolPage'

interface DashboardLayoutProps {
  openTabIds: string[]
  activeTabId: string
  setActiveTabId: (id: string) => void
  onCloseTab: (id: string) => void
  onOpenTool: (id: string) => void
  onBackToHub: () => void
  onOpenStats: () => void
}

export default function DashboardLayout({
  openTabIds,
  activeTabId,
  setActiveTabId,
  onCloseTab,
  onOpenTool,
  onBackToHub,
  onOpenStats
}: DashboardLayoutProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const scrollRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)

  const filteredTools = tools.filter((tool) => {
    const matchesSearch =
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === 'all' || tool.category === activeCategory
    return matchesSearch && matchesCategory
  })

  // Drag to scroll logic
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return
    isDragging.current = true
    startX.current = e.pageX - scrollRef.current.offsetLeft
    scrollLeft.current = scrollRef.current.scrollLeft
  }

  const handleMouseLeave = () => {
    isDragging.current = false
  }

  const handleMouseUp = () => {
    isDragging.current = false
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = (x - startX.current) * 2 // Scroll speed
    scrollRef.current.scrollLeft = scrollLeft.current - walk
  }

  return (
    <div className="flex h-screen bg-white overflow-hidden text-slate-900">
      {/* Sidebar - Prevent squeezing with shrink-0 */}
      <aside className="w-[240px] flex-shrink-0 flex flex-col bg-slate-50 border-r border-slate-200 shadow-inner">
        <div className="p-4 flex items-center gap-2 border-b border-slate-200 bg-white h-[56px]">
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-sm">
            <LayoutGrid size={18} />
          </div>
          <span className="font-bold text-sm tracking-tight">FeHelper Pro</span>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <div className="px-3 mb-6">
            <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">分类筛选</p>
            <div className="space-y-1">
              {toolCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    activeCategory === cat.id ? 'bg-slate-200 text-slate-900 shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3">
            <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">全部组件</p>
            <div className="space-y-1">
              {filteredTools.map(tool => (
                <button
                  key={tool.id}
                  onClick={() => onOpenTool(tool.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all ${
                    activeTabId === tool.id ? 'bg-white shadow-sm ring-1 ring-slate-200 font-bold text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center bg-slate-100 rounded text-[10px]">{tool.icon.length <= 3 ? tool.icon : tool.icon.charAt(0)}</span>
                    <span className="truncate">{tool.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 bg-white">
           <button 
            onClick={onOpenStats}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition text-xs font-semibold"
           >
              <BarChart3 size={16} />
              使用统计
           </button>
        </div>
      </aside>

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Global Top Navigation Bar */}
        <header className="drag-region h-[56px] border-b border-slate-200 flex items-center justify-between px-4 bg-white z-10 flex-shrink-0">
          <div className="no-drag flex items-center gap-4 flex-1">
            <button 
              onClick={onBackToHub}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition text-xs font-semibold"
            >
              <ChevronLeft size={16} />
              返回首页
            </button>

            <div className="relative max-w-sm w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="全局搜索工具..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-3 bg-slate-50 rounded-lg border border-slate-200 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition-all text-xs outline-none"
              />
            </div>
          </div>

          <div className="no-drag flex items-center gap-1 ml-4">
             <button onClick={() => window.electronAPI?.minimizeWindow()} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 transition">
                <Minus size={16} />
              </button>
              <button onClick={() => window.electronAPI?.closeWindow()} className="p-2 rounded-lg hover:bg-rose-50 hover:text-rose-500 text-slate-400 transition">
                <X size={16} />
              </button>
          </div>
        </header>

        {/* Tab Bar - Drag to scroll supported */}
        <div 
          ref={scrollRef}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseLeave}
          onMouseUp={handleMouseUp}
          onMouseMove={handleMouseMove}
          className="h-10 bg-slate-50 border-b border-slate-200 flex items-center px-4 gap-1 overflow-x-auto scrollbar-hide select-none flex-shrink-0 cursor-grab active:cursor-grabbing"
        >
          {openTabIds.map(id => {
            const tool = tools.find(t => t.id === id)
            if (!tool) return null
            return (
              <div
                key={id}
                onClick={() => setActiveTabId(id)}
                className={`group flex items-center gap-2 h-8 min-w-[120px] max-w-[240px] px-3 rounded-t-lg cursor-default border-x border-t flex-shrink-0 transition-all ${
                  activeTabId === id 
                  ? 'bg-white border-slate-200 text-slate-900 font-bold -mb-[1px] shadow-sm' 
                  : 'bg-transparent border-transparent text-slate-500 hover:bg-slate-100'
                }`}
              >
                <span className="text-[10px] text-nowrap pointer-events-none">{tool.icon.length <= 3 ? tool.icon : tool.icon.charAt(0)}</span>
                <span className="truncate text-xs pointer-events-none">{tool.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onCloseTab(id); }}
                  className="ml-auto p-0.5 rounded-md hover:bg-slate-200 transition"
                >
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>

        {/* Content Workspace */}
        <div className="flex-1 overflow-hidden relative bg-white">
           <ToolPage toolId={activeTabId} />
        </div>
      </div>
    </div>
  )
}
