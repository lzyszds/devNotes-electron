import { useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  Trash2,
  Copy,
  History,
  Clock,
  Wifi,
  WifiOff,
  Terminal,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { usePresence } from "../../hooks/usePresence";
import { useToolHistory } from "../../hooks/useToolHistory";
import { useHistoryContextMenu } from "../../hooks/useHistoryContextMenu";
import Tooltip from "../ui/Tooltip";

type MessageLog = {
  id: number;
  type: "system" | "sent" | "received" | "error";
  text: string;
  time: string;
};

const READY_STATE_LABELS = ["已断开", "连接中", "已连接", "正在关闭"];

export default function WebsocketTool() {
  const [url, setUrl] = useState("wss://echo.websocket.events");
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [status, setStatus] = useState<number>(WebSocket.CLOSED);
  const [showHistory, setShowHistory] = useState(false);
  // 历史浮层退出动画：面板 180ms、遮罩 160ms，取长者
  const { mounted: historyMounted, state: historyState } = usePresence(showHistory, 180);

  const socketRef = useRef<WebSocket | null>(null);
  const logIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { history, saveHistory, clearHistory, removeHistoryItem } =
    useToolHistory<string>("websocket");
  // 历史记录右键菜单
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setUrl(item.data);
      setShowHistory(false);
    },
    onRemove: removeHistoryItem,
  });

  const appendLog = (type: MessageLog["type"], text: string) => {
    logIdRef.current += 1;
    setLogs((prev) => [
      {
        id: logIdRef.current,
        type,
        text,
        time: new Date().toLocaleTimeString("zh-CN"),
      },
      ...prev,
    ]);
  };

  const connect = () => {
    if (!url.trim()) {
      appendLog("error", "请输入有效的 WebSocket 地址");
      return;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN)
      return;

    try {
      const socket = new WebSocket(url.trim());
      socketRef.current = socket;
      setStatus(WebSocket.CONNECTING);
      appendLog("system", `正在发起连接: ${url.trim()}`);

      socket.onopen = () => {
        setStatus(WebSocket.OPEN);
        appendLog("system", "连接已成功建立");
        saveHistory(url.trim(), url.trim());
      };

      socket.onmessage = (event) => {
        const data =
          typeof event.data === "string"
            ? event.data
            : "[收到二进制/非文本消息]";
        appendLog("received", data);
      };

      socket.onerror = () => {
        appendLog("error", "发生通信或连接错误");
      };

      socket.onclose = (event) => {
        setStatus(WebSocket.CLOSED);
        appendLog(
          "system",
          `连接已关闭 ${event.code ? `(代码: ${event.code})` : ""}`,
        );
        socketRef.current = null;
      };
    } catch (error) {
      appendLog("error", `连接失败: ${(error as Error).message}`);
      setStatus(WebSocket.CLOSED);
    }
  };

  const disconnect = () => {
    socketRef.current?.close();
  };

  const sendMessage = () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!message.trim()) return;
    socket.send(message);
    appendLog("sent", message);
    setMessage("");
  };

  const copyLogs = () => {
    const content = logs
      .slice()
      .reverse()
      .map((log) => `[${log.time}] ${log.type.toUpperCase()}: ${log.text}`)
      .join("\n");
    navigator.clipboard.writeText(content);
  };

  useEffect(() => {
    return () => {
      if (
        socketRef.current &&
        socketRef.current.readyState < WebSocket.CLOSING
      ) {
        socketRef.current.close();
      }
    };
  }, []);

  return (
    <div className="relative flex h-full min-h-0 md:min-h-[600px] bg-white overflow-hidden text-slate-900">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Action Header */}
        <div className="flex-wrap gap-3 px-4 py-4 md:px-8 md:py-5 flex items-center justify-between border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-4">
            <div
              className={`h-12 w-12 rounded-2xl flex items-center justify-center shadow-lg transition-colors ${status === WebSocket.OPEN ? "bg-brand-600 text-white shadow-brand-100" : "bg-slate-100 text-slate-400"}`}
            >
              {status === WebSocket.OPEN ? (
                <Wifi size={24} className="animate-pulse" />
              ) : (
                <WifiOff size={24} />
              )}
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                WS 调试终端
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${status === WebSocket.OPEN ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}
                >
                  {READY_STATE_LABELS[status]}
                </span>
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                  实时 Socket 状态监控
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 ">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary h-10 px-4 ${showHistory ? "ring-2 ring-brand-500/20 border-brand-200 text-brand-600" : ""}`}
            >
              <History size={16} />
              <span>服务器历史</span>
            </button>
            <div className="w-px h-6 bg-slate-100" />
            {status === WebSocket.CLOSED ? (
              <button
                onClick={connect}
                className="tool-button-primary h-10 bg-brand-600 hover:bg-brand-700 shadow-brand-100 px-6"
              >
                <Play size={16} /> 建立连接
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="tool-button-secondary h-10 border-rose-200 text-rose-600 hover:bg-rose-50 px-6"
              >
                <Square size={16} /> 断开连接
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 py-2 md:p-8 bg-white mt-3">
          <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-8 h-full">
            {/* Left Column: Input & Controls */}
            <div className="space-y-6">
              {/* Connection Form */}
              <div className="tool-panel">
                <label className="tool-label">服务器地址 (Endpoint)</label>
                <div className="relative group">
                  <Terminal
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-brand-500 transition-colors"
                    size={18}
                  />
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="wss://example.com/path"
                    disabled={status !== WebSocket.CLOSED}
                    className="tool-input pl-12 pr-4 bg-slate-50/50"
                  />
                </div>
              </div>

              {/* Message Composer */}
              <div className="tool-panel flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <label className="tool-label mb-0">消息编辑器</label>
                  <span
                    className={`text-[9px] font-bold uppercase tracking-tighter ${status === WebSocket.OPEN ? "text-brand-500" : "text-slate-300"}`}
                  >
                    {status === WebSocket.OPEN ? "已就绪" : "请先连接服务器"}
                  </span>
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="输入要发送的消息 (文本或 JSON 字符串)..."
                  disabled={status !== WebSocket.OPEN}
                  className="tool-textarea min-h-[300px] border-slate-200 shadow-sm"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={sendMessage}
                    disabled={status !== WebSocket.OPEN || !message.trim()}
                    className="tool-button-primary h-8 bg-slate-900 shadow-lg shadow-slate-100 min-w-[140px]"
                  >
                    发送数据 <ArrowUpRight size={16} className="ml-1" />
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Console Logs */}
            <div className="tool-panel flex flex-col p-0 border-slate-200 overflow-hidden shadow-xl bg-white h-full max-h-[700px]">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-slate-300 animate-pulse" />
                  <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">
                    通信控制台
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <Tooltip content="复制日志">
                    <button
                      onClick={copyLogs}
                      className="p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-all text-slate-400 hover:text-slate-900"
                    >
                      <Copy size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip content="清空日志">
                    <button
                      onClick={() => setLogs([])}
                      className="p-1.5 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-all text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide"
              >
                {logs.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-slate-300 text-center px-12">
                    <Wifi size={48} className="mb-4 opacity-10" />
                    <p className="text-[11px] font-bold uppercase tracking-widest leading-relaxed">
                      暂无数据流量
                      <br />
                      建立连接以监控消息
                    </p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className={`rounded-xl border p-4 text-[13px] animate-in fade-in slide-in-from-bottom-2 duration-300 ${
                        log.type === "received"
                          ? "border-emerald-100 bg-emerald-50/30 text-emerald-900 shadow-sm shadow-emerald-500/5"
                          : log.type === "sent"
                            ? "border-brand-100 bg-brand-50/30 text-brand-900 shadow-sm shadow-brand-500/5"
                            : log.type === "error"
                              ? "border-rose-100 bg-rose-50/30 text-rose-900 shadow-sm shadow-rose-500/5"
                              : "border-slate-100 bg-slate-50/50 text-slate-600"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3 opacity-60">
                        <div className="flex items-center gap-1.5 font-black text-[9px] uppercase tracking-wider">
                          {log.type === "received" && (
                            <CheckCircle2 size={10} />
                          )}
                          {log.type === "sent" && <ArrowUpRight size={10} />}
                          {log.type === "error" && <AlertCircle size={10} />}
                          {log.type === "received"
                            ? "接收"
                            : log.type === "sent"
                              ? "发送"
                              : "系统"}
                        </div>
                        <span className="text-[9px] font-mono font-bold">
                          {log.time}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap break-words font-mono leading-relaxed bg-white/40 p-2 rounded-lg border border-white/60">
                        {log.text}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {historyMounted && (
      <div className="history-overlay" data-state={historyState}>
        <button type="button" aria-label="关闭历史记录" className="history-overlay-backdrop" onClick={() => setShowHistory(false)} />
        <div
          className="history-overlay-panel" data-state={historyState}
          onClick={(e) => e.stopPropagation()}
        >
        <div className="p-6 border-b border-slate-200/70 bg-white/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-black text-xs uppercase tracking-widest">
            <Terminal size={18} className="text-brand-600" />
            已保存的节点
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearHistory}
              className="text-[10px] font-black text-slate-400 hover:text-rose-500 transition uppercase"
            >
              清空
            </button>
            <Tooltip content="关闭历史记录">
              <button
                onClick={() => setShowHistory(false)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"
              >
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300">
              <Clock size={32} className="mb-2 opacity-20" />
              <p className="text-[10px] font-bold uppercase tracking-widest">
                暂无地址
              </p>
            </div>
          ) : (
            history.map((item) => (
              <button
                key={item.id}
                  onContextMenu={(e) => openHistoryMenu(e, item)}
                onClick={() => {
                  setUrl(item.data);
                  setShowHistory(false);
                }}
                className="w-full text-left p-5 rounded-2xl bg-white border border-slate-200/60 shadow-sm hover:border-brand-600 hover:shadow-brand-500/10 transition-all group"
              >
                <p className="text-[11px] font-black text-slate-800 mb-2 truncate pr-4">
                  {item.title}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                    {new Date(item.timestamp).toLocaleDateString()}
                  </span>
                  <Wifi
                    size={10}
                    className="text-slate-300 group-hover:text-brand-600 transition-colors"
                  />
                </div>
              </button>
            ))
          )}
        </div>
        </div>
      </div>
      )}
    </div>
  );
}
