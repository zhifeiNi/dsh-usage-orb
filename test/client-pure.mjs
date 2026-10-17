/**
 * 客户端纯函数单测。
 *
 * 客户端 bundle 受插件契约限制不能 import 我们自己的模块，所以这里换个办法：
 * 从 client.js 里取出 /* PURE-START *\/ … /* PURE-END *\/ 之间的代码，
 * 在 Node 里求值（那段不碰 DOM / React / localStorage），然后断言。
 * 不需要打包器，也不破坏插件契约。
 */
import { readFile } from 'node:fs/promises'

let pass = 0
const fails = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fails.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const section = (t) => console.log(`\n===== ${t} =====`)
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))

const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const a = src.indexOf('/* PURE-START')
const b = src.indexOf('/* PURE-END */')
ok('client.js 里有 PURE 区块', a > 0 && b > a, `${a} → ${b}`)
if (a < 0 || b < 0) process.exit(1)
const block = src.slice(src.indexOf('\n', a) + 1, b)
const PURE = new Function(block + '\n return PURE')()

section('数字格式')
{
  ok('cn(1.5e8) = 1.50亿', PURE.cn(1.5e8) === '1.50亿', PURE.cn(1.5e8))
  ok('cn(4738.2万) = 4738.2万', PURE.cn(47382000) === '4738.2万', PURE.cn(47382000))
  ok('cn(999) 不带单位', PURE.cn(999) === '999', PURE.cn(999))
  ok('cn 非数字 → 破折号（不显示 NaN）', PURE.cn(NaN) === '—')
  ok('cnUnit', PURE.cnUnit(1.5e8) === '亿' && PURE.cnUnit(5e4) === '万' && PURE.cnUnit(999) === '')
  ok('pct(0.9967,2) = 99.67%', PURE.pct(0.9967, 2) === '99.67%', PURE.pct(0.9967, 2))
  ok('pctNum(0.66,0) = 66', PURE.pctNum(0.66, 0) === '66')
  ok('money(2730) = ¥2.73K（与面板一致）', PURE.money(2730) === '¥2.73K', PURE.money(2730))
  ok('money(86.56) = ¥86.56', PURE.money(86.56) === '¥86.56', PURE.money(86.56))
  ok('money 支持其他币种符号', PURE.money(6.02, '$') === '$6.02', PURE.money(6.02, '$'))
  ok('money 非数字 → 破折号', PURE.money(undefined) === '—')
}

section('顺序与卡片方案')
{
  const keys = ['a', 'b', 'c']
  ok('normalizeOrder：去重 + 丢未知 + 补齐缺失',
    JSON.stringify(PURE.normalizeOrder(['b', 'b', 'zz'], keys)) === JSON.stringify(['b', 'a', 'c']))
  ok('normalizeOrder：非数组也能兜住', JSON.stringify(PURE.normalizeOrder(null, keys)) === JSON.stringify(keys))

  const plan = PURE.planCards({
    order: ['c', 'a', 'b'], keys,
    hidden: ['a'], spans: { c: 2, b: 9 }, rows: { c: 2, b: 0 }
  })
  ok('planCards：按顺序、过滤隐藏项', JSON.stringify(plan.map((p) => p.key)) === JSON.stringify(['c', 'b']), JSON.stringify(plan.map((p) => p.key)))
  ok('planCards：宽高被夹到合法范围', plan[0].span === 2 && plan[0].rows === 2 && plan[1].span === 3 && plan[1].rows === 1, JSON.stringify(plan))
  ok('planCards：未配置的默认 1×1', PURE.planCards({ order: ['a'], keys, hidden: [], spans: {}, rows: {} })[0].span === 1)
  ok('clampInt：非法值回落默认', PURE.clampInt('x', 1, 3, 1) === 1 && PURE.clampInt(99, 1, 3, 1) === 3)
}

section('模拟器成本重算')
{
  const rate = { cacheHit: 0.02, cacheMiss: 1, output: 4 }      // flash 空闲价（¥/1M）
  const peak = { uncachedInput: 1000000, cacheRead: 0, output: 0 }
  const off = { uncachedInput: 0, cacheRead: 1000000, output: 1000000 }
  const mult = 2
  const base = PURE.simCost({ peak, off, rate, mult, moveFrac: 0, hitPct: null })
  const expectBase = (1000000 * 1 * 2 + 1000000 * 0.02 + 1000000 * 4) / 1e6
  ok('moveFrac=0 时等于实际成本（¥6.02）', close(base, expectBase) && close(base, 6.02), String(base))

  const moved = PURE.simCost({ peak, off, rate, mult, moveFrac: 1, hitPct: null })
  ok('高峰全挪到空闲 = 成本 − 高峰×(1−1/倍率)', close(moved, 6.02 - 2 * (1 - 1 / 2)), String(moved))
  const half = PURE.simCost({ peak, off, rate, mult, moveFrac: 0.5, hitPct: null })
  ok('挪一半恰好落在两者中间', close(half, (base + moved) / 2), String(half))

  const noCache = PURE.simCost({
    peak: { uncachedInput: 0, cacheRead: 1000000, output: 0 }, off: { uncachedInput: 0, cacheRead: 0, output: 0 },
    rate, mult, moveFrac: 0, hitPct: 0
  })
  ok('命中率假设 0% → 全部按未缓存价（¥2.00）', close(noCache, 2), String(noCache))
  const allCache = PURE.simCost({
    peak: { uncachedInput: 0, cacheRead: 1000000, output: 0 }, off: { uncachedInput: 0, cacheRead: 0, output: 0 },
    rate, mult, moveFrac: 0, hitPct: 100
  })
  ok('命中率假设 100% → 全部按缓存价（¥0.04）', close(allCache, 0.04), String(allCache))
  ok('moveFrac 越界会被夹住', close(PURE.simCost({ peak, off, rate, mult, moveFrac: 5, hitPct: null }), moved))
}

console.log(`\n${'='.repeat(56)}`)
if (fails.length) {
  console.log(`❌ 失败 ${fails.length} 项 / 通过 ${pass} 项`)
  for (const f of fails) console.log(`   · ${f}`)
  process.exit(1)
}
console.log(`✅ 全部通过（${pass} 项断言，直接测客户端纯函数）`)
