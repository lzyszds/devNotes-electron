import { useState, useRef, useEffect, useMemo } from "react";
import {
  PanelLeft,
  ListTree,
  Search,
  Download,
  BarChart3,
  Pencil,
  Settings,
  Cloud,
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
import {
  getCachedRailToolIds,
  subscribeRailToolIds,
} from "../../utils/sidebarLayout";
import { requestOutline } from "../../utils/editorBus";
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

  // 侧边栏折叠控制（控制第2栏与第3栏）
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobile);

  const [railToolIds, setRailToolIds] = useState<string[]>(() =>
    getCachedRailToolIds()
  );
  useEffect(() => subscribeRailToolIds(setRailToolIds), []);

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
    handleExport: handleExportNote,
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
      cmdInputRef.current?.focus();
    }
  }, [isCmdOpen]);

  // 全局快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRecordingShortcut()) return;
      const key = eventToAccelerator(e);
      if (!key) return;

      if (key === shortcutMap['cmd-palette'] || (e.metaKey && e.key === "k")) {
        e.preventDefault();
        setIsCmdOpen((prev) => !prev);
        return;
      }
      if (key === shortcutMap['settings'] || (e.metaKey && e.key === ",")) {
        e.preventDefault();
        openSettings("general");
        return;
      }
      if (key === shortcutMap['toggle-sidebar'] || (e.metaKey && e.key === "b")) {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
        return;
      }
      if (key === "Escape" && isCmdOpen) {
        setIsCmdOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutMap, isCmdOpen]);

  // 格式化当前分类目录名
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
    return currentTool?.name || "工具箱";
  }, [isMarkdownActive, isSnippetsActive, scope, folders, currentTool]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F3F3F1] text-[#191918] font-sans flex flex-row antialiased select-none">
      {/* ================= 1. 第 1 栏：最左侧窄导航 (w-16 = 64px) ================= */}
      <aside className="w-16 bg-[#F3F3F1] border-r border-[#E6E6E3] flex flex-col items-center py-3 justify-between flex-shrink-0 z-30 select-none">
        {/* 顶部：macOS 红绿灯窗口控制 */}
        <div className="flex flex-col items-center gap-3 w-full">
          <div className="drag-region w-full flex justify-center pt-1 pb-2">
            <WindowControls />
          </div>

          {/* 模块图标 + 2 字短标签导航 */}
          <nav className="flex flex-col gap-1.5 w-full px-1">
            {railToolIds.map((toolId) => {
              const meta = allModules.find((item) => item.id === toolId);
              if (!meta) return null;
              const isActive = activeTabId === toolId;
              const shortLabel = getToolShortLabel(toolId);

              return (
                <Tooltip key={toolId} placement="right" content={meta.name}>
                  <button
                    type="button"
                    onClick={() => {
                      if (toolId === "scratchpad" && window.electronAPI?.scratchOpen) {
                        void window.electronAPI.scratchOpen();
                        return;
                      }
                      if (isActive) {
                        setIsSidebarOpen((prev) => !prev);
                        return;
                      }
                      onOpenTool(toolId);
                      setIsSidebarOpen(true);
                    }}
                    className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
                      isActive
                        ? "text-[#1C1C1C] font-semibold bg-[#EAEAE7]/60"
                        : "text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7]/40"
                    }`}
                  >
                    {/* 选中项左侧 4px 宽的 #1C1C1C 竖条指示器 */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#1C1C1C] rounded-r" />
                    )}
                    <ToolIcon toolId={toolId} className="w-5 h-5 mb-1" />
                    <span className="text-[10px] leading-none tracking-tight">
                      {shortLabel}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </nav>
        </div>

        {/* 底部：云同步 / 统计 / 设置 / 圆形黑底头像 */}
        <div className="flex flex-col items-center gap-2 w-full px-2 pt-2 border-t border-[#E6E6E3]">
          {/* 云同步图标 */}
          <Tooltip placement="right" content="云端同步设置">
            <button
              type="button"
              onClick={() => openSettings("cloud-sync")}
              className="relative w-9 h-9 flex items-center justify-center rounded-xl text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7] transition-all cursor-pointer"
            >
              <Cloud className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
            </button>
          </Tooltip>

          {/* 使用统计 */}
          <Tooltip placement="right" content="使用统计">
            <button
              type="button"
              onClick={onOpenStats}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7] transition-all cursor-pointer"
            >
              <BarChart3 className="w-4 h-4" />
            </button>
          </Tooltip>

          {/* 全局设置 */}
          <Tooltip placement="right" content="系统设置 (⌘,)">
            <button
              type="button"
              onClick={() => openSettings("general")}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7] transition-all cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          </Tooltip>

          {/* 圆形黑底头像 */}
          <Tooltip placement="right" content="个人工作台">
            <div className="w-8 h-8 rounded-full bg-[#1C1C1C] text-white flex items-center justify-center font-bold text-xs mt-1 shadow-2xs cursor-pointer">
              D
            </div>
          </Tooltip>
        </div>
      </aside>

      {/* ================= 2. 第 2 栏与第 3 栏容器 (分类目录栏 w-52 + 记录列表栏 w-72) ================= */}
      <div
        style={{ width: isSidebarOpen ? (isMobile ? "100%" : 496) : 0 }}
        className={`flex-shrink-0 flex flex-row overflow-hidden transition-[width] duration-200 z-20 ${
          isSidebarOpen ? "opacity-100" : "w-0 opacity-0 border-r-0"
        }`}
      >
        {isMarkdownActive ? (
          <NotesSidebar onCollapse={() => setIsSidebarOpen(false)} />
        ) : isSnippetsActive ? (
          <SnippetsSidebar onCollapse={() => setIsSidebarOpen(false)} />
        ) : (
          /* 常规工具箱的统一四栏体验：第 2 栏 (w-52) + 第 3 栏 (w-72) */
          <div className="flex flex-row h-full w-full select-none overflow-hidden">
            {/* 第 2 栏：工具箱分类栏 (w-52 = 208px) */}
            <aside className="w-52 bg-[#F3F3F1] border-r border-[#E6E6E3] flex flex-col h-full flex-shrink-0">
              <div className="h-12 px-3 border-b border-[#E6E6E3] flex items-center justify-between flex-shrink-0">
                <span className="font-bold text-sm text-[#191918] tracking-tight">
                  工具分类
                </span>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
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
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 transition-all text-xs font-medium cursor-pointer ${
                        isSelected
                          ? "bg-[#1C1C1C] text-white rounded-full shadow-2xs"
                          : "text-[#191918] hover:bg-[#EAEAE7] rounded-lg"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                            isSelected
                              ? "bg-white text-[#1C1C1C]"
                              : "bg-[#1C1C1C] text-white"
                          }`}
                        >
                          {initialBadge}
                        </span>
                        <span className="truncate">{cat.name}</span>
                      </div>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                          isSelected ? "text-[#D4D4D0]" : "text-[#787774]"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* 第 3 栏：工具记录列表栏 (w-72 = 288px) */}
            <section className="w-72 bg-[#F9F9F8] border-r border-[#E6E6E3] flex flex-col h-full flex-shrink-0">
              <div className="h-12 px-3 border-b border-[#E6E6E3] flex items-center gap-2 flex-shrink-0">
                <div className="relative flex-1 flex items-center">
                  <Search className="w-3.5 h-3.5 text-[#787774] absolute left-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    placeholder="搜索工具..."
                    className="w-full pl-8 pr-6 h-8 text-xs bg-white border border-[#E6E6E3] rounded-lg outline-none text-[#191918] placeholder-[#787774] focus:border-[#1C1C1C] transition-colors"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {filteredToolList.map((tool) => {
                  const isSelected = activeTabId === tool.id;
                  return (
                    <div
                      key={tool.id}
                      onClick={() => onOpenTool(tool.id)}
                      className={`group relative p-3 rounded-xl transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[#1C1C1C] text-white shadow-2xs"
                          : "bg-transparent hover:bg-[#F3F3F1] text-[#191918]"
                      }`}
                    >
                      {/* 8px 状态小圆点 */}
                      <span className="absolute top-3 right-3 w-2 h-2 rounded-full flex-shrink-0 bg-[#22C55E] ring-2 ring-white/50" />
                      <h4
                        className={`text-xs font-semibold truncate ${
                          isSelected ? "text-white" : "text-[#191918]"
                        }`}
                      >
                        {tool.name}
                      </h4>
                      <p
                        className={`text-[11px] line-clamp-1 mt-0.5 ${
                          isSelected ? "text-[#D4D4D0]" : "text-[#787774]"
                        }`}
                      >
                        {tool.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* ================= 3. 第 4 栏：右侧主画布 (flex-1) ================= */}
      <main className="flex-1 flex flex-col bg-[#FFFFFF] overflow-hidden min-w-0 relative h-full">
        {/* 顶部 48px 极简工具栏 */}
        <header className="h-12 border-b border-[#E6E6E3] bg-[#FFFFFF] px-4 flex items-center justify-between flex-shrink-0 z-30 drag-region">
          {/* 左侧：折叠按钮 + 面包屑 */}
          <div className="no-drag flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              className="w-8 h-8 rounded-full bg-[#F3F3F1] hover:bg-[#EAEAE7] flex items-center justify-center text-[#191918] transition-colors cursor-pointer"
              title={isSidebarOpen ? "收起分类与列表 (⌘B)" : "展开分类与列表 (⌘B)"}
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            {/* 面包屑导航 */}
            <div className="flex items-center gap-1.5 text-xs text-[#787774] min-w-0 truncate">
              <span>{isMarkdownActive ? "知识库" : isSnippetsActive ? "片段库" : "工具箱"}</span>
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
                      className="text-[#191918] font-bold truncate max-w-[220px] hover:underline flex items-center gap-1 cursor-pointer"
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

          {/* 右侧：浅灰圆形图标按钮 (rounded-full bg-[#F3F3F1]) */}
          <div className="no-drag flex items-center gap-2 flex-shrink-0">
            {/* ⌘K 全局指令搜索 */}
            <Tooltip content="全局指令搜索 (⌘K)">
              <button
                type="button"
                onClick={() => setIsCmdOpen(true)}
                className="w-8 h-8 rounded-full bg-[#F3F3F1] hover:bg-[#EAEAE7] flex items-center justify-center text-[#191918] transition-colors cursor-pointer"
              >
                <Search className="w-4 h-4" />
              </button>
            </Tooltip>

            {/* 笔记模块专属：大纲 */}
            {isMarkdownActive && (
              <Tooltip content="目录大纲">
                <button
                  type="button"
                  onClick={() => requestOutline(true)}
                  className="w-8 h-8 rounded-full bg-[#F3F3F1] hover:bg-[#EAEAE7] flex items-center justify-center text-[#191918] transition-colors cursor-pointer"
                >
                  <ListTree className="w-4 h-4" />
                </button>
              </Tooltip>
            )}

            {/* 笔记模块专属：导出 */}
            {isMarkdownActive && activeNote && (
              <Tooltip content="导出为 Markdown 文件">
                <button
                  type="button"
                  onClick={() => void handleExportNote(activeNote)}
                  className="w-8 h-8 rounded-full bg-[#F3F3F1] hover:bg-[#EAEAE7] flex items-center justify-center text-[#191918] transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
          </div>
        </header>

        {/* 中间内容画布：挂载工具主页面 */}
        <div className="flex-1 overflow-hidden relative bg-[#FFFFFF]">
          <div className="absolute inset-0">
            <ToolPage toolId={activeTabId} />
          </div>
        </div>

        {/* 非笔记模块下，底部固定一条 36px 高的状态栏 (笔记模块内已由 MarkdownStatusBar 呈现) */}
        {!isMarkdownActive && (
          <footer className="h-9 border-t border-[#E6E6E3] bg-[#FFFFFF] px-4 flex items-center justify-between text-xs text-[#787774] flex-shrink-0 z-20">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
              <span>工作台已就绪</span>
            </div>
            <div>
              <span>当前模式：{currentTool?.name || "工具箱"}</span>
            </div>
          </footer>
        )}
      </main>

      {/* ================= ⌘K 全局指令面板 (Command Palette Modal) ================= */}
      {isCmdOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCmdOpen(false);
          }}
          className="fixed inset-0 bg-black/40 backdrop-blur-2xs z-[70] flex items-start justify-center pt-24"
        >
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-[#E6E6E3] overflow-hidden">
            <div className="p-3.5 border-b border-[#E6E6E3] flex items-center gap-3">
              <Search className="w-4 h-4 text-[#787774]" />
              <input
                ref={cmdInputRef}
                type="text"
                value={cmdSearch}
                onChange={(e) => setCmdSearch(e.target.value)}
                placeholder="搜索功能、小工具或快捷动作..."
                className="flex-1 text-sm bg-transparent outline-none text-[#191918] placeholder-[#787774]"
              />
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-[#F3F3F1] border border-[#E6E6E3] rounded text-[#787774]">
                ESC
              </kbd>
            </div>

            <div className="p-2 max-h-72 overflow-y-auto space-y-1 text-xs">
              {allModules
                .filter(
                  (m) =>
                    !cmdSearch.trim() ||
                    m.name.toLowerCase().includes(cmdSearch.toLowerCase()) ||
                    m.description.toLowerCase().includes(cmdSearch.toLowerCase())
                )
                .map((m) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      onOpenTool(m.id);
                      setIsCmdOpen(false);
                    }}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F3F3F1] cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-2.5 text-[#191918]">
                      <ToolIcon toolId={m.id} className="w-4 h-4 text-[#787774]" />
                      <span>{m.name}</span>
                    </span>
                    <span className="text-[11px] text-[#787774] truncate max-w-[200px]">
                      {m.description}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* 全局设置弹窗 */}
      <SettingsModal
        open={isSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={() => setIsSettingsOpen(false)}
        onResetSidebarWidth={() => {}}
      />
    </div>
  );
}
