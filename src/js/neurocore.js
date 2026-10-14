// neurocore.js - 神经芯（设计稿：.trae/documents/神经芯设计.md）：一颗独立的大脑，寄宿在一位居民身上
// 零内容红线：这里只有机制——一颗芯、一张小策略权重表、奖励调制、死后游荡、落进新生儿。
// 不写性格模板、不写天赋列表、不写前世记忆。芯里只有权重，没有往事：
// 转世不带前世记忆，手艺在骨头里。（环境无关，只依赖 core.js，单向无环）
import { clamp } from './core.js';

// ---------- 常量（有限定理） ----------
export const NEURO_TAIL_DEADLINE = 30;  // 游荡 30 天无新生儿承接 → 记一轮轮回，等待重置（芯不灭，总有新生儿）
// 权重基线 = 现状行为：exist/wander/scout 是闲时三分概率×100（55%/45%/12%），
// work 是工作愣神闸的缩放（100 = 现状 0.18 概率）。芯刚落地不改变任何行为。
export const NEURO_W = { exist: 55, wander: 45, scout: 12, work: 100 };
export const NEURO_W_CLAMP = { exist: [5, 92], wander: [5, 92], scout: [1, 40], work: [30, 260] };
export const NEURO_LR = 2;              // 奖励调制固定步长（零随机，可 seed 复现）
const NEURO_DECAY = 0.02;               // 每日向基线回落（用进废退的退化面：不牢靠的习惯会淡）
const AXIS_LABEL = { exist: '发呆', wander: '闲逛', scout: '远行', work: '手上活计' };  // 词取自现有动作，不是新内容

export function makeNeurocore(hostId, day) {
  return {
    hostId: hostId || null,
    gen: 1, age: 0, bornDay: day || 1,
    w: { ...NEURO_W },
    floating: false, deadSince: null,
    lastHost: null,
    rounds: 0,                       // 游荡中走完的轮回轮数（每 30 天 +1，承接后不清——芯走过的路）
    stats: { decisions: 0, reinforced: 0 },
    _snap: null, _prevAction: null
  };
}

// 芯是否正附在 npc 身上（活着、没游荡、id 对得上）
function riding(core, npc) {
  return !!core && !core.floating && core.hostId === npc.id;
}

// ---------- 奖励调制（学习=天道在调参）：挂在 game.js 每次脚本决策之后 ----------
// well = energy + (100-hunger) + mood + social；改善→强化最近动作，恶化→轻推回。
// 固定学习率零随机；只调制自由时段的轴，生存动作（吃/睡/避雨）不进权重表。
export function neuroObserve(game, npc, dec) {
  const core = game.neurocore;
  if (!riding(core, npc)) return;
  const well = npc.needs.energy + (100 - npc.needs.hunger) + npc.needs.mood + npc.needs.social;
  if (core._snap != null && core._prevAction && NEURO_W_CLAMP[core._prevAction]) {
    const d = well - core._snap;
    const key = core._prevAction;
    if (d > 6) {
      const [lo, hi] = NEURO_W_CLAMP[key];
      const w = clamp(core.w[key] + NEURO_LR, lo, hi);
      if (w !== core.w[key]) core.stats.reinforced++;
      core.w[key] = w;
    } else if (d < -6) {
      const [lo, hi] = NEURO_W_CLAMP[key];
      core.w[key] = clamp(core.w[key] - NEURO_LR, lo, hi);
    }
  }
  core._snap = well;
  core._prevAction = dec && NEURO_W_CLAMP[dec.action] ? dec.action : null;
  core.stats.decisions++;
}

// ---------- 宿主在世的偏置（不覆盖决策，只加倾向） ----------
// 工作时段愣神闸：0.18 → 0.18 × 100/w.work（学会"手上活计要紧"就少愣神）
export function neuroWorkIdle(npc, town) {
  const core = town && town.neurocore;
  if (!riding(core, npc)) return 0.18;
  return clamp(0.18 * (NEURO_W.work / core.w.work), 0.04, 0.45);
}

// 闲时三分（scriptDecide 第 8 步）：exist/wander/scout 按 w 加权抽签。
// scout 只在原有条件满足时占权重；一次 rng() 抽签，调用次数确定（不打乱测试序列）。
export function neuroTail(npc, town, rng, h) {
  const core = town && town.neurocore;
  if (!riding(core, npc)) return null;
  const w = core.w;
  const scoutOk = h >= 7 && h < 19 && npc.needs.energy > 40 && npc.needs.hunger < 65;
  const total = w.exist + w.wander + (scoutOk ? w.scout : 0);
  const r = rng() * total;
  if (r < w.exist) return { action: 'exist', why: null };
  if (r < w.exist + w.wander) return { action: 'wander', why: null };
  return { action: 'scout', why: '去镇外走走，看看能发现什么' };
}

// ---------- 死亡游荡：芯不进坟，也不附身活人 ----------
export function neuroOnDeath(game, npc) {
  const core = game.neurocore;
  if (!core || core.floating || core.hostId !== npc.id) return;
  core.floating = true;
  core.deadSince = game.clock ? game.clock.totalDay : 1;
  core.lastHost = npc.name;
  core._snap = null; core._prevAction = null;
}

// ---------- 落进新生儿：挂在 addBorn 尾部 ----------
// floating 的芯落进死时之后新降生的第一个新生儿（随机性来自出生本身）。
// w 原样带过去（手艺在骨头里），观察快照清空（不带走任何前世）。
export function neuroOnBorn(game, n) {
  const core = game.neurocore;
  if (!core || !core.floating) return;
  const days = core.deadSince != null ? Math.max(0, (game.clock ? game.clock.totalDay : 1) - core.deadSince) : 0;
  const waited = core.rounds > 0 ? `${core.rounds}轮轮回又${days}天` : `${days}天`;
  const top = Object.keys(NEURO_W).reduce((a, b) =>
    (core.w[a] / NEURO_W[a] >= core.w[b] / NEURO_W[b] ? a : b));
  core.hostId = n.id;
  core.floating = false;
  core.deadSince = null;
  core.gen++;
  core.age = 0;
  core.bornDay = game.clock ? game.clock.totalDay : 1;
  core._snap = null; core._prevAction = null;
  if (game.annal) {
    game.annal('neuro', `${n.name}落了地，那颗游荡了${waited}的芯落进了这具新身体（第${core.gen}代，上一代最重的习气是${AXIS_LABEL[top]}）`, '神经芯·转世不带记忆');
  }
}

// ---------- 日推进：用进废退 + 轮回倒计时（挂在 onNewDay） ----------
// 芯不灭：游荡 30 天无新生儿就记一轮轮回、等待重置，接着等——天道不急，总有新生儿。
export function neuroDaily(game, day) {
  const core = game.neurocore;
  if (!core) return;
  core.age++;
  for (const k of Object.keys(NEURO_W)) {
    const [lo, hi] = NEURO_W_CLAMP[k];
    core.w[k] = clamp(core.w[k] + (NEURO_W[k] - core.w[k]) * NEURO_DECAY, lo, hi);
  }
  if (core.floating && core.deadSince != null && day - core.deadSince > NEURO_TAIL_DEADLINE) {
    core.rounds++;
    core.deadSince = day;   // 轮回：等待重置，接着等
    if (game.annal) {
      game.annal('neuro', `那颗${core.lastHost ? core.lastHost + '留下的、' : ''}游荡的芯走完了第${core.rounds}轮轮回，没等到新生儿就再等一轮（天道不急）`, '神经芯·轮回');
    } else if (game.log) game.log('那颗游荡的芯走完一轮轮回，接着等', 'warn');
  }
}
