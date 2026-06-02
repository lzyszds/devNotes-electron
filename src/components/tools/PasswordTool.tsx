import { useState, useEffect } from 'react'
import { Lock, Copy, RefreshCw, Eye, EyeOff, History, Clock, ChevronRight } from 'lucide-react'
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
    saveHistory(password, password.slice(0, 15) + '...')
  }

  const copyPassword = () => {
    if (password) navigator.clipboard.writeText(password)
  }

  useEffect(() => {
    generatePassword()
  }, [])

  const getStrengthColor = () => {
    if (strength < 40) return 'bg-red-500'
    if (strength < 70) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const getStrengthText = () => {
    if (strength < 40) return '弱'
    if (strength < 70) return '中等'
    return '强'
  }

  return (
    <div className="flex h-full min-h-[600px]">
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
           <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Password Generator</p>
              <h3 className="mt-1 text-xl font-bold text-slate-900">随机密码生成</h3>
           </div>
           <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary h-9 ${showHistory ? 'bg-slate-100 ring-1 ring-slate-900' : ''}`}
            >
              <History className="h-4 w-4" />
              历史
            </button>
        </div>

        <div className="mb-6 rounded-xl bg-slate-50 p-6 border border-slate-200">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-500">
              <Lock className="h-5 w-5" />
              <span className="text-sm font-bold uppercase tracking-tight">Generated Password</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="tool-button-secondary px-3 py-2"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button onClick={copyPassword} className="tool-button-secondary px-3 py-2">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-[2rem] break-all font-mono text-2xl font-bold text-slate-900">
            {showPassword ? password : password.replace(/./g, '•')}
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase">Strength</span>
              <span className={`text-xs font-bold ${strength < 40 ? 'text-rose-500' : strength < 70 ? 'text-amber-500' : 'text-emerald-600'}`}>
                {getStrengthText()}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white">
              <div className={`h-full ${getStrengthColor()} transition-all duration-300`} style={{ width: `${strength}%` }} />
            </div>
          </div>
        </div>

        <div className="space-y-6 mb-8">
          <div>
            <label className="tool-label">
              密码长度: {length}
            </label>
            <input
              type="range"
              min="4"
              max="64"
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {Object.entries({
              uppercase: '大写字母 (A-Z)',
              lowercase: '小写字母 (a-z)',
              numbers: '数字 (0-9)',
              symbols: '特殊符号 (!@#$)'
            }).map(([key, label]) => (
              <label
                key={key}
                className="soft-panel flex cursor-pointer items-center gap-3 p-3 transition hover:bg-white hover:ring-1 hover:ring-slate-900/10"
              >
                <input
                  type="checkbox"
                  checked={options[key as keyof typeof options]}
                  onChange={(e) => setOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                  className="w-4 h-4 text-slate-900 border-slate-200 rounded focus:ring-slate-900"
                />
                <span className="text-xs font-bold text-slate-600">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={generatePassword}
            className="tool-button-primary flex-1 py-3"
          >
            <RefreshCw className="h-4 w-4" /> 重新生成
          </button>
          <button
            onClick={saveToHistoryManual}
            className="tool-button-secondary flex-1 py-3"
          >
            保存到历史
          </button>
        </div>
      </div>

      {/* History Sidebar */}
      {showHistory && (
        <aside className="w-80 border-l border-slate-200 bg-slate-50/50 flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Clock size={16} />
              生成历史
            </div>
            <button onClick={clearHistory} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 uppercase tracking-wider transition">
              清空
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {history.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-xs italic">暂无历史记录</div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setPassword(item.data)
                    calculateStrength(item.data)
                    setShowHistory(false)
                  }}
                  className="w-full text-left p-3 rounded-lg bg-white border border-slate-200 shadow-sm hover:border-slate-900 transition-all group"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                    <ChevronRight size={12} className="text-slate-200 group-hover:text-slate-900 transition-colors" />
                  </div>
                  <p className="text-xs font-mono font-bold text-slate-700 truncate">{item.data}</p>
                </button>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
