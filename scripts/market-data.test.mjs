import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

/*
 * 行情/账户数据层回归：用 vm 跑转译后的 marketData.ts，fetchViaNet 换成按 URL 返回预设响应的假实现。
 * 覆盖「账户失败不得伪装成零资产/空仓」「公共行情不带签名」「换凭据后旧结果作废」三条底线。
 */
const source = await readFile(new URL('../electron/marketData.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})

function setup(respond) {
  const requests = []
  const module = { exports: {} }
  const __respond = respond

  /* 不注入宿主 globals：vm 自带独立 realm 的同名内建，混用会造成构造器不一致的静默失败 */
  const sandbox = {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    __respond,
    __requests: requests,
    require(name) {
      if (name === 'node:crypto') return crypto
      if (name === './proxy') {
        return {
          fetchViaNet: async (options) => {
            requests.push(options)
            return __respond(options)
          },
        }
      }
      return {}
    },
  }
  vm.runInNewContext(outputText, sandbox)
  return { api: module.exports, requests }
}

const json = (body) => ({ ok: true, status: 200, text: JSON.stringify(body), url: '' })
const credentials = () => ['a'.repeat(20), 'b'.repeat(20)]

/** 账户三个接口的默认成功响应，可用 overrides 单独替换某一路 */
function accountResponder(overrides = {}) {
  return (options) => {
    const url = options.url
    if (url.includes('/futures/usdt/positions')) {
      return overrides.positions ?? json([{ contract: 'BTC_USDT', size: '1', entry_price: '60000', mark_price: '61000', value: '61', unrealised_pnl: '1', initial_margin: '10', mode: 'single', lever: '10', liq_price: '50000' }])
    }
    // 现货账户也必须带 accounts 前缀；先判 spot 再判 futures，避免顺序误伤
    if (url.includes('/spot/accounts')) return overrides.spot ?? json([{ currency: 'USDT', available: '100', locked: '0' }])
    if (url.includes('/futures/usdt/accounts')) return overrides.account ?? json({ total: '1200.5', available: '800', unrealised_pnl: '12.5' })
    return { ok: false, status: 404, text: '', error: 'not found', url }
  }
}

test('公开行情请求不带任何签名头', async () => {
  const { api, requests } = setup((options) => {
    if (options.url.includes('/futures/usdt/tickers')) {
      return json([{ contract: 'BTC_USDT', last: '60000', change_price: '1', change_percentage: '1.2', high_24h: '61000', low_24h: '59000' }])
    }
    return json([{ currency_pair: 'BTC_USDT', last: '60000', change_percentage: '1.2', change_utc0: '1', high_24h: '1', low_24h: '1', base_volume: '1' }])
  })
  await api.fetchMarketQuotes({ spot: ['BTCUSDT'], contracts: ['BTCUSDT'] })
  assert.ok(requests.length > 0)
  for (const request of requests) {
    assert.equal(request.headers?.KEY, undefined)
    assert.equal(request.headers?.SIGN, undefined)
  }
})

test('账户全部成功时各字段都是真实数字与数组', async () => {
  const { api } = setup(accountResponder())
  api.setGateCredentials(...credentials())
  const data = await api.fetchGateAccount()
  assert.equal(data.total, 1200.5)
  assert.equal(data.available, 800)
  assert.equal(data.unrealisedPnl, 12.5)
  assert.equal(data.openPositions.length, 1)
  assert.equal(data.spotBalances.length, 1)
  assert.equal(data.partial, false)
  assert.equal(data.balanceError, undefined)
})

test('真实的零余额与空仓仍然是 0 和空数组，而不是 --', async () => {
  const { api } = setup(accountResponder({
    account: json({ total: '0', available: '0', unrealised_pnl: '0' }),
    positions: json([]),
    spot: json([]),
  }))
  api.setGateCredentials(...credentials())
  const data = await api.fetchGateAccount()
  assert.equal(data.total, 0)
  assert.equal(data.unrealisedPnl, 0)
  // 跨 realm 的数组原型不同，用长度判断而不是 deepEqual
  assert.equal(data.openPositions.length, 0)
  assert.equal(data.spotBalances.length, 0)
  assert.equal(data.partial, false)
})

test('持仓接口失败时为 null 并带错误原因，其余成功数据保留', async () => {
  const { api } = setup(accountResponder({ positions: json({ label: 'INVALID_SIGNATURE', message: 'invalid' }) }))
  api.setGateCredentials(...credentials())
  const data = await api.fetchGateAccount()
  assert.equal(data.openPositions, null)
  assert.equal(data.partial, true)
  assert.ok(data.positionError)
  assert.equal(data.total, 1200.5)
})

test('账户余额接口失败时为 null，不会折成 0 资产', async () => {
  const { api } = setup(accountResponder({ account: { ok: false, status: 401, text: '', error: 'HTTP 401', url: '' } }))
  api.setGateCredentials(...credentials())
  const data = await api.fetchGateAccount()
  assert.equal(data.total, null)
  assert.equal(data.available, null)
  assert.equal(data.unrealisedPnl, null)
  assert.equal(data.partial, true)
  assert.ok(data.balanceError)
})

test('请求途中凭据被替换时丢弃旧账户结果', async () => {

  const { api } = setup((options) => {
    if (options.url.includes('/futures/usdt/accounts')) {
      return new Promise((resolve) => { setTimeout(() => resolve(json({ total: '1', available: '1', unrealised_pnl: '0' })), 10) })
    }
    return json([])
  })
  api.setGateCredentials(...credentials())
  const pending = api.fetchGateAccount()
  api.setGateCredentials('c'.repeat(20), 'd'.repeat(20))
  await assert.rejects(pending, /凭据已更新/)
})

test('凭据代际在每次作废后递增', () => {
  const { api } = setup(accountResponder())
  const first = api.getGateCredentialGeneration()
  const next = api.invalidateGateCredentialGeneration()
  assert.equal(next, first + 1)
  assert.equal(api.getGateCredentialGeneration(), next)
})
