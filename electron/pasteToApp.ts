/*
 * 把文本「粘贴」进当前聚焦的外部应用 —— 剪贴板面板选中即生效的关键一步。
 *
 * 原理：内容写进系统剪贴板 → 模拟一次 ⌘V。系统收到这个合成按键，会把它
 * 粘进当时聚焦的那个输入框。我们全程不关心那个框是谁的、在哪 ——
 * 那是操作系统的活。前提是面板窗口**不抢焦点**（见 openClipboardWindow），
 * 否则焦点在面板自己身上，⌘V 就粘到面板里了。
 *
 * 模拟按键在 macOS 上必须获得「辅助功能」授权，这是系统级的安全边界，
 * 程序绕不过去，只能引导用户去勾选。
 */

import { app, clipboard, ClipboardItem, systemPreferences, shell } from 'electron'
import { execFile, execFileSync } from 'child_process'

/**
 * 唤出面板时上下文：devNotes 是否在前台 + 前台应用是谁。
 *
 * 由 openClipboardWindow 在开窗前记录，粘贴时据此把焦点还回去。用模块级
 * 变量而不是参数：openClipboardWindow 和 pasteToFocusedApp 分属不同的 IPC
 * 调用链，中间隔了一层面板渲染进程，传参要绕 IPC 太啰嗦。
 *
 * previousFrontApp 存的是「唤出面板前前台应用」的 bundle id。之前只记
 * devNotes 是否前台、粘贴时靠 app.hide() 让 macOS 自己决定把前台还给谁，
 * 那个「还给谁」不可控 —— 切到微信、Finder、别的窗口都可能，粘错地方。
 * 现在显式记住目标应用，粘贴前用 open -b 精准激活它。
 */
let appWasForegroundOnOpen = true
let previousFrontApp: string | null = null

export function setPasteContext(options: {
  wasForeground: boolean
  frontAppBundleId: string | null
}): void {
  appWasForegroundOnOpen = options.wasForeground
  previousFrontApp = options.frontAppBundleId
}

/**
 * 同步读取当前前台应用的 bundle id。
 *
 * lsappinfo 是 macOS 自带命令，无需任何权限；只在开窗前那一瞬间调用，
 * 此时前台还是用户真正在用的应用（微信 / VS Code），面板还没抢焦点。
 * 拿不到就返回 null，调用方退回 app.hide() 兜底。
 */
export function getFrontmostAppSync(): string | null {
  if (process.platform !== 'darwin') return null
  try {
    /*
     * lsappinfo front 只回 ASN、不带属性，拿不到 bundle id；但 lsappinfo list
     * 会给每个应用列出 bundleID，且前台应用那条标着 "(in front)"。直接取
     * 那个标记之后最近的 bundleID 即可。不同 macOS 版本格式有差异
     * （bundleID="x" 或 bundleID = "x"），用宽松正则兼容。
     */
    const out = execFileSync('lsappinfo', ['list'], { encoding: 'utf8', timeout: 800 })
    const match = /\(in front\)[\s\S]*?bundleID\s*=\s*"([^"]+)"/.exec(out)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/** 激活指定应用。open -b 只激活已运行的实例，不会新开一个窗口 */
function activateApp(bundleId: string): Promise<void> {
  return new Promise((resolve) => {
    execFile('open', ['-b', bundleId], () => resolve())
  })
}

/**
 * 原生模块按需加载。
 *
 * 它带平台相关的预编译二进制，装不上或平台不支持时不该让整个应用起不来 ——
 * 拿不到就降级成「只写剪贴板，用户自己按 ⌘V」，其余功能照常。
 */
type InsertTextFn = (text: string, insertWithPaste?: boolean) => void
type PasteFn = (arrowKeyToClickBeforePaste?: string) => void

interface NativeModule {
  insertText: InsertTextFn
  paste: PasteFn
}

let nativeModule: NativeModule | null = null
let loadAttempted = false

function loadNativeModule(): NativeModule | null {
  if (loadAttempted) return nativeModule
  loadAttempted = true
  try {
    // 运行时才 require：打包环境下模块可能不存在，静态 import 会让主进程直接崩
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeModule = require('@xitanggg/node-insert-text') as NativeModule
  } catch {
    nativeModule = null
  }
  return nativeModule
}

/** 是否具备「自动粘贴」能力（模块装上了 且 平台是 macOS / Windows） */
export function isPasteAvailable(): boolean {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return false
  return loadNativeModule() !== null
}

/**
 * 是否已获辅助功能授权。
 *
 * 传 false 只查询、不弹窗 —— 用于界面初始化时判断该不该显示引导。
 * 非 macOS 平台没有这个概念，一律当作已授权。
 */
export function isPasteTrusted(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

/**
 * 主动申请授权：会弹出系统引导，把用户送到「辅助功能」设置页。
 *
 * 第一次调用会弹窗（且只在第一次），无论用户点同意还是拒绝都会返回当前状态。
 */
export function requestPastePermission(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(true)
}

/**
 * 打开系统设置的「辅助功能」面板。
 *
 * 用户拒绝过授权后，系统不会再弹窗，只能自己进设置里勾 —— 这时候
 * 界面上得给一个能直达的入口，否则用户根本找不到在哪开。
 */
export async function openAccessibilitySettings(): Promise<void> {
  if (process.platform !== 'darwin') return
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  )
}

/**
 * 执行粘贴。
 *
 * 返回值告诉调用方结果，界面据此决定是「贴好了」还是「已复制，请手动按 ⌘V」：
 *  - { ok: true }            自动粘贴成功
 *  - { ok: false, reason }   失败，已退化为只写剪贴板
 */
export async function pasteToFocusedApp(text: string): Promise<{
  ok: boolean
  reason?: 'no-module' | 'no-permission' | 'failed'
}> {
  // 先把内容写进剪贴板：无论能不能自动粘贴，这一步都必须做 ——
  // 它是唯一保底的路径，用户手动按 ⌘V 也能拿到。
  // Electron 44 起 writeText 也是异步的，await 一下别留下竞态。
  await clipboard.writeText(text)

  const insertText = loadNativeModule()?.insertText
  if (!insertText) return { ok: false, reason: 'no-module' }

  if (process.platform === 'darwin' && !isPasteTrusted()) {
    return { ok: false, reason: 'no-permission' }
  }

  try {
    /*
     * 外部应用场景：唤出面板时 devNotes 不在前台，但用户点面板的那一刻
     * macOS 已经把 devNotes 激活了，直接模拟 ⌘V 会粘到 devNotes 自己身上。
     *
     * 所以先把焦点还给「唤出面板前那个应用」：优先用 open -b 显式激活
     * 记住的目标应用，精准、不靠猜；没记到目标时退回 app.hide() 让系统
     * 自己归还焦点。等焦点转移完成再模拟 ⌘V。
     */
    if (process.platform === 'darwin' && !appWasForegroundOnOpen) {
      if (previousFrontApp) {
        await activateApp(previousFrontApp)
      } else {
        app.hide()
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    /*
     * insertWithPaste = true：走「存剪贴板 → 设值 → 模拟 ⌘V → 还原剪贴板」。
     *
     * 不用它默认的逐字符模拟输入（走 CGEventKeyboardSetUnicodeString）：
     * 那条路对中文、emoji 这类需要输入法参与的内容不可靠，而且在有按键
     * 被按住时会失败。粘贴这条走的是系统自己的输入通道，兼容性好得多。
     */
    insertText(text, true)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/**
 * 把图片 dataURL 写回系统剪贴板（只复制，不模拟粘贴）。
 *
 * 面板里图片条目的「复制」按钮走这里：用户只想把图拿回剪贴板、自己去别处
 * ⌘V，而不是当场粘进某个应用。
 */
export async function copyImageToClipboard(imageDataUrl: string): Promise<boolean> {
  const base64 = imageDataUrl.split(',')[1]
  if (!base64) return false

  // dataURL → PNG Buffer → Blob，走 Electron 44 的 ClipboardItem 写回剪贴板。
  // Buffer 是 Uint8Array（ArrayBufferView），直接给 Blob 即可，别断言成 ArrayBuffer。
  const binary = Buffer.from(base64, 'base64')
  const blob = new Blob([binary], { type: 'image/png' })
  await clipboard.write([new ClipboardItem({ 'image/png': blob })])
  return true
}

/**
 * 把图片粘贴进当前聚焦的外部应用。
 *
 * 与文本不同，node-insert-text 没有「写图片 + 模拟粘贴」的一体化函数，
 * 所以这里自己拆开：先把 dataURL 还原成 PNG 写进剪贴板，再调 paste() 模拟 ⌘V。
 *
 * 图片会留在剪贴板里（不像文本粘贴那样恢复原状）—— 这符合预期：用户
 * 刚粘贴了这张图，剪贴板就该是它。
 */
export async function pasteImageToFocusedApp(imageDataUrl: string): Promise<{
  ok: boolean
  reason?: 'no-module' | 'no-permission' | 'failed'
}> {
  const written = await copyImageToClipboard(imageDataUrl)
  if (!written) return { ok: false, reason: 'failed' }

  const paste = loadNativeModule()?.paste
  if (!paste) return { ok: false, reason: 'no-module' }
  if (process.platform === 'darwin' && !isPasteTrusted()) {
    return { ok: false, reason: 'no-permission' }
  }

  try {
    if (process.platform === 'darwin' && !appWasForegroundOnOpen) {
      if (previousFrontApp) {
        await activateApp(previousFrontApp)
      } else {
        app.hide()
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    paste()
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
