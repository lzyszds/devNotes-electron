import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { ComponentType } from "react";
import {
  PanelLeft,
  FolderTree,
  Search,
  BarChart3,
  Pencil,
  Settings,
  Cloud,
  Boxes,
  ClipboardList,
  FileText,
  FileCode2,
  Folder,
  Trash2,
  Languages,
  Calculator,
  Sparkles,
  Clock,
  Palette,
  Bot,
  X,
} from "lucide-react";
import {
  allModules,
  tools,
  toolCategories,
  jsonToolboxAliases,
  computerSuiteId,
  computerSuiteTools,
  type ComputerSuiteToolId,
} from "../../types";
import NotesSidebar from "../modules/markdown-notes/NotesSidebar";
import SnippetsSidebar from "../modules/snippets/SnippetsSidebar";
import ToolPage from "../../pages/ToolPage";
import ComputerSuite from "../modules/computer-suite/ComputerSuite";
import MarketBoard from "../modules/market-board/MarketBoard";
import { useNotes } from "../../context/NotesContext";
import SettingsModal, {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "../modals/SettingsModal";
import { useSnippets } from "../modules/snippets/useSnippets";
import { setSelectedSnippetId } from "../modules/snippets/SnippetsSidebar";
import Tooltip from "../ui/Tooltip";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useShortcutSettings } from "../../hooks/useShortcutSettings";
import {
  eventToAccelerator,
  isRecordingShortcut,
  SHORTCUT_BINDINGS,
} from "../../utils/shortcutSettings";
import { subscribeAppSettings } from "../../utils/settingsBus";
import {
  addUsageTime,
  recordDailyUse,
  recordToolAction,
} from "../../utils/usageLog";

import WindowControls from "./WindowControls";
import ToolIcon from "../ui/ToolIcon";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { useToast } from "../ui/Toast";
import { copyText } from "../../utils/clipboard";
import { matchQuickCalculator } from "../../utils/cmdCalculator";
import { useUiPrefsStore } from "../../store/uiPrefsStore";

/** 2字短标签映射 */
function getToolShortLabel(toolId: string): string {
  const map: Record<string, string> = {
    "markdown-notes": "笔记",
    snippets: "代码",
    "text-translate": "翻译",
    "json-toolbox": "JSON",
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
    "color-palette": "色彩",
    "ai-chat": "智聊",
  };
  return map[toolId] || "工具";
}

interface DashboardLayoutProps {
  activeTabId: string;
  onOpenTool: (id: string) => void;
  onOpenStats: () => void;
  /** 只计账不导航（草稿纸开独立小窗这类「用了但不切页」的调用） */
  onTallyTool?: (id: string) => void;
}

/*
 * 内核自己拥有键主权的应用内键。
 *
 * Milkdown 内核（preset-commonmark）天生绑着 Mod-b（加粗）与 Mod-e（行内代码），
 * Cherry 双栏源码模式的 CodeMirror 同款 —— 它们只 preventDefault，不冒泡给谁
 * 罗马字根判断。布局层的监听也在同一个 window 上，焦点在编辑器里时再拦一遍
 * 这两个键就是双发：⌘B 同时「加粗 + 收文档目录」、⌘E 同时「切行内代码 + 弹导出」。
 * 所以这两条在编辑器内让位给内核。⌘S 内核没绑，保存键不受影响：
 * 用户在笔记页编辑途中按 ⌘S，保存照常发生（这正是他该有的预期）。
 */
const EDITOR_OWNED_APP_KEYS = new Set<string>(["toggle-sidebar", "export-note"]);

/** 焦点是否落在笔记编辑器（Milkdown / Cherry 任一内核）里 */
function isFocusInsideNotesEditor(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return Boolean(active.closest?.(".milkdown-notes-editor, .cherry-notes-editor"));
}

export default function DashboardLayout({
  activeTabId,
  onOpenTool,
  onOpenStats,
  onTallyTool,
}: DashboardLayoutProps) {
  const isMobile = useIsMobile();
  const { showToast } = useToast();

  // 侧边栏折叠控制（控制列表栏）
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobile);
  // 二级目录栏扩展控制（类似 Notion / Obsidian 目录树按需展开，默认收起呈现精炼三栏）
  const isFolderTreeOpen = useUiPrefsStore((s) => s.folderTreeOpen);
  const setFolderTreeOpen = useUiPrefsStore((s) => s.setFolderTreeOpen);

  const toggleFolderTree = () => {
    setFolderTreeOpen(!isFolderTreeOpen);
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

  // 监听全量/差量在线更新就绪事件
  // 记版本号而不是布尔：横幅的「稍后」只对当前版本生效，更新的版本到来时要重新弹出
  const [updateReadyVersion, setUpdateReadyVersion] = useState<string | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const isUpdateReady = Boolean(updateReadyVersion);
  useEffect(() => {
    window.electronAPI?.getUpdateStatus?.().then((s) => {
      if (s?.state === "downloaded" && s.version) setUpdateReadyVersion(s.version);
    });
    return window.electronAPI?.onUpdateStatus?.((s) => {
      if (s.state === "downloaded") {
        setUpdateReadyVersion(s.version);
        showToast(
          `🎉 新版本 v${s.version} 差量下载完毕，点击设置即可立即重启安装！`,
          "default"
        );
      }
    });
  }, [showToast]);

  const {
    activeNote,
    handleRename: handleRenameNote,
    folders,
    scope,
    notes,
    handleSelect: handleSelectNote,
    setScope,
    // ⌘S / ⌘N / ⌘E 三个应用内动作键在布局层就能闭环：保存走 context 的统一入口，
    // 新建与导出本来就是纯 context 操作，不需要等编辑器自己再接一遍键盘
    saveNow,
    handleCreate: handleCreateNote,
    handleExport,
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
    [activeTabId],
  );
  const isMarkdownActive = activeTabId === "markdown-notes";
  const isSnippetsActive = activeTabId === "snippets";
  const isTranslateActive = activeTabId === "text-translate";
  const isAiChatActive = activeTabId === "ai-chat";
  // 电脑配置：一级大模块（和笔记/代码并列），主画布渲染 ComputerSuite 而不是 ToolPage
  const isSysSuiteActive = activeTabId === computerSuiteId;
  const isMarketBoardActive = activeTabId === "market-board";
  // 工具集合：当 activeTabId 不是独立模块时，即属于小工具集合
  const isToolCollectionActive =
    !isMarkdownActive &&
    !isSnippetsActive &&
    !isTranslateActive &&
    !isAiChatActive &&
    !isSysSuiteActive &&
    !isMarketBoardActive;

  // 翻译与智聊页面不提供外层二级侧边栏，进入时默认强制关闭侧边栏
  useEffect(() => {
    if (isTranslateActive || isAiChatActive) {
      setIsSidebarOpen(false);
    }
  }, [isTranslateActive, isAiChatActive]);

  /* ---------------- 电脑配置大模块：子工具选择（一级路由内的 tab） ---------------- */

  // 子工具选择提升到 layout：专属侧边栏、右键路由菜单、ComputerSuite 三处共用一份
  const suiteSubToolRaw = useUiPrefsStore((s) => s.suiteSubTool);
  const setSuiteSubToolStore = useUiPrefsStore((s) => s.setSuiteSubTool);
  const suiteSubTool: ComputerSuiteToolId = computerSuiteTools.some(
    (t) => t.id === suiteSubToolRaw,
  )
    ? (suiteSubToolRaw as ComputerSuiteToolId)
    : "sys-inspector";

  // 切子工具也记一笔套件使用：统计口径与「切一次工具开一页」一致
  const handleSelectSuiteTool = useCallback(
    (id: ComputerSuiteToolId) => {
      setSuiteSubToolStore(id);
      onTallyTool?.(computerSuiteId);
    },
    [onTallyTool, setSuiteSubToolStore],
  );

  // 首次进入才挂载 ComputerSuite（四个子工具按需 lazy），挂载后常驻保活
  const [suiteVisited, setSuiteVisited] = useState(false);
  useEffect(() => {
    if (isSysSuiteActive) setSuiteVisited(true);
  }, [isSysSuiteActive]);

  const [marketBoardVisited, setMarketBoardVisited] = useState(false);
  useEffect(() => { if (isMarketBoardActive) setMarketBoardVisited(true); }, [isMarketBoardActive]);

  // 胶囊 Tab 内已打开的工具标签页列表（持久化到 uiPrefsStore）
  const openedToolTabsRaw = useUiPrefsStore((s) => s.openedToolTabs);
  const setOpenedToolTabsStore = useUiPrefsStore((s) => s.setOpenedToolTabs);
  const openedToolTabs = useMemo(() => {
    const valid = openedToolTabsRaw
      .filter((id) => tools.some((t) => t.id === id))
      .slice(0, 6);
    return valid.length > 0 ? valid : ["json-toolbox"];
  }, [openedToolTabsRaw]);

  // 记录上次在工具集里查看的小工具，方便切回时无缝恢复
  const lastActiveToolId = useUiPrefsStore((s) => s.lastToolId) || "json-toolbox";
  const setLastToolId = useUiPrefsStore((s) => s.setLastToolId);

  // 当前激活项属于普通工具时，把它顶到已开标签的最前并记住最近访问项。
  // 标签最多 6 个：超出就挤掉最旧的（轮换），列表永远不需要滚动
  useEffect(() => {
    const isOrdinaryTool = tools.some((t) => t.id === activeTabId);
    if (isOrdinaryTool) {
      setLastToolId(activeTabId);
      const next = [
        activeTabId,
        ...openedToolTabs.filter((id) => id !== activeTabId),
      ].slice(0, 6);
      // 顺序未变就别写：否则 store 更新会再触发本 effect，形成循环
      if (
        next.length !== openedToolTabs.length ||
        next.some((id, i) => id !== openedToolTabs[i])
      ) {
        setOpenedToolTabsStore(next);
      }
    }
  }, [activeTabId, openedToolTabs, setLastToolId, setOpenedToolTabsStore]);

  // 关闭胶囊中的某个工具 Tab
  const handleCloseToolTab = (targetToolId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = openedToolTabs.filter((id) => id !== targetToolId);
    if (activeTabId === targetToolId) {
      if (next.length > 0) {
        onOpenTool(next[0]);
      } else {
        // 保底保留一个工具
        next.push("json-toolbox");
        onOpenTool("json-toolbox");
      }
    }
    setOpenedToolTabsStore(next);
  };

  // 点击某个子标签（草稿纸在桌面端开独立小窗，不占工作台标签）
  const handleSelectToolTab = useCallback(
    (toolId: string) => {
      if (toolId === "scratchpad" && window.electronAPI?.scratchOpen) {
        // 独立小窗绕过了 openTool，不补一笔的话统计页永远看不到草稿纸被用过
        onTallyTool?.("scratchpad");
        void window.electronAPI.scratchOpen();
        return;
      }
      onOpenTool(toolId);
      setIsSidebarOpen(true);
    },
    [onOpenTool, onTallyTool],
  );

  // 长按「工具」：清空其余全部子标签，但当前正开着的这页不关（类似浏览器「关闭其他标签页」）；
  // 当前停在模块页（笔记/翻译/代码）时没有开着的工具页，清到保底单标签即可
  const handleClearToolTabs = useCallback(() => {
    const keepCurrent = tools.some((t) => t.id === activeTabId);
    const next = keepCurrent ? [activeTabId] : ["json-toolbox"];
    setOpenedToolTabsStore(next);
  }, [activeTabId, setOpenedToolTabsStore]);

  // 右键路由 → 该路由的子内容菜单：左侧不再常驻子集，切换收进菜单里。
  // 工具 = 已开标签 + 清空；笔记 = 文件夹 / 回收站切视图；代码、翻译 = 打开入口
  const { openContextMenu } = useContextMenu();
  const openRouteMenu = (
    route: "markdown-notes" | "ai-chat" | "text-translate" | "snippets" | "tool-collection" | "sys-suite",
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    const goto = (id: string) => {
      // 翻译与智聊页锁死无侧栏，其余导航进来都展开
      setIsSidebarOpen(id !== "text-translate" && id !== "ai-chat");
      onOpenTool(id);
    };
    const items: ContextMenuItem[] = [];

    if (route === "tool-collection") {
      items.push({
        id: "open-collection",
        label: "打开工具箱",
        icon: <Boxes size={14} />,
        onSelect: handleOpenToolCollection,
      });
      items.push({ id: "sep-open", separator: true });
      openedToolTabs.forEach((id) => {
        const meta = tools.find((t) => t.id === id);
        items.push({
          id: `tab-${id}`,
          label: meta?.name || getToolShortLabel(id),
          icon: <ToolIcon toolId={id} className="w-3.5 h-3.5" />,
          onSelect: () => handleSelectToolTab(id),
        });
      });
      if (openedToolTabs.length > 1) {
        const currentMeta = tools.find((t) => t.id === activeTabId);
        items.push({ id: "sep-close", separator: true });
        if (currentMeta) {
          items.push({
            id: "close-current",
            label: `关闭「${currentMeta.name}」`,
            danger: true,
            onSelect: () => handleCloseToolTab(activeTabId),
          });
        }
        items.push({
          id: "clear-tabs",
          label: "清空其他标签",
          danger: true,
          onSelect: handleClearToolTabs,
        });
      }
    } else if (route === "sys-suite") {
      // 电脑配置右键 = 直接定位到某个子工具，不开模块页中转
      computerSuiteTools.forEach((t) => {
        items.push({
          id: `sys-${t.id}`,
          label: t.name,
          icon: <ToolIcon toolId={t.id} className="w-3.5 h-3.5" />,
          onSelect: () => {
            goto(computerSuiteId);
            handleSelectSuiteTool(t.id as ComputerSuiteToolId);
          },
        });
      });
    } else if (route === "markdown-notes") {
      items.push({
        id: "scope-all",
        label: "全部文档",
        icon: <FileText size={14} />,
        onSelect: () => {
          setScope({ type: "all" });
          goto("markdown-notes");
        },
      });
      folders.forEach((f) => {
        items.push({
          id: `folder-${f.id}`,
          label: f.name,
          icon: <Folder size={14} />,
          onSelect: () => {
            setScope({ type: "folder", folderId: f.id });
            goto("markdown-notes");
          },
        });
      });
      items.push({ id: "sep-trash", separator: true });
      items.push({
        id: "scope-trash",
        label: "回收站",
        icon: <Trash2 size={14} />,
        onSelect: () => {
          setScope({ type: "trash" });
          goto("markdown-notes");
        },
      });
    } else if (route === "snippets") {
      items.push({
        id: "open-snippets",
        label: "打开片段库",
        icon: <FileCode2 size={14} />,
        onSelect: () => goto("snippets"),
      });
    } else if (route === "ai-chat") {
      items.push({
        id: "open-ai-chat",
        label: "打开智聊",
        icon: <Bot size={14} />,
        onSelect: () => goto("ai-chat"),
      });
    } else {
      items.push({
        id: "open-translate",
        label: "打开文本翻译",
        icon: <Languages size={14} />,
        onSelect: () => goto("text-translate"),
      });
    }

    openContextMenu(e, items);
  };

  // 点击工具集合主项
  const handleOpenToolCollection = () => {
    if (isToolCollectionActive) {
      // 同笔记/代码：再次点击已激活路由，侧栏保持原样（不展开也不收起）
      return;
    }
    // 从其他独立模块切入工具集合，优先恢复最近活跃的工具；
    // 旧 json 三件套的 id 也认 —— onOpenTool 会把它解析成工具箱的对应子模式
    const legacy = jsonToolboxAliases[lastActiveToolId];
    const target =
      legacy || (lastActiveToolId && tools.some((t) => t.id === lastActiveToolId))
        ? lastActiveToolId
        : openedToolTabs[0] || "json-toolbox";
    onOpenTool(target);
    setIsSidebarOpen(true);
  };

  // 普通小工具分类筛选与搜索
  const [toolCategory, setToolCategory] = useState<string>("all");
  const [toolSearch, setToolSearch] = useState<string>("");

  const filteredToolList = useMemo(() => {
    // 搜索顺带匹配分类名：敲「编码」就能带出编码类的全部工具
    const catNameById = new Map(toolCategories.map((c) => [c.id, c.name]));
    return tools.filter((t) => {
      const matchCat = toolCategory === "all" || t.category === toolCategory;
      if (!matchCat) return false;
      const q = toolSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (catNameById.get(t.category) ?? "").toLowerCase().includes(q)
      );
    });
  }, [toolCategory, toolSearch]);

  // 一个列表里按分类分组 —— 所有工具集中在一处可扫读，
  // 替代「靠分类筛选一层层翻」的找法；搜索/筛选没命中的组整组隐藏
  const groupedToolList = useMemo(() => {
    return toolCategories
      .filter((c) => c.id !== "all")
      .map((c) => ({
        id: c.id,
        name: c.name,
        items: filteredToolList.filter((t) => t.category === c.id),
      }))
      .filter((g) => g.items.length > 0);
  }, [filteredToolList]);

  // 快捷键映射
  const shortcutMap = useShortcutSettings();

  // 使用时长心跳：窗口在前台时每 10s 给当前模块记 10 秒，
  // 失焦/最小化/切到统计页一律不计 —— 统计页的「使用时长」来自这里
  const activeToolRef = useRef(activeTabId);
  activeToolRef.current = activeTabId;
  useEffect(() => {
    const HEARTBEAT_SECONDS = 10;
    const timer = window.setInterval(() => {
      if (document.hidden || !document.hasFocus()) return;
      addUsageTime(activeToolRef.current, HEARTBEAT_SECONDS);
    }, HEARTBEAT_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 主画布里的每次点击 = 一次真实的使用动作（点「美化」「生成」这类功能按钮立刻 +1）。
  // 只认 <main data-tool-canvas>：侧栏、路由、⌘K 的点击是导航，不算用工具
  useEffect(() => {
    const onCanvasPress = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("main[data-tool-canvas]")) return;
      recordToolAction(activeToolRef.current);
      recordDailyUse();
    };
    document.addEventListener("pointerdown", onCanvasPress, true);
    return () =>
      document.removeEventListener("pointerdown", onCanvasPress, true);
  }, []);

  // 全局命令面板 (⌘K)
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");
  const cmdInputRef = useRef<HTMLInputElement>(null);
  /** ⌘K 打开前的焦点元素。剪贴板这类「填回输入框」的入口靠它还原落点 ——
      不然面板自己的搜索框占住焦点，选中一条就不知道该贴给谁了 */
  const cmdOpenedFromRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isCmdOpen) {
      cmdOpenedFromRef.current = document.activeElement as HTMLElement | null;
      setTimeout(() => cmdInputRef.current?.focus(), 50);
    }
  }, [isCmdOpen]);

  // ⌘K 搜索要直达片段子内容，这里订阅与片段库同一份模块级数据层
  const { snippets } = useSnippets();

  /** ⌘K 结果条目：大路由与子内容（笔记 / 片段 / 设置分区 / 即时计算）统一成一种可执行项 */
  interface CmdItem {
    key: string;
    /** 展示图标对应的模块 id；设置项没有模块图标，走 icon 组件 */
    toolId?: string;
    icon?: ComponentType<{ className?: string }>;
    name: string;
    description: string;
    kind: "模块" | "笔记" | "片段" | "设置" | "即时计算" | "即时换算" | "小窗";
    run: () => void;
    isQuickAction?: boolean;
    badge?: string;
  }

  const [activeCmdIndex, setActiveCmdIndex] = useState(0);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  // 搜索词变化后高亮回到第一条，防止停留在已不存在的行上
  useEffect(() => {
    setActiveCmdIndex(0);
  }, [cmdSearch]);

  // 高亮行移动时滚进可视区，长列表键盘导航不丢焦点
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeCmdIndex, isCmdOpen]);

  // 面板打开期间接管键盘：Esc 关闭 / ↑↓ 换高亮 / 回车执行（此前只能点鼠标，Esc 是失效的）
  useEffect(() => {
    if (!isCmdOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsCmdOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveCmdIndex((i) =>
          cmdItems.length ? (i + 1) % cmdItems.length : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveCmdIndex((i) =>
          cmdItems.length ? (i - 1 + cmdItems.length) % cmdItems.length : 0,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = cmdItems[activeCmdIndex] ?? cmdItems[0];
        target?.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /*
   * 搜索源：大路由（模块/工具）+ 细分子内容。
   * 子内容才是高频入口——搜「docker」要直达那条片段，而不是先开片段库再搜一遍；
   * 搜笔记标题（或正文）直达那篇笔记；搜「云同步」直达设置的对应分区。
   */
  const cmdItems = useMemo<CmdItem[]>(() => {
    const q = cmdSearch.trim().toLowerCase();
    const openTool = (id: string) => {
      onOpenTool(id);
      setIsCmdOpen(false);
      setIsSidebarOpen(id !== "text-translate" && id !== "ai-chat");
    };

    const moduleItems: CmdItem[] = allModules
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q),
      )
      .slice(0, 6)
      .map((m) => ({
        key: `m-${m.id}`,
        toolId: m.id,
        name: m.name,
        description: m.description,
        kind: "模块",
        run: () => openTool(m.id),
      }));

    /*
     * 剪贴板面板不是 allModules 成员（独立小窗），这里补一条直达入口 ——
     * 否则应用内只能靠 Alt+Shift+V 这颗全局键呼它，用户在设置页里想贴条
     * 剪贴板内容时根本不知道从哪把面板拿出来。
     */
    const clipboardItem: CmdItem = {
      key: "open-clipboard-panel",
      icon: ClipboardList,
      name: "剪贴板历史",
      description: "呼出剪贴板面板，选中一条直接填回焦点所在的输入框",
      kind: "小窗",
      run: () => {
        setIsCmdOpen(false);
        // 先把焦点还给 ⌘K 打开前的那个输入框，再唤面板 —— 面板是 non-activating
        // 的不会抢焦点，但 ⌘K 自己的搜索框占过焦点，不还原的话「填回输入框」
        // 就没有落点了
        cmdOpenedFromRef.current?.focus?.();
        window.electronAPI?.clipboardOpen?.();
      },
    };

    // 空搜索铺大路由 + 剪贴板面板；笔记/片段全量铺开反而是噪音
    if (!q) return [clipboardItem, ...moduleItems];

    const noteItems: CmdItem[] = notes
      .filter((n) => !n.deletedAt)
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map((n) => {
        // 命中正文时截一段命中上下文当描述，让「搜到了内容」看得见
        const idx = n.content.toLowerCase().indexOf(q);
        const excerpt =
          idx >= 0
            ? n.content
                .slice(Math.max(0, idx - 10), idx + 50)
                .replace(/\s+/g, " ")
                .trim()
            : "";
        return {
          key: `n-${n.id}`,
          toolId: "markdown-notes",
          name: n.title || "未命名笔记",
          description: excerpt || "打开这篇笔记",
          kind: "笔记",
          run: () => {
            openTool("markdown-notes");
            handleSelectNote(n.id);
          },
        };
      });

    const snippetItems: CmdItem[] = snippets
      .filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          s.tags.some((tag) => tag.toLowerCase().includes(q)),
      )
      .slice(0, 5)
      .map((s) => ({
        key: `s-${s.id}`,
        toolId: "snippets",
        name: s.title || "未命名片段",
        description: s.tags.length ? s.tags.join(" / ") : s.language,
        kind: "片段",
        run: () => {
          // 先写共享选中态再开页面：片段页若还没挂载，挂载时会从共享态取初值，
          // 已挂载则靠事件当场切过去（setSelectedSnippetId 两头都覆盖）
          setSelectedSnippetId(s.id);
          openTool("snippets");
        },
      }));

    const settingItems: CmdItem[] = SETTINGS_SECTIONS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) || s.hint.toLowerCase().includes(q),
    )
      .slice(0, 4)
      .map((s) => ({
        key: `set-${s.id}`,
        icon: s.icon,
        name: `设置 · ${s.label}`,
        description: s.hint,
        kind: "设置",
        run: () => {
          setIsCmdOpen(false);
          openSettings(s.id);
        },
      }));

    // 优先检测即时计算与极速换算（算式、时间戳、UUID、颜色代码）
    const calcResult = q ? matchQuickCalculator(cmdSearch) : null;
    let quickItem: CmdItem | null = null;
    if (calcResult) {
      let icon = Calculator;
      if (calcResult.category === "timestamp") icon = Clock;
      else if (calcResult.category === "color") icon = Palette;
      else if (calcResult.category === "uuid") icon = Sparkles;

      quickItem = {
        key: calcResult.id,
        icon,
        name: calcResult.title,
        description: calcResult.subtitle,
        kind: calcResult.category === "calc" ? "即时计算" : "即时换算",
        badge: calcResult.badge,
        isQuickAction: true,
        run: async () => {
          await copyText(calcResult.copyValue);
          showToast(`已复制结果：${calcResult.copyValue}`, "default");
          setIsCmdOpen(false);
        },
      };
    }

    return [
      ...(quickItem ? [quickItem] : []),
      ...moduleItems,
      // 剪贴板面板走关键字匹配（搜「剪贴板」或「clipboard」能直达）
      ...(('剪贴板历史'.toLowerCase().includes(q) || 'clipboard'.includes(q))
        ? [clipboardItem]
        : []),
      ...noteItems,
      ...snippetItems,
      ...settingItems,
    ].slice(0, 16);
    // openSettings 内部只依赖稳定的 setState，刻意不列进依赖
  }, [cmdSearch, notes, snippets, onOpenTool, handleSelectNote, showToast]);

  // 键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRecordingShortcut()) return;
      // 按住不放的自动重复不响应：⌘N 连起的会是一串新笔记，其余动作重复执行也无意义
      if (e.repeat) return;

      // ⌥⌘D 展开/收起二级目录（不占 SHORTCUT_BINDINGS，没有设置入口，单独判）
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        // 翻译与智聊页面锁死不允许展开
        if (isTranslateActive || isAiChatActive) return;
        toggleFolderTree();
        return;
      }

      const keyCombo = eventToAccelerator(e);
      if (!keyCombo) return;

      /*
       * 命中哪条绑定就执行哪条**动作**，而不是把 id 当工具去开。
       *
       * 旧实现把整张 shortcutMap 轮询后直接 onOpenTool(id)——那是「工具快捷键」
       * 时代的写法，但绑定表里大部分是动作型 id（save-note / new-note / export-note…），
       * 它们在模块表里查无此项，openTool 会落到工具箱默认页：表现就是笔记页
       * 按 ⌘S 想保存，人被踹到工具页面，保存也从来没发生。
       *
       * 只认应用内键：全局键归主进程；顺带把「跨 scope 录成同一个键」时
       * 全局条目（排在表序前面）把同串应用内键整条吞掉的问题也排掉了 ——
       * 设置界面的冲突检测按 scope 分组（findConflicts），不会警告这种情况。
       *
       * openSettings / showToast 内部只依赖稳定的 setState（同 ⌘K 那个 useMemo 的
       * 注释），刻意不列进依赖。
       */
      const hit = Object.entries(shortcutMap).find(
        ([id, accelerator]) =>
          accelerator &&
          keyCombo === accelerator &&
          SHORTCUT_BINDINGS.find((b) => b.id === id)?.scope === "app",
      );
      if (!hit) return;
      const [bindingId] = hit;
      const binding = SHORTCUT_BINDINGS.find((b) => b.id === bindingId);
      if (!binding) return;

      // 编辑器键表里自有键主的两条：焦点在编辑器内时让位给内核，防止双发
      if (EDITOR_OWNED_APP_KEYS.has(bindingId) && isFocusInsideNotesEditor()) return;

      e.preventDefault();
      switch (bindingId) {
        // ⌘K 全局搜索
        case "command-palette":
          setIsCmdOpen((prev) => !prev);
          return;

        // ⌘B 折叠侧栏
        case "toggle-sidebar":
          // 翻译与智聊页面锁死不允许展开
          if (isTranslateActive || isAiChatActive) return;
          setIsSidebarOpen((prev) => !prev);
          return;

        case "open-settings":
          openSettings("general");
          return;

        case "cloud-sync-settings":
          openSettings("cloud-sync");
          return;

        // ⌘S 保存当前笔记：走 context 的统一入口，状态栏会给出已存/失败反馈。
        // 没有未保存改动时 saveNow 自己返回 clean，不打扰状态栏
        case "save-note":
          void saveNow();
          return;

        // ⌘N 新建笔记：别的模块下先切回笔记页再创建（与快捷键说明「其他模块下会先切过去」一致）
        case "new-note": {
          if (!isMarkdownActive) {
            onOpenTool("markdown-notes");
            setIsSidebarOpen(true);
          }
          handleCreateNote();
          return;
        }

        // ⌘E 导出当前笔记为 .md
        case "export-note":
          if (activeNote) void handleExport(activeNote);
          else showToast("当前没有可导出的笔记", "default");
          return;

        default:
          // 兜底：存储里可能残留已下线绑定的键值（如旧版 toggle-theme），
          // 但它们已不在 SHORTCUT_BINDINGS 里，上面按表过滤后到这里只会是
          // 上面 case 没覆盖的未接线动作 —— 保持不响应，绝不模拟「打开同名工具」切页
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    shortcutMap,
    onOpenTool,
    isMarkdownActive,
    isTranslateActive,
    isAiChatActive,
    activeNote,
    saveNow,
    handleCreateNote,
    handleExport,
    showToast,
  ]);

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
    if (isAiChatActive) return "AI 在线会话";
    // 电脑配置大模块：二级名跟随子工具，让人知道此刻看着哪张页面
    if (isSysSuiteActive) {
      return (
        computerSuiteTools.find((t) => t.id === suiteSubTool)?.name ?? "电脑配置"
      );
    }
    if (isMarketBoardActive) return "行情看板";
    return currentTool?.name || "工具箱";
  }, [
    isMarkdownActive,
    isSnippetsActive,
    isTranslateActive,
    isAiChatActive,
    isSysSuiteActive,
    isMarketBoardActive,
    suiteSubTool,
    scope,
    folders,
    currentTool,
  ]);

  // 计算侧边栏动态总宽度（默认三栏时为 288px，展开目录树时为 208 + 288 = 496px；翻译与 AI 会话页面锁死为 0）
  const sidebarWidth = useMemo(() => {
    /* 翻译与智聊页面无需二级侧边栏，强制锁死为 0，防止撑开空白区域 */
    if (isTranslateActive || isAiChatActive) return 0;
    if (!isSidebarOpen) return 0;
    if (isMobile) return "100%";
    return isFolderTreeOpen ? 496 : 288;
  }, [isTranslateActive, isAiChatActive, isSidebarOpen, isMobile, isFolderTreeOpen]);

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
            disabled={isTranslateActive || isAiChatActive}
            onClick={() => {
              if (isTranslateActive || isAiChatActive) return;
              setIsSidebarOpen((prev) => !prev);
            }}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              isTranslateActive || isAiChatActive
                ? "text-black/20 cursor-not-allowed"
                : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.04] cursor-pointer"
            }`}
            title={
              isTranslateActive || isAiChatActive
                ? "当前页面无需外层侧边栏"
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
            disabled={isTranslateActive || isAiChatActive}
            onClick={() => {
              if (isTranslateActive || isAiChatActive) return;
              toggleFolderTree();
            }}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              isTranslateActive || isAiChatActive
                ? "text-black/20 cursor-not-allowed"
                : isFolderTreeOpen
                ? "bg-black/[0.06] text-[#191918] cursor-pointer"
                : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.04] cursor-pointer"
            }`}
            title={
              isTranslateActive || isAiChatActive
                ? "当前页面无目录树"
                : isFolderTreeOpen
                ? "收起二级目录 (⌥⌘D)"
                : "展开二级目录 (⌥⌘D)"
            }
          >
            <FolderTree className="w-3.5 h-3.5" />
          </button>

          {/* 面包屑导航与就地重命名 */}
          <div className="flex items-center gap-1.5 text-xs text-[#787774] ml-2 min-w-0 truncate">
            <span>
              {isMarkdownActive
                ? "知识库"
                : isSnippetsActive
                ? "片段库"
                : isTranslateActive
                ? "翻译中心"
                : isAiChatActive
                ? "智聊"
                : isSysSuiteActive
                ? "电脑配置"
                : isMarketBoardActive
                ? "行情"
                : "工具箱"}
            </span>
            <span>/</span>
            <span className="text-[#191918] font-medium">
              {currentCategoryName}
            </span>
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
                    <span className="truncate">
                      {activeNote.title || "未命名笔记"}
                    </span>
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
            className="w-32 flex items-center justify-center gap-2 h-7 px-2.5 text-xs bg-black/[0.075] hover:bg-black/[0.05] text-[#787774] hover:text-[#191918] rounded-md transition-colors cursor-pointer"
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
          {/* 顶层核心入口：笔记、智聊、翻译、代码、工具（右键路由可切子内容） */}
          <nav className="flex-1 min-h-0 w-full px-1 flex flex-col gap-1 overflow-y-auto no-scrollbar">
            {/* 1. 笔记 */}
            <Tooltip placement="right" content="Markdown 笔记">
              <button
                type="button"
                onClick={() => {
                  if (isMarkdownActive) {
                    // 再次点击已激活路由不做任何事：侧栏不展开也不收起，
                    // 开关侧栏只走顶栏按钮 / ⌘B，路由点击不背「开关」职责
                    return;
                  }
                  onOpenTool("markdown-notes");
                  setIsSidebarOpen(true);
                }}
                onContextMenu={(e) => openRouteMenu("markdown-notes", e)}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
                  isMarkdownActive
                    ? "text-[#1C1C1C] font-semibold bg-black/[0.05]"
                    : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                }`}
              >
                {isMarkdownActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <ToolIcon toolId="markdown-notes" className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">
                  笔记
                </span>
              </button>
            </Tooltip>

            {/* 2. 智聊 */}
            <Tooltip placement="right" content="AI 在线会话">
              <button
                type="button"
                onClick={() => {
                  onOpenTool("ai-chat");
                  setIsSidebarOpen(false);
                }}
                onContextMenu={(e) => openRouteMenu("ai-chat", e)}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
                  isAiChatActive
                    ? "text-[#1C1C1C] font-semibold bg-black/[0.05]"
                    : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                }`}
              >
                {isAiChatActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <ToolIcon toolId="ai-chat" className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">
                  智聊
                </span>
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
                onContextMenu={(e) => openRouteMenu("text-translate", e)}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
                  isTranslateActive
                    ? "text-[#1C1C1C] font-semibold bg-black/[0.05]"
                    : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                }`}
              >
                {isTranslateActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <ToolIcon toolId="text-translate" className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">
                  翻译
                </span>
              </button>
            </Tooltip>

            {/* 3. 代码 */}
            <Tooltip placement="right" content="代码片段库">
              <button
                type="button"
                onClick={() => {
                  if (isSnippetsActive) {
                    // 同笔记：再次点击不展开也不收起，侧栏保持原样
                    return;
                  }
                  onOpenTool("snippets");
                  setIsSidebarOpen(true);
                }}
                onContextMenu={(e) => openRouteMenu("snippets", e)}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
                  isSnippetsActive
                    ? "text-[#1C1C1C] font-semibold bg-black/[0.05]"
                    : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                }`}
              >
                {isSnippetsActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <ToolIcon toolId="snippets" className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">
                  代码
                </span>
              </button>
            </Tooltip>

            {/* 4. 电脑配置：独立大路由（内部四件套，右键直达子工具） */}
            <Tooltip placement="right" content="电脑配置（右键直达子工具）">
              <button
                type="button"
                onClick={() => {
                  if (isSysSuiteActive) {
                    // 同笔记：再次点击不展开也不收起，侧栏保持原样
                    return;
                  }
                  onOpenTool(computerSuiteId);
                  setIsSidebarOpen(true);
                }}
                onContextMenu={(e) => openRouteMenu(computerSuiteId, e)}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
                  isSysSuiteActive
                    ? "text-[#1C1C1C] font-semibold bg-black/[0.05]"
                    : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                }`}
              >
                {isSysSuiteActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <ToolIcon toolId={computerSuiteId} className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">电脑</span>
              </button>
            </Tooltip>

            <Tooltip placement="right" content="合约与现货行情看板">
              <button
                type="button"
                onClick={() => { onOpenTool("market-board"); setIsSidebarOpen(false); }}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${isMarketBoardActive ? "text-[#1C1C1C] font-semibold bg-black/[0.05]" : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"}`}
              >
                {isMarketBoardActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />}
                <ToolIcon toolId="market-board" className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">行情</span>
              </button>
            </Tooltip>

            {/* 5. 工具集合路由：右键弹出已开工具菜单，切换收进菜单里 */}
            <Tooltip placement="right" content="常用工具箱（右键切换已开工具）">
              <button
                type="button"
                onClick={handleOpenToolCollection}
                onContextMenu={(e) => openRouteMenu("tool-collection", e)}
                className={`relative w-full py-2 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer text-[#787774] hover:text-[#191918] ${isToolCollectionActive
                  ? "font-semibold bg-black/[0.05]"
                  : "hover:bg-black/[0.03]"
                  }`}
              >
                {isToolCollectionActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-6 bg-[#1C1C1C] rounded-[0_12px_12px_0]" />
                )}
                <Boxes className="w-5 h-5 mb-1" />
                <span className="text-[10px] leading-none tracking-tight">工具</span>
              </button>
            </Tooltip>
          </nav>

          {/* 底部：云同步 / 统计 / 设置 / 圆形黑底头像（flex-shrink-0：路由区再挤也永远显示） */}
          <div className="flex flex-col items-center gap-2 w-full px-2 pt-2 flex-shrink-0">
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
            <Tooltip
              placement="right"
              content={
                isUpdateReady
                  ? "新版本已就绪！点击设置立即安装"
                  : "系统设置 (⌘,)"
              }
            >
              <button
                type="button"
                onClick={() => openSettings("general")}
                className="relative w-8 h-8 flex items-center justify-center rounded-lg text-[#787774] hover:text-[#191918] hover:bg-[#EAEAE7] transition-all cursor-pointer"
              >
                <Settings className="w-4 h-4" />
                {isUpdateReady && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse" />
                )}
              </button>
            </Tooltip>
          </div>
        </aside>

        <div className="rounded-2xl m-2 mt-0 w-full flex flex-row overflow-hidden">
          {/* ================= 2. 侧边栏容器（默认精炼三栏 w-72，按需展开二级目录树 w-52+w-72；翻译页面锁死隐藏） ================= */}
          {/*
           * 宽度变化（⌘B 收起 / ⌥⌘D 二级目录）刻意不做过渡动画，硬切。
           * 试过 transition-[width]：列宽在动、列内容（w-72 / w-52 固定宽）不动，
           * 中间帧全是被拦腰截断的内容；快速连点时Broken中间帧反复出现，
           * 和「切工具硬切」是同一个教训 —— 与其藏不住的丑中间帧，不如瞬时到位。
           */}
          <div
            style={{ width: sidebarWidth }}
            className={`flex-shrink-0 flex flex-row overflow-hidden z-20 ${
              isSidebarOpen && !isTranslateActive && !isAiChatActive
                ? "opacity-100"
                : "w-0 opacity-0 border-r-0"
            }`}
          >
            {/* 笔记侧栏保活：切走工具时不卸载组件，切回笔记即刻呈现，告别重新加载与初始化延迟 */}
            <div
              className="h-full flex flex-row overflow-hidden"
              style={{
                display: isMarkdownActive ? "flex" : "none",
                width: sidebarWidth,
              }}
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
              style={{
                display: isSnippetsActive ? "flex" : "none",
                width: sidebarWidth,
              }}
            >
              <SnippetsSidebar
                onCollapse={() => setIsSidebarOpen(false)}
                isFolderTreeOpen={isFolderTreeOpen}
                onToggleFolderTree={toggleFolderTree}
              />
            </div>

            {/* 电脑配置侧栏保活：四个子工具的清单在此切换，模块页常驻不卸载 */}
            <div
              className="h-full flex flex-row overflow-hidden"
              style={{
                display: isSysSuiteActive ? "flex" : "none",
                width: sidebarWidth,
              }}
            >
              <section className="w-72 bg-[#F9F9F8] flex flex-col h-full flex-shrink-0">
                <div className="h-11 px-3 flex items-center justify-between flex-shrink-0">
                  <span className="font-bold text-xs text-[#191918] tracking-tight">
                    电脑配置
                  </span>
                  <span className="text-[10px] font-mono text-[#9A9996]">
                    {computerSuiteTools.length} 个子工具
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5">
                  {computerSuiteTools.map((tool) => {
                    const isSelected = suiteSubTool === tool.id;
                    return (
                      <div
                        key={tool.id}
                        onClick={() => handleSelectSuiteTool(tool.id as ComputerSuiteToolId)}
                        className={`group relative px-2.5 py-2 rounded-lg transition-all cursor-pointer flex items-center gap-2.5 ${
                          isSelected
                            ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_1px_rgba(0,0,0,0.02)] ring-1 ring-black/[0.08]"
                            : "bg-transparent hover:bg-black/[0.035] text-[#191918]"
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? "bg-[#1C1C1C] text-white"
                              : "bg-black/[0.04] text-[#787774] group-hover:text-[#191918]"
                          }`}
                        >
                          <ToolIcon toolId={tool.id} className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4
                            className={`text-xs truncate ${
                              isSelected
                                ? "font-semibold text-[#191918]"
                                : "font-normal text-[#191918]"
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

            {/* 常规工具箱视图：只在工具集合激活时渲染与展示 */}
            <div
              className="h-full flex flex-row overflow-hidden"
              style={{
                display: isToolCollectionActive ? "flex" : "none",
                width: sidebarWidth,
              }}
            >
              <div className="flex flex-row h-full w-full select-none overflow-hidden">
                {/* 二级工具分类栏 (按需展开 w-52) */}
                <aside
                  style={{ width: isFolderTreeOpen ? 208 : 0 }}
                  className={`bg-[#F3F3F1] border-r border-black/[0.06] flex flex-col h-full flex-shrink-0 overflow-hidden ${
                    isFolderTreeOpen
                      ? "opacity-100"
                      : "w-0 opacity-0 border-r-0"
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
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 transition-all text-xs font-medium cursor-pointer rounded-md ${
                            isSelected
                              ? "bg-black/[0.06] text-[#191918] font-bold"
                              : "text-[#787774] hover:text-[#191918] hover:bg-black/[0.03]"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                                isSelected
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

                  <div className="flex-1 overflow-y-auto p-1.5">
                    {groupedToolList.map((group) => (
                      <div key={group.id} className="mb-1.5">
                        {/* 粘性分组头：滚动时钉在列表顶部，扫到哪组一目了然 */}
                        <div className="z-10 px-2.5 py-1 flex items-center justify-between bg-[#F3F3F1] rounded-md mb-2">
                          <span className="text-[11px] font-extrabold text-[#191918] tracking-wider">
                            {group.name}
                          </span>
                          <span className="text-[10px] font-mono text-[#C1C0BD]">
                            {group.items.length}
                          </span>
                        </div>
                        {group.items.map((tool) => {
                          const isSelected = activeTabId === tool.id;
                          return (
                            <div
                              key={tool.id}
                              onClick={() => onOpenTool(tool.id)}
                              className={`group relative px-2.5 py-2 rounded-lg transition-all cursor-pointer flex items-center gap-2.5 ${
                                isSelected
                                  ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_1px_rgba(0,0,0,0.02)] ring-1 ring-black/[0.08]"
                                  : "bg-transparent hover:bg-black/[0.035] text-[#191918]"
                              }`}
                            >
                              <div
                                className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                                  isSelected
                                    ? "bg-[#1C1C1C] text-white"
                                    : "bg-black/[0.04] text-[#787774] group-hover:text-[#191918]"
                                }`}
                              >
                                <ToolIcon
                                  toolId={tool.id}
                                  className="w-3.5 h-3.5"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4
                                  className={`text-xs truncate ${
                                    isSelected
                                      ? "font-semibold text-[#191918]"
                                      : "font-normal text-[#191918]"
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
                    ))}
                    {filteredToolList.length === 0 && (
                      <p className="py-10 text-center text-xs text-[#9A9996]">
                        没有匹配的工具 —— 换个关键词试试
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>

          {/* ================= 3. 右侧主画布 (flex-1) ================= */}
          <main
            data-tool-canvas
            className="flex-1 flex flex-col bg-[#FFFFFF] overflow-hidden min-w-0 relative h-full"
          >
            {/* 中间内容画布：挂载工具主页面（标题栏已并入各工具 ToolShell 自己的底部状态栏） */}
            <div className="flex-1 overflow-hidden relative bg-[#FFFFFF]">
              <div className="absolute inset-0">
                {/* 工具集合的 Keep-Alive 宿主：电脑配置大模块激活时整体藏起来，
                    内部所有已开工具的状态不丢 */}
                <div
                  className="h-full w-full"
                  style={{
                    display:
                      isSysSuiteActive || isMarketBoardActive ? "none" : "block",
                  }}
                >
                  <ToolPage toolId={activeTabId} />
                </div>

                {/* 电脑配置大模块：首次进入才挂载（lazy），挂载后同样常驻保活 */}
                {suiteVisited && (
                  <div
                    className="absolute inset-0"
                    style={{ display: isSysSuiteActive ? "block" : "none" }}
                  >
                    <ComputerSuite subTool={suiteSubTool} />
                  </div>
                )}
                {marketBoardVisited && (
                  <div className="absolute inset-0" style={{ display: isMarketBoardActive ? "block" : "none" }}>
                    <MarketBoard isActive={isMarketBoardActive} />
                  </div>
                )}
              </div>
            </div>

            {/*
             * 更新就绪横幅：悬浮在内容区顶部中央，不挤占布局。
             * 左下角 toast 几秒就消失、齿轮上的小绿点太隐蔽，用户反馈根本注意不到 ——
             * 换成常驻深色横幅 + 一键安装按钮，「稍后」只对当前版本生效，
             * 下一个版本到来时重新弹出。
             */}
            {isUpdateReady && dismissedUpdateVersion !== updateReadyVersion && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-top-2 duration-200 max-w-[90%]">
                <div className="flex items-center gap-3 pl-3.5 pr-1.5 py-1.5 rounded-2xl bg-[#1C1C1C] text-white shadow-lg shadow-black/20">
                  <Sparkles size={14} className="text-amber-300 shrink-0" />
                  <div className="text-xs whitespace-nowrap">
                    <span className="font-semibold">新版本 v{updateReadyVersion} 已就绪</span>
                    <span className="text-white/55 ml-1.5 hidden sm:inline">下载完成，重启即装</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.electronAPI?.installUpdate?.()}
                    className="h-7 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white text-xs font-semibold transition-all cursor-pointer shrink-0"
                  >
                    立即重启安装
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissedUpdateVersion(updateReadyVersion)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/45 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                    title="稍后提醒"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
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
                ↑↓ 选择
              </span>
              <span className="text-[10px] bg-[#F3F3F1] border border-[#E6E6E3] rounded px-1.5 py-0.5 text-[#787774] font-mono">
                ⏎ 打开
              </span>
              <span className="text-[10px] bg-[#F3F3F1] border border-[#E6E6E3] rounded px-1.5 py-0.5 text-[#787774] font-mono">
                ESC 关闭
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto p-2 space-y-1">
              {cmdItems.map((item, i) => {
                const isActive = i === activeCmdIndex;
                return (
                  <button
                    key={item.key}
                    type="button"
                    ref={isActive ? activeRowRef : undefined}
                    onMouseEnter={() => setActiveCmdIndex(i)}
                    onClick={item.run}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-colors cursor-pointer group ${
                      isActive ? "bg-[#F3F3F1]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.isQuickAction ? (
                        <div className="w-6 h-6 rounded-lg bg-[#1C1C1C] text-white flex items-center justify-center shrink-0 shadow-2xs">
                          {item.icon && <item.icon className="w-3.5 h-3.5" />}
                        </div>
                      ) : item.toolId ? (
                        <ToolIcon
                          toolId={item.toolId}
                          className="w-5 h-5 text-[#191918] shrink-0"
                        />
                      ) : (
                        item.icon && (
                          <item.icon className="w-5 h-5 text-[#191918] shrink-0" />
                        )
                      )}
                      <div className="min-w-0">
                        <div
                          className={`text-xs font-semibold text-[#191918] truncate ${
                            item.isQuickAction ? "font-mono text-[13px] text-brand-600" : ""
                          }`}
                        >
                          {item.name}
                        </div>
                        <div className="text-[11px] text-[#787774] truncate">
                          {item.description}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      {item.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1C1C1C] text-white font-mono">
                          {item.badge}
                        </span>
                      )}
                      <span
                        className={`text-[10px] text-[#787774] transition-opacity ${
                          isActive
                            ? "opacity-100"
                            : "opacity-60 group-hover:opacity-100"
                        }`}
                      >
                        {item.kind}
                      </span>
                    </div>
                  </button>
                );
              })}
              {cmdItems.length === 0 && (
                <div className="py-8 text-center text-xs text-[#787774]">
                  没有匹配的结果
                </div>
              )}
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
          setFolderTreeOpen(false);
          setIsSidebarOpen(true);
        }}
      />
    </div>
  );
}
