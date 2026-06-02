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
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-medium text-slate-700">常用模板</h3>
        <div className="flex flex-wrap gap-2">
          {templates.map(t => (
            <button
              key={t.name}
              onClick={() => useTemplate(t.pattern)}
              className="tool-chip"
              title={t.desc}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="tool-panel mb-5">
        <div className="mb-2 flex items-center gap-2">
          <label className="tool-label mb-0">正则表达式</label>
          <span className="text-xs text-slate-400">/</span>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="输入正则表达式"
            className="tool-input flex-1 py-2 font-mono"
          />
          <span className="text-xs text-slate-400">/</span>
          <input
            type="text"
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            placeholder="flags"
            className="tool-input w-20 py-2 font-mono"
          />
        </div>
      </div>

      <div className="tool-panel mb-5">
        <div className="mb-2 flex items-center justify-between">
          <label className="tool-label mb-0">测试文本</label>
          <button onClick={() => { setTestText(''); setMatches([]) }} className="tool-button-secondary px-3 py-2">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="输入要测试的文本..."
          className="tool-textarea min-h-[180px]"
        />
        <button
          onClick={testRegex}
          className="tool-button-primary mt-4 w-full"
        >
          <Search className="mr-2 h-4 w-4" /> 测试匹配
        </button>
      </div>

      {error ? (
        <div className="status-note border-rose-200 bg-rose-50 text-rose-700">
          {error}
        </div>
      ) : matches.length > 0 ? (
        <div className="tool-panel">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">匹配结果 ({matches.length})</span>
            <button onClick={() => copyToClipboard(matches.join('\n'))} className="tool-button-secondary px-3 py-2">
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            {matches.map((match, i) => (
              <div key={i} className="soft-panel px-3 py-2 font-mono text-sm text-slate-700">
                <span className="mr-2 text-slate-400">#{i + 1}</span>
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
