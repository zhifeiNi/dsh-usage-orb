/**
 * dsh-usage-orb — host 侧入口
 *
 * 职责：
 *   1) 注册 JSON 路由 /usage-panel/api/usage（数据由 lib/usage.js 聚合）
 *   2) 启动自检：把聚合结果打到宿主日志，便于确认数据正确
 *
 * 数据层细节见 lib/usage.js 顶部注释（事件流多帧 zstd、投影降级、成本口径）。
 * 本文件只做「接线」，不写任何 DSH 数据目录；路由处理器绝不抛出未捕获异常。
 */

import {
  collectUsage, selfCheckLine, clearUsageCache, PANEL_VERSION, resolveDshHome,
  findSessionLog, parseSessionDetail
} from './usage.js'
import { loadPrices } from './prices.js'
import {
  BALANCE_TTL_MS,
  normalizeBalance,
  balanceTotalOf,
  recordBalanceAt
} from './balance.js'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export const name = 'dsh-usage-orb'

/** 客户端错误上报路由（GET + 查询参数，避免解析 body） */
const CLIENT_LOG_ROUTE = '/usage-panel/api/client-log'

/** 依赖宿主服务：webServer 用于注册 JSON 路由 */
export const inject = ['webServer']

const ROUTE_PATH = '/usage-panel/api/usage'
const ICON_ROUTE = '/usage-panel/api/icon'
const DETAIL_ROUTE = '/usage-panel/api/session'
const BLOUB_ROUTE = '/usage-panel/api/bloub.js'
const BLOUB_LIST_ROUTE = '/usage-panel/api/bloub'
const MAX_BODY = 64 * 1024

/* ------------------------------------------------------------------ *
 * 按钮图标
 *
 * 浏览器读不到 D:\ 路径，所以由 host 读文件 → 清洗（去掉 script/style）
 * → 统一着色 → 以 image/svg+xml 提供。路径可用
 * $DSH_HOME/usage-panel/config.json 的 buttonIconPath 覆盖。
 * ------------------------------------------------------------------ */

const DEFAULT_ICON_REL = 'favicon.svg'
/* 插件自带的鲸鱼（lib/icon.svg）。默认图标必须与「当前在哪个工作区」无关——
   旧默认是相对路径 favicon.svg，会跟着最近活动会话的工作区找，找不到就回落成柱状图兜底图标。 */
const LOCAL_ICON_URL = new URL('./icon.svg', import.meta.url)
const urlToPath = (u) => decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const LOCAL_ICON_PATH = urlToPath(LOCAL_ICON_URL)
const FALLBACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<rect x="3" y="13" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/>' +
  '<rect x="17" y="3" width="4" height="18" rx="1"/></svg>'

let configCache = { at: 0, value: null }
/** 最近一次聚合里「最新活动会话」的工作区，作为相对路径的首选根 */
let lastWorkspaceCwd = null

async function getConfig() {
  const now = Date.now()
  if (configCache.value && now - configCache.at < 30_000) return configCache.value
  let value = {}
  try {
    value = JSON.parse(await readFile(join(resolveDshHome(), 'usage-panel', 'config.json'), 'utf8')) ?? {}
  } catch {
    /* 没有配置文件就用默认 */
  }
  configCache = { at: now, value }
  return value
}

const exists = async (p) => {
  try { await stat(p); return true } catch { return false }
}

/**
 * 解析图标路径。默认值是**相对路径** favicon.svg，跟着工作区走：
 * 换机器、移动目录都不会坏。
 * 相对路径依次尝试：① 最近活动会话的工作区 ② host 进程 cwd ③ $DSH_HOME
 */
async function resolveIconPath(cfg) {
  const configured = String(cfg?.buttonIconPath ?? '').trim()
  /* 没有显式配置 → 用插件自带鲸鱼（绝对路径，永远存在，与工作区无关） */
  if (!configured) return { path: LOCAL_ICON_PATH, tried: [LOCAL_ICON_PATH], resolvedBy: 'plugin' }
  const raw = configured
  if (isAbsolute(raw)) return { path: raw, tried: [raw], resolvedBy: 'absolute' }

  const roots = []
  if (lastWorkspaceCwd) roots.push({ dir: lastWorkspaceCwd, by: 'workspace' })
  try { roots.push({ dir: process.cwd(), by: 'cwd' }) } catch { /* ignore */ }
  roots.push({ dir: resolveDshHome(), by: 'dsh-home' })

  const tried = []
  for (const r of roots) {
    const p = join(r.dir, raw)
    tried.push(p)
    if (await exists(p)) return { path: p, tried, resolvedBy: r.by }
  }
  return { path: join(roots[0]?.dir ?? '.', raw), tried, resolvedBy: 'unresolved' }
}

/** 只接受十六进制颜色，避免把任意 CSS 注进 SVG */
const safeColor = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c ?? '') ? c : '#e9eaec')

function sanitizeSvg(text, color) {
  const style = '<style>svg{width:100%;height:100%;display:block}' +
    `path,circle,rect,polygon,polyline,ellipse,line{fill:${safeColor(color)}}</style>`
  let svg = String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  if (/<svg/i.test(svg)) svg = svg.replace(/<svg([^>]*)>/i, `<svg$1>${style}`)
  else svg = FALLBACK_ICON.replace(/<svg([^>]*)>/i, `<svg$1>${style}`)
  return svg
}

/** 供 meta 使用：图标是否可用 + 实际解析到的路径 */
async function probeIcon() {
  const cfg = await getConfig()
  const resolved = await resolveIconPath(cfg)
  try {
    const info = await stat(resolved.path)
    return {
      available: true,
      path: resolved.path,
      resolvedBy: resolved.resolvedBy,
      bytes: info.size,
      tried: resolved.tried.length > 1 ? resolved.tried : undefined
    }
  } catch (error) {
    return {
      available: false,
      path: resolved.path,
      resolvedBy: resolved.resolvedBy,
      tried: resolved.tried,
      error: String(error?.code ?? error?.message ?? error)
    }
  }
}

/* ------------------------------------------------------------------ *
 * 账户余额（可选能力，失败必须静默降级）
 * ------------------------------------------------------------------ */

let balanceCache = { at: 0, value: null }

/** 取可选服务：用 reflect.get，避免把服务名写进 inject 导致加载失败 */
function getAccountService(ctx) {
  try {
    const get = ctx.reflect?.get
    if (typeof get !== 'function') return null
    return get.call(ctx.reflect, 'deepseekAccount') ?? null
  } catch {
    return null
  }
}

/**
 * 构造账户平台要求的 client 元数据。
 *
 * 契约（从 app.asar 里读到）：
 *   getBalance(client) → detailHeaders(client)
 *   client = { version: string, locale: string, timezoneOffsetSeconds: number }
 *   客户端侧 version 取自编译期常量 DSH_CLIENT_VERSION（bundle 里是 "0.2.0-rc.2"）；
 *   host 侧没有该常量，因此按「能探测到的版本 → 已安装运行时版本」依次退化。
 */
function clientMetadata() {
  const candidates = []
  try {
    const v = process.env.DSH_CLIENT_VERSION
    if (v) candidates.push(v)
  } catch { /* ignore */ }
  // 已安装桌面运行时的版本（与本机 app.asar 一致，仅用于平台兼容头）
  candidates.push('0.2.0-rc.2')
  let locale = 'zh-CN'
  try { locale = Intl.DateTimeFormat().resolvedOptions().locale || locale } catch { /* ignore */ }
  return {
    version: candidates.find((x) => typeof x === 'string' && x !== '') ?? '0.0.0',
    locale,
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
  }
}

let balanceProbeLogged = false

/* ------------------------------------------------------------------ *
 * P3 余额水位曲线 / P2 掉血与充值检测
 *
 * 每分钟记一个点，落在插件自己的目录（不碰 DSH 数据目录）：
 *   $DSH_HOME/usage-panel/balance-history.json
 * 由此得到：余额历史曲线、充值事件（余额跳升）、掉血 delta（余额下降）。
 * ------------------------------------------------------------------ */

const historyPath = () => join(resolveDshHome(), 'usage-panel', 'balance-history.json')

/** 记录一个点（实现与规则都在 balance.js，这里只注入本机的路径） */
const recordBalance = (value) => recordBalanceAt({ file: historyPath(), value })

/** 仅测试用：注入一个 ready 余额，让 E2E 能覆盖「账户服务可用」的真实路径 */
function fakeBalance() {
  const raw = process.env.USAGE_PANEL_FAKE_BALANCE
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    return {
      status: 'ready',
      wallets: [{ currency: o.currency ?? 'CNY', balance: String(o.balance ?? '23.32') }],
      bonusWallets: [{ currency: o.currency ?? 'CNY', balance: String(o.bonus ?? '2.86') }]
    }
  } catch {
    return { status: 'ready', wallets: [{ currency: 'CNY', balance: '23.32' }], bonusWallets: [{ currency: 'CNY', balance: '2.86' }] }
  }
}

async function readBalance(ctx) {
  const fake = fakeBalance()
  if (fake) {
    const hist = await recordBalance(fake)
    return { ...fake, ...hist }
  }
  const now = Date.now()
  if (balanceCache.value && now - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value
  const svc = getAccountService(ctx)
  if (!svc) return { status: 'unavailable' }
  if (typeof svc.getBalance !== 'function') return { status: 'unavailable', note: 'getBalance 不可用' }
  const client = clientMetadata()
  try {
    const raw = await svc.getBalance(client)
    const value = normalizeBalance(raw)
    // P3 水位曲线 / P2 充值检测与掉血：只在真正取到新值时记一个点
    try {
      Object.assign(value, await recordBalance(value))
    } catch { /* 历史记录失败不影响余额本身 */ }
    if (!balanceProbeLogged) {
      balanceProbeLogged = true
      console.log(
        `[dsh-usage-orb] 余额读取成功：client=${JSON.stringify(client)} → ` +
        JSON.stringify(value).slice(0, 300)
      )
    }
    balanceCache = { at: now, value }
    return value
  } catch (error) {
    if (!balanceProbeLogged) {
      balanceProbeLogged = true
      console.log(
        `[dsh-usage-orb] 余额读取失败：client=${JSON.stringify(client)} → ` +
        String(error?.message ?? error).slice(0, 200)
      )
    }
    return { status: 'error', message: String(error?.message ?? error).slice(0, 200) }
  }
}

function writeJson(res, status, payload) {
  let body
  try {
    body = JSON.stringify(payload)
  } catch {
    body = JSON.stringify({ ok: false, error: { code: 'encode', message: 'failed to encode response' } })
    status = 500
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  return JSON.parse(text)
}

export function apply(ctx) {
  /* 自检只打一次（见下面 usage 聚合处） */
  let loggedSelfCheck = false
  console.log(`[dsh-usage-orb] host 侧已加载（v${PANEL_VERSION}）`)

  /*
   * 探测宿主的服务面（为将来接「账户余额」做调研）。
   * 注意：逐个试名字是**无效**的 —— Cordis 的 ctx 是 Proxy，访问任何未知属性
   * 都会抛 "cannot get property ... without inject"，所以「报错」不能证明服务存在。
   * 只能枚举真实注册表 / 反射面。
   */
  ctx.effect(() => {
    const bits = []
    const safe = (fn, label) => {
      try {
        const v = fn()
        bits.push(`${label}=${v === undefined ? 'undefined' : typeof v === 'object' && v !== null ? '[' + Object.keys(v).slice(0, 12).join(',') + ']' : String(v).slice(0, 40)}`)
      } catch (e) {
        bits.push(`${label}=ERR(${String(e?.message ?? '').slice(0, 24)})`)
      }
    }
    safe(() => Reflect.ownKeys(ctx).map(String).join(',').slice(0, 200), 'ownKeys')
    safe(() => ctx.root, 'root')
    safe(() => ctx.reflect, 'reflect')
    safe(() => ctx.registry, 'registry')
    safe(() => Object.keys(ctx).join(','), 'keys')
    console.log(`[dsh-usage-orb] ctx 反射面：${bits.join(' | ')}`)
    return undefined
  }, 'dsh-usage-panel: service surface')

  /*
   * 账户余额：走宿主的账户服务，而不是自己去联网 / 碰凭据。
   *
   * 依据（从 app.asar 里读到的实现）：
   *   @deepseek-ai/dsh-api-account-controller
   *     getBalance(client) { return this.ctx.deepseekAccount.getBalance(client) }
   *   返回：null | { status:'ready', value:[{currency:'CNY'|'USD', balance}], bonusWallets:[…] }
   *         | { status:'failed' }
   *
   * 用 ctx.reflect.get(name) 取可选服务（**不写进 inject**）：服务名写错会让插件
   * 直接加载失败，而余额只是锦上添花，不该拿主功能去赌。
   */
  ctx.effect(() => {
    try {
      const svc = getAccountService(ctx)
      if (!svc) {
        console.log('[dsh-usage-orb] 账户服务：未找到（ctx.reflect.get("deepseekAccount") 为空）')
      } else {
        const proto = Object.getPrototypeOf(svc)
        const methods = Object.getOwnPropertyNames(proto).filter((n) => {
          try { return typeof svc[n] === 'function' } catch { return false }
        })
        console.log(`[dsh-usage-orb] 账户服务：可用 · 方法 ${methods.slice(0, 24).join(',') || '(无)'}`)
      }
    } catch (error) {
      console.log('[dsh-usage-orb] 账户服务探测失败：' + String(error?.message ?? error))
    }
    return undefined
  }, 'dsh-usage-panel: account service probe')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: (req, res) => {
          void (async () => {
            try {
              if (req.method !== 'POST' && req.method !== 'GET') {
                writeJson(res, 405, { ok: false, error: { code: 'method', message: 'POST or GET only' } })
                return
              }
              let force = false
              if (req.method === 'POST') {
                try {
                  const body = await readJsonBody(req)
                  force = body?.force === true
                } catch {
                  // 请求体不可解析时按默认处理，不报错
                }
              } else if (typeof req.url === 'string' && /[?&]force=1/.test(req.url)) {
                force = true
              }
              const usage = await collectUsage({ force })
              // 记下「最新活动会话的工作区」：相对图标路径优先跟着它走
              try {
                const newest = [...(usage.sessions ?? [])].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]
                if (newest?.cwd) lastWorkspaceCwd = newest.cwd
              } catch { /* ignore */ }
              // 余额是可选能力：任何失败都只写进 meta，不影响用量数据
              try {
                usage.meta.balance = await readBalance(ctx)
              } catch (error) {
                usage.meta.balance = { status: 'error', message: String(error?.message ?? error).slice(0, 120) }
              }
              try {
                usage.meta.icon = await probeIcon()
              } catch {
                usage.meta.icon = { available: false, path: DEFAULT_ICON_REL, error: 'probe-failed' }
              }
              writeJson(res, 200, { ok: true, usage })
            } catch (error) {
              writeJson(res, 500, {
                ok: false,
                error: { code: 'collect-failed', message: error?.message ?? String(error) }
              })
            }
          })()
        }
      }),
    'dsh-usage-panel: usage route'
  )

  /* 按钮图标：host 读文件 → 清洗 → 着色 → SVG */
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ICON_ROUTE,
        handler: (req, res) => {
          void (async () => {
            try {
              let color = '#e9eaec'
              try {
                const u = new URL(req.url ?? '/', 'http://127.0.0.1')
                color = safeColor(u.searchParams.get('color') ?? color)
              } catch { /* 用默认色 */ }
              const cfg = await getConfig()
              let text = null
              try {
                text = await readFile((await resolveIconPath(cfg)).path, 'utf8')
              } catch {
                text = null // 读不到 → 用内置字形
              }
              const body = Buffer.from(sanitizeSvg(text ?? FALLBACK_ICON, color), 'utf8')
              res.writeHead(200, {
                'content-type': 'image/svg+xml; charset=utf-8',
                'cache-control': 'no-store',
                'content-length': body.length
              })
              res.end(body)
            } catch (error) {
              res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('icon-failed: ' + String(error?.message ?? error))
            }
          })()
        }
      }),
    'dsh-usage-panel: icon route'
  )

  /*
   * E 组：单会话逐轮下钻。按需解析（不进主载荷），只允许 sessions 目录下真实存在的会话 id，
   * 因此不存在任意路径读取。
   */
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: DETAIL_ROUTE,
        handler: (req, res) => {
          void (async () => {
            const started = Date.now()
            try {
              let id = ''
              try {
                id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('id') ?? ''
              } catch { /* 参数坏了按空处理 */ }
              const dshHome = resolveDshHome()
              const file = await findSessionLog(dshHome, id)
              if (!file) {
                writeJson(res, 404, {
                  ok: false,
                  error: {
                    code: 'not-found',
                    message: '没有这个会话的事件流（投影缓存会话无法下钻）'
                  }
                })
                return
              }
              const prices = await loadPrices(dshHome)
              const detail = await parseSessionDetail(file, prices)
              if (detail?.error) {
                writeJson(res, 500, { ok: false, error: { code: detail.error, message: '解析失败' } })
                return
              }
              detail.queryMs = Date.now() - started
              writeJson(res, 200, { ok: true, detail })
            } catch (error) {
              writeJson(res, 500, {
                ok: false,
                error: { code: 'internal', message: String(error?.message ?? error).slice(0, 200) }
              })
            }
          })()
        }
      }),
    'dsh-usage-panel: session detail route'
  )

  ctx.effect(() => {
    let cancelled = false
    collectUsage()
      .then((usage) => {
        if (cancelled) return
        /* 只有第一次聚合才打印自检与警告：原来每次请求都打，崩溃日志会把它当作"死前最后一句话"，容易被误判成插件报错 */
        if (!loggedSelfCheck) {
          loggedSelfCheck = true
          console.log(`[dsh-usage-orb] 自检：${selfCheckLine(usage)}`)
          for (const w of usage.meta.warnings) console.warn(`[dsh-usage-orb] 注意：${w}`)
        }
      })
      .catch((error) => {
        console.error('[dsh-usage-orb] 自检失败：', error)
      })
    return () => {
      cancelled = true
      clearUsageCache()
    }
  }, 'dsh-usage-panel: startup self-check')

  return undefined
}

export default { name, inject, apply }
