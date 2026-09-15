/**
 * Milkdown 的代码高亮（shiki）。
 *
 * 为什么不用 highlight.js：lowlight 只带 `common` 那 36 种语言，集合外的语言
 * （vue / dockerfile / mermaid / toml …）一个 token 都产不出来，代码块只剩一块底色，
 * 看着像没接高亮。shiki 用的是 VS Code 那套 TextMate 语法，bundled 了 242 种语言
 * 加 104 个别名，与参考项目 nodeFileView 同一套。
 *
 * 三处刻意的取舍：
 *
 * 1. **用纯 JS 引擎**（`shiki/engine/javascript`）而不是默认的 Oniguruma。后者要加载
 *    onig.wasm，而本应用打包成 asar 之后从 file:// 取 wasm 很容易出问题。
 *    `forgiving: true` 让那些用了 Oniguruma 专有语法的 grammar 跳过对应模式而不是抛错。
 * 2. **只从 `shiki/core`、`shiki/langs`、`shiki/themes`、`shiki/engine/javascript`
 *    这几个子路径导入**。`shiki` 顶层入口静态 import 了 Oniguruma 引擎，
 *    从那里导入会把 wasm 一起拖进包里。
 * 3. **主题全部预载、语言按需加载**。主题只有 8 档、必须能随时切；语言有 242 种，
 *    按需 `import()` 交给 Vite 切成独立 chunk，用不到就不加载。
 * 4. **highlight.js 仍然保留，但只用来猜语言**。没有语言标签的代码块得有人认出来，
 *    shiki 自己没有语言猜测能力，见 guessLanguage。
 */
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledThemes } from 'shiki/themes'
import type { BundledTheme } from 'shiki/themes'
import { common as commonLanguages, createLowlight } from 'lowlight'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createParser, type Parser } from '@milkdown/plugin-highlight/shiki'
import { getCachedCodeBlockTheme } from './codeBlockTheme'
import { BUNDLED_LANGUAGES } from './highlightLanguages'

/**
 * 认不出的语言统一退到 shiki 内置的 text：它不需要注册、调用也不报错，
 * 产出的是「整块单色 + 主题底色」，比没有配色体面得多。
 */
const FALLBACK_LANG = 'text'

/** 打包进来的语言，id → 条目（清单见 highlightLanguages.ts） */
const LANGUAGES_BY_ID = new Map(BUNDLED_LANGUAGES.map((language) => [language.id, language]))

/** 语言别名（含规范名自身）→ 规范 id。围栏里写 `JS`、`Dockerfile` 很常见，查表前统一转小写 */
const LANG_IDS = new Map<string, string>()
for (const { id, aliases } of BUNDLED_LANGUAGES) {
  LANG_IDS.set(id, id)
  for (const alias of aliases) LANG_IDS.set(alias, id)
}

/**
 * 给语言选择器用的清单。
 *
 * 第一项是空 id，对应「不写语言」——那种块走 guessLanguage 自动识别，
 * 所以对用户来说它叫「自动识别」，而不是「无」。
 * 只有打包进来的语言才会出现在这里，因为没打包的选了也高亮不了。
 */
export const LANGUAGE_OPTIONS: { id: string; label: string }[] = [
  { id: '', label: '自动识别' },
  ...BUNDLED_LANGUAGES.map(({ id, name }) => ({ id, label: name })).sort((a, b) =>
    a.label.localeCompare(b.label)
  ),
]

/**
 * 加载失败过的语言。
 *
 * 失败之后必须**永久**降级到 text，否则会死循环：parser 返回 Promise → 插件在
 * then 里 refresh → 重新问 parser → 语言仍然没加载 → 又返回 Promise → …
 * grammar 是动态 import 进来的 chunk，chunk 404 / 解析出错都会走到这条路上。
 */
const failedLangs = new Set<string>()

/** 认不出的、以及认得出但加载失败过的语言，都退到 FALLBACK_LANG */
function resolveLangId(raw: string | undefined): string {
  if (!raw) return FALLBACK_LANG
  const id = LANG_IDS.get(raw.toLowerCase())
  return !id || failedLangs.has(id) ? FALLBACK_LANG : id
}

/**
 * 把围栏里写的语言名（可能是别名、大小写混排）换成规范 id，认不出返回空串。
 *
 * 语言选择器要用：清单里存的是规范名，不换算的话，` ```js ` 这种块的选中态就标不出来。
 */
export function canonicalLanguageId(raw: string): string {
  return raw ? LANG_IDS.get(raw.trim().toLowerCase()) ?? '' : ''
}

/**
 * 没有语言标签的代码块，靠 highlight.js 猜一个语言出来。
 *
 * 这条兜底不能省：所见即所得模式里**没有给代码块选语言的入口**（Cherry 有），
 * 而粘一段代码进来不写语言名才是常态 —— 直接降级成 text 的话，这类块会永远没有配色，
 * 用户只能切到 Cherry 手动指定语言再切回来。旧的 highlight.js 管线本来就是这个行为
 * （lowlight 的适配层在 language 为空时走 `highlightAuto`），换 shiki 时不能丢。
 * shiki 自己不做语言猜测，所以把 highlight.js 留着，只当「猜语言」用。
 *
 * 猜一次要跑遍 common 那 37 个语法，比按语言解析贵得多，所以按内容缓存上一次的结果。
 */
const autoDetector = createLowlight(commonLanguages)
let lastGuess: { content: string; id: string } | null = null

function guessLanguage(content: string): string {
  if (lastGuess?.content === content) return lastGuess.id

  let id = FALLBACK_LANG
  try {
    const detected = autoDetector.highlightAuto(content).data?.language
    if (detected) id = resolveLangId(detected)
  } catch {
    // 猜不出来就用兜底，别让异常冒到调用方（它会带崩全文高亮）
  }

  lastGuess = { content, id }
  return id
}

/**
 * 期望的主题。highlighter 还没建起来时改它只是记下来，建的时候直接按它载入。
 * 初值取设置里存的那一档 —— 模块初始化时读，跟编辑器谁先谁后都无所谓。
 */
let pendingTheme: BundledTheme = getCachedCodeBlockTheme()

/**
 * 主题参数。**必须常驻、必须恒有 theme**：prosemirror-highlight 的 shiki 适配是
 * `codeToTokens(content, { lang: language, ...options })`，只有 options 为 falsy 时
 * 它才回退到 `getLoadedThemes()[0]`；options 里也**不能**放 lang，会盖掉调用方传进来的语言。
 *
 * 用可变对象而不是每次重建：适配层每次调用都重新展开，改属性就等于换主题。
 * ⚠️ 里面的 theme 必须是**已经载入** highlighter 的主题，否则 codeToTokens 会抛 ——
 * 所以换主题时先 loadTheme 再改这里，顺序不能反。
 */
const tokenOptions = { theme: pendingTheme }

/** highlighter 单例。第一个编辑器挂载时才建，多个编辑器实例共享 */
let highlighter: HighlighterCore | null = null
let highlighterPromise: Promise<HighlighterCore | null> | null = null
/** 建好之后才拿得到，createParser 需要它 */
let baseParser: Parser | null = null

async function createHighlighter(): Promise<HighlighterCore | null> {
  try {
    // 只载入当前主题。65 套主题各是一个独立 chunk，全预载等于每次挂载编辑器都拉 65 个文件；
    // 其余的主题等选中了再 loadTheme（见 setShikiTheme）
    return await createHighlighterCore({
      engine: createJavaScriptRegexEngine({ forgiving: true }),
      themes: [await bundledThemes[pendingTheme]()],
      langs: [],
    })
  } catch (error) {
    // 建不出来就不再重试，parser 会一直走降级分支。重试的代价是上面说的死循环
    console.error('[Milkdown] shiki 初始化失败，代码块将不带语法配色:', error)
    return null
  }
}

function ensureHighlighter(): Promise<HighlighterCore | null> {
  highlighterPromise ??= createHighlighter().then((instance) => {
    highlighter = instance
    // 建之前可能已经被要求换过主题，这里对齐一下，免得 tokenOptions 指着一个没载入的主题
    if (instance) tokenOptions.theme = pendingTheme
    return instance
  })
  return highlighterPromise
}

/**
 * 喂给 `highlightPluginConfig` 的 parser。
 *
 * 两条硬规则，都是被 prosemirror-highlight 的内部机制逼出来的：
 *
 * 1. **失败必须收敛到同步终态**（见 failedLangs 的注释）。
 * 2. **绝不为了「认不出的语言」同步返回空数组**。它的 calculateDecoration 会把同步返回的
 *    `[]` 写进 `cache.set(pos, node, [])`，而缓存只在节点内容变化时才失效 ——
 *    那块会**永久**没有配色。所以降级目标是 text，不是空数组。
 *
 * 另外它用**一个 try 包住整篇文档的循环**，任何一块抛错会让全文所有代码块一起失去高亮，
 * 所以异常必须在这里自己消化掉。
 */
export const shikiParser: Parser = (options) => {
  // 块级函数体：适配层不看 Promise 的解决值，只认「拿到的是一个 Promise」，回调返回 void 即可
  if (!highlighter) {
    return ensureHighlighter().then(() => {
      shikiParser(options)
    })
  }
  if (!baseParser) baseParser = createParser(highlighter, tokenOptions)

  // 没写语言标签就猜一个（见 guessLanguage），写了就按别名表解析
  const declared = options.language?.trim()
  const id = declared ? resolveLangId(declared) : guessLanguage(options.content)
  const hl = highlighter
  const language = LANGUAGES_BY_ID.get(id)
  const needsLoad = !!language && !hl.getLoadedLanguages().includes(id)

  if (language && needsLoad) {
    return language
      .load()
      // 模块是 `export default [grammar]` 的命名空间，shiki 自己取 default，类型对不上但运行时就是这么用的
      .then((mod) => hl.loadLanguage(mod as Parameters<HighlighterCore['loadLanguage']>[0]))
      .catch((error) => {
        failedLangs.add(id)
        console.error(`[Milkdown] 加载 shiki 语言「${id}」失败，该代码块退化为单色:`, error)
      })
      .then(() => {
        shikiParser(options)
      })
  }

  try {
    return baseParser({ ...options, language: id })
  } catch (error) {
    failedLangs.add(id)
    console.error(`[Milkdown] 代码块高亮失败（language=${id}），退化为单色:`, error)
    try {
      return baseParser({ ...options, language: FALLBACK_LANG })
    } catch {
      // 连 text 都失败只可能是 highlighter 本身出了问题，此时不产出任何装饰
      return []
    }
  }
}

/**
 * 切换代码块主题。主题是按需载入的（65 套各是一个 chunk），所以这个函数是异步的 ——
 * 调用方得等它 resolve 再去重刷高亮，否则重刷时用的还是旧主题。
 *
 * 载入失败就保持原主题：宁可配色没换，也好过 tokenOptions 指着一个没载入的主题、
 * 让 codeToTokens 抛错（那会带崩全文的代码块高亮）。
 */
export async function setShikiTheme(theme: BundledTheme): Promise<void> {
  pendingTheme = theme

  const hl = await ensureHighlighter()
  if (!hl) return

  if (!hl.getLoadedThemes().includes(theme)) {
    try {
      await hl.loadTheme(await bundledThemes[theme]())
    } catch (error) {
      console.error(`[Milkdown] 载入 shiki 主题「${theme}」失败，保持原主题:`, error)
      return
    }
  }

  tokenOptions.theme = theme
}

/** prosemirror-highlight 认的重算信号，键名是它的公开约定 */
const HIGHLIGHT_REFRESH_META = 'prosemirror-highlight-refresh'

/**
 * 它内部建插件用的键名以这个串开头（createKey 会补 `$`、`$1` … 后缀）。
 *
 * 不能自己 `new PluginKey('prosemirror-highlight')` 去查：PluginKey 的键名带**模块级计数器**，
 * 同一个名字每建一次都不一样，按名字查必然落空。插件清单里也只有它用这个前缀。
 */
const HIGHLIGHT_KEY_PREFIX = 'prosemirror-highlight'

/** 只声明我们要动的那一小块，别把它的内部结构抄成一份完整类型 */
type HighlightPluginState = { cache?: { cache?: Map<unknown, unknown> } }

/**
 * 让文档里所有代码块按当前主题重新上色。
 *
 * 两件事都得做，少一件新主题就不生效：
 *
 * 1. **把它的装饰缓存清掉**。它按「节点位置 + 节点内容有没有变」缓存装饰，而主题是我们
 *    这边的模块级变量、节点本身没动过 —— 只发重算信号的话，它会把缓存里那份**旧配色**
 *    的装饰原样拿回来。它没有对外暴露清缓存的接口（那个 refresh meta 只对「还在异步解析中」
 *    的块有效，因为那种块压根没进缓存），所以只能取到插件 state 把里面的 Map 清空。
 *    上面的键名前缀与这里的 state 形状都是它的内部结构，升级依赖时要回来核对。
 * 2. **再发一次重算信号**，让插件按新主题重新跑一遍 parser。
 */
export function refreshMilkdownHighlight(view: EditorView): void {
  const plugin = view.state.plugins.find((item) => {
    const key = (item as unknown as { key?: string }).key
    return typeof key === 'string' && key.startsWith(HIGHLIGHT_KEY_PREFIX)
  })
  const state = plugin?.getState(view.state) as HighlightPluginState | undefined
  state?.cache?.cache?.clear()
  view.dispatch(view.state.tr.setMeta(HIGHLIGHT_REFRESH_META, true))
}
