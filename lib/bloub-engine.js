/**
 * bloub 表情引擎（内联模块）
 *
 * 上游：https://github.com/jeremy-prt/bloub  —  MIT, Copyright (c) 2026 Jérémy Perret
 * 完整许可与设计归属声明见仓库根目录 THIRD-PARTY-NOTICES.md
 *
 * 抽取范围：上游 src/bot/ 中与 DOM 无关的部分（表情表、极坐标轮廓、帧求解 frameFor、
 * 帧转 SVG frameToSvg、缓动与插值常量）。仅加封装与导出，未改任何几何/表情/时长常量。
 * 上游的 Vue 组件、导出器（GIF/MP4）、i18n 与 UI 不在本文件内。
 *
 * 注意：上游声明 "MIT covers the code, not the design it imitates" —— 与 x.ai 无关联。
 */
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

export { EXPRESSIONS, frameFor, frameToSvg, blendExpression, EXPRESSION_BY_ID, SHAPE_MORPH, DEMI_VIEWBOX, liveliness }
