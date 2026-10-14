// core.js - 常量、随机数、通用工具（环境无关：渲染层与 selftest 共用）

export const TILE = 16;
export const CHUNK = 64;   // 区块边长（无限地图基本单元）

// 地面类型
export const G = { GRASS: 0, DIRT: 1, PATH: 2, STONE: 3, WATER: 4, SAND: 5, SOIL: 6, BRIDGE: 7 };
export const G_NAME = ['草地', '泥地', '道路', '石板', '河水', '沙岸', '耕地', '木桥'];

// 物件类型
export const O = {
  NONE: 0, TREE: 1, ROCK: 2, COPPER: 3, IRON: 4, GOLD: 5,
  WALL: 6, DOOR: 7, FENCE: 8, FOUNTAIN: 9, FLOWER: 10, BUSH: 11,
  CHEST: 12, STALL: 13, CRATER: 14,
  CROP0: 20, CROP1: 21, CROP2: 22, CROP3: 23,
  STUMP: 24, SHED: 25, BENCH: 26, LAMP: 27, SITE: 28,
  BARREL: 29, LOGPILE: 30, ANVIL: 31, GRAVE: 32,
  LOG: 33, BARN: 34, WORKSHOP: 35, RUIN: 36, CABIN: 37
};
export const O_NAME = {
  0: '空地', 1: '树', 2: '石头', 3: '铜矿', 4: '铁矿', 5: '金矿',
  6: '屋墙', 7: '门', 8: '栅栏', 9: '喷泉', 10: '野花', 11: '浆果丛',
  12: '宝箱', 13: '货摊', 14: '陨石坑',
  20: '幼苗', 21: '青苗', 22: '将熟作物', 23: '成熟作物',
  24: '树桩', 25: '小棚屋', 26: '长凳', 27: '路灯', 28: '工地',
  29: '木桶', 30: '柴堆', 31: '铁砧', 32: '坟茔',
  33: '原木', 34: '仓库', 35: '木匠坊', 36: '废墟', 37: '林间小屋'
};
// 阻挡寻路的物件（原木躺地上，可跨过——物流不该堵路）
export const BLOCK_OBJ = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 25, 26, 27, 29, 30, 31, 32, 34, 35, 36, 37]);
// 居民可以"采集"的物件
export const MINEABLE = { 2: 'stone', 3: 'copper', 4: 'iron', 5: 'gold' };
export const CHOPPABLE = new Set([1, 24]);
// 产出革命（v2.9.0）：采集对象全集——由 MINEABLE/CHOPPABLE 派生组装（单一事实源，不写第二份硬编码）
// 浆果丛/熟庄稼/宝箱也是对象驱动的体能活；浇水照料单独处理（CROP0-2 不在此列）
export const GATHER_OBJS = [...Object.keys(MINEABLE).map(Number), ...CHOPPABLE, 11, 23, 12];

// ---------- 动作原语层（v3.0.0 过程革命：干什么活有什么动作，原地站着不算干活） ----------
// v4.1 起：本表是「常用原语快捷方式」，不再是唯一入口——决策层的动词已不设清单（action.js）；
// 本表只管渲染：世界目前会给这些动作编舞。清单外动作的动画（从属性推导精灵）归 v4.5 呈现层。
// 铁律层只登记「人会做的动作原语」与「渲染参数模板」——这是物理机制（人有手会挥会压会拉）；
// 「什么活计用什么动作」是内容：采集挂在世界对象上（OBJ_MOTION，石头要砸、树要砍），
// 加工挂在配方定义上（def.motion，演化引擎提案时从原语名册里选，validateRecipe 校验）。
// rate=动作循环/秒（渲染层按真实时间推进相位）；fx=命中瞬间溅出的粒子种类；tool=默认手持工具。
export const MOTION_PRIMS = {
  swing: { rate: 1.1,  fx: 'chip',   tool: 'axe'  },   // 挥劈：砍树、割庄稼
  smash: { rate: 0.85, fx: 'stone',  tool: 'pick' },   // 抡砸：挖矿、锻打、敲钉子
  pull:  { rate: 0.5,  fx: 'splash', tool: 'rod'  },   // 拉拽：钓鱼收竿
  stir:  { rate: 1.3,  fx: 'dust',   tool: 'stick'},   // 搅舂：搅锅、捣料
  knead: { rate: 1.0,  fx: 'dust',   tool: 'hand' },   // 揉压：手工通式（演化配方缺省落点）
  tend:  { rate: 0.75, fx: 'drop',   tool: 'hand' },   // 俯身照料：浇水、除草、摘果
  saw:   { rate: 1.0,  fx: 'chip',   tool: 'saw'  }    // 拉锯：锯木
};
// 渲染层目前认识的手持工具（常用快捷方式，不是封闭清单——新工具的渲染归 v4.5 呈现层）
export const MOTION_TOOLS = ['hand', 'axe', 'pick', 'rod', 'hammer', 'saw', 'stick'];
// 世界对象受什么动作（世界物理：对象决定产出，也决定怎么下手）
// 覆盖全部 GATHER_OBJS + 未熟作物（CROP0-2 浇水照料）
export const OBJ_MOTION = {
  [O.ROCK]: { prim: 'smash', tool: 'pick' },
  [O.COPPER]: { prim: 'smash', tool: 'pick' },
  [O.IRON]: { prim: 'smash', tool: 'pick' },
  [O.GOLD]: { prim: 'smash', tool: 'pick' },
  [O.TREE]: { prim: 'swing', tool: 'axe' },
  [O.STUMP]: { prim: 'swing', tool: 'axe' },
  [O.BUSH]: { prim: 'tend', tool: 'hand' },
  [O.CHEST]: { prim: 'smash', tool: 'hand' },
  [O.CROP0]: { prim: 'tend', tool: 'hand' },
  [O.CROP1]: { prim: 'tend', tool: 'hand' },
  [O.CROP2]: { prim: 'tend', tool: 'hand' },
  [O.CROP3]: { prim: 'swing', tool: 'hand' }
};
// 解析动作：prim 必须在名册内；tool 缺省/非法落回 prim 默认
export function motionFor(prim, tool) {
  const P = MOTION_PRIMS[prim];
  if (!P) return null;
  return { prim, tool: MOTION_TOOLS.includes(tool) ? tool : P.tool, rate: P.rate, fx: P.fx };
}
export function motionForObj(ov) {
  const om = OBJ_MOTION[ov];
  return om ? motionFor(om.prim, om.tool) : null;
}
// 配方的动作：def.motion 由演化引擎设定；老档/缺省落「揉压」手工通式（不报错，降级翻译）
export function motionOf(def) {
  const mo = def && def.motion;
  return motionFor(mo && mo.prim, mo && mo.tool) || motionFor('knead');
}

// 物质层常量（第五章·材料是真的：每一环有人/时间/地点，运输本身是一件事）
export const MAT = {
  CARRY: 2,            // 一次扛几根原木/几块木板（负重上限）
  LOGS_PER_PLANK: 3,   // 3 根原木出 2 块木板（加工有损耗）
  PLANKS_PER_BATCH: 2,
  MILL_MIN: 110,       // 加工一炉工时（游戏分钟）
  CRAFT_MIN: 90,       // 配方一批活的基础工时（产出革命：批完成才扣料产出，mult 只压时间不增量）
  REPAIR_MIN: 55,      // 修一处破损的工时
  BARN_CAP: 60,        // 仓库容量上限
  WS_LOG_CAP: 12,      // 木匠坊原木堆上限
  ROTTEN_RAIN: 0.3,    // 雨天一根散落原木烂掉的概率
  STOLEN: 0.03         // 仓库被偷概率（每日）
};
// 居民自主营造计划（v1.7.0：材料立项时从仓库预订，需搬抵工地才能施工）
export const PLAN_KINDS = {
  shed:     { name: '储物棚', obj: 25, need: 180, mat: { wood: 6 },  matLabel: '木板6' },
  bench:    { name: '长凳',   obj: 26, need: 70,  mat: { wood: 2 },  matLabel: '木板2' },
  lamp:     { name: '路灯',   obj: 27, need: 60,  mat: { wood: 1, stone: 2 }, matLabel: '木板1+石料2' },
  stall:    { name: '货摊',   obj: 13, need: 130, mat: { wood: 4 },  matLabel: '木板4' },
  farm:     { name: '开垦',   obj: 0,  need: 100, mat: {},           matLabel: '仅需劳力' },
  barn:     { name: '仓库',   obj: 34, need: 260, mat: { wood: 8 },  matLabel: '木板8', once: true },
  workshop: { name: '木匠坊', obj: 35, need: 200, mat: { wood: 6 },  matLabel: '木板6', once: true },
  cabin:    { name: '林间小屋', obj: 37, need: 320, mat: { wood: 10 }, matLabel: '木板10' }
};

// 季节与天气
export const SEASONS = ['春', '夏', '秋', '冬'];
export const WEATHERS = { sunny: '晴朗', cloudy: '多云', rain: '降雨', storm: '暴风雨', snow: '降雪' };
export const WEATHER_ORDER = ['sunny', 'cloudy', 'rain', 'storm', 'snow'];

// 镇库资源中文名
export const STOCK_NAME = { gold: '金币', wood: '木材', stone: '石料', copper: '铜矿', iron: '铁矿', goldOre: '金矿', fish: '鲜鱼', crop: '粮食', berry: '浆果' };

export const AREA_DEFS = [
  { id: 'plaza',  name: '镇中心广场', x: 30, y: 20, w: 13, h: 13 },
  { id: 'market', name: '集市街',     x: 50, y: 22, w: 10, h: 8 },
  { id: 'farm',   name: '南郊农田',   x: 13, y: 45, w: 26, h: 18 },
  { id: 'mine',   name: '北岭矿区',   x: 49, y: 4,  w: 19, h: 15 },
  { id: 'forest', name: '西边树林',   x: 4,  y: 6,  w: 20, h: 30 },
  { id: 'river',  name: '南河河畔',   x: 6,  y: 64, w: 62, h: 7 }
];

// ---- 随机数（可播种，保证自检确定性） ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function choice(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
export function rint(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
export function chance(rng, p) { return rng() < p; }
// 简单坐标哈希（用于地面纹理抖动）
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- 时间格式 ----
export function fmtClock(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// ---- 极简事件发射器 ----
export function makeEmitter() {
  const map = new Map();
  return {
    on(evt, fn) { if (!map.has(evt)) map.set(evt, []); map.get(evt).push(fn); },
    emit(evt, ...args) { const l = map.get(evt); if (l) for (const fn of l) fn(...args); }
  };
}

// 单点世界坐标哈希（用于无限地图的确定性纹理抖动等）
export function worldHash(worldSeed, tx, ty) {
  let h = (worldSeed ^ ((tx * 374761393 + ty * 668265263) | 0)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
