import { useEffect, useRef, useState } from "react";
import { Search, BarChart3, X, Minus, FolderOpen, Copy, ChevronLeft } from "lucide-react";
import { tools, toolCategories } from "../types";
import { useContextMenu } from "../components/ui/ContextMenu";
import { useToast } from "../components/ui/Toast";
import Tooltip from "../components/ui/Tooltip";
import ToolIcon from "../components/ui/ToolIcon";
import { copyText } from "../utils/clipboard";
import logo from "../assets/logo.png";

interface HomeProps {
  onOpenTool: (id: string) => void;
  onOpenStats: () => void;
  onBack: () => void;
  usageStats: Record<string, number>;
}

export default function Home({
  onOpenTool,
  onOpenStats,
  onBack,
  usageStats,
}: HomeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  /** 键盘选中的第几项（-1 = 没在键盘导航）。鼠标一动就清掉，免得两套高亮打架 */
  const [cursor, setCursor] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  const { openContextMenu } = useContextMenu();
  const { showToast } = useToast();

  // 复制并给出轻量提示:提示为 fixed 浮层,不参与布局
  const copyWithToast = async (text: string, label = "已复制") => {
    if (!text) {
      showToast("没有可复制的内容", "error");
      return;
    }
    const ok = await copyText(text);
    showToast(ok ? label : "复制失败", ok ? "default" : "error");
  };

  const filteredTools = tools.filter((tool) => {
    const matchesSearch =
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      activeCategory === "all" || tool.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // 筛选结果一变，之前选中的第几项就不作数了
  useEffect(() => {
    setCursor(-1);
  }, [searchQuery, activeCategory]);

  /**
   * 工具中心的键盘流。
   *
   * ⌘K 从页面任意位置把焦点抓回搜索框（这是 macOS 上「找东西」的本能按键，
   * 也是打开这个页面的第一动作）；上下键在结果之间移动，回车打开选中的那个，
   * Esc 先清空搜索、已经是空的就交给浏览器/上层处理。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filteredTools.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // 从「没选中」往下按落到第一项，往上按落到最后一项（环形）
      setCursor((prev) => {
        const next = prev < 0 ? (step > 0 ? 0 : filteredTools.length - 1) : prev + step;
        return (next + filteredTools.length) % filteredTools.length;
      });
      return;
    }

    if (event.key === 'Enter') {
      // 有键盘选中项就开它，否则开当前筛选出的第一个 —— 「搜完直接回车」是最顺手的路径
      const target = filteredTools[cursor >= 0 ? cursor : 0];
      if (target) {
        event.preventDefault();
        onOpenTool(target.id);
      }
      return;
    }

    if (event.key === 'Escape' && searchQuery) {
      event.preventDefault();
      setSearchQuery('');
    }
  };

  return (
    <div className="app-scene h-screen flex flex-col bg-white dark:bg-dark-bg overflow-hidden text-slate-900 dark:text-slate-100 transition-colors">
      {/* 移动端顶栏：桌面端那条是叠加层、只有窗口按钮，手机上换成能回工作台的导航条 */}
      <header className="md:hidden flex-shrink-0 h-11 px-3 flex items-center justify-between border-b border-slate-100 dark:border-dark-border bg-white dark:bg-dark-panel">
        <button
          onClick={onBack}
          className="-ml-1.5 flex items-center gap-0.5 rounded-lg p-1.5 text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-dark-hover"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-xs font-medium">返回</span>
        </button>
        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">工具中心</span>
        <button
          onClick={onOpenStats}
          title="使用统计"
          className="rounded-lg p-1.5 text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-dark-hover"
        >
          <BarChart3 className="w-4 h-4" />
        </button>
      </header>

      {/* Discreet Window Controls (Overlay) */}
      <div
        onDoubleClick={(event) => {
          // 无边框窗口没有系统标题栏，双击标题栏最大化这条系统行为得自己补回来
          if ((event.target as HTMLElement).closest('.no-drag')) return
          window.electronAPI?.maximizeWindow()
        }}
        className="drag-region absolute top-0 left-0 right-0 h-11 hidden md:flex justify-between items-center px-4 z-50"
      >
        <div className="no-drag flex items-center gap-1.5">
          <div
            onClick={() => window.electronAPI?.closeWindow()}
            className="w-3 h-3 rounded-full bg-rose-500/80 hover:brightness-110 cursor-pointer"
          />
          <div
            onClick={() => window.electronAPI?.minimizeWindow()}
            className="w-3 h-3 rounded-full bg-amber-500/80 hover:brightness-110 cursor-pointer"
          />
          <div
            onClick={() => window.electronAPI?.maximizeWindow()}
            className="w-3 h-3 rounded-full bg-emerald-500/80 hover:brightness-110 cursor-pointer"
          />
        </div>
        <div className="no-drag flex items-center gap-1">
          <Tooltip content="最小化窗口">
            <button
              onClick={() => window.electronAPI?.minimizeWindow()}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-400 transition"
            >
              <Minus size={14} />
            </button>
          </Tooltip>
          <Tooltip content="关闭窗口">
            <button
              onClick={() => window.electronAPI?.closeWindow()}
              className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-500 text-slate-400 transition"
            >
              <X size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-4 pb-16 md:px-10 md:pb-20">
        <div className="max-w-4xl mx-auto pt-4 md:pt-16">
          {/* Header */}
          <div className="text-center mb-2">
            {/* 首屏是唯一的品牌露出位：logo 外面罩一层 logo 青蓝的光晕，
                与主色 indigo 拉开层次，也点明 #50BDCF 这个来源色 */}
            <img
              src={logo}
              alt="devNotes"
              className="inline-block h-10 w-10 md:h-12 md:w-12 object-contain mb-4 md:mb-6 drop-shadow-[0_0_22px_rgba(80,189,207,0.45)]"
            />
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">
              devNotes 工具中心
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">
              极致简洁的现代前端开发者工作台
            </p>
          </div>

          {/* Search */}
          <div className="relative mb-10 max-w-xl mx-auto">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              size={18}
            />
            <input
              ref={searchRef}
              type="text"
              placeholder="搜索小工具 (支持拼音或描述)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              className="w-full h-12 pl-12 pr-20 bg-slate-50 dark:bg-dark-panel rounded-xl border border-slate-200/80 dark:border-dark-border text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-brand-500 transition-all text-sm outline-none shadow-2xs placeholder-slate-400"
            />
            {/* 快捷键提示：一开始就把「这里能用键盘」告诉用户，而不是等他自己发现 */}
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 rounded-md border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              ⌘K
            </kbd>
          </div>

          {/* Categories Bar */}
          <div className="flex items-center justify-between gap-3 mb-6 md:mb-8 border-b border-slate-100 dark:border-dark-border pb-4">
            <div className="flex min-w-0 gap-1 overflow-x-auto scrollbar-hide">
              {toolCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex-shrink-0 whitespace-nowrap px-3.5 py-1 rounded-full text-xs font-semibold transition-all ${
                    activeCategory === cat.id
                      ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-2xs"
                      : "text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            <button
              onClick={onOpenStats}
              className="hidden md:flex flex-shrink-0 items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-50 dark:bg-dark-hover text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-border transition text-xs font-semibold"
            >
              <BarChart3 size={14} />
              统计面板
            </button>
          </div>

          {/* Compact Grid of Small Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
            {filteredTools.map((tool, index) => (
              <button
                key={tool.id}
                onClick={() => onOpenTool(tool.id)}
                onContextMenu={(e) =>
                  openContextMenu(e, [
                    {
                      id: "card-open",
                      label: "打开",
                      icon: <FolderOpen className="w-3.5 h-3.5" />,
                      onSelect: () => onOpenTool(tool.id),
                    },
                    { id: "card-sep", separator: true },
                    {
                      id: "card-copy-name",
                      label: "复制名称",
                      icon: <Copy className="w-3.5 h-3.5" />,
                      onSelect: () => void copyWithToast(tool.name, "已复制名称"),
                    },
                    {
                      id: "card-copy-desc",
                      label: "复制描述",
                      icon: <Copy className="w-3.5 h-3.5" />,
                      disabled: !tool.description,
                      onSelect: () => void copyWithToast(tool.description, "已复制描述"),
                    },
                    {
                      id: "card-copy-id",
                      label: "复制 ID",
                      icon: <Copy className="w-3.5 h-3.5" />,
                      onSelect: () => void copyWithToast(tool.id, "已复制 ID"),
                    },
                  ])
                }
                onMouseEnter={() => setCursor(-1)}
                data-cursor={index === cursor || undefined}
                className="motion-lift group flex flex-col items-center justify-center p-3 md:p-5 rounded-2xl bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border hover:border-brand-500 dark:hover:border-brand-500 hover:shadow-lg transition-all data-[cursor]:border-brand-500 data-[cursor]:-translate-y-0.5 data-[cursor]:shadow-lg"
              >
                {/* 悬停/键盘选中时图标块抬起并染色，标题同步加深 —— 整张卡片是一个整体在响应，
                    而不是只有边框变个色 */}
                <div className="h-9 w-9 md:h-10 md:w-10 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-dark-sidebar mb-2 md:mb-3 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:bg-brand-600 group-hover:-translate-y-0.5 group-data-[cursor]:bg-brand-600 group-data-[cursor]:-translate-y-0.5">
                  <ToolIcon toolId={tool.id} className="w-5 h-5 text-slate-700 dark:text-slate-200 group-hover:text-white group-data-[cursor]:text-white transition-colors" />
                </div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 text-center truncate w-full transition-colors">
                  {tool.name}
                </span>
                {usageStats[tool.id] > 0 && (
                  <span className="mt-1 text-[10px] text-slate-400 font-mono">
                    已用 {usageStats[tool.id]} 次
                  </span>
                )}
              </button>
            ))}
          </div>

          {filteredTools.length === 0 && (
            <div className="py-20 text-center text-slate-300 italic">
              <p className="text-sm">未找到相关工具</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
