// settlement.js - 聚落层：多聚落独立管理与交互（v4.4 世界自变+多聚落）
// 零内容红线：聚落特征从属性推导，不硬编码聚落类型
// 单向依赖：core.js（不反向依赖 game.js）
import { rint, chance } from './core.js';

export const SETT = {
  enabled: true,
  initialCount: 2,       // 初始聚落数（回滚铁律：初期只做2个）
  minDistance: 80,       // 聚落间最小距离
  maxDistance: 200,     // 最大交互距离
  tradeProb: 0.10,      // 每日贸易概率
  migrateProb: 0.005,   // 每日移民概率
  abandonDays: 365,    // 人口为0持续多少天 → 废弃
};

// 命名规则（封闭集合，系统标识非内容——同 PET_PERS 级别）
const NAME_DIRS = ['北', '南', '东', '西', '上', '下', '前', '后'];
const NAME_TYPES = ['村', '寨', '堡', '屯', '营', '坊'];

function settlementName(rng) {
  return NAME_DIRS[Math.floor(rng() * NAME_DIRS.length)] + NAME_TYPES[Math.floor(rng() * NAME_TYPES.length)];
}

// 创建聚落
export function makeSettlement(center, rng, name) {
  return {
    id: `s_${Math.floor(rng() * 0x7fffffff)}`,   // 不用 Date.now：同 seed 必须跑出同一个世界（D34）
    name: name || settlementName(rng),
    center: { x: center.x, y: center.y },
    npcIds: [],
    population: 0,
    resources: {},         // 资源统计（从居民职业推导）
    culture: {
      traits: [],          // 文化特征（发展中自然长出）
      lexiconInfluence: 0,
    },
    founded: 0,
    abandoned: false,
    _emptySince: 0,
  };
}

// 聚落日推进
export function tickSettlement(settlement, game, rng) {
  if (!SETT.enabled || settlement.abandoned) return;

  // v4.5.0：人口 = 镇内登记居民 + 落脚于此的离镇者（wanderers 可能不存在于 mock，守卫）
  const settled = (game.wanderers || []).filter(w => w.wand && w.wand.state === 'settled' && w.wand.settId === settlement.id).length;
  settlement.population = settlement.npcIds.length + settled;

  // 废弃判定：人口为0持续 abandonDays → 废弃
  if (settlement.population === 0) {
    if (!settlement._emptySince) settlement._emptySince = game.clock.totalDay;
    if (game.clock.totalDay - settlement._emptySince > SETT.abandonDays) {
      settlement.abandoned = true;
    }
  } else {
    settlement._emptySince = 0;
  }

  // 资源统计：从居民职业推导
  settlement.resources = {};
  for (const id of settlement.npcIds) {
    const n = game.npcs.find(npc => npc.id === id);
    if (!n) continue;
    settlement.resources[n.job] = (settlement.resources[n.job] || 0) + 1;
  }
}

// 聚落间交互
export function interactSettlements(a, b, game, rng) {
  if (!SETT.enabled || a.abandoned || b.abandoned) return null;

  const dx = a.center.x - b.center.x;
  const dy = a.center.y - b.center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > SETT.maxDistance) return null;

  const result = {};

  // 贸易：资源互补（一个聚落有另一个没有的职业 → 互通有无）
  if (chance(rng, SETT.tradeProb)) {
    const aRes = Object.keys(a.resources);
    const bRes = Object.keys(b.resources);
    const aOnly = aRes.filter(r => !bRes.includes(r));
    const bOnly = bRes.filter(r => !aRes.includes(r));
    if (aOnly.length && bOnly.length) {
      result.trade = {
        from: a.id, to: b.id,
        give: aOnly[0], get: bOnly[0],
      };
    }
  }

  // 移民：人口多 → 少
  if (chance(rng, SETT.migrateProb)) {
    const from = a.population > b.population ? a : b;
    const to = from === a ? b : a;
    if (from.population > 3 && to.population < from.population) {
      const migrantId = from.npcIds[Math.floor(rng() * from.npcIds.length)];
      result.migrate = { migrantId, from: from.id, to: to.id };
    }
  }

  return Object.keys(result).length ? result : null;
}

// 应用交互结果
function applyInteraction(interaction, game, rng) {
  if (interaction.migrate) {
    const { migrantId, from, to } = interaction.migrate;
    const npc = game.npcs.find(n => n.id === migrantId);
    if (!npc) return;
    const fromS = game.settlements.find(s => s.id === from);
    const toS = game.settlements.find(s => s.id === to);
    if (!fromS || !toS) return;
    fromS.npcIds = fromS.npcIds.filter(id => id !== migrantId);
    toS.npcIds.push(migrantId);
    npc.settlementId = toS.id;
    npc.memory(`听说${toS.name}日子好过些，决定迁过去`, game.clock.totalDay, 6);
    game.log(`${npc.name}从${fromS.name}迁到了${toS.name}`, '');
  }
  if (interaction.trade) {
    const { from, to } = interaction.trade;
    const fromS = game.settlements.find(s => s.id === from);
    const toS = game.settlements.find(s => s.id === to);
    if (fromS && toS) {
      game.log(`${fromS.name}与${toS.name}互通有无`, '');
    }
  }
}

// 聚落日推进（全部聚落 + 交互）
export function settlementsDaily(game, rng) {
  if (!SETT.enabled || !game.settlements) return;
  for (const s of game.settlements) {
    tickSettlement(s, game, rng);
  }
  for (let i = 0; i < game.settlements.length; i++) {
    for (let j = i + 1; j < game.settlements.length; j++) {
      const interaction = interactSettlements(game.settlements[i], game.settlements[j], game, rng);
      if (interaction) applyInteraction(interaction, game, rng);
    }
  }
}

// 初始化多聚落
export function initSettlements(originCenter, worldSeed, rng) {
  if (!SETT.enabled) return [];
  const settlements = [];

  // 起源聚落（现有城镇）
  const origin = makeSettlement(originCenter, rng, '小镇');
  origin.founded = 0;
  origin.origin = true;   // v4.5.0：本镇不画营帐标记——镇子本身就是看得见的
  settlements.push(origin);

  // 第二聚落
  if (SETT.initialCount >= 2) {
    const angle = rng() * Math.PI * 2;
    const dist = SETT.minDistance + rng() * (SETT.maxDistance - SETT.minDistance);
    const cx = Math.round(originCenter.x + Math.cos(angle) * dist);
    const cy = Math.round(originCenter.y + Math.sin(angle) * dist);
    const second = makeSettlement({ x: cx, y: cy }, rng);
    second.founded = 0;
    settlements.push(second);
  }

  return settlements;
}

// 序列化
export function serializeSettlements(settlements) {
  if (!settlements) return [];
  return settlements.map(s => ({
    id: s.id,
    name: s.name,
    center: { ...s.center },
    npcIds: [...s.npcIds],
    population: s.population,
    resources: { ...s.resources },
    culture: { ...s.culture },
    founded: s.founded,
    abandoned: s.abandoned,
    origin: !!s.origin,
    _emptySince: s._emptySince || 0,
  }));
}

export function hydrateSettlements(data) {
  if (!data || !Array.isArray(data)) return [];
  return data.map(s => ({
    id: s.id,
    name: s.name,
    center: { ...s.center },
    npcIds: [...(s.npcIds || [])],
    population: s.population || 0,
    resources: { ...(s.resources || {}) },
    culture: s.culture ? { ...s.culture } : { traits: [], lexiconInfluence: 0 },
    founded: s.founded || 0,
    abandoned: s.abandoned || false,
    // 旧档无 origin 标记：名字叫小镇的就是起源（老世界的镇子只有一个）
    origin: s.origin != null ? !!s.origin : s.name === '小镇',
    _emptySince: s._emptySince || 0,
  }));
}
