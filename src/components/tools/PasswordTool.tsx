import { useState, useEffect } from 'react'
import { Copy, Eye, EyeOff, History, RefreshCw, Settings2, ShieldCheck, Zap } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import { ToolBadge, ToolHistoryOverlay, ToolShell } from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'

const CHAR_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
}

const CHAR_OPTIONS = {
  uppercase: { label: '大写字母', sub: 'A-Z' },
  lowercase: { label: '小写字母', sub: 'a-z' },
  numbers: { label: '数字', sub: '0-9' },
  symbols: { label: '特殊符号', sub: '!@#$' },
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
  const { showToast } = useToast()

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('password')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setPassword(item.data)
      calculateStrength(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

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

  const getStrengthText = () => {
    if (strength < 40) return '弱'
    if (strength < 70) return '中等'
    return '强'
  }

  const strengthTone = strength < 40 ? 'rose' : strength < 70 ? 'amber' : 'emerald'

  const getStrengthColor = () => {
    if (strength < 40) return 'bg-rose-500'
    if (strength < 70) return 'bg-amber-500'
    return 'bg-emerald-500'
  }

  const saveToHistoryManual = () => {
    if (!password) return
    saveHistory(password, `${length} 位 / ${getStrengthText()}`)
    showToast('已存入保险箱历史')
  }

  const copyPassword = async () => {
    if (!password) return
    const ok = await copyText(password)
    showToast(ok ? '已复制密码' : '复制失败', ok ? 'default' : 'error')
  }

  useEffect(() => {
    generatePassword()
  }, [])

  return (
    <ToolShell
      icon={ShieldCheck}
      title="安全密码保险箱"
      subtitle="生成具备高熵强度的加密随机密码"
      badge={
        <ToolBadge tone={strengthTone}>
          {length} 位 · {getStrengthText()}
        </ToolBadge>
      }
      actions={
        <>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`tool-button-secondary h-9 ${
              showHistory
                ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'
                : ''
            }`}
          >
            <History size={15} />
            <span>密码库</span>
          </button>
          <button onClick={generatePassword} className="tool-button-primary h-9 px-5">
            <RefreshCw size={15} />
            <span>重新生成</span>
          </button>
        </>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="最近生成的密码"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setPassword(item.data)
            calculateStrength(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
          renderItemTitle={(item) => <span className="font-mono">{item.data}</span>}
        />
      }
    >
      {/* 生成结果 */}
      <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm p-6 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">生成的随机密钥</span>
          <div className="flex items-center gap-1.5">
            <Tooltip content={showPassword ? '隐藏密码' : '显示密码'}>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 transition"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </Tooltip>
            <Tooltip content="复制密码">
              <button
                type="button"
                onClick={() => void copyPassword()}
                disabled={!password}
                className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 transition disabled:opacity-40 disabled:pointer-events-none"
              >
                <Copy size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="font-mono text-2xl md:text-3xl font-bold tracking-tight break-all select-text text-slate-900 dark:text-white">
          {showPassword ? password : password.replace(/./g, '•')}
        </div>

        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 dark:text-slate-500">密码强度</span>
            <span
              className={`font-semibold ${
                strength < 40
                  ? 'text-rose-500'
                  : strength < 70
                    ? 'text-amber-500'
                    : 'text-emerald-500'
              }`}
            >
              {getStrengthText()}
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-100 dark:bg-dark-hover rounded-full overflow-hidden">
            <div
              className={`h-full ${getStrengthColor()} transition-all duration-500`}
              style={{ width: `${strength}%` }}
            />
          </div>
        </div>
      </div>

      {/* 生成参数 */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Settings2 size={13} className="text-brand-600 dark:text-brand-400" />
              密码字符长度
            </span>
          </div>

          <div className="flex-1 p-4 flex flex-col justify-center gap-4">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-slate-900 dark:text-white tabular-nums">{length}</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">位</span>
            </div>
            <input
              type="range"
              min="4"
              max="64"
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 dark:bg-dark-hover accent-brand-600"
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500">4 位最短，64 位最长</p>
          </div>
        </div>

        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Zap size={13} className="text-brand-600 dark:text-brand-400" />
              包含字符类型
            </span>
          </div>

          <div className="flex-1 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(CHAR_OPTIONS).map(([key, val]) => {
              const active = options[key as keyof typeof options]
              return (
                <label
                  key={key}
                  className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition ${
                    active
                      ? 'border-brand-300 bg-brand-50/50 dark:border-brand-500/40 dark:bg-brand-500/10'
                      : 'border-slate-200 dark:border-dark-border opacity-60'
                  }`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-semibold text-slate-900 dark:text-white">
                      {val.label}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{val.sub}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setOptions((prev) => ({ ...prev, [key]: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-300 dark:border-dark-border text-brand-600 focus:ring-0 cursor-pointer"
                  />
                </label>
              )
            })}
          </div>
        </div>
      </div>

      {/* 底部动作条 */}
      <div className="bg-white dark:bg-dark-panel rounded-xl border border-slate-200/80 dark:border-dark-border px-4 py-3 md:px-5 flex items-center justify-between gap-3 flex-wrap shadow-2xs flex-shrink-0">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          密码只在本机生成，不会上传；存入历史的条目可以在「密码库」里找回
        </span>
        <button
          onClick={saveToHistoryManual}
          disabled={!password}
          className="tool-button-secondary h-9"
        >
          <History size={14} />
          <span>存入保险箱历史</span>
        </button>
      </div>
    </ToolShell>
  )
}
