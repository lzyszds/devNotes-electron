import { editorViewCtx } from '@milkdown/kit/core'
import type { Editor } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { EditorState } from '@milkdown/kit/prose/state'
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import type { MarkType } from '@milkdown/kit/prose/model'
import { callCommand } from '@milkdown/kit/utils'
import { markNameForTag, STYLED_TAG } from '../../../utils/milkdownInlineTag'

/**
 * 自绘工具栏 → Milkdown 的命令派发。
 *
 * 与 dispatch.ts 里 Cherry 那套「合成 DOM 事件点到隐形原生按钮」完全不同:
 * Milkdown 不渲染任何原生工具栏,它暴露的是 ProseMirror 命令,直接调就行。
 * 所以这里不需要锚点、不需要重摆弹层,是纯粹的「命令 id → 插件命令」查表。
 *
 * 需要用户先给参数的命令(标题级别、超链接、图片)不在这张表里,
 * 由编辑器组件收集完输入再调下面那几个带参函数。
 */

/**
 * 命令表里存的是「怎么拿到命令」,不是命令本身 —— 这点必须注意。
 *
 * Milkdown 的 `$Command` 是在**插件执行时**才把 key 挂到对象上的
 * (`$command` 源码里 `plugin.key = cmdKey` 写在插件函数体内),
 * 模块加载期读到的 `.key` 一律是 undefined。拿 undefined 去 call,
 * 会在 Container.get 里炸成 "Cannot read properties of undefined (reading 'id')",
 * 表现就是工具栏点了毫无反应 —— 每颗按钮都抛异常。
 * 所以这里全部推迟到点击时再求值。
 *
 * 不用 `callCommand(xxx.key)` 直接入表,还顺带保住了 payload 的类型:
 * 带参命令放在调用点上,milkdown 才能按各自的 CmdKey<T> 校验参数。
 */
const COMMANDS: Record<string, () => (ctx: Ctx) => boolean> = {
  undo: () => callCommand(undoCommand.key),
  redo: () => callCommand(redoCommand.key),

  bold: () => callCommand(toggleStrongCommand.key),
  italic: () => callCommand(toggleEmphasisCommand.key),
  strike: () => callCommand(toggleStrikethroughCommand.key),
  'inline-code': () => callCommand(toggleInlineCodeCommand.key),

  ul: () => callCommand(wrapInBulletListCommand.key),
  ol: () => callCommand(wrapInOrderedListCommand.key),
  quote: () => callCommand(wrapInBlockquoteCommand.key),

  // 任务清单没有现成命令，走下面自写的三态实现
  task: () => (ctx: Ctx) => toggleMilkdownTaskListInCtx(ctx),

  'code-block': () => callCommand(createCodeBlockCommand.key),
  table: () => callCommand(insertTableCommand.key),
  hr: () => callCommand(insertHrCommand.key),
}

/** 执行一条无参命令;返回 false 表示编辑器未就绪或该命令没实现 */
export function runMilkdownCommand(editor: Editor | null, id: string): boolean {
  const resolve = COMMANDS[id]
  if (!editor || !resolve) return false
  return editor.action(resolve())
}

/** level 取 1-6 转成对应标题,0 表示退回正文 */
export function setMilkdownHeading(editor: Editor | null, level: number): boolean {
  if (!editor) return false
  if (level < 1) return editor.action(callCommand(turnIntoTextCommand.key))
  return editor.action(callCommand(wrapInHeadingCommand.key, Math.min(6, level)))
}

/**
 * 光标处那条完整的链接范围（相邻文本节点上 href 相同的 link mark 合并成一段）。
 *
 * 用途有二：把光标放进已有链接里时能整条更新而不是切一半；
 * 以及在没有选区时给「加链接」找一个合理的落点。
 */
function linkRunAt(state: EditorState, pos: number): { from: number; to: number; href: string } | null {
  const $pos = state.doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock) return null

  const runs: { from: number; to: number; href: string }[] = []
  let offset = $pos.start()

  parent.forEach((child) => {
    const from = offset
    const to = offset + child.nodeSize
    offset = to
    if (!child.isText) return

    const link = child.marks.find((mark) => mark.type.name === 'link')
    if (!link) return

    const href = String(link.attrs.href ?? '')
    const last = runs[runs.length - 1]
    if (last && last.href === href && last.to === from) last.to = to
    else runs.push({ from, to, href })
  })

  return runs.find((run) => pos >= run.from && pos <= run.to) ?? null
}

/** 光标所在的那串非空白字符（URL、单词都算），给它加链接时不用先手动选中 */
function wordRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const $pos = state.doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock) return null

  const text = parent.textContent
  const offset = $pos.parentOffset
  let start = offset
  let end = offset
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1
  while (end < text.length && !/\s/.test(text[end])) end += 1
  if (start === end) return null

  const base = pos - offset
  return { from: base + start, to: base + end }
}

/**
 * 给选区（或光标所在的链接 / 词）加上链接。
 *
 * ⚠️ 不能直接调 `toggleLinkCommand`：它内部是 ProseMirror 的 `toggleMark`，
 * **空选区时会落成 storedMarks** —— 之后敲的每一个字都会自动变成链接的一部分，
 * 表现就是「正文莫名其妙全并进超链接里」，而且光标挪走前一直生效。
 * 同一个 toggle 还会把已有链接「取消」掉，链接面板里改成编辑语义更自然。
 *
 * 所以这里自己做三件事：
 *   1. 有选区就用选区；没有就优先扩展成光标所在的那条链接，其次扩展成所在词
 *   2. 用 addMark + removeStoredMark，绝不留下会影响后续输入的 storedMarks
 *   3. 连词都找不到（光标停在空白处）时明确返回 false，不静默改状态
 */
export function setMilkdownLink(editor: Editor | null, href: string): boolean {
  if (!editor || !href) return false
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const linkType = state.schema.marks.link
    if (!linkType) return false

    let { from, to } = state.selection

    if (from === to) {
      const run = linkRunAt(state, from)
      const fallback = run ? { from: run.from, to: run.to } : wordRangeAt(state, from)
      if (!fallback) return false
      from = fallback.from
      to = fallback.to
    }

    if (from >= to) return false

    // 已有链接的话先摘掉，避免同一段文字叠出两个 href
    const tr = state.tr
      .removeMark(from, to, linkType)
      .addMark(from, to, linkType.create({ href, title: null }))
      .removeStoredMark(linkType)

    view.dispatch(tr)
    view.focus()
    return true
  })
}

/** 光标处已有链接的 href；没有则返回空串。链接面板用它做回填 */
export function getMilkdownLinkAtCursor(editor: Editor | null): string {
  if (!editor) return ''
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const run = linkRunAt(view.state, view.state.selection.from)
    return run?.href ?? ''
  }) ?? ''
}

export function insertMilkdownImage(editor: Editor | null, src: string, alt = ''): boolean {
  if (!editor || !src) return false
  return editor.action(callCommand(insertImageCommand.key, { src, alt }))
}

/**
 * 任务清单开关。
 *
 * gfm 里**没有**任何可调用的任务清单命令 —— 只有 `extendListItemSchemaForTask`
 * （给 list_item 挂 `checked: boolean | null`，默认 null）与 `wrapInTaskListInputRule`
 * （打字 `[ ] ` 触发）。工具栏点一下没命令可调，所以这里自己写。
 *
 * 三态：
 *   不在列表里      → 先包成无序列表，再把每个 list_item 落 checked: false
 *   在列表 checked == null → 落 checked: false（任务化）
 *   在列表 checked != null → 落 checked: null（取消任务化）
 */
export function toggleMilkdownTaskListInCtx(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx)
  const { $from } = view.state.selection

  // 先判断当前是否已在任务列表里，决定这次是「任务化」还是「取消任务化」
  let inTaskList: boolean | null = null
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'list_item') {
      inTaskList = node.attrs.checked != null
      break
    }
  }

  if (inTaskList === null) {
    // 不在列表里：先转成无序列表。注意它 dispatch 之后 state 换了，
    // 下面的 setCheckedInCtx 必须重新 ctx.get(editorViewCtx)，不能复用这里的 view。
    if (!callCommand(wrapInBulletListCommand.key)(ctx)) return false
    return setCheckedInCtx(ctx, false)
  }

  return setCheckedInCtx(ctx, inTaskList ? null : false)
}

/** 一次调用就够的入口，供工具栏与右键菜单用 */
export function toggleMilkdownTaskList(editor: Editor | null): boolean {
  if (!editor) return false
  return editor.action(toggleMilkdownTaskListInCtx)
}

/**
 * 把选区内（无选区则光标所在）的 list_item 的 checked 统一改掉。
 *
 * 注意 setNodeMarkup 必须带全量 `...node.attrs` —— list_item 还有 label/listType/spread
 * 三个属性，漏掉会被重置，序列化出来的列表会变形。
 */
function setCheckedInCtx(ctx: Ctx, checked: boolean | null): boolean {
  const view = ctx.get(editorViewCtx)
  const { from, to } = view.state.selection
  const targets: number[] = []

  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'list_item') {
      targets.push(pos)
      return false
    }
    return true
  })

  if (!targets.length) {
    const $from = view.state.doc.resolve(from)
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === 'list_item') {
        targets.push($from.before(depth))
        break
      }
    }
  }
  if (!targets.length) return false

  let tr = view.state.tr
  for (const pos of targets) {
    const node = view.state.doc.nodeAt(pos)
    if (!node) continue
    if ((node.attrs.checked == null) === (checked == null)) continue
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked })
  }
  if (!tr.docChanged) return false
  view.dispatch(tr)
  return true
}

// ================= 内联 HTML（下划线 / 上下标 / 字号 / 颜色） =================
//
// commonmark 默认 schema 里没有 underline / sub / sup / textColor 这些 mark，
// gfm 也没有。但它的 `htmlSchema`（atom + inline）能把任意内联 HTML 原样存进
// `attrs.value` 并原样写回 Markdown —— 所以这几项走「往选区里塞一段 HTML」，
// 不去自定 mark + remark 解析（那要同时接管解析与序列化，风险大得多）。
//
// ⚠️ 代价：atom 节点内部不可编辑，被裹住的文字会退化成纯文本，
// 原本的加粗/斜体一并丢掉。Cherry 那边同样是按字符串拼的（它的 hook 拿到的是
// Markdown 文本、返回一段新字符串），所以行为基本对齐。

/**
 * 把 `color:red;font-size:12px` 拆成有序的声明表。
 *
 * 按声明逐个拆，不在整串上做子串匹配 —— `background-color` 里就含 `color`，
 * 用 `includes` 判的话「给带底色的文字改颜色」会被误当成取消颜色。
 */
function parseStyleDeclarations(style: string): [string, string][] {
  const list: [string, string][] = []
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const prop = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (prop && value) list.push([prop, value])
  }
  return list
}

function upsertDeclaration(list: [string, string][], prop: string, value: string) {
  const index = list.findIndex(([item]) => item === prop)
  if (index === -1) list.push([prop, value])
  else list[index] = [prop, value]
}

function removeDeclaration(list: [string, string][], prop: string) {
  const index = list.findIndex(([item]) => item === prop)
  if (index !== -1) list.splice(index, 1)
}

/** 取 mark 类型；schema 里没有就返回 null，调用方按「不支持」处理 */
function getMarkType(state: EditorState, tag: string): MarkType | null {
  return state.schema.marks[markNameForTag(tag)] ?? null
}

/**
 * 行内标签的开与关（toggle）：选区里**只要有一段**带着这个 mark，就整段取消，
 * 否则整段加上。取「全有或全无」而不是逐节点翻转，是因为用户眼里的对象是
 * 「我选的这段字」，逐节点翻转会让半截有色半截没色，看不出发生了什么。
 */
export function toggleInlineTag(editor: Editor | null, tag: string): boolean {
  if (!editor) return false
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const { from, to, empty } = state.selection
    if (empty) return false

    const markType = getMarkType(state, tag)
    if (!markType) return false

    let has = false
    state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks.some((mark) => mark.type === markType)) has = true
    })

    const tr = state.tr
    if (has) tr.removeMark(from, to, markType)
    else tr.addMark(from, to, markType.create())
    view.dispatch(tr)
    return true
  })
}

/** 下划线 `<u>…</u>` */
export function toggleUnderline(editor: Editor | null): boolean {
  return toggleInlineTag(editor, 'u')
}

/** 上标 `<sup>…</sup>` */
export function toggleSuperscript(editor: Editor | null): boolean {
  return toggleInlineTag(editor, 'sup')
}

/** 下标 `<sub>…</sub>` */
export function toggleSubscript(editor: Editor | null): boolean {
  return toggleInlineTag(editor, 'sub')
}

/**
 * 在选区的文本节点上增删若干条 style 声明，全部落在**同一个 span mark** 里。
 *
 * 逐文本节点算新值，而不是在整段上 `addMark` 一次：选区里两段字可能本来就颜色不同，
 * 整段套用会把它们统一成同一份声明，另一段原来的颜色就没了。
 *
 * `declarations` 是要一起落的声明（字号会捎带 line-height，与 Cherry 的写法一致）；
 * `key` 是判断「已经加过」的依据 —— 它的值与我们这次要写的一致时，视为再点一次，
 * 改为把 `declarations` 里的属性全部摘掉。
 */
function nextStyleValue(
  current: string,
  declarations: readonly (readonly [string, string])[],
  key: string
): string {
  const target = declarations.find(([prop]) => prop === key) ?? declarations[0]
  const list = parseStyleDeclarations(current)

  // 按属性名精确比对，不做子串匹配 —— `background-color` 里就含 `color`，
  // 用 includes 判的话「给带底色的文字改颜色」会被误当成取消颜色
  const hit = list.find(([prop]) => prop === key)
  if (hit && hit[1] === target[1]) {
    for (const [prop] of declarations) removeDeclaration(list, prop)
  } else {
    for (const [prop, value] of declarations) upsertDeclaration(list, prop, value)
  }

  return list.map(([prop, value]) => `${prop}:${value}`).join(';')
}

/**
 * 把 `declarations` 落到选中文字的 span mark 上（`key` 已有的同值再点一次 = 摘掉）。
 *
 * `nextStyleValue` 只算「新的 style 串该是什么」，真正改文档在这里 —— 分开是为了
 * 让逐段计算这件事在 `nodesBetween` 里没有副作用。
 */
export function toggleSpanStyle(
  editor: Editor | null,
  declarations: readonly (readonly [string, string])[],
  key: string
): boolean {
  if (!editor || !declarations.length) return false

  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const { from, to, empty } = state.selection
    if (empty) return false

    const markType = getMarkType(state, STYLED_TAG)
    if (!markType) return false

    // 先把要改的段落收集齐再落笔：nodesBetween 给的坐标是「改之前」的，
    // 边遍历边改会让后面那些段的坐标整体失准
    const targets: { from: number; to: number; style: string }[] = []
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText || !node.text) return
      const start = Math.max(from, pos)
      const end = Math.min(to, pos + node.nodeSize)
      if (start >= end) return

      const existing = node.marks.find((mark) => mark.type === markType)
      targets.push({
        from: start,
        to: end,
        style: nextStyleValue(String(existing?.attrs.style ?? ''), declarations, key),
      })
    })
    if (!targets.length) return false

    const tr = state.tr
    for (const item of targets) {
      // 声明被摘光的段落退回「没有这个 mark」，样式自然消失
      tr.removeMark(item.from, item.to, markType)
      if (item.style) tr.addMark(item.from, item.to, markType.create({ style: item.style }))
    }
    view.dispatch(tr)
    return true
  })
}

/**
 * 字号。标记与 Cherry 完全一致：`<span style="font-size:Npx;line-height:1em;">`，
 * 两边共用同一份 Markdown，写出来的东西必须互相认。
 */
export function setInlineFontSize(editor: Editor | null, px: number): boolean {
  return toggleSpanStyle(
    editor,
    [
      ['font-size', `${px}px`],
      ['line-height', '1em'],
    ],
    'font-size'
  )
}

/** 文字颜色。Cherry 侧写的是它自己的 `!!#xxx 文字!!`，见文件开头的方言说明 */
export function setInlineTextColor(editor: Editor | null, color: string): boolean {
  return toggleSpanStyle(editor, [['color', color]], 'color')
}

/**
 * 文字背景色。Cherry 侧写的是它自己的 `!!!#xxx 文字!!!`。
 *
 * 色值取**带透明度**的 rgba 而不是实色：实色在深色主题下会把正文的字压得看不见，
 * 而底色是内联样式，CSS 覆盖不掉，只能一开始就挑一个明暗两种主题下都读得清的写法。
 * 项目自己的高亮（`<mark>`）走的是同一条路子 —— 半透明暖色叠在底色上。
 */
export function setInlineBackgroundColor(editor: Editor | null, color: string): boolean {
  return toggleSpanStyle(editor, [['background-color', color]], 'background-color')
}

/**
 * 取当前光标所在标题的级别,没有就是 0。
 * 供标题下拉标出「当前是几级」用 —— Milkdown 不像 Cherry 那样把状态渲染到 DOM 上。
 */
export function getCurrentHeadingLevel(editor: Editor | null): number {
  if (!editor) return 0
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { $from } = view.state.selection
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      if (node.type.name === 'heading') return Number(node.attrs.level) || 0
    }
    return 0
  })
}
