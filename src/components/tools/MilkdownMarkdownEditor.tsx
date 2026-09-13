import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { history } from '@milkdown/kit/plugin/history'
import { indent } from '@milkdown/kit/plugin/indent'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { codeBlockAttr, commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { Plugin } from '@milkdown/kit/prose/state'
import { $prose, insert, replaceAll } from '@milkdown/kit/utils'
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight'
import { createParser } from '@milkdown/plugin-highlight/lowlight'
import { common as commonLanguages, createLowlight } from 'lowlight'
import { useNotes } from '../../context/NotesContext'
import { getCachedCodeBlockTheme, subscribeCodeBlockTheme } from '../../utils/codeBlockTheme'
import { applyMilkdownCodeTheme } from '../../utils/milkdownCodeTheme'
import { createMilkdownAdapter } from '../../utils/milkdownAdapter'
import { inlineHtmlView } from '../../utils/milkdownHtmlView'
import { milkdownSearchPlugin } from '../../utils/milkdownSearch'
import { collectOutline, revealOutlineItem } from '../../utils/milkdownOutline'
import type { OutlineItem } from '../../utils/milkdownOutline'
import { useEditorContextMenu } from '../../hooks/useEditorContextMenu'
import MarkdownToolbar from './markdown/MarkdownToolbar'
import EditorOutline from './markdown/EditorOutline'
import FindReplaceBar from './markdown/FindReplaceBar'
import SlashMenu, { slash } from './markdown/SlashMenu'
import BlockHandle, { block } from './markdown/BlockHandle'
import {
  getCurrentHeadingLevel,
  insertMilkdownImage,
  runMilkdownCommand,
  setMilkdownHeading,
  setMilkdownLink,
} from './markdown/milkdownCommands'
import type { MarkdownCommand } from './markdown/toolbarSpec'
import type { ToolbarItemState } from './markdown/MarkdownToolbar'

// Milkdown 自带的排版样式。prosemirror.css 是必需的(定位、断词、gapcursor)；
// 表格与 gapcursor 的样式只在用到对应能力时才有内容,一并引入省得漏。
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import '@milkdown/kit/prose/tables/style/tables.css'

export type MilkdownMarkdownEditorProps = {
  value: string
  onChange?: (markdown: string) => void
  className?: string
  /** 内容里含 Cherry 专有语法时回调一次,由宿主决定怎么提示 */
  onWarning?: (message: string) => void
  /** 当前笔记标题，供右键菜单的「Front Matter」「当前文档信息」使用 */
  title?: string
  /** 右键菜单里的「全屏」「查找替换」「大纲」由宿主统一分派（两个内核共用一套实现） */
  onToggleFullscreen?: () => void
  onOpenSearch?: () => void
  onToggleOutline?: () => void
  /** 宿主是否处于全屏态，用于短暂屏蔽 Esc 退出全屏之外的干扰 */
  fullscreen?: boolean
}

/**
 * Cherry 专有块语法(::: panel / cols / tabs / timeline …)不属于 CommonMark/GFM。
 * Milkdown 会把它当普通段落渲染,而且只要用户在这里改一个字,整篇会被重新序列化写回,
 * 这些块的结构就丢了。检测到就提示,让用户可以选择切回双栏模式编辑。
 */
const CHERRY_ONLY_BLOCK = /^[ \t]*:::[ \t]*\w/m

/** 标题下拉的选项。0 表示退回正文,与 Cherry 侧的「正文」项对齐 */
const HEADING_OPTIONS: { level: number; label: string }[] = [
  { level: 1, label: '标题 1' },
  { level: 2, label: '标题 2' },
  { level: 3, label: '标题 3' },
  { level: 4, label: '标题 4' },
  { level: 5, label: '标题 5' },
  { level: 6, label: '标题 6' },
  { level: 0, label: '正文' },
]

/** 需要先收一个参数才能执行的命令,点击后弹出输入层 */
type PopupKind = 'heading' | 'link' | 'image'

// 语法分析器建一次就够:把 highlight.js 的常用语言集交给 lowlight,
// 由它产出 hast,再交给 prosemirror-highlight 转成 ProseMirror 装饰。
const lowlight = createLowlight(commonLanguages)
const highlightParser = createParser(lowlight)

/**
 * lowlight 遇到没注册的语言(如 ```mermaid)会直接抛错,而 prosemirror-highlight
 * 是把整篇代码块放在同一个 try 里逐个解析的 —— 一个 mermaid 块就会让**全文所有**
 * 代码块一起失去高亮。这里先把不认识的语言挡在外面,退化成「不上色」而不是「全崩」。
 */
const safeHighlightParser = (options: Parameters<typeof highlightParser>[0]) => {
  const { language } = options
  if (language && !lowlight.registered(language)) return []
  return highlightParser(options)
}

/** 勾选框热区宽度(px)。方框本身 13px,留点余量;再往右就是正文了,点那儿应该是放光标 */
const TASK_CHECKBOX_HIT_AREA = 20

/**
 * 点击任务项左侧的方框切换勾选。
 *
 * gfm 只把勾选状态落成了 list_item 的 DOM 属性,没有配任何点击处理 ——
 * 不补这个插件,index.css 里画出来的方框就是个点不动的摆设。
 */
const taskListClickPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleClickOn(view, _pos, node, nodePos, event) {
          if (node.type.name !== 'list_item' || node.attrs.checked == null) return false

          const dom = view.nodeDOM(nodePos)
          if (!(dom instanceof HTMLElement)) return false
          // 只在左侧方框那一小块当勾选用,点正文交给默认行为放光标
          if (event.clientX - dom.getBoundingClientRect().left > TASK_CHECKBOX_HIT_AREA) {
            return false
          }

          view.dispatch(
            view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            })
          )
          return true
        },
      },
    })
)

/**
 * 所见即所得内核(Milkdown)。
 *
 * 与 Cherry 那套「构造原生实例 + 隐形原生工具栏」不同,Milkdown 没有 UI 外壳,
 * 自己就是 ProseMirror 的 EditorView,所以工具栏是纯 React 的、命令直连(见 milkdownCommands.ts)。
 *
 * 内容同步沿用与 Cherry 同构的三层防回环:
 *   1. suppressChangeRef 标记程序化写入,期间不往外抛 onChange
 *   2. 往外抛过的 markdown 记在 lastEmittedRef,外部 value 回流时先比字符串,是自己刚吐的就跳过
 *   3. 写入后 requestAnimationFrame 复位标志,避开同一帧里 listener 的延迟回调
 */
export default function MilkdownMarkdownEditor({
  value,
  onChange,
  className = '',
  onWarning,
  title = '',
  onToggleFullscreen,
  onOpenSearch,
  onToggleOutline,
  fullscreen = false,
}: MilkdownMarkdownEditorProps) {
  const { registerInsertHandler, handleExport } = useNotes()

  const mountRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const onChangeRef = useRef(onChange)
  const onWarningRef = useRef(onWarning)
  // 只在挂载时喂给 Milkdown;挂载 effect 不能依赖 value,否则每次打字都重建实例
  const latestValueRef = useRef(value)
  // 自己最近一次抛出去的 markdown,用来把回流认出来
  const lastEmittedRef = useRef(value)
  // 程序化写入期间屏蔽 listener,防「写入 → listener → onChange → setState → 再写入」回环
  const suppressChangeRef = useRef(false)
  // create() 是异步的,就绪前 listener 拿不到实例、也不该收外部写入
  const readyRef = useRef(false)

  const [popup, setPopup] = useState<PopupKind | null>(null)
  const [popupText, setPopupText] = useState('')
  const [headingLevel, setHeadingLevel] = useState(0)
  // 大纲浮层：显示与否 + 当前条目。工具栏的 active 态也要跟着走
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [activeOutlinePos, setActiveOutlinePos] = useState<number | null>(null)
  // 查找替换条只由编辑器自己管：宿主那边没有别的入口会打开它
  const [searchOpen, setSearchOpen] = useState(false)
  /**
   * 实例就绪后才把编辑器交给斜杠菜单/块手柄。
   *
   * 这两个组件的 Provider 需要 editor.ctx 与已挂载的 DOM，
   * 而 editorRef 是 ref、变了不触发渲染，所以额外用一份 state 做「已就绪」信号。
   */
  const [ready, setReady] = useState<Editor | null>(null)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onWarningRef.current = onWarning
  }, [onWarning])

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

  /** 命令执行后焦点会留在工具栏按钮上,补一次聚焦,否则接着打字没反应 */
  const focusEditor = useCallback(() => {
    editorRef.current?.action((ctx) => ctx.get(editorViewCtx).focus())
  }, [])

  /** 导出直接落到 .md（Cherry 侧走它自己的多格式导出菜单，见 CherryMarkdownEditor） */
  const handleExportRef = useRef(handleExport)
  useEffect(() => {
    handleExportRef.current = handleExport
  }, [handleExport])

  /**
   * 适配器只建一次 —— cherryRef/editorRef 都是 ref，读它永远是当前实例，
   * 每次渲染重建会让整棵右键菜单树跟着重建。
   */
  const adapter = useMemo(
    () =>
      createMilkdownAdapter(editorRef, {
        onExport: () => void handleExportRef.current(),
      }),
    []
  )

  const { onEditorContextMenu } = useEditorContextMenu({
    adapter,
    title,
    onRequestFullscreen: onToggleFullscreen,
    onRequestSearch: onOpenSearch,
    onRequestOutline: onToggleOutline,
  })

  /** 编辑区即整个可编辑范围（所见即所得没有独立的只读预览区），不用像 Cherry 那样分流 */
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (!editorRef.current) return
      onEditorContextMenu(event)
    },
    [onEditorContextMenu]
  )

  // ================= 构造与销毁 =================
  useEffect(() => {
    const root = mountRef.current
    if (!root) return

    // create() 尚未 resolve 时组件就卸载了,靠这个标志把迟到的实例直接销毁掉
    let disposed = false
    readyRef.current = false

    // 代码块主题是全局 <style>,挂载时先按当前设置注入一次
    applyMilkdownCodeTheme(getCachedCodeBlockTheme())

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, latestValueRef.current)
        // 挂一个自有类名,换肤时不用去猜 ProseMirror 的内部结构
        ctx.set(editorViewOptionsCtx, { attributes: { class: 'milkdown-content' } })
        ctx.set(highlightPluginConfig.key, { parser: safeHighlightParser })

        // code_block 渲染出来是 <pre data-language="x"><code>,不带任何类名,
        // 而 highlight.js 的主题 CSS 全都写在 .hljs 上 —— 这里把类名补上去。
        ctx.update(codeBlockAttr.key, (prev) => (node) => {
          const attrs = prev(node)
          return { ...attrs, code: { ...attrs.code, class: 'hljs' } }
        })

        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (suppressChangeRef.current) return
          latestValueRef.current = markdown
          lastEmittedRef.current = markdown
          onChangeRef.current?.(markdown)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(history)
      .use(clipboard)
      .use(cursor)
      .use(indent)
      .use(trailing)
      .use(highlight)
      .use(taskListClickPlugin)
      .use(inlineHtmlView)
      .use(milkdownSearchPlugin)
      // 斜杠菜单与块手柄：插件只出逻辑与定位，UI 是下面两个自绘组件
      .use(slash)
      .use(block)

    editor.create().then((instance) => {
      if (disposed) {
        void instance.destroy()
        return
      }
      editorRef.current = instance
      readyRef.current = true
      setReady(instance)

      // 进模式即提示,不等用户真改了才说
      if (CHERRY_ONLY_BLOCK.test(latestValueRef.current)) {
        onWarningRef.current?.(
          '本文含 Cherry 专有语法(::: 块),该语法不属于标准 Markdown。在当前模式下编辑会把它重新规范化并丢失这些块的结构,建议切回「双栏」编辑,或先手动替换为标准 Markdown。'
        )
      }

      // 构造期间外部可能已改过 value(挂载 effect 的依赖只有 value,那一次会被 readyRef 挡掉),补一次同步
      if (latestValueRef.current !== lastEmittedRef.current) {
        const next = latestValueRef.current
        suppressChangeRef.current = true
        try {
          instance.action(replaceAll(next))
          lastEmittedRef.current = next
        } finally {
          requestAnimationFrame(() => {
            suppressChangeRef.current = false
          })
        }
      }
    })
    // 初始化失败原本没人接,表现成「编辑区能打字、工具栏却点不动」的静默故障,
    // 这里显式打出来,免得下次还要靠端到端调试才找得到
    .catch((err) => {
      console.error('[Milkdown] 编辑器初始化失败:', err)
    })

    return () => {
      disposed = true
      readyRef.current = false
      editorRef.current = null
      // 同步置空，避免销毁后子组件还拿着旧实例去建 Provider
      setReady(null)
      try {
        void editor.destroy()
      } catch {
        // 卸载途中销毁失败无需处理
      }
    }
  }, [])

  // ================= 代码块主题 =================
  // 主题 CSS 是全局 <style>,换档位时替换内容即可,不需要重建编辑器
  useEffect(() => subscribeCodeBlockTheme(applyMilkdownCodeTheme), [])

  // ================= 大纲 =================
  // 浮层没开时不扫全文；开着时 content 一变就重扫（打字改了标题自然要跟着更新）
  useEffect(() => {
    if (!outlineOpen) return
    setOutlineItems(collectOutline(editorRef.current))
  }, [outlineOpen, value])

  /**
   * 让光标所在的标题在大纲里高亮。
   *
   * 直接用光标位置去比对条目的 pos（条目 pos 是标题节点的起始位置，
   * 光标在标题内时 pos 必小于光标，所以取「不超过光标的最后一条」）。
   */
  const syncActiveOutline = useCallback(() => {
    if (!outlineOpen) return
    const caret = editorRef.current?.action((ctx) => ctx.get(editorViewCtx).state.selection.from)
    if (caret == null) return
    let active: number | null = null
    for (const item of outlineItems) {
      if (item.pos <= caret) active = item.pos
      else break
    }
    setActiveOutlinePos(active)
  }, [outlineOpen, outlineItems])

  /** 收起大纲时顺手清掉高亮，免得下次打开闪一下旧的 */
  const toggleOutlinePanel = useCallback(() => {
    setOutlineOpen((prev) => {
      if (prev) setActiveOutlinePos(null)
      return !prev
    })
  }, [])

  /** 工具栏按钮的 active 态。只标「开着/关着」这类开关，不做光标处的格式嗅探 */
  const toolbarState = useMemo<Record<string, ToolbarItemState>>(
    () => ({
      fullscreen: { active: fullscreen },
      search: { active: searchOpen },
      outline: { active: outlineOpen },
    }),
    [fullscreen, searchOpen, outlineOpen]
  )

  // ================= 外部 value 回流 =================
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !readyRef.current) return
    // 先比较再写:自己刚抛出去的那次不该再写回去,否则光标会被重置
    if (value === lastEmittedRef.current) return

    suppressChangeRef.current = true
    lastEmittedRef.current = value
    try {
      editor.action(replaceAll(value))
    } finally {
      // 给渲染一帧时间,避免把程序写入当作用户编辑
      requestAnimationFrame(() => {
        suppressChangeRef.current = false
      })
    }
  }, [value])

  // ================= 外部片段插入 =================
  // 与 Cherry 不同,这里按 markdown 解析后以节点形式插到光标处,
  // 直接塞字符串的话会原样显示成 `**加粗**` 这种源码
  useEffect(() => {
    registerInsertHandler((prefix: string, suffix = '') => {
      const editor = editorRef.current
      if (!editor || !readyRef.current) return
      try {
        editor.action(insert(prefix + suffix))
        focusEditor()
      } catch (err) {
        console.error('插入文本失败:', err)
      }
    })
  }, [registerInsertHandler, focusEditor])

  // ================= 工具栏 =================
  const handleCommand = useCallback(
    (command: MarkdownCommand, _anchor: HTMLElement) => {
      // 大纲：Cherry 走它自带浮层，Milkdown 这套是自绘的，所以只有传了宿主回调时才外抛
      if (command.id === 'outline') {
        if (onToggleOutline) onToggleOutline()
        else toggleOutlinePanel()
        return
      }
      if (command.id === 'fullscreen') {
        onToggleFullscreen?.()
        return
      }
      // 查找替换同理：宿主没接管时用编辑器自带的这条
      if (command.id === 'search') {
        if (onOpenSearch) onOpenSearch()
        else setSearchOpen((prev) => !prev)
        return
      }
      if (command.id === 'export') {
        void handleExportRef.current()
        return
      }
      // 标题先标出当前级别再弹层
      if (command.id === 'heading') {
        setHeadingLevel(getCurrentHeadingLevel(editorRef.current))
        setPopup('heading')
        return
      }
      if (command.id === 'link' || command.id === 'image') {
        setPopupText('')
        setPopup(command.id)
        return
      }
      runMilkdownCommand(editorRef.current, command.id)
      focusEditor()
    },
    [focusEditor, onOpenSearch, onToggleFullscreen, onToggleOutline, toggleOutlinePanel]
  )

  /** 大纲条目被点：跳过去并把高亮落到它身上 */
  const pickOutlineItem = useCallback((item: OutlineItem) => {
    revealOutlineItem(editorRef.current, item)
    setActiveOutlinePos(item.pos)
  }, [])

  // Esc 关掉查找条。只在条子开着时挂监听，且不抢输入框自己的 Esc
  useEffect(() => {
    if (!searchOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [searchOpen])

  /**
   * ⌘F 唤出查找条。
   *
   * 只在鼠标/焦点落在本编辑器内时接管 —— 全站还有别的工具在跑，
   * 全局抢 ⌘F 会让别的页面按下没反应。判断依据是 activeElement 是否在挂载点上，
   * 这比「当前是否可见」准确：同屏切换工具时不可见的那个编辑器也会留着监听。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'f') return
      const root = mountRef.current
      const active = document.activeElement
      if (!root || !active || !root.contains(active)) return

      event.preventDefault()
      if (onOpenSearch) onOpenSearch()
      else setSearchOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenSearch])

  const closePopup = useCallback(() => {
    setPopup(null)
    setPopupText('')
  }, [])

  const confirmPopup = useCallback(() => {
    const text = popupText.trim()
    if (popup === 'link') setMilkdownLink(editorRef.current, text)
    else if (popup === 'image') insertMilkdownImage(editorRef.current, text)
    closePopup()
    focusEditor()
  }, [popup, popupText, closePopup, focusEditor])

  const pickHeading = useCallback(
    (level: number) => {
      setMilkdownHeading(editorRef.current, level)
      closePopup()
      focusEditor()
    },
    [closePopup, focusEditor]
  )

  return (
    <div className={`milkdown-notes-editor flex h-full min-h-0 flex-col ${className}`}>
      <MarkdownToolbar
        engine="milkdown"
        onCommand={handleCommand}
        // Milkdown 不像 Cherry 那样把状态渲染进 DOM，active 态由这里给出
        state={toolbarState}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={mountRef}
          onContextMenu={handleContextMenu}
          onKeyUp={syncActiveOutline}
          onMouseUp={syncActiveOutline}
          className="milkdown-scroll h-full w-full overflow-y-auto"
        />

        {outlineOpen && (
          <EditorOutline
            items={outlineItems}
            activePos={activeOutlinePos}
            onPick={pickOutlineItem}
            onClose={toggleOutlinePanel}
          />
        )}

        {/* 挂到编辑区内层容器上：Provider 用绝对定位放置，容器必须与编辑区同坐标系 */}
        <SlashMenu editor={ready} />
        <BlockHandle editor={ready} />

        {searchOpen && !onOpenSearch && (
          <FindReplaceBar editor={editorRef.current} onClose={() => setSearchOpen(false)} />
        )}

        {popup && (
          <>
            {/* 点空白处收起。铺一层透明背板比监听全局 click 简单,也不会和工具栏的点击打架 */}
            <div className="absolute inset-0 z-20" onMouseDown={closePopup} />

            <div className="absolute left-1/2 top-3 z-30 w-[21rem] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-slate-200/80 bg-white p-2 shadow-lg dark:border-dark-border dark:bg-dark-panel">
              {popup === 'heading' ? (
                <div className="grid grid-cols-2 gap-0.5">
                  {HEADING_OPTIONS.map((option) => (
                    <button
                      key={option.level}
                      type="button"
                      onClick={() => pickHeading(option.level)}
                      className={`rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        option.level === headingLevel
                          ? 'bg-brand-50 font-semibold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-dark-hover'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={popupText}
                    onChange={(event) => setPopupText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') confirmPopup()
                      if (event.key === 'Escape') closePopup()
                    }}
                    placeholder={
                      popup === 'link' ? '链接地址 https://…' : '图片地址 https://…'
                    }
                    className="h-7 min-w-0 flex-1 rounded-md border border-slate-200/80 bg-slate-50 px-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-dark-border dark:bg-dark-hover dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={confirmPopup}
                    disabled={!popupText.trim()}
                    className="h-7 flex-shrink-0 rounded-md bg-brand-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
                  >
                    确定
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
