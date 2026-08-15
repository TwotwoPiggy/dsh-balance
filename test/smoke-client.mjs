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
      'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 0.1, output: 0.2 },
      'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
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
      'card.balanceTitle': '📊 账户余额',
      'card.sessionTitle': '⚡ 本会话消耗',
      'card.total': '总额: ',
      'card.topup': '充值 {amount}',
      'card.granted': '赠送 {amount}',
      'card.updated': '更新于 {time} · 每 {interval} 刷新',
      'card.refreshHint': '💡 点击状态指示灯可立即手动刷新',
      'card.tokens': 'Token: 输入 {input} · 输出 {output}',
      'card.tokensHit': '命中: {hit} ({hitRate}%)',
      'card.noCost': '本会话暂未产生消耗',
      'card.pricingHint': '💡 计价规则与单价请见右侧 [?]',
      'pricing.title': '📋 DeepSeek V4 定价参考',
      'pricing.rateBadge': '每 1M tokens · {currency}',
      'pricing.hit': '命中 {price}',
      'pricing.miss': '未命中 {price}',
      'pricing.output': '输出 {price}',
      'pricing.link': '查看官方完整定价页 ›',
      'pricing.aria': '查看 DeepSeek 定价策略',
      'tip.statusAvailable': '可用',
      'tip.statusUnavailable': '不足',
      'tip.error': '获取失败: {error}',
      'model.unknown': '未知模型',
      'model.other': '其他模型',
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
if (!htmlGreen.includes('dshqb_dot_btn')) throw new Error('status button class missing')
if (!htmlGreen.includes('<button')) throw new Error('status button element missing')
if (!htmlGreen.includes('dshqb_trigger')) throw new Error('trigger container missing')
if (!htmlGreen.includes('dshqb_popover')) throw new Error('popover container missing')
if (!htmlGreen.includes('dshqb_col')) throw new Error('dual column missing')
if (!htmlGreen.includes('dshqb_vsep')) throw new Error('vertical separator missing')
if (!htmlGreen.includes('📊 账户余额')) throw new Error('balance title missing')
if (!htmlGreen.includes('⚡ 本会话消耗')) throw new Error('session title missing')
if (!htmlGreen.includes('dshqb_card_tokens')) throw new Error('tokens container class missing')
if (!htmlGreen.includes('dshqb_card_hit')) throw new Error('hit container class missing')
if (!htmlGreen.includes('命中: 60')) throw new Error('hit token count missing')
if (!htmlGreen.includes('dshqb_pricing_wrap')) throw new Error('pricing wrap missing')
if (!htmlGreen.includes('dshqb_pricing_popover')) throw new Error('pricing popover missing')
if (!htmlGreen.includes('📋 DeepSeek V4 定价参考')) throw new Error('v4 pricing title missing')
if (!htmlGreen.includes('deepseek-v4-flash')) throw new Error('v4 flash model missing')
if (!htmlGreen.includes('deepseek-v4-pro')) throw new Error('v4 pro model missing')
if (!htmlGreen.includes('命中 ¥0.02')) throw new Error('v4 hit rate missing')
if (!htmlGreen.includes('未命中 ¥0.1')) throw new Error('v4 miss rate missing')
if (!htmlGreen.includes('输出 ¥0.2')) throw new Error('v4 output rate missing')
// 验证非 V4 模型被成功过滤不展示在定价气泡中
if (htmlGreen.includes('• deepseek-chat</span><div class="dshqb_pricing_rates"')) throw new Error('non-v4 model should be filtered out')

console.log('CLIENT SMOKE TEST PASSED (ZERO-DEPENDENCY)')
process.exit(0)
