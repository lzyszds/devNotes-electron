import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test, { after } from 'node:test'
import ts from 'typescript'

// 临时 CommonJS 产物保持前端无扩展名引用不变，不给应用构建增加测试依赖。
const directory = await mkdtemp(path.join(tmpdir(), 'devnotes-translate-abort-'))
after(() => rm(directory, { recursive: true, force: true }))
for (const name of [
  'jsonI18nTranslate', 'translateFetch', 'translateProviders', 'concurrencyPool',
  'termProtection', 'translateConfig', 'translateStream',
]) {
  const source = await readFile(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  await writeFile(path.join(directory, `${name}.js`), outputText)
}
const require = createRequire(import.meta.url)
const { translateTextBatch, checkGtxReachable, resetGtxReachableCache, translateMultiLang } = require(path.join(directory, 'jsonI18nTranslate.js'))
const { translateFetch, resetGtxCache } = require(path.join(directory, 'translateFetch.js'))
const { translateWithOpenAI, translateWithLibreTranslate } = require(path.join(directory, 'translateProviders.js'))
const { runPool } = require(path.join(directory, 'concurrencyPool.js'))
const batch = { texts: ['hello', 'world', 'again'], sourceLang: 'en', targetLang: 'zh', textConcurrency: 1 }
const openai = { baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model' }
const libretranslate = { baseUrl: 'https://example.com', apiKey: '' }
const gtxResponse = () => new Response(JSON.stringify({ sentences: [{ trans: '你好' }] }))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
function resetCaches() {
  resetGtxCache()
  resetGtxReachableCache()
}
function electron(t, translateFetch) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: { translateFetch } } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  })
}
function pendingFetch(t) {
  const calls = []
  t.mock.method(globalThis, 'fetch', (url, init) => {
    const pending = deferred()
    calls.push({ url, ...init, ...pending })
    init.signal.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true })
    return pending.promise
  })
  return calls
}
function trackListeners(t, signal) {
  const listeners = new Set()
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  t.mock.method(signal, 'addEventListener', (name, listener, options) => {
    if (name === 'abort') listeners.add(listener)
    return add(name, listener, options)
  })
  t.mock.method(signal, 'removeEventListener', (name, listener, options) => {
    if (name === 'abort') listeners.delete(listener)
    return remove(name, listener, options)
  })
  return listeners
}

test('预先取消：所有 batch 路径与 provider 不发送 fetch 或 IPC', async (t) => {
  const controller = new AbortController()
  controller.abort()
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('不应请求'))
  electron(t, () => assert.fail('不应 IPC'))
  for (const api of ['gtx', 'mymemory', 'openai', 'libretranslate']) {
    const result = await translateTextBatch({ ...batch, api, signal: controller.signal })
    assert.equal(result.ok, false)
    assert.equal(result.error, '已取消')
    assert.deepEqual(result.results, batch.texts)
  }
  assert.equal((await translateWithOpenAI('hello', 'en', 'zh', openai, controller.signal)).error, '已取消')
  assert.equal((await translateWithLibreTranslate('hello', 'en', 'zh', libretranslate, controller.signal)).error, '已取消')
  assert.equal((await translateFetch('https://example.com', { signal: controller.signal })).error, '已取消')
  assert.equal(fetch.mock.callCount(), 0)
})

test('浏览器 translateFetch 将外部取消传给在途请求并清理监听', async (t) => {
  const controller = new AbortController()
  const listeners = trackListeners(t, controller.signal)
  const calls = pendingFetch(t)
  const result = translateFetch('https://example.com', { signal: controller.signal })
  assert.equal(calls.length, 1)
  controller.abort()
  assert.equal((await result).error, '已取消')
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(listeners.size, 0)
})

test('响应头之后读取正文时仍能取消，且超时覆盖正文', { timeout: 2000 }, async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    const body = deferred()
    calls.push({ signal, body })
    signal.addEventListener('abort', () => body.reject(new DOMException('Aborted', 'AbortError')), { once: true })
    return { ok: true, status: 200, text: () => body.promise }
  })
  const controller = new AbortController()
  const pending = translateFetch('https://example.com', { signal: controller.signal })
  await tick()
  controller.abort()
  assert.equal((await pending).error, '已取消')
  const timed = await translateFetch('https://example.com', { timeout: 10 })
  assert.equal(timed.ok, false)
  assert.match(timed.error, /Aborted/)
  assert.equal(calls[1].signal.aborted, true)
})

test('成功和网络失败都清理超时 timer / 外部监听，不遗留延迟 abort', async (t) => {
  const timers = new Set()
  const nativeSet = globalThis.setTimeout
  const nativeClear = globalThis.clearTimeout
  t.mock.method(globalThis, 'setTimeout', (...args) => {
    const timer = nativeSet(...args)
    timers.add(timer)
    return timer
  })
  t.mock.method(globalThis, 'clearTimeout', (timer) => {
    timers.delete(timer)
    return nativeClear(timer)
  })
  for (const failure of [false, true]) {
    const controller = new AbortController()
    const listeners = trackListeners(t, controller.signal)
    let requestSignal
    t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
      requestSignal = signal
      if (failure) throw new Error('offline')
      return new Response('ok')
    })
    assert.equal((await translateFetch('https://example.com', { signal: controller.signal })).ok, !failure)
    assert.equal(listeners.size, 0)
    assert.equal(timers.size, 0)
    controller.abort()
    assert.equal(requestSignal.aborted, false)
  }
})

test('GTX 探测取消不触发 fallback、不污染两层缓存，新请求还能成功', async (t) => {
  resetCaches()
  const calls = pendingFetch(t)
  const controller = new AbortController()
  const pending = translateTextBatch({ ...batch, api: 'gtx', signal: controller.signal })
  assert.equal(calls.length, 1)
  controller.abort()
  assert.equal((await pending).error, '已取消')
  assert.equal(calls.length, 1)
  const fetch = t.mock.method(globalThis, 'fetch', async () => gtxResponse())
  const result = await translateTextBatch({ ...batch, api: 'gtx' })
  assert.equal(result.ok, true)
  assert.equal(fetch.mock.callCount(), 4)
  assert.deepEqual(result.results, ['你好', '你好', '你好'])
})

test('GTX 在途取消停止 dj/域名重试、MyMemory 回退及后续 pool 派发', async (t) => {
  resetCaches()
  t.mock.method(globalThis, 'fetch', async () => gtxResponse())
  assert.equal(await checkGtxReachable(), true)
  const calls = pendingFetch(t)
  const controller = new AbortController()
  const progress = []
  const result = translateTextBatch({ ...batch, api: 'gtx', signal: controller.signal, onProgress: (...args) => progress.push(args) })
  await tick()
  assert.equal(calls.length, 1)
  controller.abort()
  assert.equal((await result).error, '已取消')
  assert.equal(calls.length, 1)
  assert.deepEqual(progress, [])
})

test('MyMemory 在途取消实际 abort、停止后续任务', async (t) => {
  const calls = pendingFetch(t)
  const controller = new AbortController()
  const result = translateTextBatch({ ...batch, api: 'mymemory', signal: controller.signal })
  assert.equal(calls[0].signal, controller.signal)
  controller.abort()
  assert.equal((await result).error, '已取消')
  assert.equal(calls.length, 1)
})

for (const provider of ['openai', 'libretranslate']) {
  test(`${provider} batch 在途取消实际 abort、停止后续任务且不回退`, async (t) => {
    const calls = pendingFetch(t)
    const controller = new AbortController()
    const result = translateTextBatch({
      ...batch, api: provider, providerConfig: { provider, openai, libretranslate }, signal: controller.signal,
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'POST')
    controller.abort()
    assert.equal((await result).error, '已取消')
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(calls.length, 1)
  })
}

test('Electron IPC 取消立即结束等待，不传不可克隆的 signal、迟到拒绝被消费', { timeout: 2000 }, async (t) => {
  const request = deferred()
  const calls = []
  electron(t, (options) => { calls.push(options); return request.promise })
  const controller = new AbortController()
  const listeners = trackListeners(t, controller.signal)
  const result = translateFetch('https://example.com', { signal: controller.signal })
  controller.abort()
  assert.equal((await result).error, '已取消')
  assert.equal('signal' in calls[0], false)
  assert.equal(listeners.size, 0)
  request.reject(new Error('迟到的主进程错误'))
  await tick()
})

test('Electron GTX 取消停止重试和 fallback，即使原 IPC 永不完成', { timeout: 2000 }, async (t) => {
  resetCaches()
  let calls = 0
  electron(t, () => {
    calls++
    return calls === 1 ? Promise.resolve({ ok: true, status: 200, text: '{"sentences":[{"trans":"你好"}]}' }) : new Promise(() => {})
  })
  await checkGtxReachable()
  const controller = new AbortController()
  const pending = translateTextBatch({ ...batch, api: 'gtx', signal: controller.signal })
  await tick()
  controller.abort()
  assert.equal((await pending).error, '已取消')
  assert.equal(calls, 2)
})

test('pool 暂停不取消在途任务，结果及进度保留，取消不再派发新任务', async () => {
  const current = deferred()
  const starts = []
  const progress = []
  let stopped = false
  const controller = new AbortController()
  const result = runPool([1, 2, 3], async (item) => { starts.push(item); return current.promise }, 1,
    (...args) => progress.push(args), () => stopped, controller.signal)
  stopped = true
  assert.equal(controller.signal.aborted, false)
  current.resolve('完成')
  const values = await result
  assert.equal(values[0], '完成')
  assert.deepEqual(starts, [1])
  assert.deepEqual(progress, [[1, 3]])
  const cancelled = new AbortController()
  cancelled.abort()
  await runPool([1, 2], async () => assert.fail('不应派发'), 2, undefined, undefined, cancelled.signal)
})

test('pool 并发取消后所有 worker 均不再取新任务', async () => {
  const controller = new AbortController()
  const current = deferred()
  const starts = []
  const progress = []
  const result = runPool([1, 2, 3, 4], async (item) => { starts.push(item); return current.promise }, 2,
    (...args) => progress.push(args), undefined, controller.signal)
  controller.abort()
  current.resolve('迟到')
  await result
  assert.deepEqual(starts, [1, 2])
  assert.deepEqual(progress, [])
})

test('不传 signal 时 GTX 原有重试与 MyMemory 回退仍正常', async (t) => {
  resetCaches()
  const urls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    if (urls.length === 1) return gtxResponse()
    if (!url.includes('mymemory')) return new Response('bad', { status: 503 })
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '你好' } }))
  })
  const result = await translateTextBatch({ ...batch, texts: ['hello'], api: 'gtx' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.results, ['你好'])
  assert.match(result.apiUsed, /MyMemory/)
  assert.equal(urls.length, 6)
})

test('不传 signal 时 provider 与术语保护保持兼容', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body)
    const text = body.q ?? body.messages[1].content
    return new Response(JSON.stringify(body.q
      ? { translatedText: text.replace('hello', '你好') }
      : { choices: [{ message: { content: text.replace('hello', '你好') } }] }))
  })
  for (const provider of ['openai', 'libretranslate']) {
    const result = await translateTextBatch({
      ...batch, texts: ['hello devNotes'], protectedTerms: ['devNotes'], api: provider,
      providerConfig: { provider, openai, libretranslate },
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.results, ['你好 devNotes'])
  }
})

test('多语言入口转交 signal，取消不派发剩余语言', async (t) => {
  const calls = pendingFetch(t)
  const controller = new AbortController()
  const started = []
  const result = translateMultiLang({
    parsed: { greeting: 'hello' }, stringsToTranslate: [{ path: 'greeting', key: 'greeting', value: 'hello' }],
    sourceLang: 'en', targetLangs: ['zh', 'ja', 'fr'], api: 'mymemory', langConcurrency: 1,
    signal: controller.signal, onLangStart: (lang) => started.push(lang),
  })
  controller.abort()
  await result
  assert.deepEqual(started, ['zh'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].signal.aborted, true)
})
