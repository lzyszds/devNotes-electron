import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test, { after } from 'node:test'
import ts from 'typescript'

// 沿用项目已有 TypeScript 依赖，转成 CommonJS 后无扩展名的本地引用也能解析。
// 产物放临时目录，避免为了 Node 测试改动前端源码的导入方式。
const directory = await mkdtemp(path.join(tmpdir(), 'devnotes-translate-stream-'))
after(() => rm(directory, { recursive: true, force: true }))
for (const name of ['translateStream', 'translateConfig']) {
  const source = await readFile(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  await writeFile(path.join(directory, `${name}.js`), outputText)
}
const { translateStream } = createRequire(import.meta.url)(path.join(directory, 'translateStream.js'))

const config = { baseUrl: 'https://example.com/v1', apiKey: ' secret ', model: ' model ' }
const deltaLine = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`

function mockStream(t, { start, abort } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const starts = []
  const aborts = []
  const chunks = new Set()
  const ends = new Set()
  let chunkListener
  let endListener
  const deltas = []
  const firstTokens = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        startTranslateStream(options) {
          starts.push(options)
          return start ? start(options) : Promise.resolve()
        },
        abortTranslateStream(requestId) {
          aborts.push(requestId)
          return abort ? abort(requestId) : Promise.resolve()
        },
        onTranslateStreamChunk(listener) {
          chunkListener = listener
          chunks.add(listener)
          return () => chunks.delete(listener)
        },
        onTranslateStreamEnd(listener) {
          endListener = listener
          ends.add(listener)
          return () => ends.delete(listener)
        },
      },
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  })
  const requestId = () => starts.at(-1).requestId
  return {
    starts, aborts, deltas, firstTokens,
    run(options = {}) {
      return translateStream({
        text: 'hello', sourceLang: 'auto', targetLang: '中文', config,
        onDelta: (delta, full) => deltas.push([delta, full]),
        onFirstToken: (elapsed) => firstTokens.push(elapsed),
        ...options,
      })
    },
    chunk(chunk, id = requestId()) {
      for (const listener of chunks) listener({ requestId: id, chunk })
    },
    end(error, id = requestId()) {
      for (const listener of ends) listener({ requestId: id, error })
    },
    // 故意绕过已清除的监听集合，模拟清理前就排队的 IPC 回调。
    lateChunk(chunk) { chunkListener({ requestId: requestId(), chunk }) },
    lateEnd(error) { endListener({ requestId: requestId(), error }) },
    assertClean() {
      assert.equal(chunks.size, 0)
      assert.equal(ends.size, 0)
    },
  }
}

test('成功：跨块拼行、忽略其他请求，每段 delta 都交付且首字只报一次', { timeout: 2000 }, async (t) => {
  const stream = mockStream(t)
  const result = stream.run()
  const line = deltaLine('你')
  stream.chunk(deltaLine('无关'), 'another-request')
  stream.end('无关错误', 'another-request')
  stream.chunk(`: keepalive\nevent: message\n${line.slice(0, 20)}`)
  assert.deepEqual(stream.deltas, [])
  stream.chunk(`${line.slice(20)}${deltaLine('好')}data: [DONE]\n`)
  assert.deepEqual(await result, { ok: true, text: '你好' })
  assert.deepEqual(stream.deltas, [['你', '你'], ['好', '你好']])
  assert.equal(stream.firstTokens.length, 1)
  assert.ok(stream.firstTokens[0] >= 0)
  assert.equal(stream.starts[0].url, 'https://example.com/v1/chat/completions')
  assert.equal(stream.starts[0].headers.Authorization, 'Bearer secret')
  assert.equal(JSON.parse(stream.starts[0].body).stream, true)
  stream.assertClean()
})

test('[DONE] 后忽略同一块剩余行及迟到 chunk/end，完成后取消也不再通知主进程', async (t) => {
  const controller = new AbortController()
  const stream = mockStream(t)
  const result = stream.run({ signal: controller.signal })
  stream.chunk(`${deltaLine('完成')}data: [DONE]\n${deltaLine('不能交付')}`)
  assert.deepEqual(await result, { ok: true, text: '完成' })
  stream.assertClean()
  stream.lateChunk(deltaLine('迟到'))
  stream.lateEnd('迟到错误')
  controller.abort()
  assert.deepEqual(stream.deltas, [['完成', '完成']])
  assert.deepEqual(stream.aborts, [])
})

test('end 处理最后一条没有换行的 delta', async (t) => {
  const stream = mockStream(t)
  const result = stream.run()
  stream.chunk(deltaLine('尾行').trimEnd())
  assert.deepEqual(stream.deltas, [])
  stream.end()
  assert.deepEqual(await result, { ok: true, text: '尾行' })
  assert.deepEqual(stream.deltas, [['尾行', '尾行']])
  stream.assertClean()
})

test('流内错误后不再交付当前块剩余 delta，并保留已收到的部分', async (t) => {
  const stream = mockStream(t)
  const result = stream.run()
  stream.chunk(`${deltaLine('部分')}data: {"error":{"message":"额度不足"}}\n${deltaLine('不应显示')}`)
  assert.deepEqual(await result, { ok: false, text: '部分', error: '额度不足' })
  stream.lateChunk(deltaLine('迟到'))
  stream.lateEnd()
  assert.deepEqual(stream.deltas, [['部分', '部分']])
  stream.assertClean()
})

test('end 中处理残留错误 / [DONE] 时不覆盖已经结束的结果', async (t) => {
  const stream = mockStream(t)
  const failed = stream.run()
  stream.chunk('data: {"error":{"message":"原始错误"}}')
  stream.end('不能覆盖原始错误')
  assert.deepEqual(await failed, { ok: false, text: '', error: '原始错误' })
  stream.assertClean()
  const completed = stream.run()
  stream.chunk(`${deltaLine('译文')}data: [DONE]`)
  stream.end('不能覆盖成功')
  assert.deepEqual(await completed, { ok: true, text: '译文' })
  stream.assertClean()
})

test('正常 end 的空结果与代理错误仍返回明确失败', async (t) => {
  const stream = mockStream(t)
  const empty = stream.run()
  stream.end()
  assert.deepEqual(await empty, { ok: false, text: '', error: '服务端没有返回任何内容' })
  const failed = stream.run()
  stream.chunk(deltaLine('部分'))
  stream.end('连接中断')
  assert.deepEqual(await failed, { ok: false, text: '部分', error: '连接中断' })
  stream.assertClean()
})

test('取消保留部分译文，清理监听，拒绝迟到 delta/end', async (t) => {
  const controller = new AbortController()
  const stream = mockStream(t)
  const result = stream.run({ signal: controller.signal })
  stream.chunk(deltaLine('部分'))
  controller.abort()
  assert.deepEqual(await result, { ok: false, text: '部分', error: '已取消' })
  assert.deepEqual(stream.aborts, [stream.starts[0].requestId])
  stream.assertClean()
  stream.lateChunk(deltaLine('迟到'))
  stream.lateEnd()
  controller.abort()
  assert.deepEqual(stream.deltas, [['部分', '部分']])
  assert.equal(stream.aborts.length, 1)
})

test('delta 回调内取消后不处理当前 chunk 剩余行', async (t) => {
  const controller = new AbortController()
  const stream = mockStream(t)
  const result = stream.run({
    signal: controller.signal,
    onDelta: (delta, full) => {
      stream.deltas.push([delta, full])
      controller.abort()
    },
  })
  stream.chunk(`${deltaLine('第一段')}${deltaLine('第二段')}data: [DONE]\n`)
  assert.deepEqual(await result, { ok: false, text: '第一段', error: '已取消' })
  assert.deepEqual(stream.deltas, [['第一段', '第一段']])
  stream.assertClean()
})

test('预取消直接返回，不启动请求也不注册 IPC 监听', async (t) => {
  const stream = mockStream(t)
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await stream.run({ signal: controller.signal }), { ok: false, text: '', error: '已取消' })
  assert.deepEqual(stream.starts, [])
  assert.deepEqual(stream.aborts, [])
  assert.deepEqual(stream.deltas, [])
  stream.assertClean()
})

test('启动 Promise 拒绝也会结束等待，清理监听且不接收迟到数据', { timeout: 2000 }, async (t) => {
  const stream = mockStream(t, { start: () => Promise.reject(new Error('IPC 启动失败')) })
  const result = stream.run()
  stream.chunk(deltaLine('部分'))
  assert.deepEqual(await result, { ok: false, text: '部分', error: 'IPC 启动失败' })
  stream.assertClean()
  stream.lateChunk(deltaLine('迟到'))
  stream.lateEnd()
  assert.deepEqual(stream.deltas, [['部分', '部分']])
})

test('同步启动异常同样返回失败而不是抛出', async (t) => {
  const stream = mockStream(t, { start: () => { throw new Error('同步启动失败') } })
  assert.deepEqual(await stream.run(), { ok: false, text: '', error: '同步启动失败' })
  stream.assertClean()
})

test('启动拒绝没有原因时给出中文兜底文案', async (t) => {
  const stream = mockStream(t, { start: () => Promise.reject() })
  assert.deepEqual(await stream.run(), { ok: false, text: '', error: '启动流式翻译失败' })
  stream.assertClean()
})

test('完成或取消后才到的启动拒绝被处理，不改变最终结果', async (t) => {
  let rejectStart
  const stream = mockStream(t, { start: () => new Promise((_, reject) => { rejectStart = reject }) })
  const completed = stream.run()
  stream.chunk(`${deltaLine('完成')}data: [DONE]\n`)
  rejectStart(new Error('迟到的启动拒绝'))
  assert.deepEqual(await completed, { ok: true, text: '完成' })
  const controller = new AbortController()
  const cancelled = stream.run({ signal: controller.signal })
  controller.abort()
  rejectStart(new Error('取消后的启动拒绝'))
  assert.deepEqual(await cancelled, { ok: false, text: '', error: '已取消' })
  stream.assertClean()
  // 留出一个事件循环，让 Node 检测任何没有被接住的拒绝。
  await new Promise((resolve) => setImmediate(resolve))
})

test('主进程取消失败仍在本地结束，也不泄漏拒绝', async (t) => {
  const stream = mockStream(t, { abort: () => Promise.reject(new Error('代理已断开')) })
  const controller = new AbortController()
  const result = stream.run({ signal: controller.signal })
  controller.abort()
  assert.deepEqual(await result, { ok: false, text: '', error: '已取消' })
  stream.assertClean()
  await new Promise((resolve) => setImmediate(resolve))
})
