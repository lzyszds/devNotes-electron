import { useCallback, useEffect, useId, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import Cherry from 'cherry-markdown'
import 'cherry-markdown/dist/cherry-markdown.css'
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

type CherryInstance = InstanceType<typeof Cherry>

/** 分栏比例落盘的键。Cherry 自己不管这个，拖完由我们记一下 */
const SPLIT_STORAGE_KEY = 'fehelper-editor-split'
/** Cherry 的 minBlockPercentage 默认 0.2，两侧都夹在 20%~80% */
const SPLIT_MIN = 20
const SPLIT_MAX = 80

export type CherryMarkdownEditorProps = {
  value: string
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
}: CherryMarkdownEditorProps) {
  const { registerInsertHandler } = useNotes()
  const reactId = useId().replace(/:/g, '')
  const containerId = `cherry-notes-${reactId}`
  const mountRef = useRef<HTMLDivElement>(null)
  const cherryRef = useRef<CherryInstance | null>(null)
  const onChangeRef = useRef(onChange)
  const suppressChangeRef = useRef(false)
  const latestValueRef = useRef(value)

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
          const url = await fileToDataUrl(file)
          callback(url, { name: file.name })
        } catch (error) {
          console.error('笔记附件上传失败:', error)
        }
      },
      callback: {
        afterChange: (md: string) => {
          if (suppressChangeRef.current) return
          latestValueRef.current = md
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

  useEffect(() => {
    const cherry = cherryRef.current
    if (!cherry) return

    const current = cherry.getMarkdown()
    if (current === value) return

    suppressChangeRef.current = true
    try {
      cherry.setMarkdown(value, false)
    } finally {
      // 给渲染一帧时间，避免把程序写入当作用户编辑
      requestAnimationFrame(() => {
        suppressChangeRef.current = false
      })
    }
  }, [value])

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
          />
        </div>
      )}
      <div className="relative min-h-0 flex-1 max-md:order-1">
        <div id={containerId} ref={mountRef} className="h-full w-full" />
      </div>
    </div>
  )
}
