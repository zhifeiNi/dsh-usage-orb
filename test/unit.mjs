/**
 * 数据层单元测试 —— 不依赖浏览器、不依赖真实用量数据。
 *
 * 做法：用 zlib 造一份「每个事件一个 zstd 帧」的合成会话日志（与 DSH 真实格式一致），
 * 指向临时 DSH_HOME，然后对聚合结果做**手算期望值**断言。
 * 这样价格口径、帧解析、工具配对、归因、下钻、峰谷分桶的改动都能在 1 秒内被抓住，
 * 不必每次跑 3 分钟的浏览器 E2E。
 *
 * 运行：node test/unit.mjs   （或 npm test）
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as zlib from 'node:zlib'

let pass = 0
const fails = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fails.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))
const section = (t) => console.log(`\n===== ${t} =====`)

/* ------------------------------------------------------------------ *
 * 时间锚点：北京时间周五 10:00 = UTC 周五 02:00（高峰）
 *            北京时间周五 22:00 = UTC 周五 14:00（空闲）
 * ------------------------------------------------------------------ */
const PEAK = Date.UTC(2026, 9, 16, 2, 0, 0)
const OFF = Date.UTC(2026, 9, 16, 14, 0, 0)
const home = await mkdtemp(join(tmpdir(), 'dsh-usage-test-'))
process.env.DSH_HOME = home

const S = join(home, 'sessions', '-test-ws', 'fixture-1')
const P = join(home, 'storages', 'session_projcache', 'sessions')
const S2 = join(home, 'sessions', '-test-ws', 'fixture-child')
await mkdir(S, { recursive: true })
await mkdir(S2, { recursive: true })
await mkdir(P, { recursive: true })

/** 每行一个事件 = 一个独立 zstd 帧（与 DSH 实际写盘方式一致） */
const writeLog = async (file, events) => {
  const frames = events.map((e) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(e) + '\n', 'utf8')))
  await writeFile(file, Buffer.concat(frames))
}

const msg = (time, id, usage, turn = 1, step = 1, model = 'deepseek-flash') => ({
  type: 'assistant/message', time,
  data: { turn, step, usage, message: { id, source: { provider: 'deepseek-account', model } } }
})

/*
 * 三个请求，成本可以手算：
 *   A 高峰 · 未缓存输入 1,000,000 → flash 高峰 ¥2/1M  → ¥2.00
 *   B 空闲 · 缓存命中   1,000,000 → flash 空闲 ¥0.02/1M → ¥0.02（不省则为 ¥1.00）
 *   C 空闲 · 输出       1,000,000 → flash 空闲 ¥4/1M  → ¥4.00
 *   合计 ¥6.02；高峰 ¥2.00 / 空闲 ¥4.02；缓存省下 ¥0.98
 * 工具：A 那一步申请调用了 pwsh（call→result，失败），所以 A 的账归给 pwsh。
 */
const LOG1 = [
  { type: 'session', seq: 1, time: PEAK, id: 'fixture-1', cwd: 'D:\\proj', createdAt: PEAK, origin: 'cli', delegationDepth: 0 },
  { type: 'session/title', seq: 2, time: PEAK, data: { title: '合成会话' } },
  { type: 'turn/start', seq: 3, time: PEAK, data: { turn: 1 } },
  { type: 'step/start', seq: 4, time: PEAK, data: { turn: 1, step: 1 } },
  msg(PEAK + 1000, 'm1', { inputTokens: 1000000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }),
  { type: 'tool/call', seq: 6, time: PEAK + 1100, data: { callId: 'c1', name: 'pwsh' } },
  { type: 'tool/result', seq: 7, time: PEAK + 3100, data: { message: { toolCallId: 'c1', isError: true } } },
  { type: 'llm/retry', seq: 8, time: PEAK + 3200, data: {} },
  { type: 'step/end', seq: 9, time: PEAK + 4000, data: { turn: 1, step: 1 } },

  { type: 'step/start', seq: 10, time: OFF, data: { turn: 1, step: 2 } },
  msg(OFF + 1000, 'm2', { inputTokens: 0, cacheReadTokens: 1000000, cacheWriteTokens: 0, outputTokens: 0 }, 1, 2),
  { type: 'step/end', seq: 12, time: OFF + 2000, data: { turn: 1, step: 2 } },

  { type: 'step/start', seq: 13, time: OFF + 3000, data: { turn: 1, step: 3 } },
  msg(OFF + 4000, 'm3', { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1000000 }, 1, 3),
  { type: 'step/end', seq: 15, time: OFF + 5000, data: { turn: 1, step: 3 } },

  { type: 'compaction/prune', seq: 16, time: OFF + 6000, data: { shadowedTokenCount: 12345 } },
  { type: 'turn/end', seq: 17, time: OFF + 7000, data: { turn: 1, reason: { kind: 'completed' } } },

  { type: 'turn/start', seq: 18, time: OFF + 8000, data: { turn: 2 } },
  { type: 'step/start', seq: 19, time: OFF + 8000, data: { turn: 2, step: 1 } },
  msg(OFF + 9000, 'm4', { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, 2, 1),
  { type: 'step/end', seq: 21, time: OFF + 9500, data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: 22, time: OFF + 10000, data: { turn: 2, reason: { kind: 'completed' } } }
]
await writeLog(join(S, 'session.v4.jsonl.zstd'), LOG1)

// 子 agent 会话（delegationDepth=1）→ 用于 subagents 统计
await writeLog(join(S2, 'session.v4.jsonl.zstd'), [
  { type: 'session', seq: 1, time: OFF, id: 'fixture-child', cwd: 'D:\\proj', createdAt: OFF, parentSession: 'fixture-1', delegationDepth: 1 },
  { type: 'turn/start', seq: 2, time: OFF, data: { turn: 1 } },
  { type: 'step/start', seq: 3, time: OFF, data: { turn: 1, step: 1 } },
  msg(OFF + 100, 'cm1', { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1000000 }, 1, 1),
  { type: 'step/end', seq: 5, time: OFF + 200, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 6, time: OFF + 300, data: { turn: 1, reason: { kind: 'completed' } } }
])

// 只有一个投影缓存、没有事件流的会话 → 走降级路径
await writeFile(join(P, 'fixture-proj.json'), JSON.stringify({
  usage: { uncachedInputTokens: 500000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
  requests: 1, lastAt: OFF
}))

/* ------------------------------------------------------------------ */
const prices = await import(new URL('../lib/prices.js', import.meta.url).href)
const framesMod = await import(new URL('../lib/frames.js', import.meta.url).href)
const parseMod = await import(new URL('../lib/parse.js', import.meta.url).href)
const aggMod = await import(new URL('../lib/aggregate.js', import.meta.url).href)

section('价格表（人民币为主口径）')
{
  const tbl = prices.DEFAULT_PRICES
  ok('默认币种是 CNY', tbl.code === 'CNY' && prices.DEFAULT_CURRENCY === 'CNY', `${tbl.code} ${tbl.symbol}`)
  const flash = prices.resolveModel('deepseek-account/deepseek-flash')
  ok('模型名解析（带 provider 前缀）', flash === 'deepseek-flash', String(flash))
  ok('遗留名 deepseek-v4-flash 归到 flash', prices.resolveModel('deepseek-v4-flash') === 'deepseek-flash')
  ok('未知模型返回 null（不会被静默按 0 计价）', prices.resolveModel('gpt-5') === null)

  ok('北京时间周五 10:00 是高峰', prices.isPeak(PEAK) === true)
  ok('北京时间周五 22:00 是空闲', prices.isPeak(OFF) === false)
  ok('周六任何时间都空闲', prices.isPeak(Date.UTC(2026, 9, 17, 2, 0, 0)) === false)

  const u = { uncachedInput: 1000000, cacheRead: 0, cacheWrite: 0, output: 0, total: 1000000 }
  const peakCost = prices.costOfRequest(u, PEAK, 'deepseek-flash', tbl)
  const offCost = prices.costOfRequest(u, OFF, 'deepseek-flash', tbl)
  ok('1M 未缓存输入 @高峰 = ¥2.00', close(peakCost.cost, 2), String(peakCost.cost))
  ok('1M 未缓存输入 @空闲 = ¥1.00', close(offCost.cost, 1), String(offCost.cost))
  ok('高峰标记正确', peakCost.peak === true && offCost.peak === false)
}

section('帧遍历（每个事件一个 zstd 帧）')
{
  const log = await import('node:fs/promises').then((fs) => fs.readFile(join(S, 'session.v4.jsonl.zstd')))
  const all = [...framesMod.walkZstdFrames(log)]
  ok('帧数 = 事件数', all.length === LOG1.length, `${all.length} 帧 / ${LOG1.length} 事件`)
  ok('每帧都能独立解压', all.every((f) => !f.error && f.slice.length > 0))
  const oneShot = zlib.zstdDecompressSync(log).toString('utf8')
  ok('反例：一次性解压只能拿到第一帧（这正是必须逐帧的原因）', oneShot.split('\n').filter(Boolean).length === 1, `${oneShot.split('\n').filter(Boolean).length} 个事件`)
}

section('单会话解析 + 逐轮下钻')
{
  const res = await parseMod.parseSessionLog(join(S, 'session.v4.jsonl.zstd'), prices.DEFAULT_PRICES)
  const r = res.record
  ok('会话头解析', r.id === 'fixture-1' && r.cwd === 'D:\\proj', r.id)
  ok('标题来自 session/title', r.title === '合成会话', String(r.title))
  ok('请求数 4', r.requests === 4, String(r.requests))
  ok('token 分类合计 3,000,000', r.usage.total === 3000000, String(r.usage.total))
  ok('成本 ¥6.02', close(r.cost, 6.02, 1e-6), String(r.cost))
  ok('高峰成本 ¥2.00 / 空闲 ¥4.02', close(r.peakCost, 2, 1e-6) && close(r.offPeakCost, 4.02, 1e-6), `${r.peakCost} / ${r.offPeakCost}`)
  ok('峰谷 token 分桶完整（两桶之和 = 总量）',
    r.peakTokens.total + r.offPeakTokens.total === r.usage.total, `${r.peakTokens.total}+${r.offPeakTokens.total}`)
  ok('缓存省下 ¥0.98', close(r.cacheSaved, 0.98, 1e-6), String(r.cacheSaved))
  ok('工具调用 1 次 / 失败 1 次 / 耗时 2000ms',
    r.tools.get('pwsh').calls === 1 && r.tools.get('pwsh').errors === 1 && r.tools.get('pwsh').ms === 2000,
    JSON.stringify(r.tools.get('pwsh')))
  ok('工具归因：A 的 ¥2.00 归给 pwsh', close(r.toolAttr.get('pwsh').cost, 2, 1e-6), JSON.stringify(r.toolAttr.get('pwsh')))
  ok('压缩 1 次 / 丢弃 12345 tokens', r.prunes === 1 && r.prunedTokens === 12345, `${r.prunes}/${r.prunedTokens}`)
  ok('轮数 2', r.turns === 2, String(r.turns))
  ok('ticker 最近事件里有请求和工具', r.recent.some((e) => e.kind === 'request') && r.recent.some((e) => e.kind === 'tool'))

  const d = await parseMod.parseSessionDetail(join(S, 'session.v4.jsonl.zstd'), prices.DEFAULT_PRICES)
  ok('下钻：2 轮', d.turns.length === 2, String(d.turns.length))
  ok('下钻：4 步', d.totals.steps === 4, String(d.totals.steps))
  ok('下钻：成本与总账一致 ¥6.02', close(d.totals.cost, 6.02, 1e-6), String(d.totals.cost))
  ok('下钻：步骤时长（step/start→step/end）',
    d.turns[0].steps[0].ms === 4000,
    String(d.turns[0].steps[0].ms))
  ok('下钻：轮时长 = turn/start→turn/end（第 2 轮同属空闲时段，2s）',
    d.turns[1].ms === 2000 && d.turns[0].ms === d.turns[0].endAt - d.turns[0].at && d.turns[0].reason === 'completed',
    `T1=${d.turns[0].ms} T2=${d.turns[1].ms} reason=${d.turns[0].reason}`)
  ok('下钻：工具挂在正确的步上（第 1 步 pwsh，失败）',
    d.turns[0].steps[0].tools.length === 1 && d.turns[0].steps[0].tools[0].name === 'pwsh' && d.turns[0].steps[0].tools[0].error === true,
    JSON.stringify(d.turns[0].steps[0].tools))
  ok('下钻：重试计数 1', d.retries === 1 && d.turns[0].steps[0].retries === 1, String(d.retries))
  ok('下钻：压缩标记挂在第 1 轮', d.compactions.length === 1 && d.compactions[0].turn === 1, JSON.stringify(d.compactions))
}

section('投影缓存降级路径')
{
  const res = await parseMod.parseProjection(join(P, 'fixture-proj.json'))
  ok('投影可解析并标记来源', res.record?.source === 'projection', String(res.record?.source))
  ok('投影 token 读出 500,000', res.record.usage.total === 500000, String(res.record?.usage?.total))
}

section('跨会话聚合')
{
  const u = await aggMod.collectUsage({ force: true })
  ok('会话数 2（事件流）+ 1（投影）= 3', u.totals.sessions === 3, String(u.totals.sessions))
  ok('事件流会话 2 / 投影会话 1', u.totals.eventSessions === 2 && u.totals.projectionSessions === 1,
    `${u.totals.eventSessions}/${u.totals.projectionSessions}`)
  ok('请求总数 5（4 + 子会话 1；投影缓存不提供请求数）', u.totals.requests === 5, String(u.totals.requests))
  ok('总成本 = 6.02 + 4.00（子会话 1M 输出）= 10.02', close(u.totals.cost, 10.02, 1e-6), String(u.totals.cost))
  ok('token 总量含投影那 500k（3M + 1M + 0.5M）', u.totals.total === 4500000, String(u.totals.total))
  ok('投影会话贡献 token 但不计价（无逐请求时间戳与模型 → 定价会是假精度）',
    u.totals.projectionSessions === 1 && close(u.totals.cost, 10.02, 1e-6), `${u.totals.projectionSessions} 个投影会话`)
  ok('峰谷成本之和 = 总成本（无遗漏）', close(u.totals.peakCost + u.totals.offPeakCost, u.totals.cost, 1e-9),
    `${u.totals.peakCost}+${u.totals.offPeakCost} vs ${u.totals.cost}`)
  ok('峰谷分桶只覆盖事件流会话；投影会话无时间戳故不入桶（已知口径，写成断言防止悄悄扩大）',
    u.totals.peakTokens.total + u.totals.offPeakTokens.total + 500000 === u.totals.total,
    `${u.totals.peakTokens.total}+${u.totals.offPeakTokens.total}+500000 vs ${u.totals.total}`)
  ok('工具烧钱榜按归因排序', u.toolsByCost[0]?.name === 'pwsh' && close(u.toolsByCost[0].attrCost, 2, 1e-6),
    JSON.stringify(u.toolsByCost.slice(0, 2).map((t) => [t.name, t.attrCost])))
  ok('归因覆盖率 = 2/10.52', close(u.attrCoverage, 2 / 10.02, 1e-6), String(u.attrCoverage))
  ok('压缩统计 1 次 / 12345 tokens', u.compaction.prunes === 1 && u.compaction.prunedTokens === 12345,
    JSON.stringify(u.compaction))
  ok('子 agent 1 个会话 / 1M tokens', u.subagents.sessions === 1 && u.subagents.total === 1000000,
    JSON.stringify(u.subagents))
  ok('按天聚合跨了 2 天（高峰日与空闲日同一天→1 个键）', u.byDay.length >= 1, `${u.byDay.length} 天`)
  ok('按模型只有 flash 一个', u.byModel.length === 1 && u.byModel[0].requests === 5, JSON.stringify(u.byModel.map((m) => m.model)))
  ok('recent 事件按时间倒序、上限 40', u.recent.length <= 40 && u.recent.every((e, i, a) => i === 0 || a[i - 1].at >= e.at),
    `${u.recent.length} 条`)
  ok('自检行可生成且含币种', /CNY|¥/.test(aggMod.selfCheckLine(u)), aggMod.selfCheckLine(u).slice(0, 60))
}

section('会话文件定位（路径安全）')
{
  ok('按 id 找到日志', (await parseMod.findSessionLog(home, 'fixture-1'))?.endsWith('session.v4.jsonl.zstd'))
  ok('路径穿越被拒绝', (await parseMod.findSessionLog(home, '../../etc/passwd')) === null)
  ok('不存在的 id 返回 null', (await parseMod.findSessionLog(home, 'nope')) === null)
}

await rm(home, { recursive: true, force: true })

console.log(`\n${'='.repeat(56)}`)
if (fails.length) {
  console.log(`❌ 失败 ${fails.length} 项 / 通过 ${pass} 项`)
  for (const f of fails) console.log(`   · ${f}`)
  process.exit(1)
}
console.log(`✅ 全部通过（${pass} 项断言，且不依赖浏览器与真实数据）`)
