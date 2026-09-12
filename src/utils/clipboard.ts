/**
 * 统一的剪贴板读写封装。
 * 优先走主进程 Electron clipboard(打包后 file:// 场景下最可靠),
 * 其次 navigator.clipboard,最后退回临时 textarea + execCommand。
 */

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  try {
    if (window.electronAPI?.clipboardWrite) {
      await window.electronAPI.clipboardWrite(text)
      return true
    }
  } catch {
    // 继续尝试渲染层方案
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 继续尝试兜底方案
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

export async function readText(): Promise<string> {
  try {
    if (window.electronAPI?.clipboardRead) {
      const text = await window.electronAPI.clipboardRead()
      return typeof text === 'string' ? text : ''
    }
  } catch {
    // 继续尝试渲染层方案
  }

  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}
