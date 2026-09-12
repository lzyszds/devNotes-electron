/**
 * editorView / markdownFormat / markdownStats / markdownSnippets 的单元测试。
 *
 * 直接 import 项目的 .ts 文件：Node 24 默认开启类型擦除，这些模块又是纯函数、
 * 不碰 DOM，所以不需要打包器也不需要 jsdom。跑法：npm run test:unit
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'

// editorView.ts 只在「派发合成事件」那条路径上用 document，而那条路径必须有真 CM6
// 才有意义、不在这层单测里。这里备一个够用的替身，让 makeView 能造出 contentDOM。
globalThis.document = globalThis.document || { createElement: () => ({}) }

const {
  getEditorView,
  getSelection,
  getFullText,
  setFullText,
  replaceRange,
  selectAll,
  wrapSelection,
  stripInlineFormat,
  unwrapSelection,
  setHeading,
  toggleLinePrefix,
  toggleOrderedList,
  indentLines,
  trimTrailingSpaces,
  sortLines,
  dedupeLines,
  escapeMarkdownChars,
  unescapeMarkdownChars,
} = await import('../../src/utils/editorView.ts')

const { normalizeMarkdown } = await import('../../src/utils/markdownFormat.ts')
const stats = await import('../../src/utils/markdownStats.ts')
const { documentInfo, frontMatter, formatDate } = await import('../../src/utils/markdownSnippets.ts')

/** 断言两条：相等；以及一个布尔量 */
const eq = (actual, expected, label) => assert.deepStrictEqual(actual, expected, label)
const ok = (cond, label) => assert.ok(cond, label)

/** 最小 view 替身：被测的原语只用得到 state 与 dispatch */
function makeView(doc, sel) {
  const state = EditorState.create({
    doc,
    selection: sel ? { anchor: sel[0], head: sel[1] } : undefined,
  })
  return {
    state,
    // getEditorView 要求底层的真 EditorView 带 contentDOM（CM6Adapter 没有）
    contentDOM: { tagName: 'DIV' },
    dispatch(spec) {
      this.state = this.state.update(spec).state
    },
  }
}
const text = (view) => view.state.doc.toString()
const main = (view) => view.state.selection.main

test('取 view：CM6Adapter 与旧版直挂', () => {
  const view = makeView('hi')
  // Cherry 0.11 的真实形态：editor.editor 是 CM6Adapter，真正的 view 挂在 .view 上
  eq(getEditorView({ editor: { editor: { view, dispatch() {}, state: view.state } } }), view, '走 adapter.view')
  eq(getEditorView({ editor: { editor: view } }), view, '兼容直挂 EditorView')
  eq(getEditorView({}), null, '空对象')
  eq(getEditorView(null), null, 'null')
  eq(getEditorView({ editor: { editor: { dispatch: 1 } } }), null, '假 dispatch')
  eq(getEditorView({ editor: { editor: { view: {} } } }), null, 'adapter.view 不完整')
})

test('基础读写', () => {
  const view = makeView('hello world', [0, 5])
  eq(getSelection(view), { from: 0, to: 5, text: 'hello', empty: false }, 'getSelection 有选区')
  eq(getFullText(view), 'hello world', 'getFullText')
  eq(main(view).from, 0, '选区未被破坏')

  const v2 = makeView('abc')
  eq(setFullText(v2, 'xyz'), true, 'setFullText 生效')
  eq(text(v2), 'xyz', 'setFullText 结果')
  eq(setFullText(v2, 'xyz'), false, 'setFullText 幂等')

  const v3 = makeView('abcdef', [1, 3])
  replaceRange(v3, 1, 3, 'XY')
  eq(text(v3), 'aXYdef', 'replaceRange')

  const v4 = makeView('abc\ndef')
  selectAll(v4)
  eq([main(v4).from, main(v4).to], [0, 7], 'selectAll')
})

test('内联格式：包裹与剥离', () => {
  const view = makeView('', [0, 0])
  wrapSelection(view, '**', '**', '粗体')
  eq(text(view), '**粗体**', 'wrapSelection 无选区插入占位')
  eq(main(view).anchor, 4, 'wrapSelection 光标落在占位后')

  const v2 = makeView('abc', [0, 3])
  wrapSelection(v2, '**', '**', '粗体')
  eq(text(v2), '**abc**', 'wrapSelection 包裹选区')
  eq([main(v2).from, main(v2).to], [0, 7], 'wrapSelection 选中整体')
  wrapSelection(v2, '**', '**', '粗体')
  eq(text(v2), 'abc', 'wrapSelection 再点一次取消')

  eq(stripInlineFormat('**粗体**'), '粗体', 'stripInlineFormat **')
  eq(stripInlineFormat('~~删~~'), '删', 'stripInlineFormat ~~')
  eq(stripInlineFormat('`code`'), 'code', 'stripInlineFormat `')
  eq(stripInlineFormat('**`code`**'), 'code', 'stripInlineFormat 嵌套')
  eq(stripInlineFormat('<sup>2</sup>'), '2', 'stripInlineFormat sup')
  eq(stripInlineFormat('a *b* c'), 'a b c', 'stripInlineFormat 单星')
  eq(stripInlineFormat('snake_case_name'), 'snake_case_name', 'stripInlineFormat 不动下划线单词')

  const v3 = makeView('**粗体**', [0, 6])
  unwrapSelection(v3)
  eq(text(v3), '粗体', 'unwrapSelection 选区')

  const v4 = makeView('前 **粗** 后', [0, 0])
  unwrapSelection(v4)
  eq(text(v4), '前 粗 后', 'unwrapSelection 无选区作用于当前行')
})

test('块级结构：标题与列表', () => {
  const view = makeView('标题', [0, 0])
  setHeading(view, 1)
  eq(text(view), '# 标题', 'setHeading 加 H1')
  setHeading(view, 1)
  eq(text(view), '标题', 'setHeading 再点同级别取消')
  setHeading(view, 3)
  eq(text(view), '### 标题', 'setHeading 换级别')
  setHeading(view, 0)
  eq(text(view), '标题', 'setHeading 正文')

  const v2 = makeView('甲\n乙\n丙', [0, 3])
  setHeading(v2, 2)
  eq(text(v2), '## 甲\n## 乙\n丙', 'setHeading 多行')
  setHeading(v2, 2)
  eq(text(v2), '甲\n乙\n丙', 'setHeading 多行整体取消')

  const v3 = makeView('a\nb', [0, 3])
  toggleLinePrefix(v3, '- ')
  eq(text(v3), '- a\n- b', 'toggleLinePrefix 加无序列表')
  toggleLinePrefix(v3, '- ')
  eq(text(v3), 'a\nb', 'toggleLinePrefix 取消')

  const v4 = makeView('a\nb\nc', [0, 5])
  toggleOrderedList(v4)
  eq(text(v4), '1. a\n2. b\n3. c', 'toggleOrderedList 编号')
  toggleOrderedList(v4)
  eq(text(v4), 'a\nb\nc', 'toggleOrderedList 取消')
})

test('块级结构：缩进、行尾、排序、去重', () => {
  const view = makeView('  a\nb', [0, 5])
  indentLines(view, 1)
  eq(text(view), '    a\n  b', 'indentLines 增加缩进')
  indentLines(view, -1)
  eq(text(view), '  a\nb', 'indentLines 减少缩进')

  const v2 = makeView('a   \nb\t', [0, 6])
  trimTrailingSpaces(v2)
  eq(text(v2), 'a\nb', 'trimTrailingSpaces')

  const v3 = makeView('b\na\nc', [0, 5])
  sortLines(v3, false)
  eq(text(v3), 'a\nb\nc', 'sortLines 升序')
  sortLines(v3, true)
  eq(text(v3), 'c\nb\na', 'sortLines 降序')

  const v4 = makeView('a\nb\na\nb', [0, 7])
  dedupeLines(v4)
  eq(text(v4), 'a\nb', 'dedupeLines')

  // 单行时是 no-op
  const v5 = makeView('b\na', [0, 0])
  sortLines(v5)
  eq(text(v5), 'b\na', 'sortLines 单行不动')
})

test('转义与反转义', () => {
  const raw = 'a*b_c#d [e](f) {g} |h| ~i~ `j`'
  const escaped = escapeMarkdownChars(raw)
  eq(escaped, 'a\\*b\\_c\\#d \\[e\\]\\(f\\) \\{g\\} \\|h\\| \\~i\\~ \\`j\\`', 'escapeMarkdownChars')
  eq(unescapeMarkdownChars(escaped), raw, 'unescapeMarkdownChars 往返')
})

test('规范化排版：基础档', () => {
  const src = [
    '#标题',
    '',
    '',
    '',
    '中文English混排。',
    '* 项目一',
    '+ 项目二',
    '',
    '```js',
    'const a = 1   //   保留   三个空格',
    '```',
    '',
    '结尾无换行',
  ].join('\n')
  const basic = normalizeMarkdown(src, 'basic')
  ok(basic.text.includes('const a = 1   //   保留   三个空格'), '代码块内容逐字保留')
  ok(!basic.text.includes('\n\n\n'), '连续空行压缩')
  ok(basic.text.endsWith('\n'), '结尾换行')
  eq(normalizeMarkdown(basic.text, 'basic').changes, [], '幂等')
})

test('规范化排版：完整档', () => {
  const full = normalizeMarkdown('中文!!! 等待...\n\nＡＢＣ１２３\n\n| --- | :--: |', 'full')
  ok(full.text.includes('中文! 等待……'), '标点压缩与省略号')
  ok(full.text.includes('ABC123'), '全角转半角')
  ok(full.text.includes('| --- | :--: |'), '表格分隔行对齐')
})

test('规范化排版：未闭合围栏', () => {
  // 宁可不改，也不能把代码当正文处理
  const out = normalizeMarkdown('#标题\n```\n# 这是代码里的井号\n', 'basic')
  ok(out.text.includes('# 这是代码里的井号'), '围栏内的内容不被改写')
  ok(out.text.includes('# 标题'), '围栏之前的标题仍被规范化')
})

test('统计与文档信息', () => {
  const s = stats.computeDocStats('中文 abc 123\n第二行')
  eq(s.chineseChars, 5, '中文字数')
  eq(s.englishWords, 2, '英文词数')
  eq(s.totalWords, 7, '总词数')
  eq(s.totalLines, 2, '行数')
  eq(stats.computeDocStats('').totalLines, 0, '空文档行数')
  eq(stats.computeDocStats('').readingTime, 1, '空文档阅读时间兜底')

  const info = documentInfo('# 标题\n\n中文 abc', '我的笔记')
  ok(info.includes('我的笔记'), 'documentInfo 含标题')
  ok(/字数：\d+/.test(info), 'documentInfo 含字数')
  ok(frontMatter('我的笔记').startsWith('---\n'), 'frontMatter 起始围栏')
  ok(frontMatter('我的笔记').includes('title: 我的笔记'), 'frontMatter 标题')
  ok(/^\d{4}-\d{2}-\d{2}$/.test(formatDate()), 'formatDate 格式')
})

