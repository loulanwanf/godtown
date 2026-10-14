// scene.js - 院落场景：房屋落成后的生活痕迹（篱笆段/职业道具/门前路/花）
// 只在新镇生成时跑一次；装饰只落在草地空位，不碰道路/水面/广场，不封死门前通道
// v2.1.0：chunk 接口改造——废 ground/obj 解构，改用 5 个 tile 访问函数
import { G, O } from './core.js';
import { mulberry32, rint, chance } from './core.js';
import { chunkHas, getGround, getObj, setGround, setObj } from './chunk.js';

// 职业 -> 院落道具
const JOB_PROP = {
  农夫: O.LOGPILE,
  樵夫: O.LOGPILE,
  铁匠: O.ANVIL,
  渔夫: O.BARREL,
  厨子: O.BARREL,
  商人: O.BARREL
};

// 为所有住宅生成院落（rng 外部传入保证确定性）
export function decorateYards(w, roster, rng) {
  w.houses.forEach((h, i) => {
    const job = roster[i] ? roster[i].job : null;
    decorateHouse(w, h, job, rng);
  });
}

// 确定性独立种子的便捷入口（selftest 用）
export function decorateYardsSeeded(w, roster, seed) {
  const rng = mulberry32(seed ^ 0x5deece66d);
  decorateYards(w, roster, rng);
}

function decorateHouse(w, h, job, rng) {
  const free = (x, y) => chunkHas(w, x, y) && getGround(w, x, y) === G.GRASS
    && (getObj(w, x, y) === O.NONE || getObj(w, x, y) === O.FLOWER);

  // 1) 门前 3 格小径 + 通道保护列
  const doorFront = [];
  for (let k = 1; k <= 3; k++) {
    const x = h.doorX, y = h.y + h.h - 1 + k;
    if (chunkHas(w, x, y)) {
      if (getGround(w, x, y) === G.GRASS) setGround(w, x, y, G.PATH);
      doorFront.push([x, y]);
    }
  }
  const isDoorPath = (x, y) => x === h.doorX && y >= h.y + h.h && y <= h.y + h.h + 2;

  // 2) 收集贴房环（距离 1）候选格，分侧/后/前
  const sides = [], back = [];
  for (let y = h.y - 1; y <= h.y + h.h + 1; y++) {
    for (let x = h.x - 1; x <= h.x + h.w + 1; x++) {
      if (!chunkHas(w, x, y)) continue;
      // 跳过房子本体
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) continue;
      if (isDoorPath(x, y)) continue;
      if (!free(x, y)) continue;
      const onSide = (x === h.x - 1 || x === h.x + h.w) && y >= h.y && y < h.y + h.h;
      const onBack = y === h.y - 1 && x >= h.x - 1 && x <= h.x + h.w;
      if (onSide) sides.push([x, y]);
      else if (onBack) back.push([x, y]);
    }
  }

  // 3) 篱笆段：两侧各 1-2 段，后侧 0-2 段（片段化，不围死）
  const fenceSpots = [];
  for (const list of [sides, sides, back]) {
    if (!list.length) continue;
    const n = list === back ? rint(rng, 0, 2) : rint(rng, 1, 2);
    for (let k = 0; k < n; k++) {
      const p = list[Math.floor(rng() * list.length)];
      if (p && !fenceSpots.some(q => q[0] === p[0] && q[1] === p[1])) fenceSpots.push(p);
    }
  }
  for (const [x, y] of fenceSpots) setObj(w, x, y, O.FENCE);

  // 4) 职业道具：贴房环上优先，其次外扩 1 圈
  const prop = JOB_PROP[job];
  if (prop) {
    const ring = [...sides, ...back];
    const outer = [];
    let spot = pickFree(w, ring, rng);
    if (!spot) {
      for (let y = h.y - 2; y <= h.y + h.h + 2; y++) for (let x = h.x - 2; x <= h.x + h.w + 2; x++) {
        if (free(x, y) && !isDoorPath(x, y)) outer.push([x, y]);
      }
      spot = pickFree(w, outer, rng);
    }
    if (spot) setObj(w, spot[0], spot[1], prop);
  }

  // 5) 野花 1-3 株（医生/诗人更多）
  const flowerN = (job === '医生' || job === '诗人') ? rint(rng, 2, 4) : rint(rng, 1, 3);
  const all = [];
  for (let y = h.y - 2; y <= h.y + h.h + 3; y++) for (let x = h.x - 2; x <= h.x + h.w + 2; x++) {
    if (free(x, y) && !isDoorPath(x, y)) all.push([x, y]);
  }
  for (let k = 0; k < flowerN && all.length; k++) {
    const p = all.splice(Math.floor(rng() * all.length), 1)[0];
    setObj(w, p[0], p[1], O.FLOWER);
  }
}

function pickFree(w, list, rng) {
  const cand = list.filter(([x, y]) => {
    const o = getObj(w, x, y);
    return o === O.NONE || o === O.FLOWER;
  });
  if (!cand.length) return null;
  return cand[Math.floor(rng() * cand.length)];
}
