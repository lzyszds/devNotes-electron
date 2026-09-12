// 从透明背景的源图生成全套图标 PNG:
//   assets/icon.iconset/*.png   多尺寸图标集(供 generate-ico / generate-icns 使用)
//   assets/icon.png             1024x1024 主图(Electron 运行时 / 托盘)
//   src/assets/logo.png         512x512,供 React 组件 import(带 hash,file:// 下也不会断)
//   public/favicon.png          64x64 网页图标
//
// 用法: node scripts/generate-iconset.cjs [源图路径]
//   ffmpeg 路径可用环境变量覆盖: FFMPEG=/path/to/ffmpeg node scripts/generate-iconset.cjs
// 图标变更后重新执行一次即可(产物入库,构建流程不依赖 ffmpeg)。
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const ffmpeg = process.env.FFMPEG || 'ffmpeg'
const source = process.argv[2] || path.join(root, 'assets/logo.webp')

// 源图里非透明内容的包围盒(用 alphaextract 量出来的,见 README/提交说明)。
// 源图是 1254x1254,主体只占中间一块,直接缩到图标尺寸会显得很小,
// 所以先裁到内容、再居中放到方形透明画布上,让主体占到画布的 MASTER_CONTENT_RATIO。
const CROP = { w: 657, h: 733, x: 300, y: 249 }

// 主图边长为 1024,主体高度占 86%(其余是透明留白,macOS 图标惯例)
const MASTER = 1024
const MASTER_CONTENT_RATIO = 0.86
const contentH = Math.round(MASTER * MASTER_CONTENT_RATIO) // 880
const contentW = Math.round((CROP.w * contentH) / CROP.h) // 789
const padX = Math.round((MASTER - contentW) / 2) // 117
const padY = Math.round((MASTER - contentH) / 2) // 72

// 裁切 -> 缩放 -> 垫到方形透明画布
const MASTER_FILTER = [
  'format=rgba',
  `crop=${CROP.w}:${CROP.h}:${CROP.x}:${CROP.y}`,
  `scale=${contentW}:${contentH}:flags=lanczos`,
  `pad=${MASTER}:${MASTER}:${padX}:${padY}:color=#00000000`,
].join(',')

// iconset 的 11 个文件:文件后缀 -> 像素边长(与 generate-ico / generate-icns 的约定一致)
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_64x64.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

function run(args) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
}

if (!fs.existsSync(source)) {
  console.error(`源图不存在: ${source}`)
  process.exit(1)
}

const iconsetDir = path.join(root, 'assets/icon.iconset')
fs.mkdirSync(iconsetDir, { recursive: true })
fs.mkdirSync(path.join(root, 'public'), { recursive: true })
fs.mkdirSync(path.join(root, 'src/assets'), { recursive: true })

// 1. 主图(1024x1024)
const masterFile = path.join(root, 'assets/icon.png')
run(['-i', source, '-vf', MASTER_FILTER, '-frames:v', '1', '-pix_fmt', 'rgba', masterFile])
console.log(`已生成 ${path.relative(root, masterFile)}(${MASTER}x${MASTER})`)

// 2. 其余尺寸一律从主图缩放,保证风格一致、且只解码一次源图
const derived = [
  ...ICONSET.map(([name, size]) => [path.join(iconsetDir, name), size]),
  [path.join(root, 'src/assets/logo.png'), 512],
  [path.join(root, 'public/favicon.png'), 64],
]

for (const [file, size] of derived) {
  if (size === MASTER) {
    fs.copyFileSync(masterFile, file)
  } else {
    run([
      '-i', masterFile,
      '-vf', `scale=${size}:${size}:flags=lanczos`,
      '-frames:v', '1', '-pix_fmt', 'rgba', file,
    ])
  }
  console.log(`  ${path.relative(root, file).padEnd(46)} ${size}x${size}`)
}
