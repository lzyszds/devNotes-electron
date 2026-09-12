/**
 * 让 Node 的 ESM 解析器认识项目里那种无扩展名的相对导入。
 *
 * tsconfig 用的是 moduleResolution: bundler，src/ 下 60 多处相对导入都写成
 * './markdownStats' 这种形式，Vite 能解析、Node 的原生 ESM 不能。为了不给测试
 * 去改一遍源码，这里挂一个 resolve 钩子补上 .ts 的查找。
 *
 * 只处理相对导入、只补 .ts：.tsx 里的 JSX 不是类型擦除能处理的，真要单测 React
 * 组件得另想办法（目前没有这样的用例）。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  if (isRelative && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
    const candidate = specifier + '.ts'
    if (existsSync(fileURLToPath(new URL(candidate, context.parentURL)))) {
      return nextResolve(candidate, context)
    }
  }
  return nextResolve(specifier, context)
}
