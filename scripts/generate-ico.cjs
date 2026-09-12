// 从 assets/icon.iconset 的多尺寸 PNG 生成 assets/icon.ico(PNG-in-ICO 格式)
// 用法:node scripts/generate-ico.cjs(图标变更后重新执行一次即可)
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const sizes = [16, 32, 64, 128, 256]

// 读取 PNG 并校验实际边长,避免错误尺寸的图标集被静默打进 ico
function readPng(size) {
  const file = path.join(root, 'assets/icon.iconset', `icon_${size}x${size}.png`)
  const data = fs.readFileSync(file)
  if (data.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    console.error(`不是 PNG: ${file}`)
    process.exit(1)
  }
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (width !== size || height !== size) {
    console.error(`尺寸不符: ${file} 实际 ${width}x${height},期望 ${size}x${size}`)
    process.exit(1)
  }
  return { size, data }
}

const pngs = sizes.map(readPng)

// ICO 头:6 字节 + 每个条目 16 字节目录项 + PNG 数据
const headerSize = 6 + pngs.length * 16
const entries = []
let offset = headerSize
for (const { size, data } of pngs) {
  const entry = Buffer.alloc(16)
  // 256px 的宽/高按规范写 0
  entry.writeUInt8(size >= 256 ? 0 : size, 0)
  entry.writeUInt8(size >= 256 ? 0 : size, 1)
  entry.writeUInt8(0, 2) // 调色板色数
  entry.writeUInt8(0, 3) // 保留
  entry.writeUInt16LE(1, 4) // 颜色平面数
  entry.writeUInt16LE(32, 6) // 位深
  entry.writeUInt32LE(data.length, 8)
  entry.writeUInt32LE(offset, 12)
  entries.push(entry)
  offset += data.length
}

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // 保留
header.writeUInt16LE(1, 2) // 类型:图标
header.writeUInt16LE(pngs.length, 4)

const out = Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
const outFile = path.join(root, 'assets/icon.ico')
fs.writeFileSync(outFile, out)
console.log(`已生成 ${outFile}(${out.length} 字节,${pngs.length} 个尺寸)`)
