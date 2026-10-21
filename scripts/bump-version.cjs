/*
 * 打包前自动升级版本号：把 version 最后一段 +1。
 *
 * 版本号形如 2026.4.2920（年.次版本.构建号），每次 build 递增最后一段，
 * 产物名直接用版本号（见 package.json 的 artifactName），所以每打一次包
 * 就多一个新版本，不用手动改。
 */
const fs = require('node:fs')
const path = require('node:path')

const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

const parts = pkg.version.split('.')
const build = Number(parts[parts.length - 1])
if (!Number.isFinite(build)) {
  console.error('版本号最后一段不是数字，无法自动升级：' + pkg.version)
  process.exit(1)
}
parts[parts.length - 1] = String(build + 1)
pkg.version = parts.join('.')

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('版本号已升级到 ' + pkg.version)

// 在 GitHub Actions 里把新版本号写进输出，供后续 job 读取
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${pkg.version}\n`)
}
