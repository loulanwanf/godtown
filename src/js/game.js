// game.js - 游戏编排：主循环/上帝操作/存取档/AI 征集循环（依赖 DOM，渲染层专用）
import { G, O, O_NAME, mulberry32, clamp, rint, chance, choice, fmtClock, STOCK_NAME, PLAN_KINDS, MAT } from './core.js';
import {
  genWorld, bindHouses, placeObj, removeObj, setGround, walkable, nameAt,
  canPlaceSite, findSiteNear, regrowStumps, nearestObjAround, growCropsDaily
} from './world.js';
import {
  CHUNK, serializeChunks, hydrateChunks, chunkHas, getGround, getObj, setObj,
  worldToChunk, chunkOrigin, localIdx, ST, tickChunkWarm
} from './chunk.js';
import { GameClock, SPEED_STEPS } from './time.js';
import { WeatherSys } from './weather.js';
import { NPC, ROSTER, tryPairChat } from './npc.js';
import { urgeOf } from './npc.js';
import { FOG, makeFog, markSeen, serializeFog, hydrateFog } from './fog.js';
import { decorateYards } from './scene.js';
import { EVENT_DEFS, maybeAutoEvent, tickBoars } from './events.js';
import {
  DEFAULT_AI_CFG, requestDecisions, requestDecisionsPooled, applyDecisions, ctxInfoText,
  poolEntries, assignModels, logChain,
} from './ai.js';
import { npcSnapshot as npcSnapshotList } from './npc.js';
import { bodyDailyTick } from './body.js';
import { mindDailyTick } from './secret.js';
import { driftVoice, hashStr } from './language.js';
import { initLexicon, pickLex, lexiconDaily } from './lexicon.js';
import { stageOf, dailyMortality, startDying, elderDaily, dieAndFuneral, pairCheck, tryBirth, assignAdultJob, makeChildDef, desireDaily, pregDaily, birthDaily } from './life.js';
import {
  relDailyTick, customDaily, pullScore, pushScore, departReason,
  makeTravelerDef, relOf, ensureRels, refreshStandingTop
} from './social.js';
import { beliefDaily } from './belief.js';
import {
  ANIMAL_DEFS, animalDailyTick, tickAnimals, spawnWild, husbandryDaily
} from './animals.js';
import {
  RECIPE_DEFS, makeRecipes, seedRecipes, developDaily, forgetOnDeath, serializeRecipes, hydrateRecipes
} from './develop.js';
import {
  evolveDaily, serializeEvo, hydrateEvo
} from './evolve.js';
import {
  disasterDaily, serializeDisaster, hydrateDisaster
} from './disaster.js';
import {
  chronNote, recordRumor, markNote, relHistDaily, hlSnap, serializeHistory, hydrateHistory
} from './history.js';
import {
  makeNeurocore, neuroObserve, neuroOnDeath, neuroOnBorn, neuroDaily
} from './neurocore.js';
import { holdDaily, claimHouse } from './hold.js';
import { ensureResourcePrototypes } from './action.js';
import { serializeMatter, reviveMatter } from './matter.js';
import { captureDiscoveries, serializeDiscovery, hydrateDiscovery } from './discovery.js';
import { knowledgeDaily, serializeKnowledge, hydrateKnowledge, KNOWLEDGE } from './knowledge.js';
import { geologyTick, serializeGeology, hydrateGeology, GEOL } from './geology.js';
import { climateTick, initClimateState, serializeClimate, hydrateClimate, CLIMATE } from './climate.js';
import { initSettlements, settlementsDaily, serializeSettlements, hydrateSettlements, SETT } from './settlement.js';
import { finalizeToWanderer, wandererDaily, wandererFrame, wrng } from './wanderer.js';

const SAVE_KEY = 'godtown.save.v2';   // v2.1.0：无限地图改造，存档格式变更（旧 v1 档自动迁移）
const ORIGIN_W = 72, ORIGIN_H = 72;   // 起源城镇边界（无限地图以起源镇为心，殖民地边缘带按此算）

// ---------- NPC 序列化/反序列化（v4.5.0 抽出：npcs 与 wanderers 共用一套） ----------
function serNpc(n) {
  return {
    id: n.id, name: n.name, sex: n.sex, job: n.job, workArea: n.workArea,
    traits: n.traits || [], hair: n.hair, shirt: n.shirt, pers: n.pers,
    x: +n.x.toFixed(2), y: +n.y.toFixed(2), inside: n.inside,
    needs: n.needs, relations: n.relations,
    memories: n.memories.slice(-40),
    body: n.body,
    mind: n.mind,
    family: n.family, spouse: n.spouse, dying: n.dying,
    rels: n.rels, departing: n.departing, origin: n.origin || null,
    intentLog: n.intentLog || [],     // 呈现层：因果链随档走
    hold: n.hold || null,             // 涌现物理层：个人持有随档走（旧档无则惰性初始化）
    aiModelId: n.aiModelId || null,   // 模型池分配缓存随档走（旧档无则惰性重算）
    aiDcAt: n.aiDcAt || 0,            // v2.8.0 个人决策时刻随档走（aiAsking 在途态不存）
    orient: n.orient || null,         // v4.5.0 性别层随档走
    wanderlust: n.wanderlust != null ? n.wanderlust : null,   // 远方命随档走
    preg: n.preg || null,             // 怀孕状态随档走
    visiting: n.visiting || null,     // 探亲在途随档走
    beliefs: (n.beliefs || []).slice(-12)   // v4.9.0 信念随档走
  };
}
function hydNpc(g, s, noHouse) {
  const ri = ROSTER.findIndex(d => d.id === s.id);
  let n;
  if (ri >= 0) {
    n = new NPC(ROSTER[ri], noHouse ? null : g.world.houses[ri], g.lexicon);
  } else {
    const cdef = {
      id: s.id, name: s.name, sex: s.sex, age: (s.body && s.body.ageYears) || 0,
      job: s.job, workArea: s.workArea, traits: s.traits || [],
      hair: s.hair, shirt: s.shirt, pers: s.pers, family: s.family
    };
    const fh = noHouse ? null : g.world.houses.find(h => h.ownerId === (s.family && s.family.parents[0]))
      || g.world.houses.find(h => h.ownerId === (s.family && s.family.parents[1]));
    n = new NPC(cdef, fh || null, g.lexicon);
  }
  n.x = s.x; n.y = s.y; n.inside = !!s.inside;
  // 白纸开局（v2.7.0）：职业是演化结果字段，必须随档走——ROSTER 已无预置职业，不回填老档会全员失业
  if (s.job != null) n.job = s.job;
  if (s.workArea != null) n.workArea = s.workArea;
  Object.assign(n.needs, s.needs || {});   // 旧档无 desire 时保留构造器默认 15（Object.assign 只覆盖存在的键）
  n.relations = s.relations || n.relations;   // 关系随档整体替换（不能 merge——会把构造器初始值复活进存档）
  n.memories = s.memories || [];
  if (s.body && s.body.parts) n.body = s.body;   // 旧档无 body 则用新建的
  if (s.mind) Object.assign(n.mind, s.mind);     // 认知层随档走（旧档缺省用新建的）
  if (s.family) n.family = s.family;             // 生命层随档走
  n.spouse = s.spouse || null;
  n.dying = s.dying || null;
  if (s.rels) n.rels = s.rels;                   // 社会层：关系对象随档走（v1.6+ 存档）
  else { n.rels = null; ensureRels(n, 0); }      // 旧档：按存档的数值关系重建关系对象（惰性升级）
  n.departing = s.departing || null;
  n.origin = s.origin || null;
  n.intentLog = s.intentLog || [];                 // 呈现层：因果链（旧档缺省为空，从读档时刻开始记）
  n.hold = s.hold || null;                         // 涌现物理层：持有随档走（旧档无 → ensureHold 惰性初始化）
  n.beliefs = s.beliefs || [];                     // v4.9.0 信念层随档走（旧档无 → 空，世界等着被以为）
  n.aiModelId = s.aiModelId || null;               // 模型池分配缓存随档走（池开着且缓存失效时惰性重算）
  n.aiDcAt = s.aiDcAt || 0;                        // v2.8.0 个人决策时刻随档走（0 → hydrate 末尾错开初始化）
  n.aiAsking = false;                              // 在途态绝不复活（否则永久挂起候问）
  n.intent = { type: 'ready', label: '待命', untilMin: 0 };
  // v4.5.0 性别层：怀孕/探亲随档走（取向由构造器按 id 哈希确定性重建，新旧档天然一致）
  if (s.orient) n.orient = s.orient;
  if (s.wanderlust != null) n.wanderlust = s.wanderlust;   // 远方命：有档随档，无档用构造器的 id 哈希值（同款确定性）
  n.preg = s.preg || null;
  n.visiting = s.visiting || null;
  return n;
}


export class Game {
  constructor(renderer) {
    this.renderer = renderer;
    this.fx = renderer;              // events.js 用 fx 触发特效
    this.world = null;
    this.npcs = [];
    this.clock = null;
    this.weather = null;
    this.rng = mulberry32(12345);   // 占位：newGame/hydrate 会立刻按 seed 重置——主骰流必须由 seed 定终身，墙钟会让同 seed 跑出不同世界（D34）
    this.stock = { gold: 0, wood: 0, stone: 0, copper: 0, iron: 0, goldOre: 0, fish: 0, crop: 0, berry: 0 };   // 白纸开局：不带来任何存货
    this.boars = [];
    this.festivalUntilMin = 0;
    this.droughtDays = 0;
    this.aiCfg = { ...DEFAULT_AI_CFG };
    this.display = { renderStyle: 'smooth' };   // 渲染风格：smooth(平滑抗锯齿) / pixel(硬边像素)
    this.plans = [];                 // 居民自主营造计划
    this._planSeq = 1;
    this.dead = [];                  // 生命层：故者档案（镇史种子）
    this._lifeSeq = 1;               // 新生儿序号
    this._funeral = null;            // 葬礼进行时
    // —— v1.6.0 社会层 —— 习俗/镇史(离镇)/流动人口序号/婚宴进行时
    this.customs = [];
    this.left = [];
    this.wanderers = [];             // v4.5.0 离镇者：走出小镇的人在无限地图上继续活着（实体不毁）
    this._inSeq = 1;
    this._wedding = null;
    // —— v1.7.0 物质层 —— 仓库/木匠坊/建筑风格(积木+方言)/磨损/无主好地块/殖民地
    this.barn = null;        // 仓库位置 {x,y}——木板的中转站
    this.workshop = null;    // 木匠坊 {x,y,logs,mill}——原木在这里变成木板
    this.styles = new Map(); // "x,y" → {v,by}——落成建筑的积木样式（建筑方言）
    this.wear = new Map();   // "x,y" → {v,work}——建筑磨损，没人修会垮
    this.frontier = null;    // 无主好地块 {x,y,day}——scout 发现的开拓候选
    this.colony = null;      // 殖民地 {foundedDay,houses:[{x,y,by}]}——小镇往外长
    // —— v1.8.0 世界层 —— 动物（驯化/伴侣/野生）
    this.animals = [];
    // —— v1.9.0 演化层 —— 配方知识（人脑里）/灾难（瘟疫/火灾）
    this.recipes = makeRecipes();
    this.plague = null;
    this.fire = null;
    this.plagueUntil = 0;
    // —— v2.3.0 演化引擎（第十一章）—— 候选池/演化日志/玩家风向/动态配方表/演化事件与建筑
    this.recipeDefs = { ...RECIPE_DEFS };   // 运行时配方表：铁律层 RECIPE_DEFS 不动，演化新配方动态注册在这
    this.evoPool = [];
    this.evoLog = [];
    this.evoWind = '';
    this._evoSeq = 1;
    this.evoEvents = [];
    this.evoBuilds = [];
    this.whispers = [];            // 玩家低语/神旨记录（演化引擎 player 缺口信号，cap 20）
    this.decrees = [];
    this.fallbackStats = null;     // 意图降级统计（repeat 缺口信号）
    this.matters = [];             // 世界物质索引（v4.1）：散置的、可被动作指认的物质实例登记处
    // —— v4.4 世界自变 + 多聚落 —— 地质统计/气候状态/聚落列表
    this._lastGeoYear = 0;          // 地质层：上次 tick 的年份
    this._erodedTotal = 0;
    this._collapsedTotal = 0;
    this._slidTotal = 0;
    this._sunkTotal = 0;
    this.climateState = null;       // 气候层状态（大周期/季节/极端）
    this.settlements = [];          // 聚落列表（起源镇 + 分裂出的新聚落）
    // —— v2.0.0 呈现层 —— 编年史/传闻网/地形考古/高光帧
    this.chron = [];
    this.rumors = [];
    this.marks = new Map();
    this.highlights = [];
    this.neurocore = null;           // 神经芯（v2.5.0）：newGame 里种子定宿主，hydrate 里随档走

    this.fog = makeFog();            // v4.5.1 探索迷雾：只被居民脚印点亮
    this.nowReal = 0;
    this.bannerUntil = 0;
    this.aiBusy = false;               // 一批决策在途锁（锁批次不锁全镇）
    // v2.8.0 按需触发：各活各的——谁手头的事干完、自己的冷却到了，才叫醒谁（不再全镇同步）
    this.aiBatch = [];                 // 候问队列：已到期且 ready 的人，攒收集窗口后成批
    this.aiBatchStart = 0;             // 队列首个入队时刻（绝对游戏分钟；收集窗口/超时兜底计时）
    this.aiAskWindow = 30;             // 收集窗口（游戏分钟）：窗口内凑人搭车
    this.aiAskCap = 4;                 // 一批最多人数
    this.aiAskTimeout = 90;            // 候问超时（游戏分钟）：还没应答就脚本先顶，活着不等神仙
    this.aiSchedPaused = false;        // 测试闸：只挂自动主循环的调度（手动调 aiLoopTick 不受影响）
    this.selNpcId = null;
    this.logLines = [];
    this.uiHooks = {};               // {onLog, onTickUI, onNewDay}
    this._acc = 0;
    // 用实例箭头函数：允许被解构后调用（ai.js/events.js 会解构 log）
    this.log = (text, cls) => {
      const line = { t: fmtClock(this.clock ? this.clock.hour : 6), day: this.clock ? this.clock.totalDay : 1, text, cls: cls || '' };
      this.logLines.push(line);
      if (this.logLines.length > 240) this.logLines.splice(0, this.logLines.length - 240);
      if (this.uiHooks.onLog) this.uiHooks.onLog(line);
      // 呈现层（第十章）：hl 即骨架——编年史记一笔 + 当时视角落一帧高光
      if (cls === 'hl') {
        chronNote(this, 'event', text);
        hlSnap(this, text);
      }
    };
    // 编年史专用入口：带类别与起因的大事（同时进日志与高亮）
    this.annal = (kind, text, why) => {
      chronNote(this, kind, text, why);
      this.log(text, 'hl');
    };
  }

  // ---------- 初始化 ----------
  newGame(seed) {
    this.seed = seed || ((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    this.rng = mulberry32(this.seed >>> 0);   // D34：主骰流跟 seed 走——同 seed 必须跑出同一个世界
    this._wandRng = null;   // D28 离镇骰流也一并重发，wrng 会按新 seed 惰性重建
    this.world = genWorld(this.seed);
    // v2.1.0 区块温度：起源四块起始就是温的（镇子有人住，作物才会长）
    for (const c of this.world.ws.iterNonVirgin()) c.state = ST.WARM;
    bindHouses(this.world, ROSTER);
    decorateYards(this.world, ROSTER, mulberry32(this.seed ^ 0x5deece66d));
    // 语言革命（v3.1.0）：词库是初始条件——每个世界从同一张种子表出发，说出各自不同的话
    this.lexicon = initLexicon();
    this.npcs = ROSTER.map((def, i) => new NPC(def, this.world.houses[i], this.lexicon));
    for (const n of this.npcs) n.intent = { type: 'ready', label: '待命', untilMin: 0 };
    this.clock = new GameClock();
    this.weather = new WeatherSys(mulberry32(this.seed ^ 0x9e3779b9));
    this._lastYear = this.clock.year;   // 年轮转检测（长岁用）
    this._lastSeason = this.clock.season;
    this.boars = [];
    this.stock = { gold: 0, wood: 0, stone: 0, copper: 0, iron: 0, goldOre: 0, fish: 0, crop: 0, berry: 0 };   // 白纸开局：不带来任何存货
    this.plans = [];
    this._planSeq = 1;
    this.dead = [];
    this._lifeSeq = 1;
    this._funeral = null;
    this.customs = [];
    this.left = [];
    this.wanderers = [];             // v4.5.0 离镇者：走出小镇的人在无限地图上继续活着（实体不毁）
    this._inSeq = 1;
    this._wedding = null;
    // 物质层初始化：初始仓库建在集市街旁，镇子建立时带来的存货总得有地方放
    this.barn = null; this.workshop = null;
    this.styles = new Map(); this.wear = new Map();
    this.frontier = null; this.colony = null;
    this.animals = [];
    // 演化层初始化：老手艺是常识，灾难还没来过
    this.recipes = makeRecipes();
    this.plague = null; this.fire = null; this.plagueUntil = 0;
    // 演化引擎初始化：候选池空着，风向由玩家定，动态配方表从铁律层起步
    this.recipeDefs = { ...RECIPE_DEFS };
    this.evoPool = []; this.evoLog = []; this.evoWind = ''; this._evoSeq = 1;
    this.evoEvents = []; this.evoBuilds = [];
    this.whispers = []; this.decrees = []; this.fallbackStats = null;
    // v4.7.0 观念系统：全镇观念池——NPC 从经历里长出来的念头，自由文本，不限种类
    this.ideas = []; this._ideaSeq = 1;
    // 涌现物理层初始化（v2.4.0）：交换统计/赖账计数/归属争议/认领登记——只记物理事实，不写任何制度
    this.exchangeStats = {}; this.owedDefaults = 0; this.claimDisputes = 0;
    this.claims = new Map();
    // 神经芯初始化（v2.5.0）：开局寄宿在一位居民身上（种子定人，可复现）
    this.neurocore = makeNeurocore(
      this.npcs[Math.floor(mulberry32(this.seed ^ 0x5a17)() * this.npcs.length)].id,
      this.clock.totalDay
    );
    // 呈现层初始化：镇子的历史从空白开始长
    this.chron = []; this.rumors = []; this.marks = new Map(); this.highlights = [];
    // 世界自变初始化（v4.4）：气候从种子起步，聚落从起源镇开始，地质统计归零
    this._lastGeoYear = this.clock.year;
    this._erodedTotal = 0; this._collapsedTotal = 0; this._slidTotal = 0; this._sunkTotal = 0;
    this.climateState = initClimateState(this.seed);
    this.settlements = initSettlements({ x: 36, y: 36 }, this.seed, mulberry32(this.seed ^ 0x5e7));
    const bs = findSiteNear(this.world, 55, 31, mulberry32(this.seed ^ 0x1b7), []);
    if (bs) {
      placeObj(this.world, bs.x, bs.y, O.BARN);
      this.barn = { x: bs.x, y: bs.y };
      this.wear.set(bs.x + ',' + bs.y, { v: 0, work: 0 });
      markNote(this, bs.x, bs.y, 'built', '老仓库', '开镇');   // 考古入口：镇上第一件家当
    }
    this.logLines = [];
    this.log(`雾溪镇建成，${this.npcs.length}位居民入住`, 'hl');
    this.log('你是这座小镇的创世神。天气、地貌、事件，皆由你定。', '');
    seedRecipes(this);   // 演化层：镇子建立时带来的老手艺（常识）
    ensureResourcePrototypes(this);   // v4.8.0 归属物理：资源原型入登记处（「粮食」「金币」有公名）
    this.renderer.mapDirty = true;
    this._initAiStagger();   // v2.8.0：个人决策时刻开局错开（不设定全镇闹钟）
  }

  serialize() {
    return {
      v: 2,   // v2.1.0：无限地图（chunk 序列化替代两大数组）
      seed: this.seed,
      world: {
        // 仅存 dirty 的非 VIRGIN chunk（热区块 + 起源 4 chunk）
        chunks: serializeChunks(this.world.ws)
      },
      clock: this.clock.serialize(),
      weather: this.weather.serialize(),
      stock: this.stock,
      npcs: this.npcs.map(serNpc),
      wanderers: this.wanderers.map(n => ({ ...serNpc(n), wand: n.wand })),   // v4.5.0 离镇者随档走
      aiCfg: this.aiCfg,
      display: this.display,
      droughtDays: this.droughtDays,
      plans: this.plans.map(p => ({ ...p })),
      planSeq: this._planSeq,
      dead: this.dead,
      lifeSeq: this._lifeSeq,
      funeral: this._funeral,
      customs: this.customs, left: this.left, inSeq: this._inSeq, wedding: this._wedding,
      // 物质层随档走（v1.7+ 存档）
      barn: this.barn, workshop: this.workshop,
      styles: [...this.styles.entries()], wear: [...this.wear.entries()],
      frontier: this.frontier, colony: this.colony,
      // 世界层：动物随档走（v1.8+ 存档）
      animals: this.animals,
      // 演化层：配方知识/灾难随档走（v1.9+ 存档）
      recipes: serializeRecipes(this.recipes),
      disaster: serializeDisaster(this),
      // 演化引擎：候选池/演化日志/风向/动态配方表随档走（v2.3+ 存档）
      evo: serializeEvo(this),
      // 呈现层：编年史/传闻网/考古标记/高光帧随档走（v2.0+ 存档）
      history: serializeHistory(this),
      // 涌现物理层随档走（v2.4+ 存档）：交换统计/赖账/争议/认领登记（Map 存 entries）
      exchangeStats: this.exchangeStats || {},
      owedDefaults: this.owedDefaults || 0,
      claimDisputes: this.claimDisputes || 0,
      claims: [...(this.claims || new Map()).entries()],
      // 神经芯随档走（v2.5+ 存档）：一颗芯、一张权重表，纯数据
      neurocore: this.neurocore || null,
      // 语言革命（v3.1.0）：词库随档走——这个世界说过的话、死了的词，都是它自己的
      lexicon: this.lexicon,
      // 物质索引随档走（v4.1）：NPC 起过的名、指认过的东西——读档不该让这个世界失忆
      matters: (this.matters || []).map(serializeMatter),
      // 发现层随档走（v4.2）：NPC 的意外索引、全镇识别出的技能——天道退役后世界自己长出来的东西
      discovery: serializeDiscovery(this),
      // 知识层随档走（v4.3）：NPC 的知识索引——从经历中得出的道理，会随人死而消失
      knowledge: serializeKnowledge(this),
      // 世界自变随档走（v4.4）：地质统计/气候状态/聚落——世界自己的变化不读档就丢了
      geology: serializeGeology(this),
      climate: serializeClimate(this.climateState),
      settlements: serializeSettlements(this.settlements),
      fog: serializeFog(this.fog),   // v4.5.1 探索迷雾随档走——读档不该让已点亮的世界重新黑掉
      houseState: this.world.houses.map(h => ({ ownerId: h.ownerId, wear: h.wear || 0, ruined: !!h.ruined }))
    };
  }
  static hydrate(data, renderer) {
    const g = new Game(renderer);
    g.seed = data.seed || 12345;
    g.rng = mulberry32(g.seed >>> 0);   // D34：读档也按 seed 重置主骰流，不吃构造时的墙钟
    g._wandRng = null;
    g.world = genWorld(g.seed);
    // 存档版本分支：v2=chunk 序列化；v1=旧 72×72 两大数组（自动迁移到 4 起源 chunk）
    if (data.v >= 2 && data.world && data.world.chunks) {
      // v2：genWorld 已生成起源 4 chunk（含城镇），hydrateChunks 用存档覆盖
      hydrateChunks(g.world.ws, data.world.chunks);
    } else if (data.world && data.world.ground) {
      // v1 → v2 迁移：旧 72×72 数组拆到 4 起源 chunk（x∈[0,71]&&y∈[0,71]）
      migrateV1World(g.world, data.world);
    }
    bindHouses(g.world, ROSTER);
    // 语言革命（v3.1.0）：词库先于居民恢复——新生儿/声音都要从当下词库抓（旧档无词库落种子表）
    g.lexicon = data.lexicon || initLexicon();
    // 按存档名册重建（v1.5.0：新生儿不在 ROSTER 里，完整档案随档走）
    g.npcs = (data.npcs || []).map(s => hydNpc(g, s, false));
    // v4.5.0 离镇者随档走（不绑房——他们的家已经不在镇上了；旧档无此字段则为空）
    g.wanderers = (data.wanderers || []).map(s => {
      const n = hydNpc(g, s, true);
      n.wand = s.wand || null;
      return n;
    });
    // 生命层：故者档案/新生儿序号/葬礼 + 新生儿精灵重注册（读档后 id 不在图集里）
    g.dead = data.dead || [];
    g._lifeSeq = data.lifeSeq || 1;
    g._funeral = data.funeral || null;
    // 社会层：习俗/离镇者/序号/婚宴随档走
    g.customs = data.customs || [];
    g.left = data.left || [];
    g._inSeq = data.inSeq || 1;
    g._wedding = data.wedding || null;
    // 物质层随档走（旧档缺省用构造器初值：无仓库无坊，材料链从提议木匠坊起步）
    g.barn = data.barn || null;
    g.workshop = data.workshop || null;
    g.styles = new Map(data.styles || []);
    g.wear = new Map(data.wear || []);
    g.frontier = data.frontier || null;
    g.colony = data.colony || null;
    // 世界层：动物随档走（旧档缺省为空——畜生是后来才养起来的）
    g.animals = (data.animals || []).map(a => {
      const out = { ...a };
      if (out.sex == null) {   // v4.5.0 性别层：旧档动物补公母与日龄（按 id 哈希确定，新旧档天然一致）
        const ar = mulberry32(hashStr(out.id || (out.kind + out.x + ',' + out.y)));
        out.sex = ar() < 0.5 ? '公' : '母';
        out.ageDays = ANIMAL_DEFS[out.kind] ? ANIMAL_DEFS[out.kind].maturity : 20;
      }
      if (out.preg === undefined) out.preg = null;
      return out;
    });
    // 演化层：配方知识/灾难随档走（旧档缺省用初值——老手艺重新做常识）
    // 演化引擎先恢复（动态配方表要在 hydrateRecipes 之前就位，动态手艺的知识才捞得回来）
    hydrateEvo(g, data.evo);
    g.recipes = hydrateRecipes(data.recipes, g.recipeDefs);
    hydrateDisaster(g, data.disaster);
    if (!data.recipes) seedRecipes(g);   // 老档没配方表：把常识发给手艺人
    // 呈现层随档走（旧档缺省：从镇魂碑把坟茔考古出来）
    hydrateHistory(g, data.history);
    // 涌现物理层随档走（旧档缺省：交换还没开始长，房子还是故人的名字）
    g.exchangeStats = data.exchangeStats || {};
    g.owedDefaults = data.owedDefaults || 0;
    g.claimDisputes = data.claimDisputes || 0;
    g.claims = new Map(data.claims || []);
    // 物质索引随档走（v4.1；旧档无此字段 → 空登记处，世界还没被指认过）
    g.matters = (data.matters || []).map(reviveMatter);
    // v4.8.0 归属物理：资源原型补齐（旧档没有——「粮食」「金币」从此有了公名锚点）
    ensureResourcePrototypes(g);
    // 发现层随档走（v4.2；旧档无此字段 → 空 discoveries，世界还没长出自己的技能）
    hydrateDiscovery(g, data.discovery);
    // 知识层随档走（v4.3；旧档无此字段 → 空 knowledgeList，世界还没人琢磨出道理）
    hydrateKnowledge(g, data.knowledge);
    // 世界自变随档走（v4.4；旧档无此字段 → 世界静止，地质/气候从零起步）
    hydrateGeology(g, data.geology);
    g.climateState = hydrateClimate(data.climate);
    g.settlements = hydrateSettlements(data.settlements);
    g.fog = hydrateFog(data.fog);   // v4.5.1：旧档无此字段 → 空迷雾，世界从漆黑开始被居民重新点亮
    for (const hs of (data.houseState || [])) {
      const h = g.world.houses.find(v => v.ownerId === hs.ownerId);
      if (h) { h.wear = hs.wear || 0; h.ruined = !!hs.ruined; }
    }
    // 涌现物理层：认领的房读档后接回（bindHouses 只认名册，占着的要还原 owner 与 home）
    for (const [key, c] of g.claims) {
      const n = g.npcs.find(v => v.id === c.by);
      if (!n) continue;
      const [hx, hy] = key.split(',').map(Number);
      const h = g.world.houses.find(v => v.ox === hx && v.oy === hy);
      if (!h) continue;
      h.ownerId = n.id; h.ownerName = n.name; h.ownerJob = n.job;
      if (!n.home) n.home = { x: h.ox, y: h.oy, doorX: h.doorX, doorY: h.doorY, hx: h.x, hy: h.y };
    }
    if (renderer && renderer.ts && renderer.ts.registerChild) {
      for (const n of g.npcs) renderer.ts.registerChild(n.id, n.hair);
      for (const n of g.wanderers) renderer.ts.registerChild(n.id, n.hair);   // v4.5.0 离镇者精灵也重注册
    }
    g.clock = GameClock.from(data.clock);
    g.weather = WeatherSys.from(data.weather, mulberry32(g.seed ^ 0x77));
    g._lastYear = g.clock.year;
    g._lastSeason = g.clock.season;
    // 神经芯随档走（v2.5+）：旧档无芯 → 长出一颗无主的游荡芯（30 天内有新生儿就落地）
    g.neurocore = data.neurocore || null;
    if (!g.neurocore) {
      g.neurocore = makeNeurocore(null, g.clock.totalDay);
      g.neurocore.floating = true;
      g.neurocore.deadSince = g.clock.totalDay;
    }
    if (g.neurocore.rounds == null) g.neurocore.rounds = 0;
    delete g.neurocore.dead;   // 芯不灭：早期 v2.5 档里的芯死标记作废（轮回替代）
    g.stock = { ...g.stock, ...(data.stock || {}) };
    g.aiCfg = { ...DEFAULT_AI_CFG, ...(data.aiCfg || {}) };
    g.display = { renderStyle: 'smooth', ...(data.display || {}) };
    g.droughtDays = data.droughtDays || 0;
    g.plans = (data.plans || []).map(p => ({ ...p }));
    g._planSeq = data.planSeq || (g.plans.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1);
    g.log(`世界恢复：${g.clock.label()}`, 'good');
    renderer.mapDirty = true;
    g._initAiStagger();   // v2.8.0：老档无个人时刻→错开初始化；在途态不复活
    return g;
  }
  saveLocal() {
    try {
      const json = JSON.stringify(this.serialize());
      localStorage.setItem(SAVE_KEY, json);
      // 双写到自定义数据路径（异步，不阻塞）
      if (window.gdIO && window.gdIO.saveData) {
        window.gdIO.saveData(json).catch(() => {});
      }
      this.log('自动存档完成', '');
      return true;
    } catch (e) {
      this.log('存档失败：' + (e && e.message), 'err');
      return false;
    }
  }
  static hasLocalSave() { return !!localStorage.getItem(SAVE_KEY); }
  static loadLocal(renderer) {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    try { return Game.hydrate(JSON.parse(raw), renderer); }
    catch (e) { console.error('读档失败', e); return null; }
  }
  // 从文件存储恢复（启动时优先于 localStorage）
  static async loadFromFile(renderer) {
    if (!window.gdIO || !window.gdIO.loadData) return null;
    try {
      const r = await window.gdIO.loadData();
      if (r && r.ok && r.text) {
        const g = Game.hydrate(JSON.parse(r.text), renderer);
        if (g) {
          // 同步回 localStorage（保持双写一致）
          localStorage.setItem(SAVE_KEY, r.text);
          return g;
        }
      }
    } catch (e) { console.error('文件读档失败', e); }
    return null;
  }
  static clearLocal() {
    localStorage.removeItem(SAVE_KEY);
    if (window.gdIO && window.gdIO.clearData) {
      window.gdIO.clearData().catch(() => {});
    }
  }

  // ---------- 日志 ----------
  banner(text) {
    this.bannerUntil = performance.now() + 3800;
    const el = document.getElementById('eventBanner');
    if (el) { el.textContent = text; el.classList.remove('hidden'); }
  }

  // ---------- 主循环 ----------
  loop(dtReal) {
    this.nowReal += dtReal;
    // 时间推进
    const before = this.clock.min;
    const r = this.clock.tick(dtReal);
    const gmPerReal = SPEED_STEPS[this.clock.speed] || 0;

    // 天气
    const prevW = this.weather.type;
    const changed = this.weather.tick((this.clock.min - before) + (r.newDay ? 0 : 0), this.clock.season, () => {
      this.log('一道闪电劈过小镇上空', 'warn');
    });
    if (changed && changed !== prevW) this.log(`天气转为${this.weather.label}`, 'hl');
    // v2.8.0 按需插队：刚开始降水，户外且不勇敢的人立刻可以重新拿主意（躲雨是他自己的决定）
    if (changed && changed !== prevW && this.weather.precipitating) this._aiKickPrecip();

    // NPC tick
    const ctx = {
      w: this.world, clock: this.clock, weather: this.weather, rng: this.rng,
      npcs: this.npcs, stock: this.stock, nowReal: this.nowReal,
      gmPerReal, log: (t, c) => this.log(t, c),
      game: this,   // 涌现物理层：产出经过手/见面才换需要镇级上下文
      workOnPlan: (npc, gm) => this.workOnPlan(npc, gm),
      onScout: (npc) => this.onScout(npc),
      haulJob: (npc) => this.haulJob(npc),
      millJob: () => this.millJob(),
      haulArrive: (npc, then) => this.haulArrive(npc, then),
      millTick: (npc, gm) => this.millTick(npc, gm),
      repairTick: (npc, gm, key) => this.repairTick(npc, gm, key),
      dead: this.dead,
      customs: this.customs,
      // 呈现层·传闻网：说漏嘴/传闲话的每一手都进网
      rumorHook: (info) => recordRumor(this, info)
    };
    const aiNowMin = this._aiNowMin();
    for (const n of this.npcs) {
      n.tick(dtReal, ctx);
      // 脚本 AI：待命状态找事做（传 this 作镇级上下文：plans/stock/claimPlan）
      // v2.8.0 两类人脚本不碰：①候问在途（aiAsking）——已在等 LLM，别中途塞活打架
      // ②这一帧刚到期可问（claimable）——留给帧尾 aiLoopTick 收走，否则同帧脚本先派活，LLM 永远轮空
      if (n.intent.type === 'ready' && !n.path.length && !n.aiAsking && !this._aiClaimable(n, aiNowMin)) {
        const dec = n.scriptDecide(this.world, this.clock, this.weather, this.rng, this.npcs, this);
        // 神经芯（v2.5.0）：奖励调制——宿主日子过得好不好，回头写进芯的权重表
        neuroObserve(this, n, dec);
        n.applyScriptDecision(this.world, this.rng, dec, this.npcs, this);
      }
    }
    // v2.1.0 区块温度：NPC 脚下 HOT、四邻 WARM，闲置逐时降级（日生长/逐时 tick 只看 WARM+）
    const ws = this.world.ws;
    ws.clock = this.clock.totalDay * 1440 + this.clock.min;
    for (const n of this.npcs) {
      if (n.inside) continue;
      const [cx, cy] = worldToChunk(Math.floor(n.x), Math.floor(n.y));
      ws.promoteToHot(cx, cy);
      ws.promoteToWarm(cx + 1, cy); ws.promoteToWarm(cx - 1, cy);
      ws.promoteToWarm(cx, cy + 1); ws.promoteToWarm(cx, cy - 1);
    }
    if (Math.floor(this.clock.min / 60) !== Math.floor(before / 60) || r.newDay) {
      const ctxH = { rng: this.rng, weatherType: this.weather.type, clock: this.clock };
      for (const c of ws.iterNonVirgin()) {
        ws.coolDown(c.cx, c.cy, 240, 720, 1440);
        if (c.state >= ST.WARM) tickChunkWarm(c, ctxH, 60);
      }
    }

    // 广场偶遇聊天
    this.randomEncounters(dtReal);

    // 野猪
    tickBoars(this, dtReal, gmPerReal);
    // 世界层：动物帧推进（游荡/逃跑/跟随/狼袭击）
    tickAnimals(this, dtReal, gmPerReal);
    // v4.5.0 离镇者：荒野里的人也在走（降精度连续——日推进定方向，帧推进走路）
    wandererFrame(this, dtReal);
    // v4.5.1 探索迷雾：只被居民的脚印点亮——相机不算数，看见不等于到过
    if (FOG.enabled) {
      for (const n of this.npcs) if (!n.inside) markSeen(this.fog, Math.floor(n.x), Math.floor(n.y), FOG.npcRadius);
      for (const wn of this.wanderers || []) markSeen(this.fog, Math.floor(wn.x), Math.floor(wn.y), FOG.wandererRadius);
    }

    // 庙会：时间到就散
    if (this.festivalUntilMin > 0) {
      let elapsed = this.clock.min - before;
      if (elapsed < 0) elapsed += 1440;
      this.festivalUntilMin -= elapsed;
      if (this.festivalUntilMin <= 0) {
        this.festivalUntilMin = 0;
        this.log('庙会散场，居民们带着笑意回家', 'good');
        for (const n of this.npcs) { n.moodDelta(3); }
      } else {
        this.festivalTick(dtReal);
      }
    }

    // 葬礼：哭丧与送别（第八章·哭丧；死亡有过程——第三章·十）
    if (this._funeral) this.funeralTick();
    // 婚宴：喜歌与吃喜酒（社会层·婚嫁；第八章·喜歌）
    if (this._wedding) this.weddingTick();

    // AI 征集（按需触发：各活各的，谁冷却到+手头事完才叫醒谁；aiSchedPaused 仅供冒烟手动驱动）
    if (!this.aiSchedPaused) this.aiLoopTick();

    // 新的一天
    if (r.newDay) this.onNewDay(r.days);

    this._acc += dtReal;
    if (this._acc > 0.5) { this._acc = 0; if (this.uiHooks.onTickUI) this.uiHooks.onTickUI(); }
  }

  randomEncounters(dtReal) {
    // 每 2 现实秒尝试一次：相邻两个待命居民聊天
    this._encCd = (this._encCd || 0) - dtReal;
    if (this._encCd > 0) return;
    this._encCd = 2;
    const awake = this.npcs.filter(n => !n.inside && n.intent.type === 'idle' && this.clock.hour > 6.5 && this.clock.hour < 21.5);
    for (let i = 0; i < awake.length; i++) {
      for (let j = i + 1; j < awake.length; j++) {
        const a = awake[i], b = awake[j];
        if (Math.abs(a.x - b.x) < 1.6 && Math.abs(a.y - b.y) < 1.6) {
          const talked = tryPairChat(a, b, { clock: this.clock, rng: this.rng, nowReal: this.nowReal, log: (t, c) => this.log(t, c), w: this.world, customs: this.customs, game: this, rumorHook: (info) => recordRumor(this, info) });
          if (talked) {
            // 旁观者：近处有人听见他们在聊天（低概率——不必人人都知道）
            for (const o of this.npcs) {
              if (o === a || o === b || o.inside || o.intent.type === 'sleep') continue;
              if (Math.abs(o.x - a.x) + Math.abs(o.y - a.y) < 6 && chance(this.rng, 0.25)) {
                o.perceive('hear', a.name + '和' + b.name + '在说话', this.clock.totalDay, this.clock.hour, 0);
              }
            }
          }
          return;
        }
      }
    }
  }

  festivalTick(dtReal) {
    // 庙会中：闲散居民往广场聚
    this._fesCd = (this._fesCd || 0) - dtReal;
    if (this._fesCd > 0) return;
    this._fesCd = 5;
    for (const n of this.npcs) {
      if (n.inside || n.intent.type === 'work' || n.intent.type === 'sleep') continue;
      if (n.intent.type === 'ready' || n.intent.type === 'idle') {
        n.setGotoArea(this.world, 'plaza', this.rng, { type: 'chat', with: null, dur: 60 }, '赶庙会');
      }
    }
    // 庙会说书（第八章）：话本是镇上的耳朵
    this._storyCd = (this._storyCd || 0) - dtReal;
    if (this._storyCd <= 0) {
      this._storyCd = 26;
      const teller = this.npcs.find(n => !n.inside && (n.job === '商人' || n.job === '学生'));
      if (teller) teller.say(pickLex(this, 'story', this.rng), this.nowReal);
    }
  }

  // ---------- 生命层：出生/葬礼/调试（v1.5.0，计划书第三章·十、十一） ----------
  // 新生儿落地：入户籍（父不在了就跟母——生的时候爹可能已病故或出门在外）、父母记账、全镇听见、图集注册精灵
  addBorn(nb) {
    const { def, father, mother } = nb;
    const house = (father && this.world.houses.find(h => h.ownerId === father.id))
      || this.world.houses.find(h => h.ownerId === mother.id) || null;
    const NPC_CTOR = this.npcs[0] ? this.npcs[0].constructor : null;
    const n = NPC_CTOR ? new NPC_CTOR(def, house, this.lexicon) : null;
    if (!n) return null;
    n.family = { parents: [father && father.id, mother.id].filter(Boolean), childIds: [] };
    n.inside = true;
    n.intent = { type: 'ready', label: '待命', untilMin: 0, reason: '新生儿', source: 'script' };
    this.npcs.push(n);
    for (const p of [father, mother]) {
      if (!p) continue;   // 爹没能等到这一天——孩子照样落地，娘一个人记
      p.family.childIds.push(n.id);
      p.memory(`我们的孩子${def.name}出生了`, this.clock.totalDay, this.clock.hour);
      p.moodDelta(15);
    }
    if (this.renderer && this.renderer.ts && this.renderer.ts.registerChild) this.renderer.ts.registerChild(n.id, n.hair);
    for (const o of this.npcs) {
      if (o === n || o === father || o === mother || o.inside) continue;
      o.perceive('hear', `镇上添了新生儿${def.name}`, this.clock.totalDay, this.clock.hour, 2);
    }
    this.annal('birth', `${def.name}出生了，${father ? father.name : mother.name}家添丁`, '生命层·添丁');
    // 神经芯（v2.5.0）：游荡的芯落进死时之后新降生的新生儿（手艺在骨头里，记忆不带走）
    neuroOnBorn(this, n);
    return n;
  }
  // 葬礼进行时：亲属到坟前哭丧送别（第八章·哭丧）
  funeralTick() {
    const f = this._funeral;
    const elapsed = this.clock.min - f.startedMin;
    for (const id of f.mourners) {
      const m = this.npcs.find(o => o.id === id);
      if (!m || m.inside || m.intent.type === 'sleep') continue;
      const near = f.grave && Math.abs(m.x - f.grave.x) + Math.abs(m.y - f.grave.y) < 3;
      if (near && !f.said[id]) {
        f.said[id] = true;
        m.say(pickLex(this, 'lament', this.rng), this.nowReal);
        m.memory(`在${f.name}的坟前哭了一场`, this.clock.totalDay, this.clock.hour);
      } else if (!near && m.intent.type === 'ready' && f.grave) {
        const s = nearWalkable(this.world, f.grave.x, f.grave.y, m);
        if (s) m.setGoto(this.world, s.x, s.y, { type: 'idle', dur: 120, sub: '送别' }, '送最后一程');
      }
    }
    if (elapsed >= 240) {
      this.log('葬礼散了，人们各自回家', '');
      this._funeral = null;
    }
  }

  // ---------- 社会层：婚嫁喜歌 / 人口流动 / 习俗（v1.6.0，第三章·六、十二；第八章·喜歌） ----------
  // 婚嫁：pairCheck 配成伴 → 晌午拜堂，喜歌开腔，街坊吃喜酒
  startWedding(pair) {
    const a = this.npcs.find(n => n.id === pair.a), b = this.npcs.find(n => n.id === pair.b);
    if (!a || !b) return;
    this._wedding = { aId: a.id, bId: b.id, startedMin: this.clock.min, said: {}, sung: false, cake: false };
    this.log('镇上要办喜事了——' + a.name + '和' + b.name + '定在广场拜堂', 'good');
    const day = this.clock.totalDay, hour = this.clock.hour;
    for (const o of this.npcs) {
      if (o === a || o === b) continue;
      o.perceive('hear', a.name + '和' + b.name + '要成亲了', day, hour, 3);
    }
  }
  weddingTick() {
    const wd = this._wedding;
    const a = this.npcs.find(n => n.id === wd.aId), b = this.npcs.find(n => n.id === wd.bId);
    if (!a || !b) { this._wedding = null; return; }
    const elapsed = this.clock.min - wd.startedMin;
    const day = this.clock.totalDay, hour = this.clock.hour;
    // 宾客往广场聚（闲散成年人；吃喜酒是人情）
    this._wdCd = (this._wdCd || 0) - 1;
    if (this._wdCd <= 0) {
      this._wdCd = 5;
      for (const o of this.npcs) {
        if (o === a || o === b || o.inside || o.intent.type === 'work' || o.intent.type === 'sleep') continue;
        if (o.intent.type === 'ready' || o.intent.type === 'idle') {
          o.setGotoArea(this.world, 'plaza', this.rng, { type: 'idle', dur: 220, sub: '吃喜酒' }, '去吃喜酒');
        }
      }
    }
    // 喜歌：新人到广场就开腔（第八章：喜歌是婚嫁的声音）
    const plaza = this.world.areas.find(v => v.id === 'plaza');
    const inPlaza = (n) => n && !n.inside && n.x > plaza.x - 2 && n.x < plaza.x + plaza.w + 2 && n.y > plaza.y - 2 && n.y < plaza.y + plaza.h + 2;
    if (!wd.sung && inPlaza(a) && inPlaza(b)) {
      wd.sung = true;
      a.say(pickLex(this, 'weddingSong', this.rng), this.nowReal);
      b.say(pickLex(this, 'weddingSong', this.rng), this.nowReal);
      a.memory('和' + b.name + '拜了天地，往后互相有个照应', day, hour);
      b.memory('和' + a.name + '拜了天地，这日子就绑在一块儿了', day, hour);
      for (const o of this.npcs) {
        if (o === a || o === b || o.inside) continue;
        if (inPlaza(o)) {
          o.memory('喝了' + a.name + '和' + b.name + '的喜酒', day, hour);
          o.moodDelta(3);
        }
      }
      this.annal('wed', '广场上喜歌开腔，' + a.name + '和' + b.name + '拜了天地', '好感到了，事就成了');
    }
    // 喜饼分邻：守这规矩的人家办喜事，喜饼分给街坊（习俗反过来被人守着）
    if (!wd.cake) {
      const c = this.customs.find(v => v.id === 'xibing' && v.holders.includes(a.id));
      if (c && this.stock.crop >= 4) {
        this.stock.crop -= 2;
        wd.cake = true;
        this.log('按「' + c.name + '」的老规矩，喜饼分给了街坊', 'good');
        for (const o of this.npcs) if (o !== a && o !== b && !o.inside) o.moodDelta(1);
      }
    }
    if (elapsed >= 300) {
      this.log('喜宴散了，' + a.name + '和' + b.name + '回了家', 'good');
      a.moodDelta(6); b.moodDelta(6);
      this._wedding = null;
    }
  }
  // 迁入：拉力把人拉进来（繁荣/声望/恰好路过）——落脚 → 暂住 → 定居
  addTraveler(def) {
    const owners = new Set(this.npcs.map(n => n.id));
    const house = this.world.houses.find(h => h.ownerId && !owners.has(h.ownerId)) || null;  // 故人留下的空房
    const n = new NPC(def, house, this.lexicon);
    n.relations = {}; n.rels = {};      // 初来乍到，谁也不认识
    for (const o of this.npcs) o.relations[n.id] = 0;
    n.x = 6; n.y = 66; n.inside = false; // 从镇口进来
    this.npcs.push(n);
    n.origin = '客籍';
    n.arrivedDay = this.clock.totalDay;   // 演化引擎 newcomer 触发状态要看这个
    n.memory('初到雾溪镇，人生地不熟', this.clock.totalDay, this.clock.hour);
    // 涌现物理层·归属：住进老宅就是"占着"——在场的镇民是见证人（亲眼看见即认），不再是静默赋值
    if (house) {
      const witnesses = this.npcs.filter(o => o !== n).slice(0, 6)
        .map(o => ({ npc: o, recognized: true }));
      claimHouse(this, n, house, witnesses);
    }
    if (this.renderer && this.renderer.ts && this.renderer.ts.registerChild) this.renderer.ts.registerChild(n.id, n.hair);
    for (const o of this.npcs) {
      if (o === n || o.inside) continue;
      o.perceive('see', '镇上来了个生面孔' + n.name, this.clock.totalDay, this.clock.hour, 1);
    }
    this.annal('world', (house ? n.name + '来了，住进了故人留下的老宅' : n.name + '来了，先在镇上借住着'), '拉力：' + (house ? '有空房' : '恰好路过'));
    return n;
  }
  // 离镇收尾：走的人把名字留在镇史里，把空房留给后来人
  finalizeDepart(n) {
    const day = this.clock.totalDay, hour = this.clock.hour;
    for (const o of this.npcs) {
      if (o === n) continue;
      const rel = o.rels && o.rels[n.id];
      if (o.spouse === n.id || o.family.childIds.includes(n.id) || o.family.parents.includes(n.id) || (rel && (rel.close > 25 || rel.grudge > 25))) {
        o.memory(n.name + '走的时候来道过别', day, hour);
        o.moodDelta(-3);
      }
      if (o.spouse === n.id) o.spouse = null;
    }
    // 人走了，芯留下（v4.4.2）：寄宿者离镇=宿主不在了，芯回游荡池等新生儿，
    // 不会永久卡在一个已经离开模拟的宿主身上（否则轮回永不发生）
    neuroOnDeath(this, n);
    // 镇史留一笔（按 id 去重——探亲又走的人不重复记）
    if (!this.left.some(r => r.id === n.id)) this.left.push({ id: n.id, name: n.name, age: n.body.ageYears, job: n.job, day, why: n.departing.why || '' });
    if (this.selNpcId === n.id) this.selNpcId = null;
    this.log(n.name + '挑着担子出了镇口，' + (n.departing.why || '去外面看看'), 'warn');
    chronNote(this, 'leave', n.name + '离开了小镇', n.departing.why || '去外面看看');   // 呈现层：走的人也留一笔
    // v4.5.0 离镇者：人不是没了——他走进了无限地图，在荒野里继续活着（第二章：远处是降精度，不是删除）
    n.departing = null;
    finalizeToWanderer(this, n);
  }
  // 调试/冒烟：强制走一遍出生与死亡全链路（selftest 与 CDP 冒烟共用）
  forceBirth() {
    const cands = this.npcs.filter(n => n.body.ageYears >= 18 && n.body.ageYears <= 50 && !n.dying);
    const f = cands.find(n => n.sex === '男');
    const m = cands.find(n => n.sex === '女' && n !== f);
    if (!f || !m) return null;
    f.spouse = m.id; m.spouse = f.id;
    // v4.5.0：调试锤跳过怀孕过程直接得子（正式链路走受孕→妊娠→分娩）
    this._lifeSeq = this._lifeSeq || 1;
    const def = makeChildDef(f, m, () => 0.5, this._lifeSeq, this);
    this._lifeSeq++;
    return this.addBorn({ def, father: f, mother: m });
  }
  forceDeath(id) {
    const n = id ? this.npcs.find(o => o.id === id)
      : this.npcs.reduce((a, b) => (b.body.ageYears > a.body.ageYears ? b : a));
    if (!n) return null;
    n.dying = { cause: '病故', days: 0 };
    dieAndFuneral(this, n);
    forgetOnDeath(this, n, this.clock.totalDay);
    neuroOnDeath(this, n);   // 神经芯（v2.5.0）：芯不进坟，游荡等新生儿
    return n.name;
  }

  onNewDay(days) {
    if (this.droughtDays > 0) {
      this.droughtDays -= days;
      this.log('烈日依旧，田地干裂', 'warn');
    } else {
      // v2.1.0：作物生长/树桩回生/零星长树石全在 chunk 层（growCropsDaily 遍历 WARM+ chunk）
      growCropsDaily(this.world, this.weather.type, this.rng);
      const regrew = regrowStumps(this.world, this.rng);
      if (regrew) this.renderer.mapDirty = true;
    }
    // 身体日推进：劳损/拉伤/旧伤留疤/病痛/衰老——日子在身上留下痕迹
    const day = this.clock.totalDay;
    for (const n of this.npcs) {
      const evts = bodyDailyTick(n.body, n.job, n._workMinToday, this.weather.type, this.clock.season, this.rng, day);
      for (const t of evts) {
        n.memory(t, day, 6);
        n.moodDelta(-2);
        this.log(`${n.name}${t}`, 'warn');
      }
      n._workMinToday = 0;
      n._dayIntents = 0;
    }
    // 认知层日推进：矛盾摆动 / 新秘密 / 装病（对外只说"病了"，真话在自己心里）
    for (const n of this.npcs) {
      if (n.body.ageYears < 6) continue;   // 婴幼儿没有秘密，只有吃睡
      const evs = mindDailyTick(n, this.rng, day, this);
      for (const t of evs) this.log(`${n.name}${t}`, '');
    }
    // —— 生命层日推进（第三章·十、十一）：衰老/死亡有过程/出生/传承 ——
    const lifeDeaths = [];
    for (const n of this.npcs) {
      if (n.dying) {
        n.dying.days--;
        if (n.dying.days <= 0) {
          // 病榻是关口，不是死缓（v4.5.0）：身板还撑得住的人，病一场大多挺得过来；
          // 走的是本就油尽灯枯的（年老/痼疾缠身且伤重）——旧版病倒=死缓，小镇凶得没有道理
          const worst = Math.min(...Object.values(n.body.parts).map(s => s.cond));
          const chronic = n.body.ailments.filter(a => a.kind === 'chronic' || a.kind === 'aging').length;
          if (n.body.ageYears < 55 && worst >= 35 + chronic * 5) {
            n.dying = null;
            n.memory('病了一场，总算挺过来了', day, 6);
            n.moodDelta(4);
            this.log(`${n.name}的病见好了，能下地了`, 'good');
          } else lifeDeaths.push(n);
        }
      } else if (n.body.ageYears >= 3) {
        const cause = dailyMortality(n, this.rng);
        if (cause) {
          startDying(n, cause, this.rng);
          this.log(`${n.name}病倒了，这一回看着凶险`, 'warn');
          for (const o of this.npcs) {
            if (o === n) continue;
            if (o.spouse === n.id || (o.family && (o.family.parents.includes(n.id) || o.family.childIds.includes(n.id)))) {
              o.perceive('hear', `${n.name}病得起不来床了`, day, 6, -6);
            }
          }
        }
      }
      if (n.body.ageYears >= 62) {
        for (const t of elderDaily(n, this.rng, day)) this.log(`${n.name}${t}`, '');
      }
    }
    for (const n of lifeDeaths) {
      dieAndFuneral(this, n);
      forgetOnDeath(this, n, day);
      neuroOnDeath(this, n);   // 神经芯（v2.5.0）：芯不进坟，游荡等新生儿
    }
    const pair = pairCheck(this);
    if (pair) this.startWedding(pair);
    // —— v4.5.0 性别层日推进：欲望→受孕→孕期→分娩（生育从当天掉孩子变成十月怀胎） ——
    desireDaily(this, day);
    tryBirth(this, this.rng);
    pregDaily(this, day);
    for (const nb of birthDaily(this, day)) this.addBorn(nb);
    // —— v4.5.0 离镇者日推进：荒野里的人继续活着（赶路/觅食/落脚/立营/客死/探亲） ——
    wandererDaily(this, day);
    // 神经芯日推进（v2.5.0）：用进废退 + 游荡倒计时（30 天无承接→芯死）
    neuroDaily(this, day);
    // —— 社会层日推进（v1.6.0，第三章·六、十二）：关系六维漂移/习俗/人口流动 ——
    for (const n of [...this.npcs]) {
      if (n.body.ageYears < 6) continue;
      for (const t of relDailyTick(n, this.rng, day)) this.log(`${n.name}${t}`, '');
    }
    for (const t of customDaily(this)) { this.log(`镇上${t}`, 'good'); chronNote(this, 'custom', `镇上${t}`, '日子过出来的规矩'); }
    // 呈现层·关系演变：每日给每段关系采一笔（第十章·七：关系变化必须能懂）
    relHistDaily(this, day);
    // 推力把人推出去（有伴的、孩子的不走——走，是大人才有的决定）
    for (const n of [...this.npcs]) {
      if (n.departing || n.dying) continue;
      const sp = n.spouse && this.npcs.find(o => o.id === n.spouse);
      if (sp && sp.preg) continue;   // 媳妇怀着孕，男人不上路——要当爹的人，脚跟先被家里拴住
      const p = pushScore(n);
      if (p > 0 && chance(wrng(this), p)) {   // 离镇掷骰走独立骰流：远方命不偏移镇内语言/演化确定性（D28）
        n.departing = { since: day, why: departReason(n) };
        n.memory('拿定主意要走，这镇子留不住我了', day, 6);
        this.log(n.name + '收拾起行装，说要出去闯闯', 'warn');
        for (const o of this.npcs) {
          if (o === n || o.inside) continue;
          o.perceive('hear', n.name + '说要离开小镇', day, 6, -2);
        }
      }
    }
    // 走的人次日出镇
    for (const n of [...this.npcs]) {
      if (n.departing && day - n.departing.since >= 1) this.finalizeDepart(n);
    }
    // 拉力把人拉进来：落脚 → 暂住 → 定居（镇口是人来的路，小镇永远是中心）
    if (this.npcs.length < 14 && chance(this.rng, pullScore(this) * 0.5)) {
      this.addTraveler(makeTravelerDef(this.rng, this._inSeq++, this));
    }
    // 季节更替 → 说话习惯漂移（第八章：语言随时间变）
    if (this.clock.season !== this._lastSeason) {
      this._lastSeason = this.clock.season;
      for (const n of this.npcs) driftVoice(n.mind.voice, this.rng, this.lexicon);
      // 气候层（v4.4）：季节更替时推进气候——大周期/小周期/极端天气
      if (CLIMATE.enabled && this.climateState) {
        const cs = climateTick(this.climateState, this.clock.year, this.clock.season, this.rng);
        if (cs.cycleShifted) this.log(`气候周期更替：进入${cs.phase === 'wet' ? '湿润' : '干旱'}期`, '');
        if (cs.extremeEvent) this.log(`极端天气：${cs.extremeEvent}`, 'warn');
      }
    }
    // 年轮转：开春长一岁
    if (this.clock.year !== this._lastYear) {
      this._lastYear = this.clock.year;
      for (const n of this.npcs) {
        n.body.ageYears++;
        n.memory('又长了一岁，日子过得真快', day, 6);
        // 成年：孩子长成大人想不到的样子——18 岁接大人的活计（第三章·十、十三）
        if (n.body.ageYears === 18 && n.job === '孩童') {
          const j = assignAdultJob(n, this.npcs, this.rng, day);
          this.log(`${n.name}成年了，接了${j}的活计`, 'good');
        }
      }
      const eldest = this.npcs.reduce((a, b) => (b.body.ageYears > a.body.ageYears ? b : a));
      this.log(`开春了，镇上居民又长了一岁（${eldest.name}已经${eldest.body.ageYears}岁了）`, '');
    }
    // 地质层（v4.4）：年轮转时推进地质——侵蚀/滑坡/塌陷，缓慢且不可逆
    if (GEOL.enabled) {
      const years = this.clock.year - (this._lastGeoYear || this.clock.year);
      if (years > 0) {
        const stats = geologyTick(this.world, years, this.rng);
        this._lastGeoYear = this.clock.year;
        this._erodedTotal += stats.eroded;
        this._collapsedTotal += stats.collapsed;
        this._slidTotal += stats.slid;
        this._sunkTotal += stats.sunk;
        if (stats.eroded + stats.collapsed + stats.slid + stats.sunk > 0) {
          this.renderer.mapDirty = true;
        }
      }
    }
    // 居民自主提议营造
    this.maybeAutoPlan();
    // 物质层日推进（第五章·二·维护）：磨损/空房荒废/原木腐烂/仓库失窃
    this.maintDaily(day);
    // 世界层日推进（v1.8.0）：牲畜产出/伴侣羁绊/野生动物出没/畜牧添置
    animalDailyTick(this, day);
    spawnWild(this);
    husbandryDaily(this, day);
    // 涌现物理层日推进（v2.4.0）：还镇账/无房者占空房/归属争议评理/时间成事实
    holdDaily(this, day);
    // 演化层日推进（v1.9.0）：瓶颈创新/知识传承/重新发明 + 灾难（瘟疫/火灾/废墟自愈）
    developDaily(this, day);
    disasterDaily(this, day);
    // 发现层日推进（v4.2 天道退役）：从 NPC 意外记忆推进 repeat/spread，识别新技能
    // 在 evolveDaily 之前跑——captureDiscoveries 的产物是 game.discoveries，不进 evoPool
    captureDiscoveries(this);
    // 知识层日推进（v4.3）：从意外捕获知识/组合推理/验证真值/传播给邻居
    // 在 captureDiscoveries 之后跑——知识从 incidents 提取，captureDiscoveries 推进了 incidents
    knowledgeDaily(this, day);
    // 演化引擎日推进（v2.3.0，第十一章）：缺口扫描 → 提案 → 灰度 → 观察 → 固化/修正/回滚
    // v4.2：DISCOVERY.enabled 时跳过 proposeDaily，灰度/观察/固化/回滚管道仍保留
    evolveDaily(this, day);
    // 感知层日推进（v4.9.0 · D39）：信念衰减遗忘 + 名望场 Top1 日缓存（说话算数的人）
    beliefDaily(this, day);
    refreshStandingTop(this, day);
    // 聚落层日推进（v4.4）：多聚落人口/资源/废弃判定 + 聚落间交互
    if (SETT.enabled) settlementsDaily(this, this.rng);
    // 语言革命（v3.1.0）：语言日推进——词会变异、会死；新词只从演化提案来
    lexiconDaily(this, day);
    // 宝箱过期清理（每天清一次避免堆积）——遍历所有非 VIRGIN chunk 的 obj 数组
    let cleaned = 0;
    this.world.ws.forEachWarm(c => {
      for (let i = 0; i < c.obj.length; i++) {
        if (c.obj[i] === O.CHEST) { c.obj[i] = O.NONE; cleaned++; }
      }
      if (cleaned) c.dirty = true;
    });
    if (cleaned) this.renderer.mapDirty = true;
    // 自动事件
    const ev = maybeAutoEvent(this);
    if (ev) {
      const def = EVENT_DEFS.find(d => d.id === ev);
      this.banner('神迹：' + def.name);
    }
    this.log(`—— ${this.clock.label().replace(/ \d{2}:\d{2}$/, ' 清晨')} ——`, '');
    this.saveLocal();
    if (this.uiHooks.onNewDay) this.uiHooks.onNewDay();
  }

  // ---------- 居民自主营造与开拓 ----------
  // 立项：材料立项时从仓库预订（stock 扣账），但板子要有人搬到工地才能开工——运输本身是一件事
  addPlan(kind, x, y, byName, anchor, style) {
    const def = PLAN_KINDS[kind];
    if (!def) return null;
    if (def.once && (kind === 'barn' ? this.barn : this.workshop)) return null;   // 仓库/木匠坊只建一处
    for (const [res, n] of Object.entries(def.mat || {})) {
      if ((this.stock[res] || 0) < n) return null;
    }
    if (x == null) {
      const a = anchor || this.npcs[Math.floor(this.rng() * this.npcs.length)];
      const pt = findSiteNear(this.world, Math.floor(a.x), Math.floor(a.y), this.rng, this.plans);
      if (!pt) return null;
      x = pt.x; y = pt.y;
    } else {
      if (!canPlaceSite(this.world, x, y)) return null;
      if (this.plans.some(p => !p.done && Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1)) return null;
    }
    for (const [res, n] of Object.entries(def.mat || {})) this.stock[res] -= n;
    placeObj(this.world, x, y, O.SITE);
    this.renderer.mapDirty = true;
    const needMat = {};
    for (const [res, n] of Object.entries(def.mat || {})) needMat[res] = n;
    const plan = { id: this._planSeq++, kind, name: def.name, x, y, need: def.need, progress: 0, builder: null, by: byName || '', done: false, needMat, delivered: {}, style: style || null };
    this.plans.push(plan);
    this.log(`${byName ? byName + '提议' : '镇上决定'}：在（${x},${y}）${def.name === '开垦' ? '开垦一块新田' : '建一座' + def.name}（${def.matLabel}，料从仓库出）`, 'good');
    return plan;
  }
  // 认领施工：走到工地旁进入 build 意图
  claimPlan(npc, plan) {
    if (!plan || plan.done) return false;
    if (plan.builder && plan.builder !== npc.id) return false;
    const spot = nearWalkable(this.world, plan.x, plan.y, npc);
    if (!spot) return false;
    if (!npc.setGoto(this.world, spot.x, spot.y, { type: 'build', dur: 600 }, '营造：' + plan.name)) return false;
    plan.builder = npc.id;
    return true;
  }
  // 施工推进：由 npc.tick 的 build 分支逐帧调用
  workOnPlan(npc, gm) {
    const plan = this.plans.find(p => !p.done && p.builder === npc.id);
    if (!plan) { npc.setIntent('idle', '工地完工了', 20); return; }
    // 材料没到齐，工人只能等（第五章·二·施工）——干等也是活儿的一部分
    const lack = plan.needMat && Object.entries(plan.needMat).some(([r, n]) => (plan.delivered[r] || 0) < n);
    if (lack) { if (!plan._waited) { plan._waited = true; this.log(plan.name + '工地缺料，' + npc.name + '蹲在工地等料', ''); } return; }
    plan.progress += gm;
    if (plan.progress < plan.need) return;
    plan.done = true;
    const def = PLAN_KINDS[plan.kind];
    if (plan.kind === 'farm') {
      setGround(this.world, plan.x, plan.y, G.SOIL);
      placeObj(this.world, plan.x, plan.y, O.CROP0);
    } else {
      placeObj(this.world, plan.x, plan.y, def.obj);
      // 物质层：落成的建筑会磨损，也会带着自己的样式（积木营造+建筑方言）
      this.wear.set(plan.x + ',' + plan.y, { v: 0, work: 0 });
      if (plan.kind === 'shed') this.styles.set(plan.x + ',' + plan.y, this.buildStyle(plan));
      if (plan.kind === 'barn') {
        this.barn = { x: plan.x, y: plan.y };
        this.log('新仓库立起来了，镇上的家当有地方放了', 'good');
      }
      if (plan.kind === 'workshop') {
        this.workshop = { x: plan.x, y: plan.y, logs: 0, mill: 0 };
        this.log('木匠坊落成——砍倒的树终于有地方变成木板了', 'good');
      }
      if (plan.kind === 'cabin') {
        // 边缘带判定与 findFrontierNear 一致：起源镇 72×72 外沿（殖民地只能往外长）
        const edge = plan.x < 14 || plan.x > ORIGIN_W - 15 || plan.y < 14 || plan.y > ORIGIN_H - 15;
        if (edge) {
          if (!this.colony) {
            this.colony = { foundedDay: this.clock.totalDay, houses: [] };
            this.annal('world', '镇子在郊野立起了第一间小屋——殖民地，就这么开始了', '有人看见了那块无主好地');
          }
          this.colony.houses.push({ x: plan.x, y: plan.y, by: npc.name });
        }
      }
    }
    // 呈现层·地形考古：新房子的来历，就是几十年后考古的入口（计划书第五章·四）
    markNote(this, plan.x, plan.y, 'built', def.name + (plan.kind === 'farm' ? '田' : ''), npc.name);
    this.plans = this.plans.filter(p => !p.done);
    this.renderer.mapDirty = true;
    this.log(`${def.name}在（${plan.x},${plan.y}）落成了（${npc.name}主理）`, 'good');
    chronNote(this, 'build', `${def.name}在（${plan.x},${plan.y}）落成`, npc.name + '主理');
    npc.moodDelta(5, `${def.name}落成了`, this.clock.totalDay, this.clock.hour);
    for (const o of this.npcs) {
      if (o.id !== npc.id && !o.inside && Math.abs(o.x - plan.x) + Math.abs(o.y - plan.y) < 10) o.moodDelta(2);
    }
    npc.setIntent('idle', '完工歇息', 30);
  }
  // 积木营造的 AI 决策层：配色方案有人给就用人给的，没人给就按建筑方言来（第五章·四）
  buildStyle(plan) {
    const rng = this.rng;
    let hue, v;
    if (plan.style && Number.isInteger(plan.style.hue)) hue = clamp(plan.style.hue, 0, 3);
    else {
      const all = [...this.styles.values()];
      // 方言：镇中心偏暖、郊野偏冷；六成模仿已建成的邻居——三代后形成地域风格
      hue = (plan.x + plan.y < 76) ? rint(rng, 0, 1) : rint(rng, 2, 3);
      if (all.length && chance(rng, 0.6)) hue = all[all.length - 1].hue;
    }
    if (plan.style && Number.isInteger(plan.style.v)) v = clamp(plan.style.v, 0, 2);
    else v = rint(rng, 0, 2);
    return { hue, v, by: plan.by || '' };
  }

  // ---------- 物质层：搬运/加工/修缮（v1.7.0，计划书第五章·材料是真的） ----------
  // 搬运任务分配：谁闲谁搬——分工不是任命的，是"材料必须被搬来搬去"逼出来的
  haulJob(npc) {
    if (!this.barn) return null;
    // 1) 缺料工地优先：从仓库背木板过去（一次扛 2 块，远的分几趟）
    const lack = this.plans.find(p => !p.done && p.needMat && Object.entries(p.needMat).some(([r, n]) => (p.delivered[r] || 0) < n));
    if (lack && (this.stock.wood || 0) > 0) {
      const spot = nearWalkable(this.world, this.barn.x, this.barn.y, npc);
      if (spot) return { action: 'haul', tx: spot.x, ty: spot.y, planId: lack.id, stage: 'load', why: '工地缺料，去仓库背木板' };
    }
    // 2) 地上散落的原木，坊里还有位 → 扛一根回木匠坊（原木沉，一次只扛一根）
    if (this.workshop && this.workshop.logs < MAT.WS_LOG_CAP) {
      const log = nearestObjAround(this.world, Math.floor(npc.x), Math.floor(npc.y), [O.LOG], 22);
      if (log) return { action: 'haul', tx: log.x, ty: log.y, stage: 'pick', why: '把砍倒的原木扛回坊里' };
    }
    // 3) 破败的建筑：有人修，就还没垮
    if ((this.stock.wood || 0) > 0) {
      for (const [key, wr] of this.wear) {
        if (wr.v < 1) continue;
        const [x, y] = key.split(',').map(Number);
        const o = getObj(this.world, x, y);
        if (![13, 25, 26, 27, 34, 35, 37].includes(o)) continue;
        const spot = nearWalkable(this.world, x, y, npc);
        if (spot) return { action: 'repair', tx: spot.x, ty: spot.y, key, dur: MAT.REPAIR_MIN, why: '那处建筑破了，带块板子去修' };
      }
    }
    return null;
  }
  // 加工任务：樵夫在工作时段把原木锯成板（3 根原木出 2 块，损耗是规矩）
  millJob(npc) {
    if (!this.workshop || this.workshop.logs < MAT.LOGS_PER_PLANK) return null;
    const spot = nearWalkable(this.world, this.workshop.x, this.workshop.y, npc);
    if (!spot) return null;
    return { action: 'mill', tx: spot.x, ty: spot.y, dur: MAT.MILL_MIN, why: '坊里堆着原木，锯成板子' };
  }
  // 产出革命（v2.9.0）：手艺活的落脚处——规则只有一条「去原料所在地」，零身份硬编码
  // 涉木(log/wood)的活靠木匠坊，其余的活靠仓库，都没有就在自家门口；不可达→null（调用方退化就地）
  craftSiteFor(npc, def) {
    const inputs = (def && def.inputs) || {};
    if ((inputs.log != null || inputs.wood != null) && this.workshop) {
      const s = nearWalkable(this.world, this.workshop.x, this.workshop.y, npc);
      if (s) return s;
    }
    if (this.barn) {
      const s = nearWalkable(this.world, this.barn.x, this.barn.y, npc);
      if (s) return s;
    }
    if (npc.home) {
      const s = nearWalkable(this.world, npc.home.x, npc.home.y, npc);
      if (s) return s;
    }
    return null;
  }
  // 搬运到达：装货/卸货/拾原木/存原木（haul 意图的四个站点）
  haulArrive(npc, then) {
    const rng = this.rng, w = this.world, stock = this.stock;
    if (then.stage === 'load') {
      const plan = this.plans.find(p => p.id === then.planId && !p.done);
      if (!plan || !this.barn) { npc.setIntent('idle', '没活儿了', 20); return; }
      const lack = Math.max(0, (plan.needMat.wood || 0) - (plan.delivered.wood || 0));
      const take = Math.min(MAT.CARRY, lack, stock.wood || 0);
      if (take <= 0) { npc.setIntent('idle', '仓库里没板子了', 30); return; }
      stock.wood -= take;
      npc.carrying = { plank: take };
      const spot = nearWalkable(w, plan.x, plan.y, npc);
      if (!spot || !npc.setGoto(w, spot.x, spot.y, { type: 'haul', planId: then.planId, stage: 'drop' }, '把木板背到工地')) {
        stock.wood += take; npc.carrying = null; npc.setIntent('idle', '过不去工地', 30);
      }
    } else if (then.stage === 'drop') {
      const plan = this.plans.find(p => p.id === then.planId && !p.done);
      const n = (npc.carrying && npc.carrying.plank) || 0;
      npc.carrying = null;
      if (plan && n > 0) {
        plan.delivered.wood = (plan.delivered.wood || 0) + n;
        npc.memory('把' + plan.needMat.wood + '块板里的' + n + '块背到了工地', this.clock.totalDay, this.clock.hour);
        if (plan.delivered.wood >= (plan.needMat.wood || 0)) this.log(plan.name + '工地的料备齐了，可以开工了', 'good');
      } else if (n > 0) stock.wood = (stock.wood || 0) + n;   // 工地没了，板背回仓库
      npc.setIntent('idle', '放下板子', rint(rng, 10, 25));
    } else if (then.stage === 'pick') {
      const ws = this.workshop;
      const fx = Math.floor(npc.x), fy = Math.floor(npc.y);
      if (getObj(w, fx, fy) !== O.LOG || !ws || ws.logs >= MAT.WS_LOG_CAP) { npc.setIntent('idle', '没活儿了', 15); return; }
      setObj(w, fx, fy, O.NONE);
      this.renderer.mapDirty = true;
      npc.carrying = { log: 1 };
      const spot = nearWalkable(w, ws.x, ws.y, npc);
      if (!spot || !npc.setGoto(w, spot.x, spot.y, { type: 'haul', stage: 'store' }, '把原木扛去木匠坊')) {
        setObj(w, fx, fy, O.LOG); npc.carrying = null; npc.setIntent('idle', '过不去', 20);
      }
    } else if (then.stage === 'store') {
      const ws = this.workshop;
      const n = (npc.carrying && npc.carrying.log) || 0;
      npc.carrying = null;
      if (ws && n > 0) {
        ws.logs = Math.min(MAT.WS_LOG_CAP, ws.logs + n);
        if (chance(rng, 0.25)) npc.memory('又扛了根原木回坊里', this.clock.totalDay, this.clock.hour);
      }
      npc.setIntent('idle', '放下原木', rint(rng, 10, 25));
    }
  }
  // 加工推进：一炉工时满 → 3 根原木出 2 块板进仓库
  millTick(npc, gm) {
    const ws = this.workshop;
    if (!ws) { npc.setIntent('idle', '坊没了', 20); return; }
    ws.mill = (ws.mill || 0) + gm;
    if (ws.mill < MAT.MILL_MIN) return;
    ws.mill = 0;
    if (ws.logs < MAT.LOGS_PER_PLANK) { npc.setIntent('idle', '原木不够了', 20); return; }
    const room = Math.max(0, MAT.BARN_CAP - (this.stock.wood || 0));
    if (room < 1) { this.log('仓库堆满了，锯出来的板没处放', 'warn'); npc.setIntent('idle', '仓库满了', 40); return; }
    ws.logs -= MAT.LOGS_PER_PLANK;
    const made = Math.min(MAT.PLANKS_PER_BATCH, room);
    this.stock.wood = (this.stock.wood || 0) + made;
    npc.memory(`锯出一批木板（${MAT.LOGS_PER_PLANK}根原木出${MAT.PLANKS_PER_BATCH}块，边角料填了灶）`, this.clock.totalDay, this.clock.hour);
    this.log(`${npc.name}在木匠坊锯出了${made}块木板`, 'good');
    npc.moodDelta(2);
  }
  // 修缮推进：一处破损一块板——有人修，就还没垮
  repairTick(npc, gm, key) {
    const wr = key && this.wear.get(key);
    if (!wr || wr.v <= 0 || (this.stock.wood || 0) < 1) { npc.setIntent('idle', '没得修了', 20); return; }
    wr.work = (wr.work || 0) + gm;
    if (wr.work < MAT.REPAIR_MIN) return;
    wr.work = 0;
    wr.v--;
    this.stock.wood--;
    const [x, y] = key.split(',').map(Number);
    npc.memory(`把（${x},${y}）那处破损修好了`, this.clock.totalDay, this.clock.hour);
    this.log(`${npc.name}修缮了一处破败的建筑`, 'good');
    if (wr.v <= 0) npc.setIntent('idle', '修好了', 20);
  }
  // 维护日推进（第五章·二·维护）：木头会烂，没人住的房子会荒废——废墟是"没人修，慢慢垮"
  maintDaily(day) {
    const rng = this.rng, w = this.world;
    const rainy = this.weather.type === 'rain' || this.weather.type === 'storm';
    const BUILT = [13, 25, 26, 27, 34, 35, 37];
    for (const [key, wr] of [...this.wear.entries()]) {
      const [x, y] = key.split(',').map(Number);
      const o = getObj(w, x, y);
      if (!BUILT.includes(o)) continue;
      if (chance(rng, rainy ? 0.12 : 0.06)) wr.v++;
      if (wr.v >= 3) {
        removeObj(w, x, y);
        placeObj(w, x, y, O.RUIN);
        this.wear.delete(key);
        this.styles.delete(key);
        if (this.barn && this.barn.x === x && this.barn.y === y) this.barn = null;
        if (this.workshop && this.workshop.x === x && this.workshop.y === y) this.workshop = null;
        this.log(`（${x},${y}）的建筑没人修，塌了`, 'warn');
        markNote(this, x, y, 'ruin', (O_NAME[o] || '建筑') + '的废墟', '');   // 呈现层：塌了也是痕迹
        for (const n of this.npcs) {
          if (n.inside || Math.abs(n.x - x) + Math.abs(n.y - y) >= 8) continue;
          n.perceive('see', '眼看着那座建筑塌了下去', day, 6, -1);
        }
      }
    }
    // 没人住的房子荒废：磨损快，塌了门口留一处废墟
    const owners = new Set(this.npcs.map(n => n.id));
    for (const h of w.houses) {
      if (!h.ownerId || owners.has(h.ownerId)) continue;
      if (!chance(rng, 0.15)) continue;
      h.wear = (h.wear || 0) + 1;
      if (h.wear >= 3 && !h.ruined) {
        h.ruined = true;
        const sx = nearWalkable(w, h.ox, h.oy, { x: h.ox, y: h.oy });
        if (sx) placeObj(w, sx.x, sx.y, O.RUIN);
        if (sx) markNote(this, sx.x, sx.y, 'ruin', (h.ownerName || '一户人家') + '的老宅废墟', h.ownerName || '');
        this.log((h.ownerName || '一户人家') + '的老宅没人住了，塌了半边', 'warn');
        this.renderer.mapDirty = true;
      }
    }
    // 散落的原木：雨淋会烂，平时偶尔被人顺走一根（可被雨淋、被偷）
    let rots = 0;
    for (const c of w.ws.iterNonVirgin()) {
      for (let i = 0; i < c.obj.length; i++) {
        if (c.obj[i] !== O.LOG) continue;
        if (chance(rng, rainy ? MAT.ROTTEN_RAIN : 0.04)) { c.obj[i] = O.NONE; c.dirty = true; rots++; }
      }
    }
    if (rots) { this.renderer.mapDirty = true; this.log(`${rots}根散落的原木烂在了野地里`, 'warn'); }
    // 仓库被偷：一块板，没人认
    if (this.barn && (this.stock.wood || 0) > 0 && chance(rng, MAT.STOLEN)) {
      this.stock.wood--;
      this.log('仓库好像被人顺走了一块板子，没人认', 'warn');
    }
  }
  // 开拓发现：探索结束时结算
  onScout(npc) {
    const w = this.world, rng = this.rng;
    const place = (obj) => {
      for (let k = 0; k < 24; k++) {
        const x = Math.floor(npc.x) + rint(rng, -3, 3), y = Math.floor(npc.y) + rint(rng, -3, 3);
        if (x < 0 || y < 0) continue;
        const gd = getGround(w, x, y);
        if (gd !== G.GRASS && gd !== G.DIRT) continue;
        if (getObj(w, x, y) !== O.NONE) continue;
        setObj(w, x, y, obj);
        this.renderer.mapDirty = true;
        return true;
      }
      return false;
    };
    const roll = rng();
    if (roll < 0.25) {
      const ore = roll < 0.05 ? O.GOLD : (roll < 0.14 ? O.IRON : O.COPPER);
      const nm = ore === O.GOLD ? '金矿' : ore === O.IRON ? '铁矿' : '铜矿';
      if (place(ore)) {
        npc.memory(`在镇郊发现了一处${nm}脉！`, this.clock.totalDay, this.clock.hour);
        npc.moodDelta(4);
        this.log(`${npc.name}在镇郊发现了${nm}脉`, 'good');
      } else npc.memory('出门探索了一圈，一无所获', this.clock.totalDay, this.clock.hour);
    } else if (roll < 0.45) {
      if (place(O.BUSH)) {
        this.stock.berry += 2;
        npc.memory('发现一片浆果丛，摘了些回来', this.clock.totalDay, this.clock.hour);
        npc.moodDelta(3);
        this.log(`${npc.name}采回了野浆果，还标记了一片浆果丛`, 'good');
      } else npc.memory('出门探索了一圈，一无所获', this.clock.totalDay, this.clock.hour);
    } else if (roll < 0.6) {
      npc.moodDelta(5, '在镇外看到一处好风景', this.clock.totalDay, this.clock.hour);
      this.log(`${npc.name}在镇外发现一处好风景，心情大好`, '');
    } else if (roll < 0.75) {
      // 物质层（第五章·五·开拓）：得先有人看见那块地，镇子才往那长
      if (!this.frontier && this.findFrontierNear(npc)) {
        const f = this.frontier;
        npc.memory(`在镇郊发现一块无主的好地（${f.x},${f.y}），看了就想在那盖间屋`, this.clock.totalDay, this.clock.hour);
        npc.moodDelta(4);
        this.log(`${npc.name}在镇郊（${f.x},${f.y}）发现一块无主好地`, 'good');
      } else npc.memory('出门探索了一圈，没发现什么', this.clock.totalDay, this.clock.hour);
    } else {
      npc.memory('出门探索了一圈，没发现什么', this.clock.totalDay, this.clock.hour);
    }
  }
  // 找一块无主好地（第五章·五）：边缘带、落得了房、周边开阔——镇子永远从中心长，殖民地只能往外长
  findFrontierNear(npc) {
    const w = this.world, rng = this.rng;
    const cx = Math.floor(npc.x), cy = Math.floor(npc.y);
    for (let k = 0; k < 60; k++) {
      const x = clamp(cx + rint(rng, -10, 10), 1, ORIGIN_W - 2);
      const y = clamp(cy + rint(rng, -10, 10), 1, ORIGIN_H - 2);
      if (!(x < 14 || x > ORIGIN_W - 15 || y < 14 || y > ORIGIN_H - 15)) continue;   // 边缘带
      if (!canPlaceSite(w, x, y)) continue;
      let open = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (walkable(w, x + dx, y + dy)) open++;
      }
      if (open < 12) continue;
      this.frontier = { x, y, day: this.clock.totalDay };
      return true;
    }
    return false;
  }
  // 清晨自发提议：镇上没有活跃计划时，随机居民可能想盖点东西
  maybeAutoPlan() {
    if (this.plans.some(p => !p.done)) return;
    const rng = this.rng;
    const npc = this.npcs[Math.floor(rng() * this.npcs.length)];
    // 木匠坊是材料链的咽喉——没有它，砍倒的树永远变不成板
    if (!this.workshop && chance(rng, 0.6)) {
      const plan = this.addPlan('workshop', null, null, npc.name, { x: npc.x, y: npc.y });
      if (plan) npc.memory('提议建一座木匠坊，得有地方把原木锯成板', this.clock.totalDay, this.clock.hour);
      return;
    }
    // 有人看见了那块地，就有人想往那去——小镇往外长
    if (this.frontier && chance(rng, 0.3)) {
      const f = this.frontier;
      const plan = this.addPlan('cabin', f.x, f.y, npc.name, null);
      if (plan) {
        npc.memory(`提议去（${f.x},${f.y}）盖间屋，那里看得见整片野地`, this.clock.totalDay, this.clock.hour);
        this.frontier = null;
      }
      return;
    }
    if (!chance(rng, 0.5)) return;
    const kinds = ['bench', 'lamp', 'shed', 'stall', 'farm'];
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const plan = this.addPlan(kind, null, null, npc.name, { x: npc.x, y: npc.y });
    if (plan) npc.memory(`提议${plan.name === '开垦' ? '开一块新田' : '建一座' + plan.name}`, this.clock.totalDay, this.clock.hour);
  }

  // ---------- AI 循环（v2.8.0：按需触发，各活各的） ----------
  aiEnabled() {
    if (this.aiCfg.mode === 'script') return false;
    // 模型池开：providers 自带端点与密钥，不依赖单模型配置
    if (this.aiCfg.npcPool && this.aiCfg.npcPool.enabled && poolEntries(this.aiCfg).length) return true;
    if (this.aiCfg.mode === 'llm') return !!(this.aiCfg.apiKey && this.aiCfg.model);
    return !!(this.aiCfg.apiKey && this.aiCfg.model);  // auto
  }
  _aiNowMin() { return this.clock.totalDay * 1440 + this.clock.min; }

  // 个人决策时刻错开（开局/老档缺省）：确定性 rng，同 seed 可复现
  _initAiStagger() {
    const now = this._aiNowMin();
    const span = Math.max(30, this.aiCfg.intervalH * 60);
    for (const n of this.npcs) {
      if (!(n.aiDcAt > 0)) n.aiDcAt = now + 1 + Math.floor(this.rng() * span);   // +1：时刻必须在将来（rng 可为 0，踩现在=第一帧全员涌入）
      n.aiAsking = false;   // 在途态绝不持久化
    }
    this.aiBatch = []; this.aiBatchStart = 0;
  }

  // 事件插队：把可问时刻提前到现在（仍受「意图结束」与门——睡着的醒来才问，干长活的干完才问）
  _aiKick(npc) { if (npc && !npc.dying) npc.aiDcAt = this._aiNowMin(); }
  // 降水插队：户外挨淋且不勇敢的人（勇敢者雨天照旧，屋里的人无感）
  _aiKickPrecip() { for (const n of this.npcs) if (!n.inside && !n.brave) this._aiKick(n); }

  // 谁这一刻该由 LLM 接管：AI 开着、醒着、手头的事结束（ready 无路径）、自己的冷却到了
  // 单一谓词两个用处：①主循环脚本闸据此让位（同帧不与 LLM 抢人）②aiLoopTick 收人入候问
  _aiClaimable(n, now) {
    if (!this.aiEnabled() || n.aiAsking || n.dying) return false;
    if (n.inside && n.intent.type === 'sleep') return false;   // 睡着不叫
    if (n.intent.type !== 'ready' || n.path.length) return false;  // 与门：活没干完不打断
    // v4.5.1 本能临界保底：身体快撑不住时，不等 LLM，先活命（半硬编码的硬底）
    const u = urgeOf(n);
    if (u && u.p >= 0.9) return false;
    return now >= (n.aiDcAt || 0);
  }

  aiLoopTick() {
    if (!this.aiEnabled()) return;
    const now = this._aiNowMin();
    // 1) 到期且 ready 的人收入候问队列（各自的时刻，互不相约）
    for (const n of this.npcs) {
      if (this._aiClaimable(n, now)) {
        n.aiAsking = true;
        this.aiBatch.push(n);
        if (!this.aiBatchStart) this.aiBatchStart = now;
      }
    }
    if (!this.aiBatch.length) return;
    // 2) 候问超时：应答迟迟不来 → 脚本先领他们过日子（释放后下一帧主循环脚本闸接管）
    if (now - this.aiBatchStart >= this.aiAskTimeout) {
      for (const n of this.aiBatch) { n.aiAsking = false; n.aiDcAt = now; }
      const dropped = this.aiBatch.length;
      this.aiBatch = []; this.aiBatchStart = 0;
      this.log(`居民之魂应答慢了半拍（${dropped}人候得太久），本能先领着过日子`, '');
      return;
    }
    // 3) 一批在途：新到期者排下一批
    if (this.aiBusy) return;
    // 4) 收集窗口满或人够了 → 成批（碰巧搭一趟车，不是定闹钟集合）
    if (now - this.aiBatchStart < this.aiAskWindow && this.aiBatch.length < this.aiAskCap) return;
    const batch = this.aiBatch.splice(0, this.aiAskCap);
    this.aiBatchStart = this.aiBatch.length ? now : 0;
    this.requestAiBatch(batch);
  }

  // 一批居民的决策轮（任意子集；模型池按 aiModelId 分组并行，声音分化保留）
  async requestAiBatch(batch) {
    if (this.aiBusy || !batch || !batch.length) return;
    this.aiBusy = true;
    const release = () => { for (const n of batch) n.aiAsking = false; };
    try {
      const ctx = { w: this.world, clock: this.clock, weather: this.weather, game: this };
      const nameOf = (id) => { const n = this.npcs.find(v => v.id === id); return n ? n.name : id; };
      const live = batch.filter(n => !(n.inside && n.intent.type === 'sleep'));
      const snaps = live.map(n => npcSnapshotList(n, { ...ctx, nameOf }));
      const info = ctxInfoText(this.clock, this.weather, this);
      const c = this.aiCfg;
      const pooled = c.npcPool && c.npcPool.enabled && poolEntries(c).length > 0;
      let usedVia;
      if (pooled) {
        assignModels(this);
        const npcOf = new Map(this.npcs.map(n => [n.name, n]));
        const groups = new Map();
        for (const s of snaps) {
          const npc = npcOf.get(s.name);
          const m = (npc && npc.aiModelId) || poolEntries(c)[0].model;
          if (!groups.has(m)) groups.set(m, []);
          groups.get(m).push(s);
        }
        const r = await requestDecisionsPooled(c, [...groups].map(([model, gsnaps]) => ({ model, snaps: gsnaps })), info);
        applyDecisions(this, r.clean);
        usedVia = r.via;
        logChain(this, 'npc', r.via.join(',') || null, r.tried);
      } else {
        const r = await requestDecisions(c, snaps, info);
        applyDecisions(this, r.clean);
      }
      if (usedVia && usedVia.length) this.log(`居民之魂分工运转（${[...new Set(usedVia)].join('、')}）`, 'hl');
      // 个人冷却重置：平均 intervalH，个体 0.6~1.4 抖动错开（干长活的人由 ready 与门天然再延后）
      const now = this._aiNowMin();
      for (const n of batch) n.aiDcAt = now + Math.round(this.aiCfg.intervalH * 60 * (0.6 + this.rng() * 0.8));
    } catch (e) {
      this.log('居民之魂失联（' + String(e && e.message).slice(0, 80) + '），这一批由本能接管', 'warn');
      // 失败也给冷却，避免同一批每帧重试轰炸端点
      const now = this._aiNowMin();
      for (const n of batch) n.aiDcAt = now + this.aiCfg.intervalH * 60;
    } finally {
      release();
      this.aiBusy = false;
    }
  }

  // 兼容/冒烟入口：把所有醒着的人立即凑成一批（不等收集窗口）。正常游戏循环不走这里
  async requestAiRound() {
    if (this.aiBusy) return;
    const batch = this.npcs.filter(n => !n.dying && !(n.inside && n.intent.type === 'sleep'));
    for (const n of batch) { n.aiAsking = true; n.aiDcAt = 0; }
    this.aiBatch = []; this.aiBatchStart = 0;
    return this.requestAiBatch(batch);
  }
}

// 工地周边离 npc 最近的可站位点（含工地格本身——工地不阻挡）
function nearWalkable(w, x, y, npc) {
  const cands = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
    .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
    .filter(p => walkable(w, p.x, p.y))
    .sort((a, b) =>
      (Math.abs(a.x - npc.x) + Math.abs(a.y - npc.y)) - (Math.abs(b.x - npc.x) + Math.abs(b.y - npc.y)));
  return cands[0] || null;
}
void clamp;
