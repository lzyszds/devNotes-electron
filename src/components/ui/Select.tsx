import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import Tooltip from "./Tooltip";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  disabled?: boolean;
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
  "inline-flex items-center justify-between gap-2 h-9 min-w-[88px] pl-3 pr-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none transition shrink-0 hover:border-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 disabled:opacity-50 disabled:pointer-events-none";

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
          className={`${triggerBase} w-full ${open ? "border-indigo-400 ring-2 ring-indigo-500/10" : ""}`}
        >
          <span className={`truncate ${selected ? "text-slate-700" : "text-slate-400"}`}>
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
          className="absolute top-full left-0 mt-1 z-50 w-full bg-white rounded-lg shadow-lg border border-slate-200 py-1 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150"
          style={menuMinWidth ? { minWidth: menuMinWidth } : undefined}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">暂无选项</li>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <li key={String(opt.value)} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => handleSelect(opt)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition ${
                      opt.disabled
                        ? "text-slate-300 cursor-not-allowed"
                        : isSelected
                          ? "bg-indigo-50 text-indigo-600 font-semibold"
                          : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="w-3.5 shrink-0 flex items-center justify-center">
                      {isSelected && <Check size={12} />}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
