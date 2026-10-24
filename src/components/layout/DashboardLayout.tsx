import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  PanelLeft,
  FolderTree,
  Search,
  BarChart3,
  Pencil,
  Settings,
  Cloud,
  Boxes,
} from "lucide-react";
import {
  allModules,
  tools,
  toolCategories,
} from "../../types";
import NotesSidebar from "../modules/markdown-notes/NotesSidebar";
import SnippetsSidebar from "../modules/snippets/SnippetsSidebar";
import ToolPage from "../../pages/ToolPage";
import { useNotes } from "../../context/NotesContext";
import SettingsModal, { type SettingsSection } from "../modals/SettingsModal";
import Tooltip from "../ui/Tooltip";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useShortcutSettings } from "../../hooks/useShortcutSettings";
import {
  eventToAccelerator,
  isRecordingShortcut,
} from "../../utils/shortcutSettings";
import { subscribeAppSettings } from "../../utils/settingsBus";

import WindowControls from "./WindowControls";
import ToolIcon from "../ui/ToolIcon";

/** 2字短标签映射 */
function getToolShortLabel(toolId: string): string {
  const map: Record<string, string> = {
    "markdown-notes": "笔记",
    snippets: "代码",
    "text-translate": "翻译",
    "json-format": "JSON",
    "json-diff": "比对",
    "json-i18n": "多语",
    base64: "编码",
    url: "链接",
    websocket: "WS",
    "qr-code": "扫码",
    "lan-transfer": "互传",
    "image-convert": "图片",
    "en-decode": "转码",
    timestamp: "时间",
    regexp: "正则",
    password: "密码",
    bitwise: "进制",
    "port-killer": "端口",
    "file-hash": "哈希",
    "data-convert": "互转",
    "net-probe": "网络",
    scratchpad: "草稿",
    signature: "签名",
  };
  return map[toolId] || "工具";
}

interface PillToolTabItemProps {
  toolId: string;
  toolName: string;
  isTabActive: boolean;
  canClose: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/** 胶囊 Tab 项：普通点击切换，长按 650ms 蓄力通过底部小进度条关闭标签 */
const LONG_PRESS_DURATION = 650;

function PillToolTabItem({
  toolId,
  toolName,
  isTabActive,
  canClose,
  onSelect,
  onClose,
}: PillToolTabItemProps) {
  const [isPressing, setIsPressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const isLongPressedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPressing(false);
    setProgress(0);
  }, []);

  const startPress = (e: React.SyntheticEvent) => {
    // 鼠标事件仅响应左键
    if ("button" in e && (e as React.MouseEvent).button !== 0) return;
    isLongPressedRef.current = false;

    if (!canClose) return;

    setIsPressing(true);
    startTimeRef.current = Date.now();

    const update = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(100, (elapsed / LONG_PRESS_DURATION) * 100);
      setProgress(pct);
      if (pct < 100) {
        animFrameRef.current = requestAnimationFrame(update);
      }
    };
    animFrameRef.current = requestAnimationFrame(update);

    pressTimerRef.current = setTimeout(() => {
      isLongPressedRef.current = true;
      cleanup();
      onClose();
    }, LONG_PRESS_DURATION);
  };

  const endPress = () => {
    if (isLongPressedRef.current) {
      // 已触发长按关闭，阻止触发普通点击
      cleanup();
      return;
    }
    cleanup();
    onSelect();
  };

  const cancelPress = () => {
    cleanup();
  };

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return (
    <div className="relative group/tab flex items-center justify-center flex-shrink-0">
      <Tooltip
        placement="right"
        content={canClose ? `${toolName}（长按关闭）` : toolName}
      >
        <button
          type="button"
          onMouseDown={startPress}
          onMouseUp={endPress}
          onMouseLeave={cancelPress}
          onTouchStart={startPress}
          onTouchEnd={endPress}
          onTouchCancel={cancelPress}
          className={`relative w-8 h-8 rounded-xl flex flex-col items-center justify-center transition-all duration-200 cursor-pointer transform group-hover/tab:scale-105 active:scale-95 ${isTabActive
            ? "bg-white text-[#191918] shadow-[0_2px_6px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.08] font-bold"
            : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.04]"
            }`}
        >
          <ToolIcon
            toolId={toolId}
            className={`w-4 h-4 transition-transform duration-150 ${isPressing ? "scale-90" : ""
              }`}
          />

          {/* icon 下方的小进度条（标签数量 > 1 时可见并蓄力） */}
          {canClose && (
            <div
              className={`absolute bottom-1 w-3.5 h-[2px] rounded-full overflow-hidden pointer-events-none transition-all duration-150 ${isPressing
                ? "bg-black/15 opacity-100 scale-100"
                : "bg-black/10 opacity-0 group-hover/tab:opacity-40 scale-90"
                }`}
            >
              <div
                className="h-full bg-rose-500 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </button>
      </Tooltip>
    </div>
  );
}

interface DashboardLayoutProps {
  activeTabId: string;
  onOpenTool: (id: string) => void;
  onOpenStats: () => void;
}

export default function DashboardLayout({
  activeTabId,
  onOpenTool,
  onOpenStats,
}: DashboardLayoutProps) {
  const isMobile = useIsMobile();

  // 侧边栏折叠控制（控制列表栏）
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobile);
  // 二级目录栏扩展控制（类似 Notion / Obsidian 目录树按需展开，默认收起呈现精炼三栏）
  const [isFolderTreeOpen, setIsFolderTreeOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("devnotes-foldertree-open") === "true";
    } catch {
      return false;
    }
  });

  const toggleFolderTree = () => {
    setIsFolderTreeOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("devnotes-foldertree-open", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };


  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  const openSettings = (section: SettingsSection = "general") => {
    setSettingsSection(section);
    setIsSettingsOpen(true);
  };

  useEffect(() => {
    return subscribeAppSettings((topic) => {
      openSettings(topic);
    });
  }, []);

  const {
    activeNote,
    handleRename: handleRenameNote,
    folders,
    scope,
  } = useNotes();

  // 就地重命名文档标题
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const handleTitleCommit = () => {
    setIsEditingTitle(false);
    const trimmed = tempTitle.trim();
    if (activeNote && trimmed && trimmed !== activeNote.title) {
      handleRenameNote(activeNote.id, trimmed);
    }
  };

  const currentTool = useMemo(
    () => allModules.find((item) => item.id === activeTabId),
    [activeTabId]
  );
  const isMarkdownActive = activeTabId === "markdown-notes";
  const isSnippetsActive = activeTabId === "snippets";
  const isTranslateActive = activeTabId === "text-translate";
  // 工具集合：当 activeTabId 不是三大独立模块时，即属于小工具集合
  const isToolCollectionActive =
    !isMarkdownActive && !isSnippetsActive && !isTranslateActive;

  // 翻译页面不提供二级侧边栏，进入时默认强制关闭侧边栏
  useEffect(() => {
    if (isTranslateActive) {
      setIsSidebarOpen(false);
    }
  }, [isTranslateActive]);

  // 胶囊 Tab 内已打开的工具标签页列表（持久化到本地）
  const [openedToolTabs, setOpenedToolTabs] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("devnotes-opened-tool-tabs");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter((id) => tools.some((t) => t.id === id));
          if (valid.length > 0) return valid;
        }
      }
    } catch {
      // ignore
    }
    return ["json-format"];
  });

  // 记录上次在工具集里查看的小工具，方便切回时无缝恢复
  const [lastActiveToolId, setLastActiveToolId] = useState<string>(() => {
    try {
      return localStorage.getItem("devnotes-last-tool-id") || "json-format";
    } catch {
      return "json-format";
    }
  });

  // 当当前激活项属于普通工具时，自动加入胶囊 Tab 中并记住最近访问项
  useEffect(() => {
    const isOrdinaryTool = tools.some((t) => t.id === activeTabId);
    if (isOrdinaryTool) {
      setLastActiveToolId(activeTabId);
      try {
        localStorage.setItem("devnotes-last-tool-id", activeTabId);
      } catch {
        // ignore
      }

      setOpenedToolTabs((prev) => {
        if (prev.includes(activeTabId)) return prev;
        const next = [...prev, activeTabId];
        try {
          localStorage.setItem("devnotes-opened-tool-tabs", JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
  }, [activeTabId]);

  // 关闭胶囊中的某个工具 Tab
  const handleCloseToolTab = (targetToolId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenedToolTabs((prev) => {
      const next = prev.filter((id) => id !== targetToolId);
      if (activeTabId === targetToolId) {
        if (next.length > 0) {
          onOpenTool(next[0]);
        } else {
          // 保底保留一个工具
          next.push("json-format");
          onOpenTool("json-format");
        }
      }
      try {
        localStorage.setItem("devnotes-opened-tool-tabs", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // 点击工具集合主项
  const handleOpenToolCollection = () => {
    if (isToolCollectionActive) {
      // 已在工具集合模式，切换二级侧栏展开/收起
      setIsSidebarOpen((prev) => !prev);
      return;
    }
    // 从其他独立模块切入工具集合，优先恢复最近活跃的工具
    const target =
      lastActiveToolId && tools.some((t) => t.id === lastActiveToolId)
        ? lastActiveToolId
        : openedToolTabs[0] || "json-format";
    onOpenTool(target);
    setIsSidebarOpen(true);
  };

  // 普通小工具分类筛选与搜索
  const [toolCategory, setToolCategory] = useState<string>("all");
  const [toolSearch, setToolSearch] = useState<string>("");

  const filteredToolList = useMemo(() => {
    return tools.filter((t) => {
      const matchCat =
        toolCategory === "all" || t.category === toolCategory;
      const matchSearch =
        !toolSearch.trim() ||
        t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
        t.description.toLowerCase().includes(toolSearch.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [toolCategory, toolSearch]);

  // 快捷键映射
  const shortcutMap = useShortcutSettings();

  // 全局命令面板 (⌘K)
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");
  const cmdInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCmdOpen) {
      setTimeout(() => cmdInputRef.current?.focus(), 50);
    }
  }, [isCmdOpen]);

  const cmdFilteredTools = useMemo(() => {
    const q = cmdSearch.trim().toLowerCase();
    if (!q) return allModules.slice(0, 8);
    return allModules.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
    );
  }, [cmdSearch]);

  // 键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRecordingShortcut()) return;
      const keyCombo = eventToAccelerator(e);

      // ⌘K 全局搜索
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setIsCmdOpen((prev) => !prev);
        return;
      }

      // ⌘B 折叠侧栏
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "b" &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        // 翻译页面锁死不允许展开
        if (isTranslateActive) return;
        setIsSidebarOpen((prev) => !prev);
        return;
      }

      // ⌥⌘D 展开/收起二级目录
      if (
        (e.metaKey || e.ctrlKey) &&
        e.altKey &&
        e.key.toLowerCase() === "d"
      ) {
        e.preventDefault();
        // 翻译页面锁死不允许展开
        if (isTranslateActive) return;
        toggleFolderTree();
        return;
      }

      // ⌘, 设置
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "," &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        openSettings("general");
        return;
      }

      // 用户自定义工具快捷键
      for (const [toolId, shortcut] of Object.entries(shortcutMap)) {
        if (shortcut && keyCombo === shortcut) {
          e.preventDefault();
          onOpenTool(toolId);
          if (toolId === "text-translate") {
            setIsSidebarOpen(false);
          } else {
            setIsSidebarOpen(true);
          }
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutMap, onOpenTool, isTranslateActive]);

  // 面包屑当前分类名称
  const currentCategoryName = useMemo(() => {
    if (isMarkdownActive) {
      if (scope.type === "trash") return "回收站";
      if (scope.type === "bookmarks") return "收藏标星";
      if (scope.type === "folder" && scope.folderId) {
        const found = folders.find((f) => f.id === scope.folderId);
        return found ? found.name : "文件夹";
      }
      return "全部文档";
    }
    if (isSnippetsActive) return "代码片段";
    if (isTranslateActive) return "文本翻译";
    return currentTool?.name || "工具箱";
  }, [isMarkdownActive, isSnippetsActive, isTranslateActive, scope, folders, currentTool]);

  // 计算侧边栏动态总宽度（默认三栏时为 288px，展开目录树时为 208 + 288 = 496px；翻译页面锁死为 0）
  const sidebarWidth = useMemo(() => {
    /* 翻译页面无需二级侧边栏，强制锁死为 0，防止撑开空白区域 */
    if (isTranslateActive) return 0;
    if (!isSidebarOpen) return 0;
    if (isMobile) return "100%";
    return isFolderTreeOpen ? 496 : 288;
  }, [isTranslateActive, isSidebarOpen, isMobile, isFolderTreeOpen]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#FFFFFF] text-[#191918] font-sans flex flex-col antialiased select-none">
      {/* ================= 整合的原生 Titlebar (h-11 = 44px) ================= */}
      <header className="h-11 bg-[#F3F3F1] px-3 flex items-center justify-between flex-shrink-0 z-30 drag-region select-none">
        {/* 左侧：macOS 红绿灯 + 侧栏折叠 + 二级目录展开 + 面包屑 */}
        <div className="no-drag flex items-center gap-2 min-w-0">
          <div className="flex items-center pl-1 pr-2">
            <WindowControls />
          </div>
          <div className="h-3.5 w-px bg-black/[0.08] mx-1" />

          {/* 侧边栏折叠按钮 (⌘B) */}
          <button
            type="button"
            disabled={isTranslateActive}
            onClick={() => {
              if (isTranslateActive) return;
              setIsSidebarOpen((prev) => !prev);
            }}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${isTranslateActive
              ? "text-black/20 cursor-not-allowed"
              : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.04] cursor-pointer"
              }`}
            title={
              isTranslateActive
                ? "翻译页面无需侧边栏"
                : isSidebarOpen
                  ? "收起侧边栏 (⌘B)"
                  : "展开侧边栏 (⌘B)"
            }
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>

          {/* 二级目录扩展按钮 (⌥⌘D) */}
          <button
            type="button"
            disabled={isTranslateActive}
            onClick={() => {
              if (isTranslateActive) return;
              toggleFolderTree();
            }}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${isTranslateActive
              ? "text-black/20 cursor-not-allowed"
              : isFolderTreeOpen
                ? "bg-black/[0.06] text-[#191918] cursor-pointer"
                : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.04] cursor-pointer"
              }`}
            title={
              isTranslateActive
                ? "翻译页面无目录树"
                : isFolderTreeOpen
                  ? "收起二级目录 (⌥⌘D)"
                  : "展开二级目录 (⌥⌘D)"
            }
          >
            <FolderTree className="w-3.5 h-3.5" />
          </button>

          {/* 面包屑导航与就地重命名 */}
          <div className="flex items-center gap-1.5 text-xs text-[#787774] ml-2 min-w-0 truncate">
            <span>{isMarkdownActive ? "知识库" : isSnippetsActive ? "片段库" : isTranslateActive ? "翻译中心" : "工具箱"}</span>
            <span>/</span>
            <span className="text-[#191918] font-medium">{currentCategoryName}</span>
            {isMarkdownActive && activeNote && (
              <>
                <span>/</span>
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleTitleCommit();
                      if (e.key === "Escape") setIsEditingTitle(false);
                    }}
                    onBlur={handleTitleCommit}
                    className="h-6 px-1.5 text-xs font-semibold rounded bg-white border border-[#1C1C1C] outline-none text-[#191918] min-w-[120px]"
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTempTitle(activeNote.title || "");
                      setIsEditingTitle(true);
                    }}
                    className="text-[#191918] font-bold truncate max-w-[200px] hover:underline flex items-center gap-1 cursor-pointer"
                    title="双击或点击重命名"
                  >
                    <span className="truncate">{activeNote.title || "未命名笔记"}</span>
                    <Pencil className="w-2.5 h-2.5 text-[#787774]" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* 右侧：集成全局搜索框 (⌘K) 与快捷操作 */}
        <div className="no-drag flex items-center gap-2 flex-shrink-0">
          {/* 原生桌面级全局搜索框 */}
          <button
            type="button"
            onClick={() => setIsCmdOpen(true)}
            className="flex items-center gap-2 h-7 px-2.5 text-xs bg-black/[0.035] hover:bg-black/[0.05] text-[#787774] hover:text-[#191918] rounded-md transition-colors cursor-pointer"
            title="全局命令搜索 (⌘K)"
          >
            <Search className="w-3 h-3" />
            <span className="hidden sm:inline">搜索...</span>
            <kbd className="text-[10px] bg-white border border-black/[0.08] rounded px-1 py-0.5 text-[#787774] font-mono leading-none">
              ⌘K
            </kbd>
          </button>


        </div>
      </header>

      {/* ================= 下方主体：左侧窄导航 + 侧边栏 + 主画布 ================= */}
      <div className="flex-1 flex flex-row overflow-hidden min-h-0 bg-[#F3F3F1] ">
        {/* ================= 1. 第 1 栏：最左侧窄导航 (w-16 = 64px) ================= */}
        <aside className="w-16 flex flex-col items-center py-2.5 justify-between flex-shrink-0 z-30 select-none">
          {/* 顶层四大核心入口：笔记、翻译、代码、工具（带延伸胶囊 Tab） */}
          <nav className="flex-1 w-full px-1 flex flex-col gap-1 overflow-y-auto no-scrollbar">
            {/* 1. 笔记 */}
            <Tooltip placement="right" content="Markdown 笔记">
              <button
                type="button"
                onClick={() => {
                  if (isMarkdownActive) {
                    setIsSidebarOpen((prev) => !prev);
                    return;
                  }
                  onOpenTool("markdown-notes");
                  setIsSidebarOpen(true);
                }}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${isMarkdownActive
                  ? "text-[#1C1C1C] font-semibold bg-black/[0.05]"
                  : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                  }`}
              >
                {isMarkdownActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <ToolIcon toolId="markdown-notes" className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">笔记</span>
              </button>
            </Tooltip>

            {/* 2. 翻译 */}
            <Tooltip placement="right" content="文本翻译">
              <button
                type="button"
                onClick={() => {
                  onOpenTool("text-translate");
                  setIsSidebarOpen(false);
                }}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${isTranslateActive
                  ? "text-[#1C1C1C] font-semibold bg-black/[0.05]"
                  : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                  }`}
              >
                {isTranslateActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <ToolIcon toolId="text-translate" className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">翻译</span>
              </button>
            </Tooltip>

            {/* 3. 代码 */}
            <Tooltip placement="right" content="代码片段库">
              <button
                type="button"
                onClick={() => {
                  if (isSnippetsActive) {
                    setIsSidebarOpen((prev) => !prev);
                    return;
                  }
                  onOpenTool("snippets");
                  setIsSidebarOpen(true);
                }}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${isSnippetsActive
                  ? "text-[#1C1C1C] font-semibold bg-black/[0.05]"
                  : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                  }`}
              >
                {isSnippetsActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <ToolIcon toolId="snippets" className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">代码</span>
              </button>
            </Tooltip>

            {/* 4. 工具集合 + 延伸胶囊 Tab */}
            <div className={`relative flex flex-col items-center w-full rounded-xl ${isToolCollectionActive ? "bg-black/[0.05]" : ""}`}>
              <Tooltip placement="right" content="常用工具箱">
                <button
                  type="button"
                  onClick={handleOpenToolCollection}
                  className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${isToolCollectionActive

                    }`}
                >
                  {isToolCollectionActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                  )}
                  <Boxes className="w-5 h-5 mb-1" />
                  <span className="text-[10px] leading-none tracking-tight">工具</span>
                </button>
              </Tooltip>

              {/* 延伸展开的胶囊 Tab（Pill Sub-tabs） */}
              <div
                className={`w-full flex flex-col items-center transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isToolCollectionActive
                  ? "max-h-[360px] opacity-100 mt-1 translate-y-0"
                  : "max-h-0 opacity-0 mt-0 -translate-y-2 pointer-events-none overflow-hidden"
                  }`}
              >

                {/* 胶囊容器本体 */}
                <div className="w-12 max-h-[200px] overflow-y-auto no-scrollbar py-1.5 px-0.5 rounded-full flex flex-col items-center gap-1">
                  {openedToolTabs.map((toolId) => {
                    const meta = tools.find((t) => t.id === toolId);
                    const isTabActive = activeTabId === toolId;
                    const toolName = meta?.name || getToolShortLabel(toolId);

                    return (
                      <PillToolTabItem
                        key={toolId}
                        toolId={toolId}
                        toolName={toolName}
                        isTabActive={isTabActive}
                        canClose={openedToolTabs.length > 1}
                        onSelect={() => {
                          if (
                            toolId === "scratchpad" &&
                            window.electronAPI?.scratchOpen
                          ) {
                            void window.electronAPI.scratchOpen();
                            return;
                          }
                          onOpenTool(toolId);
                          setIsSidebarOpen(true);
                        }}
                        onClose={() => handleCloseToolTab(toolId)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </nav>

          {/* 底部：云同步 / 统计 / 设置 / 圆形黑底头像 */}
          <div className="flex flex-col items-center gap-2 w-full px-2 pt-2 ">
            {/* 云同步 */}
            <Tooltip placement="right" content="云端同步设置">
              <button
                type="button"
                onClick={() => openSettings("cloud-sync")}
                className="relative w-8 h-8 flex items-center justify-center rounded-lg text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7] transition-all cursor-pointer"
              >
                <Cloud className="w-4 h-4" />
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
              </button>
            </Tooltip>

            {/* 使用统计 */}
            <Tooltip placement="right" content="使用统计">
              <button
                type="button"
                onClick={onOpenStats}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7] transition-all cursor-pointer"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </Tooltip>

            {/* 全局设置 */}
            <Tooltip placement="right" content="系统设置 (⌘,)">
              <button
                type="button"
                onClick={() => openSettings("general")}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7] transition-all cursor-pointer"
              >
                <Settings className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </aside>

        <div className="rounded-2xl m-2 mt-0 w-full flex flex-row overflow-hidden">
          {/* ================= 2. 侧边栏容器（默认精炼三栏 w-72，按需展开二级目录树 w-52+w-72；翻译页面锁死隐藏） ================= */}
          <div
            style={{ width: sidebarWidth }}
            className={`flex-shrink-0 flex flex-row overflow-hidden transition-[width] duration-200 z-20 ${isSidebarOpen && !isTranslateActive ? "opacity-100" : "w-0 opacity-0 border-r-0"
              }`}
          >
            {/* 笔记侧栏保活：切走工具时不卸载组件，切回笔记即刻呈现，告别重新加载与初始化延迟 */}
            <div
              className="h-full flex flex-row overflow-hidden"
              style={{ display: isMarkdownActive ? 'flex' : 'none', width: sidebarWidth }}
            >
              <NotesSidebar
                onCollapse={() => setIsSidebarOpen(false)}
                isFolderTreeOpen={isFolderTreeOpen}
                onToggleFolderTree={toggleFolderTree}
              />
            </div>

            {/* 代码片段侧栏保活 */}
            <div
              className="h-full flex flex-row overflow-hidden"
              style={{ display: isSnippetsActive ? 'flex' : 'none', width: sidebarWidth }}
            >
              <SnippetsSidebar
                onCollapse={() => setIsSidebarOpen(false)}
                isFolderTreeOpen={isFolderTreeOpen}
                onToggleFolderTree={toggleFolderTree}
              />
            </div>

            {/* 常规工具箱视图：只在工具集合激活时渲染与展示 */}
            <div
              className="h-full flex flex-row overflow-hidden"
              style={{ display: isToolCollectionActive ? 'flex' : 'none', width: sidebarWidth }}
            >
              <div className="flex flex-row h-full w-full select-none overflow-hidden">
                {/* 二级工具分类栏 (按需展开 w-52) */}
                <aside
                  style={{ width: isFolderTreeOpen ? 208 : 0 }}
                  className={`bg-[#F3F3F1] border-r border-black/[0.06] flex flex-col h-full flex-shrink-0 transition-[width] duration-200 overflow-hidden ${isFolderTreeOpen ? "opacity-100" : "w-0 opacity-0 border-r-0"
                    }`}
                >
                  <div className="h-11 px-3 flex items-center justify-between flex-shrink-0">
                    <span className="font-bold text-xs text-[#191918] tracking-tight">
                      工具分类
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                    {toolCategories.map((cat) => {
                      const isSelected = toolCategory === cat.id;
                      const initialBadge = cat.name.slice(0, 1) || "全";
                      const count =
                        cat.id === "all"
                          ? tools.length
                          : tools.filter((t) => t.category === cat.id).length;

                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setToolCategory(cat.id)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 transition-all text-xs font-medium cursor-pointer rounded-md ${isSelected
                            ? "bg-black/[0.06] text-[#191918] font-bold"
                            : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                            }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${isSelected
                                ? "bg-[#1C1C1C] text-white"
                                : "bg-black/[0.06] text-[#191918]"
                                }`}
                            >
                              {initialBadge}
                            </span>
                            <span className="truncate">{cat.name}</span>
                          </div>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full text-[#787774]">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                {/* 工具记录列表栏 (w-72 = 288px) */}
                <section className="w-72 bg-[#F9F9F8] flex flex-col h-full flex-shrink-0">
                  <div className="h-11 px-2.5 flex items-center gap-1.5 flex-shrink-0">

                    <div className="relative flex-1 flex items-center">
                      <Search className="w-3 h-3 text-[#9A9996] absolute left-2 pointer-events-none" />
                      <input
                        type="text"
                        value={toolSearch}
                        onChange={(e) => setToolSearch(e.target.value)}
                        placeholder="搜索工具..."
                        className="w-full pl-6 pr-5 h-7 text-xs bg-black/[0.035] hover:bg-black/[0.05] focus:bg-white rounded-md outline-none text-[#191918] placeholder-[#9A9996] focus:ring-1 focus:ring-black/[0.12] transition-all border-none"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                    {filteredToolList.map((tool) => {
                      const isSelected = activeTabId === tool.id;
                      return (
                        <div
                          key={tool.id}
                          onClick={() => onOpenTool(tool.id)}
                          className={`group relative px-2.5 py-2 rounded-lg transition-all cursor-pointer flex items-center gap-2.5 ${isSelected
                            ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_1px_rgba(0,0,0,0.02)] ring-1 ring-black/[0.08]"
                            : "bg-transparent hover:bg-black/[0.035] text-[#191918]"
                            }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${isSelected
                              ? "bg-[#1C1C1C] text-white"
                              : "bg-black/[0.04] text-[#787774] group-hover:text-[#191918]"
                              }`}
                          >
                            <ToolIcon toolId={tool.id} className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4
                              className={`text-xs truncate ${isSelected ? "font-semibold text-[#191918]" : "font-normal text-[#191918]"
                                }`}
                            >
                              {tool.name}
                            </h4>
                            <p className="text-[11px] line-clamp-1 mt-0.5 text-[#787774]">
                              {tool.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          </div>

          {/* ================= 3. 右侧主画布 (flex-1) ================= */}
          <main className="flex-1 flex flex-col bg-[#FFFFFF] overflow-hidden min-w-0 relative h-full">
            {/* 中间内容画布：挂载工具主页面 */}
            <div className="flex-1 overflow-hidden relative bg-[#FFFFFF]">
              <div className="absolute inset-0">
                <ToolPage toolId={activeTabId} />
              </div>
            </div>

            {/* 非笔记模块下，底部固定一条 36px 高的状态栏 */}
            {!isMarkdownActive && (
              <footer className="h-9 bg-[#FFFFFF] px-4 flex items-center justify-between text-xs text-[#787774] flex-shrink-0 z-20">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                  <span className="font-medium text-[#191918]">{currentTool?.name || "就绪"}</span>
                </div>
                <div className="flex items-center gap-4 text-[11px] font-mono">
                  <span>UTF-8</span>
                  <span>桌面工作台</span>
                </div>
              </footer>
            )}
          </main>
        </div>
      </div>

      {/* ================= ⌘K 全局指令搜索弹窗 ================= */}
      {isCmdOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-xs z-50 flex items-start justify-center pt-24"
          onClick={() => setIsCmdOpen(false)}
        >
          <div
            className="w-[520px] max-w-[90vw] bg-white border border-[#E6E6E3] rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-12 px-4 border-b border-[#E6E6E3] flex items-center gap-2.5">
              <Search className="w-4 h-4 text-[#787774]" />
              <input
                ref={cmdInputRef}
                type="text"
                value={cmdSearch}
                onChange={(e) => setCmdSearch(e.target.value)}
                placeholder="搜索工具、模块或功能..."
                className="flex-1 text-sm bg-transparent outline-none text-[#191918] placeholder-[#787774]"
              />
              <span className="text-[10px] bg-[#F3F3F1] border border-[#E6E6E3] rounded px-1.5 py-0.5 text-[#787774] font-mono">
                ESC 关闭
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto p-2 space-y-1">
              {cmdFilteredTools.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onOpenTool(m.id);
                    setIsCmdOpen(false);
                    if (m.id === "text-translate") {
                      setIsSidebarOpen(false);
                    } else {
                      setIsSidebarOpen(true);
                    }
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#F3F3F1] text-left transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ToolIcon toolId={m.id} className="w-5 h-5 text-[#191918] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#191918] truncate">
                        {m.name}
                      </div>
                      <div className="text-[11px] text-[#787774] truncate">
                        {m.description}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-[#787774] opacity-0 group-hover:opacity-100 transition-opacity">
                    按回车打开
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= 全局设置弹窗 ================= */}
      <SettingsModal
        open={isSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={() => setIsSettingsOpen(false)}
        onResetSidebarWidth={() => {
          setIsFolderTreeOpen(false);
          setIsSidebarOpen(true);
        }}
      />
    </div>
  );
}
