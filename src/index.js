/**
 * dsh-balance — server half.
 *
 * 1. 余额服务: 按 `refreshIntervalMs` 从 DeepSeek `/user/balance` 拉取余额并缓存,
 *    通过 HTTP 路由 `/query-balance` 提供给浏览器(浏览器只读缓存, 不打 DeepSeek)。
 *    密钥优先取配置 `apiKey`, 否则经 `ctx.credentials` 解析 `apiKeyRef`
 *    (默认 `DEEPSEEK_API_KEY`, 即 $DSH_HOME/.credentials.yaml 或进程环境)。
 * 2. 会话花费投影: 注册 `sessionProjections` 单元 `queryBalanceCost`, 在已提交的
 *    会话事件上按模型折叠 token 用量, 用配置中的单价估算本会话消耗。
 *
 * 投影折叠规则与 dsh-token-meter 的 tokenUsage 一致(同 (turn,step) 的样本替换
 * 而非重复计数); 模型取自 `request/header` / `request/context`(last-wins)。
 */
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'

export const name = 'dsh-balance'

/** 每个模型每 100 万 token 的价格(以 `currency` 计价)。 */
const ModelPrice = Schema.object({
  /** 缓存命中输入价 */
  cacheHit: Schema.number().min(0).default(0.2),
  /** 缓存未命中输入价(含缓存写入) */
  cacheMiss: Schema.number().min(0).default(2),
  /** 输出价 */
  output: Schema.number().min(0).default(8),
})

export const Config = Schema.object({
  /** 显式 API 密钥; 留空则走 apiKeyRef(credentials / 环境变量) */
  apiKey: Schema.string().default(''),
  /** credentials / 环境变量引用名 */
  apiKeyRef: Schema.string().default('DEEPSEEK_API_KEY'),
  /** DeepSeek API 基址 */
  baseUrl: Schema.string().default('https://api.deepseek.com'),
  /** 服务器向 DeepSeek 查询余额的频率(单位: 毫秒 ms) —— 真正的"查询频率" */
  refreshIntervalMs: Schema.number().min(1000).default(300000),
  /** 浏览器刷新显示读取缓存的频率(单位: 毫秒 ms) */
  clientPollIntervalMs: Schema.number().min(5000).default(30000),
  /** 单次请求超时时间(单位: 毫秒 ms) */
  timeoutMs: Schema.number().min(1000).default(8000),
  /** 花费估算的计价货币(与 prices 一致) */
  currency: Schema.string().default('CNY'),
  prices: Schema.dict(ModelPrice).default({
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
  }),
  /** 余额预警阈值(低于此值显示黄色状态) */
  warningThreshold: Schema.number().min(0).default(10),
  /** 余额告急阈值(低于此值显示红色状态) */
  dangerThreshold: Schema.number().min(0).default(5),
  /** 未列出的模型的回退单价 */
  defaultPrices: ModelPrice.default({ cacheHit: 0.1, cacheMiss: 1, output: 2 }),
})

/** 实时计算指定模型在指定时间戳下的单价(内置 DeepSeek V4 8月17日谷峰费率自动切换规则) */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const isV4Flash = model === 'deepseek-v4-flash'
  const isV4Pro = model === 'deepseek-v4-pro'

  if (!isV4Flash && !isV4Pro) {
    return config.prices?.[model] ?? config.defaultPrices
  }

  // 2026-08-17T00:00:00+08:00 (北京时间 8月17日 00:00)
  const isAfterCutoff = timestamp >= 1786896000000

  if (!isAfterCutoff) {
    if (isV4Flash) return { cacheHit: 0.02, cacheMiss: 1, output: 2 }
    if (isV4Pro) return { cacheHit: 0.025, cacheMiss: 3, output: 6 }
  }

  const d = new Date(timestamp)
  const hourBJT = (d.getUTCHours() + 8) % 24
  const isPeak = (hourBJT >= 9 && hourBJT < 12) || (hourBJT >= 14 && hourBJT < 18)

  if (isPeak) {
    if (isV4Flash) return { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 }
    if (isV4Pro) return { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 }
  } else {
    if (isV4Flash) return { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 }
    if (isV4Pro) return { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
  }
  return config.defaultPrices
}

/** 归一化 DeepSeek 余额响应中的金额字符串。 */
const toAmount = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 归一化 `/user/balance` 响应体。 */
const normalizeBalances = (data) => {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : []
  return infos.map((info) => ({
    currency: typeof info?.currency === 'string' && info.currency !== '' ? info.currency : 'CNY',
    total: toAmount(info?.total_balance),
    granted: toAmount(info?.granted_balance),
    toppedUp: toAmount(info?.topped_up_balance),
  }))
}

/** 构造会话花费投影单元。 */
export const makeCostProjection = (configOrGetter) => {
  const getConfig = () => typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const zero = () => ({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  const bucketsOf = (usage) => ({
    uncachedInputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens,
  })
  const bucketsEqual = (a, b) =>
    a.uncachedInputTokens === b.uncachedInputTokens && a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens && a.outputTokens === b.outputTokens
  const addBuckets = (a, b) => ({
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  })
  const subBuckets = (a, b) => ({
    uncachedInputTokens: a.uncachedInputTokens - b.uncachedInputTokens,
    cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens - b.cacheWriteTokens,
    outputTokens: a.outputTokens - b.outputTokens,
  })
  const priceOf = (model) => resolveModelPrice(getConfig(), model)
  const round6 = (n) => Math.round(n * 1e6) / 1e6

  return {
    key: 'queryBalanceCost',
    schema: z.object({
      models: z.array(z.string()),
      cost: z.number().nonnegative(),
      costByModel: z.record(z.string(), z.number().nonnegative()),
      tokens: z.object({
        uncachedInput: z.number().int().nonnegative(),
        cacheRead: z.number().int().nonnegative(),
        cacheWrite: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
      }).strict(),
      currency: z.string(),
    }).strict(),
    init: () => ({ currentModel: null, last: null, byModel: {}, modelOrder: [] }),
    apply: (state, event) => {
      let nextModel = state.currentModel
      if (event.type === 'request/header') {
        const model = event.data.header?.config?.model
        if (typeof model === 'string' && model !== '') nextModel = model
      } else if (event.type === 'request/context') {
        const model = event.data.model
        if (typeof model === 'string' && model !== '') nextModel = model
      }
      let usage = null
      let turn = 0
      let step = 0
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
        ({ turn, step } = event.data)
        usage = event.data.chunk.usage
      } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
        ({ turn, step, usage } = event.data)
      }
      if (usage === null) {
        // 与单元无关的事件: 返回同一引用(驱动以 Object.is 把关变更流)。
        return nextModel === state.currentModel ? state : { ...state, currentModel: nextModel }
      }
      const model = nextModel ?? 'unknown'
      const buckets = bucketsOf(usage)
      const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null
      if (previous !== null && previous.model === model && bucketsEqual(previous.buckets, buckets)) {
        return nextModel === state.currentModel ? state : { ...state, currentModel: nextModel }
      }
      const isNewModel = !(model in state.byModel)
      let byModel = state.byModel
      if (previous !== null) {
        // 同一步骤的替换样本: 先减去旧归属, 再加新归属。
        byModel = { ...byModel, [previous.model]: subBuckets(byModel[previous.model] ?? zero(), previous.buckets) }
      }
      byModel = { ...byModel, [model]: addBuckets(byModel[model] ?? zero(), buckets) }
      return {
        ...state,
        currentModel: nextModel,
        last: { turn, step, model, buckets },
        byModel,
        modelOrder: isNewModel ? [...state.modelOrder, model] : state.modelOrder,
      }
    },
    view: (state) => {
      const cfg = getConfig()
      const tokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
      const costByModel = {}
      let cost = 0
      for (const model of state.modelOrder) {
        const b = state.byModel[model] ?? zero()
        tokens.uncachedInput += b.uncachedInputTokens
        tokens.cacheRead += b.cacheReadTokens
        tokens.cacheWrite += b.cacheWriteTokens
        tokens.output += b.outputTokens
        // DeepSeek 计费: 未命中输入(含缓存写入)按 miss 价, 命中按 hit 价, 输出按 output 价。
        // 配置价是"每 1M token"的价格, 因此除以 1e6。
        const c = ((b.uncachedInputTokens + b.cacheWriteTokens) * priceOf(model).cacheMiss +
          b.cacheReadTokens * priceOf(model).cacheHit +
          b.outputTokens * priceOf(model).output) / 1e6
        if (c > 0) costByModel[model] = round6(c)
        cost += c
      }
      return {
        models: state.modelOrder,
        cost: round6(cost),
        costByModel,
        tokens,
        currency: cfg.currency,
      }
    },
    stateVersion: 1,
  }
}

/** 读取 HTTP POST JSON Body */
const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 1e6) {
      req.destroy()
      reject(new Error('Payload too large'))
    }
  })
  req.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {})
    } catch {
      reject(new Error('Invalid JSON'))
    }
  })
  req.on('error', reject)
})

export function apply(ctx, config) {
  // 运行时可变配置（优先使用用户在设置面板中动态修改的值）
  let runtimeConfig = {
    apiKey: config.apiKey ?? '',
    apiKeyRef: config.apiKeyRef ?? 'DEEPSEEK_API_KEY',
    baseUrl: config.baseUrl ?? 'https://api.deepseek.com',
    refreshIntervalMs: config.refreshIntervalMs ?? 300000,
    clientPollIntervalMs: config.clientPollIntervalMs ?? 30000,
    timeoutMs: config.timeoutMs ?? 8000,
    currency: config.currency ?? 'CNY',
    warningThreshold: config.warningThreshold ?? 10,
    dangerThreshold: config.dangerThreshold ?? 5,
    prices: { ...(config.prices ?? {}) },
    defaultPrices: { ...(config.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 }) },
  }

  const getConfig = () => runtimeConfig

  /** 解析本次刷新使用的密钥(每次操作重新解析, 遵循 credentials seam)。 */
  const resolveKey = async (overrideKey = null) => {
    if (typeof overrideKey === 'string' && overrideKey !== '') return overrideKey
    if (runtimeConfig.apiKey !== '') return runtimeConfig.apiKey
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(runtimeConfig.apiKeyRef)
        if (hit !== undefined) return hit.value
      } catch {
        /* 解析失败视为未配置 */
      }
    }
    return process.env[runtimeConfig.apiKeyRef] ?? ''
  }

  let cache = { state: 'empty', payload: null, error: null, fetchedAt: 0, lastErrorAt: 0 }
  let inflight = null
  let consecutiveFailures = 0

  const refresh = () => {
    if (inflight !== null) return inflight
    inflight = (async () => {
      const key = await resolveKey()
      if (key === '') {
        cache = { state: 'error', payload: null, error: 'api-key-missing', fetchedAt: 0, lastErrorAt: Date.now() }
        consecutiveFailures++
        return
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), runtimeConfig.timeoutMs)
      try {
        const res = await fetch(`${runtimeConfig.baseUrl.replace(/\/+$/, '')}/user/balance`, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`DeepSeek API HTTP ${res.status}`)
        const data = await res.json()
        cache = {
          state: 'ok',
          payload: {
            isAvailable: data?.is_available === true,
            balances: normalizeBalances(data),
          },
          error: null,
          fetchedAt: Date.now(),
          lastErrorAt: 0,
        }
        consecutiveFailures = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        consecutiveFailures++
        if (consecutiveFailures === 1) ctx.logger.warn(`[dsh-balance] balance fetch failed: ${message}`)
        // 保留上次成功值(stale-while-error), 仅标记错误。
        cache = {
          state: cache.state === 'ok' ? 'ok' : 'error',
          payload: cache.payload,
          error: message,
          fetchedAt: cache.fetchedAt,
          lastErrorAt: Date.now(),
        }
      } finally {
        clearTimeout(timer)
      }
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  let loopTimer = null
  const resetLoop = () => {
    if (loopTimer !== null) {
      clearTimeout(loopTimer)
      loopTimer = null
    }
    const run = () => {
      void refresh().then(() => {
        const missingKey = cache.state === 'error' && cache.error === 'api-key-missing'
        const delay = missingKey ? 5000 : runtimeConfig.refreshIntervalMs
        loopTimer = setTimeout(run, delay)
      })
    }
    loopTimer = setTimeout(run, 1000)
  }

  ctx.effect(() => {
    resetLoop()
    return () => {
      if (loopTimer !== null) clearTimeout(loopTimer)
    }
  }, 'dsh-balance: refresh loop')

  const maskKey = (k) => {
    if (!k || typeof k !== 'string') return ''
    if (k.length <= 8) return '********'
    return k.slice(0, 4) + '****' + k.slice(-4)
  }

  const getSanitizedConfig = () => {
    return {
      hasCustomKey: Boolean(runtimeConfig.apiKey),
      apiKeyMasked: maskKey(runtimeConfig.apiKey),
      apiKeyRef: runtimeConfig.apiKeyRef,
      baseUrl: runtimeConfig.baseUrl,
      refreshIntervalMs: runtimeConfig.refreshIntervalMs,
      clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
      timeoutMs: runtimeConfig.timeoutMs,
      currency: runtimeConfig.currency,
      warningThreshold: runtimeConfig.warningThreshold,
      dangerThreshold: runtimeConfig.dangerThreshold,
      prices: { ...runtimeConfig.prices },
      defaultPrices: { ...runtimeConfig.defaultPrices },
    }
  }

  // 可选 webServer: 提供浏览器读取的缓存端点与设置端点
  ctx.inject(['webServer'], (webCtx) => {
    const serialize = () => {
      const base = {
        ok: cache.state === 'ok',
        fetchedAt: cache.fetchedAt,
        refreshIntervalMs: runtimeConfig.refreshIntervalMs,
        clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
        currency: runtimeConfig.currency,
        thresholds: {
          warning: runtimeConfig.warningThreshold,
          danger: runtimeConfig.dangerThreshold,
        },
        // 定价表随响应动态下发 (内置 8月17日谷峰费率自动切换规则), 供客户端 "?" 图标展示
        prices: {
          ...runtimeConfig.prices,
          'deepseek-v4-flash': resolveModelPrice(runtimeConfig, 'deepseek-v4-flash'),
          'deepseek-v4-pro': resolveModelPrice(runtimeConfig, 'deepseek-v4-pro'),
        },
        defaultPrices: runtimeConfig.defaultPrices,
      }
      if (cache.state === 'ok') {
        return {
          ...base,
          isAvailable: cache.payload.isAvailable,
          balances: cache.payload.balances,
          ...(cache.error !== null ? { error: cache.error, stale: true } : {}),
        }
      }
      return { ...base, error: cache.error ?? 'unknown' }
    }

    const sendJson = (res, statusCode, data) => {
      const body = JSON.stringify(data)
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
    }

    // 1. 余额查询缓存路由
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-balance',
      async handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
          res.writeHead(405, { Allow: 'GET, HEAD, POST' })
          res.end()
          return
        }
        const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
        const force = parsedUrl.searchParams.get('force') === '1' || parsedUrl.searchParams.get('force') === 'true' || req.method === 'POST'
        if (force) {
          // 冷却防刷保护: 距离上次主动拉取至少间隔 2000ms
          const now = Date.now()
          if (now - cache.fetchedAt > 2000 || cache.state !== 'ok') {
            await refresh()
          }
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end()
          return
        }
        sendJson(res, 200, serialize())
      },
    }), 'dsh-balance: route')

    // 2. 可视化配置读写路由 (/query-balance/config)
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-balance/config',
      async handler(req, res) {
        if (req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            config: getSanitizedConfig(),
          })
          return
        }
        if (req.method === 'POST') {
          try {
            const body = await readJsonBody(req)
            // 局部合并与类型校验
            if (typeof body.apiKey === 'string') runtimeConfig.apiKey = body.apiKey.trim()
            if (typeof body.apiKeyRef === 'string' && body.apiKeyRef.trim()) runtimeConfig.apiKeyRef = body.apiKeyRef.trim()
            if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) runtimeConfig.baseUrl = body.baseUrl.trim()
            if (typeof body.warningThreshold === 'number' && body.warningThreshold >= 0) runtimeConfig.warningThreshold = body.warningThreshold
            if (typeof body.dangerThreshold === 'number' && body.dangerThreshold >= 0) runtimeConfig.dangerThreshold = body.dangerThreshold
            if (typeof body.refreshIntervalMs === 'number' && body.refreshIntervalMs >= 1000) runtimeConfig.refreshIntervalMs = body.refreshIntervalMs
            if (typeof body.clientPollIntervalMs === 'number' && body.clientPollIntervalMs >= 1000) runtimeConfig.clientPollIntervalMs = body.clientPollIntervalMs
            if (typeof body.timeoutMs === 'number' && body.timeoutMs >= 1000) runtimeConfig.timeoutMs = body.timeoutMs
            if (typeof body.currency === 'string' && body.currency.trim()) runtimeConfig.currency = body.currency.trim().toUpperCase()
            if (body.prices && typeof body.prices === 'object') {
              runtimeConfig.prices = { ...body.prices }
            }
            if (body.defaultPrices && typeof body.defaultPrices === 'object') {
              runtimeConfig.defaultPrices = { ...runtimeConfig.defaultPrices, ...body.defaultPrices }
            }

            // 配置变更后重设刷新循环并立即拉取一次最新数据
            resetLoop()
            await refresh()

            sendJson(res, 200, {
              ok: true,
              message: 'Config updated successfully',
              config: getSanitizedConfig(),
            })
          } catch (err) {
            sendJson(res, 400, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
          return
        }
        res.writeHead(405, { Allow: 'GET, POST' })
        res.end()
      },
    }), 'dsh-balance: config route')

    // 3. API 连通性测试路由 (/query-balance/test-connection)
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-balance/test-connection',
      async handler(req, res) {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' })
          res.end()
          return
        }
        try {
          const body = await readJsonBody(req)
          const targetUrl = (typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : runtimeConfig.baseUrl).replace(/\/+$/, '')
          const key = await resolveKey(typeof body.apiKey === 'string' && body.apiKey ? body.apiKey.trim() : null)
          if (!key) {
            sendJson(res, 400, { ok: false, error: 'api-key-missing' })
            return
          }
          const timeout = typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? body.timeoutMs : runtimeConfig.timeoutMs
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeout)
          try {
            const apiRes = await fetch(`${targetUrl}/user/balance`, {
              headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
              signal: controller.signal,
            })
            if (!apiRes.ok) {
              sendJson(res, 200, { ok: false, error: `DeepSeek API HTTP ${apiRes.status}` })
              return
            }
            const data = await apiRes.json()
            sendJson(res, 200, {
              ok: true,
              isAvailable: data?.is_available === true,
              balances: normalizeBalances(data),
            })
          } finally {
            clearTimeout(timer)
          }
        } catch (err) {
          sendJson(res, 200, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    }), 'dsh-balance: test connection route')
  })

  // 可选 sessionProjections: 会话花费投影 (使用动态 getter)
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(makeCostProjection(getConfig))
  })
}

