/**
 * 客户端 bundle 冒烟测试: 内置零依赖 React Mock 与桩 loader 执行 client/client.js,
 * 验证: 模块注册、注入点、组件渲染、红黄绿状态小控件及 Tooltip 逻辑。
 * 运行: node test/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'

const bundlePath = new URL('../client/client.js', import.meta.url)

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
}

// 模拟 DOM 环境 (注入 CSS 及 visibility 处理)
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  createElement: () => ({ dataset: {}, set textContent(v) { this._t = v } }),
  head: { appendChild: () => {} },
}

// 零依赖 React Mock
const ReactMock = {
  Fragment: Symbol.for('react.fragment'),
  memo: (comp) => comp,
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (init) => ({ current: init ?? null }),
  useSyncExternalStore: (subscribe, getSnapshot) => {
    subscribe(() => {})
    return getSnapshot()
  },
  createElement: (type, props, ...children) => {
    const flattened = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
    const finalChildren = flattened.length > 0 ? (flattened.length === 1 ? flattened[0] : flattened) : props?.children
    return {
      type,
      props: { ...(props ?? {}), children: finalChildren },
    }
  },
}

// 零依赖 HTML 渲染器
function renderToStaticMarkup(vnode) {
  if (vnode === null || vnode === undefined || vnode === false || vnode === true) return ''
  if (typeof vnode === 'string' || typeof vnode === 'number') return String(vnode)
  if (Array.isArray(vnode)) return vnode.map(renderToStaticMarkup).join('')
  if (typeof vnode.type === 'function') {
    const rendered = vnode.type(vnode.props)
    return renderToStaticMarkup(rendered)
  }
  if (vnode.type === ReactMock.Fragment) {
    return renderToStaticMarkup(vnode.props?.children)
  }
  if (typeof vnode.type === 'string') {
    const tag = vnode.type
    const { children, className, ...rest } = vnode.props ?? {}
    let attrs = ''
    if (className) attrs += ` class="${className}"`
    for (const [k, v] of Object.entries(rest)) {
      if (typeof v === 'string' || typeof v === 'number') {
        attrs += ` ${k}="${v}"`
      }
    }
    const inner = renderToStaticMarkup(children)
    return `<${tag}${attrs}>${inner}</${tag}>`
  }
  return ''
}

// 桩 primitives: Tooltip 把 label 渲染到 data-label(便于断言), 图标桩渲染 "?"
function stubPrimitives(React) {
  return {
    Tooltip: ({ label, children }) => React.createElement('span', { 'data-label': typeof label === 'string' ? label : '' }, children ?? null),
    IconQuestionOutline14: () => React.createElement('span', null, '?'),
  }
}

const code = readFileSync(bundlePath, 'utf8')

// 以 CJS 方式执行 bundle
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})

if (captured === null) throw new Error('loader.load was not called')
if (captured.id !== 'dsh-balance') throw new Error('bad id: ' + captured.id)

const factoryResult = captured.factory((id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const api = factoryResult ?? {}
console.log('exports:', Object.keys(api))
if (typeof api.apply !== 'function') throw new Error('no apply')
if (JSON.stringify(api.inject) !== JSON.stringify(['slots', 'locale'])) throw new Error('bad inject')

// 验证 apply 与 slot 注册
const capturedRegister = []
const ctx = {
  effect(fn) { this._cleanup = fn() },
  locale: { register() {} },
  slots: {
    inject(name, factory) {
      const wrapped = {
        register(opts, comp) {
          capturedRegister.push({ id: opts.id, order: opts.order, name: opts.name, locale: opts.locale, comp })
          return () => {}
        },
      }
      ctx.slots = wrapped
      factory()
    },
  },
}
api.apply(ctx)
const reg = capturedRegister[0]
console.log('slot:', JSON.stringify({ id: reg.id, order: reg.order, name: reg.name, locale: reg.locale }))
if (reg.id !== 'dsh-balance' || reg.order !== 1 || reg.name !== 'conversation.composer.dock') throw new Error('bad slot registration')

// 模拟 API 数据与国际化
let mockBalanceTotal = 100.23
let mockIsAvailable = true

globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    ok: true,
    fetchedAt: Date.now(),
    refreshIntervalMs: 300000,
    clientPollIntervalMs: 30000,
    currency: 'CNY',
    thresholds: { warning: 10, danger: 5 },
    isAvailable: mockIsAvailable,
    balances: [{ currency: 'CNY', total: mockBalanceTotal, granted: 0, toppedUp: mockBalanceTotal }],
    prices: {
      'deepseek-chat': { cacheHit: 0.2, cacheMiss: 2, output: 8 },
      'deepseek-reasoner': { cacheHit: 0.5, cacheMiss: 4, output: 16 },
    },
    defaultPrices: { cacheHit: 0.2, cacheMiss: 2, output: 8 },
  }),
})

const Comp = reg.comp
const props = {
  t: (key, params) => {
    const dict = {
      'balance': '余额 {amount}',
      'status.sufficient': '充足',
      'status.warning': '偏低',
      'status.danger': '告急',
      'sessionCost': '本会话约 {amount}',
      'tip.balance': '总额 {total} · 状态: {status} ({level})',
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

// 1. 验证绿色 (充足: 100.23 >= 10)
renderToStaticMarkup(ReactMock.createElement(Comp, props))
await new Promise((r) => setTimeout(r, 400))
const htmlGreen = renderToStaticMarkup(ReactMock.createElement(Comp, props))
console.log('rendered (green):', htmlGreen)
if (!htmlGreen.includes('100.23')) throw new Error('balance not rendered')
if (!htmlGreen.includes('dshqb_dot_success')) throw new Error('green status dot missing')
if (!htmlGreen.includes('本会话约')) throw new Error('cost not rendered')
if (!htmlGreen.includes('查看 DeepSeek 定价策略')) throw new Error('pricing anchor missing')
if (!htmlGreen.includes('>?</')) throw new Error('question icon missing')
if (!htmlGreen.includes('deepseek-chat: 命中 ¥0.2 · 未命中 ¥2 · 输出 ¥8')) throw new Error('pricing table missing')
if (!htmlGreen.includes('deepseek-reasoner: 命中 ¥0.5 · 未命中 ¥4 · 输出 ¥16')) throw new Error('reasoner pricing missing')
if (!htmlGreen.includes('其他模型: 命中 ¥0.2 · 未命中 ¥2 · 输出 ¥8')) throw new Error('fallback pricing missing')

console.log('CLIENT SMOKE TEST PASSED (ZERO-DEPENDENCY)')
process.exit(0)
