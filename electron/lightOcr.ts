import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/*
 * light-ocr（@arcships/light-ocr，PP-OCRv6 small）主引擎桥接。
 *
 * 不在 Electron 主进程里 require 这个 napi 模块 —— det+rec 推理的内存峰值
 * 大（一两百 MB），挂常驻不值得。子进程方式：用 process.execPath 加
 * ELECTRON_RUN_AS_NODE=1 启动包自带的 light-ocr CLI，喂一张落地的 PNG，
 * 读 stdout 的 JSON（pages[].lines[].text），读完进程退出，内存归零。
 *
 * 打包注意：这组 node_modules 包必须 asarUnpack —— 子进程里的 plain Node
 * 读不了 asar（native .node 也一样）， Hence package.json 的 asarUnpack 配置。
 * asar 内的 require.resolve 会指向 app.asar/...，统一替换成
 * app.asar.unpacked 后再 existsSync。
 */

export type LightOcrOutcome =
  | { status: 'ok'; text: string }
  | { status: 'unsupported' }
  | { status: 'failed'; reason: string }

const CLI_RELATIVE = path.join('@arcships', 'light-ocr', 'src', 'cli.cjs')

function cliFile(): string | null {
  // 打包后：resourcesPath/app.asar.unpacked/node_modules/@arcships/light-ocr/src/cli.cjs
  const packaged = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    CLI_RELATIVE,
  )
  if (existsSync(packaged)) return packaged
  // 开发态：dist-electron 的上一级就是仓库根
  const dev = path.join(__dirname, '..', 'node_modules', CLI_RELATIVE)
  if (existsSync(dev)) return dev
  return null
}

function extractPng(dataUrl: string): Buffer | null {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl)
  if (!match) return null
  try {
    return Buffer.from(match[1], 'base64')
  } catch {
    return null
  }
}

const SPAWN_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** 只取 JSON 里关心的字段：所有 page 的行文本按 ocr-order 拼接 */
function linesToJsonText(raw: string): string {
  const parsed = JSON.parse(raw) as {
    pages?: Array<{ lines?: Array<{ text?: unknown }> }>
  }
  const pages = Array.isArray(parsed.pages) ? parsed.pages : []
  const lines = pages.flatMap((page) =>
    Array.isArray(page.lines) ? page.lines : [],
  )
  return lines
    .map((line) => (typeof line.text === 'string' ? line.text : ''))
    .join('\n')
}

export async function lightOcrRecognize(dataUrl: string): Promise<LightOcrOutcome> {
  const cli = cliFile()
  if (!cli) return { status: 'unsupported' }

  const png = extractPng(dataUrl)
  if (!png) return { status: 'failed', reason: '不是 PNG dataURL' }

  const directory = await mkdtemp(path.join(tmpdir(), 'devnotes-light-ocr-'))
  try {
    const imageFile = path.join(directory, 'input.png')
    await writeFile(imageFile, png)

    const chunks: Buffer[] = []
    const errors: string[] = []
    let totalOut = 0

    await new Promise<void>((resolve) => {
      // ELECTRON_RUN_AS_NODE：用 Electron 自带的 node 跑 CLI（打包环境没有独立 node.exe）
      const child = spawn(process.execPath, [cli, 'recognize', imageFile], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
      })
      const timer = setTimeout(() => {
        errors.push('识别超时（60s）')
        child.kill()
      }, SPAWN_TIMEOUT_MS)

      child.stdout.on('data', (chunk: Buffer) => {
        totalOut += chunk.length
        if (totalOut <= MAX_OUTPUT_BYTES) chunks.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => errors.push(chunk.toString('utf8')))
      child.on('error', (error) => {
        clearTimeout(timer)
        errors.push(String(error))
        resolve()
      })
      child.on('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    const raw = Buffer.concat(chunks).toString('utf8')
    const failureText = errors.join('').trim() || 'light-ocr 异常退出且没有输出'

    try {
      return { status: 'ok', text: linesToJsonText(raw) }
    } catch {
      return { status: 'failed', reason: failureText }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
