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

export const name = 'dsh-balance-lite'

/** 每个模型每 100 万 token 的价格(以 `currency` 计价)。 */
const ModelPrice = Schema.object({
  /** 缓存命中输入价 */
  cacheHit: Schema.number().min(0).default(0.2),
  /** 缓存未命中输入价(含缓存写入) */
  cacheMiss: Schema.number().min(0).default(2),
  /** 输出价 */
  output: Schema.number().min(0).default(8),
})

/** 货币阈值配置 Schema */
const ThresholdConfig = Schema.object({
  warning: Schema.number().min(0).default(10),
  danger: Schema.number().min(0).default(5),
})

/**
 * 默认多币种阈值基准 (以人民币 CNY 为基准, 按今日汇率 1 USD ≈ 7.15 CNY 换算固定):
 * - CNY: 预警 10 元, 告急 5 元
 * - USD: 预警 $1.40, 告急 $0.70
 */
export const DEFAULT_THRESHOLDS_BY_CURRENCY = {
  CNY: { warning: 10, danger: 5 },
  USD: { warning: 1.4, danger: 0.7 },
}

/**
 * 获取指定货币下的预警与告急阈值。
 */
export const resolveThresholds = (config, currency = config?.currency) => {
  const cur = (currency || 'CNY').toUpperCase()
  const defaults = DEFAULT_THRESHOLDS_BY_CURRENCY[cur] ?? DEFAULT_THRESHOLDS_BY_CURRENCY.CNY
  const custom = config?.thresholds?.[cur]
  const warning = typeof custom?.warning === 'number' ? custom.warning : defaults.warning
  const danger = typeof custom?.danger === 'number' ? custom.danger : defaults.danger
  return { warning, danger }
}

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
  prices: Schema.dict(ModelPrice).default({}),
  /** 谷时模型单价表(用户自定义，留空则使用官方最新标准单价) */
  pricesOffPeak: Schema.dict(ModelPrice).default({}),
  /** 多币种独立阈值配置表 (CNY, USD 等) */
  thresholds: Schema.dict(ThresholdConfig).default({}),
  /** 未列出的模型的回退单价 */
  defaultPrices: ModelPrice.default({ cacheHit: 0.1, cacheMiss: 1, output: 2 }),
})

/** Flash 系列调价正式生效时刻: 北京时间 2026-09-10 12:00:00 (UTC 2026-09-10T04:00:00Z) */
export const FLASH_20260910_EFFECTIVE_TIMESTAMP = Date.UTC(2026, 8, 10, 4, 0, 0)

/** 2026-08-16 至 2026-09-10 12:00 期间的历史 Flash 费率 (用于账单与会话历史回溯兼容) */
export const V4_RATES_HISTORIC_202608 = {
  CNY: {
    peak: {
      'deepseek-v4-flash': { cacheHit: 0.1, cacheMiss: 3, output: 9 },
      'deepseek-v4-flash-vision-exp': { cacheHit: 0.1, cacheMiss: 3, output: 9 },
      'deepseek-v4.1-flash': { cacheHit: 0.1, cacheMiss: 3, output: 9 },
      'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    },
    offPeak: {
      'deepseek-v4-flash': { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
      'deepseek-v4-flash-vision-exp': { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
      'deepseek-v4.1-flash': { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
      'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
    },
  },
  USD: {
    peak: {
      'deepseek-v4-flash': { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
      'deepseek-v4-flash-vision-exp': { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
      'deepseek-v4.1-flash': { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
      'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    },
    offPeak: {
      'deepseek-v4-flash': { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
      'deepseek-v4-flash-vision-exp': { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
      'deepseek-v4.1-flash': { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
      'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
    },
  },
}

/** DeepSeek V4 官方现行定价表 (自北京时间 2026-09-10 12:00:00 起生效，单位: 每 100 万 tokens, 支持 CNY 与 USD 谷峰费率) */
export const V4_RATES = {
  CNY: {
    peak: {
      'deepseek-v4-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
      'deepseek-v4-flash-vision-exp': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
      'deepseek-v4.1-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
      'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    },
    offPeak: {
      'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      'deepseek-v4-flash-vision-exp': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      'deepseek-v4.1-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
    },
  },
  USD: {
    peak: {
      'deepseek-v4-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
      'deepseek-v4-flash-vision-exp': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
      'deepseek-v4.1-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
      'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    },
    offPeak: {
      'deepseek-v4-flash': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
      'deepseek-v4-flash-vision-exp': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
      'deepseek-v4.1-flash': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
      'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
    },
  },
}

/** 判定模型是否属于 DeepSeek Flash 系列 (含 flash-vision-exp、v4.1-flash) */
export const isFlashSeriesModel = (model) => {
  if (typeof model !== 'string') return false
  return (
    model === 'deepseek-v4-flash' ||
    model === 'deepseek-v4-flash-vision-exp' ||
    model === 'deepseek-v4.1-flash'
  )
}

/**
 * 判定指定时间戳是否处于 DeepSeek 计费高峰时段。
 * 高峰时段: 北京时间 (UTC+8) 周一至周五 09:00~12:00, 14:00~18:00。
 * 其余时段 (工作日其他时间及周末全天) 均为谷时特惠 / 空闲时段 (5折)。
 */
export const isPeakTime = (timestamp = Date.now()) => {
  const ts = typeof timestamp === 'number'
    ? timestamp
    : (timestamp instanceof Date ? timestamp.getTime() : Date.now())
  const bjtDate = new Date(ts + 8 * 60 * 60 * 1000)
  const day = bjtDate.getUTCDay()
  const hour = bjtDate.getUTCHours()
  const isWeekday = day >= 1 && day <= 5
  if (!isWeekday) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/**
 * 实时计算指定模型在指定时间戳下的单价。
 * 优先级:
 * 1. 峰时优先匹配 config.prices[model]，谷时优先匹配 config.pricesOffPeak[model]；
 * 2. 若为内置 DeepSeek V4 模型 (flash / flash-vision-exp / pro)，按货币 (CNY/USD) 和北京时间谷峰费率自动计算 (支持 2026-09-10 12:00 分水岭历史回溯)；
 * 3. 其余未知名模型回退到 config.defaultPrices。
 */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const ts = typeof timestamp === 'number'
    ? timestamp
    : (timestamp instanceof Date ? timestamp.getTime() : Date.now())
  const isPeak = isPeakTime(ts)

  if (isPeak) {
    if (config?.prices && Object.prototype.hasOwnProperty.call(config.prices, model) && config.prices[model]) {
      return config.prices[model]
    }
  } else {
    if (config?.pricesOffPeak && Object.prototype.hasOwnProperty.call(config.pricesOffPeak, model) && config.pricesOffPeak[model]) {
      return config.pricesOffPeak[model]
    }
    if (config?.prices && Object.prototype.hasOwnProperty.call(config.prices, model) && config.prices[model]) {
      return config.prices[model]
    }
  }

  const isFlash = isFlashSeriesModel(model)
  const isPro = model === 'deepseek-v4-pro'

  if (!isFlash && !isPro) {
    return config?.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 }
  }

  // 2. 根据计价货币选择对应币种的定价表 (支持 CNY / USD)
  const currency = typeof config?.currency === 'string' && config.currency.toUpperCase() === 'USD' ? 'USD' : 'CNY'
  const isHistoricFlash = isFlash && ts < FLASH_20260910_EFFECTIVE_TIMESTAMP
  const table = (isHistoricFlash ? V4_RATES_HISTORIC_202608 : V4_RATES)[currency] ?? V4_RATES.CNY
  const modelKey = table.peak[model] ? model : 'deepseek-v4-flash'

  return (isPeak ? table.peak[modelKey] : table.offPeak[modelKey]) ?? config?.defaultPrices
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

  const stateSchema = z.object({
    currentModel: z.string().nullable(),
    last: z.object({
      turn: z.number().int(),
      step: z.number().int(),
      model: z.string(),
      buckets: z.object({
        uncachedInputTokens: z.number().int(),
        cacheReadTokens: z.number().int(),
        cacheWriteTokens: z.number().int(),
        outputTokens: z.number().int(),
      }),
    }).nullable(),
    byModel: z.record(z.string(), z.object({
      uncachedInputTokens: z.number().int(),
      cacheReadTokens: z.number().int(),
      cacheWriteTokens: z.number().int(),
      outputTokens: z.number().int(),
    })),
    modelOrder: z.array(z.string()),
  })

  const viewSchema = z.object({
    models: z.array(z.string()),
    cost: z.number().nonnegative(),
    costByModel: z.record(z.string(), z.number().nonnegative()),
    tokens: z.object({
      uncachedInput: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    }).strict(),
    tokensByModel: z.record(z.string(), z.object({
      uncachedInputTokens: z.number().int().nonnegative(),
      cacheReadTokens: z.number().int().nonnegative(),
      cacheWriteTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }).strict()).optional(),
    currency: z.string(),
  }).strict()

  const view = (state) => {
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
      tokensByModel: state.byModel,
      currency: cfg.currency,
    }
  }

  const apply = (state, event) => {
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
  }

  return {
    key: 'queryBalanceCost',
    stateSchema,
    init: () => ({ currentModel: null, last: null, byModel: {}, modelOrder: [] }),
    apply,
    wire: {
      viewSchema,
      view,
    },
    // 向后兼容内部测试与旧调用
    view,
    schema: viewSchema,
    stateVersion: 1,
  }
}

export function apply(ctx, config) {
  const initialCurrency = (config.currency ?? 'CNY').toUpperCase()
  // 运行时不可变配置快照
  const snapshot = {
    apiKey: config.apiKey ?? '',
    apiKeyRef: config.apiKeyRef ?? 'DEEPSEEK_API_KEY',
    baseUrl: config.baseUrl ?? 'https://api.deepseek.com',
    refreshIntervalMs: config.refreshIntervalMs ?? 300000,
    clientPollIntervalMs: config.clientPollIntervalMs ?? 30000,
    timeoutMs: config.timeoutMs ?? 8000,
    currency: initialCurrency,
    thresholds: {
      CNY: {
        warning: typeof config.thresholds?.CNY?.warning === 'number'
          ? config.thresholds.CNY.warning
          : DEFAULT_THRESHOLDS_BY_CURRENCY.CNY.warning,
        danger: typeof config.thresholds?.CNY?.danger === 'number'
          ? config.thresholds.CNY.danger
          : DEFAULT_THRESHOLDS_BY_CURRENCY.CNY.danger,
      },
      USD: {
        warning: typeof config.thresholds?.USD?.warning === 'number'
          ? config.thresholds.USD.warning
          : DEFAULT_THRESHOLDS_BY_CURRENCY.USD.warning,
        danger: typeof config.thresholds?.USD?.danger === 'number'
          ? config.thresholds.USD.danger
          : DEFAULT_THRESHOLDS_BY_CURRENCY.USD.danger,
      },
      ...(config.thresholds ?? {}),
    },
    prices: { ...(config.prices ?? {}) },
    pricesOffPeak: { ...(config.pricesOffPeak ?? {}) },
    defaultPrices: { ...(config.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 }) },
  }

  const getConfig = () => snapshot

  /** 解析本次刷新使用的密钥(每次操作重新解析, 遵循 credentials seam)。 */
  const resolveKey = async (overrideKey = null) => {
    if (typeof overrideKey === 'string' && overrideKey !== '') return overrideKey
    if (snapshot.apiKey !== '') return snapshot.apiKey
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(snapshot.apiKeyRef)
        if (hit !== undefined) return hit.value
      } catch {
        /* 解析失败视为未配置 */
      }
    }
    return process.env[snapshot.apiKeyRef] ?? ''
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
      const timer = setTimeout(() => controller.abort(), snapshot.timeoutMs)
      try {
        const res = await fetch(`${snapshot.baseUrl.replace(/\/+$/, '')}/user/balance`, {
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
    let loopTimer = null
    const run = () => {
      void refresh().then(() => {
        const missingKey = cache.state === 'error' && cache.error === 'api-key-missing'
        const delay = missingKey ? 5000 : snapshot.refreshIntervalMs
        loopTimer = setTimeout(run, delay)
      })
    }
    loopTimer = setTimeout(run, 1000)

    return () => {
      if (loopTimer !== null) clearTimeout(loopTimer)
    }
  }, 'dsh-balance: refresh loop')

  // 可选 webServer: 提供浏览器读取的缓存端点
  ctx.inject(['webServer'], (webCtx) => {
    const serialize = () => {
      const isPeak = isPeakTime()

      const activeThresholds = resolveThresholds(snapshot, snapshot.currency)

      const base = {
        ok: cache.state === 'ok',
        fetchedAt: cache.fetchedAt,
        refreshIntervalMs: snapshot.refreshIntervalMs,
        clientPollIntervalMs: snapshot.clientPollIntervalMs,
        currency: snapshot.currency,
        isPeak,
        thresholds: activeThresholds,
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
  })

  // 可选 sessionProjections: 会话花费投影 (使用动态 getter)
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(makeCostProjection(getConfig))
  })
}
