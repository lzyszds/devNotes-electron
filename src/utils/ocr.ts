/*
 * 图片文字识别（OCR）。
 *
 * 主引擎：light-ocr（@arcships/light-ocr），PP-OCRv6 的 C++ 内核以子进程
 * CLI 方式调用（见 electron/lightOcr.ts）—— 中文/混排小字准确率最高，
 * 单张 <1 秒，主窗口零常驻内存；完全离线，不联网。
 *
 * 兜底：tesseract.js，资源全部走本地静态目录：
 *  - worker 与 core wasm 从 public/tesseract/ 加载（构建后跟 dist/ 一起走），
 *    不依赖 node_modules、也不走 CDN —— Electron 下从 file:// 拉 CDN 容易被
 *    CSP 拦，而且每次启动都要重新下。
 *  - 语言包用 tessdata 的 int8 fast 版（4.0.0_fast）：chi_sim 只有 4.4MB，
 *    常规版 20MB，堆进内存是一两百 MB 的 wasm 常驻；fast 版砍一个数量级。
 *    首次从 CDN 下载，之后由 tesseract 缓存到 IndexedDB，离线可用。
 *
 * 只保留 lstm 版 core：tesseract 4 之后 LSTM 是唯一在维护的识别引擎，
 * 老的 legacy 引擎识别率明显更差。fast 是量化模型，精度上略逊常规版，
 * 识别预处理（放大 + 灰度化）能弥补大半（见 upscaleForOcr 的说明）。
 */

import { createWorker, type Worker } from 'tesseract.js'

/** 资源根路径。dev 下由 Vite 从 public/ 提供，打包后是相对 dist 的路径 */
const ASSET_BASE = 'tesseract'

/**
 * 语言包 CDN。fast = int8 量化模型（chi_sim 4.4MB / eng ~4MB），内存友好；
 * 常规版是 .../4.0.0，精度优先时可以切回去（代价是常驻内存涨回一两百 MB）。
 */
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast'

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

/*
 * 识别前的预处理：放大 + 灰度化。
 *
 * tesseract / 系统 OCR 对单字符高度约 30px 的图最准，截屏里 UI 小字通常
 * 只有 12~20px —— 不放大，模型就在逐字乱猜（实测「重启」认成「車启」、
 * 「426MB」认成「426M8」）。线性插值放大的轻微糊，对识别反而有利。
 *
 * 灰度化是另一半关键：Chromium 小字用 ClearType 亚像素渲染，字符边缘带
 * 红/绿彩边，OCR 引擎的分binarization 会被颜色干扰。转 299/587/114 亮度
 * 实测把这批误字全部消灭（同一张 14px 截图：原图 6 处错，灰度+放大后 0 处）。
 */
const UPSCALE_TARGET = 2000
const UPSCALE_MAX = 3

async function upscaleForOcr(image: string): Promise<string> {
  const el = new Image()
  el.src = image
  await new Promise<void>((resolve, reject) => {
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('图片解码失败'))
  })
  const longest = Math.max(el.naturalWidth, el.naturalHeight)
  if (!longest) return image
  const scale = Math.min(UPSCALE_TARGET / longest, UPSCALE_MAX)
  if (scale <= 1) return image

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(el.naturalWidth * scale)
  canvas.height = Math.round(el.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return image
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(el, 0, 0, canvas.width, canvas.height)

  // 灰度：ImageData 按 RGBA 排列，亮度公式 (299/587/114)/1000 一遍扫完
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = frame.data
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000
    pixels[i] = pixels[i + 1] = pixels[i + 2] = lum
  }
  ctx.putImageData(frame, 0, 0)

  return canvas.toDataURL('image/png')
}

/*
 * 识别后的清洗：删掉汉字之间的假空格。
 *
 * chi_sim+eng 混合模型的顽固毛病 —— 逐字认出的段落里每个汉字都被当成
 * 独立单词，词间全补上空格（「完 或 、 这 罪 尿」）。真实空格只出现在
 * 拉丁字母 / 数字词之间，两侧都是 CJK（含全角标点）的空格必是假的，
 * 删掉是安全的；「exe 也编译」这种中英边界的空格不受影响。
 *
 * 代价：截屏里确实用空格隔开的 CJK 元素（比如「保存 取消」两个按钮）
 * 会被连成一个词。相比每屏几十个假空格，这是更少见的误伤，接受。
 */
const CJK_CLASS = '\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef'

function stripCjkGaps(text: string): string {
  // lookbehind / lookahead 让连续的「汉 字 识 别」在一次遍历里全清掉
  let result = text.replace(new RegExp(`(?<=[${CJK_CLASS}]) +(?=[${CJK_CLASS}])`, 'g'), '')
  // OCR 也常用半角标点冒充全角（「了 , 新」）。中文排版不会有空格贴在
  // 标点旁，紧跟/前贴 CJK 的半角标点空格同样按假空格处理；
  // 纯英文语境（「Hello, world」）前一个字符不是 CJK，不受影响
  result = result.replace(new RegExp(`(?<=[${CJK_CLASS}]) +([,.;:!?])`, 'g'), '$1')
  result = result.replace(new RegExp(`(?<=[,.;:!?]) +(?=[${CJK_CLASS}])`, 'g'), '')
  return result
}

/** 识别结果的统一出口：删假空格、修英文孤竖线、去行尾空白 */
function postProcess(text: string): string {
  return fixLatinPipes(stripCjkGaps(text.replace(/[ \t]+$/gm, ''))).trim()
}

/**
 * 英文行首的孤立竖线 = 被认成大写 I（无衬线大写 I 与 | 字形完全相同，
 * 「| illustrated」）；识别引擎不靠上下文纠错，这里代替它修。
 * 规则收得很紧：只修「行首 | 后跟拉丁字母」，且整行只有这一个竖线 ——
 * 代码的管道符（通常成对或成行）、表格线保持原样。
 */
function fixLatinPipes(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if ((line.match(/\|/g)?.length ?? 0) !== 1) return line
      return line.replace(/^(\s*)\|(?=[ \t]*[a-zA-Z])/, '$1I')
    })
    .join('\n')
}

/**
 * 复用同一个 worker。
 *
 * 建 worker 要加载 3.7MB 的 core 并初始化 wasm，连续识别（连截几张图）时
 * 重建会慢好几秒，所以同一语言在连续识别之间复用。
 * 语言变了则重建（tesseract 支持运行时 reinitialize，但重建更省心）。
 *
 * 复用只在「这一轮识别」内成立：chi_sim+eng 的 traineddata + wasm 常驻
 * 就是一两百 MB，截图翻译是低频动作，认完字多半就切走了 —— 因此每次
 * 识别完成后都会预约一个闲时释放（见 recognizeText 的 finally），
 * 到点没人用就把 worker 整个销毁。语言包已由 tesseract 缓存到
 * IndexedDB，释放后重建只是重新加载 wasm（慢几秒），不再走 CDN 下载。
 */
const WORKER_IDLE_MS = 60_000
let dropWorkerTimer: number | null = null

async function dropWorker(): Promise<void> {
  cancelIdleDrop()
  workerLang = ''
  const worker = workerPromise
  workerPromise = null
  if (!worker) return
  const instance = await worker.catch(() => null)
  await instance?.terminate().catch(() => {})
}

function cancelIdleDrop(): void {
  if (dropWorkerTimer !== null) {
    window.clearTimeout(dropWorkerTimer)
    dropWorkerTimer = null
  }
}

function scheduleIdleDrop(): void {
  cancelIdleDrop()
  dropWorkerTimer = window.setTimeout(() => {
    dropWorkerTimer = null
    void dropWorker()
  }, WORKER_IDLE_MS)
}

async function getWorker(lang: string, onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  cancelIdleDrop()
  if (workerPromise && workerLang === lang) return workerPromise

  // 语言变了：先把旧的收掉，避免 wasm 实例堆积
  if (workerPromise) await dropWorker()

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

/*
 * light-ocr（PP-OCRv6 子进程）优先：中文/混排小字的准确率是本机引擎里
 * 最强的，C++ 推理 <1s；子进程跑 CLI，主窗口零常驻内存。
 * supported 三态：true = 依赖就位；false = 包缺失（打包 + node_modules 里
 * 没有这组包），本会话不再尝试；null = 没试过。failed 只单次回退。
 */
let lightSupported: boolean | null = null

async function lightOcrText(
  image: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string | null> {
  const call = window.electronAPI?.lightOcr
  if (!call || lightSupported === false) return null
  onProgress?.({ progress: 0.3, status: 'recognizing text' })
  try {
    const outcome = await call(image)
    if (outcome.status === 'ok') {
      lightSupported = true
      return postProcess(outcome.text)
    }
    if (outcome.status === 'unsupported') {
      lightSupported = false
      return null
    }
    console.warn('[ocr] light-ocr 识别失败，回退 tesseract：', outcome.reason)
    return null
  } catch (error) {
    console.warn('[ocr] light-ocr 调用失败，回退 tesseract：', error)
    return null
  }
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

  // 预处理（放大 + 灰度化）一次，两条路径共用；解码失败就按原图识别
  let scaled = image
  try {
    scaled = await upscaleForOcr(image)
  } catch {
    // ignore
  }

  const light = await lightOcrText(scaled, options.onProgress)
  if (light !== null) return light

  const worker = await getWorker(lang, options.onProgress)
  activeWorker = worker

  try {
    const { data } = await worker.recognize(scaled, {}, { blocks: false })
    return postProcess(data.text)
  } finally {
    activeWorker = null
    // 这一轮识别结束了：预约闲时释放，没人接着用就把模型从内存里撤掉
    scheduleIdleDrop()
  }
}

/** 取消正在进行的识别（切换图片、关闭面板时调用），顺手把 worker 也撤掉 */
export async function cancelRecognition(): Promise<void> {
  if (!activeWorker) {
    await dropWorker()
    return
  }
  activeWorker = null
  // terminate 会把 worker 整个销毁，所以下次识别要重建
  await dropWorker()
}

/** 供进度条显示用的中文状态 */
export { describeStatus }
