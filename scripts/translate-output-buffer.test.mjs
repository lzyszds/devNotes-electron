import assert from 'node:assert/strict'
import test from 'node:test'
import { createTranslateOutputBuffer } from '../src/utils/translateOutputBuffer.ts'

test('首字立即显示，突发的 100 段增量只合并刷新一次', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes = []
  const buffer = createTranslateOutputBuffer((text) => writes.push(text))
  buffer.push('首字')
  assert.deepEqual(writes, ['首字'])
  for (let i = 1; i <= 100; i++) buffer.push('字'.repeat(i))
  assert.equal(writes.length, 1)
  t.mock.timers.tick(39)
  assert.equal(writes.length, 1)
  t.mock.timers.tick(1)
  assert.deepEqual(writes, ['首字', '字'.repeat(100)])
})

test('结束时立即 flush，最后一段不会丢失或重复写入', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes = []
  const buffer = createTranslateOutputBuffer((text) => writes.push(text))
  buffer.push('a')
  buffer.push('ab')
  buffer.flush()
  buffer.flush()
  t.mock.timers.tick(100)
  assert.deepEqual(writes, ['a', 'ab'])
})

test('取消会丢弃还未刷出的旧译文，定时器不再回写', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes = []
  const buffer = createTranslateOutputBuffer((text) => writes.push(text))
  buffer.push('a')
  buffer.push('old')
  buffer.cancel()
  buffer.flush()
  t.mock.timers.tick(100)
  assert.deepEqual(writes, ['a'])
})
