// social.js - 社会层（v1.6.0，计划书第三章·六、十二，第十五章第四遍）
// 一、关系是独立对象：每段关系有自己的历史——亲密度/信任/亏欠/怨恨/恐惧/依赖六个独立维度，
//     标签（可互相矛盾），共同记忆，未说出口的话，最后一次互动，误解。
// 二、最重要的是误解：A 以为和 B 是好朋友，B 觉得只是认识——这个不对称永远不会自动对齐。
// 三、每段关系是单向存储的：A 对 B 的关系，和 B 对 A 的关系，是两个独立对象。
// 四、习俗：聊天是规矩走的路——形成、传播、冲突（倔的人不买账）。
// 五、权力：说话算数的人不是任命的，是别人对他的信任/忌惮/依赖堆出来的。
// 六、人口流动：推力（冲突/孤独/野心）把人推出去，拉力（繁荣/声望）把人拉进来。
import { clamp, rint, chance, choice } from './core.js';
import { dominantConflict } from './secret.js';
import { relMark } from './history.js';
import { pickLex } from './lexicon.js';
import { spreadIdea } from './idea.js';

// ---------- 关系对象 ----------
// bond：六维聚合成一个 -100..100 的综合好感（写回 npc.relations 供婚配/葬礼/快照等旧链路使用）
export function bond(rel) {
  return clamp(Math.round(
    rel.close * 0.6 + rel.trust * 0.4 + rel.owe * 0.12 + rel.depend * 0.15
    - rel.grudge * 0.55 - rel.fear * 0.25
  ), -100, 100);
}
export function makeRelation(oid, val, day) {
  return {
    o: oid,
    close: clamp(val, -100, 100),        // 亲密度
    trust: clamp(val, -100, 100),        // 信任
    owe: 0,          // 亏欠（我欠他的）
    grudge: 0,       // 怨恨（我记恨他的）
    fear: 0,         // 恐惧（我忌惮他的）
    depend: 0,       // 依赖（我离不得他的）
    tags: [],        // 标签：自己视角的定性（可互相矛盾）
    shared: [],      // 共同记忆（各存各的版本）
    unsaid: null,    // 未说出口的话
    lastD: day || 0, // 最后一次互动
    meta: null       // 误解：我以为——单方面的自我叙述，对方的关系对象里永远不会有它
  };
}
// 惰性升级：旧档/新名册的数值关系在第一次触碰时升格为关系对象
export function ensureRels(n, day) {
  if (n.rels) return n.rels;
  const rels = {};
  for (const [oid, v] of Object.entries(n.relations || {})) rels[oid] = makeRelation(oid, v, day || 0);
  n.rels = rels;
  return rels;
}
export function relOf(n, oid, day) {
  if (!n.rels) ensureRels(n, day || 0);
  if (!n.rels[oid]) n.rels[oid] = makeRelation(oid, n.relations[oid] || 0, day || 0);
  return n.rels[oid];
}
function sync(n, oid) {
  const rel = n.rels && n.rels[oid];
  if (rel) n.relations[oid] = bond(rel);
}
function addTag(rel, tag) { if (!rel.tags.includes(tag)) rel.tags.push(tag); }
function dropTag(rel, tag) { const i = rel.tags.indexOf(tag); if (i >= 0) rel.tags.splice(i, 1); }
// 标签刷新：由六维重新定性（标签可互相矛盾——知心与忌惮能长在同一个人身上）
export function refreshTags(rel) {
  const t = new Set(rel.tags);
  const b = bond(rel);
  if (b >= 65) t.add('知心');
  else if (b >= 40) t.add('熟络');
  else if (b <= -30) t.add('不对付');
  else t.delete('知心');
  if (rel.grudge > 40) t.add('冤家'); else if (rel.grudge < 15) t.delete('冤家');
  if (rel.fear > 40) t.add('忌惮'); else if (rel.fear < 15) t.delete('忌惮');
  if (rel.depend > 50) t.add('离不得'); else if (rel.depend < 20) t.delete('离不得');
  if (rel.owe > 30) t.add('欠着情'); else if (rel.owe < 10) t.delete('欠着情');
  if (rel.trust > 55) t.add('托底的人'); else if (rel.trust < 20) t.delete('托底的人');
  rel.tags = [...t];
}

// 语言革命（v3.1.0）：台词全部从当下词库取（pickLex）——本层只剩关系机制，一句话都不拥有。
// game 可空：落种子词表（纯函数/selftest 兼容）

// 聊天的关系代价与进项（tryPairChat 调用）
export function touchChat(a, b, clock, rng, game) {
  const day = clock.totalDay;
  const ra = relOf(a, b.id, day), rb = relOf(b, a.id, day);
  ra.lastD = rb.lastD = day;
  ra.close = clamp(ra.close + rint(rng, 1, 3), -100, 100);
  rb.close = clamp(rb.close + rint(rng, 1, 3), -100, 100);
  if (chance(rng, 0.4)) ra.trust = clamp(ra.trust + 1, -100, 100);
  if (chance(rng, 0.4)) rb.trust = clamp(rb.trust + 1, -100, 100);
  // 共同记忆：同一天的事，两边各存各的版本（单向存储）
  if (ra.shared.length < 3 && chance(rng, 0.08)) {
    const line = pickLex(game, 'shared', rng);
    if (!ra.shared.includes(line)) { ra.shared.push(line); rb.shared.push(line); }
  }
  // 未说出口的话
  if (!ra.unsaid && chance(rng, 0.05)) ra.unsaid = pickLex(game, 'unsaid', rng).replace('{n}', b.name);
  if (!rb.unsaid && chance(rng, 0.05)) rb.unsaid = pickLex(game, 'unsaid', rng).replace('{n}', a.name);
  // 误解：单方面的自我叙述——不对称，永不自动对齐
  if (!ra.meta && chance(rng, 0.04)) ra.meta = { belief: pickLex(game, 'misread', rng).replace('{n}', b.name), day, deep: 0 };
  if (!rb.meta && chance(rng, 0.04)) rb.meta = { belief: pickLex(game, 'misread', rng).replace('{n}', a.name), day, deep: 0 };
  refreshTags(ra); refreshTags(rb);
  sync(a, b.id); sync(b, a.id);
  return { ra, rb };
}

// 吵架：旧怨压不住就吵一架——吵架也是社交，而且最难看的那部分也该被看见
export function quarrel(a, b, clock, rng, nowReal, log, game) {
  const day = clock.totalDay;
  const ra = relOf(a, b.id, day), rb = relOf(b, a.id, day);
  ra.grudge = clamp(ra.grudge + rint(rng, 3, 7), 0, 100);
  rb.grudge = clamp(rb.grudge + rint(rng, 3, 7), 0, 100);
  ra.trust = clamp(ra.trust - 3, -100, 100);
  rb.trust = clamp(rb.trust - 3, -100, 100);
  // 谁怕谁：对面是暴躁的人，这一架空前也怕
  if (b.traits.includes('暴躁')) ra.fear = clamp(ra.fear + rint(rng, 3, 8), 0, 100);
  if (a.traits.includes('暴躁')) rb.fear = clamp(rb.fear + rint(rng, 3, 8), 0, 100);
  dropTag(ra, '知心'); dropTag(rb, '知心');
  a.say(pickLex(game, 'quarrelA', rng), nowReal, { anger: true });
  b.say(pickLex(game, 'quarrelB', rng), nowReal, { anger: true });
  a.memory('和' + b.name + '吵了一架，话说得很僵', day, clock.hour);
  b.memory('和' + a.name + '吵了一架，这梁子结下了', day, clock.hour);
  // 呈现层：关系曲线上的坎
  relMark(ra, day, '吵了一架'); relMark(rb, day, '吵了一架');
  a.moodDelta(-4); b.moodDelta(-4);
  refreshTags(ra); refreshTags(rb);
  sync(a, b.id); sync(b, a.id);
  if (log) log(a.name + '和' + b.name + '吵了起来', 'warn');
}

// 和解：共同记忆是台阶——一起扛过事的人，翻篇总是快些
export function reconcile(a, b, clock, rng, nowReal, log, game) {
  const day = clock.totalDay;
  const ra = relOf(a, b.id, day), rb = relOf(b, a.id, day);
  const relief = rint(rng, 8, 16);
  ra.grudge = clamp(ra.grudge - relief, 0, 100);
  rb.grudge = clamp(rb.grudge - Math.round(relief * 0.7), 0, 100);
  ra.trust = clamp(ra.trust + 2, -100, 100);
  rb.trust = clamp(rb.trust + 2, -100, 100);
  a.say(pickLex(game, 'reconcile', rng), nowReal);
  a.memory('跟' + b.name + '把话说开了', day, clock.hour);
  b.memory('和' + a.name + '和解了', day, clock.hour);
  // 呈现层：关系曲线上的坎
  relMark(ra, day, '把话说开了'); relMark(rb, day, '把话说开了');
  a.moodDelta(3); b.moodDelta(3);
  refreshTags(ra); refreshTags(rb);
  sync(a, b.id); sync(b, a.id);
  if (log) log(a.name + '和' + b.name + '把话说开了', 'good');
}

// 关系日推进：亏欠会淡，忌惮会散，旧怨会发酵，误解只会越扎越深（永不自动对齐）
export function relDailyTick(n, rng, day) {
  const evts = [];
  if (!n.rels) return evts;
  let fermented = false;
  for (const rel of Object.values(n.rels)) {
    rel.owe = clamp(rel.owe - 1, 0, 100);
    rel.fear = clamp(rel.fear - 1, 0, 100);
    if (rel.grudge > 0 && day - rel.lastD > 6) rel.grudge = clamp(rel.grudge - 1, 0, 100);
    else if (rel.grudge > 10 && rel.close < 0 && chance(rng, 0.05)) { rel.grudge = clamp(rel.grudge + 1, 0, 100); fermented = true; }
    if (day - rel.lastD > 10 && rel.trust > 0) rel.trust = clamp(rel.trust - 1, -100, 100);
    if (rel.depend > 0 && !chance(rng, 0.5)) rel.depend = clamp(rel.depend - 1, 0, 100);
    if (rel.meta && chance(rng, 0.03)) rel.meta.deep = (rel.meta.deep || 0) + 1;
    refreshTags(rel);
    sync(n, rel.o);
  }
  // 伴侣的日子久了，是离不得的
  if (n.spouse && n.rels[n.spouse]) {
    const rel = n.rels[n.spouse];
    rel.depend = clamp(rel.depend + 1, 0, 80);
    refreshTags(rel); sync(n, n.spouse);
  }
  if (fermented && chance(rng, 0.3)) evts.push('心里那点旧怨又翻上来了');
  if (Object.values(n.rels).some(rel => rel.meta && rel.meta.deep > 2) && chance(rng, 0.05)) {
    evts.push('有桩心思越想越觉得自己当初没看错人');
  }
  return evts;
}

// ---------- 权力（社会层：说话算数的人是长出来的，不是任命的） ----------
// ---------- 名望场（v4.9.0 · 感知与名望，决议录 D39） ----------
// 谁说话算数，从被见证的历史里长——不从职业表里查（POWER_JOB 退役：职业威望是社会规定，
// 不该硬编码）。名望是函数不是表：每人眼里一份（eyeOf），全镇名望=众人眼里之平均；
// 不存全局排行榜（分布式——谣言、误判、冤案才可能涌现）。纯函数不占骰流（类 urgeOf）。
export function eyeOf(o, n, day) {
  let s = 0;
  const rel = o.rels && o.rels[n.id];
  if (rel) s += rel.trust * 0.5 + rel.fear * 0.45 + rel.depend * 0.7 - rel.grudge * 0.4;
  // o 的记忆里提到 n 的，按价态与新旧加权——被记住的事，才算数
  const mems = o.memories || [];
  let seen = 0;
  for (let i = mems.length - 1; i >= 0 && seen < 10; i--) {
    const m = mems[i];
    if (!m.text || !m.text.includes(n.name)) continue;
    const recency = Math.max(0.2, 1 - ((day != null ? day : m.d) - m.d) * 0.05);
    s += (m.valence || 0) * 0.15 * recency;
    seen++;
  }
  return s;
}
export function standingOf(n, npcs, day) {
  let sum = 0, cnt = 0;
  for (const o of npcs) {
    if (o === n || o.id === n.id || o.dying) continue;
    sum += eyeOf(o, n, day); cnt++;
  }
  if (!cnt) return 50;
  return clamp(Math.round(50 + (sum / cnt) * 0.5), 0, 100);
}
// 说话算数的人：名望场有明确 Top1（≥55 且领先 >15）才算有——日缓存，公共可见性进快照
export function refreshStandingTop(game, day) {
  const adults = (game.npcs || []).filter(n => n.body && n.body.ageYears >= 18 && !n.dying);
  game._standingTop = null;
  if (adults.length < 3) return null;
  let top = null, second = -1;
  for (const n of adults) {
    const s = standingOf(n, game.npcs, day);
    if (!top || s > top.s) { if (top) second = top.s; top = { id: n.id, name: n.name, s }; }
    else if (s > second) second = s;
  }
  if (top && top.s >= 55 && top.s - second > 15) game._standingTop = { id: top.id, name: top.name, s: top.s };
  return game._standingTop;
}
// powerOf = 名望场（函数名保留给 UI/旧测试——语义已换成"被见证的历史"）
export function powerOf(n, npcs, day) {
  return standingOf(n, npcs, day);
}
// 评理人：镇上名望最高的局外成年（纠纷双方都不算）
export function pickArbiter(a, excludeId, npcs, day) {
  const cands = npcs.filter(o => o.id !== a.id && o.id !== excludeId
    && o.body && o.body.ageYears >= 18 && !o.dying && !o.inside);
  if (!cands.length) return null;
  return cands.reduce((m, o) => (standingOf(o, npcs, day) > standingOf(m, npcs, day) ? o : m));
}
// 评理：找说话算数的人评一评，旧怨能松一松——权力在用的时候才存在
export function tryMediate(a, leader, ctx) {
  const { clock, rng, nowReal, log } = ctx;
  if ((a.chatCd[leader.id] || 0) > ctx.nowReal) return false;
  a.chatCd[leader.id] = ctx.nowReal + 120;
  const day = clock.totalDay;
  const ra = relOf(a, leader.id, day);
  let worst = null;
  for (const rel of Object.values(a.rels || {})) if (!worst || rel.grudge > worst.grudge) worst = rel;
  leader.say(pickLex(ctx.game, 'mediate', rng), nowReal);
  a.memory('找' + leader.name + '评了理，心里松快了些', day, clock.hour);
  leader.memory(a.name + '来找我评理', day, clock.hour);
  if (worst && worst.grudge > 0) {
    worst.grudge = clamp(worst.grudge - rint(rng, 8, 18), 0, 100);
    worst.trust = clamp(worst.trust + 2, -100, 100);
    refreshTags(worst); sync(a, worst.o);
  }
  ra.trust = clamp(ra.trust + 2, -100, 100);   // 服管
  ra.close = clamp(ra.close + 1, -100, 100);
  refreshTags(ra); sync(a, leader.id);
  if (log) log(a.name + '找' + leader.name + '评理', '');
  return true;
}

// ---------- 习俗（形成 → 传播 → 冲突） ----------
// 语言革命（v3.1.0）：CUSTOM_POOL 硬编码池整池拆除——习俗只从演化引擎来
//（缺口扫描会报"镇上规矩太少"，提案入池→灰度立规→固化传开；scriptPropose 有离线兜底）。
// 本函数只剩物理：没人守的老规矩自然消失。
export function customDaily(game) {
  const evts = [];
  game.customs = game.customs || [];
  const alive = new Set(game.npcs.map(n => n.id));
  for (const c of game.customs) c.holders = c.holders.filter(id => alive.has(id));
  game.customs = game.customs.filter(c => c.holders.length > 0);
  return evts;
}
// 聊天传播：规矩是嘴上走的；倔/严谨的人不买账（习俗冲突）
export function spreadCustoms(a, b, customs, clock, rng, log) {
  const out = [];
  if (!customs || !customs.length) return out;
  for (const c of customs) {
    if (!c.holders.includes(a.id) || c.holders.includes(b.id)) continue;
    if (!chance(rng, 0.06)) continue;
    const stubborn = b.traits.includes('倔') || b.traits.includes('严谨');
    if (stubborn && chance(rng, 0.5)) {
      b.memory('听' + a.name + '说起「' + c.name + '」的规矩，不以为然', clock.totalDay, clock.hour);
      out.push(b.name + '不认「' + c.name + '」的规矩');
    } else {
      c.holders.push(b.id);
      b.memory('跟' + a.name + '学会了「' + c.name + '」的讲究', clock.totalDay, clock.hour);
      out.push('「' + c.name + '」的讲究传开了');
    }
  }
  if (log) for (const t of out) log(t, '');
  return out;
}

// ---------- 人口流动（第三章·十二：推力与拉力） ----------
// 语言革命：客籍的姓名/来历从当下词库取（outSur/outGiven/persOut 槽）——镇外世界的话也是活的
// OUT_TRAITS 是性格名册（物理：性格词挂机制钩，封闭集合）——不是话术，不动
const OUT_TRAITS = ['手脚勤快', '见过世面', '沉默', '嘴甜', '认死理', '怕生'];
const OUT_JOB_AREA = { '农夫': 'farm', '樵夫': 'forest', '渔夫': 'river', '厨子': 'market', '商人': 'market' };
// 拉力：繁荣度、声望、安全度、恰好路过
export function pullScore(game) {
  const s = game.stock || {};
  const npcs = game.npcs || [];
  const mood = npcs.length ? npcs.reduce((m, n) => m + n.needs.mood, 0) / npcs.length : 50;
  let p = 0.02;
  if ((s.gold || 0) > 120) p += 0.10;
  if (mood > 55) p += 0.10;
  if ((s.crop || 0) > 40) p += 0.06;
  if ((game.plans || []).some(pl => !pl.done)) p += 0.04;
  return p;
}
export function makeTravelerDef(rng, seq, game) {
  const job = choice(rng, Object.keys(OUT_JOB_AREA));
  const traits = [];
  while (traits.length < 2) {
    const t = choice(rng, OUT_TRAITS);
    if (!traits.includes(t)) traits.push(t);
  }
  return {
    id: 't' + seq, name: pickLex(game, 'outSur', rng) + pickLex(game, 'outGiven', rng),
    sex: rng() < 0.5 ? '男' : '女', age: 20 + Math.floor(rng() * 26),
    job, workArea: OUT_JOB_AREA[job],
    traits,
    hair: choice(rng, ['#3b2f2a', '#26201a', '#6b3b1f', '#4a3826']),
    shirt: choice(rng, ['#8b6f47', '#757d8c', '#5f7d5a', '#9c4f43']),
    pers: pickLex(game, 'persOut', rng),
    origin: '客籍'
  };
}
// 推力：资源不足、社交冲突、好奇心、野心——有伴的人不走，孩子不走
// v4.4.2 修订：离镇不再是裸的每日掷骰累积（旧版人均 0.01~0.087/天，四十来天几乎人人走光）。
// 因果：走的都是"在镇上没有牵挂"的大人——有伴、有老小、有处得来的人、日子过得去的人，这镇子就留得住。
export function pushScore(n) {
  const st = (n.body && n.body.ageYears) || 30;
  const wl = n.wanderlust || 0;
  if (st < 18 || n.dying || n.departing || n.visiting) return 0;   // 探亲中的不再被推走——人家只是回来看看
  if (n.spouse && wl < 0.85) return 0;   // 有伴的人不走；除非是天生的远方命，且这段感情真拴不住他
  if (n.preg) return 0;   // 挺着肚子的人不上路——身孕是拴人的绳（v4.5.0：怀了孕还出门，孩子就生在荒野里了）
  if (n.family && (n.family.parents.length || n.family.childIds.length)) return 0;   // 有老有小（活口），走不了
  // 远方命：天生的不安分（0..1，出生即定）——越不安分，需要越深的牵挂才拴得住
  // 牵挂网：与镇民的关系六维聚合成 bond——有靠得住的人 / 有几个熟络的人，就不走
  const bonds = Object.values(n.rels || {}).map(bond);
  const anchor = 20 + wl * 70;   // 心安的人 bond 20 就锚住；远方命得要八九十深的牵挂才压得住
  if (bonds.length) {
    if (Math.max(...bonds) >= anchor) return 0;
    if (bonds.filter(b => b >= anchor * 0.85).length >= 2) return 0;
  }
  const rels = Object.values(n.relations || {});
  const avgRel = rels.length ? rels.reduce((s, v) => s + v, 0) / rels.length : 0;
  let p = 0;
  // 心安即不走：人缘不差、心情不坏的人，不会动离镇的念头——走是被逼到墙角的人的事
  if (avgRel >= 3 && n.needs.mood >= 45) {
    // 除了一小撮天生的远方命：安稳防得住「待不下去」，防不住「想去看看」
    if (wl < 0.85) return 0;
    p += 0.006;   // 细流，不是决堤——一年下来大半会动身
  } else {
    // v4.5.0 远方在心里：能走到这儿的都是无牵挂的人——没伴、没老小、没处得来的人。
    // 这样的人，日子再平淡，心里也长着远方（好奇心/野心）：细流，不是决堤。
    p += 0.008;
  }
  // 基础推力压低一个量级：走是少数人的事，不是每天的掷骰
  if (avgRel < 0) p += Math.min(0.012, -avgRel * 0.0004);
  if (n.needs.mood < 35) p += 0.004;
  const dom = dominantConflict(n.mind);
  if (dom && dom.key === 'leave' && dom.lean > 0.62) p += 0.004;
  return p;
}
export function departReason(n) {
  const rels = Object.values(n.relations || {});
  const avgRel = rels.length ? rels.reduce((s, v) => s + v, 0) / rels.length : 0;
  if (avgRel < -10) return '在镇上待不下去了';
  return '想去外面看看';
}
