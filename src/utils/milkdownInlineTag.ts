/**
 * 行内样式标签（span / u / sup / sub）的 mark 实现。
 *
 * ⚠️ 为什么不用 `html` 原子节点：`htmlSchema` 定义里写死了 `atom: true`，
 * 一旦把选中的文字包进 `<span style="…">`，那段文字就成了一块**不可编辑的整体** ——
 * 光标点不进中间，字也改不了，只能整块删掉重打。样式本质上是「给文字挂属性」，
 * 该由 mark 承担，文字节点本身必须保持可编辑。
 *
 * Markdown 侧照旧写标准的内联 HTML（`<span style="color:#e60000">x</span>`），
 * 与 Cherry、与历史数据都兼容。但 mark 在 mdast 里没有对应的父子结构
 * （它是贴在文本节点上的属性，不是包在文字外面的节点），所以两头都要自己接一段：
 *
 *   解析：remark 阶段把 `html`+内容+`html` 三个**兄弟**节点合并成一个自定义节点
 *   序列化：给 remark-stringify 注册同名 handler，写回等价的内联 HTML
 *
 * 合并出来的 mdast 节点 type 与 mark 名同名（见 markNameForTag），
 * 这样 milkdown 的 `parseMarkdown.match` / `toMarkdown.match` 一眼就能对上。
 *
 * 序列化端还有一点值得记：milkdown 的 `#maybeMergeChildren` 会把 props 相同的相邻
 * mark 节点并成一个，所以文本被其它 mark 切成几段时，写出来的仍是一对 `<span>` 而不是
 * `<span>a</span><span>b</span>`。
 */
import { $markSchema } from '@milkdown/kit/utils'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { DOMOutputSpec } from '@milkdown/kit/prose/model'

/**
 * 支持的行内标签。只有 span 带 style，其余都是纯语义标签。
 *
 * ⚠️ 这份名单必须和 milkdownHtmlView 的 KNOWN_TAGS 对齐。
 * CommonMark 把 `<kbd>x</kbd>` 拆成**两个独立的 html 节点**（开标签、闭标签），
 * 中间夹着文本 —— 只有能被这里合并成 mark 的标签才渲染得出来。
 * 漏在名单外的（kbd / small / del / ins / abbr 一度如此）会各自退化成
 * 「认不出的 HTML 片段」，正文里直接显示字面量。
 */
const TAGS = ['span', 'u', 'sup', 'sub', 'mark', 'kbd', 'small', 'ins', 'abbr'] as const

type TagName = (typeof TAGS)[number]

/** 唯一带 style 的标签。字号 / 颜色 / 背景色都落在它上面 */
export const STYLED_TAG: TagName = 'span'

const KNOWN_TAGS = new Set<string>(TAGS)

/** mark 名 = mdast 节点 type。加前缀是为了不和 commonmark 自有的节点重名 */
export function markNameForTag(tag: string): string {
  return `inlineTag:${tag}`
}

const MARK_NAME_BY_TAG = new Map<string, string>(TAGS.map((tag) => [tag, markNameForTag(tag)]))

// ==================== schema ====================

/**
 * 四个标签各一个 mark。
 *
 * 为什么不是「一个 mark 带 tag 属性」：一个文本节点上同种 mark 只能有一个，
 * 合成一个的话 `<u><sup>x</sup></u>` 这种叠加就表达不出来了。
 *
 * 每个 `$markSchema` 返回的是 `[schemaCtx, mark]` 这样一个二元组，两个都要 use ——
 * mark 插件体内是 `ctx.get(schemaCtx.key)` 取的 schema 定义，漏了 ctx 会在建编辑器时抛异常。
 * 这里摊平成一个插件列表，顺带让类型对得上（`.use()` 只收插件，不收这种元组）。
 */
export const inlineTagMarks: MilkdownPlugin[] = TAGS.flatMap((tag) => {
  const styled = tag === STYLED_TAG
  const schema = $markSchema(markNameForTag(tag), () => ({
    // 条件展开而不是 `styled ? {...} : {}` —— 后者会让 TS 推出「style 可能是 undefined」，
    // 与 attrs 的索引签名对不上
    ...(styled ? { attrs: { style: { default: '' } } } : {}),

    // 只从 HTML 导入时才走 parseDOM（Markdown 一律走 parseMarkdown）。
    // span 限定 `[style]`，免得把别处那些无样式的 span 也吃进来
    parseDOM: styled
      ? [
          {
            tag: 'span[style]',
            getAttrs: (dom: HTMLElement) => ({ style: dom.getAttribute('style') ?? '' }),
          },
        ]
      : [{ tag }],

    toDOM: (mark): DOMOutputSpec =>
      styled ? [tag, { style: String(mark.attrs.style ?? '') }, 0] : [tag, 0],

    parseMarkdown: {
      match: (node) => node.type === markNameForTag(tag),
      runner: (state, node, markType) => {
        state.openMark(markType, styled ? { style: String(node.style ?? '') } : undefined)
        state.next(node.children)
        state.closeMark(markType)
      },
    },

    toMarkdown: {
      match: (mark) => mark.type.name === markNameForTag(tag),
      // 注意箭头函数体是「块语句且不 return」—— milkdown 靠 runner 的返回值判断
      // 要不要接着跑节点自己的 runner，这里返回了真值的话里面的文字就不会被写出来
      runner: (state, mark) => {
        state.withMark(
          mark,
          markNameForTag(tag),
          undefined,
          styled ? { style: mark.attrs.style } : {}
        )
      },
    },
  }))
  return [schema.ctx, schema.mark]
})

// ==================== 解析：三兄弟节点 → 一个节点 ====================

/** mdast 节点的最小形状，够用就行，不引 mdast 的类型包 */
type MdastNode = {
  type: string
  value?: string
  style?: string
  children?: MdastNode[]
}

/** `<span style="…">` / `<u>` 这类开标签。只认白名单里的标签，其余当普通 HTML */
function matchOpenTag(value: string): { tag: string; style: string | null } | null {
  const match = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)>$/.exec(value.trim())
  if (!match) return null

  const attrs = match[2]
  // `<span/>` 是自闭合，没有配对闭合标签可言
  if (/\/\s*$/.test(attrs)) return null

  const tag = match[1].toLowerCase()
  if (!KNOWN_TAGS.has(tag)) return null

  const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
  return { tag, style: style ? style[1] ?? style[2] ?? '' : null }
}

function matchCloseTag(value: string): string | null {
  const match = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/.exec(value.trim())
  return match ? match[1].toLowerCase() : null
}

/**
 * 就地合并一层子节点里的 `开标签 + 内容 + 闭标签`。
 *
 * 找不到配对闭合时**原样保留** —— 那说明文档里本来就是一段残缺的手写 HTML，
 * 交给 `html` 原子节点按老样子渲染成不可编辑片段，比擅自吞掉安全。
 */
function mergeInlineTags(node: MdastNode) {
  const children = node.children
  if (!Array.isArray(children) || children.length === 0) return

  const merged: MdastNode[] = []
  let index = 0

  while (index < children.length) {
    const child = children[index]
    const open = child.type === 'html' ? matchOpenTag(String(child.value ?? '')) : null
    if (!open) {
      merged.push(child)
      index += 1
      continue
    }

    // 同标签要计深度：`<span a><span b>x</span></span>` 不能在内层就收尾
    let depth = 1
    let cursor = index + 1
    for (; cursor < children.length; cursor += 1) {
      const candidate = children[cursor]
      if (candidate.type !== 'html') continue

      const value = String(candidate.value ?? '')
      if (matchOpenTag(value)?.tag === open.tag) depth += 1
      else if (matchCloseTag(value) === open.tag) {
        depth -= 1
        if (depth === 0) break
      }
    }

    if (depth !== 0) {
      merged.push(child)
      index += 1
      continue
    }

    merged.push({
      type: MARK_NAME_BY_TAG.get(open.tag) as string,
      // 没写 style 的 span 也当成有 style 的 mark，只是值为空串 ——
      // mark 的 attrs 结构必须统一，否则同一个 mark 类型会出现两种形状
      ...(open.tag === STYLED_TAG ? { style: open.style ?? '' } : {}),
      children: children.slice(index + 1, cursor),
    })
    index = cursor + 1
  }

  node.children = merged
  // 合并出来的节点里还可能有嵌套的同款标签，递归再走一遍。
  // 文本节点没有 children，第一行就返回了，不会打转
  for (const item of merged) mergeInlineTags(item)
}

/**
 * 注册进 remark 的 transformer。
 *
 * 这里是 unified 的 attacher 形态（收 options、返回 transformer），
 * 因为 milkdown 是 `remark.use(plugin, options)` 挂上去的。
 */
export function inlineTagRemarkPlugin() {
  return (tree: MdastNode) => {
    mergeInlineTags(tree)
  }
}

// ==================== 序列化：一个节点 → 内联 HTML ====================

type StringifyInfo = Record<string, unknown>

/** remark-stringify 的 State 里我们用到的那几个方法 */
type StringifyState = {
  enter: (type: string) => () => void
  createTracker: (info: StringifyInfo) => {
    move: (value: string) => string
    current: () => StringifyInfo
  }
  containerPhrasing: (node: unknown, info: StringifyInfo) => string
}

type StringifyHandler = (
  node: MdastNode,
  parent: unknown,
  state: StringifyState,
  info: StringifyInfo
) => string

/**
 * 一个标签一个 handler，写法照抄 mdast-util-to-markdown 自带的 `strong`：
 * 用 tracker 记住「已经输出了多少」，children 才不会被当成行首而误转义。
 */
function makeHandler(tag: TagName): StringifyHandler {
  const styled = tag === STYLED_TAG
  return (node, _parent, state, info) => {
    const style = String(node.style ?? '')
    const open = styled && style ? `<${tag} style="${style}">` : `<${tag}>`
    const close = `</${tag}>`

    const exit = state.enter(tag)
    const tracker = state.createTracker(info)
    let value = tracker.move(open)
    value += tracker.move(
      state.containerPhrasing(node, { before: value, after: close, ...tracker.current() })
    )
    value += tracker.move(close)
    exit()
    return value
  }
}

/** 交给 `remarkStringifyOptionsCtx.handlers` 的处理器表，键就是 mdast 节点 type */
export const inlineTagStringifyHandlers: Record<string, StringifyHandler> = Object.fromEntries(
  TAGS.map((tag) => [markNameForTag(tag), makeHandler(tag)])
)
