/* ---------------------------------------------------------------------------
 * 无边框窗口：系统标题栏与菜单栏都不该存在，顶部只剩应用自绘的那条 bar。
 *
 * 守的是「改造被回退」这一类问题，三件互相独立的事：
 *   · 窗口几何 —— outer 与 inner 必须相等。带原生装饰时外框比内容区高出一截
 *     （本机 125% 缩放下实测多出 14×62 CSS px：系统标题栏 + Electron 默认菜单栏）。
 *   · 拖拽落点 —— 自绘 bar 上得有连续一段不属于任何交互控件的空白，否则
 *     -webkit-app-region: drag 无处可拖。中间那个搜索框会把两侧挤没，所以要量宽度。
 *   · no-drag 覆盖 —— 顶栏每个可点控件都必须在 .no-drag 里。漏一个，它的点击就会被
 *     上游拖拽区吞掉，表现只是「点了没反应」，不看这条很难定位到原因。
 * ------------------------------------------------------------------------- */
try {
  const mounted = await waitForEditor()
  check('编辑器已挂载', mounted)
  if (!mounted) return { checks, notes, errors }

  /* ---------- 1. 没有原生装饰 ---------- */
  const frameW = window.outerWidth - window.innerWidth
  const frameH = window.outerHeight - window.innerHeight
  note('窗口装饰', frameW + 'x' + frameH + '（都应为 0）')
  note('视口', window.innerWidth + 'x' + window.innerHeight + ' dpr=' + window.devicePixelRatio)
  check('窗口没有系统标题栏与菜单栏（outer 与 inner 相等）', frameW === 0 && frameH === 0, frameW + 'x' + frameH)

  /* ---------- 2. 自绘顶栏与三个窗口控制 ---------- */
  const bar = q('.drag-region')
  check('存在自绘顶栏（.drag-region）', !!bar)
  if (!bar) return { checks, notes, errors }

  const dots = qa('div.w-3').filter((el) =>
    ['bg-rose-500/80', 'bg-amber-500/80', 'bg-emerald-500/80'].some((c) => el.className.includes(c))
  )
  const titles = dots.map((el) => el.getAttribute('title'))
  check('顶栏上有三个窗口控制圆点', dots.length === 3, '实际 ' + dots.length)
  note('圆点', titles.join(' / '))
  check(
    '三个圆点分别是关闭 / 最小化 / 最大化',
    ['关闭窗口', '最小化', '最大化 / 还原'].every((t) => titles.indexOf(t) >= 0),
    titles.join(' | ')
  )

  /* ---------- 3. 顶栏留有可拖的空白 ---------- */
  const rect = bar.getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  const isFree = (x) => {
    const el = document.elementFromPoint(x, midY)
    if (!el) return false
    if (el.closest('.no-drag')) return false
    if (el.closest('button, a, input, textarea')) return false
    return true
  }
  let widest = 0
  let run = 0
  for (let x = Math.ceil(rect.left) + 1; x < rect.right - 1; x++) {
    run = isFree(x) ? run + 1 : 0
    if (run > widest) widest = run
  }
  note('顶栏最宽可拖空白', widest + ' CSS px')
  check('顶栏留有连续可拖空白（≥32px，窗口拖得动）', widest >= 32, widest + 'px')

  /* ---------- 4. 可点控件都标了 no-drag ---------- */
  // React 的 onClick 不落成 onclick 属性，所以按「按钮」和「手型光标」两类来找可点元素
  const regionOf = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.classList.contains('no-drag')) return 'no-drag'
      if (n.classList.contains('drag-region')) return 'drag'
    }
    return 'none'
  }
  const interactive = qa('.drag-region button, .drag-region .cursor-pointer')
  const swallowed = interactive.filter((el) => regionOf(el) !== 'no-drag')
  note('顶栏可点控件数', interactive.length)
  check(
    '顶栏可点控件都在 no-drag 里（否则点击会被拖拽区吞掉）',
    swallowed.length === 0,
    swallowed.map((el) => el.tagName + ':' + String(el.textContent || '').trim().slice(0, 12)).join(' | ')
  )
} catch (e) {
  errors.push('抛出: ' + (e && e.stack ? e.stack : String(e)))
}
return { checks, notes, errors }
