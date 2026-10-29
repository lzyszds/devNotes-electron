import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** 不经过 shell，也不写剪贴板：系统只负责框选，结果仍交给应用的 OCR。 */
function runSystemCapture(file: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/sbin/screencapture', ['-i', '-s', '-x', '-t', 'png', file], { signal }, (error, _stdout, stderr) => {
      if (!error) {
        resolve()
        return
      }
      // 系统框选按 Esc 退出时通常返回 1 且不生成文件，不应当弹「截图失败」。
      if (signal?.aborted || (error.code === 1 && !stderr.trim())) {
        resolve()
        return
      }
      reject(new Error(stderr.trim() || error.message))
    })
  })
}

/**
 * macOS 直接使用系统原生选区，不创建 Electron 全屏遮罩：
 * 避免激活应用、加载 React、销毁合成表面造成的阴影变化和黑帧。
 * 临时目录每次独立（mkdtemp 权限为 0700），成功、取消、失败都删除截图。
 */
export async function captureMacRegion(
  signal?: AbortSignal,
  runCapture = runSystemCapture,
): Promise<Buffer | null> {
  if (signal?.aborted) return null
  const directory = await mkdtemp(path.join(tmpdir(), 'devnotes-capture-'))
  const file = path.join(directory, 'selection.png')
  try {
    await runCapture(file, signal)
    if (signal?.aborted) return null
    try {
      const image = await readFile(file)
      if (image.length < 8 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error('系统未返回有效的 PNG 截图，请检查屏幕录制权限后重试')
      }
      return image
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
