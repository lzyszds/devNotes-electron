import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNotes } from "../../context/NotesContext";
import CherryMarkdownEditor from "./CherryMarkdownEditor";
import MilkdownMarkdownEditor from "./MilkdownMarkdownEditor";
import EditorModeSwitch, {
  persistEditorMode,
  readEditorMode,
  type EditorMode,
} from "./EditorModeSwitch";
import MarkdownStatusBar from "./markdown/MarkdownStatusBar";
import {
  persistViewMode,
  readViewMode,
  VIEW_MODE_LABEL,
  type EditorViewMode,
} from "./markdown/ViewModeSwitch";
import { Bookmark, Loader2, Minimize2, TriangleAlert, X } from "lucide-react";
import Tooltip from "../ui/Tooltip";
import { computeDocStats } from "../../utils/markdownStats";
import {
  publishDocStats,
  requestReadingJump,
  subscribeReadingPosition,
  type ReadingPosition,
} from "../../utils/editorBus";
import { useIsMobile } from "../../hooks/useIsMobile";
import EditorZoom from "./markdown/EditorZoom";
import {
  fitZoomFor,
  getZoom,
  resetZoom,
  stepZoom,
  subscribeZoom,
  ZOOM_STEP,
} from "../../utils/editorZoom";
import {
  captureBlockBookmark,
  captureReadingBookmark,
  createBookmarkId,
  isBookmarkResolvable,
} from "../../utils/readingBookmark";
import BookmarkNoteDialog from "./markdown/BookmarkNoteDialog";
import type { ReadingBookmark } from "../../utils/notesStore";
import { useToast } from "../ui/Toast";

/** 滚动超过这个距离才值得把「返回顶部」露出来 */
const BACK_TO_TOP_THRESHOLD = 120;

/** 底部状态栏左端显示当前用的是哪套内核 */
const ENGINE_LABEL: Record<EditorMode, string> = {
  cherry: "Cherry 双栏",
  milkdown: "Milkdown 所见即所得",
};

/** 所见即所得是无条件单栏内核，没有视图三态可言 */
const SINGLE_COLUMN_LABEL = "单栏内核";

export default function NotesTool() {
  const {
    ready,
    activeNote,
    handleContentChange,
    handleSaveReadingBookmark,
    handleDeleteReadingBookmark,
    saveStatus,
    message: saveMessage,
  } = useNotes();
  const { showToast } = useToast();
  const [mode, setMode] = useState<EditorMode>(readEditorMode);
  // 视图三态只有 Cherry 认，但状态放在这里 —— 底部状态栏要显示它
  const [viewMode, setViewMode] = useState<EditorViewMode>(readViewMode);
  const [warning, setWarning] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 全屏由宿主统一实现，两个内核共用 —— Cherry 那边本质上只是加一个 fullscreen 类
  const [fullscreen, setFullscreen] = useState(false);
  /*
   * 全屏预览：铺满视口 + 只读 + 整体等比放大。
   *
   * 与上面的 fullscreen 是两件事，不要混：全屏进去仍然能编辑，预览进去只给看。
   * 倍率也不走 utils/editorZoom 那份手动状态 —— 它按预览层宽度现算（见下面 stageWidth），
   * 所以进出预览不会动到用户调好的手动倍率。
   */
  const [previewing, setPreviewing] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);

  /*
   * 阅读位置：由编辑器上报（滚动容器在它内部，两个内核各有一套），宿主只消费。
   *
   * 上报里带 noteId —— 编辑器是 `key={activeNote.id}` 重建的，切笔记后新编辑器
   * 要过一帧才第一次上报；这中间若还攥着上一篇的容器，记书签会把上一篇的位置
   * 存到这一篇头上，书签校验也会拿错正文去比对。
   */
  const [position, setPosition] = useState<ReadingPosition>({
    noteId: "",
    activeIndex: -1,
    percent: 0,
    heading: "",
    container: null,
  });
  useEffect(() => subscribeReadingPosition(setPosition), []);
  // 只认属于当前这篇的上报；切笔记后编辑器还没报之前按「没有」处理
  const livePosition = position.noteId === activeNote?.id ? position : null;

  /*
   * 待确认的书签。位置在点按钮那一刻就算好了，这里存的是「等用户补备注」的那一条。
   * 不用 window.prompt —— Electron 的渲染进程没实现它（alert/confirm 有），
   * 调用会直接抛异常，按钮点了毫无反应。自己画一个弹窗可控得多。
   */
  const [bookmarkDraft, setBookmarkDraft] = useState<{
    noteId: string;
    captured: ReadingBookmark;
    heading: string;
    percent: number;
  } | null>(null);

  // 编辑器外壳：两个内核各自把滚动容器放在内部，统一从这里往下找
  const rootRef = useRef<HTMLDivElement>(null);

  // 画面缩放。状态收口在 utils/editorZoom，这里只订阅 —— 按钮、快捷键、滚轮三个入口都改它
  const [zoom, setZoom] = useState(getZoom);
  useEffect(() => subscribeZoom(setZoom), []);

  const isMobile = useIsMobile();

  const content = activeNote?.content || "";

  const bookmarks = activeNote?.readingBookmarks;

  /*
   * 某条书签是否还认得回正文。
   *
   * 依赖里带 content / livePosition：正文改了、或切了视图换了滚动容器，都要重算 ——
   * 否则会出现「标题早就改回来了，按钮还是灰的」这种过期判断。
   * 没有容器时一律当作不可用（切笔记的一瞬间就是这种状态）。
   */
  const isBookmarkStale = useCallback(
    (bookmark: { heading: string; offset: number }) =>
      !isBookmarkResolvable(livePosition?.container ?? null, bookmark),
    [livePosition?.container, content]
  );

  /**
   * 记下现在读到哪。
   *
   * 先把位置算出来存进 draft，再让用户补备注 —— 位置在这一刻是准的，
   * 弹窗开着的时候用户若滚动了正文，也不该把备注记到滚动后的位置上。
   */
  const handleAddBookmark = () => {
    const container = livePosition?.container;
    if (!container || !activeNote) return;

    const captured = captureReadingBookmark(container, createBookmarkId());
    if (!captured) {
      // 光标还在第一个标题之前（封面、引言区），没有可锚的章节
      showToast("请先滚动到正文的某个标题下再记书签", "error");
      return;
    }

    openBookmarkDraft(activeNote.id, captured);
  };

  /**
   * 块手柄那颗按钮：在光标所在的那一段上记书签。
   *
   * 与上面那颗的区别只在**锚点取在哪** —— 这里以「这一块的顶边」为基准，
   * 于是点哪一段就落在哪一段，而不是落在当前滚到的位置。
   */
  const handleBookmarkBlock = (block: HTMLElement) => {
    const container = livePosition?.container;
    if (!container || !activeNote) return;

    const captured = captureBlockBookmark(container, block, createBookmarkId());
    if (!captured) {
      showToast("这一段在第一个标题之前，请先在正文里记", "error");
      return;
    }

    openBookmarkDraft(activeNote.id, captured);
  };

  /** 把算好的位置交给备注弹窗。两个入口共用 */
  const openBookmarkDraft = (noteId: string, captured: ReadingBookmark) => {
    setBookmarkDraft({
      noteId,
      captured,
      heading: captured.heading,
      percent: captured.percent,
    });
  };

  /** 弹窗确认：把备注并进那条已经算好的书签 */
  const handleConfirmBookmark = (note: string) => {
    const draft = bookmarkDraft;
    setBookmarkDraft(null);
    if (!draft) return;
    handleSaveReadingBookmark(draft.noteId, {
      ...draft.captured,
      ...(note ? { note } : {}),
    });
    showToast(note ? `已记下书签：${note}` : `已记下书签：${draft.heading}`);
  };

  const handleJumpBookmark = (bookmark: { heading: string; offset: number }) => {
    requestReadingJump(bookmark);
  };

  /**
   * 状态栏显示哪条书签。
   *
   * 优先当前所在章节的那条（正在读的章节有书签，说明用户多半想回这里）；
   * 不在任何书签所在章节时，退回最近记的那条（列表已按时间倒序）。
   */
  const activeBookmark = useMemo(() => {
    if (!bookmarks?.length) return undefined;
    const here = livePosition?.heading?.trim();
    if (here) {
      const matched = bookmarks.find((item) => item.heading.trim() === here);
      if (matched) return matched;
    }
    return bookmarks[0];
  }, [bookmarks, livePosition?.heading]);

  // 实时精细化统计（与右键菜单的「当前文档信息」共用同一套口径）
  const stats = useMemo(() => computeDocStats(content), [content]);

  // 移动端顶栏的「已保存 · N 字」胶囊靠这个总线同步，口径与底部状态栏一致
  useEffect(() => publishDocStats(stats.totalWords), [stats.totalWords]);

  /**
   * 收集编辑器内部真正溢出滚动的容器。
   * 双栏模式下源码区与预览区是两个独立滚动容器，返回顶部时一并归零。
   */
  const collectScrollers = (): HTMLElement[] => {
    const root = rootRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) => {
      if (el.scrollHeight - el.clientHeight < 1) return false;
      const overflowY = getComputedStyle(el).overflowY;
      return overflowY === "auto" || overflowY === "scroll";
    });
  };

  // 滚动事件不冒泡，但能在父节点上捕获；直接用事件目标判断，避免每次滚动都遍历子树
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    setShowBackToTop(false);

    const handleScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el || typeof el.scrollTop !== "number") return;
      setShowBackToTop(el.scrollTop > BACK_TO_TOP_THRESHOLD);
    };

    root.addEventListener("scroll", handleScroll, true);
    return () => root.removeEventListener("scroll", handleScroll, true);
  }, [mode, viewMode, activeNote?.id, ready]);

  const handleBackToTop = () => {
    collectScrollers().forEach((el) =>
      el.scrollTo({ top: 0, behavior: "smooth" }),
    );
    setShowBackToTop(false);
  };

  // 兼容性提醒不常驻，看过即走
  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(""), 12000);
    return () => clearTimeout(timer);
  }, [warning]);

  // 切笔记时旧文档的提醒不该跟过来
  useEffect(() => {
    setWarning("");
  }, [activeNote?.id]);

  const handleModeChange = (next: EditorMode) => {
    setMode(next);
    persistEditorMode(next);
  };

  const handleViewModeChange = (next: EditorViewMode) => {
    setViewMode(next);
    persistViewMode(next);
  };

  const toggleFullscreen = useCallback(
    () => setFullscreen((prev) => !prev),
    [],
  );
  const togglePreview = useCallback(() => setPreviewing((prev) => !prev), []);

  /*
   * 缩放的两个快捷入口：⌘= / ⌘- / ⌘0，以及 ⌘+滚轮。
   * 滚轮必须挂非 passive 监听才能 preventDefault —— 否则会连带触发浏览器的整页缩放。
   *
   * 预览态下这两个入口都不改倍率（那会儿倍率是按窗口宽度算出来的，手动调它没有意义），
   * 但 preventDefault 一定要照做：省掉它，⌘+滚轮会漏给 Electron 的整页缩放，
   * 把侧栏、顶栏连同预览一起放大，比不响应更糟。
   */
  useEffect(() => {
    const ZOOM_KEYS = ["=", "+", "-", "_", "0"];
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!ZOOM_KEYS.includes(event.key)) return;
      event.preventDefault();
      if (previewing) return;
      if (event.key === "=" || event.key === "+") {
        stepZoom(ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        stepZoom(-ZOOM_STEP);
      } else {
        resetZoom();
      }
    };

    const root = rootRef.current;
    const onWheel = (event: WheelEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (previewing) return;
      stepZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    };

    window.addEventListener("keydown", onKeyDown);
    root?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      root?.removeEventListener("wheel", onWheel);
    };
  }, [previewing]);

  /*
   * 全屏 / 预览时按 Esc 退出。捕获阶段监听，免得被编辑器内部的 Esc（关浮层等）先吃掉。
   *
   * 两个开关有可能同时开着（先前在全屏，又点了预览），所以一次 Esc 只退最外面那层 ——
   * 预览层压在全屏之上，先退它才符合直觉。
   */
  useEffect(() => {
    if (!fullscreen && !previewing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (previewing) setPreviewing(false);
        else setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fullscreen, previewing]);

  /*
   * 预览倍率按**预览层自己的宽度**算，不用 window.innerWidth：
   * 侧栏宽度变化、窗口缩放都会改变这个宽度，一个 ResizeObserver 全覆盖；
   * 就算 fixed 被祖先的 transform 困住（.app-scene 的入场动画有 320ms 的窗口），
   * 量到的也是该层实际的宽，倍率依然是对的 —— 只是那一瞬间没盖住侧栏而已。
   */
  useEffect(() => {
    if (!previewing) return;
    const el = rootRef.current;
    if (!el) return;
    const sync = () => setStageWidth(el.getBoundingClientRect().width);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [previewing]);

  // 预览态用适配倍率，其余时候用用户手动调的那份
  const zoomValue = previewing ? fitZoomFor(stageWidth) : zoom / 100;

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-dark-panel text-slate-400">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Loader2 className="w-4 h-4 animate-spin text-logo-500" />
          正在载入文档...
        </div>
      </div>
    );
  }

  if (!activeNote) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-dark-panel text-slate-400 text-xs font-medium">
        暂无选中的笔记，请在左侧新建或选择笔记
      </div>
    );
  }

  /*
   * relative 与 fixed 必须互斥：Tailwind 的生成顺序是
   * .static → .fixed → .absolute → .relative → .sticky，
   * 两者同时挂在同一个元素上时 .relative 恒排在后面，全屏类名会被静默吃掉。
   *
   * 预览层取 z-[70]：要盖住设置弹窗与指令面板(60)，但得让 Toast(80)、Tooltip(90)、
   * 快捷键弹窗(100) 仍然浮在它上面 —— 预览只是「看文档」，不是最高优先级的模态。
   * fe-fade 直接复用第 22 节那条进入动画，不做退出动画（与全屏一致）。
   */
  return (
    <div
      ref={rootRef}
      className={`w-full h-full min-h-0 flex flex-col bg-white dark:bg-dark-panel overflow-hidden select-none ${
        previewing
          ? "fe-fade fe-preview fixed inset-0 z-[70]"
          : fullscreen
          ? "fixed inset-0 z-50"
          : "relative"
      }`}
    >
      {/* 顶部文档条：左显示当前文档名（列表滚动后仍能确认在编辑哪一篇），右为内核切换。
          预览态下它是「工具」，整条收掉；移动端标题已在顶栏、缩放靠手势，这条一并收掉 */}
      {!previewing && !isMobile && (
        <div className="relative z-40 flex-shrink-0 h-9 px-3 flex bg-white items-center justify-between gap-3 border-b border-slate-200/80 dark:border-dark-border dark:bg-dark-panel">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {activeNote.title || "未命名文档"}
          </span>
          <div className="flex flex-shrink-0 items-center gap-2">
            {/*
              当前读到哪。两个内核都有这条阅读位置（走同一条总线），
              不依赖目录胶囊是否存在 —— Cherry 没有胶囊，但进度照样该看得见。
            */}
            {livePosition && livePosition.percent > 0 && (
              <span className="hidden max-w-[14rem] truncate text-[11px] text-slate-400 lg:inline dark:text-slate-500">
                {livePosition.heading || "开头"} · {livePosition.percent}%
              </span>
            )}
            {/*
              记位置：按**当前滚动位置**记一条（块手柄那颗是按光标所在的那一段）。
              两个入口在长文里各有用处 —— 读到某处想先记一下时，滚轮比找光标快。
            */}
            <Tooltip content="记下当前阅读位置">
              <button
                type="button"
                onClick={handleAddBookmark}
                aria-label="记下当前阅读位置"
                className="flex h-8 items-center gap-1 rounded-md border border-slate-200/80 px-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-brand-500/40 hover:text-brand-600 dark:border-dark-border dark:text-slate-400 dark:hover:text-brand-400"
              >
                <Bookmark className="h-3.5 w-3.5" />
                记位置
                {bookmarks && bookmarks.length > 0 && (
                  <span className="rounded-full bg-brand-500/15 px-1 text-[10px] font-semibold tabular-nums text-brand-600 dark:text-brand-400">
                    {bookmarks.length}
                  </span>
                )}
              </button>
            </Tooltip>
            <EditorZoom />
            <EditorModeSwitch value={mode} onChange={handleModeChange} />
          </div>
        </div>
      )}

      {/* 兼容性提醒条：只在切进所见即所得、且文档含 Cherry 专有语法时出现 */}
      {!previewing && warning && (
        <div className="flex-shrink-0 flex items-start gap-2 px-3 py-2 border-b border-amber-200/70 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/10 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <TriangleAlert className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span className="min-w-0 flex-1">{warning}</span>
          <Tooltip content="关闭提醒">
            <button
              type="button"
              onClick={() => setWarning("")}
              className="flex-shrink-0 p-0.5 rounded hover:bg-amber-200/50 dark:hover:bg-amber-500/20 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </Tooltip>
        </div>
      )}

      {/* 编辑器主体：两个内核共享同一份 activeNote.content */}
      {/*
        缩放只作用于**正文**，不含编辑器自己的格式工具栏、右侧大纲与浮出的浮条。
        做法是把倍率作为 CSS 变量放在这一层，由 index.css 施加到正文的滚动容器上
        （见「.milkdown-scroll / .cherry」那两条规则）—— 直接 zoom 这一层会把工具栏一起放大。

        用 CSS zoom 而不是 transform: scale：前者会连带重算内部布局，
        滚动容器高度、正文折行、以及浮层依赖的 getBoundingClientRect 都还在同一套坐标系里；
        transform 只是视觉拉伸，滚动条与坐标全对不上。
      */}
      <div
        className="relative min-h-0 flex-1"
        style={{ "--editor-zoom": zoomValue } as CSSProperties}
      >
        {mode === "cherry" ? (
          <CherryMarkdownEditor
            key={activeNote.id}
            value={activeNote.content}
            onChange={handleContentChange}
            title={activeNote.title}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            onToggleFullscreen={toggleFullscreen}
            preview={previewing}
            onTogglePreview={togglePreview}
            noteId={activeNote.id}
            backToTop={{ visible: showBackToTop, onClick: handleBackToTop }}
            className="h-full"
          />
        ) : (
          <MilkdownMarkdownEditor
            key={activeNote.id}
            value={activeNote.content}
            onChange={handleContentChange}
            onWarning={setWarning}
            title={activeNote.title}
            onToggleFullscreen={toggleFullscreen}
            fullscreen={fullscreen}
            preview={previewing}
            onTogglePreview={togglePreview}
            noteId={activeNote.id}
            bookmarks={bookmarks}
            onJumpBookmark={handleJumpBookmark}
            onDeleteBookmark={(bookmark) =>
              handleDeleteReadingBookmark(activeNote.id, bookmark.id)
            }
            isBookmarkStale={isBookmarkStale}
            onBookmarkBlock={handleBookmarkBlock}
            backToTop={{ visible: showBackToTop, onClick: handleBackToTop }}
            className="h-full"
          />
        )}
      </div>

      {/* 底部状态栏：保存状态 + 文档统计 + 当前内核/视图，原本是浮在右下角的胶囊。
          移动端保存状态与字数已经收进顶栏胶囊，这里收掉避免重复 */}
      {!previewing && !isMobile && (
        <MarkdownStatusBar
          stats={stats}
          engineLabel={ENGINE_LABEL[mode]}
          viewLabel={
            mode === "cherry" ? VIEW_MODE_LABEL[viewMode] : SINGLE_COLUMN_LABEL
          }
          saveStatus={saveStatus}
          saveMessage={saveMessage}
          bookmark={activeBookmark}
          bookmarkStale={activeBookmark ? isBookmarkStale(activeBookmark) : false}
          onJumpBookmark={() => activeBookmark && handleJumpBookmark(activeBookmark)}
        />
      )}

      {/* 预览态把工具条全收掉了，退出入口只留这一颗（以及 Esc）。
          配色刻意与文档条同源（实色 bg-slate-50 / dark:bg-dark-sidebar）：
          带透明度后缀的 bg-white/70 命中不了 html[data-theme='…'] .bg-white 那批主题覆盖 */}
      {previewing && (
        <div className="absolute right-5 top-4 z-30">
          <Tooltip content="退出预览（Esc）">
            <button
              type="button"
              onClick={togglePreview}
              aria-label="退出预览"
              className="flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-xs transition-colors hover:bg-slate-100 hover:text-brand-600 dark:border-dark-border dark:bg-dark-sidebar dark:text-slate-400 dark:hover:bg-dark-hover dark:hover:text-brand-400"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              退出预览
            </button>
          </Tooltip>
        </div>
      )}

      {/* 「返回顶部」已经挪进工具栏（见 MarkdownToolbar 的 backToTop），
          原先右下角的浮动按钮在移动端会贴到格式工具条上 */}

      {/* 记书签的备注弹窗。挂在最外层（含弹窗遮罩）—— 预览态下也要能弹出来 */}
      <BookmarkNoteDialog
        draft={bookmarkDraft}
        onConfirm={handleConfirmBookmark}
        onCancel={() => setBookmarkDraft(null)}
      />
    </div>
  );
}
