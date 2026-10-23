import { Fragment, useState, useRef, useEffect, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  PanelLeft,
  Menu,
  ListTree,
  MoreVertical,
  Search,
  Moon,
  Sun,
  Download,
  BarChart3,
  Trash2,
  Pencil,
  BookmarkPlus,
  BookmarkMinus,
  FileCode,
  Languages,
  PlusCircle,
  GitBranch,
  Clock,
  Cloud,
  CloudUpload,
  CloudDownload,
  Copy,
  Settings,
  Sparkles,
  StickyNote,
} from "lucide-react";
import {
  allModules,
  standaloneModules,
} from "../../types";
import NotesSidebar from "../modules/markdown-notes/NotesSidebar";
import SnippetsSidebar from "../modules/snippets/SnippetsSidebar";
import ToolPage from "../../pages/ToolPage";
import { useNotes } from "../../context/NotesContext";
import SettingsModal, { type SettingsSection } from "../modals/SettingsModal";
import { useContextMenu } from "../ui/ContextMenu";
import Tooltip from "../ui/Tooltip";
import { useToast } from "../ui/Toast";
import { copyText } from "../../utils/clipboard";
import { usePresence } from "../../hooks/usePresence";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useShortcutSettings } from "../../hooks/useShortcutSettings";
import {
  SHORTCUT_BINDINGS,
  eventToAccelerator,
  isRecordingShortcut,
} from "../../utils/shortcutSettings";
import { subscribeAppSettings } from "../../utils/settingsBus";
import {
  getCachedRailToolIds,
  subscribeRailToolIds,
} from "../../utils/sidebarLayout";
import { requestOutline, subscribeDocStats } from "../../utils/editorBus";
import { isDarkTheme, THEMES, type ThemeId } from "../../utils/theme";
import { encoderTypes } from "../../utils/encoders";
import { requestToolMode } from "../../utils/toolModeRequest";

/**
 * 指令面板里编码条目的显示名与额外搜索词。
 * 「码位 U+」本身不带 Unicode 字样，这里补上，搜 unicode 才能找到它。
 */
/** 共用编码页面的工具入口 */
const ENCODE_ENTRY_IDS = ["en-decode", "url"];

const ENCODER_LABELS: Record<string, string> = {
  "unicode-cp": "码位 U+ (Unicode 码点)",
  unicode: "Unicode 转义 \\uXXXX",
};
import logo from "../../assets/logo.png";
import WindowControls from "./WindowControls";
import ThemeQuickMenu from "./ThemeQuickMenu";
import ToolIcon from "../ui/ToolIcon";

/** 是否是独立模块。Rail 上独立模块与普通小工具之间要画一条分隔线 */
function isStandalone(id: string | undefined): boolean {
  return Boolean(id && standaloneModules.some((item) => item.id === id));
}

// 二级侧边栏（文档目录）宽度的持久化配置
const SIDEBAR_WIDTH_KEY = "fehelper-sidebar-width";
const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 480;

/** 读取上次保存的侧边栏宽度，非法值时回退到默认宽度 */
function readSidebarWidth(): number {
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!Number.isFinite(saved) || saved <= 0) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(Math.max(saved, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

interface DashboardLayoutProps {
  activeTabId: string;
  onOpenTool: (id: string) => void;
  onOpenStats: () => void;
  theme: ThemeId;
  onToggleTheme: () => void;
  onSelectTheme: (id: ThemeId) => void;
}

export default function DashboardLayout({
  activeTabId,
  onOpenTool,
  onOpenStats,
  theme,
  onToggleTheme,
  onSelectTheme,
}: DashboardLayoutProps) {
  // 当前主题是否属于深色系，决定顶栏图标与提示文案
  const isDark = isDarkTheme(theme);
  // < 768px 走移动端外壳：目录改抽屉、顶栏精简
  const isMobile = useIsMobile();

  // 移动端初值就得是收起：若先以展开态挂载、再由 effect 改成收起，
  // 每次切回笔记都会看到目录滑出一下（300ms 过渡）。
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobile);
  // 文档目录宽度与拖拽态
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  /** 当前生效的快捷键映射（设置面板可改，用 useShortcutSettings 订阅） */
  const shortcutMap = useShortcutSettings();
  // 面板退出动画 160ms，遮罩 150ms，取长者
  const { mounted: cmdMounted, state: cmdState } = usePresence(isCmdOpen, 160);
  // 全局设置弹窗：打开时停在哪个分类
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  const [cmdSearch, setCmdSearch] = useState("");

  // 顶栏文档标题就地编辑
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleTitleCommit = () => {
    setIsEditingTitle(false);
    const trimmed = tempTitle.trim();
    if (activeNote && trimmed && trimmed !== activeNote.title) {
      handleRenameNote(activeNote.id, trimmed);
      showToast("已重命名笔记");
    }
  };


  const cmdInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // 获取全局 Notes 状态
  const {
    activeNote,
    saveStatus,
    handleCreate: handleCreateNote,
    handleOpenSampleNote,
    handleDelete: handleDeleteNote,
    handleRename: handleRenameNote,
    handleToggleBookmark,
    scope,
    handleExport: handleExportNote,
    insertText,
    cfConfig,
    cfSyncStatus,
    cfSyncMessage,
    triggerCfBackup,
    triggerCfPull,
    saveNow,
  } = useNotes();

  const isMarkdownActive = activeTabId === "markdown-notes";
  // 文本翻译是独立模块，二级侧边栏换成它自己的「翻译方向 + 历史」面板
  const isTranslateActive = activeTabId === "text-translate";
  // 代码片段库同样是独立模块，有自己的二级导航
  const isSnippetsActive = activeTabId === "snippets";
  // 只有笔记和片段库拥有二级侧栏，其它小工具独占全宽大视野
  const hasSecondarySidebar = isMarkdownActive || isSnippetsActive;
  /*
   * 左侧菜单栏的默认项。存一份在内存里并订阅变化 —— 设置面板里勾一下，
   * Rail 要当场跟着变，不能等重新进页面。
   */
  const [railToolIds, setRailToolIds] = useState<string[]>(() =>
    getCachedRailToolIds(),
  );
  useEffect(() => subscribeRailToolIds(setRailToolIds), []);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  // 移动端顶栏的「已保存 · N 字」胶囊。字数走编辑器总线，
  // 免得顶栏和底部状态栏各算一套、口径对不上。
  const [docCharCount, setDocCharCount] = useState(0);
  useEffect(() => subscribeDocStats(setDocCharCount), []);

  // 移动端进入时目录默认收起：抽屉一上来就盖住内容，会让人以为页面是空的
  useEffect(() => {
    if (isMobile) setIsSidebarOpen(false);
  }, [isMobile]);

  const { openContextMenu } = useContextMenu();
  const { showToast } = useToast();

  // 拖拽调整文档目录宽度：以侧边栏左边缘为基准计算指针横坐标
  const handleSidebarResizeStart = (e: ReactMouseEvent) => {
    const section = sidebarRef.current;
    if (!section) return;

    e.preventDefault();
    const left = section.getBoundingClientRect().left;
    let latest = sidebarWidth;
    setIsResizingSidebar(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      latest = Math.min(
        Math.max(ev.clientX - left, SIDEBAR_MIN_WIDTH),
        SIDEBAR_MAX_WIDTH,
      );
      setSidebarWidth(latest);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      // 仅在拖拽结束时落盘，避免过程中高频写入
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(latest));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // 双击分割线恢复默认宽度
  const resetSidebarWidth = () => {
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT_WIDTH));
  };

  // 复制并给出轻量提示:提示是 fixed 浮层,不参与布局,因此不会造成任何位移
  const copyWithToast = async (text: string, label = "已复制") => {
    if (!text) {
      showToast("没有可复制的内容", "error");
      return;
    }
    const ok = await copyText(text);
    showToast(ok ? label : "复制失败", ok ? "default" : "error");
  };

  // 打开全局设置弹窗，并直接定位到指定分类
  /**
   * 应用内快捷键 id -> 动作。
   *
   * 用 useMemo 而不是每次渲染重建：它进不了 effect 依赖（对象每次都是新的），
   * 而 effect 里要按 id 查表，所以表达成「依赖都齐了才重算」。
   */
  const appShortcutActions = useMemo<Record<string, () => void>>(
    () => ({
      "command-palette": () => setIsCmdOpen((prev) => !prev),
      "toggle-sidebar": () => {
        // 翻译页没有侧边栏，别让它切换一个看不见的状态
        if (isTranslateActive) return;
        setIsSidebarOpen((prev) => !prev);
      },
      "new-note": () => {
        if (isMarkdownActive) {
          // 在某个文件夹视图下新建，直接归到该文件夹，省一次「移动到」
          handleCreateNote(scope.type === "folder" ? scope.folderId : null);
        } else {
          onOpenTool("markdown-notes");
        }
      },
      "toggle-bookmark": () => {
        if (isMarkdownActive && activeNote) {
          handleToggleBookmark(activeNote.id);
          showToast(activeNote.bookmarked ? "已移除书签" : "已加入书签");
        }
      },
      "export-note": () => {
        if (isMarkdownActive) void handleExportNote();
      },
      "save-note": () => {
        // 自动保存开着时这个动作基本是空跑（没有未保存修改），关着时才真正干活。
        // 提示按 saveNow 真实的结果给：写盘失败时不能再报「已保存」
        if (isMarkdownActive) {
          void saveNow().then((result) => {
            showToast(
              result === "error"
                ? "保存失败，改动仍在本机内存中，请稍后重试"
                : result === "saved"
                  ? "已保存"
                  : "已保存，没有新修改"
            );
          });
        }
      },
      "toggle-theme": () => onToggleTheme(),
      "open-settings": () => {
        setSettingsSection("general");
        setIsSettingsOpen(true);
      },
      "cloud-sync-settings": () => {
        setSettingsSection("cloud-sync");
        setIsSettingsOpen(true);
      },
    }),
    [
      activeNote,
      handleCreateNote,
      handleExportNote,
      handleToggleBookmark,
      isMarkdownActive,
      isTranslateActive,
      onOpenTool,
      onToggleTheme,
      saveNow,
      saveStatus,
      scope,
      showToast,
    ],
  );

  const openSettings = (section: SettingsSection = "general") => {
    setSettingsSection(section);
    setIsSettingsOpen(true);
  };

  /**
   * 快捷键监听。
   *
   * 键位从配置读（设置面板可改），所以不能像原来那样写一串
   * `e.key === 'k'` 的 if-else —— 改成「按下的事件转成 accelerator，
   * 再查表找对应动作」。匹配用的是归一化后的字符串，用户把 ⌘K 改成
   * ⌘J 之后这里不用动。
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 录制快捷键时全部让路：用户要按 ⌘K 来录它，这条要是还生效，
      // 命令面板会当场弹出来盖住设置面板，根本录不下去。
      // 放在最前面判断，连 Esc 也不处理，让录制框独占这次的按键。
      if (isRecordingShortcut()) return;

      // 命令面板开着时 Esc 先关它，这条不参与自定义
      if (e.key === "Escape" && isCmdOpen) {
        setIsCmdOpen(false);
        return;
      }

      const pressed = eventToAccelerator(e);
      if (!pressed) return;

      // 只匹配应用内快捷键；全局键由主进程的 globalShortcut 处理，
      // 那里在窗口没聚焦时也生效，这里再拦一次会重复触发
      for (const binding of SHORTCUT_BINDINGS) {
        if (binding.scope !== "app") continue;
        if (shortcutMap[binding.id] !== pressed) continue;

        // 归一化后仍要按顺序比：配置里是 CommandOrControl+B，事件转出来
        // 也是这个写法，直接相等即命中
        const handler = appShortcutActions[binding.id];
        if (!handler) continue;
        e.preventDefault();
        handler();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appShortcutActions, isCmdOpen, shortcutMap]);

  // 打开指令面板时自动聚焦
  useEffect(() => {
    if (isCmdOpen) {
      setTimeout(() => cmdInputRef.current?.focus(), 50);
    } else {
      setCmdSearch("");
    }
  }, [isCmdOpen]);

  // 工具内部想打开全局设置（如翻译工具提示「去配置」）时，通过事件总线通知这里
  useEffect(() => {
    return subscribeAppSettings((topic) => openSettings(topic));
  }, []);

  // 窗口控制（顶栏三个圆点由 WindowControls 自己调 IPC，这里只留双击要用的最大化）
  const handleMaximize = () => window.electronAPI?.maximizeWindow();

  // 无边框窗口没有系统标题栏，「双击标题栏最大化」这条系统行为得自己补回来。
  // 落在交互控件上时不触发 —— 红绿灯、搜索框、各个按钮都带 no-drag。
  const handleTopbarDoubleClick = (event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest(".no-drag")) return;
    handleMaximize();
  };

  // 指令面板指令过滤
  const commandList = [
    {
      id: "cmd-new-note",
      title: "新建 Markdown 笔记",
      shortcut: "⌘N",
      icon: PlusCircle,
      action: () => {
        onOpenTool("markdown-notes");
        handleCreateNote();
      },
    },
    {
      id: "cmd-mermaid",
      title: "插入 Mermaid 时序图",
      shortcut: "/mermaid",
      icon: GitBranch,
      action: () => {
        onOpenTool("markdown-notes");
        const demo = `\n\`\`\`mermaid\nsequenceDiagram\n    autonumber\n    A->>B: 发送数据请求\n    B-->>A: 返回处理结果\n\`\`\`\n`;
        insertText(demo, "");
      },
    },
    {
      id: "cmd-timeline",
      title: "插入 Timeline 时间线",
      shortcut: "/timeline",
      icon: Clock,
      action: () => {
        onOpenTool("markdown-notes");
        const demo = `\n::: timeline 时间线\n:: [done] 2024-01-15 项目立项\n  完成需求评审\n:: [doing] 2024-03-20 Alpha 版本\n  正在联调\n:: [todo] 2024-06-01 正式上线\n:: [error] 2024-07-01 严重回滚事件\n:: [milestone] 2024-08-01 用户破万\n:::\n`;
        insertText(demo, "");
      },
    },
    {
      id: "cmd-text-translate",
      title: "打开文本翻译",
      shortcut: "⌘T",
      icon: Languages,
      action: () => {
        onOpenTool("text-translate");
      },
    },
    {
      id: "cmd-scratchpad-window",
      title: "打开草稿纸置顶小窗",
      shortcut: "⌥⇧N",
      icon: StickyNote,
      action: () => {
        if (!window.electronAPI?.scratchOpen) {
          onOpenTool("scratchpad");
          return;
        }
        void window.electronAPI.scratchOpen();
      },
    },
    {
      id: "cmd-scratchpad-page",
      title: "打开草稿纸（页内编辑）",
      shortcut: "",
      icon: StickyNote,
      action: () => {
        onOpenTool("scratchpad");
      },
    },
    {
      id: "cmd-open-settings",
      title: "打开全局设置",
      shortcut: "⌘,",
      icon: Settings,
      action: () => {
        openSettings("general");
      },
    },
    {
      id: "cmd-interface-settings",
      title: "界面设置（左侧菜单栏自定义）",
      shortcut: "",
      icon: PanelLeft,
      action: () => {
        openSettings("interface");
      },
    },
    {
      id: "cmd-cf-settings",
      title: "Cloudflare 云端同步设置",
      shortcut: "⌘U",
      icon: Cloud,
      action: () => {
        openSettings("cloud-sync");
      },
    },
    {
      id: "cmd-translate-api-settings",
      title: "在线翻译接口设置",
      shortcut: "",
      icon: Languages,
      action: () => {
        openSettings("translate-api");
      },
    },
    {
      id: "cmd-cf-backup",
      title: "立即备份至 Cloudflare 云端",
      shortcut: "",
      icon: CloudUpload,
      action: () => {
        void triggerCfBackup();
      },
    },
    {
      id: "cmd-cf-pull",
      title: "从 Cloudflare 同步拉取并合并笔记",
      shortcut: "",
      icon: CloudDownload,
      action: () => {
        void triggerCfPull("merge");
      },
    },
    {
      id: "cmd-sample-md",
      title: "打开 / 新建「Markdown 全特性与工具样板」",
      shortcut: "",
      icon: Sparkles,
      action: () => {
        onOpenTool("markdown-notes");
        handleOpenSampleNote();
      },
    },
    {
      id: "cmd-export-md",
      title: "导出为 .md 文件",
      shortcut: "⌘E",
      icon: Download,
      action: () => {
        handleExportNote();
      },
    },
    {
      id: "cmd-toggle-theme",
      title: isDark ? "快捷切换为对偶浅色主题" : "快捷切换为对偶深色主题",
      shortcut: "⌘D",
      icon: isDark ? Sun : Moon,
      action: () => {
        onToggleTheme();
      },
    },
    ...THEMES.map((t) => ({
      id: `cmd-theme-${t.id}`,
      title: `切换主题：${t.name} (${t.englishName} · ${t.mode === "dark" ? "深色" : "浅色"
        })`,
      shortcut: t.id === theme ? "当前" : "",
      icon: t.mode === "dark" ? Moon : Sun,
      action: () => {
        onSelectTheme(t.id);
      },
    })),
    /*
     * 工具库 + 独立模块都要列。
     *
     * 原来只遍历 tools，片段库升成独立模块后就从指令面板里消失了 ——
     * 用户搜不到自己收藏的片段入口，只能从侧栏绕。两头都得覆盖。
     */
    ...allModules
      .map((tool) => ({
        id: `cmd-tool-${tool.id}`,
        title: `打开 ${tool.name}`,
        // 搜索除了标题还要看描述，比如「Unicode」应该能找到编码转换
        keywords: `${tool.name} ${tool.description} ${tool.id}`,
        subtitle: tool.description,
        shortcut: "",
        icon: (props: any) => <ToolIcon toolId={tool.id} {...props} />,
        action: () => {
          // 草稿纸在指令面板里有单独的两条（小窗 / 页内），这里不再重复
          if (tool.id === "scratchpad") return;
          onOpenTool(tool.id);
        },
      }))
      .filter((item) => !item.id.endsWith("scratchpad")),
    /*
     * 编码转换的每种编码各占一条：搜 unicode 直接落到 Unicode 模式，不用再手动切。
     */
    /* 编码类工具共用同一个编码页面，每个入口下都能找到每种编码 */
    ...ENCODE_ENTRY_IDS.flatMap((toolId) => {
      const entryName = allModules.find((item) => item.id === toolId)?.name ?? toolId;
      return encoderTypes.map((enc) => ({
        id: `cmd-encode-${toolId}-${enc.id}`,
        title: `${entryName} · ${ENCODER_LABELS[enc.id] ?? enc.name}`,
        keywords: `${enc.name} ${ENCODER_LABELS[enc.id] ?? ""} ${enc.id} ${enc.group} ${enc.hint ?? ""} 编码 解码`,
        subtitle: enc.hint ?? "",
        shortcut: "",
        icon: (props: any) => <ToolIcon toolId={toolId} {...props} />,
        action: () => {
          requestToolMode(toolId, enc.id);
          onOpenTool(toolId);
        },
      }));
    }),
  ].filter((item) => {
    // 多个词用空格分开，每个词都要命中（标题或关键词任一处）
    const haystack = `${item.title} ${"keywords" in item ? item.keywords : ""}`.toLowerCase();
    return cmdSearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => haystack.includes(term));
  });

  // 独立模块不在工具库里，得一起查，否则面包屑上的名字会掉成「工具」
  const currentTool = allModules.find((t) => t.id === activeTabId);

  // 顶栏标题右键菜单:笔记视图给出文档动作,工具视图给出工具动作
  const handleBreadcrumbContextMenu = (e: ReactMouseEvent) => {
    if (isMarkdownActive) {
      const note = activeNote;
      openContextMenu(e, [
        {
          id: "bc-rename",
          label: "重命名文档",
          icon: <Pencil className="w-3.5 h-3.5" />,
          disabled: !note,
          onSelect: () => {
            if (!note) return;
            const next = window.prompt("重命名文档", note.title);
            if (next === null) return;
            const trimmed = next.trim();
            if (!trimmed || trimmed === note.title) return;
            handleRenameNote(note.id, trimmed);
          },
        },
        {
          id: "bc-bookmark",
          label: note?.bookmarked ? "移除书签" : "加入书签",
          icon: note?.bookmarked ? (
            <BookmarkMinus className="w-3.5 h-3.5" />
          ) : (
            <BookmarkPlus className="w-3.5 h-3.5" />
          ),
          disabled: !note,
          onSelect: () => {
            if (!note) return;
            handleToggleBookmark(note.id);
            showToast(note.bookmarked ? "已移除书签" : "已加入书签");
          },
        },
        {
          id: "bc-copy-content",
          label: "复制全文",
          icon: <Copy className="w-3.5 h-3.5" />,
          disabled: !note,
          onSelect: () => void copyWithToast(note?.content ?? "", "已复制全文"),
        },
        {
          id: "bc-export",
          label: "导出 .md",
          icon: <Download className="w-3.5 h-3.5" />,
          disabled: !note,
          onSelect: () => void handleExportNote(note ?? undefined),
        },
        { id: "bc-sep", separator: true },
        {
          id: "bc-delete",
          label: "移入回收站",
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          disabled: !note,
          onSelect: () => {
            if (!note) return;
            handleDeleteNote(note.id);
            showToast("已移入回收站");
          },
        },
      ]);
      return;
    }

    if (!currentTool) return;
    openContextMenu(e, [
      {
        id: "bc-copy-tool-name",
        label: "复制工具名称",
        icon: <Copy className="w-3.5 h-3.5" />,
        onSelect: () => void copyWithToast(currentTool.name, "已复制名称"),
      },
    ]);
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-white dark:bg-dark-bg text-slate-800 dark:text-slate-200 font-sans flex flex-col antialiased select-none">
      {/* ================= 1. 顶部栏 (Unified Topbar - 44px) ================= */}
      {/*
        顶栏取 sidebar 色，而不是 bg-white/95：带透明度的类名（.bg-white\/95）
        命中不了 html[data-theme='…'] .bg-white 那批主题覆盖，所以此前 20 套主题下顶栏恒为纯白。
        同时去掉 backdrop-blur —— 顶栏是 flex 纵列里固定高度的子项，没有内容从它下面滚过，
        模糊本来就不生效；背景转实色后更是纯开销。

        z-50（原 40）是修主题面板被挡的关键：z-index 会创建层叠上下文，
        顶栏内 ThemeQuickMenu 自己的 z-50 被锁死在顶栏这一层里，
        而编辑器的各条工具栏是文档流里更靠后的 z-40，于是反过来盖住了主题面板。
        50 仍低于浮动工具条(80)/块拖拽指示线(85)/Tooltip(90)；
        需要盖住顶栏的浮层已同步提到 60：命令面板与 SettingsModal。
      */}
      <header
        onDoubleClick={handleTopbarDoubleClick}
        className="drag-region h-11 bg-slate-50 dark:bg-dark-sidebar border-b border-slate-200/80 dark:border-dark-border px-3 md:px-4 flex items-center justify-between gap-2 z-50 flex-shrink-0"
      >
        {isMobile ? (
          <>
            {/* 左：笔记页与翻译模块有二级侧边栏，其余工具没有左侧按钮 */}
            {isMarkdownActive || isTranslateActive ? (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="no-drag -ml-1.5 p-1.5 rounded-lg text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-dark-hover"
                title={
                  isMarkdownActive
                    ? "打开文档列表"
                    : isSnippetsActive
                      ? "打开片段列表"
                      : "打开翻译面板"
                }
              >
                <Menu className="w-5 h-5" />
              </button>
            ) : (
              <span className="w-8" aria-hidden />
            )}

            {/* 中：标题 + 自动保存状态 */}
            <div className="flex min-w-0 flex-1 flex-col items-center">
              <span className="w-full truncate text-center text-xs font-bold text-slate-800 dark:text-slate-100">
                {isMarkdownActive
                  ? activeNote?.title || "未命名文档"
                  : currentTool?.name || "工具"}
              </span>
              {isMarkdownActive && (
                <span
                  className={`flex items-center gap-1 text-[10px] font-medium ${saveStatus === "error"
                    ? "text-rose-600 dark:text-rose-400"
                    : saveStatus === "saving"
                      ? "text-amber-600 dark:text-amber-400"
                      : saveStatus === "unsaved"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${saveStatus === "error"
                      ? "bg-rose-500"
                      : saveStatus === "saving"
                        ? "bg-amber-500 animate-pulse"
                        : saveStatus === "unsaved"
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                  />
                  {saveStatus === "saving"
                    ? "保存中"
                    : saveStatus === "error"
                      ? "保存失败"
                      : saveStatus === "unsaved"
                        ? "未保存"
                        : "已保存"}{" "}
                  · {docCharCount.toLocaleString()} 字
                </span>
              )}
            </div>

            {/* 右：大纲 + 更多 */}
            <div className="flex flex-shrink-0 items-center gap-0.5">
              {isMarkdownActive && (
                <button
                  onClick={() => requestOutline(true)}
                  className="no-drag p-1.5 rounded-lg text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-dark-hover"
                  title="目录大纲"
                >
                  <ListTree className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setIsMobileMoreOpen(true)}
                className="no-drag p-1.5 rounded-lg text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-dark-hover"
                title="更多"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* 左侧：窗口控件 + 侧边栏折叠 + 文档标题 / 模块信息 */}
            <div className="flex items-center gap-2.5 flex-shrink-0 min-w-0">
              <WindowControls className="mr-1 hidden md:flex" />

              {/* 标题呈现与就地重命名 */}
              <div className="flex items-center gap-2 min-w-0">
                {isMarkdownActive ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <div onContextMenu={handleBreadcrumbContextMenu} className="no-drag flex items-center gap-1.5 min-w-0">
                      <FileCode className="w-4 h-4 text-brand-600 dark:text-brand-400 flex-shrink-0" />
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
                          className="h-6 px-1.5 text-xs font-semibold rounded bg-white dark:bg-dark-panel border border-brand-500 outline-none text-slate-900 dark:text-white min-w-[120px] max-w-[260px]"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setTempTitle(activeNote?.title || "");
                            setIsEditingTitle(true);
                          }}
                          title="点击就地重命名文档"
                          className="group text-xs font-semibold text-slate-800 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400 truncate max-w-[220px] text-left transition-colors flex items-center gap-1.5 py-0.5 px-1.5 -ml-1 rounded-md hover:bg-slate-200/50 dark:hover:bg-dark-hover"
                        >
                          <span className="truncate">
                            {activeNote?.title || "未命名笔记"}
                          </span>
                          <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0 text-slate-400" />
                        </button>
                      )}
                    </div>


                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100 min-w-0">
                    <ToolIcon
                      toolId={currentTool?.id || ""}
                      className="w-4 h-4 text-brand-600 dark:text-brand-400 flex-shrink-0"
                    />
                    <span className="truncate">
                      {currentTool?.name || "工具"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 中部全局命令搜索入口 (⌘K) - 呼吸感极简胶囊 */}
            <div className="hidden md:flex flex-1 justify-center max-w-[280px] mx-auto">
              <button
                type="button"
                onClick={() => setIsCmdOpen(true)}
                className="no-drag w-full flex items-center justify-between px-2.5 py-1 bg-slate-100/80 dark:bg-dark-hover/60 hover:bg-slate-200/50 dark:hover:bg-dark-hover border border-slate-200/60 dark:border-dark-border rounded-lg text-xs text-slate-400 transition-all shadow-2xs group"
              >
                <span className="flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-brand-500 transition-colors" />
                  <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                    搜索功能或笔记...
                  </span>
                </span>
                <kbd className="px-1.5 py-0.5 text-[9px] font-mono bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded text-slate-400">
                  ⌘K
                </kbd>
              </button>
            </div>

            {/* 右侧功能控制区 */}
            <div className="flex items-center gap-2 text-xs flex-shrink-0">
              {/*
                笔记专属操作（内核切换 / 缩放 / 大纲）不在这儿了 ——
                它们属于笔记编辑器，摆在笔记页自己的工具栏上（见 NotesTool）。
                顶栏是全局的，放页面级的控件会让人以为它们对所有工具都管用。
              */}

              {/* 快捷对偶深浅切换 */}
              <Tooltip
                content={
                  isDark
                    ? "快捷切换为浅色模式 (⌘D)"
                    : "快捷切换为深色模式 (⌘D)"
                }
              >
                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="no-drag p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover rounded-md transition-colors"
                >
                  {isDark ? (
                    <Moon className="w-4 h-4 text-brand-400" />
                  ) : (
                    <Sun className="w-4 h-4 text-amber-500" />
                  )}
                </button>
              </Tooltip>

              {/* 主题选择菜单 */}
              <ThemeQuickMenu
                theme={theme}
                onSelectTheme={onSelectTheme}
                onOpenSettings={() => {
                  setSettingsSection("general");
                  setIsSettingsOpen(true);
                }}
              />
            </div>
          </>
        )}
      </header>

      {/* ================= 2. 主体三栏布局 ================= */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 2.1 工具箱极简侧边栏 (56px / w-14) */}
        <aside className="hidden md:flex w-14 bg-slate-50 dark:bg-dark-sidebar border-r border-slate-200/80 dark:border-dark-border flex-col items-center py-3 gap-4 flex-shrink-0 z-20 overflow-y-auto scrollbar-hide">
          {/* 品牌 Logo */}
          <img
            src={logo}
            alt="devNotes"
            className="w-8 h-8 object-contain drop-shadow-[0_0_10px_rgba(80,189,207,0.35)]"
          />

          {/* 常用小工具 Rail 导航。
              默认项可在「设置 → 通用 → 左侧菜单栏」里改，配置见 sidebarLayout.ts */}
          <nav className="flex-1 flex flex-col gap-2 w-full px-2">
            {railToolIds.map((toolId, index) => {
              const meta = allModules.find((item) => item.id === toolId);
              if (!meta) return null;
              const isActive = activeTabId === toolId;
              return (
                <Fragment key={toolId}>
                  {/* 独立模块（笔记 / 翻译 / 片段库）与普通小工具之间留一条分隔线 */}
                  {index > 0 &&
                    isStandalone(railToolIds[index - 1]) !==
                    isStandalone(toolId) && (
                      <div className="h-[1px] w-6 mx-auto bg-slate-200 dark:bg-dark-border" />
                    )}
                  <Tooltip placement="right" content={meta.name}>
                    <button
                      onClick={() => {
                        // 草稿纸的形态是置顶小窗，Rail 上点它就直接把小窗调出来；
                        // 页内编辑版仍可从工具中心进入
                        if (
                          toolId === "scratchpad" &&
                          window.electronAPI?.scratchOpen
                        ) {
                          void window.electronAPI.scratchOpen();
                          return;
                        }
                        if (isActive && hasSecondarySidebar) {
                          setIsSidebarOpen((prev) => !prev);
                          return;
                        }
                        onOpenTool(toolId);
                      }}
                      className={`relative group w-full aspect-square flex items-center justify-center rounded-xl transition-all ${isActive
                        ? "bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border text-brand-600 dark:text-brand-400"
                        : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover"
                        }`}
                    >
                      <ToolIcon toolId={toolId} className="w-4 h-4" />
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-brand-600 rounded-r-md" />
                      )}
                    </button>
                  </Tooltip>
                </Fragment>
              );
            })}
          </nav>

          {/* 底部：云同步状态灯 + 统计 + 工具库 + 设置 */}
          <div className="flex flex-col gap-2 w-full px-2">
            {/* 云同步状态灯（开启云同步后才出现），点击进入云同步设置 */}
            {cfConfig.enabled && (
              <Tooltip
                placement="right"
                content={cfSyncMessage || "云端数据同步"}
              >
                <button
                  onClick={() => openSettings("cloud-sync")}
                  className={`relative w-full aspect-square flex items-center justify-center rounded-xl transition-all ${cfSyncStatus === "error"
                    ? "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30"
                    : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover"
                    }`}
                >
                  <Cloud className="w-4 h-4" />
                  <span
                    className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${cfSyncStatus === "syncing"
                      ? "bg-orange-500 animate-pulse"
                      : cfSyncStatus === "error"
                        ? "bg-rose-500"
                        : "bg-emerald-500"
                      }`}
                  />
                </button>
              </Tooltip>
            )}

            <Tooltip placement="right" content="使用统计">
              <button
                onClick={onOpenStats}
                className="w-full aspect-square flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover transition-all"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </Tooltip>
            {/* 全局设置入口：云同步、翻译接口、外观等统一收在这里 */}
            <Tooltip placement="right" content="设置 (⌘,)">
              <button
                onClick={() => openSettings("general")}
                className="w-full aspect-square flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-dark-hover transition-all"
              >
                <Settings className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </aside>

        {/* 移动端目录抽屉的遮罩：点空白处收起 */}
        {isMobile && isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="absolute inset-0 z-[45] bg-slate-900/40"
          />
        )}

        {/* 2.2 二级侧边栏（仅在 Markdown 笔记与代码片段库时展示，常规小工具全宽舒适展示） */}
        {hasSecondarySidebar && (
          <section
            ref={sidebarRef}
            style={
              isMobile ? undefined : { width: isSidebarOpen ? sidebarWidth : 0 }
            }
            className={`bg-white dark:bg-dark-panel border-r border-slate-200/80 dark:border-dark-border flex flex-col ${isMobile
              ? `absolute inset-y-0 left-0 z-50 w-[82vw] max-w-[320px] shadow-2xl transition-transform duration-300 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
              }`
              : `flex-shrink-0 ${isSidebarOpen
                ? "opacity-100"
                : "w-0 opacity-0 overflow-hidden border-r-0"
              } ${isResizingSidebar
                ? ""
                : "transition-[width,opacity] duration-300"
              }`
              }`}
          >
            {isMarkdownActive ? (
              <NotesSidebar
                onAfterSelect={() => isMobile && setIsSidebarOpen(false)}
                onCollapse={() => setIsSidebarOpen(false)}
              />
            ) : (
              <SnippetsSidebar
                onAfterSelect={() => isMobile && setIsSidebarOpen(false)}
                onCollapse={() => setIsSidebarOpen(false)}
              />
            )}

            {/* 移动端抽屉底部：状态 + 主入口 */}
            {isMobile && (
              <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200/80 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-dark-border dark:bg-dark-panel">
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${cfSyncStatus === "error"
                      ? "bg-rose-500"
                      : cfSyncStatus === "syncing"
                        ? "bg-orange-500 animate-pulse"
                        : "bg-emerald-500"
                      }`}
                  />
                  <span className="truncate">
                    {cfConfig.enabled
                      ? cfSyncMessage || "云同步已就绪"
                      : "本地存储"}
                  </span>
                </span>
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => {
                      setIsSidebarOpen(false);
                      onOpenStats();
                    }}
                    className="p-1.5 rounded-lg text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-dark-hover"
                    title="使用统计"
                  >
                    <BarChart3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setIsSidebarOpen(false);
                      openSettings("general");
                    }}
                    className="p-1.5 rounded-lg text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-dark-hover"
                    title="设置"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 2.2.1 文档目录宽度分割线：负边距覆盖在侧边栏右边框上，不挤占主工作台 */}
        {hasSecondarySidebar && !isMobile && isSidebarOpen && (
          <Tooltip content="拖动调整文档目录宽度，双击恢复默认">
            <div
              onMouseDown={handleSidebarResizeStart}
              onDoubleClick={resetSidebarWidth}
              className={`-ml-[5px] w-[5px] flex-shrink-0 cursor-col-resize relative z-30 transition-colors ${isResizingSidebar
                ? "bg-brand-500"
                : "hover:bg-brand-400/70 dark:hover:bg-brand-500/70"
                }`}
            />
          </Tooltip>
        )}

        {/* 2.3 编辑器 / 工具主工作台 (Editor Workspace) */}
        <main className="flex-1 flex flex-col bg-white dark:bg-dark-panel overflow-hidden min-w-0 relative">
          {/* 当二级侧边栏折叠时，在工作区内容左上角提供精巧的展开按钮 */}
          {hasSecondarySidebar && !isMobile && !isSidebarOpen && (
            <div className="absolute top-2.5 left-2.5 z-40">
              <Tooltip content="展开侧边栏 (⌘B)">
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/95 dark:bg-dark-panel/95 backdrop-blur-sm border border-slate-200/90 dark:border-dark-border shadow-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover transition-all"
                  aria-label="展开侧边栏"
                >
                  <PanelLeft className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
          )}
          {/* 渲染当前工具内容 */}
          <div className="flex-1 overflow-hidden relative">
            <div className="absolute inset-0">
              <ToolPage toolId={activeTabId} />
            </div>
          </div>
        </main>
      </div>

      {/* 移动端「更多」动作面板 */}
      {isMobile && isMobileMoreOpen && (
        <div
          onClick={() => setIsMobileMoreOpen(false)}
          className="fixed inset-0 z-[70] flex items-end bg-slate-900/50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-2xl border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-dark-border dark:bg-dark-panel"
          >
            <div className="mx-auto my-2.5 h-1 w-10 rounded-full bg-slate-300 dark:bg-dark-hover" />
            <div className="px-3 pb-2">
              {isMarkdownActive && (
                <button
                  onClick={() => {
                    setIsMobileMoreOpen(false);
                    void handleExportNote();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-dark-hover"
                >
                  <Download className="w-4 h-4 flex-shrink-0 text-slate-400" />
                  导出 .md
                </button>
              )}
              <button
                onClick={() => {
                  setIsMobileMoreOpen(false);
                  onOpenStats();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-dark-hover"
              >
                <BarChart3 className="w-4 h-4 flex-shrink-0 text-slate-400" />
                使用统计
              </button>
              <button
                onClick={() => {
                  setIsMobileMoreOpen(false);
                  openSettings("general");
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-dark-hover"
              >
                <Settings className="w-4 h-4 flex-shrink-0 text-slate-400" />
                设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 3. ⌘K 全局指令面板 (Command Palette Modal) ================= */}
      {cmdMounted && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCmdOpen(false);
          }}
          data-state={cmdState}
          className="fe-fade fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs z-[60] flex items-start justify-center pt-24"
        >
          <div
            data-state={cmdState}
            className="fe-modal w-full max-w-lg bg-white dark:bg-dark-panel rounded-2xl shadow-2xl border border-slate-200 dark:border-dark-border overflow-hidden"
          >
            {/* 搜索框 */}
            <div className="p-3.5 border-b border-slate-100 dark:border-dark-border flex items-center gap-3">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                ref={cmdInputRef}
                type="text"
                value={cmdSearch}
                onChange={(e) => setCmdSearch(e.target.value)}
                placeholder="输入指令或搜索动作..."
                className="flex-1 text-sm bg-transparent outline-none text-slate-800 dark:text-white placeholder-slate-400"
              />
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-dark-hover border border-slate-200 dark:border-dark-border rounded text-slate-400">
                ESC
              </kbd>
            </div>

            {/* 指令列表 */}
            <div className="p-2 max-h-72 overflow-y-auto space-y-1 text-xs">
              {commandList.map((item) => {
                const IconComponent = item.icon;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      item.action();
                      setIsCmdOpen(false);
                    }}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-brand-50 dark:hover:bg-dark-hover hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200 group-hover:text-inherit">
                      <IconComponent className="w-4 h-4 text-slate-400" />
                      <span className="flex flex-col">
                        <span>{item.title}</span>
                        {"subtitle" in item && item.subtitle && (
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[340px]">
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                    </span>
                    {item.shortcut && (
                      <span className="text-[10px] text-slate-400 font-mono bg-slate-50 dark:bg-dark-sidebar px-1.5 py-0.5 rounded border border-slate-100 dark:border-dark-border">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                );
              })}

              {commandList.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-400">
                  未找到匹配的动作
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 全局设置弹窗：云同步 / AI 与翻译 / 通用外观 */}
      <SettingsModal
        open={isSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        onSelectTheme={onSelectTheme}
        onResetSidebarWidth={resetSidebarWidth}
      />
    </div>
  );
}
