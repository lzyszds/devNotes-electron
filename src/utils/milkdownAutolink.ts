/**
 * GFM 自动链接的截断修正。
 *
 * 背景：remark-gfm 的 autolink literal 规则是「从 https:// 或 www. 起，
 * 一路吃到空白或 `<` 为止」，收尾只修剪 ASCII 的 `?!.,:*_~` 与不配对的 `)`。
 * 于是**中文标点不在修剪范围内**：
 *
 *   （如 https://www.baidu.com）并点击，确认…
 *                            ↑ 全角右括号不算终止符
 *
 * 解析出来就是一个链接节点，url 与文字都变成
 * `https://www.baidu.com）并点击，确认…` —— 正文被整段并进超链接里。
 *
 * 这里在 mdast 阶段把它切回来：自动链接（url 与可见文字完全相同，或
 * mailto: + 文字）的尾部若不是合法 URL 字符，就切断，剩下的还原成普通文本。
 *
 * 只动自动链接：手写的 `[文字](地址)` 里 url ≠ 文字，一律不碰。
 */

type MdNode = {
  type: string
  url?: string
  value?: string
  children?: MdNode[]
}

/** 合法 URL 字符（保守集合：ASCII 可见字符里 URL 允许的那些，全角标点与中文都落在集合外） */
const URL_CHAR = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/

/** 邮箱自动链接的合法尾部形状 */
const EMAIL_RE = /[A-Za-z0-9\-._+%]+@[A-Za-z0-9\-._]+\.[A-Za-z]{2,}/

function nodeText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(nodeText).join('')
}

/** 从末尾回退，丢掉所有不是合法 URL 字符的尾巴（全角标点、中文都在集合外） */
function trimUrlTail(text: string): string {
  let end = text.length
  while (end > 0 && !URL_CHAR.test(text[end - 1])) end -= 1
  return text.slice(0, end)
}

/**
 * 截断一个自动链接节点。
 * 就地改写传入节点，并返回需要补在它后面的普通文本节点；不需要截断时返回 null。
 *
 * GFM 给 `www.` 开头的自动链接会补一个 `http://` 前缀，所以 url 有三种形态要认。
 */
function trimAutolink(node: MdNode): MdNode | null {
  if (node.type !== 'link' || !node.url) return null

  const text = nodeText(node)
  if (!text) return null

  let keep = ''
  let nextUrl = ''

  if (node.url === text) {
    keep = trimUrlTail(text)
    nextUrl = keep
  } else if (node.url === `http://${text}`) {
    // www. 形态：GFM 解析出来 url 带 http://，文字不带
    keep = trimUrlTail(text)
    nextUrl = `http://${keep}`
  } else if (node.url === `mailto:${text}`) {
    keep = EMAIL_RE.exec(text)?.[0] ?? ''
    nextUrl = `mailto:${keep}`
  } else {
    // 手写链接（url ≠ 文字），原样保留
    return null
  }

  if (!keep || keep === text) return null

  const rest = text.slice(keep.length)
  node.url = nextUrl
  node.children = [{ type: 'text', value: keep }]
  return { type: 'text', value: rest }
}

function walk(node: MdNode) {
  const children = node.children
  if (!Array.isArray(children) || children.length === 0) return

  const next: MdNode[] = []
  for (const child of children) {
    const rest = trimAutolink(child)
    next.push(child)
    if (rest) next.push(rest)
    walk(child)
  }
  node.children = next
}

/** unified 插件：解析完成后遍历一遍，把被吃掉的尾巴还回去 */
export function autolinkTrimPlugin() {
  return (tree: MdNode) => {
    walk(tree)
  }
}
