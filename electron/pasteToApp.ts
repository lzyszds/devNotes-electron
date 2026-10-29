/*
 * 把文本「粘贴」进当前聚焦的外部应用 —— 剪贴板面板选中即生效的关键一步。
 *
 * 两步分开：先用 Electron 把内容写进系统剪贴板（保底，用户手动 ⌘V 也能拿到），
 * 再模拟粘贴快捷键，把内容送进当时聚焦的输入框。我们不关心那个框是谁的、
 * 在哪 —— 那是操作系统的活。前提是面板窗口**不抢焦点**（见 openClipboardWindow），
 * 否则文字会送进面板自己。
 *
 * 模拟输入在 macOS 上必须获得「辅助功能」授权，这是系统级的安全边界，
 * 程序绕不过去，只能引导用户去勾选。
 */

import { app, clipboard, ClipboardItem, dialog, systemPreferences, shell } from 'electron'
import { pathToFileURL } from 'url'
import path from 'path'

/**
 * 原生模块按需加载。
 *
 * 它带平台相关的预编译二进制，装不上或平台不支持时不该让整个应用起不来 ——
 * 拿不到就降级成「只写剪贴板，用户自己按 ⌘V」，其余功能照常。
 */
type PasteFn = (arrowKeyToClickBeforePaste?: string) => void

interface NativeModule {
  paste: PasteFn
}

let nativeModule: NativeModule | null = null
let loadAttempted = false
/** 加载失败的具体原因。「只能复制不能自动粘贴」要能看出是模块没进来还是别的问题 */
let loadFailure: string | null = null

function loadNativeModule(): NativeModule | null {
  if (loadAttempted) return nativeModule
  loadAttempted = true
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null
  try {
    // 运行时才 require：打包环境下模块可能不存在，静态 import 会让主进程直接崩
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeModule = require('@xitanggg/node-insert-text') as NativeModule
  } catch (error) {
    nativeModule = null
    loadFailure = error instanceof Error ? error.message : String(error)
  }
  return nativeModule
}

/** 原生模块加载失败的原因；加载成功返回 null */
export function pasteModuleLoadError(): string | null {
  loadNativeModule()
  return nativeModule ? null : (loadFailure ?? '模块未安装')
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
 * 确保有「辅助功能」权限，没有就申请 / 引导。
 *
 * 打包重新签名后，这类系统权限会随签名变化一起失效（dev 模式用的
 * Electron 默认签名是另一份记录），用户没授权时粘贴会静默失败 ——
 * 必须显式处理。返回是否已授权，只有 true 才继续模拟粘贴。
 */
async function ensurePastePermission(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  if (isPasteTrusted()) return true

  // 系统提示只负责引导，返回的是当前状态；设置页里的授权完成后需要重试
  if (requestPastePermission()) return true

  // 之前拒绝过，系统不再弹窗，只能引导去设置手动勾选
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: '需要「辅助功能」权限才能自动粘贴',
    detail:
      '打包安装后需要重新授权：在系统设置 → 隐私与安全性 → 辅助功能里勾选 devNotes，然后重试。',
    buttons: ['打开设置', '取消'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) await openAccessibilitySettings()
  return false
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
  lastPasteError = null
  await clipboard.writeText(text)

  const paste = loadNativeModule()?.paste
  if (!paste) return { ok: false, reason: 'no-module' }

  if (!(await ensurePastePermission())) {
    return { ok: false, reason: 'no-permission' }
  }

  try {
    /*
     * 焦点处理：面板是 non-activating 的，hide 之后 key window 会自动还给
     * 唤出面板前的应用（见 main.ts 粘贴前 hideClipboardWindow + 短等待），
     * 这里不再起 open 子进程激活目标、也不再等 200ms —— 那是「面板抢焦点」
     * 旧方案的遗留，去掉后粘贴几乎即时。
     */
    /*
     * 前面已经用 Electron 写好剪贴板，只需模拟一次粘贴快捷键。
     * 不再调用 insertText 的剪贴板备份/清空/还原流程，也不用 Unicode 模拟输入：
     * 后者在部分应用、长文本或修饰键仍按下时有限制，系统粘贴兼容性更稳妥。
     */
    paste()
    return { ok: true }
  } catch (error) {
    lastPasteError = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'failed' }
  }
}

/** 最近一次自动粘贴失败的原因，用于日志与排查 */
let lastPasteError: string | null = null

export function lastPasteFailure(): string | null {
  return lastPasteError
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
 * 图片和文本一样会留在剪贴板里 —— 这符合预期：用户
 * 刚粘贴了这张图，剪贴板就该是它。
 */
export async function pasteImageToFocusedApp(imageDataUrl: string): Promise<{
  ok: boolean
  reason?: 'no-module' | 'no-permission' | 'failed'
}> {
  lastPasteError = null
  const written = await copyImageToClipboard(imageDataUrl)
  if (!written) return { ok: false, reason: 'failed' }

  const paste = loadNativeModule()?.paste
  if (!paste) return { ok: false, reason: 'no-module' }
  if (!(await ensurePastePermission())) {
    return { ok: false, reason: 'no-permission' }
  }

  try {
    paste()
    return { ok: true }
  } catch (error) {
    lastPasteError = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'failed' }
  }
}

/**
 * 把文件粘贴进当前聚焦的外部应用。
 *
 * 文件剪贴板在 macOS 上走 bookmark 类型：把绝对路径转回 file:// URL 写进
 * 剪贴板，再模拟 ⌘V。焦点处理与文本/图片一致，由调用方先收起面板。
 * 文件只是路径引用，若已移动/删除，粘贴目标会收不到。
 */
export async function pasteFileToFocusedApp(filePath: string): Promise<{
  ok: boolean
  reason?: 'no-module' | 'no-permission' | 'failed'
}> {
  lastPasteError = null
  if (!filePath) return { ok: false, reason: 'failed' }
  const fileUrl = pathToFileURL(filePath).toString()
  const fileName = path.basename(filePath)
  await clipboard.write([
    new ClipboardItem({
      'electron application/bookmark': { title: fileName, url: fileUrl },
    }),
  ])

  const paste = loadNativeModule()?.paste
  if (!paste) return { ok: false, reason: 'no-module' }
  if (!(await ensurePastePermission())) {
    return { ok: false, reason: 'no-permission' }
  }

  try {
    paste()
    return { ok: true }
  } catch (error) {
    lastPasteError = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'failed' }
  }
}
