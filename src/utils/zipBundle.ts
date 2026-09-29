/*
 * 批量导出打包。
 *
 * 用 jszip 生成 zip：图片本身已经压过了，zip 再 deflate 几乎没收益还费时间，
 * 所以统一走 STORE（仅存储）模式，打包是瞬时的。
 */

import JSZip from 'jszip'

export interface BundleEntry {
  /** zip 内的文件名，含扩展名 */
  name: string
  blob: Blob
}

/**
 * 把若干文件打成一个 zip。
 *
 * 同名会互相覆盖，调用方要保证 name 唯一 —— 多倍图按 @1x/@2x/@3x 命名
 * 天然不重名。
 */
export async function bundleZip(entries: BundleEntry[]): Promise<Blob> {
  if (!entries.length) throw new Error('没有可打包的文件')

  const zip = new JSZip()
  for (const entry of entries) {
    zip.file(entry.name, entry.blob)
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'STORE',
  })
}

/**
 * 触发浏览器下载。Electron 里会落到系统的下载目录/弹出保存框，
 * 移动端 Capacitor 交给 WebView 处理。
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // 立刻撤销会让部分环境来不及取数据，挪到下一轮事件循环
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * 把 Blob 读成 DataURL，用于内联到 CSS/HTML。
 *
 * 走 FileReader 而不是 blob.arrayBuffer() + btoa：前者是流式的，
 * 大图不会一次性把字节数组和 base64 串同时堆在内存里。
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取图片数据失败'))
    reader.readAsDataURL(blob)
  })
}
