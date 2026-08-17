/**
 * 后端可视化配置与连接测试 API 冒烟测试:
 * 验证 /query-balance/config 的 GET/POST 路由与动态修改机制。
 * 运行: node test/smoke-config-api.mjs
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { apply } from '../src/index.js'

// 模拟 webServer 上下文与注册表
const routes = new Map()

const mockCtx = {
  get(key) {
    if (key === 'credentials') {
      return {
        async resolve(ref) {
          if (ref === 'DEEPSEEK_API_KEY') return { value: 'sk-mock-key-from-credentials' }
          return undefined
        },
      }
    }
    return undefined
  },
  logger: {
    warn() {},
    info() {},
    error() {},
  },
  effect(fn) {
    fn()
  },
  inject(keys, fn) {
    if (keys.includes('webServer')) {
      const webCtx = {
        effect(cb) { cb() },
        webServer: {
          register(def) {
            routes.set(def.path, def.handler)
          },
        },
      }
      fn(webCtx)
    }
    if (keys.includes('sessionProjections')) {
      const projCtx = {
        sessionProjections: {
          register(proj) {
            mockCtx._projection = proj
          },
        },
      }
      fn(projCtx)
    }
  },
}

const initialConfig = {
  apiKey: '',
  apiKeyRef: 'DEEPSEEK_API_KEY',
  baseUrl: 'https://api.deepseek.com',
  warningThreshold: 10,
  dangerThreshold: 5,
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'CNY',
  prices: {
    'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 },
  },
  defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 },
}

apply(mockCtx, initialConfig)

// Helper: 模拟 HTTP 请求触发 handler
function invokeRoute(path, method, body = null, query = '') {
  return new Promise((resolve, reject) => {
    const handler = routes.get(path)
    if (!handler) return reject(new Error('Route not found: ' + path))

    const req = new EventEmitter()
    req.method = method
    req.url = path + (query ? '?' + query : '')
    req.headers = { 'content-type': 'application/json' }

    let statusCode = 200
    let headers = {}
    let resBody = ''

    const res = {
      writeHead(code, hdrs) {
        statusCode = code
        headers = hdrs
      },
      end(chunk) {
        if (chunk) resBody += chunk
        try {
          const parsed = resBody ? JSON.parse(resBody) : null
          resolve({ status: statusCode, headers, data: parsed, text: resBody })
        } catch {
          resolve({ status: statusCode, headers, text: resBody })
        }
      },
    }

    handler(req, res).catch(reject)

    if (body !== null) {
      req.emit('data', Buffer.from(JSON.stringify(body)))
    }
    req.emit('end')
  })
}

async function runTests() {
  console.log('Testing /query-balance routes...')

  // 1. GET /query-balance/config
  const resGetConfig = await invokeRoute('/query-balance/config', 'GET')
  assert.equal(resGetConfig.status, 200)
  assert.equal(resGetConfig.data.ok, true)
  assert.equal(resGetConfig.data.config.warningThreshold, 10)
  assert.equal(resGetConfig.data.config.dangerThreshold, 5)
  assert.equal(resGetConfig.data.config.currency, 'CNY')
  console.log('GET /query-balance/config passed')

  // 2. POST /query-balance/config 修改阈值与单价
  const resPostConfig = await invokeRoute('/query-balance/config', 'POST', {
    warningThreshold: 30,
    dangerThreshold: 15,
    currency: 'USD',
    clientPollIntervalMs: 15000,
    prices: {
      'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 }
    }
  })
  assert.equal(resPostConfig.status, 200)
  assert.equal(resPostConfig.data.ok, true)
  assert.equal(resPostConfig.data.config.warningThreshold, 30)
  assert.equal(resPostConfig.data.config.dangerThreshold, 15)
  assert.equal(resPostConfig.data.config.currency, 'USD')
  assert.deepEqual(resPostConfig.data.config.thresholds.USD, { warning: 30, danger: 15 })
  assert.deepEqual(resPostConfig.data.config.thresholds.CNY, { warning: 10, danger: 5 })
  assert.equal(resPostConfig.data.config.prices['deepseek-chat'], undefined, 'deleted custom model should not exist')
  assert.ok(resPostConfig.data.config.prices['deepseek-v4-flash'], 'flash price exists')
  assert.equal(resPostConfig.data.config.prices['deepseek-v4-flash'].cacheHit, 0.02)
  console.log('POST /query-balance/config passed (including model deletion and multi-currency thresholds test)')

  // 3. 验证动态配置生效到会话花费投影
  if (mockCtx._projection) {
    let state = mockCtx._projection.init()
    state = mockCtx._projection.apply(state, {
      type: 'request/header',
      data: { header: { config: { model: 'deepseek-chat' } } },
    })
    state = mockCtx._projection.apply(state, {
      type: 'assistant/message',
      data: {
        turn: 0,
        step: 0,
        usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    })
    const view = mockCtx._projection.view(state)
    assert.equal(view.currency, 'USD', 'Projection should reflect updated currency')
    console.log('Dynamic projection config update passed')
  }

  // 4. 验证 Bug 8: apiKey 不会被空字符串覆盖
  await invokeRoute('/query-balance/config', 'POST', { apiKey: 'sk-secret-key-123456' })
  const resKeySet = await invokeRoute('/query-balance/config', 'GET')
  assert.equal(resKeySet.data.config.hasCustomKey, true)
  assert.equal(resKeySet.data.config.apiKeyMasked, 'sk-s****3456')

  // 空字符串或空白不会清除 apiKey
  await invokeRoute('/query-balance/config', 'POST', { warningThreshold: 35, apiKey: '   ' })
  const resKeyRetained = await invokeRoute('/query-balance/config', 'GET')
  assert.equal(resKeyRetained.data.config.hasCustomKey, true)
  assert.equal(resKeyRetained.data.config.apiKeyMasked, 'sk-s****3456')
  console.log('apiKey preservation test passed (Bug 8 fix verified)')

  // 5. 验证 Bug 3: thresholds 深度合并 (只配置 warning 时 danger 不丢失)
  await invokeRoute('/query-balance/config', 'POST', {
    thresholds: {
      CNY: { warning: 88 },
      USD: { warning: 8.8 },
      EUR: { warning: 7.7 },
    },
  })
  const resThresholdCheck = await invokeRoute('/query-balance/config', 'GET')
  assert.equal(resThresholdCheck.data.config.thresholds.CNY.warning, 88)
  assert.equal(resThresholdCheck.data.config.thresholds.CNY.danger, 5, 'CNY danger should retain 5, not undefined')
  assert.equal(resThresholdCheck.data.config.thresholds.USD.warning, 8.8)
  assert.equal(resThresholdCheck.data.config.thresholds.USD.danger, 15, 'USD danger should retain previously configured 15, not undefined')
  assert.equal(resThresholdCheck.data.config.thresholds.EUR.warning, 7.7)
  assert.equal(resThresholdCheck.data.config.thresholds.EUR.danger, 5, 'EUR danger should default to 5, not undefined')
  console.log('thresholds deep merge test passed (Bug 3 fix verified)')

  // 6. 验证 Bug 2: 谷时 serialize 包含 prices 中配置的自定义模型
  await invokeRoute('/query-balance/config', 'POST', {
    prices: {
      'custom-model-x': { cacheHit: 0.5, cacheMiss: 1.5, output: 3.0 },
    },
  })
  const resCache = await invokeRoute('/query-balance', 'GET')
  assert.ok(resCache.data.prices['custom-model-x'], 'custom-model-x should be present in cache.prices')
  assert.equal(resCache.data.prices['custom-model-x'].cacheHit, 0.5)
  // 7. 验证 Bug 7: 请求体解析异常与非法 JSON 保护
  const resBadJson = await new Promise((resolve, reject) => {
    const handler = routes.get('/query-balance/config')
    const req = new EventEmitter()
    req.method = 'POST'
    req.url = '/query-balance/config'
    req.headers = { 'content-type': 'application/json' }
    req.destroy = () => {}
    let statusCode = 200
    const res = {
      writeHead(code) { statusCode = code },
      end(chunk) {
        resolve({ status: statusCode, data: JSON.parse(chunk) })
      },
    }
    handler(req, res).catch(reject)
    req.emit('data', Buffer.from('invalid-json-text'))
    req.emit('end')
  })
  assert.equal(resBadJson.status, 400)
  assert.equal(resBadJson.data.ok, false)

  // 验证超大请求体 (>1MB) 熔断保护
  const resHugeBody = await new Promise((resolve, reject) => {
    const handler = routes.get('/query-balance/config')
    const req = new EventEmitter()
    req.method = 'POST'
    req.url = '/query-balance/config'
    req.headers = { 'content-type': 'application/json' }
    req.destroy = () => {}
    let statusCode = 200
    const res = {
      writeHead(code) { statusCode = code },
      end(chunk) {
        resolve({ status: statusCode, data: JSON.parse(chunk) })
      },
    }
    handler(req, res).catch(reject)
    // 发送超过 1MB 的超大数据分片
    req.emit('data', Buffer.alloc(1.2 * 1024 * 1024, 'a'))
  })
  assert.equal(resHugeBody.status, 400)
  assert.equal(resHugeBody.data.ok, false)
  console.log('request body error handling and 1MB limit passed (Bug 7 verified)')

  // 8. 验证 Issue 12: 刷新与轮询间隔下限保护 (>= 1000ms)
  const prevConfig = (await invokeRoute('/query-balance/config', 'GET')).data.config
  await invokeRoute('/query-balance/config', 'POST', {
    refreshIntervalMs: 500, // 非法: < 1000
    clientPollIntervalMs: 200, // 非法: < 1000
    timeoutMs: 100, // 非法: < 1000
  })
  const resBoundaryCheck = await invokeRoute('/query-balance/config', 'GET')
  assert.equal(resBoundaryCheck.data.config.refreshIntervalMs, prevConfig.refreshIntervalMs, 'refreshIntervalMs < 1000 should be ignored')
  assert.equal(resBoundaryCheck.data.config.clientPollIntervalMs, prevConfig.clientPollIntervalMs, 'clientPollIntervalMs < 1000 should be ignored')
  assert.equal(resBoundaryCheck.data.config.timeoutMs, prevConfig.timeoutMs, 'timeoutMs < 1000 should be ignored')
  console.log('Boundary checks for interval fields passed (Issue 12 verified)')

  // 9. 验证 Bug 3: 初始加载配置时的 thresholds 深度合并
  const freshRoutes = new Map()
  let freshGetConfig = null
  const freshMockCtx = {
    ...mockCtx,
    inject(keys, fn) {
      if (keys.includes('webServer')) {
        fn({
          effect(cb) { cb() },
          webServer: {
            register(def) {
              freshRoutes.set(def.path, def.handler)
            },
          },
        })
      }
    },
  }
  apply(freshMockCtx, {
    currency: 'CNY',
    thresholds: {
      CNY: { warning: 20 }, // 未提供 danger
    },
  })
  const resFreshGet = await new Promise((resolve, reject) => {
    const handler = freshRoutes.get('/query-balance/config')
    const req = new EventEmitter()
    req.method = 'GET'
    req.url = '/query-balance/config'
    req.headers = {}
    const res = {
      writeHead(code) {},
      end(chunk) { resolve(JSON.parse(chunk)) },
    }
    handler(req, res).catch(reject)
    req.emit('end')
  })
  assert.equal(resFreshGet.config.thresholds.CNY.warning, 20)
  assert.equal(resFreshGet.config.thresholds.CNY.danger, 5, 'Initial apply deep merge must retain danger: 5')
  console.log('Initial apply thresholds deep merge passed (Bug 3 init verified)')

  // 10. 验证 /query-balance/test-connection 路由注册
  assert.ok(routes.has('/query-balance/test-connection'), 'test-connection route should be registered')

  console.log('ALL CONFIG API TESTS PASSED')
  process.exit(0)
}

runTests().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})

