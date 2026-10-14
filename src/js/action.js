// action.js —— 开放动作结构：动词是任意字符串，不是枚举
// 职责：把"一个行为者想干什么"翻译成动作对象，交给裁决层，然后把物理结果记进行为者的记忆。
// 本层不判断动作"合不合法该不该做"——那是裁决层的事；本层只做翻译和记录。

import { adjudicate, isMatter } from './adjudicator.js';
import { nameFor, nameMatter, makeMatter } from './matter.js';
import { maybeIncident, captureIncident, DISCOVERY } from './discovery.js';
import { giveGoods } from './hold.js';
import { STOCK_NAME } from './core.js';

// ---------- 开放动作总开关（回滚保险，v4.1） ----------
// false → 清单外动作回退旧行为（契约降级 idle）；true → 走通用裁决路径。
// 裁决层稳定前出问题，拨回 false 即退回 v4.0 行为，无需改码。
export const OPEN_ACTIONS = { enabled: true };

// ---------- 世界物质索引（v4.1：目标解析的第一块硬骨头） ----------
// 世界上散置的、可被动作指认的物质实例登记处。词库对照的物理锚点：
// NPC 说出的名词在这里有或没有一个实例。v4.2 意外发现、v4.3 知识都从这里长。
const MATTER_CAP = 800;   // 有限律：世界的尘埃也要有上限

export function registerMatter(game, m) {
  if (!game) return m;
  if (!game.matters) game.matters = [];   // 老存档惰性升级
  game.matters.push(m);
  if (game.matters.length > MATTER_CAP) game.matters.shift();   // 最老的尘埃落定
  return m;
}

// 复合目标拆分：「野草和汤」是两个东西（只认连接词，不做语义——语义是词库层的事）
const TARGET_JOINERS = /[和与跟、，,／/]+/;

/**
 * 目标解析四级（名字是指针，指到谁算谁）：
 * 1. 已是物质实例或 NPC（有 needs）→ 原样通过
 * 2. 字符串是在场 NPC 的名字 → 指到那个人（人是动作的合法目标，v4.8.0）
 * 3. 字符串在册（任何 NPC 给某物质起过这个名；行为者自己起过的优先）→ 指到那个实例
 * 4. 查不到 → 落地为「未审之物」：中性属性的新实例，以行为者给它的名入册。
 *    NPC 对世界的每一次指指点点都在给世界添东西；它的真实属性等物理来填。
 * @param {Array} raw 目标列表（物质实例 / NPC / 字符串）
 * @param {*} actor 行为者
 * @param {*} game 世界（带 matters 登记处；可空——空则只过第 1 级）
 */
export function resolveTargets(raw, actor, game) {
  const out = [];
  for (const t of (Array.isArray(raw) ? raw : (raw != null ? [raw] : []))) {
    if (isMatter(t) || (t && t.needs)) { out.push(t); continue; }
    if (typeof t !== 'string') continue;   // 非物非词（如坐标对象）——裁决层自己会忽略
    for (const word of t.split(TARGET_JOINERS)) {
      const wname = word.trim();
      if (!wname) continue;
      // 第 2 级：在场的人（名字是全网最短的指针）
      const person = (game && game.npcs || []).find(n => n.name === wname && !n.dying);
      if (person) { out.push(person); continue; }
      const matters = (game && game.matters) || [];
      const aid = actor && actor.id != null ? actor.id : null;
      const hit = (aid != null && matters.find(m => m.names[aid] === wname))
        || matters.find(m => Object.values(m.names).includes(wname));
      if (hit) { out.push(hit); continue; }
      // 第 4 级：未审之物——量 1，其余槽 0（没被审视过的东西没有已测属性）
      const fresh = makeMatter([1], null);
      if (aid != null) nameMatter(aid, fresh, wname);
      registerMatter(game, fresh);
      out.push(fresh);
    }
  }
  return out;
}

// ---------- 资源原型（v4.8.0 归属物理的锚点） ----------
// 每种库存资源在物质登记处有一个「原型」——NPC 嘴里说的「粮食」「金币」都指到它。
// 原型不入任何人手里；它是名字与资源键之间的桥。动词透明：目标格局决定物理后果。
export function ensureResourcePrototypes(game) {
  if (!game) return;
  game.matters = game.matters || [];
  for (const res of Object.keys(STOCK_NAME)) {
    if (game.matters.some(m => m.prototypeRes === res)) continue;
    const proto = makeMatter([1], null);
    proto.prototypeRes = res;
    nameMatter('town', proto, STOCK_NAME[res]);   // 公名：全镇都这么叫
    registerMatter(game, proto);
  }
}

/**
 * 构造动作对象
 * @param {*} actor 行为者（NPC 实例或任何带 id 的对象）
 * @param {string} verb 动词——任意字符串，不设清单
 * @param {Array} targets 目标列表（物质实例 / 任何对象）
 * @param {{cost?:number, causeDay?:number, reason?:string}} opts
 */
export function makeAction(actor, verb, targets, opts = {}) {
  return {
    actor,
    verb: String(verb == null ? '' : verb),
    targets: Array.isArray(targets) ? targets : (targets != null ? [targets] : []),
    cost: typeof opts.cost === 'number' ? opts.cost : 0,
    causeDay: typeof opts.causeDay === 'number' ? opts.causeDay : undefined,
    reason: opts.reason || '',
  };
}

/**
 * 宽容解析：接受字符串 / {verb|action|do, target|targets, ...} / 空
 * 字符串整句当动词——能解析"说了什么"，解析不出"对什么"
 * （从一句话里认出目标物质，需要世界物质索引+词库，那是 v4.1 全量的活；皮试阶段目标由调用方给）
 * @returns {object|null} 动作对象；raw 为空返回 null
 */
export function parseAction(raw, actor, world) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    return s ? makeAction(actor, s, [], { reason: raw }) : null;
  }
  if (typeof raw === 'object') {
    const verb = raw.verb != null ? raw.verb : (raw.action != null ? raw.action : raw.do);
    const targets = Array.isArray(raw.targets) ? raw.targets : (raw.target != null ? [raw.target] : []);
    return makeAction(actor, verb, targets, raw);
  }
  return null;
}

// —— 记忆文本：人叫名字；资源原型叫公名；其余物质用行为者自己起过的名字，没起过就是"一样东西"
function nameOf(actor, m) {
  if (m && m.needs && m.name) return m.name;                                  // 人
  if (m && m.prototypeRes) return STOCK_NAME[m.prototypeRes] || m.prototypeRes; // 资源原型（公名）
  const id = actor && actor.id != null ? actor.id : null;
  const n = id != null && isMatter(m) ? nameFor(id, m) : null;
  return n || (isMatter(m) && m.names ? m.names.town : null) || '一样东西';
}

// 槽位变化的物理说法——只对应已承诺的槽位语义（6=含水 7=能量），其余槽只说"变了"
function slotWord(slot, from, to) {
  const up = to > from;
  if (slot === 7) return up ? '变热了' : '变冷了';
  if (slot === 6) return up ? '变湿了' : '变干了';
  return '变了';
}

function describe(actor, action, verdict) {
  if (!verdict.legal) return `想${action.verb || '做点什么'}，没成（${verdict.reason}）`;
  const names = action.targets.map(t => nameOf(actor, t));
  let text = names.length ? `${action.verb}了${names.join('和')}` : (action.verb || '做了点什么');
  // v4.8.0 归属转移先于人话说清：什么东西到了谁手里
  if (verdict.moves && verdict.moves.length) {
    const bits = verdict.moves.map(mv => `${STOCK_NAME[mv.res] || mv.res}×${mv.qty}到了${mv.toName}手里`);
    return text + '，' + bits.join('，');
  }
  if (!verdict.effects.length) return text + '，没什么变化';
  const seen = [];
  for (const e of verdict.effects) {
    seen.push(nameOf(actor, e.target) + slotWord(e.slot, e.from, e.to));
  }
  return text + '，' + seen.join('，');
}

// 归属物理的射程：东西易手要近身（空间定理），最远 8 格
const HAND_REACH = 8;

/**
 * 派发：裁决 → 归属转移通道 → 写进行为者记忆 → v4.2 概率性捕获为 incident
 * 归属转移通道（v4.8.0 基底之上全开放）：动词透明——不问动词问格局。
 * 格局 = 目标里同时有「行为者持有的资源原型」和「另一个近身的人」→ 一份资源易手。
 * 「给/塞/递/扔/换」在物理上是同一件事；赊欠与等价是记忆与观念层的事，不归这里。
 * @returns {object} 裁决结果 {legal, reason, effects, moves?, ...}
 */
export function dispatch(action, world) {
  if (!action) return { legal: false, reason: '空动作', effects: [] };
  const verdict = adjudicate(action, world);
  const actor = action.actor;
  // —— 归属转移通道 ——
  if (verdict.legal && actor && actor.needs) {
    const npcT = (action.targets || []).find(t => t && t.needs && t.id != null && t !== actor && !t.dying);
    const protoT = (action.targets || []).find(t => t && t.prototypeRes);
    if (npcT && protoT) {
      const dist = Math.abs((actor.x || 0) - (npcT.x || 0)) + Math.abs((actor.y || 0) - (npcT.y || 0));
      if (dist <= HAND_REACH) {
        const moved = giveGoods(actor, npcT, protoT.prototypeRes, 1);
        if (moved > 0) verdict.moves = [{ res: protoT.prototypeRes, from: actor.id, to: npcT.id, toName: npcT.name, qty: moved }];
      }
    }
  }
  if (actor && typeof actor.memory === 'function') {
    const day = world && world.clock ? world.clock.totalDay : 0;
    const hour = world && world.clock ? world.clock.hour : 0;
    actor.memory(describe(actor, action, verdict), day, hour);
  }
  // v4.2 发现层：开放动作本身就是探索行为，概率性捕获为 incident
  // （天道退役后，NPC 自己的尝试是技能的唯一来源——不依赖物理数值变化）
  if (DISCOVERY.enabled && verdict.legal) {
    const rng = world && typeof world.rng === 'function' ? world.rng : Math.random;
    const inc = maybeIncident(actor, action, verdict, world, rng);
    if (inc) captureIncident(actor, inc, world);
  }
  return verdict;
}
