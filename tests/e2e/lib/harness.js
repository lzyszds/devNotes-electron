/* ---------------------------------------------------------------------------
 * 页内断言工具。这不是模块，而是一段「片段」：
 * driver.mjs 会把它和某个 checks/*.js 拼成一段 async IIFE，用 CDP 的
 * Runtime.evaluate 丢进渲染进程里执行。所以这里只声明局部变量，不做导入导出，
 * check 脚本执行完自己 return { checks, notes, errors }。
 * ------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const q = (s) => document.querySelector(s)
const qa = (s) => Array.prototype.slice.call(document.querySelectorAll(s))

const checks = []
const notes = []
const errors = []

/** 记一条断言。detail 只在失败时打印，用来定位到底是哪个值不对 */
const check = (label, ok, detail) => {
  checks.push({ label, ok: !!ok, detail: detail === undefined || detail === null ? '' : String(detail) })
}

/** 只记录数值不做判断，用于留一份环境快照（视口尺寸之类） */
const note = (label, value) => notes.push(label + ' = ' + String(value))

const rgba = (c) => {
  const m = String(c).match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
/** 感知亮度 0-255，用来断言「这是深底还是浅底」，比直接比字符串耐改 */
const lum = (c) => {
  const v = rgba(c)
  return v ? Math.round(0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) : -1
}

/* ---------- 菜单查询 ---------- */
const roots = () => qa('.context-menu').filter((el) => !el.classList.contains('context-menu-submenu'))
const subs = () => qa('.context-menu.context-menu-submenu')
const labelOf = (el) => {
  const span = el.querySelector('.context-menu-label')
  return span ? span.textContent.trim() : ''
}
const labelsOf = (panel) =>
  Array.prototype.slice.call(panel.querySelectorAll('.context-menu-label')).map((el) => el.textContent.trim())
const menuItems = (scope) =>
  Array.prototype.slice.call((scope || document).querySelectorAll('[role="menuitem"]')).map((el) => ({
    el,
    label: labelOf(el),
  }))
const byLabel = (label, scope) => {
  const hit = menuItems(scope).filter((it) => it.label === label)
  return hit.length ? hit[0].el : null
}
const byPrefix = (prefix, scope) => {
  const hit = menuItems(scope).filter((it) => it.label.indexOf(prefix) === 0)
  return hit.length ? hit[0].el : null
}

/* ---------- 事件合成 ---------- */
const fire = (el, type, x, y, extra) => {
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }
  if (extra) for (const k in extra) opts[k] = extra[k]
  el.dispatchEvent(new MouseEvent(type, opts))
}
const closeMenu = async () => {
  fire(document.body, 'mousedown', 4, 4, { button: 0 })
  await sleep(200)
}

/* ---------- 编辑器 ---------- */
/** 等 Cherry 挂载，返回是否等到（超时 30s） */
const waitForEditor = async (rounds) => {
  for (let i = 0; i < (rounds || 150) && !q('.cm-content'); i++) await sleep(200)
  return !!q('.cm-content')
}
/**
 * 正文为空时 CM6 会往 .cm-content 里塞一个占位提示（.cm-placeholder，这里是
 * 「输入文本或「/」开始编辑」）。它是渲染出来的提示、不是文档内容，凡是要判断正文的
 * 地方都得先把它摘掉，否则「文档已清空」这类断言会被提示文字喂饱。
 */
const withoutPlaceholder = (el) => {
  const clone = el.cloneNode(true)
  Array.prototype.slice
    .call(clone.querySelectorAll('[class*="placeholder"]'))
    .forEach((n) => n.parentNode.removeChild(n))
  return clone.textContent
}
/** CM6 每行一个 .cm-line；innerText 会把空行的 <br> 也数成换行，必须逐行取 */
const docText = () =>
  Array.prototype.slice
    .call(qa('.cm-content .cm-line'))
    .map(withoutPlaceholder)
    .join(String.fromCharCode(10))
/** 正文是否真的是空的（占位提示不算） */
const docIsEmpty = () => {
  const el = q('.cm-content')
  return !!el && withoutPlaceholder(el).trim() === ''
}
/** 用一次 selectAll + insertText 把正文整体换成 text（等价于用户全选粘贴） */
const setDoc = async (text) => {
  const cm = q('.cm-content')
  cm.focus()
  document.execCommand('selectAll')
  document.execCommand('insertText', false, text)
  await sleep(700)
}
/** 在编辑器上右键并等菜单，返回根面板与鼠标坐标 */
const openEditorMenu = async () => {
  const cm = q('.cm-content')
  const r = cm.getBoundingClientRect()
  const px = Math.round(r.left + 60)
  const py = Math.round(r.top + 24)
  fire(cm, 'contextmenu', px, py, { button: 2 })
  await sleep(350)
  return { root: roots()[0], px, py }
}
/** 点开菜单里某个父项的子菜单，返回子菜单面板（没有则 null） */
const openSubmenu = async (label, scope) => {
  const parent = byLabel(label, scope)
  if (!parent) return null
  fire(parent, 'click', 0, 0)
  await sleep(300)
  return subs()[0] || null
}
