// develop.js - 演化层·配方与知识（瓶颈驱动/知识传承/人会死手艺会断）（环境无关，game 提供上下文）
// 计划书第六章：发展不是解锁，是变异加选择；知识不写在代码里，存在人脑里，会随人死而消失
import { rint, chance, choice } from './core.js';
import { chronNote } from './history.js';
import { KNOWLEDGE } from './knowledge.js';

// ---- 配方表：每行是一门手艺 ----
// 白纸开局（v2.7.0）：铁律层配方表清空——种子世界没有与生俱来的手艺，
// 全部手艺由演化引擎提案长出（动态注册在 game.recipeDefs，谁先学会谁转职）。
// 导出名保留：evolve.js 用 RECIPE_DEFS[id] 区分铁律层/动态层（现全为动态层）。
// mult 产出倍率；knownBy Map(npcId→day) 存在人脑里；inventor/inventedDay 谁在哪天想到的
export const RECIPE_DEFS = {};

export function makeRecipes() {
  const r = {};
  for (const id of Object.keys(RECIPE_DEFS)) {
    r[id] = { id, mult: 1.0, knownBy: new Map(), inventor: null, inventedDay: 0, tries: 0, lost: false, lostDay: 0 };
  }
  return r;
}

// 开镇登记：白纸开局没有与生俱来的老手艺（函数保留：老档兼容路径可能调用）
export function seedRecipes(game) {
  void game;
}

// ---- 谁懂这门手艺 ----
export function knowsRecipe(game, npc, id) {
  const rec = game.recipes[id];
  return !!(rec && rec.knownBy.has(npc.id));
}

// ---- 产出革命（v2.9.0）：产出=世界对象+个人手艺，job 不做产出开关 ----
// 这人会的全部手艺 id（npc.js/ai.js 共用的单一事实源）
export function knownRecipes(game, npc) {
  const out = [];
  for (const [id, rec] of Object.entries(game.recipes || {})) {
    if (rec.knownBy.has(npc.id)) out.push(id);
  }
  return out;
}
// 会、且镇库原料够得着的手艺（inputs 逐项对账，不凭空）
export function craftableRecipes(game, npc) {
  const defs = defsOf(game);
  return knownRecipes(game, npc).filter(id => {
    const def = defs[id];
    if (!def || !def.inputs) return false;
    return Object.entries(def.inputs).every(([r, q]) => (game.stock[r] || 0) >= q);
  });
}
// 手艺加成：已知配方中 outputs 含该资源的最大 mult（会的人采得好——只调概率不调产量，守恒不破）
export function skillMulFor(game, npc, res) {
  const defs = defsOf(game);
  let m = 1;
  for (const id of knownRecipes(game, npc)) {
    const def = defs[id], rec = game.recipes[id];
    if (def && def.outputs && def.outputs[res] != null && rec && rec.mult > m) m = rec.mult;
  }
  return m;
}

// ---- 运行时配方表：铁律层 RECIPE_DEFS 不动，演化引擎的新配方动态注册在 game.recipeDefs ----
function defsOf(game) { return game.recipeDefs || RECIPE_DEFS; }

// ---- 瓶颈驱动创新（第六章·二）：危机期创新，繁荣期停滞 ----
// 每个相关职业每日掷一次：缺料/缺钱的时候，才想"这破东西不好用"
export function innovateDaily(game, day) {
  const { npcs, rng, stock, log, recipes } = game;
  const defs = defsOf(game);
  // 瓶颈信号：木料见底 or 粮仓见底 or 镇库空虚
  const bottleneck = (stock.wood < 8) || (stock.crop < 10) || (stock.gold < 20);
  if (!bottleneck) return;   // 日子好过，没人想改
  for (const n of npcs) {
    if (n.body.ageYears < 18 || n.body.ageYears > 65) continue;
    // 知识驱动（v2.9.0）：不按职业找配方，只琢磨自己会的——迭代序保持 npcs 序 × defs 键序，
    // 与老版「每人恰会本职业一门」的 find 命中同集合同序（链式 rng 可复现）
    for (const id of Object.keys(defs)) {
      const rec = recipes[id];
      if (!rec || !rec.knownBy.has(n.id)) continue;
      const def = defs[id];
      const maxMult = def.variants[def.variants.length - 1];
      if (rec.mult >= maxMult) continue;
      if (!chance(rng, 0.06)) continue;   // 想到是小概率——大部分瓶颈忍忍就过去了
      rec.tries++;
      // 想到变体：世界答不答应（成功率 40%——大部分发明都死在发明者手里）
      if (chance(rng, 0.4)) {
        const next = def.variants.find(v => v > rec.mult) || maxMult;
        rec.mult = next;
        rec.inventor = n.id; rec.inventedDay = day;
        rec.lost = false;
        n.memory(`琢磨出${def.name}的新法子，活儿快了不少`, day, 6);
        n.moodDelta(6);
        log(`${n.name}在${def.name}上琢磨出了新法子（手艺长进到${Math.round(next * 100)}%）`, 'good');
        chronNote(game, 'craft', `${n.name}琢磨出${def.name}的新法子`, '日子紧巴，逼出来的');
      } else {
        n.memory(`想改改${def.name}的老法子，没成`, day, 6);
        n.moodDelta(-1);
      }
    }
  }
}

// ---- 知识传承（第六章·六）：匠人自己会 → 徒弟/邻居学到 → 变成常识 ----
// 传承比发明更重要——每一环都可能断
export function teachDaily(game, day) {
  const { npcs, rng, recipes, log } = game;
  for (const id of Object.keys(recipes)) {
    const rec = recipes[id];
    if (rec.knownBy.size === 0) continue;          // 没人会，没得传
    if (rec.knownBy.size >= 3) continue;           // 三人以上=已成常识，不再专门教
    // 找一个会的人当老师，找一个不会的当学生
    const teachers = npcs.filter(n => rec.knownBy.has(n.id) && n.body.ageYears >= 18);
    if (!teachers.length) continue;
    const t = teachers[Math.floor(rng() * teachers.length)];
    // 学生池泛化（v2.9.0）：不再只限同职业——12-45 岁不会者皆可学，
    // 确定性优先级：同行当 > 与老师亲近 > 无业者 > 其余（取最优先一组抽，缘分仍看 rng）
    const def = defsOf(game)[id];
    if (!def) continue;   // 配方定义没了（演化回滚），手艺也就不传了
    const cands = npcs.filter(n => !rec.knownBy.has(n.id) && n.body.ageYears >= 12 && n.body.ageYears <= 45);
    if (!cands.length) continue;
    const sameJob = cands.filter(n => n.job && n.job === def.job);
    const close = cands.filter(n => !(n.job && n.job === def.job) && n.rels && n.rels[t.id] && n.rels[t.id].close > 30);
    const idle = cands.filter(n => !(n.job && n.job === def.job) && !(n.rels && n.rels[t.id] && n.rels[t.id].close > 30) && !n.job);
    const rest = cands.filter(n => !sameJob.includes(n) && !close.includes(n) && !idle.includes(n));
    const pupils = sameJob.length ? sameJob : close.length ? close : idle.length ? idle : rest;
    if (!chance(rng, 0.05)) continue;              // 教不教得看缘分
    const p = choice(rng, pupils);
    rec.knownBy.set(p.id, day);
    p.memory(`跟${t.name}学了${def.name}的手艺`, day, 6);
    p.moodDelta(3);
    t.memory(`把${def.name}的手艺教给了${p.name}`, day, 6);
    log(`${t.name}把${def.name}的手艺传给了${p.name}`, 'good');
  }
}

// ---- 知识会死（第六章·五）：会做的人死绝了，手艺就失传 ----
// 重新发明比第一次更难——失传的手艺 mult 归零，要靠瓶颈再逼出来
export function forgetOnDeath(game, deadNpc, day) {
  const { recipes, log, npcs } = game;
  for (const id of Object.keys(recipes)) {
    const rec = recipes[id];
    if (!rec.knownBy.has(deadNpc.id)) continue;
    rec.knownBy.delete(deadNpc.id);
    if (rec.knownBy.size === 0 && !rec.lost) {
      rec.lost = true; rec.lostDay = day;
      rec.mult = 1.0;   // 手艺归零
      const def = defsOf(game)[id] || { name: id, job: '' };
      log(`${deadNpc.name}走了，${def.name}的好手艺没人会了`, 'warn');
      chronNote(game, 'craft', `${def.name}的手艺随${deadNpc.name}入了土`, '会做的人死绝了');
      for (const n of npcs) {
        if (n.inside) continue;
        n.perceive('hear', `${def.name}的好手艺随${deadNpc.name}一起入了土`, day, 6, -2);
      }
    }
  }
}

// ---- 世界自愈的另一面：失传的手艺在废墟上被重新想起（第七章·四） ----
// 比第一次发明更难——概率砍半
export function reinventDaily(game, day) {
  const { npcs, rng, recipes, log } = game;
  for (const id of Object.keys(recipes)) {
    const rec = recipes[id];
    if (!rec.lost || rec.knownBy.size > 0) continue;
    const def = defsOf(game)[id];
    if (!def) continue;
    // 候选泛化（v2.9.0）：不再只限该职业——任何 18-60 成人都可能在废墟上想起，
    // 干着对应行当的人心里更惦记（池中放两份=加权偏好，概率结构 0.02 不变）
    const adults = npcs.filter(n => n.body.ageYears >= 18 && n.body.ageYears <= 60);
    if (!adults.length) continue;
    const cands = [];
    for (const n of adults) { cands.push(n); if (n.job && n.job === def.job) cands.push(n); }
    if (!chance(rng, 0.02)) continue;              // 重新发明更难
    const n = choice(rng, cands);
    rec.knownBy.set(n.id, day);
    rec.lost = false;
    n.memory(`重新琢磨出了${def.name}的老手艺，像是从旧日子里捡回来的`, day, 6);
    n.moodDelta(5);
    log(`${n.name}重新琢磨出了${def.name}的手艺——旧日子里的东西，又从废墟里长出来了`, 'hl');
    chronNote(game, 'craft', `${n.name}重新琢磨出了${def.name}的手艺`, '失传后重新想起');
  }
}

// ---- 知识驱动创新（v4.3 知识层）：手艺 = 知识派生的能力 ----
// 和瓶颈驱动并行：瓶颈是"日子紧巴逼出来的"，知识是"琢磨明白的道理"——两条路不冲突
// NPC 积累的知识越多，越可能把手艺精进（知识深度驱动概率，不是瓶颈信号驱动）
// 红线：只改现有配方的 mult，不创造新配方（新配方是演化引擎/v4.2 发现层的事）
export function knowledgeInnovateDaily(game, day) {
  if (!KNOWLEDGE.enabled) return;
  const { npcs, rng, recipes, log } = game;
  const defs = defsOf(game);
  for (const n of npcs) {
    if (n.body.ageYears < 18 || n.body.ageYears > 65) continue;
    if (!Array.isArray(n.knowledgeList) || !n.knowledgeList.length) continue;
    // 知识深度：有越多相关知识，越可能精进手艺
    const kCount = n.knowledgeList.length;
    for (const id of Object.keys(defs)) {
      const rec = recipes[id];
      if (!rec || !rec.knownBy.has(n.id)) continue;
      const def = defs[id];
      if (!def.variants || !def.variants.length) continue;
      const maxMult = def.variants[def.variants.length - 1];
      if (rec.mult >= maxMult) continue;
      // 知识驱动概率：基础 2% + 知识深度 × 0.5%，上限 6%（知识不是万能的，但比瓶颈更稳）
      const p = 0.02 + Math.min(kCount * 0.005, 0.04);
      if (!chance(rng, p)) continue;
      rec.tries++;
      // 知识驱动的成功率比瓶颈高（55% vs 40%）——琢磨明白的道理更有把握
      if (chance(rng, 0.55)) {
        const next = def.variants.find(v => v > rec.mult) || maxMult;
        rec.mult = next;
        rec.inventor = n.id; rec.inventedDay = day;
        rec.lost = false;
        n.memory(`想明白了${def.name}的道理，手艺又精进了`, day, 6);
        n.moodDelta(4);
        log(`${n.name}凭着琢磨出的道理，把${def.name}的手艺又精进了一分`, 'good');
        chronNote(game, 'craft', `${n.name}凭道理精进${def.name}`, '知识驱动');
      } else {
        n.memory(`琢磨${def.name}的道理，还没想通`, day, 6);
      }
    }
  }
}

// ---- 演化日推进总入口 ----
export function developDaily(game, day) {
  innovateDaily(game, day);
  knowledgeInnovateDaily(game, day);   // v4.3 知识驱动创新（与瓶颈驱动并行）
  teachDaily(game, day);
  reinventDaily(game, day);
}

// ---- 存档序列化（Map 转数组） ----
export function serializeRecipes(recipes) {
  const out = {};
  for (const [id, r] of Object.entries(recipes)) {
    out[id] = { mult: r.mult, knownBy: [...r.knownBy.entries()], inventor: r.inventor, inventedDay: r.inventedDay, tries: r.tries, lost: r.lost, lostDay: r.lostDay };
  }
  return out;
}
export function hydrateRecipes(data, defs) {
  // 按运行时配方表重建（含演化引擎动态注册的手艺）；旧档缺省用铁律层
  const base = defs || RECIPE_DEFS;
  const r = {};
  for (const id of Object.keys(base)) {
    r[id] = { id, mult: 1.0, knownBy: new Map(), inventor: null, inventedDay: 0, tries: 0, lost: false, lostDay: 0 };
  }
  if (!data) return r;
  for (const id of Object.keys(r)) {
    const d = data[id];
    if (!d) continue;
    r[id].mult = d.mult || 1.0;
    r[id].knownBy = new Map(d.knownBy || []);
    r[id].inventor = d.inventor || null;
    r[id].inventedDay = d.inventedDay || 0;
    r[id].tries = d.tries || 0;
    r[id].lost = !!d.lost;
    r[id].lostDay = d.lostDay || 0;
  }
  return r;
}

void rint;
