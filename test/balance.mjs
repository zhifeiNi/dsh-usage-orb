/**
 * 余额 / 水位的单元测试 —— 不依赖浏览器、不依赖 ctx、不依赖真实 DSH_HOME。
 * 覆盖：返回形状归一化、合计、水位点推进规则（掉血 / 充值 / 最小间隔 / 上限）、落盘与再读。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0
const fails = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fails.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const section = (t) => console.log(`\n===== ${t} =====`)

const B = await import(new URL('../lib/balance.js', import.meta.url).href)

section('返回形状归一化')
{
  ok('null → none', B.normalizeBalance(null).status === 'none')
  ok('undefined → none', B.normalizeBalance(undefined).status === 'none')
  ok('failed → failed', B.normalizeBalance({ status: 'failed' }).status === 'failed')
  const ready = B.normalizeBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '23.32' }],
    bonusWallets: [{ currency: 'CNY', balance: '29.31' }]
  })
  ok('ready → 钱包与赠送钱包都映射出来',
    ready.status === 'ready' && ready.wallets[0].balance === '23.32' && ready.bonusWallets[0].balance === '29.31')
  ok('ready 但缺 bonusWallets → 空数组（不炸）', B.normalizeBalance({ status: 'ready', value: [] }).bonusWallets.length === 0)
  ok('裸数组 → ready', B.normalizeBalance([{ currency: 'CNY', balance: '1' }]).status === 'ready')
  ok('未知形状 → unknown（不猜）', B.normalizeBalance({ status: 'weird' }).status === 'unknown')
}

section('余额合计')
{
  const v = B.normalizeBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '23.32' }],
    bonusWallets: [{ currency: 'CNY', balance: '29.31' }]
  })
  ok('充值 + 赠送 = 52.63', Math.abs(B.balanceTotalOf(v) - 52.63) < 1e-9, String(B.balanceTotalOf(v)))
  ok('非 ready → null', B.balanceTotalOf({ status: 'none' }) === null && B.balanceTotalOf(null) === null)
  const str = B.normalizeBalance({ status: 'ready', value: [{ currency: 'CNY', balance: '1.005' }], bonusWallets: [] })
  ok('字符串金额按数字相加', Math.abs(B.balanceTotalOf(str) - 1.005) < 1e-9)
}

section('水位点推进规则（纯函数）')
{
  const hist = { points: [], recharges: [] }
  const r1 = B.applyHistoryPoint(hist, 100, 1000)
  ok('第一个点直接落，delta=0', hist.points.length === 1 && r1.delta === 0 && r1.recharge === null)

  const r2 = B.applyHistoryPoint(hist, 99.5, 1000 + B.MIN_GAP_MS + 1)
  ok('下降 → delta 为负', Math.abs(r2.delta - (-0.5)) < 1e-9, String(r2.delta))
  ok('距上一点够久 → 落新点', hist.points.length === 2)

  const r3 = B.applyHistoryPoint(hist, 99.4, 1000 + 2 * B.MIN_GAP_MS + 2)
  ok('间隔不足 → 不落点但照算 delta', (() => {
    const h2 = { points: [{ t: 5000, total: 10 }], recharges: [] }
    const rr = B.applyHistoryPoint(h2, 9, 5030)   // 30s < MIN_GAP_MS
    return h2.points.length === 1 && Math.abs(rr.delta + 1) < 1e-9
  })())

  const h3 = { points: [{ t: 5000, total: 10 }], recharges: [] }
  const r4 = B.applyHistoryPoint(h3, 111, 5000 + B.MIN_GAP_MS)
  ok('上升超过 ¥1 → 记一次充值', r4.recharge !== null && Math.abs(r4.recharge.amount - 101) < 1e-9, JSON.stringify(r4.recharge))
  ok('上升不超过 ¥1 → 不算充值', (() => {
    const h4 = { points: [{ t: 1, total: 10 }], recharges: [] }
    return B.applyHistoryPoint(h4, 10.5, 1 + B.MIN_GAP_MS).recharge === null
  })())

  const h5 = { points: [], recharges: [] }
  for (let i = 0; i < B.HISTORY_MAX + 60; i++) B.applyHistoryPoint(h5, 100 + i, i * (B.MIN_GAP_MS + 1))
  ok(`点数上限 ${B.HISTORY_MAX}（超出的从最老的丢起）`, h5.points.length === B.HISTORY_MAX, String(h5.points.length))
  ok('丢的是最老的（末点仍是最新值）', h5.points[h5.points.length - 1].total === 100 + B.HISTORY_MAX + 59, String(h5.points[h5.points.length - 1].total))
  ok('充值列表也有上限', (() => {
    const h6 = { points: [], recharges: [] }
    for (let i = 0; i < B.RECHARGE_KEEP + 20; i++) B.applyHistoryPoint(h6, 1000 * (i + 1), i * (B.MIN_GAP_MS + 1))
    return h6.recharges.length === B.RECHARGE_KEEP
  })())
}

section('落盘与再读（临时文件）')
{
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bal-'))
  const file = join(dir, 'balance-history.json')
  const v = (n) => B.normalizeBalance({ status: 'ready', value: [{ currency: 'CNY', balance: String(n) }], bonusWallets: [] })

  const first = await B.recordBalanceAt({ file, value: v(100), now: 1_000_000 })
  ok('首次：1 个点 / 无 delta', first.history.length === 1 && first.delta === 0 && first.deltaAt === 0)
  const raw = JSON.parse(await readFile(file, 'utf8'))
  ok('文件已落盘且结构正确', raw.version === 1 && raw.points.length === 1 && Array.isArray(raw.recharges))

  const second = await B.recordBalanceAt({ file, value: v(99), now: 1_000_000 + B.MIN_GAP_MS + 1 })
  ok('掉血：delta < 0 且 deltaAt 有值', second.delta < 0 && second.deltaAt > 0, `${second.delta} @ ${second.deltaAt}`)

  const third = await B.recordBalanceAt({ file, value: v(199), now: 1_000_000 + 2 * (B.MIN_GAP_MS + 1) })
  ok('充值被识别并持久化', third.recharges.length === 1 && Math.abs(third.recharges[0].amount - 100) < 1e-9, JSON.stringify(third.recharges))
  ok('充值后 delta 归零（不再报掉血）', third.delta === 0 && third.deltaAt === 0)

  const nonReady = await B.recordBalanceAt({ file, value: { status: 'failed' }, now: 2_000_000 })
  ok('非 ready：不写文件、返回空结构', nonReady.history.length === 0 && nonReady.delta === 0)
  ok('返回的 history 不超过 HISTORY_RETURN', third.history.length <= B.HISTORY_RETURN, String(third.history.length))

  await rm(dir, { recursive: true, force: true })
}

console.log(`\n${'='.repeat(56)}`)
if (fails.length) {
  console.log(`❌ 失败 ${fails.length} 项 / 通过 ${pass} 项`)
  for (const f of fails) console.log(`   · ${f}`)
  process.exit(1)
}
console.log(`✅ 全部通过（${pass} 项断言）`)
