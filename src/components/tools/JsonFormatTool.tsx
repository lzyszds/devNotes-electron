import { useMemo, useState } from "react";
import {
  Wand2,
  Minimize2,
  ArrowUpDown,
  Trash2,
  Download,
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
import {
  CodeEditor,
  Segmented,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolEmpty,
  ToolHistoryOverlay,
  ToolShell,
  CopyButton,
  iconButtonClass,
} from "../ui";
import Tooltip from "../ui/Tooltip";

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

/* --- Main Tool Component --- */

export default function JsonFormatTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"text" | "tree">("text");
  const [showHistory, setShowHistory] = useState(false);

  const { history, saveHistory, clearHistory, removeHistoryItem } =
    useToolHistory<string>("json-format");

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

  const downloadOutput = () => {
    const blob = new Blob([output], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "formatted.json";
    link.click();
  };

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
            className={`tool-button-secondary h-8 ${
              showHistory
                ? "ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400"
                : ""
            }`}
          >
            <History size={15} />
            <span>历史记录</span>
          </button>
          <button onClick={formatJson} className="tool-button-primary h-8 px-5">
            <Wand2 size={15} />
            <span>美化</span>
          </button>
          <button onClick={compressJson} className="tool-button-secondary h-8">
            <Minimize2 size={15} />
            <span>压缩</span>
          </button>
          <button onClick={sortKeys} className="tool-button-secondary h-8">
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
              className="tool-button-secondary h-8 w-9 p-0 text-rose-500 dark:text-rose-400"
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
      <div className="flex-1 min-h-0 p-3">
        <div className="tool-cascade grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
          {/* 原始输入 */}
          <ToolCard>
            <ToolCardHeader
              title="原始 JSON 输入"
              meta={`${input.length} 字符`}
              actions={
                <Tooltip content="清空输入">
                  <button
                    onClick={() => setInput("")}
                    disabled={!input}
                    className={iconButtonClass("danger")}
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
              }
            />

            <CodeEditor
              value={input}
              onChange={setInput}
              placeholder="请在此粘贴 JSON 内容..."
            />
          </ToolCard>

          {/* 处理结果 */}
          <ToolCard>
            <ToolCardHeader
              title="处理结果"
              actions={
                <>
                  <Segmented
                    value={viewMode}
                    onChange={setViewMode}
                    options={[
                      { value: "text", label: "文本", icon: Type },
                      { value: "tree", label: "树形", icon: ListTree },
                    ]}
                  />
                  <CopyButton value={() => output} disabled={!output} />
                  <Tooltip content="下载结果">
                    <button
                      onClick={downloadOutput}
                      disabled={!output}
                      className={iconButtonClass("brand")}
                    >
                      <Download size={15} />
                    </button>
                  </Tooltip>
                </>
              }
            />

            <div className="flex-1 min-h-0 flex flex-col">
              {error ? (
                <ToolEmpty
                  icon={AlertTriangle}
                  title="解析错误"
                  hint={error}
                  className="flex-1"
                />
              ) : output ? (
                viewMode === "text" ? (
                  /* key 绑输出内容：重新美化一次就重挂载一层外壳（不是重挂编辑器本身），
                     让 fe-rise 重播一遍 —— 用户能看出「这次的结果是新算的」。
                     把 key 放在包一层 div 上而不是 CodeEditor 上：编辑器一旦重挂载，
                     里面滚动容器的滚动位置会归零，改个缩进就把视图弹回顶部太烦人。 */
                  <div
                    key={`${output.length}-${output.slice(0, 24)}`}
                    className="fe-rise flex-1 min-h-0 flex flex-col"
                  >
                    <CodeEditor value={output} readOnly placeholder="格式化结果将在此显示..." />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto p-4">
                    {parsedOutput ? (
                      <JsonTreeView data={parsedOutput} />
                    ) : (
                      <div className="text-slate-300 dark:text-slate-600 text-xs">
                        正在渲染树形结构...
                      </div>
                    )}
                  </div>
                )
              ) : (
                <ToolEmpty icon={Braces} title="等待美化操作" hint="粘贴 JSON 后点击「美化」" className="flex-1" />
              )}
            </div>
          </ToolCard>
        </div>
      </div>
    </ToolShell>
  );
}
