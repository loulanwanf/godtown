// chunk.js - 区块系统：无限地图的核心（环境无关，与 world.js 同层）
// 严格按《无限地图与模型池与虚假记忆》计划书第一步实现
// 用户四点反馈已融入：
//   1. tile 访问 5 函数：getGround/getObj/setGround/setObj/chunkHas（地面/物件分拆）
//   2. 热点路径性能铁律：drawChunk/growCropsDaily/regrowStumps 等先取 chunk 引用，chunk 内循环直接 c.ground[localIdx]
//   3. 起源边界：CHUNK=64，起源 2×2 chunk=128×128，城镇 72×72 横跨 4 chunk 部分区域。genChunk 先 genWildChunk 填满，后 originGen 覆盖 x∈[0,71]&&y∈[0,71]
//   4. AI 演化 v2.4.0 不在本轮
import {
  G, O, BLOCK_OBJ, MINEABLE, CHOPPABLE,
  mulberry32, hash2, rint, chance, clamp
} from './core.js';

export const CHUNK = 64;
export const CHUNK_AREA = 4096;

// 区块温度状态：VIRGIN 未生成 → COLD 已生成未激活 → COOL → WARM → HOT（NPC 在的）
export const ST = { VIRGIN: 0, COLD: 1, COOL: 2, WARM: 3, HOT: 4 };

// ---------- 坐标转换 ----------
// 世界坐标 → chunk 坐标 [cx, cy]
export function worldToChunk(tx, ty) {
  return [Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)];
}
// chunk 坐标 → 该 chunk 左上角的世界坐标
export function chunkOrigin(cx, cy) {
  return { x0: cx * CHUNK, y0: cy * CHUNK };
}
// chunk 内本地坐标 → 本地索引 0..4095
export function localIdx(lx, ly) {
  return ly * CHUNK + lx;
}
// 世界坐标 → {cx, cy, lx, ly}（一次性拿全）
export function chunkKeyOf(tx, ty) {
  const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
  return { cx, cy, lx: tx - cx * CHUNK, ly: ty - cy * CHUNK };
}

// ---------- 种子派生 ----------
// 确定性：同 worldSeed + 同 (cx,cy) 永远派生同一个 chunk 种子
function hashCoord(cx, cy) {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
export function chunkSeed(worldSeed, cx, cy) {
  return (worldSeed ^ hashCoord(cx, cy)) >>> 0;
}

// ---------- 起源判定 ----------
// 起源 2×2 chunk：(0,0)(1,0)(0,1)(1,1)，城镇 72×72 横跨其部分区域
export function isOriginChunk(cx, cy) {
  return (cx === 0 || cx === 1) && (cy === 0 || cy === 1);
}

// ---------- 野外生成 ----------
// 草地基底 + 树林斑块 + 零星石/矿/花/浆果
// 用世界坐标 hash2+sin 噪声，跨 chunk 连贯，不引第三方库
// 不生成跨 chunk 河流（连贯河流需全局协调，留给起源区南河）
export function genWildChunk(chunk, worldSeed) {
  const { cx, cy } = chunk;
  const { x0, y0 } = chunkOrigin(cx, cy);
  const origin = isOriginChunk(cx, cy);

  // 1) 草地基底
  for (let i = 0; i < CHUNK_AREA; i++) chunk.ground[i] = G.GRASS;

  // 2) 树林斑块 + 零星物件
  for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
    const i = localIdx(lx, ly);
    const g = chunk.ground[i];
    const tx = x0 + lx, ty = y0 + ly;
    const r = hash2(tx, ty);
    // 树林斑块：世界坐标 sin 噪声，跨 chunk 连贯
    const forest = Math.sin(tx * 0.12) * Math.cos(ty * 0.11);
    if (g === G.GRASS) {
      if (forest > 0.35 && r < 0.5) { chunk.obj[i] = O.TREE; continue; }
      if (r < 0.015) { chunk.obj[i] = O.ROCK; continue; }
      if (r < 0.035) { chunk.obj[i] = O.FLOWER; continue; }
      if (r < 0.05) { chunk.obj[i] = O.BUSH; continue; }
      // 远离起源的 chunk 有零星矿物
      if (!origin && r < 0.062) {
        const mr = hash2(tx + 7, ty + 13);
        chunk.obj[i] = mr < 0.5 ? O.COPPER : (mr < 0.82 ? O.IRON : O.GOLD);
        continue;
      }
    }
  }

  chunk.dirty = true;
}

// ---------- 区块生成 ----------
// genChunk(worldSeed, cx, cy, opt) → chunk
// opt.originGen(chunk, worldSeed) 回调注入城镇生成（由 world.js 提供，保持 chunk.js 不依赖城镇布局）
// 起源 chunk：先 genWildChunk 填满 64×64，后 originGen 覆盖 x∈[0,71]&&y∈[0,71] 范围（城镇盖掉野地，多出的 56×56 保持野地）
export function genChunk(worldSeed, cx, cy, opt = {}) {
  const chunk = {
    cx, cy,
    ground: new Uint8Array(CHUNK_AREA),
    obj: new Uint8Array(CHUNK_AREA),
    crops: new Map(),      // localIdx -> {stage:0-3, plantedDay, watered}
    houses: [],            // 该 chunk 内的房屋（起源 chunk 才有）
    state: ST.COLD,
    dirty: false,
    lastHotMin: 0,
    lastWarmMin: 0,
    lastAccess: 0
  };
  // 先填满野地（起源 chunk 也会被填，随后被 originGen 覆盖城镇部分）
  genWildChunk(chunk, worldSeed);
  // 起源 chunk：让 originGen 覆盖城镇范围
  if (isOriginChunk(cx, cy) && typeof opt.originGen === 'function') {
    opt.originGen(chunk, worldSeed);
  }
  chunk.dirty = true;
  return chunk;
}

// ---------- WorkingSet：运行期区块持有与冷热管理 ----------
const DEFAULT_CAPACITY = 256;   // 最多同时驻留 256 个 chunk（≈2MB ground+obj + crops/houses）

export class WorkingSet {
  constructor(worldSeed, opt = {}) {
    this.worldSeed = worldSeed;
    this.opt = opt;                 // { originGen, capacity }
    this.capacity = opt.capacity || DEFAULT_CAPACITY;
    this.map = new Map();           // key "cx,cy" -> chunk
    this.clock = 0;                 // 游戏分钟数（由 game.js 推进）
  }

  static _key(cx, cy) { return cx + ',' + cy; }

  // 只读，不生成；未持有返回 null
  get(cx, cy) {
    const c = this.map.get(WorkingSet._key(cx, cy));
    if (c) c.lastAccess = this.clock;
    return c || null;
  }

  // VIRGIN → COLD：生成并驻留
  getOrGen(cx, cy) {
    const k = WorkingSet._key(cx, cy);
    let c = this.map.get(k);
    if (c) { c.lastAccess = this.clock; return c; }
    c = genChunk(this.worldSeed, cx, cy, this.opt);
    c.lastAccess = this.clock;
    this.map.set(k, c);
    this.evictIfNeeded();
    return c;
  }

  // 语义"我要操作它"：同 getOrGen
  ensure(cx, cy) {
    return this.getOrGen(cx, cy);
  }

  // 驱逐（释放内存）
  drop(cx, cy) {
    this.map.delete(WorkingSet._key(cx, cy));
  }

  // 是否已生成（非 VIRGIN）
  has(cx, cy) {
    const c = this.map.get(WorkingSet._key(cx, cy));
    return !!c && c.state !== ST.VIRGIN;
  }

  // 遍历所有非 VIRGIN chunk（确定性顺序：按 key 排序）
  *iterNonVirgin() {
    const keys = Array.from(this.map.keys()).sort();
    for (const k of keys) {
      const c = this.map.get(k);
      if (c && c.state !== ST.VIRGIN) yield c;
    }
  }

  // 按温度遍历
  forEachHot(fn) {
    for (const c of this.iterNonVirgin()) if (c.state === ST.HOT) fn(c);
  }
  forEachWarm(fn) {
    for (const c of this.iterNonVirgin()) {
      if (c.state === ST.WARM || c.state === ST.HOT) fn(c);
    }
  }
  forEachCool(fn) {
    for (const c of this.iterNonVirgin()) {
      if (c.state >= ST.COOL) fn(c);
    }
  }

  // 容量超限时 LRU 驱逐（只驱逐 COLD/COOL，保留 WARM/HOT）
  evictIfNeeded() {
    if (this.map.size <= this.capacity) return;
    // 收集可驱逐的（COLD/COOL）
    const victims = [];
    for (const [k, c] of this.map) {
      if (c.state === ST.COLD || c.state === ST.COOL) victims.push([k, c.lastAccess]);
    }
    victims.sort((a, b) => a[1] - b[1]);   // 最老的在前
    for (const [k] of victims) {
      if (this.map.size <= this.capacity) break;
      this.map.delete(k);
    }
  }

  // ---------- 状态机 ----------
  promoteToHot(cx, cy) {
    const c = this.get(cx, cy);
    if (c) { c.state = ST.HOT; c.lastHotMin = this.clock; }
  }
  promoteToWarm(cx, cy) {
    const c = this.get(cx, cy);
    if (c && c.state < ST.WARM) { c.state = ST.WARM; c.lastWarmMin = this.clock; }
  }
  // 降级：HOT→WARM→COOL→COLD（按超时阈值）
  coolDown(cx, cy, hotTimeout, warmTimeout, coolTimeout) {
    const c = this.get(cx, cy);
    if (!c) return;
    const idle = this.clock - Math.max(c.lastHotMin, c.lastWarmMin);
    if (c.state === ST.HOT && idle > hotTimeout) c.state = ST.WARM;
    else if (c.state === ST.WARM && idle > warmTimeout) c.state = ST.COOL;
    else if (c.state === ST.COOL && idle > coolTimeout) c.state = ST.COLD;
  }
  // 强制冷冻（保留数据，仅降状态）
  freeze(cx, cy) {
    const c = this.get(cx, cy);
    if (c && c.state !== ST.VIRGIN) c.state = ST.COLD;
  }
}

// ---------- 5 个 tile 访问函数（运行期：NPC/渲染/寻路用） ----------
// 用户反馈：地面/物件分拆读写，不是一个合并的 getTile
// 未持有 chunk：getGround/getObj 返回 0（草地/空地默认），chunkHas 返回 false

export function getGround(w, x, y) {
  const [cx, cy] = worldToChunk(x, y);
  const c = w.ws.get(cx, cy);
  if (!c) return G.GRASS;
  const { x0, y0 } = chunkOrigin(cx, cy);
  return c.ground[localIdx(x - x0, y - y0)];
}
export function getObj(w, x, y) {
  const [cx, cy] = worldToChunk(x, y);
  const c = w.ws.get(cx, cy);
  if (!c) return O.NONE;
  const { x0, y0 } = chunkOrigin(cx, cy);
  return c.obj[localIdx(x - x0, y - y0)];
}
export function setGround(w, x, y, g) {
  const [cx, cy] = worldToChunk(x, y);
  const c = w.ws.ensure(cx, cy);
  const { x0, y0 } = chunkOrigin(cx, cy);
  const i = localIdx(x - x0, y - y0);
  if (c.ground[i] === G.WATER && g !== G.WATER) c.obj[i] = O.NONE;
  c.ground[i] = g;
  c.dirty = true;
  return true;
}
export function setObj(w, x, y, o) {
  const [cx, cy] = worldToChunk(x, y);
  const c = w.ws.ensure(cx, cy);
  const { x0, y0 } = chunkOrigin(cx, cy);
  const i = localIdx(x - x0, y - y0);
  if (c.obj[i] === O.WALL || c.obj[i] === O.DOOR || c.obj[i] === O.FOUNTAIN || c.obj[i] === O.STALL) return false;
  c.obj[i] = o;
  c.dirty = true;
  return true;
}
// 替代旧 inB：判断坐标处的 chunk 是否已生成（未生成=不可走/不存在）
export function chunkHas(w, x, y) {
  const [cx, cy] = worldToChunk(x, y);
  return w.ws.has(cx, cy);
}

// ---------- 序列化 ----------
// 只存非 VIRGIN + dirty 的 chunk；Uint8Array 转 Array 以便 JSON
export function serializeChunks(ws) {
  const out = [];
  for (const c of ws.iterNonVirgin()) {
    if (!c.dirty) continue;
    const cropsArr = [];
    for (const [i, v] of c.crops) cropsArr.push([i, { ...v }]);
    out.push({
      cx: c.cx, cy: c.cy, state: c.state,
      ground: Array.from(c.ground),
      obj: Array.from(c.obj),
      crops: cropsArr,
      houses: c.houses.map(h => ({ ...h }))
    });
  }
  return out;
}

// 反序列化：覆盖（起源 chunk 先由 genWorld 生成，再用存档覆盖）
export function hydrateChunks(ws, data) {
  if (!data || !Array.isArray(data)) return;
  for (const e of data) {
    const k = WorkingSet._key(e.cx, e.cy);
    let c = ws.map.get(k);
    if (!c) {
      // 未生成的 chunk 直接重建（不跑 originGen——用存档数据覆盖即可）
      c = {
        cx: e.cx, cy: e.cy,
        ground: new Uint8Array(CHUNK_AREA),
        obj: new Uint8Array(CHUNK_AREA),
        crops: new Map(),
        houses: [],
        state: e.state || ST.COLD,
        dirty: true,
        lastHotMin: 0, lastWarmMin: 0, lastAccess: 0
      };
      ws.map.set(k, c);
    }
    if (e.ground) c.ground.set(e.ground);
    if (e.obj) c.obj.set(e.obj);
    if (e.crops) {
      c.crops.clear();
      for (const [i, v] of e.crops) c.crops.set(i, { ...v });
    }
    if (e.houses) c.houses = e.houses.map(h => ({ ...h }));
    if (e.state !== undefined) c.state = e.state;
    c.dirty = true;
  }
}

// ---------- chunk tick ----------
// tickChunkWarm：逐小时背景 tick（仅 WARM+ chunk 由 game.js 调用）
// ctx: { rng, weatherType, clock }
// 逐小时：树桩低概率回生（不碰作物——作物按天长，避免与 tickChunkCool 冲突）
export function tickChunkWarm(c, ctx, dtMin) {
  if (!c || c.state < ST.WARM) return;
  const { rng } = ctx;
  // 树桩低概率回生（每小时 ~0.2%）
  const regrowProb = 0.002 * dtMin;
  if (regrowProb > 0) {
    for (let i = 0; i < CHUNK_AREA; i++) {
      if (c.obj[i] === O.STUMP && rng() < regrowProb) { c.obj[i] = O.TREE; c.dirty = true; }
    }
  }
}

// tickChunkCool：逐天主生长 tick（COOL+ chunk 由 game.js 调用）
// ctx: { rng, weatherType, dayDelta }
// 逐天：作物成熟 / 树桩回生 / 零星长树石 / 矿区回生
export function tickChunkCool(c, ctx, dayDelta = 1) {
  if (!c || c.state < ST.COOL) return;
  const { rng, weatherType } = ctx;
  const rainy = weatherType === 'rain' || weatherType === 'storm';

  // 1) 作物生长：遍历该 chunk 的 crops
  for (const [i, crop] of c.crops) {
    const watered = rainy || crop.watered;
    if (watered || chance(rng, 0.5)) {
      crop.stage = Math.min(3, crop.stage + dayDelta);
      const o = c.obj[i];
      if (o >= O.CROP0 && o <= O.CROP3) c.obj[i] = O.CROP0 + crop.stage;
    }
    crop.watered = false;
  }

  // 2) 树桩回生：概率 0.05 * dayDelta
  const stumpProb = 0.05 * dayDelta;
  for (let i = 0; i < CHUNK_AREA; i++) {
    if (c.obj[i] === O.STUMP && rng() < stumpProb) { c.obj[i] = O.TREE; c.dirty = true; }
  }

  // 3) 零星长树：草地随机长 dayDelta 棵
  const { x0, y0 } = chunkOrigin(c.cx, c.cy);
  for (let k = 0; k < dayDelta; k++) {
    const lx = Math.floor(rng() * CHUNK), ly = Math.floor(rng() * CHUNK);
    const i = localIdx(lx, ly);
    if (c.ground[i] === G.GRASS && c.obj[i] === O.NONE && rng() < 0.5) { c.obj[i] = O.TREE; c.dirty = true; }
  }
  // 4) 零星长石：泥地低概率
  for (let k = 0; k < dayDelta; k++) {
    const lx = Math.floor(rng() * CHUNK), ly = Math.floor(rng() * CHUNK);
    const i = localIdx(lx, ly);
    if (c.ground[i] === G.DIRT && c.obj[i] === O.NONE && rng() < 0.4) { c.obj[i] = O.ROCK; c.dirty = true; }
  }
}
