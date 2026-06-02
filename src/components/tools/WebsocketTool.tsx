import { useEffect, useRef, useState } from 'react'
import { Play, Square, Send, Trash2, Copy, History, Clock, ChevronRight } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'

type MessageLog = {
  id: number
  type: 'system' | 'sent' | 'received' | 'error'
  text: string
  time: string
}

const READY_STATE_LABELS = ['未连接', '连接中', '已连接', '已关闭']

export default function WebsocketTool() {
  const [url, setUrl] = useState('wss://echo.websocket.events')
  const [message, setMessage] = useState('')
  const [logs, setLogs] = useState<MessageLog[]>([])
  const [status, setStatus] = useState<number>(WebSocket.CLOSED)
  const [showHistory, setShowHistory] = useState(false)
  
  const socketRef = useRef<WebSocket | null>(null)
  const logIdRef = useRef(0)

  const { history, saveHistory, clearHistory } = useToolHistory<string>('websocket')

  const appendLog = (type: MessageLog['type'], text: string) => {
    logIdRef.current += 1
    setLogs((prev) => [
      {
        id: logIdRef.current,
        type,
        text,
        time: new Date().toLocaleTimeString('zh-CN'),
      },
      ...prev,
    ])
  }

  const connect = () => {
    if (!url.trim()) {
      appendLog('error', '请输入 WebSocket 地址')
      return
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      appendLog('system', '当前连接已建立')
      return
    }

    try {
      const socket = new WebSocket(url.trim())
      socketRef.current = socket
      setStatus(WebSocket.CONNECTING)
      appendLog('system', `开始连接: ${url.trim()}`)

      socket.onopen = () => {
        setStatus(WebSocket.OPEN)
        appendLog('system', '连接成功')
        saveHistory(url.trim(), url.trim())
      }

      socket.onmessage = (event) => {
        const data =
          typeof event.data === 'string' ? event.data : '[收到非文本消息]'
        appendLog('received', data)
      }

      socket.onerror = () => {
        appendLog('error', '连接或通信发生错误')
      }

      socket.onclose = (event) => {
        setStatus(WebSocket.CLOSED)
        appendLog('system', `连接关闭${event.code ? ` (${event.code})` : ''}`)
        socketRef.current = null
      }
    } catch (error) {
      appendLog('error', `连接失败: ${(error as Error).message}`)
      setStatus(WebSocket.CLOSED)
    }
  }

  const disconnect = () => {
    if (!socketRef.current) {
      appendLog('system', '当前没有活动连接')
      return
    }
    socketRef.current.close()
  }

  const sendMessage = () => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendLog('error', '请先建立连接')
      return
    }
    if (!message.trim()) {
      appendLog('error', '请输入要发送的消息')
      return
    }
    socket.send(message)
    appendLog('sent', message)
    setMessage('')
  }

  const copyLogs = () => {
    const content = logs
      .slice()
      .reverse()
      .map((log) => `[${log.time}] ${log.type}: ${log.text}`)
      .join('\n')
    navigator.clipboard.writeText(content)
  }

  useEffect(() => {
    return () => {
      if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) {
        socketRef.current.close()
      }
    }
  }, [])

  return (
    <div className="flex h-full min-h-[600px]">
      <div className="flex-1 p-6 overflow-y-auto space-y-6">
        <div className="flex items-center justify-between">
           <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">WebSocket Test</p>
              <h3 className="mt-1 text-xl font-bold text-slate-900">WS 连接测试</h3>
           </div>
           <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary h-9 ${showHistory ? 'bg-slate-100 ring-1 ring-slate-900' : ''}`}
            >
              <History className="h-4 w-4" />
              历史
            </button>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <div className="tool-panel">
              <div className="flex flex-col gap-4">
                <div>
                  <label className="tool-label">
                    WebSocket 地址
                  </label>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="wss://example.com/socket"
                    className="tool-input"
                  />
                </div>

                <div className="flex flex-wrap gap-3 items-center">
                  <button
                    onClick={connect}
                    className="tool-button-primary"
                  >
                    <Play className="h-4 w-4" />
                    连接
                  </button>
                  <button
                    onClick={disconnect}
                    className="tool-button-secondary"
                  >
                    <Square className="h-4 w-4" />
                    断开
                  </button>
                  <div className="text-sm text-slate-500">
                    状态:
                    <span className={`ml-2 font-bold ${status === WebSocket.OPEN ? 'text-emerald-600' : 'text-slate-800'}`}>
                      {READY_STATE_LABELS[status] ?? '未知'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="tool-panel">
              <label className="tool-label">
                发送消息
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="输入要发送的文本消息..."
                rows={6}
                className="tool-textarea min-h-[180px]"
              />
              <div className="flex justify-end mt-3">
                <button
                  onClick={sendMessage}
                  className="tool-button-primary"
                >
                  <Send className="h-4 w-4" />
                  发送
                </button>
              </div>
            </div>
          </div>

          <div className="tool-panel flex min-h-[520px] flex-col p-0">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-sm font-medium text-slate-900">消息日志</h3>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyLogs}
                  className="tool-button-secondary px-3 py-2"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setLogs([])}
                  className="tool-button-secondary px-3 py-2"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {logs.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400 italic">
                  等待连接和消息...
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className={`rounded-xl border p-3 text-sm ${
                      log.type === 'received'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : log.type === 'sent'
                          ? 'border-sky-200 bg-sky-50 text-sky-700'
                          : log.type === 'error'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="font-bold uppercase text-[10px] tracking-wide opacity-75">{log.type}</span>
                      <span className="text-[10px] opacity-70 font-mono">{log.time}</span>
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">{log.text}</pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* History Sidebar */}
      {showHistory && (
        <aside className="w-80 border-l border-slate-200 bg-slate-50/50 flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Clock size={16} />
              连接历史
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
                    setUrl(item.data)
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
                  <p className="text-xs font-bold text-slate-700 truncate">{item.title || '无标题'}</p>
                </button>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
