import { useState } from 'react'
import { Wand2, Minimize2, ArrowUpDown, Trash2, Copy, Download } from 'lucide-react'

export default function JsonFormatTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const formatJson = () => {
    if (!input.trim()) return
    try {
      const parsed = JSON.parse(input)
      setOutput(JSON.stringify(parsed, null, 2))
      setError('')
    } catch (e) {
      setError('JSON 格式错误: ' + (e as Error).message)
      setOutput('')
    }
  }

  const compressJson = () => {
    if (!input.trim()) return
    try {
      const parsed = JSON.parse(input)
      setOutput(JSON.stringify(parsed))
      setError('')
    } catch (e) {
      setError('JSON 格式错误')
    }
  }

  const sortKeys = () => {
    if (!input.trim()) return
    try {
      const parsed = JSON.parse(input)
      const sorted = sortObjectKeys(parsed)
      setOutput(JSON.stringify(sorted, null, 2))
      setError('')
    } catch (e) {
      setError('JSON 格式错误')
    }
  }

  const sortObjectKeys = (obj: unknown): unknown => {
    if (Array.isArray(obj)) {
      return obj.map(sortObjectKeys)
    } else if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj as Record<string, unknown>).sort().reduce((result, key) => {
        (result as Record<string, unknown>)[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
        return result
      }, {} as Record<string, unknown>)
    }
    return obj
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  const downloadOutput = () => {
    const blob = new Blob([output], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'formatted.json'
    a.click()
  }

  return (
    <div className="p-6">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={formatJson} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium transition-colors">
          <Wand2 className="w-4 h-4" /> 美化
        </button>
        <button onClick={compressJson} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors">
          <Minimize2 className="w-4 h-4" /> 压缩
        </button>
        <button onClick={sortKeys} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors">
          <ArrowUpDown className="w-4 h-4" /> 排序
        </button>
        <button onClick={() => { setInput(''); setOutput(''); setError('') }} className="flex items-center gap-1.5 px-4 py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium transition-colors ml-auto">
          <Trash2 className="w-4 h-4" /> 清空
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">输入 JSON</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="在此粘贴 JSON 内容..."
            className="w-full h-96 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-gray-100"
          />
        </div>

        {/* Output */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">输出结果</label>
            <div className="flex gap-2">
              <button onClick={copyOutput} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                <Copy className="w-4 h-4 text-gray-500" />
              </button>
              <button onClick={downloadOutput} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                <Download className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
          {error ? (
            <div className="w-full h-96 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm overflow-auto">
              {error}
            </div>
          ) : (
            <textarea
              value={output}
              readOnly
              placeholder="格式化后的 JSON 将显示在这里..."
              className="w-full h-96 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl font-mono text-sm resize-none text-gray-900 dark:text-gray-100"
            />
          )}
        </div>
      </div>
    </div>
  )
}
