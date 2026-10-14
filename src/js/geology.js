// geology.js - 地质层：缓慢且不可逆的地形变化（v4.4 世界自变）
// 零内容红线：只写物理机制（侵蚀/滑坡/塌陷），不硬编码具体地形
// 单向依赖：chunk.js, core.js
import { G, O, clamp } from './core.js';
import { CHUNK, ST, chunkOrigin, localIdx } from './chunk.js';

export const GEOL = {
  enabled: true,
  // 河岸侵蚀：WATER 相邻的 GRASS/DIRT → SAND（每年每格概率）
  erodeProb: 0.02,
  // 沙岸塌陷：SAND 被多面水包围 → WATER（河面缓慢加宽）
  sandCollapseProb: 0.01,
  // 山体滑坡：ROCK 向相邻空地移动
  slideProb: 0.003,
  // 地面塌陷：城镇外 STONE → DIRT
  sinkProb: 0.001,
  // 每年上限（防止单年过度变化）
  maxErodePerYear: 80,
  maxCollapsePerYear: 25,
  maxSlidePerYear: 20,
  maxSinkPerYear: 15,
};

// ---- 河流侵蚀：水边草地/泥地 → 沙岸 ----
function riverErosion(world, rng, budget) {
  let n = 0;
  for (const c of world.ws.iterNonVirgin()) {
    if (c.state < ST.COOL) continue;
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        if (n >= budget) return n;
        const i = localIdx(lx, ly);
        const g = c.ground[i];
        if (g !== G.GRASS && g !== G.DIRT) continue;
        const hasWater =
          (lx > 0 && c.ground[localIdx(lx - 1, ly)] === G.WATER) ||
          (lx < CHUNK - 1 && c.ground[localIdx(lx + 1, ly)] === G.WATER) ||
          (ly > 0 && c.ground[localIdx(lx, ly - 1)] === G.WATER) ||
          (ly < CHUNK - 1 && c.ground[localIdx(lx, ly + 1)] === G.WATER);
        if (!hasWater) continue;
        if (rng() < GEOL.erodeProb) {
          c.ground[i] = G.SAND;
          c.dirty = true;
          n++;
        }
      }
    }
  }
  return n;
}

// ---- 沙岸塌陷：沙岸被多面水包围 → 河面扩张 ----
function sandCollapse(world, rng, budget) {
  let n = 0;
  for (const c of world.ws.iterNonVirgin()) {
    if (c.state < ST.COOL) continue;
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        if (n >= budget) return n;
        const i = localIdx(lx, ly);
        if (c.ground[i] !== G.SAND) continue;
        let waterN = 0;
        if (lx > 0 && c.ground[localIdx(lx - 1, ly)] === G.WATER) waterN++;
        if (lx < CHUNK - 1 && c.ground[localIdx(lx + 1, ly)] === G.WATER) waterN++;
        if (ly > 0 && c.ground[localIdx(lx, ly - 1)] === G.WATER) waterN++;
        if (ly < CHUNK - 1 && c.ground[localIdx(lx, ly + 1)] === G.WATER) waterN++;
        if (waterN >= 2 && rng() < GEOL.sandCollapseProb) {
          c.ground[i] = G.WATER;
          c.obj[i] = O.NONE;
          c.dirty = true;
          n++;
        }
      }
    }
  }
  return n;
}

// ---- 山体滑坡：岩石向相邻空地移动 ----
function rockSlide(world, rng, budget) {
  let n = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const c of world.ws.iterNonVirgin()) {
    if (c.state < ST.COOL) continue;
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        if (n >= budget) return n;
        const i = localIdx(lx, ly);
        if (c.obj[i] !== O.ROCK) continue;
        for (const [dx, dy] of dirs) {
          const nx = lx + dx, ny = ly + dy;
          if (nx < 0 || nx >= CHUNK || ny < 0 || ny >= CHUNK) continue;
          const ni = localIdx(nx, ny);
          if (c.ground[ni] === G.WATER || c.ground[ni] === G.BRIDGE) continue;
          if (c.obj[ni] !== O.NONE) continue;
          if (rng() < GEOL.slideProb) {
            c.obj[ni] = O.ROCK;
            c.obj[i] = O.NONE;
            c.dirty = true;
            n++;
            break;
          }
        }
      }
    }
  }
  return n;
}

// ---- 地面塌陷：城镇外石板地 → 泥地 ----
function groundSink(world, rng, budget) {
  let n = 0;
  for (const c of world.ws.iterNonVirgin()) {
    if (c.state < ST.COOL) continue;
    const { x0, y0 } = chunkOrigin(c.cx, c.cy);
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        if (n >= budget) return n;
        const i = localIdx(lx, ly);
        if (c.ground[i] !== G.STONE) continue;
        // 保护城镇建筑（起源 72×72 范围）
        const tx = x0 + lx, ty = y0 + ly;
        if (tx >= 0 && tx < 72 && ty >= 0 && ty < 72) continue;
        // 保护有建筑的格子
        if (c.obj[i] !== O.NONE && c.obj[i] !== O.FLOWER) continue;
        if (rng() < GEOL.sinkProb) {
          c.ground[i] = G.DIRT;
          c.dirty = true;
          n++;
        }
      }
    }
  }
  return n;
}

// ---- 主入口 ----
// years = 距上次地质 tick 的年数（通常 1）
// 返回统计 { eroded, collapsed, slid, sunk }
export function geologyTick(world, years = 1, rng = Math.random) {
  if (!GEOL.enabled) return { eroded: 0, collapsed: 0, slid: 0, sunk: 0 };
  const eroded = riverErosion(world, rng, GEOL.maxErodePerYear * years);
  const collapsed = sandCollapse(world, rng, Math.floor(GEOL.maxCollapsePerYear * years));
  const slid = rockSlide(world, rng, GEOL.maxSlidePerYear * years);
  const sunk = groundSink(world, rng, GEOL.maxSinkPerYear * years);
  return { eroded, collapsed, slid, sunk };
}

// ---- 序列化 ----
export function serializeGeology(game) {
  return {
    lastGeoYear: game._lastGeoYear || 0,
    erodedTotal: game._erodedTotal || 0,
    collapsedTotal: game._collapsedTotal || 0,
    slidTotal: game._slidTotal || 0,
    sunkTotal: game._sunkTotal || 0,
  };
}

export function hydrateGeology(game, data) {
  if (!data) return;
  game._lastGeoYear = data.lastGeoYear || 0;
  game._erodedTotal = data.erodedTotal || 0;
  game._collapsedTotal = data.collapsedTotal || 0;
  game._slidTotal = data.slidTotal || 0;
  game._sunkTotal = data.sunkTotal || 0;
}
