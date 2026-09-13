/**
 * 解析 Vditor 运行时资源的 cdn 基址。
 *
 * Vditor 不走打包器管线:它按 `${cdn}/dist/js/lute/lute.min.js` 这类规则在运行时
 * 动态插入 <script>/<link> 去拉核心引擎、图标、语言包与图表库。因此 cdn 必须指向
 * public/vditor(构建后是 dist/vditor,打包后是 asar 内的 dist/vditor)。
 *
 * 关键:不能写死绝对路径 `/vditor`。生产环境 Electron 用 file:// 加载 dist/index.html,
 * 绝对路径会被解析到文件系统根 `file:///vditor/...` 而全部 404。Vite 的 BASE_URL
 * 在 dev 下是 `/`、生产构建下是 `./`,两种都能正确拼出可解析的相对/绝对地址。
 */
export function resolveVditorCdn(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalized}vditor`
}
