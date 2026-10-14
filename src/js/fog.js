// fog.js - 探索迷雾（世界层）：地图只被居民的脚印点亮，相机不算数
// 物理：看见不等于到过；只有真正踩过/生活过的地方，迷雾才会散开
// 零内容：只提供"标记/判定"机制，不定义任何视觉样式——渲染层决定怎么画暗
import { CHUNK, CHUNK_AREA, worldToChunk, localIdx } from './chunk.js';

export const FOG = { enabled: true, npcRadius: 6, wandererRadius: 5 };

// fog = { chunks: Map<"cx,cy", Uint8Array(CHUNK_AREA)> }
// 只记录"已探索"，未探索 chunk 懒生成——内存随探索面积增长，不随世界大小增长

export function makeFog() { return { chunks: new Map() }; }

function _key(cx, cy) { return cx + ',' + cy; }

function _chunk(fog, cx, cy) {
  const k = _key(cx, cy);
  let c = fog.chunks.get(k);
  if (!c) { c = new Uint8Array(CHUNK_AREA); fog.chunks.set(k, c); }
  return c;
}

// 标记圆形区域为已探索（半径含中心）
export function markSeen(fog, tx, ty, r) {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = tx + dx, y = ty + dy;
      const [cx, cy] = worldToChunk(x, y);
      const c = _chunk(fog, cx, cy);
      c[localIdx(x - cx * CHUNK, y - cy * CHUNK)] = 1;
    }
  }
}

export function isSeen(fog, tx, ty) {
  const [cx, cy] = worldToChunk(tx, ty);
  const c = fog.chunks.get(_key(cx, cy));
  return !!(c && c[localIdx(tx - cx * CHUNK, ty - cy * CHUNK)]);
}

// 序列化：Map 转 [key, base64] 数组
// 浏览器/Node 都有 btoa/atob（Node ≥16 全局可用）
function _u8ToB64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += 1024) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + 1024));
  }
  return btoa(bin);
}
function _b64ToU8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function serializeFog(fog) {
  return Array.from(fog.chunks.entries()).map(([k, c]) => [k, _u8ToB64(c)]);
}

export function hydrateFog(data) {
  const fog = makeFog();
  if (Array.isArray(data)) {
    for (const [k, b64] of data) fog.chunks.set(k, _b64ToU8(b64));
  }
  return fog;
}
