/**
 * dsh-usage-panel — 聚合层
 *
 * 职责：把多个会话记录汇总成前端要的一份数据（总量 / 按天 / 按模型 / 工具 / 会话 / 成本）。
 * 只读；单文件失败只跳过该文件；不抛异常。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { loadPrices,
  priceSummary } from './prices.js'
import {
  PANEL_VERSION,
  LIMITS,
  resolveDshHome,
  logsRoot,
  projRoot,
  localDayKey,
  emptyUsage,
  addUsage,
  zstdAvailable
} from './frames.js'
import {
  parseSessionLog,
  parseProjection,
  clearUsageCache,
  walkFiles,
  cachedParse,
  sessionAgg,
  newSessionRecord,
  findNumberDeep,
  findStringDeep
} from './parse.js'

/* ================================================================== *
 * 聚合
 * ================================================================== */

export async function collectUsage(options = {}) {
  const started = Date.now()
  const dshHome = resolveDshHome()
  const prices = await loadPrices(dshHome)
  if (options.force) clearUsageCache()

  const skipped = []
  const warnings = []
  let cacheHits = 0
  let cacheMisses = 0

  /* --- 事件流 --- */
  const sessions = new Map()
  const zstdOk = zstdAvailable()
  if (!zstdOk) warnings.push('当前 Node 运行时没有 zstd 支持（需要 >=22.15），已降级为投影缓存')

  let logFiles = []
  if (zstdOk) {
    logFiles = await walkFiles(logsRoot(dshHome), (n) => /\.jsonl\.zstd$/i.test(n))
  }

  for (const file of logFiles) {
    const r = await cachedParse(file, 'log', prices)
    if (r.cached) cacheHits += 1; else cacheMisses += 1
    if (r.record) sessions.set(r.record.id, r.record)
    else if (r.reason && r.reason !== 'no-usage') skipped.push({ file: basename(file), reason: r.reason })
  }

  /* --- 投影：补计时字段 & 事件流不可用时的降级 --- */
  const projFiles = await walkFiles(projRoot(dshHome), (n) => /\.json$/i.test(n))
  let projectionOnly = 0
  for (const file of projFiles) {
    const r = await cachedParse(file, 'projection', prices)
    if (r.cached) cacheHits += 1; else cacheMisses += 1
    if (!r.record) {
      if (r.reason && r.reason !== 'no-usage') skipped.push({ file: basename(file), reason: r.reason })
      continue
    }
    const existing = sessions.get(r.record.id)
    if (!existing) {
      sessions.set(r.record.id, r.record)
      projectionOnly += 1
      continue
    }
    // 事件流缺计时字段（DSH 把 llmMs/toolMs/ttft 只写进投影），补上
    if (!existing.llmMs && r.record.llmMs) existing.llmMs = r.record.llmMs
    if (!existing.toolMs && r.record.toolMs) existing.toolMs = r.record.toolMs
    if (!existing.ttftMs && r.record.ttftMs) existing.ttftMs = r.record.ttftMs
    if (!existing.ttftSteps && r.record.ttftSteps) existing.ttftSteps = r.record.ttftSteps
    if (!existing.decodeMs && r.record.decodeMs) existing.decodeMs = r.record.decodeMs
    if (!existing.decodeTokens && r.record.decodeTokens) existing.decodeTokens = r.record.decodeTokens
    if (!existing.title && r.record.title) existing.title = r.record.title
    if (!existing.cwd && r.record.cwd) existing.cwd = r.record.cwd
    if (!existing.turns && r.record.turns) existing.turns = r.record.turns
  }

  /* --- 汇总 --- */
  const totals = {
    ...emptyUsage(),
    peakTokens: emptyUsage(),
    offPeakTokens: emptyUsage(),
    requests: 0, sessions: 0, turns: 0, steps: 0,
    cost: 0, cacheSaved: 0, peakCost: 0, offPeakCost: 0,
    llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
    toolCalls: 0, toolMsMeasured: 0, toolErrors: 0,
    searchCalls: 0, prunes: 0, prunedTokens: 0,
    firstAt: null, lastAt: null,
    eventSessions: 0, projectionSessions: 0
  }
  const dayMap = new Map()
  const modelMap = new Map()
  const toolMap = new Map()
  const unmatched = new Map()
  const recentAll = []
  const subagents = { sessions: 0, total: 0, cost: 0, requests: 0 }
  const list = []

  for (const rec of sessions.values()) {
    if (rec.usage.total === 0 && rec.requests === 0 && rec.tools.size === 0) {
      skipped.push({ file: rec.id, reason: '空会话（无用量）' })
      continue
    }
    totals.sessions += 1
    if (rec.source === 'events') totals.eventSessions += 1
    else totals.projectionSessions += 1
    addUsage(totals, rec.usage)
    totals.requests += rec.requests
    totals.turns += rec.turns
    totals.steps += rec.steps
    totals.cost += rec.cost
    totals.cacheSaved += rec.cacheSaved
    totals.peakCost += rec.peakCost
    totals.offPeakCost += rec.offPeakCost
    addUsage(totals.peakTokens, rec.peakTokens)
    addUsage(totals.offPeakTokens, rec.offPeakTokens)
    totals.llmMs += rec.llmMs
    totals.toolMs += rec.toolMs
    totals.ttftMs += rec.ttftMs
    totals.ttftSteps += rec.ttftSteps
    totals.decodeMs += rec.decodeMs
    totals.decodeTokens += rec.decodeTokens
    totals.searchCalls += rec.searchCalls
    totals.prunes += rec.prunes
    totals.prunedTokens += rec.prunedTokens
    if (rec.firstAt && (totals.firstAt === null || rec.firstAt < totals.firstAt)) totals.firstAt = rec.firstAt
    if (rec.lastAt && (totals.lastAt === null || rec.lastAt > totals.lastAt)) totals.lastAt = rec.lastAt
    for (const [model, u] of rec.unmatched) {
      const prev = unmatched.get(model) ?? { tokens: 0, requests: 0 }
      prev.tokens += u.tokens
      prev.requests += u.requests
      unmatched.set(model, prev)
    }
    if (rec.origin === 'subagent' || rec.delegationDepth > 0) {
      subagents.sessions += 1
      subagents.total += rec.usage.total
      subagents.cost += rec.cost
      subagents.requests += rec.requests
    }

    for (const [day, d] of rec.byDay) {
      let g = dayMap.get(day)
      if (!g) {
        g = { day, usage: emptyUsage(), requests: 0, cost: 0, cacheSaved: 0, models: new Map() }
        dayMap.set(day, g)
      }
      addUsage(g.usage, d.usage)
      g.requests += d.requests
      g.cost += d.cost
      for (const [k, dm] of d.models) {
        const prev = g.models.get(k) ?? { usage: emptyUsage(), cost: 0 }
        addUsage(prev.usage, dm.usage)
        prev.cost += dm.cost
        g.models.set(k, prev)
      }
    }

    for (const [key, m] of rec.models) {
      let g = modelMap.get(key)
      if (!g) {
        g = { key, model: m.model, provider: m.provider, usage: emptyUsage(), requests: 0, cost: 0, cacheSaved: 0, sessions: 0 }
        modelMap.set(key, g)
      }
      addUsage(g.usage, m.usage)
      g.requests += m.requests
      g.cost += m.cost
      g.cacheSaved += m.cacheSaved
      g.sessions += 1
    }

    for (const [name, s] of rec.tools) {
      let g = toolMap.get(name)
      if (!g) {
        g = { name, calls: 0, ms: 0, errors: 0, unpaired: 0, sessions: 0, attrCost: 0, attrTokens: 0, attrSteps: 0 }
        toolMap.set(name, g)
      }
      g.calls += s.calls
      g.ms += s.ms
      g.errors += s.errors
      g.unpaired += s.unpaired
      g.sessions += 1
      const attr = rec.toolAttr.get(name)
      if (attr) {
        g.attrCost += attr.cost
        g.attrTokens += attr.tokens
        g.attrSteps += attr.steps
      }
      totals.toolCalls += s.calls
      totals.toolMsMeasured += s.ms
      totals.toolErrors += s.errors
    }
    // 工具烧钱榜里也要有「有归因但没配到 result」的工具（少见，但别丢）
    for (const [name, attr] of rec.toolAttr) {
      if (toolMap.has(name)) continue
      toolMap.set(name, {
        name, calls: 0, ms: 0, errors: 0, unpaired: 0, sessions: 1,
        attrCost: attr.cost, attrTokens: attr.tokens, attrSteps: attr.steps
      })
    }
    for (const item of rec.recent) recentAll.push(item)

    list.push({
      id: rec.id,
      title: rec.title,
      cwd: rec.cwd,
      workspace: rec.cwd ? basename(rec.cwd) : null,
      source: rec.source,
      origin: rec.origin,
      parent: rec.parentSession,
      depth: rec.delegationDepth,
      firstAt: rec.firstAt,
      lastAt: rec.lastAt,
      durationMs: rec.firstAt && rec.lastAt ? Math.max(0, rec.lastAt - rec.firstAt) : 0,
      total: rec.usage.total,
      uncachedInput: rec.usage.uncachedInput,
      cacheRead: rec.usage.cacheRead,
      output: rec.usage.output,
      requests: rec.requests,
      turns: rec.turns,
      steps: rec.steps,
      cost: rec.cost,
      cacheSaved: rec.cacheSaved,
      models: [...rec.models.values()].map((m) => m.model).filter(Boolean),
      toolCalls: [...rec.tools.values()].reduce((a, s) => a + s.calls, 0),
      toolMs: [...rec.tools.values()].reduce((a, s) => a + s.ms, 0),
      toolErrors: [...rec.tools.values()].reduce((a, s) => a + s.errors, 0),
      prunes: rec.prunes,
      prunedTokens: rec.prunedTokens,
      searchCalls: rec.searchCalls
    })
  }

  /* --- 派生指标 --- */
  const promptTokens = totals.uncachedInput + totals.cacheRead
  totals.cacheHitRate = promptTokens > 0 ? totals.cacheRead / promptTokens : 0
  totals.tokensPerSecond = totals.decodeMs > 0 ? totals.decodeTokens / (totals.decodeMs / 1000) : 0
  totals.avgTtftMs = totals.ttftSteps > 0 ? totals.ttftMs / totals.ttftSteps : 0
  totals.cacheWritePart = totals.total > 0 ? totals.cacheWrite / totals.total : 0
  const priced = totals.cost + totals.cacheSaved
  totals.cacheSavedShare = priced > 0 ? totals.cacheSaved / priced : 0
  totals.effectiveCostPerMTok = totals.total > 0 ? (totals.cost / totals.total) * 1e6 : 0
  const todayKey = localDayKey(Date.now())
  totals.costToday = dayMap.get(todayKey)?.cost ?? 0
  totals.tokensToday = dayMap.get(todayKey)?.usage.total ?? 0
  totals.peakShare = totals.cost > 0 ? totals.peakCost / totals.cost : 0

  const byDay = [...dayMap.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((d) => ({
      day: d.day,
      ...d.usage,
      requests: d.requests,
      cost: d.cost,
      models: Object.fromEntries([...d.models].map(([k, v]) => [k, { total: v.usage.total, cost: v.cost, ...v.usage }]))
    }))

  const totalTokensForShare = [...modelMap.values()].reduce((a, m) => a + m.usage.total, 0) || 1
  const totalCostForShare = [...modelMap.values()].reduce((a, m) => a + m.cost, 0) || 0
  const byModel = [...modelMap.values()]
    .map((m) => {
      const prompt = m.usage.uncachedInput + m.usage.cacheRead
      return {
        key: m.key,
        model: m.model ?? '(未知)',
        provider: m.provider,
        ...m.usage,
        requests: m.requests,
        sessions: m.sessions,
        cost: m.cost,
        cacheSaved: m.cacheSaved,
        share: m.usage.total / totalTokensForShare,
        costShare: totalCostForShare > 0 ? m.cost / totalCostForShare : 0,
        cacheHitRate: prompt > 0 ? m.usage.cacheRead / prompt : 0
      }
    })
    .sort((a, b) => b.total - a.total)

  const tools = [...toolMap.values()]
    .map((t) => ({ ...t, avgMs: t.calls > 0 ? t.ms / t.calls : 0 }))
    .sort((a, b) => b.ms - a.ms)

  /* P12：按「带来的消耗」排序的另一种视角；同时给出归因覆盖率，避免过度解读 */
  const toolsByCost = [...toolMap.values()]
    .filter((t) => t.attrCost > 0)
    .sort((a, b) => b.attrCost - a.attrCost)
  const attrCoverage = totals.cost > 0 ? toolsByCost.reduce((a, t) => a + t.attrCost, 0) / totals.cost : 0

  /* P7：跨会话合并最近事件，取最新 40 条 */
  const recent = recentAll.filter((e) => e.at).sort((a, b) => b.at - a.at).slice(0, 40)

  list.sort((a, b) => b.total - a.total)

  if (unmatched.size > 0) {
    warnings.push(
      `${unmatched.size} 个模型没有价格，其 token 未计入成本：` +
        [...unmatched.entries()].map(([m, v]) => `${m}(${v.tokens.toLocaleString('en-US')})`).join('、')
    )
  }
  if (totals.searchCalls > 0) {
    warnings.push(`内置网页搜索触发 ${totals.searchCalls} 次 LLM 调用，DSH 未记录其用量，因此未计入统计`)
  }
  if (projectionOnly > 0) {
    warnings.push(`${projectionOnly} 个会话只有投影缓存（没有事件流日志），这些会话的时间线不可用`)
  }

  return {
    generatedAt: Date.now(),
    durationMs: Date.now() - started,
    version: PANEL_VERSION,
    meta: {
      dshHome,
      logFiles: logFiles.length,
      projectionFiles: projFiles.length,
      sessions: sessions.size,
      used: totals.sessions,
      cacheHits,
      cacheMisses,
      skipped: skipped.slice(0, 40),
      skippedCount: skipped.length,
      zstdAvailable: zstdOk,
      searchCalls: totals.searchCalls,
      unmatched: [...unmatched.entries()].map(([model, v]) => ({ model, ...v })),
      prices: priceSummary(prices),
      warnings
    },
    totals,
    byDay,
    byModel,
    tools,
    /** P12：按归因消耗排序 + 覆盖率（多少成本能归到工具上） */
    toolsByCost,
    attrCoverage,
    /** P7：最近发生的请求/工具调用 */
    recent,
    compaction: { sessions: [...sessions.values()].filter((r) => r.prunes > 0).length, prunes: totals.prunes, prunedTokens: totals.prunedTokens },
    subagents,
    sessions: list.slice(0, 300)
  }
}

/** 宿主日志用的一行自检 */
export function selfCheckLine(usage) {
  const t = usage.totals
  const m = usage.meta
  const sym = m.prices?.symbol ?? ''
  const cur = m.prices?.currency ?? ''
  return (
    `扫描 ${m.logFiles} 个事件流 + ${m.projectionFiles} 个投影；采用 ${m.used} 个会话；` +
    `合计 ${t.total.toLocaleString('en-US')} tokens（未缓存 ${t.uncachedInput.toLocaleString('en-US')} / ` +
    `缓存读 ${t.cacheRead.toLocaleString('en-US')} / 输出 ${t.output.toLocaleString('en-US')}）；` +
    `命中率 ${(t.cacheHitRate * 100).toFixed(2)}%；估算成本 ${sym}${t.cost.toFixed(4)} ${cur}` +
    `（缓存省下 ${sym}${t.cacheSaved.toFixed(2)}，高峰占比 ${(t.peakShare * 100).toFixed(1)}%）；` +
    `模型 ${usage.byModel.length} 个；工具 ${usage.tools.length} 种；耗时 ${usage.durationMs}ms`
  )
}
