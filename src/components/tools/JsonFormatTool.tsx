import { useMemo, useState } from "react";
import {
  Wand2,
  Minimize2,
  ArrowUpDown,
  Trash2,
  Copy,
  Download,
  GitCompareArrows,
  CheckCircle2,
  AlertTriangle,
  History,
  Clock,
  ChevronRight,
  ChevronDown,
  Braces,
  X,
  ListTree,
  Type,
} from "lucide-react";
import { useToolHistory } from "../../hooks/useToolHistory";
import { useHistoryContextMenu } from "../../hooks/useHistoryContextMenu";
import Tooltip from "../ui/Tooltip";

type JsonFormatToolProps = {
  mode?: "format" | "diff";
};

type DiffLine = {
  left: string;
  right: string;
  status: "same" | "added" | "removed" | "changed";
};

/* --- Tree View Components --- */

const JsonTreeView = ({ data }: { data: any }) => {
  return (
    <div className="font-mono text-[13px] leading-relaxed select-text">
      <TreeNode value={data} isLast={true} />
    </div>
  );
};

const TreeNode = ({
  label,
  value,
  isLast,
}: {
  label?: string;
  value: any;
  isLast: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const isEmpty =
    isObject &&
    (isArray ? value.length === 0 : Object.keys(value).length === 0);

  const renderValue = (val: any) => {
    if (val === null)
      return <span className="text-rose-500 font-bold italic">null</span>;
    if (typeof val === "string")
      return <span className="text-emerald-600">"{val}"</span>;
    if (typeof val === "number")
      return <span className="text-sky-600 font-bold">{val}</span>;
    if (typeof val === "boolean")
      return <span className="text-amber-600 font-bold">{val.toString()}</span>;
    return null;
  };

  if (!isObject) {
    return (
      <div className="flex items-start py-0.5 group">
        {label && (
          <span className="text-slate-900 font-bold mr-2">"{label}":</span>
        )}
        {renderValue(value)}
        {!isLast && <span className="text-slate-400">,</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center py-0.5 cursor-pointer group hover:bg-slate-50 rounded px-1 -ml-1 transition-colors"
        onClick={() => !isEmpty && setIsExpanded(!isExpanded)}
      >
        <div className="w-4 h-4 flex items-center justify-center mr-1 text-slate-300">
          {!isEmpty &&
            (isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            ))}
        </div>
        {label && (
          <span className="text-slate-900 font-bold mr-2">"{label}":</span>
        )}
        <span className="text-slate-400 font-bold">
          {isArray ? "[" : "{"}
          {!isExpanded && !isEmpty && (
            <span className="mx-1 text-slate-300 text-[10px]">...</span>
          )}
          {!isExpanded && (isArray ? "]" : "}")}
        </span>
        {!isExpanded && !isLast && <span className="text-slate-400">,</span>}
        {!isExpanded && isArray && value.length > 0 && (
          <span className="ml-3 text-[10px] font-black text-slate-300 uppercase tracking-tighter bg-slate-100 px-1.5 rounded">
            {value.length} 个项目
          </span>
        )}
      </div>

      {isExpanded && !isEmpty && (
        <div className="ml-4 border-l border-slate-100 pl-4 transition-all animate-in slide-in-from-left-1 duration-200">
          {isArray
            ? value.map((item, i) => (
                <TreeNode
                  key={i}
                  value={item}
                  isLast={i === value.length - 1}
                />
              ))
            : Object.entries(value).map(([key, val], i, arr) => (
                <TreeNode
                  key={key}
                  label={key}
                  value={val}
                  isLast={i === arr.length - 1}
                />
              ))}
        </div>
      )}

      {isExpanded && (
        <div className="py-0.5">
          <span className="text-slate-400 font-bold ml-5">
            {isArray ? "]" : "}"}
            {!isLast && <span className="text-slate-400">,</span>}
          </span>
        </div>
      )}
    </div>
  );
};

/* --- Utility Functions --- */

const formatForDisplay = (value: string) => {
  if (!value.trim()) return "";
  return JSON.stringify(JSON.parse(value), null, 2);
};

const sortObjectKeys = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);

  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce(
        (result, key) => {
          (result as Record<string, unknown>)[key] = sortObjectKeys(
            (obj as Record<string, unknown>)[key],
          );
          return result;
        },
        {} as Record<string, unknown>,
      );
  }

  return obj;
};

const buildDiffLines = (leftText: string, rightText: string): DiffLine[] => {
  const leftLines = leftText.split("\n");
  const rightLines = rightText.split("\n");
  const lineCount = Math.max(leftLines.length, rightLines.length);

  return Array.from({ length: lineCount }, (_, index) => {
    const left = leftLines[index] ?? "";
    const right = rightLines[index] ?? "";

    if (left === right) return { left, right, status: "same" as const };
    if (!left && right) return { left, right, status: "added" as const };
    if (left && !right) return { left, right, status: "removed" as const };

    return { left, right, status: "changed" as const };
  });
};

const diffStyles: Record<DiffLine["status"], string> = {
  same: "text-slate-400",
  added: "bg-emerald-50 text-emerald-700 border-l-2 border-emerald-500",
  removed: "bg-rose-50 text-rose-700 border-l-2 border-rose-500",
  changed: "bg-amber-50 text-amber-700 border-l-2 border-amber-500",
};

/* --- Main Tool Component --- */

export default function JsonFormatTool({
  mode = "format",
}: JsonFormatToolProps) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"text" | "tree">("text");
  const [leftInput, setLeftInput] = useState("");
  const [rightInput, setRightInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>(
    mode === "diff" ? "json-diff" : "json-format",
  );
  // 两个面板共用同一份 history,但回填逻辑不同,各自一份右键菜单
  const openDiffHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      try {
        const data = JSON.parse(item.data);
        setLeftInput(data.left || item.data);
        setRightInput(data.right || "");
      } catch {
        setLeftInput(item.data);
      }
      setShowHistory(false);
    },
    onRemove: removeHistoryItem,
  });

  const openFormatHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setInput(item.data);
      setShowHistory(false);
    },
    onRemove: removeHistoryItem,
  });

  const parsedOutput = useMemo(() => {
    if (!output) return null;
    try {
      return JSON.parse(output);
    } catch {
      return null;
    }
  }, [output]);

  const formatJson = () => {
    if (!input.trim()) return;
    try {
      const parsed = JSON.parse(input);
      const formatted = JSON.stringify(parsed, null, 2);
      setOutput(formatted);
      setError("");
      saveHistory(input, input.slice(0, 30) + "...");
    } catch (err) {
      setError("JSON 格式错误: " + (err as Error).message);
      setOutput("");
    }
  };

  const compressJson = () => {
    if (!input.trim()) return;
    try {
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(parsed));
      setError("");
      saveHistory(input, "JSON 压缩记录");
    } catch {
      setError("JSON 格式错误");
    }
  };

  const sortKeys = () => {
    if (!input.trim()) return;
    try {
      const parsed = JSON.parse(input);
      const sorted = sortObjectKeys(parsed);
      setOutput(JSON.stringify(sorted, null, 2));
      setError("");
      saveHistory(input, "JSON 排序记录");
    } catch {
      setError("JSON 格式错误");
    }
  };

  const copyOutput = () => {
    if (output) {
      navigator.clipboard.writeText(output);
    }
  };

  const downloadOutput = () => {
    const blob = new Blob([output], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "formatted.json";
    link.click();
  };

  const leftParsed = useMemo(() => {
    try {
      return { formatted: formatForDisplay(leftInput), error: "" };
    } catch (err) {
      return { formatted: "", error: "左侧 JSON 无法解析" };
    }
  }, [leftInput]);

  const rightParsed = useMemo(() => {
    try {
      return { formatted: formatForDisplay(rightInput), error: "" };
    } catch (err) {
      return { formatted: "", error: "右侧 JSON 无法解析" };
    }
  }, [rightInput]);

  const diffError = leftParsed.error || rightParsed.error;

  const diffLines = useMemo(() => {
    if (!leftParsed.formatted || !rightParsed.formatted) return [];
    return buildDiffLines(leftParsed.formatted, rightParsed.formatted);
  }, [leftParsed.formatted, rightParsed.formatted]);

  const diffStats = useMemo(
    () =>
      diffLines.reduce(
        (stats, line) => {
          stats[line.status] += 1;
          return stats;
        },
        { same: 0, added: 0, removed: 0, changed: 0 },
      ),
    [diffLines],
  );

  if (mode === "diff") {
    return (
      <div className="relative flex h-full bg-slate-50/30 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          {/* Action Header */}
          <div className="px-8 py-5 flex items-center justify-between border-b border-slate-100 shrink-0 bg-white">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-100">
                <GitCompareArrows size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">
                  JSON 内容比对
                </h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                  逐行分析两个 JSON 的差异
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`tool-button-secondary h-10 px-4 ${showHistory ? "ring-2 ring-indigo-500/20 border-indigo-200 text-indigo-600" : ""}`}
              >
                <History size={16} />
                <span>比对历史</span>
              </button>
              <div className="w-px h-6 bg-slate-100 mx-2" />
              <button
                onClick={() => {
                  setLeftInput("");
                  setRightInput("");
                }}
                className="tool-button-secondary h-10 px-4 text-rose-500 hover:text-rose-600 hover:bg-rose-50 border-rose-100"
              >
                <Trash2 size={16} />
                <span>清空</span>
              </button>
              <button
                onClick={() => {
                  if (!leftInput || !rightInput) return;
                  saveHistory(
                    JSON.stringify({ left: leftInput, right: rightInput }),
                    `比对: ${leftInput.slice(0, 10)}...`,
                  );
                }}
                className="tool-button-primary h-10 px-4 bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100"
              >
                <Copy size={16} />
                <span>复制结果</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col">
            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 shrink-0">
              {[
                { label: "匹配", value: diffStats.same, color: "slate" },
                { label: "新增", value: diffStats.added, color: "emerald" },
                { label: "删除", value: diffStats.removed, color: "rose" },
                { label: "修改", value: diffStats.changed, color: "amber" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className={`p-4 rounded-xl border bg-white shadow-sm border-${stat.color}-100`}
                >
                  <p
                    className={`text-[10px] font-black uppercase tracking-widest text-${stat.color}-500 mb-1`}
                  >
                    {stat.label}
                  </p>
                  <p className="text-2xl font-black text-slate-900">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Inputs */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-h-[400px] h-full">
              <div className="flex flex-col gap-2 h-full">
                <label className="tool-label px-1 shrink-0">
                  原始 JSON (左侧)
                </label>
                <textarea
                  value={leftInput}
                  onChange={(e) => setLeftInput(e.target.value)}
                  placeholder="在这里粘贴原始 JSON..."
                  className="tool-textarea flex-1 border-slate-200/60 shadow-sm min-h-[300px]"
                />
              </div>
              <div className="flex flex-col gap-2 h-full">
                <label className="tool-label px-1 shrink-0">
                  比对 JSON (右侧)
                </label>
                <textarea
                  value={rightInput}
                  onChange={(e) => setRightInput(e.target.value)}
                  placeholder="在这里粘贴要比对的 JSON..."
                  className="tool-textarea flex-1 border-slate-200/60 shadow-sm min-h-[300px]"
                />
              </div>
            </div>

            {/* Comparison Table */}
            {!diffError && diffLines.length > 0 && (
              <div className="tool-panel p-0 overflow-hidden border-slate-200/60 flex flex-col">
                <div className="bg-slate-50/80 px-4 py-2 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    逐行差异视图
                  </span>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white border border-slate-200 shadow-sm">
                    <CheckCircle2 size={10} className="text-emerald-500" />
                    <span className="text-[9px] font-bold text-slate-500 uppercase">
                      实时比对中
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-slate-50 overflow-y-auto scrollbar-hide">
                  {diffLines.map((line, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[48px_1fr_1fr] group transition-colors hover:bg-slate-50/50 shrink-0"
                    >
                      <div className="py-2 px-3 text-[10px] font-mono text-slate-300 border-r border-slate-50 bg-slate-50/30 flex justify-center items-center">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div
                        className={`py-2 px-4 font-mono text-[11px] whitespace-pre-wrap break-all border-r border-slate-50/50 ${line.status === "removed" || line.status === "changed" ? diffStyles[line.status] : "text-slate-600"}`}
                      >
                        {line.left || " "}
                      </div>
                      <div
                        className={`py-2 px-4 font-mono text-[11px] whitespace-pre-wrap break-all ${line.status === "added" || line.status === "changed" ? diffStyles[line.status] : "text-slate-600"}`}
                      >
                        {line.right || " "}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {showHistory && (
          <div className="history-overlay">
            <button
              type="button"
              aria-label="关闭历史记录"
              className="history-overlay-backdrop"
              onClick={() => setShowHistory(false)}
            />
            <div
              className="history-overlay-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-slate-200/70 bg-white/80 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 text-slate-900">
                  <div className="h-10 w-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Clock size={18} />
                  </div>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em]">
                      历史比对记录
                    </p>
                    <p className="text-[10px] font-bold text-slate-400">
                      点击记录可一键恢复左右 JSON
                    </p>
                  </div>
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
                      暂无记录
                    </p>
                  </div>
                ) : (
                  history.map((item) => (
                    <button
                      key={item.id}
                      onContextMenu={(e) => openDiffHistoryMenu(e, item)}
                      onClick={() => {
                        try {
                          const data = JSON.parse(item.data);
                          setLeftInput(data.left || item.data);
                          setRightInput(data.right || "");
                        } catch {
                          setLeftInput(item.data);
                        }
                        setShowHistory(false);
                      }}
                      className="w-full text-left p-4 rounded-2xl bg-white border border-slate-200/70 shadow-sm hover:border-indigo-500 hover:shadow-indigo-500/10 transition-all group relative"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[9px] font-bold text-slate-300 font-mono">
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                        <ChevronRight
                          size={14}
                          className="text-slate-200 group-hover:text-indigo-500 transition-colors"
                        />
                      </div>
                      <p className="text-[11px] font-bold text-slate-700 truncate">
                        {item.title || "无标题比对"}
                      </p>
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

  return (
    <div className="relative flex h-full bg-white overflow-hidden text-slate-900">
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Action Header */}
        <div className="px-8 py-5 flex items-center justify-between border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-100">
              <Braces size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                JSON 格式化工具
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                双翼布局：左侧编辑，右侧即时美化预览
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary h-10 px-4 ${showHistory ? "ring-2 ring-indigo-500/20 border-indigo-200 text-indigo-600" : ""}`}
            >
              <History size={16} />
              <span>历史记录</span>
            </button>
            <div className="w-px h-6 bg-slate-100 mx-2" />
            <div className="flex gap-2">
              <button
                onClick={formatJson}
                className="tool-button-primary h-10 bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100"
              >
                <Wand2 size={16} /> 美化
              </button>
              <button
                onClick={compressJson}
                className="tool-button-secondary h-10 px-4"
              >
                <Minimize2 size={16} /> 压缩
              </button>
              <button
                onClick={sortKeys}
                className="tool-button-secondary h-10 px-4"
              >
                <ArrowUpDown size={16} /> 排序
              </button>
              <Tooltip content="清空输入与结果">
                <button
                  onClick={() => {
                    setInput("");
                    setOutput("");
                    setError("");
                  }}
                  className="tool-button-secondary h-10 w-10 p-0 text-rose-500"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden p-6 bg-slate-50/20">
          <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            {/* Left Wing: Input Area */}
            <div className="flex flex-col gap-3 min-w-0 h-full overflow-hidden">
              <div className="flex items-center justify-between px-1 shrink-0 h-[26px]">
                <label className="tool-label mb-0">原始 JSON 输入</label>
                <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">
                  {input.length} 字符
                </span>
              </div>
              <div className="relative group flex-1 overflow-hidden">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="请在此粘贴 JSON 内容..."
                  className="tool-textarea h-full border-slate-200 shadow-sm focus:shadow-indigo-500/5 group-hover:border-slate-300"
                />
                {input && (
                  <Tooltip content="清空输入">
                    <button
                      onClick={() => setInput("")}
                      className="absolute right-4 top-4 p-2 rounded-lg bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Right Wing: Output Area */}
            <div className="flex flex-col gap-3 min-w-0 h-full overflow-hidden">
              <div className="flex items-center justify-between px-1 shrink-0">
                <div className="flex items-center gap-6">
                  <label className="tool-label mb-0">处理结果展示</label>
                  <div className="flex items-center p-0.5 bg-slate-100 rounded-lg">
                    <button
                      onClick={() => setViewMode("text")}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all ${viewMode === "text" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
                    >
                      <Type size={11} /> 文本
                    </button>
                    <button
                      onClick={() => setViewMode("tree")}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all ${viewMode === "tree" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
                    >
                      <ListTree size={11} /> 树形
                    </button>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Tooltip content="复制结果">
                    <button
                      onClick={copyOutput}
                      disabled={!output}
                      className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-900 hover:text-white transition-all"
                    >
                      <Copy size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip content="下载结果">
                    <button
                      onClick={downloadOutput}
                      disabled={!output}
                      className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-900 hover:text-white transition-all"
                    >
                      <Download size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div className="flex-1 overflow-hidden relative h-full">
                {error ? (
                  <div className="status-note h-full flex flex-col items-center justify-center border-rose-100 bg-rose-50/50 text-rose-600 text-center p-8">
                    <AlertTriangle size={32} className="mb-3 opacity-20" />
                    <p className="text-[10px] font-black uppercase tracking-tight mb-1">
                      解析错误
                    </p>
                    <p className="text-xs font-medium max-w-xs">{error}</p>
                  </div>
                ) : output ? (
                  <div className="h-full tool-panel border-indigo-100 bg-indigo-50/[0.02] overflow-hidden flex flex-col p-0 shadow-inner">
                    {viewMode === "text" ? (
                      <textarea
                        value={output}
                        readOnly
                        placeholder="格式化结果将在此显示..."
                        className="w-full h-full border-none bg-transparent font-mono text-[13px] leading-relaxed p-6 resize-none outline-none text-indigo-900 placeholder:text-indigo-200"
                      />
                    ) : (
                      <div className="h-full overflow-y-auto p-6 scrollbar-hide">
                        {parsedOutput ? (
                          <JsonTreeView data={parsedOutput} />
                        ) : (
                          <div className="text-slate-300 italic text-xs">
                            正在渲染树形结构...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 text-[10px] font-bold uppercase tracking-[0.2em] italic gap-3">
                    <Minimize2 size={24} className="opacity-20" />
                    等待美化操作...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="history-overlay">
          <button
            type="button"
            aria-label="关闭历史记录"
            className="history-overlay-backdrop"
            onClick={() => setShowHistory(false)}
          />
          <div
            className="history-overlay-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-200/70 bg-white/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 text-slate-900">
                <div className="h-10 w-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <History size={18} />
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em]">
                    历史记录
                  </p>
                  <p className="text-[10px] font-bold text-slate-400">
                    最近格式化过的 JSON 片段
                  </p>
                </div>
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
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                  <Clock size={32} className="mb-2 opacity-20" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">
                    暂无记录
                  </p>
                </div>
              ) : (
                history.map((item) => (
                  <button
                    key={item.id}
                    onContextMenu={(e) => openFormatHistoryMenu(e, item)}
                    onClick={() => {
                      setInput(item.data);
                      setShowHistory(false);
                    }}
                    className="w-full text-left p-5 rounded-2xl bg-white border border-slate-200/70 shadow-sm hover:border-indigo-600 hover:shadow-indigo-500/10 transition-all group"
                  >
                    <p className="text-[11px] font-black text-slate-800 mb-3 truncate pr-4">
                      {item.title}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                      <ChevronRight
                        size={12}
                        className="text-slate-300 group-hover:text-indigo-600 transition-colors"
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
