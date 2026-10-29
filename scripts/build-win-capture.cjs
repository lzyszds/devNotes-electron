// 构建 Windows 截图助手（native/win-capture）。
//
// 必须用 MSVC：链路里是 WIC / GDI / WinRT / Windows 头文件。CI 的 windows-latest
// 默认 PATH 里没有 cl.exe，这里用 vswhere 找到 vcvars64.bat 再配置。
// 本地若已打开 “x64 Native Tools Command Prompt”，检测到 VCINSTALLDIR 就直接编。
//
// 生成器优先 Ninja，没有就退回 NMake Makefiles。两者都是单配置，
// 产物固定落在 native/<proj>/build/Release/，和 extraResources 一致。
// 不用 Visual Studio 多配置生成器：它会再拼一层 Release/，打包路径对不上。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

// 产物路径同时被 extraResources（package.json）和 CI 校验（.github/workflows）引用
const PROJECTS = [
  { dir: 'win-capture', exe: 'devnotes-capture.exe', ctest: true },
]

if (process.platform !== 'win32') {
  console.log('[win-helpers] 非 Windows 平台，跳过原生助手构建')
  process.exit(0)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) {
    console.error(`[win-helpers] 无法执行 ${command}：${result.error.message}`)
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
    console.error('[win-helpers] 找不到 vswhere.exe，请安装 Visual Studio 的“使用 C++ 的桌面开发”')
    process.exit(1)
  }
  const found = spawnSync(vswhere, [
    '-latest',
    '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8' })
  // 只取第一行：装了多个 VS 时 vswhere 会逐行输出，拼在一起路径就不对了
  const install = (found.stdout || '').trim().split(/\r?\n/)[0].trim()
  const bat = install && path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  if (!bat || !fs.existsSync(bat)) {
    console.error('[win-helpers] 找不到 vcvars64.bat，请安装 MSVC x64 工具集')
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
  console.log('[win-helpers] PATH 里没有 ninja，改用 NMake Makefiles')
}

function projectSteps(project) {
  const sourceDir = path.join(root, 'native', project.dir)
  const buildDir = path.join(sourceDir, 'build')
  const steps = [
    ['cmake', ['-S', sourceDir, '-B', buildDir, '-G', generator, '-DCMAKE_BUILD_TYPE=Release']],
    ['cmake', ['--build', buildDir]],
  ]
  // 只有 win-capture 带选区单测（不依赖 Windows API，任意平台/CI 可跑）
  if (project.ctest) {
    steps.push(['ctest', ['--test-dir', buildDir, '--output-on-failure']])
  }
  return steps
}

// vcvars 只对当前 cmd 会话生效，所有工程的三步必须包在同一次 cmd /c 里。
//
// 引号只能放在自己写好的批处理里：batch 和参数交给 PowerShell 传时，
// Git Bash 会再剥一层引号、pwsh 的默认 shell 又是 PowerShell —— VS 装在
// "Program Files" 下，路径一旦少引号就是 'C:\Program' 不是内部命令。
const chain = PROJECTS.flatMap((project) =>
  projectSteps(project).map(([command, args]) => [command, ...args.map((arg) => `"${arg}"`)].join(' ')),
).join(' && ')

if (msvcAlreadyLoaded()) {
  run('cmd.exe', ['/d', '/s', '/c', chain])
} else {
  const bat = findVcvars64()
  const tempDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || process.env.TEMP || root, 'win-helpers-'))
  const script = path.join(tempDir, 'build.cmd')
  fs.writeFileSync(script, ['@echo off', `call "${bat}"`, chain, ''].join('\r\n'))
  run('cmd.exe', ['/d', '/c', script])
  fs.rmSync(tempDir, { recursive: true, force: true })
}

for (const project of PROJECTS) {
  const output = path.join(root, 'native', project.dir, 'build', 'Release', project.exe)
  if (!fs.existsSync(output)) {
    console.error(`[win-helpers] 未生成 ${output}`)
    process.exit(1)
  }
}
console.log('[win-helpers] 原生助手构建完成')
