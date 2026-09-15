/**
 * 生成 src/utils/highlightLanguages.ts。
 *
 * 为什么需要它：shiki 默认给它支持的 242 种语言每种切一个 chunk，一行代码没用上也会进安装包
 * （实测 242 个 chunk 合计 7.6 MB）。要减体积，唯一办法是**构建时**就只 import 用得到的那些，
 * 而 import 的路径必须写成静态字面量，没法从数组循环生成 —— 所以这里用脚本生成一份显式清单。
 *
 * 用法：改下面的 LANGUAGES，然后 `node scripts/generate-highlight-languages.mjs`
 *
 * LANGUAGES 里写 shiki 的 id 或别名都行（dockerfile / makefile / protobuf 都是别名），
 * 脚本会统一换算成规范 id，并带上 shiki 自己的显示名与别名表。
 */
import { writeFileSync } from 'node:fs'
import { bundledLanguagesInfo } from 'shiki/langs'

/**
 * 参与打包的语言。默认这份覆盖 Web / 后端 / 运维脚本的常见需要。
 *
 * 「尽量精简」的话优先砍体积大的：cpp 单个 767 KB（含 C 语法），
 * 其次是 objective-cpp、typst、angular-ts、vue-vine 这类专用语法。
 * 砍掉的语言不会消失 —— 围栏写它时会退化成自动识别或单色，只是没有精确配色。
 */
const LANGUAGES = [
  // Web / 前端
  'javascript', 'jsx', 'typescript', 'tsx', 'vue', 'svelte',
  'html', 'css', 'scss', 'less', 'stylus',
  'json', 'jsonc', 'json5', 'yaml', 'toml', 'xml',
  'markdown', 'mdx', 'graphql', 'csv', 'dotenv', 'ini',
  // 后端与系统语言
  'java', 'kotlin', 'scala', 'groovy', 'go', 'rust',
  'c', 'cpp', 'csharp', 'php', 'ruby', 'python',
  'swift', 'dart', 'lua', 'r', 'perl', 'objective-c',
  'elixir', 'erlang', 'haskell', 'clojure', 'zig', 'julia', 'solidity',
  // 脚本、配置与运维
  'shellscript', 'powershell', 'bat', 'docker', 'make', 'nginx',
  'sql', 'proto', 'diff', 'git-commit', 'terraform', 'regex',
  // 文档与其它
  'latex', 'mermaid', 'asm', 'viml',
]

/** 别名 → 规范 id。写错的名字直接报错退出，别悄悄少打一个语言 */
function resolveId(name) {
  const byId = bundledLanguagesInfo.find((info) => info.id === name)
  if (byId) return byId
  const byAlias = bundledLanguagesInfo.find((info) => (info.aliases ?? []).includes(name))
  if (byAlias) return byAlias
  throw new Error(`shiki 里没有这个语言：${name}`)
}

const langs = LANGUAGES.map(resolveId)
const dupes = langs.map((l) => l.id).filter((id, i, all) => all.indexOf(id) !== i)
if (dupes.length) throw new Error(`清单里有重复：${[...new Set(dupes)].join(', ')}`)

const entries = langs
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(
    ({ id, name, aliases }) => `  {
    id: ${JSON.stringify(id)},
    name: ${JSON.stringify(name ?? id)},
    aliases: ${JSON.stringify(aliases ?? [])},
    load: () => import('shiki/langs/${id}.mjs'),
  },`
  )
  .join('\n')

const output = `/**
 * 参与打包的高亮语言清单。
 *
 * ⚠️ 这个文件是**生成**的，别手改：${new Date().toISOString().slice(0, 10)}
 *    改 \`scripts/generate-highlight-languages.mjs\` 里的 LANGUAGES，再跑
 *    \`node scripts/generate-highlight-languages.mjs\`。
 *
 * 为什么要有这份清单：\`shiki/langs\` 那张总表自带全部 ${bundledLanguagesInfo.length} 种语言的 loader，
 * 只要 import 了它（哪怕只为读个显示名），构建时就会把每种语言各切一个 chunk 打进安装包
 * （实测 242 个共 7.6 MB）。这里改成显式列出 —— 只有写到的语言才会被打包。
 *
 * load 指向 \`shiki/langs/<id>.mjs\`（shiki 自己 pin 的那个包），所以不必额外依赖 @shikijs/langs。
 */

/** shiki 的语言模块是 \`export default [grammar]\`，loadLanguage 会自己取 default */
type LanguageModule = { default: unknown }

export interface BundledLanguage {
  id: string
  /** shiki 的显示名，语言选择器里用 */
  name: string
  /** 围栏里可能写的别名（js、ts、yml …），用来把用户写的标签对应到 id */
  aliases: string[]
  load: () => Promise<LanguageModule>
}

export const BUNDLED_LANGUAGES: BundledLanguage[] = [
${entries}
]
`

writeFileSync(new URL('../src/utils/highlightLanguages.ts', import.meta.url), output)
console.log(
  `已生成 ${langs.length} 种语言（shiki 共 ${bundledLanguagesInfo.length} 种）→ src/utils/highlightLanguages.ts`
)
