import { editorViewCtx } from '@milkdown/kit/core'
import type { Editor } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { callCommand } from '@milkdown/kit/utils'

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

export function setMilkdownLink(editor: Editor | null, href: string): boolean {
  if (!editor || !href) return false
  return editor.action(callCommand(toggleLinkCommand.key, { href }))
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
