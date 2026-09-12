/* ---------------------------------------------------------------------------
 * 编辑器右键菜单的端到端检查（在真实打包产物里跑）。
 * 覆盖：菜单定位与分组、格式/撤销重做、三级子菜单、规范化排版、
 *       预览区只读菜单、预览区可选中、输入框菜单回归、清空全文确认。
 * ------------------------------------------------------------------------- */
try {
  note('视口', innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio)

  const mounted = await waitForEditor()
  check('编辑器已挂载', mounted)
  check('预览区已挂载', !!q('.cherry-previewer'))
  if (!mounted) return { checks, notes, errors }

  const cm = () => q('.cm-content')

  /* ---------- 1. 写入固定正文 ---------- */
  await setDoc('alpha')
  check('写入后正文为 alpha', cm().textContent === 'alpha', JSON.stringify(cm().textContent))

  /* ---------- 2. 全选后右键：菜单出现、贴鼠标、在视口内 ---------- */
  document.execCommand('selectAll')
  await sleep(250)
  const opened = await openEditorMenu()
  let root = opened.root
  check('右键后出现菜单', !!root)
  check('菜单项含「格式」', !!root && !!byLabel('格式', root), root ? labelsOf(root).join(' | ') : '')
  check('菜单含「撤销」「重做」', !!root && !!byLabel('撤销', root) && !!byLabel('重做', root))
  if (!root) return { checks, notes, errors }

  const rb = root.getBoundingClientRect()
  check(
    '菜单跟随鼠标',
    Math.abs(rb.left - opened.px) < 60 && Math.abs(rb.top - opened.py) < 60,
    '鼠标 ' + opened.px + ',' + opened.py + ' 菜单 ' + Math.round(rb.left) + ',' + Math.round(rb.top)
  )
  check(
    '菜单在视口内',
    rb.left >= 0 && rb.top >= 0 && rb.right <= innerWidth + 1 && rb.bottom <= innerHeight + 1,
    JSON.stringify({ l: Math.round(rb.left), t: Math.round(rb.top), r: Math.round(rb.right), b: Math.round(rb.bottom) })
  )

  /* ---------- 3. 格式 → 加粗（同时验证右键前的选区没丢） ---------- */
  let sub = await openSubmenu('格式', root)
  check('「格式」子菜单出现', !!sub, sub ? labelsOf(sub).join(' | ') : '')
  check('子菜单用 absolute 定位', !!sub && getComputedStyle(sub).position === 'absolute', sub ? getComputedStyle(sub).position : '')
  const bold = sub ? byLabel('加粗', sub) : null
  check('子菜单含「加粗」', !!bold)
  if (bold) {
    fire(bold, 'click', opened.px, opened.py)
    await sleep(600)
  }
  check('加粗后正文为 **alpha**', cm().textContent === '**alpha**', JSON.stringify(cm().textContent))
  check('选中后菜单已关闭', roots().length === 0)

  /* ---------- 4. 撤销 / 重做 ---------- */
  root = (await openEditorMenu()).root
  const undo = root ? byLabel('撤销', root) : null
  check('菜单含「撤销」', !!undo)
  if (undo) {
    fire(undo, 'click', opened.px, opened.py)
    await sleep(600)
  }
  check('撤销回退到 alpha', cm().textContent === 'alpha', JSON.stringify(cm().textContent))

  root = (await openEditorMenu()).root
  const redo = root ? byLabel('重做', root) : null
  check('菜单含「重做」', !!redo)
  if (redo) {
    fire(redo, 'click', opened.px, opened.py)
    await sleep(600)
  }
  check('重做恢复 **alpha**', cm().textContent === '**alpha**', JSON.stringify(cm().textContent))

  /* ---------- 5. 三级子菜单：快捷插入 → 日期时间 ---------- */
  root = (await openEditorMenu()).root
  sub = await openSubmenu('快捷插入', root)
  check('「快捷插入」子菜单出现', !!sub, sub ? labelsOf(sub).join(' | ') : '')
  const dt = sub ? byLabel('日期时间', sub) : null
  check('二级含「日期时间」', !!dt)
  if (dt) {
    fire(dt, 'click', opened.px, opened.py)
    await sleep(300)
  }
  const level3 = subs()
  check('展开到三级', level3.length === 2, '当前子菜单层数 ' + level3.length)
  const lv3 = level3[1]
  check(
    '各级 position 都是 absolute',
    level3.every((el) => getComputedStyle(el).position === 'absolute'),
    level3.map((el) => getComputedStyle(el).position).join(',')
  )
  const boxes = level3.map((el) => {
    const b = el.getBoundingClientRect()
    return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }
  })
  check(
    '各级菜单都在视口内',
    boxes.every((b) => b.l >= 0 && b.r <= innerWidth + 1 && b.t >= 0 && b.b <= innerHeight + 1),
    JSON.stringify(boxes)
  )
  const dateItem = lv3 ? byPrefix('日期（', lv3) : null
  check('三级含日期项', !!dateItem, lv3 ? labelsOf(lv3).join(' | ') : '')
  const beforeInsert = cm().textContent
  if (dateItem) {
    fire(dateItem, 'click', opened.px, opened.py)
    await sleep(700)
  }
  check('插入日期后正文确实变了', cm().textContent !== beforeInsert, JSON.stringify(cm().textContent))

  /* ---------- 6. 智能规范化排版（基础档） ---------- */
  await closeMenu()
  await setDoc(
    '#标题\n\n\n\n中文English混排。\n* 项目一\n+ 项目二\n\n```js\nconst a = 1   //   保留   三个空格\n```\n结尾无换行'
  )
  root = (await openEditorMenu()).root
  sub = await openSubmenu('智能规范化排版', root)
  check('「智能规范化排版」子菜单出现', !!sub, sub ? labelsOf(sub).join(' | ') : '')
  const basic = sub ? byLabel('基础规范化', sub) : null
  check('含「基础规范化」', !!basic)
  if (basic) {
    fire(basic, 'click', opened.px, opened.py)
    await sleep(700)
  }
  const formatted = docText()
  check('中英文之间补了空格', formatted.indexOf('中文 English 混排') >= 0, JSON.stringify(formatted.slice(0, 80)))
  check('代码块内容逐字保留', formatted.indexOf('const a = 1   //   保留   三个空格') >= 0)
  check('连续空行被压缩', formatted.indexOf('\n\n\n') < 0)
  check('toast 有反馈', !!q('.toast, [class*="toast"]'))

  /* ---------- 7. 预览区只读菜单 ---------- */
  await closeMenu()
  const previewer = q('.cherry-previewer')
  const pb = previewer.getBoundingClientRect()
  fire(previewer, 'contextmenu', Math.round(pb.left + 40), Math.round(pb.top + 40), { button: 2 })
  await sleep(350)
  root = roots()[0]
  check('预览区右键出现菜单', !!root)
  const previewLabels = root ? labelsOf(root) : []
  check(
    '预览区菜单不含编辑项',
    !previewLabels.some((l) => l === '加粗' || l === '撤销' || l === '粘贴'),
    previewLabels.join(' | ')
  )

  /* ---------- 8. 预览区文字可选中 ---------- */
  const range = document.createRange()
  range.selectNodeContents(previewer)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  await sleep(200)
  const selected = selection.toString().length
  selection.removeAllRanges()
  check('预览区文字可选中', selected > 0, '选中字符数 ' + selected)
  await closeMenu()

  /* ---------- 9. 输入框右键（非编辑器区域的回归） ---------- */
  const input = q('input[type="text"]')
  check('页面上存在文本输入框', !!input)
  if (input) {
    input.focus()
    const ib = input.getBoundingClientRect()
    fire(input, 'contextmenu', Math.round(ib.left + 10), Math.round(ib.top + 10), { button: 2 })
    await sleep(350)
    check('输入框右键出现菜单', roots().length > 0, roots().length ? labelsOf(roots()[0]).join(' | ') : '')
    await closeMenu()
  }

  /* ---------- 10. 清空全文：confirm 取消 / 确认 ---------- */
  const origConfirm = window.confirm
  window.confirm = () => false
  root = (await openEditorMenu()).root
  const clear = root ? byLabel('清空全文', root) : null
  check('菜单含「清空全文」', !!clear)
  const beforeClear = cm().textContent
  const beforeClearDoc = docText()
  if (clear) {
    fire(clear, 'click', opened.px, opened.py)
    await sleep(500)
  }
  check('取消 confirm 后正文不变', docText() === beforeClearDoc, JSON.stringify(docText().slice(0, 60)))
  await closeMenu()

  window.confirm = () => true
  root = (await openEditorMenu()).root
  const clear2 = root ? byLabel('清空全文', root) : null
  if (clear2) {
    fire(clear2, 'click', opened.px, opened.py)
    await sleep(600)
  }
  check('确认后正文被清空', docIsEmpty(), JSON.stringify(cm().textContent))
  window.confirm = origConfirm
  await closeMenu()

  /* ---------- 11. 清空可撤销 ---------- */
  root = (await openEditorMenu()).root
  const undo2 = root ? byLabel('撤销', root) : null
  if (undo2) {
    fire(undo2, 'click', opened.px, opened.py)
    await sleep(600)
  }
  // 清空是整篇一次 dispatch，所以应当一步撤销回原样；用 cm().textContent 判断的话，
  // 光靠占位提示就能满足，等于没测
  check('清空后一步撤销回原样', docText() === beforeClearDoc, JSON.stringify(docText().slice(0, 60)))
  await closeMenu()

  /* ---------- 12. 分组后的根菜单高度（125% 缩放下视口只有约 738px） ---------- */
  root = (await openEditorMenu()).root
  const rootLabels = labelsOf(root)
  note('根菜单项数', rootLabels.length)
  note('根菜单项', rootLabels.join(' | '))
  const rb12 = root.getBoundingClientRect()
  check(
    '根菜单不溢出视口',
    rb12.top >= 0 && rb12.bottom <= innerHeight + 1,
    '高 ' + Math.round(rb12.height) + ' / 视口 ' + innerHeight
  )
  check('根菜单已收进 16 项以内', rootLabels.length <= 16, '实际 ' + rootLabels.length + ' 项')

  sub = await openSubmenu('复制为', root)
  check('「复制为」子菜单出现', !!sub, sub ? labelsOf(sub).join(' | ') : '')
  check('「复制为」有 3 个子项', !!sub && labelsOf(sub).length === 3, sub ? String(labelsOf(sub).length) : '')
  await closeMenu()

  root = (await openEditorMenu()).root
  sub = await openSubmenu('视图', root)
  check('「视图」子菜单出现', !!sub, sub ? labelsOf(sub).join(' | ') : '')
  check('「视图」有 5 个子项', !!sub && labelsOf(sub).length === 5, sub ? String(labelsOf(sub).length) : '')
  if (sub) {
    const sb = sub.getBoundingClientRect()
    check('末级子菜单不溢出', sb.top >= 0 && sb.bottom <= innerHeight + 1, 'bottom ' + Math.round(sb.bottom) + ' / 视口 ' + innerHeight)
  }
  await closeMenu()
} catch (e) {
  errors.push('抛出: ' + (e && e.stack ? e.stack : String(e)))
}
return { checks, notes, errors }
