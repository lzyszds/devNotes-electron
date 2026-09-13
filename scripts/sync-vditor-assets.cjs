// 把 Vditor 的运行时资源同步到 public/vditor/dist
//
// Vditor 不走打包器管线:它通过 addScript() 在运行时按 ${cdn}/dist/... 的规则
// 动态插入 <script>/<link> 去拉 lute 引擎、图标、语言包、mermaid 等。
// 所以这些文件必须原样躺在 public/ 下,由 Vite 复制进 dist/,最终进 asar。
//
// 用法:node scripts/sync-vditor-assets.cjs
// 已接入 package.json 的 predev / prebuild / prebuild:web,一般不用手动跑。

const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const sourceDir = path.join(root, 'node_modules/vditor/dist')
const targetDir = path.join(root, 'public/vditor/dist')

// 只同步本项目用得到的子集(约 10 MB)。
// 刻意跳过 mathjax(6.5M,katex 才是默认数学引擎)、graphviz、echarts、
// markmap、abcjs、smiles-drawer、flowchart.js、wavedrom、plantuml —— 合计约 11 MB。
// 将来若需要某种图表,把对应目录名加进来再重跑本脚本即可。
const ENTRIES = [
  'index.css', // 主样式,导出/打印的 iframe 里会引用
  'method.min.js', // 导出与打印流程
  'css/content-theme', // 内容主题(代码块/引用块配色)
  'js/lute', // ★ 核心 markdown 引擎,缺了编辑器起不来
  'js/icons', // ★ 工具栏图标
  'js/i18n', // ★ 语言包
  'js/mermaid', // mermaid 图(Vditor 内置支持)
  'js/highlight.js', // 代码块高亮
  'js/katex', // 数学公式
  'images', // emoji 等零散图片
]

// 目录大小写敏感、且要能识别出 node_modules 缺失这类前置问题
if (!fs.existsSync(sourceDir)) {
  console.error(`找不到 ${sourceDir},请先执行 npm install`)
  process.exit(1)
}

// 先整体清掉再重建,避免改名/删除的资源残留成幽灵文件
fs.rmSync(targetDir, { recursive: true, force: true })
fs.mkdirSync(targetDir, { recursive: true })

let copied = 0
let bytes = 0

for (const entry of ENTRIES) {
  const from = path.join(sourceDir, entry)
  const to = path.join(targetDir, entry)

  if (!fs.existsSync(from)) {
    console.error(`Vditor 资源缺失: ${entry}(vditor 版本可能已变更目录结构)`)
    process.exit(1)
  }

  fs.cpSync(from, to, { recursive: true })
  copied += 1
  bytes += dirSize(from)
}

function dirSize(target) {
  const stat = fs.statSync(target)
  if (!stat.isDirectory()) return stat.size
  return fs
    .readdirSync(target)
    .reduce((sum, name) => sum + dirSize(path.join(target, name)), 0)
}

console.log(
  `vditor 资源已同步: ${copied} 项, ${(bytes / 1048576).toFixed(1)} MB -> public/vditor/dist`
)
