// ai.js - 居民大脑接口：LLM 决策 / 厚容错 JSON 解析 / 神谕注入（渲染层与 selftest 共用，环境无关部分在此）
import { fmtClock, PLAN_KINDS, GATHER_OBJS } from './core.js';
import { npcSnapshot, AI_ACTIONS_DOC } from './npc.js';
import { walkable, nearestObjAround, findObjInArea } from './world.js';
import { makeIntent, validateIntent, probPass } from './contract.js';
import { makeAction, dispatch, resolveTargets, OPEN_ACTIONS } from './action.js';
import { craftableRecipes } from './develop.js';

export const DEFAULT_AI_CFG = {
  mode: 'auto',            // auto:配置了API用LLM否则脚本 / script:纯脚本 / llm:强制LLM
  baseUrl: 'https://api.siliconflow.cn/v1',
  apiKey: '',
  model: 'Qwen/Qwen2.5-7B-Instruct',
  intervalH: 2,            // 每隔多少游戏小时征集一次决策
  temperature: 0.8,
  maxTokens: 1600,
  timeoutSec: 60,
  // —— 第一层：NPC 模型池（聚合网关，不同 NPC 绑不同模型——声音自然分化）——
  npcPool: {
    enabled: false,                     // 默认关：单模型路径（v2.5 行为）
    strategy: 'byPersonality',          // 性格向量做分配键
    providers: []                       // [{baseUrl, apiKey, models:['m1','m2']}] 每家一个 OpenAI 兼容端点
  },
  // —— 第二层：演化引擎独占的脑（不与 NPC 池共享额度）——
  evolutionModel: {
    enabled: false,                     // 未就绪自动回退上面的单模型路径
    baseUrl: '', apiKey: '', model: '', // 首选 gemini-2.5-flash（AI Studio 免费层 1M 上下文）
    backup: []                          // [{baseUrl, apiKey, model}] 如 glm-4.7-flash / qwen3-235b
  },
  // —— 第三层：本地兜底（全部端点挂掉时最后一步）——
  localFallback: { baseUrl: 'http://localhost:11434/v1', model: 'qwen3.8:27b' }
};

// ---------- 厚容错 JSON 提取 ----------
// 经验教训沉淀：剥围栏/思考块 → 扫描每个 { [ 起点括号配平 → 多候选 → 修尾逗号/字符串内裸换行/中文标点/单引号 → 截断守卫
export function extractJsonLoose(text, validator) {
  if (!text) return null;
  let t = String(text);
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<\|?thinking\|?>[\s\S]*?(<\|?\/thinking\|?>|$)/gi, '');
  t = t.replace(/```(?:json)?/gi, '');
  t = t.replace(/<RichMediaReference>[\s\S]*?<\/RichMediaReference>/gi, '');

  // 单遍扫描：记录字符串外的 { [ 起点
  const starts = [];
  {
    let inStr = false, esc = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{' || c === '[') starts.push(i);
    }
  }
  if (!starts.length) return null;

  const candidates = [];
  for (const s of starts) {
    const balanced = balanceEnd(t, s);
    if (balanced >= 0) candidates.push(t.slice(s, balanced + 1));
    // 截断守卫：配平到末尾未闭合的候选不要（绝不捞残片伪装成功）
  }
  let firstParsed = null;
  for (const c of candidates) {
    const parsed = tryParse(c);
    if (!parsed) continue;
    if (validator) {
      if (validator(parsed)) return parsed;
      if (firstParsed === null) firstParsed = parsed;
      continue;
    }
    return parsed;
  }
  return firstParsed;
}
function balanceEnd(t, s) {
  const open = t[s];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    else if (c === '{' || c === '[') depth++;  // 交叉嵌套容错
    else if (c === '}' || c === ']') depth--;
  }
  return -1;
}
function tryParse(s) {
  const variants = [s, repairJson(s), repairJson2(repairJson(s))];
  for (const v of variants) {
    try { return JSON.parse(v); } catch (e) { /* 下一个 */ }
  }
  return null;
}
// 修一层：字符串外中文标点、弯引号、尾逗号、单引号键值
function repairJson(s) {
  let out = '';
  let inStr = false, strCh = '', esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (strCh === '"' && c === '"') { inStr = false; out += c; continue; }
      if (strCh === '"' && (c === '\u201c' || c === '\u201d')) { out += '\\"'; continue; } // 字符串内弯引号是内容
      if (strCh === "'" && c === "'") { inStr = false; out += '"'; continue; }            // 单引号闭合
      if (strCh === "'" && c === '"') { out += '\\"'; continue; }
      out += c; continue;
    }
    // 字符串外
    if (c === "'" || c === '\u201c' || c === '\u201d') { inStr = true; strCh = c; out += '"'; continue; }
    if (c === '\uff1a') { out += ':'; continue; }   // ：
    if (c === '\uff0c') { out += ','; continue; }   // ，
    if (c === '\uff5c') { out += '|'; continue; }
    out += c;
  }
  return out;
}
// 修二层：尾逗号、字符串内裸换行、空逗号
function repairJson2(s) {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === '"') { inStr = false; out += c; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\t') { out += ' '; continue; }
      out += c; continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      // 前视：逗号后紧跟闭括号 → 丢弃；连续逗号 → 保留一个
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length || s[j] === '}' || s[j] === ']') continue;
      if (s[j] === ',') continue;
    }
    out += c;
  }
  return out;
}

// ---------- 模型池（三层分工：NPC 池 / 演化独占 / 本地兜底） ----------
// 确定性字符串哈希（FNV-1a 32位）——零随机，同键必同槽，可 seed 复现
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// providers 折叠成扁平端点列表 [{baseUrl, apiKey, model}]
export function poolEntries(cfg) {
  const out = [];
  for (const p of (cfg && cfg.npcPool && cfg.npcPool.providers) || []) {
    if (!p || !p.baseUrl || !Array.isArray(p.models)) continue;
    for (const m of p.models) {
      if (m) out.push({ baseUrl: String(p.baseUrl).replace(/\/+$/, ''), apiKey: p.apiKey || '', model: String(m) });
    }
  }
  return out;
}

function localEntry(cfg) {
  const lf = cfg && cfg.localFallback;
  return lf && lf.baseUrl && lf.model
    ? { baseUrl: String(lf.baseUrl).replace(/\/+$/, ''), apiKey: lf.apiKey || '', model: lf.model }
    : null;
}

// byPersonality 分配：traits+pers+id 做哈希键（性格差异大→模型易分散；id 参与防全同塌缩）
export function assignModel(entries, npc) {
  if (!entries.length) return '';
  const key = (npc.traits || []).join('|') + '|' + (npc.pers || '') + '|' + npc.id;
  return entries[hashStr(key) % entries.length].model;
}

// 惰性补齐全镇分配：新 NPC / 读档后池变了 / 分配不在池内 → 重算（池关闭不动）
export function assignModels(game) {
  const cfg = game.aiCfg;
  const entries = poolEntries(cfg);
  if (!(cfg.npcPool && cfg.npcPool.enabled) || !entries.length) return 0;
  const names = new Set(entries.map(e => e.model));
  let n = 0;
  for (const npc of game.npcs) {
    if (!npc.aiModelId || !names.has(npc.aiModelId)) {
      npc.aiModelId = assignModel(entries, npc);
      n++;
    }
  }
  return n;
}

// 演化引擎独占就绪？（未就绪回退旧单模型路径）
export function evolutionReady(cfg) {
  const em = cfg && cfg.evolutionModel;
  return !!(em && em.enabled && em.baseUrl && em.model);
}

// 演化链：主 → backup → 本地兜底（不含 NPC 池——演化不共享 NPC 额度）
export function evoEntries(cfg) {
  if (!evolutionReady(cfg)) return [];
  const em = cfg.evolutionModel;
  const out = [{ baseUrl: String(em.baseUrl).replace(/\/+$/, ''), apiKey: em.apiKey || '', model: em.model }];
  for (const b of em.backup || []) {
    if (b && b.baseUrl && b.model) out.push({ baseUrl: String(b.baseUrl).replace(/\/+$/, ''), apiKey: b.apiKey || '', model: b.model });
  }
  const lf = localEntry(cfg);
  if (lf) out.push(lf);
  return out;
}

// 某个模型名在池内的端点（重名取第一个；找不到返回 null）
function entryOfModel(entries, model) {
  return entries.find(e => e.model === model) || null;
}

// 故障链：逐级尝试，每级独立超时；全挂才抛。返回 {text, via, tried:[{model, err}]}
export async function callChain(entries, cfg, sys, user) {
  const tried = [];
  for (const e of entries) {
    try {
      const text = await callLLM({ ...cfg, baseUrl: e.baseUrl, apiKey: e.apiKey, model: e.model }, sys, user);
      return { text, via: e.model, tried };
    } catch (err) {
      tried.push({ model: e.model, err: String(err && err.message).slice(0, 120) });
    }
  }
  const err = new Error('故障链全挂：' + tried.map(t => t.model).join(',') + ' / ' + (tried[tried.length - 1] ? tried[tried.length - 1].err : ''));
  err.tried = tried;
  throw err;
}

// 降级诊断（game 层调用）：留最近 20 条，不随档走
export function logChain(game, purpose, via, tried) {
  game.aiChainLog = game.aiChainLog || [];
  game.aiChainLog.push({ t: Date.now(), purpose, via: via || null, failed: tried || [] });
  while (game.aiChainLog.length > 20) game.aiChainLog.shift();
}

// ---------- Prompt 构建 ----------
export function buildPrompt(snapshots, ctxInfo) {
  const sys = [
    '你是像素小镇「雾溪镇」的居民之魂。小镇里有若干居民，每个人的性格、需求、身体、关系、近期记忆由快照给出。',
    '你的任务：为快照中的每一位居民决定接下来几个小时的行动。要求：',
    '1. 行为要符合人物性格与当前状态（饿了吃饭、冷了回屋、困了打盹、心情差找人倾诉；身体有旧伤的人动作会慢些）。',
    '2. 小镇的大部分时候什么都不发生：居民只是在生活，不是每时每刻都有事做。允许安排存在本身：发呆、看天、打瞌睡、串门、集市闲逛、河边枯坐、追忆往事。',
    '3. 小镇由居民共同营造：可以派人参与工地施工（build），也可以派人去镇郊开拓探索（scout）。',
    '4. say 字段是居民当下说的一句话，要口语化、有生活气，不超过20字。',
    '5. reason 字段必填：每个决定都要有一句可理解的动机（这是他为什么这么做的唯一线索）。',
    '6. 严格输出 JSON，不要任何解释文字。格式：',
    '{"decisions":[{"npc":"居民名","action":"动作","target":"对象(可空)","say":"台词(可空)","reason":"一句话动机(必填)"}]}',
    'action 写法（是格式，不是清单）：',
    AI_ACTIONS_DOC
  ].join('\n');
  const user = [
    `【小镇现状】${ctxInfo}`,
    '【居民快照】',
    JSON.stringify(snapshots, null, 1)
  ].join('\n');
  return { sys, user };
}

export function ctxInfoText(clock, weather, game) {
  const phase = clock.isNight() ? '夜' : '昼';
  const extra = [];
  if (game.festivalUntilMin > 0) extra.push('今晚有庙会');
  if (game.droughtDays > 0) extra.push('大旱中');
  if (game.boars.length) extra.push('农田有野猪出没');
  // 气候层（v4.4）：让居民之魂看得见气候周期——湿润期/干旱期/极端天气
  // 不是硬编码"雨天不出门"，是让 AI 看到气候事实，自己决定 NPC 怎么反应
  if (game.climateState) {
    const cs = game.climateState;
    if (cs.phase === 'wet') extra.push('正值湿润期');
    else if (cs.phase === 'dry') extra.push('正值干旱期');
    if (cs.extremeEvent) extra.push(`近期极端天气：${cs.extremeEvent === 'DROUGHT' ? '大旱' : cs.extremeEvent === 'FLOOD' ? '大涝' : '寒潮'}`);
  }
  const plans = (game.plans || []).filter(p => !p.done);
  if (plans.length) {
    extra.push('营造中：' + plans.map(p => {
      const lack = p.needMat ? Object.entries(p.needMat).some(([r, n]) => (p.delivered[r] || 0) < n) : false;
      return `${p.name}@(${p.x},${p.y})${p.builder ? '' : '（待认领）'}${lack ? '（缺料）' : ''}`;
    }).join('、'));
  } else {
    extra.push('镇上暂无营造计划（居民可提议新建：木匠坊/仓库/小屋/储物棚/长凳/路灯/货摊/开垦）');
  }
  if (game.stock) extra.push(`镇库木材${Math.floor(game.stock.wood)}、石料${Math.floor(game.stock.stone)}`);
  // 物质层：让居民之魂看得见材料链的现状
  if (game.workshop) extra.push(`木匠坊存原木${game.workshop.logs}根`);
  if (game.frontier) extra.push(`镇郊（${game.frontier.x},${game.frontier.y}）有一块无主好地，可以去那盖屋`);
  if (game.colony) extra.push(`镇子的殖民地已有${game.colony.houses.length}间屋`);
  // 世界层：让居民之魂看得见镇上的活物
  if (game.animals) {
    const alive = game.animals.filter(a => a.alive);
    if (alive.length) extra.push(`镇上养着${alive.length}头（只）牲畜家禽${alive.some(a => a.kind === 'wolf') ? '，镇郊有狼出没' : ''}`);
  }
  // 演化层：让居民之魂看得见手艺与灾难
  if (game.recipes) {
    const defs = game.recipeDefs || {};
    const nameOf = (id) => (defs[id] && defs[id].name) || ({ plank: '锯木', mill: '磨面', forge: '锻铁', stew: '炖汤', fishnet: '织网' })[id] || id;
    const grown = Object.values(game.recipes).filter(r => r.mult > 1.0 && r.knownBy.size > 0);
    if (grown.length) extra.push(`手艺有长进：${grown.map(r => `${nameOf(r.id)}${Math.round(r.mult * 100)}%`).join('、')}`);
    const lost = Object.values(game.recipes).filter(r => r.lost && r.knownBy.size === 0);
    if (lost.length) extra.push(`有手艺失传了，得有人重新琢磨`);
  }
  // 发现层（v4.2 天道退役）：让居民之魂看得见镇上最近长出的新技能
  // 不是硬编码"学到X就去做X"，是让 AI 看到镇上有了新发现，自己决定要不要用、要不要传
  if (game.discoveries && game.discoveries.length) {
    const recent = game.discoveries.slice(-3);
    const desc = recent.map(d => {
      const t = (d.targetNames && d.targetNames.length) ? d.targetNames.join('和') : '东西';
      return `${d.verb}${t}`;
    }).join('、');
    if (desc) extra.push(`镇上最近琢磨出了：${desc}`);
  }
  // v4.4.1 接线2：聚落 → 上下文——让 AI 看见镇子（们）的规模与存亡
  // 聚落是自变的结果（人聚集形成聚落，聚落废弃是人散了），AI 看见才能回应
  if (Array.isArray(game.settlements) && game.settlements.length) {
    const sDesc = game.settlements.slice(0, 4).map(s => {
      if (s.abandoned) return `${s.name}已废弃`;
      const pop = s.population || (s.npcIds || []).length;
      const res = s.resources ? Object.entries(s.resources).map(([j, c]) => `${j}${c}`).join('') : '';
      return `${s.name}${pop}人${res ? '（' + res + '）' : ''}`;
    });
    extra.push(sDesc.join('，'));
  }
  if (game.plague && !game.plague.over) extra.push(`时疫正在镇上蔓延（已病${game.plague.sick.length}人）`);
  if (game.fire) extra.push(`镇上走了水，火还没熄`);
  return `${clock.label()}（${phase}），天气${weather.label}${extra.length ? '，' + extra.join('，') : ''}`;
}

// ---------- LLM 调用 ----------
export async function callLLM(cfg, sys, user) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (cfg.timeoutSec || 60) * 1000);
  try {
    const base = (cfg.baseUrl || '').replace(/\/+$/, '');
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (cfg.apiKey || '')
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature ?? 0.8,
        max_tokens: cfg.maxTokens || 1600,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ]
      })
    });
    if (!r.ok) {
      const bodyText = await r.text().catch(() => '');
      const err = new Error(`HTTP ${r.status} ${bodyText.slice(0, 200)}`);
      err.status = r.status;
      throw err;
    }
    const data = await r.json();
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    return (msg && (msg.content || msg.reasoning_content)) || '';
  } finally {
    clearTimeout(timer);
  }
}

// 完整决策流程：构建 → 调用 → 解析 → 校验
export async function requestDecisions(cfg, snapshots, ctxInfo) {
  const { sys, user } = buildPrompt(snapshots, ctxInfo);
  const raw = await callLLM(cfg, sys, user);
  const hasDecisions = (p) => p && (Array.isArray(p.decisions) || Array.isArray(p));
  const parsed = extractJsonLoose(raw, hasDecisions);
  if (!parsed) {
    const err = new Error('模型返回无法解析为 JSON：' + String(raw).slice(0, 200));
    err.raw = raw;
    throw err;
  }
  const list = Array.isArray(parsed) ? parsed : parsed.decisions;
  if (!Array.isArray(list)) throw new Error('返回 JSON 缺少 decisions 数组：' + String(raw).slice(0, 200));
  return { clean: cleanDecisions(list), raw };
}

// 模型池分组决策：每组（同 aiModelId 的快照子集）独立调用——不同模型对同一份性格快照给出不同的处世味道。
// 组内独立失败不拖垮全镇：单组挂→逐个试池内其他端点→本地兜底→该组空手而归（本能接管）。
// 返回 {clean, via:用过的模型列表, tried:全部失败尝试}
export async function requestDecisionsPooled(cfg, groups, ctxInfo) {
  const entries = poolEntries(cfg);
  const lf = localEntry(cfg);
  const results = await Promise.all(groups.map(async (grp) => {
    // 本组优先自己的模型，失败后故障转移到池内其他端点，最后本地兜底
    const own = entryOfModel(entries, grp.model);
    const chain = (own ? [own] : []).concat(entries.filter(e => e !== own)).concat(lf ? [lf] : []);
    try {
      const { sys, user } = buildPrompt(grp.snaps, ctxInfo);
      const { text, via, tried } = await callChain(chain, cfg, sys, user);
      const hasDecisions = (p) => p && (Array.isArray(p.decisions) || Array.isArray(p));
      const parsed = extractJsonLoose(text, hasDecisions);
      const list = parsed ? (Array.isArray(parsed) ? parsed : parsed.decisions) : null;
      if (!Array.isArray(list)) throw new Error('返回 JSON 缺少 decisions 数组');
      return { clean: cleanDecisions(list), via, tried };
    } catch (err) {
      return { clean: [], via: null, tried: (err && err.tried) || [{ model: grp.model, err: String(err && err.message).slice(0, 120) }] };
    }
  }));
  const clean = [];
  const via = [], tried = [];
  for (const r of results) {
    for (const d of r.clean) clean.push(d);
    if (r.via) via.push(r.via);
    for (const t of r.tried) tried.push(t);
  }
  return { clean, via, tried };
}

function cleanDecisions(list) {
  const clean = [];
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const npc = String(d.npc || d.name || '').trim();
    const action = String(d.action || '').trim().toLowerCase();
    if (!npc || !action) continue;
    clean.push({
      npc, action,
      target: d.target != null ? String(d.target).trim() : '',
      say: d.say != null ? String(d.say).slice(0, 40) : '',
      reason: d.reason != null ? String(d.reason).slice(0, 30) : ''
    });
  }
  return clean;
}

// ---------- 决策落地（数据契约闸：AI 只能提议，系统负责裁决） ----------
// 返回 {applied, skipped, fellBack}
export function applyDecisions(game, decisions) {
  const { npcs, world: w, rng, clock, log, weather } = game;
  let applied = 0, skipped = 0, fellBack = 0;
  for (const d of decisions) {
    const npc = npcs.find(n => n.name === d.npc || n.id === d.npc);
    if (!npc) { skipped++; continue; }
    if (npc.inside && npc.intent.type === 'sleep' && !['say'].includes(d.action)) { skipped++; continue; }  // 睡觉的不吵醒
    // —— 契约：洗成意图对象 → 校验 → 合法入队 / 条件跳过 / 降级翻译 ——
    const intent = makeIntent({
      type: d.action, target: d.target, say: d.say, reason: d.reason, source: 'llm',
      cond: d.cond, prob: d.prob
    }, { nowMin: clock.totalDay * 1440 + clock.min });
    const v = validateIntent(intent, {
      npc, w,
      raining: weather.raining, snowing: weather.snowing, stormy: weather.stormy,
      isNight: clock.isNight(),
      hungry: npc.needs.hunger > 65, tired: npc.needs.energy < 30,
      walkableAll: (x, y) => walkable(w, x, y)
    });
    if (v.verdict === 'skip') { skipped++; continue; }   // 条件字段不满足：合法但不生效
    const it = v.intent;
    if (v.verdict === 'fallback') {
      fellBack++;
      // 演化引擎 repeat 缺口信号：同一类意图反复被降级，说明世界缺一个正式方案
      game.fallbackStats = game.fallbackStats || {};
      game.fallbackStats[d.action] = (game.fallbackStats[d.action] || 0) + 1;
      npc.memory(it.reason, clock.totalDay, clock.hour);
      if (log) log(`[契约] ${npc.name}的「${d.action}」被降级为「${it.type}」（${v.why}）`, 'warn');
    }
    // 概率字段：不一定成功
    if (!probPass(it, rng)) { skipped++; continue; }

    let ok = false;
    switch (it.type) {
      case 'work': {
        // 产出革命（v2.9.0）：LLM 说"去干活"——有手艺先手艺（选址与脚本同一套规则），没手艺找采集对象，全落空就地
        if (it.params.tx != null) {
          ok = npc.setGoto(w, Math.floor(it.params.tx), Math.floor(it.params.ty), { type: 'work', dur: 150 }, it.reason || '去干活');
          if (ok) break;
        }
        const craftable = craftableRecipes(game, npc);
        if (craftable.length) {
          const def = (game.recipeDefs || {})[craftable[0]];
          if (def) {
            const then = { type: 'work', dur: 150, craft: craftable[0] };
            const site = game.craftSiteFor(npc, def);
            if (site) ok = npc.setGoto(w, site.x, site.y, then, it.reason || '去做' + def.name + '的活计');
            if (!ok) { npc.setIntent('work', '干活', 150, it.reason || '就地' + def.name, 'llm'); npc.intent.craft = craftable[0]; ok = true; }
            break;
          }
        }
        // 没手艺：附近找采集对象（人人可干的体能活——树/矿/浆果/熟庄稼）
        const t = nearestObjAround(w, Math.floor(npc.x), Math.floor(npc.y), GATHER_OBJS, 18)
          || findObjInArea(w, 'forest', GATHER_OBJS, rng)
          || findObjInArea(w, 'mine', GATHER_OBJS, rng)
          || findObjInArea(w, 'farm', GATHER_OBJS, rng);
        if (t) ok = npc.setGoto(w, t.x, t.y, { type: 'work', dur: 150 }, it.reason || '去找点活计');
        if (!ok) { npc.setIntent('work', '就地干活', 120, it.reason || '就在这儿干点活', 'llm'); ok = true; }
        break;
      }
      case 'goto': {
        // 降级翻译出的具体坐标直接走；人名/地名目标走原有寻路
        if (it.params.tx != null && it.params.ty != null) {
          ok = npc.setGoto(w, Math.floor(it.params.tx), Math.floor(it.params.ty), null, it.reason || '过去看看');
          break;
        }
        const area = w.areas.find(a => a.name === it.params.target || a.id === it.params.target);
        if (area) ok = npc.setGotoArea(w, area.id, rng, null, '前往' + area.name);
        else if (it.params.target) {
          const other = npcs.find(n => n.name === it.params.target && !n.inside);
          if (other) ok = npc.setGoto(w, Math.floor(other.x), Math.floor(other.y), null, '去找' + other.name);
        }
        if (!ok) { npc.setIntent('idle', '想去' + (it.params.target || '某处') + '没去成', 40, it.reason, 'llm'); ok = true; }
        break;
      }
      case 'chat': {
        const other = npcs.find(n => n.name === it.params.target && !n.inside);
        if (other) {
          ok = npc.setGoto(w, Math.floor(other.x), Math.floor(other.y), { type: 'chat', with: other.id, dur: 45 }, '找' + other.name + '聊天');
        }
        if (!ok) { npc.setIntent('idle', '想找人聊天', 30, it.reason, 'llm'); ok = true; }
        break;
      }
      case 'eat':
        ok = npc.applyScriptDecision(w, rng, { action: 'eat', why: it.reason }, npcs, game);
        break;
      case 'sleep':
        ok = npc.applyScriptDecision(w, rng, { action: 'sleep', why: it.reason }, npcs, game);
        break;
      case 'idle':
        npc.setIntent('idle', it.reason || '闲着', 60, it.reason, 'llm');
        if (it.params.target) npc.intent.sub = '发呆';
        ok = true;
        break;
      case 'build': {
        // target 匹配已有计划 → 认领；匹配营造类型但无计划 → 立项新建；都没有 → 接手任意计划
        const t = it.params.target || '';
        const plans = game.plans || [];
        let plan = t ? plans.find(p => !p.done && (p.name === t || p.name.includes(t) || t.includes(p.name))) : null;
        if (!plan && t) {
          const kindKey = Object.keys(PLAN_KINDS).find(k =>
            PLAN_KINDS[k].name === t || (PLAN_KINDS[k].alias || []).some(a => t.includes(a) || a.includes(t)));
          if (kindKey) plan = game.addPlan(kindKey, null, null, npc.name, { x: Math.floor(npc.x), y: Math.floor(npc.y) });
        }
        if (!plan) plan = plans.find(p => !p.done && !p.builder) || plans.find(p => !p.done);
        if (plan && game.claimPlan(npc, plan)) ok = true;
        else { npc.setIntent('idle', '想去帮工没找着工地', 30, it.reason, 'llm'); ok = true; }
        break;
      }
      case 'scout':
        ok = npc.applyScriptDecision(w, rng, { action: 'scout', why: it.reason }, npcs, game);
        if (!ok) { npc.setIntent('idle', '没出成镇', 25, it.reason, 'llm'); ok = true; }
        break;
      case 'chop':
        ok = npc.setGotoArea(w, 'forest', rng, { type: 'work', dur: 150 }, '去伐木');
        if (!ok) { npc.setIntent('work', '就地伐木', 100, it.reason, 'llm'); ok = true; }
        break;
      case 'mine':
        ok = npc.setGotoArea(w, 'mine', rng, { type: 'work', dur: 150 }, '去采矿');
        if (!ok) { npc.setIntent('work', '就地采矿', 100, it.reason, 'llm'); ok = true; }
        break;
      case 'haul': case 'repair': {
        // 物质层：AI 提议去搬/修，具体搬哪修哪由镇上的活儿说了算（数据契约闸：AI 只能提议，系统负责裁决）
        const dec = game.haulJob && game.haulJob(npc);
        if (dec && (dec.action === 'haul' || dec.action === 'repair')) {
          ok = npc.applyScriptDecision(w, rng, dec, npcs, game);
        }
        if (!ok) { npc.setIntent('idle', '眼下没搬运的活儿', 30, it.reason, 'llm'); ok = true; }
        break;
      }
      case 'mill': {
        const dec = game.millJob && game.millJob(npc);
        if (dec && dec.action === 'mill') ok = npc.applyScriptDecision(w, rng, dec, npcs, game);
        if (!ok) { npc.setIntent('idle', '坊里眼下没原木可锯', 30, it.reason, 'llm'); ok = true; }
        break;
      }
      case 'say':
        ok = true;
        break;
      default: {
        // 开放动作（v4.1）：清单外的动词不降级。目标能解析成物质就走物理裁决；
        // 没见过的名词落地为「未审之物」（中性属性入册）——说出来的词就是世界的尘埃。
        if (!OPEN_ACTIONS.enabled) { skipped++; continue; }   // 回滚保险：关掉时回到「到不了这里」
        const targets = resolveTargets(it.params.target != null ? [it.params.target] : [], npc, game);
        const verdict = dispatch(makeAction(npc, it.type, targets, { reason: it.reason }), game);
        if (verdict.legal) {
          // 动作落地：占一段时间，标签就是动词本身——世界还没给这个动词编过舞
          npc.setIntent('idle', it.type, 30, it.reason, 'llm');
          ok = true;
        }
        break;
      }
    }
    if (ok) {
      applied++;
      npc._dayIntents++;
      if (it.say) { npc.say(it.say, game.nowReal); npc.memory(`说了：「${it.say}」`, clock.totalDay, clock.hour); }
      if (it.reason && v.verdict !== 'fallback' && it.type !== 'say') npc.memory(it.reason, clock.totalDay, clock.hour);
    } else skipped++;
  }
  if (log && applied) log(`居民之魂更新了 ${applied} 位居民的意图`, 'hl');
  return { applied, skipped, fellBack };
}

// ---------- 神谕（上帝低语） ----------
export function whisper(npc, text, game) {
  const { clock, log } = game;
  npc.memory('（神谕）' + text, clock.totalDay, clock.hour);
  npc.moodDelta(2);
  npc.say('……我似乎听到了什么', game.nowReal);
  if (log) log(`神谕低语传入${npc.name}心中`, 'hl');
}
export function decree(text, game) {
  const { npcs, clock, log } = game;
  for (const n of npcs) n.memory('（神谕）' + text, clock.totalDay, clock.hour);
  if (log) log(`神谕响彻小镇上空：「${text}」`, 'hl');
  void clock;
  void fmtClock;
}

// ---------- 演化之灵退役（v4.8.0）----------
// 曾经有一个"演化提案"prompt：LLM 扮演演化之灵，在 8 种类型里挑一种造新东西——那是白名单思维。
// 现在演化唯一管道是观念池（idea.js）：念头在居民脑子里自生自灭，结晶成规矩，没有任何类型发生器。
