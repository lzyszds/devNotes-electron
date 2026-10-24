import { useCallback, useEffect, useId, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ReactNode } from 'react'
import { Download, ListTree, Maximize2, Presentation, Search } from 'lucide-react'
import Cherry from 'cherry-markdown'
import 'cherry-markdown/dist/cherry-markdown.css'
import Tooltip from '../ui/Tooltip'
import { useNotes } from '../../context/NotesContext'
import { attachDomTooltips } from '../ui/domTooltip'
import { useEditorContextMenu } from '../../hooks/useEditorContextMenu'
import { createCherryAdapter } from '../../utils/cherryAdapter'
import MarkdownToolbar from './markdown/MarkdownToolbar'
import type { ToolbarItemState } from './markdown/MarkdownToolbar'
import ViewModeSwitch, { type EditorViewMode } from './markdown/ViewModeSwitch'
import { execCherryCommand } from './markdown/dispatch'
import { CHERRY_TOOLBAR_CONFIG, commandsFor } from './markdown/toolbarSpec'
import type { MarkdownCommand } from './markdown/toolbarSpec'
import {
  getCachedCodeBlockTheme,
  getCodeBlockPreset,
  subscribeCodeBlockTheme,
} from '../../utils/codeBlockTheme'
import {
  publishReadingPosition,
  subscribeOutlineJump,
  subscribeReadingJump,
} from '../../utils/editorBus'
import {
  jumpToCherryBookmark,
  measureCherryReading,
  revealCherryOutlineItem,
} from '../../utils/cherryOutline'
import { uploadSyncImage } from '../../utils/cloudflareSync'

type CherryInstance = InstanceType<typeof Cherry>

/** 分栏比例落盘的键。Cherry 自己不管这个，拖完由我们记一下 */
const SPLIT_STORAGE_KEY = 'fehelper-editor-split'
/** Cherry 的 minBlockPercentage 默认 0.2，两侧都夹在 20%~80% */
const SPLIT_MIN = 20
const SPLIT_MAX = 80

export type CherryMarkdownEditorProps = {
  value: string
  /**
   * 正文被外部换过的次数（云端拉取 / 快照恢复 / 文件刷新）。
   *
   * 整篇重载的唯一触发信号。早先这里监听 [value] 并与 getMarkdown() 比字符串，
   * Cherry 的序列化与 CodeMirror 内容不保证字节级一致，于是每敲几下键就会
   * setMarkdown 整篇替换一次 —— 光标被重置、预览整篇重排。自己敲字不推进
   * revision，这个 effect 就永远不会为用户输入而跑。
   */
  contentRevision?: number
  onChange?: (markdown: string) => void
  className?: string
  /** 当前笔记标题，供右键菜单的「Front Matter」「当前文档信息」使用 */
  title?: string
  /** 视图三态。状态由 NotesTool 持有，底部状态栏要显示它 */
  viewMode: EditorViewMode
  onViewModeChange: (mode: EditorViewMode) => void
  /** 右键菜单里的「全屏」「查找替换」「大纲」由宿主统一分派（两个内核共用一套实现） */
  onToggleFullscreen?: () => void
  onOpenSearch?: () => void
  onToggleOutline?: () => void
  /** 全屏预览态（只读 + 铺满视口）。由宿主统一切换，两个内核共用同一份状态 */
  preview?: boolean
  onTogglePreview?: () => void
  /** 「返回顶部」：状态与回调都在宿主（NotesTool），这里只透传给工具栏 */
  backToTop?: { visible: boolean; onClick: () => void }
  /** 笔记页自己的控件（内核切换、缩放）。摆在工具栏最右端 */
  toolbarExtra?: ReactNode
  /** 笔记页自己的控件（内核切换）。摆在工具栏左端 */
  toolbarLeading?: ReactNode
  /** 当前笔记 id。随阅读位置一起上报，供外壳认领「这份数据是哪一篇的」 */
  noteId?: string
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function readSplitRatio(): number | null {
  const saved = Number(localStorage.getItem(SPLIT_STORAGE_KEY))
  if (!Number.isFinite(saved) || saved < SPLIT_MIN || saved > SPLIT_MAX) return null
  return saved
}

/** 视图三态 → Cherry 的 switchModel 取值 */
const MODEL_BY_VIEW: Record<EditorViewMode, 'editOnly' | 'edit&preview' | 'previewOnly'> = {
  edit: 'editOnly',
  split: 'edit&preview',
  preview: 'previewOnly',
}

export default function CherryMarkdownEditor({
  value,
  contentRevision = 0,
  onChange,
  className = '',
  title = '',
  viewMode,
  onViewModeChange,
  onToggleFullscreen,
  onOpenSearch,
  onToggleOutline,
  preview = false,
  onTogglePreview,
  backToTop,
  toolbarExtra,
  toolbarLeading,
  noteId = '',
}: CherryMarkdownEditorProps) {
  const { registerInsertHandler } = useNotes()
  const reactId = useId().replace(/:/g, '')
  const containerId = `cherry-notes-${reactId}`
  const mountRef = useRef<HTMLDivElement>(null)
  const cherryRef = useRef<CherryInstance | null>(null)
  const onChangeRef = useRef(onChange)
  const suppressChangeRef = useRef(false)
  const latestValueRef = useRef(value)
  // 自己最近一次抛出去的 markdown。外部换进来的正文与它不同才值得整篇重载
  const lastEmittedRef = useRef(value)

  const lastSplitRef = useRef<number | null>(null)

  /**
   * 适配器只建一次：右键菜单的每个菜单项都闭包引用它，
   * 每次渲染重建会让整棵 70 项菜单树跟着重建。
   * cherryRef 是 ref，读它永远是当前实例，所以这里缓存是安全的。
   */
  const adapter = useMemo(() => createCherryAdapter(cherryRef), [])

  /** 「切换编辑 / 预览模式」在宿主三态里循环一圈 */
  const cycleViewMode = useCallback(() => {
    const order: EditorViewMode[] = ['edit', 'split', 'preview']
    const next = order[(order.indexOf(viewMode) + 1) % order.length]
    onViewModeChange(next)
  }, [viewMode, onViewModeChange])

  /**
   * 「大纲」—— 切换 Cherry 自带的侧边大纲浮层。
   *
   * 注意不要用 toolbarHandlers.toc：那个 handler 叫「插入目录」，只是往正文插一行
   * `[[toc]]`，跟大纲浮层没关系。浮层（.cherry-flex-toc）由公开方法 toggleToc() 切换。
   */
  const toggleOutline = useCallback(() => {
    try {
      ;(cherryRef.current as unknown as { toggleToc?: (model?: string) => void })?.toggleToc?.()
    } catch (error) {
      console.error('切换大纲失败:', error)
    }
  }, [])

  const { onEditorContextMenu, onPreviewContextMenu } = useEditorContextMenu({
    adapter,
    title,
    onRequestViewMode: cycleViewMode,
    onRequestFullscreen: onToggleFullscreen,
    onRequestSearch: onOpenSearch,
    onRequestOutline: onToggleOutline,
  })

  // 「导出…」仍然交给 Cherry 自己的导出菜单：它带 pdf / 截图 / markdown / html / word
  // 五种格式，比 NotesContext.handleExport 只能存 .md 更全。adapter.invokeNative('export')
  // 已经接好了这条路，不需要宿主传 onExport 进来。

  /**
   * 编辑区与预览区同在这个容器里，按事件目标分流：
   * - .cm-editor      → 可编辑菜单（真正能改文档）
   * - .cherry-previewer → 只读菜单（复制/导出）
   * 工具栏、TOC 侧栏等其它区域不接管，交给浏览器默认行为。
   */
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('.cm-editor')) {
        onEditorContextMenu(event)
        return
      }
      if (target.closest('.cherry-previewer')) {
        onPreviewContextMenu(event)
      }
    },
    [onEditorContextMenu, onPreviewContextMenu]
  )

  useEffect(() => {
    registerInsertHandler((prefix: string, suffix = '') => {
      const cherry = cherryRef.current
      if (!cherry) return
      try {
        const current = cherry.getMarkdown()
        const newMd = current + (current.endsWith('\n') ? '' : '\n') + prefix + suffix
        cherry.setMarkdown(newMd, false)
        // 记账：这份 markdown 是我们刚写进编辑器的，外部回流时别再当陌生内容
        lastEmittedRef.current = newMd
        onChangeRef.current?.(newMd)
      } catch (err) {
        console.error('Insert text failed:', err)
      }
    })
  }, [registerInsertHandler])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

  useEffect(() => {
    if (!mountRef.current) return

    const cherry = new Cherry({
      id: containerId,
      value: latestValueRef.current,
      locale: 'zh_CN',
      nameSpace: 'fehelper-cherry-notes',
      forceAppend: false,
      autoScrollByCursor: true,
      editor: {
        defaultModel: 'edit&preview',
        keepDocumentScrollAfterInit: true,
        showSuggestList: true,
        codemirror: {
          placeholder: '输入文本或「/」开始编辑',
        },
      },
      engine: {
        syntax: {
          panel: {
            enableJustify: true,
            enableAlign: true,
            enablePanel: true,
            enableCols: true,
            enableTabs: true,
            enableTimeline: true,
          },
        },
      },
      /*
       * 明暗不再交给 Cherry 自己的主题。它那套 .cherry.theme__dark 与我们的换肤规则
       * 特异度相同，谁赢只看文档顺序；而且 mainTheme 还会被 localStorage 里的旧值顶掉。
       * 这里统一钉在 default，深色完全由 index.css 里带 html.dark 前缀的规则负责。
       */
      themeSettings: {
        // themeList 只在主题切换菜单里用得到，而那个菜单随原生工具栏一起隐形了，给个最小合法值即可
        themeList: [
          { className: 'default', label: '默认' },
          { className: 'dark', label: '暗色' },
        ],
        mainTheme: 'default',
        // 代码块配色由「设置 → 通用 → 代码块主题」决定，与上面的 mainTheme 互相独立
        codeBlockTheme: getCodeBlockPreset(getCachedCodeBlockTheme()).cherry,
        inlineCodeTheme: 'red',
      },
      toolbars: {
        theme: 'light',
        showToolbar: true,
        /**
         * 这份配置是给「隐形原生工具栏」用的：它不给人看，只提供两样东西 ——
         *   1. 命令入口：自绘工具栏点击后合成指针事件派发到这里
         *   2. 弹层锚点：Cherry 的下拉靠按钮的 offsetLeft/offsetTop 定位
         * 所以这里必须是「一项一个按钮」的扁平清单，且不能有重名。
         * 特别注意 table/quickTable、code/inlineCode 这几组会撞类名，
         * 只保留其中一个（见 toolbarSpec.ts 的 CHERRY_CLASS_SUFFIX）。
         */
        toolbar: CHERRY_TOOLBAR_CONFIG,
        toolbarRight: [],
        bubble: [
          'bold',
          'italic',
          'underline',
          'strikethrough',
          'sub',
          'sup',
          'quote',
          '|',
          'size',
          'color',
        ],
        float: ['h1', 'h2', 'h3', '|', 'checklist', 'quote', 'table', 'code', 'timeline'],
        toc: {
          updateLocationHash: false,
          defaultModel: 'pure',
          showAutoNumber: false,
        },
      },
      fileUpload: async (file: File, callback: (url: string, params?: Record<string, unknown>) => void) => {
        try {
          // 优先上传至云端服务器，获取干净轻量的公网 URL，杜绝庞大 Base64 塞满 Markdown
          const uploadRes = await uploadSyncImage(file, file.name)
          if (uploadRes.ok && uploadRes.url) {
            callback(uploadRes.url, { name: file.name, isShadow: true })
            return
          }
          // 未开启云同步或上传未成功时，降级为 Data URL 保证本地即时可用
          const url = await fileToDataUrl(file)
          callback(url, { name: file.name })
        } catch (error) {
          console.error('笔记附件云端上传失败，降级本地存储:', error)
          const url = await fileToDataUrl(file)
          callback(url, { name: file.name })
        }
      },
      callback: {
        afterChange: (md: string) => {
          if (suppressChangeRef.current) return
          latestValueRef.current = md
          lastEmittedRef.current = md
          onChangeRef.current?.(md)
        },
      },
    })

    cherryRef.current = cherry

    /**
     * 主题必须构造后再强制设一次。
     * Cherry 的 createWrapper() 里写的是：
     *   FB(nameSpace, 'theme') ? IB(true, nameSpace) : options.themeSettings.mainTheme
     * 也就是只要 localStorage 里存过 '<nameSpace>-theme'（本项目 = fehelper-cherry-notes-theme），
     * themeSettings 就被完全忽略 —— 老版本存过的 'dark' 会让新代码「时灵时不灵」。
     * 这里钉回 default，顺带把 localStorage 也纠正回来（setTheme 内部会回写）。
     */
    cherry.setTheme('default')
    // 同理，localStorage['fehelper-cherry-notes-codeTheme'] 里存过的旧值也会盖掉构造参数，
    // 这里按当前设置钉一次；订阅 effect 负责后续的实时切换
    cherry.setCodeBlockTheme(getCodeBlockPreset(getCachedCodeBlockTheme()).cherry)

    // 恢复上次拖出来的分栏比例
    const savedSplit = readSplitRatio()
    if (savedSplit !== null) {
      lastSplitRef.current = savedSplit
      cherry.previewer?.setRealLayout(`${savedSplit}%`, `${100 - savedSplit}%`)
    }

    // 容器尺寸变化时刷新编辑区，避免 Tab 切换后高度异常
    const observer = new ResizeObserver(() => {
      try {
        const view = (cherry as any)?.editor?.editor
        view?.requestMeasure?.()
      } catch {
        // ignore
      }
    })
    observer.observe(mountRef.current)

    /*
     * 构造期间外部可能已换过正文（云端拉取、快照恢复正好落在挂载窗口里）：
     * 那时 cherryRef 还没就绪，下面的 revision effect 会直接 return 且不推进
     * lastRevisionRef —— 之后 revision 不再变化，这一篇就永远停在旧正文上。
     * 与 Milkdown 一致，构造完成后补一次同步。
     *
     * lastEmittedRef 也要跟着改：它记的是「编辑器里此刻是什么」，不更新的话
     * 之后同内容的外部刷新会被误判成「和现有的不一样」，白白整篇重写一次。
     */
    if (contentRevisionRef.current !== lastRevisionRef.current) {
      lastRevisionRef.current = contentRevisionRef.current
      if (latestValueRef.current !== lastEmittedRef.current) {
        lastEmittedRef.current = latestValueRef.current
        suppressChangeRef.current = true
        try {
          cherry.setMarkdown(latestValueRef.current, false)
        } finally {
          requestAnimationFrame(() => {
            suppressChangeRef.current = false
          })
        }
      }
    }

    return () => {
      observer.disconnect()
      try {
        cherry.destroy()
      } catch {
        // ignore
      }
      cherryRef.current = null
    }
  }, [containerId])

  // 视图三态。注意第二参必须留默认 true：
  // 传 false 会 emit('toolbarHide') → 给 wrapper 加 cherry--no-toolbar
  // → CSS 把 .cherry-toolbar 变成 display:none，隐形工具栏的布局盒消失，下拉定位就全废了。
  //
  // 全屏预览时钉在 previewOnly：源码区被 Cherry 自己收起，预览区拿到 --full 铺满，
  // 整个界面也就没有可编辑的地方了。退出时这里会按 viewMode 再切回去，用户原来的
  // 三态不受影响。
  useEffect(() => {
    const cherry = cherryRef.current
    if (!cherry) return
    cherry.switchModel(preview ? 'previewOnly' : MODEL_BY_VIEW[viewMode])
  }, [viewMode, preview])

  // 设置面板里改了代码块主题，已经挂载的实例要立刻跟着变（Cherry 只换 .cherry 上的
  // data-code-block-theme 属性，纯 CSS 生效，不需要重建实例）
  useEffect(
    () =>
      subscribeCodeBlockTheme((id) => {
        cherryRef.current?.setCodeBlockTheme(getCodeBlockPreset(id).cherry)
      }),
    []
  )

  // ================= 大纲与阅读位置 =================
  /*
   * 扫描标题 + 上报滚动进度。
   *
   * 依赖里有 value / viewMode / preview：切视图会换掉渲染层（双栏 ↔ 单栏 ↔ 纯预览），
   * 预览区跟着挂起/恢复，不重挂监听就会盯着一个已经不可见的容器算进度。
   *
   * 滚动用捕获监听挂在外层：scroll 不冒泡但走捕获，预览区在子树里，能收到。
   * 首次测量用 setTimeout 推到下一轮 —— Cherry 的预览区是异步建出来的，
   * 挂载这一帧它还不存在。
   */
  useEffect(() => {
    const root = mountRef.current
    if (!root || preview) return

    let frame = 0
    const measure = () => {
      frame = 0
      const state = measureCherryReading(root)
      publishReadingPosition({
        noteId,
        activeIndex: state.activeIndex,
        percent: state.percent,
        heading: state.heading,
        container: state.container,
      })
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    const timer = window.setTimeout(measure, 0)
    root.addEventListener('scroll', onScroll, true)
    return () => {
      window.clearTimeout(timer)
      root.removeEventListener('scroll', onScroll, true)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [value, viewMode, preview, noteId])

  /** 两个跳转入口从总线进来（触发方是外壳的目录与书签按钮） */
  useEffect(
    () => subscribeOutlineJump((index) => revealCherryOutlineItem(mountRef.current, index)),
    []
  )

  useEffect(
    () => subscribeReadingJump((target) => jumpToCherryBookmark(mountRef.current, target)),
    []
  )

  /**
   * 分栏比例落盘。不挂 Cherry 的 layoutChange 事件，直接在中缝拖动结束（mouseup）时读一次实际宽度：
   * 少一个对内部事件总线的依赖，且比例只在真正拖过之后才写。
   */
  useEffect(() => {
    const root = mountRef.current
    if (!root) return

    const handleMouseUp = () => {
      const editorDom = root.querySelector<HTMLElement>('.cherry-editor')
      const previewerDom = root.querySelector<HTMLElement>('.cherry-previewer')
      if (!editorDom || !previewerDom) return

      const editorWidth = editorDom.getBoundingClientRect().width
      const total = editorWidth + previewerDom.getBoundingClientRect().width
      if (total <= 0) return

      const ratio = Math.round((editorWidth / total) * 100)
      if (ratio < SPLIT_MIN || ratio > SPLIT_MAX) return
      if (ratio === lastSplitRef.current) return

      lastSplitRef.current = ratio
      localStorage.setItem(SPLIT_STORAGE_KEY, String(ratio))
    }

    root.addEventListener('mouseup', handleMouseUp)
    return () => root.removeEventListener('mouseup', handleMouseUp)
  }, [containerId])

  /**
   * 原生弹层（下拉、气泡工具栏、块级浮动菜单）的提示改成和全站一致的自绘气泡。
   * Cherry 把文案挂在原生 title 上(取自它的 zh_CN locale)，attachDomTooltips 会把它搬进
   * data-qtip 并摘掉 title，否则系统灰框会和自绘气泡一起冒出来。
   * 自绘工具栏是 React 组件、自带 Tooltip，这里不再需要管 .cherry-toolbar。
   */
  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    return attachDomTooltips(container, {
      selector: [
        '.cherry-dropdown-item[title]',
        '.cherry-bubble [title]',
        '.cherry-floatmenu [title]',
      ].join(', '),
    })
  }, [containerId])

  /*
   * 外部正文回流：只在 contentRevision 推进时整篇替换。
   *
   * 早先这里依赖 [value]，并与 cherry.getMarkdown() 比字符串。问题在于
   * getMarkdown() 返回的是 CodeMirror 的当前内容，与 afterChange 抛出去的那份
   * 不保证字节级一致（尾部换行、CRLF、自动补的空行），一旦有差就会
   * setMarkdown 整篇替换 —— 光标被重置、预览整篇重排，用户看到的就是
   * 「改一个小东西，整篇笔记的格式全乱了」。
   *
   * 改成 revision 后，只有云端拉取 / 快照恢复 / 文件刷新才会走到这里
   * （见 NotesContext.applyExternalState）；用户自己敲字推进的是 afterChange
   * 那条路，永远不触发整篇替换。
   */
  const lastRevisionRef = useRef(contentRevision)
  // 构造 effect 只在挂载时跑一次，闭包里拿得到的是首渲染的 revision ——
  // 补同步要用「此刻最新」的那个，所以另存一份
  const contentRevisionRef = useRef(contentRevision)
  contentRevisionRef.current = contentRevision
  useEffect(() => {
    const cherry = cherryRef.current
    if (!cherry) return
    if (contentRevision === lastRevisionRef.current) return
    lastRevisionRef.current = contentRevision
    // 外部换进来的正文与编辑器里现有的一致时不必重写
    if (value === lastEmittedRef.current) return

    suppressChangeRef.current = true
    lastEmittedRef.current = value
    try {
      cherry.setMarkdown(value, false)
    } finally {
      // 给渲染一帧时间，避免把程序写入当作用户编辑
      requestAnimationFrame(() => {
        suppressChangeRef.current = false
      })
    }
  }, [contentRevision, value])

  /**
   * 工具栏命令派发。
   *
   * 三颗按钮不再走 Cherry 的原生 handler：
   *   outline    → Cherry 的 toc handler 是「插入 [[toc]] 文本」，不是大纲浮层（见 toggleOutline）
   *   fullscreen → Cherry 的 fullScreen 只是给 DOM 加个 class，改由宿主统一实现
   *   search     → 由宿主分派（两个内核各有一套查找 UI）
   */
  const handleCommand = useCallback(
    (command: MarkdownCommand, anchor: HTMLElement) => {
      if (command.id === 'outline') {
        toggleOutline()
        return
      }
      if (command.id === 'fullscreen') {
        onToggleFullscreen?.()
        return
      }
      if (command.id === 'preview') {
        onTogglePreview?.()
        return
      }
      if (command.id === 'search') {
        onOpenSearch?.()
        return
      }
      const root = mountRef.current
      if (!root || !command.cherry) return
      execCherryCommand(root, command.cherry, anchor)
    },
    [onOpenSearch, onToggleFullscreen, onTogglePreview, toggleOutline]
  )

  /**
   * 纯预览态下原生工具栏被 Cherry 加上 preview-only（按钮全部 display:none），
   * 格式化命令点了也只是作用在隐藏的编辑区上。这里直接把左侧那组藏掉，
   * 只留大纲/搜索/全屏/导出 —— 宁可少一颗按钮，也不留一颗点了没反应的。
   */
  const toolbarState = useMemo<Record<string, ToolbarItemState> | undefined>(() => {
    if (viewMode !== 'preview') return undefined
    const next: Record<string, ToolbarItemState> = {}
    for (const command of commandsFor('cherry')) {
      if (command.align !== 'right') next[command.id] = { hidden: true }
    }
    return next
  }, [viewMode])

  return (
    <div
      className={`cherry-notes-editor flex h-full min-h-0 flex-col ${className}`}
      onContextMenu={handleContextMenu}
    >
      {/* 预览态是只读的，工具栏上每一颗按钮都点不出效果，连同视图切换一起收掉。
          移动端把工具栏挪到底部，当作键盘上方的格式配件条。 */}
      {!preview && (
        <div className="max-md:order-2 max-md:bg-white max-md:pb-[env(safe-area-inset-bottom)] max-md:dark:bg-dark-panel">
          <MarkdownToolbar
            engine="cherry"
            onCommand={handleCommand}
            state={toolbarState}
            trailing={<ViewModeSwitch value={viewMode} onChange={onViewModeChange} />}
            backToTop={backToTop}
            extra={toolbarExtra}
            leading={toolbarLeading}
          />
        </div>
      )}
      <div className="relative min-h-0 flex-1 max-md:order-1">
        <div id={containerId} ref={mountRef} className="h-full w-full" />

        {/* 右侧悬浮操作胶囊 */}
        <div className="absolute inset-y-0 right-4 z-20 flex flex-col items-end justify-center py-3 select-none pointer-events-none">
          <div className="w-[32px] flex flex-col items-center gap-1 p-1 rounded-xl border border-black/[0.08] bg-white/95 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-md pointer-events-auto">
            {/* 大纲 */}
            <Tooltip content="目录大纲" placement="right">
              <button
                type="button"
                aria-label="目录大纲"
                onClick={toggleOutline}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[#787774] hover:bg-black/[0.05] hover:text-[#191918] transition-colors cursor-pointer"
              >
                <ListTree className="h-3.5 w-3.5" />
              </button>
            </Tooltip>

            <span className="w-4 h-px bg-black/[0.06] my-0.5" />

            {/* 搜索 */}
            {onOpenSearch && (
              <Tooltip content="搜索替换 (⌘F)" placement="right">
                <button
                  type="button"
                  aria-label="搜索替换"
                  onClick={onOpenSearch}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-[#787774] hover:bg-black/[0.05] hover:text-[#191918] transition-colors cursor-pointer"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}

            {/* 全屏 */}
            {onToggleFullscreen && (
              <Tooltip content="全屏沉浸 (F11)" placement="right">
                <button
                  type="button"
                  aria-label="全屏"
                  onClick={onToggleFullscreen}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-[#787774] hover:bg-black/[0.05] hover:text-[#191918] transition-colors cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}

            {/* 预览 */}
            {onTogglePreview && (
              <Tooltip content="预览阅读" placement="right">
                <button
                  type="button"
                  aria-label="预览阅读"
                  onClick={onTogglePreview}
                  className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                    preview ? "bg-[#1C1C1C] text-white" : "text-[#787774] hover:bg-black/[0.05] hover:text-[#191918]"
                  }`}
                >
                  <Presentation className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}

            {/* 导出 */}
            <span className="w-4 h-px bg-black/[0.06] my-0.5" />
            <Tooltip content="导出" placement="right">
              <button
                type="button"
                aria-label="导出"
                onClick={() => handleCommand({ id: 'export', label: '导出', icon: Download, group: 6 }, document.body)}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[#787774] hover:bg-black/[0.05] hover:text-[#191918] transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}
