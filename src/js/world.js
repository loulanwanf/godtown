// world.js - 地图生成、寻路、地块操作、作物生长（环境无关）
// v2.1.0：无限地图改造——废除 ground/obj 全局数组，改为 WorkingSet 区块系统
// 起源 2×2 chunk=128×128，城镇 72×72 横跨 4 chunk 部分区域
// 热点路径性能铁律：walkable/findPath/placeObj 等直接取 chunk 引用 + c.ground[localIdx]，不调全局函数
import {
  TILE, CHUNK, G, O, BLOCK_OBJ, MINEABLE, CHOPPABLE,
  AREA_DEFS, mulberry32, choice, rint, chance
} from './core.js';
import {
  WorkingSet, CHUNK_AREA, ST,
  worldToChunk, chunkOrigin, localIdx, chunkKeyOf, isOriginChunk,
  getGround, getObj, setGround, setObj, chunkHas,
  tickChunkWarm, tickChunkCool
} from './chunk.js';

// ---------- 地图生成 ----------
export function genWorld(seed) {
  const ws = new WorkingSet(seed, { originGen: genOriginArea });
  // 生成起源 4 chunk：(0,0)(1,0)(0,1)(1,1)
  // genChunk 内部先 genWildChunk 填满野地，后 originGen 覆盖城镇范围 x∈[0,71]&&y∈[0,71]
  ws.ensure(0, 0);
  ws.ensure(1, 0);
  ws.ensure(0, 1);
  ws.ensure(1, 1);
  // 收集房屋全集（NPC 初始化要用）—— 房屋都在 chunk(0,0)
  const houses = [];
  for (const c of ws.iterNonVirgin()) {
    for (const h of c.houses) houses.push(h);
  }
  const w = {
    seed,
    ws,                 // WorkingSet（替代旧 ground/obj 两大数组）
    houses,             // 起源区块房屋全集
    areas: AREA_DEFS.map(a => ({ ...a })),
    version: 2
  };
  return w;
}

// genOriginArea(chunk, worldSeed) — 原 genWorld 函数体提取，按 chunk 坐标范围分片写入
// 起源 chunk 被 genChunk 调用：此时野地已由 genWildChunk 填满，本函数只覆盖城镇 72×72 范围
// 多出的 56×56（128-72）保持野地
export function genOriginArea(chunk, worldSeed) {
  const { cx, cy } = chunk;
  const { x0, y0 } = chunkOrigin(cx, cy);
  const rng = mulberry32(worldSeed);
  // 该 chunk 范围判定（世界坐标 → 本 chunk 内）
  const inT = (x, y) => x >= x0 && x < x0 + CHUNK && y >= y0 && y < y0 + CHUNK;
  const li = (x, y) => localIdx(x - x0, y - y0);
  // 局部写入辅助（只写落在本 chunk 的格子）
  const setG = (x, y, g) => { if (inT(x, y)) chunk.ground[li(x, y)] = g; };
  const setO = (x, y, o) => { if (inT(x, y)) chunk.obj[li(x, y)] = o; };
  const getG = (x, y) => inT(x, y) ? chunk.ground[li(x, y)] : G.GRASS;
  const getO = (x, y) => inT(x, y) ? chunk.obj[li(x, y)] : O.NONE;

  // 房屋印章（直接操作 chunk）
  function stampHouse(hx, hy, hw, hh, color) {
    for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + hw; x++) {
      setO(x, y, O.WALL);
      setG(x, y, G.STONE);
    }
    const dx = hx + 2, dy = hy + hh - 1;
    setO(dx, dy, O.DOOR);
    if (inT(dx, dy + 1) && getG(dx, dy + 1) === G.GRASS) setG(dx, dy + 1, G.PATH);
    // 房屋只登记在门所在的那个 chunk（originGen 会在 4 个起源 chunk 各跑一遍，不挡会重复登记）
    if (inT(dx, dy)) chunk.houses.push({ x: hx, y: hy, w: hw, h: hh, doorX: dx, doorY: dy, ox: dx, oy: dy + 1, color });
  }
  function roadH(x0r, x1r, y) {
    for (let x = Math.min(x0r, x1r); x <= Math.max(x0r, x1r); x++) {
      if (!inT(x, y)) continue;
      const g = chunk.ground[li(x, y)];
      if (g === G.WATER) continue;
      const o = chunk.obj[li(x, y)];
      if (o === O.WALL || o === O.DOOR || o === O.FOUNTAIN) continue;
      chunk.ground[li(x, y)] = G.PATH;
      if (o === O.TREE || o === O.ROCK || o === O.FLOWER || o === O.FENCE) chunk.obj[li(x, y)] = O.NONE;
    }
  }
  function roadV(x, y0r, y1r) {
    for (let y = Math.min(y0r, y1r); y <= Math.max(y0r, y1r); y++) {
      if (!inT(x, y)) continue;
      const g = chunk.ground[li(x, y)];
      if (g === G.WATER) continue;
      const o = chunk.obj[li(x, y)];
      if (o === O.WALL || o === O.DOOR || o === O.FOUNTAIN) continue;
      chunk.ground[li(x, y)] = G.PATH;
      if (o === O.TREE || o === O.ROCK || o === O.FLOWER || o === O.FENCE) chunk.obj[li(x, y)] = O.NONE;
    }
  }

  // 1) 草地基底 + 边缘树墙（城镇范围 0..71，盖掉 genWildChunk 的野地树/石）
  for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) {
    if (!inT(x, y)) continue;
    chunk.ground[li(x, y)] = G.GRASS;
    chunk.obj[li(x, y)] = O.NONE;
  }
  for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) {
    if (x < 2 || y < 1 || x >= 70 || y >= 70) setO(x, y, O.TREE);
  }

  // 2) 南河：y=66..70 波浪水带 + 沙岸
  for (let x = 2; x < 70; x++) {
    const wave = Math.round(Math.sin(x * 0.22) * 1.2);
    const yR = 66 + wave;
    for (let y = yR; y <= yR + 3; y++) setG(x, y, G.WATER);
    setG(x, yR - 1, G.SAND);
    if (yR + 4 < 70) setG(x, yR + 4, G.SAND);
  }
  // 木桥 x=35,36
  for (let y = 63; y <= 71; y++) {
    for (const bx of [35, 36]) {
      if (y < 70 && getG(bx, y) === G.WATER) { setG(bx, y, G.BRIDGE); setO(bx, y, O.NONE); }
    }
  }

  // 3) 镇中心广场（石板 13x13 + 中央喷泉）
  const px = 30, py = 20, pw = 13, ph = 13;
  for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) {
    setG(x, y, G.STONE); setO(x, y, O.NONE);
  }
  for (let y = py + 5; y <= py + 6; y++) for (let x = px + 5; x <= px + 6; x++) setO(x, y, O.FOUNTAIN);

  // 4) 集市街（东侧空地 + 3 个货摊）
  for (let y = 22; y < 30; y++) for (let x = 50; x < 60; x++) {
    if (getG(x, y) === G.GRASS) setG(x, y, G.DIRT);
    if (getO(x, y) === O.TREE) setO(x, y, O.NONE);
  }
  setO(53, 24, O.STALL); setO(56, 24, O.STALL); setO(53, 27, O.STALL);
  // 路灯：广场四角 + 集市两角
  for (const [lx, ly] of [[32, 22], [39, 22], [32, 29], [39, 29], [51, 22], [58, 29]]) setO(lx, ly, O.LAMP);

  // 5) 居民房屋：10 座 6x5 环绕广场
  const houseSpots = [
    [29, 11], [39, 11], [49, 13],
    [24, 19], [52, 32],
    [24, 33], [58, 40], [42, 40],
    [50, 44], [44, 32]
  ];
  const houseColors = ['#8c5a3c', '#a3714b', '#7d6a9e', '#5f7d5a', '#9c4f43', '#b08968', '#6e8b9e', '#8f8f6a', '#a06a52', '#757d8c'];
  houseSpots.forEach((s, i) => stampHouse(s[0], s[1], 6, 5, houseColors[i]));

  // 6) 南郊农田：栅栏围一圈 + 耕地垄
  for (let y = 45; y < 63; y++) for (let x = 13; x < 39; x++) {
    const edge = (x === 13 || x === 38 || y === 45 || y === 62);
    if (edge) { if (getO(x, y) === O.NONE || getO(x, y) === O.TREE) setO(x, y, O.FENCE); }
    else { setO(x, y, O.NONE); if (getO(x, y) !== O.FENCE) { setG(x, y, G.SOIL); } }
  }
  // 大门缺口
  for (const gx of [25, 26, 27]) setO(gx, 45, O.NONE);
  for (const gx of [25, 26, 27]) setO(gx, 62, O.NONE);
  // 初期作物：一半耕地有苗
  let planted = 0;
  for (let y = 47; y < 61 && planted < 40; y += 2) {
    for (let x = 15; x < 37 && planted < 40; x += 2) {
      if (!inT(x, y)) continue;
      if (getG(x, y) === G.SOIL && getO(x, y) === O.NONE) {
        const stage = rint(rng, 0, 2);
        setO(x, y, O.CROP0 + stage);
        chunk.crops.set(li(x, y), { stage, plantedDay: 1, watered: false });
        planted++;
      }
    }
  }

  // 7) 北岭矿区：碎石地 + 岩石/矿脉 + 矿洞口
  for (let y = 4; y < 19; y++) for (let x = 49; x < 68; x++) {
    if (getG(x, y) === G.GRASS) setG(x, y, G.DIRT);
    if (getO(x, y) === O.TREE) setO(x, y, O.NONE);
  }
  // 矿洞口（装饰用墙体块）
  for (let y = 6; y <= 8; y++) for (let x = 57; x <= 59; x++) setO(x, y, O.WALL);
  // 岩石与矿脉
  for (let i = 0; i < 85; i++) {
    const x = rint(rng, 49, 67), y = rint(rng, 4, 18);
    if (!inT(x, y)) continue;
    if (getO(x, y) !== O.NONE) continue;
    const r = rng();
    setO(x, y, r < 0.62 ? O.ROCK : (r < 0.82 ? O.COPPER : (r < 0.95 ? O.IRON : O.GOLD)));
  }

  // 8) 西边树林：密林
  for (let y = 6; y < 36; y++) for (let x = 4; x < 24; x++) {
    if (!inT(x, y)) continue;
    if (getG(x, y) !== G.GRASS || getO(x, y) !== O.NONE) continue;
    if (chance(rng, 0.58)) setO(x, y, O.TREE);
    else if (chance(rng, 0.08)) setO(x, y, O.BUSH);
  }

  // 9) 道路网：广场向四方辐射
  roadH(14, 59, 26);          // 东西横路穿过广场
  roadV(36, 26, 66);          // 南下到桥
  roadV(36, 10, 26);          // 北上住宅区
  roadH(24, 50, 38);          // 南部住宅横路
  roadV(22, 20, 45);          // 西路到农田门
  roadV(54, 20, 30);          // 东路到集市

  // 10) 全图散落装饰
  for (let y = 3; y < 69; y++) for (let x = 3; x < 69; x++) {
    if (!inT(x, y)) continue;
    const i = li(x, y);
    if (chunk.ground[i] !== G.GRASS || chunk.obj[i] !== O.NONE) continue;
    if (chance(rng, 0.02)) chunk.obj[i] = O.FLOWER;
    else if (chance(rng, 0.008)) chunk.obj[i] = O.ROCK;
  }

  // 11) 每户门前 3 格通道：清阻挡 + 铺路
  for (const h of chunk.houses) {
    for (let k = 1; k <= 3; k++) {
      const x = h.doorX, y = h.doorY + k;
      if (!inT(x, y)) continue;
      const i = li(x, y);
      if (chunk.ground[i] === G.WATER || chunk.ground[i] === G.BRIDGE) continue;
      if (chunk.obj[i] !== O.DOOR) chunk.obj[i] = O.NONE;
      if (chunk.ground[i] === G.GRASS || chunk.ground[i] === G.DIRT) chunk.ground[i] = G.PATH;
    }
  }

  chunk.dirty = true;
}

export function bindHouses(w, roster) {
  // roster[i] 对应 houses[i]
  roster.forEach((def, i) => {
    if (!w.houses[i]) return;
    w.houses[i].ownerId = def.id;
    w.houses[i].ownerName = def.name;
    w.houses[i].ownerJob = def.job;
  });
}

// re-export chunk.js 的 tile 访问函数（保持调用方 import 兼容）
export { getGround, getObj, setGround, setObj, chunkHas };

// ---------- 查询与操作 ----------
// walkable：直接取 chunk 引用 + 数组访问（性能铁律：不调 getGround/getObj）
export function walkable(w, x, y) {
  const [cx, cy] = worldToChunk(x, y);
  const c = w.ws.get(cx, cy);
  if (!c) return false;           // 未持有 chunk = 不可走
  const { x0, y0 } = chunkOrigin(cx, cy);
  const i = localIdx(x - x0, y - y0);
  const g = c.ground[i];
  if (g === G.WATER) return false;           // BRIDGE 可走
  if (BLOCK_OBJ.has(c.obj[i])) return false;
  return true;
}

// BFS 寻路：整数键 + chunk 局部缓存（性能铁律：字符串 key 是 GC 垃圾制造机——
//  profiler 实测 findPath 占全镇 CPU 56%，其中大半是 "x,y" 拼接与 Map 字符串哈希）
// maxExplore=4096，长路径分 48 步段。遍历顺序与旧版完全一致：同样的队列、同样的方向序、同样的结果。
function relKey(dx, dy) { return (dx + 8192) * 16384 + (dy + 8192); }   // 以起点为原点的相对键，±8192 内无碰撞（BFS 半径 ≪ 此值）
export function findPath(w, sx, sy, tx, ty, maxSteps = 48) {
  if (sx === tx && sy === ty) return [];
  const ws = w.ws;
  // 局部 walker：BFS 探索的区域是连续的，连续瓦片大概率落在同一个（或相邻）chunk——
  // 一个 5 槽直查缓存把 ws.get 的字符串 key 从每瓦片 1 次压到近乎 0
  const cache = [];   // [{cx, cy, c}] 小数组线性查，命中即走
  const walk = (x, y) => {
    const [cx, cy] = worldToChunk(x, y);
    let c = null;
    for (let i = 0; i < cache.length; i++) {
      if (cache[i].cx === cx && cache[i].cy === cy) { c = cache[i].c; break; }
    }
    if (c === null) {
      c = ws.map.get(cx + ',' + cy);   // 直取底层 map：绕过 lastAccess 记账（寻路不该污染 LRU）
      if (cache.length >= 5) cache.shift();
      cache.push({ cx, cy, c });
    }
    if (!c) return false;
    const { x0, y0 } = chunkOrigin(cx, cy);
    const i = localIdx(x - x0, y - y0);
    if (c.ground[i] === G.WATER) return false;         // BRIDGE 可走
    if (BLOCK_OBJ.has(c.obj[i])) return false;
    return true;
  };
  if (!walk(tx, ty)) {
    // 目标不可走时找目标相邻可走点
    const alt = [[0, 1], [0, -1], [1, 0], [-1, 0]]
      .map(d => [tx + d[0], ty + d[1]])
      .filter(p => walk(p[0], p[1]));
    if (!alt.length) return null;
    tx = alt[0][0]; ty = alt[0][1];
  }
  const seen = new Set();
  const prev = new Map();
  const qx = [sx], qy = [sy];
  const skey = relKey(0, 0);
  seen.add(skey);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let head = 0, explored = 0;
  while (head < qx.length) {
    const cx = qx[head], cy = qy[head]; head++;
    if (cx === tx && cy === ty) {
      // 回溯
      const path = [];
      let cxk = relKey(cx - sx, cy - sy);
      while (cxk !== skey) {
        const pr = prev.get(cxk);
        if (pr === undefined) return null;
        const px = sx + Math.floor(pr / 16384) - 8192, py = sy + (pr % 16384) - 8192;
        path.push([px, py]);
        cxk = pr;
      }
      path.reverse();
      // 长路径分段：只返回前 maxSteps 步，npc 走完自动续程
      if (path.length > maxSteps) return path.slice(0, maxSteps);
      return path;
    }
    if (++explored > 4096) break;   // maxExplore 上限
    for (const d of dirs) {
      const nx = cx + d[0], ny = cy + d[1];
      const nkey = relKey(nx - sx, ny - sy);
      if (seen.has(nkey)) continue;
      if (!walk(nx, ny)) continue;
      seen.add(nkey);
      prev.set(nkey, relKey(cx - sx, cy - sy));
      qx.push(nx); qy.push(ny);
    }
  }
  return null;
}

// placeObj：直接操作 chunk（性能铁律）
export function placeObj(w, x, y, o) {
  if (!chunkHas(w, x, y)) return false;
  const [cx, cy] = worldToChunk(x, y);
  const c = w.ws.get(cx, cy);
  const { x0, y0 } = chunkOrigin(cx, cy);
  const i = localIdx(x - x0, y - y0);
  if (c.obj[i] === O.WALL || c.obj[i] === O.DOOR || c.obj[i] === O.FOUNTAIN || c.obj[i] === O.STALL) return false;
  c.obj[i] = o;
  if (o >= O.CROP0 && o <= O.CROP3) c.crops.set(i, { stage: o - O.CROP0, plantedDay: 1, watered: false });
  c.dirty = true;
  return true;
}
export function removeObj(w, x, y) {
  if (!chunkHas(w, x, y)) return null;
  const [cx, cy] = worldToChunk(x, y);
  const c = w.ws.get(cx, cy);
  const { x0, y0 } = chunkOrigin(cx, cy);
  const i = localIdx(x - x0, y - y0);
  const old = c.obj[i];
  if (old === O.WALL || old === O.DOOR || old === O.FOUNTAIN || old === O.STALL) return null;
  c.obj[i] = O.NONE;
  c.crops.delete(i);
  c.dirty = true;
  return old;
}

// 原木掉落在地上（物质层·采集：砍倒的树是实体，不是凭空进账的数字）
export function dropLogs(w, x, y, n, rng) {
  let placed = 0;
  for (let k = 0; k < 30 && placed < n; k++) {
    const lx = x + rint(rng, -3, 3), ly = y + rint(rng, -3, 3);
    if (!chunkHas(w, lx, ly)) continue;
    const [cx, cy] = worldToChunk(lx, ly);
    const c = w.ws.get(cx, cy);
    const { x0, y0 } = chunkOrigin(cx, cy);
    const i = localIdx(lx - x0, ly - y0);
    if (c.ground[i] === G.WATER || c.ground[i] === G.SOIL) continue;
    if (c.obj[i] !== O.NONE) continue;
    c.obj[i] = O.LOG;
    c.dirty = true;
    placed++;
  }
  return placed;
}

// 采集：返回 {res, qty} 或 null
export function harvestObj(w, x, y, rng) {
  if (!chunkHas(w, x, y)) return null;
  const [cx, cy] = worldToChunk(x, y);
  const c = w.ws.get(cx, cy);
  const { x0, y0 } = chunkOrigin(cx, cy);
  const i = localIdx(x - x0, y - y0);
  const o = c.obj[i];
  if (MINEABLE[o]) {
    c.obj[i] = O.NONE; c.dirty = true;
    return { res: MINEABLE[o], qty: o === O.ROCK ? rint(rng, 1, 2) : rint(rng, 1, 3) };
  }
  if (CHOPPABLE.has(o)) {
    // 砍树留桩；倒下的树成为地上的原木——搬运、加工是接下来的事（材料是真的）
    c.obj[i] = o === O.TREE ? O.STUMP : O.NONE; c.dirty = true;
    const n = o === O.TREE ? rint(rng, 1, 2) : 1;
    return { res: 'log', qty: dropLogs(w, x, y, n, rng) };
  }
  if (o === O.BUSH) {
    c.obj[i] = O.NONE; c.dirty = true;
    return { res: 'berry', qty: rint(rng, 1, 3) };
  }
  if (o === O.CROP3) {
    c.obj[i] = O.NONE; c.crops.delete(i); c.dirty = true;
    c.ground[i] = G.SOIL;
    return { res: 'crop', qty: rint(rng, 2, 4) };
  }
  if (o === O.CHEST) {
    c.obj[i] = O.NONE; c.dirty = true;
    return { res: 'gold', qty: rint(rng, 30, 80) };
  }
  return null;
}

// 每日自然生长：委托 tickChunkCool（遍历 WARM+ chunk：作物成熟/树桩回生/零星长树石）
export function growCropsDaily(w, weatherType, rng) {
  w.ws.forEachWarm(c => tickChunkCool(c, { rng, weatherType, dayDelta: 1 }, 1));
}

// 区域名（含居民住宅名），供 AI 快照与日志使用
export function nameAt(w, x, y) {
  for (const h of w.houses) {
    if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h.ownerName ? h.ownerName + '家' : '民宅';
  }
  for (const a of w.areas) {
    if (x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h) return a.name;
  }
  return '小镇郊野';
}
export function areaCenter(w, areaId) {
  const a = w.areas.find(v => v.id === areaId);
  if (!a) return null;
  return { x: a.x + Math.floor(a.w / 2), y: a.y + Math.floor(a.h / 2) };
}
export function randPointInArea(w, areaId, rng) {
  const a = w.areas.find(v => v.id === areaId);
  if (!a) return null;
  for (let k = 0; k < 30; k++) {
    const x = a.x + Math.floor(rng() * a.w), y = a.y + Math.floor(rng() * a.h);
    if (walkable(w, x, y)) return { x, y };
  }
  return null;
}
// 找区域内某种物件
export function findObjInArea(w, areaId, objTypes, rng) {
  const a = w.areas.find(v => v.id === areaId);
  if (!a) return null;
  const hits = [];
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    if (objTypes.includes(getObj(w, x, y))) hits.push({ x, y });
  }
  if (!hits.length) return null;
  return hits[Math.floor(rng() * hits.length) % hits.length];
}
export function nearestObjAround(w, x, y, objTypes, maxR) {
  let best = null, bd = maxR * maxR;
  for (let dy = -maxR; dy <= maxR; dy++) for (let dx = -maxR; dx <= maxR; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!chunkHas(w, nx, ny)) continue;
    if (!objTypes.includes(getObj(w, nx, ny))) continue;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = { x: nx, y: ny }; }
  }
  return best;
}

// ---------- 居民自主营造：选址与树桩再生 ----------
// 营造选址校验：只许草地/泥地上的空地；房屋与农田外扩1格保护（门洞留通道）
export function canPlaceSite(w, x, y) {
  if (!chunkHas(w, x, y)) return false;
  const g = getGround(w, x, y);
  if (g !== G.GRASS && g !== G.DIRT) return false;
  const o = getObj(w, x, y);
  if (o !== O.NONE && o !== O.FLOWER && o !== O.RUIN) return false;   // 废墟清了就能重建
  for (const h of w.houses) {
    if (x >= h.x - 1 && x < h.x + h.w + 1 && y >= h.y - 1 && y < h.y + h.h + 1) return false;
  }
  const f = w.areas.find(a => a.id === 'farm');
  if (f && x >= f.x - 1 && x < f.x + f.w + 1 && y >= f.y - 1 && y < f.y + f.h + 1) return false;
  return true;
}
// 在锚点附近找一处可营造空地（不与现有计划相邻重叠）
export function findSiteNear(w, cx, cy, rng, plans, tries = 90) {
  for (let k = 0; k < tries; k++) {
    const r = 3 + Math.floor(rng() * 14);
    const ang = rng() * Math.PI * 2;
    const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
    if (!canPlaceSite(w, x, y)) continue;
    if (plans && plans.some(p => !p.done && Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1)) continue;
    return { x, y };
  }
  return null;
}
// 树桩按概率回生成树（prob 传入 0~1；selftest 可传 1 强制）
export function regrowStumps(w, rng, prob = 0.05) {
  let n = 0;
  w.ws.forEachWarm(c => {
    for (let i = 0; i < CHUNK_AREA; i++) {
      if (c.obj[i] === O.STUMP && rng() < prob) { c.obj[i] = O.TREE; c.dirty = true; n++; }
    }
  });
  return n;
}
