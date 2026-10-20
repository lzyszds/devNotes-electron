import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  GitCompareArrows,
  History,
  Minus,
  Pencil,
  Plus,
  Trash2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useToolHistory } from "../../hooks/useToolHistory";
import { useHistoryContextMenu } from "../../hooks/useHistoryContextMenu";
import {
  CodeEditor,
  CopyButton,
  Segmented,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolEmpty,
  ToolHistoryOverlay,
  ToolShell,
  ToolTag,
  iconButtonClass,
} from "../ui";
import type { SegmentOption } from "../ui";
import Tooltip from "../ui/Tooltip";

type DiffKind = "added" | "removed" | "changed";

type DiffEntry = {
  kind: DiffKind;
  path: string;
  left?: unknown;
  right?: unknown;
};

type DiffResult = {
  entries: DiffEntry[];
  same: number;
};

type ParseState =
  | { status: "empty" }
  | { status: "ok"; value: unknown }
  | { status: "error"; message: string };

type Filter = "all" | DiffKind;

type HistoryPayload = { left: string; right: string };

const MAX_ROWS = 500;

const KIND_STYLE: Record<DiffKind, { label: string; icon: LucideIcon; cls: string }> = {
  added: {
    label: "新增",
    icon: Plus,
    cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  removed: {
    label: "删除",
    icon: Minus,
    cls: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
  },
  changed: {
    label: "修改",
    icon: Pencil,
    cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  },
};

const parseSide = (text: string): ParseState => {
  if (!text.trim()) return { status: "empty" };
  try {
    return { status: "ok", value: JSON.parse(text) };
  } catch (err) {
    const raw = (err as Error).message;
    const match = raw.match(/position (\d+)/);
    if (!match) return { status: "error", message: raw };
    const index = Number(match[1]);
    const line = text.slice(0, index).split("\n").length;
    const column = index - text.lastIndexOf("\n", index - 1);
    return { status: "error", message: `第 ${line} 行第 ${column} 列附近存在语法错误` };
  }
};

const kindOf = (value: unknown) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const childPath = (path: string, key: string) =>
  /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const preview = (value: unknown, limit = 200) => {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

/** 按结构递归比较：对象按键名对齐，数组按下标对齐，与缩进、换行、键的书写位置无关 */
const compareValues = (left: unknown, right: unknown, path: string, out: DiffResult) => {
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    keys.forEach((key) => {
      const next = childPath(path, key);
      const inLeft = Object.prototype.hasOwnProperty.call(left, key);
      const inRight = Object.prototype.hasOwnProperty.call(right, key);
      if (inLeft && !inRight) {
        out.entries.push({ kind: "removed", path: next, left: left[key] });
      } else if (!inLeft && inRight) {
        out.entries.push({ kind: "added", path: next, right: right[key] });
      } else {
        compareValues(left[key], right[key], next, out);
      }
    });
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
      const next = `${path}[${i}]`;
      if (i >= right.length) {
        out.entries.push({ kind: "removed", path: next, left: left[i] });
      } else if (i >= left.length) {
        out.entries.push({ kind: "added", path: next, right: right[i] });
      } else {
        compareValues(left[i], right[i], next, out);
      }
    }
    return;
  }

  if (kindOf(left) === kindOf(right) && left === right) {
    out.same += 1;
    return;
  }

  out.entries.push({ kind: "changed", path, left, right });
};

const diffJson = (left: unknown, right: unknown): DiffResult => {
  const out: DiffResult = { entries: [], same: 0 };
  compareValues(left, right, "$", out);
  return out;
};

function JsonSidePanel({
  title,
  text,
  state,
  onChange,
  placeholder,
}: {
  title: string;
  text: string;
  state: ParseState;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const valid = state.status === "ok";

  return (
    <ToolCard>
      <ToolCardHeader
        title={title}
        meta={text ? `${text.length} 字符` : undefined}
        actions={
          <>
            {state.status === "ok" && (
              <ToolTag tone="emerald">
                <CheckCircle2 size={11} />
                有效
              </ToolTag>
            )}
            {state.status === "error" && (
              <ToolTag tone="amber">
                <AlertTriangle size={11} />
                语法错误
              </ToolTag>
            )}
            <Tooltip content="格式化" disabled={!valid}>
              <button
                onClick={() => valid && onChange(JSON.stringify(state.value, null, 2))}
                disabled={!valid}
                className={iconButtonClass("brand")}
              >
                <Wand2 size={15} />
              </button>
            </Tooltip>
            <Tooltip content="清空" disabled={!text}>
              <button
                onClick={() => onChange("")}
                disabled={!text}
                className={iconButtonClass("danger")}
              >
                <Trash2 size={15} />
              </button>
            </Tooltip>
          </>
        }
      />
      <CodeEditor value={text} onChange={onChange} placeholder={placeholder} />
      {state.status === "error" && (
        <div
          className="shrink-0 truncate border-t border-amber-200/60 bg-amber-50/60 px-3.5 py-2 text-[11px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
          title={state.message}
        >
          {state.message}
        </div>
      )}
    </ToolCard>
  );
}

function ValueCell({ text, tint }: { text: string | null; tint: string }) {
  return (
    <div
      className={`break-all px-3 py-2 ${tint} ${
        text === null ? "text-slate-300 dark:text-slate-600" : "text-slate-600 dark:text-slate-300"
      }`}
      title={text ?? undefined}
    >
      {text ?? "—"}
    </div>
  );
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  const style = KIND_STYLE[entry.kind];
  const Icon = style.icon;

  const leftTint =
    entry.kind === "removed"
      ? "bg-rose-50/70 dark:bg-rose-500/10"
      : entry.kind === "changed"
        ? "bg-amber-50/70 dark:bg-amber-500/10"
        : "";
  const rightTint =
    entry.kind === "added"
      ? "bg-emerald-50/70 dark:bg-emerald-500/10"
      : entry.kind === "changed"
        ? "bg-amber-50/70 dark:bg-amber-500/10"
        : "";

  return (
    <div className="grid grid-cols-[72px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] font-mono text-[12px] transition-colors hover:bg-slate-50/60 dark:hover:bg-dark-hover/40">
      <div className="px-3 py-2">
        <span
          className={`inline-flex h-5 items-center gap-1 rounded-md px-1.5 font-sans text-[10px] font-semibold ${style.cls}`}
        >
          <Icon size={11} />
          {style.label}
        </span>
      </div>
      <div className="break-all px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
        {entry.path}
      </div>
      <ValueCell
        text={entry.kind === "added" ? null : preview(entry.left)}
        tint={leftTint}
      />
      <ValueCell
        text={entry.kind === "removed" ? null : preview(entry.right)}
        tint={rightTint}
      />
    </div>
  );
}

/* --- Main Tool Component --- */

export default function JsonDiffTool() {
  const [leftInput, setLeftInput] = useState("");
  const [rightInput, setRightInput] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showHistory, setShowHistory] = useState(false);

  const { history, saveHistory, clearHistory, removeHistoryItem } =
    useToolHistory<string>("json-diff");

  const restorePair = (raw: string) => {
    try {
      const data = JSON.parse(raw) as Partial<HistoryPayload>;
      setLeftInput(data.left ?? raw);
      setRightInput(data.right ?? "");
    } catch {
      setLeftInput(raw);
      setRightInput("");
    }
    setShowHistory(false);
  };

  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => restorePair(item.data),
    onRemove: removeHistoryItem,
  });

  const leftState = useMemo(() => parseSide(leftInput), [leftInput]);
  const rightState = useMemo(() => parseSide(rightInput), [rightInput]);

  const diff = useMemo(() => {
    if (leftState.status !== "ok" || rightState.status !== "ok") return null;
    return diffJson(leftState.value, rightState.value);
  }, [leftState, rightState]);

  const counts = useMemo(() => {
    const result = { added: 0, removed: 0, changed: 0 };
    diff?.entries.forEach((entry) => {
      result[entry.kind] += 1;
    });
    return result;
  }, [diff]);

  const visibleEntries = useMemo(() => {
    if (!diff) return [];
    return filter === "all" ? diff.entries : diff.entries.filter((e) => e.kind === filter);
  }, [diff, filter]);

  const report = useMemo(() => {
    if (!diff) return "";
    return diff.entries
      .map((entry) => {
        const label = KIND_STYLE[entry.kind].label;
        if (entry.kind === "added") return `[${label}] ${entry.path}: ${preview(entry.right)}`;
        if (entry.kind === "removed") return `[${label}] ${entry.path}: ${preview(entry.left)}`;
        return `[${label}] ${entry.path}: ${preview(entry.left)} → ${preview(entry.right)}`;
      })
      .join("\n");
  }, [diff]);

  // 两侧都合法且内容有变化时，停顿片刻后记入历史；同一对内容只记一次
  const lastSavedRef = useRef("");
  useEffect(() => {
    if (!diff || !leftInput.trim() || !rightInput.trim()) return;
    const key = JSON.stringify([leftInput, rightInput]);
    const timer = window.setTimeout(() => {
      if (lastSavedRef.current === key) return;
      lastSavedRef.current = key;
      const total = diff.entries.length;
      const title = total === 0 ? "结构一致" : `${total} 处差异`;
      const payload: HistoryPayload = { left: leftInput, right: rightInput };
      saveHistory(JSON.stringify(payload), title);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [diff, leftInput, rightInput, saveHistory]);

  const filterOptions: SegmentOption<Filter>[] = [
    { value: "all", label: `全部 ${diff?.entries.length ?? 0}` },
    { value: "added", label: `新增 ${counts.added}` },
    { value: "removed", label: `删除 ${counts.removed}` },
    { value: "changed", label: `修改 ${counts.changed}` },
  ];

  const renderResultBody = () => {
    if (leftState.status === "error" || rightState.status === "error") {
      const sides = [
        leftState.status === "error" ? `左侧：${leftState.message}` : null,
        rightState.status === "error" ? `右侧：${rightState.message}` : null,
      ].filter(Boolean);
      return (
        <ToolEmpty
          icon={AlertTriangle}
          title="无法比对，请先修正 JSON 语法"
          hint={sides.join("；")}
          className="flex-1"
        />
      );
    }

    if (!diff) {
      return (
        <ToolEmpty
          icon={GitCompareArrows}
          title="等待两侧输入"
          hint="在上方两侧粘贴 JSON，内容会自动比对"
          className="flex-1"
        />
      );
    }

    if (diff.entries.length === 0) {
      return (
        <ToolEmpty
          icon={CheckCircle2}
          title="结构完全一致"
          hint={`共比较 ${diff.same} 个值，没有发现差异`}
          className="flex-1"
        />
      );
    }

    if (visibleEntries.length === 0) {
      return <ToolEmpty icon={CheckCircle2} title="该类型下没有差异" className="flex-1" />;
    }

    const shown = visibleEntries.slice(0, MAX_ROWS);

    return (
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="sticky top-0 z-10 grid grid-cols-[72px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-400 dark:border-dark-border dark:bg-dark-hover dark:text-slate-500">
          <div className="px-3 py-2">类型</div>
          <div className="px-3 py-2">路径</div>
          <div className="px-3 py-2">原始 JSON（左）</div>
          <div className="px-3 py-2">比对 JSON（右）</div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-dark-border">
          {shown.map((entry, index) => (
            <DiffRow key={`${entry.path}-${index}`} entry={entry} />
          ))}
        </div>
        {visibleEntries.length > MAX_ROWS && (
          <div className="px-3 py-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
            仅显示前 {MAX_ROWS} 条，完整结果请使用「复制差异报告」
          </div>
        )}
      </div>
    );
  };

  const totalDiffs = diff?.entries.length ?? 0;

  return (
    <ToolShell
      icon={GitCompareArrows}
      title="JSON 比对"
      subtitle="按结构逐字段比较，忽略缩进、换行与格式差异"
      badge={
        diff ? (
          totalDiffs === 0 ? (
            <ToolBadge tone="emerald">结构一致</ToolBadge>
          ) : (
            <ToolBadge tone="brand">{totalDiffs} 处差异</ToolBadge>
          )
        ) : undefined
      }
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
            <span>比对历史</span>
          </button>
          <button
            onClick={() => {
              setLeftInput(rightInput);
              setRightInput(leftInput);
            }}
            disabled={!leftInput && !rightInput}
            className="tool-button-secondary h-8 disabled:opacity-40"
          >
            <ArrowLeftRight size={15} />
            <span>交换左右</span>
          </button>
          <button
            onClick={() => {
              setLeftInput("");
              setRightInput("");
            }}
            className="tool-button-secondary h-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50 border-rose-100 dark:text-rose-400 dark:border-rose-500/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
          >
            <Trash2 size={15} />
            <span>清空</span>
          </button>
        </>
      }
      scroll={false}
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="比对历史"
          items={history}
          onClear={clearHistory}
          onPick={(item) => restorePair(item.data)}
          onItemContextMenu={openHistoryMenu}
          renderItemTitle={(item) => item.title || "无标题比对"}
        />
      }
    >
      <div className="flex flex-1 min-h-0 flex-col gap-4 p-4 md:p-6">
        <div className="tool-cascade grid grid-cols-1 xl:grid-cols-2 gap-4 flex-[1_1_0] min-h-[260px]">
          <JsonSidePanel
            title="原始 JSON（左）"
            text={leftInput}
            state={leftState}
            onChange={setLeftInput}
            placeholder="在这里粘贴原始 JSON..."
          />
          <JsonSidePanel
            title="比对 JSON（右）"
            text={rightInput}
            state={rightState}
            onChange={setRightInput}
            placeholder="在这里粘贴要比对的 JSON..."
          />
        </div>

        <ToolCard className="tool-cascade flex-[1.3_1_0] min-h-[260px]">
          <ToolCardHeader
            icon={GitCompareArrows}
            title="差异明细"
            meta={
              diff
                ? `${totalDiffs} 处差异 · ${diff.same} 个值相同`
                : undefined
            }
            actions={
              diff && totalDiffs > 0 ? (
                <>
                  <Segmented value={filter} onChange={setFilter} options={filterOptions} />
                  <CopyButton value={report} label="复制差异报告" />
                </>
              ) : undefined
            }
          />
          <div className="flex-1 min-h-0 flex flex-col">{renderResultBody()}</div>
        </ToolCard>
      </div>
    </ToolShell>
  );
}
