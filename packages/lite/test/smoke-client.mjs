/**
 * 客户端 bundle 冒烟测试 (精简版): 内置零依赖 React Mock 与桩 loader 执行 client/client.js,
 * 验证: 模块注册、注入点、组件渲染、红黄绿状态指示灯、popover 详情展示。
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

// 模拟 DOM 环境
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
  useMemo: (fn) => fn(),
  useEffect: (fn) => { fn() },
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

const code = readFileSync(bundlePath, 'utf8')

// 以 CJS 方式执行 bundle
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  throw new Error('unexpected require in lite: ' + id)
})

if (captured === null) throw new Error('loader.load was not called')
if (captured.id !== 'dsh-balance-lite') throw new Error('bad id: ' + captured.id)

const factoryResult = captured.factory((id) => {
  if (id === 'react') return ReactMock
  throw new Error('unexpected require in lite: ' + id)
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
if (reg.id !== 'dsh-balance-lite' || reg.order !== 1 || reg.name !== 'conversation.composer.dock') throw new Error('bad slot registration')

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
    balances: [
      { currency: 'USD', total: 0, granted: 0, toppedUp: 0 },
      { currency: 'CNY', total: mockBalanceTotal, granted: 0, toppedUp: mockBalanceTotal },
    ],
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

// 确认精简版已删除设置按钮、定价参考弹窗等
if (htmlGreen.includes('dshqb_pricing_wrap')) throw new Error('pricing wrap should not exist in lite')
if (htmlGreen.includes('dshqb_btn_icon')) throw new Error('btn_icon should not exist in lite')
if (htmlGreen.includes('⚙️ 打开偏好设置')) throw new Error('settings link should not exist in lite')

// 2. 验证负数金额与小数位格式化
mockBalanceTotal = -0.05
const vnode = Comp(props)
function findDot(vn) {
  if (!vn || typeof vn !== 'object') return null
  if (vn.props?.className?.includes('dshqb_dot')) return vn
  const children = Array.isArray(vn.props?.children) ? vn.props.children : [vn.props?.children]
  for (const c of children) {
    const res = findDot(c)
    if (res) return res
  }
  return null
}
const dot = findDot(vnode)
if (dot?.props?.onClick) dot.props.onClick({ stopPropagation() {}, preventDefault() {} })
await new Promise((r) => setTimeout(r, 400))
const htmlNegative = renderToStaticMarkup(ReactMock.createElement(Comp, props))
if (!htmlNegative.includes('-¥0.050')) throw new Error('negative balance format failed: ' + htmlNegative)

// 3. 验证黄色预警状态 (warning: total 8 < 10 && >= 5)
mockBalanceTotal = 8.00
dot?.props?.onClick({ stopPropagation() {}, preventDefault() {} })
await new Promise((r) => setTimeout(r, 400))
const htmlWarning = renderToStaticMarkup(ReactMock.createElement(Comp, props))
if (!htmlWarning.includes('dshqb_dot_warning')) throw new Error('warning dot missing for total=8.00')
if (!htmlWarning.includes('偏低')) throw new Error('warning text missing')

// 4. 验证红色告急状态 (danger: total 3 < 5)
mockBalanceTotal = 3.00
dot?.props?.onClick({ stopPropagation() {}, preventDefault() {} })
await new Promise((r) => setTimeout(r, 400))
const htmlDanger = renderToStaticMarkup(ReactMock.createElement(Comp, props))
if (!htmlDanger.includes('dshqb_dot_danger')) throw new Error('danger dot missing for total=3.00')
if (!htmlDanger.includes('告急')) throw new Error('danger text missing')

// 5. 验证不可用状态 (isAvailable = false 强制告急)
mockBalanceTotal = 50.00
mockIsAvailable = false
dot?.props?.onClick({ stopPropagation() {}, preventDefault() {} })
await new Promise((r) => setTimeout(r, 400))
const htmlUnavailable = renderToStaticMarkup(ReactMock.createElement(Comp, props))
if (!htmlUnavailable.includes('dshqb_dot_danger')) throw new Error('danger dot missing when isAvailable=false')

// 6. Issue #7 验证: lite 包 client.inject 不包含已废弃的 @deepseek-ai/dsh-client-runtime
const pkgLite = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (pkgLite.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-runtime')) {
  throw new Error('packages/lite/package.json dsh.client.inject must not include deprecated @deepseek-ai/dsh-client-runtime')
}
console.log('Issue #7 lite package inject verification passed')

console.log('LITE CLIENT SMOKE TEST PASSED')
process.exit(0)
