import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/*
 * 文件哈希：在主进程里流式读取，一次读取同时算出所有选中的算法，
 * 大文件不会整个读进内存，也不会卡住渲染进程。
 */

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'] as const
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number]

export interface HashResult {
  path: string
  name: string
  size: number
  digests: Partial<Record<HashAlgorithm, string>>
  error?: string
}

export interface HashProgress {
  path: string
  readBytes: number
  totalBytes: number
}

function hashOne(
  filePath: string,
  algorithms: HashAlgorithm[],
  onProgress: (readBytes: number, totalBytes: number) => void,
): Promise<HashResult> {
  const name = path.basename(filePath)
  return fs.promises
    .stat(filePath)
    .then(
      (stat) =>
        new Promise<HashResult>((resolve) => {
          if (!stat.isFile()) {
            resolve({ path: filePath, name, size: 0, digests: {}, error: '不是文件' })
            return
          }
          const hashes = algorithms.map((algo) => ({ algo, hash: crypto.createHash(algo) }))
          const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
          let readBytes = 0
          stream.on('data', (data: string | Buffer) => {
            const chunk = typeof data === 'string' ? Buffer.from(data) : data
            for (const { hash } of hashes) hash.update(chunk)
            readBytes += chunk.length
            onProgress(readBytes, stat.size)
          })
          stream.on('error', (err) => resolve({ path: filePath, name, size: stat.size, digests: {}, error: err.message }))
          stream.on('end', () => {
            const digests: Partial<Record<HashAlgorithm, string>> = {}
            for (const { algo, hash } of hashes) digests[algo] = hash.digest('hex')
            resolve({ path: filePath, name, size: stat.size, digests })
          })
        }),
    )
    .catch((err: Error) => ({ path: filePath, name, size: 0, digests: {}, error: err.message }))
}

/** 逐个计算，避免同时读多个大文件撑爆磁盘带宽；进度通过回调推给调用方 */
export async function hashFiles(
  paths: string[],
  algorithms: HashAlgorithm[],
  onProgress: (progress: HashProgress) => void,
): Promise<HashResult[]> {
  const results: HashResult[] = []
  for (const filePath of paths) {
    results.push(await hashOne(filePath, algorithms, (readBytes, totalBytes) => onProgress({ path: filePath, readBytes, totalBytes })))
  }
  return results
}

/** 按期望哈希的长度推断算法：md5 32、sha1 40、sha256 64、sha512 128 个十六进制字符 */
export function guessAlgorithm(hex: string): HashAlgorithm | null {
  const clean = hex.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(clean)) return null
  switch (clean.length) {
    case 32:
      return 'md5'
    case 40:
      return 'sha1'
    case 64:
      return 'sha256'
    case 128:
      return 'sha512'
    default:
      return null
  }
}
