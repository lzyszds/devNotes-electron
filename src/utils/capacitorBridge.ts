/**
 * Android(Capacitor)环境下补齐 window.electronAPI。
 *
 * 渲染层的原生能力全部走 `window.electronAPI?.xxx` 可选链，桌面端由 preload 注入。
 * 移动端没有 preload，这里用 Capacitor 插件实现同名 API，
 * 让既有调用路径原样生效，而不是在每个调用点再加一层平台分支。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Clipboard } from '@capacitor/clipboard'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'

// 笔记文件落在应用沙箱的 Documents 目录下
const NOTES_DIR = 'devNotes'

/** electron-store 存的是任意 JSON，而 Preferences 只接受字符串，这里做编解码 */
async function storeGet(key: string) {
  const { value } = await Preferences.get({ key })
  if (value == null) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

async function storeSet(key: string, value: unknown) {
  await Preferences.set({ key, value: JSON.stringify(value ?? null) })
}

async function storeDelete(key: string) {
  await Preferences.remove({ key })
}

/**
 * 走 CapacitorHttp 原生网络栈，绕开 WebView 的 CORS 限制。
 * 桌面端这一步是主进程代理做的，移动端没有主进程。
 */
async function translateFetch(options: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
}) {
  try {
    let data: unknown
    if (options.body) {
      // CapacitorHttp 收到对象才会按 JSON 序列化，直接给字符串会被二次编码
      try {
        data = JSON.parse(options.body)
      } catch {
        data = options.body
      }
    }

    const response = await CapacitorHttp.request({
      url: options.url,
      method: options.method ?? 'GET',
      headers: options.headers,
      data,
      connectTimeout: options.timeout,
      readTimeout: options.timeout,
    })

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text:
        typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Android WebView 支持 <input type="file">，会拉起系统文件选择器。
 * 用户取消时 onchange 不会触发，靠窗口重新获得焦点兜底 resolve(null)。
 */
function notesOpenFile() {
  return new Promise<{ path: string; name: string; content: string } | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,text/markdown,text/plain'

    const settle = (result: { path: string; name: string; content: string } | null) => {
      window.removeEventListener('focus', onWindowFocus)
      resolve(result)
    }

    const onWindowFocus = () => {
      // 选择器关闭后窗口才拿回焦点，延后一点让 onchange 先跑
      setTimeout(() => {
        if (!input.files?.length) settle(null)
      }, 500)
    }

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return settle(null)
      const reader = new FileReader()
      reader.onload = () =>
        settle({ path: file.name, name: file.name, content: String(reader.result ?? '') })
      reader.onerror = () => settle(null)
      reader.readAsText(file)
    }

    window.addEventListener('focus', onWindowFocus, { once: true })
    input.click()
  })
}

async function notesSaveFile(options: { content: string; defaultPath?: string }) {
  const name = options.defaultPath?.split('/').pop() || `未命名-${Date.now()}.md`

  await Filesystem.mkdir({
    path: NOTES_DIR,
    directory: Directory.Documents,
    recursive: true,
  }).catch(() => {
    // 目录已存在时 mkdir 会抛错，忽略
  })

  const result = await Filesystem.writeFile({
    path: `${NOTES_DIR}/${name}`,
    data: options.content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  })

  return { path: result.uri, name }
}

export function installCapacitorBridge() {
  if (!Capacitor.isNativePlatform() || window.electronAPI) return

  window.electronAPI = {
    // 桌面窗口控制，移动端无对应概念
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    closeWindow: async () => {},
    openTool: async () => {},
    showNotification: async () => {},
    getAppVersion: async () => (await App.getInfo()).version,

    storeGet,
    storeSet,
    storeDelete,

    clipboardWrite: async (text: string) => {
      await Clipboard.write({ string: text })
    },
    clipboardRead: async () => (await Clipboard.read()).value ?? '',

    translateFetch,

    // 代理是 Electron 主进程的能力，移动端直连，留空实现保证调用方不报错
    getProxyConfig: async () => ({ mode: 'system' as const }),
    setProxyConfig: async (config) => config,
    testProxy: async () => ({ ok: true, proxy: '', status: 200 }),

    notesOpenFile,
    notesSaveFile,

    openExternal: async (url: string) => {
      await Browser.open({ url })
    },

    // 文件关联是桌面端特性(双击 .md)，移动端不会触发
    onOpenFileRequest: () => () => {},
    notifyRendererReady: async () => {},
  }
}
