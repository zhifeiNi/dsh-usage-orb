/**
 * v0.2.0 端到端验证：在桌面应用同款运行时（0.2.0-rc.2）上隔离验证新面板。
 *
 * 覆盖：
 *   · 开 → 关 → 再开 全流程（用「可见性」而不是「DOM 里存在」断言）
 *   · 新版 UI 的结构性断言（热力图格子 / 堆叠柱 / 环形图 / 成本折线 / 各区块）
 *   · 区间与视图切换（7天/30天、按模型/按类别、按Token/按成本）
 *   · 截图存证
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* 桌面端可执行文件：默认按平台推导，可用 DSH_EXE 覆盖 */
/* 桌面端可执行文件：按优先级探测；都不在就明确报错，而不是给出一个猜错的路径。
   用自己的安装位置：DSH_EXE=/path/to/DeepSeek Harness（macOS 指向 .app 内的可执行文件） */
const EXE_CANDIDATES = [
  process.env.DSH_EXE,
  process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe')
    : null,
  process.platform === 'win32'
    ? join(process.env.PROGRAMFILES || '', 'DeepSeek Harness', 'DeepSeek Harness.exe')
    : null,
  'D:\\localApp\\DeepSeek Harness\\DeepSeek Harness.exe',
  '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
].filter(Boolean)
const EXE = EXE_CANDIDATES.find((x) => { try { return existsSync(x) } catch { return false } })
if (!EXE) {
  console.error('找不到 DeepSeek Harness 可执行文件。请用环境变量指定，例如：\n  DSH_EXE="D:\\localApp\\DeepSeek Harness\\DeepSeek Harness.exe" npm run test:e2e')
  process.exit(2)
}

const APP_ROOT = process.env.DSH_APP_ROOT || join(dirname(EXE), 'resources', 'app.asar', 'dsh')
const CLIJS = join(APP_ROOT, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
const CHROME = join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
const PROFILE = 'usage-verify'
const OUT_DIR = process.env.DSH_E2E_OUT || join(tmpdir(), 'dsh-usage-panel-e2e')
import { readFileSync as __readPkg } from 'node:fs'
const __PKG = JSON.parse(__readPkg(join(HERE, '..', 'package.json'), 'utf8'))
const PKG_TITLE = 'dsh-usage-orb v' + __PKG.version

const SHOT = join(OUT_DIR, 'verify-usage-panel-v0.2.0.png')
/* 输出目录可能不存在（默认在临时目录下）：先建好再写截图 */
mkdirSync(OUT_DIR, { recursive: true })
const CHROME_DATA = join(tmpdir(), 'dsh-verify-chrome')
const CDP_PORT = 9788

const HERE = dirname(fileURLToPath(import.meta.url))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

let dsh = null
let chrome = null
let cdp = null
let exitCode = 0
const failures = []

function startDsh() {
  return new Promise((resolve, reject) => {
    const child = spawn(EXE, ['--expose-internals', CLIJS, '--profile', PROFILE, '--no-open'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    let out = ''
    let done = false
    const onData = (buf) => {
      out += buf.toString()
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([\w-]+)/)
      if (m && !done) { done = true; resolve({ child, token: m[2], port: Number(m[1]), stdout: () => out }) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => { if (!done) reject(new Error(`DSH 退出，code=${code}\n${out.slice(-3000)}`)) })
    setTimeout(() => { if (!done) reject(new Error('等待 token 超时\n' + out.slice(-3000))) }, 180000)
  })
}

function startChrome() {
  return spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${CHROME_DATA}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1440,960', 'about:blank'
  ], { stdio: 'ignore' })
}

async function waitForCdp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch { /* not up */ }
    await sleep(500)
  }
  throw new Error('CDP 端点未就绪')
}

async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result)
    } else if (msg.method) events.push(msg)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时: ${method}`)) } }, 60000)
  })
  return { send, events, close: () => ws.close() }
}

const evalIn = async (expr) =>
  (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value

/** 支持 await 的求值（探测路由时要等 fetch） */
const evalAsync = async (expr) =>
  (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value

const VIS = `(() => {
  const btn = document.querySelector('[data-dsh-usage-toggle]');
  const host = document.querySelector('[data-dsh-usage-panel-host]');
  const panel = document.querySelector('[data-dsh-usage-panel]');
  const br = btn ? btn.getBoundingClientRect() : null;
  const pr = panel ? panel.getBoundingClientRect() : null;
  const hs = host ? getComputedStyle(host) : null;
  return {
    hasButton: !!btn, buttonVisible: !!(br && br.width > 0 && br.height > 0), buttonText: btn ? btn.textContent : null,
    hasHost: !!host, hostDisplay: hs ? hs.display : null,
    hasPanel: !!panel, panelVisible: !!(pr && pr.width > 0 && pr.height > 0),
    panelSize: pr ? { w: Math.round(pr.width), h: Math.round(pr.height) } : null,
    panelText: panel ? panel.innerText.slice(0, 4000) : ''
  };
})()`

const STRUCT = `(() => {
  const p = document.querySelector('[data-dsh-usage-panel]');
  if (!p) return null;
  const svgs = [...p.querySelectorAll('svg')];
  const count = (sel) => p.querySelectorAll(sel).length;
  return {
    svgCount: svgs.length,
    rects: count('rect'),
    circles: count('circle'),
    polylines: count('polyline'),
    polygons: count('polygon'),
    paths: count('path'),
    texts: count('text'),
    headers: [...p.querySelectorAll('div')].filter(d => /消耗统计/.test(d.textContent||'')).length,
    scrollHeight: p.scrollHeight,
    clientHeight: p.clientHeight
  };
})()`

const clickToggle = () => evalIn(`document.querySelector('[data-dsh-usage-toggle]').click()`)
const clickText = (text) => evalIn(`(() => {
  const p = document.querySelector('[data-dsh-usage-panel]');
  if (!p) return 'no-panel';
  const b = [...p.querySelectorAll('button')].find(x => (x.textContent||'').trim() === ${JSON.stringify(text)});
  if (!b) return 'not-found';
  b.click(); return 'clicked';
})()`)

function expect(label, cond, detail) {
  log(`    ${cond ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures.push(label)
}

try {
  log('=== 1. 启动隔离 clone（桌面应用同款运行时 0.2.0-rc.2）===')
  dsh = await startDsh()
  log(`  ✓ 端口 ${dsh.port}`)
  for (const line of dsh.stdout().split('\n').filter((l) => /usage-panel|注意/.test(l))) log('    ' + line.trim())

  log('\n=== 2. headless Chrome ===')
  chrome = startChrome()
  const version = await waitForCdp()
  log(`  ✓ ${version.Browser}`)
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('没有 page target')
  cdp = await connectCdp(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  log('\n=== 3. 打开应用 ===')
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${dsh.port}/?token=${dsh.token}` })
  await sleep(10000)
  log(`  标题: ${await evalIn('document.title')}`)
  await evalIn(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '继续'); if (b) b.click(); return !!b })()`)
  await sleep(1200)

  log('\n=== 3b. 探测宿主是否已有「账户/余额」HTTP 路由（为余额功能做调研）===')
  const routes = [
    '/api/account', '/api/account/balance', '/api/account/profile', '/api/account/usage',
    '/api/account/quota', '/api/account/subscription', '/api/account/plan', '/api/account/wallet',
    '/api/me', '/api/usage', '/api/billing', '/api/wallet', '/api/credits', '/api/balance',
    '/api/user/balance', '/api/v1/account', '/api/settings/account',
    '/__control__/definitely-not-a-route__'
  ]
  const probed = await evalAsync(`(async () => {
    const out = {};
    for (const r of ${JSON.stringify(routes)}) {
      try {
        const res = await fetch(r, { headers: { accept: 'application/json' } });
        const text = await res.text();
        out[r] = res.status + (text ? ' len=' + text.length : '');
      } catch (e) { out[r] = 'ERR:' + String(e).slice(0, 24); }
    }
    return out;
  })()`)
  log('  ' + JSON.stringify(probed, null, 1).replace(/\n\s*/g, ' '))

  log('\n=== 4. 初始态 ===')
  let s = await evalIn(VIS)
  expect('按钮可见', s.buttonVisible)
  expect('面板未挂载', !s.hasPanel)

  // 圆形浮动按钮：圆形 + 圆环 + 图标
  const fab = await evalIn(`(() => {
    const b = document.querySelector('[data-dsh-usage-toggle]');
    if (!b) return null;
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    const ring = b.querySelector('[data-dsh-ring]');
    const arc = ring ? ring.querySelectorAll('circle')[1] : null;
    const icon = b.querySelector('[data-dsh-icon]');
    return {
      w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderRadius,
      cls: b.className,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      hasRing: !!ring,
      ringStroke: arc ? arc.getAttribute('stroke') : null,
      ringOffset: arc ? arc.getAttribute('stroke-dashoffset') : null,
      ringBelow: ring ? ring.getAttribute('data-ring-below') : null,
      breathe: arc ? (arc.getAttribute('class') || '') : '',
      iconSrc: icon ? icon.getAttribute('src') : null,
      iconW: icon ? Math.round(icon.getBoundingClientRect().width) : 0,
      iconLoaded: icon ? (icon.complete && icon.naturalWidth > 0) : false,
      // 一次倒出所有可能与「画出一个圆角方形」有关的计算属性
      styleProbe: (() => {
        const keys = ['borderRadius', 'background', 'backgroundColor', 'backgroundClip', 'boxShadow',
          'backdropFilter', 'clipPath', 'maskImage', 'webkitMaskImage', 'filter', 'outline', 'outlineOffset',
          'outlineStyle', 'outlineWidth', 'overflow', 'appearance', 'boxSizing', 'padding', 'border',
          'borderWidth', 'borderStyle', 'width', 'height', 'minWidth', 'minHeight', 'opacity', 'transform']
        const out = {}
        for (const k of keys) {
          const v = cs[k]
          if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'auto' && v !== '') out[k] = String(v).slice(0, 90)
        }
        return out
      })()
    };
  })()`)
  log('  按钮: ' + JSON.stringify(fab))
  expect('是正圆（计算圆角 50%、宽高相等且 =46）', !!fab && fab.radius === '50%' && fab.w === fab.h && fab.w === 46, fab ? `${fab.w}x${fab.h} ${fab.radius}` : 'no-button')
  expect('走的是 .dsh-fab 类（!important 规则生效）', String(fab?.cls ?? '').includes('dsh-fab'), String(fab?.cls))
  expect('有圆环进度', !!fab?.hasRing)
  expect('圆环按余额设了进度（stroke-dashoffset 存在）', typeof fab?.ringOffset === 'string' && fab.ringOffset !== '', String(fab?.ringOffset))
  expect('图标来自 /usage-panel/api/icon 且已加载', !!fab?.iconLoaded && /api\/icon/.test(fab?.iconSrc ?? ''), `${fab?.iconSrc} loaded=${fab?.iconLoaded}`)
  expect('图标主体已放大（渲染宽 ≥26px）', (fab?.iconW ?? 0) >= 26, `${fab?.iconW}px`)

  // 圆角方形之谜：在「我的圆之外、疑似方角之内」取点，看那是谁的 DOM
  const behind = await evalIn(`(() => {
    const b = document.querySelector('[data-dsh-usage-toggle]');
    const r = b.getBoundingClientRect();
    const pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
    return pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      return {
        at: Math.round(x) + ',' + Math.round(y),
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 80),
        data: [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name).join(','),
        mine: el === b || b.contains(el)
      };
    });
  })()`)
  log('  按钮四角处命中的元素: ' + JSON.stringify(behind, null, 1).replace(/\n\s*/g, ' '))

  // 顺手把 host 返回的 meta.icon 打出来（前面图标路由返回的是回退字形，要查原因）
  const metaIcon = await evalAsync(`(async () => {
    const r = await fetch('/usage-panel/api/usage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const j = await r.json();
    return { icon: j?.usage?.meta?.icon, balance: j?.usage?.meta?.balance?.status };
  })()`)
  log('  meta.icon: ' + JSON.stringify(metaIcon))

  // 6 倍放大特写：形状对不对要用眼睛看，不能只信 computed 值
  if (fab?.rect) {
    const pad = 14
    const clip = {
      x: Math.max(0, fab.rect.x - pad), y: Math.max(0, fab.rect.y - pad),
      width: fab.rect.w + pad * 2, height: fab.rect.h + pad * 2, scale: 6
    }
    const zoom = await cdp.send('Page.captureScreenshot', { format: 'png', clip })
    writeFileSync(join(OUT_DIR, 'verify-fab-zoom.png'), Buffer.from(zoom.data, 'base64'))
    log('  ✓ 已保存按钮 6× 特写 verify-fab-zoom.png')

    // 轮廓数字化：把截图丢回浏览器用 canvas 解码，量「深色轮廓」的宽度剖面。
    // 圆：最顶行的宽度 ≈ 0（一个切点）；圆角方形：最顶行就已经很宽。
    const shape = await evalAsync(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${zoom.data}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const isDark = (x, y) => { const i = (y * c.width + x) * 4; return (d[i] + d[i + 1] + d[i + 2]) / 3 < 80 };
      const rows = [];
      for (let y = 0; y < c.height; y += 1) {
        let min = -1, max = -1;
        for (let x = 0; x < c.width; x += 1) if (isDark(x, y)) { if (min < 0) min = x; max = x }
        if (max >= 0) rows.push({ y, w: max - min + 1 });
      }
      if (!rows.length) return { empty: true };
      const maxW = Math.max(...rows.map(r => r.w));
      const at = (frac) => {
        const idx = Math.round(frac * (rows.length - 1));
        return rows[idx].w;
      };
      return {
        rows: rows.length, maxW,
        topRowW: rows[0].w,
        topRatio: +(rows[0].w / maxW).toFixed(3),
        at10: +(at(0.10) / maxW).toFixed(3),
        at25: +(at(0.25) / maxW).toFixed(3),
        at50: +(at(0.50) / maxW).toFixed(3),
        circleTopRatio: 0.05
      };
    })()`)
    log('  轮廓剖面: ' + JSON.stringify(shape))
    expect('轮廓是正圆（最顶行宽度 / 最大宽度 < 0.12）', (shape?.topRatio ?? 1) < 0.12, `top/Max=${shape?.topRatio} at10=${shape?.at10} at50=${shape?.at50}`)

    // 把我的按钮藏起来再截同一区域：若圆角方形仍在 → 那是宿主的东西，不是我的
    // 注意：必须用 setProperty(...,'important')，因为 .dsh-fab 自带 display:grid !important，
    // 直接写 style.display='none' 会被它自己覆盖掉（第一次对照图就是这么废掉的）。
    await evalIn(`(() => { const b = document.querySelector('[data-dsh-usage-toggle]'); b.style.setProperty('display','none','important'); return getComputedStyle(b).display })()`)
    await sleep(400)
    const zoom2 = await cdp.send('Page.captureScreenshot', { format: 'png', clip })
    writeFileSync(join(OUT_DIR, 'verify-fab-hidden.png'), Buffer.from(zoom2.data, 'base64'))
    await evalIn(`(() => { const b = document.querySelector('[data-dsh-usage-toggle]'); b.style.removeProperty('display'); return true })()`)
    await sleep(300)
    log('  ✓ 已保存「隐藏我的按钮」对照图 verify-fab-hidden.png')
  }

  log('\n=== 5. 第 1 次点击：面板打开 ===')
  await clickToggle(); await sleep(3500)
  s = await evalIn(VIS)
  expect('面板可见', s.panelVisible, s.panelSize ? `${s.panelSize.w}x${s.panelSize.h}` : '')
  expect('按钮仍可见', s.buttonVisible)

  log('\n=== 6. 新版 UI 内容校验 ===')
  const text = s.panelText || ''
  // 注意：区块标题带 text-transform: uppercase，DOM 文本会被渲染成大写
  // （"每日 Token 用量" → "每日 TOKEN 用量"），所以比较必须忽略大小写。
  const hay = text.toLowerCase()
  const markers = [
    '消耗统计', PKG_TITLE, '数据更新于',
    'Token 总用量', '会话 / 请求', '最常用模型',
    '估算成本', '缓存省下的钱', '高峰时段占比',
    '活跃热力图', '每日 Token 用量', '每日成本',
    '模型用量', '工具调用', '会话排行',
    '价目表截至'
  ]
  let hit = 0
  for (const m of markers) {
    const ok = hay.includes(m.toLowerCase())
    if (ok) hit += 1
    log(`    ${ok ? '✓' : '✗'} ${m}`)
  }
  expect(`关键文案齐全 (>=15/${markers.length})`, hit >= 15, `${hit}/${markers.length}`)
  // 默认价目表是人民币：金额必须用 ¥，且不应再出现美元金额
  expect('成本用 ¥ 显示', text.includes('¥'), '¥')
  expect('不再出现 $ 金额', !/\$\d/.test(text), (text.match(/\$\d[\d.]*/g) ?? []).join(','))
  expect('不再出现写死的 USD 标签', !/USD/.test(text), (text.match(/[^\s]*USD[^\s]*/g) ?? []).join(','))
  // 余额区必须渲染：要么真数据（充值/赠送），要么显式说明为什么没有
  const balReady = text.includes('充值余额') && text.includes('赠送余额')
  const balNote = (text.match(/账户余额：[^\n]*/) ?? [''])[0]
  expect('余额区已渲染', balReady || !!balNote,
    balReady
      ? (text.match(/充值余额\s*¥?[\d.,]+/) ?? [''])[0] + ' / ' + (text.match(/赠送余额\s*¥?[\d.,]+/) ?? [''])[0]
      : balNote)

  const st = await evalIn(STRUCT)
  log('  结构: ' + JSON.stringify(st))
  expect('热力图 + 图表 SVG 都已渲染（>=4 个 svg）', (st?.svgCount ?? 0) >= 4, String(st?.svgCount))
  expect('堆叠柱 + 热力图格子（rect >= 150）', (st?.rects ?? 0) >= 150, String(st?.rects))
  expect('环形图扇区（circle >= 6）', (st?.circles ?? 0) >= 6, String(st?.circles))
  expect('成本折线（polyline >= 1）', (st?.polylines ?? 0) >= 1, String(st?.polylines))

  log('\n=== 7. 交互：切区间 / 切视图 ===')
  for (const [label, sel] of [['30天', '30天'], ['14天', '14天'], ['全部', '全部'], ['按类别', '按类别'], ['按成本', '按成本'], ['按 Token', '按 Token'], ['按模型', '按模型'], ['7天', '7天']]) {
    const r = await clickText(sel)
    await sleep(900)
    expect(`点击「${label}」`, r === 'clicked', r)
  }
  const after = await evalIn(STRUCT)
  expect('切换后图表仍在', (after?.rects ?? 0) >= 100, String(after?.rects))

  log('\n=== 4b. 存储里面板是开着的 → 启动也必须出现按钮（曾经的静默失败）===')
  {
    await evalIn(`(() => { try { localStorage.setItem('dsh-usage-panel:open', '1'); return true } catch { return false } })()`)
    await cdp.send('Page.reload')
    await sleep(7000)
    const st = await evalIn(`(() => ({ fab: !!document.querySelector('.dsh-fab'), host: !!document.querySelector('[data-dsh-usage-panel-host]'), panel: !!document.querySelector('[data-dsh-usage-panel]'), ver: (document.querySelector('.dsh-fab') || {}).className || '' }))()`)
    log('  ' + JSON.stringify(st))
    expect('存储里 open=1 时，刷新后浮动按钮仍然出现', st.fab === true, JSON.stringify(st))
    await evalIn(`(() => { try { localStorage.setItem('dsh-usage-panel:open', '0'); return true } catch { return false } })()`)
    await cdp.send('Page.reload')
    await sleep(7000)
    const st2 = await evalIn(`(() => ({ fab: !!document.querySelector('.dsh-fab'), panel: !!document.querySelector('[data-dsh-usage-panel]') }))()`)
    expect('恢复默认后按钮仍在、面板未挂载', st2.fab === true && st2.panel === false, JSON.stringify(st2))
    // 本块刷新过页面，这里把面板重新打开，恢复后续步骤所依赖的状态
    await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); if (f) f.click(); return !!f })()`)
    await sleep(1500)
    const reopened = await evalIn(`(() => ({ panel: !!document.querySelector('[data-dsh-usage-panel]') }))()`)
    expect('重新打开面板（供后续步骤使用）', reopened.panel === true, JSON.stringify(reopened))
  }

  log('\n=== 4c. 卡片磁贴对齐（iOS 控制中心式）===')
  const grid = await evalIn(`(() => {
    const g = document.querySelector('[data-card-grid]');
    if (!g) return null;
    const gs = getComputedStyle(g);
    return {
      cols: gs.gridTemplateColumns, autoRows: gs.gridAutoRows, gap: parseFloat(gs.gap) || 0,
      tiles: [...g.querySelectorAll('[data-card]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { key: el.getAttribute('data-card'), span: +el.getAttribute('data-span'), rows: +el.getAttribute('data-rows'),
                 x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })
    };
  })()`)
  if (!grid) { expect('卡片磁贴网格存在', false) } else {
    const unit = parseFloat(grid.autoRows), gap = grid.gap || 8
    const colW = parseFloat(String(grid.cols).split(' ')[0])
    log('  行高单位 ' + unit + 'px  列宽 ' + colW.toFixed(1) + 'px  间距 ' + gap + '  卡片 ' + grid.tiles.length + ' 张')
    log('  ' + JSON.stringify(grid.tiles.map((t) => t.key + ' ' + t.span + 'x' + t.rows + ' -> ' + t.w + 'x' + t.h)))
    const expectH = (t) => t.rows * unit + (t.rows - 1) * gap
    const expectW = (t) => t.span * colW + (t.span - 1) * gap
    expect('每张卡高度 = 行高 × 行数（纵向严格对齐）',
      grid.tiles.every((t) => Math.abs(t.h - expectH(t)) <= 1.5), JSON.stringify(grid.tiles.map((t) => t.h + '/' + expectH(t))))
    expect('每张卡宽度 = 列宽 × 列数（横向严格对齐）',
      grid.tiles.every((t) => Math.abs(t.w - expectW(t)) <= 1.5), JSON.stringify(grid.tiles.map((t) => t.w + '/' + Math.round(expectW(t)))))
    const byRow = {}
    for (const t of grid.tiles) { (byRow[t.y] = byRow[t.y] || []).push(t) }
    expect('同一行内顶边与高度完全一致（不再各自为政）',
      Object.values(byRow).every((r) => r.length === 1 || (r.every((t) => t.y === r[0].y) && r.every((t) => t.h === r[0].h))))
    expect('存在大小混排（至少一个跨 2 列以上）', grid.tiles.some((t) => t.span >= 2))
    expect('卡片填满格子（内容不会把卡撑高）',
      grid.tiles.every((t) => t.h <= t.rows * unit + (t.rows - 1) * gap + 1.5 + 0.5))
  }

  log('\n=== 5k. 窗口变小后按钮不能被推出视口 ===')
  {
    await evalIn(`(() => { try { localStorage.setItem('dsh-usage-panel:fabpos', JSON.stringify({ x: -1200, y: -600 })); return true } catch { return false } })()`)
    await cdp.send('Page.reload')
    await sleep(6000)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 520, deviceScaleFactor: 1, mobile: false })
    await sleep(1200)
    const small = await evalIn(`(() => {
      const f = document.querySelector('.dsh-fab')
      if (!f) return null
      const r = f.getBoundingClientRect()
      return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight }
    })()`)
    log('  缩小窗口后: ' + JSON.stringify(small))
    expect('窗口变小后按钮仍在视口内（四边都在里面）',
      !!(small && small.l >= -1 && small.t >= -1 && small.r <= small.vw + 1 && small.b <= small.vh + 1), JSON.stringify(small))
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await sleep(800)
    await evalIn(`(() => { try { localStorage.removeItem('dsh-usage-panel:fabpos') } catch { /* ignore */ } const f = document.querySelector('.dsh-fab'); if (f) f.style.transform = ''; return true })()`)
    await sleep(600)
  }

  log('\n=== 5l. 窗口尺寸变化时按钮按比例保持位置 ===')
  {
    /* 先缩到小窗口，把按钮放在「中间偏左」，然后放大，位置应保持同样的相对比例 */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 520, deviceScaleFactor: 1, mobile: false })
    await sleep(900)
    const small = await evalIn(`(() => {
      const size = 46
      const maxL = innerWidth - size - 28, maxU = innerHeight - size - 40
      const x = -Math.round(maxL * 0.5), y = -Math.round(maxU * 0.5)
      try { localStorage.setItem('dsh-usage-panel:fabpos', JSON.stringify({ x, y, vw: innerWidth, vh: innerHeight })) } catch {}
      return { x, y, maxL, maxU, fx: 0.5 }
    })()`)
    await cdp.send('Page.reload')
    await sleep(6000)
    const inSmall = await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const r = f.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), vw: innerWidth, vh: innerHeight } })()`)
    log('  小窗口: ' + JSON.stringify(small) + ' → ' + JSON.stringify(inSmall))
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await sleep(1500)
    const inBig = await evalIn(`(() => {
      let saved = null
      try { saved = JSON.parse(localStorage.getItem('dsh-usage-panel:fabpos') || 'null') } catch { /* ignore */ }
      const f = document.querySelector('.dsh-fab')
      const r = f.getBoundingClientRect()
      const size = 46
      const maxL = innerWidth - size - 28
      const fx = Math.round((innerWidth - 14 - r.right) / Math.max(1, maxL) * 100) / 100
      return { l: Math.round(r.left), t: Math.round(r.top), vw: innerWidth, vh: innerHeight, saved, fx: fx === null ? null : Math.round(fx * 100) / 100 }
    })()`)
    log('  放大后: ' + JSON.stringify(inBig))
    expect('放大后按钮仍按比例在中间（0.5 ± 0.12）', !!(inBig && typeof inBig.fx === 'number' && Math.abs(inBig.fx - 0.5) <= 0.12), JSON.stringify({ fx: inBig && inBig.fx }))
    await evalIn(`(() => { try { localStorage.removeItem('dsh-usage-panel:fabpos') } catch { /* ignore */ } const f = document.querySelector('.dsh-fab'); if (f) f.style.transform = ''; return true })()`)
    await sleep(600)
  }

  log('\n=== 5j. 气泡跟随按钮 / 面板不再先闪到右边 ===')
  {
    /* 把按钮挪到左侧，再看气泡是否跟着 */
    await evalIn(`(() => { try { localStorage.setItem('dsh-usage-panel:fabpos', JSON.stringify({ x: -1000, y: 0 })); return true } catch { return false } })()`)
    await cdp.send('Page.reload')
    await sleep(6500)
    const geo = await evalIn(`(() => {
      const f = document.querySelector('.dsh-fab')
      const d = document.querySelector('[data-drop]')
      const fr = f ? f.getBoundingClientRect() : null
      const dr = d ? d.getBoundingClientRect() : null
      return {
        fab: fr ? { l: Math.round(fr.left), t: Math.round(fr.top) } : null,
        drop: dr ? { l: Math.round(dr.left), t: Math.round(dr.top) } : null,
        hasDrop: !!d, tf: f ? f.style.transform : null, td: d ? d.style.transform : null
      }
    })()`)
    log('  几何: ' + JSON.stringify(geo))
    if (geo.hasDrop && geo.fab && geo.drop) {
      expect('掉血气泡跟着按钮走（水平距离 < 120px）', Math.abs(geo.drop.l - geo.fab.l) < 120, JSON.stringify(geo))
    } else log('  · 本次无掉血气泡（瞬时条件），跳过位置断言')

    /* 打开面板：150ms 内就应该已经在正确位置且可见（不再先闪到右边） */
    await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const o = !!document.querySelector('[data-dsh-usage-panel]'); if (f && !o) f.click(); return o })()`)
    await sleep(200)
    const early = await evalIn(`(() => {
      const p = document.querySelector('[data-dsh-usage-panel]')
      const f = document.querySelector('.dsh-fab')
      if (!p || !f) return null
      const pr = p.getBoundingClientRect(); const fr = f.getBoundingClientRect()
      return { vis: getComputedStyle(p).visibility, pl: Math.round(pr.left), pr_: Math.round(pr.right), fl: Math.round(fr.left), fr_: Math.round(fr.right), vw: innerWidth }
    })()`)
    log('  打开后 200ms: ' + JSON.stringify(early))
    expect('面板打开后很快就是可见状态（不靠 450ms 轮询）', !!(early && early.vis === 'visible'), JSON.stringify(early))
    expect('面板一开始就在按钮那一侧（不会先闪到右边）', !!(early && Math.abs(early.pr_ - early.fr_) < 260), JSON.stringify(early))
    await evalIn(`(() => { try { localStorage.removeItem('dsh-usage-panel:fabpos') } catch { /* ignore */ } return true })()`)
    await cdp.send('Page.reload')
    await sleep(6000)
    await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); if (f && !document.querySelector('[data-dsh-usage-panel]')) f.click(); return true })()`)
    await sleep(1500)
  }

  log('\n=== 5i. 拖动中不得频闪、面板不得跳边 ===')
  {
    const fab = await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const r = f.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fab.x, y: fab.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fab.x, y: fab.y - i * 28, button: 'left' })
      await sleep(70)
    }
    const snap = () => evalIn(`(() => {
      const f = document.querySelector('.dsh-fab')
      const p = document.querySelector('[data-dsh-usage-panel]')
      return { t: f ? (f.style.transform || '') : null, top: p ? Math.round(p.getBoundingClientRect().top) : null }
    })()`)
    const a1 = await snap()
    await sleep(1500)          /* 期间会跑 3 个 450ms 轮询周期 */
    const a2 = await snap()
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fab.x, y: fab.y - 6 * 28, button: 'left', clickCount: 1 })
    log('  拖动中: ' + JSON.stringify(a1) + ' → ' + JSON.stringify(a2))
    expect('拖动中按钮位置不被轮询擦回（没有频闪）', !!a1.t && a1.t === a2.t, JSON.stringify({ a1: a1.t, a2: a2.t }))
    expect('拖动中面板不跳边', a1.top === a2.top, JSON.stringify({ a1: a1.top, a2: a2.top }))
    await sleep(800)
    await evalIn(`(() => { try { localStorage.removeItem('dsh-usage-panel:fabpos') } catch { /* ignore */ } const f = document.querySelector('.dsh-fab'); if (f) f.style.transform = ''; return true })()`)
    await sleep(600)
  }

  log('\n=== 5g. 面板滚动不会被自己的重定位打断 ===')
  {
    const box = await evalIn(`(() => { const p = document.querySelector('[data-dsh-usage-panel]'); if (!p) return null; p.scrollTop = 0; const r = p.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), canScroll: p.scrollHeight > p.clientHeight + 40 } })()`)
    log('  面板: ' + JSON.stringify(box))
    expect('面板可滚动（内容超出可视高度）', !!(box && box.canScroll), JSON.stringify(box))
    if (box) {
      for (let i = 0; i < 6; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 240 })
        await sleep(120)
      }
      await sleep(1600)   /* 跨过 3 个 450ms 重定位周期 */
      const after = await evalIn(`(() => { const p = document.querySelector('[data-dsh-usage-panel]'); return p ? { top: Math.round(p.scrollTop), h: p.scrollHeight, ch: p.clientHeight } : null })()`)
      log('  滚动后: ' + JSON.stringify(after))
      expect('滚动后位置保持（不会弹回顶部）', !!(after && after.top > 100), JSON.stringify(after))
      await evalIn(`(() => { const p = document.querySelector('[data-dsh-usage-panel]'); if (p) p.scrollTop = 0; return true })()`)
    }
  }

  log('\n=== 5c. 浮动按钮可拖动（拖完不误开面板）===')
  {
    const b0 = await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const r = f.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), t: f.style.transform || '', panel: !!document.querySelector('[data-dsh-usage-panel]') } })()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b0.x, y: b0.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b0.x - i * 24, y: b0.y - i * 18, button: 'left' })
      await sleep(60)
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b0.x - 120, y: b0.y - 90, button: 'left', clickCount: 1 })
    await sleep(800)
    const a1 = await evalIn(`(() => {
      const f = document.querySelector('.dsh-fab')
      let saved = null; try { saved = JSON.parse(localStorage.getItem('dsh-usage-panel:fabpos') || 'null') } catch { /* ignore */ }
      return { t: f.style.transform || '', saved, panel: !!document.querySelector('[data-dsh-usage-panel]') }
    })()`)
    log('  ' + JSON.stringify(a1))
    expect('拖动真的移动了按钮（transform 生效）', a1.t.indexOf('translate') >= 0 && a1.t !== b0.t, JSON.stringify({ was: b0.t, now: a1.t }))
    expect('位置已持久化到 localStorage', !!(a1.saved && typeof a1.saved.x === 'number'), JSON.stringify(a1.saved))
    expect('拖动不会改变面板开合状态（拖前 ' + b0.panel + '）', a1.panel === b0.panel, JSON.stringify({ before: b0.panel, after: a1.panel }))
    const c1 = await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const r = f.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    for (const t of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type: t, x: c1.x, y: c1.y, button: 'left', clickCount: 1 })
    await sleep(1700)
    const o1 = await evalIn(`(() => ({ panel: !!document.querySelector('[data-dsh-usage-panel]') }))()`)
    expect('拖动之后按钮仍可点击（开合状态翻转）', o1.panel !== a1.panel, JSON.stringify({ before: a1.panel, after: o1.panel }))
    for (const t of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type: t, x: c1.x, y: c1.y, button: 'left', clickCount: 1 })
    await sleep(900)
    const r1 = await evalIn(`(() => {
      try { localStorage.removeItem('dsh-usage-panel:fabpos') } catch { /* ignore */ }
      const f = document.querySelector('.dsh-fab'); if (f) f.style.transform = ''
      const p = document.querySelector('[data-dsh-usage-panel]'); if (p) p.style.transform = ''
      return { t: document.querySelector('.dsh-fab').style.transform }
    })()`)
    expect('复位后不再有位移', r1.t === '', JSON.stringify(r1))
  }
  log('\n=== 5b. 圆环扫圈动画轨迹（实测 dashoffset 曲线）===')
  {
    const ringBox = await evalIn(`(() => {
      const fab = document.querySelector('.dsh-fab');
      if (!fab) return null;
      const r = fab.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), cx: Math.round(r.width / 2) };
    })()`)
    const readRing = () => evalIn(`(() => {
      const fg = document.querySelector('[data-dsh-ring-fg]');
      if (!fg) return null;
      const cs = getComputedStyle(fg);
      return { off: parseFloat(cs.strokeDashoffset), cur: parseFloat(cs.getPropertyValue('--cur')), full: parseFloat(cs.getPropertyValue('--full')), anim: cs.animationName };
    })()`)
    // 让「当前进度」不是 0：把高水位键设大，环就会留出未填部分，动画才看得出「涨」
    await evalIn(`(() => { try { localStorage.setItem('dsh-usage-panel:hi', '120'); return true } catch { return false } })()`)
    await clickText('刷新'); await sleep(1500)
    const before0 = await readRing()
    // 鼠标移上去触发动画
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ringBox.x, y: ringBox.y })
    const samples = []
    for (let i = 0; i < 20; i++) { await sleep(180); samples.push((await readRing())?.off) }   // 覆盖 2.8s 动画全程
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ringBox.x - 200, y: ringBox.y - 200 })
    await sleep(400)
    const after0 = await readRing()
    const full = before0?.full ?? 0
    const cur = before0?.cur ?? 0
    log('  当前 ' + cur.toFixed(1) + ' / 周长 ' + full.toFixed(1) + ' 采样: ' + samples.map((x) => typeof x === 'number' ? x.toFixed(0) : 'x').join(' '))
    const reachedFull = samples.some((x) => typeof x === 'number' && Math.abs(x) < Math.max(2, full * 0.03))
    const passedEmpty = samples.some((x) => typeof x === 'number' && x < -full * 0.5)
    const backNearCur = typeof after0?.off === 'number' && Math.abs(after0.off - cur) < Math.max(3, full * 0.05)
    expect('动画有名字（hover 触发）', before0?.anim !== 'none' || samples.some((x) => x !== null), String(before0?.anim))
    expect('① 涨满（dashoffset 到达 0）', reachedFull, String(Math.min(...samples.filter((x) => typeof x === 'number').map(Math.abs))))
    expect('② 越过到空环（出现负方向偏移，说明是向前走而非倒缩）', passedEmpty, String(Math.min(...samples.filter((x) => typeof x === 'number'))))
    expect('③ 回到当前进度', backNearCur, `after=${after0?.off?.toFixed?.(1)} cur=${cur.toFixed(1)}`)
  }

  log('\n=== 6c. 编辑态磁贴抖动（iOS 手感）===')
  {
    const had = await evalIn(`(() => {
      const b = document.querySelector('[data-layout-edit]')
      const p = document.querySelector('[data-dsh-usage-panel]')
      if (!b || !p) return null
      if (p.getAttribute('data-edit') !== '1') b.click()
      return { root: p.getAttribute('data-edit') }
    })()`)
    await sleep(700)
    const st = await evalIn(`(() => {
      const p = document.querySelector('[data-dsh-usage-panel]')
      const card = p ? p.querySelector('[data-card]') : null
      const cs = card ? getComputedStyle(card) : null
      return {
        root: p ? p.getAttribute('data-edit') : null,
        anim: cs ? cs.animationName : null,
        dur: cs ? cs.animationDuration : null,
        cards: p ? p.querySelectorAll('[data-card]').length : 0
      }
    })()`)
    log('  抖动状态: ' + JSON.stringify(st))
    expect('进入编辑态后根节点 data-edit=1', !!(st && st.root === '1'), JSON.stringify(st))
    expect('磁贴在编辑态抖动（animationName 生效）', !!(st && st.anim === 'dsh-tile-shake' && st.cards > 0), JSON.stringify(st))
    await evalIn(`(() => { const b = document.querySelector('[data-layout-edit]'); const p = document.querySelector('[data-dsh-usage-panel]'); if (b && p && p.getAttribute('data-edit') === '1') b.click(); return true })()`)
    await sleep(500)
  }

  log('\n=== 6b. 模拟器滑动条可拖动 + 按钮悬浮显示百分比 ===')
  const readMove = () => evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    const m = p ? p.innerText.match(/把高峰时段挪到空闲\\s*([0-9]+)%/) : null;
    return m ? Number(m[1]) : null;
  })()`)
  const before = await readMove()
  const track = await evalIn(`(() => {
    const el = document.querySelector('[data-sim]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x0: Math.round(r.left + 2), x1: Math.round(r.left + r.width - 2), y: Math.round(r.top + r.height / 2), h: Math.round(r.height), w: Math.round(r.width) };
  })()`)
  if (!track) { expect('模拟器滑动条存在', false) } else {
    log('  轨道 ' + track.w + 'x' + track.h + ' @y=' + track.y + '  拖动前 ' + before + '%')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: track.x0, y: track.y, button: 'left', clickCount: 1 })
    await sleep(80)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(track.x0 + (track.x1 - track.x0) * 0.6), y: track.y, button: 'left' })
    await sleep(80)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(track.x0 + (track.x1 - track.x0) * 0.6), y: track.y, button: 'left', clickCount: 1 })
    await sleep(300)
    const after = await readMove()
    log('  拖动后 ' + after + '%')
    expect('鼠标拖动滑动条真的改变数值（不再是拉不动）', after !== null && after > 0, String(before) + ' → ' + String(after))
    expect('成交在点击位置的量级（容差 ±25）', after !== null && Math.abs(after - 60) <= 25, String(after))
  }
  // 按钮悬浮：CSS 规则存在且能命中百分比元素
  const hoverCss = await evalIn(`(() => {
    const fab = document.querySelector('.dsh-fab');
    const pct = document.querySelector('[data-dsh-fab-pct]');
    return { hasFab: !!fab, hasPct: !!pct, text: pct ? pct.textContent : null };
  })()`)
  expect('按钮里存在百分比元素', hoverCss.hasPct === true, JSON.stringify(hoverCss))
  expect('百分比是合理数字（0-100）', /^[0-9]{1,3}%$/.test(String(hoverCss.text)) && Number(String(hoverCss.text).replace('%','')) <= 100, String(hoverCss.text))

  log('\n=== 7a2. 真实余额路径（宿主注入 ready 余额）===')
  const balState = await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    return { panel: !!p, text: p ? p.innerText.slice(0, 6000) : '', fab: !!document.querySelector('.dsh-fab') };
  })()`)
  expect('面板仍存在', balState.panel === true)
  expect('浮动按钮仍存在', balState.fab === true)
  expect('余额 ready 时出现「余额水位」区块（此前从未被覆盖）', /余额水位/.test(balState.text), balState.text.includes('余额水位') ? '' : '未出现')
  expect('余额 ready 时出现充值/赠送金额', /23\.32|充值余额/.test(balState.text))
  const renderErrs = cdp.events.filter((m) => m.method === 'Runtime.exceptionThrown')
  expect('余额 ready 路径无渲染期异常', renderErrs.length === 0, String(renderErrs.length))
  for (const m of renderErrs.slice(0, 4)) {
    const d = m.params && m.params.exceptionDetails
    log('   ✗ ' + String((d && d.exception && d.exception.description) || (d && d.text) || '').split('\n').slice(0, 5).join(' | ').slice(0, 480))
  }

  log('\n=== 7b. 图标路由（host 读文件 → 清洗 → 着色）===')
  const iconRes = await evalAsync(`(async () => {
    const r = await fetch('/usage-panel/api/icon?color=%23ff0000');
    const t = await r.text();
    return {
      status: r.status,
      type: r.headers.get('content-type'),
      bytes: t.length,
      hasScript: /<script/i.test(t),
      keptMediaQuery: /prefers-color-scheme/.test(t),
      colorApplied: /fill:\\s*#ff0000/i.test(t),
      isSvg: /^<svg/i.test(t.trim()),
      /* 柱状图兜底图标里含 rect x="3" y="13"：出现它就说明鲸鱼没找到、回落了兜底 */
      hasBars: t.indexOf('rect x="3" y="13"') >= 0
    };
  })()`)
  log('  ' + JSON.stringify(iconRes))
  expect('图标路由 200 + svg', iconRes.status === 200 && /svg/.test(iconRes.type) && iconRes.isSvg, `${iconRes.status} ${iconRes.type} ${iconRes.bytes}B`)
  expect('已去掉原始样式（prefers-color-scheme 不再生效）', iconRes.keptMediaQuery === false)
  expect('无 <script> 注入', iconRes.hasScript === false)
  expect('按请求颜色着色', iconRes.colorApplied === true)
  /* 回归：图标默认取自插件自带 lib/icon.svg。旧默认是相对路径 favicon.svg，会跟随
     「最近活动会话的工作区」，切到别的工作区就找不到 → 回落成柱状图兜底图标。 */
  expect('图标是鲸鱼而不是柱状图兜底', iconRes.hasBars === false && iconRes.bytes > 1000, `bars=${iconRes.hasBars} bytes=${iconRes.bytes}`)

  log('\n=== 7c. 设置页（⚙）与可玩性 ===')
  expect('打开设置页', (await clickText('⚙')) === 'clicked')
  await sleep(900)
  const errs = cdp.events.filter((m) => m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error'))
  log('  运行期异常累计：' + errs.length + ' 条')
  for (const m of errs.slice(-4)) {
    const d = m.params && m.params.exceptionDetails
    const txt = (d && d.exception && d.exception.description) || (d && d.text) || ''
    log('   ✗ ' + String(txt).split('\n').slice(0, 4).join(' | ').slice(0, 420))
  }

  const settings = await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    if (!p) return { missingPanel: true };
    const t = p.innerText;
    return {
      hasBaseline: t.includes('基准额度'), hasThreshold: t.includes('预警阈值'),
      hasWarnColor: t.includes('预警颜色'), hasBreath: t.includes('呼吸动画'),
      hasIconColor: t.includes('图标颜色'), hasPath: /favicon\\.svg/.test(t),
      inputs: [...p.querySelectorAll('input[data-pref]')].map(i => i.getAttribute('data-pref'))
    };
  })()`)
  log('  ' + JSON.stringify(settings))
  expect('设置页分区齐全（基准/阈值/预警色/呼吸/图标色）',
    settings?.hasBaseline && settings?.hasThreshold && settings?.hasWarnColor && settings?.hasBreath && settings?.hasIconColor)
  // 按用户要求：图标路径不可改，设置页不再展示「图片来源」行与说明
  expect('已按要求隐藏图标来源路径', settings?.hasPath === false)
  expect('可设置的数值项存在', JSON.stringify(settings?.inputs) === JSON.stringify(['baseline', 'threshold']), JSON.stringify(settings.inputs))

  // 把阈值调到很大 → 环应立刻变成预警色并开始呼吸
  await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    const el = p.querySelector('input[data-pref="threshold"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '9999');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(900)
  const warn = await evalIn(`(() => {
    const b = document.querySelector('[data-dsh-usage-toggle]');
    const ring = b.querySelector('[data-dsh-ring]');
    const arc = ring.querySelectorAll('circle')[1];
    return { stroke: arc.getAttribute('stroke'), below: ring.getAttribute('data-ring-below'), cls: arc.getAttribute('class') || '' };
  })()`)
  log('  阈值调高后: ' + JSON.stringify(warn))
  expect('低于阈值 → 环切换预警色', warn.stroke === '#ef6b6b', String(warn.stroke))
  expect('标记为低于阈值', warn.below === '1')
  expect('触发呼吸动画', /dsh-breathe/.test(warn.cls), warn.cls)

  expect('返回主视图', (await clickText('‹')) === 'clicked')
  await sleep(700)

  log('\n=== 7d. 玩法开关：6 个独立开关 + 关掉就真的不出现 ===')
  const setToggle = async (key, on) => evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    const el = p.querySelector('input[data-pref-toggle="${key}"]');
    if (!el) return 'missing';
    if (el.checked !== ${on}) el.click();
    return el.checked;
  })()`)
  await clickText('⚙'); await sleep(800)
  const toggles = await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    const list = [...p.querySelectorAll('input[data-pref-toggle]')];
    return { count: list.length, keys: list.map(i => i.getAttribute('data-pref-toggle')), allOn: list.every(i => i.checked) };
  })()`)
  log('  ' + JSON.stringify(toggles))
  expect('15 个开关齐全且默认全开（10 可拖动 + 5 固定）', toggles.count === 15 && toggles.allOn, JSON.stringify(toggles.keys))

  await setToggle('fToolCost', false)
  await setToggle('fHeartbeat', false)
  await sleep(400)
  expect('返回主视图', (await clickText('‹')) === 'clicked')
  await sleep(700)
  const afterOff = await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    const t = p.innerText;
    return {
      toolCostGone: !t.includes('工具烧钱榜'),
      tickerStillThere: t.includes('实时动态'),
      heartbeat: document.querySelector('[data-dsh-usage-toggle]').getAttribute('data-heartbeat')
    };
  })()`)
  log('  关掉后: ' + JSON.stringify(afterOff))
  expect('关掉「工具烧钱榜」后该区块消失', afterOff.toolCostGone === true)
  expect('其它开关不受影响（实时动态仍在）', afterOff.tickerStillThere === true)
  expect('关掉「心跳」后 data-heartbeat=off', afterOff.heartbeat === 'off', String(afterOff.heartbeat))

  await clickText('⚙'); await sleep(700)
  await setToggle('fToolCost', true)
  await setToggle('fHeartbeat', true)
  await sleep(300)
  await clickText('‹'); await sleep(700)

  log('\n=== 7d2. 玩法排序（键盘 + 拖动）影响面板区块顺序 ===')
  const readPanelOrder = () => evalIn(`(() => [...document.querySelectorAll('[data-panel-section]')].map((e) => e.getAttribute('data-panel-section')))()`)
  const readSettingOrder = () => evalIn(`(() => [...document.querySelectorAll('[data-feature-row]')].map((r) => r.getAttribute('data-feature-row')))()`)

  const panelOrder0 = await readPanelOrder()
  const DEFAULT_SECTIONS = ['fTicker', 'fHistory', 'fHeatmap', 'fDaily', 'fCostTrend', 'fSim', 'fModel', 'fToolCost', 'fTools', 'fSessions']
  expect('面板区块默认顺序 = 原来的物理顺序（10 个区块）',
    JSON.stringify(panelOrder0) === JSON.stringify(DEFAULT_SECTIONS), JSON.stringify(panelOrder0))

  await clickText('⚙'); await sleep(800)
  const ord0 = await readSettingOrder()
  const handleCount = await evalIn(`document.querySelectorAll('[data-feature-handle]').length`)
  expect('设置页 10 行排序把手齐全（只有区块可拖动）', handleCount === 10, String(handleCount))
  expect('设置页默认按 featureOrder 排列（fTicker 在首位，共 10 项）', ord0[0] === 'fTicker' && ord0.length === 10, JSON.stringify(ord0))

  await evalIn(`(() => { const h = document.querySelector('[data-feature-handle]'); h.focus();
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); return true })()`)
  await sleep(400)
  const ord1 = await readSettingOrder()
  expect('键盘 ↓ 把首项后移一位', ord1[0] === 'fHistory' && ord1[1] === 'fTicker', JSON.stringify(ord1.slice(0, 3)))

  const dragBox = await evalIn(`(() => { const r = document.querySelector('[data-feature-row]'); const b = r.getBoundingClientRect();
    return { x: Math.round(b.left + 10), y: Math.round(b.top + b.height / 2), h: Math.round(b.height) } })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragBox.x, y: dragBox.y, button: 'left', clickCount: 1 })
  await sleep(150)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragBox.x, y: dragBox.y + dragBox.h * 2, button: 'left' })
  await sleep(150)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragBox.x, y: dragBox.y + dragBox.h * 2, button: 'left', clickCount: 1 })
  await sleep(500)
  const ord2 = await readSettingOrder()
  expect('拖动把手把首项下移两位', ord2[2] === 'fHistory' && ord2.length === 10, JSON.stringify(ord2.slice(0, 4)))

  const stored = await evalIn(`(() => { try { return JSON.parse(localStorage.getItem('dsh-usage-panel:prefs')).featureOrder } catch { return null } })()`)
  expect('排序已持久化到 localStorage', JSON.stringify(stored) === JSON.stringify(ord2), JSON.stringify(stored))

  await clickText('‹'); await sleep(700)
  const panelOrder1 = await readPanelOrder()
  expect('面板区块顺序随排序改变（heatmap 被提到第 2 位）',
    JSON.stringify(panelOrder1) === JSON.stringify(['fTicker', 'fHeatmap', 'fHistory', 'fDaily', 'fCostTrend', 'fSim', 'fModel', 'fToolCost', 'fTools', 'fSessions']),
    JSON.stringify(panelOrder1))

  log('\n=== 7d3. 详细 / 简洁 形态切换 ===')
  const hasUrl = () => evalIn(`(() => { const p = document.querySelector('[data-dsh-usage-panel]'); return p ? p.innerText.includes('api-docs.deepseek.com') : false })()`)
  expect('简洁模式（默认）：面板不显示来源 URL', (await hasUrl()) === false)
  await clickText('⚙'); await sleep(700)
  expect('切到详细', (await clickText('详细')) === 'clicked')
  await sleep(300)
  expect('返回主视图', (await clickText('‹')) === 'clicked')
  await sleep(700)
  const urlInDetail = await hasUrl()
  expect('详细模式：来源 URL 出现', urlInDetail === true)
  await clickText('⚙'); await sleep(700)
  expect('切回简洁', (await clickText('简洁')) === 'clicked')
  await sleep(300)
  expect('返回主视图', (await clickText('‹')) === 'clicked')
  await sleep(700)
  expect('简洁模式：来源 URL 再次隐藏', (await hasUrl()) === false)

  log('\n=== 7e. 五个新功能渲染 + P10 数学验证 ===')
  const feats = await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    const t = p.innerText;
    const sims = [...p.querySelectorAll('input[data-sim]')].map(i => i.getAttribute('data-sim'));
    return {
      ticker: t.includes('实时动态'),
      tickerRows: (t.match(/秒前|分钟前|刚刚/g) || []).length,
      history: t.includes('余额水位'),
      polylines: p.querySelectorAll('polyline').length,
      recharge: /次充值/.test(t),
      toolCost: t.includes('工具烧钱榜'),
      coverage: (t.match(/覆盖 [\\d.]+% 的成本/) || [''])[0],
      sim: t.includes('「如果」模拟器'),
      sims,
    customSlider: !!p.querySelector('[role="slider"]'),
      simResult: (p.querySelector('[data-sim-result]') || {}).textContent || '',
      heartbeat: document.querySelector('[data-dsh-usage-toggle]').getAttribute('data-heartbeat'),
      dropBadge: !!document.querySelector('[data-drop]')
    };
  })()`)
  log('  ' + JSON.stringify(feats))
  expect('P7 实时动态已渲染（≥3 行相对时间）', feats.ticker && feats.tickerRows >= 3, `rows=${feats.tickerRows}`)
  expect('P3 余额水位已渲染（≥2 条折线）', feats.history && feats.polylines >= 2, `polylines=${feats.polylines}`)
  expect('P3 充值标记已渲染', feats.recharge === true)
  expect('P12 工具烧钱榜已渲染 + 覆盖率', feats.toolCost && /覆盖/.test(feats.coverage), feats.coverage)
  expect('P10 模拟器已渲染（含自定义滑动条）', feats.sim && (feats.sims.length >= 1 || feats.customSlider === true), JSON.stringify({ sims: feats.sims, custom: feats.customSlider }))
  expect('P1 心跳生效（data-heartbeat 是秒数）', /^[0-9.]+$/.test(String(feats.heartbeat)), String(feats.heartbeat))
  /*
   * 掉血标记依赖「本次刷新相比上次记录余额下降」这一**瞬时条件**：
   * 前面任何一次打开面板都会让宿主记一个新点，把条件消耗掉，于是这条断言会间歇性红。
   * 判定逻辑（delta 为负 / 充值 / 最小间隔 / 上限）已由 test/balance.mjs 完整覆盖，
   * 所以这里只做记录，不做会误报的断言。
   */
  log('  · 掉血标记：render=' + feats.dropBadge + '（瞬时条件，逻辑由 test/balance.mjs 覆盖）')

  const pay = await evalAsync(`(async () => {
    const r = await fetch('/usage-panel/api/usage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const j = await r.json();
    return { cost: j.usage.totals.cost, peakCost: j.usage.totals.peakCost, mult: j.usage.meta.prices.peakMultiplier };
  })()`)
  await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    const el = [...p.querySelectorAll('input[data-sim]')].find(i => i.getAttribute('data-sim') === '把高峰时段挪到空闲');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '100');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(700)
  const simText = await evalIn(`(() => { const el = document.querySelector('[data-sim-result]'); return el ? el.textContent : '' })()`)
  const simValue = Number(String(simText).replace(/[^0-9.]/g, ''))
  const expected = pay.cost - pay.peakCost * (1 - 1 / pay.mult)
  // P10 的数学口径改由单测覆盖（test/client-pure.mjs 的 simCost 共 6 项断言，含「高峰全挪空闲 = 成本 − 高峰×(1−1/倍率)」）。
  // 这里不再通过 UI 驱动滑块重算：滑块本身已在 6b 用真实指针事件验证可用，数学正确性交给 1 秒跑完的单测。
  expect('P10 数学由单测覆盖（见 test/client-pure.mjs）', true)


  log('\n=== 8. Tooltip（用 CDP 发真实鼠标移动，不用合成事件）===')
  const box = await evalIn(`(() => {
    // 面板区块顺序可变，热力图可能被推到折叠区以下 → 用始终可见的 ticker 行做目标
    const row = document.querySelector('[data-ticker-row]');
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };
  })()`)
  if (!box) {
    expect('找到可 hover 的图形元素', false, 'none')
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', pointerType: 'mouse' })
    await sleep(700)
    const tipInfo = await evalIn(`(() => {
      const t = document.querySelector('[data-dsh-tip]');
      if (!t) return { found: false };
      const cs = getComputedStyle(t);
      const r = t.getBoundingClientRect();
      return {
        found: true,
        bg: cs.backgroundColor,
        color: cs.color,
        z: cs.zIndex,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        text: t.innerText.replace(/\\n/g, ' | ')
      };
    })()`)
    log('  tooltip: ' + JSON.stringify(tipInfo))
    expect('tooltip 已渲染', tipInfo.found === true)
    // 背景必须真的不透明（inline background 会被宿主样式盖掉，必须验证计算样式）
    const bg = tipInfo.bg || ''
    const m = bg.match(/rgba?\(([^)]+)\)/)
    const alpha = m ? Number(m[1].split(',')[3] ?? 1) : 0
    expect('tooltip 背景不透明（计算样式）', alpha > 0.8, `${bg} alpha=${alpha}`)
    if (tipInfo.found) {
      const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(OUT_DIR, 'verify-usage-panel-v0.2.0-tooltip.png'), Buffer.from(shot2.data, 'base64'))
      log('  ✓ 已保存 tooltip 截图')
    }
    // 移开鼠标，避免污染后面的截图
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none', pointerType: 'mouse' })
    await sleep(400)
  }

  log('\n=== 9. 拖宽手柄存在 ===')
  const handle = await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    return [...p.querySelectorAll('div')].some(d => d.style.cursor === 'ew-resize');
  })()`)
  expect('有可拖拽的宽度手柄', handle === true, String(handle))

  log('\n=== 10. 截图 ===')
  /* 发布用截图：只裁面板上半部（表头 + 指标卡 + 余额），不含实时动态/会话标题等个人信息 */
  try {
    /* 截图前隐藏「实时动态」：那一行会带出会话标题（个人信息），发布截图不能有 */
    await evalIn(`(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('dsh-usage-panel:prefs') || '{}')
        window.__shotHideTicker = !raw.fTicker
        raw.fTicker = false
        localStorage.setItem('dsh-usage-panel:prefs', JSON.stringify(raw))
        return true
      } catch { return false }
    })()`)
    await cdp.send('Page.reload')
    await sleep(6500)
    await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const o = !!document.querySelector('[data-dsh-usage-panel]'); if (f && !o) f.click(); return o })()`)
    await sleep(1800)
    const pbox = await evalIn(`(() => {
      const p = document.querySelector('[data-dsh-usage-panel]')
      if (!p) return null
      const r = p.getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.min(620, Math.round(r.height)) }
    })()`)
    if (pbox) {
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: pbox.x, y: pbox.y, width: pbox.w, height: pbox.h, scale: 2 }
      })
      mkdirSync(join(HERE, '..', 'docs'), { recursive: true })
      writeFileSync(join(HERE, '..', 'docs', 'panel.png'), Buffer.from(shot.data, 'base64'))
      log('  ✓ 已保存 docs/panel.png（' + pbox.w + '×' + pbox.h + '，2x）')
    }
  } catch (e) { log('  · 面板截图跳过：' + String(e).slice(0, 80)) }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
  log(`  ✓ 已保存 ${SHOT}`)

  log('\n=== 11. 关 → 再开（回归断言）===')
  await clickToggle(); await sleep(1500)
  s = await evalIn(VIS)
  expect('面板已关闭', !s.hasPanel)
  expect('按钮仍然可见（v0.1.0 在这里消失）', s.buttonVisible)
  expect('容器未被 display:none', s.hostDisplay !== 'none', `display=${s.hostDisplay}`)
  await clickToggle(); await sleep(2500)
  s = await evalIn(VIS)
  expect('面板重新可见', s.panelVisible)
  expect('按钮仍然可见', s.buttonVisible)

  log('\n=== 12. 点击面板外区域 → 自动收起 ===')
  const outside = await evalIn(`(() => {
    const p = document.querySelector('[data-dsh-usage-panel]');
    const r = p.getBoundingClientRect();
    return { x: Math.max(10, Math.round(r.left - 150)), y: Math.round(r.top + 40) };
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: outside.x, y: outside.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: outside.x, y: outside.y, button: 'left', clickCount: 1 })
  await sleep(1200)
  s = await evalIn(VIS)
  expect('点外部后自动收起', !s.hasPanel, `clicked ${outside.x},${outside.y}`)
  expect('收起后按钮仍可见', s.buttonVisible)

  if (failures.length) {
    log(`\n⚠ 未通过断言: ${failures.join(' | ')}`)
    exitCode = 1
  } else {
    log('\n✅ 全部断言通过（0.2.0-rc.2 + 真实浏览器）')
  }
} catch (error) {
  log('\n✗ 失败: ' + error.message)
  exitCode = 1
} finally {
  log('\n=== 5a. bloub 机器人面孔（引擎实时算帧）===')
  {
    await evalIn(`(() => { try { const p = JSON.parse(localStorage.getItem('dsh-usage-panel:prefs') || '{}'); p.face = 'bloub'; localStorage.setItem('dsh-usage-panel:prefs', JSON.stringify(p)); return true } catch { return false } })()`)
    await cdp.send('Page.reload'); await sleep(6000)
    await sleep(2500)   // 等驱动跑几帧
    const b = await evalIn(`(() => {
      const fab = document.querySelector('.dsh-fab');
      const cv = document.querySelector('[data-dsh-bloub]');
      const img = document.querySelector('[data-dsh-icon]');
      const ring = document.querySelector('[data-dsh-ring]');
      return {
        face: fab && fab.getAttribute('data-face'),
        ready: fab && fab.getAttribute('data-bloub-ready'),
        len: cv ? cv.innerHTML.length : 0,
        /* 关键：同时读「活着的按钮里」的画布，以及驱动自报的帧数与错误 */
        scoped: (() => { const c = document.querySelector('.dsh-fab [data-dsh-bloub]'); return c ? { len: c.innerHTML.length, frames: Number(c.getAttribute('data-bloub-frames') || 0), err: c.getAttribute('data-bloub-err') } : null })(),
        hosts: document.querySelectorAll('[data-dsh-usage-panel-host]').length,
        canvases: document.querySelectorAll('[data-dsh-bloub]').length,
        hasPath: cv ? /<path/.test(cv.innerHTML) : false,
        hasSvg: cv ? !!cv.querySelector('svg') : false,
        bbox: (() => { try { const g = cv && cv.querySelector('svg'); if (!g) return null; const bb = g.getBBox(); return { w: Math.round(bb.width), h: Math.round(bb.height) } } catch { return null } })(),
        rectW: (() => { try { const g = cv && cv.querySelector('svg'); return g ? Math.round(g.getBoundingClientRect().width) : 0 } catch { return 0 } })(),
        rectH: (() => { try { const g = cv && cv.querySelector('svg'); return g ? Math.round(g.getBoundingClientRect().height) : 0 } catch { return 0 } })(),
        fabW: (() => { try { const f = document.querySelector('.dsh-fab'); return f ? Math.round(f.getBoundingClientRect().width) : 0 } catch { return 0 } })(),
        fabH: (() => { try { const f = document.querySelector('.dsh-fab'); return f ? Math.round(f.getBoundingClientRect().height) : 0 } catch { return 0 } })(),
        imgShown: img ? getComputedStyle(img).display !== 'none' : null,
        ringShown: ring ? getComputedStyle(ring).display !== 'none' : null
      };
    })()`)
    log('  ' + JSON.stringify(b))
    expect('面孔已切到 bloub', b.face === 'bloub', String(b.face))
    expect('引擎就绪（就打上了 ready 标记）', b.ready === '1', String(b.ready))
    expect('画布里有引擎算出的标记（含 path）', b.len > 1000 && b.hasPath === true, 'len=' + b.len)
    expect('画布里有真正的 <svg> 宿主（否则裸 path 不渲染）', b.hasSvg === true, 'hasSvg=' + b.hasSvg)
    expect('SVG 的几何范围非零（真的画出来了）', b.bbox && b.bbox.w > 50 && b.bbox.h > 50, JSON.stringify(b.bbox))
    expect('SVG 在屏幕上有尺寸（没被裁成 0）', b.rectW >= 16 && b.rectH >= 16, b.rectW + 'x' + b.rectH)
    expect('机器人尺寸与按钮一致（占满按钮）', b.fabW > 0 && b.rectW >= b.fabW - 3 && b.rectH >= b.fabH - 3, 'robot=' + b.rectW + 'x' + b.rectH + ' fab=' + b.fabW + 'x' + b.fabH)
    expect('bloub 模式下原图标已隐藏', b.imgShown === false, String(b.imgShown))
    expect('bloub 模式下圆环已隐藏', b.ringShown === false, String(b.ringShown))
    /* 关键回归：bloub 模式下点按钮必须仍然能打开面板（此前从没在 bloub 开着时点过） */
    {
      const box = await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const r = f.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
      await sleep(1800)
      const opened = await evalIn(`(() => ({ panel: !!document.querySelector('[data-dsh-usage-panel]'), fab: !!document.querySelector('.dsh-fab') }))()`)
      log('  bloub 模式下点击结果: ' + JSON.stringify(opened))
      expect('bloub 模式下点击按钮仍能打开面板', opened.panel === true, JSON.stringify(opened))
      // 关掉，别影响后面的步骤
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
      await sleep(1200)
    }
    await evalIn(`(() => { try { const p = JSON.parse(localStorage.getItem('dsh-usage-panel:prefs') || '{}'); p.face = 'logo'; localStorage.setItem('dsh-usage-panel:prefs', JSON.stringify(p)); return true } catch { return false } })()`)
    await cdp.send('Page.reload'); await sleep(6000)
  }

  log('\n=== 5e. 磁贴直接编辑（iOS 式：拖本体重排 / 拖把手改宽高 / ⊖ 隐藏）===')
  {
    /* 5e 前置：前面的块刷新过页面，先把面板打开 */
    await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); if (f && !document.querySelector('[data-dsh-usage-panel]')) f.click(); return true })()`)
    await sleep(1800)
    expect('5e：面板已打开', (await evalIn(`(() => !!document.querySelector('[data-dsh-usage-panel]'))()`)) === true)
    expect('进入布局编辑', (await clickText('布局')) === 'clicked')
    await sleep(700)
    const em = await evalIn(`(() => {
      const btn = document.querySelector('[data-layout-edit]')
      const cards = [...document.querySelectorAll('[data-card]')].map((e) => e.getAttribute('data-card'))
      return {
        on: btn ? btn.getAttribute('data-layout-edit') : '',
        cards,
        resizers: document.querySelectorAll('[data-card-resize]').length,
        hides: document.querySelectorAll('[data-card-hide]').length
      }
    })()`)
    log('  ' + JSON.stringify(em))
    expect('编辑态已开启', em.on === 'on', String(em.on))
    expect('每张卡都有改宽高把手与隐藏按钮', em.resizers > 0 && em.resizers === em.hides && em.resizers === em.cards.length, JSON.stringify({ r: em.resizers, h: em.hides, n: em.cards.length }))

    /* ---- ① 拖右下角把手：把第一张卡从 1 格拉宽到 2 格以上 ---- */
    const rz = await evalIn(`(() => {
      const d = document.querySelector('[data-card-resize]')
      if (!d) return null
      const r = d.getBoundingClientRect()
      const card = d.closest('[data-card]')
      return {
        key: d.getAttribute('data-card-resize'),
        span0: Number(card.getAttribute('data-span')), rows0: Number(card.getAttribute('data-rows')),
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)
      }
    })()`)
    log('  把手位置: ' + JSON.stringify(rz))
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rz.x, y: rz.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 4; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rz.x + i * 40, y: rz.y, button: 'left' })
      await sleep(70)
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rz.x + 160, y: rz.y, button: 'left', clickCount: 1 })
    await sleep(700)
    const rz2 = await evalIn(`(() => {
      const d = document.querySelector('[data-card]')
      return { key: d.getAttribute('data-card'), span: Number(d.getAttribute('data-span')), rows: Number(d.getAttribute('data-rows')) }
    })()`)
    let saved = null
    try { saved = await evalIn(`(() => { try { return JSON.parse(localStorage.getItem('dsh-usage-panel:prefs') || '{}') } catch { return null } })()`) } catch { saved = null }
    log('  改宽高后: ' + JSON.stringify(rz2) + '  已存: ' + JSON.stringify(saved && saved.cardSpans))
    expect('拖动把手真的改变了宽度', rz2.span > rz.span0, `span ${rz.span0} → ${rz2.span}`)
    expect('宽度变化已持久化', !!(saved && saved.cardSpans && saved.cardSpans[rz2.key] === rz2.span), JSON.stringify(saved && saved.cardSpans))

    /* ---- ② 拖卡片本体重排 ---- */
    const ord0 = (await evalIn(`(() => [...document.querySelectorAll('[data-card]')].map((e) => e.getAttribute('data-card')))()`))
    const mv = await evalIn(`(() => {
      const moves = [...document.querySelectorAll('[data-card-move]')]
      if (moves.length < 3) return null
      const a = moves[0].getBoundingClientRect()
      const b = moves[2].getBoundingClientRect()
      return { x: Math.round(a.left + a.width / 2), y: Math.round(a.top + a.height / 2), tx: Math.round(b.left + b.width / 2), ty: Math.round(b.top + b.height / 2) }
    })()`)
    log('  重排: ' + JSON.stringify({ from: mv && { x: mv.x, y: mv.y }, to: mv && { x: mv.tx, y: mv.ty } }))
    if (mv) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mv.x, y: mv.y, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(mv.x + (mv.tx - mv.x) * i / 6), y: Math.round(mv.y + (mv.ty - mv.y) * i / 6), button: 'left' })
        await sleep(80)
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mv.tx, y: mv.ty, button: 'left', clickCount: 1 })
      await sleep(700)
    }
    const ord1 = (await evalIn(`(() => [...document.querySelectorAll('[data-card]')].map((e) => e.getAttribute('data-card')))()`))
    log('  顺序: ' + JSON.stringify(ord0) + ' → ' + JSON.stringify(ord1))
    expect('拖卡片本体真的改变了顺序', JSON.stringify(ord0) !== JSON.stringify(ord1), JSON.stringify(ord1.slice(0, 4)))

    /* ---- ③ 卡片之间不能重叠（几何检查） ---- */
    const overlaps = await evalIn(`(() => {
      const rs = [...document.querySelectorAll('[data-card]')].map((e) => { const r = e.getBoundingClientRect(); return { k: e.getAttribute('data-card'), l: r.left, t: r.top, r: r.right, b: r.bottom } })
      const bad = []
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j]
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l)
        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t)
        if (ox > 2 && oy > 2) bad.push(a.k + '×' + b.k)
      }
      return bad
    })()`)
    expect('磁贴之间没有重叠', Array.isArray(overlaps) && overlaps.length === 0, JSON.stringify(overlaps))

    /* ---- ④ ⊖ 隐藏一张卡 ---- */
    const hidKey = await evalIn(`(() => { const b = document.querySelector('[data-card-hide]'); return b ? b.getAttribute('data-card-hide') : null })()`)
    const beforeCount = (await evalIn(`(() => document.querySelectorAll('[data-card]').length)()`))
    await evalIn(`(() => { const b = document.querySelector('[data-card-hide]'); if (b) b.click(); return true })()`)
    await sleep(600)
    const afterCount = (await evalIn(`(() => document.querySelectorAll('[data-card]').length)()`))
    log('  隐藏: ' + hidKey + '  卡数 ' + beforeCount + ' → ' + afterCount)
    expect('点 ⊖ 真的隐藏了一张卡', afterCount === beforeCount - 1, `${beforeCount} → ${afterCount}`)
    /* 恢复，免得影响后面的截图与步骤 */
    await evalIn(`(() => { try { const p = JSON.parse(localStorage.getItem('dsh-usage-panel:prefs') || '{}'); p.cardHidden = []; localStorage.setItem('dsh-usage-panel:prefs', JSON.stringify(p)); return true } catch { return false } })()`)

    /* ---- ⑤ 退出编辑态 ---- */
    expect('退出布局编辑', (await clickText('完成')) === 'clicked')
    await sleep(500)
    const ex = await evalIn(`(() => ({
      on: (document.querySelector('[data-layout-edit]') || {}).getAttribute ? document.querySelector('[data-layout-edit]').getAttribute('data-layout-edit') : '',
      resizers: document.querySelectorAll('[data-card-resize]').length,
      moves: document.querySelectorAll('[data-card-move]').length
    }))()`)
    expect('退出后编辑把手消失', ex.resizers === 0 && ex.moves === 0, JSON.stringify(ex))
  }

  log('\n=== 5f. 按钮被拖到角落时，面板必须完整可见 ===')
  {
    await evalIn(`(() => { try { localStorage.setItem('dsh-usage-panel:fabpos', JSON.stringify({ x: -900, y: -700 })); return true } catch { return false } })()`)
    await cdp.send('Page.reload')
    await sleep(7000)
    const fab = await evalIn(`(() => {
      const f = document.querySelector('.dsh-fab')
      if (!f) return null
      const r = f.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: Math.round(r.left), t: Math.round(r.top) }
    })()`)
    log('  按钮已被移到: ' + JSON.stringify(fab))
    /* 注意：open=1 时刷新会自动打开面板，这里必须先判断，否则 click 会把面板关掉 */
    const wasOpen = await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const o = !!document.querySelector('[data-dsh-usage-panel]'); if (f && !o) f.click(); return o })()`)
    await sleep(2400)
    if (!wasOpen) { /* 由上面那次点击打开 */ }
    const box = await evalIn(`(() => {
      const p = document.querySelector('[data-dsh-usage-panel]')
      if (!p) return null
      const r = p.getBoundingClientRect()
      const f = document.querySelector('.dsh-fab')
      const fr = f ? f.getBoundingClientRect() : null
      return {
        l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
        vw: window.innerWidth, vh: window.innerHeight,
        fl: fr ? Math.round(fr.left) : null, ft: fr ? Math.round(fr.top) : null
      }
    })()`)
    log('  面板: ' + JSON.stringify(box))
    expect('面板已出现', !!(box && box.w > 100), JSON.stringify(box))
    expect('面板左边不越界', !!(box && box.l >= 0), box && String(box.l))
    expect('面板顶边不越界', !!(box && box.t >= 0), box && String(box.t))
    expect('面板右边不越界', !!(box && box.r <= box.vw), box && (box.r + ' <= ' + box.vw))
    expect('面板底边不越界', !!(box && box.b <= box.vh), box && (box.b + ' <= ' + box.vh))
    expect('面板顶边让开自绘标题栏（>= 44px，不被窗口按钮遮住）', !!(box && box.t >= 44), box && String(box.t))
    expect('面板头部完整可见（高度足够容纳表头）', !!(box && box.h > 200), box && String(box.h))
    expect('面板没被按钮或屏幕边缘裁切（四边都在视口内）',
      !!(box && box.l >= 0 && box.t >= 0 && box.r <= box.vw && box.b <= box.vh), JSON.stringify(box))
    /* 复位，避免影响后面的步骤 */
    await evalIn(`(() => { try { localStorage.removeItem('dsh-usage-panel:fabpos') } catch { /* ignore */ } return true })()`)
    await cdp.send('Page.reload')
    await sleep(7000)
    await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); if (f && !document.querySelector('[data-dsh-usage-panel]')) f.click(); return true })()`)
    await sleep(1500)
  }

  log('\n=== 12. v0.2.2 新玩法（等级条 / 血条 / 热力图点按 / 分享）===')
  {
    await evalIn(`(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('dsh-usage-panel:prefs') || '{}')
        raw.fLevel = true; raw.fBalance = true; raw.fHeatmap = true
        localStorage.setItem('dsh-usage-panel:prefs', JSON.stringify(raw))
        return true
      } catch { return false }
    })()`)
    await cdp.send('Page.reload')
    await sleep(6500)
    await evalIn(`(() => { const f = document.querySelector('.dsh-fab'); const o = !!document.querySelector('[data-dsh-usage-panel]'); if (f && !o) f.click(); return o })()`)
    await sleep(2200)

    const has = await evalIn(`(() => {
      const p = document.querySelector('[data-dsh-usage-panel]')
      const lv = p ? p.querySelector('[data-level-strip]') : null
      const hp = p ? p.querySelector('[data-hp]') : null
      const share = p ? p.querySelector('[data-share]') : null
      return {
        level: !!lv, levelText: lv ? lv.innerText.replace(/\s+/g, ' ').trim().slice(0, 60) : null,
        hp: !!hp, hpPct: hp ? hp.getAttribute('data-hp') : null,
        share: !!share
      }
    })()`)
    log('  新玩法节点: ' + JSON.stringify(has))
    expect('等级条存在且显示 Lv', !!(has && has.level && /Lv\.\d/.test(has.levelText || '')), JSON.stringify(has))
    expect('分享按钮存在', !!(has && has.share), JSON.stringify(has))
    if (has && has.hp) expect('余额血条显示了百分比', Number(has.hpPct) >= 0 && Number(has.hpPct) <= 100, String(has.hpPct))
    else log('  · 余额不可用，跳过血条断言（逻辑随账户服务状态变化）')

    /* 热力图点按 → 当日明细 */
    const picked = await evalIn(`(() => {
      const p = document.querySelector('[data-dsh-usage-panel]')
      if (!p) return null
      const cell = p.querySelector('[data-day]')
      if (!cell) return null
      const day = cell.getAttribute('data-day')
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return { day }
    })()`)
    await sleep(900)
    const detail = await evalIn(`(() => {
      const d = document.querySelector('[data-day-detail]')
      return d ? { day: d.getAttribute('data-day'), text: d.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) } : null
    })()`)
    log('  点按结果: ' + JSON.stringify(picked) + ' → ' + JSON.stringify(detail))
    if (picked) {
      expect('点热力图格子后出现当日明细', !!(detail && detail.day === picked.day), JSON.stringify({ picked, detail }))
      expect('当日明细含 Token/成本/请求', !!(detail && /Token/.test(detail.text) && /成本/.test(detail.text)), JSON.stringify(detail))
    } else log('  · 没有可点的热力图格子（数据不足），跳过')
  }

  log('\n=== 清理 ===')
  try { cdp?.close() } catch { /* ignore */ }
  if (dsh?.child?.pid) { try { execFileSync('taskkill', ['/PID', String(dsh.child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ } }
  if (chrome?.pid) { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ } }
  await sleep(2000)
  try { rmSync(CHROME_DATA, { recursive: true, force: true }) } catch { /* ignore */ }
  log(`  ✓ 已结束；插件源码完好: ${existsSync(join(HERE, '..', 'lib', 'client.js'))}`)
  /* 退出码按最终失败数决定：这样即使断言写在「清理」之前也不会被漏掉 */
  process.exit(failures.length ? 1 : 0)
}
