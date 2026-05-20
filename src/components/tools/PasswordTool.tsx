import { useState, useEffect } from 'react'
import { Lock, Copy, RefreshCw, Download, Eye, EyeOff } from 'lucide-react'

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
  const [history, setHistory] = useState<string[]>([])

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

  const saveToHistory = () => {
    if (!password || history.includes(password)) return
    setHistory(prev => [password, ...prev].slice(0, 10))
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
    <div className="p-6">
      {/* Password Display */}
      <div className="bg-gray-900 rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-gray-400">
            <Lock className="w-5 h-5" />
            <span className="text-sm">生成的密码</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4 text-gray-400" /> : <Eye className="w-4 h-4 text-gray-400" />}
            </button>
            <button onClick={copyPassword} className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <Copy className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
        <div className="font-mono text-2xl text-green-400 break-all min-h-[2rem]">
          {showPassword ? password : password.replace(/./g, '•')}
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">密码强度</span>
            <span className={`text-sm font-medium ${strength < 40 ? 'text-red-400' : strength < 70 ? 'text-yellow-400' : 'text-green-400'}`}>
              {getStrengthText()}
            </span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div className={`h-full ${getStrengthColor()} transition-all duration-300`} style={{ width: `${strength}%` }} />
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
            密码长度: {length}
          </label>
          <input
            type="range"
            min="4"
            max="64"
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
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
              className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <input
                type="checkbox"
                checked={options[key as keyof typeof options]}
                onChange={(e) => setOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                className="w-4 h-4 text-primary-500 rounded focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={generatePassword}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> 生成新密码
        </button>
        <button
          onClick={saveToHistory}
          className="flex-1 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium transition-colors"
        >
          保存到历史
        </button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">历史记录</h3>
          <div className="space-y-2">
            {history.map((pwd, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <span className="font-mono text-sm text-gray-600 dark:text-gray-400 truncate max-w-[200px]">
                  {pwd}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(pwd)}
                  className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  <Copy className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
