/*
 * 一次性清理：删除全仓库死掉的暗色样式。
 *
 * 【已执行过 —— 2026-11-02 跑过一轮并已手工修复产物，脚本仅作审计记录，勿重跑。】
 * 已知瑕疵：逗号选择器里含 `:is(...)` 的暗色规则会被错误切坏 —— 当时的产物
 * （index.css 四处残留）已被逐一对回原文修复；重跑会再踩同一个坑。
 *
 * 前提（执行前已核实）：
 *  - tailwind.config darkMode:'class'，而 App.tsx 启动即 remove('dark')，
 *    全仓库没有任何代码再写入 dark class —— 所以任意 `dark:` 变体
 *    （dark:bg-xxx / dark:hover:xxx…）永远不会命中，是纯死代码。
 *  - 裸用的 dark-* 调色板（bg-dark-panel 这类无 dark: 前缀的现实渲染类）为 0。
 *
 * 两条通路：
 *  1. tsx/ts：剥掉 className 字符串里的 `dark:<token>`（正则只吃「冒号后
 *     非空格」的 token，`{ dark: '#123' }` 这类对象键带空格不会误伤）。
 *  2. index.css：成块删除选择器命中 .dark / html.dark 的规则；逗号选择器
 *     拆开处理，只删命中段。删完做一次空白压缩。
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(SRC).filter(
  (f) => !f.endsWith('.d.ts') && (/\.(tsx|ts)$/.test(f) || f.endsWith('index.css')),
)

/* 1. tsx/ts：剥 dark: token。冒号后必须紧跟非空白（class token），边界为空白/引号/反引号 */
const TOKEN = /(^|[\s'"`(])dark:[^\s'"`]+/g

/* 2. css：写一个小型块级解析器 */
function pruneCss(src) {
  const findDark = (selector) =>
    /(^|[\s,>~+*])\.dark\b/.test(selector) || /\bhtml\.dark\b/.test(selector)

  const out = []
  let idx = 0
  n: while (idx < src.length) {
    const brace = src.indexOf('{', idx)
    if (brace === -1) {
      out.push(src.slice(idx))
      break
    }
    // 选择器起点：上一个 '}' 或 ';' 之后
    let selStart = Math.max(src.lastIndexOf('}', brace), src.lastIndexOf(';', brace))
    // 注释可能占着选择器段，跳过注释不算选择器
    selStart = Math.max(selStart, src.lastIndexOf('*/', brace))
    const prev = src.slice(idx, selStart + 1)
    let selector = src.slice(selStart + 1, brace)
    // 该「选择器段」里若还有更早的 {，说明我们在某个块内层，selector 只是小尾巴，
    // 直接照抄输出（由外层逻辑处理） —— 简化：把 prev 原样吐出，selector 原样保留
    const isAt = /@/.test(selector) && /^\s*@/.test(selector)

    // 计算配对的大括号深度
    let depth = 1
    let end = brace + 1
    while (end < src.length && depth > 0) {
      const ch = src[end]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      end++
    }
    const bodyL = src.slice(brace + 1, end - 1)

    const pruneList = (selectors) => {
      const parts = selectors.split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim())
      const kept = parts.filter((s) => s && !findDark(s))
      if (!kept.length) return null
      // dark 段被删后，若剩下都是同一选择器，没必要重排 —— 直接 join
      return kept.join(', ')
    }

    if (findDark(selector) && bodyL.includes('{')) {
      // 嵌套块（如 .dark .md { @media { ... } }）：整体跳过
      idx = end
      // 跳过块后紧随的空白与分号
      while (/\s/.test(src[idx] ?? '') || src[idx] === ';') idx++
      continue
    }

    if (findDark(selector) && (isAt === false || selector.trim().startsWith('@'))) {
      const pruned = pruneList(selector)
      if (pruned === null) {
        idx = end
        while (/\s/.test(src[idx] ?? '') || src[idx] === ';') idx++
        continue
      }
      // 逗号列表里删掉 dark 段，保留其余
      out.push(prev, pruned, '{')
      out.push(pruneCss(bodyL))
      out.push('}')
      idx = end
      continue
    }

    out.push(prev, selector, '{')
    if (bodyL.includes('{')) {
      out.push(pruneCss(bodyL))
      out.push('}')
    } else {
      out.push(bodyL, '}')
    }
    idx = end
    continue
  }
  return out.join('').replace(/\n\s*\n\s*\n+/g, '\n\n')
}

let tokenCount = 0
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8')
  let after = before
  if (/\.(tsx|ts)$/.test(file)) {
    after = after.replace(TOKEN, (m, lead) => {
      tokenCount++
      return lead
    })
    // 清理可能产生的空串/悬挂空格
    after = after.replace(/className=\{?["'`]\s*["'`]\}?/g, (m) => (m.includes('=') ? m : m))
  } else {
    after = pruneCss(after)
  }
  if (after !== before) {
    fs.writeFileSync(file, after)
    console.log('pruned', path.relative(process.cwd(), file))
  }
}
console.log('dark: tokens removed:', tokenCount)
