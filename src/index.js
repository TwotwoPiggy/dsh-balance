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
  /** 服务器向 DeepSeek 查询余额的频率(毫秒) —— 真正的"查询频率" */
  refreshIntervalMs: Schema.number().min(1000).default(300000),
  /** 浏览器刷新显示读取缓存的频率(毫秒) */
  clientPollIntervalMs: Schema.number().min(5000).default(30000),
  /** 单次请求超时(毫秒) */
  timeoutMs: Schema.number().min(1000).default(8000),
  /** 花费估算的计价货币(与 prices 一致) */
  currency: Schema.string().default('CNY'),
  prices: Schema.dict(ModelPrice).default({
    'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 },
    'deepseek-reasoner': { cacheHit: 1, cacheMiss: 4, output: 16 },
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 0.1, output: 0.2 },
  }),
  /** 未列出的模型的回退单价 */
  defaultPrices: ModelPrice.default({ cacheHit: 0.1, cacheMiss: 1, output: 2 }),
})

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
export const makeCostProjection = (config) => {
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
  const priceOf = (model) => {
    const isV4Flash = model === 'deepseek-v4-flash'
    const isV4Pro = model === 'deepseek-v4-pro'

    if (!isV4Flash && !isV4Pro) {
      return config.prices[model] ?? config.defaultPrices
    }

    const timestamp = Date.now()
    // 2026-08-17T00:00:00+08:00
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
        currency: config.currency,
      }
    },
    stateVersion: 1,
  }
}

export function apply(ctx, config) {
  /** 解析本次刷新使用的密钥(每次操作重新解析, 遵循 credentials seam)。 */
  const resolveKey = async () => {
    if (config.apiKey !== '') return config.apiKey
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        // CredentialRef 是字符串品牌, 运行时即普通字符串。
        const hit = await credentials.resolve(config.apiKeyRef)
        if (hit !== undefined) return hit.value
      } catch {
        /* 解析失败视为未配置 */
      }
    }
    return process.env[config.apiKeyRef] ?? ''
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
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      try {
        const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/user/balance`, {
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

  ctx.effect(() => {
    // 密钥缺失(credentials 提供方尚未就绪)时快速重试, 否则按配置频率轮询。
    let timer = null
    let run = () => {
      void refresh().then(() => {
        const missingKey = cache.state === 'error' && cache.error === 'api-key-missing'
        const delay = missingKey ? 5000 : config.refreshIntervalMs
        timer = setTimeout(run, delay)
      })
    }
    timer = setTimeout(run, 1000)
    return () => clearTimeout(timer)
  }, 'dsh-balance: refresh loop')

  // 可选 webServer: 提供浏览器读取的缓存端点(headless 组合不受影响)。
  ctx.inject(['webServer'], (webCtx) => {
    const serialize = () => {
      const base = {
        ok: cache.state === 'ok',
        fetchedAt: cache.fetchedAt,
        refreshIntervalMs: config.refreshIntervalMs,
        clientPollIntervalMs: config.clientPollIntervalMs,
        currency: config.currency,
        // 定价表随响应下发, 供客户端 "?" 图标展示
        prices: config.prices,
        defaultPrices: config.defaultPrices,
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
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-balance',
      handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' })
          res.end()
          return
        }
        const body = JSON.stringify(serialize())
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(body),
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    }), 'dsh-balance: route')
  })

  // 可选 sessionProjections: 会话花费投影。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(makeCostProjection(config))
  })
}
