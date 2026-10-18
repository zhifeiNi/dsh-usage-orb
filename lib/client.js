/**
 * dsh-usage-orb — client 侧（浏览器 bundle）  v0.2.1
 *
 * 约束（DSH 客户端模块系统）：
 *   · 手写 CJS，不用 JSX，只 require('react') / require('react-dom/client')
 *   · 样式用 inline style；只有「动效关键帧」用注入的 <style>（无外部依赖、无构建）
 *   · 零依赖：热力图 / 堆叠柱 / 环形图 / 折线全部手写 SVG
 *
 * 数据通道：POST 相对路径 /usage-panel/api/usage（credentials: same-origin）
 * 服务端一次返回完整聚合（逐日 / 逐模型 / 工具 / 会话），区间与视图切换在客户端本地
 * 完成 —— 所以 7/14/30/全部 切换是瞬时的，不重新请求。
 */
'use strict'

window.__ModuleLoader__.load({
  id: 'dsh-usage-orb',
  factory: (require) => {
    /* 放进 factory 作用域：这样即使同一份 bundle 被求值两次也不会顶层重复声明 */
    const PANEL_ID = 'dsh-usage-orb'
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const ROUTE = '/usage-panel/api/usage'
    const VERSION = '0.2.2'
    const LS = {
      width: 'dsh-usage-panel:width',
      range: 'dsh-usage-panel:range',
      mode: 'dsh-usage-panel:mode',
      metric: 'dsh-usage-panel:metric',
      budget: 'dsh-usage-panel:budget',
      open: 'dsh-usage-panel:open'
    }
      /* ===== bloub 表情引擎（内联，来源：gongju/bloub-expressions）===== */
  const BLOUB = (() => {
  "use strict";
  /* ================================================================
   * 引擎核心 —— 逐行移植自 bloub-main/src/bot（纯函数，无框架无时钟）
   * ================================================================ */

  /* ---- math.ts ---- */
  const TAU = Math.PI * 2;
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easings = {
      easeOutCubic: (t) => 1 - (1 - t) ** 3,
      easeInOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
      easeOutQuint: (t) => 1 - (1 - t) ** 5,
  };
  function loopNoise(t, period, seed = 0) {
      const p = (t / period) * TAU;
      return 0.55 * Math.sin(p + seed) + 0.3 * Math.sin(2 * p + seed * 1.7 + 1.1) + 0.15 * Math.sin(3 * p + seed * 2.3 + 2.4);
  }
  function createRng(seed) {
      let a = seed >>> 0;
      return () => {
          a = (a + 0x6d2b79f5) >>> 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
  }
  const r2 = (v) => Math.round(v * 100) / 100;

  /* ---- profiles.ts（仅需采样数）---- */
  const PROFILE_SAMPLES = 64;

  /* ---- shape.ts ---- */
  const ANGLES = Array.from({ length: PROFILE_SAMPLES }, (_, i) => (i / PROFILE_SAMPLES) * TAU);
  const COS = ANGLES.map(Math.cos);
  const SIN = ANGLES.map(Math.sin);
  function circle(radius) {
      return { radii: new Array(PROFILE_SAMPLES).fill(radius), rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 };
  }
  function toPoints(s, scale, out = []) {
      const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
      for (let i = 0; i < PROFILE_SAMPLES; i++) {
          const r = s.radii[i] ?? 1;
          const x = r * (COS[i] ?? 0), y = r * (SIN[i] ?? 0);
          const rx = x * cr - y * sr, ry = x * sr + y * cr;
          const p = out[i] ?? { x: 0, y: 0 };
          p.x = (rx * s.sx + s.cx) * scale;
          p.y = (ry * s.sy + s.cy) * scale;
          out[i] = p;
      }
      out.length = PROFILE_SAMPLES;
      return out;
  }
  function closedPath(pts, tension = 1 / 6) {
      const n = pts.length;
      if (n < 3) return "";
      const first = pts[0];
      let d = `M${r2(first.x)} ${r2(first.y)}`;
      for (let i = 0; i < n; i++) {
          const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
          const c1x = p1.x + (p2.x - p0.x) * tension, c1y = p1.y + (p2.y - p0.y) * tension;
          const c2x = p2.x - (p3.x - p1.x) * tension, c2y = p2.y - (p3.y - p1.y) * tension;
          d += `C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2.x)} ${r2(p2.y)}`;
      }
      return `${d}Z`;
  }
  function capsulePath(w, h) {
      const hw = Math.max(w, 0.01) / 2, hh = Math.max(h, 0.01) / 2, r = Math.min(hw, hh);
      return (
          `M${r2(-hw)} ${r2(-hh + r)}` +
          `A${r2(r)} ${r2(r)} 0 0 1 ${r2(-hw + r)} ${r2(-hh)}` +
          `L${r2(hw - r)} ${r2(-hh)}` +
          `A${r2(r)} ${r2(r)} 0 0 1 ${r2(hw)} ${r2(-hh + r)}` +
          `L${r2(hw)} ${r2(hh - r)}` +
          `A${r2(r)} ${r2(r)} 0 0 1 ${r2(hw - r)} ${r2(hh)}` +
          `L${r2(-hw + r)} ${r2(hh)}` +
          `A${r2(r)} ${r2(r)} 0 0 1 ${r2(-hw)} ${r2(hh - r)}Z`
      );
  }
  function radiusAtAngle(radii, angle) {
      const n = radii.length;
      const t = ((((angle / TAU) % 1) + 1) % 1) * n;
      const i = Math.floor(t);
      return lerp(radii[i % n] ?? 1, radii[(i + 1) % n] ?? 1, t - i);
  }

  /* ---- face.ts ---- */
  const EYE_SPLIT = 15.46, EYE_W = 0.186, EYE_H = 0.412;
  const REST_GAZE = { yaw: 28.49, pitch: 28.62, roll: -13 };
  const deg = (d) => (d * Math.PI) / 180;
  function spin(u, v, angle) {
      const c = Math.cos(angle), s = Math.sin(angle);
      return [
          [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
          [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s],
      ];
  }
  function eyePoses(gaze, scale, split = EYE_SPLIT) {
      let f = [0, 0, 1], right = [1, 0, 0], down = [0, 1, 0];
      [f, right] = spin(f, right, deg(gaze.yaw));
      [down, f] = spin(down, f, deg(gaze.pitch));
      [right, down] = spin(right, down, deg(gaze.roll));
      const build = (side) => {
          const [ef, er] = spin(f, right, deg(split * side));
          return { x: ef[0] * scale, y: ef[1] * scale, a: er[0], b: er[1], c: down[0], d: down[1], depth: ef[2] };
      };
      return [build(-1), build(1)];
  }
  const B_RNG = createRng(0x5eed);
  const BLINKS = (() => {
      const out = []; let t = 1.4;
      while (t < 900) {
          out.push(t);
          t += 1.9 + B_RNG() * 2.7;
          if (B_RNG() < 0.18) { out.push(t); t += 0.24; }
      }
      return out;
  })();
  const BLINK_DUR = 0.18;
  function blinkLid(t) {
      for (let i = 0; i < BLINKS.length; i++) {
          const start = BLINKS[i];
          if (t < start) break;
          const k = (t - start) / BLINK_DUR;
          if (k >= 0 && k <= 1) return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55;
      }
      return 1;
  }
  function liveliness(t, opt = {}) {
      const { wander = 1, blink = true, float = true } = opt;
      return {
          dYaw: (loopNoise(t, 11.3, 0.4) * 5.5 + loopNoise(t, 3.7, 2.1) * 1.6) * wander,
          dPitch: (loopNoise(t, 9.1, 1.3) * 4.2 + loopNoise(t, 4.3, 0.7) * 1.3) * wander,
          dRoll: loopNoise(t, 13.7, 3.2) * 2.2 * wander,
          lid: blink ? blinkLid(t) : 1,
          driftX: float ? loopNoise(t, 7.9, 1.9) * 0.006 : 0,
          driftY: float ? loopNoise(t, 5.3, 0.3) * 0.007 : 0,
          breath: float ? 1 + Math.sin((t / 3.4) * Math.PI * 2) * 0.005 : 1,
      };
  }
  function blinkScale(lid) { return 0.06 + 0.94 * clamp(lid); }

  /* ---- expressions.ts（16 种表情）---- */
  const eye = (w, h, tilt = 0, open = 1) => ({ w, h, tilt, open });
  const pair = (w, h, tilt = 0, open = 1) => [eye(w, h, tilt, open), eye(w, h, -tilt, open)];
  const EXPRESSIONS = [
      { id: "neutre", zh: "自然", gaze: { ...REST_GAZE }, split: EYE_SPLIT, eyes: [eye(EYE_W, EYE_H), eye(EYE_W, EYE_H)] },
      { id: "attentif", zh: "专注", gaze: { yaw: 4, pitch: 5, roll: -4 }, split: 16, eyes: pair(0.21, 0.44) },
      { id: "surpris", zh: "惊讶", gaze: { yaw: 3, pitch: -3, roll: 0 }, split: 19, eyes: pair(0.45, 0.47) },
      { id: "excite", zh: "兴奋", gaze: { yaw: 6, pitch: -14, roll: 0 }, split: 19.5, eyes: pair(0.4, 0.56, -10) },
      { id: "heureux", zh: "高兴", gaze: { yaw: 5, pitch: 9, roll: 0 }, split: 17, eyes: pair(0.27, 0.17, 14) },
      { id: "hilare", zh: "大笑", gaze: { yaw: 4, pitch: 14, roll: 0 }, split: 18, eyes: pair(0.34, 0.13, 20) },
      { id: "colere", zh: "愤怒", gaze: { yaw: 3, pitch: 7, roll: 0 }, split: 17, eyes: pair(0.34, 0.15, 30) },
      { id: "triste", zh: "悲伤", gaze: { yaw: 3, pitch: -13, roll: 0 }, split: 16, eyes: pair(0.22, 0.4, -28) },
      { id: "effraye", zh: "惊恐", gaze: { yaw: 2, pitch: -20, roll: 0 }, split: 20.5, eyes: pair(0.4, 0.6) },
      { id: "mefiant", zh: "怀疑", gaze: { yaw: 12, pitch: 6, roll: -6 }, split: 16, eyes: [eye(0.21, 0.4), eye(0.22, 0.15)] },
      { id: "confus", zh: "困惑", gaze: { yaw: -14, pitch: 3, roll: 8 }, split: 16.5, eyes: [eye(0.2, 0.44, -18), eye(0.28, 0.17, 14)] },
      { id: "curieux", zh: "好奇", gaze: { yaw: 16, pitch: -9, roll: -15 }, split: 16.5, eyes: [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)] },
      { id: "fier", zh: "骄傲", gaze: { yaw: 5, pitch: 17, roll: 0 }, split: 17, eyes: pair(0.3, 0.15, 18) },
      { id: "timide", zh: "害羞", gaze: { yaw: -19, pitch: -14, roll: -7 }, split: 14, eyes: pair(0.17, 0.3) },
      { id: "blase", zh: "冷漠", gaze: { yaw: -22, pitch: 2, roll: 0 }, split: 16, eyes: pair(0.3, 0.12) },
      { id: "somnolent", zh: "困倦", gaze: { yaw: 6, pitch: -9, roll: -3 }, split: 16, eyes: pair(0.2, 0.42, 0, 0.42) },
  ];
  const EXPRESSION_BY_ID = new Map(EXPRESSIONS.map((e) => [e.id, e]));

  function blendExpression(a, b, t) {
      const lerpEye = (x, y) => ({ w: lerp(x.w, y.w, t), h: lerp(x.h, y.h, t), tilt: lerp(x.tilt ?? 0, y.tilt ?? 0, t), open: lerp(x.open, y.open, t) });
      return {
          id: b.id,
          gaze: { yaw: lerp(a.gaze.yaw, b.gaze.yaw, t), pitch: lerp(a.gaze.pitch, b.gaze.pitch, t), roll: lerp(a.gaze.roll, b.gaze.roll, t) },
          split: lerp(a.split, b.split, t),
          eyes: [lerpEye(a.eyes[0], b.eyes[0]), lerpEye(a.eyes[1], b.eyes[1])],
      };
  }

  /* ---- 常量（repere.ts / engine.ts）---- */
  const RAYON = 100;          // scale
  const DEMI_VIEWBOX = 158;
  const SHAPE_MORPH = 0.45;   // 表情切换插值时长

  /* ---- 渲染一帧（engine.sample 的 idle 分支，1:1）---- */
  const pts = []; // 复用点数组，避免每帧分配
  function frameFor(expr, now, morphState) {
      let eff = expr;
      if (morphState.active) {
          const k = (now - morphState.at) / SHAPE_MORPH;
          if (k < 1) eff = blendExpression(morphState.from, expr, easings.easeOutQuint(clamp(k)));
          else morphState.active = false;
      }

      // idle 基础姿态（base()）：圆形身体 + 表达式替换脸部
      const pose = {
          sil: circle(1), offX: 0, offY: 0,
          gaze: eff.gaze, split: eff.split, eyes: eff.eyes,
          eyeAlpha: 1, bodyAlpha: 1, dots: [], arcs: [], notif: null, dotsBehind: false,
      };

      // 生命力（idle：wander=1, blink=on）
      const look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 };
      const life = liveliness(now, { wander: look.wander, blink: true });
      const gaze = {
          yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + life.dYaw - look.spin,
          pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + life.dPitch,
          roll: pose.gaze.roll + life.dRoll,
      };

      // 眨眼：仅生命力驱动（idle 无状态切换，forced=1）
      const lid = life.lid;
      const offX = pose.offX + life.driftX, offY = pose.offY + life.driftY;
      const decalage = { x: 0, y: 0 }; // idle 圆形身体：eyefit 表返回 NUL(0,0)

      // ---- 身体轮廓（Catmull-Rom 闭合曲线）----
      const sil = { ...pose.sil, cx: pose.sil.cx + offX, cy: pose.sil.cy + offY, sy: pose.sil.sy * life.breath };
      const bodyPath = closedPath(toPoints(sil, RAYON, pts));

      // ---- 眼睛（打洞在身体上）----
      const bodyRadius = (x, y) => radiusAtAngle(pose.sil.radii, Math.atan2(y, x) - pose.sil.rot);
      const eyes = [];
      const poses = eyePoses(gaze, RAYON, pose.split);
      for (let i = 0; i < 2; i++) {
          const e = poses[i];
          if (e.depth <= 0.02) continue;
          const cfg = pose.eyes[i];
          const fit = bodyRadius(e.x, e.y);
          const phi = ((cfg.tilt ?? 0) * Math.PI) / 180;
          const cp = Math.cos(phi), sp = Math.sin(phi);
          const ax = e.a * cp + e.c * sp, ay = e.b * cp + e.d * sp;
          const cx2 = -e.a * sp + e.c * cp, cy2 = -e.b * sp + e.d * cp;
          const k = blinkScale(Math.min(lid, cfg.open));
          eyes.push({
              d: capsulePath(cfg.w * RAYON, cfg.h * RAYON),
              matrix: `matrix(${r2(ax)},${r2(ay * k)},${r2(cx2)},${r2(cy2 * k)},${r2(e.x * fit + (offX + decalage.x) * RAYON)},${r2(e.y * fit + (offY + decalage.y) * RAYON)})`,
              alpha: pose.eyeAlpha * clamp(e.depth / 0.12),
          });
      }

      return {
          bodyPath,
          bodyAlpha: pose.bodyAlpha,
          eyes,
          dots: [],
          dotsBehind: false,
          arcs: [],
          notif: null,
          notch: null,
      };
  }

  /* ================================================================
   * SVG 渲染层 —— 1:1 对应 BloubBot.vue 模板
   * ================================================================ */
  const paper = "#f9f9f9", ink = "#0a0a0c";
  const VB = DEMI_VIEWBOX;
  const NOTIF_BLUE = "#2496e8";

  function mixHex(a, b, t) {
      const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
      const ch = (sh) => ((pa >> sh) & 255) + ((((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
      const r = Math.round(ch(16)), g = Math.round(ch(8)), bl = Math.round(ch(0));
      return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
  }

  function dotSvg(dot) {
      const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
      const common = `fill="${fill}" opacity="${dot.opacity}"`;
      return dot.d
          ? `<path d="${dot.d}" ${common} transform="translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})" />`
          : `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.r}" ${common} />`;
  }

  function frameToSvg(frame, nonce) {
      const maskId = `bm-${nonce}`;

      // mask：白色身体 + 眼睛黑色打洞 + notify 缺口
      let defs =
          `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${-VB}" y="${-VB}" width="${VB * 2}" height="${VB * 2}">` +
          `<path d="${frame.bodyPath}" fill="#fff" />`;
      for (const e of frame.eyes) {
          defs += `<path d="${e.d}" transform="${e.matrix}" opacity="${e.alpha}" fill="#000" />`;
      }
      if (frame.notch) {
          defs += `<circle cx="${frame.notch.x}" cy="${frame.notch.y}" r="${frame.notch.r}" fill="#000" />`;
      }
      defs += `</mask>`;

      // 轨道渐变
      if (frame.arcs.length) {
          for (const arc of frame.arcs) {
              const gid = `g-${nonce}-${arc.id}`;
              let stops = "";
              const denom = Math.max(1, arc.grad.stops.length - 1);
              arc.grad.stops.forEach((c, i) => {
                  stops += `<stop offset="${i / denom}" stop-color="${c}" />`;
              });
              defs += `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${arc.grad.x1}" y1="${arc.grad.y1}" x2="${arc.grad.x2}" y2="${arc.grad.y2}">${stops}</linearGradient>`;
          }
      }

      const arcBack = frame.arcs.length
          ? `<g fill="none" stroke-linecap="round">` +
            frame.arcs.map((a) => `<path d="${a.back}" stroke="url(#g-${nonce}-${a.id})" stroke-width="${a.width}" opacity="${a.opacity}" />`).join("") +
            `</g>`
          : "";
      const dotsBehind = frame.dotsBehind ? `<g>${frame.dots.map(dotSvg).join("")}</g>` : "";
      const body =
          `<g opacity="${frame.bodyAlpha}">` +
          `<path d="${frame.bodyPath}" fill="${paper}" />` +
          `<g mask="url(#${maskId})"><rect x="${-VB}" y="${-VB}" width="${VB * 2}" height="${VB * 2}" fill="${ink}" /></g>` +
          `</g>`;
      const dotsFront = !frame.dotsBehind && frame.dots.length ? `<g>${frame.dots.map(dotSvg).join("")}</g>` : "";
      const notif = frame.notif ? `<circle cx="${frame.notif.x}" cy="${frame.notif.y}" r="${frame.notif.r}" fill="${NOTIF_BLUE}" />` : "";
      const arcFront = frame.arcs.length
          ? `<g fill="none" stroke-linecap="round">` +
            frame.arcs.map((a) => `<path d="${a.front}" stroke="url(#g-${nonce}-${a.id})" stroke-width="${a.width}" opacity="${a.opacity}" />`).join("") +
            `</g>`
          : "";

      return `<defs>${defs}</defs>${arcBack}${dotsBehind}${body}${dotsFront}${notif}${arcFront}`;
  }

  let maskCounter = 0;
  function renderFrame(frame) {
      svgEl.innerHTML = frameToSvg(frame, ++maskCounter);
  }

  /* ================================================================
   * 交互与主循环
   * ================================================================ */
    return { EXPRESSIONS, frameFor, frameToSvg, SHAPE_MORPH }
  })()

const MIN_W = 360
    const MAX_W = 960
    const DEFAULT_W = 420

    /* ================================================================ *
     * 面板开合（模块级状态，跨 HMR 保持）
     * ================================================================ */

    /*
 * 早期就装上的错误上报：渲染进程一旦出问题，现场会被送到宿主的
 * /usage-panel/api/client-log，这样"按钮静默消失"这类问题就有迹可循。
 */
const reportClientError = (kind, err) => {
  try {
    const ls = {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.indexOf('usage-panel') >= 0) ls[k] = String(localStorage.getItem(k)).slice(0, 300)
      }
    } catch { /* ignore */ }
    const q = new URLSearchParams({
      kind: String(kind).slice(0, 40),
      msg: String((err && (err.stack || err.message)) || err || '').slice(0, 1000),
      href: String(location.href).slice(0, 160),
      ls: JSON.stringify(ls).slice(0, 500)
    })
    fetch('/usage-panel/api/client-log?' + q.toString()).catch(() => {})
  } catch { /* 上报自身绝不能再抛 */ }
}
try { window.addEventListener('error', (e) => reportClientError('error', e.error ?? e.message)) } catch { /* ignore */ }
try { window.addEventListener('unhandledrejection', (e) => reportClientError('rejection', e.reason)) } catch { /* ignore */ }
/* 挂载自检：2 秒后仍看不到按钮，就把现场报上去（不改变任何行为） */
try {
  setTimeout(() => {
    try {
      const fab = document.querySelector('.dsh-fab, [data-dsh-fab-fallback]')
      if (!fab) reportClientError('no-fab', '挂载 2 秒后既没有 .dsh-fab 也没有 fallback：' + (document.body ? document.body.children.length + ' 个顶层节点' : 'no body'))
    } catch { /* ignore */ }
  }, 2000)
} catch { /* ignore */ }

/*
 * 启动一律从「关闭」开始：不从存储恢复打开状态。
 * 恢复路径只在「上次退出时面板是开着的」这一种情况下才会走；一旦它有 bug，
 * 用户看到的就是「既没有面板、也没有按钮」——最难排查的一种失败。
 * 按钮必须无条件出现，面板只由点击打开。
 */
let panelOpen = false

    let panelHost = null
    let reactRoot = null
    const listeners = new Set()

    const emit = () => {
      for (const listener of listeners) {
        try { listener() } catch { /* 单个监听器出错不影响其它 */ }
      }
    }

    /*
     * 只改状态 + 通知订阅者。
     *
     * 踩过的坑（v0.1.0 的真实缺陷）：这里曾经额外做
     * `panelHost.style.display = next ? 'block' : 'none'`。但按钮和面板渲染在
     * **同一个 host** 里，于是「关闭面板」会把 host 一起隐藏 —— 开它的那个按钮也
     * 消失，而且再也点不回来（直到刷新页面）。
     */
    const setOpen = (next) => {
      panelOpen = next
      try { localStorage.setItem(LS.open, next ? '1' : '0') } catch { /* ignore */ }
      emit()
    }

    const usePanelOpen = () => {
      const [, force] = React.useReducer((n) => n + 1, 0)
      useEffect(() => {
        listeners.add(force)
        return () => listeners.delete(force)
      }, [])
      return panelOpen
    }

    /* ================================================================ *
     * 主题与调色板
     * ================================================================ */

    const C = {
      text: '#e9eaec',
      dim: 'rgba(233,234,236,.66)',
      faint: 'rgba(233,234,236,.40)',
      border: 'rgba(255,255,255,.12)',
      border2: 'rgba(255,255,255,.07)',
      card: 'rgba(255,255,255,.045)',
      cardSolid: 'rgba(26,28,32,.98)',
      accent: '#6f9dff',
      good: '#4cc38a',
      warn: '#e5a13a',
      bad: '#ef6b6b',
      purple: '#8f7bff'
    }
    const PALETTE = ['#5b8def', '#4cc38a', '#e5a13a', '#ef6b6b', '#8f7bff', '#38bdc9', '#9aa4b2']
    const HEAT = ['rgba(255,255,255,.06)', '#1e3d6b', '#2f63ad', '#4a8ae6', '#82b6ff']
    const CLASSES = [
      { key: 'uncachedInput', label: '未缓存输入', color: '#5b8def' },
      { key: 'cacheRead', label: '缓存读取', color: '#4cc38a' },
      { key: 'output', label: '输出', color: '#e5a13a' }
    ]

    /* ================================================================ *
     * 格式化
     * ================================================================ */

    const exact = (n) => (Number.isFinite(n) ? new Intl.NumberFormat('zh-CN').format(Math.round(n)) : '—')

    /** 中文量级（只用于 token 量） */
    function cn(n) {
      if (!Number.isFinite(n)) return '—'
      const a = Math.abs(n)
      if (a >= 1e8) return (n / 1e8).toFixed(2) + '亿'
      if (a >= 1e4) return (n / 1e4).toFixed(1) + '万'
      return exact(n)
    }
    /** 数字部分（配合 cnUnit 使用，便于大字号 + 小单位排版） */
    function cnNum(n) {
      if (!Number.isFinite(n)) return '—'
      const a = Math.abs(n)
      if (a >= 1e8) return (n / 1e8).toFixed(2)
      if (a >= 1e4) return (n / 1e4).toFixed(1)
      return exact(n)
    }
    const cnUnit = (n) => (Math.abs(n) >= 1e8 ? '亿' : Math.abs(n) >= 1e4 ? '万' : '')

    const pct = (r, d = 1) => (Number.isFinite(r) ? (r * 100).toFixed(d) + '%' : '—')
    const pctNum = (r, d = 1) => (Number.isFinite(r) ? (r * 100).toFixed(d) : '—')

    /* 货币符号由服务端的价目表决定（默认人民币 ¥）。
       金额一律不做汇率换算 —— 官方人民币价与美元价是两套独立标价。 */
    const CUR = { symbol: '¥' }

      /*
       * 显示形态（详细 / 简洁）。
       * 面板只有一点空间，简洁模式把「解释性长文案」全部去掉，只留标签与数字；
       * 关键诚实口径（API 标价 ≠ 实际账单）保留一个短版，不因为它而消失。
       */
      /* PURE-START —— 这一段不碰 DOM / React / localStorage，测试脚本直接求值它 */
      const PURE = (() => {
        /** 订阅顺序规整：去重、丢掉未知项、补齐缺失项 */
        const normalizeOrder = (order, keys) => {
          const seen = new Set()
          const out = []
          for (const k of Array.isArray(order) ? order : []) {
            if (keys.includes(k) && !seen.has(k)) { seen.add(k); out.push(k) }
          }
          for (const k of keys) if (!seen.has(k)) { seen.add(k); out.push(k) }
          return out
        }
        const clampInt = (v, lo, hi, dflt) => {
          const n = Math.round(Number(v))
          return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
        }
        /** 指标卡方案：顺序 + 显隐 + 宽（1..3 列）+ 高（1..2 行） */
        const planCards = ({ order, keys, hidden, spans, rows }) => {
          const hide = new Set(Array.isArray(hidden) ? hidden : [])
          return normalizeOrder(order, keys)
            .filter((k) => !hide.has(k))
            .map((k) => ({
              key: k,
              span: clampInt(spans?.[k] ?? 1, 1, 3, 1),
              rows: clampInt(rows?.[k] ?? 1, 1, 2, 1)
            }))
        }
        /** token 计数简写（亿 / 万） */
        const cn = (n) => {
          if (!Number.isFinite(n)) return '—'
          const a = Math.abs(n)
          if (a >= 1e8) return (n / 1e8).toFixed(2) + '亿'
          if (a >= 1e4) return (n / 1e4).toFixed(1) + '万'
          return String(Math.round(n))
        }
        const cnUnit = (n) => (Math.abs(n) >= 1e8 ? '亿' : Math.abs(n) >= 1e4 ? '万' : '')
        const pct = (r, d = 1) => (Number.isFinite(r) ? (r * 100).toFixed(d) + '%' : '—')
        const pctNum = (r, d = 1) => (Number.isFinite(r) ? (r * 100).toFixed(d) : '—')
        const money = (v, symbol = '¥') => {
          if (!Number.isFinite(v)) return '—'
          const a = Math.abs(v)
          const s = symbol
          if (a >= 1000) return s + (v / 1000).toFixed(2) + 'K'
          if (a >= 100) return s + v.toFixed(1)
          if (a >= 1) return s + v.toFixed(2)
          if (a >= 0.01) return s + v.toFixed(3)
          return s + v.toFixed(4)
        }
        const costOf = (t, rate, mult) =>
          ((t.uncachedInput ?? 0) * rate.cacheMiss * mult +
            (t.cacheRead ?? 0) * rate.cacheHit * mult +
            (t.output ?? 0) * rate.output * mult) / 1e6
        /**
         * 「如果」模拟器的成本重算。
         * moveFrac：把高峰用量的这个比例挪到空闲；hitPct：假想的缓存命中率（null = 维持现状）
         */
        const simCost = ({ peak, off, rate, mult, moveFrac = 0, hitPct = null }) => {
          const rebalance = (t) => {
            if (hitPct === null) return t
            const prompt = (t.uncachedInput ?? 0) + (t.cacheRead ?? 0)
            return { uncachedInput: prompt * (1 - hitPct / 100), cacheRead: prompt * (hitPct / 100), output: t.output ?? 0 }
          }
          const f = Math.min(1, Math.max(0, moveFrac))
          const p = rebalance(peak)
          return costOf(rebalance(off), rate, 1) + costOf(p, rate, 1) * f + costOf(p, rate, mult) * (1 - f)
        }
        return { normalizeOrder, planCards, clampInt, cn, cnUnit, pct, pctNum, money, costOf, simCost }
      })()
      /* PURE-END */

      /* 上面的纯函数在这里落地成实现（避免两套口径） */
      const planCards = PURE.planCards

      let DENSITY = 'concise'
      const isConcise = () => DENSITY === 'concise'
      const t = (long, short) => (isConcise() ? short : long)
      const onlyDetail = (node) => (isConcise() ? null : node)
      const rightNote = (text) => (isConcise() ? null : h('span', { style: { fontSize: 10 } }, text))

    function money(v) {
      if (!Number.isFinite(v)) return '—'
      const a = Math.abs(v)
      const s = CUR.symbol
      if (a >= 1000) return s + (v / 1000).toFixed(2) + 'K'
      if (a >= 100) return s + v.toFixed(1)
      if (a >= 1) return s + v.toFixed(2)
      if (a > 0) return s + v.toFixed(3)
      return s + '0.00'
    }

    function duration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      const s = Math.floor(ms / 1000)
      const hh = Math.floor(s / 3600)
      const mm = Math.floor((s % 3600) / 60)
      if (hh > 0) return `${hh}h${String(mm).padStart(2, '0')}m`
      if (mm > 0) return `${mm}m${String(s % 60).padStart(2, '0')}s`
      return `${s}s`
    }

    const hhmmss = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
    const mdhm = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
    const shortDay = (day) => day.slice(5)
    const modelLabel = (key) => String(key).slice(String(key).lastIndexOf('/') + 1)

    /* ================================================================ *
     * 日期
     * ================================================================ */

    const pad2 = (n) => String(n).padStart(2, '0')
    const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

    function addDays(d, n) {
      const x = new Date(d)
      x.setDate(x.getDate() + n)
      return x
    }

    /** 把稀疏的 byDay 补成连续序列（右到今天；all=从首个有数据的日子起） */
    function fillDays(byDay, days) {
      const map = new Map(byDay.map((d) => [d.day, d]))
      const out = []
      if (days === 'all') {
        if (byDay.length === 0) return out
        let cur = new Date(byDay[0].day + 'T00:00:00')
        const last = new Date(byDay[byDay.length - 1].day + 'T00:00:00')
        while (cur <= last) {
          const k = dayKey(cur)
          out.push(map.get(k) ?? { day: k, total: 0, cost: 0, requests: 0, models: {} })
          cur = addDays(cur, 1)
        }
        return out
      }
      const today = startOfDay(new Date())
      for (let i = days - 1; i >= 0; i -= 1) {
        const k = dayKey(addDays(today, -i))
        out.push(map.get(k) ?? { day: k, total: 0, cost: 0, requests: 0, models: {} })
      }
      return out
    }

    /* ================================================================ *
     * 动效 / 测量
     * ================================================================ */

    const prefersReduced = () => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
    }

    const STYLE_ID = 'dsh-usage-panel-style'
    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
@keyframes dsh-fade-up { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes dsh-grow { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes dsh-draw { from { stroke-dashoffset: 1400 } to { stroke-dashoffset: 0 } }
@keyframes dsh-pulse { 0%,100% { opacity: .3; transform: scale(.75) } 50% { opacity: 1; transform: scale(1.15) } }
@keyframes dsh-breathe { 0%,100% { opacity: 1 } 50% { opacity: .38 } }
@keyframes dsh-shimmer { from { background-position: -180% 0 } to { background-position: 180% 0 } }
.dsh-fade { animation: dsh-fade-up .26s ease-out both }
.dsh-bar { transform-box: fill-box; transform-origin: center bottom; animation: dsh-grow .5s cubic-bezier(.2,.8,.2,1) both }
.dsh-draw { animation: dsh-draw .9s ease-out both }
.dsh-pulse { animation: dsh-pulse 1.6s ease-in-out infinite }
.dsh-breathe { animation: dsh-breathe 2.1s ease-in-out infinite }
.dsh-skel { background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.13), rgba(255,255,255,.05)); background-size: 200% 100%; animation: dsh-shimmer 1.4s linear infinite; border-radius: 6px }
.dsh-scroll::-webkit-scrollbar { width: 8px; height: 8px }
.dsh-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 4px }
.dsh-scroll::-webkit-scrollbar-track { background: transparent }
/* tooltip 用类 + !important：实测 inline background 会被宿主样式表盖掉，
   结果变成「浅底浅字」几乎不可读。定位仍走 inline style。 */
.dsh-tip {
  background: rgba(18,20,24,.99) !important;
  color: #e9eaec !important;
  border: 1px solid rgba(255,255,255,.14) !important;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,.55);
}
.dsh-tip * { color: inherit }
/* 浮动按钮的形状也必须用类 + !important：宿主样式表会改圆角，
   于是出现「说圆又不圆」——深色底被撑成圆角方形，只有我画的环是圆的。 */
.dsh-fab {
  width: 46px !important;
  height: 46px !important;
  min-width: 46px !important;
  min-height: 46px !important;
  border-radius: 50% !important;
  /* 只设 border-radius 不够：实测绘制结果仍是圆角方形（宽度 46/圆角 50% 都对）。
     clip-path 裁剪的是「绘制结果」本身，任何把圆角改掉的原因都绕不过它。 */
  clip-path: circle(50%) !important;
  padding: 0 !important;
  border: none !important;
  display: grid !important;
  place-items: center !important;
  box-sizing: border-box !important;
  -webkit-appearance: none !important;
  appearance: none !important;
}
.dsh-fab img { display: block !important }
      /* 鼠标悬浮在按钮上时：logo 换成余额剩余百分比（纯 CSS 切换，无需额外状态） */
      .dsh-fab:hover [data-dsh-icon] { display: none !important }
      .dsh-fab:hover [data-dsh-fab-pct] { display: block !important }
      /* bloub 模式：隐藏原图标、圆环与百分比，只显示机器人 */
      /* 只有引擎确实就绪（data-bloub-ready）才隐藏原图标/圆环，否则保持原样，避免空白按钮 */
      .dsh-fab[data-face="bloub"][data-bloub-ready="1"] [data-dsh-icon],
      .dsh-fab[data-face="bloub"][data-bloub-ready="1"] [data-dsh-ring],
      .dsh-fab[data-face="bloub"][data-bloub-ready="1"] [data-dsh-fab-pct] { display: none !important }
      .dsh-fab[data-face="bloub"][data-bloub-ready="1"] [data-dsh-bloub] { display: block !important }
      .dsh-fab[data-face="bloub"] svg { overflow: visible }
      /* 被戳一下：像有弹性一样挤一下（transform 不影响拖动所在的按钮根节点） */
      /*
       * 掉血/充值气泡：0.35s 长出（缩放+上浮+淡入）→ 停留约 4.4s → 1.2s 缩回按钮方向淡出。
       * 总时长 6s 由动画本身决定，不需要 JS 计时；React 侧用 key 变化触发重播。
       */
      @keyframes dsh-drop-life {
        0%   { opacity: 0; transform: translateY(7px) scale(.82); }
        6%   { opacity: 1; transform: translateY(0) scale(1); }
        72%  { opacity: 1; transform: translateY(0) scale(1); }
        100% { opacity: 0; transform: translateY(9px) scale(.55); }
      }
      [data-drop] { transform-origin: 50% 135%; will-change: transform, opacity; }

      /* 余额见底时血条呼吸（克制版：只动透明度与一点缩放，不闪屏） */
      @keyframes dsh-hp-low {
        0%, 100% { opacity: .55; transform: scaleY(1); }
        50%      { opacity: 1;   transform: scaleY(1.5); }
      }
      .dsh-hp-low > i { animation: dsh-hp-low 1.5s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .dsh-hp-low > i { animation: none !important; } }
      @keyframes dsh-hp-gain { 0% { filter: brightness(2.2); } 100% { filter: none; } }
      .dsh-hp-gain > i { animation: dsh-hp-gain .9s ease-out 1; }

      /* 编辑布局时磁贴轻微抖动（iOS 主屏手感）；用 nth-child 错开相位，避免整块同步晃 */
      @keyframes dsh-tile-shake {
        0%   { transform: rotate(-0.45deg) translateY(0); }
        50%  { transform: rotate(0.45deg) translateY(-0.5px); }
        100% { transform: rotate(-0.45deg) translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-dsh-usage-panel][data-edit='1'] [data-card] { animation: none !important; }
      }
      [data-dsh-usage-panel][data-edit='1'] [data-card] {
        animation: dsh-tile-shake .34s ease-in-out infinite alternate;
        outline: 1px dashed rgba(255,255,255,.18);
        outline-offset: 2px;
      }
      [data-dsh-usage-panel][data-edit='1'] [data-card]:nth-child(2n) { animation-delay: -.07s; }
      [data-dsh-usage-panel][data-edit='1'] [data-card]:nth-child(3n) { animation-delay: -.14s; }
      [data-dsh-usage-panel][data-edit='1'] [data-card]:nth-child(5n) { animation-delay: -.21s; }

      @keyframes dsh-bloub-poke {
        0% { transform: scale(1, 1); }
        28% { transform: scale(1.16, 0.84); }
        58% { transform: scale(0.93, 1.09); }
        100% { transform: scale(1, 1); }
      }
      .dsh-fab[data-bloub-react="poke"] [data-dsh-bloub] { animation: dsh-bloub-poke .5s cubic-bezier(.3,.7,.3,1) both; }
      /* 机器人是装饰：一律不接指针事件，点击必须落到按钮根节点上 */
      .dsh-fab[data-face="bloub"] [data-dsh-bloub] svg,
      .dsh-fab[data-face="bloub"] [data-dsh-bloub] svg * { pointer-events: none !important }
      /*
       * 悬浮时圆环扫一圈：当前进度 → 涨满 → 越过到 0%（空环）→ 丝滑回到当前状态。
       * dashoffset = 周长 就是 0%，所以中段正好是你描述的那个瞬间。
       */
      @keyframes dsh-ring-sweep {
        /* 当前进度 → 涨满 */
        0%    { stroke-dashoffset: var(--cur); }
        38%   { stroke-dashoffset: 0; }
        /* 继续向前越过一整圈 ⇒ 视觉上正好是空环（0%），而不是倒着缩回去 */
        58%   { stroke-dashoffset: var(--neg); }
        /* 等价位置跳变（-周长 与 +周长 渲染相同，肉眼不可见） */
        58.01% { stroke-dashoffset: var(--full); }
        /* 再平滑回到当前进度 */
        100%  { stroke-dashoffset: var(--cur); }
      }
      .dsh-fab:hover [data-dsh-ring-fg] { animation: dsh-ring-sweep 2.8s cubic-bezier(.45,.05,.25,1) both; }
@media (prefers-reduced-motion: reduce) {
  .dsh-fade, .dsh-bar, .dsh-draw, .dsh-pulse, .dsh-skel { animation: none !important }
}
`
      document.head.appendChild(style)
    }

    /** 数字滚动：直接写 DOM 文本，不走 state（否则 60fps 重渲染整棵树） */
    function useCountUp(value, format, dur = 650) {
      const ref = useRef(null)
      const prev = useRef(null)
      useEffect(() => {
        const el = ref.current
        if (!el) return undefined
        const from = prev.current ?? 0
        prev.current = value
        if (prefersReduced() || !Number.isFinite(value) || from === value) {
          el.textContent = format(value)
          return undefined
        }
        let raf = 0
        const t0 = performance.now()


        const tick = (t) => {
          const p = Math.min(1, (t - t0) / dur)
          const e = 1 - Math.pow(1 - p, 3)
          el.textContent = format(from + (value - from) * e)
          if (p < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
      }, [value, dur])
      return ref
    }

    function useMeasure() {
      const ref = useRef(null)
      const [w, setW] = useState(360)
      useEffect(() => {
        const el = ref.current
        if (!el) return undefined
        setW(el.clientWidth)
        let ro = null
        try {
          ro = new ResizeObserver((entries) => {
            for (const e of entries) setW(Math.round(e.contentRect.width))
          })
          ro.observe(el)
        } catch { /* 兜底：不支持就只在挂载时测一次 */ }
        return () => { try { ro?.disconnect() } catch { /* ignore */ } }
      }, [])
      return [ref, w]
    }

    /* ================================================================ *
     * 数据
     * ================================================================ */

    function useUsage() {
      const [state, setState] = useState({ data: null, error: null, busy: false, at: null })
      const inFlight = useRef(false)

      const load = useCallback(async (force) => {
        if (inFlight.current) return
        inFlight.current = true
        setState((s) => ({ ...s, busy: true, error: null }))
        try {
          const res = await fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ force: !!force })
          })
          const json = await res.json()
          if (!json || json.ok !== true) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
          // 先按服务端价目表设定货币符号，再触发渲染（金额不做汇率换算）
          const sym = json.usage?.meta?.prices?.symbol
          if (sym) CUR.symbol = sym
          setState({ data: json.usage, error: null, busy: false, at: Date.now() })
        } catch (e) {
          // 保留上次数据 + 明确失败态（静默失败比不显示更糟）
          setState((s) => ({ ...s, busy: false, error: String(e?.message ?? e) }))
        } finally {
          inFlight.current = false
        }
      }, [])

      return { ...state, load }
    }

    /* ================================================================ *
     * 通用小部件
     * ================================================================ */

    const Dot = ({ color }) => h('span', {
      style: { display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 6, flex: '0 0 auto' }
    })

    const SectionTitle = ({ children, right }) => h('div', {
      style: { display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px', fontSize: 11.5, color: C.faint, letterSpacing: '.05em', minHeight: 22 }
    },
      h('span', { style: { textTransform: 'uppercase', whiteSpace: 'nowrap' } }, children),
      h('span', { style: { flex: 1 } }),
      right ?? null)

    function Segmented({ options, value, onChange }) {
      return h('div', {
        style: { display: 'inline-flex', border: '1px solid ' + C.border, borderRadius: 7, overflow: 'hidden', background: 'rgba(255,255,255,.03)' }
      }, options.map((o, i) => h('button', {
        key: o.value,
        type: 'button',
        onClick: () => onChange(o.value),
        style: {
          border: 'none',
          borderRight: i === options.length - 1 ? 'none' : '1px solid ' + C.border2,
          background: value === o.value ? 'rgba(111,157,255,.22)' : 'transparent',
          color: value === o.value ? C.text : C.dim,
          padding: '3px 8px',
          fontSize: 11,
          cursor: 'pointer',
          lineHeight: 1.5,
          fontFamily: 'inherit'
        }
      }, o.label)))
    }

    const Bar = ({ ratio, color = C.accent, height = 6, bg = 'rgba(255,255,255,.08)' }) => {
      const w = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0))
      return h('div', { style: { height, background: bg, borderRadius: height / 2, overflow: 'hidden' } },
        h('div', {
          style: {
            width: (w * 100).toFixed(2) + '%', height: '100%', background: color,
            borderRadius: height / 2, transition: 'width .5s cubic-bezier(.2,.8,.2,1)'
          }
        }))
    }

    const btnStyle = {
      border: '1px solid ' + C.border2, background: 'transparent', color: C.dim,
      borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 7px',
      lineHeight: 1.5, fontFamily: 'inherit',
      /* 表头按钮很多：禁止折行、禁止被压缩，否则「布局/分享/刷新」会裂成两行 */
      whiteSpace: 'nowrap', flexShrink: 0
    }

    /**
     * 指标卡。
     * format 决定数字怎么写（token 用 cnNum / 钱用 money / 比例用 pctNum），
     * unit 是紧跟其后的小字单位。
     * 不要把不同口径混用同一个格式化函数。
     */
    function MetricCard({ label, value, format, unit, hint, accent, delta, progress, extra }) {
      const ref = useCountUp(value, format)
      const hasFoot = Boolean(hint || (delta !== undefined && delta !== null) || (progress !== undefined && progress !== null) || extra)
      return h('div', {
        className: 'dsh-fade',
        style: {
          /* 填满磁贴：高度由网格决定，内部上中下三段，底部信息贴底对齐 */
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          flex: '1 1 auto', height: '100%', boxSizing: 'border-box',
          minWidth: 0, minHeight: 0, overflow: 'hidden',
          border: '1px solid ' + C.border, borderRadius: 16, background: C.card, padding: '9px 11px'
        }
      },
        h('div', { style: { fontSize: 10.5, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto' } }, label),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 3, minWidth: 0, flex: '0 0 auto' } },
          h('span', {
            ref,
            style: { fontSize: 19, fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: accent ?? C.text, whiteSpace: 'nowrap' }
          }, format(value)),
          unit ? h('span', { style: { fontSize: 11.5, color: C.dim } }, unit) : null),
        hasFoot
          ? h('div', { style: { minWidth: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, overflow: 'hidden' } },
              hint ? h('div', { style: { fontSize: 10, color: C.faint, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, hint) : null,
              delta !== undefined && delta !== null
                ? h('div', { style: { fontSize: 10, color: delta >= 0 ? C.warn : C.good, whiteSpace: 'nowrap' } },
                    (delta >= 0 ? '↑' : '↓') + Math.abs(delta * 100).toFixed(1) + '% 环比')
                : null,
              progress !== undefined && progress !== null ? h('div', { style: { marginTop: 4 } }, progress) : null,
              extra ?? null)
          : null)
    }

    /* ================================================================ *
     * 热力图（分位分档）
     * ================================================================ */

    function quantileThresholds(values) {
      if (values.length === 0) return []
      const out = []
      for (let i = 1; i <= 4; i += 1) {
        const idx = Math.min(values.length - 1, Math.floor((i / 5) * values.length))
        out.push(values[idx])
      }
      return out
    }

    /**
     * 生成分享卡片的 SVG（720×420）。只含**聚合数字**：
     * 不含会话标题、工作区名、逐条工具明细、账户信息。
     */
    function buildShareSvg({ totals, meta, byDay, level }) {
      const W = 720
      const H = 420
      const bg = '#0f1115'
      const fg = '#f2f3f5'
      const dim = '#9aa1ab'
      const accent = '#6f9dff'
      const good = '#5ad19a'
      const sym = meta?.prices?.symbol || '¥'
      const esc = (v) => String(v).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
      const money = (v) => sym + (Number(v) || 0).toFixed(2)
      const big = (v) => {
        const n = Number(v) || 0
        if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿'
        if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万'
        return String(Math.round(n))
      }
      const total = Number(totals?.total) || 0
      const rows = [
        ['Token 总用量', big(total)],
        ['会话 / 请求', String(totals?.sessions ?? 0) + ' / ' + String(totals?.requests ?? 0)],
        ['缓存命中率', ((Number(totals?.cacheHitRate) || 0) * 100).toFixed(2) + '%'],
        ['估算成本', money(totals?.cost)],
        ['缓存省下', money(totals?.cacheSaved)],
        ['高峰占比', Math.round((Number(totals?.peakShare) || 0) * 100) + '%']
      ]
      const pad = 32
      const colW = (W - pad * 2 - 16) / 2
      const boxH = 66
      const startY = 138
      const boxes = rows.map((r, i) => {
        const cx = pad + (i % 2) * (colW + 16)
        const cy = startY + Math.floor(i / 2) * (boxH + 12)
        return '<g><rect x="' + cx + '" y="' + cy + '" width="' + colW + '" height="' + boxH + '" rx="10" fill="#171a20" stroke="#262b33"/>' +
          '<text x="' + (cx + 14) + '" y="' + (cy + 24) + '" fill="' + dim + '" font-size="12">' + esc(r[0]) + '</text>' +
          '<text x="' + (cx + 14) + '" y="' + (cy + 50) + '" fill="' + fg + '" font-size="22" font-weight="700">' + esc(r[1]) + '</text></g>'
      }).join('')
      const lv = level || { name: '', idx: 0 }
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
        '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>' +
        '<text x="' + pad + '" y="52" fill="' + fg + '" font-size="24" font-weight="700">DSH 用量光球</text>' +
        '<text x="' + pad + '" y="76" fill="' + dim + '" font-size="12">dsh-usage-orb · 跨会话用量统计</text>' +
        '<text x="' + (W - pad) + '" y="52" fill="' + accent + '" font-size="16" font-weight="700" text-anchor="end">Lv.' + (lv.idx + 1) + ' ' + esc(lv.name) + '</text>' +
        '<text x="' + (W - pad) + '" y="76" fill="' + dim + '" font-size="11" text-anchor="end">' + esc(byDay?.label || '') + '</text>' +
        boxes +
        '<text x="' + pad + '" y="' + (H - 22) + '" fill="' + good + '" font-size="11">数据仅在本机聚合 · 不含会话内容</text>' +
        '<text x="' + (W - pad) + '" y="' + (H - 22) + '" fill="' + dim + '" font-size="11" text-anchor="end">github.com/zhifeiNi/dsh-usage-orb</text>' +
        '</svg>'
    }

    /* 等级阶梯：按累计 token 分级（跨会话累计，换了会话也不会掉级） */
    const LV_TIERS = [
      { at: 0, name: '青铜', color: '#b08d57' },
      { at: 1e8, name: '白银', color: '#b9c2cc' },
      { at: 5e8, name: '黄金', color: '#e3b341' },
      { at: 2e9, name: '铂金', color: '#8fd3e8' },
      { at: 5e9, name: '钻石', color: '#8fb8ff' },
      { at: 2e10, name: '王者', color: '#f0a3ff' }
    ]

    /**
     * 等级条：Lv.N 名称 + 升级进度 + 连续使用天数 + 今日相对近 7 日的强度。
     * 全部从 byDay 现算，不额外存状态（换设备/清缓存也不会"掉级"）。
     */
    function LevelStrip({ byDay }) {
      const info = useMemo(() => {
        const list = Array.isArray(byDay) ? byDay : []
        const byDate = new Map()
        let total = 0
        for (const d of list) {
          const t = Number(d.total) || 0
          total += t
          byDate.set(d.day, (byDate.get(d.day) || 0) + t)
        }
        let idx = 0
        for (let i = 0; i < LV_TIERS.length; i++) if (total >= LV_TIERS[i].at) idx = i
        const cur = LV_TIERS[idx]
        const next = LV_TIERS[idx + 1] || null
        const span = next ? next.at - cur.at : 0
        const got = next ? total - cur.at : 0
        const prog = next && span > 0 ? Math.max(0, Math.min(1, got / span)) : 1

        /* 连续天数：从今天往回数，遇到 0 用量就停（今天还没用也算断，但显示为 0 不吓人） */
        const key = (d) => {
          const p = (n) => (n < 10 ? '0' + n : '' + n)
          return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
        }
        let streak = 0
        const now = new Date()
        for (let i = 0; i < 400; i++) {
          const k = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))
          if ((byDate.get(k) || 0) > 0) streak++
          else if (i > 0) break
          else continue   /* 今天还没用：不立刻断，继续看昨天 */
        }

        /* 今日强度：今日用量 / 近 7 日均值（去掉今天） */
        const todayKey = key(now)
        const today = byDate.get(todayKey) || 0
        let sum7 = 0
        let cnt7 = 0
        for (let i = 1; i <= 7; i++) {
          const v = byDate.get(key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))) || 0
          if (v > 0) { sum7 += v; cnt7++ }
        }
        const avg = cnt7 > 0 ? sum7 / cnt7 : 0
        return { total, idx, cur, next, prog, streak, today, avg }
      }, [byDay])

      const pctTxt = info.next
        ? Math.round(info.prog * 100) + '% → ' + info.next.name
        : '已满级'
      const ratio = info.avg > 0 ? info.today / info.avg : (info.today > 0 ? 1 : 0)

      return h('div', {
        'data-level-strip': '',
        title: '累计 ' + cnNum(info.total) + cnUnit(info.total) + ' token · 今日 ' + cnNum(info.today) + cnUnit(info.today) +
          (info.avg > 0 ? '（近 7 日均值 ' + cnNum(info.avg) + cnUnit(info.avg) + '）' : ''),
        style: {
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '7px 9px', marginBottom: 8, borderRadius: 8,
          background: 'rgba(255,255,255,.03)', border: '1px solid ' + C.border
        }
      },
        h('span', {
          style: {
            fontSize: 10.5, fontWeight: 700, letterSpacing: '.02em',
            color: info.cur.color, border: '1px solid ' + info.cur.color + '55',
            background: info.cur.color + '18', borderRadius: 999, padding: '1px 7px'
          }
        }, 'Lv.' + (info.idx + 1) + ' ' + info.cur.name),
        h('div', { style: { flex: '1 1 90px', minWidth: 70 } },
          h(Bar, { ratio: info.prog, color: info.cur.color, height: 4 }),
          h('div', { style: { fontSize: 9.5, color: C.faint, marginTop: 3 } }, pctTxt)),
        h('span', { style: { fontSize: 10.5, color: info.streak > 0 ? C.text : C.faint } },
          '连续 ' + info.streak + ' 天'),
        h('span', { style: { fontSize: 10.5, color: ratio >= 1 ? C.good : C.dim } },
          '今日 ' + Math.round(ratio * 100) + '%')
      )
    }

    function Heatmap({ byDay, firstDay, width, onTip, onTipEnd, onPick, picked }) {
      const weeks = 26
      const labelW = 16
      const cw = Math.max(7, Math.floor((width - labelW - 4) / weeks) - 2)
      const gap = 2

      const grid = useMemo(() => {
        const map = new Map(byDay.map((d) => [d.day, d]))
        const today = startOfDay(new Date())
        const dow = (today.getDay() + 6) % 7               // 周一 = 0
        const lastMonday = addDays(today, -dow)
        const start = addDays(lastMonday, -(weeks - 1) * 7)
        const cells = []
        for (let w = 0; w < weeks; w += 1) {
          for (let r = 0; r < 7; r += 1) {
            const d = addDays(start, w * 7 + r)
            if (d > today) continue
            const k = dayKey(d)
            const rec = map.get(k)
            cells.push({ day: k, w, r, value: rec?.total ?? 0, cost: rec?.cost ?? 0, requests: rec?.requests ?? 0 })
          }
        }
        const values = cells.filter((c) => c.value > 0).map((c) => c.value).sort((a, b) => a - b)
        return { cells, thresholds: quantileThresholds(values) }
      }, [byDay, weeks])

      const level = (v) => {
        if (v <= 0) return 0
        let lv = 1
        for (const t of grid.thresholds) if (v > t) lv += 1
        return Math.min(5, lv)
      }

      const months = useMemo(() => {
        const out = []
        let last = null
        for (const c of grid.cells) {
          if (c.r !== 0) continue
          const m = c.day.slice(0, 7)
          if (m !== last) { out.push({ w: c.w, label: Number(c.day.slice(5, 7)) + '月' }); last = m }
        }
        return out
      }, [grid.cells])

      const svgW = labelW + weeks * (cw + gap)
      const svgH = 12 + 7 * (cw + gap)
      const activeDays = byDay.filter((d) => (d.total ?? 0) > 0).length

      return h('div', null,
        h('svg', {
          width: '100%', viewBox: `0 0 ${svgW} ${svgH}`, style: { display: 'block' },
          'data-dsh-heatmap': ''
        },
          months.map((m) => h('text', { key: 'm' + m.w, x: labelW + m.w * (cw + gap), y: 8, fill: C.faint, fontSize: 9 }, m.label)),
          [0, 2, 4].map((r, i) => h('text', {
            key: 'r' + r, x: 0, y: 14 + r * (cw + gap) + cw * 0.8, fill: C.faint, fontSize: 9
          }, ['一', '三', '五'][i])),
          grid.cells.map((c) => h('rect', {
            key: c.day,
            className: 'dsh-fade',
            x: labelW + c.w * (cw + gap),
            y: 12 + c.r * (cw + gap),
            width: cw, height: cw, rx: 2,
            fill: c.value > 0
              ? HEAT[level(c.value)]
              : (firstDay && c.day < firstDay ? 'rgba(255,255,255,.022)' : HEAT[0]),
            'data-day': c.day,
            'data-picked': picked === c.day ? '1' : '0',
            style: {
              animationDelay: Math.min(240, c.w * 5) + 'ms', cursor: 'pointer',
              stroke: picked === c.day ? C.accent : 'none', strokeWidth: picked === c.day ? 1.5 : 0
            },
            onClick: () => { if (onPick) onPick(picked === c.day ? null : c) },
            onMouseEnter: (e) => onTip(e, {
              title: c.day,
              rows: [
                ['Token', c.value ? `${cn(c.value)}（${exact(c.value)}）` : '0'],
                ['成本', money(c.cost)],
                ['请求', String(c.requests)]
              ]
            }),
            onMouseLeave: onTipEnd
          }))),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 10, color: C.faint, flexWrap: 'wrap' } },
          h('span', null, '—'),
          HEAT.map((c, i) => h('span', { key: i, style: { width: 9, height: 9, borderRadius: 2, background: c, display: 'inline-block' } })),
          h('span', null, '—'),
          h('span', { style: { marginLeft: 'auto' } },
            grid.thresholds.length
              ? `分档 ${grid.thresholds.map((t) => cn(t)).join(' / ')}`
              : '暂无数据'),
          activeDays < 30 && firstDay
            ? h('span', { style: { width: '100%', opacity: .8 } }, `历史还很短：自 ${firstDay} 起共 ${activeDays} 天有数据`)
            : null))
    }

    /* ================================================================ *
     * 每日堆叠柱
     * ================================================================ */

    function StackedBars({ days, series, width, onTip, onTipEnd }) {
      const padL = 34
      const padB = 16
      const padT = 8
      const height = 132
      const plotW = Math.max(40, width - padL - 6)
      const plotH = height - padB - padT
      const max = Math.max(1, ...days.map((d) => d.total ?? 0))
      const slot = plotW / Math.max(1, days.length)
      const bw = Math.max(3, Math.floor(slot) - 3)
      const xOf = (i) => padL + slot * i + (slot - bw) / 2
      const yOf = (v) => padT + plotH - (v / max) * plotH
      const labelEvery = Math.max(1, Math.ceil(days.length / 12))

      return h('svg', { width: '100%', viewBox: `0 0 ${width} ${height}`, style: { display: 'block' } },
        [0, 0.5, 1].map((f, i) => h('g', { key: i },
          h('line', { x1: padL, x2: padL + plotW, y1: yOf(max * f), y2: yOf(max * f), stroke: C.border2, strokeWidth: 1 }),
          h('text', { x: padL - 5, y: yOf(max * f) + 3, fill: C.faint, fontSize: 9, textAnchor: 'end' }, cn(max * f)))),
        days.map((d, i) => {
          let acc = 0
          const segs = []
          for (const s of series) {
            const v = s.get(d)
            if (v > 0) {
              const y0 = yOf(acc + v)
              segs.push(h('rect', {
                key: s.key,
                className: 'dsh-bar',
                x: xOf(i), y: y0, width: bw, height: Math.max(0.6, yOf(acc) - yOf(acc + v)),
                fill: s.color,
                style: { animationDelay: Math.min(220, i * 12) + 'ms' }
              }))
              acc += v
            }
          }
          return h('g', {
            key: d.day,
            onMouseEnter: (e) => onTip(e, {
              title: `${d.day}（${new Date(d.day + 'T00:00:00').toLocaleDateString('zh-CN', { weekday: 'short' })}）`,
              rows: [
                ['合计', `${cn(d.total ?? 0)}（${exact(d.total ?? 0)}）`],
                ...series.map((s) => [s.label, cn(s.get(d))]).filter((r) => r[1] !== '0'),
                ['成本', money(d.cost ?? 0)],
                ['请求', String(d.requests ?? 0)]
              ]
            }),
            onMouseLeave: onTipEnd
          },
            h('rect', { x: padL + slot * i, y: padT, width: slot, height: plotH, fill: 'transparent' }),
            segs)
        }),
        days.map((d, i) => (days.length <= 16 || i % labelEvery === 0 || i === days.length - 1)
          ? h('text', {
              key: 'x' + d.day, x: xOf(i) + bw / 2, y: height - 4,
              fill: C.faint, fontSize: 9, textAnchor: 'middle'
            }, shortDay(d.day))
          : null))
    }

    /** 每日成本折线（独立坐标轴 —— 不与 token 共用一轴） */
    function CostTrend({ days, width }) {
      const padL = 34
      const height = 64
      const plotW = Math.max(40, width - padL - 6)
      const max = Math.max(0.0001, ...days.map((d) => d.cost ?? 0))
      const stepX = days.length > 1 ? plotW / (days.length - 1) : plotW
      const baseY = 42
      const pts = days.map((d, i) => [padL + i * stepX, baseY - ((d.cost ?? 0) / max) * 32])
      const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
      const total = days.reduce((a, d) => a + (d.cost ?? 0), 0)

      return h('svg', { width: '100%', viewBox: `0 0 ${width} ${height}`, style: { display: 'block' } },
        h('defs', null,
          h('linearGradient', { id: 'dsh-cost-grad', x1: 0, y1: 0, x2: 0, y2: 1 },
            h('stop', { offset: '0%', stopColor: C.good, stopOpacity: 0.3 }),
            h('stop', { offset: '100%', stopColor: C.good, stopOpacity: 0 }))),
        h('line', { x1: padL, x2: padL + plotW, y1: baseY, y2: baseY, stroke: C.border2 }),
        h('text', { x: padL - 5, y: 14, fill: C.faint, fontSize: 9, textAnchor: 'end' }, money(max)),
        h('text', { x: padL + plotW, y: 12, fill: C.faint, fontSize: 9, textAnchor: 'end' }, `区间合计 ${money(total)}`),
        pts.length > 1
          ? h('polygon', { points: `${padL},${baseY} ${line} ${padL + (days.length - 1) * stepX},${baseY}`, fill: 'url(#dsh-cost-grad)' })
          : null,
        pts.length > 1
          ? h('polyline', {
              className: prefersReduced() ? '' : 'dsh-draw',
              points: line, fill: 'none', stroke: C.good, strokeWidth: 1.6,
              strokeLinejoin: 'round', strokeLinecap: 'round', strokeDasharray: 1400
            })
          : null,
        pts.map((p, i) => h('circle', { key: i, cx: p[0], cy: p[1], r: 1.8, fill: C.good })))
    }

    /* ================================================================ *
     * 模型：环形图 + 排行榜
     * ================================================================ */

    function Donut({ byModel, width, metric, onTip, onTipEnd }) {
      const size = Math.max(96, Math.min(140, width * 0.42))
      const r = size / 2 - 13
      const cx = size / 2
      const cy = size / 2
      const CIRC = 2 * Math.PI * r
      const valueOf = (m) => (metric === 'cost' ? m.cost : m.total)
      const items = byModel.slice(0, 6)
      const shownTotal = byModel.reduce((a, m) => a + valueOf(m), 0)
      const sum = items.reduce((a, m) => a + valueOf(m), 0) || 1
      let acc = 0
      const arcs = items.map((m, i) => {
        const frac = valueOf(m) / sum
        const arc = { m, frac, offset: acc, color: PALETTE[i % PALETTE.length] }
        acc += frac
        return arc
      })
      return h('svg', { width: size, height: size, style: { flex: '0 0 auto' } },
        h('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(255,255,255,.07)', strokeWidth: 13 }),
        arcs.map((a) => h('circle', {
          key: a.m.key,
          cx, cy, r, fill: 'none',
          stroke: a.color, strokeWidth: 13,
          strokeDasharray: `${Math.max(0, a.frac * CIRC - 2)} ${CIRC}`,
          strokeDashoffset: -a.offset * CIRC,
          transform: `rotate(-90 ${cx} ${cy})`,
          style: { transition: 'stroke-dasharray .6s cubic-bezier(.2,.8,.2,1)', cursor: 'pointer' },
          onMouseEnter: (e) => onTip(e, {
            title: a.m.model,
            rows: [
              ['Token', cn(a.m.total)],
              ['成本', money(a.m.cost)],
              ['请求', String(a.m.requests)],
              ['占比', pct(a.frac)]
            ]
          }),
          onMouseLeave: onTipEnd
        })),
        h('text', { x: cx, y: cy - 1, textAnchor: 'middle', fill: C.text, fontSize: 14, fontWeight: 650 },
          metric === 'cost' ? money(shownTotal) : cn(shownTotal)),
        h('text', { x: cx, y: cy + 13, textAnchor: 'middle', fill: C.faint, fontSize: 9.5 },
          metric === 'cost' ? '估算成本' : 'Token 合计'))
    }

    function ModelTable({ byModel, metric, onTip, onTipEnd }) {
      const valueOf = (m) => (metric === 'cost' ? m.cost : m.total)
      const all = byModel.reduce((a, x) => a + valueOf(x), 0) || 1
      const max = Math.max(1e-9, ...byModel.map(valueOf))
      return h('div', { style: { flex: 1, minWidth: 0 } },
        byModel.slice(0, 6).map((m, i) => h('div', {
          key: m.key,
          className: 'dsh-fade',
          style: { padding: '5px 0', borderBottom: '1px solid ' + C.border2, animationDelay: i * 30 + 'ms' },
          onMouseEnter: (e) => onTip(e, {
            title: m.model,
            rows: [
              ['Token', cn(m.total)],
              ['未缓存输入', exact(m.uncachedInput)],
              ['缓存读取', exact(m.cacheRead)],
              ['输出', exact(m.output)],
              ['缓存命中率', pct(m.cacheHitRate, 2)],
              ['估算成本', money(m.cost)],
              ['缓存省下', money(m.cacheSaved)],
              ['请求 / 会话', `${m.requests} / ${m.sessions}`]
            ]
          }),
          onMouseLeave: onTipEnd
        },
          h('div', { style: { display: 'flex', alignItems: 'center', fontSize: 11.5, gap: 4 } },
            h(Dot, { color: PALETTE[i % PALETTE.length] }),
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.model),
            h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, metric === 'cost' ? money(m.cost) : cn(m.total)),
            h('span', { style: { width: 44, textAlign: 'right', color: C.faint, fontVariantNumeric: 'tabular-nums' } },
              pct(valueOf(m) / all))),
          h('div', { style: { marginTop: 4 } }, h(Bar, { ratio: valueOf(m) / max, color: PALETTE[i % PALETTE.length], height: 3 }))))
      )
    }

    /* ---------------------------------------------------------------- *
     * P7 实时 ticker / P12 工具烧钱榜 / P3 余额水位 / P10 模拟器
     * ---------------------------------------------------------------- */

    function relTime(t) {
      const s = Math.max(0, Math.round((Date.now() - t) / 1000))
      if (s < 5) return '刚刚'
      if (s < 60) return s + ' 秒前'
      const m = Math.floor(s / 60)
      if (m < 60) return m + ' 分钟前'
      const h = Math.floor(m / 60)
      if (h < 24) return h + ' 小时前'
      return Math.floor(h / 24) + ' 天前'
    }

    /** P7：最近发生了什么（点开面板就能看到"正在烧钱"的实感） */
    function Ticker({ recent, onTip, onTipEnd }) {
      const items = (recent ?? []).slice(0, 8)
      if (!items.length) return h('div', { style: { fontSize: 11, color: C.faint } }, '还没有可显示的活动')
      return h('div', null, items.map((e, i) => h('div', {
        key: `${e.at}-${i}`,
        'data-ticker-row': '',
        className: 'dsh-fade',
        style: {
          display: 'flex', gap: 7, alignItems: 'baseline', padding: '3px 0',
          fontSize: 11, animationDelay: i * 25 + 'ms'
        },
        onMouseEnter: (ev) => onTip(ev, {
          title: e.kind === 'request' ? '一次模型请求' : '一次工具调用',
          rows: e.kind === 'request'
            ? [['时间', new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false })],
               ['会话', String(e.title ?? e.session)],
               ['位置', `第 ${e.turn ?? '?'} 轮 / 第 ${e.step ?? '?'} 步`],
               ['token', exact(e.total)],
               ['成本', money(e.cost)]]
            : [['时间', new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false })],
               ['会话', String(e.title ?? e.session)],
               ['工具', e.name]]
        }),
        onMouseLeave: onTipEnd
      },
        h('span', { style: { color: C.faint, width: 52, flex: '0 0 auto' } }, relTime(e.at)),
        e.kind === 'request'
          ? h(React.Fragment, null,
              h('span', { style: { color: C.accent, width: 30, flex: '0 0 auto' } }, '模型'),
              onlyDetail(h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.dim } },
                String(e.title ?? e.session ?? ''))),
              h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, '+' + cn(e.total)),
              h('span', { style: { fontVariantNumeric: 'tabular-nums', width: 58, textAlign: 'right' } }, money(e.cost)))
          : h(React.Fragment, null,
              h('span', { style: { color: C.purple, width: 30, flex: '0 0 auto' } }, '工具'),
              h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.name),
              h('span', { style: { color: C.faint, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 } },
                String(e.title ?? e.session ?? ''))))))
    }

    /** P12：把「每一步的账」归给它随后申请调用的工具 */
    function ToolCostTable({ tools, coverage, onTip, onTipEnd }) {
      const top = (tools ?? []).slice(0, 6)
      if (!top.length) return h('div', { style: { fontSize: 11, color: C.faint } }, '还没有可归因的工具消耗')
      const max = Math.max(1e-9, ...top.map((t) => t.attrCost))
      return h('div', null,
        top.map((t, i) => h('div', {
          key: t.name,
          style: { padding: '4px 0' },
          onMouseEnter: (e) => onTip(e, {
            title: t.name,
            rows: [
              ['归因消耗', money(t.attrCost)],
              ['归因 token', cn(t.attrTokens)],
              ['带来消耗的步骤', String(t.attrSteps)],
              ['调用次数', String(t.calls)],
              ['总耗时', duration(t.ms)],
              ['失败', String(t.errors)]
            ]
          }),
          onMouseLeave: onTipEnd
        },
          h('div', { style: { display: 'flex', fontSize: 11.5, gap: 6, alignItems: 'baseline' } },
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
            h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, money(t.attrCost)),
            h('span', { style: { color: C.faint, width: 74, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, cn(t.attrTokens))),
          h('div', { style: { marginTop: 3 } }, h(Bar, { ratio: t.attrCost / max, color: PALETTE[i % PALETTE.length], height: 3 })))),
        h('div', { style: { fontSize: 10, color: C.faint, marginTop: 6, lineHeight: 1.6 } },
          `覆盖了 ${pct(coverage, 1)} 的估算成本；其余是没触发工具的步骤（纯回复/思考）——` +
          '归因按「某步的账 ÷ 该步申请调用的工具数」均摊，因此是近似值。'))
    }

    /** P3：余额水位曲线 + 充值标记（点数不足时给一句话，不画空图） */
    function BalanceHistory({ balance, width }) {
      const pts = balance?.history ?? []
      const recharges = balance?.recharges ?? []
      const sym = symOf(balance?.wallets?.[0]?.currency ?? balance?.bonusWallets?.[0]?.currency ?? 'CNY')
      if (pts.length < 2) {
        return h('div', { style: { fontSize: 10.5, color: C.faint, lineHeight: 1.6 } },
          `刚开始记录（已有 ${pts.length} 个点，每分钟一个）。攒够 2 个点就会画出余额曲线；` +
          '之后余额跳升会被标成「充值」。')
      }
      const h0 = 58
      const padL = 6
      const values = pts.map((p) => p.total)
      const lo = Math.min(...values)
      const hi = Math.max(...values)
      const span = Math.max(1e-6, hi - lo)
      const stepX = (width - padL * 2) / (pts.length - 1)
      const y = (v) => 8 + (1 - (v - lo) / span) * (h0 - 20)
      const line = pts.map((p, i) => `${(padL + i * stepX).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ')
      const area = `${padL},${h0 - 12} ${line} ${(padL + (pts.length - 1) * stepX).toFixed(1)},${h0 - 12}`
      const first = pts[0]
      const last = pts[pts.length - 1]
      const change = last.total - first.total
      return h('div', null,
        h('svg', { width: '100%', viewBox: `0 0 ${width} ${h0}`, style: { display: 'block' } },
          h('defs', null,
            h('linearGradient', { id: 'dsh-bal-grad', x1: 0, y1: 0, x2: 0, y2: 1 },
              h('stop', { offset: '0%', stopColor: C.accent, stopOpacity: 0.3 }),
              h('stop', { offset: '100%', stopColor: C.accent, stopOpacity: 0 }))),
          h('polygon', { points: area, fill: 'url(#dsh-bal-grad)' }),
          h('polyline', {
            className: prefersReduced() ? '' : 'dsh-draw',
            points: line, fill: 'none', stroke: C.accent, strokeWidth: 1.6,
            strokeLinejoin: 'round', strokeLinecap: 'round', strokeDasharray: 1400
          }),
          pts.map((p, i) => h('circle', { key: i, cx: padL + i * stepX, cy: y(p.total), r: 1.4, fill: C.accent })),
          recharges.map((r, i) => {
            const idx = pts.findIndex((p) => p.t >= r.t)
            const x = padL + (idx < 0 ? pts.length - 1 : idx) * stepX
            return h('g', { key: 'r' + i },
              h('line', { x1: x, x2: x, y1: 4, y2: h0 - 12, stroke: C.good, strokeWidth: 1, strokeDasharray: '2 2' }),
              h('text', { x: x + 3, y: 10, fill: C.good, fontSize: 9 }, `+${sym}${r.amount}`))
          })),
        h('div', { style: { display: 'flex', gap: 10, fontSize: 10.5, color: C.faint, marginTop: 4, flexWrap: 'wrap' } },
          h('span', null, `现在 ${sym}${last.total.toFixed(2)}`),
          h('span', null, `区间 ${change <= 0 ? '' : '+'}${sym}${change.toFixed(2)}`),
          h('span', null, `最高 ${sym}${hi.toFixed(2)} / 最低 ${sym}${lo.toFixed(2)}`),
          h('span', null, `${pts.length} 个点`),
          recharges.length ? h('span', { style: { color: C.good } }, `${recharges.length} 次充值`) : null))
    }

    /** P10「如果」模拟器：改条件，看账单怎么变（纯本地计算） */
    function Simulator({ totals, prices, byModel }) {
      const [movePct, setMovePct] = useState(0)
      const [hitPct, setHitPct] = useState(null)      // null = 维持现状
      const [useOther, setUseOther] = useState(false)

      const rates = prices?.rates ?? {}
      const models = Object.keys(rates)
      const currentModel = byModel?.[0]?.model ?? models[0]
      const otherModel = models.find((m) => m !== currentModel) ?? currentModel
      const targetModel = useOther ? otherModel : currentModel
      const r = rates[targetModel]
      const mult = prices?.peakMultiplier ?? 2
      const sym = prices?.symbol ?? '¥'
      const peak = totals?.peakTokens ?? { uncachedInput: 0, cacheRead: 0, output: 0 }
      const off = totals?.offPeakTokens ?? { uncachedInput: 0, cacheRead: 0, output: 0 }
      const baseline = totals?.cost ?? 0

      const costOf = (t, rate, peakRate) => {
        const m = peakRate ? mult : 1
        return ((t.uncachedInput ?? 0) * rate.cacheMiss * m +
          (t.cacheRead ?? 0) * rate.cacheHit * m +
          (t.output ?? 0) * rate.output * m) / 1e6
      }
      const rebalance = (t) => {
        if (hitPct === null) return t
        const prompt = (t.uncachedInput ?? 0) + (t.cacheRead ?? 0)
        return { uncachedInput: prompt * (1 - hitPct / 100), cacheRead: prompt * (hitPct / 100), output: t.output ?? 0 }
      }
      const f = movePct / 100
      const sim = r
        ? costOf(rebalance(off), r, false) +
          costOf(rebalance(peak), r, false) * f +
          costOf(rebalance(peak), r, true) * (1 - f)
        : baseline
      const diff = sim - baseline
      const currentHit = (totals?.cacheHitRate ?? 0) * 100

      /*
       * 自定义滑动条：原生 <input type=range> 在深色小面板里轨道只有几像素、拇指很小，
       * 拖动很容易脱手；而且事件挂在元素上时，鼠标一上下偏离窄带就断。
       * 这里：22px 高轨道 + 指针事件挂 document + 支持 ←/→ 键盘微调。
       */
      const slider = (label, value, min, max, step, onChange, hint) => {
        const shown = Number(String(value).replace(/[^0-9.\-]/g, ''))
        const cur = Number.isFinite(shown) ? Math.max(min, Math.min(max, shown)) : min
        const pct = max > min ? ((cur - min) / (max - min)) * 100 : 0
        const setFromX = (el, clientX) => {
          const r = el.getBoundingClientRect()
          const f = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)))
          const snapped = Math.round((min + f * (max - min)) / step) * step
          onChange(Math.max(min, Math.min(max, snapped)))
        }
        return h('div', { style: { marginTop: 9 } },
          h('div', { style: { display: 'flex', fontSize: 11, marginBottom: 3 } },
            h('span', { style: { flex: 1 } }, label),
            h('span', { style: { color: C.dim, fontVariantNumeric: 'tabular-nums', 'data-sim-value': '' } }, value)),
          h('div', {
            'data-sim': label,
            role: 'slider',
            tabIndex: 0,
            'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': cur,
            title: '点击或拖动；也可聚焦后用 ← → 调整',
            onKeyDown: (e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, cur - step)) }
              else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, cur + step)) }
            },
            onPointerDown: (e) => {
              if (e.button !== undefined && e.button !== 0) return
              e.preventDefault()
              const el = e.currentTarget
              setFromX(el, e.clientX)
              const move = (ev) => setFromX(el, ev.clientX)
              const up = () => {
                document.removeEventListener('pointermove', move)
                document.removeEventListener('pointerup', up)
                document.removeEventListener('pointercancel', up)
              }
              document.addEventListener('pointermove', move)
              document.addEventListener('pointerup', up)
              document.addEventListener('pointercancel', up)
            },
            style: { position: 'relative', height: 22, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none', outline: 'none' }
          },
            h('div', { style: { position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 3, background: 'rgba(255,255,255,.14)' } }),
            h('div', { style: { position: 'absolute', left: 0, width: pct + '%', height: 5, borderRadius: 3, background: C.accent, pointerEvents: 'none' } }),
            h('div', {
              style: {
                position: 'absolute', left: 'calc(' + pct + '% - 8px)', width: 16, height: 16, borderRadius: '50%',
                background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.45)', pointerEvents: 'none'
              }
            })),
          hint ? h('div', { style: { fontSize: 10, color: C.faint, marginTop: 2 } }, hint) : null)
      }

      return h('div', null,
        slider('把高峰时段挪到空闲', movePct + '%', 0, 100, 5, setMovePct,
          `高峰 ${money(totals?.peakCost ?? 0)}（×${mult} 价）→ 全挪到空闲可省 ${money((totals?.peakCost ?? 0) * (1 - 1 / mult))}`),
        h('div', { style: { marginTop: 9 } },
          h('div', { style: { display: 'flex', fontSize: 11, marginBottom: 3, alignItems: 'center', gap: 6 } },
            h('span', { style: { flex: 1 } }, '假设缓存命中率'),
            h('span', { style: { color: C.dim, fontVariantNumeric: 'tabular-nums' } },
              hitPct === null ? `现状 ${currentHit.toFixed(2)}%` : hitPct + '%'),
            hitPct === null
              ? null
              : h('button', { type: 'button', style: btnStyle, onClick: () => setHitPct(null) }, '还原')),
          h('div', {
            'data-sim': 'hit',
            role: 'slider', tabIndex: 0,
            'aria-valuemin': 0, 'aria-valuemax': 100,
            'aria-valuenow': Math.round(hitPct === null ? currentHit : hitPct),
            title: '点击或拖动；也可聚焦后用 ← → 调整',
            onKeyDown: (e) => {
              const cur = hitPct === null ? currentHit : hitPct
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setHitPct(Math.max(0, cur - 0.5)) }
              else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setHitPct(Math.min(100, cur + 0.5)) }
            },
            onPointerDown: (e) => {
              if (e.button !== undefined && e.button !== 0) return
              e.preventDefault()
              const el = e.currentTarget
              const put = (clientX) => {
                const r = el.getBoundingClientRect()
                const f = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)))
                setHitPct(Math.round((f * 100) / 0.5) * 0.5)
              }
              put(e.clientX)
              const move = (ev) => put(ev.clientX)
              const up = () => {
                document.removeEventListener('pointermove', move)
                document.removeEventListener('pointerup', up)
                document.removeEventListener('pointercancel', up)
              }
              document.addEventListener('pointermove', move)
              document.addEventListener('pointerup', up)
              document.addEventListener('pointercancel', up)
            },
            style: { position: 'relative', height: 22, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none', outline: 'none', marginTop: 4 }
          },
            h('div', { style: { position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 3, background: 'rgba(255,255,255,.14)' } }),
            h('div', { style: { position: 'absolute', left: 0, width: Math.max(0, Math.min(100, hitPct === null ? currentHit : hitPct)) + '%', height: 5, borderRadius: 3, background: C.accent, pointerEvents: 'none' } }),
            h('div', { style: { position: 'absolute', left: 'calc(' + Math.max(0, Math.min(100, hitPct === null ? currentHit : hitPct)) + '% - 8px)', width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.45)', pointerEvents: 'none' } })),
          h('div', { style: { fontSize: 10, color: C.faint, marginTop: 2 } },
            '拖动即进入假设模式；命中率下降会让未缓存输入（全价）变多')),
        models.length > 1
          ? h(Row, {
              label: '换模型',
              hint: `当前 ${currentModel} → ${otherModel}`
            }, h(Segmented, {
              value: useOther ? 'other' : 'current',
              onChange: (v) => setUseOther(v === 'other'),
              options: [{ value: 'current', label: '当前' }, { value: 'other', label: '换一个' }]
            }))
          : h('div', { style: { fontSize: 10, color: C.faint, marginTop: 6 } }, '价目表里只有一个模型，无法做切换对比'),
        h('div', {
          style: {
            marginTop: 10, padding: '8px 10px', border: '1px solid ' + C.border,
            borderRadius: 8, background: 'rgba(255,255,255,.03)'
          }
        },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
            h('span', { style: { fontSize: 11, color: C.dim } }, '模拟成本'),
            h('span', { 'data-sim-result': '', style: { fontSize: 18, fontWeight: 650, fontVariantNumeric: 'tabular-nums' } },
              `${sym}${sim.toFixed(2)}`),
            h('span', { style: { marginLeft: 'auto', fontSize: 11, color: diff <= 0 ? C.good : C.warn, fontVariantNumeric: 'tabular-nums' } },
              (diff <= 0 ? '省 ' : '多 ') + `${sym}${Math.abs(diff).toFixed(2)}` +
              (baseline > 0 ? `（${diff <= 0 ? '-' : '+'}${Math.abs(diff / baseline * 100).toFixed(1)}%）` : ''))),
          h('div', { style: { fontSize: 10, color: C.faint, marginTop: 4 } },
            `基准（现状）${sym}${baseline.toFixed(2)} · 价格截至 ${prices?.asOf ?? '—'}；` +
            '这是纯本地重算，不会真的改变任何用量')))
    }

    /* 账户余额条：数据来自宿主的账户服务（本插件不碰凭据、不自己联网） */
    function BalanceStrip({ balance, fallbackSymbol, peak, delta }) {      if (!balance) return null
      const symOf = (cur) => (cur === 'USD' ? '$' : cur === 'CNY' ? '¥' : fallbackSymbol || '')
      const sumByCurrency = (list) => {
        const out = new Map()
        for (const w of list ?? []) {
          const v = Number(w?.balance)
          if (!Number.isFinite(v)) continue
          out.set(w.currency ?? '?', (out.get(w.currency ?? '?') ?? 0) + v)
        }
        return [...out.entries()]
      }
      const chip = (key, label, amount, currency) => h('div', {
        key,
        style: {
          flex: 1, minWidth: 0, border: '1px solid ' + C.border, borderRadius: 10,
          background: C.card, padding: '9px 11px'
        }
      },
        h('div', { style: { fontSize: 11, color: C.dim, marginBottom: 3 } }, label),
        h('div', { style: { fontSize: 18, fontWeight: 650, fontVariantNumeric: 'tabular-nums' } },
          `${symOf(currency)}${amount.toFixed(2)}`))

      if (balance.status === 'ready') {
        const wallets = sumByCurrency(balance.wallets)
        const bonus = sumByCurrency(balance.bonusWallets)
        const cur = wallets[0]?.[0] ?? bonus[0]?.[0] ?? 'CNY'
        const main = wallets[0]?.[1] ?? 0
        const bonusTotal = bonus.reduce((a, [, v]) => a + v, 0)
        const total = main + bonusTotal
        /*
         * 血条：以「观察到的历史最高水位」为满格，直观看出还剩多少。
         * peak 来自宿主已经记的水位点，不需要额外状态；拿不到就不画条（不编造）。
         */
        const pk = Number(peak) || 0
        const ratio = pk > 0 ? Math.max(0, Math.min(1, total / pk)) : null
        const low = ratio !== null && ratio < 0.2
        const hpColor = low ? C.bad : ratio !== null && ratio < 0.5 ? C.warn : C.good
        return h('div', null,
          h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            chip('w', '充值余额', main, cur),
            chip('b', '赠送余额', bonusTotal, cur)),
          ratio !== null
            ? h('div', {
                className: low ? 'dsh-hp-low' : (Number(delta) > 0 ? 'dsh-hp-gain' : ''),
                'data-hp': Math.round(ratio * 100),
                title: '相对历史最高水位 ' + symOf(cur) + pk.toFixed(2) + '，当前剩余 ' + Math.round(ratio * 100) + '%',
                style: {
                  display: 'flex', alignItems: 'center', gap: 7, marginTop: 7
                }
              },
                h('div', {
                  style: {
                    flex: 1, height: 6, borderRadius: 999, overflow: 'hidden',
                    background: 'rgba(255,255,255,.07)', border: '1px solid ' + C.border
                  }
                },
                  h('i', {
                    style: {
                      display: 'block', height: '100%', width: Math.max(2, ratio * 100) + '%',
                      borderRadius: 999, background: hpColor, transformOrigin: 'left center'
                    }
                  })),
                h('span', {
                  style: {
                    fontSize: 10, color: hpColor, fontVariantNumeric: 'tabular-nums',
                    minWidth: 34, textAlign: 'right'
                  }
                }, Math.round(ratio * 100) + '%'),
                Number.isFinite(Number(delta)) && Number(delta) !== 0
                  ? h('span', {
                      style: {
                        fontSize: 9.5, padding: '1px 5px', borderRadius: 999,
                        color: Number(delta) > 0 ? C.good : C.bad,
                        background: (Number(delta) > 0 ? C.good : C.bad) + '1c',
                        border: '1px solid ' + (Number(delta) > 0 ? C.good : C.bad) + '44'
                      }
                    }, (Number(delta) > 0 ? '+' : '−') + symOf(cur) + Math.abs(Number(delta)).toFixed(2))
                  : null)
            : null)
      }
      const msg = balance.status === 'none'
        ? '未登录 / 无账户授权'
        : balance.status === 'failed'
          ? '余额读取失败（平台返回 failed）'
          : balance.status === 'unavailable'
            ? '宿主未提供账户服务'
            : '状态未知：' + (balance.message ?? balance.status)
      return h('div', {
        style: {
          marginTop: 8, fontSize: 10.5, color: C.faint,
          border: '1px dashed ' + C.border2, borderRadius: 8, padding: '6px 9px'
        }
      }, '账户余额：' + msg)
    }

    /* ================================================================ *
     * 工具 / 会话
     * ================================================================ */

    function ToolsPanel({ tools, onTip, onTipEnd }) {
      const top = tools.slice(0, 6)
      const max = Math.max(1, ...top.map((t) => t.ms))
      return h('div', null, top.map((t) => h('div', {
        key: t.name,
        style: { padding: '4px 0' },
        onMouseEnter: (e) => onTip(e, {
          title: t.name,
          rows: [
            ['调用', String(t.calls)],
            ['总耗时', duration(t.ms)],
            ['平均', duration(t.avgMs)],
            ['失败', String(t.errors)],
            ['涉及会话', String(t.sessions)]
          ]
        }),
        onMouseLeave: onTipEnd
      },
        h('div', { style: { display: 'flex', fontSize: 11.5, gap: 6, alignItems: 'baseline' } },
          h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
          t.errors > 0 ? h('span', { style: { color: t.errors / Math.max(1, t.calls) > 0.05 ? C.bad : C.warn } }, `✕${t.errors}`) : null,
          h('span', { style: { color: C.faint, fontVariantNumeric: 'tabular-nums', width: 56, textAlign: 'right' } }, `${t.calls} 次`),
          h('span', { style: { fontVariantNumeric: 'tabular-nums', width: 62, textAlign: 'right' } }, duration(t.ms))),
        h('div', { style: { marginTop: 3 } }, h(Bar, { ratio: t.ms / max, color: C.purple, height: 3 }))))
      )
    }

    function SessionsPanel({ sessions, onTip, onTipEnd, onOpen, drill }) {
      return h('div', null, sessions.slice(0, 6).map((s, i) => h('div', {
        key: s.id,
        className: 'dsh-fade',
        'data-session-id': drill ? s.id : '',
        'data-drill': drill ? '1' : '0',
        title: drill ? '点开看这一轮轮发生了什么' : undefined,
        style: {
          padding: '6px 0', borderBottom: '1px solid ' + C.border2, animationDelay: i * 30 + 'ms',
          cursor: drill ? 'pointer' : 'default'
        },
        onClick: drill ? () => onOpen(s.id, s.title ?? s.id) : undefined,
        onMouseEnter: (e) => onTip(e, {
          title: s.title ?? s.id,
          rows: [
            ['工作区', s.workspace ?? s.cwd ?? '—'],
            ['模型', (s.models ?? []).map(modelLabel).join(', ') || '—'],
            ['起止', `${mdhm(s.firstAt)} → ${mdhm(s.lastAt)}`],
            ['时长', duration(s.durationMs)],
            ['请求 / 轮次', `${s.requests} / ${s.turns}`],
            ['工具 调用/失败', `${s.toolCalls} / ${s.toolErrors}`],
            ['压缩', s.prunes ? `${s.prunes} 次（丢弃 ${cn(s.prunedTokens)}）` : '无'],
            ['来源', s.source === 'events' ? '事件流' : '投影缓存'],
            ...(drill && s.source === 'events' ? [['下钻', '点击查看逐轮明细']] : [])
          ]
        }),
        onMouseLeave: onTipEnd
      },
        h('div', { style: { display: 'flex', gap: 6, fontSize: 11.5, alignItems: 'baseline' } },
          h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.title ?? s.id),
          drill && s.source === 'events' ? h('span', { style: { color: C.accent, fontSize: 10 } }, '›') : null,
          h('span', { style: { color: C.faint, fontSize: 10 } }, s.workspace ?? '—')),
        h('div', { style: { display: 'flex', gap: 6, fontSize: 10.5, color: C.faint, marginTop: 2, alignItems: 'baseline' } },
          h('span', null, mdhm(s.firstAt)),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, cn(s.total)),
          h('span', { style: { fontVariantNumeric: 'tabular-nums', width: 54, textAlign: 'right' } }, money(s.cost)),
          s.toolErrors > 0 ? h('span', { style: { color: C.warn } }, `✕${s.toolErrors}`) : null))))
    }

    /* ================================================================ *
     * E 组：逐轮下钻视图
     * ================================================================ */

    function StepRow({ s, maxTotal, i }) {
      const tools = s.tools ?? []
      return h('div', {
        className: 'dsh-fade',
        style: { padding: '4px 0 4px 2px', animationDelay: Math.min(i * 12, 200) + 'ms' }
      },
        h('div', { style: { display: 'flex', gap: 6, fontSize: 11, alignItems: 'baseline' } },
          h('span', { style: { color: C.faint, width: 34, flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' } }, '#' + s.step),
          h('span', { style: { flex: 1, minWidth: 0 } }, h(Bar, { ratio: maxTotal > 0 ? s.usage.total / maxTotal : 0, color: C.accent, height: 3 })),
          h('span', { style: { width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, cn(s.usage.total)),
          h('span', { style: { width: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, money(s.cost)),
          h('span', { style: { width: 46, textAlign: 'right', color: C.faint, fontVariantNumeric: 'tabular-nums' } },
            s.ms != null ? (s.ms >= 60000 ? (s.ms / 60000).toFixed(1) + '分' : (s.ms / 1000).toFixed(1) + 's') : '—'),
          s.retries > 0 ? h('span', { style: { width: 30, textAlign: 'right', color: C.warn, fontSize: 10 } }, `重试${s.retries}`) : null),
        tools.length
          ? h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3, paddingLeft: 34 } },
              tools.map((t, k) => h('span', {
                key: k,
                style: {
                  fontSize: 10, padding: '1px 5px', borderRadius: 4,
                  border: '1px solid ' + (t.error ? 'rgba(239,107,107,.5)' : C.border),
                  background: t.error ? 'rgba(239,107,107,.12)' : 'rgba(255,255,255,.04)',
                  color: t.error ? '#ffb4b4' : C.dim
                }
              }, t.name + (t.ms != null ? ' · ' + (t.ms >= 1000 ? (t.ms / 1000).toFixed(1) + 's' : t.ms + 'ms') : '') + (t.error ? ' ✕' : ''))))
          : null)
    }

    function TurnCard({ t, maxTurnTotal, defaultOpen }) {
      const [open, setOpen] = useState(!!defaultOpen)
      const toolCount = (t.steps ?? []).reduce((a, s) => a + (s.tools?.length ?? 0), 0)
      const errors = (t.steps ?? []).reduce((a, s) => a + (s.tools ?? []).filter((x) => x.error).length, 0)
      const maxStepTotal = Math.max(1, ...(t.steps ?? []).map((s) => s.usage.total))
      const badge = t.reason && t.reason !== 'completed'
        ? h('span', { style: { fontSize: 10, color: C.warn, border: '1px solid ' + C.border, borderRadius: 4, padding: '0 4px' } }, t.reason)
        : null
      return h('div', { style: { borderBottom: '1px solid ' + C.border2, padding: '7px 0' } },
        h('div', {
          'data-turn': t.turn,
          onClick: () => setOpen(!open),
          style: { cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5 }
        },
          h('span', { style: { color: C.faint, width: 12 } }, open ? '▾' : '▸'),
          h('span', { style: { width: 52 } }, `第 ${t.turn} 轮`),
          h('span', { style: { flex: 1, minWidth: 0 } },
            h(Bar, { ratio: maxTurnTotal > 0 ? t.usage.total / maxTurnTotal : 0, color: C.purple, height: 4 })),
          badge,
          h('span', { style: { width: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, cn(t.usage.total)),
          h('span', { style: { width: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, money(t.cost))),
        h('div', { style: { display: 'flex', gap: 8, fontSize: 10, color: C.faint, marginTop: 2, paddingLeft: 18 } },
          h('span', null, `${t.steps.length} 步`),
          h('span', null, t.ms != null ? duration(t.ms) : '时长未知'),
          toolCount ? h('span', null, `工具 ${toolCount}${errors ? `（失败 ${errors}）` : ''}`) : null,
          h('span', { style: { flex: 1 } }),
          h('span', null, t.at ? new Date(t.at).toLocaleTimeString('zh-CN', { hour12: false }) : '')),
        open
          ? h('div', { style: { marginTop: 5, paddingLeft: 12, borderLeft: '1px solid ' + C.border2 } },
              (t.steps ?? []).map((s, i) => h(StepRow, { key: s.step, s, maxTotal: maxStepTotal, i })),
              (t.steps ?? []).length === 0 ? h('div', { style: { fontSize: 10.5, color: C.faint } }, '这一轮没有记录到步骤') : null)
          : null)
    }

    function DrillView({ id, title, onBack, prices }) {
      const [state, setState] = useState({ loading: true, detail: null, error: null })
      useEffect(() => {
        let alive = true
        setState({ loading: true, detail: null, error: null })
        void (async () => {
          try {
            const r = await fetch(`/usage-panel/api/session?id=${encodeURIComponent(id)}`)
            const j = await r.json()
            if (!alive) return
            if (!r.ok || !j?.ok) setState({ loading: false, detail: null, error: j?.error?.message ?? `HTTP ${r.status}` })
            else setState({ loading: false, detail: j.detail, error: null })
          } catch (e) {
            if (alive) setState({ loading: false, detail: null, error: String(e?.message ?? e) })
          }
        })()
        return () => { alive = false }
      }, [id])

      const sym = prices?.symbol ?? '¥'
      const d = state.detail
      const maxTurnTotal = d ? Math.max(1, ...d.turns.map((t) => t.usage.total)) : 1
      const lastTurn = d?.turns?.[d.turns.length - 1]?.turn

      return h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', borderBottom: '1px solid ' + C.border, position: 'sticky', top: 0, background: C.cardSolid, zIndex: 2 } },
          h('button', { type: 'button', onClick: onBack, style: btnStyle, title: '返回' }, '‹'),
          h('span', { style: { fontSize: 13, fontWeight: 650, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '逐轮明细'),
          state.loading ? h('span', { style: { fontSize: 10.5, color: C.faint } }, '解析中…') : null),

        h('div', { style: { padding: '8px 13px 18px' } },
          h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 3 } }, d?.title ?? title ?? id),
          h('div', { style: { fontSize: 10, color: C.faint, marginBottom: 8, wordBreak: 'break-all' } },
            (d?.cwd ?? '—') + (d?.firstAt ? ` · ${mdhm(d.firstAt)} → ${mdhm(d.lastAt)}` : '')),

          state.error
            ? h('div', { style: { fontSize: 11, color: C.warn, border: '1px dashed ' + C.border, borderRadius: 8, padding: '10px 12px', lineHeight: 1.7 } },
                '无法下钻：' + state.error,
                h('div', { style: { color: C.faint, marginTop: 4, fontSize: 10.5 } },
                  '只有事件流（session.*.jsonl.zstd）才能给出逐轮明细；来自投影缓存的会话没有这一步。'))
            : null,

          state.loading
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 } },
                [0, 1, 2, 3, 4].map((i) => h('div', { key: i, style: { height: 14, borderRadius: 4, background: 'rgba(255,255,255,.05)' } })))
            : null,

          d
            ? h(React.Fragment, null,
                h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10.5, color: C.dim, border: '1px solid ' + C.border, borderRadius: 8, padding: '7px 9px', marginBottom: 4 } },
                  h('span', null, `${d.turns.length} 轮 / ${d.totals.steps} 步`),
                  h('span', null, `${cn(d.totals.usage.total)} token`),
                  h('span', { style: { color: C.text } }, `${sym}${d.totals.cost.toFixed(2)}`),
                  h('span', null, `工具 ${d.totals.toolCalls}`),
                  d.retries ? h('span', { style: { color: C.warn } }, `重试 ${d.retries}`) : null,
                  d.compactions.length ? h('span', null, `压缩 ${d.compactions.length}`) : null,
                  d.truncated ? h('span', { style: { color: C.warn } }, '已截断') : null,
                  h('span', { style: { flex: 1 } }),
                  h('span', { style: { color: C.faint } }, `解析 ${d.parseMs}ms · ${(d.bytes / 1048576).toFixed(1)}MB`)),

                d.compactions.length
                  ? h('div', { style: { fontSize: 10, color: C.faint, margin: '2px 0 4px' } },
                      '上下文压缩：' + d.compactions.map((c) => `第 ${c.turn ?? '?'} 轮丢弃 ${cn(c.tokens)}`).join(' · '))
                  : null,

                d.turns.map((t) => h(TurnCard, { key: t.turn, t, maxTurnTotal, defaultOpen: t.turn === lastTurn })),
                d.turns.length === 0 ? h('div', { style: { fontSize: 11, color: C.faint } }, '这个会话没有解析到任何轮次') : null)
            : null))
    }

    /* ================================================================ *
     * 面板
     * ================================================================ */

    function Panel({ onClose, width, setWidth, usage, prefs, setPref, onOpenSettings, onOpenDrill }) {
      DENSITY = prefs.density === 'detail' ? 'detail' : 'concise'
      const { data, error, busy, at, load } = usage
      const [range, setRange] = useState(() => { try { return localStorage.getItem(LS.range) || '7' } catch { return '7' } })
      const [mode, setMode] = useState(() => { try { return localStorage.getItem(LS.mode) || 'model' } catch { return 'model' } })
      const [metric, setMetric] = useState(() => { try { return localStorage.getItem(LS.metric) || 'token' } catch { return 'token' } })
      const [budget, setBudget] = useState(() => { try { return Number(localStorage.getItem(LS.budget)) || 0 } catch { return 0 } })
      const [tip, setTip] = useState(null)
      const [bodyRef, bodyW] = useMeasure()

      /* ============ 磁贴直接编辑（iOS 控制中心式）============
       * 进入编辑态：拖卡片本体=重排；拖右下角把手=改宽/高；点左上 ⊖=隐藏。
       * 长按任意卡片 0.5 秒也可进入。
       */
      const [editLayout, setEditLayout] = useState(false)
      /* 热力图选中的那一天（点第二下取消） */
      const [pickedDay, setPickedDay] = useState(null)
      /* 分享卡片：先渲染 SVG，再栅格化成 PNG 下载；任何一步失败就退化为下载 SVG */
      async function shareCard() {
        const svg = buildShareSvg({ totals, meta, byDay, level: null })
        const name = 'dsh-usage-orb-' + (dayKey(new Date()) || 'card')
        const save = (href, download) => {
          const a = document.createElement('a')
          a.href = href
          a.download = download
          document.body.appendChild(a)
          a.click()
          a.remove()
        }
        try {
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
          const img = new Image()
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
          const W = 720
          const H = 420
          const cv = document.createElement('canvas')
          cv.width = W * 2
          cv.height = H * 2
          const ctx = cv.getContext('2d')
          ctx.scale(2, 2)
          ctx.drawImage(img, 0, 0, W, H)
          URL.revokeObjectURL(url)
          save(cv.toDataURL('image/png'), name + '.png')
        } catch {
          try { save('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), name + '.svg') } catch { /* ignore */ }
        }
      }
      const [liveTile, setLiveTile] = useState(null)
      const liveTileRef = useRef(null)
      const gridElRef = useRef(null)
      const dragRef = useRef(null)
      const longPressRef = useRef(null)

      const cardCell = () => {
        const g = gridElRef.current
        if (!g) return { cw: 120, ch: CARD_ROW_H, gap: 8 }
        const cs = getComputedStyle(g)
        const gap = parseFloat(cs.columnGap) || 8
        const cols = (cs.gridTemplateColumns || '').split(' ').filter(Boolean).map(parseFloat).filter((x) => Number.isFinite(x))
        return {
          cw: cols.length ? cols[0] : 120,
          ch: parseFloat(cs.gridAutoRows) || CARD_ROW_H,
          gap
        }
      }

      const beginTileDrag = (kind, tile, e) => {
        if (e.button !== undefined && e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        dragRef.current = { kind, key: tile.key, x0: e.clientX, y0: e.clientY, span0: tile.span, rows0: tile.rows, moved: false }
        liveTileRef.current = { key: tile.key, span: tile.span, rows: tile.rows }
        setLiveTile(liveTileRef.current)
        const onMove = (ev) => {
          const d = dragRef.current
          if (!d) return
          const dx = ev.clientX - d.x0
          const dy = ev.clientY - d.y0
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          if (d.kind === 'resize') {
            const { cw, ch, gap } = cardCell()
            const span = Math.max(1, Math.min(3, Math.round((d.span0 * (cw + gap) + dx) / (cw + gap))))
            const rows = Math.max(1, Math.min(2, Math.round((d.rows0 * (ch + gap) + dy) / (ch + gap))))
            liveTileRef.current = { key: d.key, span, rows }
            setLiveTile(liveTileRef.current)
          } else if (d.moved) {
            const el = document.elementFromPoint(ev.clientX, ev.clientY)
            const over = el && el.closest ? el.closest('[data-card]') : null
            const overKey = over ? over.getAttribute('data-card') : null
            if (overKey && overKey !== d.key) {
              const order = PURE.normalizeOrder(prefs.cardOrder, CARD_KEYS)
              const from = order.indexOf(d.key)
              const to = order.indexOf(overKey)
              if (from >= 0 && to >= 0 && from !== to) {
                const next = order.slice()
                next.splice(from, 1)
                next.splice(to, 0, d.key)
                setPref({ cardOrder: next })
              }
            }
          }
        }
        const onUp = () => {
          const d = dragRef.current
          dragRef.current = null
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.removeEventListener('pointercancel', onUp)
          const live = liveTileRef.current
          if (d && d.kind === 'resize' && live && (live.span !== d.span0 || live.rows !== d.rows0)) {
            setPref({
              cardSpans: Object.assign({}, prefs.cardSpans || {}, { [d.key]: live.span }),
              cardRows: Object.assign({}, prefs.cardRows || {}, { [d.key]: live.rows })
            })
          }
          liveTileRef.current = null
          setLiveTile(null)
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
      }

      const armLongPress = () => {
        if (editLayout) return
        clearTimeout(longPressRef.current)
        longPressRef.current = setTimeout(() => setEditLayout(true), 520)
      }
      const disarmLongPress = () => clearTimeout(longPressRef.current)

      const persist = useCallback((k, v) => { try { localStorage.setItem(k, String(v)) } catch { /* ignore */ } }, [])
      // 拉取与轮询都上提到 Root（浮动按钮的余额环也要用同一份数据）

      const onTip = useCallback((e, content) => {
        const r = e.currentTarget.getBoundingClientRect()
        setTip({ x: r.left + r.width / 2, y: r.top, ...content })
      }, [])
      const onTipEnd = useCallback(() => setTip(null), [])

      /* ---- 派生 ---- */
      const totals = data?.totals
      const meta = data?.meta
      const byDay = data?.byDay ?? []
      const days = useMemo(() => fillDays(byDay, range === 'all' ? 'all' : Number(range)), [byDay, range])
      const rangeDays = range === 'all' ? days.length : Number(range)
      const chartW = Math.max(200, bodyW - 26)





      const series = useMemo(() => {
        if (mode === 'class') {
          return CLASSES.map((c) => ({ key: c.key, label: c.label, color: c.color, get: (d) => d[c.key] ?? 0 }))
        }
        const sum = new Map()
        for (const d of days) {
          for (const [k, v] of Object.entries(d.models ?? {})) sum.set(k, (sum.get(k) ?? 0) + (v.total ?? 0))
        }
        const sorted = [...sum.entries()].sort((a, b) => b[1] - a[1])
        const top = sorted.slice(0, 6).map(([k]) => k)
        const out = top.map((k, i) => ({
          key: k, label: modelLabel(k), color: PALETTE[i % PALETTE.length],
          get: (d) => d.models?.[k]?.total ?? 0
        }))
        if (sorted.length > 6) {
          const rest = new Set(sorted.slice(6).map(([k]) => k))
          out.push({
            key: '__other', label: '其他', color: PALETTE[6],
            get: (d) => Object.entries(d.models ?? {}).reduce((a, [k, v]) => a + (rest.has(k) ? (v.total ?? 0) : 0), 0)
          })
        }
        return out
      }, [days, mode])

      /*
       * 面板区块总表：顺序 = 「玩法开关」的拖动排序，开关决定去留。
       * 默认顺序刻意等于「这些区块原本的物理顺序」，所以没动过排序时版面看起来没变。
       * 关掉或数据不足的区块会从数组里消失，后面的自动前移。
       */
      const orderedSections = useMemo(() => {
        if (!data) return []
        const nodes = {
          fTicker: (data.recent?.length ?? 0) > 0
            ? h('div', { key: 'fTicker', 'data-panel-section': 'fTicker' },
                h(SectionTitle, { right: rightNote(`最近 ${Math.min(8, data.recent.length)} 条`) }, '实时动态'),
                h(Ticker, { recent: data.recent, onTip, onTipEnd }))
            : null,
          fHistory: meta?.balance?.status === 'ready'
            ? h('div', { key: 'fHistory', 'data-panel-section': 'fHistory' },
                h(SectionTitle, { right: rightNote('每分钟一个点') }, '余额水位'),
                h(BalanceHistory, { balance: meta.balance, width: chartW }))
            : null,
          fHeatmap: h('div', { key: 'fHeatmap', 'data-panel-section': 'fHeatmap' },
            h(SectionTitle, { right: rightNote('最近 26 周 · 点格看当天') }, '活跃热力图'),
            h(Heatmap, {
              byDay, firstDay: totals?.firstAt ? dayKey(new Date(totals.firstAt)) : null,
              width: chartW, onTip, onTipEnd,
              picked: pickedDay ? pickedDay.day : null,
              onPick: (c) => setPickedDay(c ? c : null)
            }),
            pickedDay ? h('div', {
              'data-day-detail': '',
              'data-day': pickedDay.day,
              style: {
                marginTop: 8, padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,.04)', border: '1px solid ' + C.border,
                fontSize: 11
              }
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 } },
                h('span', { style: { fontWeight: 650 } }, pickedDay.day),
                h('span', { style: { color: C.faint, fontSize: 10 } }, '当日明细'),
                h('button', {
                  type: 'button',
                  onClick: () => setPickedDay(null),
                  title: '收起',
                  style: {
                    marginLeft: 'auto', background: 'transparent', border: 'none', color: C.faint,
                    cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0, fontFamily: 'inherit'
                  }
                }, '×')),
              h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', color: C.dim } },
                h('span', null, 'Token ', h('b', { style: { color: C.text } }, cnNum(pickedDay.value || 0) + cnUnit(pickedDay.value || 0))),
                h('span', null, '成本 ', h('b', { style: { color: C.text } }, money(pickedDay.cost || 0))),
                h('span', null, '请求 ', h('b', { style: { color: C.text } }, String(pickedDay.requests || 0)))),
              (() => {
                const rec = (byDay || []).find((d) => d.day === pickedDay.day)
                const models = rec && rec.models ? Object.entries(rec.models).filter(([, v]) => (v?.total ?? 0) > 0) : []
                if (!models.length) return null
                models.sort((a, b2) => (b2[1].total ?? 0) - (a[1].total ?? 0))
                return h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 } },
                  models.slice(0, 4).map(([k, v]) => h('div', { key: k, style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    h('span', { style: { minWidth: 92, color: C.dim } }, modelLabel(k)),
                    h('div', { style: { flex: 1, height: 4, borderRadius: 999, background: 'rgba(255,255,255,.07)' } },
                      h('i', {
                        style: {
                          display: 'block', height: '100%', borderRadius: 999, background: C.accent,
                          width: Math.max(3, Math.round(((v.total || 0) / Math.max(1, pickedDay.value || 1)) * 100)) + '%'
                        }
                      })),
                    h('span', { style: { fontSize: 10, color: C.faint, minWidth: 44, textAlign: 'right' } },
                      cnNum(v.total || 0) + cnUnit(v.total || 0)))))
              })())
            : null),
          fDaily: h('div', { key: 'fDaily', 'data-panel-section': 'fDaily' },
            h(SectionTitle, {
              right: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } },
                h(Segmented, {
                  value: mode, onChange: (v) => { setMode(v); persist(LS.mode, v) },
                  options: [{ value: 'model', label: '按模型' }, { value: 'class', label: '按类别' }]
                }),
                h(Segmented, {
                  value: range, onChange: (v) => { setRange(v); persist(LS.range, v) },
                  options: [{ value: '7', label: '7天' }, { value: '14', label: '14天' }, { value: '30', label: '30天' }, { value: 'all', label: '全部' }]
                }))
            }, '每日 Token 用量'),
            h(StackedBars, { days, series, width: chartW, onTip, onTipEnd }),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 10.5, color: C.dim } },
              series.map((s) => h('span', { key: s.key, style: { display: 'inline-flex', alignItems: 'center' } },
                h(Dot, { color: s.color }), s.label)))),
          fCostTrend: h('div', { key: 'fCostTrend', 'data-panel-section': 'fCostTrend' },
            h(SectionTitle, { right: rightNote('独立坐标轴') }, `每日成本（${meta.prices.currency}）`),
            (totals?.cost ?? 0) > 0
              ? h(CostTrend, { days, width: chartW })
              : h('div', { style: { fontSize: 11, color: C.faint } }, '没有匹配到价格的用量，无法估算成本')),
          fSim: (data.totals?.cost ?? 0) > 0
            ? h('div', { key: 'fSim', 'data-panel-section': 'fSim' },
                h(SectionTitle, { right: rightNote('改条件看账单') }, '「如果」模拟器'),
                h(Simulator, { totals: data.totals, prices: meta.prices, byModel: data.byModel }))
            : null,
          fModel: h('div', { key: 'fModel', 'data-panel-section': 'fModel' },
            h(SectionTitle, {
              right: h(Segmented, {
                value: metric, onChange: (v) => { setMetric(v); persist(LS.metric, v) },
                options: [{ value: 'token', label: '按 Token' }, { value: 'cost', label: '按成本' }]
              })
            }, '模型用量'),
            h('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
              h(Donut, { byModel: data.byModel, width: chartW, metric, onTip, onTipEnd }),
              h(ModelTable, { byModel: data.byModel, metric, onTip, onTipEnd }))),
          fToolCost: (data.toolsByCost?.length ?? 0) > 0
            ? h('div', { key: 'fToolCost', 'data-panel-section': 'fToolCost' },
                h(SectionTitle, { right: h('span', { style: { fontSize: 10 } }, `覆盖 ${pct(data.attrCoverage ?? 0, 1)} 的成本`) }, '工具烧钱榜 · 按归因'),
                h(ToolCostTable, { tools: data.toolsByCost, coverage: data.attrCoverage, onTip, onTipEnd }))
            : null,
          fTools: (data.tools?.length ?? 0) > 0
            ? h('div', { key: 'fTools', 'data-panel-section': 'fTools' },
                h(SectionTitle, {
                  right: rightNote(`${totals.toolCalls} 次 · ${duration(totals.toolMsMeasured)}` + (totals.toolErrors ? ` · 失败 ${totals.toolErrors}` : ''))
                }, '工具调用 · 按耗时'),
                h(ToolsPanel, { tools: data.tools, onTip, onTipEnd }))
            : null,
          fSessions: (data.sessions?.length ?? 0) > 0
            ? h('div', { key: 'fSessions', 'data-panel-section': 'fSessions' },
                h(SectionTitle, { right: rightNote(`前 ${Math.min(6, data.sessions.length)} / ${data.sessions.length}`) }, '会话排行'),
                h(SessionsPanel, { sessions: data.sessions, onTip, onTipEnd, drill: prefs.fDrill, onOpen: onOpenDrill }))
            : null,
        }
        return normalizeOrder(prefs.featureOrder)
          .filter((k) => FEATURE_BY_KEY.get(k)?.movable && prefs[k] && nodes[k])
          .map((k) => nodes[k])
      }, [data, meta, prefs, chartW, series, days, mode, range, metric, onTip, onTipEnd, onOpenDrill, pickedDay])

      const prevDays = useMemo(() => {
        if (range === 'all') return []
        const today = startOfDay(new Date())
        const keys = new Set()
        for (let i = rangeDays; i < rangeDays * 2; i += 1) keys.add(dayKey(addDays(today, -i)))
        return byDay.filter((d) => keys.has(d.day))
      }, [byDay, range, rangeDays])

      const sumOf = (list, f) => list.reduce((a, d) => a + (f(d) ?? 0), 0)
      const curTotal = sumOf(days, (d) => d.total)
      const prevTotal = sumOf(prevDays, (d) => d.total)
      const delta = prevTotal > 0 ? curTotal / prevTotal - 1 : null
      const rangeCost = sumOf(days, (d) => d.cost)
      const rangeRequests = sumOf(days, (d) => d.requests)
      const topModel = (data?.byModel ?? [])[0]
      const rangeLabel = range === 'all' ? '全部' : rangeDays + '天'

      /* ---- 拖拽手柄（宽度由外层 PanelShell 持有）---- */
      const startDrag = (e) => {
        e.preventDefault()
        const startX = e.clientX
        const startW = width
        const move = (ev) => {
          const w = Math.max(MIN_W, Math.min(MAX_W, startW + (startX - ev.clientX)))
          setWidth(w)
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          try { localStorage.setItem(LS.width, String(width)) } catch { /* ignore */ }
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }

      /* ---- 首屏骨架 ---- */

      /* 6 张卡的节点（内容不变，只由上面的方案决定显示哪些、多大） */
      const cardNodes = useMemo(() => (data ? {
        total: h(MetricCard, {
          label: `Token 总用量 · ${rangeLabel}`,
          value: curTotal, format: cnNum, unit: cnUnit(curTotal),
          hint: exact(curTotal), delta
        }),
        sessions: h(MetricCard, {
          label: '会话 / 请求',
          value: totals?.sessions ?? 0, format: (v) => exact(v), unit: '',
          hint: `${exact(rangeRequests)} 次请求 · ${totals?.turns ?? 0} 轮`
        }),
        topModel: h(MetricCard, {
          label: '最常用模型',
          value: topModel?.total ?? 0, format: cnNum, unit: cnUnit(topModel?.total ?? 0),
          hint: topModel ? `${topModel.model} · 占比 ${pct(topModel.share)}` : '—'
        }),
        cost: h(MetricCard, {
          label: `估算成本 · ${rangeLabel}`,
          value: rangeCost, format: money, unit: '',
          accent: C.good,
          hint: `今日 ${money(totals?.costToday ?? 0)} · 混合单价 ${money(totals?.effectiveCostPerMTok ?? 0)}/1M`,
          progress: budget > 0
            ? h('div', null,
                h(Bar, { ratio: (totals?.costToday ?? 0) / budget, color: (totals?.costToday ?? 0) > budget ? C.bad : C.warn, height: 4 }),
                h('div', { style: { fontSize: 9.5, color: C.faint, marginTop: 3 } },
                  `日预算 ${money(budget)} · 剩余 ${money(Math.max(0, budget - (totals?.costToday ?? 0)))}`))
            : h('input', {
                type: 'number', min: 0, step: 1, placeholder: `设日预算(${CUR.symbol})`,
                onChange: (e) => { const v = Number(e.target.value) || 0; setBudget(v); persist(LS.budget, v) },
                style: {
                  width: '100%', marginTop: 5, background: 'transparent', border: '1px solid ' + C.border,
                  borderRadius: 6, color: C.dim, fontSize: 10.5, padding: '3px 6px', fontFamily: 'inherit', boxSizing: 'border-box'
                }
              })
        }),
        cacheSaved: h(MetricCard, {
          label: '缓存省下的钱',
          value: totals?.cacheSaved ?? 0, format: money, unit: '',
          accent: C.good,
          hint: `命中率 ${pct(totals?.cacheHitRate ?? 0, 2)} · 相当于应花费的 ${pct(totals?.cacheSavedShare ?? 0)}`
        }),
        peak: h(MetricCard, {
          label: '高峰时段占比',
          value: totals?.peakShare ?? 0, format: (v) => pctNum(v, 0), unit: '%',
          accent: (totals?.peakShare ?? 0) > 0.5 ? C.warn : C.text,
          hint: (totals?.peakShare ?? 0) > 0.02
            ? `高峰 ${money(totals?.peakCost ?? 0)} · 全挪到低谷约省 ${money((totals?.peakCost ?? 0) / 2)}`
            : '全部落在低谷时段'
        })
      } : {}), [data, rangeLabel, curTotal, exact, rangeRequests, totals, topModel, rangeCost, money, pct, pctNum, cnNum, cnUnit, budget, delta])

      const cardPlan = useMemo(
        () => planCards({
          order: prefs.cardOrder, keys: CARD_KEYS,
          hidden: prefs.cardHidden, spans: prefs.cardSpans, rows: prefs.cardRows
        }),
        [prefs.cardOrder, prefs.cardHidden, prefs.cardSpans, prefs.cardRows])

      if (!data) {
        return h('div', { style: { padding: 14 } },
          h('div', { className: 'dsh-skel', style: { height: 18, width: '45%', marginBottom: 12 } }),
          h('div', { style: { display: prefs.fCards ? 'grid' : 'none', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 } },
            [0, 1, 2].map((i) => h('div', { key: i, className: 'dsh-skel', style: { height: 62 } }))),
          h('div', { className: 'dsh-skel', style: { height: 92, marginTop: 14 } }),
          h('div', { className: 'dsh-skel', style: { height: 132, marginTop: 14 } }),
          error
            ? h('div', { style: { marginTop: 12, color: C.bad, fontSize: 11.5 } },
                '数据加载失败：' + error,
                h('div', { style: { marginTop: 6 } },
                  h('button', { type: 'button', onClick: () => load(true), style: btnStyle }, '重试')))
            : null)
      }
      return h('div', { style: { position: 'relative' } },
        /* 头部 */
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, padding: '11px 13px', flexWrap: 'nowrap',
            borderBottom: '1px solid ' + C.border, position: 'sticky', top: 0,
            background: C.cardSolid, zIndex: 2
          }
        },
          h('span', { style: { fontSize: 13.5, fontWeight: 650, whiteSpace: 'nowrap', flexShrink: 0 } }, '消耗统计'),
          h('span', {
            style: { fontSize: 9.5, color: C.dim, border: '1px solid ' + C.border, borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }
          }, `${PANEL_ID} v${VERSION}`),
          h('span', { style: { flex: 1 } }),
          h('span', {
            className: busy ? 'dsh-pulse' : '',
            title: busy ? '正在刷新' : error ? '上次刷新失败' : '空闲',
            style: { width: 7, height: 7, borderRadius: '50%', background: error ? C.bad : busy ? C.accent : C.good, display: 'inline-block' }
          }),
          h('button', {
            type: 'button',
            onClick: () => setEditLayout((v) => {
                const next = !v
                /* 命令式同步：CSS 用 [data-edit='1'] 触发抖动，不依赖组件作用域 */
                const root = document.querySelector('[data-dsh-usage-panel]')
                if (root) root.setAttribute('data-edit', next ? '1' : '0')
                return next
              }),
            style: editLayout ? Object.assign({}, btnStyle, { borderColor: C.accent, color: C.accent }) : btnStyle,
            'data-layout-edit': editLayout ? 'on' : 'off',
            title: editLayout ? '完成布局编辑' : '编辑指标卡布局（也可长按卡片进入）'
          }, editLayout ? '完成' : '布局'),
          h('button', {
            type: 'button',
            onClick: () => { try { shareCard() } catch { /* ignore */ } },
            style: btnStyle,
            'data-share': '',
            title: '导出分享卡片（PNG，仅含聚合数字）'
          }, '分享'),
          h('button', {
            type: 'button', onClick: onOpenSettings, style: btnStyle, title: '设置（按钮 / 进度环）'
          }, '⚙'),
          h('button', { type: 'button', onClick: () => load(true), disabled: busy, style: { ...btnStyle, opacity: busy ? 0.55 : 1 } }, '刷新'),
          h('button', { type: 'button', onClick: onClose, style: btnStyle, title: '关闭' }, '×')),

        /* 状态行 */
        h('div', { style: { padding: '5px 13px', fontSize: 10.5, color: C.faint, borderBottom: '1px solid ' + C.border2 } },
          error
            ? h('span', { style: { color: C.bad } }, `刷新失败：${error}（显示 ${at ? hhmmss(at) : '上次'} 的数据）`)
            : `数据更新于 ${hhmmss(data.generatedAt)} · 聚合耗时 ${data.durationMs}ms` + (busy ? ' · 后台更新中…' : '')),

        /* 主体 */
        h('div', { ref: bodyRef, className: 'dsh-scroll', style: { padding: '12px 13px 16px' } },
          (meta?.warnings?.length ?? 0) > 0
            ? h('div', {
                style: {
                  border: '1px solid rgba(229,161,58,.35)', background: 'rgba(229,161,58,.08)', borderRadius: 8,
                  padding: '7px 9px', marginBottom: 10, fontSize: 10.5, color: '#f0cd8a', lineHeight: 1.6
                }
              }, meta.warnings.map((w, i) => h('div', { key: i }, '· ' + w)))
            : null,

          /* 指标卡：数量 / 顺序 / 显隐 / 宽高都由「指标卡 DIY」决定 */
          prefs.fCards && cardPlan.length
            ? h('div', {
                'data-card-grid': '',
                ref: gridElRef,
                style: {
                  display: 'grid',
                  /* 固定行高单位 + 整数倍跨格 = 磁贴式严格对齐（不再按内容自适应高度） */
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gridAutoRows: CARD_ROW_H + 'px',
                  gap: 8,
                  alignItems: 'stretch'
                }
              },
                cardPlan.map((c) => {
                  const live = liveTile && liveTile.key === c.key ? liveTile : null
                  const span = live ? live.span : c.span
                  const rows = live ? live.rows : c.rows
                  return h('div', {
                    key: c.key,
                    'data-card': c.key,
                    'data-span': String(span),
                    'data-rows': String(rows),
                    style: Object.assign({
                      gridColumn: `span ${span}`, gridRow: `span ${rows}`,
                      minWidth: 0, minHeight: 0, display: 'flex', position: 'relative', borderRadius: 16
                    }, editLayout ? { outline: '1px dashed rgba(255,255,255,.22)', outlineOffset: 1 } : null),
                    onPointerDown: () => armLongPress(),
                    onPointerUp: () => disarmLongPress(),
                    onPointerLeave: () => disarmLongPress()
                  },
                    cardNodes[c.key],
                    editLayout ? h('button', {
                      type: 'button',
                      'data-card-hide': c.key,
                      title: '隐藏这张卡（可在设置页恢复）',
                      onPointerDown: (e) => { e.stopPropagation() },
                      onClick: (e) => {
                        e.stopPropagation()
                        const hid = Array.isArray(prefs.cardHidden) ? prefs.cardHidden : []
                        if (hid.indexOf(c.key) < 0) setPref({ cardHidden: hid.concat([c.key]) })
                      },
                      style: {
                        position: 'absolute', top: 4, left: 4, width: 17, height: 17, borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,.16)', background: 'rgba(16,18,22,.86)',
                        color: 'rgba(255,255,255,.92)', fontSize: 12, lineHeight: 1, padding: 0,
                        cursor: 'pointer', zIndex: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 1px 3px rgba(0,0,0,.45)'
                      }
                    }, '−') : null,
                    editLayout ? h('div', {
                      'data-card-move': c.key,
                      title: '拖动重排',
                      onPointerDown: (e) => beginTileDrag('move', { key: c.key, span, rows }, e),
                      style: { position: 'absolute', inset: 0, borderRadius: 16, cursor: 'grab', zIndex: 2 }
                    }) : null,
                    editLayout ? h('div', {
                      'data-card-resize': c.key,
                      title: '拖动改宽 / 高',
                      onPointerDown: (e) => beginTileDrag('resize', { key: c.key, span, rows }, e),
                      style: {
                        position: 'absolute', right: 1, bottom: 1, width: 18, height: 18, borderRadius: 5,
                        cursor: 'nwse-resize', zIndex: 5, background: 'transparent',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 3
                      }
                    }, h('span', {
                      style: {
                        width: 9, height: 9, borderRadius: 2,
                        borderRight: '1.5px solid rgba(255,255,255,.7)',
                        borderBottom: '1.5px solid rgba(255,255,255,.7)'
                      }
                    })) : null
                  )
                }))
            : null,

          /* 账户余额条（也可关） */
          prefs.fBalance
          ? h(BalanceStrip, {
              balance: meta.balance,
              fallbackSymbol: meta.prices.symbol,
              peak: (meta.balance?.points ?? []).reduce((a, p) => Math.max(a, Number(p?.total) || 0), 0),
              delta: meta.balance?.delta ?? null
            })
          : null,

          /* 全部区块：顺序由「玩法开关」的拖动排序决定 */
          /* 等级条是固定前缀：不参与区块排序与开关计数 */
        prefs.fLevel && (data?.byDay?.length ?? 0) > 0 ? h(LevelStrip, { byDay, key: 'level-strip' }) : null,
        ...orderedSections,

          /* 脚注 */
          h('div', { style: { marginTop: 14, paddingTop: 10, borderTop: '1px solid ' + C.border2, fontSize: 10, color: C.faint, lineHeight: 1.75 } },
            h('div', null, `数据源：事件流 ${meta.logFiles} 个（${totals.eventSessions} 个会话）· 投影缓存 ${meta.projectionFiles} 个（${totals.projectionSessions} 个）· 跳过 ${meta.skippedCount} 个`),
            h('div', null, `成本口径：${meta.prices.currencyLabel ?? meta.prices.currency}（${meta.prices.symbol} ${meta.prices.unit}）· 价目表截至 ${meta.prices.asOf}${meta.prices.overridden ? '（已被本地覆盖）' : ''} · 高峰 ×${meta.prices.peakMultiplier}`),
            DENSITY === 'detail' ? h('div', null, `高峰时段：${meta.prices.peakLabel || '未配置'}${meta.prices.holidayCount ? ` · 已配置 ${meta.prices.holidayCount} 个节假日` : ' · 节假日表未配置'}`) : null,
            DENSITY === 'detail' ? h('div', { style: { wordBreak: 'break-all' } }, `来源 ${meta.prices.source}`) : null,
            h('div', null, t('成本按官方 API 标价估算，不等于实际账单；未匹配到价格的模型不计入成本。',
              'API 标价估算 ≠ 实际账单')),
            h('div', null, `上下文压缩：${data.compaction.prunes} 次 / 丢弃 ${cn(data.compaction.prunedTokens)} tokens（${data.compaction.sessions} 个会话）`),
            data.subagents?.sessions
              ? h('div', null, `子 agent：${data.subagents.sessions} 个会话 / ${cn(data.subagents.total)} tokens / ${money(data.subagents.cost)}（已计入总量）`)
              : null,
            h('div', null, `聚合耗时 ${data.durationMs}ms · 缓存命中 ${meta.cacheHits} 个文件`),
            meta.skipped?.length
              ? h('details', { style: { marginTop: 4 } },
                  h('summary', { style: { cursor: 'pointer' } }, `跳过的文件（${meta.skippedCount}）`),
                  meta.skipped.map((s, i) => h('div', { key: i }, `${s.file} — ${s.reason}`)))
              : null)),

        /* 拖拽改宽 */
        h('div', {
          title: '拖动调整宽度',
          onMouseDown: startDrag,
          style: { position: 'absolute', left: 2, top: 46, bottom: 6, width: 6, cursor: 'ew-resize', borderRadius: 3 }
        }),

        /* Tooltip：fixed 定位（避免被面板 overflow 裁掉），配色见 .dsh-tip */
        tip
          ? h('div', {
              className: 'dsh-tip',
              'data-dsh-tip': '',
              style: {
                position: 'fixed',
                left: Math.max(8, Math.min(window.innerWidth - 236, tip.x - 110)),
                top: Math.max(8, tip.y - (tip.rows.length * 17 + 34)),
                zIndex: 2147483000,
                width: 216,
                padding: '7px 9px',
                pointerEvents: 'none',
                fontSize: 10.5
              }
            },
            h('div', { style: { fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tip.title),
            tip.rows.map((r, i) => h('div', { key: i, style: { display: 'flex', gap: 8 } },
              h('span', { style: { color: C.faint, flex: '0 0 auto' } }, r[0]),
              h('span', {
                style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
              }, r[1]))))
          : null)
    }

    /* ================================================================ *
     * 外壳：按钮 + 可拖宽的浮层
     * ================================================================ */

    /* 浮动按钮：圆形 + 图标 + 圆环进度（余额剩余量） */

    const FAB_SIZE = 46

    /** 可玩性设置（本地持久化；默认蓝色环、阈值 ¥5、低于阈值变红并呼吸） */
    const PREF_DEFAULTS = {
      ring: true,
      baseColor: '#6f9dff',
      warnColor: '#ef6b6b',
      threshold: 5,
      baseline: 0,          // 0 = 自动（按观察到的最高水位）
      breathing: 'warn',    // off | warn | always
      iconColor: '#e9eaec',
      iconPath: '',          // 由 host 告知，只读展示
      /* 玩法开关：每个功能一个独立开关，关掉就完全不出现（不是灰色禁用） */
      fHeartbeat: true,      // P1 心跳：余额越低呼吸越快
      fDrop: true,           // P2 掉血：余额下降时闪一下差额
      fHistory: true,        // P3 余额水位曲线 + 充值标记
      fTicker: true,         // P7 实时 ticker
      fToolCost: true,       // P12 工具烧钱榜
      fSim: true,            // P10「如果」模拟器
      fDrill: true,          // E 逐轮下钻（点会话看每一轮/每一步）
      fCards: true,          // 顶部 6 张指标卡
      fLevel: true,          // 等级条：Lv / 连续天数 / 今日强度
      fBalance: true,        // 账户余额条
      fHeatmap: true,        // 活跃热力图
      fDaily: true,          // 每日 Token 用量
      fCostTrend: true,      // 每日成本折线
      fModel: true,          // 模型用量（环形 + 排行）
      fTools: true,          // 工具调用 · 按耗时
      fSessions: true,       // 会话排行
      /**
       * 区块顺序：设置页按它排列，面板也按它渲染。
       * 默认顺序刻意等于这些区块原本的物理顺序，所以没动过排序时版面看起来没变。
       */
      featureOrder: ['fTicker', 'fHistory', 'fHeatmap', 'fDaily', 'fCostTrend', 'fSim', 'fModel', 'fToolCost', 'fTools', 'fSessions'],
      /** 形态：concise = 只留数字与标签，去掉解释性长文案 */
      density: 'concise',
      /** 按钮面孔：logo = 原图标；bloub = 机器人表情（隐藏图标与圆环） */
      face: 'logo',
      /** bloub 表情模式：auto = 16 种轮播；否则固定为指定索引 */
      bloubMode: 'play',
      bloubIndex: 0,
      /** 互动模式：鼠标静止多少秒后开始发呆（秒） */
      bloubIdleSec: 25,
      /** 指标卡 DIY：顺序 / 显隐 / 宽（1-3 列）/ 高（1-2 行） */
      cardOrder: ['total', 'sessions', 'topModel', 'cacheSaved', 'peak', 'cost'],
      cardHidden: [],
      /* 默认版式（3 列磁贴）：宽 hero 2×1 + 小方块 1×1 + 全宽大块 3×2 */
      cardSpans: { total: 2, cost: 3 },
      cardRows: { cost: 2 }
    }

    /** 玩法与区块的元数据（顺序由 prefs.featureOrder 决定，这里只描述） */
    const FEATURES = [
      { key: 'fTicker', label: 'P7 实时动态', hint: '面板里滚动显示最近发生的请求与工具调用', short: '滚动显示最近的请求与工具', movable: true },
      { key: 'fHistory', label: 'P3 余额水位曲线', hint: '每分钟记一个点，标出充值事件', short: '每分钟一点，标出充值', movable: true },
      { key: 'fHeatmap', label: '活跃热力图', hint: '最近 26 周每天的活动强度（按分位分档）', short: '26 周活动强度', movable: true },
      { key: 'fDaily', label: '每日 Token 用量', hint: '按模型 / 类别堆叠，可切 7 / 14 / 30 / 全部', short: '按模型 / 类别堆叠', movable: true },
      { key: 'fCostTrend', label: '每日成本折线', hint: '成本独立坐标轴（不与 token 共用）', short: '独立坐标轴', movable: true },
      { key: 'fSim', label: 'P10「如果」模拟器', hint: '拖动条件实时重算成本，纯本地、不改变真实用量', short: '拖条件重算成本', movable: true },
      { key: 'fModel', label: '模型用量', hint: '环形图 + 排行（按 Token / 按成本）', short: '环形图 + 排行', movable: true },
      { key: 'fToolCost', label: 'P12 工具烧钱榜', hint: '把每一步的账归给它申请调用的工具（近似）', short: '按归因排序（近似）', movable: true },
      { key: 'fTools', label: '工具调用 · 按耗时', hint: '每个工具的调用数、耗时与失败率', short: '调用数 / 耗时 / 失败率', movable: true },
      { key: 'fSessions', label: '会话排行', hint: '按消耗排序的会话，可点开逐轮明细', short: '按消耗排序，可下钻', movable: true },
      { key: 'fCards', label: '指标卡（6 张）', hint: '顶部的总量 / 成本 / 命中率等指标卡', short: '总量 / 成本 / 命中率', movable: false },
      { key: 'fBalance', label: '账户余额条', hint: '充值余额与赠送余额', short: '充值 + 赠送', movable: false },
      { key: 'fHeartbeat', label: 'P1 心跳呼吸', hint: '余额越低，环的呼吸越快（满额 1.9s → 见底 0.9s）', short: '余额越低呼吸越快', movable: false },
      { key: 'fDrop', label: 'P2 掉血反馈', hint: '余额下降时在按钮上方显示差额', short: '显示近 1 分钟差额', movable: false },
      { key: 'fDrill', label: 'E 逐轮下钻', hint: '点会话查看每一轮/每一步的 token、耗时与工具（按需解析事件流）', short: '点会话看逐轮明细', movable: false }
    ]
    const FEATURE_KEYS = FEATURES.map((f) => f.key)
    const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f]))
    const DEFAULT_ORDER = PREF_DEFAULTS.featureOrder

    /** 指标卡的元数据（顺序由 prefs.cardOrder 决定） */
    const CARDS = [
      { key: 'total', label: 'Token 总用量' },
      { key: 'sessions', label: '会话 / 请求' },
      { key: 'topModel', label: '最常用模型' },
      { key: 'cost', label: '估算成本' },
      { key: 'cacheSaved', label: '缓存省下的钱' },
      { key: 'peak', label: '高峰时段占比' }
    ]
    const CARD_KEYS = CARDS.map((c) => c.key)
    const CARD_BY_KEY = new Map(CARDS.map((c) => [c.key, c]))

    /** 可拖动排序的键（只有面板区块能改顺序） */
    const MOVABLE_KEYS = FEATURES.filter((f) => f.movable).map((f) => f.key)

    /** 把任意来源的顺序规整成「只含可拖动区块、无重复、不缺项」的合法顺序 */
    function normalizeOrder(order) {
      const seen = new Set()
      const out = []
      for (const k of Array.isArray(order) ? order : []) {
        if (MOVABLE_KEYS.includes(k) && !seen.has(k)) { seen.add(k); out.push(k) }
      }
      for (const k of DEFAULT_ORDER) if (MOVABLE_KEYS.includes(k) && !seen.has(k)) { seen.add(k); out.push(k) }
      for (const k of MOVABLE_KEYS) if (!seen.has(k)) out.push(k)
      return out
    }
    const PREF_KEY = 'dsh-usage-panel:prefs'

    function usePrefs() {
      const [prefs, setPrefsState] = useState(() => {
        let saved = {}
        try { saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') ?? {} } catch { /* ignore */ }
        return { ...PREF_DEFAULTS, ...saved, featureOrder: normalizeOrder(saved?.featureOrder) }
      })
      const setPref = useCallback((patch) => {
        setPrefsState((prev) => {
          const next = { ...prev, ...patch }
          try { localStorage.setItem(PREF_KEY, JSON.stringify(next)) } catch { /* ignore */ }
          return next
        })
      }, [])
      const reset = useCallback(() => {
        setPrefsState({ ...PREF_DEFAULTS })
        try { localStorage.setItem(PREF_KEY, JSON.stringify(PREF_DEFAULTS)) } catch { /* ignore */ }
      }, [])
      return { prefs, setPref, reset }
    }

    /** 余额合计（充值 + 赠送，同币种相加） */
    function balanceTotal(balance) {
      if (!balance || balance.status !== 'ready') return null
      const sum = (list) => (list ?? []).reduce((a, w) => a + (Number(w?.balance) || 0), 0)
      const total = sum(balance.wallets) + sum(balance.bonusWallets)
      const cur = balance.wallets?.[0]?.currency ?? balance.bonusWallets?.[0]?.currency ?? 'CNY'
      return { total, currency: cur, recharge: sum(balance.wallets), bonus: sum(balance.bonusWallets) }
    }

    const symOf = (cur) => (cur === 'USD' ? '$' : '¥')

    /**
     * 圆形浮动按钮。
     * 圆环 = 余额剩余量 / 基准额度；低于阈值换成预警色，可选呼吸。
     * 图标由 /usage-panel/api/icon 提供（host 侧读文件 + 清洗 + 着色），
     * 读不到就退回内置字形，按钮本身绝不因为图标缺失而失效。
     */
    function RingButton({ open, balance, prefs, setPref, icon }) {
      const openRatio = usePanelOpen()
      const b = balanceTotal(balance)
      const hi = useRef(0)

      // 自动基准：记录观察到的最高水位
      useEffect(() => {
        if (b && b.total > hi.current) {
          hi.current = b.total
          try { localStorage.setItem('dsh-usage-panel:hi', String(b.total)) } catch { /* ignore */ }
        } else if (!hi.current) {
          try { hi.current = Number(localStorage.getItem('dsh-usage-panel:hi')) || 0 } catch { /* ignore */ }
        }
      }, [b?.total])

      const baseline = prefs.baseline > 0 ? prefs.baseline : (hi.current || 0)
      const ratio = b && baseline > 0 ? Math.max(0, Math.min(1, b.total / baseline)) : (b ? 1 : 0)
      const below = b ? b.total <= prefs.threshold : false
      const color = !b ? 'rgba(255,255,255,.25)' : below ? prefs.warnColor : prefs.baseColor
      const breathe = prefs.breathing === 'always' || (prefs.breathing === 'warn' && below)
      // P1 心跳：余额越低呼吸越快（满额 1.9s → 见底 0.9s）
      const heartSec = prefs.fHeartbeat ? (0.9 + ratio * 1.0).toFixed(2) : null

      /*
       * P2 掉血：余额相比「上一个记录点（约 1 分钟前）」下降时显示差额。
       * 刻意不用定时消失 —— 那会变成「闪一下就没」的装饰；持续显示「近 1 分钟花了多少」
       * 更有用，而且余额回升（充值）时它会自然消失。
       */
      const drop = Number(balance?.delta ?? 0)
      const showDrop = prefs.fDrop && drop < 0

      const R = FAB_SIZE / 2 - 2.5
      const CIRC = 2 * Math.PI * R
      // v 参数让「图标路径解析结果」变化时重新取图（首次渲染时 meta 还没到）
      const iconV = icon?.available ? `${icon.bytes ?? 0}-${(icon.path ?? '').length}` : 'init'
      const iconUrl = `/usage-panel/api/icon?color=${encodeURIComponent(prefs.iconColor)}&v=${iconV}`

      const title = b
        ? `用量趋势 · 余额 ${symOf(b.currency)}${b.total.toFixed(2)}` +
          `（充值 ${symOf(b.currency)}${b.recharge.toFixed(2)} + 赠送 ${symOf(b.currency)}${b.bonus.toFixed(2)}）` +
          `\n基准 ${prefs.baseline > 0 ? symOf(b.currency) + prefs.baseline.toFixed(2) : '自动 ' + symOf(b.currency) + baseline.toFixed(2)}` +
          ` · 阈值 ${symOf(b.currency)}${prefs.threshold.toFixed(2)}` +
          (below ? '（已低于阈值）' : '') +
          '\n点击开合面板，⚙ 可改样式'
        : balance?.status === 'unavailable' || balance?.status === 'none'
          ? '用量趋势 · 未取得余额（点开面板看原因）'
          : '用量趋势'

      return h(React.Fragment, null,
        showDrop
          ? h('div', {
              /* key 随金额变化 → React 重建节点 → 动画从头播放（新一轮掉血会重新"长出来"） */
              key: 'drop-' + drop.toFixed(4),
              'data-drop': '',
              style: {
                position: 'fixed', right: '14px', bottom: '72px', zIndex: 62,
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px 4px 8px', borderRadius: 999,
                background: 'rgba(22,24,28,.95)',
                border: '1px solid rgba(255,255,255,.10)',
                boxShadow: '0 6px 18px rgba(0,0,0,.45)',
                color: '#f3f4f6', fontSize: 12, fontWeight: 600,
                fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
                pointerEvents: 'none', fontFamily: 'inherit',
                animation: 'dsh-drop-life 6s cubic-bezier(.22,.61,.36,1) forwards'
              },
              title: '相比上一个记录点（约 1 分钟前）的余额变化 · 6 秒后自动收起'
            },
              h('span', { style: { color: '#ff8f8f', fontSize: 11, lineHeight: 1, fontWeight: 700 } }, '↓'),
              h('span', { style: { color: '#ffb0b0' } }, symOf(b?.currency ?? 'CNY') + Math.abs(drop).toFixed(2))
            )
          : null,
        h('button', {
        type: 'button',
        'data-dsh-usage-toggle': '',
        'data-face': prefs.face === 'bloub' ? 'bloub' : 'logo',
        /* 双保险：即使指针事件落在装饰画布上，也把它交回按钮处理 */
        onPointerDownCapture: (e) => {
          if (!e.currentTarget.contains(e.target)) return
        },
        'data-ring': prefs.ring ? '1' : '0',
        'data-heartbeat': heartSec ?? 'off',
        'aria-pressed': openRatio,
        title,
        onClick: () => setOpen(!openRatio),
        className: 'dsh-fab',
        style: {
          position: 'fixed', right: '14px', bottom: '18px',
          background: openRatio ? 'rgba(111,157,255,.22)' : 'rgba(32,34,38,.96)',
          // clip-path 会裁掉 box-shadow，所以用 drop-shadow（在裁剪之后应用，跟随轮廓）
          filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.42))',
          cursor: 'pointer',
          zIndex: 61,
          fontFamily: 'inherit'
        }
      },
        prefs.ring
          ? h('svg', {
              width: FAB_SIZE, height: FAB_SIZE,
              viewBox: `0 0 ${FAB_SIZE} ${FAB_SIZE}`,
              'data-dsh-ring': '',
              'data-ring-below': below ? '1' : '0',
              style: { position: 'absolute', pointerEvents: 'none' }
            },
            h('circle', {
              cx: FAB_SIZE / 2, cy: FAB_SIZE / 2, r: R, fill: 'none',
              stroke: 'rgba(255,255,255,.16)', strokeWidth: 3
            }),
            h('circle', {
              cx: FAB_SIZE / 2, cy: FAB_SIZE / 2, r: R, fill: 'none',
              stroke: color, strokeWidth: 3, strokeLinecap: 'round', 'data-dsh-ring-fg': '',
              className: breathe ? 'dsh-breathe' : '',
              strokeDasharray: CIRC.toFixed(2),
              strokeDashoffset: (CIRC * (1 - ratio)).toFixed(2),
              transform: `rotate(-90 ${FAB_SIZE / 2} ${FAB_SIZE / 2})`,
              style: {
                '--cur': (CIRC * (1 - ratio)).toFixed(2),
                '--full': CIRC.toFixed(2),
                '--neg': (-CIRC).toFixed(2),
                transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1), stroke .3s linear',
                ...(heartSec ? { animationDuration: heartSec + 's' } : {})
              }
            }))
          : null,
        b
          ? h('span', {
              'data-dsh-fab-pct': '',
              style: {
                position: 'relative', fontSize: 12.5, fontWeight: 650, color,
                fontVariantNumeric: 'tabular-nums', display: 'none', letterSpacing: '-0.02em'
              }
            }, Math.round(ratio * 100) + '%')
          : null,
        h('img', {
          src: iconUrl,
          alt: '',
          'data-dsh-icon': '',
          onError: (e) => { e.currentTarget.style.display = 'none' },
          style: {
            width: 28, height: 28, objectFit: 'contain', position: 'relative',
            transform: 'scale(1.08)'
          }
        }),
        h('span', {
          'data-dsh-bloub': '',
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'none', pointerEvents: 'none' }
        }),
        h('span', {
          'data-dsh-fab-fallback': '',
          style: {
            position: 'absolute', fontSize: 10, color: '#e8e8ea', opacity: 0,
            pointerEvents: 'none'
          }
        }, '用量')))
    }

    /** 指标卡 DIY：拖动定顺序、开关定显隐、分段器定宽（列）与高（行） */
    /** 磁贴网格的行高单位（px）：所有卡片高度都必须是它的整数倍，边缘才严格对齐 */
    const CARD_ROW_H = 76

    const WIDTH_OPTS = [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]
    const HEIGHT_OPTS = [{ value: '1', label: '1' }, { value: '2', label: '2' }]

    function CardOrderList({ prefs, setPref }) {
      const order = PURE.normalizeOrder(prefs.cardOrder, CARD_KEYS)
      const hidden = Array.isArray(prefs.cardHidden) ? prefs.cardHidden : []
      const hiddenSet = new Set(hidden)
      const [dragKey, setDragKey] = useState(null)
      const live = useRef({ from: 0, to: 0 })

      const move = (from, to) => {
        if (to < 0 || to >= order.length || from === to) return
        const next = order.slice()
        const [k] = next.splice(from, 1)
        next.splice(to, 0, k)
        setPref({ cardOrder: next })
      }
      const startDrag = (e, key, i) => {
        if (e.button !== undefined && e.button !== 0) return
        e.preventDefault()
        const startY = e.clientY
        const rowH = Math.max(24, e.currentTarget.closest('[data-card-row]')?.getBoundingClientRect().height ?? 44)
        live.current = { from: i, to: i }
        setDragKey(key)
        const onMove = (ev) => {
          live.current.to = Math.max(0, Math.min(order.length - 1, i + Math.round((ev.clientY - startY) / rowH)))
        }
        const onUp = () => {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.removeEventListener('pointercancel', onUp)
          setDragKey(null)
          if (live.current.to !== live.current.from) move(live.current.from, live.current.to)
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
      }

      return h('div', { 'data-card-list': '' },
        order.map((key, i) => {
          const c = CARD_BY_KEY.get(key)
          if (!c) return null
          const on = !hiddenSet.has(key)
          return h('div', {
            key,
            'data-card-row': key,
            'data-card-index': i,
            style: {
              display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0',
              borderBottom: '1px solid ' + C.border2, opacity: dragKey === key ? 0.45 : on ? 1 : 0.55
            }
          },
            h('span', {
              'data-card-handle': '', role: 'button', tabIndex: 0, title: '拖动排序（或聚焦后 ↑/↓）',
              onPointerDown: (e) => startDrag(e, key, i),
              onKeyDown: (e) => {
                if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1) }
                else if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1) }
              },
              style: { cursor: 'grab', color: C.faint, fontSize: 13, userSelect: 'none', padding: '0 3px', flex: '0 0 auto' }
            }, '⠿'),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 11.5 } }, c.label),
              h('div', { style: { display: 'flex', gap: 5, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { style: { fontSize: 10, color: C.faint } }, '宽'),
                h(Segmented, {
                  value: String(PURE.clampInt(prefs.cardSpans?.[key] ?? 1, 1, 3, 1)),
                  onChange: (v) => setPref({ cardSpans: { ...(prefs.cardSpans ?? {}), [key]: Number(v) } }),
                  options: WIDTH_OPTS
                }),
                h('span', { style: { fontSize: 10, color: C.faint, marginLeft: 4 } }, '高'),
                h(Segmented, {
                  value: String(PURE.clampInt(prefs.cardRows?.[key] ?? 1, 1, 2, 1)),
                  onChange: (v) => setPref({ cardRows: { ...(prefs.cardRows ?? {}), [key]: Number(v) } }),
                  options: HEIGHT_OPTS
                }))),
            h('input', {
              type: 'checkbox',
              'data-card-toggle': key,
              checked: on,
              onChange: (e) => setPref({
                cardHidden: e.target.checked ? hidden.filter((k) => k !== key) : [...hidden, key]
              })
            }))
        }))
    }

    /* ---------------------------------------------------------------- *
     * 玩法排序：按住 ⠿ 拖动，或用键盘 ↑/↓
     * 用 pointer 事件而不是 HTML5 DnD：手感更稳，也能被自动化验证。
     * ---------------------------------------------------------------- */

    function FeatureOrderList({ order, prefs, setPref, onChange }) {
      const list = normalizeOrder(order)
      const [dragKey, setDragKey] = useState(null)
      const [dropAt, setDropAt] = useState(null)
      const live = useRef({ from: 0, to: 0 })

      const move = (from, to) => {
        if (to < 0 || to >= list.length || from === to) return
        const next = list.slice()
        const [k] = next.splice(from, 1)
        next.splice(to, 0, k)
        onChange(next)
      }

      const startDrag = (e, key, idx) => {
        if (e.button !== undefined && e.button !== 0) return
        e.preventDefault()
        const startY = e.clientY
        const rowH = Math.max(24, e.currentTarget.closest('[data-feature-row]')?.getBoundingClientRect().height ?? 40)
        live.current = { from: idx, to: idx }
        setDragKey(key)
        setDropAt(idx)
        const onMove = (ev) => {
          const to = Math.max(0, Math.min(list.length - 1, idx + Math.round((ev.clientY - startY) / rowH)))
          live.current.to = to
          setDropAt(to)
        }
        const onUp = () => {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.removeEventListener('pointercancel', onUp)
          setDragKey(null)
          setDropAt(null)
          if (live.current.to !== live.current.from) move(live.current.from, live.current.to)
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
      }

      return h('div', { 'data-feature-list': '' },
        list.map((key, i) => {
          const f = FEATURE_BY_KEY.get(key)
          if (!f) return null
          const dragging = dragKey === key
          const isDropTarget = dragKey && !dragging && dropAt === i
          return h('div', {
            key,
            'data-feature-row': key,
            'data-feature-index': i,
            style: {
              display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0',
              borderBottom: '1px solid ' + C.border2,
              borderTop: isDropTarget ? '2px solid ' + C.accent : '2px solid transparent',
              opacity: dragging ? 0.45 : 1,
              background: dragging ? 'rgba(111,157,255,.08)' : 'transparent'
            }
          },
            h('span', {
              'data-feature-handle': '',
              role: 'button',
              tabIndex: 0,
              title: '拖动排序（或聚焦后用 ↑/↓）',
              onPointerDown: (e) => startDrag(e, key, i),
              onKeyDown: (e) => {
                if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1) }
                else if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1) }
              },
              style: {
                cursor: dragging ? 'grabbing' : 'grab', color: C.faint, fontSize: 13,
                userSelect: 'none', padding: '0 3px', flex: '0 0 auto', lineHeight: 1
              }
            }, '⠿'),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'baseline' } },
                f.label,
                f.movable
                  ? h('span', { style: { fontSize: 9.5, color: C.accent, border: '1px solid ' + C.border, borderRadius: 4, padding: '0 4px' } }, '面板区块')
                  : h('span', { style: { fontSize: 9.5, color: C.faint } }, '非区块')),
              h('div', { style: { fontSize: 10.5, color: C.faint, marginTop: 2, lineHeight: 1.5 } }, t(f.hint, f.short))),
            h('input', {
              type: 'checkbox',
              'data-pref-toggle': key,
              checked: !!prefs[key],
              onChange: (e) => setPref({ [key]: e.target.checked })
            }))
        }))
    }

    /* ---------------------------------------------------------------- *
     * 设置视图（弹窗右上角 ⚙ 进入）
     * ---------------------------------------------------------------- */

    const SWATCHES = ['#6f9dff', '#4cc38a', '#e5a13a', '#ef6b6b', '#8f7bff', '#38bdc9', '#e9eaec', '#111318']

    function Swatches({ value, onChange }) {
      return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        SWATCHES.map((c) => h('button', {
          key: c, type: 'button', onClick: () => onChange(c), title: c,
          style: {
            width: 20, height: 20, borderRadius: 5, cursor: 'pointer',
            background: c,
            border: value.toLowerCase() === c.toLowerCase() ? '2px solid #fff' : '1px solid ' + C.border
          }
        })),
        h('input', {
          type: 'text', value, onChange: (e) => onChange(e.target.value), spellCheck: false,
          style: {
            width: 84, background: 'transparent', border: '1px solid ' + C.border, borderRadius: 6,
            color: C.dim, fontSize: 10.5, padding: '3px 6px', fontFamily: 'inherit'
          }
        }))
    }

    function Row({ label, hint, children }) {
      return h('div', { style: { padding: '9px 0', borderBottom: '1px solid ' + C.border2 } },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 11.5 } }, label),
            hint ? h('div', { style: { fontSize: 10.5, color: C.faint, marginTop: 2, lineHeight: 1.5 } }, hint) : null),
          h('div', { style: { flex: '0 0 auto' } }, children)))
    }

    function NumInput({ value, onChange, step = 1, width = 80, placeholder, name }) {
      return h('input', {
        type: 'number', min: 0, step, value, placeholder,
        'data-pref': name ?? '',
        onChange: (e) => onChange(Number(e.target.value) || 0),
        style: {
          width, background: 'transparent', border: '1px solid ' + C.border, borderRadius: 6,
          color: C.text, fontSize: 11, padding: '3px 6px', fontFamily: 'inherit'
        }
      })
    }

    function SettingsView({ prefs, setPref, reset, usage, onBack }) {
      DENSITY = prefs.density === 'detail' ? 'detail' : 'concise'
      const balance = usage?.data?.meta?.balance
      const b = balanceTotal(balance)
      const icon = usage?.data?.meta?.icon
      const sym = b ? symOf(b.currency) : '¥'
      return h('div', null,
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px',
            borderBottom: '1px solid ' + C.border, position: 'sticky', top: 0,
            background: C.cardSolid, zIndex: 2
          }
        },
          h('button', { type: 'button', onClick: onBack, style: btnStyle, title: '返回' }, '‹'),
          h('span', { style: { fontSize: 13.5, fontWeight: 650 } }, '设置 · 按钮与进度环'),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', onClick: reset, style: btnStyle }, '恢复默认')),

        h('div', { style: { padding: '6px 13px 16px' } },
          h('div', { style: { fontSize: 10.5, color: C.faint, margin: '8px 0 2px', lineHeight: 1.6 } },
            t('这些设置只影响右下角的浮动按钮，存在浏览器本地（localStorage）。', '设置存在浏览器本地')),

          h(SectionTitle, {
            right: h('span', { style: { fontSize: 10, color: C.faint } }, '按住 ⠿ 拖动排序')
          }, '玩法开关'),
          h('div', { style: { fontSize: 10.5, color: C.faint, marginBottom: 2, lineHeight: 1.6 } },
            t('顺序同时决定面板里这些区块的先后（带 ⠿ 的可拖动；P1/P2/E 只影响按钮与下钻视图）。', '顺序同时决定面板区块顺序')),
          h(FeatureOrderList, {
            order: prefs.featureOrder,
            prefs,
            setPref,
            onChange: (next) => setPref({ featureOrder: normalizeOrder(next) })
          }),

          h('div', { style: { fontSize: 10.5, color: C.faint, margin: '10px 0 2px' } }, '固定位置（不影响排序）'),
          FEATURES.filter((f) => !f.movable).map((f) => h('div', {
            key: f.key,
            'data-feature-fixed': f.key,
            style: { display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + C.border2 }
          },
            h('span', { style: { width: 19, flex: '0 0 auto' } }),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 11.5 } }, f.label),
              h('div', { style: { fontSize: 10.5, color: C.faint, marginTop: 2, lineHeight: 1.5 } }, t(f.hint, f.short))),
            h('input', {
              type: 'checkbox', 'data-pref-toggle': f.key,
              checked: !!prefs[f.key], onChange: (e) => setPref({ [f.key]: e.target.checked })
            }))),

          h(SectionTitle, {
            right: h('span', { style: { fontSize: 10, color: C.faint } }, t('拖动排序 · 可设宽高', '拖动排序'))
          }, '指标卡 DIY'),
          onlyDetail(h('div', { style: { fontSize: 10.5, color: C.faint, marginBottom: 2, lineHeight: 1.6 } },
            '宽按三列网格算（1-3 列），高 1-2 行；关掉即整张卡消失。')),
          h(CardOrderList, { prefs, setPref }),

          h(SectionTitle, { right: h(Segmented, {
            value: prefs.density, onChange: (v) => setPref({ density: v }),
            options: [{ value: 'concise', label: '简洁' }, { value: 'detail', label: '详细' }]
          }) }, '显示形态'),
          h('div', { style: { fontSize: 10.5, color: C.faint, lineHeight: 1.6 } },
            t('详细：每个组件都带一句解释。简洁：只留标签与数字（推荐，面板空间有限）。',
              '简洁：只留标签与数字；切到详细会补上每个组件的解释。')),

          h(SectionTitle, null, '圆形进度环'),
          h(Row, {
            label: '显示进度环',
            hint: t('环 = 余额剩余量 / 基准额度', '环 = 余额 / 基准')
          }, h('input', {
            type: 'checkbox', checked: prefs.ring,
            onChange: (e) => setPref({ ring: e.target.checked })
          })),
          h(Row, {
            label: '基准额度',
            hint: prefs.baseline > 0
              ? `环满格 = ${sym}${prefs.baseline.toFixed(2)}`
              : `0 = 自动：按观察到的最高水位（当前 ${b ? sym + b.total.toFixed(2) : '—'}）`
          }, h(NumInput, {
            value: prefs.baseline, step: 10, placeholder: '自动', name: 'baseline',
            onChange: (v) => setPref({ baseline: v })
          })),
          h(Row, { label: '正常颜色', hint: t('余额充足时', '') },
            h(Swatches, { value: prefs.baseColor, onChange: (c) => setPref({ baseColor: c }) })),
          h(Row, {
            label: '预警阈值',
            hint: t(`余额 ≤ ${sym}${prefs.threshold.toFixed(2)} 时切换预警色`, '低于此值变预警色')
          }, h(NumInput, { value: prefs.threshold, step: 1, name: 'threshold', onChange: (v) => setPref({ threshold: v }) })),
          h(Row, { label: '预警颜色', hint: '低于阈值时' },
            h(Swatches, { value: prefs.warnColor, onChange: (c) => setPref({ warnColor: c }) })),
          h(Row, {
            label: '呼吸动画',
            hint: t('低额时脉冲提示；也可常亮呼吸', '低额脉冲')
          }, h(Segmented, {
            value: prefs.breathing,
            onChange: (v) => setPref({ breathing: v }),
            options: [{ value: 'off', label: '关' }, { value: 'warn', label: '仅预警' }, { value: 'always', label: '始终' }]
          })),

          h(SectionTitle, null, '图标'),
          h(Row, {
            label: '按钮面孔',
            hint: t('静态 logo，或 bloub 机器人：16 种表情按状态实时平滑切换，会隐藏图标与圆环', 'logo / bloub 机器人')
          }, h(Segmented, {
            value: prefs.face === 'bloub' ? 'bloub' : 'logo',
            onChange: (v) => setPref({ face: v }),
            options: [{ value: 'logo', label: '静态 logo' }, { value: 'bloub', label: 'bloub 机器人' }]
          })),
          prefs.face === 'bloub'
            ? h(Row, {
                label: '表情模式',
                hint: t('按状态 = 按真实情况选（余额告急→惊恐、掉血→悲伤、充值→大笑、刷新→专注、悬浮→好奇、闲置→困倦…）', '按状态 / 自动 / 固定')
              }, h(Segmented, {
                value: ['play', 'state', 'auto', 'fixed'].indexOf(prefs.bloubMode) >= 0 ? prefs.bloubMode : 'play',
                onChange: (v) => setPref({ bloubMode: v }),
                options: [{ value: 'play', label: '互动' }, { value: 'state', label: '按状态' }, { value: 'auto', label: '自动' }, { value: 'fixed', label: '固定' }]
              }))
            : null,
          h(Row, {
            label: '按钮位置',
            hint: t('按住按钮即可拖到任意位置（自动吸附在视口内）；双击按钮复位', '可拖动；双击复位')
          }, h('button', {
            type: 'button',
            style: btnStyle,
            onClick: () => {
              try { localStorage.removeItem('dsh-usage-panel:fabpos') } catch { /* ignore */ }
              try {
                const fab = document.querySelector('.dsh-fab')
                if (fab) fab.style.transform = ''
                const panel = document.querySelector('[data-dsh-usage-panel]')
                if (panel) panel.style.transform = ''
              } catch { /* ignore */ }
            }
          }, '复位按钮位置')),
          h(Row, { label: '图标颜色', hint: t('图标是多色 SVG，这里统一着色以适配深色按钮', '统一着色以适配深色按钮') },
            h(Swatches, { value: prefs.iconColor, onChange: (c) => setPref({ iconColor: c }) })),

          h('div', { style: { marginTop: 12, fontSize: 10.5, color: C.faint, lineHeight: 1.7 } },
            h('div', null, `当前：充值 ${b ? sym + b.recharge.toFixed(2) : '—'} + 赠送 ${b ? sym + b.bonus.toFixed(2) : '—'} = ${b ? sym + b.total.toFixed(2) : '—'}`),
            h('div', null, balance?.status === 'ready' ? '' : `余额状态：${balance?.status ?? '未知'}`),
            h('div', null, '')))
      )
    }

    const S = {
      panel: (width) => ({
        position: 'fixed', right: '14px', bottom: '58px',
        /* 先隐藏：等 placePanel() 摆好位置再显示，避免先在右下角闪一下再跳到按钮旁 */
        visibility: 'hidden',
        width: width + 'px', maxWidth: 'calc(100vw - 28px)', maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto', zIndex: 60,
        border: '1px solid ' + C.border, borderRadius: '12px',
        background: 'rgba(26,28,32,.98)', color: C.text,
        boxShadow: '0 16px 48px rgba(0,0,0,.5)', fontSize: '12px', fontFamily: 'inherit'
      })
    }

    /** 宽度与视图状态放外壳；点击外部收起 */
    function PanelShell({ usage, prefs, setPref, reset }) {
      const [width, setWidth] = useState(() => {
        let w = DEFAULT_W
        try { w = Number(localStorage.getItem(LS.width)) || DEFAULT_W } catch { /* ignore */ }
        return Math.max(MIN_W, Math.min(MAX_W, w))
      })
      const [view, setView] = useState('main')
      const [drill, setDrill] = useState(null)   // { id, title }

      useEffect(() => {
        const onDown = (e) => {
          const panel = panelHost?.querySelector('[data-dsh-usage-panel]')
          const toggle = panelHost?.querySelector('[data-dsh-usage-toggle]')
          if (panel && panel.contains(e.target)) return
          if (toggle && toggle.contains(e.target)) return
          setOpen(false)
        }
        document.addEventListener('mousedown', onDown, true)
        return () => document.removeEventListener('mousedown', onDown, true)
      }, [])

      return h('div', { 'data-dsh-usage-panel': '', 'data-edit': '0', style: S.panel(width) },
        drill
          ? h(DrillView, {
              id: drill.id, title: drill.title,
              onBack: () => setDrill(null),
              prices: usage.data?.meta?.prices
            })
          : view === 'settings'
            ? h(SettingsView, { prefs, setPref, reset, usage, onBack: () => setView('main') })
            : h(Panel, {
                onClose: () => setOpen(false), width, setWidth, usage, prefs, setPref,
                onOpenSettings: () => setView('settings'),
                onOpenDrill: (id, title) => setDrill({ id, title })
              }))
    }

    function Root() {
      const open = usePanelOpen()
      const usage = useUsage()
      const { prefs, setPref, reset } = usePrefs()
      const { load } = usage

      // 首次加载 + 轮询（面板打开时 30s，收起时 60s —— 圆形进度环也要保持新鲜）
      useEffect(() => { load(false) }, [load])
      useEffect(() => {
        const id = setInterval(() => load(false), open ? 30000 : 60000)
        return () => clearInterval(id)
      }, [load, open])

      const balance = usage.data?.meta?.balance
      const icon = usage.data?.meta?.icon
      return h(React.Fragment, null,
        h(RingButton, { open, balance, prefs, setPref, icon }),
        open ? h(PanelShell, { usage, prefs, setPref, reset }) : null)
    }

    /* ================================================================ *
     * Cordis 客户端插件入口
     * ================================================================ */

    const inject = ['slots']

    function apply(ctx) {
      console.log(`[dsh-usage-panel] client 侧已加载（v${VERSION}）`)
      injectStyle()

      ctx.effect(() => {
        panelHost = document.createElement('div')
        panelHost.setAttribute('data-dsh-usage-panel-host', '')
        document.body.appendChild(panelHost)

        const ReactDOMClient = require('react-dom/client')
        reactRoot = ReactDOMClient.createRoot(panelHost)
        reactRoot.render(h(Root))

        console.log('[dsh-usage-panel] 已挂载浮动入口')

      /*
       * 浮动按钮可拖动。
       * 关键取舍：按钮的 right/bottom 由 React 管理（余额刷新就会重渲染），
       * 所以位移一律走 transform —— React 不会碰它，也就不会被重渲染擦掉。
       * 位置存的是「相对右下角的偏移」(x ≤ 0, y ≤ 0)，天然便于夹取在视口内。
       */
      try {
        const FAB_POS_KEY = 'dsh-usage-panel:fabpos'
        const readPos = () => { try { return JSON.parse(localStorage.getItem(FAB_POS_KEY) || 'null') } catch { return null } }
        /* 拖动期间必须停掉 paint()/placePanel()：否则 450ms 轮询会把位移擦回旧值（频闪）、
           并让面板在上下之间反复翻转 */
        let fabDragging = false
        let lastSide = null   // 面板当前停在哪一侧（用于迟滞，避免临界点来回跳）
        const clampPos = (p, fab) => {
          const r = fab.getBoundingClientRect()
          const size = r.width || 46
          const maxLeft = -(window.innerWidth - size - 28)
          const maxUp = -(window.innerHeight - size - 40)
          return { x: Math.max(maxLeft, Math.min(0, Math.round(p.x))), y: Math.max(maxUp, Math.min(0, Math.round(p.y))) }
        }
        /*
         * 面板定位：不再用 transform 平移，而是按「按钮位置 + 视口」算 left/top。
         * 规则：优先放按钮正上方并右对齐；上方空间不够就翻到下方；最后整体夹进视口，
         * 保证四边都在屏幕内（这正是「拖到某处后弹窗被挡一部分」的原因）。
         */
        const placePanel = () => {
          try { document.documentElement.setAttribute('data-dsh-drag', fabDragging ? '1' : '0') } catch { /* ignore */ }
          if (fabDragging) return
          const panel = document.querySelector('[data-dsh-usage-panel]')
          if (!panel) return
          /* 三边 10px；顶边要为自绘标题栏（应用/编辑 菜单 + 窗口按钮）让位 */
          const M = 10
          const M_TOP = 44
          const GAP = 10
          const vw = window.innerWidth
          const vh = document.documentElement.clientHeight || window.innerHeight
          if (panel.style.right !== 'auto' || panel.style.bottom !== 'auto') {
            panel.style.right = 'auto'
            panel.style.bottom = 'auto'
          }
          /*
           * 关键：不要为了量高度去清空 maxHeight——那会让元素高度跳变、滚动位置被重置回顶部
           * （「滚一下就弹回顶部」就是这个原因）。用 scrollHeight 取内容高度即可。
           */
          const pr = panel.getBoundingClientRect()
          const pw = Math.min(pr.width || 420, vw - M * 2)
          const contentH = Math.max(panel.scrollHeight || 0, pr.height || 0)
          const fab = document.querySelector('.dsh-fab')
          let left
          let top
          let ph = Math.min(contentH || 400, vh - M_TOP - M)
          if (fab) {
            const fr = fab.getBoundingClientRect()
            left = fr.right - pw
            const roomAbove = fr.top - GAP - M_TOP    // 按钮上方的可用高度（扣掉标题栏）
            const roomBelow = vh - fr.bottom - GAP - M // 按钮下方的可用高度
            /*
             * 选空间更宽裕的一侧，但要**迟滞**：只有另一侧明显更宽裕（多出 140px）才换边，
             * 否则在临界点会来回翻转（用户看到的就是面板上下跳）。
             */
            const HYST = 140
            let useBelow
            if (lastSide === 'below') useBelow = roomBelow + HYST > roomAbove
            else if (lastSide === 'above') useBelow = roomBelow > roomAbove + HYST
            else useBelow = roomBelow > roomAbove
            lastSide = useBelow ? 'below' : 'above'
            if (useBelow) {
              ph = Math.min(ph, roomBelow)
              top = fr.bottom + GAP
            } else {
              ph = Math.min(ph, roomAbove)
              top = fr.top - ph - GAP
            }
          } else {
            left = vw - M - pw
            top = M
          }
          left = Math.max(M, Math.min(vw - M - pw, left))
          top = Math.max(M_TOP, Math.min(vh - M - ph, top))
          const nx = Math.round(left) + 'px'
          const ny = Math.round(top) + 'px'
          if (panel.style.left !== nx) panel.style.left = nx
          if (panel.style.top !== ny) panel.style.top = ny
          const nh = Math.round(Math.max(160, ph)) + 'px'
          if (panel.style.maxHeight !== nh) panel.style.maxHeight = nh
          if (panel.style.visibility !== 'visible') panel.style.visibility = 'visible'
          try {
            document.documentElement.setAttribute('data-dsh-placed', '1')
            document.documentElement.setAttribute('data-dsh-placed-vis', panel.style.visibility || '')
            document.documentElement.setAttribute('data-dsh-placed-lt', (panel.style.left || '') + ',' + (panel.style.top || ''))
          } catch { /* ignore */ }
          if (panel.style.transform) panel.style.transform = ''
          /* 保底：万一浏览器因重排重置了滚动位置，这里不主动干预（交给用户），
             但记下最近一次位置，避免我们自己的重排把它打回 0 */
        }

        /* 把掉血/充值气泡摆到按钮正上方（跟随按钮位置；含拖动中） */
        const placeDrop = () => {
          const drop = document.querySelector('[data-drop]')
          const fab = document.querySelector('.dsh-fab')
          if (!drop || !fab) return
          const fr = fab.getBoundingClientRect()
          const dr = drop.getBoundingClientRect()
          const left = Math.round(Math.max(8, Math.min(window.innerWidth - 8 - (dr.width || 60), fr.left + fr.width / 2 - (dr.width || 60) / 2)))
          const top = Math.round(Math.max(48, fr.top - (dr.height || 22) - 8))
          const nl = left + 'px'
          const nt = top + 'px'
          if (drop.style.right !== 'auto') drop.style.right = 'auto'
          if (drop.style.bottom !== 'auto') drop.style.bottom = 'auto'
          if (drop.style.left !== nl) drop.style.left = nl
          if (drop.style.top !== nt) drop.style.top = nt
        }

        const paint = () => {
          const fab = document.querySelector('.dsh-fab')
          if (!fab) return
          if (fabDragging) return
          let p = readPos()
          /*
           * 视口变化后必须重新夹取：位置存的是「相对右下角的偏移」，
           * 窗口变小后同一个偏移会把按钮推出屏幕外 —— 表现就是「窗口没最大化时按钮不见了」。
           */
          if (p) {
            /*
             * 位置语义 = 「在可移动范围里的比例」。窗口尺寸变了就按新范围重新换算，
             * 这样你在小窗口里把按钮放在中间，最大化后它还在中间（不会永远钉在同一个像素上）。
             */
            const size = fab.getBoundingClientRect().width || 46
            const maxL = window.innerWidth - size - 28
            const maxU = window.innerHeight - size - 40
            let nx = p.x
            let ny = p.y
            /*
             * 只在「真正的尺寸变化」时按比例换算：滚动条出现/消失会让 innerWidth 抖动 10~17px，
             * 若也算作 resize，就会每 150ms 重算一次并漂移（表现：拖动后位置一直变 / 频闪）。
             */
            const BIG = 24
            if (typeof p.vw === 'number' && typeof p.vh === 'number' &&
                (Math.abs(p.vw - window.innerWidth) >= BIG || Math.abs(p.vh - window.innerHeight) >= BIG)) {
              const oldL = Math.max(1, p.vw - size - 28)
              const oldU = Math.max(1, p.vh - size - 40)
              const fx = Math.min(1, Math.max(0, -p.x / oldL))
              const fy = Math.min(1, Math.max(0, -p.y / oldU))
              nx = -Math.round(fx * maxL)
              ny = -Math.round(fy * maxU)
            }
            /* 夹取只影响「显示」，绝不回写存储 —— 回写会和轮询形成反馈回路，导致位置自己漂移 */
            p = { x: Math.max(-maxL, Math.min(0, Math.round(nx))), y: Math.max(-maxU, Math.min(0, Math.round(ny))) }
          }
          const t = p ? 'translate(' + p.x + 'px, ' + p.y + 'px)' : ''
          if (fab.style.transform !== t) fab.style.transform = t
          /* 掉血/充值气泡：用 left/top 直接贴到按钮上方。
             注意不能用 transform——它自带 dsh-fade 入场动画，CSS 动画会覆盖内联 transform。 */
          placeDrop()
          /* 面板不再跟 transform 走：位移会把面板推出视口（部分被裁）。
             改由 placePanel() 按「按钮位置 + 视口」重新摆放。 */
          placePanel()
        }
        const installFabDrag = () => {
          const fab = document.querySelector('.dsh-fab')
          if (!fab || fab.__dshFabDrag) return
          fab.__dshFabDrag = true
          let dragging = false
          let moved = false
          let sx = 0, sy = 0, bx = 0, by = 0
          fab.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return
            const cur = readPos() || { x: 0, y: 0 }
            dragging = true; moved = false
            sx = e.clientX; sy = e.clientY; bx = cur.x; by = cur.y
            try { fab.setPointerCapture(e.pointerId) } catch { /* ignore */ }
          })
          fab.addEventListener('pointermove', (e) => {
            if (!dragging) return
            const dx = e.clientX - sx
            const dy = e.clientY - sy
            if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return   // 小于 4px 视为点击
            moved = true
            fabDragging = true
            const p = clampPos({ x: bx + dx, y: by + dy }, fab)
            fab.style.transform = 'translate(' + p.x + 'px, ' + p.y + 'px)'
            placeDrop()
            placePanel()
          })
          const endDrag = (e) => {
            if (!dragging) return
            dragging = false
            fabDragging = false
            try { fab.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
            fabDragging = false
            if (!moved) return                                       // 没位移 = 普通点击，交给 React
            const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(fab.style.transform || '')
            const p = m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 }
            try { localStorage.setItem(FAB_POS_KEY, JSON.stringify({ x: p.x, y: p.y, vw: window.innerWidth, vh: window.innerHeight })) } catch { /* ignore */ }
            fab.__dshDraggedAt = Date.now()
          }
          fab.addEventListener('pointerup', endDrag)
          fab.addEventListener('pointercancel', endDrag)
          /* 拖完紧接着的那一次 click 必须吃掉，否则会顺手把面板打开 */
          fab.addEventListener('click', (e) => {
            if (Date.now() - (fab.__dshDraggedAt || 0) < 400) {
              e.stopPropagation()
              e.preventDefault()
            }
          }, true)
          /* 双击复位到右下角 */
          fab.addEventListener('dblclick', () => {
            try { localStorage.removeItem(FAB_POS_KEY) } catch { /* ignore */ }
            fab.style.transform = ''
            placePanel()
          })
        }
        window.__dshFabDrag = { paint, installFabDrag, readPos, key: FAB_POS_KEY }
        paint()
        installFabDrag()
        placePanel()
        /* 低负载：窗口不可见时降到 ~1s 一次；面板关着且没拖动时降到 ~450ms 一次 */
        let tickN = 0
        setInterval(() => {
          try {
            tickN++
            const hidden = document.hidden === true
            const panelOpen = !!document.querySelector('[data-dsh-usage-panel]')
            if (hidden && tickN % 7 !== 0) return
            if (!hidden && !panelOpen && !fabDragging && tickN % 3 !== 0) return
            installFabDrag(); paint(); placePanel()
            document.documentElement.setAttribute('data-dsh-tick', 'ok')
          } catch (err) {
            /* 诊断：把异常与状态暴露到 DOM，便于 E2E 直接读（不弹窗、不刷控制台） */
            try {
              document.documentElement.setAttribute('data-dsh-tick', 'ERR')
              document.documentElement.setAttribute('data-dsh-tick-err', String(err && err.message || err).slice(0, 160))
            } catch { /* ignore */ }
          }
        }, 150)
        /* 只在真正需要时重摆：窗口变化 + 面板出现/消失（由上面的 450ms 轮询覆盖）。
           不要监听整个文档的 DOM 变化——面板里的「实时动态」每秒都在变，会反复触发放/清高。 */
        window.addEventListener('resize', placePanel)
        window.addEventListener('resize', () => { paint(); placePanel(); placeDrop() })
      } catch { /* ignore */ }

      /*
       * bloub 表情驱动：不改 React，直接对 [data-dsh-bloub] 写 SVG。
       * 引擎自带的 0.45s 表情插值 + 眨眼/呼吸/视线漂移 = 平滑实时过渡。
       */
      try {
        if (window.__dshBloubTimer) clearInterval(window.__dshBloubTimer)
        let engine = null
        let lastIdx = -1
        let lastFace = null
        const morph = { from: null, at: 0, active: false }
        const t0 = performance.now()
        /*
         * 按状态选表情（优先级从高到低）。返回 [索引, 原因]，原因会写到 data-bloub-why 便于排查与测试。
         * 表情 id 全部来自引擎的 16 种：neutre 自然 / attentif 专注 / surpris 惊讶 / excite 兴奋 /
         * heureux 高兴 / hilare 大笑 / colere 愤怒 / triste 悲伤 / effraye 惊恐 / mefiant 怀疑 /
         * confus 困惑 / curieux 好奇 / fier 骄傲 / timide 害羞 / blase 冷漠 / somnolent 困倦
         */
        /* ---- 状态采集（全部来自真实运行时，不猜） ---- */
        let hoverFab = false
        let lastActive = Date.now()
        let snap = null            // 最近一次 /usage-panel/api/usage 的聚合结果
        let snapAt = 0
        let snapErr = false
        /* 连点彩蛋：1.2s 内点 5 下 → 晕 2.5s（优先级最高，压过其它情绪） */
        const pokeState = { clicks: [], until: 0 }
        try {
          const fabEl = document.querySelector('.dsh-fab')
          if (fabEl && !fabEl.__bloubHooked) {
            fabEl.__bloubHooked = true
            fabEl.addEventListener('mouseenter', () => { hoverFab = true })
            fabEl.addEventListener('mouseleave', () => { hoverFab = false })
          }
        } catch { /* ignore */ }
        try {
          for (const ev of ['pointerdown', 'keydown', 'wheel']) {
            document.addEventListener(ev, () => { lastActive = Date.now() }, { passive: true })
          }
          document.addEventListener('pointerdown', (e) => {
            const fab = document.querySelector('.dsh-fab')
            if (!fab || !fab.contains(e.target)) return
            const now = Date.now()
            pokeState.clicks = pokeState.clicks.filter((t) => now - t < 1200)
            pokeState.clicks.push(now)
            if (pokeState.clicks.length >= 5) { pokeState.until = now + 2500; pokeState.clicks = [] }
          }, { passive: true })
        } catch { /* ignore */ }
        const pollState = async () => {
          try {
            const r = await fetch('/usage-panel/api/usage', { credentials: 'same-origin' })
            const j = await r.json()
            snap = j && j.usage ? j.usage : null
            snapErr = !snap
          } catch { snapErr = true }
          snapAt = Date.now()
        }
        pollState()
        setInterval(pollState, 8000)
        /* ---- 互动模式用的实时输入（光标 / 速度 / 点击 / 闲置）---- */
        const pointer = { x: 0, y: 0, at: 0, prevX: 0, prevY: 0, prevAt: 0, speed: 0 }
        let gazeCur = { yaw: 0, pitch: 0 }   // 当前注视（平滑逼近目标，所以是滑过去而不是跳过去）
        let react = { kind: 'none', until: 0 }   // 会被重新赋值，必须 let
        const markPoke = () => { react = { kind: 'poke', until: Date.now() + 900 } }
        try {
          document.addEventListener('pointermove', (e) => {
            const nowMs = Date.now()
            const dt = Math.max(16, nowMs - (pointer.prevAt || nowMs - 16))
            const d = Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y)
            pointer.speed = pointer.speed * 0.6 + (d / dt) * 1000 * 0.4   // 平滑后的像素/秒
            pointer.prevX = pointer.x; pointer.prevY = pointer.y; pointer.prevAt = nowMs
            pointer.x = e.clientX; pointer.y = e.clientY; pointer.at = nowMs
          }, { passive: true })
          document.addEventListener('pointerdown', (e) => {
            const fab = document.querySelector('.dsh-fab')
            if (fab && fab.contains(e.target)) markPoke()
          }, true)
          document.addEventListener('pointerleave', () => { pointer.at = Date.now() - 999999 })
        } catch { /* ignore */ }

        /* 表情停留：非紧急切换至少停 8s，避免数据小抖动导致表情抽搐 */
        const dwell = { id: null, at: 0 }
        const ESCAPE = new Set(['effraye', 'confus'])
        const pickExpr = (p, t) => {
          const idx = (id) => Math.max(0, engine.EXPRESSIONS.findIndex((e) => e.id === id))
          const settle = (pair) => {
            const id = engine.EXPRESSIONS[pair[0]]?.id ?? 'neutre'
            const now = Date.now()
            if (dwell.id && id !== dwell.id && !ESCAPE.has(id) && now - dwell.at < 8000) {
              return [Math.max(0, engine.EXPRESSIONS.findIndex((e) => e.id === dwell.id)), pair[1] + '（停留中）']
            }
            if (id !== dwell.id) { dwell.id = id; dwell.at = now }
            return pair
          }
          const meta = snap && snap.meta ? snap.meta : null
          const tot = snap && snap.totals ? snap.totals : null
          const bal = meta && meta.balance ? meta.balance : null
          // ⓪ 连点彩蛋
          if (pokeState.until > Date.now()) return [idx('confus'), '被连点晕了']
          // ① 接口出错 / 完全拿不到数据
          if (snapErr) return [idx('confus'), '接口出错']
          // ② 余额低于预警阈值 → 惊恐
          if (bal && typeof bal.total === 'number' && bal.total <= (p.threshold ?? 5)) return [idx('effraye'), '余额告急']
          // ③ 余额在掉（P2 掉血）→ 悲伤
          if (bal && bal.delta < 0) return [idx('triste'), '余额下降']
          // ④ 刚充值 → 大笑
          if (bal && Array.isArray(bal.recharges) && bal.recharges.length && Date.now() - (bal.recharges[bal.recharges.length - 1].t || 0) < 60_000) return [idx('hilare'), '刚充值']
          // ⑤ 正在刷新/聚合 → 专注
          if (snap && snap.durationMs > 900) return [idx('attentif'), '聚合中']
          // ⑥ 鼠标悬浮在按钮上 → 好奇
          if (hoverFab) return [idx('curieux'), '悬浮查看']
          // ⑦ 鼠标停在图表提示上 → 惊讶
          if (document.querySelector('[data-dsh-tip]')) return [idx('surpris'), '看提示']
          // ⑧ 面板打开着 → 兴奋
          if (document.querySelector('[data-dsh-usage-panel]')) return [idx('excite'), '面板打开']
          // ⑨ 缓存命中率很优秀 → 骄傲
          if (tot && tot.cacheHitRate >= 0.99) return settle([idx('fier'), '命中率优秀'])
          // ⑨b 今日用量明显高于近 7 日均值 → 兴奋（"今天干得多"）
          try {
            const byDay = (snap && Array.isArray(snap.byDay)) ? snap.byDay : null
            if (byDay && byDay.length >= 3) {
              const dayKey = (d) => d.toISOString().slice(0, 10)
              const map = new Map(byDay.map((d) => [d.day, Number(d.total) || 0]))
              const today = map.get(dayKey(new Date())) || 0
              let sum = 0
              let cnt = 0
              for (let i = 1; i <= 7; i++) {
                const v = map.get(dayKey(new Date(Date.now() - i * 86400000))) || 0
                if (v > 0) { sum += v; cnt++ }
              }
              const avg = cnt > 0 ? sum / cnt : 0
              if (avg > 0 && today > avg * 1.5) return settle([idx('excite'), '今日用量偏高'])
            }
          } catch { /* ignore */ }
          // ⑨c 高峰时段占比过高 → 疲惫（"都在忙时烧钱"）
          if (tot && typeof tot.peakShare === 'number' && tot.peakShare > 0.7) return settle([idx('blase'), '高峰占比过高'])
          // ⑩ 长时间没操作 → 困倦
          if (Date.now() - lastActive > 180_000) return [idx('somnolent'), '闲置中']
          // ⑪ 数据很旧（超过 10 分钟没动）→ 冷漠
          if (tot && tot.lastAt && Date.now() - tot.lastAt > 600_000) return [idx('blase'), '数据陈旧']
          return settle([idx('neutre'), '自然'])
        }
        const readFace = () => {
          try { return JSON.parse(localStorage.getItem('dsh-usage-panel:prefs') || '{}') } catch { return {} }
        }
        window.__dshBloubTimer = setInterval(async () => {
          /* 窗口不可见时不做表情插值与 SVG 重写（省 GPU/CPU） */
          if (document.hidden === true) return
          const canvas = document.querySelector('.dsh-fab [data-dsh-bloub]') || document.querySelector('[data-dsh-usage-panel-host] [data-dsh-bloub]')
          if (!canvas) return
          const p = readFace()
          if (p.face !== 'bloub') {
            if (lastFace === 'bloub') { try { canvas.innerHTML = '' } catch { /* ignore */ } }
            lastFace = p.face || 'logo'
            return
          }
          lastFace = 'bloub'
          if (!engine) {
            engine = BLOUB
            try { const f = document.querySelector('.dsh-fab'); if (f) f.setAttribute('data-bloub-ready', '1') } catch { /* ignore */ }
          }
          try {
            const t = (performance.now() - t0) / 1000
            const n = engine.EXPRESSIONS.length
            if (!engine.EXPRESSIONS) engine = BLOUB
            let why = '固定'
            let picked
            /* 连点彩蛋压过一切模式：任何模式下都能把注意力"戳晕" */
            if (pokeState.until > Date.now()) {
              picked = Math.max(0, engine.EXPRESSIONS.findIndex((e) => e.id === 'confus'))
              why = '被连点晕了'
            } else if (p.bloubMode === 'auto') { picked = Math.floor(t / 3.2) % n; why = '自动轮播' }
            else if (p.bloubMode === 'state' || !p.bloubMode) { const r = pickExpr(p, t); picked = r[0]; why = r[1] }
            else { picked = Math.max(0, Math.min(n - 1, Number(p.bloubIndex) || 0)); why = '固定' }
            const want = picked
            if (want !== lastIdx) {
              morph.from = lastIdx < 0 ? null : engine.EXPRESSIONS[lastIdx]
              morph.at = t
              morph.active = Boolean(morph.from)
              lastIdx = want
            }
            let useExpr = engine.EXPRESSIONS[want]
            if (p.bloubMode === 'play') {
              const nowMs = Date.now()
              const idleMs = Math.max(3, Number(p.bloubIdleSec) || 25) * 1000
              const idleFor = nowMs - (pointer.at || 0)
              const asleep = idleFor > idleMs * 2
              const fabNow = document.querySelector('.dsh-fab')
              const rNow = fabNow ? fabNow.getBoundingClientRect() : { left: 0, top: 0, width: 46, height: 46 }
              const cx = rNow.left + rNow.width / 2
              const cy = rNow.top + rNow.height / 2
              const R = 340
              const nx = Math.max(-1, Math.min(1, (pointer.x - cx) / R))
              const ny = Math.max(-1, Math.min(1, (pointer.y - cy) / R))
              /* 睡着时半闭眼：直接覆盖 eyes */
              if (asleep) {
                useExpr = Object.assign({}, useExpr, { eyes: [Object.assign({}, useExpr.eyes[0], { open: 0.22 }), Object.assign({}, useExpr.eyes[1], { open: 0.22 })] })
              }
              /* 目标注视：看向光标；睡着时缓慢下垂；平滑逼近，所以是"滑过去"而不是跳过去 */
              const tgt = asleep ? { yaw: 0, pitch: 8 } : { yaw: nx * 30, pitch: -ny * 20 }
              gazeCur.yaw += (tgt.yaw - gazeCur.yaw) * 0.14
              gazeCur.pitch += (tgt.pitch - gazeCur.pitch) * 0.14
              useExpr = Object.assign({}, useExpr, { gaze: { yaw: gazeCur.yaw, pitch: gazeCur.pitch, roll: useExpr.gaze.roll } })
              /* 行为优先级：被戳 → 刚睡醒 → 睡着 → 发呆 → 手快 → 好奇 */
              if (nowMs < react.until) { why = '被戳了一下' }
              else if (react.kind === 'poke' && nowMs >= react.until) { react = { kind: 'none', until: 0 }; why = '回过神' }
              else if (asleep) { why = '睡着了' }
              else if (idleFor > idleMs) { why = '发呆中' }
              else if (pointer.speed > 900) { why = '手好快' }
              else { why = '看着你的光标' }
            }
            const frame = engine.frameFor(useExpr, t, morph)
            /*
             * 必须有一层 <svg> 宿主：引擎的 frameToSvg() 只返回 <defs>/<path> 这类内部标记，
             * 而裸露的 <path> 在 HTML 里不会被渲染。原项目也是靠 HTML 里的 <svg id="botSvg"> 承载。
             */
            let host = canvas.querySelector('svg')
            if (!host) {
              canvas.innerHTML = '<svg viewBox="-108 -108 216 216" width="100%" height="100%" role="img" aria-label="bloub" preserveAspectRatio="xMidYMid meet"></svg>'
              host = canvas.querySelector('svg')
            }
            if (host) host.innerHTML = engine.frameToSvg(frame, Math.floor(t * 24) % 1000)
            canvas.setAttribute('data-bloub-frames', String((Number(canvas.getAttribute('data-bloub-frames')) || 0) + 1))
            try {
              const f = document.querySelector('.dsh-fab')
              if (f) {
                f.setAttribute('data-bloub-expr', (useExpr && useExpr.id) || engine.EXPRESSIONS[want].id)
                f.setAttribute('data-bloub-react', Date.now() < react.until ? 'poke' : (why === '睡着了' ? 'asleep' : (why === '发呆中' ? 'idle' : 'none')))
                if (p.bloubMode === 'play') f.setAttribute('data-bloub-gaze', gazeCur.yaw.toFixed(1) + ',' + gazeCur.pitch.toFixed(1))
                f.setAttribute('data-bloub-why', why)
              }
            } catch { /* ignore */ }
          } catch (err) {
            /* 单帧失败不能影响按钮，但必须留下痕迹（不再静默） */
            try {
              canvas.setAttribute('data-bloub-err', String(err && err.message || err).slice(0, 200))
              window.__dshUsagePanelLastError = 'bloub: ' + String(err && err.stack || err).slice(0, 1200)
            } catch { /* ignore */ }
          }
        }, 1000 / 24)
      } catch { /* ignore */ }

      /*
       * 兜底：3 秒后如果连按钮都没有，就用纯 DOM 插一个可见的红色按钮。
       * 目的：让「按钮不出现」这件事从此在视觉上不可能发生，并且点一下就能看到原因。
       */
      try {
        setTimeout(() => {
          try {
            if (document.querySelector('.dsh-fab') || document.querySelector('[data-dsh-safe-fab]')) return
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.setAttribute('data-dsh-safe-fab', '')
            btn.textContent = '!'
            btn.title = '用量面板没能挂载：点一下看原因'
            btn.style.cssText = 'position:fixed;right:14px;bottom:18px;width:46px;height:46px;border-radius:50%;border:0;background:#ef6b6b;color:#fff;font-size:22px;font-weight:700;cursor:pointer;z-index:2147483000;box-shadow:0 3px 10px rgba(0,0,0,.45)'
            btn.addEventListener('click', () => {
              const msg = String(window.__dshUsagePanelLastError ?? '（没有捕获到错误信息）')
              try { alert('用量面板没能显示。\n\n最近一次错误：\n' + msg.slice(0, 900)) } catch { /* ignore */ }
            })
            document.body.appendChild(btn)
          } catch { /* ignore */ }
        }, 3000)
      } catch { /* ignore */ }
        return () => {
          try { reactRoot?.unmount() } catch { /* ignore */ }
          reactRoot = null
          panelHost?.remove()
          panelHost = null
          listeners.clear()
        }
      }, 'dsh-usage-panel: mount')

      return undefined
    }

    return {
      name: PANEL_ID,
      inject,
      apply,
      default: { name: PANEL_ID, inject, apply }
    }
  }
})
