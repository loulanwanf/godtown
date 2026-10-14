// disaster.js - 演化层·灾难与崩溃恢复（瘟疫/火灾/世界自己修复）（环境无关，game 提供上下文）
// 计划书第七章：灾难不只来自技术；六环断一环就崩；崩溃之后，新的东西会从废墟里长出来
import { O, rint, chance, choice } from './core.js';
import { chunkHas, getObj, setObj } from './chunk.js';
import { chronNote, markNote } from './history.js';

// ---- 瘟疫（传染性，中速） ----
// 有人倒下 → 每日近身传播 → 扛过去或病故；医生能降低周围死亡率（六环之一：有没有人管）
export function plagueDaily(game, day) {
  const { npcs, rng, log } = game;
  // 爆发：每日 0.8%，从随机一个成年人开始
  if (!game.plague && chance(rng, 0.008)) {
    const hosts = npcs.filter(n => n.body.ageYears >= 6 && !n.dying);
    if (hosts.length) {
      const h = choice(rng, hosts);
      game.plague = { startedDay: day, sick: [h.id], dead: 0, over: false };
      h.plagueSick = true;
      log(`${h.name}发起了高热，浑身无力——镇上来了时疫`, 'warn');
      chronNote(game, 'disaster', '镇上来了时疫，' + h.name + '第一个倒下', '');
    }
  }
  const p = game.plague;
  if (!p || p.over) return;
  // 传播：病人身边 4 格内的健康者 12% 被染
  for (const id of [...p.sick]) {
    const s = npcs.find(n => n.id === id);
    if (!s) continue;
    for (const o of npcs) {
      if (o.id === id || o.plagueSick || o.dying || p.sick.includes(o.id)) continue;
      if (o.body.ageYears < 6) continue;
      if (Math.abs(o.x - s.x) + Math.abs(o.y - s.y) > 4) continue;
      if (chance(rng, 0.12)) {
        p.sick.push(o.id);
        o.plagueSick = true;
        o.memory('也病倒了，这时疫传得快', day, 6);
        o.perceive('hear', '时疫在镇上传开了', day, 6, -3);
      }
    }
  }
  // 转归：每位病人每日定生死——医生在镇上且没病倒，死亡率减半（有人管）
  const doctorUp = npcs.some(n => n.job === '医生' && !n.plagueSick && !n.dying);
  for (const id of [...p.sick]) {
    const s = npcs.find(n => n.id === id);
    if (!s) { p.sick = p.sick.filter(v => v !== id); continue; }
    if (s.dying) continue;
    const deathP = doctorUp ? 0.03 : 0.06;
    if (chance(rng, deathP)) {
      s.dying = { cause: '时疫', days: rint(rng, 1, 2) };
      p.dead++;
      log(`${s.name}病势沉了，时疫要人命`, 'warn');
    } else if (chance(rng, 0.35)) {
      // 扛过去了
      s.plagueSick = false;
      p.sick = p.sick.filter(v => v !== id);
      s.memory('从时疫里扛了过来，捡回一条命', day, 6);
      s.moodDelta(4);
    }
  }
  // 平息：没有病人了
  if (p.sick.length === 0) {
    p.over = true;
    log(`时疫过去了，镇上${p.dead ? '没能留住' + p.dead + '口人' : '没人丢下性命'}`, p.dead ? 'warn' : 'good');
    chronNote(game, 'disaster', `时疫过去了（${p.dead ? '没能留住' + p.dead + '口人' : '没人丢下性命'}）`, '二十天不再来');
    game.plagueUntil = day + 20;   // 二十天内不再来
  }
}

// ---- 火灾（外源性，突发） ----
// 旱季/晴日里一户人家起火 → 烧掉门口物件 → 邻里看见来救（有人看见→有人信→有人听）
export function fireDaily(game, day) {
  const { world: w, npcs, rng, log, weather } = game;
  if (game.fire) { fireTick(game); return; }
  const dry = weather.type === 'sunny' || weather.type === 'hot';
  if (!dry) return;
  if (!chance(rng, 0.004)) return;
  // 起火点：随机一户人家门口
  const houses = w.houses.filter(h => h.ownerId && npcs.some(n => n.id === h.ownerId));
  if (!houses.length) return;
  const h = choice(rng, houses);
  game.fire = { x: h.ox, y: h.oy, day, spread: 1, put: 0 };
  log(`${h.ownerName || '一户人家'}家里走了水，火舌蹿上了屋檐`, 'warn');
  chronNote(game, 'disaster', `${h.ownerName || '一户人家'}家里走了水`, '旱日走水');
  for (const n of npcs) {
    if (n.inside) continue;
    if (Math.abs(n.x - h.ox) + Math.abs(n.y - h.oy) < 12) {
      n.perceive('see', '看见火光冲天', day, 6, -4);
    } else {
      n.perceive('hear', '听见有人喊着火了', day, 6, -2);
    }
  }
}
export function fireTick(game) {
  const f = game.fire;
  if (!f) return;
  const { world: w, rng, log } = game;
  // 烧：火点周围 2 格的可燃物被吃掉
  for (let k = 0; k < f.spread; k++) {
    const x = f.x + rint(rng, -2, 2), y = f.y + rint(rng, -2, 2);
    if (!chunkHas(w, x, y)) continue;
    const o = getObj(w, x, y);
    if (o === O.TREE || o === O.BUSH || o === O.STUMP || o === O.LOG) {
      setObj(w, x, y, O.NONE);
      if (chance(rng, 0.3)) setObj(w, x, y, O.RUIN);   // 烧剩的焦桩
    }
  }
  f.spread = Math.min(3, f.spread + 1);
  // 救：邻里靠近火场，每人每日 25% 压一分火
  const { npcs } = game;
  for (const n of npcs) {
    if (n.inside || n.dying) continue;
    if (Math.abs(n.x - f.x) + Math.abs(n.y - f.y) < 6 && chance(rng, 0.25)) {
      f.put++;
      n.memory('帮着扑了火', game.clock.totalDay, 6);
    }
  }
  // 熄：扑救压过火势，或烧满三日
  if (f.put >= 4 || game.clock.totalDay - f.day >= 3) {
    const ruin = f.put < 4;   // 没人救→留废墟；救下来了→只留焦痕
    if (ruin) {
      if (getObj(w, f.x, f.y) === O.NONE) setObj(w, f.x, f.y, O.RUIN);
      markNote(game, f.x, f.y, 'ruin', '火烧的焦土', '');
      log('火熄了，烧出一地焦土——日子还得往下过', 'warn');
    } else {
      log('街坊们提着水桶把火压下去了', 'good');
    }
    game.renderer && (game.renderer.mapDirty = true);
    game.fire = null;
  }
}

// ---- 崩溃之后世界自己修复（第七章·五）：烧焦/荒废的地，慢慢长出新的东西 ----
// 火烧过的森林，恢复后可能变成草原——继续看，不重开
export function recoverDaily(game, day) {
  const { world: w, rng } = game;
  // 废墟格 0.5%/日 风化成草地（慢慢被草盖住）——遍历所有已生成 chunk
  let healed = 0;
  for (const c of w.ws.iterNonVirgin()) {
    for (let i = 0; i < c.obj.length; i++) {
      if (c.obj[i] !== O.RUIN) continue;
      if (!chance(rng, 0.005)) continue;
      c.obj[i] = O.NONE;
      c.dirty = true;
      healed++;
    }
  }
  if (healed) {
    game.renderer && (game.renderer.mapDirty = true);
    game.log('几处废墟被青草盖住了——世界在自己长好', '');
  }
}

// ---- 灾难日推进总入口 ----
export function disasterDaily(game, day) {
  plagueDaily(game, day);
  fireDaily(game, day);
  recoverDaily(game, day);
}

// ---- 存档 ----
export function serializeDisaster(game) {
  return { plague: game.plague || null, fire: game.fire || null, plagueUntil: game.plagueUntil || 0 };
}
export function hydrateDisaster(game, d) {
  game.plague = (d && d.plague) || null;
  game.fire = (d && d.fire) || null;
  game.plagueUntil = (d && d.plagueUntil) || 0;
}
