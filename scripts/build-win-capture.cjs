// 构建 Windows 截图助手（native/win-capture）。
//
// 必须用 MSVC：链路里是 WIC / GDI / Windows 头文件。CI 的 windows-latest
// 默认 PATH 里没有 cl.exe，这里用 vswhere 找到 vcvars64.bat 再配置。
// 本地若已打开 “x64 Native Tools Command Prompt”，检测到 VCINSTALLDIR 就直接编。
//
// 生成器优先 Ninja，没有就退回 NMake Makefiles。两者都是单配置，
// 产物固定落在 native/win-capture/build/Release/，和 extraResources 一致。
// 不用 Visual Studio 多配置生成器：它会再拼一层 Release/，打包路径对不上。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const sourceDir = path.join(root, 'native', 'win-capture')
const buildDir = path.join(sourceDir, 'build')
const output = path.join(buildDir, 'Release', 'devnotes-capture.exe')

if (process.platform !== 'win32') {
  console.log('[win-capture] 非 Windows 平台，跳过原生截图助手构建')
  process.exit(0)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) {
    console.error(`[win-capture] 无法执行 ${command}：${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/** Native Tools Prompt 已经把 cl 放进环境；普通 cmd / GitHub runner 没有。 */
function msvcAlreadyLoaded() {
  return Boolean(process.env.VCToolsInstallDir || process.env.VCINSTALLDIR)
}

function findVcvars64() {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  )
  if (!fs.existsSync(vswhere)) {
    console.error('[win-capture] 找不到 vswhere.exe，请安装 Visual Studio 的“使用 C++ 的桌面开发”')
    process.exit(1)
  }
  const found = spawnSync(vswhere, [
    '-latest',
    '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8' })
  const install = (found.stdout || '').trim().split(/\r?\n/)[0].trim()
  const bat = install && path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  if (!bat || !fs.existsSync(bat)) {
    console.error('[win-capture] 找不到 vcvars64.bat，请安装 MSVC x64 工具集')
    process.exit(1)
  }
  return bat
}

function ninjaOnPath() {
  const found = spawnSync('where', ['ninja'], { encoding: 'utf8', shell: true })
  return found.status === 0
}

const generator = ninjaOnPath() ? 'Ninja' : 'NMake Makefiles'
if (generator !== 'Ninja') {
  console.log('[win-capture] PATH 里没有 ninja，改用 NMake Makefiles')
}

const cmakeArgs = [
  '-S', sourceDir,
  '-B', buildDir,
  '-G', generator,
  '-DCMAKE_BUILD_TYPE=Release',
]
const buildSteps = [
  ['cmake', cmakeArgs],
  ['cmake', ['--build', buildDir]],
  ['ctest', ['--test-dir', buildDir, '--output-on-failure']],
]

if (msvcAlreadyLoaded()) {
  for (const [command, args] of buildSteps) run(command, args)
} else {
  // vcvars 只对当前 cmd 会话生效，三次调用必须包在同一次 cmd /c 里
  const bat = findVcvars64()
  const chain = buildSteps
    .map(([command, args]) => [command, ...args.map((arg) => `"${arg}"`)].join(' '))
    .join(' && ')
  // 只在外层包一对引号：cmd /s /c 会剥掉首尾引号，内层再给 bat 加引号
  // 会被当成命令名的一部分（GitHub runner 的 VS 装在 "Program Files" 下，必踩）。
  run('cmd.exe', ['/d', '/s', '/c', `call ${bat} && ${chain}`])
}

if (!fs.existsSync(output)) {
  console.error(`[win-capture] 未生成 ${output}`)
  process.exit(1)
}
console.log(`[win-capture] 已生成 ${path.relative(root, output)}`)
