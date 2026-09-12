/* ---------------------------------------------------------------------------
 * 文档列表的布局稳定性：进入重命名、输入超长标题、提交，三个时刻都不能挤动列表。
 * 重命名输入框只在重命名态下才存在，所以必须先点铅笔按钮把它切出来。
 * ------------------------------------------------------------------------- */
try {
  const mounted = await waitForEditor()
  check('编辑器已挂载', mounted)
  if (!mounted) return { checks, notes, errors }

  /** 文档卡片的铅笔按钮是列表里唯一稳定的锚点 */
  const pencil = () => q('button[title="重命名文档"]')
  const noteList = () => {
    const p = pencil()
    return p ? p.closest('div.overflow-y-auto') : null
  }
  check('找到文档列表', !!noteList())
  check('文档列表里有重命名按钮', !!pencil())
  if (!noteList() || !pencil()) return { checks, notes, errors }

  /**
   * 重命名态下标题元素会由 h4 换成 input（input 带 -mx-[5px] px-1，天然比 h4 左右各宽 5px），
   * 两种形态都从快照里排除。否则「h4 没了、input 来了」这一处按设计发生的变化会被当成列表被挤动。
   */
  const isTitleEl = (el) =>
    el.tagName === 'INPUT'
      ? el.getAttribute('placeholder') === '输入文档名称'
      : el.tagName === 'H4' && String(el.getAttribute('title') || '').indexOf('双击重命名') >= 0
  /** 列表内所有元素的几何快照（只比几何，不比 class/tag） */
  const snapshot = () =>
    Array.prototype.slice
      .call(noteList().querySelectorAll('*'))
      .filter((el) => !isTitleEl(el))
      .slice(0, 150)
      .map((el) => {
        const b = el.getBoundingClientRect()
        return Math.round(b.left) + ',' + Math.round(b.top) + ',' + Math.round(b.width) + ',' + Math.round(b.height)
      })
  /** 每张文档卡片的 顶部:高度，用于给出更好读的失败信息 */
  const cardBoxes = () =>
    qa('button[title="重命名文档"]').map((b) => {
      const card = b.closest('.group')
      if (!card) return '?'
      const r = card.getBoundingClientRect()
      return Math.round(r.top) + ':' + Math.round(r.height)
    })
  const diff = (a, b) => a.filter((v, i) => b[i] !== undefined && b[i] !== v)

  note('文档数', cardBoxes().length)
  const base = snapshot()
  const baseCards = cardBoxes()
  check('列表快照非空', base.length > 0, '元素数 ' + base.length)

  /* ---------- 1. 进入重命名 ---------- */
  pencil().click()
  await sleep(400)
  const renameInput = q('input[placeholder="输入文档名称"]')
  check('出现重命名输入框', !!renameInput)
  if (!renameInput) return { checks, notes, errors }

  const afterEnter = snapshot()
  check('进入重命名没有挤动列表', diff(base, afterEnter).length === 0, JSON.stringify(diff(base, afterEnter).slice(0, 6)))
  check(
    '卡片高度不变',
    JSON.stringify(baseCards) === JSON.stringify(cardBoxes()),
    baseCards.join(' ') + ' -> ' + cardBoxes().join(' ')
  )
  const inputBox = renameInput.getBoundingClientRect()
  note('重命名输入框', Math.round(inputBox.width) + 'x' + Math.round(inputBox.height))

  /* ---------- 2. 输入超长标题 ---------- */
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(renameInput, '一个非常非常非常长的标题用来测试是否挤压列表项以及其它元素')
  renameInput.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(500)
  const afterType = snapshot()
  check('输入超长标题没有挤动列表', diff(base, afterType).length === 0, JSON.stringify(diff(base, afterType).slice(0, 6)))
  check(
    '超长标题下卡片高度不变',
    JSON.stringify(baseCards) === JSON.stringify(cardBoxes()),
    baseCards.join(' ') + ' -> ' + cardBoxes().join(' ')
  )

  /* ---------- 3. 回车提交 ---------- */
  renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await sleep(500)
  check('提交后退出重命名态', !q('input[placeholder="输入文档名称"]'))
  const committed = qa('h4[title*="双击重命名"]').map((el) => el.textContent.trim())
  check('标题已改成自定义名称', committed.indexOf('一个非常非常非常长的标题用来测试是否挤压列表项以及其它元素') >= 0, committed.join(' | '))
  const afterCommit = snapshot()
  check('提交后列表仍未位移', diff(base, afterCommit).length === 0, JSON.stringify(diff(base, afterCommit).slice(0, 6)))
} catch (e) {
  errors.push('抛出: ' + (e && e.stack ? e.stack : String(e)))
}
return { checks, notes, errors }
