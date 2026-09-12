// 从 assets/icon.iconset 的多尺寸 PNG 生成 assets/icon.icns。
// 用法: node scripts/generate-icns.cjs(图标变更后重新执行一次即可)
//
// ICNS 结构: 'icns' magic + 总长度(大端 4 字节) + 若干块[4 字节类型 + 4 字节长度(含头) + 数据]。
// 各块统一写 PNG 数据(Apple 规格里 ic04/ic05 也接受 PNG,不必手写 PackBits 压缩的 ARGB)。
// 末尾的 info 元数据块(Xcode 资源目录引用,不含图像)从旧文件原样沿用,避免丢元信息。
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const iconsetDir = path.join(root, 'assets/icon.iconset')
const outFile = path.join(root, 'assets/icon.icns')

// 块类型 -> iconset 文件名(按像素边长升序,顺序不影响 macOS 读取)
const BLOCKS = [
  ['ic04', 'icon_16x16.png', 16],
  ['ic05', 'icon_32x32.png', 32],
  ['ic11', 'icon_16x16@2x.png', 32],
  ['ic12', 'icon_32x32@2x.png', 64],
  ['ic07', 'icon_128x128.png', 128],
  ['ic08', 'icon_256x256.png', 256],
  ['ic13', 'icon_128x128@2x.png', 256],
  ['ic14', 'icon_256x256@2x.png', 512],
  ['ic09', 'icon_512x512.png', 512],
  ['ic10', 'icon_512x512@2x.png', 1024],
]

// 先读旧文件里的 info 块(要在覆盖之前读)
function readLegacyInfoBlock() {
  try {
    const legacy = fs.readFileSync(outFile)
    let offset = 8
    while (offset + 8 <= legacy.length) {
      const type = legacy.toString('ascii', offset, offset + 4)
      const length = legacy.readUInt32BE(offset + 4)
      if (length < 8) return null
      if (type === 'info') return legacy.subarray(offset, offset + length)
      offset += length
    }
  } catch {
    // 首次生成时没有旧文件,属正常情况
  }
  return null
}

const chunks = BLOCKS.map(([type, file, size]) => {
  const filePath = path.join(iconsetDir, file)
  if (!fs.existsSync(filePath)) {
    console.error(`缺少图标集文件: ${filePath}(请先执行 node scripts/generate-iconset.cjs)`)
    process.exit(1)
  }
  const data = fs.readFileSync(filePath)
  // 校验实际边长,避免错误尺寸的图标集被静默打进 icns
  if (data.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    console.error(`不是 PNG: ${filePath}`)
    process.exit(1)
  }
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (width !== size || height !== size) {
    console.error(`尺寸不符: ${filePath} 实际 ${width}x${height},期望 ${size}x${size}`)
    process.exit(1)
  }
  const header = Buffer.alloc(8)
  header.write(type, 0, 4, 'ascii')
  header.writeUInt32BE(data.length + 8, 4) // 长度含这 8 字节头
  return Buffer.concat([header, data])
})

const infoBlock = readLegacyInfoBlock()
if (infoBlock) chunks.push(infoBlock)

const body = Buffer.concat(chunks)
const header = Buffer.alloc(8)
header.write('icns', 0, 4, 'ascii')
header.writeUInt32BE(body.length + 8, 4)

fs.writeFileSync(outFile, Buffer.concat([header, body]))
console.log(
  `已生成 ${outFile}(${body.length + 8} 字节,${BLOCKS.length} 个图像块${infoBlock ? ' + info 元数据' : ''})`
)
