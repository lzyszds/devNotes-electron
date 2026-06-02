import { ArrowLeft, BarChart3, TrendingUp, Clock, Zap } from 'lucide-react'
import { tools } from '../types'

interface StatsProps {
  usageStats: Record<string, number>
  onBack: () => void
}

export default function Stats({ usageStats, onBack }: StatsProps) {
  const sortedStats = Object.entries(usageStats)
    .map(([id, count]) => ({
      id,
      count,
      tool: tools.find(t => t.id === id)
    }))
    .filter(item => item.tool)
    .sort((a, b) => b.count - a.count)

  const totalUsage = Object.values(usageStats).reduce((a, b) => a + b, 0)
  const mostUsed = sortedStats[0]

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden text-slate-900">
      <header className="drag-region bg-white border-b border-slate-200 h-[56px] px-6 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="no-drag p-2 rounded-lg hover:bg-slate-100 transition"
          >
            <ArrowLeft size={18} className="text-slate-600" />
          </button>
          <h1 className="text-sm font-bold tracking-tight">使用统计与分析</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 text-slate-400 mb-4">
                 <Zap size={16} />
                 <span className="text-[10px] font-bold uppercase tracking-widest">累计使用</span>
              </div>
              <p className="text-3xl font-black">{totalUsage}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">所有工具的点击总数</p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 text-amber-500 mb-4">
                 <TrendingUp size={16} />
                 <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">最受欢迎</span>
              </div>
              <p className="text-lg font-bold truncate">
                {mostUsed?.tool?.name || '暂无数据'}
              </p>
              <p className="text-xs text-slate-400 mt-1 font-medium">累计使用了 {mostUsed?.count || 0} 次</p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 text-sky-500 mb-4">
                 <Clock size={16} />
                 <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">活跃状态</span>
              </div>
              <p className="text-lg font-bold">本地运行中</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">数据仅存储在本地设备</p>
            </div>
          </div>

          {/* Detailed List */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
             <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h2 className="text-sm font-bold">工具使用频率排行</h2>
                <BarChart3 size={16} className="text-slate-300" />
             </div>
             
             <div className="divide-y divide-slate-50">
               {sortedStats.length === 0 ? (
                 <div className="p-16 text-center text-slate-300 italic text-sm">
                   暂无使用数据记录。
                 </div>
               ) : (
                 sortedStats.map((item, index) => (
                   <div key={item.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition">
                      <div className="flex items-center gap-4 flex-1">
                         <span className="text-[10px] font-black text-slate-200 w-4">{index + 1}</span>
                         <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold">
                           {item.tool!.icon.length <= 3 ? item.tool!.icon : item.tool!.icon.charAt(0)}
                         </div>
                         <div className="flex-1 max-w-xs">
                            <p className="text-xs font-bold">{item.tool!.name}</p>
                            <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                               <div 
                                className="h-full bg-slate-900 rounded-full" 
                                style={{ width: `${(item.count / (mostUsed?.count || 1)) * 100}%` }}
                               />
                            </div>
                         </div>
                      </div>
                      <div className="text-right">
                         <span className="text-sm font-black">{item.count}</span>
                         <p className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">次点击</p>
                      </div>
                   </div>
                 ))
               )}
             </div>
          </div>
        </div>
      </main>
    </div>
  )
}
