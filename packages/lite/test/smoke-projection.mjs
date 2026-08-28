/**
 * 服务器端投影折叠逻辑测试 (精简版): 验证 queryBalanceCost 单元的
 * 同步骤替换语义、模型归属、花费计算与 schema 校验。
 * 运行: node test/smoke-projection.mjs
 */
import { makeCostProjection, resolveModelPrice, isPeakTime } from '../src/index.js'
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

// 验证 dsh 0.1.1-rc.2 契约字段 (stateSchema + wire: { viewSchema, view } + stateVersion)
assert.ok(def.stateSchema, 'stateSchema must be provided')
assert.ok(def.wire, 'wire must be provided for client-visible projection')
assert.ok(def.wire.viewSchema, 'wire.viewSchema must be provided')
assert.equal(typeof def.wire.view, 'function', 'wire.view must be a function')
assert.equal(def.stateVersion, 1, 'stateVersion must be 1')

let state = def.init()
def.stateSchema.parse(state) // 校验初始状态符合 stateSchema

// 无关事件必须返回同一引用(变更流靠 Object.is 把关)
const untouched = def.apply(state, { type: 'turn/start', data: { turn: 0 } })
assert.equal(untouched, state, 'unrelated event must keep same reference')

// 模型来自 request/header
state = def.apply(state, { type: 'request/header', data: { header: { config: { model: 'deepseek-chat' } } } })
assert.notEqual(state, untouched)
def.stateSchema.parse(state)

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
def.stateSchema.parse(state)

// 模型切换: request/context 指向 reasoner, 新样本归入 reasoner
state = def.apply(state, { type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-reasoner' } })
state = def.apply(state, {
  type: 'assistant/message',
  data: { turn: 0, step: 1, message: {}, usage: { inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 } },
})
def.stateSchema.parse(state)

let view = def.wire.view(state)
def.wire.viewSchema.parse(view) // wire.viewSchema 校验
def.schema.parse(view) // 向后兼容 schema 别名校验
console.log('view:', JSON.stringify(view))

assert.deepEqual(view.tokens, { uncachedInput: 300, cacheRead: 60, cacheWrite: 10, output: 100 })
// chat: (100+10)*2 + 60*0.2 + 60*8 = 220 + 12 + 480 = 712 (每 1M) → 0.000712
// reasoner: 200*4 + 0*0.5 + 40*16 = 800 + 640 = 1440 → 0.00144
assert.equal(view.costByModel['deepseek-chat'], 0.000712)
assert.equal(view.costByModel['deepseek-reasoner'], 0.00144)
assert.equal(Math.round(view.cost * 1e6), 2152)
assert.deepEqual(view.models, ['deepseek-chat', 'deepseek-reasoner'])
assert.equal(view.currency, 'CNY')

// 未知名模型使用回退价
state = def.init()
state = def.apply(state, { type: 'assistant/message', data: { turn: 0, step: 0, message: {}, usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } })
def.stateSchema.parse(state)
view = def.view(state)
def.schema.parse(view)
assert.equal(view.costByModel['unknown'], 0.0002)

// 同步骤同 (turn, step) 替换样本发生模型切换时的 token 减法与 Zod 校验
let switchState = def.init()
switchState = def.apply(switchState, {
  type: 'request/context',
  data: { model: 'model-A' },
})
switchState = def.apply(switchState, {
  type: 'assistant/chunk',
  data: {
    turn: 0,
    step: 0,
    chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  },
})
// 同一步骤 (turn 0, step 0) 切换为 model-B 报告样本
switchState = def.apply(switchState, {
  type: 'request/context',
  data: { model: 'model-B' },
})
switchState = def.apply(switchState, {
  type: 'assistant/message',
  data: {
    turn: 0,
    step: 0,
    usage: { inputTokens: 200, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
})
const switchView = def.view(switchState)
def.schema.parse(switchView)
assert.equal(switchView.tokens.uncachedInput, 200, 'uncachedInput should be 200 (model-A replaced by model-B)')
assert.equal(switchView.tokens.output, 80, 'output should be 80')
assert.equal(switchView.costByModel['model-A'], undefined, 'model-A should have 0 cost and be omitted from costByModel')
assert.ok(switchView.costByModel['model-B'] > 0, 'model-B should have positive cost')

// 验证 resolveModelPrice 优先级与多币种能力
const customPriceConfig = {
  currency: 'CNY',
  prices: {
    'deepseek-v4-flash': { cacheHit: 0.01, cacheMiss: 0.5, output: 1.0 },
    'custom-standard-model': { cacheHit: 0.05, cacheMiss: 0.8, output: 1.5 },
  },
  pricesOffPeak: {
    'custom-discount-model': { cacheHit: 0.02, cacheMiss: 0.4, output: 0.8 },
  },
  defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 },
}
const priceCustom = resolveModelPrice(customPriceConfig, 'deepseek-v4-flash')
assert.deepEqual(priceCustom, { cacheHit: 0.01, cacheMiss: 0.5, output: 1.0 }, 'Custom price must override dynamic table')

const peakTime = new Date('2026-08-18T02:00:00Z').getTime() // 10:00 BJT -> 峰时
const priceStdPeak = resolveModelPrice(customPriceConfig, 'custom-standard-model', peakTime)
assert.deepEqual(priceStdPeak, { cacheHit: 0.05, cacheMiss: 0.8, output: 1.5 })

const priceDiscPeak = resolveModelPrice(customPriceConfig, 'custom-discount-model', peakTime)
assert.deepEqual(priceDiscPeak, customPriceConfig.defaultPrices)

const offPeakTime = new Date('2026-08-18T12:00:00Z').getTime() // 20:00 BJT -> 谷时
const priceStdOffPeak = resolveModelPrice(customPriceConfig, 'custom-standard-model', offPeakTime)
assert.deepEqual(priceStdOffPeak, { cacheHit: 0.05, cacheMiss: 0.8, output: 1.5 })

const priceDiscOffPeak = resolveModelPrice(customPriceConfig, 'custom-discount-model', offPeakTime)
assert.deepEqual(priceDiscOffPeak, { cacheHit: 0.02, cacheMiss: 0.4, output: 0.8 })

const usdConfig = { currency: 'USD', prices: {}, defaultPrices: { cacheHit: 0.01, cacheMiss: 0.1, output: 0.2 } }
const priceUsdPeak = resolveModelPrice(usdConfig, 'deepseek-v4-flash', peakTime)
assert.deepEqual(priceUsdPeak, { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 }, 'USD peak rate calculation mismatch')

// 5. 验证 isPeakTime 与周末全天 5 折特惠规则
assert.equal(isPeakTime(peakTime), true, 'Tuesday 10:00 BJT should be peak time')
assert.equal(isPeakTime(offPeakTime), false, 'Tuesday 20:00 BJT should be off-peak time')
const saturdayTime = new Date('2026-08-22T02:00:00Z').getTime() // 周六 10:00 BJT
assert.equal(isPeakTime(saturdayTime), false, 'Saturday 10:00 BJT should be off-peak time')
const priceWeekend = resolveModelPrice(usdConfig, 'deepseek-v4-flash', saturdayTime)
assert.deepEqual(priceWeekend, { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 }, 'Weekend daytime should use off-peak rate')

console.log('LITE PROJECTION TEST PASSED')
