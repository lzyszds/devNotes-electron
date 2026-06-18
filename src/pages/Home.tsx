import { useState } from 'react'
import {
  Search,
  BarChart3,
  X,
  Minus,
  LayoutGrid,
} from 'lucide-react'
import { tools, toolCategories } from '../types'

interface HomeProps {
  onOpenTool: (id: string) => void
  onOpenStats: () => void
  usageStats: Record<string, number>
}

export default function Home({ onOpenTool, onOpenStats, usageStats }: HomeProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')

  const filteredTools = tools.filter((tool) => {
    const matchesSearch =
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === 'all' || tool.category === activeCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="app-scene h-screen flex flex-col bg-white overflow-hidden text-slate-900">
      {/* Discreet Window Controls (Overlay) */}
      <div className="drag-region absolute top-0 left-0 right-0 h-12 flex justify-end items-center px-4 z-50 pointer-events-none">
        <div className="no-drag flex items-center gap-1 pointer-events-auto">
          <button onClick={() => window.electronAPI?.minimizeWindow()} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition">
            <Minus size={14} />
          </button>
          <button onClick={() => window.electronAPI?.closeWindow()} className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-500 text-slate-400 transition">
            <X size={14} />
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-scroll px-10 pb-20">
        <div className="max-w-4xl mx-auto pt-20">
          {/* Header */}
          <div className="text-center mb-16">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white mb-6 shadow-lg">
              <LayoutGrid size={24} />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">FeHelper 工具中心</h1>
            <p className="text-slate-500 text-sm font-medium">极致简洁的开发者生产力工具箱</p>
          </div>

          {/* Search */}
          <div className="relative mb-12 max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
            <input
              type="text"
              placeholder="搜索小工具 (支持拼音或描述)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-14 pl-12 pr-4 bg-slate-50 rounded-xl border-none ring-1 ring-slate-200/60 focus:ring-2 focus:ring-slate-900 transition-all text-sm outline-none shadow-sm"
            />
          </div>

          {/* Categories Bar */}
          <div className="flex items-center justify-between mb-8 border-b border-slate-100 pb-4">
             <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                {toolCategories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                      activeCategory === cat.id ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
             </div>
             <button 
              onClick={onOpenStats}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-100 transition text-[11px] font-bold uppercase tracking-wider"
             >
                <BarChart3 size={14} />
                统计面板
             </button>
          </div>

          {/* Compact Grid of Small Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
            {filteredTools.map(tool => (
              <button
                key={tool.id}
                onClick={() => onOpenTool(tool.id)}
                className="motion-lift group flex flex-col items-center justify-center p-5 rounded-xl bg-white ring-1 ring-slate-100 hover:ring-slate-900 hover:shadow-xl hover:shadow-slate-100 transition-all"
              >
                <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-slate-50 text-base font-bold text-slate-900 mb-3 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                  {tool.icon.length <= 3 ? tool.icon : tool.icon.charAt(0)}
                </div>
                <span className="text-[11px] font-bold text-slate-900 text-center truncate w-full">{tool.name}</span>
                {usageStats[tool.id] > 0 && (
                   <span className="mt-1 text-[9px] text-slate-300 font-bold uppercase tracking-tighter">
                     已用 {usageStats[tool.id]} 次
                   </span>
                )}
              </button>
            ))}
          </div>

          {filteredTools.length === 0 && (
            <div className="py-20 text-center text-slate-300 italic">
              <p className="text-sm">未找到相关工具</p>
            </div>
          )}
        </div>
      </main>

      <footer className="py-6 border-t border-slate-50 text-center">
         <p className="text-[9px] font-bold text-slate-300 uppercase tracking-[0.4em]">FeHelper • v2026.4.2920 • 稳定版</p>
      </footer>
    </div>
  )
}
