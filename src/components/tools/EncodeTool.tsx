import { useState } from 'react'
import { ArrowRightLeft, Copy, Trash2 } from 'lucide-react'

const encodeTypes = [
  { id: 'base64', name: 'Base64', encode: (s: string) => btoa(unescape(encodeURIComponent(s))), decode: (s: string) => decodeURIComponent(escape(atob(s))) },
  { id: 'url', name: 'URL', encode: encodeURIComponent, decode: decodeURIComponent },
  { id: 'unicode', name: 'Unicode', encode: (s: string) => s.split('').map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''), decode: (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) },
  { id: 'html', name: 'HTML', encode: (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string)), decode: (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({'amp':'&','lt':'<','gt':'>','quot':'"','#39':"'"}[e] as string)) },
]

export default function EncodeTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [activeType, setActiveType] = useState('base64')
  const [error, setError] = useState('')

  const handleEncode = () => {
    if (!input.trim()) return
    const type = encodeTypes.find(t => t.id === activeType)
    if (!type) return
    try {
      setOutput(type.encode(input))
      setError('')
    } catch (e) {
      setError('编码失败: ' + (e as Error).message)
    }
  }

  const handleDecode = () => {
    if (!input.trim()) return
    const type = encodeTypes.find(t => t.id === activeType)
    if (!type) return
    try {
      setOutput(type.decode(input))
      setError('')
    } catch (e) {
      setError('解码失败: ' + (e as Error).message)
    }
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  return (
    <div className="p-6">
      {/* Type Selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {encodeTypes.map(type => (
          <button
            key={type.id}
            onClick={() => { setActiveType(type.id); setError('') }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeType === type.id
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {type.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">输入</label>
            <button onClick={() => { setInput(''); setOutput(''); setError('') }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <Trash2 className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入要转换的内容..."
            className="w-full h-64 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-gray-100"
          />
          <div className="flex gap-2 mt-3">
            <button onClick={handleEncode} className="flex-1 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium transition-colors">
              编码
            </button>
            <button onClick={handleDecode} className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors">
              解码
            </button>
          </div>
        </div>

        {/* Output */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">结果</label>
            <button onClick={copyOutput} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <Copy className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          {error ? (
            <div className="w-full h-64 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm overflow-auto">
              {error}
            </div>
          ) : (
            <textarea
              value={output}
              readOnly
              placeholder="转换结果..."
              className="w-full h-64 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl font-mono text-sm resize-none text-gray-900 dark:text-gray-100"
            />
          )}
        </div>
      </div>
    </div>
  )
}
