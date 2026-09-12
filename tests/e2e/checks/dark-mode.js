/* ---------------------------------------------------------------------------
 * 暗色模式配色 + 编辑正文时的布局稳定性。
 * 这两项一起测：切 .dark 与输入文字都会触发重排，正好互相验证。
 * ------------------------------------------------------------------------- */
try {
  const mounted = await waitForEditor()
  check('编辑器已挂载', mounted)
  if (!mounted) return { checks, notes, errors }

  const cm = () => q('.cm-content')

  /* ---------- 1. 亮色下的菜单配色 ---------- */
  await setDoc('dark mode probe')
  let root = (await openEditorMenu()).root
  check('亮色下出现菜单', !!root)
  if (root) {
    const bg = getComputedStyle(root).backgroundColor
    const fg = getComputedStyle(root).color
    note('亮色菜单背景', bg)
    check('亮色菜单是浅底', lum(bg) > 180, '亮度 ' + lum(bg))
    check('亮色菜单文字够深', lum(fg) < 120, '亮度 ' + lum(fg))
  }

  /* ---------- 2. 切暗色 ---------- */
  document.documentElement.classList.add('dark')
  await sleep(400)
  if (root) {
    const bg = getComputedStyle(root).backgroundColor
    const fg = getComputedStyle(root).color
    note('暗色菜单背景', bg)
    check('暗色菜单是深底', lum(bg) < 90, '亮度 ' + lum(bg))
    check('暗色菜单文字够亮', lum(fg) > 150, '亮度 ' + lum(fg))
  }

  const sub = await openSubmenu('格式', root)
  check('暗色下子菜单可见', !!sub)
  if (sub) {
    const sbg = getComputedStyle(sub).backgroundColor
    note('暗色子菜单背景', sbg)
    check('暗色子菜单是深底', lum(sbg) < 90, '亮度 ' + lum(sbg))
  }
  await closeMenu()

  /* ---------- 3. 编辑正文不挤动其它输入框 ---------- */
  const inputBoxes = () =>
    qa('input').map((el) => {
      const b = el.getBoundingClientRect()
      return Math.round(b.left) + ',' + Math.round(b.top) + ',' + Math.round(b.width)
    })
  const before = inputBoxes()
  check('页面上有输入框可比对', before.length > 0, '共 ' + before.length + ' 个')
  cm().focus()
  document.execCommand('selectAll')
  document.execCommand('insertText', false, 'dark mode probe 加长一点看看会不会挤')
  await sleep(700)
  const after = inputBoxes()
  const shifted = before.filter((v, i) => after[i] !== undefined && after[i] !== v)
  check('编辑正文后输入框没有位移', shifted.length === 0, JSON.stringify(shifted))

  document.documentElement.classList.remove('dark')
  await sleep(300)
} catch (e) {
  errors.push('抛出: ' + (e && e.stack ? e.stack : String(e)))
}
return { checks, notes, errors }
