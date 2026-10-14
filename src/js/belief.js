// belief.js —— 信念层（v4.9.0 · 感知与名望，决议录 D39）
// 设计来源：Talk of the Town 信念四元组（命题+来源+时间戳+置信度）、Dwarf Fortress 传闻逐跳、
// 果蝇蘑菇体 valence 标签（FlyWire 2024：13.9 万神经元的果蝇都有世界表征，镇民不能没有）。
// 核心原则：
//   1. 信念是 NPC 以为的世界——允许错误与过时：人搬走了，信念还在。误知是真实世界的特征。
//   2. 机制只管传播/衰减/覆盖，信念文本全从事件来，无主题白名单（基底之上全开放）。
//   3. 目击 > 听闻：亲眼所见 conf 0.9 不被传闻覆盖；传闻可以被目击推翻。
//   4. 复述自增强：说出口的信念，自己更信（Talk of the Town）。
// （环境无关，game 提供上下文）
import { clamp, chance, choice } from './core.js';
import { distortText } from './history.js';

// ---------- 常量（有限律） ----------
const BELIEF_CAP = 12;         // 单 NPC 信念上限（挤弱留强）
const BELIEF_SPREAD_P = 0.10;  // 聊天时传一条信念的概率
const HOP_DECAY = 0.8;         // 每转一手，置信度打折
const DAY_DECAY = 0.985;       // 每日自然衰减
const REHEARSE_BOOST = 0.05;   // 复述自增强
const FORGET_CONF = 0.15;      // 低于则遗忘（静默——遗忘不写记忆）
export const WITNESS_CONF = 0.9;   // 亲眼所见的分量

// ---------- 写入 ----------
// opts: { src('亲眼'|来源名), dir(方向词|null), conf, day, hops }
export function addBelief(npc, text, opts) {
  const o = opts || {};
  const t = String(text || '').trim().slice(0, 30);
  if (!t) return null;
  npc.beliefs = npc.beliefs || [];
  const src = o.src || '听说';
  const conf = clamp(o.conf != null ? o.conf : 0.5, 0, 1);
  const day = o.day || 1;
  // 同文去重：亲眼把置信度顶到 0.9（目击覆盖听闻）；传闻不撼动亲眼
  const dup = npc.beliefs.find(b => b.text === t);
  if (dup) {
    if (src === '亲眼') { dup.conf = WITNESS_CONF; dup.src = '亲眼'; dup.day = day; }
    else if (dup.src !== '亲眼' && conf > dup.conf) { dup.conf = conf; dup.day = day; dup.src = src; }
    return dup;
  }
  const b = { text: t, dir: o.dir || null, src, day, conf, hops: o.hops || 0 };
  npc.beliefs.push(b);
  // 有限律：挤弱留强
  while (npc.beliefs.length > BELIEF_CAP) {
    let weakest = 0;
    for (let i = 1; i < npc.beliefs.length; i++) {
      if (npc.beliefs[i].conf < npc.beliefs[weakest].conf) weakest = i;
    }
    npc.beliefs.splice(weakest, 1);
  }
  return b;
}

// ---------- 传播（聊天时） ----------
// a 把一条拿得出手的信念讲给 b：逐跳衰减，第三手起话可能走样；a 自己越讲越信
export function spreadBelief(a, b, game, day) {
  if (!game || !game.rng) return null;
  if (!a.beliefs || !a.beliefs.length) return null;
  if (!chance(game.rng, BELIEF_SPREAD_P)) return null;
  const worthy = a.beliefs.filter(x => x.conf >= 0.4);
  if (!worthy.length) return null;
  const src = choice(game.rng, worthy);
  // 第三手起，话走样（口述物理，复用传闻网变形）
  let text = src.text;
  if ((src.hops || 0) >= 2) text = distortText(game, text);
  const heard = addBelief(b, text, {
    src: a.name, dir: src.dir, day,
    conf: src.conf * HOP_DECAY, hops: (src.hops || 0) + 1
  });
  // 复述自增强：说出口的自己更信
  src.conf = clamp(src.conf + REHEARSE_BOOST, 0, 1);
  if (heard) b.memory(`听${a.name}说起：${text}`, day, game.clock ? game.clock.hour : 6);
  return heard;
}

// ---------- 日推进 ----------
// 衰减与遗忘都是纯函数——不占骰流（D34）；遗忘是静默的，日子久了就想不起来了
export function beliefDaily(game, day) {
  for (const n of game.npcs || []) {
    if (!n.beliefs || !n.beliefs.length) continue;
    for (const b of n.beliefs) b.conf = +(b.conf * DAY_DECAY).toFixed(4);
    n.beliefs = n.beliefs.filter(b => b.conf >= FORGET_CONF);
  }
}
