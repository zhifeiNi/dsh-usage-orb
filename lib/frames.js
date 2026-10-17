/**
 * dsh-usage-orb — 字节层
 *
 * 职责：定位 DSH 数据文件、按 RFC 8878 逐帧解压事件流、以及 token 累加这类通用小工具。
 * 关键事实：**每个事件是一个独立的 zstd 帧**。任何一次性解压都只能拿到第一帧（会话头），
 * 后面几千个事件会被静默丢掉 —— 所以必须自己走帧边界。
 */

import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as zlib from 'node:zlib'

export const PANEL_VERSION = '0.2.0'


const ZSTD_MAGIC = 0xfd2fb528
export const LIMITS = {
  maxFiles: 20000,
  maxLogBytes: 64 * 1024 * 1024,
  maxProjectionBytes: 8 * 1024 * 1024,
  maxWalkDepth: 6
}

/* ================================================================== *
 * 路径
 * ================================================================== */

export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

export const logsRoot = (dshHome) => join(dshHome, 'sessions')
export const projRoot = (dshHome) => join(dshHome, 'storages', 'session_projcache', 'sessions')

/* ================================================================== *
 * zstd 多帧读取
 * ================================================================== */

export const zstdAvailable = () => typeof zlib.zstdDecompressSync === 'function'

/**
 * 依次产出每个 zstd 帧的切片。
 * 帧头布局（RFC 8878）：magic(4) + descriptor(1) + [window(1)] + [dictId] + [contentSize] + blocks
 * 块头 3 字节：bit0=last, bit1-2=type(0 raw / 1 rle / 2 compressed), bit3-23=size
 */
export function* walkZstdFrames(buf) {
  let off = 0
  while (off + 4 <= buf.length) {
    if (buf.readUInt32LE(off) !== ZSTD_MAGIC) {
      yield { error: `偏移 ${off} 不是 zstd 帧头` }
      return
    }
    let p = off + 4
    const fhd = buf[p]; p += 1
    const fcsFlag = fhd >> 6
    const singleSegment = (fhd >> 5) & 1
    const checksum = (fhd >> 2) & 1
    const dictFlag = fhd & 3
    if (!singleSegment) p += 1
    p += dictFlag === 0 ? 0 : dictFlag === 1 ? 1 : dictFlag === 2 ? 2 : 4
    p += fcsFlag === 0 ? (singleSegment ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
    let last = false
    while (!last) {
      if (p + 3 > buf.length) { yield { error: `偏移 ${off} 块头越界` }; return }
      const bh = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16); p += 3
      last = (bh & 1) === 1
      const type = (bh >> 1) & 3
      const size = bh >> 3
      if (type === 0) p += size
      else if (type === 1) p += 1
      else if (type === 2) p += size
      else { yield { error: `偏移 ${off} 出现保留块类型` }; return }
    }
    if (checksum) p += 4
    if (p > buf.length) { yield { error: `偏移 ${off} 帧越界` }; return }
    yield { start: off, end: p, slice: buf.subarray(off, p) }
    off = p
  }
}

/* ================================================================== *
 * 小工具
 * ================================================================== */

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地日期键（用户时区） */
export function localDayKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export const emptyUsage = () => ({ uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 })

export function addUsage(target, src) {
  target.uncachedInput += src.uncachedInput ?? 0
  target.cacheRead += src.cacheRead ?? 0
  target.cacheWrite += src.cacheWrite ?? 0
  target.output += src.output ?? 0
  target.total += src.total ?? 0
  return target
}
