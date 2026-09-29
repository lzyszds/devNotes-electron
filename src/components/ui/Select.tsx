import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import Tooltip from "./Tooltip";
import { usePresence } from "../../hooks/usePresence";

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
   * 子选项。带子选项的项只当分类用，点它不会选中，而是在右侧弹出二级菜单
   * —— 平铺的小标题挡不住上百项的长清单（如系统音色按语种归类）。
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
   * 默认 md 与工具页表单一致。尺寸写在 button 上，不是根 div：
   * 根 div 只负责定位，传 className 到根上去改高度改不动触发器。
   */
  size?: "md" | "sm";
  /**
   * 展开方向。贴着容器下沿的控件（如卡片底栏）要用 up，
   * 否则下拉会被外层 overflow 裁掉。
   */
  placement?: "down" | "up";
}

const triggerBase =
  "inline-flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-slate-700 dark:text-slate-300 outline-none transition shrink-0 hover:border-slate-300 dark:hover:border-slate-600 focus:border-brand-400 dark:focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:opacity-50 disabled:pointer-events-none";

const triggerSizes = {
  md: "h-9 min-w-[88px] pl-3 pr-2 text-xs font-semibold",
  sm: "h-7 min-w-[76px] pl-2 pr-1.5 text-[11px] font-medium",
} as const;

/** 二级菜单与父项之间的水平间距 */
const SUBMENU_GAP = 4;
/** 二级菜单距视口边缘的最小留白 */
const VIEWPORT_PADDING = 8;
/** 父项与面板之间那道缝的悬停宽限：进出都立刻开关会闪 */
const SUBMENU_CLOSE_DELAY = 180;

/**
 * 二级菜单面板。
 *
 * 必须走 createPortal + fixed：外层列表是 max-h + overflow-y-auto 的滚动容器，
 * 面板留在里面会被它裁掉（往右、往下都越界）。代价是它不在 rootRef 里，
 * 点外关闭的判断得单独认一个 ref。
 */
function SubmenuPanel<T extends string | number>({
  anchor,
  items,
  value,
  onSelect,
  panelRef,
  onPointerEnter,
  onPointerLeave,
}: {
  anchor: DOMRect;
  items: SelectOption<T>[];
  value: T;
  onSelect: (option: SelectOption<T>) => void;
  panelRef: RefObject<HTMLUListElement>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const [style, setStyle] = useState<CSSProperties>({
    visibility: "hidden",
    left: 0,
    top: 0,
  });

  // 先藏着量尺寸，贴到视口右/下边缘时翻到左侧或往上收，别被裁掉
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const flip = anchor.right + SUBMENU_GAP + width > window.innerWidth - VIEWPORT_PADDING;

    setStyle({
      visibility: "visible",
      left: Math.max(
        VIEWPORT_PADDING,
        flip ? anchor.left - SUBMENU_GAP - width : anchor.right + SUBMENU_GAP,
      ),
      top: Math.max(
        VIEWPORT_PADDING,
        Math.min(anchor.top, window.innerHeight - VIEWPORT_PADDING - height),
      ),
    });
  }, [anchor, panelRef]);

  return createPortal(
    <ul
      ref={panelRef}
      role="listbox"
      style={style}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      // z 要高过设置弹窗那层（z-[60]），又低于 Tooltip（z-[90]）
      className="fe-pop fixed z-[70] max-h-72 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-dark-border dark:bg-dark-panel"
    >
      {items.length === 0 ? (
        <li className="px-3 py-2 text-xs text-slate-400">暂无选项</li>
      ) : (
        items.map((item) => {
          const isSelected = item.value === value;
          return (
            <li key={String(item.value)} role="option" aria-selected={isSelected}>
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => onSelect(item)}
                className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition ${
                  item.disabled
                    ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                    : isSelected
                      ? "bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 font-semibold"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover"
                }`}
              >
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          );
        })
      )}
    </ul>,
    document.body,
  );
}

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
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<{ anchor: DOMRect; option: SelectOption<T> } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** 主面板的 ref。它挂在 body 下（portal），不在 rootRef 里 —— 点外关闭得单独认它 */
  const menuRef = useRef<HTMLUListElement>(null);
  // 二级菜单走 portal，不在 rootRef 里，点外关闭要单独认它
  const submenuRef = useRef<HTMLUListElement>(null);
  const submenuTimer = useRef<number | null>(null);
  const listboxId = useId();
  // 与 CSS 里 .fe-pop[data-state='closed'] 的时长一致
  const { mounted, state } = usePresence(open, 130);

  // 带子选项的项自身不是候选值，触发器上显示的仍是子项的名字
  const selected =
    options.find((opt) => opt.value === value) ??
    options.flatMap((opt) => opt.children ?? []).find((opt) => opt.value === value);
  const displayLabel = selected?.label ?? placeholder;

  /*
   * 主面板的位置。
   *
   * 面板**不能**留在原地用 absolute：它是装在各种卡片、弹窗里的表单控件，
   * 而外层容器普遍带 overflow（滚动列表、max-h 弹窗），面板往下展开就会被裁掉一截
   * ——「选项显示不全」就是这么来的。placement="up" 只能躲开往下被裁，横向照样裁。
   *
   * 所以和二级菜单一样走 createPortal + fixed：挂到 body 下，任何祖先的 overflow
   * 都裁不到它。代价是坐标要自己算（fixed 是视口坐标），且滚动/resize 时得重算，
   * 否则面板会与触发器脱节。
   */
  /*
   * 面板位置。null 表示「还没量」—— 那时**不渲染面板**。
   *
   * 不能给个 {width: 0} 的初值就渲染：面板宽度取自触发器，而触发器要等 DOM 提交后
   * 才量得到，于是首帧会画出一个 0 宽的面板（只剩边框与内边距、中间是空的），
   * 看起来像「面板是透明的、底下的字透出来了」。等量到了再渲染，只多一帧、肉眼无感。
   */
  const [menuRect, setMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const syncMenuRect = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
  };

  const cancelSubmenuClose = () => {
    if (submenuTimer.current !== null) {
      window.clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
  };

  // 父项到面板之间有 4px 缝，鼠标穿过去会先离开父项，所以关闭要延迟一拍
  const scheduleSubmenuClose = () => {
    cancelSubmenuClose();
    submenuTimer.current = window.setTimeout(() => setSubmenu(null), SUBMENU_CLOSE_DELAY);
  };

  const closeAll = () => {
    setOpen(false);
    setSubmenu(null);
    // 位置作废：下次打开要按当时的触发器位置重新量（期间窗口可能被移动/缩放过）
    setMenuRect(null);
  };

  useEffect(() => cancelSubmenuClose, []);

  /*
   * 打开时量一次触发器的位置，之后滚动或窗口尺寸变化都要重量 ——
   * 面板挂在 body 下用 fixed，不会跟着触发器走，不重算就会脱节。
   *
   * 用捕获阶段监听 scroll：面板外层往往是某个滚动列表，而 scroll 不冒泡，
   * 在 document 上只有捕获才收得到内层容器的滚动。
   */
  useLayoutEffect(() => {
    if (!open) return;
    syncMenuRect();

    const onReflow = () => syncMenuRect();
    window.addEventListener("resize", onReflow);
    document.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      document.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // 三个地方都算「内部」：触发器、主面板、二级面板。后两者是 portal，
      // 挂在 body 下，不认它们的话点选项会被当成点外部、菜单先关掉
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        submenuRef.current?.contains(target)
      ) {
        return;
      }
      closeAll();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
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
    closeAll();
  };

  const openSubmenu = (option: SelectOption<T>, target: HTMLElement) => {
    cancelSubmenuClose();
    // 触发按钮铺满整行，它的 rect 就是 li 的 rect
    setSubmenu({ anchor: target.getBoundingClientRect(), option });
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* title 交给自绘 Tooltip，且只包在触发按钮上：挂到根 div 会把下方展开的选项列表也算进悬停区 */}
      <Tooltip content={title}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => !disabled && setOpen((v) => !v)}
          className={`${triggerBase} ${triggerSizes[size]} w-full ${open ? "border-brand-400 ring-2 ring-brand-500/10" : ""}`}
        >
          <span
            className={`truncate ${selected ? "text-slate-700 dark:text-slate-300" : "text-slate-400"}`}
          >
            {displayLabel}
          </span>
          <ChevronDown
            size={size === "sm" ? 12 : 14}
            className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </Tooltip>

      {/*
        面板挂到 body 下 —— 留在原地会被外层 overflow 裁掉（见 menuRect 的注释）。
        入口用 portal，所以这里显式判 mounted：收起动画结束后才真正卸载。
      */}
      {mounted &&
        menuRect &&
        createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            data-state={state}
            className="fe-pop fixed z-[70] max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-dark-border dark:bg-dark-panel"
            style={{
              /*
               * fixed 用视口坐标。纵向按 placement 翻：默认贴在触发器下沿，
               * 下方空间不够（面板顶到视口底）就翻到上方 —— 这比原来靠调用方
               * 手动传 placement="up" 稳，不用每处调用自己知道自己在不在容器底部。
               */
              top: placement === "up" ? undefined : menuRect.top + menuRect.height + 4,
              bottom:
                placement === "up"
                  ? window.innerHeight - menuRect.top + 4
                  : undefined,
              left: menuRect.left,
              width: menuRect.width,
              ...(menuMinWidth ? { minWidth: menuMinWidth } : {}),
            }}
          // 列表一滚，子面板记的坐标就不作数了
          onScroll={() => setSubmenu(null)}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">暂无选项</li>
          ) : (
            options.map((opt, index) => {
              const hasChildren = Boolean(opt.children?.length);
              // 父项的选中态跟着子项走：用户挑的是音色，语言只是入口
              const activeChild = opt.children?.find((child) => child.value === value);
              const isSelected = hasChildren ? Boolean(activeChild) : opt.value === value;
              const isExpanded = submenu?.option === opt;
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
                      // 悬停就展开，触屏上 mouseenter 不可靠，点击同样能开
                      onMouseEnter={(e) => hasChildren && openSubmenu(opt, e.currentTarget)}
                      onClick={(e) =>
                        hasChildren ? openSubmenu(opt, e.currentTarget) : handleSelect(opt)
                      }
                      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition ${
                        opt.disabled
                          ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                          : isSelected
                            ? "bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 font-semibold"
                            : isExpanded
                              ? "bg-slate-50 dark:bg-dark-hover text-slate-700 dark:text-slate-300"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover"
                      }`}
                    >
                      <span className="flex-1 truncate">{opt.label}</span>
                      {/* 父项右侧挂上当前选中的子项，收起状态下也知道选的是哪个 */}
                      {activeChild && (
                        <span className="max-w-[45%] truncate text-[10px] font-normal text-slate-400 dark:text-slate-500">
                          {activeChild.label}
                        </span>
                      )}
                      {hasChildren && (
                        <ChevronRight size={12} className="shrink-0 text-slate-400" />
                      )}
                    </button>
                  </li>
                </Fragment>
              );
            })
          )}
          </ul>,
          document.body
        )}

      {submenu && (
        <SubmenuPanel
          anchor={submenu.anchor}
          items={submenu.option.children ?? []}
          value={value}
          onSelect={handleSelect}
          panelRef={submenuRef}
          onPointerEnter={cancelSubmenuClose}
          onPointerLeave={scheduleSubmenuClose}
        />
      )}
    </div>
  );
}
