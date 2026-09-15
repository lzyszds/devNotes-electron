import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import Tooltip from "./Tooltip";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /**
   * 分组名。相邻且同名的项会被归到一个小标题底下，用来把长清单分段
   * （如代码块主题按深色/浅色分开）。不必预先排好序，但同组的项要连在一起。
   */
  group?: string;
}

export interface SelectProps<T extends string | number = string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  /** 下拉菜单最小宽度，默认与触发器同宽 */
  menuMinWidth?: number | string;
}

const triggerBase =
  "inline-flex items-center justify-between gap-2 h-9 min-w-[88px] pl-3 pr-2 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-xs font-semibold text-slate-700 dark:text-slate-300 outline-none transition shrink-0 hover:border-slate-300 dark:hover:border-slate-600 focus:border-brand-400 dark:focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:opacity-50 disabled:pointer-events-none";

export default function Select<T extends string | number = string>({
  value,
  options,
  onChange,
  placeholder = "请选择",
  disabled = false,
  className = "",
  title,
  menuMinWidth,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((opt) => opt.value === value);
  const displayLabel = selected?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSelect = (opt: SelectOption<T>) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* title 交给自绘 Tooltip，且只包在触发按钮上：挂到根 div 会把下方展开的选项列表也算进悬停区 */}
      <Tooltip content={title}>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => !disabled && setOpen((v) => !v)}
          className={`${triggerBase} w-full ${open ? "border-brand-400 ring-2 ring-brand-500/10" : ""}`}
        >
          <span
            className={`truncate ${selected ? "text-slate-700 dark:text-slate-300" : "text-slate-400"}`}
          >
            {displayLabel}
          </span>
          <ChevronDown
            size={14}
            className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </Tooltip>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute top-full left-0 mt-1 z-50 w-full bg-white dark:bg-dark-panel rounded-lg shadow-lg border border-slate-200 dark:border-dark-border py-1 max-h-60 overflow-y-auto"
          style={menuMinWidth ? { minWidth: menuMinWidth } : undefined}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">暂无选项</li>
          ) : (
            options.map((opt, index) => {
              const isSelected = opt.value === value;
              // 组名只在「和上一项不同」时打一次，所以同组的项必须连着放
              const startsGroup = !!opt.group && opt.group !== options[index - 1]?.group;
              return (
                <Fragment key={String(opt.value)}>
                  {startsGroup && (
                    // sticky：清单长的时候滚到哪都能看见自己在哪一组
                    <li
                      role="presentation"
                      className="sticky top-0 z-10 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:bg-dark-hover dark:text-slate-500"
                    >
                      {opt.group}
                    </li>
                  )}
                  <li role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => handleSelect(opt)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition ${
                        opt.disabled
                          ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                          : isSelected
                            ? "bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 font-semibold"
                            : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover"
                      }`}
                    >
                      <span className="w-3.5 shrink-0 flex items-center justify-center">
                        {isSelected && <Check size={12} />}
                      </span>
                      <span className="truncate">{opt.label}</span>
                    </button>
                  </li>
                </Fragment>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
