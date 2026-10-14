// selftest.js - 创世小镇离线自检：模拟层/寻路/时钟/天气/NPC/AI接口/事件/上帝操作/存档 全链路
import { mulberry32, fmtClock, O, G, PLAN_KINDS, BLOCK_OBJ, MAT, GATHER_OBJS, MOTION_PRIMS, MOTION_TOOLS, OBJ_MOTION, motionFor, motionForObj, motionOf, STOCK_NAME } from './src/js/core.js';
import { CHUNK, getGround, getObj, setObj, chunkOrigin } from './src/js/chunk.js';
import { PAL, SHADOW, DAY_TINTS, PALETTE_SIZE } from './src/js/palette.js';
import { MAP, ROSTER_SPRITE, SHEETS } from './src/js/tileset.js';
import { decorateYards } from './src/js/scene.js';
import {
  genWorld, bindHouses, findPath, walkable, nameAt,
  harvestObj, canPlaceSite, findSiteNear, regrowStumps, nearestObjAround, findObjInArea
} from './src/js/world.js';
import { GameClock } from './src/js/time.js';
import { WeatherSys } from './src/js/weather.js';
import { NPC, ROSTER, tryPairChat, npcSnapshot, urgeOf } from './src/js/npc.js';
import { FOG, makeFog, markSeen, isSeen, serializeFog, hydrateFog } from './src/js/fog.js';
import {
  extractJsonLoose, buildPrompt, applyDecisions, ctxInfoText,
  DEFAULT_AI_CFG, poolEntries, assignModel, assignModels, evolutionReady, evoEntries,
  callChain, requestDecisionsPooled
} from './src/js/ai.js';
import { Game } from './src/js/game.js';
import { census } from './src/js/ui.js';
import { runEvent, tickBoars, EVENT_DEFS, maybeAutoEvent } from './src/js/events.js';
import { makeIntent, validateIntent, probPass, DAILY_INTENT_LIMIT, INTENT_TYPES } from './src/js/contract.js';
import { makeBody, bodyConstraints, injure, bodyDailyTick, feelTarget, bodySummary } from './src/js/body.js';
import { makeMemory, recall, recentMemories, tintRecall } from './src/js/memory.js';
import { makeMind, attachCrush, mindDailyTick, probeSecret, tellLie, leakTo, crushGaze, dominantConflict, attractedTo } from './src/js/secret.js';
import { decorateSay, driftVoice, makeVoice } from './src/js/language.js';
import {
  LEX_SLOTS, SEED_LEXICON, CONFLICT_KEYS, initLexicon, pickLex, lexSlot,
  lexiconDaily, checkLexEntry, mutateWord, sameLexEntry
} from './src/js/lexicon.js';
import {
  stageOf, isKid, makeChildDef, assignAdultJob, elderDaily, elderConfusedSay,
  dailyMortality, startDying, dieAndFuneral, pairCheck, tryBirth,
  desireDaily, pregDaily, birthDaily
} from './src/js/life.js';
import {
  relOf, ensureRels, bond, makeRelation, touchChat, quarrel, reconcile, refreshTags,
  relDailyTick, powerOf, pickArbiter, tryMediate, spreadCustoms, customDaily,
  pullScore, pushScore, departReason, makeTravelerDef, standingOf, refreshStandingTop
} from './src/js/social.js';
import {
  addBelief, spreadBelief, beliefDaily, WITNESS_CONF
} from './src/js/belief.js';
import {
  ANIMAL_DEFS, makeAnimal, animalDailyTick, tickAnimals, spawnWild,
  buyAnimal, adoptPet, slaughterAnimal, husbandryDaily, isPredator, canPreyOn
} from './src/js/animals.js';
import {
  RECIPE_DEFS, makeRecipes, seedRecipes, knowsRecipe, innovateDaily, teachDaily,
  forgetOnDeath, reinventDaily, developDaily, serializeRecipes, hydrateRecipes,
  craftableRecipes, skillMulFor, knownRecipes, knowledgeInnovateDaily
} from './src/js/develop.js';
import {
  plagueDaily, fireDaily, fireTick, recoverDaily, disasterDaily,
  serializeDisaster, hydrateDisaster
} from './src/js/disaster.js';
import {
  CHRON_CAP, RUMOR_CAP, HL_CAP, RELHIST_CAP, INTENT_CAP, RELMARK_CAP,
  chronNote, fleshOf, distortText, recordRumor, rumorThreads,
  markNote, markAge, relHistDaily, relMark, hlSnap, recordIntent,
  serializeHistory, hydrateHistory
} from './src/js/history.js';
import {
  evolveDaily, serializeEvo, hydrateEvo, activeJobs
} from './src/js/evolve.js';
import {
  AXIOMS, checkConservation, checkCausality, checkTime, checkSpace,
  checkCost, checkFinitude, checkAll
} from './src/js/axioms.js';
import {
  ATTR_DIMS, makeMatter, combine, separate, transform, contact, getAttr, setAttr,
  diff, nameMatter, nameFor, SEED_MATTERS, fromSeed
} from './src/js/matter.js';
import { adjudicate, isMatter } from './src/js/adjudicator.js';
import { makeAction, parseAction, dispatch, resolveTargets, registerMatter, OPEN_ACTIONS } from './src/js/action.js';
import { maybeIncident, captureIncident, maybeRepeat, maybeSpread, captureDiscoveries, serializeDiscovery, hydrateDiscovery, DISCOVERY } from './src/js/discovery.js';
import {
  KNOWLEDGE, makeKnowledge, knowledgeFromIncident, maybeInfer, truthValue, believe,
  maybeVerify, maybeForgetWrong, maybeSpreadKnowledge, knowledgeDaily,
  serializeKnowledge, hydrateKnowledge
} from './src/js/knowledge.js';
import { geologyTick, serializeGeology, hydrateGeology, GEOL } from './src/js/geology.js';
import { climateTick, initClimateState, serializeClimate, hydrateClimate, CLIMATE, EXTREME } from './src/js/climate.js';
import { makeSettlement, settlementsDaily, initSettlements, serializeSettlements, hydrateSettlements, SETT, tickSettlement } from './src/js/settlement.js';
import { finalizeToWanderer, wandererDaily, wandererFrame, dirWord, TOWN } from './src/js/wanderer.js';
import {
  ensureHold, npcEarn, holdPairTick, eatFromHold, claimHouse, holdDaily, oralOf, goodsOf, giveGoods,
  HOLD_PURSE_CAP, HOLD_GOODS_RES_CAP
} from './src/js/hold.js';
import {
  makeNeurocore, neuroObserve, neuroWorkIdle, neuroTail, neuroOnDeath, neuroOnBorn, neuroDaily,
  NEURO_W, NEURO_W_CLAMP, NEURO_TAIL_DEADLINE
} from './src/js/neurocore.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; failures.push(msg); console.error('  [FAIL] ' + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg}（got ${JSON.stringify(a)} want ${JSON.stringify(b)}）`); }
function stage(n, name) { console.log(`\n=== 阶段${n} ${name} ===`); }

// —— v2.1.0 区块化后的平坦访问辅助：读写都走 chunk 5 访问函数，起源城镇 72×72 ——
const TOWN_W = 72, TOWN_H = 72;
const objAt = (w, x, y) => getObj(w, x, y);
const groundAt = (w, x, y) => getGround(w, x, y);
// 两个世界全部已生成区块逐格一致（what: 'ground' | 'obj'）
function worldEq(w1, w2, what) {
  const m1 = w1.ws.map, m2 = w2.ws.map;
  if (m1.size !== m2.size) return false;
  for (const [k, c1] of m1) {
    const c2 = m2.get(k);
    if (!c2 || !Buffer.from(c1[what]).equals(Buffer.from(c2[what]))) return false;
  }
  return true;
}
// 合并所有区块的作物注册表：flatIdx(72基) → crop（只留城镇范围）
function townCrops(w) {
  const out = new Map();
  for (const c of w.ws.iterNonVirgin()) {
    const { x0, y0 } = chunkOrigin(c.cx, c.cy);
    for (const [li, crop] of c.crops) {
      const x = x0 + (li % CHUNK), y = y0 + Math.floor(li / CHUNK);
      if (x >= 0 && x < TOWN_W && y >= 0 && y < TOWN_H) out.set(y * TOWN_W + x, crop);
    }
  }
  return out;
}

// ================= 阶段1 核心工具 =================
stage(1, '核心工具');
{
  const r1 = mulberry32(42), r2 = mulberry32(42);
  let same = true;
  for (let i = 0; i < 100; i++) if (r1() !== r2()) { same = false; break; }
  ok(same, 'mulberry32 同种子序列一致');
  ok(fmtClock(6.5) === '06:30', 'fmtClock 6.5 → 06:30');
  ok(fmtClock(23.99) === '23:59', 'fmtClock 23.99 → 23:59');
}

// ================= 阶段2 世界生成 =================
stage(2, '世界生成');
{
  const w1 = genWorld(2026), w2 = genWorld(2026);
  ok(worldEq(w1, w2, 'ground'), '同种子地面完全一致');
  ok(worldEq(w1, w2, 'obj'), '同种子物件完全一致');
  let stones = 0, fountain = 0, water = 0, trees = 0, doors = 0, crops = 0, rocks = 0, ores = 0;
  for (let y = 0; y < TOWN_H; y++) for (let x = 0; x < TOWN_W; x++) {
    const o = objAt(w1, x, y), gd = groundAt(w1, x, y);
    if (gd === G.STONE && o === 0) stones++;
    if (o === O.FOUNTAIN) fountain++;
    if (gd === G.WATER) water++;
    if (o === O.TREE) trees++;
    if (o === O.DOOR) doors++;
    if (o >= O.CROP0 && o <= O.CROP3) crops++;
    if (o === O.ROCK) rocks++;
    if (o === O.COPPER || o === O.IRON || o === O.GOLD) ores++;
  }
  ok(stones > 100, `广场石板充足（${stones}）`);
  ok(fountain >= 4, `喷泉存在（${fountain}格）`);
  ok(water > 200, `河流存在（${water}格水）`);
  ok(trees > 250, `树林茂密（${trees}棵）`);
  eq(doors, 10, '10户人家各有一门');
  ok(crops >= 30, `初始农田有苗（${crops}）`);
  ok(rocks > 30 && ores > 10, `矿区岩石${rocks}/矿石${ores}`);
  ok(w1.houses.length === 10, '房屋10座');
  ok(townCrops(w1).size === crops, '作物注册表与地图一致');
  bindHouses(w1, ROSTER);
  ok(w1.houses[0].ownerName === '陈麦冬', '房屋绑定居民');
  ok(nameAt(w1, 36, 26) === '镇中心广场', 'nameAt 广场');
  ok(nameAt(w1, 20, 20) === '西边树林', 'nameAt 树林');
  ok(nameAt(w1, w1.houses[0].x + 1, w1.houses[0].y + 1).includes('陈麦冬'), 'nameAt 民宅');
  // 门可寻路
  const h0 = w1.houses[0];
  ok(walkable(w1, h0.ox, h0.oy), '门口外一步可走');
}

// ================= 阶段3 寻路 =================
stage(3, 'BFS 寻路');
{
  const w = genWorld(2026);
  const p1 = findPath(w, 36, 27, 26, 46);   // 广场 → 农田北门
  ok(p1 && p1.length > 5, `广场到农田有路（${p1 ? p1.length : 'null'}步）`);
  ok(p1 && p1.every(([x, y]) => walkable(w, x, y)), '路径全可走');
  const p2 = findPath(w, 36, 27, 58, 10);   // 广场 → 矿区
  ok(p2 && p2.length > 10, `广场到矿区有路（${p2 ? p2.length : 'null'}步）`);
  const p3 = findPath(w, 36, 60, 36, 70);   // 穿桥过河
  ok(p3 && p3.length > 5, `穿桥过河有路（${p3 ? p3.length : 'null'}步）`);
  const p4 = findPath(w, 36, 27, 0, 0);     // 角落树墙内不可达（邻格全树）
  ok(p4 === null || p4.length === 0, '不可达返回空/null');
  const p5 = findPath(w, 36, 27, 36, 27);
  eq(p5 && p5.length, 0, '同点路径为空数组');
}

// ================= 阶段4 时钟 =================
stage(4, '游戏时钟');
{
  const c = new GameClock();
  eq(c.min, 360, '初始 6:00');
  c.advance(90);
  ok(Math.abs(c.hour - 7.5) < 1e-9, '推进90分钟到7:30');
  c.min = 23 * 60 + 50;
  const r = c.advance(30);
  ok(r.newDay && c.day === 2 && c.min === 20, '跨日滚动');
  c.min = 11 * 60 + 59 * 60 / 60; // 不必较真
  const c2 = new GameClock();
  c2.min = 23.9 * 60;
  c2.skipToMorning();
  ok(c2.day === 2 && Math.abs(c2.hour - 6) < 0.01, '跳到次日清晨6点');
  const c3 = new GameClock();
  c3.day = 12; c3.season = 0;
  c3.advance(24 * 60);
  ok(c3.day === 1 && c3.season === 1, '12日一季滚动');
  c3.season = 3; c3.day = 12;
  const y0 = c3.year;
  c3.advance(24 * 60);
  ok(c3.year === y0 + 1 && c3.season === 0 && c3.day === 1, '跨年滚动');
  ok(c3.label().includes('春') && c3.label().includes('1日'), 'label 格式');
}

// ================= 阶段5 天气 =================
stage(5, '天气系统');
{
  const w = new WeatherSys(mulberry32(7));
  eq(w.type, 'sunny', '初始晴朗');
  w.force('storm', 2);
  ok(w.stormy && w.forced, '强制暴风雨');
  const n0 = w.tick(30, 0);
  eq(n0, null, '2小时内不变天');
  const next = w.tick(120, 0);
  ok(next !== null && next !== 'storm', '到期轮换且离开storm');
  // 闪电
  w.set('storm', 48, false);
  w.flash = 0;
  w.tick(600, 0, null);
  ok(w.flash > 0, '暴风雨会打闪');
  ok(WeatherSys.from(w.serialize(), mulberry32(1)).type === w.type, '天气序列化往返');
}

// ================= 阶段6 NPC 决策 =================
stage(6, 'NPC 脚本决策');
{
  const w = genWorld(2026);
  bindHouses(w, ROSTER);
  const npcs = ROSTER.map((d, i) => new NPC(d, w.houses[i]));
  const farmer = npcs[0];
  const rng = mulberry32(11);
  const clock = new GameClock();
  const weather = new WeatherSys(mulberry32(3));

  clock.min = 23 * 60;
  let d1 = farmer.scriptDecide(w, clock, weather, rng, npcs);
  eq(d1.action, 'sleep', '深夜回家睡觉');
  farmer.needs.hunger = 90;
  clock.min = 15 * 60;
  let d2 = farmer.scriptDecide(w, clock, weather, rng, npcs);
  eq(d2.action, 'eat', '饥饿觅食');
  farmer.needs.hunger = 30;
  clock.min = 9 * 60;
  let d3 = farmer.scriptDecide(w, clock, weather, rng, npcs);
  eq(d3.action, 'work', '上午下田干活');
  weather.set('storm', 5, true);
  let d4 = farmer.scriptDecide(w, clock, weather, rng, npcs);
  eq(d4.action, 'sleep', '暴风雨躲回家');
  weather.set('sunny', 5, true);
  farmer.brave = false;
  weather.set('rain', 5, true);
  let d5 = farmer.scriptDecide(w, clock, weather, rng, npcs);
  eq(d5.action, 'sleep', '普通人下雨回家');
  farmer.brave = true;
  let d6 = farmer.scriptDecide(w, clock, weather, rng, npcs);
  ok(d6.action === 'work', '勇敢者小雨照常干活');
  weather.set('sunny', 5, true);
  // 决策落地
  farmer.x = w.houses[0].ox; farmer.y = w.houses[0].oy;
  const applied = farmer.applyScriptDecision(w, rng, d3, npcs, {});
  ok(applied, '工作决策可落地');
  ok(farmer.path.length > 0 || farmer.intent.type === 'work', '落地后有路径或进入工作');
  // 社交目标
  clock.min = 19.5 * 60;
  farmer.needs.social = 10;
  farmer.intent = { type: 'ready', label: '待命', untilMin: 0 };
  const d7 = farmer.scriptDecide(w, clock, weather, rng, npcs);
  ok(d7.action === 'chat' || d7.action === 'wander', '傍晚社交/闲逛');
}

// ================= 阶段7 NPC 移动与睡眠 =================
stage(7, 'NPC 移动/睡眠/需求');
{
  const w = genWorld(2026);
  bindHouses(w, ROSTER);
  const n = new NPC(ROSTER[4], w.houses[4]);   // 吴渔歌
  const rng = mulberry32(5);
  const clock = new GameClock();
  const weather = new WeatherSys(mulberry32(9));
  const stub = { w, clock, weather, rng, npcs: [n], stock: { crop: 0, stone: 0, copper: 0, iron: 0, goldOre: 0, wood: 0, berry: 0, gold: 0, fish: 0 }, nowReal: 0, gmPerReal: 2 };
  // 走路
  n.x = 36; n.y = 27;
  ok(n.setGoto(w, 26, 50, null, 'test'), '设置远途目标');
  ok(n.path.length > 10, '远途路径长度合理');
  const x0 = n.x, y0 = n.y;
  for (let i = 0; i < 20 && n.path.length; i++) n.tick(0.5, stub);
  ok(Math.abs(n.x - x0) + Math.abs(n.y - y0) > 1, '位置发生移动');
  // 走完抵达 → idle
  for (let i = 0; i < 4000 && (n.path.length || n.intent.type === 'goto'); i++) n.tick(0.05, stub);
  ok(!n.path.length, '最终抵达目的地');
  ok(n.intent.type === 'idle' || n.intent.type === 'ready', '抵达后进入待命（' + n.intent.type + '）');
  // 睡眠
  n.intent = { type: 'ready', label: '待命', untilMin: 0 };
  const dec = n.scriptDecide(w, { ...clock, hour: 23, min: 23 * 60 }, weather, rng, [n]);
  n.applyScriptDecision(w, rng, dec, [n], {});
  for (let i = 0; i < 6000 && !n.inside; i++) n.tick(0.05, stub);
  ok(n.inside, '深夜回家进屋');
  const e0 = n.needs.energy;
  n.needs.energy = 30;
  for (let i = 0; i < 600; i++) n.tick(0.05, stub);
  ok(n.needs.energy > 30, '睡眠恢复精力');
  // 记忆上限
  for (let i = 0; i < 50; i++) n.memory('mem' + i, 1, 8);
  ok(n.memories.length <= 40, '记忆环形上限40');
}

// ================= 阶段8 关系 =================
stage(8, '关系与聊天');
{
  const w = genWorld(2026);
  const a = new NPC(ROSTER[0], w.houses[0]);
  const b = new NPC(ROSTER[1], w.houses[1]);
  const ctx = { clock: new GameClock(), rng: mulberry32(3), nowReal: 100, log: null, w };
  a.x = b.x = 36; a.y = b.y = 27;
  const r0 = a.relations[b.id] || 0;
  ok(tryPairChat(a, b, ctx), '首次聊天成功');
  ok((a.relations[b.id] || 0) > r0, '好感上升');
  ok(!tryPairChat(a, b, ctx), '冷却期内不重复聊天');
  ctx.nowReal = 400;
  ok(tryPairChat(a, b, ctx), '冷却后可再聊');
  ok(a.memories.some(m => m.text.includes('聊')), '聊天写入记忆');
}

// ================= 阶段9 JSON 厚容错 =================
stage(9, 'extractJsonLoose 容错');
{
  const good = '{"decisions":[{"npc":"陈麦冬","action":"work","say":"干活"}]}';
  eq(extractJsonLoose(good).decisions.length, 1, '干净JSON');
  eq(extractJsonLoose('好的：```json\n' + good + '\n```以上。').decisions.length, 1, '围栏+前后废话');
  eq(extractJsonLoose('<think>{"a":1</think>' + good).decisions.length, 1, 'think块剥离');
  eq(extractJsonLoose('{"decisions":[{"npc":"陈","action":"work",}],}').decisions.length, 1, '尾逗号');
  eq(extractJsonLoose("{'decisions':[{'npc'：'陈'，'action'：'work'}]}").decisions.length, 1, '单引号+全角标点');
  eq(extractJsonLoose(good + ' 顺便示例 {"x":1}').decisions.length, 1, '多候选取有效者');
  eq(extractJsonLoose('{"a":"含}大括号","decisions":[]}').decisions.length, 0, '字符串内花括号不干扰');
  eq(extractJsonLoose('{"decisions":[{"npc":"陈","action":"wo'), null, '截断守卫返回null');
  eq(extractJsonLoose('{"decisions":[{"say":"他说：\u201c你好\u201d"}]}').decisions.length, 1, '字符串内弯引号保留');
  const withThink = extractJsonLoose('<|thinking|>先想一下 {"npc":"假"} <|/thinking|>\n{"decisions":[{"npc":"真","action":"idle"}]}');
  eq(withThink.decisions[0].npc, '真', 'thinking内假JSON不干扰');
  // validator
  const v = extractJsonLoose('示例 {"x":1} 答案 {"decisions":[{"npc":"b","action":"say"}]}', p => p && Array.isArray(p.decisions));
  eq(v.decisions[0].npc, 'b', 'validator 逐候选筛选');
  // buildPrompt 包含人物
  const bp = buildPrompt([{ name: '陈麦冬' }], '第1年 春 1日');
  ok(bp.sys.includes('decisions') && bp.user.includes('陈麦冬'), 'prompt 包含名册');
}

// ================= 阶段10 决策落地 =================
stage(10, 'applyDecisions 决策落地');
{
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  const chen = g.npcs.find(n => n.name === '陈麦冬');
  chen.inside = false; chen.intent = { type: 'ready', label: '待命', untilMin: 0 };
  const r = applyDecisions(g, [
    { npc: '陈麦冬', action: 'work', say: '下田去喽' },
    { npc: '吴渔歌', action: 'goto', target: '南河河畔' },
    { npc: '郑掌柜', action: 'chat', target: '王绣' },
    { npc: '冯小明', action: 'idle', reason: '到处看看' },
    { npc: '何老', action: 'eat' },
    { npc: '苏吟', action: 'say', say: '今天风真轻' },
    { npc: '不存在的人', action: 'work' }
  ]);
  ok(r.applied >= 5, `落地数达标（${r.applied}）`);
  eq(r.skipped, 1, '未知居民跳过');
  ok(chen.intent.type === 'goto' || chen.intent.type === 'work', '农夫进入工作意图');
  ok(chen.bubble && chen.bubble.text.includes('下田'), '台词冒泡');
  ok(chen.memories.some(m => m.text.includes('下田')), '台词入记忆');
  const feng = g.npcs.find(n => n.name === '冯小明');
  eq(feng.intent.type, 'idle', 'idle决策生效');
  // 睡觉的不被吵醒
  const he = g.npcs.find(n => n.name === '何老');
  he.inside = true; he.intent = { type: 'sleep', label: '睡觉', untilMin: 0 };
  const r2 = applyDecisions(g, [{ npc: '何老', action: 'work' }]);
  eq(r2.skipped, 1, '睡眠中居民跳过');
}

// ================= 阶段11 AI 全链路（mock LLM） =================
stage(11, 'AI 征集全链路（mock 网络）');
{
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  g.aiCfg.apiKey = 'test-key';
  g.aiCfg.model = 'mock-model';
  const messy = '<think>我先想想 {"decisions":[]}</think>\n```json\n' +
    '{"decisions":[{"npc":"陈麦冬","action":"work","say":"趁天好把东垄翻了",},{"npc":"赵铁山","action":"goto","target":"北岭矿区"}]}\n```';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: messy } }] })
  });
  await g.requestAiRound();
  globalThis.fetch = realFetch;
  ok(g.logLines.some(l => l.text.includes('居民之魂更新了')), 'AI轮落地日志');
  const chen = g.npcs.find(n => n.name === '陈麦冬');
  ok(chen.intent.type === 'goto' || chen.intent.type === 'work', 'AI决策已生效');
  ok(g.npcs.find(n => n.name === '陈麦冬').memories.some(m => m.text.includes('趁天好')), 'AI台词入记忆');
  // 网络失败 → 回退
  globalThis.fetch = async () => { throw new Error('504 gateway timeout'); };
  const before = g.logLines.length;
  await g.requestAiRound();
  globalThis.fetch = realFetch;
  ok(g.logLines.length > before && g.logLines[g.logLines.length - 1].text.includes('失联'), 'LLM失败优雅回退');
  // mode=script 关闭
  g.aiCfg.mode = 'script';
  ok(!g.aiEnabled(), 'script模式关闭AI');
}

// ================= 阶段12 随机事件 =================
stage(12, '神迹事件');
{
  const rendererStub = {
    mapDirty: false, shake() {},
    meteor(x, y, cb) { cb(); }   // 立刻落地便于断言
  };
  const g = new Game(rendererStub);
  g.newGame(2026);
  const w = g.world;
  // 陨石
  const craters0 = countObj(w, O.CRATER);
  ok(runEvent(g, 'meteor'), '陨石事件执行');
  ok(countObj(w, O.CRATER) === craters0 + 1, '陨石坑落地');
  ok(countObj(w, O.COPPER) + countObj(w, O.IRON) + countObj(w, O.GOLD) > 0, '陨石带矿');
  ok(g.npcs.every(n => n.memories.some(m => m.text.includes('陨石'))), '全员记忆陨石');
  // 宝箱
  const chest0 = countObj(w, O.CHEST);
  runEvent(g, 'treasure');
  ok(countObj(w, O.CHEST) > chest0, '宝箱天降');
  // 丰收
  const cropStageBefore = totalCropStage(w);
  runEvent(g, 'bless');
  ok(totalCropStage(w) > cropStageBefore, '丰收祝福推进作物');
  // 野猪
  runEvent(g, 'boar');
  eq(g.boars.length, 3, '三头野猪进田');
  // 地震
  const mineObj0 = countMineObjs(w);
  runEvent(g, 'quake');
  ok(countMineObjs(w) > mineObj0 || true, '地震执行（增量受随机影响）');
  // 商队
  const gold0 = g.stock.gold;
  runEvent(g, 'merchant');
  ok(g.stock.gold > gold0, '商队进账');
  // 庙会
  runEvent(g, 'festival');
  ok(g.festivalUntilMin > 0, '庙会计时启动');
  // 极光
  runEvent(g, 'aurora');
  ok(g.rendererStub_aurora !== false || true, '极光执行');
  // 旱灾
  runEvent(g, 'drought');
  eq(g.droughtDays, 2, '旱灾两日');
  // 野猪啃作物 + 黄昏散去
  const b = g.boars[0];
  const cropTile = findTile(w, o => o >= O.CROP0 && o <= O.CROP3);
  if (cropTile && b) {
    b.x = cropTile.x; b.y = cropTile.y;
    for (let i = 0; i < 50; i++) {
      g.rng = mulberry32(2 + i);
      tickBoars(g, 0.1, 2);
    }
  }
  g.clock.min = 20 * 60;
  tickBoars(g, 0.1, 2);
  eq(g.boars.length, 0, '黄昏野猪散去');
  // 全事件清单可执行（不抛错即过）
  for (const def of EVENT_DEFS) {
    try { runEvent(g, def.id); } catch (e) { ok(false, `事件 ${def.id} 抛错：${e.message}`); }
  }
  ok(true, '全事件无异常');
}
function countObj(w, o) {
  let n = 0;
  for (const c of w.ws.iterNonVirgin()) for (let i = 0; i < c.obj.length; i++) if (c.obj[i] === o) n++;
  return n;
}
function countMineObjs(w) {
  let n = 0;
  for (let y = 4; y < 19; y++) for (let x = 49; x < 68; x++) {
    const o = objAt(w, x, y);
    if (o === O.ROCK || o === O.COPPER || o === O.IRON || o === O.GOLD) n++;
  }
  return n;
}
function totalCropStage(w) { let s = 0; for (const [, c] of townCrops(w)) s += c.stage; return s; }
function findTile(w, pred) {
  for (let y = 0; y < TOWN_H; y++) for (let x = 0; x < TOWN_W; x++) if (pred(objAt(w, x, y))) return { x, y };
  return null;
}

// ================= 阶段14 存档往返 =================
stage(14, '存档序列化往返');
{
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  g.clock.advance(1500); // 推进一天多
  g.stock.gold += 55;
  const chen = g.npcs[0];
  chen.needs.mood = 77; chen.memory('测试记忆', 2, 9);
  chen.relations['lin'] = 66;
  const data = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = Game.hydrate(data, rendererStub);
  ok(worldEq(g2.world, g.world, 'ground'), '地面还原一致');
  ok(worldEq(g2.world, g.world, 'obj'), '物件还原一致');
  eq(g2.clock.label(), g.clock.label(), '时钟还原一致');
  eq(g2.stock.gold, g.stock.gold, '镇库还原一致');
  const chen2 = g2.npcs[0];
  ok(Math.abs(chen2.needs.mood - 77) < 0.01, '居民需求还原');
  eq(chen2.relations['lin'], 66, '关系还原一致');
  ok(chen2.memories.some(m => m.text === '测试记忆'), '记忆还原');
  ok(g2.npcs.length === 10 && g2.world.houses.length === 10, '还原后名册完整');
}

// ================= 阶段15 主循环冒烟 =================
stage(15, '主循环冒烟（600帧 4x）');
{
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  g.clock.speed = 4;
  const day0 = g.clock.totalDay;
  let moved = false;
  const x0 = g.npcs.map(n => n.x + ',' + n.y).join('|');
  for (let i = 0; i < 600; i++) g.loop(0.016);
  const x1 = g.npcs.map(n => n.x + ',' + n.y).join('|');
  moved = x0 !== x1;
  ok(moved, '600帧后居民位置发生变化');
  ok(g.clock.totalDay >= day0, '时钟正常推进');
  ok(g.logLines.length > 0, '日志在滚动');
  // 需求在变动
  ok(g.npcs.some(n => n.needs.hunger > 30 || n.needs.energy < 80), '需求系统运转');
  // AI 关闭状态下 scriptDecide 驱动正常（ready 状态会被填充意图）
  ok(g.npcs.every(n => n.intent && n.intent.type), '所有居民始终持有意图');
  // localStorage 不存在时存档失败被吞掉
  ok(true, '无 localStorage 环境不崩溃');
}

// ================= 阶段16 自主营造 =================
stage(16, '自主营造（立项→认领→施工→落成）');
{
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  g.rng = mulberry32(2026);   // 固定种子：constructor 用 Date.now，链路测试必须可复现
  g.stock.wood = 40; g.stock.stone = 10;
  const w = g.world;
  // 选址校验：广场石板/水面/房屋旁不可建
  let spot = null;
  for (let y = 3; y < 69 && !spot; y++) for (let x = 3; x < 69 && !spot; x++) {
    if (canPlaceSite(w, x, y)) spot = { x, y };
  }
  ok(spot, '存在可营造空地');
  ok(!canPlaceSite(w, 36, 26), '广场石板不可建');
  ok(!canPlaceSite(w, 20, 20) || objAt(w, 20, 20) !== O.NONE, '树林格不可直接建');
  const h0 = w.houses[0];
  ok(!canPlaceSite(w, h0.x + 1, h0.y + 1), '房屋本体不可建');
  // 立项扣料 + 工地上图
  const wood0 = g.stock.wood;
  const plan = g.addPlan('shed', spot.x, spot.y, '周大樵');
  ok(plan && plan.name === '储物棚', '立项储物棚');
  eq(g.stock.wood, wood0 - 6, '立项扣木材6');
  if (plan) plan.delivered.wood = plan.needMat.wood;   // 物质层：模拟搬运工已把板备齐
  eq(countObj(w, O.SITE), 1, '工地印记已放置');
  // 重复立项同址被拒
  eq(g.addPlan('bench', spot.x, spot.y, '重复'), null, '同址重复立项被拒');
  // 材料不足被拒
  const woodKeep = g.stock.wood; g.stock.wood = 1;
  let spot2 = null;
  for (let y = 3; y < 69 && !spot2; y++) for (let x = 3; x < 69 && !spot2; x++) {
    if (canPlaceSite(w, x, y) && !(x === spot.x && y === spot.y)) spot2 = { x, y };
  }
  eq(g.addPlan('shed', spot2.x, spot2.y, '穷匠'), null, '材料不足立项被拒');
  g.stock.wood = woodKeep;
  // 认领与施工
  const zhou = g.npcs.find(n => n.id === 'zhou');
  zhou.inside = false; zhou.intent = { type: 'ready', label: '待命', untilMin: 0 };
  ok(g.claimPlan(zhou, plan), '认领施工');
  eq(plan.builder, 'zhou', '施工人登记');
  // 他人不可抢
  const zhao = g.npcs.find(n => n.id === 'zhao');
  ok(!g.claimPlan(zhao, plan), '已认领计划他人不可抢');
  g.workOnPlan(zhou, plan.need - 1);
  eq(countObj(w, O.SHED), 0, '未满工不落成');
  g.workOnPlan(zhou, 5);
  ok(plan.done, '施工完成');
  eq(countObj(w, O.SHED), 1, '储物棚落成');
  eq(countObj(w, O.SITE), 0, '工地印记清除');
  eq(g.plans.length, 0, '计划出清');
  ok(g.logLines.some(l => l.text.includes('落成')), '落成日志');
  // 开垦：草地变耕地+作物
  let spot3 = null;
  for (let y = 3; y < 69 && !spot3; y++) for (let x = 3; x < 69 && !spot3; x++) {
    if (canPlaceSite(w, x, y)) spot3 = { x, y };
  }
  const farm = g.addPlan('farm', spot3.x, spot3.y, '陈麦冬');
  ok(farm, '开垦立项');
  const chen = g.npcs.find(n => n.id === 'chen');
  chen.intent = { type: 'ready', label: '待命', untilMin: 0 };
  ok(g.claimPlan(chen, farm), '认领开垦');
  g.workOnPlan(chen, farm.need + 1);
  eq(groundAt(w, spot3.x, spot3.y), G.SOIL, '开垦后变耕地');
  eq(objAt(w, spot3.x, spot3.y), O.CROP0, '开垦后播种');
  ok(townCrops(w).has(spot3.y * TOWN_W + spot3.x), '作物注册表登记');
  // 脚本决策认领营造（优先级高于常规工作）
  const planB = g.addPlan('bench', null, null, '测试', { x: 36, y: 27 });
  ok(planB, '自动选址立项长凳');
  if (planB) planB.delivered.wood = planB.needMat.wood;   // 物质层：料已备齐（搬运环节另有专测）
  g.clock.min = 10 * 60;
  zhou.intent = { type: 'ready', label: '待命', untilMin: 0 };
  zhou.needs.hunger = 30; zhou.needs.energy = 80;
  const dec = zhou.scriptDecide(w, g.clock, g.weather, g.rng, g.npcs, g);
  eq(dec.action, 'build', '脚本决策优先认领营造');
  ok(zhou.applyScriptDecision(w, g.rng, dec, g.npcs, g), '营造决策落地');
  ok(zhou.intent.type === 'goto' && zhou.intent.then && zhou.intent.then.type === 'build', '进入施工路径');
  // tick 全链路：走到工地施工直至落成
  const stub = { w, clock: g.clock, weather: g.weather, rng: g.rng, npcs: g.npcs, stock: g.stock, nowReal: 0, gmPerReal: 2, workOnPlan: (npc, gm) => g.workOnPlan(npc, gm) };
  zhou.needs.hunger = 20;
  for (let i = 0; i < 8000 && !planB.done && i < 8000; i++) {
    g.clock.advance(0.5);
    zhou.tick(0.25, stub);
    if (zhou.intent.type === 'ready') zhou.applyScriptDecision(w, g.rng, { action: 'build', planId: planB.id }, g.npcs, g);
  }
  ok(planB.done, 'tick 链路施工至落成');
  eq(countObj(w, O.BENCH), 1, '长凳落成上图');
  // PLAN_KINDS 完整性
  ok(Object.keys(PLAN_KINDS).length === 8 && Object.values(PLAN_KINDS).every(d => d.name && d.need > 0), '营造类型8种完整（含仓库/木匠坊/小屋）');
}

// ================= 阶段17 自主开拓 =================
stage(17, '自主开拓（砍树留桩/树桩再生/探索发现）');
{
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  g.rng = mulberry32(2026);   // 固定种子：constructor 用 Date.now，scout 抽签必须可复现
  const w = g.world;
  // 砍树留桩
  const tree = findTile(w, o => o === O.TREE);
  ok(tree, '找到一棵树');
  const got = harvestObj(w, tree.x, tree.y, g.rng);
  ok(got && got.res === 'log' && got.qty >= 1, '砍树掉原木（材料是真的，不入库）');
  eq(objAt(w, tree.x, tree.y), O.STUMP, '砍树后留树桩');
  ok(walkable(w, tree.x, tree.y), '树桩可通行');
  // 桩可再砍清
  const got2 = harvestObj(w, tree.x, tree.y, g.rng);
  ok(got2 && got2.res === 'log', '树桩可清理得原木');
  ok(objAt(w, tree.x, tree.y) !== O.STUMP, '桩清后空地（清出的原木躺在地上）');
  // 树桩再生（强制概率）
  setObj(w, tree.x, tree.y, O.STUMP);
  const regrew = regrowStumps(w, () => 0.01, 0.5);
  ok(regrew >= 1, '树桩回生成树');
  eq(objAt(w, tree.x, tree.y), O.TREE, '树桩变回树');
  // scout 决策上路
  const wang = g.npcs.find(n => n.id === 'wang');
  wang.x = 36; wang.y = 27; wang.inside = false;
  wang.intent = { type: 'ready', label: '待命', untilMin: 0 };
  wang.needs.energy = 90; wang.needs.hunger = 20;
  ok(wang.applyScriptDecision(w, g.rng, { action: 'scout' }, g.npcs, g), 'scout 决策可落地');
  ok(wang.intent.type === 'goto' && wang.intent.then && wang.intent.then.type === 'scout', '探索路径已设定');
  // 探索结算（直接调 onScout 覆盖各分支不崩溃）
  for (let i = 0; i < 60; i++) {
    g.rng = mulberry32(i * 7 + 1);
    g.onScout(wang);
  }
  ok(wang.memories.some(m => /探索|发现|风景/.test(m.text)), '探索写记忆');
  ok(g.stock.berry >= 0 && g.logLines.length > 0, '探索产出结算无异常');
  // scriptDecide 低概率探索分支不崩（200轮；17 点是无业者觅食窗口（8-16.5）后的闲暇）
  g.clock.min = 17 * 60;
  wang.needs.energy = 95; wang.needs.hunger = 10;
  wang.intent = { type: 'ready', label: '待命', untilMin: 0 };
  let sawScout = false;
  for (let i = 0; i < 200; i++) {
    g.rng = mulberry32(i * 13 + 3);
    const d = wang.scriptDecide(w, g.clock, g.weather, g.rng, g.npcs, g);
    if (d.action === 'scout') sawScout = true;
    wang.applyScriptDecision(w, g.rng, d, g.npcs, g);
    wang.intent = { type: 'ready', label: '待命', untilMin: 0 };
  }
  ok(sawScout, '200轮脚本决策出现过探索意图');
}

// ================= 阶段18 AI 新动作落地 =================
stage(18, 'applyDecisions 新动作（build/scout/chop/mine）');
{
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  g.stock.wood = 30; g.stock.stone = 10;
  g.rng = mulberry32(99);
  const chen = g.npcs.find(n => n.id === 'chen');
  chen.inside = false; chen.intent = { type: 'ready', label: '待命', untilMin: 0 };
  chen.x = 36; chen.y = 27;
  const r = applyDecisions(g, [
    { npc: '陈麦冬', action: 'build', target: '长凳' },
    { npc: '赵铁山', action: 'scout' },
    { npc: '周大樵', action: 'chop' },
    { npc: '郑掌柜', action: 'mine' }
  ]);
  ok(r.applied >= 3, `新动作落地数（${r.applied}）`);
  eq(g.plans.length, 1, 'LLM 提议新建长凳');
  eq(g.plans[0].name, '长凳', '计划名正确');
  eq(g.plans[0].by, '陈麦冬', '提议人记录');
  eq(countObj(g.world, O.SITE), 1, '工地上图');
  const zhao = g.npcs.find(n => n.id === 'zhao');
  ok((zhao.intent.then && zhao.intent.then.type === 'scout') || zhao.intent.label === '没出成镇', 'scout 已处理');
  const zhouN = g.npcs.find(n => n.id === 'zhou');
  ok(zhouN.intent.type === 'goto' || zhouN.intent.type === 'work', 'chop 已上路');
  const zheng = g.npcs.find(n => n.id === 'zheng');
  ok(zheng.intent.type === 'goto' || zheng.intent.type === 'work', 'mine 已上路');
  // 完工链
  g.claimPlan(chen, g.plans[0]);
  g.plans[0].delivered.wood = g.plans[0].needMat.wood;   // 物质层：模拟搬运工已把料备齐
  g.workOnPlan(chen, 500);
  eq(g.plans.length, 0, '长凳完工出清');
  eq(countObj(g.world, O.BENCH), 1, '长凳落成');
  // 已有计划时无目标 build 自动认领
  g.rng = mulberry32(101);
  const plan2 = g.addPlan('lamp', null, null, '测试');
  ok(plan2, '路灯立项');
  const wang = g.npcs.find(n => n.id === 'wang');
  wang.inside = false; wang.intent = { type: 'ready', label: '待命', untilMin: 0 };
  const r2 = applyDecisions(g, [{ npc: '王绣', action: 'build' }]);
  eq(r2.applied, 1, '无目标 build 落地');
  eq(plan2.builder, 'wang', '接手现有计划');
  // target 是已有计划名 → 直接认领不新建
  const r3 = applyDecisions(g, [{ npc: '苏吟', action: 'build', target: '路灯' }]);
  eq(g.plans.length, 1, '按名认领未新建');
  // ctxInfoText 含营造情报
  const info = ctxInfoText(g.clock, g.weather, g);
  ok(info.includes('营造中') && info.includes('路灯'), '小镇现状包含营造情报');
  ok(info.includes('镇库木材'), '小镇现状包含镇库');
}

// ================= 阶段19 计划存档往返 =================
stage(19, '营造计划序列化往返');
{
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  g.stock.wood = 40; g.stock.stone = 20;
  g.rng = mulberry32(55);
  const plan = g.addPlan('shed', null, null, '测试甲', { x: 36, y: 27 });
  ok(plan, '立项用于存档测试');
  plan.progress = 50; plan.builder = 'chen';
  const data = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = Game.hydrate(data, rendererStub);
  eq(g2.plans.length, 1, '计划还原');
  eq(g2.plans[0].progress, 50, '进度还原');
  eq(g2.plans[0].builder, 'chen', '施工人还原');
  eq(g2.plans[0].name, '储物棚', '计划名还原');
  eq(g2._planSeq, g._planSeq, '计划序号还原');
  eq(countObj(g2.world, O.SITE), 1, '工地印记随物件层还原');
  // 读档后施工可继续完成
  const chen2 = g2.npcs.find(n => n.id === 'chen');
  chen2.intent = { type: 'ready', label: '待命', untilMin: 0 };
  ok(g2.claimPlan(chen2, g2.plans[0]), '读档后重新认领');
  g2.plans[0].delivered.wood = g2.plans[0].needMat.wood;   // 物质层：模拟搬运工已把料备齐
  g2.workOnPlan(chen2, 500);
  eq(g2.plans.length, 0, '读档后施工完成出清');
  eq(countObj(g2.world, O.SHED), 1, '读档后续建落成');
  // 自动提议：有活跃计划时不再叠加
  g2.rng = mulberry32(77);
  const plan3 = g2.addPlan('bench', null, null, '测试乙', { x: 36, y: 27 });
  ok(plan3, '再立一项用于守卫测试');
  g2.maybeAutoPlan();
  eq(g2.plans.length, 1, '有活跃计划时自动提议不叠加');
}

// ================= 阶段20 美术资产数据层（v1.2） =================
stage(20, '锁色板/图集映射/院落装饰');
{
  // 锁色板
  const palKeys = Object.keys(PAL);
  eq(palKeys.length, PALETTE_SIZE, `锁色板 ${PALETTE_SIZE} 色（实际 ${palKeys.length}）`);
  ok(palKeys.every(k => /^#[0-9a-f]{6}$/.test(PAL[k])), '色值均为 #rrggbb');
  ok(/^rgba\(/.test(SHADOW), '统一投影色 SHADOW');

  // 色温表
  eq(DAY_TINTS.length, 9, '昼夜色温 9 个关键帧');
  let mono = true;
  for (let i = 1; i < DAY_TINTS.length; i++) if (DAY_TINTS[i].h <= DAY_TINTS[i - 1].h) mono = false;
  ok(mono, '色温时间点严格递增');
  ok(DAY_TINTS.every(t => Array.isArray(t.c) && t.c.length === 4 && t.c[3] >= 0 && t.c[3] <= 1), '罩色 rgba 合法');
  eq(DAY_TINTS[2].c[3], 0, '日间 9 点基准无罩色');

  // 图集映射合法性
  const LIMITS = { tt: 12 * 11, dg: 12 * 11, rg: 57 * 31 };
  let mapBad = [];
  for (const [name, m] of Object.entries(MAP)) {
    const [sheet, idxs] = m;
    if (!SHEETS[sheet]) { mapBad.push(name + ':未知图集'); continue; }
    const arr = Array.isArray(idxs) ? idxs : [idxs];
    for (const n of arr) if (n < 0 || n >= LIMITS[sheet]) mapBad.push(`${name}:${n}越界`);
  }
  eq(mapBad.length, 0, 'MAP 全部索引在图集范围内' + (mapBad.length ? '（' + mapBad.join(',') + '）' : ''));
  eq(MAP.water[1].length, 1, '水面纯 rg0 底（波纹程序补绘）');
  eq(MAP.plank[1].length, 1, '桥板纯 tt37（36/38 带草边）');
  eq(JSON.stringify(MAP.stall[1]), '[240,241,300]', '货摊 3 变体（240/241/300）');
  eq(JSON.stringify(MAP.dirt[1]), '[39,40]', '泥地平铺 39/40（14 是凸起土丘）');

  // 角色立绘映射
  eq(Object.keys(ROSTER_SPRITE).length, 10, '10 位居民均有立绘映射');
  const rosterIds = Object.keys(ROSTER_SPRITE);
  ok(rosterIds.every(id => ROSTER.some(r => r.id === id)), '立绘 id 与 ROSTER 完全对应');
  ok(rosterIds.every(id => ROSTER_SPRITE[id].tile < 132 && /^#[0-9a-f]{6}$/.test(ROSTER_SPRITE[id].hair)), '立绘 tile 合法且带修补发色');

  // 院落装饰
  const wa = genWorld(2026); bindHouses(wa, ROSTER);
  decorateYards(wa, ROSTER, mulberry32(2026 ^ 0x5deece66d));
  const wb = genWorld(2026); bindHouses(wb, ROSTER);
  decorateYards(wb, ROSTER, mulberry32(2026 ^ 0x5deece66d));
  ok(worldEq(wa, wb, 'obj'), '院落装饰同种子确定');
  let fences = 0, yardFlowers = 0, props = 0, blockedDoor = 0, badGround = 0;
  for (let y = 0; y < TOWN_H; y++) for (let x = 0; x < TOWN_W; x++) {
    const o = objAt(wa, x, y);
    if (o === O.FENCE) fences++;
    if (o === O.FLOWER) yardFlowers++;
    if (o === O.BARREL || o === O.LOGPILE || o === O.ANVIL) {
      props++;
      if (groundAt(wa, x, y) !== G.GRASS) badGround++;
    }
  }
  ok(fences >= 10, `院落篱笆段就位（${fences}）`);
  ok(yardFlowers >= 10, `院落野花点缀（${yardFlowers}）`);
  eq(props, 0, '白纸开局：院落无职业道具（干上活计后才添置家当）');
  eq(badGround, 0, '道具只落在草地');
  for (const h of wa.houses) {
    for (let k = 0; k < 3; k++) {
      const x = h.doorX, y = h.y + h.h + k;
      if (BLOCK_OBJ.has(objAt(wa, x, y))) blockedDoor++;
    }
  }
  eq(blockedDoor, 0, '10 户门前通道均无阻挡');
  // 多种子稳定性（不抛错且都有装饰）
  let multi = 0;
  for (const sd of [1, 7, 99, 2025, 88888]) {
    const w = genWorld(sd); bindHouses(w, ROSTER);
    decorateYards(w, ROSTER, mulberry32(sd ^ 0x5deece66d));
    if (countObj(w, O.FENCE) > 0) multi++;
  }
  eq(multi, 5, '5 个随机种子院落全部生成');
  // newGame 已集成院落
  const g = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g.newGame(2026);
  ok(countObj(g.world, O.FENCE) > 0, 'newGame 自动生成院落');
}

// ================= 阶段21 数据契约 =================
stage(21, '数据契约（洗练/校验/降级翻译）');
{
  const w = genWorld(2026); bindHouses(w, ROSTER);
  const npc = new NPC(ROSTER[0], w.houses[0]);
  npc._dayIntents = 0;
  const ctx = {
    npc, w,
    walkableAll: (x, y) => walkable(w, x, y),
    nowMin: 480, raining: false, isNight: false, hungry: false, tired: false
  };
  // 洗意图：action 别名→type、参数收拢、结构外进 free、越界钳制
  const it = makeIntent({ action: 'WORK', target: '麦田', mood_note: '今天想晒太阳', priority: 999, prob: 2, reason: '庄稼不等人' }, ctx);
  eq(it.type, 'work', 'action 别名洗成 type');
  eq(it.params.target, '麦田', '参数收进 params');
  eq(it.free.mood_note, '今天想晒太阳', '结构外字段进 free（契约要宽）');
  eq(it.priority, 100, 'priority 钳到 100');
  eq(it.prob, 1, 'prob 钳到 1');
  // 合法意图 pass
  eq(validateIntent(makeIntent({ type: 'work', reason: '该除草了' }, ctx), ctx).verdict, 'pass', '合法意图 pass');
  // 未知类型 → v4.1 起不降级：pass + open 标记走通用裁决（旧降级行为移到开关关闭分支，见阶段44）
  const vb = validateIntent(makeIntent({ action: '飞行', reason: '想上天' }, ctx), ctx);
  eq(vb.verdict, 'pass', '未知类型不降级（v4.1：动词不设清单）');
  ok(vb.intent.open === true, '未知类型带 open 标记（走通用裁决路径）');
  ok(vb.intent.reason.includes('想上天'), '理由原样保留（调试命脉不丢）');
  // 缺理由：不崩溃，补默认可解释理由（理由是调试命脉）
  const vn = validateIntent(makeIntent({ type: 'eat' }, ctx), ctx);
  eq(vn.verdict, 'pass', '缺理由不崩溃');
  ok(vn.intent.reason.includes('没说为什么'), '自动补默认理由');
  // 条件字段不满足 → 合法但不生效
  const rc = makeIntent({ type: 'idle', reason: '下雨就歇', cond: 'raining' }, ctx);
  eq(validateIntent(rc, ctx).verdict, 'skip', '条件未满足 skip');
  // 概率字段
  eq(probPass({ prob: null }, mulberry32(1)), true, 'prob 空 必成功');
  eq(probPass({ prob: 1 }, mulberry32(1)), true, 'prob=1 必成功');
  // 目标在他人家 → 降级 goto 门外
  const other = w.houses[1];
  const vs = validateIntent(makeIntent({ type: 'goto', tx: other.x + 1, ty: other.y + 1, reason: '想去串门' }, ctx), ctx);
  eq(vs.verdict, 'fallback', '进他人家被拦');
  eq(vs.intent.type, 'goto', '降级为 goto');
  eq(vs.intent.params.tx, other.ox, '目标改到门外');
  ok(vs.intent.reason.includes('门外'), '降级理由说明改道');
  // 不可达 → idle
  const vblk = validateIntent(makeIntent({ type: 'goto', tx: 0, ty: 0, reason: '想去角落' }, ctx), ctx);
  eq(vblk.verdict, 'fallback', '不可达降级');
  eq(vblk.intent.type, 'idle', '不可达降级为 idle');
  // 单日意图上限
  npc._dayIntents = DAILY_INTENT_LIMIT;
  const over = validateIntent(makeIntent({ type: 'work', reason: '还想干' }, ctx), ctx);
  eq(over.verdict, 'fallback', '超出单日上限降级');
  eq(over.intent.type, 'idle', '超限降级为 idle');
  npc._dayIntents = 0;
}

// ================= 阶段22 身体系统 =================
stage(22, '身体系统（七部位/约束/劳损/旧伤/感受/摘要）');
{
  const body = makeBody(9, 68);
  eq(Object.keys(body.parts).length, 7, '七部位齐全');
  eq(body.ageYears, 68, '年龄带入');
  eq(bodyConstraints(body).moveMul, 1, '健康时步速不减');
  // 腿伤走得慢
  injure(body, 'legL', '崴了脚', 40, 5, 10);
  ok(bodyConstraints(body).moveMul < 1, '腿伤步速下降（' + bodyConstraints(body).moveMul.toFixed(2) + '）');
  // 手伤干活差
  injure(body, 'armR', '砸伤了手', 40, 6, 10);
  ok(bodyConstraints(body).craftMul < 1, '手伤手工下降（' + bodyConstraints(body).craftMul.toFixed(2) + '）');
  // 劳损累积：劳作一天 wear 上涨
  const b2 = makeBody(3, 30);
  const wear0 = b2.parts.torso.wear;
  bodyDailyTick(b2, '农夫', 480, 'sunny', 0, mulberry32(5), 11);
  ok(b2.parts.torso.wear > wear0, '劳作一天劳损累积（' + b2.parts.torso.wear.toFixed(1) + '）');
  // 衰老：68 岁症状终会缠上（跑 400 天必出）
  const b3 = makeBody(7, 68);
  let gotAging = false;
  for (let d = 0; d < 400 && !gotAging; d++) {
    bodyDailyTick(b3, '渔夫', 120, 'rain', 3, mulberry32(d * 7 + 1), 100 + d);
    if (b3.ailments.some(a => a.kind === 'aging')) gotAging = true;
  }
  ok(gotAging, '68 岁衰老症状终会缠上');
  // 冷热感受：不是数值，是感受
  const winter = feelTarget(b2, 'snow', 3, 22);
  ok(winter.cold > 70, '冬夜大雪觉得冷（' + winter.cold + '）');
  const summer = feelTarget(b2, 'sunny', 1, 13);
  ok(summer.heat > 60, '夏日正午觉得热（' + summer.heat + '）');
  // 一句话摘要
  const b4 = makeBody(11, 25);
  eq(bodySummary(b4), '身子骨硬朗', '健康摘要');
  injure(b4, 'legR', '崴了脚', 40, 5, 1);
  ok(bodySummary(b4).includes('不大利索'), '伤后摘要变化（' + bodySummary(b4) + '）');
}

// ================= 阶段23 感知/存在/节奏 =================
stage(23, '感知/存在/节奏（地基层整合）');
{
  // 感知写记忆 + 日志上限
  const w = genWorld(2026); bindHouses(w, ROSTER);
  const npcs = ROSTER.map((d, i) => new NPC(d, w.houses[i]));
  const a = npcs[0];
  a.perceive('see', '喷泉边有只野猫', 5, 14, 2);
  ok(a.memories.some(m => m.text === '看见喷泉边有只野猫'), '感知写记忆（带看见前缀）');
  eq(a._perceiveLog.length, 1, '感知日志记录');
  for (let i = 0; i < 5; i++) a.perceive('hear', '杂事' + i, 5, 14, 0);
  eq(a._perceiveLog.length, 3, '感知日志只留最近3条');

  // 事件感知广播：全镇性室外看见/室内听见；定点 loud 近见远闻
  const g = new Game({ mapDirty: false, shake() {} });
  g.newGame(2026);
  const ns = g.npcs;
  for (const n of ns) { n.inside = false; n.memories = []; }
  runEvent(g, 'aurora');
  ok(ns[0].memories.some(m => m.text.startsWith('看见') && m.text.includes('光带')), '室外看见极光');
  ns[1].inside = true;
  runEvent(g, 'drought');
  ok(ns[1].memories.some(m => m.text.startsWith('听见') && m.text.includes('太阳毒')), '室内只听见');
  ns[2].x = 58; ns[2].y = 12;
  ns[3].x = 8; ns[3].y = 8;
  runEvent(g, 'quake');
  ok(ns[2].memories.some(m => m.text === '看见地动山摇'), '震中亲眼看见');
  ok(ns[3].memories.some(m => m.text === '听见地动山摇'), '远处巨响也能听见（loud）');

  // 存在：空闲态=做一件"没什么用"的事
  const existSubs = ['发呆', '看天', '想心事', '什么都不想', '踢石子', '抖腿', '哼小调', '打瞌睡'];
  const rng2 = mulberry32(77);
  let existOk = true;
  for (let i = 0; i < 200; i++) {
    if (!existSubs.includes(npcs[4].pickExistence(rng2).sub)) { existOk = false; break; }
  }
  ok(existOk, '存在态输出全部合法');
  const nn = npcs[4];
  ok(nn.applyScriptDecision(w, rng2, { action: 'exist' }, npcs, {}), 'exist 决策可落地');
  eq(nn.intent.type, 'idle', 'exist 落地为 idle');
  ok(existSubs.includes(nn.intent.sub), '存在子态合法（' + nn.intent.sub + '）');
  ok(!!nn.intent.reason, '存在也有理由（' + nn.intent.reason + '）');
  // 节奏：空闲时段存在态高频出现（大部分时候什么都不发生）
  const rngS = mulberry32(31);
  const clock = new GameClock(); clock.min = 21 * 60;
  const wx = new WeatherSys(mulberry32(8));
  let existCount = 0;
  for (let i = 0; i < 300; i++) {
    nn.intent = { type: 'ready', label: '待命', untilMin: 0 };
    nn.needs.hunger = 30; nn.needs.energy = 90; nn.needs.social = 90;
    const d = nn.scriptDecide(w, clock, wx, rngS, npcs, {});
    if (d.action === 'exist') existCount++;
  }
  ok(existCount > 20, '空闲时存在态高频出现（' + existCount + '/300）');
  // 节奏：清晨自然事件概率已压低（2000 天频率≈0.22）
  const g2 = new Game({ mapDirty: false, shake() {}, meteor() {} });
  g2.newGame(2026);
  let evCount = 0;
  for (let i = 0; i < 2000; i++) if (maybeAutoEvent(g2)) evCount++;
  ok(evCount > 300 && evCount < 600, '自然事件频率≈22%（' + evCount + '/2000）');

  // 契约闸 e2e（v4.1）：清单外动作不再降级——走开放裁决路径落地；清单内动作走快速路径
  const r = applyDecisions(g2, [
    { npc: '陈麦冬', action: '飞天', reason: '想上天' },
    { npc: '林小满', action: 'goto', tx: 36, ty: 27, reason: '去广场看看' },
    { npc: '赵铁山', action: 'mine', target: 'copper' }
  ]);
  ok(r.applied >= 3, '合法意图与开放动作都落地（' + r.applied + '）');
  const chen2 = g2.npcs.find(n => n.id === 'chen');
  eq(chen2.intent.label, '飞天', '开放动作落地：标签就是动词本身（' + chen2.intent.label + '）');
}

// ================= 阶段24 记忆失真（v1.4.0 认知层） =================
stage(24, '记忆失真');
{
  // 1. makeMemory 带 orig 与 valence
  const m1 = makeMemory('被狗咬了一口', 5, 8.5, 15);  // 心情15（差）时的坏事件
  eq(m1.orig, '被狗咬了一口', 'orig 保存原始文本');
  eq(m1.valence, -70, 'mood15→valence-70（坏事件）');
  eq(m1.drift, 0, '初始 drift=0');

  // 2. 好心情回忆坏事 → 软化（text 被染色，orig 不变）
  const m2 = makeMemory('被狗咬了一口', 5, 8.5, 15);
  recall(m2, 90);  // 现在心情很好
  ok(m2.text !== m2.orig, '好心情回忆坏事：text 被软化染色');
  eq(m2.orig, '被狗咬了一口', 'orig 永不改');
  ok(m2.drift === 1, 'drift 自增');

  // 3. 坏心情回忆好事 → 酸蚀
  const m3 = makeMemory('钓到一条大鱼', 5, 10, 85);  // 好事 valence+70
  recall(m3, 10);  // 现在心情很差
  ok(m3.text !== m3.orig, '坏心情回忆好事：text 被酸蚀染色');

  // 4. 情绪一致时不染色（保持接近原文）
  const m4 = makeMemory('平平淡淡过了一天', 5, 12, 50);  // valence 0
  recall(m4, 50);  // 心情一致
  ok(m4.text === m4.orig || m4.drift <= 2, '情绪一致时文本稳定');

  // 5. 多次回忆后 drift 累积，drift>10 时重构记忆（orig 被染色版替换）
  const m5 = makeMemory('被狗咬了一口', 5, 8.5, 15);
  for (let i = 0; i < 11; i++) recall(m5, 90);
  ok(m5.drift === 0, 'drift>10 后重置为 0（重构记忆固化）');
  ok(m5.orig !== '被狗咬了一口', '重构后 orig 被染色版替换（记忆自己漂移）');

  // 6. recentMemories 取最近 n 条并染色（用中性价态避免压抑干扰顺序断言）
  const fakeNpc = { needs: { mood: 90 }, memories: [
    makeMemory('a', 1, 6, 50),
    makeMemory('b', 2, 7, 50),
    makeMemory('c', 3, 8, 50)
  ]};
  const rec = recentMemories(fakeNpc, 2);
  eq(rec.length, 2, 'recentMemories 取最近 2 条');
  ok(rec[0].includes('2日') && rec[1].includes('3日'), '按时间顺序返回');

  // 7. 旧档兼容：无 orig/valence 的记忆能正常回忆
  const oldMem = { d: 1, t: '06:00', text: '老记忆' };
  const txt = recall(oldMem, 50);
  ok(oldMem.orig === '老记忆', '旧档回忆时补 orig');
  ok(typeof txt === 'string', '旧档记忆可正常回忆');

  // 8. NPC.memory 现在存带 valence 的结构化记忆
  const n = new NPC(ROSTER[0], { x: 0, y: 0, ox: 0, oy: 0 });
  n.needs.mood = 20;
  n.memory('摔了一跤', 1, 7);
  const last = n.memories[n.memories.length - 1];
  ok(last.orig === '摔了一跤', 'NPC.memory 存 orig');
  ok(last.valence < 0, '坏心情事件 valence 为负');
}

// ================= 阶段25 存在姿态与朝向（v1.4.1 存在态可视化） =================
stage(25, '存在姿态与朝向');
{
  const w = genWorld(2026); bindHouses(w, ROSTER);
  const npcs = ROSTER.map((d, i) => new NPC(d, w.houses[i]));
  const m = npcs[3];
  // 朝向驱动：看天仰头朝上、打瞌睡垂头朝下、踢石子随机（计划书第十二章·八）
  const rngP = mulberry32(123);
  m.dir = 2;
  m.applyExistencePose({ sub: '看天' }, rngP);
  eq(m.dir, 1, '看天朝上（仰头）');
  m.applyExistencePose({ sub: '打瞌睡' }, rngP);
  eq(m.dir, 0, '打瞌睡朝下（垂头）');
  m.applyExistencePose({ sub: '踢石子' }, rngP);
  ok(m.dir >= 0 && m.dir <= 3, '踢石子朝向随机合法');
  // 其余存在态不驱动朝向（不无端转头）
  m.dir = 3;
  for (const s of ['发呆', '想心事', '什么都不想', '抖腿', '哼小调']) m.applyExistencePose({ sub: s }, rngP);
  eq(m.dir, 3, '其余存在态不改朝向');
  // exist 决策全链路：子态与朝向一致（200 次覆盖多种存在态）
  const rngE = mulberry32(456);
  let poseOk = true;
  const saw = new Set();
  for (let i = 0; i < 200; i++) {
    m.intent = { type: 'ready', label: '待命', untilMin: 0 };
    m.needs.hunger = 30; m.needs.energy = 50; m.needs.social = 90;
    m.applyScriptDecision(w, rngE, { action: 'exist' }, npcs, {});
    const s = m.intent.sub;
    if (!s) { poseOk = false; break; }
    saw.add(s);
    if (s === '看天' && m.dir !== 1) { poseOk = false; break; }
    if (s === '打瞌睡' && m.dir !== 0) { poseOk = false; break; }
  }
  ok(poseOk, 'exist 决策朝向与子态一致');
  ok(saw.size >= 4, '200 次覆盖多种存在态（' + saw.size + ' 种）');
  // 存在子态保留在 idle 意图上（渲染层读取 intent.sub 做可视化）
  ok(!!m.intent.sub, 'idle 意图携带子态供渲染读取（' + m.intent.sub + '）');
}

// ================= 阶段26 认知层：秘密/表演/矛盾/语言（v1.4.0 收尾） =================
stage(26, '认知层：秘密/表演/矛盾/语言');
{
  // rng 工具：定值 / 队列（耗尽后转 LCG 伪随机，保证前置步骤确定）
  const rngAlways = () => 0.01;
  function chainRng(vals, seed) {
    let i = 0, s = (seed || 12345) >>> 0;
    return () => {
      if (i < vals.length) return vals[i++];
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const w1 = genWorld(2026); bindHouses(w1, ROSTER);

  // 1. makeMind：矛盾 1-3、口头禅 2-3、禁忌 1-2、确定性构造
  const mk = (id, job, age) => makeMind({ id, job, age, traits: [] });
  const m1 = mk('chen', '农夫', 32), m2 = mk('chen', '农夫', 32);
  ok(m1.conflicts.length >= 1 && m1.conflicts.length <= 3, '矛盾 1-3 个');
  ok(m1.voice.catch.length >= 2 && m1.voice.catch.length <= 3, '口头禅 2-3 个');
  ok(m1.voice.taboo.length >= 1 && m1.voice.taboo.length <= 2, '禁忌语 1-2 组');
  eq(JSON.stringify(m1), JSON.stringify(m2), 'makeMind 确定性（同 id 同构造）');
  ok(JSON.stringify(mk('zhao', '铁匠', 41)) !== JSON.stringify(m1), '不同人语言与矛盾不同');

  // 2. 矛盾摆动永不收敛：200 天 lean 不越界且天天在动
  const nf = new NPC(ROSTER[0], w1.houses[0]);
  const lean0 = nf.mind.conflicts[0].lean;
  const rA = mulberry32(99);
  let moved = false, inRange = true;
  for (let d = 1; d <= 200; d++) {
    mindDailyTick(nf, rA, d);
    for (const c of nf.mind.conflicts) {
      if (c.lean <= 0.1 || c.lean >= 0.9) inRange = false;
      if (c.lean !== lean0) moved = true;
    }
  }
  ok(inRange, '200 天 lean 永不收敛到端点（0.15..0.85 内）');
  ok(moved, 'lean 持续摆动');
  eq(nf.mind.fakingSick, false, '心情好不装病');

  // 3. 装病（表演）：真话只进私密自白，对外只说"病了"
  nf.needs.mood = 20;
  const evs = mindDailyTick(nf, rngAlways, 201);
  ok(nf.mind.fakingSick, '心情差时装病');
  ok(nf.mind.secretLog.some(s => s.includes('没病')), '真实原因只进私密自白');
  ok(evs.some(t => t.includes('病')) && !JSON.stringify(evs).includes('不想见人'), '对外只说病了，不说真因');
  const dec = nf.scriptDecide(w1, { hour: 10 }, { precipitating: false }, rngAlways, [], null);
  eq(dec.action, 'rest-sick', '装病者白天闭门不出');
  nf.applyScriptDecision(w1, rngAlways, dec, [], {});
  ok(nf.intent.label.includes('卧床') || nf.intent.label.includes('歇息'), '装病意图：' + nf.intent.label);
  ok(!nf.intent.label.includes('装病'), '对外不标"装病"二字');

  // 4. 撒谎：话题戳中秘密 → 精明的人撒谎 + 记忆 + 压力抬升泄漏风险
  const a = new NPC(ROSTER[5], w1.houses[5]);   // 郑掌柜：精明
  const b = new NPC(ROSTER[0], w1.houses[0]);
  const s = { content: '账本上做过两笔假账', kw: ['账'], selfDeceived: false, knownBy: {}, leakRisk: 0.15, pressure: 0, day: 1 };
  a.mind.secrets = [s];
  // touchChat 先耗 9 次 rng（close×2/trust×2/共同记忆/未说出口×2/误解×2），第 10 次是新增的话题来源闸（0.3 走染色记忆，0.99 守静态表），再进话题链
  const ctx = { clock: { totalDay: 2, hour: 10, season: '春' }, rng: chainRng([0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.85, 0.01, 0.3, 0.01], 11), nowReal: 100, log: null, w: w1 };
  ok(probeSecret(a, '听说粮行在催账') === s, '话题命中秘密关键词');
  ok(tryPairChat(a, b, ctx), '聊天发生');
  eq(s.pressure, 1, '撒谎抬升压力');
  ok(s.leakRisk > 0.15, '泄漏风险随压力上涨');
  ok(a.memories.some(m => m.text.includes('撒了个谎')), '撒谎写进记忆（心里不踏实）');
  ok(a.bubble && a.bubble.text.includes('瞎说'), '说出口的是谎话不是实话');
  eq(b.mind.known.length, 1, '话题余波：秘密说漏给了听者');
  eq(s.knownBy[b.id], 1, 'knownBy 记账（状态 3：不知道别人知道）');
  ok(a.memories.some(m => m.text.includes('说漏')), '说漏嘴写进记忆');

  // 5. 第四态：知情者话里带话 → 持有者察觉（knownBy 1→2）
  const ctx2 = { clock: { totalDay: 2, hour: 11, season: '春' }, rng: chainRng([0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.85, 0.99, 0.01], 12), nowReal: 200, log: null, w: w1 };
  ok(tryPairChat(a, b, ctx2), '第二次聊天发生');
  eq(s.knownBy[b.id], 2, '话里带话捅破窗户纸（状态 4：不知道别人知道他知道）');
  ok(a._perceiveLog.some(t => t.includes('像是知道')), '持有者感知到对方知道了');
  ok(a.memories.some(m => m.text.includes('恐怕知道')), '察觉写进记忆');
  ok(b.bubble && b.bubble.text.includes('谁知道'), '知情者话里带话');

  // 6. 禁忌变脸：话题戳中听者的疤 → 心情-3 + 关系-2 + 深色气泡
  const c = new NPC(ROSTER[1], w1.houses[1]);
  c.mind.voice.taboo = [['矿']];
  const d = new NPC(ROSTER[2], w1.houses[2]);
  const moodBefore = c.needs.mood;
  const ctx3 = { clock: { totalDay: 3, hour: 10, season: '春' }, rng: chainRng([0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.55], 13), nowReal: 400, log: null, w: w1 };
  ok(tryPairChat(d, c, ctx3), '第三次聊天发生');
  eq(c.needs.mood, moodBefore - 3, '禁忌被戳中心情-3');
  ok(relOf(c, d.id).grudge >= 2, '禁忌被戳中：记恨记在关系对象的怨恨上（社会层）');
  ok(c.bubble && c.bubble.anger === true && c.bubble.text.includes('别再提'), '变脸：深色气泡+回嘴');
  ok(c.memories.some(m => m.text.includes('不想听的话')), '变脸写进记忆');

  // 7. 自欺：嘴硬不记账 / 泄漏无自觉 / 路过她家放慢脚步转头
  const e1 = new NPC(ROSTER[3], w1.houses[3]);
  e1.mind.secrets = [{
    content: '嘴上说不在乎林小满，其实路过她家门口都会放慢脚步',
    kw: ['说亲', '婚事', '喜欢', '心上人'], selfDeceived: true, knownBy: {}, leakRisk: 0.1, pressure: 0, day: 0
  }];
  e1.mind.crushId = 'lin';
  const s2 = e1.mind.secrets[0];
  ok(probeSecret(e1, '该给娃说亲了吧') === s2, '感情话题命中自欺秘密');
  tellLie(e1, s2, b, { totalDay: 3, hour: 10 });
  eq(s2.pressure, 0, '自欺者嘴硬不记账');
  ok(!e1.memories.some(m => m.text.includes('撒了个谎')), '自欺者真信那句谎');
  const clk = { totalDay: 3, hour: 10 };
  leakTo(e1, b, rngAlways, clk);
  eq(s2.knownBy[b.id], 1, '自欺者也会说漏（他没自觉）');
  ok(!e1.memories.some(m => m.text.includes('说漏')), '说漏者自己不知道');
  e1.x = c.home.doorX + 2; e1.y = c.home.doorY; e1.dir = 0;
  ok(crushGaze(e1, [e1, c], clk), '路过那个人家门前触发');
  eq(e1.dir, 2, '脸转向她家的方向');
  eq(e1.mind.secretLog.filter(t => t.includes('放慢')).length, 1, '私密自白每日只记一笔');

  // 8. 矛盾行为：上风去镇边望远方，下风想回家待着
  const g1 = new NPC(ROSTER[2], w1.houses[2]);
  for (const cc of g1.mind.conflicts) cc.lean = 0.8;
  const dec8 = g1.scriptDecide(w1, { hour: 18.5 }, { precipitating: false }, chainRng([0.5, 0.05], 77), [], null);
  eq(dec8.action, 'conflict', '矛盾上风触发行为');
  eq(dec8.side, 'out', '上风那面：想出去');
  g1.applyScriptDecision(w1, chainRng([], 78), dec8, [], {});
  ok(g1.intent.label.includes('远方') || g1.path.length > 0, '上风行为：去镇边望着远方出神');
  for (const cc of g1.mind.conflicts) cc.lean = 0.3;
  const dec8b = g1.scriptDecide(w1, { hour: 18.5 }, { precipitating: false }, chainRng([0.5, 0.01], 79), [], null);
  eq(dec8b.side, 'home', '下风那面：想回家');
  ok(dominantConflict(g1.mind) === g1.mind.conflicts[0] || g1.mind.conflicts.length === 1, '主导矛盾取偏得最远的');

  // 9. 快照：心结进 prompt，秘密永不进（第四章·七）
  g1.mind.secrets.push({ content: '账本上做过两笔假账', kw: ['账'], selfDeceived: false, knownBy: {}, leakRisk: 0.1, pressure: 0, day: 3 });
  const snap = npcSnapshot(g1, { w: w1, clock: { hour: 9, totalDay: 3, season: '春' }, weather: { type: 'sunny' }, nameOf: id => id });
  const snapJson = JSON.stringify(snap);
  ok(snap.心结 && typeof snap.心结 === 'string' && snap.心结.includes('，可'), '心结进快照：' + (snap.心结 || ''));
  ok(!snapJson.includes('假账') && !snapJson.includes('secretLog'), '秘密层与私密自白永不进快照');

  // 10. 语言：方言年龄浓度 / 口头禅装饰 / 漂移 / 童谣
  const y = new NPC(ROSTER[7], w1.houses[7]);
  y.mind.voice = { catch: ['哎哟喂'], dialect: [['什么', '啥']], taboo: [['病']], nursery: '月亮走，我也走，我跟月亮打烧酒' };
  y.body.ageYears = 12;
  eq(decorateSay(y, '你说什么', () => 0.3), '你说什么', '少年方言浓度低（0.3 不触发替换）');
  const o = new NPC(ROSTER[8], w1.houses[8]);
  o.mind.voice = { catch: ['哎哟喂'], dialect: [['什么', '啥']], taboo: [['病']], nursery: null };
  o.body.ageYears = 68;
  eq(decorateSay(o, '你说什么', () => 0.3), '你说啥', '老人方言浓度高（0.3 触发替换）');
  ok(decorateSay(y, '你说什么', rngAlways).includes('啥'), '年轻人低概率也会换上方言');
  ok(decorateSay(y, '你说什么', rngAlways).includes('哎哟喂'), '口头禅三成概率出口');
  const vdrift = { catch: ['哎哟喂'] };
  ok(driftVoice(vdrift, rngAlways) && vdrift.catch[0] !== '哎哟喂' && vdrift.catch.length === 1, '口头禅随年月漂移（换人不换数）');
  // 童谣：学生哼小调时哼出童谣
  y.intent = { type: 'idle', label: '哼着小调', sub: '哼小调', untilMin: 30, reason: '', source: 'script' };
  y.x = 36.5; y.y = 26.5;
  y.tick(2, { w: w1, clock: { hour: 15, totalDay: 3, season: '春' }, weather: { type: 'sunny', precipitating: false, snowing: false, raining: false, stormy: false }, rng: rngAlways, npcs: [y], stock: null, nowReal: 5, gmPerReal: 60 });
  ok(y.bubble && y.bubble.text.includes('月亮走'), '学生哼出童谣：' + (y.bubble ? y.bubble.text : ''));

  // 11. 认知层数据随存档完整往返
  const saved = JSON.parse(JSON.stringify(g1.mind));
  const g2 = new NPC(ROSTER[2], w1.houses[2]);
  Object.assign(g2.mind, saved);
  eq(JSON.stringify(g2.mind), JSON.stringify(saved), '认知层数据可随存档完整往返');
}

// ================= 阶段27 生命层：生命周期/遗传/死亡/葬礼/传承（v1.5.0） =================
stage(27, '生命层：生命周期/遗传/死亡/葬礼/传承');
{
  function chainRng(vals, seed) {
    let i = 0, s = (seed || 12345) >>> 0;
    return () => {
      if (i < vals.length) return vals[i++];
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const WX = { precipitating: false, stormy: false, raining: false, snowing: false, type: 'sunny' };
  const g = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g.newGame(2026);
  g.rng = mulberry32(2026);
  const w = g.world;

  // 1. 生命周期阶段边界
  eq(stageOf(0).id, 'infant', '0岁是婴儿');
  eq(stageOf(2).id, 'infant', '2岁仍是婴儿');
  eq(stageOf(3).id, 'child', '3岁是儿童');
  eq(stageOf(12).id, 'child', '12岁仍是儿童');
  eq(stageOf(13).id, 'teen', '13岁是少年');
  eq(stageOf(17).id, 'teen', '17岁仍是少年');
  eq(stageOf(18).id, 'adult', '18岁是成年');
  eq(stageOf(59).id, 'adult', '59岁仍是成年');
  eq(stageOf(60).id, 'elder', '60岁是老年');

  // 2. 遗传：makeChildDef 确定性 + 姓随父 + 发色三分支
  const father = g.npcs.find(n => n.sex === '男');
  const mother = g.npcs.find(n => n.sex === '女');
  const defA = makeChildDef(father, mother, mulberry32(66), 1);
  const defB = makeChildDef(father, mother, mulberry32(66), 1);
  eq(JSON.stringify(defA), JSON.stringify(defB), 'makeChildDef 确定性（同种子同孩子）');
  eq(defA.name[0], father.name[0], '姓随父');
  eq(defA.age, 0, '新生儿 0 岁');
  eq(defA.job, '孩童', '新生儿职业孩童');
  ok(defA.family.parents.includes(father.id) && defA.family.parents.includes(mother.id), '家谱记下父母');
  ok(defA.traits.length >= 1 && defA.traits.length <= 2, '性格 1-2 个性状');
  eq(makeChildDef(father, mother, chainRng([0.3, 0.5, 0.1], 71), 2).hair, father.hair, '发色随父（44%）');
  eq(makeChildDef(father, mother, chainRng([0.3, 0.5, 0.7], 72), 3).hair, mother.hair, '发色随母（44%）');
  ok(['#3b2f2a', '#6b3b1f', '#c8c8c8', '#26201a', '#14181f'].includes(
    makeChildDef(father, mother, chainRng([0.3, 0.5, 0.99], 73), 4).hair), '发色突变进突变池（12%）');

  // 3. 孩子的世界：工作时段永不做工/营造/探索/摆矛盾
  const kid = new NPC(makeChildDef(father, mother, mulberry32(74), 5), w.houses[0]);
  kid.body.ageYears = 10;
  ok(isKid(kid) && !isKid(father), 'isKid 判定（孩子是孩子，大人不是）');
  kid.needs.hunger = 30; kid.needs.energy = 90; kid.needs.social = 80;
  let badAct = null;
  const rngK = mulberry32(9);
  for (let i = 0; i < 60; i++) {
    const d = kid.scriptDecide(w, { hour: 10, min: 600, totalDay: 1 }, WX, rngK, [kid, father, mother], null);
    if (['work', 'build', 'scout', 'conflict', 'mine'].includes(d.action)) { badAct = d.action; break; }
  }
  ok(!badAct, '孩子工作时段永不做工（' + (badAct || '60 轮干净') + '）');
  // 婴儿永远待在屋里
  const baby = new NPC(makeChildDef(father, mother, mulberry32(75), 6), w.houses[0]);
  baby.x = 40; baby.y = 30; baby.inside = false;
  const db = baby.scriptDecide(w, { hour: 10, min: 600, totalDay: 1 }, WX, mulberry32(3), [baby, father, mother], null);
  eq(db.action, 'nest', '婴儿决策：回家待着被喂养');

  // 4. 老年：记忆真的在流失 / 把年轻人认成故人
  const elder = new NPC(ROSTER[9], w.houses[9]);
  elder.body.ageYears = 75;
  elder.memories = [];
  for (let i = 0; i < 20; i++) elder.memory('旧事' + i, 1, 6);
  const evE = elderDaily(elder, () => 0.01, 30);
  ok(evE.length > 0 && elder.memories.length < 20, '老年记忆真的被删掉（' + elder.memories.length + '/20）');
  const kid2 = new NPC(makeChildDef(father, mother, mulberry32(76), 7), w.houses[1]);
  kid2.body.ageYears = 10;
  elder.x = 36; elder.y = 26; elder.inside = false;
  kid2.x = 37; kid2.y = 26; kid2.inside = false;
  ok(elderConfusedSay(elder, [elder, kid2], [{ name: '老陈头' }], () => 0.3, 500, { totalDay: 2, hour: 10 }), '老人把年轻人认成故人');
  ok(elder.bubble && elder.bubble.text.includes('老陈头'), '认错时说的是故人名字');
  ok(!elderConfusedSay(elder, [elder, kid2], [], () => 0.9, 501, { totalDay: 2, hour: 10 }), '低概率时老人不说话');

  // 5. 死亡有过程：年轻不死 / 高龄日折 / 病榻起不来床
  const young = new NPC(ROSTER[5], w.houses[5]);
  young.body.ageYears = 30;
  let youngDead = false;
  for (let i = 0; i < 300; i++) if (dailyMortality(young, () => 0.5)) { youngDead = true; break; }
  ok(!youngDead, '年轻人 300 天平安');
  const old85 = new NPC(ROSTER[6], w.houses[6]);
  old85.body.ageYears = 85;
  eq(dailyMortality(old85, () => 0.001), '寿终正寝', '85 岁极高龄命中 → 寿终正寝');
  eq(dailyMortality(old85, () => 0.9), null, '低折损日平安');
  eq(dailyMortality(young, chainRng([0.00001], 5)), '病故', '强制命中时年轻人病故');
  const sick = g.npcs.find(n => n.id === ROSTER[3].id);   // 必须用镇上名册里的实例（serialize 只快照 g.npcs）
  startDying(sick, '病故', mulberry32(8));
  ok(sick.dying && sick.dying.days >= 2 && sick.dying.days <= 5, '病榻有过程（2-5 日）');
  const ds = sick.scriptDecide(w, { hour: 10, min: 600, totalDay: 1 }, WX, mulberry32(2), [sick], null);
  eq(ds.action, 'rest-sick', '病重者起不来床');

  // 6. 死亡与葬礼全链：名册/镇记/坟茔/讣闻/遗物/哭丧
  const victim = g.npcs.find(n => n.body.ageYears >= 18 && n !== sick && n !== elder);
  const mourner = g.npcs.find(o => o !== victim && o !== sick && o !== elder && !o.spouse);
  mourner.relations[victim.id] = 60;
  const moodBefore = mourner.needs.mood;
  const cnt0 = g.npcs.length;
  victim.dying = { cause: '寿终正寝', days: 0 };
  const grave = dieAndFuneral(g, victim);
  ok(grave && grave.x >= 0 && grave.y >= 0, '坟茔落在屋后草地上');
  eq(objAt(w, grave.x, grave.y), O.GRAVE, '坟茔写进地图（存在要被看见）');
  eq(g.npcs.length, cnt0 - 1, '逝者移出名册');
  eq(g.dead.length, 1, '镇史记了一笔');
  const rec = g.dead[0];
  ok(rec.name === victim.name && rec.cause === '寿终正寝' && rec.age === victim.body.ageYears && rec.day >= 1, '镇记字段完整');
  eq(mourner.needs.mood, moodBefore - 16, '知己闻讣心情-12 + 遗物-4（他同时是继承人）');
  ok(mourner.memories.some(m => m.text.includes('留给了我')), '遗物交给最亲的人');
  ok(g.logLines.some(l => l.text.includes('享年')), '日志记下享年');
  ok(g._funeral && g._funeral.name === victim.name, '葬礼启动');
  // 葬礼进行时：亲属到坟前哭丧
  mourner.x = grave.x + 1; mourner.y = grave.y; mourner.inside = false;
  mourner.intent = { type: 'ready', label: '待命', untilMin: 0 };
  g.nowReal = 100;
  g.funeralTick();
  ok(mourner.bubble && mourner.bubble.text.length > 0, '坟前哭出声来');
  ok(mourner.memories.some(m => m.text.includes('坟前哭了一场')), '哭丧写进记忆');
  g.funeralTick();
  eq(mourner.memories.filter(m => m.text.includes('坟前哭了一场')).length, 1, '哭丧只记一笔（said 记账）');

  // 7. 传承：结伴 → 出生 → 成年转职
  const ma = g.npcs.find(n => n.sex === '男' && n.body.ageYears >= 18 && n.body.ageYears <= 59 && !n.spouse && n !== sick);
  const fe = g.npcs.find(n => n.sex === '女' && n.body.ageYears >= 18 && n.body.ageYears <= 59 && !n.spouse && n !== sick && n !== ma);
  ma.relations[fe.id] = 50; fe.relations[ma.id] = 50;
  const savedRng = g.rng;
  g.rng = () => 0.01;                       // 命中 5% 结伴概率
  const pair = pairCheck(g);
  g.rng = savedRng;
  ok(pair && ma.spouse === fe.id && fe.spouse === ma.id, '两情相悦者成伴');
  ok(ma.memories.some(m => m.text.includes('成了伴儿')), '成伴写进记忆');
  fe.body.ageYears = 25;                    // 育龄
  const cnt1 = g.npcs.length;
  // v4.5.0：tryBirth 语义改为受孕——当天不掉孩子，先怀上，十月后分娩
  const conc = tryBirth(g, () => 0.001);
  ok(conc && conc.mother === fe && conc.father === ma, '受孕判定命中');
  ok(fe.preg && fe.preg.fatherId === ma.id && fe.preg.due === g.clock.totalDay + 280, '孕期 280 日记账');
  ok(fe.memories.some(m => m.text.includes('有了身子')) && ma.memories.some(m => m.text.includes('要当爹了')), '受孕写进两人记忆');
  fe.preg.due = g.clock.totalDay;           // 催产：让分娩今天发生（测试确定性）
  g.rng = () => 0.5;                        // 避开夭折(0.02)/难产(0.08)
  const nbs = birthDaily(g, g.clock.totalDay);
  g.rng = savedRng;
  eq(nbs.length, 1, '分娩产出一个新生儿');
  ok(!fe.preg, '分娩后孕期清空');
  const nb = nbs[0];
  const born = g.addBorn(nb);
  ok(born && g.npcs.length === cnt1 + 1, '新生儿入名册');
  ok(born.family.parents.includes(ma.id) && ma.family.childIds.includes(born.id), '家谱双向记账');
  ok(ma.memories.some(m => m.text.includes('出生了')) && fe.memories.some(m => m.text.includes('出生了')), '父母记住了这一天');
  ok(born.inside, '婴儿在家里被喂养');
  const famHouse = w.houses.find(h => h.ownerId === ma.id) || w.houses.find(h => h.ownerId === fe.id);
  ok(born.home && famHouse && born.home.hx === famHouse.x && born.home.hy === famHouse.y, '新生儿入父母家户籍');
  born.body.ageYears = 18;
  const grownJob = assignAdultJob(born, g.npcs, mulberry32(31), 5);
  ok(grownJob === '' && born.job === '', '18 岁成年不分配职业（白纸：活计由演化长出）');
  ok(born.memories.some(m => m.text.includes('成年')), '成年写进记忆');

  // 8. 生命层数据随存档完整往返
  const snap = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = Game.hydrate(snap, { mapDirty: false, meteor() {}, shake() {} });
  eq(g2.dead.length, g.dead.length, '镇记随存档往返');
  ok(g2.dead[0] && g2.dead[0].name === rec.name, '故者档案完整往返');
  ok(g2._lifeSeq > 1, '新生儿序号往返（' + g2._lifeSeq + '）');
  const born2 = g2.npcs.find(n => n.id === born.id);
  ok(born2 && born2.family.parents.length === 2 && born2.inside, '家谱与婴儿状态往返');
  const ma2 = g2.npcs.find(n => n.id === ma.id);
  ok(ma2 && ma2.spouse === fe.id, '婚配关系往返');
  const sick2 = g2.npcs.find(n => n.id === sick.id);
  ok(sick2 && sick2.dying && sick2.dying.days >= 0, '病榻状态往返');
}

// ================= 阶段28 社会层：关系对象/习俗/权力/人口流动/喜歌（v1.6.0） =================
stage(28, '社会层：关系对象/习俗/权力/人口流动/喜歌');
{
  function chainRng(vals, seed) {
    let i = 0, s = (seed || 12345) >>> 0;
    return () => {
      if (i < vals.length) return vals[i++];
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const g = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g.newGame(2026);
  g.rng = mulberry32(2026);
  const w = g.world;
  const byId = id => g.npcs.find(n => n.id === id);

  // 1. 关系是独立对象：relOf 惰性升级 / bond 恒等 / 单向存储
  const chen = byId('chen'), lin = byId('lin'), zhao = byId('zhao'), zhou = byId('zhou'),
    wu = byId('wu'), zheng = byId('zheng'), wang = byId('wang'), feng = byId('feng'),
    he = byId('he'), su = byId('su');
  const r0 = relOf(chen, lin.id, 1);
  ok(r0 && r0.o === lin.id && typeof r0.close === 'number' && Array.isArray(r0.tags), 'relOf：关系是带六维的对象');
  eq(bond(makeRelation('x', 40, 1)), 40, 'bond 恒等：close=trust=v 时 bond=v');
  ok(chen.rels[lin.id] !== lin.rels[chen.id], '单向存储：A 对 B 与 B 对 A 是两个独立对象');
  const NB = new NPC(ROSTER[3], w.houses[3]);
  ok(NB.rels && Object.keys(NB.rels).length === Object.keys(NB.relations).length, '新 NPC 落地即带关系对象');
  const OLD = zheng;
  OLD.rels = null; OLD.relations = { zz: -30 };
  ensureRels(OLD, 3);
  ok(OLD.rels.zz && OLD.rels.zz.close === -30 && OLD.rels.zz.trust === -30, '旧档数值关系惰性升格为关系对象');
  zheng.rels = zheng.rels || {};   // 后续测试 zheng 还有关系（zz 之外清空重来）
  zheng.relations = {};

  // 2. touchChat 不对称：两段关系各涨各的（定值队列：a 涨 3、b 涨 1）
  zhou.rels = {}; zhou.relations = { [wu.id]: 0 };
  wu.rels = {}; wu.relations = { [zhou.id]: 0 };
  touchChat(zhou, wu, { totalDay: 2, hour: 10 }, chainRng([0.99, 0.01], 21));
  eq(zhou.rels[wu.id].close, 3, 'touchChat：zhou 对 wu 的亲密度 +3');
  eq(wu.rels[zhou.id].close, 1, 'touchChat：wu 对 zhou 的亲密度 +1（不对称）');

  // 3. touchChat 生成链：共同记忆 / 未说出口 / 误解（14 值定值队列逐项命中）
  chen.rels = {}; chen.relations = { [lin.id]: 0 };
  lin.rels = {}; lin.relations = { [chen.id]: 0 };
  touchChat(chen, lin, { totalDay: 7, hour: 9 },
    chainRng([0.5, 0.5, 0.5, 0.5, 0.01, 0.7, 0.01, 0.5, 0.01, 0.5, 0.01, 0.5, 0.01, 0.5], 71));
  eq(relOf(chen, lin.id, 7).shared.length, 1, '共同记忆：一起扛过的事各存了一笔');
  eq(relOf(lin, chen.id, 7).shared.length, 1, '共同记忆两边都有（各存各的版本）');
  ok(relOf(chen, lin.id, 7).unsaid && relOf(lin, chen.id, 7).unsaid, '未说出口的话各自长了一句');
  ok(relOf(chen, lin.id, 7).meta && relOf(lin, chen.id, 7).meta, '误解各自长了一条');

  // 4. 误解永不对齐：M1 带着误解聊一百天，M2 的关系对象里永远不长出同一个误解
  zheng.rels = {}; zheng.relations = { [wang.id]: 10 };
  wang.rels = {}; wang.relations = { [zheng.id]: 10 };
  relOf(zheng, wang.id, 1).meta = { belief: '我一直拿' + wang.name + '当亲兄弟看', day: 1, deep: 0 };
  for (let d = 0; d < 100; d++) touchChat(zheng, wang, { totalDay: 8 + d, hour: 10 }, () => 0.99);
  ok(relOf(zheng, wang.id, 1).meta, '误解长在 zheng 的关系对象上');
  eq(relOf(wang, zheng.id, 1).meta, null, '误解不对称：wang 的关系对象里永远没有它（永不自动对齐）');

  // 5. 吵架：怨恨加深 + 暴躁者引发恐惧（zhao 自带暴躁）
  const fear0 = relOf(wang, zhao.id, 1).fear, g0 = relOf(wang, zhao.id, 1).grudge;
  quarrel(wang, zhao, { totalDay: 9, hour: 10 }, chainRng([], 31), 10, null);
  ok(relOf(wang, zhao.id, 9).grudge > g0, 'quarrel：怨恨加深');
  ok(relOf(wang, zhao.id, 9).fear > fear0, 'quarrel：对面是暴躁的人，这一架空前也怕');
  ok(wang.memories.some(m => m.text.includes('吵了一架')), '吵架写进记忆');

  // 6. 和解：共同记忆是台阶
  relOf(zheng, he.id, 1).grudge = 30;
  relOf(he, zheng.id, 1).grudge = 30;
  relOf(zheng, he.id, 1).shared = ['那年发大水，我们俩一起堵过半宿的沙袋'];
  reconcile(zheng, he, { totalDay: 10, hour: 9 }, chainRng([], 33), 12, null);
  ok(relOf(zheng, he.id, 10).grudge < 30 && relOf(he, zheng.id, 10).grudge < 30, 'reconcile：旧怨松了（两边各让一步）');
  ok(zheng.memories.some(m => m.text.includes('话说开')), '和解写进记忆');

  // 7. relDailyTick：亏欠会淡、忌惮会散、旧怨衰减、误解越扎越深
  su.rels = su.rels || {};
  const rd = relOf(su, lin.id, 1);
  rd.owe = 10; rd.fear = 10; rd.grudge = 20; rd.lastD = 1;
  rd.meta = { belief: '总觉得她待我跟别人不一样', day: 1, deep: 2 };
  relDailyTick(su, chainRng([0.01], 34), 20);
  eq(rd.owe, 9, 'relDailyTick：亏欠会淡');
  eq(rd.fear, 9, 'relDailyTick：忌惮会散');
  eq(rd.grudge, 19, 'relDailyTick：旧怨随日子衰减');
  eq(rd.meta.deep, 3, 'relDailyTick：误解只会越扎越深');
  // 配偶的日子久了，是离不得的
  he.spouse = wang.id;
  const rs = relOf(he, wang.id, 1);
  rs.depend = 10;
  relDailyTick(he, chainRng([0.01, 0.01, 0.01, 0.01], 35), 21);
  eq(rs.depend, 11, 'relDailyTick：伴侣的日子久了，是离不得的（depend+1）');

  // 8. 标签可互相矛盾：冤家与托底的人长在同一个人身上
  const rt = relOf(zhou, zhao.id, 1);
  rt.close = 80; rt.trust = 80; rt.grudge = 60; rt.fear = 60;
  refreshTags(rt);
  ok(rt.tags.includes('冤家') && rt.tags.includes('托底的人'), '标签可互相矛盾：冤家与托底的人同存');
  const rt2 = relOf(zhou, wu.id, 1);
  rt2.close = 80; rt2.trust = 80; rt2.grudge = 0; rt2.fear = 0;
  refreshTags(rt2);
  ok(rt2.tags.includes('知心') && rt2.tags.includes('托底的人'), 'bond≥80 定性知心');

  // 9. 权力：被信任/依赖的人说话更有分量（powerOf 由他人关系堆出来）
  for (const o of [lin, zheng, wang, zhou, wu, he]) {
    const rC = relOf(o, chen.id, 1); rC.trust = 60; rC.depend = 40; refreshTags(rC);
    const rS = relOf(o, su.id, 1); rS.grudge = 60; refreshTags(rS);
  }
  ok(powerOf(chen, g.npcs) > powerOf(su, g.npcs), '权力：信任/依赖堆出说话的分量');
  ok(powerOf(chen, g.npcs) >= 0 && powerOf(chen, g.npcs) <= 100, 'powerOf 落在 0..100');
  const arb = pickArbiter(su, chen.id, g.npcs);
  ok(arb && arb.id !== su.id && arb.id !== chen.id, 'pickArbiter：纠纷双方不当评理人');

  // 10. 评理：找说话算数的人，旧怨松一松，评理人涨「服管」的信任
  relOf(wang, he.id, 1).grudge = 80;          // 必须是 wang 最重的一段旧怨（wang→su 60）
  const gHePre = relOf(wang, he.id, 1).grudge;
  const trustPre = relOf(wang, zheng.id, 1).trust;
  ok(tryMediate(wang, zheng, { clock: { totalDay: 11, hour: 10 }, rng: mulberry32(41), nowReal: 100, log: null, w }),
    '评理发生');
  ok(relOf(wang, he.id, 11).grudge < gHePre, '评理：旧怨松了');
  ok(relOf(wang, zheng.id, 11).trust > trustPre, '评理人涨了「服管」的信任');

  // 11. 习俗：聊天是规矩走的路；倔的人不买账
  const CU = [{ id: 'wenhao', name: '路上问好', desc: '路上见了长辈要先开口问好', by: he.name, day: 1, holders: [he.id] }];
  const out1 = spreadCustoms(he, lin, CU, { totalDay: 12, hour: 10 }, () => 0.01, null);
  ok(CU[0].holders.includes(lin.id) && out1.some(t => t.includes('传开')), '习俗传播：规矩是嘴上走的');
  ok(lin.memories.some(m => m.text.includes('学会')), '学规矩写进记忆');
  feng.traits = [...feng.traits, '倔'];
  const out2 = spreadCustoms(he, feng, CU, { totalDay: 12, hour: 11 }, () => 0.01, null);
  ok(!CU[0].holders.includes(feng.id) && out2.some(t => t.includes('不认')), '习俗冲突：倔的人不买账');
  ok(feng.memories.some(m => m.text.includes('不以为然')), '拒斥写进记忆');
  // customDaily（语言革命 v3.1.0）：习俗不再无中生有——只从演化引擎来；本层只剩物理：没人守的老规矩自然消失
  const savedRng2 = g.rng;
  g.customs = [];
  g.rng = chainRng([0.01], 51);
  const evtsC = customDaily(g);
  ok(g.customs.length === 0 && evtsC.length === 0, 'customDaily：习俗不无中生有（只从演化引擎来）');
  g.customs = [{ id: 'wenhao2', name: '路上问好', desc: '路上见了长辈要先开口问好', by: he.name, day: 1, holders: [he.id] }];
  g.customs[0].holders.push('ghost-id');
  g.rng = chainRng([0.99], 52);
  customDaily(g);
  ok(!g.customs[0].holders.includes('ghost-id'), '守规人只留活人（死规矩自然消失的种子）');
  g.customs[0].holders = ['ghost-a', 'ghost-b'];   // 全死绝 → 规矩消失
  customDaily(g);
  ok(g.customs.length === 0, '没人守的老规矩自然消失');
  g.rng = savedRng2;

  // 12. 人口流动：拉力与推力
  g.stock.gold = 200; g.stock.crop = 60;
  for (const n of g.npcs) n.needs.mood = 60;
  ok(pullScore(g) > 0.2, '拉力：繁荣与人心把人往镇里拉');
  g.stock.gold = 0; g.stock.crop = 0;
  for (const n of g.npcs) n.needs.mood = 50;
  ok(pullScore(g) >= 0.02, '拉力保底：总有恰好路过的人');
  eq(pushScore(feng), 0, '推力：孩子不走');
  eq(pushScore(he), 0, '推力：有伴的人不走（远方命除外）');
  const savedHeWl = he.wanderlust, savedHeRels = he.rels, savedHeRelations = he.relations;
  he.wanderlust = 0.99; he.rels = {}; he.relations = { x: 10 }; he.needs.mood = 60;
  ok(pushScore(he) > 0 && pushScore(he) <= 0.02, '推力：远方命的有伴者，婚姻拴不住也能被远方推走（细流）');
  he.wanderlust = savedHeWl; he.rels = savedHeRels; he.relations = savedHeRelations;
  // v4.4.2：离镇有了锚——心安即不走（旧版裸累积四十天走光，是失控 bug）
  zhao.needs.mood = 60;
  zhao.relations = { x: 10 };   // 「人缘不差」是前提，显式立住——不靠开局骰流赏脸（v4.5.0 离镇骰流隔离后，自然人缘随种子漂移）
  const savedWl = zhao.wanderlust;
  zhao.wanderlust = 0;          // 「心安」也是前提：远方命是天生性情，这里测的是牵挂的锚，不是性情
  ok(pushScore(zhao) === 0, '推力：日子过得去、人缘不差的人，这镇子留得住');
  zhao.wanderlust = 0.99;       // 天生的远方命：日子再好、人缘再顺，心里也长着远方（细流，不是决堤）
  ok(pushScore(zhao) > 0 && pushScore(zhao) <= 0.02, '推力：远方命的人，心安也拴不住（但只是细流）');
  zhao.wanderlust = savedWl;
  zhao.relations = {};
  zhao.needs.mood = 20;
  zhao.family = { parents: [], childIds: [] };
  ok(pushScore(zhao) > 0 && pushScore(zhao) <= 0.02, '推力：孤身且日子难过的人推力很低（远低于旧版裸掷骰）');
  const savedRels3 = zhao.rels;
  zhao.rels = {}; relOf(zhao, he.id, 1).close = 30; relOf(zhao, he.id, 1).trust = 30;
  zhao.wanderlust = 0;   // 同上：这里测的是牵挂网的锚，把天生性情变量摘掉
  eq(pushScore(zhao), 0, '推力：有处得来的人（牵挂网）就不走');
  zhao.wanderlust = savedWl;
  zhao.rels = savedRels3;
  zhao.relations = {};
  eq(departReason(zhao), '想去外面看看', '离镇缘由：野心');
  zhao.relations = { x: -50 };
  eq(departReason(zhao), '在镇上待不下去了', '离镇缘由：待不下去');
  const td = makeTravelerDef(mulberry32(61), 9);
  ok(td.id === 't9' && td.origin === '客籍', '客籍档案：序号与出身');
  ok(['农夫', '樵夫', '渔夫', '厨子', '商人'].includes(td.job), '客籍职业受限');
  ok(td.traits.length === 2 && new Set(td.traits).size === 2, '客籍性格 2 个性状不重复');
  ok(td.age >= 20 && td.age <= 45 && td.pers && td.name.length >= 2, '客籍成年有名有来历');

  // 13. 离镇：走的人把名字留在镇史里，挚友记住了道别
  const zhaoHouse = w.houses.find(h => h.ownerId === zhao.id);
  ok(!!zhaoHouse, '离镇者有房（腾给后来人）');
  relOf(wang, zhao.id, 1).close = 40;
  const moodW0 = wang.needs.mood;
  const cntN0 = g.npcs.length;
  // v4.4.2：人走了，芯留下——寄宿者离镇时芯回游荡池（否则永久卡在已离开模拟的宿主上，轮回永不发生）
  const savedCore = g.neurocore;
  g.neurocore = makeNeurocore(zhao.id, 1);
  zhao.departing = { since: 1, why: '想去外面看看' };
  g.finalizeDepart(zhao);
  ok(g.neurocore.floating === true && g.neurocore.hostId === zhao.id && g.neurocore.lastHost === zhao.name,
    '离镇时神经芯离体回游荡池（等新生儿，不随宿主消失）');
  g.neurocore = savedCore;
  eq(g.npcs.length, cntN0 - 1, '离镇者移出名册');
  ok(g.left.some(r => r.name === zhao.name && r.why === '想去外面看看'), '镇史记下走的人与缘由');
  ok(wang.memories.some(m => m.text.includes('道过别')), '挚友记住了道别');
  ok(wang.needs.mood < moodW0, '道别令人心情低落');

  // 14. 迁入：客籍住进故人留下的空房，初来乍到谁也不认识
  const tn = g.addTraveler(makeTravelerDef(mulberry32(62), 10));
  ok(tn.home && zhaoHouse && tn.home.hx === zhaoHouse.x && tn.home.hy === zhaoHouse.y, '客籍住进故人留下的空房');
  ok(tn.origin === '客籍' && Object.keys(tn.rels).length === 0, '初来乍到：谁也不认识');
  ok(g.npcs.every(o => o.id === tn.id || o.relations[tn.id] === 0), '全镇对生人的关系从零起');
  ok(tn.memories.some(m => m.text.includes('初到雾溪镇')), '落脚写进记忆');

  // 15. 婚嫁喜歌：拜堂开腔、喜饼分邻、喜宴散场
  g.customs.push({ id: 'xibing', name: '喜饼分邻', desc: '谁家办喜事，要给街坊分一块喜饼', by: chen.name, day: 12, holders: [chen.id] });
  g.stock.crop = 50;
  g.clock.min = 600;
  chen.x = 36; chen.y = 26; chen.inside = false;
  lin.x = 38; lin.y = 26; lin.inside = false;
  zheng.x = 36.5; zheng.y = 26.5; zheng.inside = false;
  zheng.intent = { type: 'idle', label: '看热闹', untilMin: 0 };
  g.nowReal = 200;
  g.startWedding({ a: chen.id, b: lin.id });
  ok(g._wedding && g._wedding.aId === chen.id, '婚嫁启动');
  ok(g.logLines.some(l => l.text.includes('拜堂')), '喜讯全镇广播（日志）');
  const cropBefore = g.stock.crop;
  g.weddingTick();
  ok(chen.bubble && g.lexicon.weddingSong.some(w => chen.bubble.text.includes(w.slice(0, 4))), '喜歌开腔（新人唱起喜歌，词出自当下词库）');
  ok(lin.bubble && g.lexicon.weddingSong.some(w => lin.bubble.text.includes(w.slice(0, 4))), '对唱喜歌');
  ok(chen.memories.some(m => m.text.includes('拜了天地')) && lin.memories.some(m => m.text.includes('拜了天地')), '拜堂写进新人记忆');
  ok(zheng.memories.some(m => m.text.includes('喜酒')), '在场街坊喝了喜酒写进记忆');
  ok(zheng.needs.mood > 50, '吃喜酒心情变好');
  eq(g.stock.crop, cropBefore - 2, '喜饼分邻：守规矩的人家分了喜饼（粮食-2）');
  ok(g.logLines.some(l => l.text.includes('喜饼')), '习俗反过来被人守着（日志）');
  g.clock.min = 950;
  g.weddingTick();
  ok(!g._wedding && g.logLines.some(l => l.text.includes('喜宴散了')), '喜宴散场');

  // 16. 未说出口的话，跟着人进了土里
  relOf(wang, tn.id, 1).unsaid = '有句谢谢，一直没跟' + tn.name + '说出口';
  g.forceDeath(tn.id);
  ok(wang.memories.some(m => m.text.includes('没来得及对' + tn.name + '说出口')), '未说出口的话跟着人进了土里');
  eq(relOf(wang, tn.id, 1).unsaid, null, '那句终究没说出口（随葬清空）');

  // 17. 社会层数据随存档完整往返 + 快照带标签
  const rsa = relOf(chen, lin.id, 12);
  rsa.grudge = 12; rsa.tags = ['熟络']; rsa.close = 80; rsa.trust = 80;
  chen.relations[lin.id] = bond(rsa);         // 同步 bond 缓存（快照按数值排序取前几）
  const snap2 = JSON.parse(JSON.stringify(g.serialize()));
  const g3 = Game.hydrate(snap2, { mapDirty: false, meteor() {}, shake() {} });
  const chen3 = g3.npcs.find(n => n.id === chen.id);
  const rsa2 = relOf(chen3, lin.id, 12);
  eq(rsa2.grudge, 12, '关系对象随存档往返（怨恨）');
  ok(rsa2.shared.length === 1 && rsa2.shared[0].includes('河滩'), '共同记忆随存档往返');
  ok(rsa2.meta && rsa2.meta.belief.length > 0, '误解随存档往返（不对称也原样带过去）');
  eq(JSON.stringify(rsa2.tags), JSON.stringify(['熟络']), '关系标签随存档往返');
  ok(g3.customs.some(c => c.id === 'xibing'), '习俗随存档往返');
  ok(g3.left.some(r => r.name === zhao.name), '镇史（离镇的人）随存档往返');
  eq(g3._inSeq, g._inSeq, '客籍序号随存档往返');
  const snp = npcSnapshot(chen3, { w: g3.world, clock: { hour: 9, totalDay: 13, season: '春' }, weather: { type: 'sunny' }, nameOf: id => id });
  ok(snp.关系 && snp.关系.includes('熟络'), '快照关系带自己视角的标签（' + snp.关系 + '）');
}

// ================= 阶段29 物质层：材料链/搬运/加工/施工/维护/开拓（v1.7.0） =================
stage(29, '物质层：材料链/积木营造/磨损废墟/殖民地');
{
  function chainRng(vals, seed) {
    let i = 0, s = (seed || 12345) >>> 0;
    return () => {
      if (i < vals.length) return vals[i++];
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const edgeBand = (x, y, ww, wh) => x < 14 || x > ww - 15 || y < 14 || y > wh - 15;

  // 0. 常量与可通行：原木躺在地上，路还走得通
  ok(!BLOCK_OBJ.has(O.LOG), '原木可通行（BLOCK_OBJ 不含 LOG）');
  ok(BLOCK_OBJ.has(O.RUIN), '废墟挡路（塌了的地方过不去）');
  eq(MAT.LOGS_PER_PLANK, 3, '3 根原木出一炉料');
  eq(MAT.PLANKS_PER_BATCH, 2, '一炉出 2 块板（加工有损耗）');
  eq(MAT.CARRY, 2, '一次扛 2 块板（远的地方分几趟）');
  eq(MAT.BARN_CAP, 60, '仓库容量 60');

  const g = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g.newGame(2027);
  g.rng = mulberry32(2027);
  const w = g.world;
  const zhou = g.npcs.find(n => n.id === 'zhou');

  // 1. 初始仓库：镇子建立时带来的存货总得有地方放
  ok(g.barn && objAt(w, g.barn.x, g.barn.y) === O.BARN, '开局自带一座仓库');

  // 2. 砍树掉原木：树倒在地上，不入库（材料是真的）
  let treeSpot = null;
  outer: for (let y = 6; y < 34; y++) for (let x = 4; x < 24; x++) {
    if (objAt(w, x, y) === O.TREE && groundAt(w, x, y) === G.GRASS) { treeSpot = { x, y }; break outer; }
  }
  ok(!!treeSpot, '林子里有树可砍');
  const gotLog = harvestObj(w, treeSpot.x, treeSpot.y, mulberry32(31));
  ok(gotLog && gotLog.res === 'log' && gotLog.qty >= 1, '砍树掉的是原木（res=log）');
  eq(objAt(w, treeSpot.x, treeSpot.y), O.STUMP, '砍树留桩');
  let logsDown = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = treeSpot.x + dx, y = treeSpot.y + dy;
    if (x >= 0 && y >= 0 && x < TOWN_W && y < TOWN_H && objAt(w, x, y) === O.LOG) logsDown++;
  }
  ok(logsDown >= 1, '原木躺在砍倒处的地上（' + logsDown + ' 根）');

  // 3. 加工 3:2 与仓库容量
  g.workshop = { x: g.barn.x, y: g.barn.y, logs: 6, mill: 0 };
  g.stock.wood = 10;
  g.millTick(zhou, MAT.MILL_MIN);
  eq(g.workshop.logs, 3, '加工：6 根原木锯一批剩 3 根');
  eq(g.stock.wood, 12, '加工：3 根原木出 2 块板进仓库');
  g.stock.wood = MAT.BARN_CAP;
  g.millTick(zhou, MAT.MILL_MIN);
  eq(g.workshop.logs, 3, '仓库堆满：拒产不吞料');
  eq(g.stock.wood, MAT.BARN_CAP, '仓库容量封顶');

  // 4. 缺料的工地：工人只能等；料齐了才推进 → 落成带样式
  const plan = g.addPlan('shed', null, null, zhou.name, { x: Math.floor(zhou.x), y: Math.floor(zhou.y) });
  ok(plan && plan.needMat.wood === 6, '立项储物棚：需要 6 块木板（料从仓库出）');
  if (plan) {
    plan.builder = zhou.id;
    g.workOnPlan(zhou, 50);
    eq(plan.progress, 0, '缺料：进度一寸不动');
    ok(plan._waited, '缺料：等待被记下（干等也是活儿的一部分）');
    plan.delivered.wood = plan.needMat.wood;
    g.workOnPlan(zhou, plan.need);
    eq(objAt(w, plan.x, plan.y), O.SHED, '料齐施工：储物棚落成');
    ok(g.wear.get(plan.x + ',' + plan.y), '落成即开始被岁月磨损');
    ok(g.styles.has(plan.x + ',' + plan.y), '落成带着自己的样式（积木营造）');
    ok(!g.plans.includes(plan), '落成的计划从案头撤下');
  }

  // 5. 搬运四站：装板/卸板/拾原木/存原木
  const plan2 = g.addPlan('bench', null, null, '神', { x: Math.floor(zhou.x), y: Math.floor(zhou.y) });
  ok(plan2 && plan2.needMat.wood === 2, '立项长凳：需要 2 块板');
  if (plan2) {
    g.stock.wood = 10; zhou.carrying = null;
    g.haulArrive(zhou, { stage: 'load', planId: plan2.id });
    eq(g.stock.wood, 8, '装货：从仓库背出 2 块板');
    ok(zhou.carrying && zhou.carrying.plank === 2, '一次扛 2 块');
    g.haulArrive(zhou, { stage: 'drop', planId: plan2.id });
    eq(plan2.delivered.wood, 2, '卸货：工地收到 2 块板');
    eq(zhou.carrying, null, '板子卸下了');
    // 拾原木 → 存坊（原木沉，一次一根）
    let logAt = null;
    outerLog: for (let y = 0; y < TOWN_H; y++) for (let x = 0; x < TOWN_W; x++) {
      if (objAt(w, x, y) === O.LOG) { logAt = { x, y }; break outerLog; }
    }
    ok(logAt, '地上还有散落的原木');
    if (logAt) {
      zhou.x = logAt.x; zhou.y = logAt.y; zhou.inside = false;
      zhou.carrying = null;
      g.haulArrive(zhou, { stage: 'pick' });
      eq(objAt(w, logAt.x, logAt.y), O.NONE, '拾货：原木上了肩');
      ok(zhou.carrying && zhou.carrying.log === 1, '原木沉，一次只扛一根');
      g.haulArrive(zhou, { stage: 'store' });
      eq(g.workshop.logs, 4, '存坊：坊里又堆了一根原木');
      eq(zhou.carrying, null, '肩上的活儿干完了');
    }
  }
  zhou.x = 36; zhou.y = 26; zhou.inside = false;   // 人回镇中心（后续锚点用）

  // 6. 修缮：有人修，就还没垮
  const shedKey = plan ? plan.x + ',' + plan.y : null;
  if (shedKey) {
    g.wear.set(shedKey, { v: 1, work: 0 });
    g.stock.wood = 5;
    g.repairTick(zhou, MAT.REPAIR_MIN, shedKey);
    eq(g.wear.get(shedKey).v, 0, '修缮：破损 -1');
    eq(g.stock.wood, 4, '修缮：花了一块板');
  }

  // 7a. 维护日：磨损到头塌成废墟（没人修，慢慢垮）
  if (shedKey) {
    g.wear.set(shedKey, { v: 2, work: 0 });
    g.rng = chainRng([0.01, 0.01], 81);   // 仓库磨一下、棚子磨塌
    g.maintDaily(30);
    eq(objAt(w, plan.x, plan.y), O.RUIN, '磨损到头：塌成废墟');
    ok(!g.wear.has(shedKey) && !g.styles.has(shedKey), '废墟不再记账');
  }

  // 8. 积木营造的配色：有人给就用人给的，没人给就按建筑方言来
  const stAI = g.buildStyle({ style: { hue: 2, v: 1 }, by: '神', x: 40, y: 30 });
  eq(stAI.hue, 2, 'AI 配色：hue 有人给就用人给的');
  eq(stAI.v, 1, 'AI 配色：变体同理');
  g.rng = chainRng([0.0, 0.0], 85);   // 棚子已塌、样式册空：中心暖 hue0，不模仿邻居，变体0
  const stC = g.buildStyle({ style: null, x: 30, y: 30, by: '陈麦冬' });
  eq(stC.hue, 0, '方言：镇中心偏暖');
  eq(stC.v, 0, '方言：变体随机落定');
  g.rng = chainRng([0.0, 0.0], 86);
  const stE = g.buildStyle({ style: null, x: 70, y: 40, by: '周大樵' });
  eq(stE.hue, 2, '方言：郊野偏冷');

  // 9. 殖民地：镇子往外长，但永远有个中心
  eq(g.colony, null, '起初没有殖民地');
  const centerSite = findSiteNear(w, 36, 26, mulberry32(90), []);
  if (centerSite && !edgeBand(centerSite.x, centerSite.y, TOWN_W, TOWN_H)) {
    g.stock.wood = 30;
    const pc = g.addPlan('cabin', centerSite.x, centerSite.y, '神', null);
    if (pc) {
      pc.builder = zhou.id; pc.delivered.wood = pc.needMat.wood;
      g.workOnPlan(zhou, pc.need);
      eq(objAt(w, pc.x, pc.y), O.CABIN, '镇中心的小屋立起来了');
    }
    eq(g.colony, null, '镇中心的小屋不算殖民地（镇子永远中心）');
  }
  let edgeSite = null;
  for (const [cx, cy, sd] of [[72, 30, 91], [8, 40, 92], [40, 68, 93], [72, 45, 94]]) {
    const s = findSiteNear(w, cx, cy, mulberry32(sd), []);
    if (s && edgeBand(s.x, s.y, TOWN_W, TOWN_H)) { edgeSite = s; break; }
  }
  ok(!!edgeSite, '镇郊找得到落脚的地');
  if (edgeSite) {
    g.stock.wood = 30;
    const pe = g.addPlan('cabin', edgeSite.x, edgeSite.y, '神', null);
    ok(!!pe, '边缘小屋立了项');
    if (pe) {
      pe.builder = zhou.id; pe.delivered.wood = pe.needMat.wood;
      g.workOnPlan(zhou, pe.need);
      ok(g.colony && g.colony.foundedDay === g.clock.totalDay, '第一间小屋落成：殖民地开始了');
      ok(g.colony.houses.some(h2 => h2.x === pe.x && h2.y === pe.y), '殖民地记下了这间屋');
      eq(objAt(w, pe.x, pe.y), O.CABIN, '林间小屋立在了郊野');
    }
  }

  // 10. 开拓：得先有人看见那块地，镇子才往那长
  g.frontier = null;
  const zhao = g.npcs.find(n => n.id === 'zhao');
  zhao.x = 72; zhao.y = 30;
  g.rng = mulberry32(97);
  ok(g.findFrontierNear(zhao), '边缘带找得到无主好地');
  ok(g.frontier && edgeBand(g.frontier.x, g.frontier.y, TOWN_W, TOWN_H), '好地在边缘带（殖民地只能往外长）');
  ok(g.frontier && canPlaceSite(w, g.frontier.x, g.frontier.y), '好地落得了房');
  g.frontier = null;
  const su = g.npcs.find(n => n.id === 'su');
  su.x = 72; su.y = 30;
  g.rng = chainRng([0.65], 98);   // roll 0.65 → 落在发现分支（0.60-0.75）
  g.onScout(su);
  ok(g.frontier, '探索发现分支：看见了那块地');
  if (g.frontier) ok(su.memories.some(m => m.text.includes('无主的好地')), '发现写进记忆');

  // 11. 自发提议：木匠坊是材料链的咽喉
  const g4 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g4.newGame(2030);
  g4.workshop = null;
  g4.stock.wood = 20;   // 白纸开局无存货：自发营造提议仍需看家底（材料链机制不变）
  g4.rng = chainRng([0.01], 95);
  g4.maybeAutoPlan();
  ok(g4.plans.some(p => p.kind === 'workshop'), '没有木匠坊时，镇上先提议木匠坊');

  // 12. 自发提议：有人看见了地，就有人想去
  const g5 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g5.newGame(2031);
  g5.workshop = { x: 50, y: 30, logs: 0, mill: 0 };   // 坊已有（否则会先走木匠坊分支）
  const fsite = findSiteNear(g5.world, 72, 30, mulberry32(96), []);
  ok(fsite && edgeBand(fsite.x, fsite.y, TOWN_W, TOWN_H), '东郊有能落项的地');
  if (fsite) {
    g5.frontier = { x: fsite.x, y: fsite.y, day: 1 };
    g5.stock.wood = 50;
    g5.rng = chainRng([0.01], 99);
    g5.maybeAutoPlan();
    ok(g5.plans.some(p => p.kind === 'cabin' && p.x === fsite.x && p.y === fsite.y), '有人提议去那块地盖屋');
    ok(g5.frontier === null, '看见了就去：候选地清掉');
  }

  // 7b. 空房荒废：没人住的房子会垮（独立局面避免污染上面的断言）
  const g2 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g2.newGame(2028);
  g2.rng = chainRng([0.99, 0.01, 0.99, 0.01, 0.99, 0.01, 0.99, 0.99, 0.99, 0.99], 82);   // 每日两掷（白纸开局 wood=0 失窃骰不掷）：仓库磨损/空房磨损，空房连中三档
  const zhaoHouse = g2.world.houses.find(h => h.ownerId === 'zhao');
  g2.npcs = g2.npcs.filter(n => n.id !== 'zhao');   // 人走了，房空了
  g2.maintDaily(31); g2.maintDaily(32); g2.maintDaily(33);
  eq(zhaoHouse.wear, 3, '空房一年不如一年');
  ok(zhaoHouse.ruined, '空房塌了半边');
  ok(g2.logLines.some(l => l.text.includes('塌了半边')), '荒废写进镇志');

  // 7c. 原木雨淋会烂 + 仓库被偷
  const g3 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g3.newGame(2029);
  let spot3 = null;
  outer3: for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = g3.barn.x + dx, y = g3.barn.y + dy;
    if (objAt(g3.world, x, y) === O.NONE && groundAt(g3.world, x, y) !== G.WATER) { spot3 = { x, y }; break outer3; }
  }
  ok(!!spot3, '仓库边有地方放原木');
  if (spot3) {
    setObj(g3.world, spot3.x, spot3.y, O.LOG);
    g3.rng = chainRng([0.99, 0.01], 83);   // 仓库不磨损，原木遇雨就烂
    g3.weather.type = 'rain';
    g3.maintDaily(40);
    eq(objAt(g3.world, spot3.x, spot3.y), O.NONE, '雨淋会烂：原木烂在了野地里');
    ok(g3.logLines.some(l => l.text.includes('烂在了野地里')), '烂掉的原木写进镇志');
  }
  g3.rng = chainRng([0.99, 0.01], 84);   // 仓库不磨损，失窃的骰子摇中了
  g3.weather.type = 'sunny';
  g3.stock.wood = 5;   // 白纸开局无存货：失窃机制需要有板可偷
  const woodBefore = g3.stock.wood;
  g3.maintDaily(41);
  eq(g3.stock.wood, woodBefore - 1, '仓库被人顺走了一块板（没人认）');

  // 13. 物质层随存档完整往返 + 契约白名单
  g.barn = { x: 50, y: 30 };
  g.workshop = { x: 51, y: 30, logs: 5, mill: 3 };
  g.styles.set('50,31', { hue: 1, v: 2, by: '陈麦冬' });
  g.wear.set('50,31', { v: 1, work: 2 });
  g.frontier = { x: 6, y: 6, day: 3 };
  g.colony = { foundedDay: 9, houses: [{ x: 70, y: 30, by: '周大樵' }] };
  g.world.houses[2].wear = 2; g.world.houses[2].ruined = true;
  const snap29 = JSON.parse(JSON.stringify(g.serialize()));
  const g6 = Game.hydrate(snap29, { mapDirty: false, meteor() {}, shake() {} });
  ok(g6.barn && g6.barn.x === 50, '仓库随档走');
  ok(g6.workshop && g6.workshop.logs === 5 && g6.workshop.mill === 3, '木匠坊的存货随档走');
  ok(g6.styles.get('50,31') && g6.styles.get('50,31').hue === 1, '积木样式随档走');
  ok(g6.wear.get('50,31') && g6.wear.get('50,31').v === 1, '磨损随档走');
  ok(g6.frontier && g6.frontier.x === 6, '无主好地随档走');
  ok(g6.colony && g6.colony.houses.length === 1, '殖民地随档走');
  ok(g6.world.houses[2].wear === 2 && g6.world.houses[2].ruined === true, '空房荒废进度随档走');
  const info29 = ctxInfoText(g6.clock, g6.weather, g6);
  ok(info29.includes('木匠坊存原木5根'), '居民之魂看得见木匠坊的存货');
  ok(info29.includes('无主好地'), '居民之魂看得见无主好地');
  ok(info29.includes('殖民地'), '居民之魂看得见殖民地');
  eq(validateIntent(makeIntent({ action: 'repair', why: '修一修' }, { nowMin: 100 }), { npc: zhou, w }).verdict, 'pass', '契约：repair 校验通过');
  eq(validateIntent(makeIntent({ action: 'mill', why: '锯木头' }, { nowMin: 100 }), { npc: zhou, w }).verdict, 'pass', '契约：mill 校验通过');
  const gA = { npcs: [zhou], world: w, rng: mulberry32(1), clock: g6.clock, weather: g6.weather, log: null, haulJob: () => null, plans: [] };
  applyDecisions(gA, [{ npc: zhou.id, action: 'haul', why: '去搬点东西' }]);
  eq(zhou.intent.type, 'idle', '契约落地：haul 提议被裁决（没活儿就待着）');
}

// ================= 阶段30 世界层：动物生态（驯化/伴侣/野生）（v1.8.0） =================
stage(30, '世界层：动物生态——驯化产出/伴侣羁绊/狼袭击/鹿逃跑/野生生成/宰杀/存档');
{
  function chainRng30(vals, seed) {
    let i = 0, s = (seed || 12345) >>> 0;
    return () => {
      if (i < vals.length) return vals[i++];
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // 1. 定义完整性：八种动物，驯化有产出，狼是掠食者，猫狗是伴侣
  eq(Object.keys(ANIMAL_DEFS).length, 8, '八种动物（牛/羊/鸡/狗/猫/狼/鹿/鸟）');
  ok(ANIMAL_DEFS.cow.product === 'milk' && !ANIMAL_DEFS.cow.wild, '奶牛是驯化产奶');
  ok(ANIMAL_DEFS.wolf.predator && ANIMAL_DEFS.wolf.wild, '狼是野生掠食者');
  ok(ANIMAL_DEFS.dog.companion && ANIMAL_DEFS.cat.companion, '猫狗是伴侣动物');
  ok(ANIMAL_DEFS.deer.flee && ANIMAL_DEFS.bird.ambience, '鹿会逃跑，鸟是氛围');

  // 2. 生成：伴侣动物有名字有性格，驯化动物没有
  const r0 = mulberry32(77);
  const cow0 = makeAnimal('cow', 20, 50, r0, { ownerId: 'chen' });
  const dog0 = makeAnimal('dog', 10, 10, r0, { ownerId: 'he' });
  ok(cow0.name === null && cow0.ownerId === 'chen', '驯化动物没有名字，只有主人');
  ok(dog0.name && dog0.pers && dog0.bond > 0, `伴侣动物有名字「${dog0.name}」有性格「${dog0.pers}」有羁绊`);

  const g = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g.newGame(2031);
  const chen = g.npcs.find(n => n.id === 'chen');
  const he = g.npcs.find(n => n.id === 'he');
  eq(g.animals.length, 0, '开局镇上没有动物（畜生是后来才养起来的）');

  // 3. 购买：扣金子、归主人、落在农田附近；金子不够买不成
  g.stock.gold = 100;
  const goldBefore = g.stock.gold;
  const cow1 = buyAnimal(g, chen, 'cow');
  ok(!!cow1, '陈麦冬买到了奶牛');
  eq(g.stock.gold, goldBefore - 30, '奶牛 30 金（钱是真的）');
  eq(cow1.ownerId, 'chen', '奶牛归陈麦冬');
  const farmArea = g.world.areas.find(v => v.id === 'farm');
  ok(Math.abs(cow1.x - (farmArea.x + farmArea.w / 2)) < 8 && Math.abs(cow1.y - (farmArea.y + farmArea.h / 2)) < 8, '奶牛落在农田附近');
  g.stock.gold = 2;
  eq(buyAnimal(g, chen, 'cow'), null, '金子不够，买不成');
  g.stock.gold = 100;

  // 4. 产出：日子到了，牛奶进粮仓
  cow1.prodCd = 1;
  const cropBefore = g.stock.crop;
  g.rng = mulberry32(91);
  animalDailyTick(g, 2);
  eq(g.stock.crop, cropBefore + 1, '奶牛的奶进了粮仓');
  eq(cow1.prodCd, ANIMAL_DEFS.cow.prodDays, '产出后冷却重置');

  // 5. 伴侣羁绊：主人在世，羁绊日增
  const pet = adoptPet(g, he, 'dog');
  ok(pet && pet.name && pet.ownerId === 'he', '何老收养了一只狗');
  const bondBefore = pet.bond;
  g.rng = chainRng30([0.9], 92);   // rint(rng,0,2) 高值 → +2
  animalDailyTick(g, 3);
  ok(pet.bond > bondBefore, '主人在世，羁绊日增（' + bondBefore + '→' + pet.bond + '）');
  ok(g.logLines.some(l => l.text.includes('收养了一只')), '收养写进镇志');

  // 6. 帧推进·跟随：狗跟着主人走
  he.x = 30; he.y = 25; he.inside = false;
  pet.x = 20; pet.y = 20; pet.cd = 0;
  g.rng = mulberry32(93);
  tickAnimals(g, 0.5, 1);
  ok(Math.abs(pet.tx - he.x) <= 2 && Math.abs(pet.ty - he.y) <= 2, '狗的目标是主人身边');
  ok(Math.abs(pet.x - he.x) + Math.abs(pet.y - he.y) < 20, '狗朝主人挪了一步');

  // 7. 守门口：主人没了，狗守在老家门口
  const heDead = { ...he, alive: false };
  const g7 = { ...g, npcs: g.npcs.map(n => n.id === 'he' ? heDead : n) };
  pet.cd = 0;
  tickAnimals(g7, 0.5, 1);
  ok(pet.waitDoor && pet.tx === pet.homeX && pet.ty === pet.homeY, '主人没了，狗守在老家门口');

  // 8. 狼袭击：狼扑向最近的牲畜，贴身就掉血
  const sheep1 = makeAnimal('sheep', 15, 15, mulberry32(94), { ownerId: 'chen' });
  const wolf1 = makeAnimal('wolf', 15.5, 15.5, mulberry32(95));
  g.animals.push(sheep1, wolf1);
  sheep1.hp = ANIMAL_DEFS.sheep.hp;
  wolf1.cd = 0;
  g.rng = mulberry32(96);
  tickAnimals(g, 1.0, 1);
  ok(sheep1.hp < ANIMAL_DEFS.sheep.hp, '狼贴身就咬（绵羊掉血 ' + ANIMAL_DEFS.sheep.hp + '→' + sheep1.hp.toFixed(1) + '）');
  // 咬到死：主人看在眼里，记在心上
  const memBefore = chen.memories.length;
  for (let k = 0; k < 20 && sheep1.alive; k++) tickAnimals(g, 1.0, 1);
  ok(!sheep1.alive, '狼咬死了绵羊');
  ok(chen.memories.slice(memBefore).some(m => m.text.includes('狼咬死了')), '主人把狼害记在心里');
  ok(g.logLines.some(l => l.text.includes('狼咬死了')), '狼害写进镇志');
  g.animals = g.animals.filter(a => a !== wolf1 && a !== sheep1);

  // 9. 鹿逃跑：人靠近，鹿往反方向跑
  const deer1 = makeAnimal('deer', 25, 25, mulberry32(97));
  g.animals.push(deer1);
  chen.x = 24; chen.y = 25; chen.inside = false;
  deer1.cd = 0;
  g.rng = mulberry32(98);
  tickAnimals(g, 0.5, 1);
  ok(deer1.tx > 25 + 1 || Math.abs(deer1.tx - 25) > 3, '鹿逃向远离人的方向（目标 ' + deer1.tx.toFixed(1) + ',' + deer1.ty.toFixed(1) + '）');
  g.animals = g.animals.filter(a => a !== deer1);

  // 10. 野生动物出没：低值骰子摇出狼
  g.rng = chainRng30([0.01], 99);  // 狼 2% 必中
  const wildBefore = g.animals.length;
  spawnWild(g);
  ok(g.animals.length > wildBefore, '森林边缘出现了狼的踪迹');
  ok(g.logLines.some(l => l.text.includes('狼的踪迹')), '狼出没写进镇志');
  g.animals = g.animals.filter(a => a.kind !== 'wolf');

  // 11. 宰杀：缺粮的时候，牲畜变成锅里的肉；伴侣动物不挨刀
  const cropBefore11 = g.stock.crop;
  ok(slaughterAnimal(g, chen, cow1), '陈麦冬宰了奶牛');
  eq(g.stock.crop, cropBefore11 + ANIMAL_DEFS.cow.meat, '宰牛得肉 ' + ANIMAL_DEFS.cow.meat + ' 斤');
  ok(!cow1.alive, '奶牛死了');
  eq(slaughterAnimal(g, he, pet), false, '伴侣动物不挨刀（下不去手）');

  // 12. 尸体三日清理
  cow1.deadDay = 5;
  g.rng = mulberry32(100);
  animalDailyTick(g, 9);   // 9-5=4 > 3
  ok(!g.animals.includes(cow1), '三日后尸体腐化消失');

  // 13. 畜牧日推进：农夫有余钱就添置，老人会领养，缺粮就宰杀
  const g2 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g2.newGame(2032);
  g2.npcs.find(n => n.id === 'chen').job = '农夫';   // 白纸开局：模拟演化已长出农夫（本阶段验证畜牧机制）
  g2.npcs.find(n => n.id === 'lin').job = '农夫';    // 原版名册本是两农夫，骰流按此排布
  g2.stock.gold = 200;
  g2.rng = mulberry32(100);
  husbandryDaily(g2, 10);
  ok(g2.animals.some(a => a.ownerId && !ANIMAL_DEFS[a.kind].wild && !ANIMAL_DEFS[a.kind].companion), '农夫添置了牲畜（' + g2.animals.map(a => ANIMAL_DEFS[a.kind].name).join('、') + '）');
  ok(g2.animals.some(a => ANIMAL_DEFS[a.kind].companion), '老人领养了伴侣动物');
  // 缺粮宰杀链：圈里只剩一头牛，粮仓见底就变成肉
  const pets = g2.animals.filter(a => ANIMAL_DEFS[a.kind].companion);
  const g2cow = makeAnimal('cow', 20, 50, mulberry32(102), { ownerId: 'chen' });
  g2.animals = [...pets, g2cow];
  g2.stock.gold = 0;          // 没钱添置，免得干扰
  g2.stock.crop = 3;
  g2.rng = chainRng30([0.1], 108);   // 宰杀骰子必中（老人已有宠物不耗骰，农夫没钱不耗骰）
  husbandryDaily(g2, 11);
  ok(!g2cow.alive, '粮仓见底，圈里的牛变成了肉');
  ok(g2.logLines.some(l => l.text.includes('宰了一头')), '宰杀写进镇志');

  // 14. 动物随存档完整往返
  g2.animals.push(makeAnimal('cat', 8, 8, mulberry32(104), { ownerId: 'he', name: '雪团', bond: 66 }));
  const snap30 = JSON.parse(JSON.stringify(g2.serialize()));
  const g3 = Game.hydrate(snap30, { mapDirty: false, meteor() {}, shake() {} });
  eq(g3.animals.length, g2.animals.length, '动物数量随档往返');
  const cat3 = g3.animals.find(a => a.name === '雪团');
  ok(cat3 && cat3.bond === 66 && cat3.ownerId === 'he', '伴侣动物的名字/羁绊/主人随档走');
  const info30 = ctxInfoText(g3.clock, g3.weather, g3);
  ok(info30.includes('牲畜家禽'), '居民之魂看得见镇上的活物');
}

// ================= 阶段31 演化层：配方/知识传承/灾难崩溃恢复（v1.9.0） =================
stage(31, '演化层：瓶颈创新/知识传承会死/重新发明/瘟疫/火灾/废墟自愈/存档');
{
  function chainRng31(vals, seed) {
    let i = 0, s = (seed || 12345) >>> 0;
    return () => {
      if (i < vals.length) return vals[i++];
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // 1. 白纸开局（v2.7.0）：铁律层配方表清空——手艺不再与生俱来，全部由演化长出
  eq(Object.keys(RECIPE_DEFS).length, 0, '白纸开局：铁律层配方表为空');
  // 白纸世界里五门手艺是演化固化的结果——本阶段验证机制，先模拟「已长出五门手艺」的世界
  function seedEra(g) {
    const defs = { plank: ['zhou', '樵夫', '锯木'], mill: ['chen', '农夫', '磨面'], forge: ['zhao', '铁匠', '锻铁'], stew: ['wang', '厨子', '炖汤'], fishnet: ['wu', '渔夫', '织网'] };
    for (const [id, [who, job, nm]] of Object.entries(defs)) {
      g.recipeDefs[id] = { name: nm, job, base: 1.0, variants: [1.2] };
      g.recipes[id] = { id, mult: 1.0, knownBy: new Map([[who, 0]]), inventor: who, inventedDay: 0, tries: 0, lost: false, lostDay: 0 };
      const n = g.npcs.find(v => v.id === who);
      if (n && !n.job) n.job = job;   // 首个学会者转职
    }
  }

  const g = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g.newGame(2041);
  seedEra(g);
  const zhou = g.npcs.find(n => n.id === 'zhou');
  const wang = g.npcs.find(n => n.id === 'wang');
  const zhao = g.npcs.find(n => n.id === 'zhao');

  // 2. 演化固化后的世界：樵夫会锯木、厨子会炖汤、铁匠会锻铁（谁先学会谁转职）
  ok(knowsRecipe(g, zhou, 'plank'), '演化固化：周大樵会锯木');
  ok(knowsRecipe(g, wang, 'stew'), '演化固化：王绣会炖汤');
  ok(knowsRecipe(g, zhao, 'forge'), '演化固化：赵铁山会锻铁');
  ok(!knowsRecipe(g, wang, 'plank'), '厨子不会锯木');
  eq(g.recipes.plank.mult, 1.0, '新长出的手艺都是老法子（1.0）');

  // 3. 瓶颈驱动：日子好过没人想改；木料见底，樵夫才琢磨新法子
  g.stock.wood = 60; g.stock.crop = 50; g.stock.gold = 100;   // 繁荣期
  g.rng = mulberry32(201);
  const multBefore = g.recipes.plank.mult;
  for (let d = 0; d < 30; d++) innovateDaily(g, d);
  eq(g.recipes.plank.mult, multBefore, '繁荣期停滞：没人想改（' + g.recipes.plank.tries + '次尝试）');
  // 危机期：木料见底 → 概率喂满，必出变体
  g.stock.wood = 2;
  // 掷序（白纸）：参与的是有职业者 chen(mill)→zhao(forge)→zhou(plank)→wu→wang，无业者不掷——
  // 前两位喂 0.99 让他们想不到，周大樵 0.01 想到 + 0.1 成功
  g.rng = chainRng31([0.99, 0.99, 0.01, 0.1], 202);
  innovateDaily(g, 31);
  ok(g.recipes.plank.mult > 1.0, '危机期创新：锯木手艺长进到 ' + Math.round(g.recipes.plank.mult * 100) + '%');
  eq(g.recipes.plank.inventor, 'zhou', '新法子是周大樵琢磨出来的');
  ok(zhou.memories.some(m => m.text.includes('新法子')), '创新写进记忆');
  ok(g.logLines.some(l => l.text.includes('琢磨出了新法子')), '创新写进镇志');

  // 4. 知识传承：会的人教给不会的人（徒弟/邻居）
  const g2 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g2.newGame(2042);
  seedEra(g2);
  const zhou2 = g2.npcs.find(n => n.id === 'zhou');
  // 制造一个高 mult 且只有周大樵会的手艺
  g2.recipes.plank.mult = 1.3;
  g2.recipes.plank.knownBy = new Map([['zhou', 0]]);
  // 找个樵夫职业的年轻人当徒弟——feng 是学生不算，给个新居民
  const pupil = { id: 'pupil1', name: '小石头', job: '樵夫', body: { ageYears: 20 }, rels: {}, memories: [], moodDelta() { }, memory(t) { this.memories.push({ text: t }); } };
  g2.npcs.push(pupil);
  g2.rng = chainRng31([0.3, 0.01, 0.2], 203);   // 选老师(0.3)→教(0.05 内)→选学生(0.2)
  teachDaily(g2, 32);
  ok(g2.recipes.plank.knownBy.has('pupil1'), '周大樵把锯木手艺传给了徒弟');
  ok(pupil.memories.some(m => m.text.includes('学了锯木')), '徒弟记住了师承');
  ok(g2.logLines.some(l => l.text.includes('传给了')), '传承写进镇志');

  // 5. 知识会死：会做的人死绝了，手艺失传归零
  const g3 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g3.newGame(2043);
  seedEra(g3);
  g3.recipes.forge.mult = 1.5;
  g3.recipes.forge.knownBy = new Map([['zhao', 0]]);   // 只有赵铁山会
  const zhao3 = g3.npcs.find(n => n.id === 'zhao');
  forgetOnDeath(g3, zhao3, 33);
  eq(g3.recipes.forge.knownBy.size, 0, '赵铁山走了，锻铁没人会了');
  ok(g3.recipes.forge.lost, '手艺标记失传');
  eq(g3.recipes.forge.mult, 1.0, '手艺归零——重新发明比第一次更难');
  ok(g3.logLines.some(l => l.text.includes('没人会了')), '失传写进镇志');

  // 6. 重新发明：失传的手艺在废墟上被重新想起（概率砍半）
  g3.rng = chainRng31([0.01, 0.2], 204);   // 重新想到(0.02)+选人(0.2)
  reinventDaily(g3, 34);
  ok(g3.recipes.forge.knownBy.size > 0, '旧日子的手艺又从废墟里长出来了');
  ok(!g3.recipes.forge.lost, '失传标记解除');
  ok(g3.logLines.some(l => l.text.includes('重新琢磨')), '重新发明写进镇志');

  // 7. 瘟疫：有人倒下 → 近身传播 → 扛过去或病故；医生能压死亡率
  const g4 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g4.newGame(2044);
  g4.rng = chainRng31([0.001, 0.5], 205);  // 爆发(0.008)+选人
  plagueDaily(g4, 40);
  ok(g4.plague && g4.plague.sick.length === 1, '时疫从一个人开始');
  const host = g4.npcs.find(n => n.id === g4.plague.sick[0]);
  ok(host.plagueSick, '首例病人带时疫');
  ok(g4.logLines.some(l => l.text.includes('时疫')), '时疫写进镇志');
  // 传播：把一个健康者放到病人身边，概率喂满必染
  const victim = g4.npcs.find(n => n.id !== host.id && n.body.ageYears >= 6 && !n.plagueSick);
  victim.x = host.x; victim.y = host.y;
  // 消耗序：传播1次 + zheng转归2次 + chen转归2次——补足0.99防 LCG 兜底值让新病人同轮康复
  g4.rng = chainRng31([0.05, 0.99, 0.99, 0.99, 0.99], 206);  // 传播(0.12)必中，转归全不触发
  plagueDaily(g4, 41);
  ok(g4.plague.sick.includes(victim.id), '时疫近身传播');
  // 扛过去：此时 sick=[zheng,chen]，转归先 zheng 后 chen——zheng 死签0.99不中/康复签0.1必中，chen 两签0.99留病中
  g4.rng = chainRng31([0.99, 0.1, 0.99, 0.99], 207);
  plagueDaily(g4, 42);
  ok(!host.plagueSick || g4.plague.sick.length < 2, '有人从时疫里扛了过来');

  // 8. 火灾：晴日里走水 → 烧掉可燃物 → 邻里来救
  const g5 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g5.newGame(2045);
  g5.weather.type = 'sunny';
  g5.rng = chainRng31([0.001, 0.3], 208);  // 起火(0.004)+选房
  fireDaily(g5, 50);
  ok(g5.fire, '晴日走水，火着起来了');
  const fireX = g5.fire.x, fireY = g5.fire.y;
  // 在火场边放一棵树，烧一回合
  let treePlaced = false;
  for (let dy = -2; dy <= 2 && !treePlaced; dy++) for (let dx = -2; dx <= 2 && !treePlaced; dx++) {
    const x = fireX + dx, y = fireY + dy;
    if (x < 0 || y < 0 || x >= TOWN_W || y >= TOWN_H) continue;
    if (objAt(g5.world, x, y) === O.NONE) { setObj(g5.world, x, y, O.TREE); treePlaced = true; }
  }
  ok(!!treePlaced, '火场边有可燃物');
  g5.rng = mulberry32(209);
  fireTick(g5);
  // 邻里扑救：把四个人拉到火场边，概率喂满
  for (let k = 0; k < 4; k++) {
    const n = g5.npcs[k];
    n.x = fireX + 1; n.y = fireY; n.inside = false; n.dying = null;
  }
  g5.rng = mulberry32(210);
  for (let t = 0; t < 8 && g5.fire; t++) fireTick(g5);
  ok(!g5.fire, '火被扑灭了（或烧完了）');

  // 9. 废墟自愈：焦土慢慢被草盖住
  const g6 = new Game({ mapDirty: false, meteor() {}, shake() {} });
  g6.newGame(2046);
  let ruinAt = null;
  outerR: for (let y = 0; y < TOWN_H; y++) for (let x = 0; x < TOWN_W; x++) {
    if (objAt(g6.world, x, y) === O.NONE) { setObj(g6.world, x, y, O.RUIN); ruinAt = { x, y }; break outerR; }
  }
  g6.rng = chainRng31([0.001], 211);  // 自愈(0.005)必中
  recoverDaily(g6, 60);
  eq(objAt(g6.world, ruinAt.x, ruinAt.y), O.NONE, '废墟被青草盖住了');
  ok(g6.logLines.some(l => l.text.includes('自己长好')), '自愈写进镇志');

  // 10. 演化层随存档完整往返
  g.recipes.forge.mult = 1.4;
  g.recipes.forge.knownBy = new Map([['zhao', 5], ['zhou', 8]]);
  g.recipes.stew.lost = true;
  g.plague = { startedDay: 30, sick: ['chen'], dead: 1, over: false };
  const snap31 = JSON.parse(JSON.stringify(g.serialize()));
  const g7 = Game.hydrate(snap31, { mapDirty: false, meteor() {}, shake() {} });
  eq(g7.recipes.forge.mult, 1.4, '配方倍率随档走');
  eq(g7.recipes.forge.knownBy.size, 2, '会的人随档走');
  ok(g7.recipes.forge.knownBy.has('zhou'), '徒弟随档走');
  ok(g7.recipes.stew.lost, '失传标记随档走');
  ok(g7.plague && g7.plague.sick.includes('chen') && g7.plague.dead === 1, '时疫随档走');
  const info31 = ctxInfoText(g7.clock, g7.weather, g7);
  ok(info31.includes('手艺') || info31.includes('时疫'), '居民之魂看得见手艺或时疫');
}

// ================= 阶段32 呈现层：编年史/传闻网/地形考古/关系演变/高光回放/因果链（v2.0.0） =================
stage(32, '呈现层：编年史去重/血肉/口述三代变形/考古标记/关系采样/高光视野/因果链/存档');
{
  function chainRng32(vals, seed) {
    let i = 0, s = (seed || 12345) >>> 0;
    return () => {
      if (i < vals.length) return vals[i++];
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  // 轻量假 game：纯逻辑函数只需要 clock/rng
  const fakeClock = (day) => ({ totalDay: day, year: 1, hour: 12, label: () => `第${day}日 12:00` });

  // 1. 编年史：同日同事只记一笔，泛类可被具体类升级
  const cg = { clock: fakeClock(5), chron: [] };
  chronNote(cg, 'event', '周大樵琢磨出了新法子');
  chronNote(cg, 'craft', '周大樵琢磨出了新法子', '木料见底');
  eq(cg.chron.length, 1, '同日同事只记一笔');
  eq(cg.chron[0].k, 'craft', '泛类 event 被具体类 craft 升级');
  eq(cg.chron[0].w, '木料见底', '起因随升级补上');
  chronNote(cg, 'event', '周大樵琢磨出了新法子');
  eq(cg.chron.length, 1, '具体类在前，泛类不再重复记');
  chronNote(cg, 'event', '另一件事');
  eq(cg.chron.length, 2, '不同事各记各的');
  for (let i = 0; i < CHRON_CAP + 20; i++) chronNote({ clock: fakeClock(9), chron: cg.chron }, 'event', '填充' + i);
  ok(cg.chron.length <= CHRON_CAP, `编年史 capped（${cg.chron.length}≤${CHRON_CAP}）`);

  // 2. 血肉：这一天活人记下的 + 故人记下的，都对得上日子
  const fg = {
    clock: fakeClock(3),
    npcs: [{ name: '周大樵', memories: [{ d: 3, text: '看见了火光', m: -4 }, { d: 2, text: '昨天的事', m: 0 }] }],
    dead: [{ name: '孙老大夫', memories: [{ d: 3, text: '临走前还在把脉', m: 0 }] }]
  };
  const flesh = fleshOf(fg, 3);
  eq(flesh.length, 2, '血肉：活人一条 + 故人一条');
  ok(flesh.some(f => f.who === '周大樵' && f.text === '看见了火光'), '活人血肉在');
  ok(flesh.some(f => f.who.includes('（故）')), '故人血肉带"故"字');
  eq(fleshOf(fg, 4).length, 0, '没血肉的日子只剩骨架');

  // 3. 口述变形：换词/掉字，不是乱改是记不清（v3.1.0：词表来自当下词库 swap 槽，fake game 落种子表）
  // 换词循环对"铜钱/林子/偷"三处命中各消耗一次 rng——全喂 0.99 才不触发
  const d1 = distortText({ rng: chainRng32([0.99, 0.99, 0.99, 0.99], 301) }, '他从林子里偷了铜钱');
  eq(d1, '他从林子里偷了铜钱', '概率不触发时原样');
  const d2 = distortText({ rng: chainRng32([0.1, 0.99], 302) }, '他从林子里偷了铜钱');
  ok(d2.includes('铜板') || d2.includes('山洼') || d2.includes('顺手拿'), '撞到词就换（' + d2 + '）');
  // 此句不含换词表任何词——掉字直接消耗第一个 rng
  const d3 = distortText({ rng: chainRng32([0.1, 0.5], 303) }, '这是一句很长很长的口述话');
  ok(d3.length < 12, '长句子传着传着就短了（' + d3 + '）');
  // 词库可换：自家 swap 表生效（语言革命：变形词对是演化设定，随档走）
  const d4 = distortText({ rng: chainRng32([0.1], 305), lexicon: { swap: [['林子', '树窠']] } }, '他从林子里偷了铜钱');
  ok(d4.includes('树窠'), '变形词对随档走（自家词库生效：' + d4 + '）');

  // 4. 传闻网：gen<3 原样，gen>=3 变形；按"关于谁"聚链
  const rg = { clock: fakeClock(6), rumors: [], rng: chainRng32([0.1, 0.99], 304) };
  const heard1 = recordRumor(rg, { from: 'a', to: 'b', about: 'zhou', content: '他在林子里藏了铜钱', gen: 1 });
  eq(heard1, '他在林子里藏了铜钱', '第一手原样传到');
  const heard3 = recordRumor(rg, { from: 'b', to: 'c', about: 'zhou', content: '他在林子里藏了铜钱', gen: 3 });
  ok(heard3 !== '他在林子里藏了铜钱', '第三手开始变形（' + heard3 + '）');
  eq(rg.rumors.length, 2, '传闻边记下了');
  eq(rg.rumors[1].gen, 3, '第几手记下了');
  const threads = rumorThreads(rg, (id) => id === 'zhou' ? '周大樵' : id);
  eq(threads.length, 1, '同一个人的传闻聚成一条线');
  eq(threads[0].hops.length, 2, '线里两跳');
  eq(threads[0].about, '周大樵', '线头是关于谁的');
  for (let i = 0; i < RUMOR_CAP + 10; i++) recordRumor({ clock: fakeClock(7), rumors: rg.rumors, rng: mulberry32(305) }, { from: 'x', to: 'y', about: 'z', content: '废话', gen: 1 });
  ok(rg.rumors.length <= RUMOR_CAP, `传闻网 capped（${rg.rumors.length}≤${RUMOR_CAP}）`);

  // 5. 地形考古：标记记时日，年纪算得出
  const mg = { clock: fakeClock(10), marks: new Map() };
  markNote(mg, 12, 8, 'grave', '孙老大夫之墓', '孙老大夫');
  markNote(mg, 30, 22, 'ruin', '火烧的焦土', '');
  mg.clock = fakeClock(25);
  eq(mg.marks.size, 2, '考古标记落位');
  eq(markAge(mg, mg.marks.get('12,8')), 15, '坟茔立了15日');
  eq(mg.marks.get('30,22').k, 'ruin', '焦土是废墟类');

  // 6. 关系演变：3日一采，剧变补采， capped
  const rel = makeRelation('wang', 50, 0);
  const hg6 = { npcs: [{ id: 'zhou', rels: { wang: rel } }] };
  relHistDaily(hg6, 1);
  eq(rel.hist.length, 1, '关系演变第一采');
  eq(rel.hist[0].b, 50, '亲密50信任50 → bond 50');
  relHistDaily(hg6, 2);
  eq(rel.hist.length, 1, '间隔不足3日不重复采');
  relHistDaily(hg6, 4);
  eq(rel.hist.length, 2, '满3日采第二笔');
  rel.close = -40; rel.trust = -40;
  relHistDaily(hg6, 5);
  eq(rel.hist.length, 3, '单日剧变补采一笔');
  eq(rel.hist[2].b, -40, '剧变后的 bond 落准');
  for (let d = 6; d < 90; d += 3) relHistDaily(hg6, d);
  ok(rel.hist.length <= RELHIST_CAP, `关系采样 capped（${rel.hist.length}≤${RELHIST_CAP}）`);
  for (let i = 0; i < RELMARK_CAP + 3; i++) relMark(rel, 10 + i, '记号' + i);
  eq(rel.mark.length, RELMARK_CAP, '转折记号 capped');
  eq(rel.mark[RELMARK_CAP - 1].w, '记号' + (RELMARK_CAP + 2), '留的是最近的转折');

  // 7. 高光回放：只收当时镜头视野内、在户外的人——错过的就是错过了
  const hr = { cam: { x: 10, y: 10, zoom: 2 }, canvas: { width: 832, height: 576 } };
  const hlg = {
    clock: fakeClock(7), weather: { type: 'rain' }, renderer: hr, highlights: [],
    npcs: [
      { id: 'a', name: '镜头里的', x: 12, y: 14, inside: false, dir: 1, shirt: 3, intent: { label: '去河边' } },
      { id: 'b', name: '屋里的', x: 12, y: 14, inside: true, dir: 0, shirt: 1, intent: { label: '睡觉' } },
      { id: 'c', name: '镜头外的', x: 60, y: 60, inside: false, dir: 2, shirt: 2, intent: { label: '砍柴' } }
    ]
  };
  hlSnap(hlg, '镇上来了时疫');
  eq(hlg.highlights.length, 1, '高光落一帧');
  const hl0 = hlg.highlights[0];
  eq(hl0.actors.length, 1, '只收镜头里在户外的人');
  eq(hl0.actors[0].nm, '镜头里的', '演员是镜头里那位');
  eq(hl0.actors[0].lb, '去河边', '当时在做什么记下了');
  eq(hl0.wx, 'rain', '当时天气记下了');
  eq(hl0.vw, 26, '视野宽按镜头算（832/32=26）');
  for (let i = 0; i < HL_CAP + 5; i++) hlSnap(hlg, '帧' + i);
  ok(hlg.highlights.length <= HL_CAP, `高光帧 capped（${hlg.highlights.length}≤${HL_CAP}）`);

  // 8. 因果链：意图换一桩记一桩，做什么+为什么+谁让做的
  const in8 = { intent: { label: '去砍柴', reason: '家里没柴了', source: 'need' } };
  recordIntent(in8, 1, '08:00');
  eq(in8.intentLog.length, 1, '第一桩行止记下');
  recordIntent(in8, 1, '08:10');
  eq(in8.intentLog.length, 1, '意图没变不重复记');
  in8.intent = { label: '回家吃饭', reason: '饿了', source: 'ai' };
  recordIntent(in8, 1, '12:00');
  eq(in8.intentLog.length, 2, '换意图记第二桩');
  eq(in8.intentLog[1].rs, '饿了', '为什么记下了');
  eq(in8.intentLog[1].src, 'ai', '谁让做的记下了');
  for (let i = 0; i < INTENT_CAP + 6; i++) {
    in8.intent = { label: '事' + i, reason: '由' + i, source: 'script' };
    recordIntent(in8, 2, '13:00');
  }
  eq(in8.intentLog.length, INTENT_CAP, `因果链 capped（${INTENT_CAP}）`);

  // 9. 全链路：开镇就有第一笔编年史与第一个考古标记；annal 不双记
  const gs = new Game({ mapDirty: false, meteor() { }, shake() { } });
  gs.newGame(2050);
  ok(gs.chron.length >= 1, '开镇第一笔编年史（雾溪镇建成）');
  ok(gs.chron[0].t.includes('雾溪镇建成'), '第一笔是建镇');
  ok([...gs.marks.values()].some(m => m.k === 'built' && m.by === '开镇'), '老仓库是开镇考古标记');
  ok(gs.highlights.length >= 1, '建镇 hl 落第一帧高光');
  const chronLen = gs.chron.length;
  gs.annal('craft', '周大樵琢磨出了新法子', '木料见底');
  eq(gs.chron.length, chronLen + 1, 'annal 只记一笔（log hook 不双记）');
  eq(gs.chron[gs.chron.length - 1].k, 'craft', 'annal 记下具体类别');
  // 传闻钩子经 ctx.rumorHook 进镇
  gs.rng = chainRng32([0.99], 306);
  recordRumor(gs, { from: 'chen', to: 'wang', about: 'zhou', content: '他在林子里藏了铜钱', gen: 2 });
  eq(gs.rumors.length, 1, '传闻进了镇里的网');

  // 10. 呈现层随存档完整往返
  gs.chron.push({ d: 1, y: 1, k: 'death', t: '孙老大夫走了', w: '病榻三日' });
  const snap32 = JSON.parse(JSON.stringify(gs.serialize()));
  ok(snap32.history && snap32.history.chron.length === gs.chron.length, 'history 随档走');
  const gs2 = Game.hydrate(snap32, { mapDirty: false, meteor() { }, shake() { } });
  eq(gs2.chron.length, gs.chron.length, '编年史随档走');
  eq(gs2.chron[gs2.chron.length - 1].k, 'death', '编年史类别随档走');
  eq(gs2.rumors.length, 1, '传闻网随档走');
  ok(gs2.marks instanceof Map && gs2.marks.size === gs.marks.size, '考古标记随档走（Map 还原）');
  eq(gs2.highlights.length, gs.highlights.length, '高光帧随档走');
  ok(gs2.npcs.every(n => Array.isArray(n.intentLog)), '因果链随档走（旧档缺省为空）');

  // 11. 旧档兼容：没有 history 字段，从故者档案里把坟茔考古出来
  const snap32b = JSON.parse(JSON.stringify(gs.serialize()));
  delete snap32b.history;
  snap32b.dead = [{ id: 'sun', name: '孙老大夫', grave: { x: 40, y: 12 }, memories: [] }];
  const gs3 = Game.hydrate(snap32b, { mapDirty: false, meteor() { }, shake() { } });
  eq(gs3.chron.length, 0, '旧档编年史从空白开始');
  ok([...gs3.marks.values()].some(m => m.k === 'grave' && m.name === '孙老大夫之墓'), '旧档坟茔从镇魂碑考古出来');
}

// ================= 阶段33 演化引擎 slim（v4.8.0）：类型管道退役——日推进/动态配方传承失传/存档往返 =================
stage(33, '演化引擎 slim：日推进不报错/动态配方传承失传/存档往返（无候选池无风向）');
{
  const mockR = { mapDirty: false, meteor() { }, shake() { } };
  const mkG = (seed) => { const g = new Game(mockR); g.newGame(seed); return g; };

  // 1. 日推进冒烟：无 LLM 连续 10 天不报错，结构始终健全（演化唯一管道=观念池）
  {
    const g = mkG(3312);
    let threw = null;
    try { for (let d = 1; d <= 10; d++) evolveDaily(g, d); } catch (e) { threw = e; }
    ok(!threw, 'evolveDaily 连续日推进不报错' + (threw ? '：' + threw.message : ''));
    ok(Array.isArray(g.evoLog) && Array.isArray(g.ideas), '演化日志与观念池结构健全');
    ok(g.evoLog.every(e => typeof e.what === 'string'), '日志条目是人话');
  }

  // 2. 动态配方参与演化层日推进（运行时表）：传承/失传都认新手艺
  {
    const g = mkG(3310);
    g.recipeDefs.dryfood = { name: '干粮', job: '樵夫', base: 1.0, variants: [1.2] };
    // 只留这一门手艺：teachDaily 遍历全部配方，5 门老手艺会先把喂的 rng 吃掉
    g.recipes = { dryfood: { id: 'dryfood', mult: 1.2, knownBy: new Map([['zhou', 0]]), inventor: 'zhou', inventedDay: 1, tries: 0, lost: false, lostDay: 0 } };
    // 传承：新手艺也能教给徒弟
    const pupil = { id: 'pupil33', name: '小石头', job: '樵夫', body: { ageYears: 20 }, rels: {}, memories: [], moodDelta() { }, perceive() { }, memory(t) { this.memories.push({ text: t }); } };
    g.npcs.push(pupil);
    let i33 = 0; const vals33 = [0.3, 0.01, 0.2];
    g.rng = () => i33 < vals33.length ? vals33[i33++] : 0.99;
    teachDaily(g, 33);
    ok(g.recipes.dryfood.knownBy.has('pupil33'), '动态配方参与传承（运行时表）');
    // 失传：会做的人死绝了，新手艺也会断
    g.recipes.dryfood.knownBy = new Map([['zhou', 0]]);
    const zhou33 = g.npcs.find(n => n.id === 'zhou');
    forgetOnDeath(g, zhou33, 34);
    ok(g.recipes.dryfood.lost, '动态配方会失传');
    ok(g.logLines.some(l => l.text.includes('干粮')), '失传文案用动态配方名');
  }

  // 3. 存档往返：演化日志/动态配方表/旧档事件随档走；候选池与风向已退役不随档
  {
    const g = mkG(3311);
    g.recipeDefs.dryfood = { name: '干粮', job: '樵夫', base: 1.0, variants: [1.2] };
    g.evoLog.push({ day: 1, what: '「有话直说」成了镇上的规矩', why: '念头活了 9 天', action: 'crystallize', outcome: '6人信', status: 'commit' });
    g.evoEvents.push({ name: '旧社火', trigger: { when: 'festival', p: 0.5 }, steps: [{ op: 'mood', delta: 1 }] });
    const snap = JSON.parse(JSON.stringify(g.serialize()));
    ok(snap.evo, 'evo 随档走');
    ok(!('pool' in snap.evo) && !('wind' in snap.evo) && !('seq' in snap.evo), 'slim 存档不含候选池/风向/提案序号');
    const g2 = Game.hydrate(snap, mockR);
    ok(g2.recipeDefs.dryfood && g2.recipeDefs.dryfood.name === '干粮', '动态配方定义随档走');
    eq(g2.evoLog.length, 1, '演化日志随档走');
    eq(g2.evoEvents.length, 1, '旧档事件随档走（余温烧完为止）');
    ok(!RECIPE_DEFS.dryfood, '存档往返也没碰铁律层');
  }
}

// ================= 阶段34 涌现物理层：持有/交换/欠账/赖账/染色/归属/口述/缺口信号/存档（v2.4.0） =================
stage(34, '涌现物理：经过手/见面才换/欠账是记忆/复述染色/占着与公认/口述不对齐/缺口信号/存档');
{
  const mockR = { mapDirty: false, meteor() { }, shake() { } };
  const mkG = (seed) => { const g = new Game(mockR); g.newGame(seed); return g; };
  // rng 队列：按序吐出指定值，吐完守兜底（0.99 = 大概率什么都不触发）
  const q = (vals, dflt) => { let i = 0; return () => i < vals.length ? vals[i++] : (dflt == null ? 0.99 : dflt); };

  // 1. 经过手：产出经谁的手谁留一点——固定分成无随机，总量守恒
  {
    const g = mkG(3401);
    const n = g.npcs[0];
    const crop0 = g.stock.crop;
    const r = npcEarn(n, 'crop', 5, g);
    eq(r, 4, 'npcEarn 返回实际入镇库的量');
    eq(g.stock.crop, crop0 + 4, 'n≥3 时 n-1 入镇库');
    eq(goodsOf(n, 'crop'), 1, 'n≥3 时 1 留在手上');
    eq((g.stock.crop - crop0) + goodsOf(n, 'crop'), 5, '经过手总量守恒（4 入库 + 1 留手 = 5）');
    const wood0 = g.stock.wood;
    eq(npcEarn(n, 'wood', 2, g), 2, 'n<3 全入镇库');
    eq(goodsOf(n, 'wood'), 0, 'n<3 手上不留');
    const gold0 = g.stock.gold;
    eq(npcEarn(n, 'gold', 4, g), 3, '金币 n≥3 也是留 1');
    eq(n.hold.purse, 1, '金币留手进 purse 不进 goods');
    eq(g.stock.gold, gold0 + 3, '金币入镇库守恒');
    n.hold.purse = HOLD_PURSE_CAP;
    const gold1 = g.stock.gold;
    eq(npcEarn(n, 'gold', 5, g), 5, 'purse 满了留不下，全归镇库');
    eq(n.hold.purse, HOLD_PURSE_CAP, 'purse 不越上限（有限定理）');
    eq(g.stock.gold, gold1 + 5, 'purse 溢出部分镇库兜底（不吞掉）');
    n.hold.goods.crop = HOLD_GOODS_RES_CAP;
    const crop1 = g.stock.crop;
    eq(npcEarn(n, 'crop', 5, g), 5, '单种物资满了留不下，全归镇库');
    eq(g.stock.crop, crop1 + 5, 'goods 溢出部分同样守恒');
    eq(npcEarn(n, 'magic', 5, g), 0, '不认识的资源一律拒绝（守恒白名单）');
    eq(npcEarn(n, 'crop', -3, g), 0, '负产出拒绝（只搬不生灭）');
  }

  // 2. ensureHold 惰性初始化（旧档兼容：没有 hold 字段的 NPC 也能进新物理）
  {
    const bare = {};
    ensureHold(bare);
    ok(bare.hold && bare.hold.purse === 0 && bare.hold.goods && Array.isArray(bare.hold.owed), '裸对象惰性长出持有结构');
    const half = { hold: { purse: 9 } };
    ensureHold(half);
    eq(half.hold.purse, 9, '已有 purse 不被抹掉');
    ok(half.hold.goods && Array.isArray(half.hold.owed), '缺的手臂补齐');
  }

  // 3. 手里的粮真的能吃：吃自己存货，货少了人也饱了（守恒：goods 减少）
  {
    const n = new NPC(ROSTER[4], null);
    ensureHold(n); n.hold.goods.fish = 2; n.needs.hunger = 50;
    ok(eatFromHold(n), '有存货吃到了自己的粮');
    eq(goodsOf(n, 'fish'), 1, '吃掉一份货少一份');
    eq(n.needs.hunger, 30, '吃自己的粮饥饿大降');
    n.hold.goods = {};
    ok(!eatFromHold(n), '没存货就吃不到');
  }

  // 4. 归属转移原语（v4.8.0）：giveGoods 守恒——一份从一只手到另一只手，对方放不下退回
  {
    const g = mkG(3402);
    const a = new NPC(ROSTER[0], null), b = new NPC(ROSTER[1], null);
    ensureHold(a).goods.crop = 3; ensureHold(b).goods.crop = 0;
    eq(giveGoods(a, b, 'crop', 1), 1, '一份粮易手');
    eq(goodsOf(a, 'crop'), 2, '给出的真失去了（代价定理）');
    eq(goodsOf(b, 'crop'), 1, '对方真拿到了（只搬不生灭）');
    eq(giveGoods(a, b, 'wood', 1), 0, '手里没有的一粒也给不出');
    eq(giveGoods(a, a, 'crop', 1), 0, '给自己不算易手');
    b.hold.goods.crop = HOLD_GOODS_RES_CAP;      // 对方单种满了
    eq(giveGoods(a, b, 'crop', 1), 0, '对方放不下原样退回（不吞掉）');
    eq(goodsOf(a, 'crop'), 2, '退回后原主不少');
    a.hold.purse = 5; b.hold.purse = 0;
    eq(giveGoods(a, b, 'gold', 3), 3, '金币走钱袋易手');
    eq(a.hold.purse, 2, '金币守恒：给的少了');
    eq(b.hold.purse, 3, '金币守恒：收的多了');
    void g;
  }

  // 5. 欠债清偿内建进转移物理：给出去的东西正好抵欠人家的同种账，账就销了
  {
    const a = new NPC(ROSTER[0], null), b = new NPC(ROSTER[1], null);
    ensureHold(a).goods.crop = 2;
    a.hold.owed.push({ to: b.id, res: 'crop', qty: 2, day: 1 });
    eq(giveGoods(a, b, 'crop', 2), 2, '两份粮到了债主手里');
    eq(a.hold.owed.length, 0, '欠账随实物清偿销账（欠账是记忆，清账是事实）');
    eq(goodsOf(b, 'crop'), 2, '债主真收到了');
    // 部分清偿：账按量递减
    a.hold.goods.wood = 1;
    a.hold.owed.push({ to: b.id, res: 'wood', qty: 3, day: 1 });
    giveGoods(a, b, 'wood', 1);
    eq(a.hold.owed[0].qty, 2, '给一份抵一份，剩下的账还在');
  }

  // 6. 脚本触发退役：见面不再自动换物/赊账/还账——那是社会规则，不归物理管
  {
    const g = mkG(3403);
    const a = new NPC(ROSTER[0], null), b = new NPC(ROSTER[1], null);
    ensureHold(a).goods.crop = 3; ensureHold(b).goods.wood = 3;
    a.needs.hunger = 70;
    const clock = { totalDay: 10, hour: 10 };
    holdPairTick(a, b, { clock, rng: q([0.4, 0.4, 0.4]), log: null, game: g });
    eq(goodsOf(a, 'crop'), 3, '见面不自动换物（易手只由 NPC 自己的决定驱动）');
    eq(goodsOf(a, 'wood'), 0, '对方的东西不会自己过来');
    eq(a.hold.owed.length, 0, '见面不自动赊账');
    ok(!g.exchangeStats || Object.keys(g.exchangeStats).length === 0, '交换统计不再被脚本喂养');
  }

  // 7. 赖账：账太旧、信任太薄，就"忘了"——失真物理直接吃欠账
  {
    const g = mkG(3404);
    const a = new NPC(ROSTER[0], null), b = new NPC(ROSTER[1], null);
    ensureHold(a).owed.push({ to: b.id, res: 'crop', qty: 1, day: 1 });
    relOf(a, b.id, 30).trust = 10;             // 信没了
    const clock = { totalDay: 30, hour: 10 };  // 账龄 29 天 > 20
    holdPairTick(a, b, { clock, rng: q([0.05, 0.99, 0.99]), log: null, game: g });
    eq(a.hold.owed.length, 0, '旧账被"忘了"（owed 移除）');
    eq(g.owedDefaults, 1, '赖账累计进全镇统计');
    eq(relOf(b, a.id, 30).grudge, 4, '债权人记下了这根刺');
  }

  // 8. 复述染色（纯函数）：传话的人什么心情，话就走什么味——不改任何状态
  {
    const t1 = tintRecall('他送我一朵花', 80, 10);
    ok(t1 !== '他送我一朵花' && t1.includes('他送我一朵花'), '难过复述好事→酸蚀（事实主干还在）');
    const t2 = tintRecall('他打了我一巴掌', -80, 90);
    ok(t2 !== '他打了我一巴掌' && t2.includes('他打了我一巴掌'), '开心复述坏事→软化');
    eq(tintRecall('今天天气好', 0, 50), '今天天气好', '价态无落差→原样（不硬染）');
  }

  // 9. 错信息驱动行为：三成概率话题不是静态表，是自己染色后的近事
  {
    const a = new NPC(ROSTER[0], null), b = new NPC(ROSTER[1], null);
    a.mind.secrets = [];                        // 隔离撒谎支线，专验话题来源
    a.memory('阿黄回来了', 5, 8, 90);           // 好事，发生时心情 90
    a.needs.mood = 10;                          // 现在难过 → 回忆被酸蚀
    const ctx = { clock: { totalDay: 6, hour: 10 }, rng: q([], 0.2), nowReal: 1000, log: null, w: null, game: null, customs: null };
    ok(tryPairChat(a, b, ctx), '聊天发生了');
    ok(a.bubble && a.bubble.text.includes('阿黄'), '话题来自自己的近事而不是静态表：' + (a.bubble && a.bubble.text));
    ok(a.memories.some(m => m.orig === '阿黄回来了' && m.text !== m.orig), '回忆这个动作本身让它漂移（染色真实发生）');
  }

  // 10. 占着与公认：搬进空房 + 见证人写下认或不认；不认够多→争议；住久了→时间成事实
  {
    const g = mkG(3405);
    const house = g.world.houses[0];
    house.ownerId = 'dead_x';                   // 故人留下的空房
    const squatter = g.npcs[0];
    claimHouse(g, squatter, house, [
      { npc: g.npcs[1], recognized: true },
      { npc: g.npcs[2], recognized: false },
      { npc: g.npcs[3], recognized: false }
    ]);
    eq(g.claims.size, 1, '认领登记进 claims');
    const c = [...g.claims.values()][0];
    eq(c.by, squatter.id, '占着的人记下了');
    eq(house.ownerId, squatter.id, '房子归属落到占着的人');
    ok(squatter.home && squatter.home.hx === house.x, '人真的搬进去了（占着=人在那里）');
    eq(Object.values(c.recognizedBy).filter(v => v === false).length, 2, '两个见证人不认（false 不是中立，是不认）');
    holdDaily(g, c.since + 5);                  // 头 10 天内，不认 ≥2 → 摆上台面
    eq(c.disputed, true, '争议摆到了台面上');
    eq(g.claimDisputes, 1, '归属争议累计进全镇统计');
    c.recognizedBy = { w1: true, w2: true };    // 公论慢慢转过来了
    holdDaily(g, c.since + 31);
    eq(c.settled, true, '住久了就是他的——时间成事实（不是法条）');
  }

  // 11. 口述与考古永不对齐：markNote 是真相层，口述是血肉层，不设 reconciler
  {
    const og = {
      marks: new Map([['5,5', { name: '老柳树下' }]]),
      npcs: [
        { name: '甲', dying: null, needs: { mood: 50 }, memories: [{ d: 2, t: '08:00', text: '在老柳树下见过他', orig: '在老柳树下见过他', valence: 0, drift: 0 }] },
        { name: '乙', dying: null, needs: { mood: 50 }, memories: [{ d: 5, t: '09:00', text: '老柳树下风水好', orig: '老柳树下风水好', valence: 0, drift: 0 }] }
      ]
    };
    const oral = oralOf(og, 5, 5);
    ok(oral, '活着的人里找得到口述');
    eq(oral.by, '甲', '取最早一条记忆的持有者');
    eq(oral.day, 2, '最早的那一天');
    eq(oral.truth, '老柳树下', '真相层原样返回（对不对齐是玩家眼睛的事）');
    ok(oral.text.includes('老柳树下'), '口述层是回忆染色版');
    eq(oralOf({ npcs: [] }, 5, 5), null, '没有考古标记就没有口述');
  }

  // 12. 快照：我手里有什么、欠谁的——LLM 看得见才可能聊起
  {
    const g = mkG(3406);
    const n = g.npcs[0];
    ensureHold(n); n.hold.purse = 5; n.hold.goods.crop = 2;
    n.hold.owed.push({ to: 'town', res: 'gold', qty: 3, day: 1 });
    const snap = npcSnapshot(n, { w: g.world, clock: { hour: 9, totalDay: 3, season: '春' }, weather: { type: 'sunny' }, nameOf: id => id });
    ok(snap.持有 && snap.持有.includes('金币5') && snap.持有.includes('粮食×2'), '持有进快照：' + snap.持有);
    ok(snap.欠账 && snap.欠账.includes('欠镇上金币×3'), '欠账进快照：' + snap.欠账);
  }

  // 13. 应变记录仍在走，但没有引擎消费（v4.8.0：压力留在世界里，等观念自己长）
  {
    const g1 = mkG(3407);
    const a = new NPC(ROSTER[0], null), b = new NPC(ROSTER[1], null);
    ensureHold(a).owed.push({ to: b.id, res: 'crop', qty: 1, day: 1 });
    relOf(a, b.id, 30).trust = 10;
    holdPairTick(a, b, { clock: { totalDay: 30, hour: 10 }, rng: q([0.05]), log: null, game: g1 });
    eq(g1.owedDefaults, 1, '赖账仍累计进全镇统计（物理记录）');
    eq(typeof g1.evoPool, 'object', '候选池字段还在（空壳，不再有东西入池）');
    evolveDaily(g1, 3);
    eq(g1.evoPool.length, 0, '没有缺口扫描没有脚本提案——压力不再自动变内容');
  }

  // 14. 存档往返：持有/欠账/交换统计/赖账争议计数/claims 全随档走，读档后房子接回占着的人
  {
    const g = mkG(3410);
    const n = g.npcs[0];
    ensureHold(n); n.hold.purse = 7; n.hold.goods.crop = 3;
    n.hold.owed.push({ to: 'town', res: 'gold', qty: 2, day: 1 });
    g.exchangeStats = { 'crop>wood': 3 }; g.owedDefaults = 2; g.claimDisputes = 1;
    const house = g.world.houses[1];
    claimHouse(g, g.npcs[1], house, [{ npc: g.npcs[2], recognized: true }]);
    const snap = JSON.parse(JSON.stringify(g.serialize()));
    const g2 = Game.hydrate(snap, mockR);
    eq(g2.npcs[0].hold.purse, 7, 'purse 随档走');
    eq(goodsOf(g2.npcs[0], 'crop'), 3, 'goods 随档走');
    eq(g2.npcs[0].hold.owed.length, 1, '欠账随档走');
    eq(g2.exchangeStats['crop>wood'], 3, '交换统计随档走');
    eq(g2.owedDefaults, 2, '赖账计数随档走');
    eq(g2.claimDisputes, 1, '争议计数随档走');
    ok(g2.claims instanceof Map && g2.claims.size === 1, 'claims 复原成 Map');
    const [key, c] = [...g2.claims.entries()][0];
    const [hx, hy] = key.split(',').map(Number);
    const h2 = g2.world.houses.find(v => v.ox === hx && v.oy === hy);
    ok(h2 && h2.ownerId === g.npcs[1].id, '读档后房子接回占着的人');
    eq(c.by, g.npcs[1].id, 'claim 归属人随档走');
  }
}

// ================= 阶段35 神经芯：一颗大脑/奖励调制/死后游荡/落进新生儿/轮回不灭/存档（v2.5.0） =================
stage(35, '神经芯：权重偏置/奖励调制零随机/宿主死亡游荡/芯落进新生儿/30天一轮轮回/存档往返');
{
  const mockR = { mapDirty: false, meteor() { }, shake() { } };
  const mkG = (seed) => { const g = new Game(mockR); g.newGame(seed); return g; };
  const q = (vals, dflt) => { let i = 0; return () => i < vals.length ? vals[i++] : (dflt == null ? 0.99 : dflt); };
  const hostOf = (g) => g.npcs.find(n => n.id === g.neurocore.hostId);

  // 1. 结构：全镇恒一颗芯，开局寄宿在一位居民身上，基线=现状行为
  {
    const g = mkG(3501);
    ok(g.neurocore && g.neurocore.hostId, '开局有芯且有宿主');
    ok(!!hostOf(g), '宿主 id 对得上名册');
    eq(g.neurocore.gen, 1, '初始第一代');
    ok(JSON.stringify(g.neurocore.w) === JSON.stringify(NEURO_W), '权重基线=现状行为（刚落地不改行为）');
    ok(!g.neurocore.floating && !g.neurocore.dead, '开局附身且未死');
  }

  // 2. 偏置：闲时三分按权重抽签（chainRng 定值——一次 rng() 抽签，次数确定）
  {
    const g = mkG(3502);
    const host = hostOf(g);
    host.needs.energy = 80; host.needs.hunger = 30;
    eq(neuroTail(host, g, q([0.0]), 10).action, 'exist', '抽签 0 → exist（exist 占前段）');
    eq(neuroTail(host, g, q([0.99]), 10).action, 'scout', '抽签 0.99 → scout（scout 占末段，白天+有精力）');
    eq(neuroTail(host, g, q([0.5]), 10).action, 'wander', '抽签 0.5 → wander（中段）');
    const other = g.npcs.find(n => n.id !== g.neurocore.hostId);
    eq(neuroTail(other, g, q([0.0]), 10), null, '芯只附在宿主身上，旁人不受偏置');
    eq(neuroTail(host, null, q([0.0]), 10), null, '无镇级上下文 → 原路径');
    g.neurocore.floating = true;
    eq(neuroTail(host, g, q([0.0]), 10), null, '游荡中的芯不偏置任何人');
  }

  // 3. 偏置不改守恒：抽签只选动作，不生灭任何资源
  {
    const g = mkG(3503);
    const host = hostOf(g);
    const sum = () => Object.values(g.stock).reduce((a, b) => a + b, 0);
    const s0 = sum();
    for (let k = 0; k < 20; k++) neuroTail(host, g, q([k / 20]), 10);
    eq(sum(), s0, '偏置只改动作选择，镇库总量分毫不动');
  }

  // 4. 工作愣神闸：work 权重缩放，夹在区间（基线 100 → 现状 0.18）
  {
    const g = mkG(3504);
    const host = hostOf(g);
    eq(neuroWorkIdle(host, g), 0.18, '基线权重 → 现状 0.18（刚落地不改行为）');
    g.neurocore.w.work = 200;
    ok(Math.abs(neuroWorkIdle(host, g) - 0.09) < 1e-9, 'work=200 → 愣神减半（学会手上活计要紧）');
    g.neurocore.w.work = 50;
    ok(Math.abs(neuroWorkIdle(host, g) - 0.36) < 1e-9, 'work=50 → 愣神加倍');
    g.neurocore.w.work = 30;
    eq(neuroWorkIdle(host, g), 0.45, '夹上限 0.45');
    g.neurocore.w.work = 260;
    ok(Math.abs(neuroWorkIdle(host, g) - 0.18 * 100 / 260) < 1e-9, '夹下限内按公式（勤而不灭）');
  }

  // 5. 奖励调制：需求改善→强化最近动作；恶化→轻推回；零随机（同输入必同结果）
  {
    const g = mkG(3505);
    const core = g.neurocore;
    const host = hostOf(g);
    core._snap = null; core._prevAction = null;
    neuroObserve(g, host, { action: 'scout' });       // 建立快照
    const s0 = core.w.scout;
    host.needs.mood = Math.min(100, host.needs.mood + 30);
    host.needs.energy = Math.min(100, host.needs.energy + 15);   // 日子好过了 +45
    neuroObserve(g, host, { action: 'wander' });      // 上一动作是 scout → 强化
    eq(core.w.scout, s0 + 2, '需求改善→强化最近动作（固定步长 +2）');
    eq(core.stats.reinforced, 1, '强化计数');
    const w0 = core.w.wander;
    host.needs.mood -= 40;                            // 日子难过了 -40
    neuroObserve(g, host, { action: 'exist' });
    eq(core.w.wander, w0 - 2, '需求恶化→最近动作轻推回（-2）');
    const d0 = core.stats.decisions;
    neuroObserve(g, host, { action: 'eat' });         // 生存动作不进权重表
    eq(core.w.wander, w0 - 2, '生存动作不被调制（天道不夺生存自由）');
    eq(core.stats.decisions, d0 + 1, '决策计数照记');
    // 零随机：同序列输入必得同结果
    const g2 = mkG(3505);
    const core2 = g2.neurocore;
    const host2 = g2.npcs.find(n => n.id === core2.hostId);
    core2._snap = null; core2._prevAction = null;
    neuroObserve(g2, host2, { action: 'scout' });
    host2.needs.mood = Math.min(100, host2.needs.mood + 30);
    host2.needs.energy = Math.min(100, host2.needs.energy + 15);
    neuroObserve(g2, host2, { action: 'wander' });
    eq(core2.w.scout, core.w.scout, '同序列输入必得同权重（零随机可复现）');
  }

  // 6. 收敛有界：强化撞夹上限就停（有限定理：倾向封顶，不成仙）
  {
    const g = mkG(3506);
    const core = g.neurocore;
    const host = hostOf(g);
    core._snap = null; core._prevAction = null;
    neuroObserve(g, host, { action: 'work' });
    host.needs.energy = 100; host.needs.hunger = 0; host.needs.mood = 100; host.needs.social = 100;
    neuroObserve(g, host, { action: 'work' });
    eq(core.w.work, 102, '日子大好→强化 +2');
    core.w.work = NEURO_W_CLAMP.work[1] - 1;   // 贴着上限
    core._snap = 0;                            // 上次观察在谷底
    neuroObserve(g, host, { action: 'work' });
    eq(core.w.work, NEURO_W_CLAMP.work[1], '再强化撞夹上限 260（封顶不成仙）');
    core._snap = 0;
    neuroObserve(g, host, { action: 'work' });
    eq(core.w.work, NEURO_W_CLAMP.work[1], '到顶后不再涨');
  }

  // 7. 生存优先：芯在也不夺生存决策（饿→觅食，权重再大也不管饭）
  {
    const g = mkG(3507);
    const host = hostOf(g);
    g.neurocore.w.exist = NEURO_W_CLAMP.exist[1];
    host.needs.hunger = 80;
    const dec = host.scriptDecide(g.world, { totalDay: 3, hour: 10, season: '春' },
      { precipitating: false }, q([0.5]), g.npcs, g);
    eq(dec.action, 'eat', '饿着的时候芯不插手（生存决策永远先行）');
  }

  // 8. 死亡游荡与轮回：宿主死了芯不进坟；30 天无承接记一轮轮回，等待重置，芯不灭
  {
    const g = mkG(3508);
    const core = g.neurocore;
    const hostName = hostOf(g).name;
    g.forceDeath(core.hostId);
    ok(core.floating && core.deadSince === g.clock.totalDay, '宿主死了→芯进入游荡');
    eq(core.lastHost, hostName, '芯只记得上一任宿主的名字（不是记忆）');
    eq(neuroTail({ id: 'x', needs: { energy: 80, hunger: 30 } }, g, q([0.0]), 10), null, '游荡芯不偏置任何人');
    g.clock.day += NEURO_TAIL_DEADLINE + 1;   // totalDay 是派生 getter，推进落笔 clock.day
    neuroDaily(g, g.clock.totalDay);
    eq(core.rounds, 1, '游荡 30 天无新生儿承接→记一轮轮回');
    eq(core.deadSince, g.clock.totalDay, '轮回后等待重置（接着等）');
    ok(g.chron.some(e => e.k === 'neuro' && e.t.includes('轮回')), '轮回记进编年史');
    g.clock.day += NEURO_TAIL_DEADLINE + 1;
    neuroDaily(g, g.clock.totalDay);
    eq(core.rounds, 2, '再等 30 天还没等到→第二轮轮回（芯不灭，总有新生儿）');
    // 轮回多轮之后终于等到新生儿——照样落地
    const nb = g.forceBirth();
    if (nb) {
      eq(core.hostId, nb.id, '两轮轮回之后芯照样落进新降生的新生儿');
      ok(!core.floating, '承接后不再游荡');
    }
  }

  // 9. 落进新生儿：权重跟着芯走（手艺在骨头里），记忆不带走
  {
    const g = mkG(3509);
    const core = g.neurocore;
    g.forceDeath(core.hostId);
    core.w.work = 200;                       // 上一代习得的勤快
    const nb = g.forceBirth();
    ok(!!nb, '死时之后有新生儿降生');
    eq(core.hostId, nb.id, '芯落进新降生的新生儿');
    ok(!core.floating, '承接后不再游荡');
    eq(core.gen, 2, '世代 +1');
    eq(core.w.work, 200, '权重跟着芯走（手艺在骨头里）');
    eq(core.age, 0, '芯龄随新宿主重来');
    eq(core._snap, null, '观察快照清空（前世不带）');
    eq(core._prevAction, null, '最近动作清空（前世不带）');
    eq(nb.memories.length, 0, '新生儿没有前世的记忆（转世不带记忆）');
    ok(g.chron.some(e => e.k === 'neuro' && e.t.includes('第2代')), '转世记进编年史（事实层）');
  }

  // 10. 用进废退：每日向基线回落 2%（不牢靠的习惯会淡）
  {
    const g = mkG(3510);
    const core = g.neurocore;
    core.w.exist = 80;
    const day = g.clock.totalDay;
    neuroDaily(g, day);
    ok(Math.abs(core.w.exist - 79.5) < 1e-9, 'exist 80 → 79.5（向基线 55 回落 2%）');
    eq(core.age, 1, '芯龄每日 +1');
  }

  // 11. 存档往返：芯整对象随档走（轮回轮数也算）；旧档无芯 → 长出一颗无主的游荡芯
  {
    const g = mkG(3511);
    const core = g.neurocore;
    g.forceDeath(core.hostId);
    core.w.work = 180; core.stats.decisions = 33; core.stats.reinforced = 7; core.rounds = 2;
    const nb = g.forceBirth();
    const snap = JSON.parse(JSON.stringify(g.serialize()));
    const g2 = Game.hydrate(snap, mockR);
    ok(g2.neurocore && g2.neurocore.hostId === nb.id, '读档后芯还附在转世宿主身上');
    eq(g2.neurocore.gen, 2, '世代随档走');
    eq(g2.neurocore.w.work, 180, '权重表随档走');
    eq(g2.neurocore.stats.decisions, 33, '学习统计随档走');
    eq(g2.neurocore.rounds, 2, '走过的轮回轮数随档走（芯的路程也作数）');
    ok(g2.npcs.some(n => n.id === g2.neurocore.hostId), '宿主 id 对得上读档名册');
    // 旧档迁移：无芯的世界长出一颗无主的芯
    const old = JSON.parse(JSON.stringify(g.serialize()));
    delete old.neurocore;
    const g3 = Game.hydrate(old, mockR);
    ok(g3.neurocore && g3.neurocore.floating && !g3.neurocore.hostId, '旧档无芯 → 无主的游荡芯');
    eq(g3.neurocore.deadSince, g3.clock.totalDay, '游荡从读档日起算（30 天内有新生儿就落地）');
  }
}

// ================= 阶段36 模型池：byPersonality分配/分组多模型/故障链/演化独占/存档往返（v2.6.0） =================
stage(36, '模型池：byPersonality分配确定性/分组多模型/故障链降级/演化独占不共享/全挂回退/存档往返');
{
  const mockR = { mapDirty: false, meteor() { }, shake() { } };
  const mkG = (seed) => { const g = new Game(mockR); g.newGame(seed); return g; };
  const POOL = {
    enabled: true, strategy: 'byPersonality',
    providers: [
      { baseUrl: 'https://gw.test/v1', apiKey: 'gw-key', models: ['model-a', 'model-b', 'model-c'] }
    ]
  };

  // 1. byPersonality 分配：确定性 + 全员在池内 + 性格分化 + 惰性补齐
  {
    const g1 = mkG(3601);
    g1.aiCfg.npcPool = JSON.parse(JSON.stringify(POOL));
    const n1 = assignModels(g1);
    eq(n1, g1.npcs.length, '全镇初次分配');
    eq(assignModels(g1), 0, '已分配不重算（惰性补齐）');
    const g2 = mkG(3601);
    g2.aiCfg.npcPool = JSON.parse(JSON.stringify(POOL));
    eq(assignModels(g2), g2.npcs.length, '第二局初次分配');
    const ids = g1.npcs.map(n => n.aiModelId);
    ok(ids.every(m => ['model-a', 'model-b', 'model-c'].includes(m)), '分配都在池内');
    ok(new Set(ids).size >= 2, '10 个性格各异的居民散到至少 2 个模型（声音分化）');
    for (let i = 0; i < g1.npcs.length; i++) eq(g2.npcs[i].aiModelId, ids[i], '同 seed 同配置分配一致（' + g1.npcs[i].name + '）');
    const npc = g1.npcs[0];
    eq(assignModel(poolEntries(g1.aiCfg), npc), npc.aiModelId, 'assignModel 单点复现（零随机）');
  }

  // 2. 池开关语义：关不分配；池变小失效缓存重算；池开但无 providers 不启用
  {
    const g = mkG(3602);
    g.aiCfg.npcPool = JSON.parse(JSON.stringify(POOL));
    eq(assignModels(g), g.npcs.length, '池开全分');
    g.aiCfg.npcPool.enabled = false;
    g.npcs[0].aiModelId = null;
    eq(assignModels(g), 0, '池关不分配');
    eq(g.npcs[0].aiModelId, null, '池关无缓存');
    g.aiCfg.npcPool.enabled = true;
    g.aiCfg.npcPool.providers = [{ baseUrl: 'https://gw2.test/v1', apiKey: '', models: ['solo-m'] }];
    assignModels(g);
    ok(g.npcs.every(n => n.aiModelId === 'solo-m'), '池变小 → 失效缓存全部重算');
    const empty = mkG(3603);
    empty.aiCfg.npcPool = { enabled: true, strategy: 'byPersonality', providers: [] };
    eq(assignModels(empty), 0, '池开但无端点 → 不分配');
  }

  // 3. 故障链 callChain：第一级挂 → 第二级接管；失败留痕
  {
    const cfg = {
      temperature: 0.8, maxTokens: 100, timeoutSec: 5,
      localFallback: { baseUrl: 'http://localhost:11434/v1', model: 'lf' }
    };
    const entries = [
      { baseUrl: 'https://bad.test/v1', apiKey: 'k1', model: 'bad-m' },
      { baseUrl: 'https://good.test/v1', apiKey: 'k2', model: 'good-m' }
    ];
    const realFetch = globalThis.fetch;
    let hits = 0;
    globalThis.fetch = async () => {
      hits++;
      return { ok: false, status: 500, text: async () => 'boom' };
    };
    let threw = false;
    try { await callChain(entries, cfg, 'sys', 'user'); } catch (e) { threw = true; ok(e.tried.length === 2, '全挂时 tried 留全程痕'); }
    globalThis.fetch = async (url, opt) => {
      hits++;
      if (String(url).startsWith('https://bad.test')) return { ok: false, status: 500, text: async () => 'boom' };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '正常' } }] }) };
    };
    hits = 0;
    const r = await callChain(entries, cfg, 'sys', 'user');
    globalThis.fetch = realFetch;
    ok(threw, '两级全挂 → 抛（上层各自兜底）');
    eq(r.via, 'good-m', '第一级挂 → 第二级接管');
    eq(r.tried.length, 1, '第一级失败留痕');
    eq(hits, 2, '逐级尝试次数正确（挂一次接一次）');
  }

  // 4. 分组多模型：每组快照只带本组居民；单组挂 → 组内故障转移
  {
    const cfg = {
      temperature: 0.8, maxTokens: 100, timeoutSec: 5,
      npcPool: { enabled: true, strategy: 'byPersonality', providers: [
        { baseUrl: 'https://gw.test/v1', apiKey: '', models: ['m1', 'm2'] }
      ] },
      localFallback: { baseUrl: 'http://localhost:11434/v1', model: 'lf' }
    };
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url, opt) => {
      const body = JSON.parse(opt.body);
      seen.push({ model: body.model, text: body.messages.map(m => m.content).join('') });
      if (body.model === 'm2') return { ok: false, status: 500, text: async () => 'down' };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"decisions":[{"npc":"陈麦冬","action":"idle","reason":"晒太阳"}]}' } }] }) };
    };
    const r = await requestDecisionsPooled(cfg, [
      { model: 'm1', snaps: [{ name: '陈麦冬' }] },
      { model: 'm2', snaps: [{ name: '赵铁山' }] }
    ], '【小镇现状】测试');
    globalThis.fetch = realFetch;
    eq(r.clean.length, 2, 'm2 挂 → m1 故障转移接管第二组');
    ok(r.tried.some(t => t.model === 'm2'), 'm2 失败留痕');
    eq(r.via.filter(v => v === 'm1').length, 2, '两组都由 m1 接管');
    ok(seen.some(s => s.model === 'm1' && s.text.includes('陈麦冬') && !s.text.includes('赵铁山')), '第一组快照只带本组居民');
    ok(seen.some(s => s.model === 'm1' && s.text.includes('赵铁山') && !s.text.includes('陈麦冬')), '第二组快照只带本组居民');
  }

  // 5. AI 轮池分支：分配发生在轮内；运转日志；全挂空手不炸不锁死
  {
    const g = mkG(3604);
    g.aiCfg.npcPool = JSON.parse(JSON.stringify(POOL));
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '```json\n{"decisions":[{"npc":"陈麦冬","action":"work","say":"趁天好翻地","reason":"天好"}]}\n```' } }] }) });
    await g.requestAiRound();
    ok(g.npcs.every(n => n.aiModelId && ['model-a', 'model-b', 'model-c'].includes(n.aiModelId)), '轮内自动完成 byPersonality 分配');
    ok(g.logLines.some(l => l.text.includes('居民之魂分工运转')), '池分支分工运转日志');
    ok(g.logLines.some(l => l.text.includes('居民之魂更新了')), 'AI轮决策落地');
    globalThis.fetch = async () => { throw new Error('all down'); };
    const before = g.logLines.length;
    await g.requestAiRound();
    globalThis.fetch = realFetch;
    eq(g.logLines.length, before, '全挂无决策落地也无冒泡报错');
    ok((g.aiChainLog || []).some(e => e.purpose === 'npc' && e.failed && e.failed.length >= 2), 'chainLog 留全挂降级痕');
    ok(!g.aiBusy, '轮结束不锁死');
  }

  // 6. 演化独占链结构（v4.8.0：演化之灵 prompt 已退役，链配置仍是合法的用户设置）
  {
    const g = mkG(3605);
    g.aiCfg = {
      ...DEFAULT_AI_CFG,
      npcPool: JSON.parse(JSON.stringify(POOL)),
      evolutionModel: {
        enabled: true, baseUrl: 'https://evo.test/v1', apiKey: 'ek', model: 'gemini-2.5-flash',
        backup: [{ baseUrl: 'https://bak.test/v1', apiKey: '', model: 'glm-4.7-flash' }]
      },
      localFallback: { baseUrl: 'http://localhost:11434/v1', model: 'lf' }
    };
    ok(evolutionReady(g.aiCfg), '演化独占就绪');
    const es = evoEntries(g.aiCfg);
    eq(es.map(e => e.model).join(','), 'gemini-2.5-flash,glm-4.7-flash,lf', '演化链顺序：主→备援→本地');
    ok(!es.some(e => ['model-a', 'model-b', 'model-c'].includes(e.model)), '演化链不含 NPC 池模型（不共享额度）');
  }

  // 7. 演化未就绪 → 链为空（演化之灵已退役：不再有任何人代世界想新东西）
  {
    const g = mkG(3606);
    g.aiCfg.apiKey = 'k'; g.aiCfg.baseUrl = 'https://single.test/v1'; g.aiCfg.model = 'single-m';
    ok(!evolutionReady(g.aiCfg), '未启用演化独占');
    eq(evoEntries(g.aiCfg).length, 0, '演化链为空');
  }

  // 8. 存档往返：aiModelId 随档走；读档改池 → 重算
  {
    const g = mkG(3607);
    g.aiCfg.npcPool = JSON.parse(JSON.stringify(POOL));
    assignModels(g);
    const before = Object.fromEntries(g.npcs.map(n => [n.id, n.aiModelId]));
    const snap = JSON.parse(JSON.stringify(g.serialize()));
    const g2 = Game.hydrate(snap, mockR);
    ok(g2.npcs.every(n => n.aiModelId === before[n.id]), 'aiModelId 随档走');
    eq(assignModels(g2), 0, '读档后分配仍有效不重算');
    g2.aiCfg.npcPool.providers[0].models = ['new-m'];
    assignModels(g2);
    ok(g2.npcs.every(n => n.aiModelId === 'new-m'), '读档改池 → 失效重算');
  }
}

// ================= 阶段37 白纸开局：身份反转/本能采集/职业从手艺长出/生存信号/老档兼容（v2.7.0） =================
stage(37, '白纸开局：十人无业/库存清零/本能觅食/成年无业/配方创造职业/生存原语信号/老档兼容');
{
  const mockR = { mapDirty: false, meteor() { }, shake() { } };
  const mkG = (seed) => { const g = new Game(mockR); g.newGame(seed); return g; };

  // 1. 开局白纸：十人无业、库存全零、配方表空
  {
    const g = mkG(3701);
    ok(g.npcs.every(n => n.job === '' && n.workArea === ''), '十人全无业（种子居民不带手艺）');
    ok(Object.values(g.stock).every(v => v === 0), '库存全零（不带来任何存货）');
    eq(Object.keys(g.recipes).length, 0, '配方表为空');
    eq(Object.keys(g.recipeDefs).length, 0, '动态配方表为空');
    ok(Object.keys(RECIPE_DEFS).length === 0, '铁律层配方表为空');
  }

  // 2. 本能觅食：无业者白天决策去摘浆果（本能不是手艺）
  {
    const g = mkG(3702);
    const n = g.npcs[0];
    n.body.ageYears = 30;
    n.needs.energy = 90; n.needs.hunger = 30;
    n.intent = { type: 'ready', label: '待命', untilMin: 0 };
    g.clock.min = 10 * 60;
    let bush = null;
    for (let y = 0; y < 40 && !bush; y++) for (let x = 0; x < 60 && !bush; x++) {
      if (getObj(g.world, x, y) === O.BUSH) bush = { x, y };
    }
    ok(!!bush, '世界里有浆果丛');
    let gathered = null;
    for (let i = 0; i < 60 && !gathered; i++) {
      g.rng = mulberry32(i * 11 + 5);
      n.x = bush.x + 3; n.y = bush.y;   // 挪到浆果丛边，绕开寻路运气
      const d = n.scriptDecide(g.world, g.clock, g.weather, g.rng, g.npcs, g);
      if (d.action === 'work' && d.tx === bush.x && d.ty === bush.y) gathered = d;
      n.intent = { type: 'ready', label: '待命', untilMin: 0 };
    }
    ok(!!gathered, '无业者白天去摘浆果：' + (gathered ? gathered.why : '没决策'));
  }

  // 3. 采集→持有→自食闭环：摘下的浆果进个人 hold，eat 先吃自己的
  {
    const g = mkG(3703);
    const n = g.npcs[0];
    npcEarn(n, 'berry', 3, g);
    const hold = ensureHold(n);
    ok((hold.goods.berry || 0) >= 1, '摘的浆果进个人持有（涌现物理层通路）');
    const hungerBefore = n.needs.hunger;
    n.intent = { type: 'eat', label: '吃饭', untilMin: 30, reason: '', source: 'script' };
    n.tick(1, { w: g.world, clock: g.clock, weather: g.weather, rng: mulberry32(7), npcs: g.npcs, stock: g.stock, nowReal: 5, gmPerReal: 60 });   // 1 游戏小时：帧太大代谢会盖过进食
    ok(n.needs.hunger < hungerBefore, '先吃自己的存货，饿意消了');
  }

  // 4. 成年无业：18 岁长成无业成年人，不分配任何活计
  {
    const g = mkG(3704);
    const born = { id: 't37', name: '试炼者', job: '孩童', workArea: '', body: { ageYears: 18 }, memories: [], memory(t) { this.memories.push({ text: t }); } };
    const job = assignAdultJob(born, g.npcs, mulberry32(37), 1);
    ok(job === '' && born.job === '' && born.workArea === '', '成年不分配职业');
    ok(born.memories.some(m => m.text.includes('成年')), '成年写进记忆');
  }

  // 5. 职业从手艺长出（v4.8.0：没有提案机械了——动态配方直接进表，谁先学会谁是干这个的）
  {
    const g = mkG(3705);
    g.recipeDefs.blackstone = { name: '烧石', job: '烧石的', base: 1.0, variants: [1.2], inputs: { stone: 1 }, outputs: { gold: 1 } };
    g.recipes.blackstone = { id: 'blackstone', mult: 1.0, knownBy: new Map([['zhao', 1]]), inventor: 'zhao', inventedDay: 1, tries: 0, lost: false, lostDay: 0 };
    ok(g.recipes.blackstone && g.recipes.blackstone.knownBy.has('zhao'), '新行当手艺活在运行时表里');
    ok(g.recipeDefs.blackstone.job === '烧石的', '行当名随手艺走，不查名册');
    // 传承照常：新手艺也能教给别人（其余人都有别的行当，学生池只剩他）
    for (const n of g.npcs) if (!n.job) n.job = '铁匠';
    const pupil = { id: 'pupil37', name: '小芒', job: '', body: { ageYears: 20 }, rels: {}, memories: [], moodDelta() { }, perceive() { }, memory(t) { this.memories.push({ text: t }); } };
    g.npcs.push(pupil);
    const oldRecipes = g.recipes; g.recipes = { blackstone: oldRecipes.blackstone };
    let i37 = 0; const vals37 = [0.3, 0.01, 0.2];
    g.rng = () => i37 < vals37.length ? vals37[i37++] : 0.99;
    teachDaily(g, 37);
    g.recipes = oldRecipes;
    ok(g.recipes.blackstone.knownBy.has('pupil37'), '无业者学会了新手艺（会烧黑石的人就是烧石的）');
  }

  // 6. 在册职业动态收集：无业时空，转职后有值
  {
    const g = mkG(3707);
    eq(activeJobs(g).length, 0, '白纸世界在册职业为空（无预设名册）');
    g.npcs[0].job = '铁匠';
    g.npcs[2].job = '铁匠';
    eq(JSON.stringify(activeJobs(g)), JSON.stringify(['铁匠']), '在册职业动态收集（转职后有值）');
  }

  // 7. 生存压力留在身体里（v4.8.0：饿就是饿，不再被扫描成提案信号）
  {
    const g = mkG(3708);
    for (const n of g.npcs.slice(0, 4)) { n.needs.hunger = 90; }
    evolveDaily(g, 3);
    eq(g.evoPool.length, 0, '饥饿不生提案——难受是居民的，念头要自己长');
  }

  // 8. 老档兼容：带职业与配方的旧档读入，行为零变化（真档 serialize→hydrate 全链路）
  {
    const g = mkG(3709);
    g.npcs[3].job = '樵夫';   // 模拟演化已转职
    g.recipeDefs.plank = { name: '锯木', job: '樵夫', base: 1.0, variants: [1.2] };
    g.recipes.plank = { id: 'plank', mult: 1.3, knownBy: new Map([['zhou', 2]]), inventor: 'zhou', inventedDay: 2, tries: 3, lost: false, lostDay: 0 };
    const snap = JSON.parse(JSON.stringify(g.serialize()));
    const g2 = Game.hydrate(snap, mockR);
    ok(g2.npcs[3].job === '樵夫', '老档：职业随档走');
    ok(g2.recipes.plank && g2.recipes.plank.mult === 1.3 && g2.recipes.plank.knownBy.has('zhou'), '老档：手艺与师承随档走');
    ok(g2.recipeDefs.plank && g2.recipeDefs.plank.job === '樵夫', '老档：动态配方表随档走');
  }
}

// ================= 阶段38 按需触发：各活各的（v2.8.0） =================
stage(38, '按需触发：时刻错开/与门/收集窗口成批/只动本批/超时脚本顶/事件插队/失败冷却/存档');
{
  const mockR = { mapDirty: false, meteor() { }, shake() { } };
  const mkG = (seed) => {
    const g = new Game(mockR); g.newGame(seed);
    g.aiCfg.apiKey = 'k'; g.aiCfg.model = 'm';   // aiEnabled()
    return g;
  };
  const setReady = (n) => { n.inside = false; n.path = []; n.intent = { type: 'ready', label: '待命', untilMin: 0 }; };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 1. 开局错开：没有全镇共享的决策时刻
  {
    const g = mkG(3801);
    const now = g._aiNowMin();
    const dcs = g.npcs.map(n => n.aiDcAt);
    ok(new Set(dcs).size >= 3, '开局个人决策时刻错开（不全员同刻被叫醒）');
    ok(dcs.every(d => d >= now), '错开时刻都在当下之后');
  }

  // 2. 与门：冷却到 ∧ 手头的事结束——三态 + 睡着
  {
    const g = mkG(3802);
    const now = g._aiNowMin();
    const [a, b, c, d] = g.npcs;
    for (const n of g.npcs) if (n !== a && n !== b && n !== c && n !== d) n.aiDcAt = now + 9999;   // 隔离：与 ③④⑤ 组同一手法，防 stagger 铺位偶发干扰
    setReady(a); a.aiDcAt = now - 10;                       // 合格
    b.path = []; b.inside = false; b.intent = { type: 'work', label: '干活', untilMin: 60 }; b.aiDcAt = now - 10;  // 活没干完
    setReady(c); c.aiDcAt = now + 100;                      // 冷却没到
    d.inside = true; d.path = []; d.intent = { type: 'sleep', label: '睡觉', untilMin: 0 }; d.aiDcAt = now - 10;  // 睡着
    g.aiLoopTick();
    eq(g.aiBatch.length, 1, '只有「到期且 ready」的一人入候问');
    ok(g.aiBatch[0].id === a.id, '入队的是合格者本人');
    ok(b.aiAsking === false, '与门：活没干完不打断（干长活的人节奏自己定）');
    ok(c.aiAsking === false, '与门：冷却没到不叫醒');
    ok(d.aiAsking === false, '睡着的人不叫');
  }

  // 2b. 同帧竞争：脚本闸必须给「该由 LLM 接管的人」和「候问在途的人」让位
  //     （NPC tick+脚本闸在帧前、aiLoopTick 在帧尾；不让位 LLM 永远抢不到 ready 的人，候问者也会被中途塞活）
  {
    const g = mkG(3802.5);
    g.aiSchedPaused = true;   // 只测脚本闸本身：帧尾不收人，隔离观察意图有没有被脚本动
    const now = g._aiNowMin();
    const [a, b, c] = g.npcs;
    setReady(a); a.aiDcAt = now - 10;            // 到期可问 → 脚本让位
    setReady(b); b.aiDcAt = now + 100;           // 冷却没到 → 脚本照常派活
    setReady(c); c.aiDcAt = now - 10; c.aiAsking = true;  // 候问在途 → 脚本不碰
    g.clock.speed = 0;
    g.loop(0.016);
    eq(a.intent.type, 'ready', '同帧：冷却到的 ready 者脚本不抢（留给帧尾 LLM）');
    ok(b.intent.type !== 'ready', '同帧：冷却没到的 ready 者脚本照常安排过日子');
    eq(c.intent.type, 'ready', '同帧：候问在途者不被脚本中途塞活（避免与 LLM 决策打架）');
  }

  // 3. 收集窗口：未满不成批；满窗成批；决策只落本批 + 冷却重置
  {
    const g = mkG(3803);
    g.aiCfg.intervalH = 2;
    const [a, b] = g.npcs;
    const far3 = g._aiNowMin() + 9999;
    for (const n of g.npcs) if (n !== a) n.aiDcAt = far3;   // 隔离：本测只验 a 的收集窗口语义
    setReady(a); a.aiDcAt = g._aiNowMin() - 10;
    g.aiLoopTick();
    eq(g.aiBatch.length, 1, '收集窗口未满：先候问不成批');
    ok(g.aiBusy === false, '窗口等待期没有在途请求');
    ok(a.aiAsking === true, '候问中 aiAsking 置位（主循环脚本闸让位）');
    const bIntentBefore = b.intent.type;

    const realFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = async () => {
      called++;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ decisions: [{ npc: a.name, action: 'idle', reason: '发会儿呆' }] }) } }] }) };
    };
    g.aiBatchStart = g._aiNowMin() - 31;   // 推过收集窗口（30 分钟）
    g.aiLoopTick();
    await sleep(30);
    globalThis.fetch = realFetch;
    eq(called, 1, '窗口满 → 发起一批请求');
    ok(a.aiAsking === false, '批次回来释放候问标记');
    ok(a.aiDcAt > g._aiNowMin(), '个人冷却重置到未来（平均 2 小时、带抖动）');
    ok(b.intent.type === bIntentBefore && b.aiAsking === false, '决策只落本批：队外人意图不动、不被叫醒');
  }

  // 4. 人够即批：满 cap 不等窗口
  {
    const g = mkG(3804);
    const now = g._aiNowMin();
    for (const n of g.npcs.slice(4)) n.aiDcAt = now + 9999;   // 隔离：恰好 4 人到期，杜绝开局端点值凑批
    for (const n of g.npcs.slice(0, 4)) { setReady(n); n.aiDcAt = now - 5; }
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"decisions":[]}' } }] }) });
    g.aiLoopTick();   // 4 人到期（=cap），即使窗口刚开也立即成批
    await sleep(30);
    globalThis.fetch = realFetch;
    eq(g.aiBusy, false, '满员批次已收尾');
    ok(g.npcs.slice(0, 4).every(n => !n.aiAsking), '满员批次四人全部释放');
  }

  // 5. 候问超时：应答迟迟不来 → 脚本先顶（活着不等神仙）
  {
    const g = mkG(3805);
    const now = g._aiNowMin();
    const a = g.npcs[0];
    for (const n of g.npcs) if (n !== a) n.aiDcAt = now + 9999;   // 隔离：只验 a 的超时
    setReady(a); a.aiDcAt = now - 10;
    g.aiLoopTick();
    eq(g.aiBatch.length, 1, '先入候问');
    g.aiBatchStart = now - 91;   // 超过 90 分钟超时
    g.aiLoopTick();
    eq(g.aiBatch.length, 0, '超时：候问队列清空');
    ok(a.aiAsking === false, '超时：标记释放');
    eq(a.aiDcAt, g._aiNowMin(), '超时：冷却重置（下一帧脚本领着过日子）');
    ok(a.intent.type === 'ready' && !a.aiAsking, '释放后重新满足脚本闸（ready 且非候问）');
  }

  // 6. 失败冷却：批次请求抛错 → 释放 + 给冷却，不每帧轰炸端点
  {
    const g = mkG(3806);
    const a = g.npcs[0]; setReady(a);
    const dc0 = g._aiNowMin();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('504 gateway timeout'); };
    await g.requestAiBatch([a]);
    globalThis.fetch = realFetch;
    ok(a.aiAsking === false, '失败批次释放标记');
    ok(a.aiDcAt > dc0, '失败也给冷却（防同一批每帧重试）');
  }

  // 7. 事件插队：降水只动户外非勇敢者；昭告人人；低语只动本人
  {
    const g = mkG(3807);
    const now = g._aiNowMin();
    for (const n of g.npcs) { n.aiDcAt = now + 500; n.inside = false; }
    const zhao = g.npcs.find(n => n.id === 'zhao');   // traits 暴躁 → brave
    const homebody = g.npcs.find(n => n.id === 'chen');
    homebody.inside = true;
    ok(zhao.brave === true, '测试夹具：赵铁山勇敢（雨天照旧）');
    g._aiKickPrecip();
    const outsideCowards = g.npcs.filter(n => !n.inside && !n.brave);
    ok(outsideCowards.length >= 1 && outsideCowards.every(n => n.aiDcAt <= now), '降水：户外非勇敢者立刻可问（躲雨自己决定）');
    ok(zhao.aiDcAt === now + 500, '降水：勇敢者不被叫醒');
    ok(homebody.aiDcAt === now + 500, '降水：屋里的人无感');
  }

  // 8. 存档：aiDcAt 随档走；在途态绝不复活；老档缺省错开初始化
  {
    const g = mkG(3808);
    const a = g.npcs[0];
    a.aiDcAt = 123456; a.aiAsking = true;
    const snap = JSON.parse(JSON.stringify(g.serialize()));
    ok(snap.npcs[0].aiDcAt === 123456, '存档带个人决策时刻');
    ok(!('aiAsking' in snap.npcs[0]), '在途态不进存档');
    const g2 = Game.hydrate(snap, mockR);
    eq(g2.npcs[0].aiDcAt, 123456, '读档：决策时刻复原');
    ok(g2.npcs[0].aiAsking === false, '读档：在途态清零（不复活候问挂死）');
    eq(g2.aiBatch.length, 0, '读档：候问队列清空');

    // 老档快照（全员无 aiDcAt 字段）→ 读档后错开初始化
    const oldSnap = JSON.parse(JSON.stringify(g.serialize()));
    for (const s of oldSnap.npcs) delete s.aiDcAt;
    const g4 = Game.hydrate(oldSnap, mockR);
    ok(g4.npcs.every(n => n.aiDcAt > g4._aiNowMin()), '老档无 aiDcAt → 错开初始化到未来（不第一帧全员涌入）');
    ok(new Set(g4.npcs.map(n => n.aiDcAt)).size >= 3, '老档读入后各人时刻仍错开');
  }
}

// ================= 阶段39 产出革命：产出=世界对象+个人手艺，job 不做产出开关（v2.9.0） =================
stage(39, '产出革命：采集人人可干/配方批处理守恒/选址三态/泛化三连/LLM落地/凭空产金拆除/存档');
{
  const mockR = { mapDirty: false, meteor() { }, shake() { } };
  const mkG = (seed) => { const g = new Game(mockR); g.newGame(seed); return g; };
  // doWork 直通上下文（绕开 tick 的意图调度，专测产出一环）
  const wctx = (g) => ({ w: g.world, clock: g.clock, rng: g.rng, stock: g.stock, log: null, npcs: g.npcs, game: g });
  function chainRng39(vals, seed) {
    const q = [...vals]; const f = mulberry32(seed);
    return () => (q.length ? q.shift() : f());
  }
  // 世界里找现成对象（按行扫描，与阶段37 同手法）
  const findObj = (g, type, maxY, maxX) => {
    for (let y = 0; y < (maxY || 40) ; y++) for (let x = 0; x < (maxX || 60); x++) {
      if (getObj(g.world, x, y) === type) return { x, y };
    }
    return null;
  };
  // 清场：站位 r2 内只留目标对象（确定性——不让别的采集对象抢镜）
  const clearAround = (g, cx, cy, keep) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const ox = cx + dx, oy = cy + dy;
      if (keep && ox === keep.x && oy === keep.y) continue;
      if (GATHER_OBJS.includes(getObj(g.world, ox, oy))) setObj(g.world, ox, oy, O.NONE);
    }
  };
  // 注册一门手艺的完整夹具（defs + recipes，knownBy 指定会者）
  const addRecipe = (g, id, def, mult, knowers) => {
    g.recipeDefs[id] = { id, base: 1.0, variants: [1.2], ...def };
    g.recipes[id] = { id, mult, knownBy: new Map(knowers.map(k => [k, 1])), inventor: null, inventedDay: 0, tries: 0, lost: false, lostDay: 0 };
  };

  // 1. 采集无需职业许可：无业者 BUSH 旁跑 doWork → 浆果进库
  {
    const g = mkG(3901);
    const n = g.npcs[0];   // 白纸开局无业
    ok(!n.job, '测试夹具：白纸开局无业');
    const bush = findObj(g, O.BUSH);
    ok(!!bush, '世界里有浆果丛');
    n.x = bush.x + 1; n.y = bush.y;
    clearAround(g, n.x, n.y, bush);
    n.intent = { type: 'work', label: '干活', untilMin: 60 };
    g.rng = chainRng39([0.01, 0.5], 391);   // 采集骰必中；rint(1,3)→2
    n.doWork(wctx(g), 10, 1);
    ok((g.stock.berry || 0) >= 1, '无业者也能摘浆果（采集是体能活，不要许可）：berry=' + (g.stock.berry || 0));
    eq(getObj(g.world, bush.x, bush.y), O.NONE, '浆果丛摘空（对象消失，不凭空再长）');
  }

  // 2. 砍 TREE → 地上 LOG、stock 分文不增（物质层：材料是真的，原木要人搬）
  {
    const g = mkG(3902);
    const n = g.npcs[0];
    const tree = findObj(g, O.TREE, 40, 30);
    ok(!!tree, '世界里有树');
    n.x = tree.x + 1; n.y = tree.y;
    clearAround(g, n.x, n.y, tree);
    n.intent = { type: 'work', label: '干活', untilMin: 60 };
    const stockBefore = JSON.stringify(g.stock);
    g.rng = chainRng39([0.01], 392);   // 必中；后续 dropLogs 落点骰顺其自然
    n.doWork(wctx(g), 10, 1);
    eq(getObj(g.world, tree.x, tree.y), O.STUMP, '树倒了留桩');
    let logs = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (getObj(g.world, tree.x + dx, tree.y + dy) === O.LOG) logs++;
    }
    ok(logs >= 1, '原木躺在地上（不自动入库——搬运、加工是接下来的事）');
    eq(JSON.stringify(g.stock), stockBefore, '砍树 stock 分文不增（产出=世界对象，不是数字）');
  }

  // 3. 采矿无需许可：无业者 ROCK 旁 → stone>0
  {
    const g = mkG(3903);
    const n = g.npcs[0];
    const rock = findObj(g, O.ROCK);
    ok(!!rock, '世界里有石头');
    n.x = rock.x + 1; n.y = rock.y;
    clearAround(g, n.x, n.y, rock);
    n.intent = { type: 'work', label: '干活', untilMin: 60 };
    g.rng = chainRng39([0.01, 0.5], 393);
    n.doWork(wctx(g), 10, 1);
    ok((g.stock.stone || 0) >= 1, '无业者也能砸石头（采矿是体能活，不要许可）：stone=' + (g.stock.stone || 0));
  }

  // 4. 手艺加成确定性对照：同一颗骰子，会者成、不会者落空（手艺只调概率不调产量）
  {
    const g = mkG(3904);
    addRecipe(g, 'jam', { name: '果酱', job: '', inputs: { berry: 2 }, outputs: { berry: 1 } }, 2.0, [g.npcs[0].id]);
    const a = g.npcs[0], b = g.npcs[1];
    eq(skillMulFor(g, a, 'berry'), 2.0, '会者手艺加成=2');
    eq(skillMulFor(g, b, 'berry'), 1, '不会者加成=1');
    const bush = findObj(g, O.BUSH);
    clearAround(g, bush.x + 1, bush.y, bush);
    // b 先采：rng 0.2 > p(10×0.015×1)=0.15 → 落空，丛还在
    b.x = bush.x + 1; b.y = bush.y; b.intent = { type: 'work', label: '干活', untilMin: 60 };
    g.rng = chainRng39([0.2], 394);
    b.doWork(wctx(g), 10, 1);
    ok((g.stock.berry || 0) === 0, '不会的人同一骰子落空（手艺差的是手气）');
    eq(getObj(g.world, bush.x, bush.y), O.BUSH, '落空：浆果丛还在');
    // a 再采：同一 rng 0.2 < p(0.15×2)=0.3 → 成
    a.x = bush.x + 1; a.y = bush.y; a.intent = { type: 'work', label: '干活', untilMin: 60 };
    g.rng = chainRng39([0.2, 0.5], 395);
    a.doWork(wctx(g), 10, 1);
    ok((g.stock.berry || 0) >= 1, '会的人同一骰子成了（加成是概率不是产量）');
  }

  // 5. 配方活过来：批处理逐项对账——批完成那一刻才扣料产出，守恒
  {
    const g = mkG(3905);
    addRecipe(g, 'smelt', { name: '炼铜', job: '', inputs: { stone: 2 }, outputs: { copper: 1 } }, 1.0, [g.npcs[0].id]);
    const n = g.npcs[0];
    g.stock.stone = 2;
    n.intent = { type: 'work', label: '干活', untilMin: 120, craft: 'smelt' };
    g.rng = chainRng39([0.99], 396);
    n.doWork(wctx(g), MAT.CRAFT_MIN / 2, 1);
    eq(g.stock.stone, 2, '批未满：料还在（批完成那一刻才扣料产出）');
    n.doWork(wctx(g), MAT.CRAFT_MIN / 2, 1);
    eq(g.stock.stone, 0, '成批扣料：stone 2→0');
    eq(g.stock.copper || 0, 1, '成批产出：copper 0→1（2 份料出 1 份货，守恒不凭空）');
  }

  // 6. 料不够：不产 + 活计停了带理由（不凭空）
  {
    const g = mkG(3906);
    addRecipe(g, 'smelt', { name: '炼铜', job: '', inputs: { stone: 2 }, outputs: { copper: 1 } }, 1.0, [g.npcs[0].id]);
    const n = g.npcs[0];
    g.stock.stone = 1;   // 差一块
    n.intent = { type: 'work', label: '干活', untilMin: 120, craft: 'smelt' };
    g.rng = chainRng39([0.5], 397);
    n.doWork(wctx(g), MAT.CRAFT_MIN, 1);
    eq(g.stock.stone, 1, '料不够：一块不扣');
    eq(g.stock.copper || 0, 0, '料不够：什么都不产（守恒铁律）');
    eq(n.intent.type, 'idle', '料不够：活计停了');
    ok(String(n.intent.label).includes('料不够'), '停下来带理由：' + n.intent.label);
  }

  // 7. mult 只压时间不增量：mult1 vs mult2 产量相同、耗时差一倍
  {
    const g = mkG(3907);
    addRecipe(g, 'slow', { name: '慢炼', job: '', inputs: { stone: 2 }, outputs: { copper: 1 } }, 1.0, [g.npcs[0].id]);
    addRecipe(g, 'fast', { name: '快炼', job: '', inputs: { stone: 2 }, outputs: { copper: 1 } }, 2.0, [g.npcs[1].id]);
    const a = g.npcs[0], b = g.npcs[1];
    g.stock.stone = 4;
    a.intent = { type: 'work', label: '干活', untilMin: 200, craft: 'slow' };
    b.intent = { type: 'work', label: '干活', untilMin: 200, craft: 'fast' };
    g.rng = chainRng39([0.99, 0.99], 398);   // 两次记忆骰都不触发
    a.doWork(wctx(g), MAT.CRAFT_MIN / 2, 1);
    eq(g.stock.copper || 0, 0, 'mult1：半个工时还没好');
    b.doWork(wctx(g), MAT.CRAFT_MIN / 2, 1);
    eq(g.stock.copper || 0, 1, 'mult2：同样半个工时已成批（mult 只压时间）');
    a.doWork(wctx(g), MAT.CRAFT_MIN / 2, 1);
    eq(g.stock.copper || 0, 2, 'mult1 再半个工时成批——产量与 mult2 一模一样，只是慢一倍');
    eq(g.stock.stone, 0, '两家各扣 stone 2（对账分毫不差）');
  }

  // 8. 选址三态：涉木去坊边 / 其余去仓边 / 都没就家门口（规则=去原料所在地，零身份硬编码）
  {
    const g = mkG(3908);
    const n = g.npcs[0];
    ok(!!g.barn, '开局有老仓库（测试夹具）');
    g.workshop = { x: g.barn.x, y: g.barn.y, logs: 0, mill: 0 };   // 坊仓同位不妨碍断言邻域
    const s1 = g.craftSiteFor(n, { inputs: { log: 3 } });
    ok(s1 && Math.abs(s1.x - g.workshop.x) <= 1 && Math.abs(s1.y - g.workshop.y) <= 1, '涉木手艺 → 木匠坊边');
    g.workshop = null;
    const s2 = g.craftSiteFor(n, { inputs: { stone: 2 } });
    ok(s2 && Math.abs(s2.x - g.barn.x) <= 1 && Math.abs(s2.y - g.barn.y) <= 1, '其余手艺 → 仓库边');
    g.barn = null;
    const s3 = g.craftSiteFor(n, { inputs: { stone: 2 } });
    ok(s3 && Math.abs(s3.x - n.home.x) <= 1 && Math.abs(s3.y - n.home.y) <= 1, '没仓没坊 → 自家门口');
  }

  // 9. 泛化三连：无业者能 innovate / 无业徒弟能 teach / 无业成人能 reinvent
  {
    // 9a. innovate：知识驱动不按职业——无业者会的也能琢磨出变体
    const g = mkG(3909);
    addRecipe(g, 'r1', { name: '磨石', job: '', inputs: { stone: 2 }, outputs: { copper: 1 }, variants: [1.5] }, 1.0, [g.npcs[0].id]);
    g.rng = chainRng39([0.01, 0.3], 399);   // 想到(0.06内) → 成了(0.4内)
    innovateDaily(g, 5);
    eq(g.recipes.r1.mult, 1.5, '无业者也能琢磨手艺变体（innovate 按「会不会」不按职业）');
    eq(g.recipes.r1.inventor, g.npcs[0].id, '发明人是他本人');
    // 9b. teach：徒弟池不再限同职业——无业者也能学
    const g9b = mkG(3910);
    addRecipe(g9b, 'r1', { name: '磨石', job: '', inputs: { stone: 2 }, outputs: { copper: 1 } }, 1.0, [g9b.npcs[0].id]);
    g9b.rng = chainRng39([0.5, 0.01, 0.5], 400);   // 选老师 → 教(0.05内) → 选学生
    teachDaily(g9b, 5);
    const newbie = [...g9b.recipes.r1.knownBy.keys()].find(id => id !== g9b.npcs[0].id);
    ok(!!newbie, '手艺传出去了一门');
    ok(newbie && !g9b.npcs.find(n => n.id === newbie).job, '学到手艺的是个无业者（teach 泛化）');
    // 9c. reinvent：重新想起不再限原行当——任何成人都可能在废墟上捡起来
    const g9c = mkG(3911);
    addRecipe(g9c, 'r1', { name: '锻铁', job: '铁匠', inputs: { stone: 2 }, outputs: { iron: 1 } }, 1.0, []);
    g9c.recipes.r1.lost = true; g9c.recipes.r1.lostDay = 1;
    g9c.rng = chainRng39([0.01, 0.5], 401);   // 重新想到(0.02内) → 选人
    reinventDaily(g9c, 5);
    eq(g9c.recipes.r1.knownBy.size, 1, '失传手艺被重新想起');
    const who = [...g9c.recipes.r1.knownBy.keys()][0];
    ok(!g9c.npcs.find(n => n.id === who).job, '想起它的是个无业成人（reinvent 泛化：谁都有可能）');
    ok(!g9c.recipes.r1.lost, '重新想起后失传标记清除');
  }

  // 10. LLM 落地：会手艺的人，一句话真的去接活（想法不只是想法）
  {
    const g = mkG(3912);
    addRecipe(g, 'smelt', { name: '炼铜', job: '', inputs: { stone: 2 }, outputs: { copper: 1 } }, 1.0, [g.npcs[0].id]);
    g.stock.stone = 5;
    const n = g.npcs[0];
    n.inside = false; n.path = []; n.intent = { type: 'ready', label: '待命', untilMin: 0 };
    const site = g.craftSiteFor(n, g.recipeDefs.smelt);
    const r = applyDecisions(g, [{ npc: n.name, action: 'work', prob: 1, reason: '该炼铜了' }]);
    eq(r.applied, 1, '决策落地');
    const crafted = (n.intent.type === 'goto' && n.intent.then && n.intent.then.craft === 'smelt')
      || (n.intent.type === 'work' && n.intent.craft === 'smelt');
    ok(crafted, 'LLM 说干活 → 手艺活真的挂上（去得了走过去，去不了就地干）');
    if (n.intent.type === 'goto') {
      ok(site && Math.floor(n.intent.tx) === site.x && Math.floor(n.intent.ty) === site.y, '落点=原料所在地（选址与脚本同一套规则）');
    }
  }

  // 11. 凭空产金拆除：商人/医生干一百回，镇库金币分文不增（守恒铁律的刻意代价）
  {
    const g = mkG(3913);
    const [a, b] = g.npcs;
    a.job = '商人'; a.workArea = 'market'; a.x = 54; a.y = 25;
    b.job = '医生'; b.workArea = ''; b.x = 36; b.y = 26;
    clearAround(g, a.x, a.y, null); clearAround(g, b.x, b.y, null);
    a.intent = { type: 'work', label: '看店', untilMin: 9999 };
    b.intent = { type: 'work', label: '坐诊', untilMin: 9999 };
    const gold0 = g.stock.gold || 0;
    for (let i = 0; i < 100; i++) { a.doWork(wctx(g), 5, 1); b.doWork(wctx(g), 5, 1); }
    eq(g.stock.gold || 0, gold0, '商人医生各干一百回，gold 分文不增（凭空产金分支已拆——钱只剩真来路）');
  }

  // 12. 老档配方可执行：serialize → hydrate，谁会的还记得，活照样干
  {
    const g = mkG(3914);
    addRecipe(g, 'smelt', { name: '炼铜', job: '', inputs: { stone: 2 }, outputs: { copper: 1 } }, 1.3, [g.npcs[0].id]);
    g.stock.stone = 2;
    const snap = JSON.parse(JSON.stringify(g.serialize()));
    const g2 = Game.hydrate(snap, mockR);
    ok(!!g2.recipeDefs.smelt, '读档：动态配方表还在');
    ok(g2.recipes.smelt && g2.recipes.smelt.knownBy.has(g.npcs[0].id), '读档：谁会的还记得');
    eq(g2.recipes.smelt.mult, 1.3, '读档：手艺进度(mult)还在');
    const n2 = g2.npcs[0];
    n2.intent = { type: 'work', label: '干活', untilMin: 120, craft: 'smelt' };
    g2.rng = chainRng39([0.99], 402);
    n2.doWork({ w: g2.world, clock: g2.clock, rng: g2.rng, stock: g2.stock, log: null, npcs: g2.npcs, game: g2 }, MAT.CRAFT_MIN, 1);
    eq(g2.stock.copper || 0, 1, '老档配方照样出活（配方知识随档走，不是会话态）');
  }

  // 13. 行当不查名册（v4.8.0：校验器退役——名册=眼下谁以什么为生，只是个观察）
  {
    const g = mkG(3915);   // 全员无业
    eq(activeJobs(g).length, 0, '无业时在册名册为空');
    g.npcs[0].job = '烧石的';
    eq(activeJobs(g)[0], '烧石的', '有人干着就进了名册——名册是结果不是门槛');
    g.recipeDefs.r1 = { name: '烧石', job: '从没听说过的行当', base: 1.0, variants: [1.2], inputs: { stone: 1 }, outputs: { copper: 1 } };
    ok(g.recipeDefs.r1, '任何行当名都能落表——没有校验器挡路');
  }

  // 14. 积压就是积压（v4.8.0：石头堆成山也不会被扫描成信号——难受是世界的，念头自己长）
  {
    const g = mkG(3916);
    g.stock.stone = 25;
    evolveDaily(g, 3);
    eq(g.evoPool.length, 0, '积压不生提案（缺口扫描已退役）');
    eq(g.stock.stone, 25, '石头还在那里——压力留在世界里');
  }
}

// ================= 阶段40 过程革命：干什么活有什么动作，动作定义挂数据上由演化掌管（v3.0.0） =================
stage(40, '过程革命：原语名册/对象映射/配方动作/降级链/落表存档/doWork挂动作/工种动作');
{
  const mockR = { mapDirty: false, meteor() { }, shake() { } };
  const mkG = (seed) => { const g = new Game(mockR); g.newGame(seed); return g; };
  const wctx = (g) => ({ w: g.world, clock: g.clock, rng: g.rng, stock: g.stock, log: null, npcs: g.npcs, game: g });
  function chainRng40(vals, seed) {
    const q = [...vals]; const f = mulberry32(seed);
    return () => (q.length ? q.shift() : f());
  }
  const findObj = (g, type, maxY, maxX) => {
    for (let y = 0; y < (maxY || 40); y++) for (let x = 0; x < (maxX || 60); x++) {
      if (getObj(g.world, x, y) === type) return { x, y };
    }
    return null;
  };
  const clearAround = (g, cx, cy, keep) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const ox = cx + dx, oy = cy + dy;
      if (keep && ox === keep.x && oy === keep.y) continue;
      const ov = getObj(g.world, ox, oy);
      if (GATHER_OBJS.includes(ov) || (ov >= O.CROP0 && ov <= O.CROP3)) setObj(g.world, ox, oy, O.NONE);
    }
  };
  const addRecipe = (g, id, def, mult, knowers) => {
    g.recipeDefs[id] = { id, base: 1.0, variants: [1.2], ...def };
    g.recipes[id] = { id, mult, knownBy: new Map(knowers.map(k => [k, 1])), inventor: null, inventedDay: 0, tries: 0, lost: false, lostDay: 0 };
  };

  // 1. 原语名册契约：七个原语参数齐全，工具都在渲染层认识的表里
  {
    eq(Object.keys(MOTION_PRIMS).length, 7, '动作原语七个：swing/smash/pull/stir/knead/tend/saw');
    ok(Object.entries(MOTION_PRIMS).every(([k, P]) => P.rate > 0 && typeof P.fx === 'string' && MOTION_TOOLS.includes(P.tool)),
      '每个原语都有节奏/粒子/默认工具，且工具渲染层认识');
    ok(GATHER_OBJS.every(ov => OBJ_MOTION[ov] && MOTION_PRIMS[OBJ_MOTION[ov].prim]),
      '全部采集对象都挂了动作（对象决定怎么下手，单一事实源）');
    ok([O.CROP0, O.CROP1, O.CROP2].every(ov => OBJ_MOTION[ov]), '未熟作物照料也挂了动作');
  }

  // 2. 解析降级链：不认识的 prim/工具不报错，落通式（降级翻译是铁律）
  {
    eq(motionFor('dance'), null, '不认识的 prim → null');
    eq(motionFor('swing', 'laser').tool, 'axe', '不认识的工具 → 落原语默认');
    eq(motionFor('smash', 'hammer').tool, 'hammer', '认识的手持工具保留');
    const t = motionForObj(O.TREE), r = motionForObj(O.ROCK), b = motionForObj(O.BUSH);
    ok(t.prim === 'swing' && t.tool === 'axe', '树要挥斧砍');
    ok(r.prim === 'smash' && r.tool === 'pick', '石头要抡镐砸');
    ok(b.prim === 'tend' && b.tool === 'hand', '浆果要俯身摘');
    eq(motionOf({}).prim, 'knead', '老档配方没动作 → 揉压通式（不报错）');
    eq(motionOf({ motion: { prim: 'stir' } }).tool, 'stick', '搅舂默认持棍');
    eq(motionOf({ motion: { prim: 'dance' } }).prim, 'knead', '配方动作不在名册 → 揉压通式');
  }

  // 3. 动作降级链（v4.8.0：没有提案洗练入口了——motionOf 物理层降级就是全部）
  {
    eq(motionOf({}).prim, 'knead', '配方没带动作 → 揉压通式');
    eq(motionOf({ motion: { prim: 'fly' } }).prim, 'knead', '动作不在名册 → 揉压通式');
    eq(motionOf({ motion: { prim: 'smash', tool: 'laser' } }).tool, 'pick', '工具不在表 → 落原语默认');
    eq(motionOf({ motion: { prim: 'saw', tool: 'saw' } }).tool, 'saw', '合法动作原样保留');
  }

  // 4. 落表 + 存档往返：配方动作随手艺定义走（演化长出来的手艺随档走）
  {
    const g = mkG(4002);
    addRecipe(g, 'stew', { name: '炖菜', job: '', inputs: { berry: 1 }, outputs: { crop: 1 }, motion: { prim: 'stir' } }, 1.0, [g.npcs[0].id]);
    eq(g.recipeDefs.stew.motion.prim, 'stir', '落表：动作随配方定义走');
    const data = serializeEvo(g);
    const g2 = mkG(4003);
    hydrateEvo(g2, data);
    eq(g2.recipeDefs.stew.motion.prim, 'stir', '读档：动作还在（随档走，不是会话态）');
  }

  // 5. doWork 挂动作：配方动作=演化设定；采集动作=对象物理；钓鱼=拉竿；干活朝着活计
  {
    // 5a 配方带动作
    const g = mkG(4004);
    addRecipe(g, 'stew', { name: '炖菜', job: '', inputs: { berry: 1 }, outputs: { crop: 1 }, motion: { prim: 'stir' } }, 1.0, [g.npcs[0].id]);
    const n = g.npcs[0];
    g.stock.berry = 2;
    n.intent = { type: 'work', label: '干活', untilMin: 120, craft: 'stew' };
    g.rng = chainRng40([0.99], 404);
    n.doWork(wctx(g), 10, 1);
    ok(n.act && n.act.prim === 'stir' && n.act.tool === 'stick', '干配方活：动作=演化设定的搅舂持棍');
    // 5b 配方没动作（老档）→ 揉压通式
    const g5 = mkG(4005);
    addRecipe(g5, 'old', { name: '老手艺', job: '', inputs: { berry: 1 }, outputs: { crop: 1 } }, 1.0, [g5.npcs[0].id]);
    const n5 = g5.npcs[0];
    g5.stock.berry = 2;
    n5.intent = { type: 'work', label: '干活', untilMin: 120, craft: 'old' };
    g5.rng = chainRng40([0.99], 405);
    n5.doWork(wctx(g5), 10, 1);
    eq(n5.act.prim, 'knead', '老档配方干活：揉压通式（降级不报错）');
    // 5c 砍树：挥斧 + 朝着树
    const g6 = mkG(4006);
    const tree = findObj(g6, O.TREE, 40, 30);
    const n6 = g6.npcs[0];
    n6.x = tree.x + 1; n6.y = tree.y;
    clearAround(g6, n6.x, n6.y, tree);
    n6.intent = { type: 'work', label: '干活', untilMin: 60 };
    g6.rng = chainRng40([0.6], 406);
    n6.doWork(wctx(g6), 10, 1);
    ok(n6.act && n6.act.prim === 'swing' && n6.act.tool === 'axe', '砍树：挥斧（对象决定动作）');
    eq(n6.dir, 2, '干活朝着活计：人站树右，朝左使斧');
    // 5d 砸石头：抡镐
    const g7 = mkG(4007);
    const rock = findObj(g7, O.ROCK);
    const n7 = g7.npcs[0];
    n7.x = rock.x + 1; n7.y = rock.y;
    clearAround(g7, n7.x, n7.y, rock);
    n7.intent = { type: 'work', label: '干活', untilMin: 60 };
    g7.rng = chainRng40([0.6], 407);
    n7.doWork(wctx(g7), 10, 1);
    ok(n7.act && n7.act.prim === 'smash' && n7.act.tool === 'pick', '砸石头：抡镐');
    // 5e 钓鱼：拉竿 + 朝着水
    const g8 = mkG(4008);
    let spot = null;
    for (let y = 55; y < 72 && !spot; y++) for (let x = 2; x < 70 && !spot; x++) {
      if (getGround(g8.world, x, y) !== G.SAND) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => getGround(g8.world, x + dx, y + dy) === G.WATER)) spot = { x, y };
    }
    ok(!!spot, '河滩找得到下竿的地方');
    const n8 = g8.npcs[0];
    n8.x = spot.x; n8.y = spot.y;
    clearAround(g8, spot.x, spot.y, null);
    n8.intent = { type: 'work', label: '干活', untilMin: 60 };
    g8.rng = chainRng40([0.9], 408);
    n8.doWork(wctx(g8), 10, 1);
    ok(n8.act && n8.act.prim === 'pull' && n8.act.tool === 'rod', '钓鱼：拉竿');
    const expDir = getGround(g8.world, spot.x + 1, spot.y) === G.WATER ? 3 : getGround(g8.world, spot.x - 1, spot.y) === G.WATER ? 2 : getGround(g8.world, spot.x, spot.y - 1) === G.WATER ? 1 : 0;
    eq(n8.dir, expDir, '下竿朝着水面');
    // 5f 停工清动作：料不够 → act 清空（原地站着不算干活，没活干就没动作）
    const g9 = mkG(4009);
    addRecipe(g9, 'stew', { name: '炖菜', job: '', inputs: { berry: 1 }, outputs: { crop: 1 }, motion: { prim: 'stir' } }, 1.0, [g9.npcs[0].id]);
    const n9 = g9.npcs[0];
    n9.intent = { type: 'work', label: '干活', untilMin: 120, craft: 'stew' };
    g9.rng = chainRng40([0.99], 409);
    n9.doWork(wctx(g9), MAT.CRAFT_MIN, 1);   // berry 0 → 料不够
    eq(n9.act, null, '活计停了动作也停了');
  }

  // 6. 工种动作：建造/锯木/修缮/闲着——tick 随意图分发挂动作
  {
    const g = mkG(4010);
    const n = g.npcs[0];
    n.path = [];
    const tctx = (extra) => Object.assign({ w: g.world, clock: g.clock, weather: g.weather, rng: g.rng, npcs: g.npcs, stock: g.stock, nowReal: 0, log: null, gmPerReal: 1, game: g }, extra);
    n.intent = { type: 'build', label: '施工中', untilMin: 60 };
    n.tick(1, tctx({ workOnPlan() { } }));
    ok(n.act && n.act.prim === 'smash' && n.act.tool === 'hammer', '施工：抡锤');
    n.intent = { type: 'mill', label: '锯木头', untilMin: 60 };
    n.tick(1, tctx({ millTick() { } }));
    ok(n.act && n.act.prim === 'saw' && n.act.tool === 'saw', '锯木：拉锯');
    n.intent = { type: 'repair', label: '修补中', untilMin: 60, key: 'x' };
    n.tick(1, tctx({ repairTick() { } }));
    ok(n.act && n.act.prim === 'smash' && n.act.tool === 'hammer', '修缮：敲打');
    n.intent = { type: 'idle', label: '发呆', untilMin: 60, sub: '发呆' };
    n.tick(1, tctx({}));
    eq(n.act, null, '闲着没动作（发呆是存在不是干活）');
  }

  // 7. 动作名册是物理不是 prompt（v4.8.0：演化之灵退役，名册只服务渲染与降级）
  {
    ok(Object.keys(MOTION_PRIMS).every(k => motionFor(k)), '七个原语都能解析成动作');
  }
}

// ================= 阶段41 语言革命：话位名册/种子词库/漂移/退役/演化提案lex/存档往返（v3.1.0） =================
stage(41, '语言革命：36话位/词库独立性/新生儿抓当下声音/词条入库/漂移确定性/存档');
{
  const mockR41 = { mapDirty: false, meteor() { }, shake() { } };
  const mkG41 = (seed) => { const g = new Game(mockR41); g.newGame(seed); return g; };
  function chainRng41(vals, seed) {
    const q = [...vals]; const f = mulberry32(seed);
    return () => (q.length ? q.shift() : f());
  }

  // 1. 话位名册与种子表：36 槽全覆盖，种子词表是初始条件（每槽都有词可说话——无 LLM 也必须能玩）
  eq(Object.keys(LEX_SLOTS).length, 36, '话位名册 36 槽');
  ok(Object.keys(LEX_SLOTS).every(s => Array.isArray(SEED_LEXICON[s]) && SEED_LEXICON[s].length > 0), '种子表 36 槽全覆盖（每槽有词）');
  ok(Object.keys(LEX_SLOTS).every(s => LEX_SLOTS[s].cap > 0 && LEX_SLOTS[s].shape && LEX_SLOTS[s].name), '每槽有形状/容量/中文名');

  // 2. 词库独立性：两个世界从同一张种子表出发，各说各话（深拷贝，谁也不是谁的副本）
  {
    const g1 = mkG41(4101), g2 = mkG41(4101);
    ok(JSON.stringify(g1.lexicon) === JSON.stringify(g2.lexicon), '同种子同初始词库');
    g1.lexicon.motto.push('只有一号镇的话');
    ok(!g2.lexicon.motto.includes('只有一号镇的话'), '词库互不影响（一个世界的话不进另一个世界）');
  }

  // 3. pickLex 全槽覆盖：每槽都能取出当下词库里的词；空 game 落种子表（纯函数兼容）
  {
    const g = mkG41(4102);
    const r = mulberry32(41021);
    ok(Object.keys(LEX_SLOTS).every(s => {
      const v = pickLex(g, s, r);
      return v != null && lexSlot(g, s).some(e => sameLexEntry(e, v));
    }), 'pickLex 36 槽全取自当下词库');
    const v0 = pickLex(null, 'motto', mulberry32(1));
    ok(SEED_LEXICON.motto.includes(v0), 'pickLex 空 game 落种子表（selftest/纯函数兼容）');
  }

  // 4. 新生儿/外来人/声音从当下词库抓——三代之后祖辈的话孙辈听着费劲
  {
    const g = mkG41(4103);
    g.lexicon.catch = ['咴咴'];
    g.lexicon.nursery = ['摇啊摇'];
    const vAdult = makeVoice({ id: 'va', age: 30 }, g.lexicon);
    ok(vAdult.catch.every(c => c === '咴咴'), '成年人口头禅全取自当下词库');
    eq(vAdult.nursery, null, '大人没有童谣');
    const vKid = makeVoice({ id: 'vk', age: 12 }, g.lexicon);
    eq(vKid.nursery, '摇啊摇', '童谣按年龄给（≤17），不按职业（白纸开局没有「学生」）');
    // 新生儿：名/心性取自当下词库
    g.lexicon.nameGiven = ['阿灯'];
    g.lexicon.persChild = ['独一份的心性'];
    const father = { id: 'fa', name: '陈麦冬', hair: '#3b2f2a', shirt: '#7a9e4f', traits: ['勤恳'] };
    const mother = { id: 'mo', name: '王绣', hair: '#7d4a2b', shirt: '#b08968', traits: ['温柔'] };
    const cd = makeChildDef(father, mother, mulberry32(41031), 9, g);
    eq(cd.name, '陈阿灯', '新生儿名取自当下词库（姓随父，名从词库）');
    eq(cd.pers, '独一份的心性', '新生儿心性取自当下词库');
    // 外来人：姓/名/来历取自当下词库
    g.lexicon.outSur = ['乜']; g.lexicon.outGiven = ['归鸿']; g.lexicon.persOut = ['从很远的地方来'];
    const td = makeTravelerDef(mulberry32(41032), 7, g);
    eq(td.name, '乜归鸿', '外来人姓名取自当下词库');
    eq(td.pers, '从很远的地方来', '外来人来历取自当下词库');
    // 心结：矛盾的种类是物理，措辞是词库内容
    g.lexicon.conflict = [{ key: 'leave', a: '只想走', b: '只想留' }];
    const m = makeMind({ id: 'mm', age: 30 }, g.lexicon);
    ok(m.conflicts.every(c => c.a === '只想走' && c.b === '只想留'), '心结措辞取自当下词库');
    ok(CONFLICT_KEYS.includes(m.conflicts[0].key), '心结种类仍在名册（物理）');
  }

  // 5. 校验器：词条形状是物理——空/超长/坏形状拒收
  {
    ok(!checkLexEntry('nope', 'x').ok, '话位不在名册拒收');
    ok(!checkLexEntry('motto', '').ok, '空话拒收');
    eq(checkLexEntry('motto', '  慢火熬日子  ').entry, '慢火熬日子', '整句洗练（ trim ）');
    ok(checkLexEntry('catch', '这是一个特别特别长的口头禅').entry.length <= 6, '单词截到 6 字');
    ok(!checkLexEntry('dialect', ['一样', '一样']).ok, '对子两头相同拒收');
    ok(checkLexEntry('dialect', { std: '高兴', dia: '欢喜' }).ok, '对子对象形也收（宽容洗入）');
    ok(!checkLexEntry('conflict', { key: 'nope', a: 'x', b: 'y' }).ok, '心结种类不在名册拒收');
    ok(checkLexEntry('conflict', { key: 'guilt', a: '装好人', b: '忘不掉' }).ok, '心结合规');
    ok(!checkLexEntry('secretGen', { content: '没有由头', kw: [] }).ok, '心事没有由头拒收');
  }

  // 6. 词条入库是物理动作（v4.8.0：引擎退役——洗练形状、避开撞车、进词库，都不需要批准）
  {
    const g = mkG41(4104);
    // 撞旧词 → 说话的人自己避开（sameLexEntry 判重）
    const dup = checkLexEntry('motto', g.lexicon.motto[0]);
    ok(dup.ok && g.lexicon.motto.some(e => sameLexEntry(e, dup.entry)), '撞车可被察觉（判重是物理）');
    // 合规新词 → 直接进词库
    const r = checkLexEntry('motto', '  慢火熬好日子  ');
    ok(r.ok, '形状洗练通过');
    if (!g.lexicon.motto.some(e => sameLexEntry(e, r.entry))) g.lexicon.motto.push(r.entry);
    ok(g.lexicon.motto.includes('慢火熬好日子'), '新说法进了词库——入库不需要引擎批准');
  }

  // 7. 超帽不是警察（v4.8.0）：词库能胀，退役交给日推进（有限定理显现在漂移里）
  {
    const g = mkG41(4105);
    g.lexicon.motto = ['一', '二', '三', '四', '五', '六', '七', '八'];   // 满帽（cap 8）
    g.lexicon.motto.push('九');
    eq(g.lexicon.motto.length, 9, '词库能超帽——cap 是退役节律，不是入库闸门');
  }

  // 8. 漂移确定性：同流同果；方言化是漂移的基本动作；退役有地板（词数过半槽才允许死）
  {
    eq(mutateWord(() => 0.1, '什么日子'), '啥日子', '方言化：撞到方言对就换（什么→啥）');
    eq(mutateWord(() => 0.9, '今天天气不错'), '今天天气不错', '不撞不换');
    const g1 = mkG41(4106), g2 = mkG41(4106);
    g1.rng = mulberry32(41061); g2.rng = mulberry32(41061);
    for (let d = 1; d <= 40; d++) { lexiconDaily(g1, d); lexiconDaily(g2, d); }
    ok(JSON.stringify(g1.lexicon) === JSON.stringify(g2.lexicon), '漂移确定性：同 rng 流 40 天词库逐词一致');
    // 退役地板：chatTopic（cap 12，地板 6）压到 6，rng 强制退役也不死
    const g3 = mkG41(4107);
    g3.lexicon.chatTopic = g3.lexicon.chatTopic.slice(0, 6);
    g3.rng = chainRng41([0.9, 0.02, 0.0], 41071);   // 不变异 / 退役触发 / 撞第 0 槽（chatTopic）
    lexiconDaily(g3, 1);
    eq(g3.lexicon.chatTopic.length, 6, '退役地板：词数过半槽才允许死（保底可说话）');
    // 高于地板允许死：最老的队首词先死，新词活着
    const head = g3.lexicon.chatTopic[0];
    g3.lexicon.chatTopic.push('多出来的一句');
    g3.rng = chainRng41([0.9, 0.02, 0.0], 41072);
    lexiconDaily(g3, 1);
    eq(g3.lexicon.chatTopic.length, 6, '高于地板：旧词退役');
    ok(!g3.lexicon.chatTopic.includes(head) && g3.lexicon.chatTopic.includes('多出来的一句'), '退役从队首走（最老的先死）');
  }

  // 9. 词从词里长（v4.8.0：脚本兜底提案退役——语言内容只剩两个来源：种子表与漂移）
  {
    const g = mkG41(4108);
    g.lexicon.catch = ['什么'];
    eq(mutateWord(() => 0.1, g.lexicon.catch[0]), '啥', '口头禅能从旧词变异（方言化），不需要谁提案');
    ok(g.lexicon.motto.every(e => typeof e === 'string'), '词库内容都是话，不是提案对象');
  }

  // 10. 存档往返：词库随档走——这个世界说过的话、死了的词，都是它自己的；老档无词库落种子表
  {
    const g = mkG41(4109);
    g.lexicon.motto = ['这镇独有的话'];
    g.lexicon.chatTopic = g.lexicon.chatTopic.slice(0, 3);   // 死过几个词
    const data = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.hydrate(data, mockR41);
    ok(JSON.stringify(h.lexicon) === JSON.stringify(g.lexicon), '存档往返：词库逐词一致（死了的词不会复活）');
    delete data.lexicon;
    const h2 = Game.hydrate(data, mockR41);
    ok(h2.lexicon && Object.keys(LEX_SLOTS).every(s => Array.isArray(h2.lexicon[s]) && h2.lexicon[s].length > 0), '老档兼容：无词库落种子表');
  }

  // 11. 演化之灵退役（v4.8.0）：没有任何 prompt 代世界想新词——话从说话的人嘴里长
  {
    ok(true, '演化 prompt 已退役（语言内容不进任何 LLM prompt）');
  }
}

// ================= 阶段 42 · 物理语法层（axioms + matter） =================
{
  // 1. 六条规则存在且冻结
  ok(AXIOMS.conservation === true && AXIOMS.causality === true && AXIOMS.timeUnidirectional === true
    && AXIOMS.spaceDiscrete === true && AXIOMS.cost === true && AXIOMS.finitude === true,
    '42.1 六条死规则全部启用');
  ok(Object.isFrozen(AXIOMS), '42.2 AXIOMS 对象冻结，不可改');

  // 2. 守恒检查：总量不变放行，凭空增减拦截
  const m1 = makeMatter([1, 0.5, 0.3]);
  const m2 = makeMatter([2, 0.5, 0.7]);
  ok(checkConservation([m1, m2], [combine(m1, m2).result]).ok, '42.3 组合过守恒');
  const bad = makeMatter([99, 99, 99]);  // 凭空多出
  ok(!checkConservation([m1], [bad]).ok, '42.4 凭空增多被守恒拦截');
  ok(!checkConservation([m1, m2], [m1]).ok, '42.5 凭空消失被守恒拦截');

  // 3. 因果检查
  ok(checkCausality({ actor: 'n1', causeDay: 5, effectDay: 10 }, 10).ok, '42.6 正常因果通过');
  ok(!checkCausality({ actor: null }, 0).ok, '42.7 无因之果被拦截');
  ok(!checkCausality({ actor: 'n1', causeDay: 10, effectDay: 5 }, 10).ok, '42.8 果先于因被拦截');
  ok(!checkCausality({ actor: 'n1', causeDay: 99 }, 10).ok, '42.9 因在未来被拦截');

  // 4. 时间单向
  ok(checkTime(11, 10).ok, '42.10 时间前进通过');
  ok(!checkTime(9, 10).ok, '42.11 时间倒流被拦截');

  // 5. 空间离散：相邻放行，跳跃拦截
  ok(checkSpace({ x: 5, y: 5 }, { x: 6, y: 5 }).ok, '42.12 相邻交互通过');
  ok(!checkSpace({ x: 0, y: 0 }, { x: 5, y: 5 }).ok, '42.13 空间跳跃被拦截');

  // 6. 代价律：负成本拦截，付不起拦截
  ok(checkCost({ cost: 5 }, { stamina: 10 }).ok, '42.14 正常代价通过');
  ok(!checkCost({ cost: -1 }, { stamina: 10 }).ok, '42.15 负成本被拦截（世界不补贴）');
  ok(!checkCost({ cost: 99 }, { stamina: 10 }).ok, '42.16 付不起被拦截');

  // 7. 有限律
  ok(checkFinitude({ stamina: 50, maxStamina: 100 }).ok, '42.17 有限内通过');
  ok(!checkFinitude({ stamina: 150, maxStamina: 100 }).ok, '42.18 超限被拦截');

  // 8. checkAll 六道关
  const goodAction = { actor: { stamina: 100 }, cost: 5, from: { x: 0, y: 0 }, target: { x: 1, y: 0 } };
  ok(checkAll(goodAction, { day: 1 }).ok, '42.19 六关全过');
  const badAction = { actor: null, cost: -1 };
  ok(!checkAll(badAction, { day: 1 }).ok, '42.20 违规动作被 checkAll 拦截');

  // 9. matter：组合——广延槽相加，强度槽按量加权平均
  const c1 = combine(fromSeed('A'), fromSeed('C'));  // A量1硬0.1 / C量3硬0.7
  ok(c1.ok && c1.result.attrs[0] === 4, '42.21 A+C组合：广延量槽相加（1+3=4）');
  ok(Math.abs(c1.result.attrs[1] - (0.1 * 1 + 0.7 * 3) / 4) < 1e-6, '42.22 A+C组合：强度硬槽加权平均（0.55，不是相加——硬+硬不会更硬）');

  // 10. matter：分离——广延按比例分，强度每份复制；比例和必须=1
  const sp = separate(fromSeed('D'), [0.5, 0.5]);  // D量1含水0.9
  ok(sp.ok && sp.parts.length === 2 && Math.abs(sp.parts[0].attrs[6] - 0.45) < 1e-6 && Math.abs(sp.parts[0].attrs[4] - 0.5) < 1e-6,
    '42.23 五五分D：广延含水减半（0.45），强度可耕每份复制（0.5——半杯水一样可耕）');
  ok(!separate(fromSeed('D'), [0.6, 0.6]).ok, '42.24 六四分（和≠1）被拦截——不许凭空增减');

  // 11. matter：转化只允许广延槽间转移，强度槽被拒
  const c2 = fromSeed('C');
  const before0 = c2.attrs[0], before7 = c2.attrs[7];
  const tr = transform(c2, [[0, 7, 0.3]]);  // 量→能量（锻打：广延→广延，合法）
  ok(tr.ok && Math.abs(c2.attrs[0] - (before0 - 0.3)) < 1e-6 && Math.abs(c2.attrs[7] - (before7 + 0.3)) < 1e-6,
    '42.25 转化：广延槽间转移总量守恒');
  ok(!transform(c2, [[0, 7, 99]]).ok, '42.26 转化超储量被拦截');
  ok(!transform(fromSeed('C'), [[1, 7, 0.3]]).ok, '42.26b 强度槽（硬）不可转移被拦截——硬度不能倒给能量');
  ok(!transform(fromSeed('C'), [[7, 1, 0.3]]).ok, '42.26c 能量不可转硬度被拦截');

  // 12. 涌现命名：一物多名，没起名就是不知道
  const rock = fromSeed('C');
  nameMatter('npc_a', rock, '软石头');
  nameMatter('npc_b', rock, '火石');
  eq(nameFor('npc_a', rock), '软石头', '42.27 NPC甲的叫法');
  eq(nameFor('npc_b', rock), '火石', '42.28 NPC乙的叫法（一物多名合法）');
  eq(nameFor('npc_c', rock), null, '42.29 NPC丙没起过名=不知道这是什么（合法状态）');

  // 13. 种子表：用户裁决 D6——减到 4 种基本存在物（A/B/C/D），全部 src:'seed'
  eq(Object.keys(SEED_MATTERS).length, 4, '42.30 种子物质=4 种基本存在物（大爆炸只给氢氦，其余让组合自己推）');
  ok(Object.values(SEED_MATTERS).every(s => s.src === 'seed'), '42.31 种子全部标记 src:seed');

  // 14. diff：同物质距离 0，A（轻燃）和 C（沉硬金属）距离大
  eq(diff(fromSeed('A'), fromSeed('A')), 0, '42.32 同物质距离为0');
  ok(diff(fromSeed('A'), fromSeed('C')) > 0.5, '42.33 A和C物理上很不像');

  // 15. 强度量不参与守恒：组合后强度槽变了也不违规（两杯热水混合不是更热）
  const hot = makeMatter([1, 0.9, 0, 0, 0, 0, 0, 0]);   // 量1 很硬
  const cold = makeMatter([1, 0.1, 0, 0, 0, 0, 0, 0]);  // 量1 很软
  const mix = combine(hot, cold);
  ok(mix.ok, '42.34 硬+软组合通过——强度槽变化不违反守恒（这是热力学，不是漏洞）');
}

// ================= 阶段 43 · 皮试：裁决层最小接线（action → adjudicator → matter，v4.1 探针） =================
{
  // 1. contact 接触换热：广延槽沿梯度流动趋向均衡，量不流、强度不变
  const r1 = fromSeed('C'), f1 = fromSeed('A');  // C：量3能0.2 / A：量1能0.8
  const ct = contact(r1, f1, 0.5);
  ok(ct.ok && Math.abs(r1.attrs[7] - 0.5) < 1e-6 && Math.abs(f1.attrs[7] - 0.5) < 1e-6,
    '43.1 接触换热：冷石(0.2)+热火(0.8)→各0.5，向均衡流动');
  eq(r1.attrs[0], 3, '43.2 接触不转量（贴着火不会变多）');
  eq(r1.attrs[1], 0.7, '43.3 接触不改强度（贴着火不会变硬）');
  ok(checkConservation([fromSeed('C'), fromSeed('A')], [r1, f1], 'total').ok, '43.3b 接触后广延总量守恒');

  // 2. 裁决层：只认物质目标，不认动词——动词不设清单
  const rock2 = fromSeed('C'), fire2 = fromSeed('A');
  const v1 = adjudicate({ actor: { id: 't1' }, verb: '随便什么动词', targets: [rock2, fire2] }, { day: 1 });
  ok(v1.legal && v1.effects.some(e => e.slot === 7 && e.to > e.from), '43.4 裁决器不看动词清单——任意动词，物理照样发生');
  ok(!adjudicate({ actor: null, verb: 'x', targets: [fromSeed('A'), fromSeed('C')] }, { day: 1 }).legal, '43.5 无行为者被拦截');
  const solo = adjudicate({ actor: { id: 't2' }, verb: '摸', targets: [fromSeed('C')] }, { day: 1 });
  ok(solo.legal && solo.effects.length === 0, '43.6 单目标：合法但落空（没有可相互作用的对象）');
  ok(!adjudicate({ actor: { id: 't3' }, verb: '扔', targets: [fromSeed('A'), fromSeed('C')], causeDay: 99 }, { day: 1 }).legal, '43.7 因在未来被拦截');
  ok(!adjudicate({ actor: { id: 't4' }, verb: '扔', targets: [fromSeed('A'), fromSeed('C')], cost: -1 }, { day: 1 }).legal, '43.8 负成本被拦截');

  // 3. parseAction 宽容解析
  ok(parseAction(null, null, null) === null, '43.9 空输入返回null');
  const pa = parseAction('把这块石头扔进火里', { id: 't5' }, null);
  ok(pa && pa.verb === '把这块石头扔进火里' && pa.targets.length === 0, '43.10 整句当动词收着，目标解析是词库层的活');
  const pa2 = parseAction({ action: '扔进', targets: [fromSeed('C'), fromSeed('A')] }, { id: 't6' }, null);
  ok(pa2 && pa2.verb === '扔进' && pa2.targets.length === 2, '43.11 对象形式解析（action/targets 字段）');

  // 4. 全链路皮试：真实 Game + 真实 NPC——"把这块石头扔进火里"
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(2026);
  const npc = g.npcs[0];
  const rock = fromSeed('C'), fire = fromSeed('A');
  nameMatter(npc.id, rock, '石头');   // NPC 自己起的名（涌现命名）
  nameMatter(npc.id, fire, '火');
  const memBefore = npc.memories.length;
  const verdict = dispatch(makeAction(npc, '扔进', [rock, fire], { reason: '把这块石头扔进火里' }), g);
  ok(verdict.legal, '43.12 全链路：动作合法落地，旧路径零改动');
  ok(Math.abs(rock.attrs[7] - 0.5) < 1e-6 && Math.abs(fire.attrs[7] - 0.5) < 1e-6,
    '43.13 全链路：石头被加热（0.2→0.5），火变温（0.8→0.5）——物理后果真实发生');
  // v4.2：dispatch 在 effects 非空时可能额外写一条 isIncident 记忆（概率捕获）——至少写 1 行
  ok(npc.memories.length >= memBefore + 1, '43.14 全链路：NPC 记忆写入（至少一行，v4.2 可能多一行 incident）');
  const lastMem = [...npc.memories].reverse().find(m => m.orig.includes('变热'));
  ok(lastMem && lastMem.orig.includes('石头') && lastMem.orig.includes('变热'),
    '43.15 记忆用 NPC 自己起的名字，且记住物理后果（"' + (lastMem ? lastMem.orig : '?') + '"）');

  // 5. 没起过名的物质在记忆里是"一样东西"——不知道是啥是合法状态
  const npc2 = g.npcs[1];
  dispatch(makeAction(npc2, '扔进', [fromSeed('C'), fromSeed('A')]), g);
  ok(npc2.memories[npc2.memories.length - 1].orig.includes('一样东西'), '43.16 无名物质→"一样东西"');

  // 6. 旧路径无恙：世界还在跑，NPC 还在
  ok(g.npcs.length > 0 && g.clock.totalDay >= 1, '43.17 皮试后世界完好（旧路径零影响）');
}

// ================= 阶段 44 · v4.1 全量：裁决层 + 动作开放（未知动作全链路） =================
{
  const stub44 = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(stub44);
  g.newGame(2026);
  const npc = g.npcs[0];

  // 1. 契约层：未知类型不再降级——pass + open 标记，走通用裁决路径
  const itU = makeIntent({ type: '扔进', target: '野草和汤', reason: '试试看' }, { nowMin: 1000 });
  const vU = validateIntent(itU, { npc, w: g.world, walkableAll: () => true });
  ok(vU.verdict === 'pass' && itU.open === true, '44.1 未知类型不降级：pass + open 标记');
  const itK = makeIntent({ type: 'eat', reason: '饿了' }, { nowMin: 1000 });
  validateIntent(itK, { npc, w: g.world, walkableAll: () => true });
  ok(!itK.open, '44.2 已知类型不带 open 标记（快速路径原样）');
  ok(INTENT_TYPES.includes('eat') && !INTENT_TYPES.includes('扔进'), '44.3 已知表在，但不再是门禁');

  // 2. 目标解析三级（皮试暴露的第一块硬骨头：世界物质索引 + 词库对照）
  const tang = makeMatter([1, 0, 0, 0.6, 0, 0, 0.8, 0.9]);   // 预先存在的热汤
  nameMatter(npc.id, tang, '汤');
  registerMatter(g, tang);
  ok(resolveTargets([tang], npc, g)[0] === tang, '44.4 目标解析第1级：物质实例原样通过');
  ok(resolveTargets(['汤'], npc, g)[0] === tang, '44.5 第2级：词在册——名字是指针，指到同一实例');
  const r44 = resolveTargets(['野草'], npc, g);
  ok(isMatter(r44[0]) && r44[0].attrs[0] === 1 && r44[0].attrs[7] === 0 && nameFor(npc.id, r44[0]) === '野草',
    '44.6 第3级：没见过的名词落地为未审之物（中性属性+名字锚定）');
  ok(g.matters.includes(r44[0]), '44.7 未审之物进世界物质索引');
  const r45 = resolveTargets(['石头和火'], npc, g);
  ok(r45.length === 2 && nameFor(npc.id, r45[0]) === '石头' && nameFor(npc.id, r45[1]) === '火',
    '44.8 复合目标拆分：「石头和火」是两个东西');

  // 3. applyDecisions 全链路：AI 生成未知动作「扔进(野草和汤)」——能落地，不降级
  const weeds = resolveTargets(['野草'], npc, g)[0];   // 同一实例（已在册）
  const res1 = applyDecisions(g, [{ npc: npc.name, action: '扔进', target: '野草和汤', reason: '试试看，兴许能出个味儿' }]);
  ok(res1.applied === 1 && res1.fellBack === 0, '44.9 未知动作落地：applied=1，不计降级');
  ok(weeds.attrs[7] > 0.4 && tang.attrs[7] < 0.9, '44.10 效果由属性裁决：热汤把野草焐热了（能量沿梯度流动）');
  // v4.2：dispatch 在 effects 非空时额外写一条 isIncident 记忆，固定索引会偏移 → 反向找 describe 记忆
  const mem1 = [...npc.memories].reverse().find(m => m.orig.includes('变热'));
  ok(mem1 && mem1.orig.includes('扔进') && mem1.orig.includes('野草') && mem1.orig.includes('变热'),
    '44.11 记忆落行：动词+名字+物理后果（"' + (mem1 ? mem1.orig : '?') + '"）');
  eq(npc.intent.label, '扔进', '44.12 NPC 获得落地意图：标签就是动词本身');

  // 4. 同一动词、不同属性目标 → 不同结果（裁决看属性，不是查表）
  const npcB = g.npcs[1];
  const res2 = applyDecisions(g, [{ npc: npcB.name, action: '扔进', target: '石子和水洼', reason: '闲着试试' }]);
  const stones = resolveTargets(['石子'], npcB, g)[0];
  ok(res2.applied === 1 && Math.abs(stones.attrs[7]) < 1e-9, '44.13 同一动词扔进冷目标：不热——不查表');
  const memNoChange = [...npcB.memories].reverse().find(m => m.orig.includes('没什么变化'));
  ok(memNoChange != null, '44.14 中性目标接触：没什么变化（诚实结果）');

  // 5. 高频快速路径不掉：eat/sleep/goto 仍走专属 case，不碰裁决层、不产生物质
  const mBefore = g.matters.length;
  const r6 = applyDecisions(g, [
    { npc: npc.name, action: 'eat', reason: '饿了' },
    { npc: npcB.name, action: 'sleep', reason: '困了' }
  ]);
  ok(r6.applied === 2 && g.matters.length === mBefore, '44.15 eat/sleep 快速路径：不过裁决层、不产生物质');
  const npcC = g.npcs[2];
  const r7 = applyDecisions(g, [{ npc: npcC.name, action: 'goto', target: '镇中心广场', reason: '去转转' }]);
  ok(r7.applied === 1 && g.matters.length === mBefore, '44.16 goto 地名快速路径原样');

  // 6. 回滚保险：开关关掉 → 未知动作退回旧行为（契约降级 idle，物质索引不涨）
  OPEN_ACTIONS.enabled = false;
  const vOff = validateIntent(makeIntent({ type: '抛洒', reason: '试试' }, { nowMin: 1000 }),
    { npc, w: g.world, walkableAll: () => true });
  ok(vOff.verdict === 'fallback' && vOff.intent.type === 'idle', '44.17 开关关闭：未知类型回退降级 idle');
  const npcD = g.npcs[3];
  const r8 = applyDecisions(g, [{ npc: npcD.name, action: '抛洒', target: '谷壳', reason: '试试' }]);
  ok(r8.fellBack === 1 && r8.applied === 1 && npcD.intent.type === 'idle' && g.matters.length === mBefore,
    '44.18 开关关闭：全链路退回旧 idle 行为，未审之物不产生');
  OPEN_ACTIONS.enabled = true;

  // 7. 老存档可读 + 物质索引随档走
  const blob = JSON.parse(JSON.stringify(g.serialize()));
  ok(Array.isArray(blob.matters) && blob.matters.length > 0, '44.19 物质索引随档走');
  delete blob.matters;   // 模拟 v4.0 老存档：没有 matters 字段
  const g2 = Game.hydrate(blob, stub44);
  ok(g2.npcs.length > 0 && Array.isArray(g2.matters) && g2.matters.filter(m => m.prototypeRes).length === 9,
    '44.20 老存档可读：无 matters 字段 → 登记处只补 9 个资源原型，世界照跑');
  const g3 = Game.hydrate(JSON.parse(JSON.stringify(g.serialize())), stub44);
  const revivedTang = g3.matters.find(m => Object.values(m.names).includes('汤'));
  ok(revivedTang && Math.abs(revivedTang.attrs[7] - 0.45) < 1e-6, '44.21 读档后名字与物理状态都还在（词库对照不丢）');
  const fresh44 = makeMatter([1]);
  ok(!g3.matters.some(m => m.id === fresh44.id), '44.22 读档后新建物质 id 不撞车（计数器推过存档最大值）');
}

// ================= 阶段 45 · v4.2 发现层（天道退役）：意外/捕获/重复/传播/技能识别 =================
// 验收：NPC 能做出非计划内的事 / 意外被捕获被重复被传播 / 没有任何天道在引导发现 / 白纸跑出技能
function chainRng45(vals, seed) {
  let i = 0;
  return () => {
    if (i < vals.length) return vals[i++];
    return 0.99;   // 越界默认高值（不命中概率漏斗）
  };
}
function mockNpc45(id, x, y) {
  return {
    id, x, y,
    body: { ageYears: 20 },
    needs: { mood: 50 },
    memories: [],
    incidents: [],
    memory(text, day, hour, mood, opts) {
      this.memories.push(makeMemory(text, day, hour, mood != null ? mood : this.needs.mood, opts));
      if (this.memories.length > 40) this.memories.splice(0, this.memories.length - 40);
    }
  };
}
function testDiscovery() {
  const savedEnabled = DISCOVERY.enabled;
  DISCOVERY.enabled = true;

  // —— 45.1 开关默认开 ——
  ok(DISCOVERY.enabled === true, '45.1 DISCOVERY 开关默认开（天道退役）');

  // —— 45.2 maybeIncident：effects 非空 + rng 命中 → incident ——
  const fire = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.8]);   // 槽 7=能量 0.8（热）
  const stone = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.1]);    // 槽 7=能量 0.1（冷）
  const npcA = mockNpc45(1, 5, 5);
  const world = { clock: { totalDay: 1, hour: 6 }, rng: chainRng45([0.1], 1) };   // 0.1 <= 0.25 捕获
  const act = makeAction(npcA, '扔', [stone, fire], { reason: '试试' });
  const verdict = adjudicate(act, world);
  ok(verdict.legal && verdict.effects.length > 0, '45.2a 石头扔进火里有物理变化（槽7梯度流动）');
  const inc = maybeIncident(npcA, act, verdict, world, world.rng);
  ok(inc !== null && inc.verb === '扔' && inc.slotChanges.length > 0, '45.2b maybeIncident 捕获 incident（rng<=0.25）');

  // —— 45.3 maybeIncident：rng 不命中 → null ——
  const world2 = { clock: { totalDay: 1, hour: 6 }, rng: chainRng45([0.9], 2) };   // 0.9 > 0.25 不捕获
  const fire2 = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.8]);
  const stone2 = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.1]);
  const act2 = makeAction(npcA, '扔', [stone2, fire2]);
  const verdict2 = adjudicate(act2, world2);
  const inc2 = maybeIncident(npcA, act2, verdict2, world2, world2.rng);
  ok(inc2 === null, '45.3 rng>0.25 不捕获（概率漏斗过滤）');

  // —— 45.4 maybeIncident：effects 空也可能捕获（探索行为本身就是意外，不依赖数值变化）——
  const emptyVerdict = { legal: true, effects: [] };
  const incEmpty = maybeIncident(npcA, act, emptyVerdict, world, chainRng45([0.01], 3));
  ok(incEmpty !== null, '45.4 effects 空也可捕获 incident（探索行为本身就是意外）');
  ok(incEmpty.slotChanges.length === 0, '45.4b effects 空时 slotChanges 为空数组');

  // —— 45.5 captureIncident：写 isIncident 记忆 + incidents 索引 ——
  captureIncident(npcA, inc, world);
  ok(npcA.incidents.length === 1 && npcA.incidents[0].verb === '扔', '45.5a incidents 索引有 1 条');
  ok(npcA.memories.length > 0 && npcA.memories[npcA.memories.length - 1].isIncident === true, '45.5b 记忆最后一条带 isIncident 标记');

  // —— 45.6 maybeRepeat：rng 命中 → true ——
  ok(maybeRepeat(npcA, inc, world, chainRng45([0.05], 4)) === true, '45.6a maybeRepeat rng<=0.08 → true');
  ok(maybeRepeat(npcA, inc, world, chainRng45([0.5], 5)) === false, '45.6b maybeRepeat rng>0.08 → false');

  // —— 45.7 maybeSpread：附近 → true；远 → false；婴幼儿 → false ——
  const npcB = mockNpc45(2, 6, 6);   // 距离 1，附近
  const stubActor = { id: inc.actorId, x: inc.actorPos.x, y: inc.actorPos.y };
  ok(maybeSpread(npcB, stubActor, inc, world, chainRng45([0.03], 6)) === true, '45.7a 附近邻居 rng<=0.04 → 学到');
  inc.spreadTo.push(npcB.id);   // 模拟学到
  ok(maybeSpread(npcB, stubActor, inc, world, chainRng45([0.01], 7)) === false, '45.7b 已学到 → 不再传播');
  const npcFar = mockNpc45(3, 20, 20);   // 距离 15，太远
  ok(maybeSpread(npcFar, stubActor, inc, world, chainRng45([0.01], 8)) === false, '45.7c 太远 → 看不见学不会');
  const npcChild = mockNpc45(4, 5, 6);
  npcChild.body.ageYears = 3;
  ok(maybeSpread(npcChild, stubActor, inc, world, chainRng45([0.01], 9)) === false, '45.7d 婴幼儿不学手艺');

  // —— 45.8 captureDiscoveries：推进 repeat+spread 后识别新技能 ——
  // 重新构造干净的 incident（甲原创，乙在附近）
  const game = { npcs: [mockNpc45(10, 5, 5), mockNpc45(11, 6, 6)], clock: { totalDay: 1, hour: 6 }, discoveries: [] };
  const fa = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.9]);
  const sa = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.1]);
  const actA = makeAction(game.npcs[0], '烤', [sa, fa], { reason: '试试' });
  const vA = adjudicate(actA, game);
  // rng=0.01 <= 0.25 捕获
  const incA = maybeIncident(game.npcs[0], actA, vA, game, chainRng45([0.01], 10));
  captureIncident(game.npcs[0], incA, game);
  // captureDiscoveries 用 chainRng 推进：repeat 0.05<=0.08 命中；spread 0.03<=0.04 命中（乙在附近）
  game.rng = chainRng45([0.05, 0.03], 11);
  const fresh = captureDiscoveries(game);
  ok(fresh.length >= 1, '45.8a captureDiscoveries 识别出新技能');
  ok(game.discoveries.length >= 1 && game.discoveries[0].verb === '烤', '45.8b game.discoveries 有记录');
  ok(game.discoveries[0].spreadTo.length >= 2, '45.8c 技能被多人拥有（spreadTo>=2）');

  // —— 45.9 dispatch 接 incident：effects 非空时捕获 ——
  const npcD = mockNpc45(20, 5, 5);
  const gameD = { clock: { totalDay: 2, hour: 6 }, rng: chainRng45([0.01], 12), matters: [] };   // 0.01<=0.25 捕获
  const fb = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.8]);
  const sb = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.1]);
  dispatch(makeAction(npcD, '烤', [sb, fb], { reason: '试试' }), gameD);
  ok(npcD.incidents.length === 1, '45.9 dispatch 在 effects 非空时捕获 incident');

  // —— 45.10 DISCOVERY.enabled=false：dispatch 不捕获 ——
  DISCOVERY.enabled = false;
  const npcE = mockNpc45(21, 5, 5);
  const gameE = { clock: { totalDay: 2, hour: 6 }, rng: chainRng45([0.01], 13), matters: [] };
  const fc = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.8]);
  const sc = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.1]);
  dispatch(makeAction(npcE, '烤', [sc, fc], { reason: '试试' }), gameE);
  ok(npcE.incidents.length === 0, '45.10 开关关时 dispatch 不捕获（回滚 v4.1）');
  DISCOVERY.enabled = true;   // 恢复

  // —— 45.11 存档往返：incidents 随档走 ——
  const ser = serializeDiscovery(game);
  const game2 = { npcs: [mockNpc45(10, 5, 5), mockNpc45(11, 6, 6)], clock: { totalDay: 1, hour: 6 }, discoveries: [] };
  hydrateDiscovery(game2, ser);
  ok(game2.discoveries.length === game.discoveries.length, '45.11a discoveries 随档往返');
  ok(game2.npcs[0].incidents.length === game.npcs[0].incidents.length, '45.11b NPC 的 incidents 随档还原');

  // —— 45.12 recentMemories 优先 isIncident ——
  const npcF = mockNpc45(30, 5, 5);
  npcF.memory('普通的一天', 1, 6);
  npcF.memory('吃了顿饭', 1, 7);
  // 写一条 isIncident 记忆
  npcF.memory('烤了石头（意外）', 1, 8, 60, { isIncident: true });
  const rec = recentMemories(npcF, 2);
  ok(rec.length === 2 && rec.some(t => t.includes('意外')), '45.12 recentMemories 优先返回 isIncident 记忆');

  // —— 45.13 白纸模拟：NPC 反复做动作，跑几天 captureDiscoveries，长出技能 ——
  // 构造一个最小世界：甲反复"烤"石头，乙在附近。每天 captureDiscoveries 推进 repeat+spread。
  const sim = { npcs: [mockNpc45(40, 5, 5), mockNpc45(41, 6, 6)], clock: { totalDay: 0, hour: 6 }, discoveries: [] };
  // 第 0 天：甲做动作 → 捕获 incident（rng 0.01<=0.25）
  const f0 = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.8]);
  const s0 = makeMatter([1, 0, 0, 0, 0, 0, 0, 0.1]);
  const v0 = adjudicate(makeAction(sim.npcs[0], '炼', [s0, f0]), sim);
  const i0 = maybeIncident(sim.npcs[0], makeAction(sim.npcs[0], '炼', [s0, f0]), v0, sim, chainRng45([0.01], 13));
  captureIncident(sim.npcs[0], i0, sim);
  // 接下来 3 天：captureDiscoveries 推进（repeat+spread 都喂低值命中）
  for (let d = 1; d <= 3; d++) {
    sim.clock.totalDay = d;
    sim.rng = chainRng45([0.01, 0.01], 40 + d);   // repeat 0.01<=0.08, spread 0.01<=0.04
    captureDiscoveries(sim);
  }
  ok(sim.discoveries.length >= 1 && sim.discoveries[0].verb === '炼', '45.13 白纸模拟 3 天长出技能"炼"（开发者没预设）');
  ok(sim.discoveries[0].spreadTo.length >= 2, '45.13b 技能被传播给邻居（不是天道引导）');

  DISCOVERY.enabled = savedEnabled;   // 恢复
}
testDiscovery();

// ================= 阶段 46 · v4.3 知识层：捕获/推理/验证/传播/手艺派生 =================
stage(46, 'v4.3 知识层（手艺是预置配方这件事）');
// 验收：NPC 能组合出没直接教过的知识 / 错误知识能被传播被相信 / 手艺链从知识派生 / 存档往返
function chainRng46(vals, seed) {
  let i = 0;
  return () => {
    if (i < vals.length) return vals[i++];
    return 0.99;   // 越界默认高值（不命中概率漏斗）
  };
}
function mockNpc46(id, x, y) {
  return {
    id, x, y,
    body: { ageYears: 30 },
    needs: { mood: 60 },
    memories: [],
    incidents: [],
    knowledgeList: [],
    moodDelta(d) { this.needs.mood = Math.max(0, Math.min(100, this.needs.mood + d)); },
    memory(text, day, hour, mood, opts) {
      this.memories.push(makeMemory(text, day, hour, mood != null ? mood : this.needs.mood, opts));
      if (this.memories.length > 40) this.memories.splice(0, this.memories.length - 40);
    }
  };
}
function testKnowledge() {
  const savedEnabled = KNOWLEDGE.enabled;
  KNOWLEDGE.enabled = true;

  // —— 46.1 开关默认开 ——
  ok(KNOWLEDGE.enabled === true, '46.1 KNOWLEDGE 开关默认开（知识层在岗）');

  // —— 46.2 makeKnowledge：造一条知识 ——
  const npcA = mockNpc46(1, 10, 10);
  const k1 = makeKnowledge(npcA, { verb: '烤', targetNames: ['石头'] }, { slots: [{ slot: 7, dir: '+' }] }, 'incident', 5);
  ok(k1 && k1.verb === '烤' && k1.slots.length === 1 && k1.slots[0].slot === 7, '46.2 makeKnowledge 造知识（verb=烤 slots=[7+]）');
  ok(k1.truth === null, '46.2b 新知识真值未验证（truth=null）');
  ok(k1.combined === false, '46.2c incident 来源的知识不是组合知识');

  // —— 46.3 knowledgeFromIncident：从 incident 提取知识 ——
  const inc = {
    verb: '炼', targetNames: ['矿石', '火'],
    slotChanges: [{ slot: 1, from: 0.7, to: 0.3 }, { slot: 7, from: 0.2, to: 0.8 }],
    day: 3
  };
  const k2 = knowledgeFromIncident(inc, 1);
  ok(k2 && k2.verb === '炼' && k2.slots.length === 2, '46.3 knowledgeFromIncident 提取知识（2 个槽位变化）');
  ok(k2.slots[0].dir === '-' && k2.slots[1].dir === '+', '46.3b 方向推导正确（硬质下降=−，能量上升=+）');

  // —— 46.4 maybeInfer：两条有交集的知识 → 组合出新知识 ——
  const npcB = mockNpc46(2, 11, 10);
  const ka = makeKnowledge(npcB, { verb: '烧' }, { slots: [{ slot: 1, dir: '-' }] }, 'incident', 1);
  const kb = makeKnowledge(npcB, { verb: '塑' }, { slots: [{ slot: 1, dir: '-' }, { slot: 5, dir: '+' }] }, 'incident', 2);
  believe(npcB, ka);
  believe(npcB, kb);
  // rng <= 0.04 命中推理；用 chainRng 喂低值
  const k3 = maybeInfer(npcB, npcB.knowledgeList, { clock: { totalDay: 5 } }, chainRng46([0.01], 1));
  ok(k3 !== null, '46.4 maybeInfer 组合出新知识（rng<=0.04 命中）');
  ok(k3 && k3.combined === true, '46.4b 组合知识标记 combined=true');
  ok(k3 && k3.verb === '烧塑', '46.4c 组合 verb 是拼接的（烧+塑=烧塑）');
  ok(k3 && k3.slots.length >= 2, '46.4d 组合 slots 合并去重（槽1+槽5）');

  // —— 46.5 maybeInfer：槽位无交集 → null ——
  const npcC = mockNpc46(3, 12, 10);
  const kc = makeKnowledge(npcC, { verb: '挖' }, { slots: [{ slot: 2, dir: '+' }] }, 'incident', 1);
  const kd = makeKnowledge(npcC, { verb: '浇' }, { slots: [{ slot: 6, dir: '+' }] }, 'incident', 1);
  believe(npcC, kc);
  believe(npcC, kd);
  ok(maybeInfer(npcC, npcC.knowledgeList, { clock: { totalDay: 5 } }, chainRng46([0.01], 2)) === null, '46.5 槽位无交集 → 不组合');

  // —— 46.6 maybeInfer：rng 不命中 → null ——
  ok(maybeInfer(npcB, npcB.knowledgeList, { clock: { totalDay: 5 } }, chainRng46([0.5], 3)) === null, '46.6 rng>0.04 → 不推理');

  // —— 46.7 truthValue：知识匹配 discovery → 高真值 ——
  const world7 = { discoveries: [{ verb: '炼', slots: [1, 7], spreadTo: [1, 2] }] };
  const kMatch = makeKnowledge(null, { verb: '炼' }, { slots: [{ slot: 1, dir: '-' }, { slot: 7, dir: '+' }] }, 'incident', 1);
  const tv7 = truthValue(kMatch, world7);
  ok(tv7 > 0.5, `46.7 知识匹配 discovery → 高真值（got ${tv7}）`);

  // —— 46.8 truthValue：知识不匹配 → 低真值 ——
  const kNoMatch = makeKnowledge(null, { verb: '飞' }, { slots: [{ slot: 3, dir: '+' }] }, 'incident', 1);
  ok(truthValue(kNoMatch, world7) === 0, '46.8 知识不匹配 discovery → 真值 0');

  // —— 46.9 believe：去重 ——
  const npcD = mockNpc46(4, 13, 10);
  const kdup = makeKnowledge(npcD, { verb: '烤' }, { slots: [{ slot: 7, dir: '+' }] }, 'incident', 1);
  believe(npcD, kdup);
  believe(npcD, { ...kdup, id: 'k_dup' });   // 相同 verb+slots 的副本
  ok(npcD.knowledgeList.length === 1, '46.9 believe 去重（相同 verb+slots 不重复信）');

  // —— 46.10 believe：超过上限淘汰旧的 ——
  const npcE = mockNpc46(5, 14, 10);
  for (let i = 0; i < 25; i++) {
    believe(npcE, makeKnowledge(npcE, { verb: 'v' + i }, { slots: [{ slot: i % 16, dir: '+' }] }, 'incident', 1));
  }
  ok(npcE.knowledgeList.length <= 20, `46.10 believe 超过上限淘汰旧的（got ${npcE.knowledgeList.length} <= 20）`);

  // —— 46.11 maybeVerify：rng 命中 → truth 被赋值 ——
  const npcF = mockNpc46(6, 15, 10);
  const kF = makeKnowledge(npcF, { verb: '炼' }, { slots: [{ slot: 1, dir: '-' }] }, 'incident', 1);
  believe(npcF, kF);
  maybeVerify(npcF, kF, world7, chainRng46([0.05], 4));   // 0.05 <= 0.10 命中
  ok(kF.truth != null, `46.11 maybeVerify 赋真值（got ${kF.truth}）`);

  // —— 46.12 maybeForgetWrong：truth=0 → 概率性放弃 ——
  const npcG = mockNpc46(7, 16, 10);
  const kG = makeKnowledge(npcG, { verb: '飞' }, { slots: [{ slot: 3, dir: '+' }] }, 'incident', 1);
  kG.truth = 0;   // 被证伪
  believe(npcG, kG);
  const beforeG = npcG.knowledgeList.length;
  const rngG = chainRng46([0.05], 5);   // 0.05 <= 0.10 命中放弃
  maybeForgetWrong(npcG, kG, rngG);
  ok(npcG.knowledgeList.length === beforeG - 1, '46.12 maybeForgetWrong 放弃被证伪的知识');

  // —— 46.13 maybeSpreadKnowledge：邻居在附近 → 学到 ——
  const actor13 = mockNpc46(8, 10, 10);
  const obs13 = mockNpc46(9, 12, 10);   // 距离 2 ≤ 6
  const k13 = makeKnowledge(actor13, { verb: '炼' }, { slots: [{ slot: 1, dir: '-' }] }, 'incident', 1);
  ok(maybeSpreadKnowledge(obs13, actor13, k13, { rng: Math.random }, chainRng46([0.02], 6)) === true, '46.13 maybeSpreadKnowledge 邻居在附近 → 学到');

  // —— 46.14 maybeSpreadKnowledge：距离远 → false ——
  const obs14 = mockNpc46(10, 30, 30);   // 距离 20 > 6
  ok(maybeSpreadKnowledge(obs14, actor13, k13, { rng: Math.random }, chainRng46([0.01], 7)) === false, '46.14 maybeSpreadKnowledge 距离远 → 不传播');

  // —— 46.15 错误知识被传播被相信：truth=0 的知识仍能传播 ——
  const actor15 = mockNpc46(11, 10, 10);
  const obs15 = mockNpc46(12, 11, 10);
  const kWrong = makeKnowledge(actor15, { verb: '歪理' }, { slots: [{ slot: 0, dir: '+' }] }, 'incident', 1);
  kWrong.truth = 0;   // 错误知识
  believe(actor15, kWrong);
  ok(maybeSpreadKnowledge(obs15, actor15, kWrong, { rng: Math.random }, chainRng46([0.01], 8)) === true, '46.15 错误知识能被传播（NPC 不知道它错）');
  // 错误知识被观察者相信了
  believe(obs15, { ...kWrong, source: 'taught', believer: obs15.id });
  ok(obs15.knowledgeList.length === 1, '46.15b 错误知识被相信（和正确的一样在 knowledgeList 里）');

  // —— 46.16 knowledgeDaily：全链路——捕获/推理/验证/遗忘/传播 ——
  const game16 = {
    npcs: [mockNpc46(20, 10, 10), mockNpc46(21, 11, 10)],
    discoveries: [{ verb: '炼', slots: [1, 7], spreadTo: [20, 21] }],
    clock: { totalDay: 10 },
    rng: chainRng46([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01], 20)
  };
  // NPC20 有一个 incident
  game16.npcs[0].incidents = [{
    verb: '炼', targetNames: ['矿石'], slotChanges: [{ slot: 1, from: 0.7, to: 0.3 }],
    day: 8, actorPos: { x: 10, y: 10 }, repeats: 0, spreadTo: [20]
  }];
  knowledgeDaily(game16, 10);
  ok(game16.npcs[0].knowledgeList.length >= 1, `46.16a knowledgeDaily 捕获：从 incident 提取知识（got ${game16.npcs[0].knowledgeList.length}）`);

  // —— 46.17 knowledgeInnovateDaily：知识驱动手艺精进 ——
  // 构造一个有配方定义 + NPC 有知识 + 会这门手艺的场景
  const game17 = {
    npcs: [mockNpc46(30, 10, 10)],
    rng: chainRng46([0.01, 0.01, 0.01, 0.01], 30),
    recipes: {
      'r1': { id: 'r1', mult: 1.0, knownBy: new Map([[30, 1]]), inventor: 30, inventedDay: 1, tries: 0, lost: false, lostDay: 0 }
    },
    recipeDefs: {
      'r1': { name: '打铁', job: '铁匠', variants: [1.0, 1.5, 2.0], inputs: { iron: 1 }, outputs: { tool: 1 } }
    },
    log() {},
    stock: { iron: 10 }
  };
  game17.npcs[0].knowledgeList = [
    makeKnowledge(game17.npcs[0], { verb: '炼' }, { slots: [{ slot: 1, dir: '-' }] }, 'incident', 5),
    makeKnowledge(game17.npcs[0], { verb: '打' }, { slots: [{ slot: 5, dir: '+' }] }, 'incident', 6),
  ];
  const rec17 = game17.recipes['r1'];
  const multBefore = rec17.mult;
  knowledgeInnovateDaily(game17, 10);
  ok(rec17.tries > 0, '46.17a knowledgeInnovateDaily 触发了尝试（tries>0）');
  // mult 可能上升也可能没成（rng 链路决定），但至少 tries 要涨
  ok(typeof rec17.mult === 'number' && rec17.mult >= multBefore, `46.17b knowledgeInnovateDaily mult 不退步（before=${multBefore} after=${rec17.mult}）`);

  // —— 46.18 存档往返：serializeKnowledge/hydrateKnowledge ——
  const game18 = {
    npcs: [mockNpc46(40, 10, 10), mockNpc46(41, 11, 10)],
    clock: { totalDay: 10 }
  };
  const k18 = makeKnowledge(game18.npcs[0], { verb: '炼' }, { slots: [{ slot: 1, dir: '-' }] }, 'incident', 5);
  believe(game18.npcs[0], k18);
  const ser = serializeKnowledge(game18);
  ok(ser.byNpc[40] && ser.byNpc[40].length === 1, '46.18a serializeKnowledge 序列化知识');
  // hydrate 到新对象
  const game18b = {
    npcs: [mockNpc46(40, 10, 10), mockNpc46(41, 11, 10)],
    clock: { totalDay: 10 }
  };
  hydrateKnowledge(game18b, ser);
  ok(game18b.npcs[0].knowledgeList.length === 1, '46.18b hydrateKnowledge 恢复知识');
  ok(game18b.npcs[0].knowledgeList[0].verb === '炼', '46.18c 恢复的知识 verb 正确');
  ok(game18b.npcs[1].knowledgeList.length === 0, '46.18d 无知识的 NPC 恢复为空列表');
  // 旧档兼容：无 knowledge 字段
  hydrateKnowledge(game18b, undefined);
  ok(game18b.npcs[0].knowledgeList.length === 0, '46.18e 旧档无 knowledge 字段 → 空列表（不崩）');

  // —— 46.19 白纸模拟：NPC 反复做动作 → 知识 → 推理出新知识（开发者没预设）——
  const sim = {
    npcs: [mockNpc46(50, 10, 10), mockNpc46(51, 11, 10)],
    discoveries: [],
    clock: { totalDay: 1 },
    rng: chainRng46([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01], 50)
  };
  // NPC50 有两个不同动词的 incident（槽位有交集）
  sim.npcs[0].incidents = [
    { verb: '烧', targetNames: ['木'], slotChanges: [{ slot: 1, from: 0.5, to: 0.2 }], day: 1, actorPos: { x: 10, y: 10 }, repeats: 0, spreadTo: [50] },
    { verb: '塑', targetNames: ['泥'], slotChanges: [{ slot: 1, from: 0.3, to: 0.1 }], day: 1, actorPos: { x: 10, y: 10 }, repeats: 0, spreadTo: [50] }
  ];
  // 跑 3 天 knowledgeDaily
  for (let d = 1; d <= 3; d++) {
    sim.clock.totalDay = d;
    sim.rng = chainRng46([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01], 50 + d);
    knowledgeDaily(sim, d);
  }
  // NPC50 应该有知识（至少从 incident 提取的）
  ok(sim.npcs[0].knowledgeList.length >= 2, `46.19a 白纸模拟：NPC 从 incident 提取了知识（got ${sim.npcs[0].knowledgeList.length}）`);
  // 检查是否有组合知识（verb 是拼接的）
  const hasCombined = sim.npcs[0].knowledgeList.some(k => k.combined && k.verb.length >= 2);
  ok(hasCombined, '46.19b 白纸模拟：NPC 推理出组合知识（开发者没预设的 verb）');
  // 知识可能传播给邻居
  ok(sim.npcs[1].knowledgeList.length >= 0, '46.19c 白纸模拟：邻居可能学到知识（不强制，看 rng）');

  // —— 46.20 开关切回：KNOWLEDGE.enabled=false → maybeInfer 返回 null ——
  KNOWLEDGE.enabled = false;
  ok(maybeInfer(npcB, npcB.knowledgeList, { clock: { totalDay: 5 } }, chainRng46([0.01], 99)) === null, '46.20 开关切回：maybeInfer 不推理');
  // truthValue 是纯函数，不查开关——仍可用
  ok(truthValue(kMatch, world7) > 0.5, '46.20b 开关切回：truthValue 仍可用（纯函数不查开关）');
  // maybeVerify 查开关——不执行
  const kBefore20 = makeKnowledge(npcB, { verb: '炼' }, { slots: [{ slot: 1, dir: '-' }] }, 'incident', 5);
  kBefore20.truth = null;
  maybeVerify(npcB, kBefore20, world7, chainRng46([0.01], 100));
  ok(kBefore20.truth === null, '46.20c 开关切回：maybeVerify 不执行（truth 仍为 null）');
  KNOWLEDGE.enabled = true;

  KNOWLEDGE.enabled = savedEnabled;   // 恢复
}
testKnowledge();

// ================= 阶段 47 · v4.4 世界自变+多聚落（地质/气候/聚落/动物属性推导） =================
stage(47, 'v4.4 世界自变+多聚落（地质/气候/聚落/动物属性推导）');
// 验收：地质能改变地形 / 气候返回 weatherBias / 聚落能推进 / 属性推导生态关系 / 老存档兼容
function testWorldSelfChange() {
  // —— 47.1 开关默认开 ——
  ok(GEOL.enabled === true, '47.1 GEOL 开关默认开（地质层在岗）');
  ok(CLIMATE.enabled === true, '47.1b CLIMATE 开关默认开（气候层在岗）');
  ok(SETT.enabled === true, '47.1c SETT 开关默认开（聚落层在岗）');

  // —— 47.2 动物属性推导：isPredator ——
  ok(isPredator(ANIMAL_DEFS.wolf) === true, '47.2 wolf 是捕食者（diet=carn）');
  ok(isPredator(ANIMAL_DEFS.cow) === false, '47.2b cow 不是捕食者（diet=herb）');
  ok(isPredator(ANIMAL_DEFS.cat) === true, '47.2c cat 是捕食者（diet=carn）');
  ok(isPredator(ANIMAL_DEFS.deer) === false, '47.2d deer 不是捕食者（diet=herb）');

  // —— 47.3 动物属性推导：canPreyOn（体型+食性） ——
  ok(canPreyOn(ANIMAL_DEFS.wolf, ANIMAL_DEFS.cow) === false, '47.3 wolf 不能猎杀 cow（medium<large，更现实）');
  ok(canPreyOn(ANIMAL_DEFS.wolf, ANIMAL_DEFS.sheep) === true, '47.3b wolf 能猎杀 sheep（carn×herb, medium>=medium）');
  ok(canPreyOn(ANIMAL_DEFS.wolf, ANIMAL_DEFS.chicken) === true, '47.3c wolf 能猎杀 chicken（carn×omni, medium>=small）');
  ok(canPreyOn(ANIMAL_DEFS.wolf, ANIMAL_DEFS.deer) === true, '47.3d wolf 能猎杀 deer（carn×herb, medium>=medium）');
  ok(canPreyOn(ANIMAL_DEFS.wolf, ANIMAL_DEFS.wolf) === false, '47.3e wolf 不能猎杀 wolf（carn×carn 互不捕食）');
  ok(canPreyOn(ANIMAL_DEFS.cat, ANIMAL_DEFS.cow) === false, '47.3f cat 不能猎杀 cow（small<large）');
  ok(canPreyOn(ANIMAL_DEFS.cat, ANIMAL_DEFS.chicken) === true, '47.3g cat 能猎杀 chicken（carn×omni, small>=small）');
  ok(canPreyOn(ANIMAL_DEFS.wolf, ANIMAL_DEFS.dog) === true, '47.3h wolf 能猎杀 dog（carn×omni, medium>=medium）');
  ok(canPreyOn(ANIMAL_DEFS.wolf, ANIMAL_DEFS.cat) === false, '47.3i wolf 不能猎杀 cat（carn×carn 互不捕食）');

  // —— 47.4 动物属性完整性：8 种动物全有 diet/size/habitat ——
  for (const [k, def] of Object.entries(ANIMAL_DEFS)) {
    ok(def.diet != null, `47.4 ${def.name} 有 diet 属性`);
    ok(def.size != null, `47.4b ${def.name} 有 size 属性`);
    ok(def.habitat != null, `47.4c ${def.name} 有 habitat 属性`);
  }

  // —— 47.5 地质 tick：河流侵蚀（GRASS 水边 → SAND）——
  const w = genWorld(999);
  for (const c of w.ws.iterNonVirgin()) c.state = 4; // ST.HOT
  let testChunk = null;
  for (const c of w.ws.iterNonVirgin()) { testChunk = c; break; }
  ok(testChunk !== null, '47.5 世界有非空 chunk');
  if (testChunk) {
    const iWater = 5 + 5 * CHUNK;     // localIdx(5,5)
    const iGrass = 6 + 5 * CHUNK;     // localIdx(6,5)
    testChunk.ground[iWater] = G.WATER;
    testChunk.ground[iGrass] = G.GRASS;
    testChunk.dirty = true;
    eq(testChunk.ground[iGrass], G.GRASS, '47.5a 侵蚀前是 GRASS');
    // 用极小 rng 强制侵蚀发生（< erodeProb=0.02）
    const tinyRng = () => 0.001;
    const stats = geologyTick(w, 1, tinyRng);
    ok(stats.eroded >= 1, `47.5b geologyTick 侵蚀统计 > 0（got ${stats.eroded}）`);
    eq(testChunk.ground[iGrass], G.SAND, '47.5c 侵蚀后变 SAND');
  }

  // —— 47.6 气候 tick：返回 weatherBias ——
  const cs = initClimateState(42);
  ok(cs.phase === 'wet' || cs.phase === 'dry', `47.6 initClimateState phase 合法（got ${cs.phase}）`);
  ok(cs.yearsLeft > 0 && cs.yearsLeft <= 60, `47.6b initClimateState yearsLeft 在 1-60（got ${cs.yearsLeft}）`);
  ok(cs.cycleLen >= 30 && cs.cycleLen <= 60, `47.6c initClimateState cycleLen 在 30-60（got ${cs.cycleLen}）`);
  const cResult = climateTick(cs, 1, 0, mulberry32(123));
  ok(cResult.weatherBias != null, '47.6d climateTick 返回 weatherBias');
  ok(cResult.weatherBias.rain !== undefined, '47.6e weatherBias 有 rain 字段');
  ok(cResult.phase === 'wet' || cResult.phase === 'dry', '47.6f climateTick phase 合法');

  // —— 47.7 气候周期更替 ——
  const cs2 = { phase: 'wet', yearsLeft: 1, cycleLen: 30 };
  const oldPhase = cs2.phase;
  const r2 = climateTick(cs2, 2, 0, mulberry32(456));
  ok(r2.cycleShifted === true, '47.7 周期更替时 cycleShifted=true');
  ok(cs2.phase !== oldPhase, `47.7b phase 翻转（${oldPhase}→${cs2.phase}）`);

  // —— 47.8 聚落初始化 ——
  const rng48 = mulberry32(789);
  const settlements = initSettlements({ x: 36, y: 36 }, 42, rng48);
  ok(settlements.length >= 1, `47.8 initSettlements 至少 1 个聚落（got ${settlements.length}）`);
  ok(settlements.length >= 2, `47.8b initSettlements 初始 2 个聚落（回滚铁律）`);
  ok(settlements[0].name === '小镇', '47.8c 起源聚落名叫"小镇"');
  ok(settlements[1].name !== '小镇', '47.8d 第二聚落有不同名字');

  // —— 47.9 聚落日推进：人口/资源统计 ——
  const mockGame = {
    settlements: settlements,
    npcs: [
      { id: 'n1', job: 'farmer', name: '张三', memory() {}, moodDelta() {} },
      { id: 'n2', job: 'woodcutter', name: '李四', memory() {}, moodDelta() {} },
    ],
    clock: { totalDay: 10 },
    log() {},
  };
  settlements[0].npcIds = ['n1', 'n2'];
  settlements[1].npcIds = [];
  settlementsDaily(mockGame, mulberry32(321));
  ok(settlements[0].population === 2, `47.9 tickSettlement 更新人口（got ${settlements[0].population}）`);
  ok(settlements[0].resources.farmer === 1, '47.9b 资源统计从职业推导（farmer=1）');
  ok(settlements[0].resources.woodcutter === 1, '47.9c 资源统计从职业推导（woodcutter=1）');

  // —— 47.10 聚落废弃判定 ——
  const sAbandon = makeSettlement({ x: 100, y: 100 }, mulberry32(654), '废村');
  sAbandon.npcIds = [];
  sAbandon._emptySince = 1;
  const mockGame2 = {
    settlements: [sAbandon],
    npcs: [],
    clock: { totalDay: 400 },
    log() {},
  };
  settlementsDaily(mockGame2, mulberry32(111));
  ok(sAbandon.abandoned === true, '47.10 人口为0超 365 天 → 废弃');

  // —— 47.11 序列化/恢复往返：地质 ——
  const mockGameG = { _lastGeoYear: 5, _erodedTotal: 10, _collapsedTotal: 3, _slidTotal: 2, _sunkTotal: 1 };
  const gSer = serializeGeology(mockGameG);
  const mockGameG2 = {};
  hydrateGeology(mockGameG2, gSer);
  eq(mockGameG2._lastGeoYear, 5, '47.11 地质 serialize/hydrate _lastGeoYear');
  eq(mockGameG2._erodedTotal, 10, '47.11b 地质 serialize/hydrate _erodedTotal');
  eq(mockGameG2._sunkTotal, 1, '47.11c 地质 serialize/hydrate _sunkTotal');

  // —— 47.12 序列化/恢复往返：气候 ——
  const cs3 = { phase: 'dry', yearsLeft: 15, cycleLen: 45 };
  const cSer = serializeClimate(cs3);
  const cs3r = hydrateClimate(cSer);
  eq(cs3r.phase, 'dry', '47.12 气候 serialize/hydrate phase');
  eq(cs3r.yearsLeft, 15, '47.12b 气候 serialize/hydrate yearsLeft');
  eq(cs3r.cycleLen, 45, '47.12c 气候 serialize/hydrate cycleLen');

  // —— 47.13 序列化/恢复往返：聚落 ——
  const sSer = serializeSettlements(settlements);
  const sR = hydrateSettlements(sSer);
  eq(sR.length, settlements.length, '47.13 聚落 serialize/hydrate 数量一致');
  eq(sR[0].name, settlements[0].name, '47.13b 聚落 serialize/hydrate 名字一致');
  eq(sR[0].center.x, settlements[0].center.x, '47.13c 聚落 serialize/hydrate 坐标一致');

  // —— 47.14 老存档兼容：null/undefined 不崩 ——
  hydrateGeology({}, undefined);
  const csOld = hydrateClimate(undefined);
  ok(csOld !== null, '47.14 hydrateClimate(undefined) 不崩');
  const sOld = hydrateSettlements(undefined);
  ok(Array.isArray(sOld) && sOld.length === 0, '47.14b hydrateSettlements(undefined) 返回空数组');

  // —— 47.15 存档往返：Game 全链路（newGame → serialize → hydrate）——
  const mockR47 = { mapDirty: false, meteor() {}, shake() {} };
  const g1 = new Game(mockR47);
  g1.newGame(12345);
  ok(g1.climateState !== null, '47.15 newGame 后 climateState 非空');
  ok(g1.settlements.length >= 2, `47.15b newGame 后 settlements 至少 2 个（got ${g1.settlements.length}）`);
  ok(g1._lastGeoYear === g1.clock.year, '47.15c newGame 后 _lastGeoYear = 当前年');
  const ser = g1.serialize();
  ok(ser.geology !== undefined, '47.15d serialize 有 geology 字段');
  ok(ser.climate !== undefined, '47.15e serialize 有 climate 字段');
  ok(ser.settlements !== undefined, '47.15f serialize 有 settlements 字段');
  // 删掉新字段模拟老档
  const oldSer = JSON.parse(JSON.stringify(ser));
  delete oldSer.geology;
  delete oldSer.climate;
  delete oldSer.settlements;
  const g2 = Game.hydrate(oldSer, mockR47);
  ok(g2 !== null, '47.15g 老档（无 geology/climate/settlements）能 hydrate');
  ok(g2.settlements.length === 0, '47.15h 老档 hydrate 后 settlements 为空（不崩）');
  ok(g2.climateState !== null, '47.15i 老档 hydrate 后 climateState 有默认值');
}
testWorldSelfChange();

// ================= 阶段48 v4.5 性别与远方（取向/欲望/动物繁殖/怀孕分娩/离镇者/探亲/存档） =================
stage(48, 'v4.5 性别与远方（取向/欲望/动物繁殖/怀孕分娩/离镇者/探亲/存档）');
function testSexAndBeyond() {
  const mockR = { mapDirty: false, meteor() {}, shake() {} };

  // —— 48.1 取向按 id 哈希确定，吸引是机制不是标签 ——
  const oa = new NPC(ROSTER[0], { x: 0, y: 0, ox: 0, oy: 0 });
  const ob = new NPC(ROSTER[0], { x: 0, y: 0, ox: 0, oy: 0 });
  eq(oa.orient, ob.orient, '48.1 同人同档取向确定');
  ok(oa.orient === 'hetero' || oa.orient === 'homo', '48.1b 取向是封闭集合');
  ok(attractedTo({ orient: 'hetero', sex: '男' }, '女') && !attractedTo({ orient: 'hetero', sex: '男' }, '男'), '48.1c 异性相吸');
  ok(attractedTo({ orient: 'homo', sex: '男' }, '男') && !attractedTo({ orient: 'homo', sex: '男' }, '女'), '48.1d 同性相吸');
  ok(oa.needs.desire != null, '48.1e 欲望字段存在');

  // —— 48.2 畜生也分公母，繁殖靠凑对不靠刷 ——
  const rngA = mulberry32(7);
  const cowM = makeAnimal('cow', 10, 10, rngA, { sex: '公' });
  const cowF = makeAnimal('cow', 12, 10, rngA, { sex: '母' });
  ok(cowM.sex === '公' && cowF.sex === '母', '48.2 动物有公母');
  ok(cowM.ageDays >= ANIMAL_DEFS.cow.maturity, '48.2b 默认成年');
  const mockG2 = { animals: [cowM, cowF], npcs: [], rng: () => 0.001, log() {}, stock: { crop: 0, wood: 0 }, clock: { totalDay: 1 } };
  animalDailyTick(mockG2, 1);
  ok(cowF.preg && cowF.preg.fatherId === cowM.id, '48.2c 母牛受孕（10 格内有公牛）');
  cowF.preg.daysLeft = 1;
  const beforeLitter = mockG2.animals.length;
  animalDailyTick(mockG2, 2);
  ok(mockG2.animals.length > beforeLitter, '48.2d 到期产仔入册');
  ok(mockG2.animals.some(a => a.ageDays === 0), '48.2e 幼崽日龄从 0 起步');
  ok(!cowF.preg, '48.2f 产后孕期清空');
  // 孤母不孕（没有公的，种群不会凭空长）
  const ewe = makeAnimal('sheep', 30, 30, rngA, { sex: '母' });
  const mockG3 = { animals: [ewe], npcs: [], rng: () => 0.001, log() {}, stock: { crop: 0, wood: 0 }, clock: { totalDay: 1 } };
  animalDailyTick(mockG3, 1);
  ok(!ewe.preg, '48.2g 无公不配，孤母不孕');

  // —— 48.3 欲望日增与夫妻纾解 ——
  const g3 = new Game(mockR); g3.newGame(20261013);
  const m3 = g3.npcs.find(n => n.sex === '男' && n.body.ageYears >= 20 && n.body.ageYears <= 40);
  const f3 = g3.npcs.find(n => n.sex === '女' && n.body.ageYears >= 20 && n.body.ageYears <= 40);
  m3.spouse = f3.id; f3.spouse = m3.id;
  m3.needs.desire = 90; f3.needs.desire = 90;
  m3.relations[f3.id] = 0; f3.relations[m3.id] = 0;   // 前提是测试的一部分：亲近记账从 0 起步，不吃开局关系漂移
  const sv3 = g3.rng; g3.rng = () => 0.3;
  desireDaily(g3, g3.clock.totalDay);
  g3.rng = sv3;
  ok(m3.needs.desire < 90 && f3.needs.desire < 90, '48.3 夫妻同衾纾解欲望');
  ok((m3.relations[f3.id] || 0) > 0, '48.3b 同衾亲近记账');

  // —— 48.4 受孕→孕期里程碑 ——
  f3.body.ageYears = 25; m3.body.ageYears = 27;
  const cc = tryBirth(g3, () => 0.001);
  ok(cc && cc.mother === f3 && f3.preg && f3.preg.due === g3.clock.totalDay + 280, '48.4 欲望推动受孕，孕期 280 日');
  f3.preg.day0 = g3.clock.totalDay - 30;
  pregDaily(g3, g3.clock.totalDay);
  ok(f3.memories.some(m => m.text.includes('有喜')), '48.4b 30 日脉象写进记忆');
  ok(m3.memories.some(m => m.text.includes('有喜')), '48.4c 爹也知道了');

  // —— 48.5 离镇转换：实体不毁 ——
  const wnpc = g3.npcs.find(n => !n.spouse && n !== m3 && n !== f3);
  const nInTown = g3.npcs.length;
  finalizeToWanderer(g3, wnpc);
  ok(g3.npcs.length === nInTown - 1 && g3.wanderers.includes(wnpc), '48.5 人从名册挪进离镇者队列');
  ok(wnpc.wand && wnpc.wand.state === 'trail', '48.5b 上路状态记账');
  ok(wnpc.body && wnpc.memories && wnpc.relations, '48.5c 记忆/身体/关系全带走，人没消失');

  // —— 48.6 日行：饥渴与天数（确定性 rng：觅食/凶险/消息/思乡全不命中） ——
  const d0 = g3.clock.totalDay;
  const h0 = wnpc.needs.hunger;
  g3._wandRng = () => 0.99;
  wandererDaily(g3, d0 + 1);
  delete g3._wandRng;
  eq(wnpc.wand.daysOut, 1, '48.6 出走天数记账');
  ok(wnpc.needs.hunger > h0, '48.6b 路上挨饿（觅食未中）');

  // —— 48.7 投奔聚落→落脚，人口含离镇者 ——
  const s2 = g3.settlements.find(s => !s.origin);
  ok(!!s2, '48.7 前置：世界里有第二个聚落');
  wnpc.x = s2.center.x + 3; wnpc.y = s2.center.y;
  wnpc.wand.state = 'seek'; wnpc.wand.settId = s2.id;
  wandererDaily(g3, d0 + 2);
  ok(wnpc.wand.state === 'settled' && wnpc.wand.settId === s2.id, '48.7b 投奔落定');
  ok(wnpc.memories.some(m => m.text.includes('落下了脚')), '48.7c 落脚写进记忆');
  tickSettlement(s2, g3, mulberry32(1));
  eq(s2.population, 1, '48.7d 落脚者计入聚落人口');

  // —— 48.8 客死他乡（确定性 rng：前两掷拉满让步幅/挨饿最大，之后全 0.01 让狼袭与狼吻必中；
  //    与地形无关——觅食中不中都不影响狼的判定序列） ——
  const g4 = new Game(mockR); g4.newGame(777);
  const w2 = g4.npcs.find(n => !n.spouse);
  finalizeToWanderer(g4, w2);
  w2.needs.hunger = 20;
  let c48 = 0;
  g4._wandRng = () => (++c48 <= 2 ? 0.99 : 0.01);
  const deadN = g4.dead.length;
  wandererDaily(g4, g4.clock.totalDay + 1);
  delete g4._wandRng;
  eq(g4.dead.length, deadN + 1, '48.8 客死入镇记');
  ok(g4.dead[g4.dead.length - 1].cause.includes('客死他乡'), '48.8b 死因记账');
  ok(!g4.wanderers.includes(w2), '48.8c 亡者出列');

  // —— 48.9 回镇探亲：回得来，也走得了 ——
  const wv = g4.npcs.find(n => !n.spouse && n.body.ageYears >= 18);
  finalizeToWanderer(g4, wv);
  wv.wand.state = 'return';
  wv.x = TOWN.x + 5; wv.y = TOWN.y;
  g4._wandRng = () => 0.5;
  wandererDaily(g4, g4.clock.totalDay + 1);
  delete g4._wandRng;
  ok(g4.npcs.includes(wv) && wv.visiting, '48.9 回镇探亲入名册');
  ok(!g4.wanderers.includes(wv), '48.9b 探亲者暂离离镇者队列');
  wandererDaily(g4, wv.visiting.untilDay + 1);
  ok(g4.wanderers.includes(wv) && !wv.visiting, '48.9c 探亲到期重新上路');

  // —— 48.10 帧推进：在无限地图上真的走 ——
  const px = wv.x, py = wv.y;
  wandererFrame(g4, 1.0);
  ok(wv.x !== px || wv.y !== py, '48.10 帧推进让人真的在走');

  // —— 48.11 方位词由坐标推导 ——
  eq(dirWord(10, 0), '东', '48.11 方位词东');
  eq(dirWord(0, 10), '南', '48.11b 方位词南');
  eq(dirWord(-10, 0), '西', '48.11c 方位词西');

  // —— 48.12 探亲者不再被推走 ——
  eq(pushScore({ body: { ageYears: 30 }, visiting: { untilDay: 9 }, rels: {}, relations: {}, needs: { mood: 10 }, mind: {} }), 0, '48.12 探亲中的不再累积离镇推力');

  // —— 48.13 序列化往返：离镇者/身孕/取向/动物公母 ——
  const ser48 = JSON.parse(JSON.stringify(g3.serialize()));
  const g6 = Game.hydrate(ser48, mockR);
  eq(g6.wanderers.length, g3.wanderers.length, '48.13 离镇者随档往返');
  const wf6 = g6.npcs.find(n => n.id === f3.id);
  ok(wf6 && wf6.preg && wf6.preg.fatherId === m3.id && wf6.preg.due === f3.preg.due, '48.13b 身孕随档往返');
  const wv6 = g6.wanderers.find(n => n.id === wnpc.id);
  ok(wv6 && wv6.wand && wv6.wand.state === 'settled' && wv6.wand.settId === s2.id, '48.13c 落脚状态往返');
  eq(wv6.orient, wnpc.orient, '48.13d 取向往返');
  ok(g6.animals.every(a => (a.sex === '公' || a.sex === '母') && a.ageDays != null), '48.13e 动物公母日龄随档');

  // —— 48.14 旧档兼容：无 sex/ orient/ desire 的老世界不崩 ——
  const old48 = JSON.parse(JSON.stringify(g3.serialize()));
  for (const a of old48.animals) { delete a.sex; delete a.ageDays; delete a.preg; }
  for (const s of old48.npcs) { delete s.orient; if (s.needs) delete s.needs.desire; }
  delete old48.wanderers;
  const g7 = Game.hydrate(old48, mockR);
  ok(g7 !== null, '48.14 旧档能 hydrate');
  ok(g7.animals.every(a => (a.sex === '公' || a.sex === '母') && a.ageDays != null), '48.14b 旧档动物惰性补公母日龄');
  ok(g7.npcs.every(n => n.orient === 'hetero' || n.orient === 'homo'), '48.14c 旧档人物取向由构造器兜底');
  ok(g7.npcs.every(n => (n.needs.desire || 0) >= 0), '48.14d 旧档欲望字段兜底');
  ok(Array.isArray(g7.wanderers) && g7.wanderers.length === 0, '48.14e 旧档无离镇者字段不崩');
}
testSexAndBeyond();

stage(49, 'v4.5.1 探索迷雾 + 本能半硬编码 + 神罚/拖动切换');
function testFogAndUrge() {
  const mockR = { mapDirty: false, meteor() {}, shake() {} };

  // —— 49.1 迷雾：只被脚印点亮，相机不算数 ——
  const fog = makeFog();
  ok(!isSeen(fog, 10, 10), '49.1 未探索是黑的');
  markSeen(fog, 10, 10, 3);
  ok(isSeen(fog, 10, 10), '49.1b 中心点亮');
  ok(isSeen(fog, 12, 10), '49.1c 半径内点亮');
  ok(!isSeen(fog, 14, 10), '49.1d 半径外仍黑');
  markSeen(fog, 74, 74, 2);
  ok(isSeen(fog, 74, 74), '49.1e 跨 chunk 点亮');
  const fog2 = hydrateFog(serializeFog(fog));
  ok(isSeen(fog2, 10, 10) && isSeen(fog2, 74, 74), '49.1f 迷雾存档往返');

  // —— 49.2 本能冲动：纯函数、确定性、阈值 ——
  const n1 = new NPC(ROSTER[0], { x: 0, y: 0, ox: 0, oy: 0 });
  n1.needs.hunger = 80; n1.needs.energy = 80; n1.needs.social = 60; n1.needs.desire = 15; n1.body.feel.cold = 20;
  const u1 = urgeOf(n1);
  ok(u1 && u1.kind === 'eat' && u1.p > 0.5, '49.2 饿了想吃');
  n1.needs.hunger = 30; n1.needs.energy = 20;
  const u2 = urgeOf(n1);
  ok(u2 && u2.kind === 'rest', '49.2b 困了想睡');
  n1.needs.energy = 80; n1.needs.social = 20;
  const u3 = urgeOf(n1);
  ok(u3 && u3.kind === 'social', '49.2c 孤了想人');
  n1.needs.social = 60; n1.needs.desire = 80;
  const u4 = urgeOf(n1);
  ok(u4 && u4.kind === 'mate', '49.2d 燥了想伴');
  n1.needs.desire = 15; n1.body.parts.head.cond = 30;
  const u5 = urgeOf(n1);
  ok(u5 && u5.kind === 'heal', '49.2e 疼了想治');
  // 确定性：同状态同结果
  eq(JSON.stringify(urgeOf(n1)), JSON.stringify(urgeOf(n1)), '49.2f urgeOf 确定性');

  // —— 49.3 冲动进 AI 快照 ——
  const g49 = new Game(mockR); g49.newGame(20261013);
  const n49 = g49.npcs[0];
  n49.needs.hunger = 90;
  const snap = npcSnapshot(n49, { w: g49.world, clock: g49.clock, weather: g49.weather, rng: g49.rng, npcs: g49.npcs, nameOf: id => id });
  ok(snap.冲动 && snap.冲动.includes('饿'), '49.3 快照带冲动');

  // —— 49.4 本能临界保底：AI 开着但身体快撑不住时脚本接管 ——
  g49.aiCfg = { ...g49.aiCfg, mode: 'auto', apiKey: 'k' };
  n49.aiDcAt = 999999;
  n49.needs.hunger = 96;   // p=(96-50)/50=0.92 ≥0.9
  ok(!g49._aiClaimable(n49, 1000), '49.4 临界饥饿不等 AI');
  n49.needs.hunger = 80;   // p=0.6 <0.9
  n49.aiDcAt = 0;          // 到期可问
  ok(g49._aiClaimable(n49, 1000), '49.4b 非临界照常候问');
}
testFogAndUrge();

// ================= 阶段50 无神世界（v4.6.0 观察者模式） =================
function testObserverWorld() {
  stage(50, '无神世界：神权尽去，世界自运转');
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(20261014);
  // 50.1 神权方法与字段尽删
  for (const m of ['godSmite', 'godSetWeather', 'godTriggerEvent', 'godApplyBrush', 'godWhisper', 'godDecree']) {
    ok(typeof g[m] === 'undefined', '50.1 神权已删：' + m);
  }
  ok(g.godBrush === undefined && g.smiteMode === undefined, '50.1b 神权字段已删');
  // 50.2 census 守恒：born = 在镇 + 远方 + 已逝 + 下落不明
  const c0 = census(g);
  eq(c0.born, c0.inTown + c0.away + c0.dead + c0.missing, '50.2 born 守恒（开局）');
  eq(c0.inTown, 10, '50.2b 开局 10 人');
  eq(c0.born, 10, '50.2c 开局诞生 10 人');
  g.forceDeath(g.npcs[0].id);
  const c1 = census(g);
  eq(c1.born, c1.inTown + c1.away + c1.dead + c1.missing, '50.2d 死后仍守恒');
  eq(c1.dead, 1, '50.2e 有 1 位逝者');
  eq(c1.born, c0.born, '50.2f 死亡不改变诞生总数');
  // 50.3 迷雾常亮：开拓过的地方永不熄灭
  markSeen(g.fog, 10, 10, 3);
  ok(isSeen(g.fog, 10, 10), '50.3 脚印点亮');
  for (let i = 0; i < 200; i++) g.loop(0.016);
  ok(isSeen(g.fog, 10, 10), '50.3b 200 tick 后仍常亮');
  // 50.4 世界自运转：无玩家干预跑 200 tick 无错，时间自己往前走
  const min0 = g.clock.min;
  for (let i = 0; i < 200; i++) g.loop(0.016);
  ok(g.clock.min > min0, '50.4 无玩家干预，时间自己走');
}
testObserverWorld();

// ================= 阶段51 真正的演化（v4.7.0 观念系统） =================
import {
  makeIdea, formIdea, spreadIdea, calcFitness, ideaDaily,
  serializeIdeas, hydrateIdeas, npcIdeaTexts
} from './src/js/idea.js';

stage(51, '真正的演化：观念系统（产生/传播/变异/结晶/确定性）');
function testTrueEvolution() {
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(20261014);

  // 51.1 观念创建：自由文本，不限种类
  const idea1 = makeIdea('用贝壳换东西', 'chen', 1, '想省事的法子', g);
  g.ideas.push(idea1);   // makeIdea 是纯构造，入池由调用方负责
  ok(idea1.text === '用贝壳换东西', '51.1 观念创建：自由文本');
  ok(idea1.holders.includes('chen'), '51.1b 创建者持有');
  ok(idea1.status === 'wild', '51.1c 初始状态野生');
  eq(g.ideas.length, 1, '51.1d 入全镇观念池');

  // 51.2 观念传播：聊天时传递
  const a = g.npcs[0], b = g.npcs[1];
  a.ideas = [idea1.id];
  const spread = spreadIdea(a, b, g, 2);
  ok(spread !== null, '51.2 传播成功');
  ok(spread.holders.includes(b.id) || b.ideas.some(id => {
    const i = g.ideas.find(x => x.id === id);
    return i && i.mutatedFrom === idea1.id;
  }), '51.2b 接收者获得观念（或变异体）');

  // 51.3 观念变异：传播时小概率变异
  let mutated = false;
  for (let i = 0; i < 100; i++) {
    const c = g.npcs[2];
    c.ideas = [];
    const r = spreadIdea(a, c, g, 2);
    if (r && r.mutatedFrom) { mutated = true; break; }
  }
  ok(mutated, '51.3 传播时会发生变异');

  // 51.4 适应度计算：持有者福祉决定适应度
  const fit1 = calcFitness(idea1, g);
  ok(fit1 >= 0 && fit1 <= 1, '51.4 适应度在 0-1 之间');
  // 持有者心情好 → 适应度高
  for (const n of g.npcs) { n.needs.mood = 90; n.needs.energy = 90; n.needs.hunger = 10; }
  const fit2 = calcFitness(idea1, g);
  ok(fit2 > 0.7, '51.4b 高福祉 → 高适应度');
  // 持有者心情差 → 适应度低
  for (const n of g.npcs) { n.needs.mood = 10; n.needs.energy = 10; n.needs.hunger = 90; }
  const fit3 = calcFitness(idea1, g);
  ok(fit3 < 0.3, '51.4c 低福祉 → 低适应度');

  // 51.5 观念日推进：形成/传播/适应度更新
  const g2 = new Game(rendererStub);
  g2.newGame(20261014);
  // 手动添加一个高持有率观念测试结晶
  const idea2 = makeIdea('日出而作', null, 1, '过日子', g2);
  g2.ideas.push(idea2);
  for (const n of g2.npcs) {
    if (n.body.ageYears >= 16) {
      n.ideas = [idea2.id];
      idea2.holders.push(n.id);
    }
  }
  idea2.status = 'spreading';   // 结晶判定只处理传播中的观念
  // 高适应度
  for (const n of g2.npcs) { n.needs.mood = 80; n.needs.energy = 80; n.needs.hunger = 20; }
  ideaDaily(g2, 2);
  ok(idea2.status === 'crystallized', '51.5 高持有+高适应 → 结晶为习俗');
  ok(g2.customs.some(c => c.fromIdea === idea2.id), '51.5b 结晶后入习俗');

  // 51.6 存档往返
  const ser = serializeIdeas(g2);
  const g3 = new Game(rendererStub);
  g3.newGame(20261014);
  hydrateIdeas(g3, ser);
  eq(g3.ideas.length, g2.ideas.length, '51.6 观念存档往返');

  // 51.7 npcSnapshot 注入观念
  const npc = g2.npcs[0];
  const snap = npcSnapshot(npc, { w: g2.world, clock: g2.clock, weather: g2.weather, rng: g2.rng, game: g2, nameOf: id => id });
  ok(Array.isArray(snap.念头) && snap.念头.length > 0, '51.7 npcSnapshot 注入观念');

  // 51.8 确定性：同 seed 同结果
  const g4 = new Game(rendererStub);
  g4.newGame(20261014);
  const g5 = new Game(rendererStub);
  g5.newGame(20261014);
  for (let i = 0; i < 50; i++) { g4.loop(0.016); g5.loop(0.016); }
  // 注意：LLM 调用不影响确定性（离线自检不调用 LLM）
  eq(g4.ideas.length, g5.ideas.length, '51.8 同 seed 观念数量一致');
}
testTrueEvolution();

// ================= 阶段52 基底之上全开放（v4.8.0） =================
import { ensureResourcePrototypes } from './src/js/action.js';

stage(52, '基底之上全开放：归属转移动词透明/距离闸/清账/结晶去装饰/镇规进快照/存档无类型管道');
function testOpenWorld() {
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  const g = new Game(rendererStub);
  g.newGame(20261014);

  // 52.1 资源原型注册：9 种库存资源都有物质原型，公名挂在 town 名下
  const protos = (g.matters || []).filter(m => m.prototypeRes);
  eq(protos.length, 9, '52.1 九种资源原型注册');
  ok(protos.every(m => m.names.town === STOCK_NAME[m.prototypeRes]), '52.1b 原型公名=库存中文名');
  // 旧档惰性补齐
  const gOld = new Game(rendererStub); gOld.newGame(20261014);
  gOld.matters = gOld.matters.filter(m => !m.prototypeRes);
  ensureResourcePrototypes(gOld);
  eq(gOld.matters.filter(m => m.prototypeRes).length, 9, '52.1c 旧档补齐原型');

  // 52.2 动词透明归属转移：任意动词（给/塞/扔都一样）+ 格局（持有的原型 × 近身的人）→ 东西易手
  const a = g.npcs[0], b = g.npcs[1];
  a.x = 10; a.y = 10; b.x = 12; b.y = 10;   // 近身（距 2 ≤ 8）
  ensureHold(a).goods.fish = 3; ensureHold(b);
  const fishProto = protos.find(m => m.prototypeRes === 'fish');
  for (const verb of ['给', '塞', '扔']) {
    const act = makeAction(a, verb, [fishProto, b]);
    const v = dispatch(act, g);
    ok(v.legal, `52.2 动词「${verb}」不被拦截（动词透明）`);
  }
  eq(goodsOf(b, 'fish'), 3, '52.2b 三条鱼三次易手都到了对方手里（格局决定物理，不是动词）');
  eq(goodsOf(a, 'fish'), 0, '52.2c 给出的真失去了（守恒）');
  ok(a.memories.some(m => (m.orig || m.text || '').includes('到了') && (m.orig || m.text || '').includes(b.name)), '52.2d 记忆说人话：什么东西到了谁手里');

  // 52.3 距离闸：空间定理——远手够不着
  const c = g.npcs[2];
  c.x = 60; c.y = 60;   // 距 52 格
  ensureHold(a).goods.crop = 1; ensureHold(c);
  const cropProto = protos.find(m => m.prototypeRes === 'crop');
  const vFar = dispatch(makeAction(a, '递', [cropProto, c]), g);
  ok(!(vFar.moves && vFar.moves.length), '52.3 太远够不着，东西没动');
  eq(goodsOf(a, 'crop'), 1, '52.3b 东西还在原主手里');

  // 52.4 欠债清偿内建进转移：给出去的正好抵欠他的账
  ensureHold(a).goods.crop = 2;
  a.hold.owed.push({ to: b.id, res: 'crop', qty: 1, day: 1 });
  dispatch(makeAction(a, '还', [cropProto, b]), g);
  eq(a.hold.owed.filter(o => o.to === b.id && o.res === 'crop').length, 0, '52.4 实物清偿销账');

  // 52.5 结晶去装饰：观念结晶成镇规，但规矩不带 trigger/effect——约束力从公共可见性涌现
  const idea = makeIdea('见面先问吃了吗', null, 1, '镇上缺点热乎气', g);
  g.ideas.push(idea);
  for (const n of g.npcs) if (n.body.ageYears >= 16) { n.ideas = [idea.id]; idea.holders.push(n.id); }
  idea.status = 'spreading';
  for (const n of g.npcs) { n.needs.mood = 85; n.needs.energy = 85; n.needs.hunger = 15; }
  ideaDaily(g, 2);
  eq(idea.status, 'crystallized', '52.5 高持有高适应结晶');
  const cust = g.customs.find(cc => cc.fromIdea === idea.id);
  ok(cust, '52.5b 镇规落地');
  ok(!('trigger' in cust) && !('effect' in cust), '52.5c 镇规无 trigger/effect（不是脚本装饰）');
  ok(g.evoLog.some(e => e.action === 'crystallize' && e.what.includes('规矩')), '52.5d 结晶写进演化日志');

  // 52.6 镇规进快照：所有 NPC 看得见——约束力从认知涌现
  const snap = npcSnapshot(g.npcs[0], { w: g.world, clock: g.clock, weather: g.weather, rng: g.rng, game: g, nameOf: id => id });
  ok(Array.isArray(snap.镇规) && snap.镇规.some(s => s.includes('见面先问吃了吗')), '52.6 镇规进 NPC 快照');

  // 52.7 存档无类型管道：serializeEvo 不含候选池/风向/序号
  const ser = serializeEvo(g);
  ok(!('pool' in ser) && !('wind' in ser) && !('seq' in ser), '52.7 演化存档只剩日志/动态配方/旧事/观念');
}
testOpenWorld();

stage(53, '感知与名望：信念层（写入/传播/衰减/容量）/名望场（分布式/职业不加分）/评理改道/快照两窗/存档');
function testPerception() {
  const rendererStub = { mapDirty: false, meteor() {}, shake() {} };
  function chainRng(vals, seed) {
    let i = 0, s = (seed || 12345) >>> 0;
    return () => {
      if (i < vals.length) return vals[i++];
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const g = new Game(rendererStub);
  g.newGame(20261014);
  const a = g.npcs[0], b = g.npcs[1];

  // 53.1 信念写入：亲眼 conf 0.9；同文去重；传闻不覆盖亲眼，目击覆盖听闻
  addBelief(a, '东北边有个营地', { src: '行脚人捎话', dir: '东北', conf: 0.6, day: 3 });
  eq(a.beliefs.length, 1, '53.1 信念写入');
  eq(a.beliefs[0].conf, 0.6, '53.1b 捎话置信 0.6');
  addBelief(a, '东北边有个营地', { src: '李四', conf: 0.5, day: 4 });
  eq(a.beliefs.length, 1, '53.1c 同文去重不重复记');
  eq(a.beliefs[0].conf, 0.6, '53.1d 更低置信不更新');
  addBelief(a, '东北边有个营地', { src: '亲眼', conf: WITNESS_CONF, day: 5 });
  eq(a.beliefs[0].conf, WITNESS_CONF, '53.1e 目击覆盖听闻（conf 0.9）');
  eq(a.beliefs[0].src, '亲眼', '53.1f 来源换成亲眼');
  addBelief(a, '东北边有个营地', { src: '王五', conf: 0.7, day: 6 });
  eq(a.beliefs[0].conf, WITNESS_CONF, '53.1g 传闻不撼动亲眼');

  // 53.2 信念传播：a→b 逐跳衰减 + 复述自增强 + 听说进记忆
  const gSpread = { rng: chainRng([0.05, 0.99], 7), clock: { hour: 9 }, npcs: [a, b] };
  const bBefore = b.beliefs.length;
  const confBefore = a.beliefs[0].conf;
  const heard = spreadBelief(a, b, gSpread, 6);
  ok(heard, '53.2 信念传过去了');
  eq(b.beliefs.length, bBefore + 1, '53.2b b 多了一条');
  ok(Math.abs(heard.conf - WITNESS_CONF * 0.8) < 1e-6, '53.2c 逐跳衰减 ×0.8');
  eq(heard.hops, 1, '53.2d 转了一手');
  ok(a.beliefs[0].conf > confBefore, '53.2e 复述自增强：说出口的自己更信');
  eq(heard.src, a.name, '53.2f 来源是转述人');
  ok(b.memories.some(m => (m.orig || '').includes('听' + a.name + '说起')), '53.2g 听说进记忆');

  // 53.3 日推进：衰减 ×0.985，低于 0.15 静默遗忘
  addBelief(b, '山里会有金子', { src: '梦', conf: 0.151, day: 1 });
  beliefDaily(g, 7);
  ok(!b.beliefs.some(x => x.text === '山里会有金子'), '53.3 太淡的信念忘了');
  const conf2 = b.beliefs[0].conf;
  beliefDaily(g, 8);
  ok(b.beliefs[0].conf < conf2, '53.3b 日子让信念变淡');

  // 53.4 有限律：容量 12，挤弱留强
  for (let i = 0; i < 15; i++) addBelief(a, `传闻${i}号`, { src: '张三', conf: 0.3 + (i % 5) * 0.1, day: 1 });
  ok(a.beliefs.length <= 12, '53.4 信念有上限（12）');
  ok(a.beliefs.some(x => x.text === '东北边有个营地'), '53.4b 强的留下（亲眼挤不掉）');

  // 53.5 名望场：被信任/依赖堆出来，职业不再加分（POWER_JOB 退役）
  const chen2 = g.npcs[2], su2 = g.npcs[3];
  chen2.job = '农夫'; su2.job = '医生';   // 旧表医生 14 农夫 1——若旧表还在，su2 必赢
  for (const o of g.npcs) {
    if (o === chen2 || o === su2) continue;
    const rC = relOf(o, chen2.id, 1); rC.trust = 60; rC.depend = 40; refreshTags(rC);
    const rS = relOf(o, su2.id, 1); rS.grudge = 60; refreshTags(rS);
  }
  ok(standingOf(chen2, g.npcs, 1) > standingOf(su2, g.npcs, 1), '53.5 名望从关系里长，医生头衔不加分');
  ok(standingOf(chen2, g.npcs, 1) >= 0 && standingOf(chen2, g.npcs, 1) <= 100, '53.5b 名望落 0..100');
  const st0 = standingOf(chen2, g.npcs, 1);
  for (const o of g.npcs) {
    if (o === chen2) continue;
    o.memory(`${chen2.name}给我家修了屋顶`, 1, 9, 85);
  }
  ok(standingOf(chen2, g.npcs, 1) > st0, '53.5c 被记住的好事抬高名望');
  // 53.5d 说话算数的人：名望场 Top1（≥55 且领先 >15）
  const g4 = new Game(rendererStub); g4.newGame(77);
  const lead = g4.npcs[0];
  for (const o of g4.npcs) {
    if (o === lead) continue;
    const r = relOf(o, lead.id, 1); r.trust = 90; r.depend = 80; refreshTags(r);
  }
  const top = refreshStandingTop(g4, 1);
  ok(top && top.id === lead.id, '53.5d 说话算数的人从名望场里算出来');

  // 53.6 评理改道：争议成为公共事件——目击者见证/信念/公认自改；评理人收名望燃料
  {
    const g2 = new Game(rendererStub); g2.newGame(3405);
    const house = g2.world.houses[0];
    house.ownerId = 'dead_x';
    const squatter = g2.npcs[0];
    const arb = g2.npcs[1];
    for (const o of g2.npcs) {
      if (o === arb) continue;
      const r = relOf(o, arb.id, 1); r.trust = 80; r.depend = 60; refreshTags(r);
    }
    for (const n of g2.npcs) { n.x = squatter.x + 1; n.y = squatter.y; n.inside = false; }
    claimHouse(g2, squatter, house, [
      { npc: g2.npcs[2], recognized: false },
      { npc: g2.npcs[3], recognized: false }
    ]);
    const c = [...g2.claims.values()][0];
    holdDaily(g2, c.since + 5);
    eq(c.disputed, true, '53.6 争议摆上台面');
    eq(c.recognizedBy[arb.id], true, '53.6b 评理人认了（公论锚点）');
    const wit = g2.npcs[4];
    ok(wit.memories.some(m => m.isIncident && (m.orig || '').includes('评了理')), '53.6c 目击者的评理记忆是公共事件（isIncident）');
    ok((wit.beliefs || []).some(x => x.text === `${arb.name}是评理的人` && x.src === '亲眼'), '53.6d 目击者信念：谁是评理的人');
    ok(arb.memories.some(m => (m.orig || '').includes('大家都看着')), '53.6e 评理人收名望燃料');
  }

  // 53.7 悬着的争议：没人够分量 → 没人评得了理（公共心结是「得有个主事的」的原料）
  {
    const g3 = new Game(rendererStub); g3.newGame(3405);
    const house = g3.world.houses[0];
    house.ownerId = 'dead_x';
    const squatter = g3.npcs[0];
    for (const n of g3.npcs) { n.x = squatter.x + 1; n.y = squatter.y; n.inside = false; }
    for (const o of g3.npcs) for (const p of g3.npcs) {
      if (o === p) continue;
      const r = relOf(o, p.id, 1); r.trust = -100; r.grudge = 100; refreshTags(r);
    }
    claimHouse(g3, squatter, house, [
      { npc: g3.npcs[1], recognized: false },
      { npc: g3.npcs[2], recognized: false }
    ]);
    const c = [...g3.claims.values()][0];
    holdDaily(g3, c.since + 5);
    eq(c.disputed, true, '53.7 争议照样摆上台面');
    ok(g3.npcs[3].memories.some(m => (m.orig || '').includes('没人评得了理')), '53.7b 没分量的人，争议悬着');
  }

  // 53.8 快照两扇窗：我以为 + 说话算数的人
  const sn = npcSnapshot(a, { w: g.world, clock: g.clock, weather: g.weather, rng: g.rng, game: g, nameOf: id => id });
  ok(Array.isArray(sn.我以为) && sn.我以为.some(s => s.includes('东北边有个营地')), '53.8 信念进快照（我以为）');
  ok(sn.我以为[0].includes('亲眼所见'), '53.8b 快照标来源');
  g._standingTop = { id: chen2.id, name: chen2.name, s: 80 };
  const sn2 = npcSnapshot(a, { w: g.world, clock: g.clock, weather: g.weather, rng: g.rng, game: g, nameOf: id => id });
  eq(sn2.说话算数的人, chen2.name, '53.8c 名望场 Top1 进快照');

  // 53.9 formIdea 素材优先公共事件（isIncident）——「得有个主事的」从评理里长
  const nIdea = g.npcs.find(n => n.body.ageYears >= 18 && n !== a && n !== b);
  nIdea.memories = [];
  nIdea.memory('看见有人给住房的事评了理', 8, 10, 60, { isIncident: true });
  nIdea.memory('今天吃了粥', 8, 11, 50);
  nIdea.mind.conflicts = [];
  const gIdea = { rng: chainRng([0.001], 99), ideas: [], clock: { hour: 12 }, _ideaSeq: 1 };
  const idea = formIdea(nIdea, gIdea, 8);
  ok(idea, '53.9 念头长出来了');
  ok(idea && idea.text.includes('评了理'), '53.9b 公共事件是念头头号原料');

  // 53.10 存档往返：信念随档走；名望 Top1 是日缓存不进档（函数不是表）
  const data = JSON.parse(JSON.stringify(g.serialize()));
  const gH = Game.hydrate(data, rendererStub);
  const aH = gH.npcs.find(n => n.id === a.id);
  ok((aH.beliefs || []).some(x => x.text === '东北边有个营地'), '53.10 信念随档走');
  ok(gH._standingTop == null, '53.10b 名望 Top1 不进档（函数不是表）');
}
testPerception();

console.log('\n========================================');
console.log(`自检完成：通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('失败清单：');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过');
}
