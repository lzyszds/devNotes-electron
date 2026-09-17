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
  ChevronRight,
  ChevronDown,
  Braces,
  ListTree,
  Type,
} from "lucide-react";
import { useToolHistory } from "../../hooks/useToolHistory";
import { useHistoryContextMenu } from "../../hooks/useHistoryContextMenu";
import { ToolBadge, ToolHistoryOverlay, ToolShell } from "../ui";
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
      return <span className="text-rose-500 dark:text-rose-400 font-bold italic">null</span>;
    if (typeof val === "string")
      return <span className="text-emerald-600 dark:text-emerald-400">"{val}"</span>;
    if (typeof val === "number")
      return <span className="text-sky-600 dark:text-sky-400 font-bold">{val}</span>;
    if (typeof val === "boolean")
      return <span className="text-amber-600 dark:text-amber-400 font-bold">{val.toString()}</span>;
    return null;
  };

  if (!isObject) {
    return (
      <div className="flex items-start py-0.5 group">
        {label && (
          <span className="text-slate-900 dark:text-slate-100 font-bold mr-2">"{label}":</span>
        )}
        {renderValue(value)}
        {!isLast && <span className="text-slate-400 dark:text-slate-500">,</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center py-0.5 cursor-pointer group hover:bg-slate-50 dark:hover:bg-dark-hover rounded px-1 -ml-1 transition-colors"
        onClick={() => !isEmpty && setIsExpanded(!isExpanded)}
      >
        <div className="w-4 h-4 flex items-center justify-center mr-1 text-slate-300 dark:text-slate-600">
          {!isEmpty &&
            (isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            ))}
        </div>
        {label && (
          <span className="text-slate-900 dark:text-slate-100 font-bold mr-2">"{label}":</span>
        )}
        <span className="text-slate-400 dark:text-slate-500 font-bold">
          {isArray ? "[" : "{"}
          {!isExpanded && !isEmpty && (
            <span className="mx-1 text-slate-300 dark:text-slate-600 text-[10px]">...</span>
          )}
          {!isExpanded && (isArray ? "]" : "}")}
        </span>
        {!isExpanded && !isLast && <span className="text-slate-400 dark:text-slate-500">,</span>}
        {!isExpanded && isArray && value.length > 0 && (
          <span className="ml-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tighter bg-slate-100 dark:bg-dark-hover px-1.5 rounded">
            {value.length} 个项目
          </span>
        )}
      </div>

      {isExpanded && !isEmpty && (
        <div className="ml-4 border-l border-slate-100 dark:border-dark-border pl-4 transition-all">
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
          <span className="text-slate-400 dark:text-slate-500 font-bold ml-5">
            {isArray ? "]" : "}"}
            {!isLast && <span className="text-slate-400 dark:text-slate-500">,</span>}
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
  same: "text-slate-400 dark:text-slate-500",
  added:
    "bg-emerald-50 text-emerald-700 border-l-2 border-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-300",
  removed:
    "bg-rose-50 text-rose-700 border-l-2 border-rose-500 dark:bg-rose-500/10 dark:text-rose-300",
  changed:
    "bg-amber-50 text-amber-700 border-l-2 border-amber-500 dark:bg-amber-500/10 dark:text-amber-300",
};

/** 统计卡的语义色：匹配=灰、新增=绿、删除=红、修改=琥珀，深浅两套都写死，
 *  不用模板字符串拼类名 —— 拼出来的类名 Tailwind 扫不到，只是碰巧别处有同名字符串才生效 */
const DIFF_STAT_TONES = {
  same: {
    box: "border-slate-100 dark:border-dark-border",
    label: "text-slate-500 dark:text-slate-400",
  },
  added: {
    box: "border-emerald-100 dark:border-emerald-500/25",
    label: "text-emerald-500 dark:text-emerald-400",
  },
  removed: {
    box: "border-rose-100 dark:border-rose-500/25",
    label: "text-rose-500 dark:text-rose-400",
  },
  changed: {
    box: "border-amber-100 dark:border-amber-500/25",
    label: "text-amber-500 dark:text-amber-400",
  },
} as const;

const CARD = "bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col min-h-0";
const CARD_HEAD = "px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex items-center justify-between gap-2 flex-shrink-0";
const CARD_HEAD_LABEL = "text-xs font-semibold text-slate-700 dark:text-slate-300";
const CARD_FOOT = "px-4 py-2.5 border-t border-slate-100 dark:border-dark-border bg-slate-50/40 dark:bg-dark-sidebar/30 rounded-b-2xl flex items-center justify-end gap-3 text-xs flex-shrink-0";
const ICON_BTN = "p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 transition disabled:opacity-40 disabled:pointer-events-none";
const BODY_TEXTAREA = "w-full flex-1 bg-transparent resize-none outline-none font-mono text-slate-800 dark:text-slate-100 text-sm leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-600";

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
      <ToolShell
        icon={GitCompareArrows}
        title="JSON 内容比对"
        subtitle="逐行分析两个 JSON 的差异"
        badge={
          diffLines.length > 0 ? <ToolBadge tone="brand">{diffLines.length} 行</ToolBadge> : undefined
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
              <span>比对历史</span>
            </button>
            <button
              onClick={() => {
                setLeftInput("");
                setRightInput("");
              }}
              className="tool-button-secondary h-9 text-rose-500 hover:text-rose-600 hover:bg-rose-50 border-rose-100 dark:text-rose-400 dark:border-rose-500/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
            >
              <Trash2 size={15} />
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
              className="tool-button-primary h-9 px-5"
            >
              <Copy size={15} />
              <span>复制结果</span>
            </button>
          </>
        }
        overlay={
          <ToolHistoryOverlay
            open={showHistory}
            onClose={() => setShowHistory(false)}
            title="历史比对记录"
            items={history}
            onClear={clearHistory}
            onPick={(item) => {
              try {
                const data = JSON.parse(item.data);
                setLeftInput(data.left || item.data);
                setRightInput(data.right || "");
              } catch {
                setLeftInput(item.data);
              }
              setShowHistory(false);
            }}
            onItemContextMenu={openDiffHistoryMenu}
            renderItemTitle={(item) => item.title || "无标题比对"}
          />
        }
      >
        {/* 差异统计 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
          {(
            [
              { key: "same", label: "匹配", value: diffStats.same },
              { key: "added", label: "新增", value: diffStats.added },
              { key: "removed", label: "删除", value: diffStats.removed },
              { key: "changed", label: "修改", value: diffStats.changed },
            ] as const
          ).map((stat) => (
            <div
              key={stat.key}
              className={`p-4 rounded-2xl border bg-white dark:bg-dark-panel shadow-sm ${DIFF_STAT_TONES[stat.key].box}`}
            >
              <p
                className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${DIFF_STAT_TONES[stat.key].label}`}
              >
                {stat.label}
              </p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* 两份 JSON */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-[400px]">
          <div className={CARD}>
            <div className={CARD_HEAD}>
              <span className={CARD_HEAD_LABEL}>原始 JSON（左侧）</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {leftInput.length} 字符
              </span>
            </div>
            <div className="flex-1 p-4 flex flex-col min-h-0">
              <textarea
                value={leftInput}
                onChange={(e) => setLeftInput(e.target.value)}
                placeholder="在这里粘贴原始 JSON..."
                className={BODY_TEXTAREA}
              />
            </div>
          </div>

          <div className={CARD}>
            <div className={CARD_HEAD}>
              <span className={CARD_HEAD_LABEL}>比对 JSON（右侧）</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {rightInput.length} 字符
              </span>
            </div>
            <div className="flex-1 p-4 flex flex-col min-h-0">
              <textarea
                value={rightInput}
                onChange={(e) => setRightInput(e.target.value)}
                placeholder="在这里粘贴要比对的 JSON..."
                className={BODY_TEXTAREA}
              />
            </div>
          </div>
        </div>

        {/* 逐行差异 */}
        {!diffError && diffLines.length > 0 && (
          <div className={`${CARD} flex-1 min-h-[320px]`}>
            <div className={CARD_HEAD}>
              <span className={CARD_HEAD_LABEL}>逐行差异视图</span>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
                <CheckCircle2 size={11} />
                实时比对中
              </span>
            </div>
            <div className="flex-1 min-h-0 divide-y divide-slate-50 dark:divide-dark-border overflow-y-auto">
              {diffLines.map((line, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[48px_1fr_1fr] group transition-colors hover:bg-slate-50/50 dark:hover:bg-dark-hover/40 shrink-0"
                >
                  <div className="py-2 px-3 text-[10px] font-mono text-slate-300 dark:text-slate-600 border-r border-slate-50 dark:border-dark-border bg-slate-50/30 dark:bg-dark-sidebar/30 flex justify-center items-center">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div
                    className={`py-2 px-4 font-mono text-[11px] whitespace-pre-wrap break-all border-r border-slate-50/50 dark:border-dark-border ${
                      line.status === "removed" || line.status === "changed"
                        ? diffStyles[line.status]
                        : "text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {line.left || " "}
                  </div>
                  <div
                    className={`py-2 px-4 font-mono text-[11px] whitespace-pre-wrap break-all ${
                      line.status === "added" || line.status === "changed"
                        ? diffStyles[line.status]
                        : "text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {line.right || " "}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </ToolShell>
    );
  }

  return (
    <ToolShell
      icon={Braces}
      title="JSON 格式化工具"
      subtitle="双翼布局：左侧编辑，右侧即时美化预览"
      badge={output ? <ToolBadge tone="brand">{output.length} 字符</ToolBadge> : undefined}
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
            <span>历史记录</span>
          </button>
          <button onClick={formatJson} className="tool-button-primary h-9 px-5">
            <Wand2 size={15} />
            <span>美化</span>
          </button>
          <button onClick={compressJson} className="tool-button-secondary h-9">
            <Minimize2 size={15} />
            <span>压缩</span>
          </button>
          <button onClick={sortKeys} className="tool-button-secondary h-9">
            <ArrowUpDown size={15} />
            <span>排序</span>
          </button>
          <Tooltip content="清空输入与结果">
            <button
              onClick={() => {
                setInput("");
                setOutput("");
                setError("");
              }}
              className="tool-button-secondary h-9 w-9 p-0 text-rose-500 dark:text-rose-400"
            >
              <Trash2 size={15} />
            </button>
          </Tooltip>
        </>
      }
      scroll={false}
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="历史记录"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setInput(item.data);
            setShowHistory(false);
          }}
          onItemContextMenu={openFormatHistoryMenu}
        />
      }
    >
      <div className="flex-1 min-h-0 p-4 md:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
          {/* 原始输入 */}
          <div className={CARD}>
            <div className={CARD_HEAD}>
              <span className={CARD_HEAD_LABEL}>原始 JSON 输入</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {input.length} 字符
              </span>
            </div>
            <div className="flex-1 p-4 flex flex-col min-h-0">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="请在此粘贴 JSON 内容..."
                className={BODY_TEXTAREA}
              />
            </div>
            <div className={CARD_FOOT}>
              <button
                onClick={() => setInput("")}
                disabled={!input}
                className="px-3 py-1 bg-white dark:bg-dark-panel hover:bg-slate-50 dark:hover:bg-dark-hover text-slate-700 dark:text-slate-200 font-medium border border-slate-200 dark:border-dark-border rounded-md transition shadow-2xs flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
              >
                <Trash2 size={13} className="text-slate-500 dark:text-slate-400" />
                <span>清空输入</span>
              </button>
            </div>
          </div>

          {/* 处理结果 */}
          <div className={CARD}>
            <div className={CARD_HEAD}>
              <span className={CARD_HEAD_LABEL}>处理结果展示</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center p-0.5 bg-slate-100 dark:bg-dark-sidebar rounded-lg">
                  <button
                    onClick={() => setViewMode("text")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                      viewMode === "text"
                        ? "bg-white dark:bg-dark-panel text-brand-600 dark:text-brand-400 shadow-2xs"
                        : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                    }`}
                  >
                    <Type size={11} /> 文本
                  </button>
                  <button
                    onClick={() => setViewMode("tree")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                      viewMode === "tree"
                        ? "bg-white dark:bg-dark-panel text-brand-600 dark:text-brand-400 shadow-2xs"
                        : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                    }`}
                  >
                    <ListTree size={11} /> 树形
                  </button>
                </div>
                <Tooltip content="复制结果">
                  <button onClick={copyOutput} disabled={!output} className={ICON_BTN}>
                    <Copy size={15} />
                  </button>
                </Tooltip>
                <Tooltip content="下载结果">
                  <button onClick={downloadOutput} disabled={!output} className={ICON_BTN}>
                    <Download size={15} />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              {error ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-rose-600 dark:text-rose-300">
                  <AlertTriangle size={32} className="mb-3 opacity-20" />
                  <p className="text-[10px] font-bold uppercase tracking-tight mb-1">解析错误</p>
                  <p className="text-xs font-medium max-w-xs whitespace-pre-line">{error}</p>
                </div>
              ) : output ? (
                <div className="flex-1 min-h-0 m-4 rounded-xl border border-brand-100 dark:border-brand-500/20 bg-brand-50/[0.02] dark:bg-brand-500/[0.04] overflow-hidden flex flex-col">
                  {viewMode === "text" ? (
                    <textarea
                      value={output}
                      readOnly
                      placeholder="格式化结果将在此显示..."
                      className="w-full h-full border-none bg-transparent font-mono text-sm leading-relaxed p-4 resize-none outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                    />
                  ) : (
                    <div className="h-full overflow-y-auto p-4">
                      {parsedOutput ? (
                        <JsonTreeView data={parsedOutput} />
                      ) : (
                        <div className="text-slate-300 dark:text-slate-600 italic text-xs">
                          正在渲染树形结构...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 m-4 rounded-xl border border-dashed border-slate-200 dark:border-dark-border flex flex-col items-center justify-center text-slate-300 dark:text-slate-600 text-[11px] font-bold uppercase tracking-[0.2em] gap-3">
                  <Minimize2 size={24} className="opacity-20" />
                  等待美化操作...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
