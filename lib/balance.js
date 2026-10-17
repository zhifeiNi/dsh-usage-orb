/**
 * dsh-usage-orb — 余额与水位
 *
 * 这里放「能脱离宿主环境测试」的部分：返回形状归一化、合计、水位点的推进规则。
 * 需要 ctx 的服务查找与读取入口仍在 index.js（那里才有 Cordis 上下文）。
 *
 * 水位文件落在插件自己的目录，不碰 DSH 数据目录：
 *   $DSH_HOME/usage-panel/balance-history.json
 * 由此得到：历史曲线、充值事件（余额跳升）、掉血 delta（余额下降）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const BALANCE_TTL_MS = 60_000
export const HISTORY_MAX = 1440          // 最多留 1 天的分钟级点
export const HISTORY_RETURN = 180        // 返回给前端的点数（3 小时）
export const MIN_GAP_MS = 55_000
export const RECHARGE_MIN = 1            // 余额上升超过 ¥1 视为充值
export const RECHARGE_KEEP = 60
export const RECHARGE_RETURN = 10

/** 把账户服务的返回归一化成前端好用的形状 */
export function normalizeBalance(raw) {
  if (raw === null || raw === undefined) return { status: 'none' }
  if (raw?.status === 'failed') return { status: 'failed' }
  if (raw?.status === 'ready') {
    const map = (list) => (Array.isArray(list) ? list : []).map((w) => ({
      currency: w?.currency ?? null,
      balance: w?.balance ?? null
    }))
    return { status: 'ready', wallets: map(raw.value), bonusWallets: map(raw.bonusWallets) }
  }
  if (Array.isArray(raw)) {
    return {
      status: 'ready',
      wallets: raw.map((w) => ({ currency: w?.currency ?? null, balance: w?.balance ?? null })),
      bonusWallets: []
    }
  }
  return { status: 'unknown' }
}

/** 余额合计（充值 + 赠送，同币种相加）；非 ready 返回 null */
export function balanceTotalOf(value) {
  if (!value || value.status !== 'ready') return null
  const sum = (l) => (l ?? []).reduce((a, w) => a + (Number(w?.balance) || 0), 0)
  return sum(value.wallets) + sum(value.bonusWallets)
}

/** 读水位文件（不存在/损坏都返回空结构） */
export async function loadHistory(file) {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'))
    return {
      points: Array.isArray(raw?.points) ? raw.points : [],
      recharges: Array.isArray(raw?.recharges) ? raw.recharges : []
    }
  } catch {
    return { points: [], recharges: [] }
  }
}

/**
 * 纯函数：把一个新的余额合计推进到 hist 里，返回本次的 delta 与是否记了充值。
 * 规则：delta = 本次 - 上一个点；> RECHARGE_MIN 记充值；距上一点 >= MIN_GAP_MS 才落新点。
 */
export function applyHistoryPoint(hist, total, now) {
  const last = hist.points[hist.points.length - 1]
  let delta = 0
  let recharge = null
  if (last) {
    delta = Number((total - last.total).toFixed(4))
    if (delta > RECHARGE_MIN) {
      recharge = { t: now, amount: +delta.toFixed(2) }
      hist.recharges = [...hist.recharges, recharge].slice(-RECHARGE_KEEP)
    }
    if (now - last.t >= MIN_GAP_MS) hist.points.push({ t: now, total: +total.toFixed(4) })
  } else {
    hist.points.push({ t: now, total: +total.toFixed(4) })
  }
  if (hist.points.length > HISTORY_MAX) hist.points.splice(0, hist.points.length - HISTORY_MAX)
  return { delta, recharge }
}

/** 记录一个点并落盘；返回给前端的形状 */
export async function recordBalanceAt({ file, value, now = Date.now() }) {
  const total = balanceTotalOf(value)
  if (total === null) return { history: [], recharges: [], delta: 0, deltaAt: 0 }
  const hist = await loadHistory(file)
  const { delta } = applyHistoryPoint(hist, total, now)
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ version: 1, points: hist.points, recharges: hist.recharges }), 'utf8')
  } catch { /* 写不进去也不能影响读数 */ }
  return {
    history: hist.points.slice(-HISTORY_RETURN),
    recharges: hist.recharges.slice(-RECHARGE_RETURN),
    delta: delta < 0 ? delta : 0,          // 只报告「掉血」
    deltaAt: delta < 0 ? now : 0
  }
}
