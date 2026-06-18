import { useState, useEffect } from 'react'
import { Lock, Copy, RefreshCw, Eye, EyeOff, History, Clock, ChevronRight, ShieldCheck, Settings2, Zap, X } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'

const CHAR_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
}

export default function PasswordTool() {
  const [length, setLength] = useState(16)
  const [options, setOptions] = useState({
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true
  })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [strength, setStrength] = useState(0)
  const [showHistory, setShowHistory] = useState(false)

  const { history, saveHistory, clearHistory } = useToolHistory<string>('password')

  const generatePassword = () => {
    let chars = ''
    if (options.uppercase) chars += CHAR_SETS.uppercase
    if (options.lowercase) chars += CHAR_SETS.lowercase
    if (options.numbers) chars += CHAR_SETS.numbers
    if (options.symbols) chars += CHAR_SETS.symbols

    if (!chars) return

    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setPassword(result)
    calculateStrength(result)
  }

  const calculateStrength = (pwd: string) => {
    let score = 0
    if (pwd.length >= 8) score += 25
    if (pwd.length >= 12) score += 25
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 20
    if (/\d/.test(pwd)) score += 15
    if (/[^A-Za-z0-9]/.test(pwd)) score += 15
    setStrength(score)
  }

  const saveToHistoryManual = () => {
    if (!password) return
    saveHistory(password, `${length} 位 / ${getStrengthText()}`)
  }

  const copyPassword = () => {
    if (password) navigator.clipboard.writeText(password)
  }

  useEffect(() => {
    generatePassword()
  }, [])

  const getStrengthColor = () => {
    if (strength < 40) return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
    if (strength < 70) return 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
    return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
  }

  const getStrengthText = () => {
    if (strength < 40) return '弱'
    if (strength < 70) return '中等'
    return '强'
  }

  return (
    <div className="relative flex h-full min-h-[600px] bg-white overflow-hidden text-slate-900">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Action Header */}
        <div className="px-8 py-5 flex items-center justify-between border-b border-slate-100">
           <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg shadow-slate-100">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">安全密码保险箱</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">生成具备高熵强度的加密随机密码</p>
              </div>
           </div>

           <div className="flex items-center gap-3">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`tool-button-secondary h-10 px-4 ${showHistory ? 'ring-2 ring-slate-900/20 border-slate-300 text-slate-900' : ''}`}
              >
                <History size={16} />
                <span>密码库</span>
              </button>
              <div className="w-px h-6 bg-slate-100" />
              <button 
                onClick={generatePassword}
                className="tool-button-primary h-10 bg-slate-900 shadow-lg shadow-slate-100 px-6"
              >
                <RefreshCw size={16} /> 重新生成
              </button>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/20">
           <div className="max-w-4xl mx-auto space-y-8">
              {/* Display Card */}
              <div className="workspace-card p-10 relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-8 opacity-[0.03]">
                    <Lock size={120} />
                 </div>
                 
                 <div className="relative z-10 space-y-8 text-center">
                    <div className="space-y-4">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">生成的随机密钥</label>
                       <div className="flex items-center justify-center gap-6">
                          <div className="text-4xl font-mono font-black text-slate-900 tracking-tighter break-all max-w-2xl">
                             {showPassword ? password : password.replace(/./g, '•')}
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                             <button onClick={() => setShowPassword(!showPassword)} className="p-3 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-900 transition-all border border-slate-100 hover:border-slate-300">
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                             </button>
                             <button onClick={copyPassword} className="p-3 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-900 transition-all border border-slate-100 hover:border-slate-300">
                                <Copy size={20} />
                             </button>
                          </div>
                       </div>
                    </div>

                    <div className="max-w-md mx-auto space-y-3">
                       <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">密码强度分析</span>
                          <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${strength < 40 ? 'text-rose-500 bg-rose-50' : strength < 70 ? 'text-amber-500 bg-amber-50' : 'text-emerald-500 bg-emerald-50'}`}>
                             {getStrengthText()}
                          </span>
                       </div>
                       <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${getStrengthColor()} transition-all duration-500`} style={{ width: `${strength}%` }} />
                       </div>
                    </div>
                 </div>
              </div>

              {/* Controls Grid */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8">
                 {/* Length Slider */}
                 <div className="tool-panel flex flex-col justify-center gap-6">
                    <div className="flex items-center gap-2 mb-2">
                       <Settings2 size={16} className="text-slate-400" />
                       <label className="tool-label mb-0">密码字符长度</label>
                    </div>
                    <div className="space-y-4">
                       <div className="flex items-center justify-between">
                          <span className="text-4xl font-black text-slate-900">{length}</span>
                          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">位</span>
                       </div>
                       <input
                          type="range"
                          min="4"
                          max="64"
                          value={length}
                          onChange={(e) => setLength(Number(e.target.value))}
                          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
                       />
                    </div>
                 </div>

                 {/* Character Options */}
                 <div className="tool-panel">
                    <div className="flex items-center gap-2 mb-6">
                       <Zap size={16} className="text-slate-400" />
                       <label className="tool-label mb-0">包含字符类型</label>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       {Object.entries({
                          uppercase: { label: '大写字母', sub: 'A-Z' },
                          lowercase: { label: '小写字母', sub: 'a-z' },
                          numbers: { label: '数字', sub: '0-9' },
                          symbols: { label: '特殊符号', sub: '!@#$' }
                       }).map(([key, val]) => (
                          <label
                             key={key}
                             className={`group p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${options[key as keyof typeof options] ? 'border-slate-900 bg-white ring-1 ring-slate-900/5' : 'border-slate-100 bg-white/50 grayscale opacity-60'}`}
                          >
                             <div className="flex flex-col">
                                <span className="text-[11px] font-black text-slate-900 uppercase tracking-tight">{val.label}</span>
                                <span className="text-[10px] font-bold text-slate-400 tracking-widest">{val.sub}</span>
                             </div>
                             <input
                                type="checkbox"
                                checked={options[key as keyof typeof options]}
                                onChange={(e) => setOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                                className="w-4 h-4 text-slate-900 border-slate-200 rounded focus:ring-slate-900 cursor-pointer"
                             />
                          </label>
                       ))}
                    </div>
                 </div>
              </div>

              <div className="flex justify-center">
                 <button 
                  onClick={saveToHistoryManual}
                  className="tool-button-secondary h-12 px-10 text-slate-400 hover:text-slate-900 hover:border-slate-300"
                 >
                    存入保险箱历史
                 </button>
              </div>
           </div>
        </div>
      </div>

       {showHistory && (
       <div className="history-overlay">
          <button type="button" aria-label="关闭历史记录" className="history-overlay-backdrop" onClick={() => setShowHistory(false)} />
          <div className="history-overlay-panel" onClick={(e) => e.stopPropagation()}>
          <div className="p-6 border-b border-slate-200/70 bg-white/80 flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-black text-xs uppercase tracking-widest">
              <ShieldCheck size={18} className="text-slate-900" />
              最近生成的密码
            </div>
            <div className="flex items-center gap-2">
              <button onClick={clearHistory} className="text-[10px] font-black text-slate-400 hover:text-rose-500 transition uppercase">清空</button>
              <button onClick={() => setShowHistory(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={14}/></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
             {history.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                  <Clock size={32} className="mb-2 opacity-20" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">暂无记录</p>
               </div>
             ) : (
               history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setPassword(item.data); calculateStrength(item.data); setShowHistory(false); }}
                  className="w-full text-left p-5 rounded-2xl bg-white border border-slate-200/60 shadow-sm hover:border-slate-900 hover:shadow-slate-500/10 transition-all group"
                >
                  <p className="text-[11px] font-mono font-black text-slate-800 mb-2 truncate pr-4">{item.data}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{item.title}</span>
                    <ChevronRight size={10} className="text-slate-300 group-hover:text-slate-900 transition-colors" />
                  </div>
                </button>
               ))
             )}
          </div>
          </div>
       </div>
       )}
    </div>
  )
}
