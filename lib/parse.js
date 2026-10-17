/**
 * dsh-usage-orb — 解析层
 *
 * 职责：把原始文件变成「会话记录」。含事件流解析（权威）、投影缓存解析（降级）、
 * 以及单会话逐轮下钻（按需解析 + 缓存）。不含任何跨会话聚合。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import * as zlib from 'node:zlib'
import {
  costOfRequest,
  cacheSavedOfRequest,
  DEFAULT_PRICES
} from './prices.js'
import {
  LIMITS,
  logsRoot,
  walkZstdFrames,
  localDayKey,
  emptyUsage,
  addUsage
} from './frames.js'

/** 深度受限地找第一个数值/字符串（仅用于投影兜底解析） */
export function findNumberDeep(node, keys, depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNumberDeep(item, keys, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const k of keys) {
    if (typeof node[k] === 'number' && Number.isFinite(node[k])) return node[k]
  }
  for (const v of Object.values(node)) {
    const found = findNumberDeep(v, keys, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

export function findStringDeep(node, keys, depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findStringDeep(item, keys, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const k of keys) {
    if (typeof node[k] === 'string' && node[k].trim()) return node[k].trim()
  }
  for (const v of Object.values(node)) {
    const found = findStringDeep(v, keys, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

export async function walkFiles(root, filter, acc = [], depth = 0) {
  if (depth > LIMITS.maxWalkDepth || acc.length >= LIMITS.maxFiles) return acc
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (acc.length >= LIMITS.maxFiles) break
    const full = join(root, e.name)
    if (e.isDirectory()) await walkFiles(full, filter, acc, depth + 1)
    else if (e.isFile() && filter(e.name)) acc.push(full)
  }
  return acc
}

/* ================================================================== *
 * 会话记录（两套源归一化成同一个形状）
 * ================================================================== */

export function newSessionRecord(id) {
  return {
    id,
    source: null,
    title: null,
    cwd: null,
    agentPreset: null,
    origin: 'user',
    parentSession: null,
    delegationDepth: 0,
    createdAt: null,
    firstAt: null,
    lastAt: null,
    usage: emptyUsage(),
    /** 高峰 / 空闲时段各自的 token 构成（P10「如果」模拟器要按这两桶重算成本） */
    peakTokens: emptyUsage(),
    offPeakTokens: emptyUsage(),
    cost: 0,
    cacheSaved: 0,
    peakCost: 0,
    offPeakCost: 0,
    requests: 0,
    turns: 0,
    steps: 0,
    /** day → { usage, requests, cost, models: Map<modelKey, {usage, cost}> } */
    byDay: new Map(),
    /** modelKey → { usage, requests, cost, provider, model } */
    models: new Map(),
    /** name → { calls, ms, errors, unpaired } */
    tools: new Map(),
    /** name → { cost, tokens, steps }：把「某一步的账」归给它申请调用的工具（P12） */
    toolAttr: new Map(),
    /** 精简的最近事件（P7 ticker 用），随后跨会话合并 */
    recent: [],
    searchCalls: 0,
    prunes: 0,
    prunedTokens: 0,
    /** 投影独有的计时字段（事件流没有） */
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    unmatched: new Map()
  }
}

export function sessionAgg(rec) {
  const dayKey = rec.lastAt ? localDayKey(rec.lastAt) : null
  return {
    byDay: dayKey,
    models: [...rec.models.entries()],
    tools: [...rec.tools.entries()]
  }
}

/* ================================================================== *
 * 源 1：事件流
 * ================================================================== */

/**
 * 解析一个会话事件流。
 * @returns {Promise<{record: object|null, reason?: string, frames: number, events: number}>}
 */
export async function parseSessionLog(file, prices = DEFAULT_PRICES) {
  let info
  try {
    info = await stat(file)
  } catch {
    return { record: null, reason: 'stat-failed', frames: 0, events: 0 }
  }
  if (info.size > LIMITS.maxLogBytes) {
    return { record: null, reason: `日志超过 ${(LIMITS.maxLogBytes / 1048576) | 0} MiB`, frames: 0, events: 0 }
  }
  let buf
  try {
    buf = await readFile(file)
  } catch {
    return { record: null, reason: 'read-failed', frames: 0, events: 0 }
  }

  let record = null
  let frames = 0
  let events = 0
  let badFrames = 0
  const seenMessageIds = new Set()
  const pendingCalls = new Map()
  /*
   * 有序「事件时间线」：只为两件事存在
   *   · P7 实时 ticker：最近发生的请求 / 工具调用
   *   · P12 工具烧钱榜：assistant/message（那一步的账）与它之后 tool/call 的配对
   * 事件顺序实测是 step/start → assistant/message → tool/call → tool/result → step/end，
   * 所以「一个 assistant/message 的账」应归给它【后面】紧跟的那些工具调用。
   */
  const timeline = []

  for (const fr of walkZstdFrames(buf)) {
    if (fr.error) { badFrames += 1; break }
    frames += 1
    let text
    try {
      text = zlib.zstdDecompressSync(fr.slice).toString('utf8')
    } catch {
      badFrames += 1
      continue
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      let ev
      try {
        ev = JSON.parse(trimmed)
      } catch {
        badFrames += 1
        continue
      }
      events += 1
      const t = ev.type
      const d = ev.data ?? {}
      const at = typeof ev.time === 'number' ? ev.time : null

      if (t === 'session') {
        record = record ?? newSessionRecord(ev.id)
        record.source = 'events'
        record.cwd = ev.cwd ?? record.cwd
        record.agentPreset = ev.agentPreset ?? record.agentPreset
        record.origin = ev.origin ?? record.origin
        record.parentSession = ev.parentSession ?? null
        record.delegationDepth = ev.delegationDepth ?? 0
        record.createdAt = ev.createdAt ?? record.createdAt
        continue
      }
      if (!record) {
        // 头部通常在第一帧；万一没有，就用文件名兜底
        record = newSessionRecord(basename(file, '.zstd'))
        record.source = 'events'
      }

      if (t === 'assistant/message' && d.usage) {
        const id = d.message?.id ?? null
        if (id) {
          if (seenMessageIds.has(id)) continue   // 防重放重复计数
          seenMessageIds.add(id)
        }
        const model = d.message?.source?.model ?? null
        const provider = d.message?.source?.provider ?? null
        // DSH 的 usage.inputTokens = 未命中缓存的输入部分
        const u = {
          uncachedInput: d.usage.inputTokens ?? 0,
          cacheRead: d.usage.cacheReadTokens ?? 0,
          cacheWrite: d.usage.cacheWriteTokens ?? 0,
          output: d.usage.outputTokens ?? 0
        }
        u.total = u.uncachedInput + u.cacheRead + u.cacheWrite + u.output

        const key = `${provider ?? '?'}/${model ?? '?'}`
        const priced = costOfRequest(u, at, model, prices)
        const saved = cacheSavedOfRequest(u, at, model, prices)

        record.requests += 1
        addUsage(record.usage, u)
        record.cost += priced.cost
        record.cacheSaved += saved
        if (priced.matched) {
          if (priced.peak) {
            record.peakCost += priced.cost
            addUsage(record.peakTokens, u)
          } else {
            record.offPeakCost += priced.cost
            addUsage(record.offPeakTokens, u)
          }
        } else {
          const prev = record.unmatched.get(model ?? '(未知)') ?? { tokens: 0, requests: 0 }
          prev.tokens += u.total
          prev.requests += 1
          record.unmatched.set(model ?? '(未知)', prev)
        }

        const m = record.models.get(key) ?? {
          provider, model, usage: emptyUsage(), requests: 0, cost: 0, cacheSaved: 0
        }
        addUsage(m.usage, u)
        m.requests += 1
        m.cost += priced.cost
        m.cacheSaved += saved
        record.models.set(key, m)

        if (at) {
          const dk = localDayKey(at)
          let day = record.byDay.get(dk)
          if (!day) {
            day = { usage: emptyUsage(), requests: 0, cost: 0, models: new Map() }
            record.byDay.set(dk, day)
          }
          addUsage(day.usage, u)
          day.requests += 1
          day.cost += priced.cost
          const dm = day.models.get(key) ?? { usage: emptyUsage(), cost: 0 }
          addUsage(dm.usage, u)
          dm.cost += priced.cost
          day.models.set(key, dm)

          if (record.firstAt === null || at < record.firstAt) record.firstAt = at
          if (record.lastAt === null || at > record.lastAt) record.lastAt = at
        }
        const turn = d.turn
        if (turn !== undefined) record.turns = Math.max(record.turns, turn)
        record.steps += 1
        // 供 ticker / 工具归因使用（只留精简字段，别把整条消息塞进来）
        timeline.push({
          kind: 'usage', at, cost: priced.cost, total: u.total,
          output: u.output, cacheRead: u.cacheRead, uncachedInput: u.uncachedInput,
          model: model ?? null, turn: d.turn ?? null, step: d.step ?? null
        })
        continue
      }

      if (t === 'tool/call') {
        pendingCalls.set(d.callId, { name: d.name ?? '(未命名)', at })
        timeline.push({ kind: 'call', at, name: d.name ?? '(未命名)' })
        continue
      }

      if (t === 'tool/result') {
        const callId = d.message?.toolCallId ?? d.message?.source?.callId
        const call = callId ? pendingCalls.get(callId) : null
        const name = call?.name ?? '(未配对)'
        const s = record.tools.get(name) ?? { calls: 0, ms: 0, errors: 0, unpaired: 0 }
        s.calls += 1
        if (call && at && call.at) s.ms += Math.max(0, at - call.at)
        else s.unpaired += 1
        if (d.message?.isError) s.errors += 1
        record.tools.set(name, s)
        if (callId) pendingCalls.delete(callId)
        continue
      }

      if (t === 'compaction/prune') {
        record.prunes += 1
        record.prunedTokens += d.shadowedTokenCount ?? 0
        continue
      }

      if (t === 'session/title' && d.title) {
        record.title = d.title
        continue
      }

      if (t === 'web/deepseek-search-llm-request') {
        record.searchCalls += 1
        continue
      }
    }
  }

  if (!record || (record.requests === 0 && record.tools.size === 0)) {
    return { record: record && record.requests > 0 ? record : null, reason: 'no-usage', frames, events }
  }
  // 没有 assistant 消息但有工具调用：仍然保留（会话存在）
  if (!record.lastAt && record.createdAt) record.lastAt = record.createdAt

  /* ---- P12 工具烧钱榜：把每一步的账归给它随后申请调用的工具 ---- */
  {
    let pendingUsage = null
    const pendingNames = []
    const flush = () => {
      if (pendingUsage && pendingNames.length) {
        const share = pendingUsage.cost / pendingNames.length
        const tokShare = pendingUsage.total / pendingNames.length
        for (const name of pendingNames) {
          const rec = record.toolAttr.get(name) ?? { cost: 0, tokens: 0, steps: 0 }
          rec.cost += share
          rec.tokens += tokShare
          rec.steps += 1
          record.toolAttr.set(name, rec)
        }
      }
      pendingUsage = null
      pendingNames.length = 0
    }
    for (const e of timeline) {
      if (e.kind === 'usage') { flush(); pendingUsage = e } else if (e.kind === 'call' && pendingUsage) pendingNames.push(e.name)
    }
    flush()
  }

  /* ---- P7 ticker：每个会话留一点最近事件，随后跨会话合并 ---- */
  {
    const usages = timeline.filter((e) => e.kind === 'usage' && e.at).slice(-8)
    const calls = timeline.filter((e) => e.kind === 'call' && e.at).slice(-8)
    record.recent = [
      ...usages.map((e) => ({
        kind: 'request', at: e.at, session: record.id, title: record.title,
        total: e.total, output: e.output, cacheRead: e.cacheRead, cost: e.cost,
        model: e.model, turn: e.turn, step: e.step
      })),
      ...calls.map((e) => ({ kind: 'tool', at: e.at, session: record.id, title: record.title, name: e.name }))
    ]
  }

  return { record, frames, events, badFrames }
}

/* ================================================================== *
 * 源 2：投影缓存（降级 / 补充计时字段）
 * ================================================================== */

export async function parseProjection(file) {
  let info
  try {
    info = await stat(file)
  } catch {
    return { record: null, reason: 'stat-failed' }
  }
  if (info.size > LIMITS.maxProjectionBytes) return { record: null, reason: 'too-large' }
  let data
  try {
    data = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return { record: null, reason: 'parse-failed' }
  }
  const id = basename(file).replace(/\.json$/i, '')
  const rec = newSessionRecord(id)
  rec.source = 'projection'
  rec.usage = {
    uncachedInput: findNumberDeep(data, ['uncachedInputTokens']) ?? 0,
    cacheRead: findNumberDeep(data, ['cacheReadTokens']) ?? 0,
    cacheWrite: findNumberDeep(data, ['cacheWriteTokens']) ?? 0,
    output: findNumberDeep(data, ['outputTokens']) ?? 0,
    total: 0
  }
  rec.usage.total = rec.usage.uncachedInput + rec.usage.cacheRead + rec.usage.cacheWrite + rec.usage.output
  rec.turns = findNumberDeep(data, ['turns']) ?? 0
  rec.steps = findNumberDeep(data, ['steps']) ?? 0
  rec.llmMs = findNumberDeep(data, ['llmMs']) ?? 0
  rec.toolMs = findNumberDeep(data, ['toolMs']) ?? 0
  rec.ttftMs = findNumberDeep(data, ['ttftMs']) ?? 0
  rec.ttftSteps = findNumberDeep(data, ['ttftSteps']) ?? 0
  rec.decodeMs = findNumberDeep(data, ['decodeMs']) ?? 0
  rec.decodeTokens = findNumberDeep(data, ['decodeTokens']) ?? 0
  rec.title = findStringDeep(data, ['title']) ?? null
  rec.cwd = findStringDeep(data, ['cwd']) ?? null
  const model = findStringDeep(data, ['model']) ?? null
  const provider = findStringDeep(data, ['provider']) ?? null
  const at = findNumberDeep(data, ['lastPromptAt', 'updatedAt', 'createdAt'])
  if (at && at > 1e12) { rec.lastAt = at; rec.createdAt = at; rec.firstAt = at }
  if (model) {
    const key = `${provider ?? '?'}/${model}`
    rec.models.set(key, { provider, model, usage: { ...rec.usage }, requests: 0, cost: 0, cacheSaved: 0 })
  }
  if (rec.usage.total === 0 && rec.steps === 0) return { record: null, reason: 'no-usage' }
  return { record: rec }
}

/* ================================================================== *
 * 缓存（按 mtime+size 增量）
 * ================================================================== */

const fileCache = new Map()   // path → { size, mtimeMs, record, reason }

export function clearUsageCache() {
  fileCache.clear()
}

export async function cachedParse(file, kind, prices) {
  let info
  try {
    info = await stat(file)
  } catch {
    fileCache.delete(file)
    return { record: null, reason: 'stat-failed', cached: false }
  }
  const hit = fileCache.get(file)
  if (hit && hit.size === info.size && hit.mtimeMs === info.mtimeMs) {
    return { record: hit.record, reason: hit.reason, cached: true }
  }
  const parsed = kind === 'log' ? await parseSessionLog(file, prices) : await parseProjection(file)
  fileCache.set(file, {
    size: info.size,
    mtimeMs: info.mtimeMs,
    record: parsed.record,
    reason: parsed.reason
  })
  return { ...parsed, cached: false }
}

/* ================================================================== *
 * E 组：单会话逐轮下钻（按需解析，不进主载荷）
 *
 * 只在用户点开某个会话时才解析它的日志，结果按 mtime+size 缓存。
 * 事件形状（实测）：
 *   turn/start {turn}            turn/end {turn, reason}
 *   step/start {turn, step}      step/end {turn, step}
 *   assistant/message {turn, step, usage, message.source}
 *   tool/call {callId, name}     tool/result {message.toolCallId, message.isError}
 *   llm/retry（重试：白花的时间和钱）   compaction/prune {shadowedTokenCount}
 * ================================================================== */

const detailCache = new Map()        // file → { key, value }
const DETAIL_CACHE_MAX = 8

/** 用 id 定位会话日志（只允许 sessions/<slug>/<id>/session*.jsonl.zstd） */
export async function findSessionLog(dshHome, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) return null
  const root = logsRoot(dshHome)
  let workspaces
  try {
    workspaces = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue
    const dir = join(root, ws.name, id)
    let files
    try {
      files = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const f of files) {
      if (f.isFile() && /\.jsonl\.zstd$/.test(f.name)) return join(dir, f.name)
    }
  }
  return null
}

export async function parseSessionDetail(file, prices = DEFAULT_PRICES) {
  let info
  try {
    info = await stat(file)
  } catch {
    return { error: 'stat-failed' }
  }
  const cacheKey = `${info.mtimeMs}:${info.size}`
  const hit = detailCache.get(file)
  if (hit && hit.key === cacheKey) return hit.value

  const started = Date.now()
  let buf
  try {
    buf = await readFile(file)
  } catch {
    return { error: 'read-failed' }
  }

  const turns = new Map()
  const stepsOf = new Map()          // `${turn}/${step}` → step
  const callIndex = new Map()        // callId → call
  const compactions = []
  let header = null
  let title = null
  let currentStep = null
  let currentTurn = null
  let retries = 0
  let userMessages = 0
  let events = 0
  let badFrames = 0
  let truncated = false
  const totals = { requests: 0, steps: 0, toolCalls: 0, cost: 0, usage: emptyUsage() }

  const ensureTurn = (turn, at) => {
    let t = turns.get(turn)
    if (!t) {
      if (turns.size >= 300) { truncated = true; return null }
      t = { turn, at: at ?? null, endAt: null, reason: null, cost: 0, usage: emptyUsage(), steps: [] }
      turns.set(turn, t)
    }
    if (at && !t.at) t.at = at
    return t
  }
  const ensureStep = (turn, step, at) => {
    let s = stepsOf.get(`${turn}/${step}`)
    if (!s) {
      const parent = ensureTurn(turn, at)
      if (!parent) return null
      if (stepsOf.size >= 2000) { truncated = true; return null }
      s = { step, at: at ?? null, endAt: null, cost: 0, usage: emptyUsage(), model: null, retries: 0, tools: [] }
      stepsOf.set(`${turn}/${step}`, s)
      parent.steps.push(s)
    }
    if (at && !s.at) s.at = at
    return s
  }

  for (const fr of walkZstdFrames(buf)) {
    if (fr.error) { badFrames += 1; break }
    let text
    try {
      text = zlib.zstdDecompressSync(fr.slice).toString('utf8')
    } catch {
      badFrames += 1
      continue
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      let ev
      try {
        ev = JSON.parse(trimmed)
      } catch {
        badFrames += 1
        continue
      }
      events += 1
      const t = ev.type
      const d = ev.data ?? {}
      const at = typeof ev.time === 'number' ? ev.time : null

      if (t === 'session') { header = ev; continue }
      if (t === 'session/title') { title = d.title ?? ev.title ?? title; continue }
      if (t === 'turn/start') { currentTurn = d.turn ?? null; ensureTurn(d.turn, at); currentStep = null; continue }
      if (t === 'turn/end') {
        const tr = turns.get(d.turn)
        if (tr) { tr.endAt = at; tr.reason = d.reason?.kind ?? null }
        continue
      }
      if (t === 'step/start') { currentStep = ensureStep(d.turn, d.step, at); continue }
      if (t === 'step/end') {
        const s = stepsOf.get(`${d.turn}/${d.step}`)
        if (s) s.endAt = at
        continue
      }
      if (t === 'llm/retry' || t === 'llm/retry-started') {
        retries += 1
        if (currentStep) currentStep.retries += 1
        continue
      }
      if (t === 'user/message') { userMessages += 1; continue }
      if (t === 'compaction/prune') {
        compactions.push({ t: at, tokens: d.shadowedTokenCount ?? 0, turn: currentTurn })
        continue
      }
      if (t === 'tool/call') {
        if (currentStep) {
          const call = { name: d.name ?? '(未命名)', at, ms: null, error: false }
          currentStep.tools.push(call)
          totals.toolCalls += 1
          if (d.callId) callIndex.set(d.callId, call)
        }
        continue
      }
      if (t === 'tool/result') {
        const callId = d.message?.toolCallId ?? d.message?.source?.callId
        const call = callId ? callIndex.get(callId) : null
        if (call) {
          if (at && call.at) call.ms = Math.max(0, at - call.at)
          call.error = d.message?.isError === true
        }
        continue
      }
      if (t === 'assistant/message') {
        const u = {
          uncachedInput: d.usage?.inputTokens ?? 0,
          cacheRead: d.usage?.cacheReadTokens ?? 0,
          cacheWrite: d.usage?.cacheWriteTokens ?? 0,
          output: d.usage?.outputTokens ?? 0
        }
        u.total = u.uncachedInput + u.cacheRead + u.cacheWrite + u.output
        const model = d.message?.source?.model ?? null
        const priced = costOfRequest(u, at, model, prices)
        const step = ensureStep(d.turn ?? 0, d.step ?? 0, at)
        if (step) {
          addUsage(step.usage, u)
          step.cost += priced.cost
          step.model = model ?? step.model
        }
        const tr = turns.get(d.turn ?? 0)
        if (tr) { addUsage(tr.usage, u); tr.cost += priced.cost }
        addUsage(totals.usage, u)
        totals.cost += priced.cost
        totals.requests += 1
        totals.steps += 1
        continue
      }
    }
  }

  const ordered = [...turns.values()].sort((a, b) => a.turn - b.turn)
  const value = {
    id: header?.id ?? null,
    title: title ?? null,
    cwd: header?.cwd ?? null,
    origin: header?.origin ?? null,
    createdAt: header?.createdAt ?? null,
    firstAt: ordered.length ? (ordered[0].at ?? null) : null,
    lastAt: ordered.reduce((a, t) => Math.max(a, t.endAt ?? t.at ?? 0), 0) || null,
    totals,
    turns: ordered.map((t) => ({
      ...t,
      ms: t.at && t.endAt ? t.endAt - t.at : null,
      /* 每一步的时长（step/start→step/end）：面板「逐轮明细」的耗时列靠它 */
      steps: t.steps.map((s) => ({ ...s, ms: s.at && s.endAt ? s.endAt - s.at : null }))
    })),
    compactions,
    retries,
    userMessages,
    truncated,
    events,
    badFrames,
    bytes: info.size,
    parseMs: Date.now() - started
  }
  if (detailCache.size >= DETAIL_CACHE_MAX) detailCache.delete(detailCache.keys().next().value)
  detailCache.set(file, { key: cacheKey, value })
  return value
}
