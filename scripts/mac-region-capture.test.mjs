import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { captureMacRegion } from '../electron/macRegionCapture.ts'

test('原生框选成功后读取结果并删除临时目录', async () => {
  let output
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
  const result = await captureMacRegion(undefined, async (file) => {
    output = file
    await writeFile(file, bytes)
  })
  assert.deepEqual(result, bytes)
  assert.equal(existsSync(path.dirname(output)), false)
})

test('Esc 取消不产生结果，也不留下临时目录', async () => {
  let output
  const result = await captureMacRegion(undefined, async (file) => { output = file })
  assert.equal(result, null)
  assert.equal(existsSync(path.dirname(output)), false)
})

test('系统截图失败仍清除临时图片', async () => {
  let output
  await assert.rejects(captureMacRegion(undefined, async (file) => {
    output = file
    await writeFile(file, 'partial screenshot')
    throw new Error('capture failed')
  }), /capture failed/)
  assert.equal(existsSync(path.dirname(output)), false)
})

test('中止截图后不再交付旧结果', async () => {
  const controller = new AbortController()
  let output
  const result = await captureMacRegion(controller.signal, async (file) => {
    output = file
    await writeFile(file, 'screenshot')
    controller.abort()
  })
  assert.equal(result, null)
  assert.equal(existsSync(path.dirname(output)), false)
})

test('空文件或非 PNG 结果不能交给 OCR', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('invalid image')]) {
    let output
    await assert.rejects(captureMacRegion(undefined, async (file) => {
      output = file
      await writeFile(file, bytes)
    }), /有效的 PNG/)
    assert.equal(existsSync(path.dirname(output)), false)
  }
})

test('提前中止不会启动系统截图', async () => {
  const controller = new AbortController()
  controller.abort()
  const result = await captureMacRegion(controller.signal, async () => assert.fail('should not capture'))
  assert.equal(result, null)
})
