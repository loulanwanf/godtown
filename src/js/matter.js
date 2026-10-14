// matter.js —— 物质层：世界只有"一坨数字"，名字由 NPC 涌现
// 混合方案（见改造决议录 D1）：底层无名数字数组 + 语义层涌现命名
// 所有组合/分离/转化都必须过 axioms.checkConservation —— 不守恒的操作被拒绝。

import { checkConservation, isExtensive } from './axioms.js';
import { O } from './core.js';

// 属性槽位数：固定 16 槽，含义不预设。
// 槽位语义由种子表给出初始对应（src:'seed'），之后世界可以自己扩展解读。
export const ATTR_DIMS = 16;

let _nextId = 1;

/**
 * 创建一个物质实例
 * @param {ArrayLike<number>} attrs 属性数组（长度 ≤ ATTR_DIMS，缺的补 0）
 * @param {{x:number,y:number}|null} pos 位置
 * @returns {{id:string, attrs:Float64Array, pos:*, holder:*, names:Object, born: number}}
 */
export function makeMatter(attrs, pos = null) {
  const a = new Float64Array(ATTR_DIMS);
  const n = Math.min(attrs ? attrs.length : 0, ATTR_DIMS);
  for (let i = 0; i < n; i++) a[i] = attrs[i];
  return {
    id: 'm' + (_nextId++),
    attrs: a,
    pos,
    holder: null,        // 谁拿着它（null = 在世界上）
    names: {},           // 涌现命名：{ npcId: '叫法' } —— 同一物质可有多个名字
    born: 0,             // 诞生于第几日（由调用方填）
  };
}

/**
 * 组合两个物质：
 * - 广延槽（量/含水/能量）相加——两堆东西合起来更多
 * - 强度槽（硬/燃/食/耕/金属性）按量加权平均——硬东西和软东西混合不会变更硬
 * 过守恒检查（只查广延槽——强度量本来就不守恒）
 */
export function combine(a, b, opts = {}) {
  const out = makeMatter(null, opts.pos || a.pos);
  const wa = a.attrs[0] || 0, wb = b.attrs[0] || 0, wsum = wa + wb;
  for (let i = 0; i < ATTR_DIMS; i++) {
    if (isExtensive(i)) {
      out.attrs[i] = a.attrs[i] + b.attrs[i];
    } else {
      // 强度槽按量加权；两方都没量时取算术平均
      out.attrs[i] = wsum > 1e-9 ? (a.attrs[i] * wa + b.attrs[i] * wb) / wsum : (a.attrs[i] + b.attrs[i]) / 2;
    }
  }
  const chk = checkConservation([a, b], [out]);
  if (!chk.ok) return { ok: false, reason: '组合被守恒拦截：' + chk.reason };
  // 涌现命名不自动继承——新物质是"无名之物"，等 NPC 起名
  return { ok: true, reason: chk.reason, result: out };
}

/**
 * 分离：按 ratios 把 m 拆成多份（ratios 之和必须为 1，容差 1e-6）
 * 广延槽按比例分（半杯水水量减半），强度槽每份复制（半杯水一样热）
 */
export function separate(m, ratios) {
  const total = ratios.reduce((s, r) => s + r, 0);
  if (Math.abs(total - 1) > 1e-6) {
    return { ok: false, reason: `分离比例之和 ${total} ≠ 1——不许凭空增减` };
  }
  const parts = ratios.map(r => {
    const p = makeMatter(null, m.pos);
    for (let i = 0; i < ATTR_DIMS; i++) {
      p.attrs[i] = isExtensive(i) ? m.attrs[i] * r : m.attrs[i];
    }
    return p;
  });
  const chk = checkConservation([m], parts);
  if (!chk.ok) return { ok: false, reason: '分离被守恒拦截：' + chk.reason };
  return { ok: true, reason: chk.reason, parts };
}

/**
 * 转化：广延槽之间的转移（总量不变，形态改变）
 * 强度槽不可转移——"硬度"不能倒给别的东西；强度改变只能等反应（v4.1 裁决层）
 * @param {object} m 物质
 * @param {Array<[number, number, number]>} moves [fromSlot, toSlot, amount] 列表
 * @returns {{ok:boolean, reason:string}}
 */
export function transform(m, moves) {
  const before = makeMatter(null); before.attrs.set(m.attrs);
  for (const [from, to, amt] of moves) {
    if (from === to) continue;
    if (!isExtensive(from) || !isExtensive(to)) {
      return { ok: false, reason: `强度槽不可转移（槽 ${!isExtensive(from) ? from : to}）——它只能等反应改变` };
    }
    if (m.attrs[from] < amt - 1e-6) {
      return { ok: false, reason: `槽 ${from} 储量 ${m.attrs[from]} 不够转出 ${amt}` };
    }
    m.attrs[from] -= amt;
    m.attrs[to] += amt;
  }
  const chk = checkConservation([before], [m], 'total');  // 转化允许广延槽间互换，只守恒总量
  if (!chk.ok) return { ok: false, reason: '转化被守恒拦截：' + chk.reason };
  return { ok: true, reason: chk.reason };
}

/**
 * 接触：两个物质放在一起，广延量（含水/能量）沿梯度流动，趋向均衡
 * ——冷的变热、干的变湿。流量 = 差值 × rate，一加一减，总量守恒。
 * 量（槽 0）不随接触流动（贴着石头不会变出石头）；强度槽不变（贴着硬物不会变硬）。
 * 这是"把石头扔进火里，石头变热"的物理本体——不需要"燃烧规则"，换热自己会发生。
 * @param {object} a @param {object} b 两个物质实例（原地修改）
 * @param {number} rate 换热/换湿速率 0-1（0.5 = 一次接触双方到中点）
 */
export function contact(a, b, rate = 0.5) {
  const beforeA = makeMatter(null); beforeA.attrs.set(a.attrs);
  const beforeB = makeMatter(null); beforeB.attrs.set(b.attrs);
  for (let i = 0; i < ATTR_DIMS; i++) {
    if (!isExtensive(i) || i === 0) continue;  // 量不流动
    const flow = (b.attrs[i] - a.attrs[i]) * rate;
    a.attrs[i] += flow;
    b.attrs[i] -= flow;
  }
  const chk = checkConservation([beforeA, beforeB], [a, b], 'total');
  if (!chk.ok) return { ok: false, reason: '接触被守恒拦截：' + chk.reason };
  return { ok: true, reason: chk.reason };
}

/** 读属性槽 */
export function getAttr(m, i) { return m.attrs[i] || 0; }
/** 写属性槽（直接写不进守恒——仅初始化/世界生成期使用，运行时改动必须走 transform） */
export function setAttr(m, i, v) { m.attrs[i] = v; }

/** 两物质的槽位距离（欧氏）——用于"这两东西像不像"的物理判断 */
export function diff(a, b) {
  let s = 0;
  for (let i = 0; i < ATTR_DIMS; i++) { const d = a.attrs[i] - b.attrs[i]; s += d * d; }
  return Math.sqrt(s);
}

/**
 * 涌现命名：NPC 给物质起名。名字是指针，不是属性。
 * 同一物质可被不同 NPC 叫不同名字——一词多物、一物多词都是真实。
 */
export function nameMatter(npcId, m, name) {
  m.names[npcId] = name;
  return m;
}

/** 查询某 NPC 对某物质的叫法（没起过名返回 null——"不知道这是什么"是合法状态） */
export function nameFor(npcId, m) { return m.names[npcId] || null; }

/**
 * 种子物质表 —— 大爆炸初始条件（用户裁决 D6：减到 4 种，推翻 12 种）
 * 12 种带着"已知世界"的痕迹（木/石/铜/铁是把现在的世界分类，是内容不是种子）。
 * 真正的大爆炸只给氢和氦——这里只给 A/B/C/D 四种基本存在物，纯数字组合，无任何语义预设。
 * "木""石"能不能被长出来，让组合自己推；长不出来也是"没有保底"的代价。
 *
 * 槽位约定（广延 0/6/7；强度 1-5；8-15 留给世界）：
 *   0=量  1=硬质  2=可燃  3=可食  4=可耕  5=金属性  6=含水  7=能量
 */
export const SEED_MATTERS = Object.freeze({
  // A：轻、极可燃、高能——类似氢的位置
  A: { attrs: [1, 0.1, 0.9, 0.0, 0.0, 0.0, 0.0, 0.8], src: 'seed' },
  // B：重、惰性、稳定——类似氦的位置
  B: { attrs: [2, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1], src: 'seed' },
  // C：沉、硬、带金属性——类似恒星灰烬的位置
  C: { attrs: [3, 0.7, 0.0, 0.0, 0.3, 0.5, 0.0, 0.2], src: 'seed' },
  // D：湿、软、可食可耕——类似生命原料的位置
  D: { attrs: [1, 0.0, 0.1, 0.5, 0.5, 0.0, 0.9, 0.3], src: 'seed' },
});

/** 从种子表生成一个物质实例（世界开局/迁移用，运行时不调） */
export function fromSeed(key, pos = null) {
  const s = SEED_MATTERS[key];
  if (!s) return null;
  return makeMatter(s.attrs, pos);
}

// ---------- 从世界物件类型推导物质属性（物理推导，非内容） ----------
// 物件的物理属性从 4 种基本存在物（SEED_MATTERS A/B/C/D）派生，不硬编码"铁""木头"之类的名字。
// 有机物→D（湿软可燃）/ 矿物→C（坚硬惰性带金属性）/ 人工结构→B（稳定惰性）
const OBJ_MATTER_MAP = {
  // 有机物：树/灌木/花/作物 → D 类（高含水、有能量、可燃）
  [O.TREE]: 'D', [O.BUSH]: 'D', [O.FLOWER]: 'D',
  [O.CROP0]: 'D', [O.CROP1]: 'D', [O.CROP2]: 'D', [O.CROP3]: 'D',
  // 矿物：岩石/铜/铁/金 → C 类（坚硬、惰性、带金属性）
  [O.ROCK]: 'C', [O.COPPER]: 'C', [O.IRON]: 'C', [O.GOLD]: 'C',
  // 人工结构：墙/门/栅栏/喷泉 → B 类（稳定、惰性）
  [O.WALL]: 'B', [O.DOOR]: 'B', [O.FENCE]: 'B', [O.FOUNTAIN]: 'B',
};
export function matterFromObjType(objType, x, y) {
  const key = OBJ_MATTER_MAP[objType];
  if (!key) return null;
  return fromSeed(key, x != null ? { x, y } : null);
}

// ---------- 存档：名字是 NPC 起的，读档不该让这个世界失忆 ----------
export function serializeMatter(m) {
  return { id: m.id, attrs: Array.from(m.attrs), pos: m.pos, holder: m.holder, names: m.names, born: m.born };
}
/** 从存档复活物质实例；同时把 id 计数器推过存档最大值——新旧实例 id 不许撞车 */
export function reviveMatter(d) {
  const m = makeMatter(d.attrs || [], d.pos || null);
  m.id = d.id;
  m.holder = d.holder != null ? d.holder : null;
  m.names = d.names || {};
  m.born = d.born || 0;
  const mm = /^m(\d+)$/.exec(d.id || '');
  if (mm && +mm[1] >= _nextId) _nextId = +mm[1] + 1;
  return m;
}
