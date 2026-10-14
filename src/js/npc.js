// npc.js - 居民：属性/需求/日程/脚本AI/移动/记忆/关系/感知/快照（环境无关，供渲染层与 selftest 共用）
import { O, G, clamp, rint, choice, chance, fmtClock, mulberry32, STOCK_NAME, MINEABLE, CHOPPABLE, GATHER_OBJS, MAT, motionFor, motionForObj, motionOf } from './core.js';
import { findPath, harvestObj, nameAt, randPointInArea, findObjInArea, nearestObjAround, walkable } from './world.js';
import { worldToChunk, chunkOrigin, localIdx, getGround, getObj, chunkHas } from './chunk.js';
import { makeBody, bodyConstraints, bodyDailyTick, feelTarget, bodySummary, injure, INJURY_TABLE } from './body.js';
import { craftableRecipes, skillMulFor } from './develop.js';
import { makeMemory, recentMemories } from './memory.js';
import {
  makeMind, attachCrush, perturbConflicts, dominantConflict, probeSecret, tellLie,
  leakTo, slipHint, gossip, crushGaze, attractedTo
} from './secret.js';
import { decorateSay, tabooHit, hashStr } from './language.js';
import { pickLex } from './lexicon.js';
import { stageOf, decideChild, isKid, elderConfusedSay } from './life.js';
import {
  ensureRels, relOf, touchChat, quarrel, reconcile, tryMediate, spreadCustoms, powerOf, pickArbiter
} from './social.js';
import { recordIntent } from './history.js';
import { npcEarn, holdPairTick, eatFromHold, ensureHold } from './hold.js';
import { neuroWorkIdle, neuroTail } from './neurocore.js';
import { makeAction, dispatch, resolveTargets, OPEN_ACTIONS } from './action.js';
import { spreadIdea } from './idea.js';
import { spreadBelief } from './belief.js';

// ---------- 居民名册 ----------
// 白纸开局（v2.7.0）：种子居民没有职业、没有手艺——职业是学会手艺的果，不是因。
// 十人只带身体/性格/外貌，活计全部由演化长出（第一个学会一门手艺的人自动成为干这活的人）。
export const ROSTER = [
  { id: 'chen',  name: '陈麦冬', sex: '男', age: 32, job: '', workArea: '', traits: ['勤恳', '话少'],   hair: '#3b2f2a', shirt: '#7a9e4f', pers: '沉稳寡言，把庄稼当自己的孩子' },
  { id: 'lin',   name: '林小满', sex: '女', age: 24, job: '', workArea: '', traits: ['爽朗', '爱唱歌'], hair: '#6b3b1f', shirt: '#c76b3a', pers: '热情爽利，干活时总哼小调' },
  { id: 'zhao',  name: '赵铁山', sex: '男', age: 41, job: '', workArea: '', traits: ['暴躁', '重情义'], hair: '#1f1f1f', shirt: '#5a5f6b', pers: '脾气冲但护短，敲铁的时候最平静' },
  { id: 'zhou',  name: '周大樵', sex: '男', age: 29, job: '', workArea: '', traits: ['憨厚', '力大'],   hair: '#2e2a24', shirt: '#8b6f47', pers: '话不多，一笑就脸红' },
  { id: 'wu',    name: '吴渔歌', sex: '女', age: 26, job: '', workArea: '', traits: ['安静', '细心'],   hair: '#14181f', shirt: '#4a7d8c', pers: '喜欢独处，懂得河水的脾气' },
  { id: 'zheng', name: '郑掌柜', sex: '男', age: 52, job: '', workArea: '', traits: ['精明', '热心'],   hair: '#4a3826', shirt: '#9c4f43', pers: '镇上消息最灵通的人，算账飞快' },
  { id: 'wang',  name: '王绣',   sex: '女', age: 34, job: '', workArea: '', traits: ['温柔', '手巧'],   hair: '#7d4a2b', shirt: '#b08968', pers: '谁家有事都帮一把，做的汤整条街香' },
  { id: 'feng',  name: '冯小明', sex: '男', age: 12, job: '', workArea: '', traits: ['好奇', '淘气'],   hair: '#26201a', shirt: '#5f7d5a', pers: '天不怕地不怕，就怕何大夫的戒尺' },
  { id: 'he',    name: '何老',   sex: '男', age: 68, job: '', workArea: '', traits: ['严谨', '毒舌'],   hair: '#c8c8c8', shirt: '#6e8b9e', pers: '嘴上不饶人，药箱从不离手' },
  { id: 'su',    name: '苏吟',   sex: '女', age: 27, job: '', workArea: '', traits: ['忧郁', '浪漫'],   hair: '#1a1420', shirt: '#757d8c', pers: '总在寻找别人看不见的美' }
];

// 各职业工作窗口 [开始小时, 结束小时]（含午休由决策层处理）
const WORK_HOURS = {
  '农夫': [[6, 12], [13, 19]],
  '铁匠': [[8, 12], [13, 17]],
  '樵夫': [[7, 12], [13, 17]],
  '渔夫': [[6, 11], [13, 18]],
  '商人': [[8, 12], [13, 18]],
  '厨子': [[6, 9], [11, 13], [16, 19]],
  '学生': [[9, 11], [14, 16]],
  '医生': [[8, 11], [14, 17]],
  '诗人': [[10, 12], [14, 17]]
};
const SHELTER_HOUSES = ['zheng', 'wang'];  // 公共庇护：商店/饭馆

export class NPC {
  constructor(def, house, lex) {
    this.id = def.id; this.name = def.name; this.sex = def.sex;
    this.job = def.job; this.workArea = def.workArea;
    this.traits = [...def.traits]; this.pers = def.pers;
    this.hair = def.hair; this.shirt = def.shirt;
    this.home = house ? { x: house.ox, y: house.oy, doorX: house.doorX, doorY: house.doorY, hx: house.x, hy: house.y } : null;
    this.x = this.home ? this.home.x : 36; this.y = this.home ? this.home.y : 26;
    this.dir = 0;               // 0下1上2左3右（渲染朝向）
    this.path = [];             // [[x,y],...]
    this.inside = false;        // 进屋后不渲染
    this.intent = { type: 'idle', label: '发呆', untilMin: 0, reason: '', source: 'boot' };
    this.workTarget = null;     // 工作目标地块
    this.bubble = null;         // {text, untilReal}
    // —— v2.8.0 按需触发：各活各的，不再全镇同步被叫醒 ——
    this.aiDcAt = 0;            // 个人下次可问 LLM 的时刻（绝对游戏分钟）；0=未初始化（newGame/hydrate 错开）
    this.aiAsking = false;      // 已入候问/决策在途（防重复入队）；不存档，读档强制清零
    this.needs = { energy: 80, hunger: 30, social: 60, mood: 60, desire: 15 };   // v4.5.0 性别层：欲望是第五种需求
    // —— v4.5.0 性别层 —— 取向（id 定终身，与暗恋同法）；preg=怀孕状态（女，null=未孕）
    this.orient = mulberry32(hashStr(def.id + '|orient'))() < 0.9 ? 'hetero' : 'homo';
    // 远方命：天生的不安分（0..1，id 哈希定终身，不占骰流）——越高，牵挂要越深才拴得住；
    // 心安也拴不住的那一小撮人（>0.85），日子再好，心里也长着远方
    this.wanderlust = def.wanderlust != null ? def.wanderlust : mulberry32(hashStr(def.id + '|wl'))();
    this.preg = null;
    this.relations = {};        // npcId -> -100..100
    this.memories = [];         // {d:总日, t:'08:30', text}
    this.chatCd = {};           // npcId -> 现实秒冷却
    this.brave = def.traits.includes('好奇') || def.traits.includes('暴躁');
    // —— v1.5.0 生命层 —— 家族/伴侣/病榻（血亲是葬礼与遗传的骨架）
    this.family = { parents: def.family ? [...def.family.parents] : [], childIds: [] };
    this.spouse = null;
    this.dying = null;
    // —— v1.3.0 地基层 ——
    this.body = makeBody(def.id, def.age);   // 身体：部位/劳损/旧伤/病痛/感受
    // —— v1.4.0 认知层 —— 秘密/表演/矛盾/语言（秘密层永不进 prompt，只通过行为体现）
    this.mind = makeMind(def, lex);
    attachCrush(this, ROSTER.filter(o => o.id !== def.id));
    this._perceiveLog = [];     // 最近感知（可序列化的纯数据，进快照）
    this.beliefs = [];          // v4.9.0 信念层：我以为的世界（允许错误与过时，随档走）
    this._workMinToday = 0;     // 今日工作分钟（身体日tick算劳损用）
    this._dayIntents = 0;       // 今日外部意图计数（契约单日上限）
    // —— v4.3 知识层 —— 知识与记忆分离：记忆是"经历过什么"，知识是"从经历中得出什么"
    this.knowledgeList = [];     // 知识索引（独立的，不挤占 memories 上限 40）
    // —— v4.7.0 观念层 —— 观念索引（独立的，不挤占 memories 上限 40）
    this.ideas = [];             // 持有的观念 id 列表
    for (const other of ROSTER) {
      if (other.id !== def.id) this.relations[other.id] = rint(mulberry32(hashStr(def.id + '|rel|' + other.id)), -5, 15);   // 开局关系按对人哈希定终身：同 seed 必须跑出同一个世界（D34）
    }
    // —— v1.6.0 社会层 —— 关系是独立对象（单向存储；relations 数值留作 bond 缓存供旧链路使用）
    ensureRels(this, 0);
  }

  memory(text, totalDay, hour, mood, opts) {
    // mood 为事件发生时的心情；不传则取当前心情。记忆带 valence，回忆时会被当前情绪染色
    // opts.isIncident（v4.2 发现层）：标记为意外记忆，recentMemories 检索时优先
    const m = makeMemory(text, totalDay, hour, mood != null ? mood : this.needs.mood, opts);
    this.memories.push(m);
    if (this.memories.length > 40) this.memories.splice(0, this.memories.length - 40);
  }
  // 感知：看见/听见/闻到/觉得——写记忆 + 记进感知日志（理由命脉的一部分）
  perceive(kind, text, totalDay, hour, mood, opts) {
    const mark = { see: '看见', hear: '听见', smell: '闻到', feel: '觉得' }[kind] || '感到';
    this.memory(mark + text, totalDay, hour, mood != null ? this.needs.mood + mood : this.needs.mood, opts);
    this._perceiveLog.push(mark + text);
    if (this._perceiveLog.length > 3) this._perceiveLog.shift();
    if (mood) this.moodDelta(mood);
  }
  say(text, nowReal, opts) {
    // 出口经语言层：口头禅/方言（第八章——语言是身份，不是贴皮）；anger=变脸
    const t = decorateSay(this, String(text), opts && opts.rng);
    this.bubble = { text: t.slice(0, 40), untilReal: nowReal + 5, anger: !!(opts && opts.anger) };
  }
  moodDelta(n, why, totalDay, hour) {
    this.needs.mood = clamp(this.needs.mood + n, 0, 100);
    if (Math.abs(n) >= 4 && this.mind) perturbConflicts(this.mind, n);   // 大事让矛盾的天平晃一晃
    if (why) this.memory(why + (n >= 0 ? '（心情变好）' : '（心情变差）'), totalDay, hour);
  }

  currentArea(w) { return nameAt(w, Math.floor(this.x), Math.floor(this.y)); }
  isWorking() { return this.intent.type === 'work'; }

  // ---------- 意图设置 ----------
  setGoto(w, tx, ty, then, label) {
    // 目标 chunk 若未生成 → 先 ensure（让寻路能在新生成区域内找到路）
    const [tcx, tcy] = worldToChunk(tx, ty);
    if (!w.ws.has(tcx, tcy)) w.ws.ensure(tcx, tcy);
    const p = findPath(w, Math.floor(this.x), Math.floor(this.y), tx, ty);
    if (!p) return false;
    this.path = p;
    this.intent = { type: 'goto', tx, ty, then: then || null, label: label || '前往' + nameAt(w, tx, ty), reason: label || '', source: 'script' };
    return true;
  }
  setGotoArea(w, areaId, rng, then, label) {
    const pt = randPointInArea(w, areaId, rng);
    if (!pt) return false;
    return this.setGoto(w, pt.x, pt.y, then, label);
  }
  setIntent(type, label, durGameMin, reason, source) {
    this.intent = { type, label: label || type, untilMin: durGameMin || 60, reason: reason || label || '', source: source || 'script' };
  }

  // ---------- 存在：默认状态是活着，不是待命 ----------
  // 发呆、抖腿、看天、打瞌睡、想心事、什么都不想。做事是从存在里中断出来的，不是常态。
  pickExistence(rng) {
    const pool = [];
    const add = (sub, w) => { for (let i = 0; i < w; i++) pool.push(sub); };
    add('发呆', 26); add('看天', 14); add('想心事', 14); add('什么都不想', 10);
    add('踢石子', 8); add('抖腿', 8); add('哼小调', this.traits.includes('爱唱歌') ? 16 : 6);
    if (this.needs.energy < 72) add('打瞌睡', 20);
    const sub = pool[Math.floor(rng() * pool.length) % pool.length];
    const label = { '发呆': '发呆', '看天': '望着天', '想心事': '想心事', '什么都不想': '放空', '踢石子': '踢着石子', '抖腿': '坐着抖腿', '哼小调': '哼着小调', '打瞌睡': '打瞌睡' }[sub] || sub;
    return { sub, label };
  }

  // 存在姿态：存在行为驱动朝向，静止不再冻结在走路方向（计划书第十二章·八）
  applyExistencePose(ex, rng) {
    if (ex.sub === '看天') this.dir = 1;                            // 仰头望天
    else if (ex.sub === '打瞌睡') this.dir = 0;                     // 垂头打盹
    else if (ex.sub === '踢石子') this.dir = Math.floor(rng() * 4); // 随手一踢，朝向随机
  }

  // ---------- 脚本 AI（无 LLM 时的兜底决策） ----------
  // town: 可选，{plans, stock, claimPlan}——营造与开拓需要镇级上下文
  scriptDecide(w, clock, weather, rng, others, town) {
    const h = clock.hour;
    const shelter = precipShelter(w, this, weather);

    // 0) 病榻（死亡有过程——病得起不来床，这一日只剩躺着）
    if (this.dying) return { action: 'rest-sick', why: '病重，起不来床了' };
    // 0.5) 要离镇的人：收拾行装，往镇口走（第三章·十二：推力把人推出去）
    if (this.departing) return { action: 'leave-town', why: '行装收拾好了，要出远门了' };
    // 1) 深夜 → 回家睡觉
    if (h >= 21.5 || h < 6) return this.decideSleep(w);
    // 2) 饥饿
    if (this.needs.hunger > 72) return this.decideEat(w);
    // 3) 精力耗尽
    if (this.needs.energy < 14 && h >= 12) return this.decideSleep(w);
    // 4) 雨雪 → 回屋躲避（勇敢者雨天照旧，暴风雨谁都躲）
    if (weather.precipitating && (weather.stormy || !this.brave)) return shelter ? shelter : this.decideSleep(w);
    // 4.5) 冷得受不住 → 回屋暖和（饥渴冷热是感受，感受构成行为约束）
    if (this.body.feel.cold > 72 && !isWorkTime(this.job, h)) return { action: 'warm', why: '冻得受不住，回屋暖和暖和' };
    // 4.6) 生命层（第三章·十）：童年有童年的世界——孩子不做工、不营造、不出镇；婴儿在襁褓里
    const lifeSt = stageOf(this.body.ageYears).id;
    if (lifeSt === 'infant') return { action: 'nest', why: '还在襁褓里，吃了睡睡了吃' };
    if (lifeSt === 'child' || lifeSt === 'teen') return decideChild(this, w, clock, rng, others);
    // 5) 午饭点
    if (h >= 12 && h < 13 && this.needs.hunger > 40) return this.decideEat(w);
    // 5.2) 装病（表演，第三章·八）：真话只在心里——对外只说"病了"
    if (this.mind && this.mind.fakingSick && h >= 7 && h < 21) return { action: 'rest-sick', why: '病了，得躺着' };
    // 5.4) 太孤单了，先找人说说话（v4.4.2）
    // 实测：旧版社交只在傍晚 3.5 小时窗口触发，白天全被干活/营造占满，而这两样又不耗社交，
    // 长跑下来全镇均社交常年 20 出头（谁都孤独却谁都找不着人说话），成亲成了无源之水。
    // 人不是只会干活的：孤独到份上，就该放下手头的活，去找说得上话的人（排在任何活计之前）。
    if ((lifeSt === 'adult' || lifeSt === 'elder') && this.needs.social < 48 && h >= 7.5 && h < 21) {
      const target = pickChatTarget(this, others, w, rng);
      if (target) return { action: 'chat', npc: target, why: '心里空落落的，找人说说话' };
    }
    // 5.5) 营造：镇上有待施工的计划且自己有余力 → 认领
    if (town && town.plans && this.needs.energy > 25 && h >= 6.5 && h < 20) {
      const plan = town.plans.find(p => !p.done && (!p.builder || p.builder === this.id));
      if (plan) return { action: 'build', planId: plan.id, why: '去' + plan.name + '工地帮忙' };
    }
    // 5.55) 物质层（第五章·材料是真的）：分工不是任命的，是"材料必须被搬来搬去"逼出来的——闲人接搬运
    // 产出革命（v2.9.0）：有手艺可做的人优先手艺活（在 decideWork 排最前），搬运留给真闲人
    const hasCraft = !!(town && craftableRecipes(town, this).length);
    if (town && town.haulJob && !hasCraft && !isWorkTime(this.job, h) && this.needs.energy > 25 && h >= 6.5 && h < 20) {
      const haul = town.haulJob(this);
      if (haul) return haul;
    }
    // 6) 工作时段（产出革命：WORK_HOURS 只管职业习惯的边缘时段；白天清醒的人都可能找活干）
    const workTime = isWorkTime(this.job, h) || (h >= 7 && h < 12) || (h >= 13 && h < 17);
    if (workTime && this.needs.energy > 20) {
      // 存在优先：工作时段也可能先发会儿呆（做事是从存在里中断出来的）
      // 神经芯（v2.5.0）：愣神闸由芯的 work 权重微调——学出"手上活计要紧"就少愣神
      if (chance(rng, neuroWorkIdle(this, town))) return { action: 'exist', why: '先愣一会儿神再说' };
      const dec = this.decideWork(w, rng, town);
      if (dec) return dec;
    }
    // 7) 收工后找人说说话（傍晚是走动的时间；v4.4.2 放宽阈值，让"心里有点空"就肯出门）
    if (h >= 17.5 && h < 21 && this.needs.social < 68) {
      const target = pickChatTarget(this, others, w, rng);
      if (target) return { action: 'chat', npc: target, why: '去广场找人说说话' };
    }
    // 7.5) 开拓：闲时低概率去镇郊探索
    if (h >= 7 && h < 19 && this.needs.energy > 40 && this.needs.hunger < 65 && chance(rng, 0.12)) {
      return { action: 'scout', why: '去镇外走走，看看能发现什么' };
    }
    // 7.8) 矛盾摆动（第三章·九）：不同时刻不同的那一面占上风——连他自己都不确定明天选哪边
    const dom = dominantConflict(this.mind);
    if (dom && (lifeSt === 'adult' || lifeSt === 'elder')) {
      if (dom.lean > 0.62 && chance(rng, 0.10)) return { action: 'conflict', side: 'out', why: '那股想出去看看的念头又压不住了' };
      if (dom.lean < 0.38 && chance(rng, 0.08)) return { action: 'conflict', side: 'home', why: '说不清为什么，就是想回家待着' };
    }
    // 7.9) 评理（社会层·权力）：旧怨压不住的时候，镇上总有个说话算数的人
    if (lifeSt === 'adult' || lifeSt === 'elder') {
      let worst = null;
      for (const rel of Object.values(this.rels || {})) if (!worst || rel.grudge > worst.grudge) worst = rel;
      if (worst && worst.grudge > 40 && chance(rng, 0.12)) {
        const arb = pickArbiter(this, worst.o, others);
        if (arb) return { action: 'mediate', npc: arb.id, why: '这口气咽不下，找' + arb.name + '评理去' };
      }
    }
    // 8) 节奏：大部分时候什么都不发生——存在为主，闲逛为辅
    // 神经芯（v2.5.0）：宿主在世时，闲时的倾向由芯的权重表给一点偏置——
    // 天道不夺自由意志，生存决策永远先行，芯只在"无事一身轻"时分里给倾向
    const biased = neuroTail(this, town, rng, h);
    if (biased) return biased;
    if (chance(rng, 0.55)) return { action: 'exist', why: null };
    return { action: 'wander', why: null };
  }

  // 产出革命（v2.9.0）：产出=世界对象+个人手艺，job 退化为习惯倾向，绝不做产出开关
  decideWork(w, rng, town) {
    const x = Math.floor(this.x), y = Math.floor(this.y);
    // ① 手艺优先：会、且镇库料够的配方——饿了优先产食的，否则熟练度(mult)最高的
    if (town) {
      const craftable = craftableRecipes(town, this);
      if (craftable.length) {
        const defs = town.recipeDefs || {};
        const FOOD = ['crop', 'berry', 'fish'];
        const hungry = this.needs.hunger > 60;
        const scored = [];
        for (const id of craftable) {
          const def = defs[id];
          if (!def) continue;
          const isFood = !!(def.outputs && FOOD.some(r => def.outputs[r] != null));
          const mult = (town.recipes[id] && town.recipes[id].mult) || 1;
          scored.push({ id, def, score: (hungry && isFood ? 100 : 0) + mult });
        }
        scored.sort((a, b) => b.score - a.score);
        if (scored.length) {
          const best = scored[0];
          const site = town.craftSiteFor ? town.craftSiteFor(this, best.def) : null;
          const dec = { action: 'work', craft: best.id, why: '去做' + best.def.name + '的活计' };
          if (site) { dec.tx = site.x; dec.ty = site.y; }
          return dec;
        }
      }
      // ② 公共加工：坊里堆着原木谁都能锯（原樵夫专属闸门删除，3 根原木出 2 块板）
      if (town.millJob) {
        const mill = town.millJob(this);
        if (mill) return mill;
      }
    }
    // ③ 采集：饿了先找吃的；无业者的本能也是先找吃的（摘浆果是本能，不是手艺）
    if (this.needs.hunger > 60 || !this.job) {
      const food = nearestObjAround(w, x, y, [O.BUSH, O.CROP3], 18)
        || findObjInArea(w, 'farm', [O.BUSH, O.CROP3], rng)
        || findObjInArea(w, 'forest', [O.BUSH, O.CROP3], rng);
      if (food) {
        return { action: 'work', tx: food.x, ty: food.y, why: getObj(w, food.x, food.y) === O.CROP3 ? '去收熟了的庄稼充饥' : '摘点浆果充饥' };
      }
    }
    const t = nearestObjAround(w, x, y, GATHER_OBJS, 18)
      || (this.workArea ? findObjInArea(w, this.workArea, GATHER_OBJS, rng) : null);
    if (t) {
      const ot = getObj(w, t.x, t.y);
      const why = ot === O.BUSH ? '摘点浆果充饥'
        : (ot === O.TREE || ot === O.STUMP) ? '进林子伐木'
        : ot === O.CROP3 ? '去收熟了的庄稼'
        : ot === O.CHEST ? '去开个宝箱碰碰运气'
        : '去矿区敲石头';
      return { action: 'work', tx: t.x, ty: t.y, why };
    }
    // ④ 饿着又找不到吃的 → 河边钓两条（原渔夫寻滩逻辑通用化）
    if (this.needs.hunger > 60) {
      const a = w.areas.find(v => v.id === 'river');
      if (a) {
        for (let k = 0; k < 40; k++) {
          const fx = a.x + Math.floor(rng() * a.w), fy = a.y + Math.floor(rng() * a.h);
          if (getGround(w, fx, fy) === G.SAND) return { action: 'work', tx: fx, ty: fy, why: '去河边钓鱼充饥' };
        }
      }
    }
    // ⑤ 有工作的人回工作区驻场（习惯倾向，不是产出开关）
    if (this.job && this.workArea) {
      return { action: 'work', area: this.workArea, why: '去' + (w.areas.find(a => a.id === this.workArea)?.name || '活计') + '干活' };
    }
    return null;
  }
  decideEat(w) {
    // 就近：自家 or 饭馆
    return { action: 'eat', why: '肚子饿了，觅食去' };
  }
  decideSleep(w) {
    return { action: 'sleep', why: null };
  }

  // 把脚本决策转成实际意图（游戏层调用）
  applyScriptDecision(w, rng, dec, others, ctx) {
    switch (dec.action) {
      case 'work': {
        const then = { type: 'work', dur: rint(rng, 90, 180) };
        if (dec.craft) then.craft = dec.craft;   // 产出革命：手艺活随意图透传（tick 抵达后挂上 intent.craft）
        if (dec.tx != null) {
          if (this.setGoto(w, dec.tx, dec.ty, then, dec.why || '干活')) return true;
        } else if (dec.area) {
          if (this.setGotoArea(w, dec.area, rng, then, dec.why || '干活')) return true;
        } else if (dec.craft) {
          // 手艺活没处去（选址不可达）→ 就地开干
          this.setIntent('work', '干活', then.dur, dec.why || '开干');
          this.intent.craft = dec.craft;
          return true;
        }
        return false;
      }
      case 'eat': {
        // 去饭馆/商店或回家吃
        const pub = w.houses.find(h => SHELTER_HOUSES.includes(h.ownerId));
        const usePub = !!(pub && chance(rng, 0.6));
        const dest = usePub ? { x: pub.ox, y: pub.oy } : (this.home ? { x: this.home.x, y: this.home.y } : null);
        if (dest && this.setGoto(w, dest.x, dest.y, { type: 'eat', dur: 40, home: !usePub }, '吃饭')) return true;
        this.setIntent('eat', '就地进食', 30);
        return true;
      }
      case 'sleep': {
        if (this.home && this.setGoto(w, this.home.x, this.home.y, { type: 'sleep', dur: 0 }, '回家睡觉')) return true;
        this.setIntent('sleep', '露宿', 0);
        return true;
      }
      case 'chat': {
        const other = others.find(n => n.id === dec.npc);
        if (!other || other.inside) return false;
        if (this.setGoto(w, Math.floor(other.x), Math.floor(other.y), { type: 'chat', with: other.id, dur: 45 }, '找' + other.name + '聊天')) return true;
        return false;
      }
      case 'mediate': {
        // 评理：去找说话算数的人（社会层·权力在用的时候才存在）
        const leader = others.find(n => n.id === dec.npc && !n.inside);
        if (leader && this.setGoto(w, Math.floor(leader.x), Math.floor(leader.y), { type: 'chat', with: leader.id, dur: 40, sub: '评理' }, '找' + leader.name + '评理')) return true;
        return false;
      }
      case 'leave-town': {
        // 离镇：往镇口边缘走（告别在 game 层的镇史里收尾）
        // 起源 2×2 chunk = 128×128；镇口在边缘带
        for (let k = 0; k < 12; k++) {
          const side = rint(rng, 0, 3);
          let tx, ty;
          if (side === 0) { tx = rint(rng, 3, 10); ty = rint(rng, 5, 122); }
          else if (side === 1) { tx = rint(rng, 117, 124); ty = rint(rng, 5, 122); }
          else if (side === 2) { tx = rint(rng, 5, 122); ty = rint(rng, 3, 10); }
          else { tx = rint(rng, 5, 122); ty = rint(rng, 117, 124); }
          if (!walkable(w, tx, ty)) continue;
          if (this.setGoto(w, tx, ty, null, '往镇口去')) return true;
        }
        return false;
      }
      case 'goto': {
        if (dec.area && this.setGotoArea(w, dec.area, rng, null, dec.label)) return true;
        return false;
      }
      case 'build': {
        const plans = ctx && ctx.plans;
        if (plans && ctx.claimPlan) {
          const plan = dec.planId != null
            ? plans.find(p => p.id === dec.planId && !p.done)
            : plans.find(p => !p.done && (!p.builder || p.builder === this.id));
          if (plan && ctx.claimPlan(this, plan)) return true;
        }
        return false;
      }
      case 'haul': {
        // 物质层·搬运：近的直接扛，远的分几趟——运输本身是一件事
        if (dec.tx != null && this.setGoto(w, dec.tx, dec.ty, { type: 'haul', planId: dec.planId, stage: dec.stage }, dec.why || '搬东西去')) return true;
        return false;
      }
      case 'mill': {
        if (dec.tx != null && this.setGoto(w, dec.tx, dec.ty, { type: 'mill', dur: dec.dur || 110 }, dec.why || '去木匠坊锯木头')) return true;
        return false;
      }
      case 'repair': {
        if (dec.tx != null && this.setGoto(w, dec.tx, dec.ty, { type: 'repair', dur: dec.dur || 55, key: dec.key }, dec.why || '去修补破败的地方')) return true;
        return false;
      }
      case 'scout': {
        // 目标：四条边缘带随机点
        for (let k = 0; k < 12; k++) {
          const side = rint(rng, 0, 3);
          let tx, ty;
          if (side === 0) { tx = rint(rng, 4, 12); ty = rint(rng, 5, 122); }
          else if (side === 1) { tx = rint(rng, 116, 123); ty = rint(rng, 5, 122); }
          else if (side === 2) { tx = rint(rng, 5, 122); ty = rint(rng, 4, 12); }
          else { tx = rint(rng, 5, 122); ty = rint(rng, 116, 123); }
          if (!walkable(w, tx, ty)) continue;
          if (this.setGoto(w, tx, ty, { type: 'scout', dur: rint(rng, 40, 80) }, '外出探索')) return true;
        }
        return false;
      }
      case 'conflict': {
        // 矛盾的行为面：上风想去外面 → 去镇边望远方；下风想守着 → 回家待着
        if (dec.side === 'out') {
          for (let k = 0; k < 12; k++) {
            const side = rint(rng, 0, 3);
            let tx, ty;
            if (side === 0) { tx = rint(rng, 4, 12); ty = rint(rng, 5, 122); }
            else if (side === 1) { tx = rint(rng, 116, 123); ty = rint(rng, 5, 122); }
            else if (side === 2) { tx = rint(rng, 5, 122); ty = rint(rng, 4, 12); }
            else { tx = rint(rng, 5, 122); ty = rint(rng, 116, 123); }
            if (!walkable(w, tx, ty)) continue;
            if (this.setGoto(w, tx, ty, { type: 'idle', dur: 70, sub: '出神' }, '去镇边望着远方出神')) return true;
          }
          return false;
        }
        if (this.home && this.setGoto(w, this.home.x, this.home.y, { type: 'idle', dur: 50, sub: '守家', home: true }, '想回家待着')) return true;
        this.setIntent('idle', '想回家待着', 40, dec.why || '', 'script');
        return true;
      }
      case 'rest-sick': {
        // 装病/病重：闭门不出（对外只有"病了"三个字，真话在私密自白里）
        if (this.home && this.setGoto(w, this.home.x, this.home.y, { type: 'idle', dur: 240, sub: '卧床', home: true }, '卧床歇息')) return true;
        this.setIntent('idle', '就地歪着歇息', 120, '病了', 'script');
        return true;
      }
      // —— 生命层：童年有自己的世界（计划书第三章·十）——
      case 'nest': {
        // 婴儿：襁褓中，不出门（吃睡都在屋里完成）
        if (this.home) { this.x = this.home.x; this.y = this.home.y; this.inside = true; }
        this.setIntent('idle', '在襁褓里安睡', 240, dec.why || '', 'script');
        this.intent.sub = '襁褓';
        return true;
      }
      case 'study': {
        // 少年念书：去广场识字（孩子自己的正经事）
        if (this.setGotoArea(w, 'plaza', rng, { type: 'work', dur: rint(rng, 60, 120), label: '念书' }, '去广场念书')) return true;
        this.setIntent('work', '就地练字', 60, '念书', 'script');
        return true;
      }
      case 'play': {
        const mate = dec.with ? others.find(o => o.id === dec.with && !o.inside) : null;
        if (mate && this.setGoto(w, Math.floor(mate.x), Math.floor(mate.y), { type: 'idle', dur: 70, sub: '玩耍' }, '和' + mate.name + '玩')) return true;
        if (this.setGotoArea(w, 'plaza', rng, { type: 'idle', dur: 60, sub: '玩耍' }, '去广场玩')) return true;
        this.setIntent('idle', '就地玩泥巴', 40, '玩', 'script');
        this.intent.sub = '玩耍';
        return true;
      }
      case 'follow': {
        const p = others.find(o => o.id === dec.npc && !o.inside);
        if (p && this.setGoto(w, Math.floor(p.x), Math.floor(p.y), { type: 'idle', dur: 50, sub: '玩耍' }, '跟着' + p.name)) return true;
        return false;
      }
      case 'home': {
        if (this.home && this.setGoto(w, this.home.x, this.home.y, { type: 'idle', dur: 60, home: true }, '天黑了，回家吃饭')) return true;
        this.setIntent('idle', '就地歇着', 40, '天黑了', 'script');
        return true;
      }
      case 'exist': {
        // 存在：默认状态是活着。原地待着，做一件"没什么用"的事
        const ex = this.pickExistence(rng);
        const dur = ex.sub === '打瞌睡' ? rint(rng, 45, 110) : rint(rng, 25, 70);
        this.setIntent('idle', ex.label, dur, dec.why || '没什么，就是待着', 'script');
        this.intent.sub = ex.sub;
        this.applyExistencePose(ex, rng);
        return true;
      }
      case 'warm': {
        // 冷 → 回屋暖和（感受构成行为约束）
        if (this.home && this.setGoto(w, this.home.x, this.home.y, { type: 'idle', dur: 120, sub: '烤火', home: true }, '回屋暖和')) return true;
        this.setIntent('idle', '原地跺脚取暖', 60, dec.why || '冷', 'script');
        return true;
      }
      case 'wander': {
        const dx = rint(rng, -5, 5), dy = rint(rng, -5, 5);
        // 起源 2×2 chunk = 128×128，wander 在起源区内散（不钳到未生成区域）
        const tx = clamp(Math.floor(this.x) + dx, 3, 124), ty = clamp(Math.floor(this.y) + dy, 3, 124);
        if (!this.setGoto(w, tx, ty, null, '散步')) {
          const ex = this.pickExistence(rng);
          this.setIntent('idle', ex.label, 30, '走不动，就在这儿待着', 'script');
          this.intent.sub = ex.sub;
          this.applyExistencePose(ex, rng);
        }
        return true;
      }
      default: {
        // 开放动作（v4.1）：清单外的动作不丢弃——走通用裁决，动词对裁决层透明。
        // 回滚保险：开关关掉时退回旧行为（未识别动作不落地）。
        if (!OPEN_ACTIONS.enabled) return false;
        const t = dec.targets != null ? dec.targets : (dec.target != null ? [dec.target] : []);
        const v = dispatch(makeAction(this, dec.action, resolveTargets(t, this, ctx), { reason: dec.why || '' }), ctx);
        return v.legal;
      }
    }
  }

  // ---------- 逐帧推进 ----------
  // dtReal: 现实秒；gmPerReal: 每现实秒对应游戏分钟；ctx: {w, clock, weather, rng, npcs, stock, nowReal, log, onChat}
  tick(dtReal, ctx) {
    const { w, clock, weather, rng, npcs, stock, nowReal, log } = ctx;
    const gm = dtReal * ctx.gmPerReal;   // 本帧游戏分钟
    const hours = gm / 60;
    // 呈现层·因果链：意图换一桩记一桩（做什么+为什么+谁让做的）
    recordIntent(this, clock.totalDay, fmtClock(clock.hour));
    const spdMul = (weather.snowing ? 0.65 : weather.raining ? 0.8 : 1);
    // 身体约束：状态本身就是行为约束（腿伤走得慢、手伤干活差）
    const bodyC = bodyConstraints(this.body);
    // 冷热感受漂移（饥渴冷热是感受，不是数值）
    const ft = feelTarget(this.body, weather.type, clock.season, clock.hour);
    this.body.feel.cold += (ft.cold - this.body.feel.cold) * clamp(hours * 0.5, 0, 1);
    this.body.feel.heat += (ft.heat - this.body.feel.heat) * clamp(hours * 0.5, 0, 1);

    // 非睡眠意图却在屋内 → 走出门（读档/夜间决策修正；襁褓中的婴儿除外；回家活动除外）
    if (this.inside && this.intent.type !== 'sleep' && !this.intent.home && stageOf(this.body.ageYears).id !== 'infant') this.inside = false;

    // 走路（v4.4.2 修致命死锁：findPath 目标即脚下时返回空路径，旧条件 `path.length && type==='goto'`
    // 把这种 goto 挡在门外，而 goto 又不在下面的驻留分支里——人一旦"到了"就永远卡在 goto 里，
    // 不再决策。改成只要意图是 goto 就进来：有路就走，没路直接判"抵达"。）
    if (this.intent.type === 'goto') {
      // v4.5.0 性别层：孕晚期脚步放缓（身子沉，走不快）
      const pregMul = (this.preg && this.preg.due - clock.totalDay < 45) ? 0.85 : 1;
      const speed = 2.3 * spdMul * bodyC.moveMul * pregMul;   // 格/现实秒
      let move = speed * dtReal;
      // 自欺的矛盾不该被修正：路过那个人家门前，脚步自己慢了下来（第三章·八）
      if (crushGaze(this, npcs, clock)) move *= 0.55;
      while (move > 0 && this.path.length) {
        const [nx, ny] = this.path[0];
        const dx = nx - this.x, dy = ny - this.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= move) {
          this.x = nx; this.y = ny; move -= dist; this.path.shift();
          if (dx > 0.01) this.dir = 3; else if (dx < -0.01) this.dir = 2;
          else if (dy > 0.01) this.dir = 0; else if (dy < -0.01) this.dir = 1;
        } else {
          const t = move / dist;
          if (dx > 0.01) this.dir = 3; else if (dx < -0.01) this.dir = 2;
          else if (dy > 0.01) this.dir = 0; else if (dy < -0.01) this.dir = 1;
          this.x += dx * t; this.y += dy * t; move = 0;
        }
      }
      this.needs.energy = clamp(this.needs.energy - hours * 4, 0, 100);
      // 抵达 → 进入 then 意图
      if (!this.path.length) {
        const then = this.intent.then;
        if (then) {
          if (then.type === 'sleep') { this.inside = true; this.setIntent('sleep', '睡觉', 0, '到了家'); this.memory('睡了一觉', clock.totalDay, clock.hour); }
          else if (then.type === 'eat') { this.setIntent('eat', '吃饭', then.dur, '坐下吃饭'); }
          else if (then.type === 'work') { this.setIntent('work', '干活', then.dur, then.label || '开干'); this.workTarget = null; if (then.craft) this.intent.craft = then.craft; }
          else if (then.type === 'chat') { this.setIntent('chat', '聊天', then.dur, '见着人了'); this.chatWith = then.with; if (then.sub) this.intent.sub = then.sub; }
          else if (then.type === 'build') { this.setIntent('build', '施工中', then.dur, '工地到了'); }
          else if (then.type === 'scout') { this.setIntent('scout', '探索周围', then.dur, '开始探索'); }
          else if (then.type === 'haul') { if (ctx.haulArrive) ctx.haulArrive(this, then, ctx); else this.setIntent('idle', '停下', 20); }
          else if (then.type === 'mill') { this.setIntent('mill', '锯木头', then.dur, '工坊到了'); }
          else if (then.type === 'repair') { this.setIntent('repair', '修补中', then.dur, '破地方到了'); }
          else { this.setIntent('idle', then.label || '停留', then.dur || 30, then.label || ''); if (then.sub) this.intent.sub = then.sub; }
          // 到家了 → 进屋（回家吃饭/守家/烤火/卧床都该在屋里待着）
          if (then.home) { this.inside = true; this.intent.home = true; }
        } else {
          this.setIntent('idle', '停留', rint(rng, 20, 60), '走到了，站会儿');
        }
      }
    } else {
      // 驻留意图的持续效果
      const it = this.intent;
      this.act = null;   // 动作状态随意图分发重建：只有正在干活的意图会挂上动作（瞬态不存档）
      if (it.type === 'sleep') {
        this.inside = true;
        this.needs.energy = clamp(this.needs.energy + hours * 14, 0, 100);
        this.needs.hunger = clamp(this.needs.hunger + hours * 2, 0, 100);
        if (clock.hour >= 7 && clock.hour < 21 && this.needs.energy > 95) {
          this.inside = false;
          this.setIntent('idle', '起床', 10);
        }
      } else if (it.type === 'eat') {
        // 涌现物理层：手里有存货先吃自己的（一次进食最多一份，守恒：goods 真减少）
        if (!it._ateHold) { eatFromHold(this); it._ateHold = true; }
        this.needs.hunger = clamp(this.needs.hunger - hours * 90, 0, 100);
        this.needs.mood = clamp(this.needs.mood + hours * 4, 0, 100);
        if (it.untilMin <= 0.5) this.setIntent('idle', '饭后歇', 20);
      } else if (it.type === 'work') {
        this.needs.energy = clamp(this.needs.energy - hours * 6, 0, 100);
        this.needs.hunger = clamp(this.needs.hunger + hours * 5, 0, 100);
        // v4.4.2：埋头干活是最孤的——手上不停，心里空着（社交欲自会累积，攒够了就去寻人）
        this.needs.social = clamp(this.needs.social - hours * 2.5, 0, 100);
        this._workMinToday += gm;
        this.doWork(ctx, gm, bodyC.craftMul);
        // 工伤：劳作中突发——按「正在干的活动」查表（v2.9.0：不按职业身份，挖矿的受矿伤、伐木的受木伤）
        const actKey = this._workAct == null ? null
          : this._workAct === 'mine' ? '铁匠'
          : this._workAct === 'chop' ? '樵夫'
          : this._workAct === 'fish' ? '渔夫'
          : this._workAct === 'farm' ? '农夫'
          : this._workAct.startsWith('craft:') ? (() => {
            const def = ((ctx.game && ctx.game.recipeDefs) || {})[this._workAct.slice(6)];
            const outRes = def ? Object.keys(def.outputs || {})[0] : null;
            return outRes === 'wood' ? '樵夫' : ['stone', 'copper', 'iron', 'goldOre'].includes(outRes) ? '铁匠' : outRes === 'fish' ? '渔夫' : '农夫';
          })() : null;
        if (actKey && chance(rng, gm * 0.0004)) {
          const table = INJURY_TABLE[actKey] || INJURY_TABLE['农夫'];
          const def = table[Math.floor(rng() * table.length) % table.length];
          injure(this.body, def.part, def.name, def.sev, def.days, clock.totalDay);
          this.memory(def.name + '，疼得龇牙咧嘴', clock.totalDay, clock.hour);
          if (log) log(`${this.name}干活时${def.name}`, 'warn');
          this.say('嘶——', nowReal);
        }
        if (it.untilMin <= 0.5) this.setIntent('idle', '歇口气', rint(rng, 15, 40), '干累了');
      } else if (it.type === 'build') {
        this.needs.energy = clamp(this.needs.energy - hours * 7, 0, 100);
        this.needs.hunger = clamp(this.needs.hunger + hours * 6, 0, 100);
        this._workMinToday += gm;
        this.act = motionFor('smash', 'hammer');   // 施工：抡锤敲打（建造是真过程）
        if (ctx.workOnPlan) ctx.workOnPlan(this, gm);
        if (it.untilMin <= 0.5) this.setIntent('idle', '施工歇息', rint(rng, 15, 40));
      } else if (it.type === 'mill') {
        // 物质层·加工：原木锯成板，木屑落一地
        this.needs.energy = clamp(this.needs.energy - hours * 6, 0, 100);
        this.needs.hunger = clamp(this.needs.hunger + hours * 5, 0, 100);
        this._workMinToday += gm;
        this.act = motionFor('saw');               // 锯木：来回拉锯
        if (ctx.millTick) ctx.millTick(this, gm);
        if (it.untilMin <= 0.5) this.setIntent('idle', '锯完歇口气', rint(rng, 15, 40));
      } else if (it.type === 'repair') {
        // 物质层·维护：木头会烂，需要修缮——有人修，就还没垮
        this.needs.energy = clamp(this.needs.energy - hours * 5, 0, 100);
        this._workMinToday += gm;
        this.act = motionFor('smash', 'hammer');   // 修缮：敲敲打打
        if (ctx.repairTick) ctx.repairTick(this, gm, it.key);
        if (it.untilMin <= 0.5) this.setIntent('idle', '修完歇口气', rint(rng, 15, 40));
      } else if (it.type === 'scout') {
        this.needs.energy = clamp(this.needs.energy - hours * 3, 0, 100);
        this.needs.mood = clamp(this.needs.mood + hours * 2, 0, 100);
        if (it.untilMin <= 0.5) {
          if (ctx.onScout) ctx.onScout(this);
          else this.memory('去镇外探索了一圈', clock.totalDay, clock.hour);
          this.setIntent('idle', '探索归来', rint(rng, 20, 50));
        }
      } else if (it.type === 'chat') {
        const other = npcs.find(n => n.id === this.chatWith);
        if (other && !other.inside && dist(this, other) < 2.5) {
          this.needs.social = clamp(this.needs.social + hours * 45, 0, 100);
          // 评理走权力的路（社会层）；寻常闲聊走关系的路
          if (it.sub === '评理') tryMediate(this, other, ctx);
          else tryPairChat(this, other, ctx);
        } else {
          this.setIntent('idle', '没找到人', 15);
        }
        if (it.untilMin <= 0.5) this.setIntent('idle', '聊完了', 10);
      } else if (it.type === 'idle') {
        // 存在的持续效果：打瞌睡恢复精力更快也不耗社交；烤火驱寒；想心事漂情绪
        this.needs.social = clamp(this.needs.social - hours * (it.sub === '打瞌睡' ? 0.5 : 3.5), 0, 100);
        this.needs.hunger = clamp(this.needs.hunger + hours * 3.5, 0, 100);
        if (it.sub === '打瞌睡') this.needs.energy = clamp(this.needs.energy + hours * 6, 0, 100);
        else this.needs.energy = clamp(this.needs.energy + hours * 1.5, 0, 100);
        if (it.sub === '烤火') this.body.feel.cold = clamp(this.body.feel.cold - hours * 40, 0, 100);
        // 襁褓：被喂着，吃睡都在屋里完成（婴儿不出门）
        if (it.sub === '襁褓') {
          this.needs.hunger = clamp(this.needs.hunger - hours * 40, 0, 100);
          this.needs.mood = clamp(this.needs.mood + hours * 2, 0, 100);
        }
        // 玩耍：童年自己的社交（社交欲越玩越满，还会喊出声）
        if (it.sub === '玩耍') {
          this.needs.social = clamp(this.needs.social + hours * 30, 0, 100);
          if (chance(rng, hours * 0.5)) this.say(pickLex(ctx.game, 'childIdle', rng), nowReal);
        }
        // 吃喜酒：人情往来的热闹（社会层·婚嫁）
        if (it.sub === '吃喜酒') {
          this.needs.social = clamp(this.needs.social + hours * 30, 0, 100);
          this.needs.mood = clamp(this.needs.mood + hours * 6, 0, 100);
        }
        // 老年：时间感错乱，会把眼前的年轻人认成故人（第三章·十）
        if (stageOf(this.body.ageYears).id === 'elder' && ctx.dead && ctx.dead.length && chance(rng, hours * 0.04)) {
          elderConfusedSay(this, npcs, ctx.dead, rng, nowReal, clock, ctx.game);
        }
        // 孩子闲时哼童谣（第八章：童谣是语言里最活的部分；白纸开局后没有"学生"职业，按生活段判定）
        if (it.sub === '哼小调' && ['child', 'teen'].includes(stageOf(this.body.ageYears).id) && this.mind && this.mind.voice.nursery && chance(rng, hours * 0.4)) {
          this.say(this.mind.voice.nursery, nowReal);
        }
        if (it.sub === '想心事' && chance(rng, hours * 0.08)) {
          this.moodDelta(chance(rng, 0.5) ? 1 : -1, '想起了些往事', clock.totalDay, clock.hour);
        }
        if (it.untilMin <= 0.5) {
          if (it.sub === '打瞌睡' && chance(rng, 0.35)) this.memory('打了个盹，精神了些', clock.totalDay, clock.hour);
          this.intent = { type: 'ready', label: '待命', untilMin: 0, reason: '', source: 'script' };
        }
      }
      // 意图倒计时
      if (this.intent.untilMin > 0) this.intent.untilMin = Math.max(0, this.intent.untilMin - gm);
    }

    // 通用需求漂移
    if (this.intent.type !== 'sleep') {
      this.needs.hunger = clamp(this.needs.hunger + hours * 3.2, 0, 100);
    }
    // 体质约束：精力上限（体质层终身缓慢衰退，装不满只能歇）
    if (this.needs.energy > bodyC.staminaMax) {
      this.needs.energy = Math.max(bodyC.staminaMax, this.needs.energy - hours * 2.5);
    }
    // 心情向基线回归 + 天气影响 + 冷热感受影响
    let moodTarget = 55 + (weather.precipitating ? (this.brave ? -5 : -12) : 4);
    if (this.needs.hunger > 80) moodTarget -= 15;
    if (this.needs.energy < 20) moodTarget -= 10;
    if (this.body.feel.cold > 65) moodTarget -= 6;
    if (this.body.feel.heat > 70) moodTarget -= 5;
    this.needs.mood += (moodTarget - this.needs.mood) * clamp(hours * 0.4, 0, 1);

    // 气泡到期
    if (this.bubble && nowReal > this.bubble.untilReal) this.bubble = null;

    // 极端饥饿掉心情
    if (this.needs.hunger >= 99 && chance(rng, 0.02)) {
      this.moodDelta(-1, '饿得眼冒金星', clock.totalDay, clock.hour);
    }
    // v4.5.1 本能半硬编码：未满足的身体冲动日夜蚕食心情——居民之魂看得见，也得扛得住
    const urge = urgeOf(this);
    if (urge && urge.p > 0.55) {
      this.needs.mood = clamp(this.needs.mood - hours * (urge.p - 0.55) * 1.5, 0, 100);
    }

    // 路径被上帝改动堵死 → 放弃（树桩24/工地28可通行）
    if (this.path.length) {
      const [nx, ny] = this.path[0];
      const g = getGround(w, nx, ny);
      const ob = getObj(w, nx, ny);
      if (g === G.WATER || (ob !== 0 && ob !== 10 && ob !== 11 && ob !== 24 && ob !== 28 && ob !== 33 && !(ob >= 20 && ob <= 23))) {
        this.path = []; this.setIntent('idle', '路被堵了', 20);
        if (log) log(`${this.name}发现路被堵住了`, 'warn');
      }
    }
  }

  // craftMul：身体约束的手上精度（手抖的铁匠打出来的东西精度低）
  doWork(ctx, gm, craftMul) {
    const cm = craftMul == null ? 1 : craftMul;
    const { w, clock, rng, stock, log, npcs } = ctx;
    // 涌现物理层：产出经过手（selftest 的 ctx 可能只有 stock 没有 game，兜底包一层）
    const game = ctx.game || { stock };
    const fx = Math.floor(this.x), fy = Math.floor(this.y);

    // —— 加工（v2.9.0）：按配方干活，knowsRecipe 专属——批处理：批完成那一刻才扣料产出，
    // mult/base/cm 只压缩批时间、绝不放大产量（守恒铁律：outputs≤inputs 由 validateRecipe 卡死）
    const craftId = this.intent.craft;
    if (craftId) {
      const defs = game.recipeDefs || {};
      const def = defs[craftId], rec = game.recipes && game.recipes[craftId];
      // 配方被回滚/手艺失传 → 这活计干不了了
      if (!def || !rec || !rec.knownBy.has(this.id)) {
        this._workAct = null;
        this.act = null;
        this.setIntent('idle', '这活计干不了了', rint(rng, 15, 40), '手艺断了');
        return;
      }
      this._workAct = 'craft:' + craftId;
      // 过程革命（v3.0.0）：动作挂在配方定义上——演化引擎设定这门手艺怎么干（原语+工具）
      this.act = motionOf(def);
      this._craftMin = (this._craftMin || 0) + gm * (def.base || 1) * (rec.mult || 1) * cm;
      if (this._craftMin >= MAT.CRAFT_MIN) {
        this._craftMin = 0;
        const enough = Object.entries(def.inputs).every(([r, q]) => (game.stock[r] || 0) >= q);
        if (enough) {
          for (const [r, q] of Object.entries(def.inputs)) game.stock[r] -= q;
          for (const [r, q] of Object.entries(def.outputs)) npcEarn(this, r, q, game);
          if (chance(rng, 0.15)) { this.memory(`做成了一批${def.name}`, clock.totalDay, clock.hour); if (log) log(`${this.name}做成了一批${def.name}`, 'good'); }
        } else {
          this.memory(`想做${def.name}，料不够了`, clock.totalDay, clock.hour);
          this._workAct = null;
          this.act = null;
          this.setIntent('idle', '料不够了', rint(rng, 15, 40), '料不够了');
        }
      }
      return;
    }

    // —— 采集（v2.9.0）：体能活人人可干，对象决定产出；手艺只调概率不调产量（会的人上手快）
    const near = nearestObjAround(w, fx, fy, GATHER_OBJS, 2)
      || nearestObjAround(w, fx, fy, [O.CROP0, O.CROP1, O.CROP2], 3);
    if (near) {
      const ov = getObj(w, near.x, near.y);
      // 干活要朝着活计（过程革命：动作朝着对象使，不是原地对着空气）
      this.faceTo(near.x - fx, near.y - fy);
      // 未熟作物：浇水照料（任何人靠近都做——照料是体能活不是手艺）
      if (ov === O.CROP0 || ov === O.CROP1 || ov === O.CROP2) {
        this._workAct = 'farm';
        this.act = motionForObj(ov);
        const [ncx, ncy] = worldToChunk(near.x, near.y);
        const c = w.ws.get(ncx, ncy);
        if (c) {
          const { x0, y0 } = chunkOrigin(ncx, ncy);
          const crop = c.crops.get(localIdx(near.x - x0, near.y - y0));
          if (crop) crop.watered = true;
        }
        return;
      }
      this._workAct = MINEABLE[ov] ? 'mine' : CHOPPABLE.has(ov) ? 'chop' : 'farm';
      // 过程革命（v3.0.0）：对象决定怎么下手——石头要砸、树要砍、浆果要摘（世界物理挂对象上）
      this.act = motionForObj(ov);
      const skillRes = MINEABLE[ov] ? (ov === O.GOLD ? 'goldOre' : MINEABLE[ov])
        : CHOPPABLE.has(ov) ? 'wood'
        : ov === O.BUSH ? 'berry' : ov === O.CROP3 ? 'crop' : 'gold';
      const sm = skillMulFor(game, this, skillRes);
      if (chance(rng, gm * 0.015 * cm * sm)) {
        const got = harvestObj(w, near.x, near.y, rng);
        if (got && stock) {
          // 产物映射按对象：矿石/浆果/庄稼入库；宝箱是金币进个人钱袋；原木躺地上（物质层·材料是真的）
          if (ov === O.CHEST) npcEarn(this, 'gold', got.qty, game);
          else if (got.res === 'stone') npcEarn(this, 'stone', Math.max(1, Math.round(got.qty * cm)), game);
          else if (got.res === 'copper') npcEarn(this, 'copper', Math.max(1, Math.round(got.qty * cm)), game);
          else if (got.res === 'iron') npcEarn(this, 'iron', Math.max(1, Math.round(got.qty * cm)), game);
          else if (got.res === 'gold') npcEarn(this, 'goldOre', Math.max(1, Math.round(got.qty * cm)), game);
          else if (got.res === 'berry') npcEarn(this, 'berry', Math.max(1, Math.round(got.qty * cm)), game);
          else if (got.res === 'crop') npcEarn(this, 'crop', Math.max(1, Math.round(got.qty * cm)), game);
          if ((got.res === 'gold' || got.res === 'iron') && chance(rng, 0.3)) {
            this.memory(`挖到了${got.res === 'gold' ? '金矿' : '铁矿'}，运气不错`, clock.totalDay, clock.hour);
            if (log) log(`${this.name}挖到了${got.res === 'gold' ? '金矿' : '铁矿'}`, 'good');
          }
          if (got.res === 'crop' && chance(rng, 0.15)) { this.memory('收了一茬庄稼', clock.totalDay, clock.hour); if (log) log(`${this.name}收获了一批粮食`, 'good'); }
        }
      }
      return;
    }
    // 钓鱼：脚下沙岸且邻水才下得了竿（站农田里钓不出鱼）
    if (getGround(w, fx, fy) === G.SAND && (
      getGround(w, fx + 1, fy) === G.WATER || getGround(w, fx - 1, fy) === G.WATER ||
      getGround(w, fx, fy + 1) === G.WATER || getGround(w, fx, fy - 1) === G.WATER)) {
      this._workAct = 'fish';
      // 朝着水面下竿
      if (getGround(w, fx + 1, fy) === G.WATER) this.dir = 3;
      else if (getGround(w, fx - 1, fy) === G.WATER) this.dir = 2;
      else if (getGround(w, fx, fy - 1) === G.WATER) this.dir = 1;
      else this.dir = 0;
      this.act = motionFor('pull');
      if (chance(rng, gm * 0.01 * cm * skillMulFor(game, this, 'fish')) && stock) {
        npcEarn(this, 'fish', rint(rng, 1, 2), game);
        if (chance(rng, 0.1)) this.memory('钓到一条大鱼', clock.totalDay, clock.hour);
      }
      return;
    }
    this._workAct = null;
    this.act = null;
    void npcs;
  }

  // 朝向辅助：干活朝着活计（0下1上2左3右）
  faceTo(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 3 : 2;
    else if (dy !== 0) this.dir = dy > 0 ? 0 : 1;
  }
}

// 本能冲动层（v4.5.1 半硬编码）：身体是物理压力——引擎只负责"压力是真的"
// 饥会死、孤会郁、欲会烧；怎么回应由居民自己决定（AI 可顺应可硬扛），
// 但身体有硬底：p≥0.9 时脚本直接接管（不等 LLM 应答）
export function urgeOf(n) {
  let kind = null, p = 0;
  const { needs, body } = n;
  // eat
  if (needs.hunger > 50) { const v = (needs.hunger - 50) / 50; if (v > p) { p = v; kind = 'eat'; } }
  // rest
  if (needs.energy < 30) { const v = (30 - needs.energy) / 30; if (v > p) { p = v; kind = 'rest'; } }
  // warm
  if (body.feel.cold > 55) { const v = (body.feel.cold - 55) / 45; if (v > p) { p = v; kind = 'warm'; } }
  // social
  if (needs.social < 45) { const v = (45 - needs.social) / 45; if (v > p) { p = v; kind = 'social'; } }
  // mate (adult/elder only, not pregnant)
  const ls = stageOf(body.ageYears).id;
  if ((ls === 'adult' || ls === 'elder') && needs.desire > 65 && !n.preg) {
    const v = (needs.desire - 65) / 35; if (v > p) { p = v; kind = 'mate'; }
  }
  // heal
  if (body.parts && typeof body.parts === 'object') {
    for (const k of Object.keys(body.parts)) {
      const part = body.parts[k];
      if (part && part.cond < 55) { const v = (55 - part.cond) / 55; if (v > p) { p = v; kind = 'heal'; } }
    }
  }
  return kind ? { kind, p: Math.min(p, 1) } : null;
}

function urgeLabel(kind, p) {
  const intensity = p >= 0.9 ? '火烧眉毛' : p >= 0.7 ? '压不住了' : p >= 0.55 ? '有点急' : '隐隐约约';
  const map = { eat: '饿', rest: '困', warm: '冷', social: '孤单', mate: '躁', heal: '疼' };
  return (map[kind] || kind) + '（' + intensity + '）';
}

// ---------- 辅助 ----------
function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function isWorkTime(job, h) {
  const wins = WORK_HOURS[job];
  if (!wins) return false;
  return wins.some(([a, b]) => h >= a && h < b);
}
function precipShelter(w, npc, weather) {
  if (!weather.precipitating) return null;
  // 就近回家，远则去公共屋顶
  return { action: 'sleep', why: npc.job === '学生' ? '下雨了跑回家' : '下雨了，回家避雨' };
}
function pickChatTarget(npc, others, w, rng) {
  const cands = others.filter(o =>
    o.id !== npc.id && !o.inside && o.intent.type !== 'sleep' &&
    (o.currentArea(w) === '镇中心广场' || o.currentArea(w) === npc.currentArea(w)));
  if (!cands.length) return null;
  // v4.4.2：见着谁跟谁说——先紧着处得来的人（情分是处出来的，反复来往才长深；成亲靠的是同一对人反复说笑）。
  // 用一次 rng() 做加权抽签（不增加抽签次数，确定性序列不变）：关系越好权重越大，生人也有机会。
  const weights = cands.map(o => {
    let wgt = 1 + Math.max(0, (npc.relations[o.id] || 0)) * 0.25;
    // v4.5.0 性别层：欲望给求偶加码——成年单身、取向兼容的成年人之间，火烧得越旺越想凑过去
    if (!npc.spouse && npc.body.ageYears >= 18 && !o.spouse && o.body && o.body.ageYears >= 18
      && attractedTo(npc, o.sex)) wgt += (npc.needs.desire || 0) * 0.04;
    return wgt;
  });
  const total = weights.reduce((s, x) => s + x, 0);
  let r = rng() * total;
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i];
    if (r <= 0) return cands[i].id;
  }
  return cands[cands.length - 1].id;
}
// 语言革命（v3.1.0）：闲聊话题进词库（chatTopic 槽）——本层只剩聊天机制，一句话都不拥有
export function tryPairChat(a, b, ctx) {
  const { clock, rng, nowReal, log } = ctx;
  const key = b.id;
  if ((a.chatCd[key] || 0) > nowReal) return false;
  a.chatCd[key] = nowReal + 90; b.chatCd[a.id] = nowReal + 90;
  // —— 社会层（第三章·六）：关系是独立对象，聊天是它长变形的地方 ——
  const ra = relOf(a, b.id, clock.totalDay);
  // 旧怨压不住 → 吵一架（最难看的那部分社交也该被看见）
  if (ra.grudge > 45 && chance(rng, 0.35)) {
    quarrel(a, b, clock, rng, nowReal, log, ctx.game);
    return true;
  }
  // 有共同记忆的旧怨 → 低概率把话说开（一起扛过事的人，翻篇总是快些）
  if (ra.grudge > 18 && ra.grudge <= 45 && ra.shared.length && chance(rng, 0.22)) {
    reconcile(a, b, clock, rng, nowReal, log, ctx.game);
    return true;
  }
  // 常规聊天：亲密度/信任/共同记忆/未说出口的话/误解，六维各归各
  touchChat(a, b, clock, rng, ctx.game);
  // 生命层：孩子和孩子说话是另一个世界的话题（第三章·十：童年有童年的世界）
  // 涌现物理层·失真：三成概率话题不是静态表，是自己染色后的近事——心情把记忆染成什么样，话就怎么说
  let topic;
  if (!(isKid(a) || isKid(b)) && chance(rng, 0.3)) {
    const mems = recentMemories(a, 1, rng);
    topic = mems.length ? mems[0].slice(0, 20) : pickLex(ctx.game, 'chatTopic', rng);
  } else {
    topic = pickLex(ctx.game, (isKid(a) || isKid(b)) ? 'childTopic' : 'chatTopic', rng);
  }
  // —— 秘密与表演（第三章·八）：人每天大部分社交，都是在演 ——
  // 1) 话题戳到 a 的秘密 → 高心眼的人撒谎，实诚的岔开话题
  const probed = probeSecret(a, topic);
  if (probed) {
    const sly = a.traits.includes('精明') || a.traits.includes('忧郁');
    if (chance(rng, sly ? 0.7 : 0.3)) {
      topic = pickLex(ctx.game, 'deny', rng);
      tellLie(a, probed, b, clock);
    } else {
      a.memory(`被${b.name}问起心里的事，岔开了话题`, clock.totalDay, clock.hour);
    }
  }
  // 2) b 知道 a 的秘密且话题撞上 → 话里带话（"不知道别人知道他知道"成形）
  slipHint(b, a, topic, ctx);
  // 3) 话题戳到 b 的禁忌 → 变脸，记恨加深（社会层：记在关系的怨恨上）
  if (tabooHit(b, topic)) {
    b.moodDelta(-3, '听了不想听的话', clock.totalDay, clock.hour);
    const rb = relOf(b, a.id, clock.totalDay);
    rb.grudge = clamp(rb.grudge + 2, 0, 100);
    b.say(pickLex(ctx.game, 'tabooRetort', rng), nowReal, { anger: true });
  }
  a.say(topic, nowReal);
  b.memory(`${a.name}跟我聊了聊`, clock.totalDay, clock.hour);
  a.memory(`和${b.name}聊了会儿`, clock.totalDay, clock.hour);
  // 4) 说漏嘴：秘密漏给听者（流言自己会长）  5) 传闲话：听来的事继续走
  //    呈现层：ctx.rumorHook 把每一手记进传闻网，第三代起话走样
  leakTo(a, b, rng, clock, ctx.rumorHook);
  gossip(b, a, rng, clock, ctx.rumorHook);
  // 6) 习俗传播（社会层）：聊天是规矩走的路，倔的人不买账
  if (ctx.customs) spreadCustoms(a, b, ctx.customs, clock, rng, log);
  // 7) 观念传播（v4.7.0 真正的演化）：聊天是念头走的路——比规矩轻，比话重
  if (ctx.game) spreadIdea(a, b, ctx.game, clock.totalDay);
  // 7.5) 信念传播（v4.9.0 感知与名望）：我以为的世界，聊着聊着就到了你脑子里
  if (ctx.game) spreadBelief(a, b, ctx.game, clock.totalDay);
  // 涌现物理层·交换：见面才换——还账/赖账/赠予/换物/赊账，外加归属公认的闲聊
  holdPairTick(a, b, ctx);
  if (log) log(`${a.name}和${b.name}在${a.currentArea(ctx.w)}聊了起来`, '');
  return true;
}

// ---------- AI 快照 ----------
// 返回给 LLM 的紧凑结构（感知上下文必须是可序列化的纯数据）
export function npcSnapshot(npc, ctx) {
  const { w, clock, weather } = ctx;
  const mem = recentMemories(npc, 5, ctx.rng);   // recall 会回写记忆漂移，快照也不能用野骰子（D34）
  // 关系带自己视角的标签（社会层：标签可互相矛盾，误解不对称——快照只放自己的那一份）
  const rels = Object.entries(npc.relations)
    .map(([id, v]) => {
      const rel = npc.rels && npc.rels[id];
      const tag = rel && rel.tags.length ? '·' + rel.tags.join('/') : '';
      return { name: (ctx.nameOf ? ctx.nameOf(id) : id), v, tag };
    })
    .sort((a, b) => b.v - a.v);
  const relTop = rels.slice(0, 3).map(r => `${r.name}:${r.v > 0 ? '+' : ''}${r.v}${r.tag}`);
  const relBot = rels.slice(-2).map(r => `${r.name}:${r.v > 0 ? '+' : ''}${r.v}${r.tag}`);
  // 身体与感受（饥渴冷热是感受）
  const feels = [];
  if (npc.body.feel.cold > 45) feels.push('觉得冷');
  if (npc.body.feel.heat > 55) feels.push('觉得热');
  const bodyText = [`${npc.body.ageYears}岁`, bodySummary(npc.body), ...feels].filter(Boolean).join('，');
  const out = {
    name: npc.name,
    job: npc.job,
    年龄: npc.body.ageYears,
    性格: npc.pers,
    身体: bodyText,
    位置: npc.inside ? '家里' : npc.currentArea(w),
    正在做: npc.intent.label,
    动机: npc.intent.reason || '（没说）',
    状态: {
      精力: Math.round(npc.needs.energy),
      饱食: Math.round(100 - npc.needs.hunger),
      社交欲: Math.round(100 - npc.needs.social),
      心情: Math.round(npc.needs.mood)
    },
    关系: [...relTop, ...relBot].join(' '),
    近事: mem.length ? mem : ['刚搬来不久']
  };
  // v4.5.1 本能半硬编码：身体冲动进快照——AI 看得见"身体在喊什么"，回应不回应由它自己决定
  const urge = urgeOf(npc);
  if (urge && urge.p > 0.4) out.冲动 = urgeLabel(urge.kind, urge.p);
  // 心结（核心矛盾）可以进 prompt；秘密层永不进（第四章·七：只通过行为体现）
  const dom = dominantConflict(npc.mind);
  if (dom) out.心结 = `${dom.a}，可${dom.b}`;
  if (npc._perceiveLog.length) out.最近感知 = [...npc._perceiveLog];
  // v4.4.1 接线1：知识 → 快照——让 AI 看见这个 NPC 相信什么（从经历得出的结论，AI 自己决定怎么用）
  if (Array.isArray(npc.knowledgeList) && npc.knowledgeList.length) {
    out.知识 = npc.knowledgeList.slice(-3).map(k => {
      const tgt = Array.isArray(k.targetNames) && k.targetNames.length ? k.targetNames.join('/') : '';
      return `${k.verb}${tgt ? ':' + tgt : ''}`;
    });
  }
  // v4.7.0 观念层：让 AI 看见这个 NPC 相信什么——观念是演化的燃料
  if (Array.isArray(npc.ideas) && npc.ideas.length && ctx.game && Array.isArray(ctx.game.ideas)) {
    const texts = npc.ideas
      .map(id => ctx.game.ideas.find(i => i.id === id))
      .filter(i => i && i.status !== 'dead')
      .map(i => i.text);
    if (texts.length) out.念头 = texts;
  }
  // v4.8.0 镇规进快照：结晶的规矩人人都看得见——约束力从认知涌现，不从效果字段涌现
  if (ctx.game && Array.isArray(ctx.game.customs) && ctx.game.customs.length) {
    out.镇规 = ctx.game.customs.slice(-5).map(c => `${c.name}（${c.desc}）`);
  }
  // v4.9.0 信念层进快照：我以为的世界（允许错误与过时——误知是真实世界的特征）
  if (Array.isArray(npc.beliefs) && npc.beliefs.length) {
    const bs = npc.beliefs.slice().sort((x, y) => y.conf - x.conf).slice(0, 3);
    out.我以为 = bs.map(b => `${b.text}（${b.src === '亲眼' ? '亲眼所见' : `第${b.day}日听${b.src}说`}）`);
  }
  // v4.9.0 名望场进快照：说话算数的人（公共可见性——称呼让 AI 从这里自己长）
  if (ctx.game && ctx.game._standingTop && ctx.game._standingTop.id !== npc.id) {
    out.说话算数的人 = ctx.game._standingTop.name;
  }
  // 涌现物理层：我手里有什么、欠谁的——LLM 看得见，才可能聊起
  const hold = ensureHold(npc);
  const goodsTxt = Object.entries(hold.goods).map(([k, v]) => `${STOCK_NAME[k] || k}×${v}`);
  if (hold.purse > 0) goodsTxt.unshift(`金币${hold.purse}`);
  if (goodsTxt.length) out.持有 = goodsTxt.join(' ');
  if (hold.owed.length) {
    out.欠账 = hold.owed.map(o =>
      `欠${o.to === 'town' ? '镇上' : (ctx.nameOf ? ctx.nameOf(o.to) : o.to)}${STOCK_NAME[o.res] || o.res}×${o.qty}`
    ).join('，');
  }
  return out;
}

// 供决策落地的动作格式说明（拼进 prompt）
// v4.1：动作不是清单，是格式。表内是"常见动作"（有熟路，响应快）；
// 表外的动作一样合法——世界按物理裁决会发生什么，不按字面值拒收。
export const AI_ACTIONS_DOC = [
  'action：一个动词或短动词短语，说这个居民接下来想做什么。',
  'target：动作涉及的对象（人名/地名/东西的名字，可空；多个对象用「和」隔开）。',
  '常见动作（这些有熟路）：work 干活 / goto 去某处 / chat 找人聊 / eat 吃饭 / sleep 睡觉 / idle 闲逛 / build 营造 / scout 探索 / chop 伐木 / mine 采矿 / haul 搬运 / mill 锯木 / repair 修缮 / say 只说一句话',
  '动作不设清单：他想做清单外的事（比如「把野草扔进汤里」「拿石头砸坚果」），直接写那个动词短语——世界会按物理裁决结果，成不成他都会记住。',
  '东西可以在人之间易手：目标里同时带上一样自己持有的东西和近身的那个人（比如「把鲜鱼给林小满」，target 写「鲜鱼和林小满」），东西就真的到对方手里。给、还、递、扔都一样——物理只看东西从谁手里到谁手里。'
].join('\n');
