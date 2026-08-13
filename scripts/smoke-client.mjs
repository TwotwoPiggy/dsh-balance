/**
 * 客户端 bundle 冒烟测试: 用桩 loader 执行 client/client.js, 再以真实 react +
 * react-dom/server 渲染组件, 验证: 注册不抛错、inject 正确、组件可渲染。
 * 运行: node scripts/smoke-client.mjs
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const bundlePath = new URL('../client/client.js', import.meta.url)

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
}
// bundle 里的 CSS 注入需要 document
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  createElement: () => ({ dataset: {}, set textContent(v) { this._t = v } }),
  head: { appendChild: () => {} },
}

const code = (await import('node:fs')).readFileSync(bundlePath, 'utf8')
// 桩 primitives: Tooltip 把 label 渲染到 data-label(便于断言), 图标桩渲染 "?"
function stubPrimitives(React) {
  return {
    Tooltip: ({ label, children }) => React.createElement('span', { 'data-label': typeof label === 'string' ? label : '' }, children ?? null),
    IconQuestionOutline14: () => React.createElement('span', null, '?'),
  }
}
// 以 CJS 方式执行 bundle: window.__ModuleLoader__.load 捕获 factory 后手动调用
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return require('react')
  if (id === 'react-dom/server') return require('react-dom/server')
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(require('react'))
  throw new Error('unexpected require: ' + id)
})

if (captured === null) throw new Error('loader.load was not called')
if (captured.id !== 'dsh-query-balance') throw new Error('bad id: ' + captured.id)

const module = { exports: {} }
const realReact = require('react')
// 测试用 react: 让 useSyncExternalStore 每次渲染都订阅并读取实时快照
const testReact = {
  ...realReact,
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
    subscribe(() => {})
    return getSnapshot()
  },
}
const factoryResult = captured.factory((id) => {
  if (id === 'react') return testReact
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(testReact)
  throw new Error('unexpected require: ' + id)
})
const api = factoryResult ?? module.exports
console.log('exports:', Object.keys(api))
if (typeof api.apply !== 'function') throw new Error('no apply')
if (JSON.stringify(api.inject) !== JSON.stringify(['slots', 'locale'])) throw new Error('bad inject')

// apply: 记录 locale 注册与 slot 注册
const registrations = []
const ctx = {
  effect(fn) { this._cleanup = fn() },
  locale: {
    register(ns, dicts) { registrations.push(['locale', ns, Object.keys(dicts.zh).length, Object.keys(dicts.en).length]) },
  },
  slots: {
    register() { registrations.push(['register-called']); return () => {} },
    inject(name, factory) {
      registrations.push(['inject', name])
      const dispose = factory()
      registrations.push(['register', dispose !== undefined])
    },
  },
}
api.apply(ctx)
console.log('registrations:', JSON.stringify(registrations))
if (registrations[0][0] !== 'locale' || registrations[0][1] !== 'queryBalance') throw new Error('locale register missing')
if (registrations[1][1] !== 'conversation.composer.dock') throw new Error('slot inject missing')

// 渲染组件: 从注册回调里拿不到组件, 直接重新 apply 并钩住 slots.register
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
let Component = null
const ctx2 = {
  effect() {},
  locale: { register() {} },
  slots: {
    inject(name, factory) {
      const out = factory()
      // factory 返回 disposer; 我们需要组件 —— 改为钩住 register
    },
  },
}
// 直接构造: 通过再次执行 factory 并注入 register 捕获组件
const capturedRegister = []
const ctx3 = {
  effect() {},
  locale: { register() {} },
  slots: {
    inject(name, factory) {
      const wrapped = {
        register(opts, comp) {
          capturedRegister.push({ id: opts.id, order: opts.order, name: opts.name, locale: opts.locale, comp })
          return () => {}
        },
      }
      const prev = ctx3.slots
      ctx3.slots = wrapped
      factory()
      ctx3.slots = prev
    },
  },
}
api.apply(ctx3)
const reg = capturedRegister[0]
console.log('slot:', JSON.stringify({ id: reg.id, order: reg.order, name: reg.name, locale: reg.locale }))
if (reg.id !== 'query-balance' || reg.order !== 1 || reg.name !== 'conversation.composer.dock') throw new Error('bad slot registration')

// 渲染: 桩 useProjection 返回花费投影; balance store 通过 fetch 桩返回余额 + 定价表
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    ok: true,
    fetchedAt: Date.now(),
    refreshIntervalMs: 300000,
    clientPollIntervalMs: 30000,
    currency: 'CNY',
    isAvailable: true,
    balances: [{ currency: 'CNY', total: 100.23, granted: 0, toppedUp: 100.23 }],
    prices: {
      'deepseek-chat': { cacheHit: 0.2, cacheMiss: 2, output: 8 },
      'deepseek-reasoner': { cacheHit: 0.5, cacheMiss: 4, output: 16 },
    },
    defaultPrices: { cacheHit: 0.2, cacheMiss: 2, output: 8 },
  }),
})
// 先触发一次 refresh 让 store 有数据
const Comp = reg.comp
const props = {
  t: (key, params) => {
    const dict = {
      'balance': '余额 {amount}',
      'sessionCost': '本会话约 {amount}',
      'tip.balance': '总额 {total}',
      'tip.cost': '本会话消耗(估算): {amount}',
      'tip.statusAvailable': '可用',
      'tip.statusUnavailable': '不足',
      'tip.error': '获取失败: {error}',
      'model.unknown': '未知模型',
      'model.other': '其他模型',
      'tip.costModel': '{model}: {amount}',
      'tip.pricing': 'DeepSeek 定价(每 1M token · {currency})\n{models}\n点击查看官方定价页',
      'tip.pricingModel': '{model}: 命中 {hit} · 未命中 {miss} · 输出 {output}',
      'pricing.aria': '查看 DeepSeek 定价策略',
      'unit.minutes': '{n} 分钟',
      'unit.seconds': '{n} 秒',
    }
    let out = dict[key] ?? key
    for (const [k, v] of Object.entries(params ?? {})) out = out.replaceAll('{' + k + '}', String(v))
    return out
  },
  useProjection: () => ({
    models: ['deepseek-chat'],
    cost: 0.000712,
    costByModel: { 'deepseek-chat': 0.000712 },
    tokens: { uncachedInput: 100, cacheRead: 60, cacheWrite: 10, output: 60 },
    currency: 'CNY',
  }),
}
// 先渲染一次以启动 store 订阅(发起 fetch), 等待完成后再次渲染验证余额
renderToStaticMarkup(React.createElement(Comp, props))
await new Promise((r) => setTimeout(r, 400))
const el = React.createElement(Comp, props)
const html = renderToStaticMarkup(el)
console.log('rendered:', html)
if (!html.includes('100.23')) throw new Error('balance not rendered')
if (!html.includes('本会话约')) throw new Error('cost not rendered')
if (!html.includes('查看 DeepSeek 定价策略')) throw new Error('pricing anchor missing')
if (!html.includes('>?</')) throw new Error('question icon missing')
if (!html.includes('deepseek-chat: 命中 ¥0.2 · 未命中 ¥2 · 输出 ¥8')) throw new Error('pricing table missing')
if (!html.includes('deepseek-reasoner: 命中 ¥0.5 · 未命中 ¥4 · 输出 ¥16')) throw new Error('reasoner pricing missing')
if (!html.includes('其他模型: 命中 ¥0.2 · 未命中 ¥2 · 输出 ¥8')) throw new Error('fallback pricing missing')
if (!html.includes('点击查看官方定价页')) throw new Error('pricing page hint missing')
console.log('SMOKE TEST PASSED')
process.exit(0)
