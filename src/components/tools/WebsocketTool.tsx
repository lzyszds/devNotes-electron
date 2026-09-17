import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  History,
  Play,
  Square,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useToolHistory } from "../../hooks/useToolHistory";
import { useHistoryContextMenu } from "../../hooks/useHistoryContextMenu";
import { ToolBadge, ToolHistoryOverlay, ToolShell } from "../ui";
import Tooltip from "../ui/Tooltip";
import { useToast } from "../ui/Toast";
import { copyText } from "../../utils/clipboard";

type MessageLog = {
  id: number;
  type: "system" | "sent" | "received" | "error";
  text: string;
  time: string;
};

const READY_STATE_LABELS = ["已断开", "连接中", "已连接", "正在关闭"];

/** 每条日志的配色：接收绿、发送蓝、错误红、系统灰 */
const LOG_TONES: Record<MessageLog["type"], string> = {
  received:
    "border-emerald-100 bg-emerald-50/30 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200",
  sent: "border-brand-100 bg-brand-50/30 text-brand-900 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200",
  error:
    "border-rose-100 bg-rose-50/30 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200",
  system:
    "border-slate-100 bg-slate-50/50 text-slate-600 dark:border-dark-border dark:bg-dark-hover/40 dark:text-slate-300",
};

export default function WebsocketTool() {
  const [url, setUrl] = useState("wss://echo.websocket.events");
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [status, setStatus] = useState<number>(WebSocket.CLOSED);
  const [showHistory, setShowHistory] = useState(false);
  const { showToast } = useToast();

  const socketRef = useRef<WebSocket | null>(null);
  const logIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { history, saveHistory, clearHistory, removeHistoryItem } =
    useToolHistory<string>("websocket");
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

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) return;

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
        appendLog(
          "received",
          typeof event.data === "string" ? event.data : "[收到二进制/非文本消息]",
        );
      };

      socket.onerror = () => {
        appendLog("error", "发生通信或连接错误");
      };

      socket.onclose = (event) => {
        setStatus(WebSocket.CLOSED);
        appendLog("system", `连接已关闭 ${event.code ? `(代码: ${event.code})` : ""}`);
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

  const copyLogs = async () => {
    const content = logs
      .slice()
      .reverse()
      .map((log) => `[${log.time}] ${log.type.toUpperCase()}: ${log.text}`)
      .join("\n");
    const ok = await copyText(content);
    showToast(ok ? "已复制日志" : "复制失败", ok ? "default" : "error");
  };

  useEffect(() => {
    return () => {
      if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) {
        socketRef.current.close();
      }
    };
  }, []);

  const connected = status === WebSocket.OPEN;

  return (
    <ToolShell
      icon={connected ? Wifi : WifiOff}
      iconTone={connected ? "brand" : "muted"}
      title="WS 调试终端"
      subtitle="实时 Socket 状态监控"
      badge={
        <ToolBadge tone={connected ? "emerald" : "amber"} pulse={connected}>
          {READY_STATE_LABELS[status]}
        </ToolBadge>
      }
      actions={
        <>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`tool-button-secondary h-9 ${
              showHistory
                ? "ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400"
                : ""
            }`}
          >
            <History size={15} />
            <span>服务器历史</span>
          </button>
          {status === WebSocket.CLOSED ? (
            <button onClick={connect} className="tool-button-primary h-9 px-5">
              <Play size={15} />
              <span>建立连接</span>
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="tool-button-secondary h-9 px-5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
            >
              <Square size={15} />
              <span>断开连接</span>
            </button>
          )}
        </>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="已保存的节点"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setUrl(item.data);
            setShowHistory(false);
          }}
          onItemContextMenu={openHistoryMenu}
          emptyText="暂无地址"
        />
      }
    >
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 min-h-[520px]">
        {/* ---------------- 左：连接与消息 ---------------- */}
        <div className="flex flex-col gap-4 min-h-0">
          <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex-shrink-0">
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                服务器地址 (Endpoint)
              </span>
            </div>
            <div className="p-4">
              <div className="relative group">
                <Terminal
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600 group-focus-within:text-brand-500 transition-colors"
                  size={16}
                />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="wss://example.com/path"
                  disabled={status !== WebSocket.CLOSED}
                  className="tool-input pl-10 font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex items-center justify-between gap-2 flex-shrink-0">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                消息编辑器
              </span>
              <span
                className={`text-[11px] ${
                  connected
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-slate-400 dark:text-slate-500"
                }`}
              >
                {connected ? "已就绪" : "请先连接服务器"}
              </span>
            </div>

            <div className="flex-1 p-4 flex flex-col min-h-0">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="输入要发送的消息 (文本或 JSON 字符串)…"
                disabled={!connected}
                className="w-full flex-1 bg-transparent resize-none outline-none font-mono text-slate-800 dark:text-slate-100 text-sm leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-600 disabled:cursor-not-allowed"
              />
            </div>

            <div className="px-4 py-2.5 border-t border-slate-100 dark:border-dark-border flex items-center justify-between gap-3 text-xs bg-slate-50/40 dark:bg-dark-sidebar/30 rounded-b-2xl flex-shrink-0">
              <span className="font-mono text-slate-500 dark:text-slate-500">
                {message.length} 字符
              </span>
              <button
                onClick={sendMessage}
                disabled={!connected || !message.trim()}
                className="tool-button-primary h-9 px-5"
              >
                <span>发送数据</span>
                <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* ---------------- 右：通信控制台 ---------------- */}
        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col min-h-0 max-h-[720px]">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex items-center justify-between gap-2 flex-shrink-0">
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connected ? "bg-emerald-500 animate-pulse" : "bg-slate-300 dark:bg-slate-600"
                }`}
              />
              通信控制台
            </span>
            <div className="flex items-center gap-1">
              <Tooltip content="复制日志">
                <button
                  onClick={() => void copyLogs()}
                  disabled={logs.length === 0}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 transition disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Copy size={14} />
                </button>
              </Tooltip>
              <Tooltip content="清空日志">
                <button
                  onClick={() => setLogs([])}
                  disabled={logs.length === 0}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 transition disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Trash2 size={14} />
                </button>
              </Tooltip>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {logs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-slate-300 dark:text-slate-600 text-center px-8">
                <Wifi size={44} className="mb-4 opacity-15" />
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
                  className={`rounded-xl border p-3 text-[13px] ${LOG_TONES[log.type]}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3 opacity-70">
                    <div className="flex items-center gap-1.5 font-bold text-[10px] uppercase tracking-wider">
                      {log.type === "received" && <CheckCircle2 size={11} />}
                      {log.type === "sent" && <ArrowUpRight size={11} />}
                      {log.type === "error" && <AlertCircle size={11} />}
                      {log.type === "received" ? "接收" : log.type === "sent" ? "发送" : "系统"}
                    </div>
                    <span className="text-[10px] font-mono font-bold">{log.time}</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono leading-relaxed bg-white/40 dark:bg-white/[0.04] p-2 rounded-lg border border-white/60 dark:border-white/10">
                    {log.text}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
