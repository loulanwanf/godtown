// discovery.js —— 发现层（v4.2 · 天道退役）
// 设计来自计划书第十一章重构：意外不是被设计的，是日常行为的副产品。系统只做捕获，不做生成。
// 四件事：
//   1. maybeIncident    动作产生非空 effects（有物理变化）时，概率性捕获为 incident
//   2. captureIncident 把 incident 写进行为者的 isIncident 记忆 + incidents 索引
//   3. maybeRepeat      行为者概率性重复这个动作（重复是固化的前提）
//   4. maybeSpread      邻居概率性学到这个动作（传播）
// 系统从不主动设计意外。意外只在 NPC 与物质接触时自己长出来。
// captureDiscoveries 扫 NPC 记忆识别"被多人重复的 incident 模式" → game.discoveries，替代旧 scanGaps 的缺口扫描角色。
// 红线：本层不生成任何内容，不查动作清单，不编台词。它只看物理层给出了什么变化。

import { isMatter } from './adjudicator.js';
import { nameFor } from './matter.js';

// ---------- 发现层总开关（回滚保险，v4.2） ----------
// false → 天道在岗：evolveDaily 仍调 proposeDaily（scanGaps+scriptPropose 缺口扫描），dispatch 不捕获 incident。
// true  → 天道退役：evolveDaily 不调 proposeDaily，改调 captureDiscoveries；dispatch 在 effects 非空时捕获 incident。
// 发现层出问题，拨回 false 即退回 v4.1 行为，无需改码。
export const DISCOVERY = { enabled: true };

// ---------- 概率漏斗（有限律：不是所有 incident 都进记忆，否则记忆爆炸） ----------
const INCIDENT_CAPTURE_P = 0.25;    // 捕获概率：有物理变化的动作只有 1/4 被记为 incident
const INCIDENT_REPEAT_P = 0.08;    // 重复概率：被捕获的 incident 只有 8% 概率被行为者再试一次
const INCIDENT_SPREAD_P = 0.04;    // 传播概率：邻居只有 4% 概率学到
const SKILL_REPEAT_THRESHOLD = 2;  // 成型阈值：被同一 NPC 重复达此次数，captureDiscoveries 才认它"成型"
const SKILL_SPREAD_THRESHOLD = 2;   // 成型阈值：被这么多人拥有，captureDiscoveries 才认它"成型"
const SPREAD_RADIUS = 6;            // 传播半径：观察者得在行为者附近才能学（因果：看不见学不会）
const INCIDENT_MEM_CAP = 12;        // 单个 NPC 的 incident 索引上限（有限律）
const DISCOVERIES_CAP = 60;         // 全镇 discoveries 上限（有限律）

function rngOf(world) {
  return (world && typeof world.rng === 'function') ? world.rng : Math.random;
}

function dayOf(world) {
  return (world && world.clock && typeof world.clock.totalDay === 'number') ? world.clock.totalDay : 0;
}
function hourOf(world) {
  return (world && world.clock && typeof world.clock.hour === 'number') ? world.clock.hour : 0;
}

// 行为者给过的名字优先（词在册指到同一实例；未审之物用 NPC 起的名）
function targetLabel(actor, t) {
  if (!t) return null;
  if (isMatter(t)) {
    const id = actor && actor.id != null ? actor.id : null;
    const n = id != null ? nameFor(id, t) : null;
    return n || '一样东西';
  }
  return String(t);
}

/**
 * 判定一个动作结果是不是 incident（意外）
 * 基准：物理裁决给出非空 effects（有物理变化）。是否"意外"由概率漏斗过滤——
 * 日常动作也有效果，但只有 1/4 被捕获；被捕获后还要经重复/传播漏斗才成型。
 * 这本身就是"意外的过滤器"：日常动作偶尔被捕获但很难成型，新颖动作因 NPC 反复尝试而累积。
 * @param {*} npc     行为者
 * @param {*} action 动作对象（{verb, targets, ...}）
 * @param {*} verdict 裁决结果（{legal, effects, ...}）
 * @param {*} world   世界上下文（取 clock / rng）
 * @param {*} [rng]   随机源（不传则取 world.rng / Math.random）
 * @returns {object|null} incident 对象；null 不捕获
 */
export function maybeIncident(npc, action, verdict, world, rng) {
  if (!DISCOVERY.enabled) return null;
  if (!action || !action.actor || !verdict || !verdict.legal) return null;
  // 意外不依赖物理数值变化——NPC 尝试新事物本身就是意外。
  // 接触后"没变化"也是一种发现（原来这俩放一起没用），一样值得记住和传播。
  const r = (typeof rng === 'function') ? rng() : rngOf(world)();
  if (r > INCIDENT_CAPTURE_P) return null;
  const actor = action.actor;
  const targetNames = (action.targets || []).map(t => targetLabel(actor, t)).filter(Boolean);
  // 存行为者位置快照——maybeSpread 要据此判定空间邻接，但行为者日后可能已离开或身故
  const actorPos = (typeof actor.x === 'number' && typeof actor.y === 'number')
    ? { x: actor.x, y: actor.y } : null;
  return {
    actorId: npc ? (npc.id != null ? npc.id : null) : null,
    verb: String(action.verb || ''),
    targetNames,
    slotChanges: (verdict.effects || []).map(e => ({ slot: e.slot, from: e.from, to: e.to })),
    day: dayOf(world),
    hour: hourOf(world),
    actorPos,
    repeats: 0,                 // 被原创者重复次数（captureDiscoveries 每天 maybeRepeat 推进）
    spreadTo: (npc && npc.id != null) ? [npc.id] : []   // 谁会这门（含原创；maybeSpread 扩展）
  };
}

/**
 * 把 incident 写进 NPC 的 isIncident 记忆 + incidents 索引
 * 记忆走 npc.memory（染色/漂移/压抑都生效）；incidents 是独立索引，不挤占 memories 上限 40。
 * @param {*} npc      行为者
 * @param {*} incident maybeIncident 的返回
 * @param {*} world    上下文
 */
export function captureIncident(npc, incident, world) {
  if (!DISCOVERY.enabled || !npc || !incident) return;
  if (typeof npc.memory !== 'function') return;
  const day = incident.day != null ? incident.day : dayOf(world);
  const hour = incident.hour != null ? incident.hour : hourOf(world);
  const tname = incident.targetNames.length ? incident.targetNames.join('和') : '一样东西';
  const slotDesc = incident.slotChanges.length
    ? '（' + incident.slotChanges.map(c => `槽${c.slot}:${c.from}→${c.to}`).join(' ') + '）'
    : '';
  const text = `${incident.verb}了${tname}${slotDesc}`;
  // isIncident 透传给 makeMemory（recentMemories 检索时优先）
  if (typeof npc.memory === 'function' && npc.memory.length >= 4) {
    // npc.memory(text, totalDay, hour, mood, opts) —— 第 5 参透传 isIncident
    npc.memory(text, day, hour, 60, { isIncident: true, incidentId: incident.actorId });
  } else {
    npc.memory(text, day, hour, 60);
  }
  // 独立索引：captureDiscoveries 检索用，不挤占 memories
  if (!Array.isArray(npc.incidents)) npc.incidents = [];
  npc.incidents.push({ ...incident, text, memDay: day });
  while (npc.incidents.length > INCIDENT_MEM_CAP) npc.incidents.shift();
}

/**
 * NPC 概率性重复一个 incident（重复是固化的前提）
 * 只重复自己经历过的：原创者可重复；学到的（spreadTo 含自己）才可能重复。
 * @returns {boolean} true 表示 NPC 决定再试一次（调用方据此触发动作）
 */
export function maybeRepeat(npc, incident, world, rng) {
  if (!DISCOVERY.enabled || !npc || !incident) return false;
  if (npc.body && npc.body.ageYears < 6) return false;       // 婴幼儿不学手艺
  if (npc.dying) return false;                              // 临终不试新
  // 只重复自己经历过的
  if (incident.actorId != null && npc.id !== incident.actorId) {
    if (!incident.spreadTo.includes(npc.id)) return false;   // 没学到不会重复
  }
  const r = (typeof rng === 'function') ? rng() : rngOf(world)();
  return r <= INCIDENT_REPEAT_P;
}

/**
 * 邻居概率性学到 incident
 * 观察者得在行为者附近（SPREAD_RADIUS 内）才能学——因果：看不见学不会。
 * 婴幼儿、临终者不学。
 * @returns {boolean} true 表示观察者学到了（调用方据此把 observer 加入 spreadTo）
 */
export function maybeSpread(observer, actor, incident, world, rng) {
  if (!DISCOVERY.enabled || !observer || !actor || !incident) return false;
  if (observer.id === actor.id) return false;               // 不观察自己
  if (observer.body && observer.body.ageYears < 6) return false;  // 婴幼儿不学手艺
  if (observer.dying) return false;                         // 临终不学
  if (incident.spreadTo.includes(observer.id)) return false;      // 已学到
  // 空间邻接（因果：看不见学不会）——双方都必须有坐标，否则不传播
  if (typeof actor.x !== 'number' || typeof observer.x !== 'number') return false;
  const dx = Math.abs(actor.x - observer.x), dy = Math.abs(actor.y - observer.y);
  if (dx > SPREAD_RADIUS || dy > SPREAD_RADIUS) return false;
  const r = (typeof rng === 'function') ? rng() : rngOf(world)();
  return r <= INCIDENT_SPREAD_P;
}

/**
 * 从 NPC 记忆识别"新技能"（game.js onNewDay 调用，替代 proposeDaily 的缺口扫描角色）
 * 三步：
 *   1. 推进 repeat：对每个 incident，maybeRepeat 概率性给 inc.repeats++（NPC 又试了一次）
 *   2. 推进 spread：对每个 incident，附近 NPC 概率性学到——学到的在 observer.incidents 加一份副本
 *   3. 聚类识别：按 (verb+目标名+槽位变化模式) 分桶；b.total = 桶里 incident 数 + repeats 之和；
 *      b.total ≥ SKILL_REPEAT_THRESHOLD 且 spreadTo 人数 ≥ SKILL_SPREAD_THRESHOLD → 成型，记进 game.discoveries
 * 天道退役：这里没有任何"系统主动找缺口"的逻辑——技能只从 NPC 自己长出来的行为里识别。
 * @returns {Array} 本次新识别的技能清单
 */
export function captureDiscoveries(game) {
  if (!DISCOVERY.enabled) return [];
  if (!game || !game.npcs) return [];
  const rng = rngOf(game);
  const day = dayOf(game);
  if (!Array.isArray(game.discoveries)) game.discoveries = [];

  // —— 步骤 1：推进 repeat（每个 NPC 概率性再试自己的 incident）——
  for (const n of game.npcs || []) {
    for (const inc of (n.incidents || [])) {
      if (maybeRepeat(n, inc, game, rng)) inc.repeats++;
    }
  }
  // —— 步骤 2：推进 spread（每个 incident 的附近 NPC 概率性学到，学到的在 observer.incidents 加副本）——
  for (const n of game.npcs || []) {
    for (const inc of (n.incidents || [])) {
      if (!inc.actorPos) continue;     // 没位置快照的不传播
      const stubActor = { id: inc.actorId, x: inc.actorPos.x, y: inc.actorPos.y };
      for (const o of game.npcs || []) {
        if (!maybeSpread(o, stubActor, inc, game, rng)) continue;
        inc.spreadTo.push(o.id);
        // 学到的在 observer.incidents 加一份副本（actorId 保持原创者；副本也可被 maybeRepeat 推进）
        if (!Array.isArray(o.incidents)) o.incidents = [];
        // 去重：observer 已有同类副本就不重复加（避免同一份被传播多次）
        const key = inc.verb + '|' + (inc.targetNames || []).join('+') + '|' + (inc.slotChanges || []).map(c => c.slot).join(',');
        if (!o.incidents.some(x => (x.verb + '|' + (x.targetNames || []).join('+') + '|' + (x.slotChanges || []).map(c => c.slot).join(',')) === key)) {
          o.incidents.push({ ...inc, spreadTo: inc.spreadTo.slice(), memDay: day });
          while (o.incidents.length > INCIDENT_MEM_CAP) o.incidents.shift();
        }
      }
    }
  }

  // —— 步骤 3：聚类识别 ——
  const known = new Set(game.discoveries.map(d => d.verb + '|' + d.targetNames.join('+') + '|' + d.slots.join(',')));
  const buckets = new Map();
  for (const n of game.npcs || []) {
    for (const inc of (n.incidents || [])) {
      const key = inc.verb + '|' + (inc.targetNames || []).join('+') + '|' + (inc.slotChanges || []).map(c => c.slot).join(',');
      if (!buckets.has(key)) buckets.set(key, {
        verb: inc.verb, targetNames: (inc.targetNames || []).slice(), slots: (inc.slotChanges || []).map(c => c.slot),
        spreadTo: new Set(), total: 0, firstDay: inc.day
      });
      const b = buckets.get(key);
      for (const id of (inc.spreadTo || [])) b.spreadTo.add(id);
      b.total += 1 + (inc.repeats || 0);   // 每个 incident 代表 1 次动作 + 被推进的额外次数
    }
  }
  const fresh = [];
  for (const [key, b] of buckets) {
    if (b.total < SKILL_REPEAT_THRESHOLD) continue;
    if (b.spreadTo.size < SKILL_SPREAD_THRESHOLD) continue;
    if (known.has(key)) continue;
    if (!game._discSeq) game._discSeq = 0;
    game._discSeq++;
    const d = {
      id: 'disc_' + String(game._discSeq).padStart(4, '0'),
      verb: b.verb,
      targetNames: b.targetNames.slice(),
      slots: b.slots.slice(),
      spreadTo: [...b.spreadTo],
      total: b.total,
      bornDay: day,
      firstDay: b.firstDay
    };
    game.discoveries.push(d);
    while (game.discoveries.length > DISCOVERIES_CAP) game.discoveries.shift();   // 有限律：旧技能会退役
    fresh.push(d);
  }
  return fresh;
}

// ---------- 存档往返 ----------
// incidents 索引随 NPC 走，但不挤占 NPC 序列化——统一由 discovery 存档收口
export function serializeDiscovery(game) {
  const incidentsByNpc = {};
  for (const n of (game.npcs || [])) {
    if (n.id != null && Array.isArray(n.incidents) && n.incidents.length) {
      incidentsByNpc[n.id] = n.incidents;
    }
  }
  return {
    discoveries: game.discoveries || [],
    seq: game._discSeq || 0,
    incidentsByNpc
  };
}
export function hydrateDiscovery(game, data) {
  game.discoveries = (data && data.discoveries) || [];
  game._discSeq = (data && data.seq) || 0;
  const byNpc = (data && data.incidentsByNpc) || {};
  for (const n of (game.npcs || [])) {
    if (n.id != null && Array.isArray(byNpc[n.id])) {
      n.incidents = byNpc[n.id];
    }
  }
}
