import { useState, useEffect } from 'react'
import { Clock, Copy } from 'lucide-react'

export default function TimestampTool() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [inputTimestamp, setInputTimestamp] = useState('')
  const [inputDate, setInputDate] = useState('')
  const [timestampResult, setTimestampResult] = useState('')
  const [dateResult, setDateResult] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const timestampToDate = () => {
    if (!inputTimestamp) return
    let ts = parseInt(inputTimestamp)
    if (isNaN(ts)) return
    if (ts < 10000000000) ts *= 1000
    const date = new Date(ts)
    setTimestampResult(date.toLocaleString('zh-CN'))
  }

  const dateToTimestamp = () => {
    if (!inputDate) return
    const date = new Date(inputDate)
    setDateResult(Math.floor(date.getTime() / 1000).toString())
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="rounded-xl bg-slate-50 p-6 border border-slate-200">
        <div className="mb-4 flex items-center gap-2 text-slate-700">
          <Clock className="h-5 w-5" />
          <span className="font-medium">当前时间</span>
        </div>
        <div className="mb-2 font-mono text-4xl font-bold text-slate-900">
          {currentTime.toLocaleTimeString('zh-CN')}
        </div>
        <div className="text-slate-500">
          {currentTime.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </div>
        <div className="mt-4 flex gap-4 text-sm">
          <div className="rounded-full bg-white px-3 py-1 text-slate-600 shadow-sm">
            秒级: {Math.floor(currentTime.getTime() / 1000)}
          </div>
          <div className="rounded-full bg-white px-3 py-1 text-slate-600 shadow-sm">
            毫秒: {currentTime.getTime()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="tool-panel">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">时间戳 → 日期</h3>
          <input
            type="text"
            value={inputTimestamp}
            onChange={(e) => setInputTimestamp(e.target.value)}
            placeholder="输入时间戳..."
            className="tool-input mb-3"
          />
          <button
            onClick={timestampToDate}
            className="tool-button-primary w-full"
          >
            转换
          </button>
          {timestampResult && (
            <div className="soft-panel mt-4 flex items-center justify-between px-4 py-3">
              <span className="font-mono text-sm text-slate-700">{timestampResult}</span>
              <button onClick={() => copyToClipboard(timestampResult)} className="tool-button-secondary px-3 py-2">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="tool-panel">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">日期 → 时间戳</h3>
          <input
            type="datetime-local"
            value={inputDate}
            onChange={(e) => setInputDate(e.target.value)}
            className="tool-input mb-3"
          />
          <button
            onClick={dateToTimestamp}
            className="tool-button-primary w-full"
          >
            转换
          </button>
          {dateResult && (
            <div className="soft-panel mt-4 flex items-center justify-between px-4 py-3">
              <span className="font-mono text-sm text-slate-700">{dateResult}</span>
              <button onClick={() => copyToClipboard(dateResult)} className="tool-button-secondary px-3 py-2">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
