// hold.js - 涌现物理层（设计稿：.trae/documents/涌现物理层设计.md）：交换 / 归属
// 零内容红线：这里只有机制——持有、经过手、见面才换、欠账是记忆、占着与公认。
// 不写价格表、不写货币制度、不写法律条文。等价物/规矩由 evolve.js 提案池去诞生或不诞生。
// （环境无关，game 提供上下文）
import { clamp, chance, STOCK_NAME } from './core.js';
import { relOf } from './social.js';
import { recall } from './memory.js';
import { pickArbiter, standingOf } from './social.js';
import { addBelief, WITNESS_CONF } from './belief.js';

// ---------- 常量（有限定理） ----------
export const HOLD_PURSE_CAP = 200;    // 个人金币上限
export const HOLD_GOODS_RES_CAP = 20; // 单种物资个人上限
export const HOLD_GOODS_TOTAL_CAP = 40; // 个人物资总量上限
export const HOLD_OWED_CAP = 8;       // 欠账笔数上限
export const HOLD_OWED_STALE = 20;    // 欠账超过 20 天未还，开始可能"被忘了"（赖账）
export const CLAIM_DISPUTE_DAYS = 10; // 占着头 10 天内才可能起争议
export const CLAIM_SETTLE_DAYS = 30;  // 占着 30 天无人不认 → 时间成事实
const FOOD_RES = ['crop', 'berry', 'fish'];   // 能入口的（物理属性，不是制度）
const RES_KEYS = Object.keys(STOCK_NAME);

// ---------- 持有 ----------
export function ensureHold(npc) {
  if (!npc.hold) npc.hold = { purse: 0, goods: {}, owed: [] };
  if (!npc.hold.goods) npc.hold.goods = {};
  if (!npc.hold.owed) npc.hold.owed = [];
  if (!Number.isFinite(npc.hold.purse)) npc.hold.purse = 0;
  return npc.hold;
}
function goodsTotal(hold) {
  return Object.values(hold.goods).reduce((a, b) => a + b, 0);
}
export function goodsOf(npc, res) {
  return (npc.hold && npc.hold.goods && npc.hold.goods[res]) || 0;
}
function addGoods(npc, res, qty) {
  const hold = ensureHold(npc);
  const cur = goodsOf(npc, res);
  const roomRes = HOLD_GOODS_RES_CAP - cur;
  const roomAll = HOLD_GOODS_TOTAL_CAP - goodsTotal(hold);
  const n = Math.max(0, Math.min(qty, roomRes, roomAll));
  if (n > 0) hold.goods[res] = cur + n;
  return n;   // 放不下的退回调用方（守恒：不吞掉）
}
function takeGoods(npc, res, qty) {
  const hold = ensureHold(npc);
  const cur = goodsOf(npc, res);
  const n = Math.min(cur, qty);
  if (n <= 0) return 0;
  if (cur - n > 0) hold.goods[res] = cur - n; else delete hold.goods[res];
  return n;
}

// ---------- 归属转移（v4.8.0 基底之上全开放） ----------
// 一份资源从一只手到另一只手。动词透明——「给/塞/递/换/扔」在物理上都是易手。
// 守恒：对方放不下就原样退回，东西不吞不凭空。
// 顺清账：给出去的东西正好抵欠人家的同种账，账就销了（欠账是记忆，清账是事实）。
export function giveGoods(from, to, res, qty = 1) {
  if (!from || !to || from === to || !RES_KEYS.includes(res)) return 0;
  const hf = ensureHold(from), ht = ensureHold(to);
  let moved = 0;
  for (let i = 0; i < qty; i++) {
    if (res === 'gold') {
      if (hf.purse < 1 || ht.purse >= HOLD_PURSE_CAP) break;
      hf.purse -= 1; ht.purse += 1; moved++;
    } else {
      if (goodsOf(from, res) < 1) break;
      takeGoods(from, res, 1);
      const got = addGoods(to, res, 1);
      if (!got) { addGoods(from, res, 1); break; }   // 对方放不下，退回
      moved++;
    }
  }
  if (moved > 0) {
    let left = moved;
    for (let i = hf.owed.length - 1; i >= 0 && left > 0; i--) {
      const o = hf.owed[i];
      if (o.to !== to.id || o.res !== res) continue;
      const pay = Math.min(o.qty, left);
      o.qty -= pay; left -= pay;
      if (o.qty <= 0) hf.owed.splice(i, 1);
    }
  }
  return moved;
}

// 经过手：物资链的第一环——产出经谁的手，谁就可能留下一点
// 固定分成无随机（不打乱 chainRng 测试序列）：n≥3 留 1 在手上，其余入镇库；n<3 全入镇库
// gold 进 purse（上限 200，溢出归镇库）。返回实际入镇库的量。
export function npcEarn(npc, res, n, game) {
  if (!RES_KEYS.includes(res) || !Number.isFinite(n) || n <= 0) return 0;
  const hold = ensureHold(npc);
  if (res === 'gold') {
    const room = HOLD_PURSE_CAP - hold.purse;
    const keep = n >= 3 ? Math.min(1, room) : 0;
    hold.purse += keep;
    game.stock.gold = (game.stock.gold || 0) + (n - keep);
    return n - keep;
  }
  let keep = 0;
  if (n >= 3) keep = addGoods(npc, res, 1);
  game.stock[res] = (game.stock[res] || 0) + (n - keep);
  return n - keep;
}

// 手里的粮真的能吃：进食时消耗一份存货，吃得更踏实（守恒：goods 减少）
// 返回是否吃到了自己的存货（每次进食意图最多一份，由调用方用 it._ateHold 控制）
export function eatFromHold(npc) {
  const hold = ensureHold(npc);
  for (const res of FOOD_RES) {
    if (goodsOf(npc, res) > 0) {
      takeGoods(npc, res, 1);
      npc.needs.hunger = clamp(npc.needs.hunger - 20, 0, 100);
      return true;
    }
  }
  return false;
}

// ---------- 见面时仍在转的物理（v4.8.0：脚本触发规则已退役） ----------
// 退役的：赠予/换物/赊账/还账的"什么时候发生"——那是社会规则，不归物理管。
//   现在，东西易手只由 NPC 自己的决定驱动（开放动作 → 归属转移）。
// 仍在的：欠账会被忘掉（记忆失真）、归属公认靠嘴传（传闻）——这两样是血肉层物理。
// ctx: {clock, rng, nowReal, log, game}
export function holdPairTick(a, b, ctx) {
  const { game } = ctx;
  if (!game) return;
  ensureHold(a); ensureHold(b);
  defaultOwed(a, b, ctx);   // 记忆失真：账太旧、信任太薄，就"忘了"
  claimGossip(a, b, ctx);   // 传闻：聊着聊着，说起那处新占的房子
}

function defaultOwed(a, b, ctx) {
  const { clock, rng, log, game } = ctx;
  const hold = ensureHold(a);
  const day = clock.totalDay;
  const i = hold.owed.findIndex(o => o.to === b.id && day - o.day > HOLD_OWED_STALE);
  if (i < 0) return;
  if (relOf(a, b.id, day).trust >= 25) return;      // 信还在，赖不掉
  if (!chance(rng, 0.1)) return;                     // 遗忘是小概率，但会累积
  const o = hold.owed[i];
  hold.owed.splice(i, 1);
  relOf(b, a.id, day).grudge = clamp(relOf(b, a.id, day).grudge + 4, 0, 100);
  game.owedDefaults = (game.owedDefaults || 0) + 1;
  a.memory(`欠${b.name}的那点事……什么来着`, day, clock.hour);
  b.perceive('feel', `${a.name}像是把赊的${STOCK_NAME[o.res]}忘了`, day, clock.hour, -2);
  if (log) log(`${a.name}把欠${b.name}的账忘了，${b.name}记下了这根刺`, 'warn');
}

// ---------- 归属：占着与公认（公认来自见证与听说，false 不是中立，是不认） ----------
function claimKeyOf(house) {
  const x = house.ox != null ? house.ox : house.hx;
  const y = house.oy != null ? house.oy : house.hy;
  return x + ',' + y;
}

// 占着：人搬进去 + 登记 claim。witnesses: [{npc, recognized}]
export function claimHouse(game, npc, house, witnesses) {
  npc.home = { x: house.ox, y: house.oy, doorX: house.doorX, doorY: house.doorY, hx: house.x, hy: house.y };
  house.ownerId = npc.id; house.ownerName = npc.name; house.ownerJob = npc.job;
  house.wear = 0;   // 有人住了，荒废计数重来
  if (!game.claims) game.claims = new Map();
  const recognizedBy = {};
  for (const w of (witnesses || [])) recognizedBy[w.npc.id] = !!w.recognized;
  game.claims.set(claimKeyOf(house), {
    by: npc.id, since: game.clock ? game.clock.totalDay : 1,
    recognizedBy, disputed: false, settled: false
  });
}

// 公认传播：聊天时说起某处新占的房子，听者按对占据者的关系写下认或不认
function claimGossip(a, b, ctx) {
  const { clock, rng, game } = ctx;
  if (!game || !game.claims || !game.claims.size) return;
  if (!chance(rng, 0.08)) return;
  const day = clock.totalDay;
  for (const [key, c] of game.claims) {
    if (c.settled || c.by === b.id) continue;
    if (c.recognizedBy[b.id] != null) continue;
    const holder = (game.npcs || []).find(n => n.id === c.by);
    if (!holder) continue;
    const rel = relOf(b, c.by, day);
    const t = rel.trust + rel.close - rel.grudge - rel.fear;
    if (t > 10) c.recognizedBy[b.id] = true;
    else if (t < -10) { c.recognizedBy[b.id] = false; b.memory(`说起${holder.name}住的那处房子，心里不认同`, day, clock.hour); }
    return;   // 一次聊天只说一处
  }
}

// 归属日推进：还镇上的账 / 无房者占空房 / 争议与评理 / 时间成事实
export function holdDaily(game, day) {
  const { npcs, rng, log } = game;
  const owners = new Set(npcs.map(n => n.id));
  // 1) 还镇上的账：手里有了就还（镇库垫付不是免单）
  for (const n of npcs) {
    const hold = ensureHold(n);
    const i = hold.owed.findIndex(o => o.to === 'town' && hold.purse >= o.qty);
    if (i >= 0) {
      const o = hold.owed[i];
      hold.purse -= o.qty;
      game.stock.gold = (game.stock.gold || 0) + o.qty;
      hold.owed.splice(i, 1);
      n.memory(`把欠镇上的${o.qty}金币还上了`, day, 8);
    }
  }
  // 2) 占空房：没房住的成年人，看中一处故人留下的空房就搬进去（一天最多一例）
  const empty = (game.world.houses || []).find(h => h.ownerId && !owners.has(h.ownerId) && !h.ruined);
  if (empty) {
    const squat = npcs.find(n => !n.home && n.body.ageYears >= 18 && !n.dying && chance(rng, 0.2));
    if (squat) {
      const witnesses = npcs.filter(o => o !== squat && !o.inside
        && Math.abs(o.x - squat.x) + Math.abs(o.y - squat.y) < 10)
        .slice(0, 3)
        .map(o => {
          const rel = relOf(o, squat.id, day);
          return { npc: o, recognized: rel.trust + rel.close - rel.grudge - rel.fear > -10 };
        });
      claimHouse(game, squat, empty, witnesses);
      squat.memory(`搬进了${empty.ownerName || '故人'}留下的老宅，总算有了个窝`, day, 10);
      log(`${squat.name}搬进了${empty.ownerName || '故人'}留下的老宅`, 'good');
    }
  }
  // 3) 争议与评理：不认的人够多，这事就摆到了台面上——
  //    v4.9.0 评理改道（D39）：争议摆到名望最高者面前，成为被见证的公共事件。
  //    目击者按自己对当事人的关系自行改写公认（见证改公论，不是系统强翻）；
  //    评理人收目击者的正面记忆与信念（名望燃料——领导从被求评理的次数里长）。
  //    没有够分量的人，争议就悬着——悬着的公共心结是「得有个主事的」观念原料。
  if (game.claims) {
    let judged = false;
    for (const [key, c] of game.claims) {
      const age = day - c.since;
      if (c.settled || c.disputed || age > CLAIM_DISPUTE_DAYS) continue;
      const noes = Object.entries(c.recognizedBy).filter(([, v]) => v === false);
      if (noes.length < 2) continue;
      c.disputed = true;
      game.claimDisputes = (game.claimDisputes || 0) + 1;
      if (judged) continue;                        // 有限律：一天最多一起评理
      const holder = npcs.find(n => n.id === c.by);
      if (!holder) continue;
      const hour = game.clock ? game.clock.hour : 10;
      const arbiter = pickArbiter(holder, null, npcs, day);
      const near = npcs.filter(o => o !== holder && o !== arbiter && !o.inside
        && Math.abs(o.x - holder.x) + Math.abs(o.y - holder.y) < 10).slice(0, 5);
      // 没有够分量的人：争议悬着，成为公共心结
      if (!arbiter || standingOf(arbiter, npcs, day) < 25) {
        for (const w of near) {
          w.perceive('see', `${holder.name}住那处房子的事吵开了，没人评得了理`, day, hour, -2, { isIncident: true });
        }
        log(`${holder.name}住那处房子的事吵开了，可镇上没人评得了理`, 'warn');
        judged = true;
        continue;
      }
      judged = true;
      c.recognizedBy[arbiter.id] = true;
      for (const w of near) {
        w.perceive('see', `${arbiter.name}给${holder.name}住房的事评了理`, day, hour, 2, { isIncident: true });
        // 目击者按自己对 holder 的关系自行改写公认——见证改公论
        if (c.recognizedBy[w.id] !== true) {
          const rel = relOf(w, holder.id, day);
          c.recognizedBy[w.id] = (rel.trust + rel.close - rel.grudge - rel.fear) > -10;
        }
        // 公共事件进信念：亲眼所见，谁给评的理
        addBelief(w, `${arbiter.name}是评理的人`, { src: '亲眼', conf: WITNESS_CONF, day });
      }
      arbiter.memory(`给${holder.name}住房的事评了理，大家都看着`, day, hour, 70);
      log(`${holder.name}住那处房子的事起了争议，${arbiter.name}出面评了理${near.length ? `，${near.length}人见证` : ''}`, 'warn');
    }
    // 4) 时间成事实：住久了就是他的（时间定理的显现，不是法条）
    for (const [, c] of game.claims) {
      if (c.settled || day - c.since < CLAIM_SETTLE_DAYS) continue;
      if (Object.values(c.recognizedBy).some(v => v === false)) continue;
      c.settled = true;
    }
  }
}

// ---------- 口述与考古永不对齐（失真物理）：markNote 是真相层，口述是血肉层，不设 reconciler ----------
// 找活着 NPC 记忆里提到该处名字的最早一条，返回其当下染色版——回忆这个动作本身会让它继续漂移
export function oralOf(game, x, y) {
  if (!game.marks) return null;
  const m = game.marks.get(x + ',' + y);
  if (!m || !m.name) return null;
  let best = null;
  for (const n of game.npcs || []) {
    if (n.dying) continue;
    for (const mem of (n.memories || [])) {
      const orig = mem.orig != null ? mem.orig : mem.text;
      if (!orig || !orig.includes(m.name)) continue;
      if (!best || mem.d < best.mem.d) best = { npc: n, mem };
      break;
    }
  }
  if (!best) return null;
  return {
    by: best.npc.name,
    day: best.mem.d,
    text: recall(best.mem, best.npc.needs ? best.npc.needs.mood : 50),
    truth: m.name   // 真相层原样返回，对不对齐是玩家眼睛的事
  };
}
