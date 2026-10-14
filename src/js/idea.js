// idea.js —— 观念系统（v4.7.0 · 真正的演化）
// 设计来源：人工生命研究——Sugarscape（能量-生存-繁殖）、TerraLingua（LLM生态开放演化）、
// Artificial Life in the Wild（文化层提供不可预测的动态性）。
// 核心原则：
//   1. 观念是自由文本——不限种类，不预设分类。货币/宗教/制度都从观念里长出来。
//   2. 物理层保持确定性（吃睡伤死不动）；文化层完全开放。
//   3. 观念从经历/对话/矛盾中自发形成，不依赖缺口扫描。
//   4. 传播经对话（复用 tryPairChat），小概率变异。
//   5. 适应度=持有者平均福祉；低则遗忘，高则结晶为制度。
// （环境无关，game 提供上下文）

import { clamp, chance, choice } from './core.js';
import { mutateWord } from './lexicon.js';

// ---------- 常量 ----------
const IDEA_CAP = 48;           // 全镇观念池上限（有限律）
const NPC_IDEA_CAP = 6;        // 单个 NPC 持有的观念上限（有限律）
const IDEA_FORM_P = 0.012;     // 每日形成观念的基础概率（小概率——念头不是每天都有）
const IDEA_SPREAD_P = 0.08;    // 聊天时传播概率（比习俗高——观念比规矩轻）
const IDEA_MUTATE_P = 0.15;    // 传播时变异概率（15%——话传三代会走样）
const IDEA_FORGET_P = 0.02;    // 低适应度每日遗忘概率
const CRYSTALLIZE_RATIO = 0.3; // 结晶阈值：持有者占成年人口 30%
const FITNESS_WINDOW = 7;      // 适应度观察窗口（天）

// ---------- 观念结构 ----------
// { id, text, origin:{npcId,day,why}, holders:[], fitness, bornDay, mutatedFrom, spreadCount, status, crystallizedTo }
// status: 'wild'(野生) | 'spreading'(传播中) | 'crystallized'(已结晶) | 'dead'(已死)

let _ideaSeq = 1;

function nextIdeaId(game) {
  if (game && game._ideaSeq != null) return 'idea_' + String(game._ideaSeq++).padStart(4, '0');
  return 'idea_' + String(_ideaSeq++).padStart(4, '0');
}

// ---------- 创建观念 ----------
export function makeIdea(text, npcId, day, why, game) {
  return {
    id: nextIdeaId(game),
    text: String(text || '').trim().slice(0, 40) || '一个模糊的念头',
    origin: { npcId, day, why: String(why || '').slice(0, 30) || '日子过出来的' },
    holders: npcId != null ? [npcId] : [],
    fitness: 0.5,               // 初始适应度中等
    bornDay: day,
    mutatedFrom: null,
    spreadCount: 0,
    status: 'wild',
    crystallizedTo: null,
    _fitnessHistory: []         // 最近 N 天的适应度采样（不进存档）
  };
}

// ---------- 从经历形成观念 ----------
// NPC 每天有小概率从近事/心结/身体感受里长出一个观念。
// 不依赖缺口扫描——念头是过日子的副产品。
export function formIdea(npc, game, day) {
  if (!npc || npc.dying || npc.body.ageYears < 12) return null;
  if (!chance(game.rng, IDEA_FORM_P)) return null;
  // 从近事/心结/冲动里取素材
  // v4.9.0 观念土壤（D39）：公共事件（意外记忆）是念头的头号原料——
  // 「得有个主事的」从评理/争吵/噩耗里长，不从流水账里长
  const recent = (npc.memories || []).slice(-5);
  const inc = recent.filter(m => m.isIncident);
  const mems = (inc.length ? inc : recent.slice(-3)).map(m => m.text);
  const dom = npc.mind && npc.mind.conflicts && npc.mind.conflicts.length
    ? npc.mind.conflicts[0] : null;
  let text = '';
  let why = '';
  if (dom && Math.abs(dom.lean - 0.5) > 0.2) {
    // 心结逼出观念
    text = `${dom.a}比${dom.b}要紧`;
    why = `心里「${dom.a}」与「${dom.b}」撕扯得厉害`;
  } else if (mems.length) {
    // 从最近经历提炼
    const mem = mems[mems.length - 1];
    text = mem.length > 20 ? mem.slice(0, 20) : mem;
    why = `从「${mem.slice(0, 12)}」里想出来的`;
  } else {
    // 身体感受逼出观念
    const hunger = npc.needs.hunger > 70;
    const cold = npc.body.feel.cold > 60;
    if (hunger) { text = '吃饱才是正经事'; why = '天天饿肚子'; }
    else if (cold) { text = '得有个暖和去处'; why = '冻得受不住'; }
    else { text = '日子该有个讲究'; why = '心里空落落的'; }
  }
  const idea = makeIdea(text, npc.id, day, why, game);
  npc.ideas = npc.ideas || [];
  npc.ideas.push(idea.id);
  if (npc.ideas.length > NPC_IDEA_CAP) npc.ideas.shift();
  game.ideas = game.ideas || [];
  game.ideas.push(idea);
  while (game.ideas.length > IDEA_CAP) game.ideas.shift();
  npc.memory(`心里冒出个念头：「${text}」`, day, game.clock ? game.clock.hour : 6);
  return idea;
}

// ---------- 传播观念（带变异） ----------
// a 把观念传给 b。变异概率 15%——话传三代会走样。
export function spreadIdea(a, b, game, day) {
  if (!a.ideas || !a.ideas.length || !game.ideas) return null;
  // 从 a 持有的观念里挑一个 b 还没有的
  const bHas = new Set(b.ideas || []);
  const candidates = a.ideas.filter(id => !bHas.has(id));
  if (!candidates.length) return null;
  const ideaId = choice(game.rng, candidates);
  const idea = game.ideas.find(i => i.id === ideaId);
  if (!idea || idea.status === 'dead') return null;
  // 倔/严谨的人不买账
  const stubborn = b.traits.includes('倔') || b.traits.includes('严谨');
  if (stubborn && chance(game.rng, 0.5)) {
    b.memory(`听${a.name}说起「${idea.text}」，不以为然`, day, game.clock ? game.clock.hour : 6);
    return null;
  }
  // 变异：话传三代会走样
  let text = idea.text;
  let mutatedFrom = null;
  if (chance(game.rng, IDEA_MUTATE_P)) {
    text = mutateWord(game.rng, text);
    mutatedFrom = idea.id;
  }
  // 如果变异了，创建新观念；没变异则加入持有者
  if (mutatedFrom) {
    const newIdea = makeIdea(text, b.id, day, `从「${idea.text}」变来的`, game);
    newIdea.mutatedFrom = mutatedFrom;
    newIdea.spreadCount = idea.spreadCount + 1;
    game.ideas.push(newIdea);
    while (game.ideas.length > IDEA_CAP) game.ideas.shift();
    b.ideas = b.ideas || [];
    b.ideas.push(newIdea.id);
    if (b.ideas.length > NPC_IDEA_CAP) b.ideas.shift();
    b.memory(`听${a.name}说起「${idea.text}」，我想成了「${text}」`, day, game.clock ? game.clock.hour : 6);
    return newIdea;
  } else {
    idea.holders.push(b.id);
    idea.spreadCount++;
    if (idea.status === 'wild') idea.status = 'spreading';
    b.ideas = b.ideas || [];
    b.ideas.push(idea.id);
    if (b.ideas.length > NPC_IDEA_CAP) b.ideas.shift();
    b.memory(`跟${a.name}学会了「${idea.text}」`, day, game.clock ? game.clock.hour : 6);
    return idea;
  }
}

// ---------- 计算适应度 ----------
// 适应度 = 持有者平均福祉（mood 40% + energy 30% + 反向 hunger 30%）
// 低适应度 → 被遗忘；高适应度 + 持有者多 → 结晶
export function calcFitness(idea, game) {
  if (!idea.holders.length) return 0;
  const holders = game.npcs.filter(n => idea.holders.includes(n.id) && !n.dying);
  if (!holders.length) return 0;
  const avg = holders.reduce((s, n) => {
    const mood = n.needs.mood / 100;
    const energy = n.needs.energy / 100;
    const satiety = (100 - n.needs.hunger) / 100;
    return s + mood * 0.4 + energy * 0.3 + satiety * 0.3;
  }, 0) / holders.length;
  return clamp(avg, 0, 1);
}

// ---------- 结晶为习俗/制度 ----------
// 持有者达成年人口比例 + 适应度够高 → 观念落地为规矩
function crystallize(idea, game, day) {
  if (idea.status === 'crystallized') return false;
  const adults = game.npcs.filter(n => n.body.ageYears >= 16 && !n.dying);
  if (!adults.length) return false;
  const ratio = idea.holders.filter(id => adults.some(a => a.id === id)).length / adults.length;
  if (ratio < CRYSTALLIZE_RATIO) return false;
  const fitness = calcFitness(idea, game);
  if (fitness < 0.45) return false;
  // 结晶为习俗（v4.8.0 去装饰：规矩不附带任何我写的效果——
  // 约束力从公共可见性涌现：人人快照里看得见它，遵不遵守、怎么议论违反者，是他们的事）
  game.customs = game.customs || [];
  const name = idea.text.slice(0, 8);
  const custom = {
    id: 'custom_' + idea.id,
    name,
    desc: idea.text,
    by: game.npcs.find(n => n.id === idea.origin.npcId)?.name || '镇上',
    day,
    holders: idea.holders.slice(),
    evo: true,
    fromIdea: idea.id
  };
  game.customs.push(custom);
  idea.status = 'crystallized';
  idea.crystallizedTo = custom.id;
  game.log(`「${idea.text}」在镇上立住了脚，成了规矩`, 'good');
  // 演化日志：落地是演化史的事件
  game.evoLog = game.evoLog || [];
  game.evoLog.push({
    day,
    what: `「${idea.text}」成了镇上的规矩`,
    why: idea.origin.why,
    action: 'crystallize',
    outcome: `${idea.holders.length}人信 · 适应度${Math.round(fitness * 100)}%`,
    status: 'commit'
  });
  if (game.evoLog.length > 200) game.evoLog.shift();
  return true;
}

// ---------- 每日推进 ----------
export function ideaDaily(game, day) {
  if (!game.ideas) game.ideas = [];
  if (!game.npcs) return;
  // 1. 每个 NPC 小概率形成观念
  for (const n of game.npcs) {
    formIdea(n, game, day);
  }
  // 2. 清理死观念（无人持有）
  game.ideas = game.ideas.filter(i => {
    i.holders = i.holders.filter(id => game.npcs.some(n => n.id === id && !n.dying));
    return i.holders.length > 0;
  });
  // 3. 更新适应度（观察窗口）
  for (const idea of game.ideas) {
    if (idea.status === 'dead') continue;
    const f = calcFitness(idea, game);
    idea._fitnessHistory = idea._fitnessHistory || [];
    idea._fitnessHistory.push({ day, f });
    if (idea._fitnessHistory.length > FITNESS_WINDOW) idea._fitnessHistory.shift();
    // 滑动平均
    idea.fitness = idea._fitnessHistory.reduce((s, h) => s + h.f, 0) / idea._fitnessHistory.length;
  }
  // 4. 低适应度遗忘
  for (const n of game.npcs) {
    if (!n.ideas) continue;
    n.ideas = n.ideas.filter(id => {
      const idea = game.ideas.find(i => i.id === id);
      if (!idea || idea.status === 'dead') return false;
      if (idea.fitness < 0.3 && chance(game.rng, IDEA_FORGET_P)) {
        n.memory(`忘了「${idea.text}」这个念头`, day, game.clock ? game.clock.hour : 6);
        return false;
      }
      return true;
    });
  }
  // 5. 结晶判定
  for (const idea of game.ideas) {
    if (idea.status !== 'spreading') continue;
    if (crystallize(idea, game, day)) {
      // 编年史：观念落地为制度
      if (game.annal) game.annal('evo', `「${idea.text}」成了镇上的规矩`, `从${game.npcs.find(n => n.id === idea.origin.npcId)?.name || '某人'}的念头里长出来的`);
    }
  }
  // 6. 标记死观念（ holder 全忘光）
  for (const idea of game.ideas) {
    if (idea.status !== 'dead' && idea.holders.length === 0) {
      idea.status = 'dead';
    }
  }
}

// ---------- 存档往返 ----------
export function serializeIdeas(game) {
  return {
    ideas: (game.ideas || []).map(i => ({
      ...i,
      _fitnessHistory: undefined   // 瞬时观察窗口不进存档
    })),
    seq: game._ideaSeq || 1
  };
}

export function hydrateIdeas(game, data) {
  game.ideas = (data && data.ideas) || [];
  game._ideaSeq = (data && data.seq) || 1;
  // 恢复 NPC 的 ideas 索引
  const ideaMap = new Map(game.ideas.map(i => [i.id, i]));
  for (const n of game.npcs || []) {
    if (!n.ideas) n.ideas = [];
    n.ideas = n.ideas.filter(id => ideaMap.has(id));
  }
}

// ---------- 工具：NPC 持有的观念文本列表 ----------
export function npcIdeaTexts(npc, game) {
  if (!npc.ideas || !game.ideas) return [];
  return npc.ideas
    .map(id => game.ideas.find(i => i.id === id))
    .filter(i => i && i.status !== 'dead')
    .map(i => i.text);
}
