// evolve.js —— 演化观察层（v4.8.0 基底之上全开放）
// 类型管道退役：曾经引擎能生产 9 种类型的提案（配方/语言/习俗/事件/建筑/角色/说法/词条/观念），
// 那是白名单思维——演化不该有一个"类型发生器"。
// 现在演化只有一条管道：观念池（idea.js）——念头自己生、自己传、自己变异、自己死、自己结晶成规矩。
// 本层只剩：存档往返、旧档余温（已固化事件烧完为止，不产生新的）、activeJobs 观察。
// （环境无关，game 提供上下文）
import { chance } from './core.js';
import { chronNote } from './history.js';
import { RECIPE_DEFS } from './develop.js';
import { ideaDaily, serializeIdeas, hydrateIdeas } from './idea.js';

// 名册就是「眼下谁在以什么为生」（产出革命：没有第二张表）
export function activeJobs(game) {
  const set = new Set();
  for (const n of game.npcs || []) if (n.job && n.body.ageYears >= 16) set.add(n.job);
  return [...set];
}

// ================= 旧档余温：已固化事件继续触发，但永远不会有新的 =================
// v4.8.0 之前固化的演化事件是老存档里的历史内容——让它们自然烧完，不添新柴。
function triggerMet(when, game) {
  switch (when) {
    case 'daily': return true;
    case 'wed': return !!game._wedding;
    case 'death': return (game.npcs || []).some(n => n.dying);
    case 'sick': return (game.npcs || []).some(n => n.dying || n.plagueSick);
    case 'newcomer': return (game.npcs || []).some(n => n.origin === '客籍' && game.clock && game.clock.totalDay - (n.arrivedDay || 0) <= 2);
    case 'festival': return game.festivalUntilMin > 0;
    case 'harvest': return game.clock && game.clock.season === '秋';
    case 'plague': return !!(game.plague && !game.plague.over);
    case 'drought': return game.droughtDays > 0;
    case 'fire': return !!game.fire;
    default: return false;
  }
}

function runEvoEvent(game, def) {
  const { log, npcs } = game;
  const day = game.clock ? game.clock.totalDay : 1;
  log(`镇上起了「${def.name}」`, 'hl');
  chronNote(game, 'evo', `「${def.name}」来了`, '旧档里长出来的旧事');
  for (const s of def.steps) {
    if (s.op === 'say') {
      for (const n of npcs || []) n.perceive('hear', s.text, day, game.clock ? game.clock.hour : 6, 0);
    } else if (s.op === 'mood') {
      for (const n of npcs || []) n.moodDelta(s.delta);
    } else if (s.op === 'gather') {
      for (const n of (npcs || []).filter(v => !v.inside && !v.dying).slice(0, 5)) {
        n.setGotoArea(game.world, 'plaza', game.rng, null, `去看「${def.name}」`);
      }
    } else if (s.op === 'loss') {
      game.stock[s.res] = Math.max(0, (game.stock[s.res] || 0) - s.n);
    }
  }
}

function evoEventsDaily(game) {
  for (const def of game.evoEvents || []) {
    if (!triggerMet(def.trigger.when, game)) continue;
    if (chance(game.rng, def.trigger.p)) runEvoEvent(game, def);
  }
}

// ================= 演化日推进总入口 =================
// 唯一的演化管道是观念池：形成/传播/变异/适应度/结晶/遗忘，全在 idea.js。
export function evolveDaily(game, day) {
  evoEventsDaily(game);      // 旧档余温
  ideaDaily(game, day);      // 观念日推进
}

// ================= 存档往返 =================
// 类型管道已退役：候选池/风向/提案序号不再随档走——旧档里的它们就地成为历史。
export function serializeEvo(game) {
  // 动态配方表随档走（只存铁律层之外的——discovery 层长出来的手艺不能丢）
  const dynDefs = {};
  for (const [id, def] of Object.entries(game.recipeDefs || {})) {
    if (!RECIPE_DEFS[id]) dynDefs[id] = def;
  }
  return {
    log: game.evoLog || [],
    recipeDefs: dynDefs,
    evoEvents: game.evoEvents || [],
    evoBuilds: game.evoBuilds || [],
    ideas: serializeIdeas(game)
  };
}

export function hydrateEvo(game, data) {
  game.evoLog = (data && data.log) || [];
  game.recipeDefs = { ...RECIPE_DEFS, ...((data && data.recipeDefs) || {}) };
  game.evoEvents = (data && data.evoEvents) || [];
  game.evoBuilds = (data && data.evoBuilds) || [];
  if (data && data.ideas) hydrateIdeas(game, data.ideas);
}
