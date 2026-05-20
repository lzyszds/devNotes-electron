import { useState } from 'react'
import { Search, Copy, Trash2 } from 'lucide-react'

const templates = [
  { name: '手机号', pattern: '1[3-9]\\d{9}', desc: '中国大陆手机号' },
  { name: '邮箱', pattern: '[\\w.-]+@[\\w.-]+\\.\\w+', desc: '电子邮箱地址' },
  { name: 'URL', pattern: 'https?://[\\w./%-]+', desc: 'HTTP/HTTPS链接' },
  { name: '身份证', pattern: '\\d{17}[\\dXx]', desc: '18位身份证号' },
  { name: 'IP地址', pattern: '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}', desc: 'IPv4地址' },
  { name: '日期', pattern: '\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}', desc: '日期格式' },
  { name: '整数', pattern: '-?\\d+', desc: '整数' },
  { name: '中文', pattern: '[\\u4e00-\\u9fa5]+', desc: '中文字符' },
]

export default function RegexpTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testText, setTestText] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [error, setError] = useState('')

  const testRegex = () => {
    if (!pattern || !testText) return
    try {
      const regex = new RegExp(pattern, flags)
      const result = testText.match(regex) || []
      setMatches(result)
      setError('')
    } catch (e) {
      setError('正则表达式错误: ' + (e as Error).message)
      setMatches([])
    }
  }

  const useTemplate = (p: string) => {
    setPattern(p)
    setError('')
  }

  return (
    <div className="p-6">
      {/* Templates */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">常用模板</h3>
        <div className="flex flex-wrap gap-2">
          {templates.map(t => (
            <button
              key={t.name}
              onClick={() => useTemplate(t.pattern)}
              className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-xs transition-colors"
              title={t.desc}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Pattern Input */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">正则表达式</label>
          <span className="text-xs text-gray-400">/</span>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="输入正则表达式"
            className="flex-1 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="text-xs text-gray-400">/</span>
          <input
            type="text"
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            placeholder="flags"
            className="w-16 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* Test Text */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">测试文本</label>
          <button onClick={() => { setTestText(''); setMatches([]) }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <Trash2 className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        <textarea
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="输入要测试的文本..."
          className="w-full h-32 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          onClick={testRegex}
          className="mt-2 w-full py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Search className="w-4 h-4 inline mr-2" /> 测试匹配
        </button>
      </div>

      {/* Results */}
      {error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      ) : matches.length > 0 ? (
        <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">匹配结果 ({matches.length})</span>
            <button onClick={() => copyToClipboard(matches.join('\n'))} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
              <Copy className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="space-y-2">
            {matches.map((match, i) => (
              <div key={i} className="p-2 bg-white dark:bg-gray-800 rounded-lg font-mono text-sm text-gray-700 dark:text-gray-300">
                <span className="text-gray-400 mr-2">#{i + 1}</span>
                {match}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
}
