import { useMemo } from "react";
import Tooltip from "./Tooltip";
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./shadcn/select";
import { cn } from "../../lib/utils";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /**
   * 分组名。相邻且同名的项会被归到一个小标题底下，用来把长清单分段
   * （如代码块主题按深色/浅色分开）。不必预先排好序，但同组的项要连在一起。
   */
  group?: string;
  /**
   * 子选项。带子选项的项只当分类用 —— Radix Select 没有二级菜单，
   * 这里展平成 SelectGroup（父 label 当组标题）。
   */
  children?: SelectOption<T>[];
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
  /**
   * 触发器尺寸。sm 给卡片标题栏这类次要位置用 —— 和旁边的小按钮齐平，
   * 默认 md 与工具页表单一致。
   */
  size?: "md" | "sm";
  /**
   * 展开方向。贴着容器下沿的控件（如卡片底栏）要用 up。
   */
  placement?: "down" | "up";
}

/** Radix Select 禁止 value=""，空串用哨兵占位再还原 */
const EMPTY_SENTINEL = "__devnotes_select_empty__";

function toRadixValue(value: string | number): string {
  if (value === "") return EMPTY_SENTINEL;
  return String(value);
}

function fromRadixValue<T extends string | number>(
  raw: string,
  options: SelectOption<T>[],
): T {
  if (raw === EMPTY_SENTINEL) {
    const empty = findOption(options, "" as T);
    return empty ? empty.value : ("" as T);
  }
  const matched = findOptionByString(options, raw);
  if (matched) return matched.value;
  /* 数字型 value：选项里是 number，Radix 只给 string */
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    const numHit = findOption(options, asNum as T);
    if (numHit) return numHit.value;
  }
  return raw as T;
}

function findOption<T extends string | number>(
  options: SelectOption<T>[],
  value: T,
): SelectOption<T> | undefined {
  for (const opt of options) {
    if (opt.children?.length) {
      const child = opt.children.find((c) => c.value === value);
      if (child) return child;
    } else if (opt.value === value) {
      return opt;
    }
  }
  return undefined;
}

function findOptionByString<T extends string | number>(
  options: SelectOption<T>[],
  raw: string,
): SelectOption<T> | undefined {
  for (const opt of options) {
    if (opt.children?.length) {
      const child = opt.children.find((c) => String(c.value) === raw);
      if (child) return child;
    } else if (String(opt.value) === raw) {
      return opt;
    }
  }
  return undefined;
}

type RenderBlock<T extends string | number> =
  | { type: "items"; items: SelectOption<T>[] }
  | { type: "group"; label: string; items: SelectOption<T>[] };

/** 把 group / children 展成 Radix 能吃的 Group 结构 */
function buildBlocks<T extends string | number>(
  options: SelectOption<T>[],
): RenderBlock<T>[] {
  const blocks: RenderBlock<T>[] = [];
  let pending: SelectOption<T>[] = [];
  let pendingGroup: string | undefined;

  const flushPending = () => {
    if (!pending.length) return;
    if (pendingGroup) {
      blocks.push({ type: "group", label: pendingGroup, items: pending });
    } else {
      blocks.push({ type: "items", items: pending });
    }
    pending = [];
    pendingGroup = undefined;
  };

  for (const opt of options) {
    if (opt.children?.length) {
      flushPending();
      blocks.push({ type: "group", label: opt.label, items: opt.children });
      continue;
    }
    const g = opt.group;
    if (g !== pendingGroup) {
      flushPending();
      pendingGroup = g;
    }
    pending.push(opt);
  }
  flushPending();
  return blocks;
}

const triggerSizes = {
  md: "h-9 min-w-[88px] px-3 text-xs font-semibold",
  sm: "h-7 min-w-[76px] px-2 text-[11px] font-medium",
} as const;

/**
 * 应用内统一下拉：外壳仍是旧 Select API，内核换成 shadcn/Radix Select。
 * 调用方不用改；Dialog 里滚动/点击由 Radix 原生处理。
 */
export default function Select<T extends string | number = string>({
  value,
  options,
  onChange,
  placeholder = "请选择",
  disabled = false,
  className = "",
  title,
  menuMinWidth,
  size = "md",
  placement = "down",
}: SelectProps<T>) {
  const blocks = useMemo(() => buildBlocks(options), [options]);
  const selected = findOption(options, value);
  const radixValue = toRadixValue(value);

  /*
   * 当前值不在 options 里时（例如模型列表还没拉到、但本地已存了模型名），
   * Radix 会显示空白。补一项，保证触发器上仍能看到当前值。
   */
  const orphan =
    selected == null && String(value).length > 0
      ? ({ value, label: String(value) } as SelectOption<T>)
      : null;

  const contentStyle =
    menuMinWidth != null
      ? {
          minWidth:
            typeof menuMinWidth === "number"
              ? `${menuMinWidth}px`
              : menuMinWidth,
        }
      : undefined;

  const trigger = (
    <SelectTrigger
      disabled={disabled}
      className={cn(triggerSizes[size], "w-full", className)}
    >
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
  );

  return (
    <ShadcnSelect
      value={radixValue}
      disabled={disabled}
      onValueChange={(next) => onChange(fromRadixValue(next, options))}
    >
      {title ? <Tooltip content={title}>{trigger}</Tooltip> : trigger}

      <SelectContent
        side={placement === "up" ? "top" : "bottom"}
        position="popper"
        style={contentStyle}
      >
        {orphan && (
          <SelectGroup>
            <SelectItem value={toRadixValue(orphan.value)}>
              {orphan.label}
            </SelectItem>
          </SelectGroup>
        )}
        {blocks.map((block, index) => {
          if (block.type === "items") {
            return (
              <SelectGroup key={`items-${index}`}>
                {block.items.map((item) => (
                  <SelectItem
                    key={toRadixValue(item.value)}
                    value={toRadixValue(item.value)}
                    disabled={item.disabled}
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          }
          return (
            <SelectGroup key={`group-${block.label}-${index}`}>
              <SelectLabel>{block.label}</SelectLabel>
              {block.items.map((item) => (
                <SelectItem
                  key={toRadixValue(item.value)}
                  value={toRadixValue(item.value)}
                  disabled={item.disabled}
                >
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
        {blocks.length === 0 && !orphan && (
          <div className="px-3 py-2 text-xs text-slate-400">暂无选项</div>
        )}
      </SelectContent>
    </ShadcnSelect>
  );
}
