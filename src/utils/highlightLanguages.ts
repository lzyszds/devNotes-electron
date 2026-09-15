/**
 * 参与打包的高亮语言清单。
 *
 * ⚠️ 这个文件是**生成**的，别手改：2026-09-14
 *    改 `scripts/generate-highlight-languages.mjs` 里的 LANGUAGES，再跑
 *    `node scripts/generate-highlight-languages.mjs`。
 *
 * 为什么要有这份清单：`shiki/langs` 那张总表自带全部 242 种语言的 loader，
 * 只要 import 了它（哪怕只为读个显示名），构建时就会把每种语言各切一个 chunk 打进安装包
 * （实测 242 个共 7.6 MB）。这里改成显式列出 —— 只有写到的语言才会被打包。
 *
 * load 指向 `shiki/langs/<id>.mjs`（shiki 自己 pin 的那个包），所以不必额外依赖 @shikijs/langs。
 */

/** shiki 的语言模块是 `export default [grammar]`，loadLanguage 会自己取 default */
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
  {
    id: "asm",
    name: "Assembly",
    aliases: [],
    load: () => import('shiki/langs/asm.mjs'),
  },
  {
    id: "bat",
    name: "Batch File",
    aliases: ["batch","cmd"],
    load: () => import('shiki/langs/bat.mjs'),
  },
  {
    id: "c",
    name: "C",
    aliases: [],
    load: () => import('shiki/langs/c.mjs'),
  },
  {
    id: "clojure",
    name: "Clojure",
    aliases: ["clj"],
    load: () => import('shiki/langs/clojure.mjs'),
  },
  {
    id: "cpp",
    name: "C++",
    aliases: ["c++"],
    load: () => import('shiki/langs/cpp.mjs'),
  },
  {
    id: "csharp",
    name: "C#",
    aliases: ["c#","cs"],
    load: () => import('shiki/langs/csharp.mjs'),
  },
  {
    id: "css",
    name: "CSS",
    aliases: [],
    load: () => import('shiki/langs/css.mjs'),
  },
  {
    id: "csv",
    name: "CSV",
    aliases: [],
    load: () => import('shiki/langs/csv.mjs'),
  },
  {
    id: "dart",
    name: "Dart",
    aliases: [],
    load: () => import('shiki/langs/dart.mjs'),
  },
  {
    id: "diff",
    name: "Diff",
    aliases: [],
    load: () => import('shiki/langs/diff.mjs'),
  },
  {
    id: "docker",
    name: "Dockerfile",
    aliases: ["dockerfile"],
    load: () => import('shiki/langs/docker.mjs'),
  },
  {
    id: "dotenv",
    name: "dotEnv",
    aliases: [],
    load: () => import('shiki/langs/dotenv.mjs'),
  },
  {
    id: "elixir",
    name: "Elixir",
    aliases: [],
    load: () => import('shiki/langs/elixir.mjs'),
  },
  {
    id: "erlang",
    name: "Erlang",
    aliases: ["erl"],
    load: () => import('shiki/langs/erlang.mjs'),
  },
  {
    id: "git-commit",
    name: "Git Commit Message",
    aliases: [],
    load: () => import('shiki/langs/git-commit.mjs'),
  },
  {
    id: "go",
    name: "Go",
    aliases: [],
    load: () => import('shiki/langs/go.mjs'),
  },
  {
    id: "graphql",
    name: "GraphQL",
    aliases: ["gql"],
    load: () => import('shiki/langs/graphql.mjs'),
  },
  {
    id: "groovy",
    name: "Groovy",
    aliases: [],
    load: () => import('shiki/langs/groovy.mjs'),
  },
  {
    id: "haskell",
    name: "Haskell",
    aliases: ["hs"],
    load: () => import('shiki/langs/haskell.mjs'),
  },
  {
    id: "html",
    name: "HTML",
    aliases: [],
    load: () => import('shiki/langs/html.mjs'),
  },
  {
    id: "ini",
    name: "INI",
    aliases: ["properties"],
    load: () => import('shiki/langs/ini.mjs'),
  },
  {
    id: "java",
    name: "Java",
    aliases: [],
    load: () => import('shiki/langs/java.mjs'),
  },
  {
    id: "javascript",
    name: "JavaScript",
    aliases: ["js","cjs","mjs"],
    load: () => import('shiki/langs/javascript.mjs'),
  },
  {
    id: "json",
    name: "JSON",
    aliases: [],
    load: () => import('shiki/langs/json.mjs'),
  },
  {
    id: "json5",
    name: "JSON5",
    aliases: [],
    load: () => import('shiki/langs/json5.mjs'),
  },
  {
    id: "jsonc",
    name: "JSON with Comments",
    aliases: [],
    load: () => import('shiki/langs/jsonc.mjs'),
  },
  {
    id: "jsx",
    name: "JSX",
    aliases: [],
    load: () => import('shiki/langs/jsx.mjs'),
  },
  {
    id: "julia",
    name: "Julia",
    aliases: ["jl"],
    load: () => import('shiki/langs/julia.mjs'),
  },
  {
    id: "kotlin",
    name: "Kotlin",
    aliases: ["kt","kts"],
    load: () => import('shiki/langs/kotlin.mjs'),
  },
  {
    id: "latex",
    name: "LaTeX",
    aliases: [],
    load: () => import('shiki/langs/latex.mjs'),
  },
  {
    id: "less",
    name: "Less",
    aliases: [],
    load: () => import('shiki/langs/less.mjs'),
  },
  {
    id: "lua",
    name: "Lua",
    aliases: [],
    load: () => import('shiki/langs/lua.mjs'),
  },
  {
    id: "make",
    name: "Makefile",
    aliases: ["makefile"],
    load: () => import('shiki/langs/make.mjs'),
  },
  {
    id: "markdown",
    name: "Markdown",
    aliases: ["md"],
    load: () => import('shiki/langs/markdown.mjs'),
  },
  {
    id: "mdx",
    name: "MDX",
    aliases: [],
    load: () => import('shiki/langs/mdx.mjs'),
  },
  {
    id: "mermaid",
    name: "Mermaid",
    aliases: ["mmd"],
    load: () => import('shiki/langs/mermaid.mjs'),
  },
  {
    id: "nginx",
    name: "Nginx",
    aliases: [],
    load: () => import('shiki/langs/nginx.mjs'),
  },
  {
    id: "objective-c",
    name: "Objective-C",
    aliases: ["objc"],
    load: () => import('shiki/langs/objective-c.mjs'),
  },
  {
    id: "perl",
    name: "Perl",
    aliases: [],
    load: () => import('shiki/langs/perl.mjs'),
  },
  {
    id: "php",
    name: "PHP",
    aliases: [],
    load: () => import('shiki/langs/php.mjs'),
  },
  {
    id: "powershell",
    name: "PowerShell",
    aliases: ["ps","ps1","pwsh"],
    load: () => import('shiki/langs/powershell.mjs'),
  },
  {
    id: "proto",
    name: "Protocol Buffer 3",
    aliases: ["protobuf"],
    load: () => import('shiki/langs/proto.mjs'),
  },
  {
    id: "python",
    name: "Python",
    aliases: ["py"],
    load: () => import('shiki/langs/python.mjs'),
  },
  {
    id: "r",
    name: "R",
    aliases: [],
    load: () => import('shiki/langs/r.mjs'),
  },
  {
    id: "regexp",
    name: "RegExp",
    aliases: ["regex"],
    load: () => import('shiki/langs/regexp.mjs'),
  },
  {
    id: "ruby",
    name: "Ruby",
    aliases: ["rb"],
    load: () => import('shiki/langs/ruby.mjs'),
  },
  {
    id: "rust",
    name: "Rust",
    aliases: ["rs"],
    load: () => import('shiki/langs/rust.mjs'),
  },
  {
    id: "scala",
    name: "Scala",
    aliases: [],
    load: () => import('shiki/langs/scala.mjs'),
  },
  {
    id: "scss",
    name: "SCSS",
    aliases: [],
    load: () => import('shiki/langs/scss.mjs'),
  },
  {
    id: "shellscript",
    name: "Shell",
    aliases: ["bash","sh","shell","zsh"],
    load: () => import('shiki/langs/shellscript.mjs'),
  },
  {
    id: "solidity",
    name: "Solidity",
    aliases: [],
    load: () => import('shiki/langs/solidity.mjs'),
  },
  {
    id: "sql",
    name: "SQL",
    aliases: [],
    load: () => import('shiki/langs/sql.mjs'),
  },
  {
    id: "stylus",
    name: "Stylus",
    aliases: ["styl"],
    load: () => import('shiki/langs/stylus.mjs'),
  },
  {
    id: "svelte",
    name: "Svelte",
    aliases: [],
    load: () => import('shiki/langs/svelte.mjs'),
  },
  {
    id: "swift",
    name: "Swift",
    aliases: [],
    load: () => import('shiki/langs/swift.mjs'),
  },
  {
    id: "terraform",
    name: "Terraform",
    aliases: ["tf","tfvars"],
    load: () => import('shiki/langs/terraform.mjs'),
  },
  {
    id: "toml",
    name: "TOML",
    aliases: [],
    load: () => import('shiki/langs/toml.mjs'),
  },
  {
    id: "tsx",
    name: "TSX",
    aliases: [],
    load: () => import('shiki/langs/tsx.mjs'),
  },
  {
    id: "typescript",
    name: "TypeScript",
    aliases: ["ts","cts","mts"],
    load: () => import('shiki/langs/typescript.mjs'),
  },
  {
    id: "viml",
    name: "Vim Script",
    aliases: ["vim","vimscript"],
    load: () => import('shiki/langs/viml.mjs'),
  },
  {
    id: "vue",
    name: "Vue",
    aliases: [],
    load: () => import('shiki/langs/vue.mjs'),
  },
  {
    id: "xml",
    name: "XML",
    aliases: [],
    load: () => import('shiki/langs/xml.mjs'),
  },
  {
    id: "yaml",
    name: "YAML",
    aliases: ["yml"],
    load: () => import('shiki/langs/yaml.mjs'),
  },
  {
    id: "zig",
    name: "Zig",
    aliases: [],
    load: () => import('shiki/langs/zig.mjs'),
  },
]
