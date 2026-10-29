// 覆盖原生助手的编排逻辑：成功 / 取消 / 失败 / 中止 / 启动失败。
// 助手进程用假实现注入，不需要真的 Windows。
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  captureWindowsRegion,
  releaseWindowsNativeResult,
  runWindowsHelper,
} from '../electron/windowsNativeCapture.ts'

const PNG = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 1]

/**
 * 假 spawn：记录参数，按行为写好输出文件再触发 close。
 * behaviour: 'ok' | 'cancel' | 'fail-with-stderr' | 'fail-silent' | 'not-png' | 'error'
 */
function fakeSpawn(behaviour) {
  const calls = []
  const launch = (exe, args, options) => {
    calls.push({ exe, args, options })
    const output = args[args.indexOf('--output') + 1]
    const child = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => child.emit('close', 2)
    setTimeout(() => {
      if (behaviour === 'error') {
        child.emit('error', new Error('spawn ENOENT'))
        return
      }
      if (behaviour === 'ok') writeFileSync(output, Buffer.from(PNG))
      if (behaviour === 'not-png') writeFileSync(output, 'not a png')
      if (behaviour === 'fail-with-stderr') child.stderr.emit('data', Buffer.from('未能读取桌面画面'))
      const code = behaviour === 'ok' || behaviour === 'not-png' ? 0 : behaviour === 'cancel' ? 2 : 1
      child.emit('close', code)
    }, 0)
    return child
  }
  return { launch, calls }
}

test('助手写出 PNG：读取成功、清理临时目录、参数正确', async () => {
  const { launch, calls } = fakeSpawn('ok')
  const outcome = await captureWindowsRegion(undefined, 'C:\\tools\\devnotes-capture.exe', launch)
  assert.equal(outcome.status, 'ok')
  assert.deepEqual(outcome.result.image, Buffer.from(PNG))
  assert.equal(existsSync(outcome.result.directory), false)
  assert.equal(calls[0].args[0], '--output')
  assert.equal(calls[0].options.windowsHide, true)
  // 发布会话里可能再调一次释放，必须是幂等的
  await releaseWindowsNativeResult(outcome.result)
})

test('Esc 取消：返回 cancelled，调用方不应再弹回退遮罩', async () => {
  const { launch } = fakeSpawn('cancel')
  assert.deepEqual(await captureWindowsRegion(undefined, 'helper.exe', launch), {
    status: 'cancelled',
  })
})

test('助手失败且没有 stderr：返回 failed，由调用方回退', async () => {
  const { launch } = fakeSpawn('fail-silent')
  const outcome = await captureWindowsRegion(undefined, 'helper.exe', launch)
  assert.equal(outcome.status, 'failed')
})

test('助手失败并写了 stderr：把原始原因带上，便于日志排障', async () => {
  const { launch } = fakeSpawn('fail-with-stderr')
  const dir = mkdtempSync(path.join(tmpdir(), 'fake-out-'))
  await assert.rejects(
    runWindowsHelper('helper.exe', path.join(dir, 'x.png'), undefined, launch),
    /未能读取桌面画面/,
  )
  // 走 captureWindowsRegion 时不抛错，统一变成 failed
  const outcome = await captureWindowsRegion(undefined, 'helper.exe', fakeSpawn('fail-with-stderr').launch)
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.reason, /未能读取桌面画面/)
})

test('写出的不是 PNG：返回 failed 而不是把坏图交给 OCR', async () => {
  const { launch } = fakeSpawn('not-png')
  assert.equal((await captureWindowsRegion(undefined, 'helper.exe', launch)).status, 'failed')
})

test('启动失败（文件被删 / 杀软拦截）返回 failed，不抛错', async () => {
  const { launch } = fakeSpawn('error')
  assert.equal((await captureWindowsRegion(undefined, 'helper.exe', launch)).status, 'failed')
})

test('中止后的旧结果不交付', async () => {
  const controller = new AbortController()
  const { launch } = fakeSpawn('ok')
  const running = captureWindowsRegion(controller.signal, 'helper.exe', launch)
  controller.abort()
  assert.equal((await running).status, 'failed')
})

test('没有助手路径时返回 failed', async () => {
  assert.equal((await captureWindowsRegion(undefined, null)).status, 'failed')
})

test('package.json 只在 win 里带截图助手，且 from 是 CMake 的真实产物', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.build.extraResources.length, 0, '顶层 extraResources 不能带 Windows exe，否则 macOS 打包会失败')
  const resources = pkg.build.win.extraResources ?? []
  const entry = resources.find((item) => String(item.to).replaceAll('\\', '/') === 'native/devnotes-capture.exe')
  assert.ok(entry, 'build.win.extraResources 缺少截图助手')
  assert.equal(
    String(entry.from).replaceAll('\\', '/'),
    'native/win-capture/build/Release/devnotes-capture.exe',
    'extraResources.from 必须与 CMake 产物路径一致',
  )
})
