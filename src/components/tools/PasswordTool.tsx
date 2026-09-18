import { useState, useEffect } from 'react'
import { Check, Copy, Eye, EyeOff, History, RefreshCw, Settings2, ShieldCheck, Zap } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import {
  BTN,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolHistoryOverlay,
  ToolShell,
  iconButtonClass,
} from '../ui'
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
      <ToolCard fill={false}>
        <ToolCardHeader
          title="生成的随机密钥"
          actions={
            <>
              <Tooltip content={showPassword ? '隐藏密码' : '显示密码'}>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={iconButtonClass('brand')}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </Tooltip>
              <Tooltip content="复制密码">
                <button
                  type="button"
                  onClick={() => void copyPassword()}
                  disabled={!password}
                  className={iconButtonClass('brand')}
                >
                  <Copy size={15} />
                </button>
              </Tooltip>
            </>
          }
        />

        <div className="p-5">
          <div className="font-mono text-[22px] md:text-[26px] font-semibold tracking-tight break-all select-text text-slate-900 dark:text-white leading-snug">
            {showPassword ? password : password.replace(/./g, '•')}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="flex gap-1.5 flex-1 max-w-[280px]">
              {[0, 1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                    strength >= (step + 1) * 25 ? getStrengthColor() : 'bg-slate-100 dark:bg-dark-hover'
                  }`}
                />
              ))}
            </div>
            <span
              className={`text-[11px] font-semibold ${
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
        </div>
      </ToolCard>

      {/* 生成参数 */}
      <div className="tool-cascade grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
        <ToolCard>
          <ToolCardHeader title="密码字符长度" icon={Settings2} />

          <div className="flex-1 p-4 flex flex-col justify-center gap-4">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[32px] font-semibold text-slate-900 dark:text-white tabular-nums leading-none">
                {length}
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">位</span>
            </div>
            <input
              type="range"
              min="4"
              max="64"
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="tool-range"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500">4 位最短，64 位最长</p>
          </div>
        </ToolCard>

        <ToolCard>
          <ToolCardHeader title="包含字符类型" icon={Zap} />

          <div className="flex-1 p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {Object.entries(CHAR_OPTIONS).map(([key, val]) => {
              const active = options[key as keyof typeof options]
              return (
                <label
                  key={key}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                    active
                      ? 'border-brand-200/70 bg-brand-50/50 dark:border-brand-500/30 dark:bg-brand-500/10'
                      : 'border-slate-200/70 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-dark-hover'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setOptions((prev) => ({ ...prev, [key]: e.target.checked }))}
                    className="sr-only"
                  />
                  <span
                    className={`w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0 transition-colors ${
                      active
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {active && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {val.label}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                      {val.sub}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </ToolCard>
      </div>

      {/* 底部动作条 */}
      <ToolActionBar
        info="密码只在本机生成，不会上传；存入历史的条目可以在「密码库」里找回"
      >
        <button
          onClick={saveToHistoryManual}
          disabled={!password}
          className={BTN.secondary}
        >
          <History size={14} />
          <span>存入保险箱历史</span>
        </button>
      </ToolActionBar>
    </ToolShell>
  )
}
