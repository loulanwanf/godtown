// knowledge.js —— 知识层（v4.3 · 手艺是预置配方这件事）
// 设计来自计划书第十一章重构：知识是"从经历中得出什么"，不是经历本身（记忆是"经历过什么"）
// 四件事：
//   1. makeKnowledge        从前提+结论造一条知识
//   2. maybeInfer           NPC 从已有知识组合推理出新知识（知识可以组合）
//   3. truthValue           知识与现实的吻合度（0-1）——错误知识在 NPC 心里和正确的一样，直到被现实推翻
//   4. believe              NPC 相信一条知识（写进 knowledgeList）
// 关键设计：
//   - 知识可以组合：A 的效果槽与 B 的前提槽有交集 → A+B 组合出新知识
//   - 知识不一定正确：错误知识在 NPC 心里和正确的一样，直到被现实推翻；错误知识会传播、会被相信
//   - 手艺 = 知识派生的能力（develop.js knowledgeInnovateDaily 用知识驱动手艺精进）
// 红线：本层不生成任何内容，不查动作清单，不编台词。知识只从 NPC 自己的经历和推理里长出来。

// ---------- 知识层总开关（回滚保险，v4.3） ----------
// false → 知识层关闭：knowledgeDaily 不跑，knowledgeInnovateDaily 不跑，NPC 不推理。
//         退回 v4.2 行为（手艺仍走瓶颈驱动创新 + RECIPE_DEFS 预置配方兜底）。
// true  → 知识层在岗：NPC 从意外捕获知识、组合推理、验证真值、传播给邻居。
// 知识层出问题，拨回 false 即退回 v4.2 行为，无需改码。
export const KNOWLEDGE = { enabled: true };

// ---------- 概率漏斗（有限律：不是所有经历都变知识，否则知识爆炸） ----------
const INFER_P = 0.04;           // 推理概率：空闲时只有 4% 概率想深想（大部分时候不想）
const TRUTH_VERIFY_P = 0.10;    // 验证概率：被现实检验的机会只有 10%
const WRONG_FORGET_P = 0.10;    // 遗忘概率：被证伪的知识只有 10%/天 概率被放弃（错误知识很顽固）
const KNOWLEDGE_SPREAD_P = 0.03; // 传播概率：邻居只有 3% 概率学到（和正确的一样——NPC 不知道它错）
const KNOWLEDGE_CAP = 20;        // 单个 NPC 能信的知识条数上限（有限律）
const SPREAD_RADIUS = 6;         // 传播半径：观察者得在附近才能学（因果：看不见学不会）

let _nextKId = 1;

function rngOf(world) {
  return (world && typeof world.rng === 'function') ? world.rng : Math.random;
}
function dayOf(world) {
  return (world && world.clock && typeof world.clock.totalDay === 'number') ? world.clock.totalDay : 0;
}

/**
 * 从前提+结论造一条知识（推理/selftest 用）
 * @param {*} npc       相信者（可为 null——selftest 造知识时不必有 NPC）
 * @param {{verb?:string, targetNames?:Array}} premise 前提（动词+目标名）
 * @param {{slots?:Array<{slot:number, dir:string}>}} conclusion 结论（哪些槽往哪个方向变）
 * @param {string} source 'incident'|'inference'|'taught'
 * @param {number} day 形成于第几日
 * @returns {object} 知识对象
 */
export function makeKnowledge(npc, premise, conclusion, source, day) {
  const p = premise && typeof premise === 'object' ? premise : {};
  const c = conclusion && typeof conclusion === 'object' ? conclusion : {};
  return {
    id: 'k' + (_nextKId++),
    verb: String(p.verb || ''),
    targetNames: Array.isArray(p.targetNames) ? p.targetNames.slice() : [],
    slots: Array.isArray(c.slots) ? c.slots.map(s => ({ slot: s.slot | 0, dir: s.dir || '~' })) : [],
    source: source || 'inference',
    day: day || 0,
    truth: null,            // null = 未验证；0..1 = 验证后的真值
    believer: (npc && npc.id != null) ? npc.id : null,
    combined: source === 'inference',   // 推理出来的知识标记为组合
  };
}

/**
 * 从 incident（意外记忆）提取知识
 * incident 的 slotChanges: [{slot, from, to}] → 知识的 slots: [{slot, dir}]
 * 知识的 verb = incident.verb，targetNames = incident.targetNames
 * @param {object} incident 发现层的 incident 对象
 * @param {*} npcId 相信者 id
 * @returns {object|null} 知识对象；null 提取失败
 */
export function knowledgeFromIncident(incident, npcId) {
  if (!incident || !incident.verb || !Array.isArray(incident.slotChanges)) return null;
  const slots = [];
  for (const c of incident.slotChanges) {
    const dir = c.to > c.from ? '+' : (c.to < c.from ? '-' : '~');
    slots.push({ slot: c.slot | 0, dir });
  }
  if (!slots.length) return null;
  return {
    id: 'k' + (_nextKId++),
    verb: String(incident.verb),
    targetNames: Array.isArray(incident.targetNames) ? incident.targetNames.slice() : [],
    slots,
    source: 'incident',
    day: incident.day || 0,
    truth: null,
    believer: npcId,
    combined: false,
  };
}

/**
 * NPC 从已有知识组合推理出新知识
 * 组合规则：两条知识的槽位有交集（A 让某槽变，B 也涉及该槽），且动词不同 → 组合
 * 组合知识：verb = A.verb + B.verb，slots = A.slots + B.slots 去重（同槽取 A 的方向，因 A 先发生）
 * @param {*} npc 推理者
 * @param {Array} knowledgeList 已有知识
 * @param {*} world 上下文
 * @param {*} [rng] 随机源
 * @returns {object|null} 新知识；null 不推理
 */
export function maybeInfer(npc, knowledgeList, world, rng) {
  if (!KNOWLEDGE.enabled) return null;
  if (!npc || !Array.isArray(knowledgeList) || knowledgeList.length < 2) return null;
  if (npc.body && npc.body.ageYears < 12) return null;    // 婴幼儿不推理
  if (npc.dying) return null;                              // 临终不试新
  const r = (typeof rng === 'function') ? rng() : rngOf(world)();
  if (r > INFER_P) return null;
  // 只取非组合知识参与组合（防推理爆炸：组合知识不再参与组合）
  const list = knowledgeList.filter(k => !k.combined);
  if (list.length < 2) return null;
  // 用同一个 rng 的派生值选两条（确定性 + 避免再抽一次 rng 打乱链路）
  const seed = Math.floor(r * 10000);
  const i = seed % list.length;
  let j = ((seed >> 3) + 1) % list.length;
  if (i === j) j = (i + 1) % list.length;   // 确保取两条不同的
  const A = list[i], B = list[j];
  // 交集检查：A 和 B 的效果槽有交集 → 因果链可接
  const aSlots = new Set(A.slots.map(s => s.slot));
  let hasOverlap = false;
  for (const s of B.slots) { if (aSlots.has(s.slot)) { hasOverlap = true; break; } }
  if (!hasOverlap) return null;
  // 组合：verb 拼接，slots 合并（同槽取 A 的方向——A 先发生，方向以 A 为准）
  const merged = new Map();
  for (const s of A.slots) merged.set(s.slot, s.dir);
  for (const s of B.slots) if (!merged.has(s.slot)) merged.set(s.slot, s.dir);
  const slots = [...merged.entries()].map(([slot, dir]) => ({ slot, dir }));
  return {
    id: 'k' + (_nextKId++),
    verb: A.verb + B.verb,
    targetNames: [...new Set([...(A.targetNames || []), ...(B.targetNames || [])])],
    slots,
    source: 'inference',
    day: dayOf(world),
    truth: null,
    believer: (npc.id != null) ? npc.id : null,
    combined: true,
    from: [A.id, B.id],
  };
}

/**
 * 知识与现实的吻合度
 * 对照源：game.discoveries（被多人重复验证的技能模式——这是"现实裁判"）
 * 返回：1 = 完全吻合；0 = 完全矛盾；null = 无现实参照（没法验证，知识暂存）
 * 注意：truthValue 不改变知识本身——它只给一个数值。NPC 不因 truth=0 就不信（那是 maybeForgetWrong 的事）
 * @param {object} knowledge 知识对象
 * @param {object} world 世界上下文（取 discoveries）
 * @returns {number|null} 0..1 或 null
 */
export function truthValue(knowledge, world) {
  if (!knowledge || !world) return null;
  const discoveries = world.discoveries || [];
  if (!discoveries.length) return null;   // 没有现实参照——无法验证，不是"矛盾"
  let bestMatch = 0;
  for (const d of discoveries) {
    // verb 匹配：相同 verb，或组合知识的 verb 包含 discovery 的 verb 片段
    let verbMatch = false;
    if (d.verb === knowledge.verb) verbMatch = true;
    else if (knowledge.combined && knowledge.verb.length >= 2) {
      // 组合知识的 verb 是拼接的：检查 discovery 的 verb 是否是组合 verb 的子串
      verbMatch = knowledge.verb.includes(d.verb);
    }
    if (!verbMatch) continue;
    // 槽位匹配：知识的 slots 有多少在 discovery 的 slots 里
    const dSlots = new Set(d.slots);
    let match = 0, total = 0;
    for (const s of knowledge.slots) {
      total++;
      if (dSlots.has(s.slot)) match++;
    }
    const score = total > 0 ? match / total : 0;
    if (score > bestMatch) bestMatch = score;
  }
  return bestMatch;
}

/**
 * NPC 相信一条知识
 * 错误知识和正确的一样被相信——直到 truthValue 被检验且为 0，NPC 不会主动放弃
 * 去重：相同 verb + 相同 slots 不重复信
 * @param {*} npc NPC
 * @param {object} knowledge 知识对象（会被浅拷贝）
 */
export function believe(npc, knowledge) {
  if (!npc || !knowledge) return;
  if (!Array.isArray(npc.knowledgeList)) npc.knowledgeList = [];
  // 去重：相同 verb + 相同 slots 排列不重复信
  const key = knowledge.verb + '|' + knowledge.slots.map(s => s.slot + s.dir).sort().join(',');
  for (const k of npc.knowledgeList) {
    const kk = k.verb + '|' + k.slots.map(s => s.slot + s.dir).sort().join(',');
    if (kk === key) return;
  }
  npc.knowledgeList.push({ ...knowledge });
  while (npc.knowledgeList.length > KNOWLEDGE_CAP) npc.knowledgeList.shift();   // 有限律
}

/**
 * 概率性检验知识的真值（被现实检验后，truth 被赋值）
 * @param {*} npc @param {object} knowledge @param {*} world @param {*} [rng]
 */
export function maybeVerify(npc, knowledge, world, rng) {
  if (!KNOWLEDGE.enabled || !npc || !knowledge) return;
  if (knowledge.truth != null) return;   // 已验证过
  const r = (typeof rng === 'function') ? rng() : rngOf(world)();
  if (r > TRUTH_VERIFY_P) return;
  const tv = truthValue(knowledge, world);
  if (tv != null) knowledge.truth = tv;   // null = 无现实参照，不赋值（知识暂存，不判定真伪）
}

/**
 * 概率性放弃被证伪的知识
 * 错误知识在 NPC 心里和正确的一样顽固——只有 WRONG_FORGET_P/天 概率被放弃
 * @returns {boolean} true 表示放弃了
 */
export function maybeForgetWrong(npc, knowledge, rng) {
  if (!KNOWLEDGE.enabled || !npc || !knowledge) return false;
  if (knowledge.truth == null || knowledge.truth > 0) return false;   // 未证伪不弃
  const r = (typeof rng === 'function') ? rng() : Math.random();
  if (r > WRONG_FORGET_P) return false;
  if (!Array.isArray(npc.knowledgeList)) return false;
  const idx = npc.knowledgeList.findIndex(k => k.id === knowledge.id);
  if (idx >= 0) {
    npc.knowledgeList.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * 邻居概率性学到一条知识（错误知识和正确的一样传播——NPC 不知道它错）
 * @returns {boolean} true 表示观察者学到了
 */
export function maybeSpreadKnowledge(observer, actor, knowledge, world, rng) {
  if (!KNOWLEDGE.enabled || !observer || !actor || !knowledge) return false;
  if (observer.id === actor.id) return false;
  if (observer.body && observer.body.ageYears < 12) return false;    // 婴幼儿不学
  if (observer.dying) return false;
  // 已学到的不重复
  if (Array.isArray(observer.knowledgeList)) {
    const key = knowledge.verb + '|' + knowledge.slots.map(s => s.slot + s.dir).sort().join(',');
    for (const k of observer.knowledgeList) {
      const kk = k.verb + '|' + k.slots.map(s => s.slot + s.dir).sort().join(',');
      if (kk === key) return false;
    }
  }
  // 空间邻接（因果：看不见学不会）
  if (typeof actor.x !== 'number' || typeof observer.x !== 'number') return false;
  const dx = Math.abs(actor.x - observer.x), dy = Math.abs(actor.y - observer.y);
  if (dx > SPREAD_RADIUS || dy > SPREAD_RADIUS) return false;
  const r = (typeof rng === 'function') ? rng() : rngOf(world)();
  return r <= KNOWLEDGE_SPREAD_P;
}

/**
 * 知识层日推进总入口（game.js onNewDay 调用）
 * 五步：
 *   1. 捕获：从 NPC 的 incidents 提取知识（经历 → 知识）
 *   2. 推理：NPC 从已有知识组合出新知识（知识可以组合）
 *   3. 验证：概率性检验知识的真值（知识不一定正确）
 *   4. 遗忘：概率性放弃被证伪的知识（错误知识很顽固）
 *   5. 传播：邻居概率性学到知识（错误知识和正确的一样传播）
 * 系统从不主动设计知识——知识只从 NPC 自己的经历和推理里长出来。
 * @param {object} game 游戏对象
 * @param {number} day 当前日
 */
export function knowledgeDaily(game, day) {
  if (!KNOWLEDGE.enabled || !game || !game.npcs) return;
  const rng = rngOf(game);
  void day;

  // —— 1. 捕获：从 incidents 提取知识 ——
  for (const n of game.npcs) {
    if (!Array.isArray(n.incidents) || !n.incidents.length) continue;
    if (!Array.isArray(n.knowledgeList)) n.knowledgeList = [];
    for (const inc of n.incidents) {
      // 去重：已有相同 verb+slots 的知识就不重复提取
      const key = inc.verb + '|' + (inc.slotChanges || []).map(c => c.slot).sort().join(',');
      const exists = n.knowledgeList.some(k =>
        k.verb === inc.verb &&
        k.slots.map(s => s.slot).sort().join(',') === (inc.slotChanges || []).map(c => c.slot).sort().join(',')
      );
      if (exists) continue;
      const k = knowledgeFromIncident(inc, n.id);
      if (k) believe(n, k);
    }
  }

  // —— 2. 推理：NPC 从已有知识组合出新知识 ——
  for (const n of game.npcs) {
    if (!Array.isArray(n.knowledgeList) || n.knowledgeList.length < 2) continue;
    if (n.body && n.body.ageYears < 12) continue;
    const k = maybeInfer(n, n.knowledgeList, game, rng);
    if (k) {
      believe(n, k);
      // 推理出新知识 → 记忆（不是 incident，是普通记忆）
      if (typeof n.memory === 'function' && n.memory.length >= 4) {
        n.memory(`想明白了个道理：${k.verb}`, dayOf(game), 6, 60, { isIncident: false });
      } else if (typeof n.memory === 'function') {
        n.memory(`想明白了个道理：${k.verb}`, dayOf(game), 6);
      }
    }
  }

  // —— 3. 验证：概率性检验真值 ——
  for (const n of game.npcs) {
    if (!Array.isArray(n.knowledgeList)) continue;
    for (const k of n.knowledgeList) {
      if (k.truth == null) maybeVerify(n, k, game, rng);
    }
  }

  // —— 4. 遗忘：概率性放弃被证伪的知识 ——
  for (const n of game.npcs) {
    if (!Array.isArray(n.knowledgeList)) continue;
    for (let i = n.knowledgeList.length - 1; i >= 0; i--) {
      maybeForgetWrong(n, n.knowledgeList[i], rng);
    }
  }

  // —— 5. 传播：邻居概率性学到知识（错误知识和正确的一样传播）——
  for (const n of game.npcs) {
    if (!Array.isArray(n.knowledgeList)) continue;
    for (const k of n.knowledgeList) {
      if (k.source === 'taught') continue;   // 学来的不再传（防传播链爆炸）
      for (const o of game.npcs) {
        if (maybeSpreadKnowledge(o, n, k, game, rng)) {
          believe(o, { ...k, source: 'taught', believer: o.id });
        }
      }
    }
  }
}

// ---------- 存档往返 ----------
// knowledgeList 随 NPC 走，但跟 incidents 一样不挤占 NPC 基本字段——由 knowledge 存档收口
export function serializeKnowledge(game) {
  const byNpc = {};
  for (const n of (game.npcs || [])) {
    if (n.id != null && Array.isArray(n.knowledgeList) && n.knowledgeList.length) {
      byNpc[n.id] = n.knowledgeList.map(k => ({ ...k }));
    }
  }
  return { byNpc };
}
export function hydrateKnowledge(game, data) {
  const byNpc = (data && data.byNpc) || {};
  for (const n of (game.npcs || [])) {
    if (n.id != null && Array.isArray(byNpc[n.id])) {
      n.knowledgeList = byNpc[n.id];
    } else {
      n.knowledgeList = [];
    }
  }
  // 恢复 id 计数器——新旧知识 id 不许撞车
  for (const n of (game.npcs || [])) {
    for (const k of (n.knowledgeList || [])) {
      const m = /^k(\d+)$/.exec(k.id || '');
      if (m && +m[1] >= _nextKId) _nextKId = +m[1] + 1;
    }
  }
}
