import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../electron/pasteToApp.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})

function setup({ trusted = true, missing = false, pasteError } = {}) {
  const events = []
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    process: { platform: 'darwin' },
    require(name) {
      if (name === 'electron') return {
        clipboard: { writeText: async (text) => events.push(['write', text]) },
        systemPreferences: { isTrustedAccessibilityClient: () => trusted },
        dialog: { showMessageBox: async () => ({ response: 1 }) },
      }
      if (name === '@xitanggg/node-insert-text') {
        if (missing) throw new Error('missing binary')
        return { paste() {
          events.push(['paste'])
          if (pasteError) throw new Error(pasteError)
        } }
      }
      return {}
    },
  })
  return { api: exports, events }
}

test('先写剪贴板，再仅模拟粘贴，不调用 insertText 或还原剪贴板', async () => {
  const { api, events } = setup()
  assert.equal((await api.pasteToFocusedApp('中文 😀\n多行')).ok, true)
  assert.deepEqual(events, [['write', '中文 😀\n多行'], ['paste']])
})

test('缺少原生模块时保留复制结果并报告加载错误', async () => {
  const { api, events } = setup({ missing: true })
  assert.equal((await api.pasteToFocusedApp('hello')).reason, 'no-module')
  assert.deepEqual(events, [['write', 'hello']])
  assert.match(api.pasteModuleLoadError(), /missing binary/)
})

test('未授权时不发送按键，仍保留手动粘贴内容', async () => {
  const { api, events } = setup({ trusted: false })
  assert.equal((await api.pasteToFocusedApp('hello')).reason, 'no-permission')
  assert.deepEqual(events, [['write', 'hello']])
})

test('原生粘贴异常可以返回原因并记录具体错误', async () => {
  const { api } = setup({ pasteError: 'event failed' })
  assert.equal((await api.pasteToFocusedApp('hello')).reason, 'failed')
  assert.match(api.lastPasteFailure(), /event failed/)
})
