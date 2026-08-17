/**
 * 服务器端投影折叠逻辑测试: 验证 queryBalanceCost 单元的
 * 同步骤替换语义、模型归属、花费计算与 schema 校验。
 * 运行: node test/smoke-projection.mjs
 */
import { makeCostProjection, resolveModelPrice } from '../src/index.js'
import assert from 'node:assert/strict'

const config = {
  currency: 'CNY',
  prices: {
    'deepseek-chat': { cacheHit: 0.2, cacheMiss: 2, output: 8 },
    'deepseek-reasoner': { cacheHit: 0.5, cacheMiss: 4, output: 16 },
  },
  defaultPrices: { cacheHit: 0.2, cacheMiss: 2, output: 8 },
}
const def = makeCostProjection(config)

let state = def.init()

// 无关事件必须返回同一引用(变更流靠 Object.is 把关)
const untouched = def.apply(state, { type: 'turn/start', data: { turn: 0 } })
assert.equal(untouched, state, 'unrelated event must keep same reference')

// 模型来自 request/header
state = def.apply(state, { type: 'request/header', data: { header: { config: { model: 'deepseek-chat' } } } })
assert.notEqual(state, untouched)

// usage chunk(早期样本)
state = def.apply(state, {
  type: 'assistant/chunk',
  data: { turn: 0, step: 0, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 50, cacheWriteTokens: 0 } } },
})
// 同 (turn,step) 的 assistant/message 替换样本, 不得重复计数
state = def.apply(state, {
  type: 'assistant/message',
  data: { turn: 0, step: 0, message: {}, usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 60, cacheWriteTokens: 10 } },
})

// 模型切换: request/context 指向 reasoner, 新样本归入 reasoner
state = def.apply(state, { type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-reasoner' } })
state = def.apply(state, {
  type: 'assistant/message',
  data: { turn: 0, step: 1, message: {}, usage: { inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 } },
})

let view = def.view(state)
def.schema.parse(view) // schema 校验
console.log('view:', JSON.stringify(view))

assert.deepEqual(view.tokens, { uncachedInput: 300, cacheRead: 60, cacheWrite: 10, output: 100 })
// chat: (100+10)*2 + 60*0.2 + 60*8 = 220 + 12 + 480 = 712 (每 1M) → 0.000712
// reasoner: 200*4 + 0*0.5 + 40*16 = 800 + 640 = 1440 → 0.00144
assert.equal(view.costByModel['deepseek-chat'], 0.000712)
assert.equal(view.costByModel['deepseek-reasoner'], 0.00144)
assert.equal(Math.round(view.cost * 1e6), 2152)
assert.deepEqual(view.models, ['deepseek-chat', 'deepseek-reasoner'])
assert.equal(view.currency, 'CNY')

// 未知名模型使用回退价(deepseek-chat 默认)
state = def.init()
state = def.apply(state, { type: 'assistant/message', data: { turn: 0, step: 0, message: {}, usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } })
view = def.view(state)
def.schema.parse(view)
assert.equal(view.costByModel['unknown'], 0.0002)

// 验证 resolveModelPrice 优先级与多币种能力
// 1. 用户显式覆盖 V4 模型价格
const customPriceConfig = {
  currency: 'CNY',
  prices: {
    'deepseek-v4-flash': { cacheHit: 0.01, cacheMiss: 0.5, output: 1.0 },
  },
  defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 },
}
const priceCustom = resolveModelPrice(customPriceConfig, 'deepseek-v4-flash')
assert.deepEqual(priceCustom, { cacheHit: 0.01, cacheMiss: 0.5, output: 1.0 }, 'Custom price must override dynamic table')

// 2. USD 币种下的动态时间感知计费 (峰时 10:00 BJT)
const usdConfig = { currency: 'USD', prices: {}, defaultPrices: { cacheHit: 0.01, cacheMiss: 0.1, output: 0.2 } }
// 2026-08-18 10:00:00 BJT (UTC+8) -> UTC 02:00:00 -> 峰时
const peakTime = new Date('2026-08-18T02:00:00Z').getTime()
const priceUsdPeak = resolveModelPrice(usdConfig, 'deepseek-v4-flash', peakTime)
assert.deepEqual(priceUsdPeak, { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 }, 'USD peak rate calculation mismatch')

// 3. USD 币种下的动态时间感知计费 (谷时 20:00 BJT)
// 2026-08-18 20:00:00 BJT (UTC+8) -> UTC 12:00:00 -> 谷时
const offPeakTime = new Date('2026-08-18T12:00:00Z').getTime()
const priceUsdOffPeak = resolveModelPrice(usdConfig, 'deepseek-v4-flash', offPeakTime)
assert.deepEqual(priceUsdOffPeak, { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 }, 'USD off-peak rate calculation mismatch')

console.log('PROJECTION TEST PASSED')
