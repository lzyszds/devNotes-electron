/*
 * 图片文字识别（OCR）。
 *
 * 用 tesseract.js，资源全部走本地静态目录：
 *  - worker 与 core wasm 从 public/tesseract/ 加载（构建后跟 dist/ 一起走），
 *    不依赖 node_modules、也不走 CDN —— Electron 下从 file:// 拉 CDN 容易被
 *    CSP 拦，而且每次启动都要重新下。
 *  - 语言包体积大（中文约 20MB），不预置，首次用到时从 tessdata CDN 下载，
 *    由 tesseract 自己缓存到 IndexedDB，之后离线可用。
 *
 * 只保留 lstm 版 core：tesseract 4 之后 LSTM 是唯一在维护的识别引擎，
 * 老的 legacy 引擎识别率明显更差。
 */

import { createWorker, type Worker } from 'tesseract.js'

/** 资源根路径。dev 下由 Vite 从 public/ 提供，打包后是相对 dist 的路径 */
const ASSET_BASE = 'tesseract'

/** 语言包 CDN。tesseract 默认也是这里，显式写出来是为了留下改自建源的余地 */
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0'

export type OcrLanguage = 'chi_sim+eng' | 'eng' | 'chi_sim'

export const OCR_LANGUAGES: { value: OcrLanguage; label: string }[] = [
  { value: 'chi_sim+eng', label: '中英混合' },
  { value: 'eng', label: '仅英文' },
  { value: 'chi_sim', label: '仅中文' },
]

export interface OcrProgress {
  /** 0 ~ 1 */
  progress: number
  /** 给人看的状态描述 */
  status: string
}

let workerPromise: Promise<Worker> | null = null
/** 当前 worker 用的语言，切语言时要重建 */
let workerLang = ''
/** 正在跑的识别任务，用于取消 */
let activeWorker: Worker | null = null

/**
 * 复用同一个 worker。
 *
 * 建 worker 要加载 3.7MB 的 core 并初始化 wasm，每次识别都重建会慢好几秒。
 * 语言不变就一直复用；换语言则重建（tesseract 支持运行时 reinitialize，
 * 但重建更省心，换语言本来就是低频操作）。
 */
async function getWorker(lang: string, onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  if (workerPromise && workerLang === lang) return workerPromise

  // 语言变了：先把旧的收掉，避免 wasm 实例堆积
  if (workerPromise) {
    const old = await workerPromise.catch(() => null)
    await old?.terminate().catch(() => {})
    workerPromise = null
  }

  workerLang = lang
  workerPromise = createWorker(lang, undefined, {
    workerPath: `${ASSET_BASE}/worker.min.js`,
    corePath: `${ASSET_BASE}`,
    langPath: LANG_PATH,
    logger: (message) => {
      // tesseract 的 logger 回调形态不固定，字段缺失时给个兜底
      const status = typeof message?.status === 'string' ? message.status : ''
      const progress = typeof message?.progress === 'number' ? message.progress : 0
      if (status) onProgress?.({ status, progress })
    },
  })

  return workerPromise
}

/** 把 tesseract 的英文状态串换成人话，进度条上直接显示原文太生硬 */
function describeStatus(status: string): string {
  const map: Record<string, string> = {
    'loading tesseract core': '加载识别引擎',
    'initializing tesseract': '初始化引擎',
    'loading language traineddata': '下载语言包（首次较慢）',
    'initializing api': '准备识别',
    'recognizing text': '识别文字',
  }
  return map[status] ?? status
}

/**
 * 识别一张图片里的文字。
 *
 * image 可以是 dataURL、object URL 或 Blob URL —— tesseract 三种都收。
 * 传入的语言会决定是否复用现有 worker。
 */
export async function recognizeText(
  image: string,
  options: {
    lang?: OcrLanguage
    onProgress?: (progress: OcrProgress) => void
  } = {},
): Promise<string> {
  const lang = options.lang ?? 'chi_sim+eng'
  const worker = await getWorker(lang, options.onProgress)
  activeWorker = worker

  try {
    const { data } = await worker.recognize(image, {}, { blocks: false })
    // tesseract 会在行尾补一堆空白，清掉免得填进输入框后还要手动删
    return data.text.replace(/[ \t]+$/gm, '').trim()
  } finally {
    activeWorker = null
  }
}

/** 取消正在进行的识别（切换图片、关闭面板时调用） */
export async function cancelRecognition(): Promise<void> {
  const worker = activeWorker
  if (!worker) return
  activeWorker = null
  // terminate 会把 worker 整个销毁，所以下次识别要重建
  await worker.terminate().catch(() => {})
  workerPromise = null
  workerLang = ''
}

/** 供进度条显示用的中文状态 */
export { describeStatus }
