import { useState, useEffect } from 'react'
import { Clock, Copy, RefreshCw } from 'lucide-react'

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
      {/* Current Time */}
      <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-5 h-5" />
          <span className="font-medium">当前时间</span>
        </div>
        <div className="text-4xl font-mono font-bold mb-2">
          {currentTime.toLocaleTimeString('zh-CN')}
        </div>
        <div className="text-white/80">
          {currentTime.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </div>
        <div className="mt-4 flex gap-4 text-sm">
          <div className="bg-white/20 rounded-lg px-3 py-1">
            秒级: {Math.floor(currentTime.getTime() / 1000)}
          </div>
          <div className="bg-white/20 rounded-lg px-3 py-1">
            毫秒: {currentTime.getTime()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Timestamp to Date */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6">
          <h3 className="font-medium text-gray-900 dark:text-white mb-4">时间戳 → 日期</h3>
          <input
            type="text"
            value={inputTimestamp}
            onChange={(e) => setInputTimestamp(e.target.value)}
            placeholder="输入时间戳..."
            className="w-full p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={timestampToDate}
            className="w-full py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            转换
          </button>
          {timestampResult && (
            <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded-xl flex items-center justify-between">
              <span className="font-mono text-sm">{timestampResult}</span>
              <button onClick={() => copyToClipboard(timestampResult)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <Copy className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          )}
        </div>

        {/* Date to Timestamp */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6">
          <h3 className="font-medium text-gray-900 dark:text-white mb-4">日期 → 时间戳</h3>
          <input
            type="datetime-local"
            value={inputDate}
            onChange={(e) => setInputDate(e.target.value)}
            className="w-full p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={dateToTimestamp}
            className="w-full py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            转换
          </button>
          {dateResult && (
            <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded-xl flex items-center justify-between">
              <span className="font-mono text-sm">{dateResult}</span>
              <button onClick={() => copyToClipboard(dateResult)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <Copy className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
