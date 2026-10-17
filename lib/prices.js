/**
 * dsh-usage-panel — 价目表与成本计算
 *
 * 两套**官方**标价，不互相换算（美元档是取整过的，乘汇率会算错）：
 *
 *   人民币（默认，中文文档）https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 *     deepseek-flash     缓存命中 空闲 ¥0.02 / 高峰 ¥0.04
 *                        缓存未命中 空闲 ¥1  / 高峰 ¥2
 *                        输出       空闲 ¥4  / 高峰 ¥8
 *     deepseek-v4-pro    缓存命中 空闲 ¥0.15 / 高峰 ¥0.30
 *                        缓存未命中 空闲 ¥4.5 / 高峰 ¥9.0
 *                        输出       空闲 ¥13.5 / 高峰 ¥27.0
 *
 *   美元（可选，英文文档）https://api-docs.deepseek.com/quick_start/pricing/
 *     deepseek-flash     $0.003 / $0.006 · $0.15 / $0.30 · $0.6 / $1.2
 *     deepseek-v4-pro    $0.022 / $0.044 · $0.66 / $1.32 · $1.98 / $3.96
 *
 * 共同口径（两页一致）：
 *   · 单价单位「每 1M tokens」。
 *   · 只有三档价：输入（缓存命中）/ 输入（缓存未命中）/ 输出。
 *     **没有单独的「缓存写入」价** → cacheWriteTokens 不计价（DSH 里它一直是 0）。
 *   · 高峰 = 空闲的 2 倍。高峰时段按**北京时间**：周一至周五（不含中国法定节假日）
 *     9:00–12:00、14:00–18:00 → 即 UTC 01:00–04:00、06:00–10:00。
 *     其余（含周末与法定节假日全天）为空闲时段。
 *   · `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 是遗留名，官方明示
 *     「按 Flash 价格计费」→ 作为别名。
 *
 * 设计原则：
 *   · 覆盖文件 $DSH_HOME/usage-panel/prices.json 可切换 currency、校正价格、补节假日。
 *   · 匹配不到价格的模型：token 照记，成本**排除**，并在 UI 显式声明（绝不静默当 0）。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-flash-vision-exp': 'deepseek-flash',
  'deepseek-v4-pro-0813': 'deepseek-v4-pro'
}

/** 高峰窗口（UTC）。对应北京时间 09:00–12:00 / 14:00–18:00，工作日。 */
const PEAK = {
  multiplier: 2,
  windows: [
    { weekdays: [1, 2, 3, 4, 5], startHourUtc: 1, endHourUtc: 4 },
    { weekdays: [1, 2, 3, 4, 5], startHourUtc: 6, endHourUtc: 10 }
  ],
  label: '北京时间 09:00–12:00、14:00–18:00（周一至周五，不含中国法定节假日）'
}

export const PRICE_TABLES = {
  CNY: {
    code: 'CNY',
    symbol: '¥',
    label: '人民币',
    asOf: '2026-10-15',
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    unit: 'per 1M tokens',
    models: {
      'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
    },
    aliases: ALIASES,
    peak: PEAK,
    /** 中国法定节假日（UTC 日期 YYYY-MM-DD）：这些日子全天空闲。留空 = 不做节假日判断。 */
    holidaysUtc: []
  },
  USD: {
    code: 'USD',
    symbol: '$',
    label: '美元',
    asOf: '2026-10-15',
    source: 'https://api-docs.deepseek.com/quick_start/pricing/',
    unit: 'per 1M tokens',
    models: {
      'deepseek-flash': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
      'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 }
    },
    aliases: ALIASES,
    peak: PEAK,
    holidaysUtc: []
  }
}

export const DEFAULT_CURRENCY = 'CNY'

/** 兼容旧引用 */
export const DEFAULT_PRICES = PRICE_TABLES[DEFAULT_CURRENCY]

/* ------------------------------------------------------------------ *
 * 载入（默认表 + 用户覆盖）
 * ------------------------------------------------------------------ */

let cached = null
let cachedHome = null

export async function loadPrices(dshHome) {
  if (cached && cachedHome === dshHome) return cached
  let override = null
  if (dshHome) {
    try {
      override = JSON.parse(await readFile(join(dshHome, 'usage-panel', 'prices.json'), 'utf8'))
    } catch {
      /* 没有覆盖文件或它坏了 → 用默认表 */
    }
  }
  const code = String(override?.currency ?? DEFAULT_CURRENCY).toUpperCase()
  const base = PRICE_TABLES[code] ?? PRICE_TABLES[DEFAULT_CURRENCY]
  const table = {
    ...base,
    ...(override ?? {}),
    code: base.code,
    symbol: override?.symbol ?? base.symbol,
    label: override?.label ?? base.label,
    models: { ...base.models, ...(override?.models ?? {}) },
    aliases: { ...base.aliases, ...(override?.aliases ?? {}) },
    peak: { ...base.peak, ...(override?.peak ?? {}) },
    holidaysUtc: override?.holidaysUtc ?? base.holidaysUtc,
    overridden: !!override
  }
  cached = table
  cachedHome = dshHome
  return table
}

/** 让测试/长时间运行能重新载入 */
export function resetPriceCache() {
  cached = null
  cachedHome = null
}

/* ------------------------------------------------------------------ *
 * 模型名解析
 * ------------------------------------------------------------------ */

/**
 * 把 `deepseek-account/deepseek-flash` 之类的写法归一化到价目表键。
 * 顺序：去 provider 前缀 → 精确 → 别名 → 去版本后缀 → 未匹配(null)。
 */
export function resolveModel(rawName, table = DEFAULT_PRICES) {
  if (!rawName || typeof rawName !== 'string') return null
  let name = rawName.trim().toLowerCase()
  if (name.includes('/')) name = name.slice(name.lastIndexOf('/') + 1)
  if (table.models[name]) return name
  if (table.aliases[name] && table.models[table.aliases[name]]) return table.aliases[name]
  const stripped = name.replace(/[-_.](?:\d{4,8}|\d{2}-\d{2})$/, '')
  if (stripped !== name) {
    if (table.models[stripped]) return stripped
    if (table.aliases[stripped] && table.models[table.aliases[stripped]]) return table.aliases[stripped]
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 峰谷判断
 * ------------------------------------------------------------------ */

const utcDayKey = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function isPeak(ms, table = DEFAULT_PRICES) {
  if (table.holidaysUtc?.includes(utcDayKey(ms))) return false
  const d = new Date(ms)
  const weekday = d.getUTCDay()
  const hour = d.getUTCHours()
  for (const w of table.peak.windows ?? []) {
    if (!w.weekdays.includes(weekday)) continue
    if (hour >= w.startHourUtc && hour < w.endHourUtc) return true
  }
  return false
}

/* ------------------------------------------------------------------ *
 * 单笔成本
 * ------------------------------------------------------------------ */

/**
 * 计算一笔请求的成本（**以当前价目表的货币计价**）。
 * @returns {{cost:number, matched:boolean, model:string|null, peak:boolean}}
 */
export function costOfRequest(usage, atMs, rawModel, table = DEFAULT_PRICES) {
  const model = resolveModel(rawModel, table)
  if (!model) return { cost: 0, matched: false, model: null, peak: false, reason: 'unknown-model' }
  const price = table.models[model]
  const peak = Number.isFinite(atMs) ? isPeak(atMs, table) : false
  const mult = peak ? table.peak.multiplier ?? 2 : 1
  const perM = 1e6
  const cost =
    ((usage.uncachedInput ?? 0) * price.cacheMiss * mult +
      (usage.cacheRead ?? 0) * price.cacheHit * mult +
      (usage.output ?? 0) * price.output * mult) / perM
  return { cost, matched: true, model, peak }
}

/** 缓存读替代缓存未命中所省下的钱（同货币、含峰谷） */
export function cacheSavedOfRequest(usage, atMs, rawModel, table = DEFAULT_PRICES) {
  const model = resolveModel(rawModel, table)
  if (!model) return 0
  const price = table.models[model]
  const mult = Number.isFinite(atMs) && isPeak(atMs, table) ? table.peak.multiplier ?? 2 : 1
  return ((usage.cacheRead ?? 0) * (price.cacheMiss - price.cacheHit) * mult) / 1e6
}

/** 价目表摘要，供 UI 标注「价格截至 / 币种 / 高峰时段」 */
export function priceSummary(table = DEFAULT_PRICES) {
  return {
    currency: table.code,
    symbol: table.symbol,
    currencyLabel: table.label,
    asOf: table.asOf,
    source: table.source,
    unit: table.unit,
    models: Object.keys(table.models),
    overridden: !!table.overridden,
    peakMultiplier: table.peak?.multiplier ?? 1,
    peakLabel: table.peak?.label ?? '',
    peakWindows: (table.peak?.windows ?? []).map((w) => ({
      weekdays: w.weekdays,
      startHourUtc: w.startHourUtc,
      endHourUtc: w.endHourUtc
    })),
    holidayCount: table.holidaysUtc?.length ?? 0,
    /** 每个模型的单价，便于 UI 直接展示 */
    rates: table.models
  }
}
