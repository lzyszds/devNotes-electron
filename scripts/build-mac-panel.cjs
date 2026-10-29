// N-API 不依赖 Electron 的 V8 ABI，用 Node headers 编译即可；安装包不能依赖本机残留的 .node。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.platform !== 'darwin') process.exit(0)

const root = path.resolve(__dirname, '..')
const nativeDir = path.join(root, 'native')
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
const result = spawnSync(process.execPath, [nodeGyp, 'rebuild', '--arch=arm64'], {
  cwd: nativeDir,
  stdio: 'inherit',
  // 仓库间接安装的 node-gyp 9 依赖 distutils，不能误用 Homebrew 的 Python 3.12+。
  env: {
    ...process.env,
    npm_config_python: process.env.npm_config_python || process.env.PYTHON || '/usr/bin/python3',
  },
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const output = path.join(nativeDir, 'build/Release/nonactivating.node')
if (!fs.existsSync(output)) throw new Error(`未生成剪贴板窗口组件：${output}`)
console.log('[clipboard] 已构建 macOS arm64 不抢焦点组件（与当前安装包架构一致）')
