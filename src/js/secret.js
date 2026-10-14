// secret.js - 秘密与表演 / 核心矛盾（计划书第三章·八、九）
// 秘密的四个状态：
//   1. 藏起来不让别人知道        → secret.knownBy 为空
//   2. 不让自己知道（自我欺骗）  → secret.selfDeceived（行为暴露：路过那个人家门前放慢脚步）
//   3. 不知道别人知道            → knownBy[id]=1（说漏/传闻，持有者不知情）
//   4. 不知道别人知道他知道      → knownBy[id]=2（话里带话被本人察觉）
// 铁律（第四章·七）：秘密层永不进 prompt——本模块数据只通过行为与气泡间接显形，npcSnapshot 只放心结。
// 矛盾不解决：lean 振荡钳在 0.15..0.85，永不收敛（第三章·九）。
import { mulberry32, choice, clamp, chance } from './core.js';
import { hashStr, makeVoice } from './language.js';
import { tintRecall } from './memory.js';
import { pickLex, lexSlot, SEED_LEXICON } from './lexicon.js';

// 语言革命（v3.1.0）：矛盾模板/常见心事/脱口抵赖全部进词库（conflict/secretGen/deny/slyHint 槽）——
// 本层只剩秘密机制，一句话都不拥有。矛盾的种类（CONFLICT_KEYS）是物理，措辞是词库内容。

// 职业底细（开局按职业配一桩，日推进再攒）——③职业残留，暂留
const SECRET_TEMPLATES = {
  '农夫': [{ content: '去年欠了粮行的账，一直没还清', kw: ['账', '欠'] }],
  '铁匠': [{ content: '学艺那年偷拿过师父一块铁料', kw: ['师父', '手艺', '偷'] }],
  '樵夫': [{ content: '前年那场山火，起火处是自己丢的烟头', kw: ['山火', '林子'] }],
  '渔夫': [{ content: '偷偷攒了一小袋铜钱，想哪天离开镇子', kw: ['离开', '攒钱', '铜钱'] }],
  '商人': [{ content: '账本上抹过两笔假账', kw: ['账'] }],
  '厨子': [{ content: '招牌汤的方子是偷学别家的', kw: ['汤', '方子'] }],
  '医生': [{ content: '行医早年误诊过一个人，从没跟人提过', kw: ['误诊', '行医', '当年'] }],
  '学生': [{ content: '从爹藏钱的匣子里拿过几枚铜板买糖', kw: ['钱', '铜板'] }],
  '诗人': [{ content: '最得意的那首诗，是抄了故人的残稿', kw: ['诗', '稿'] }]
};

function sLog(n, t) {
  n.mind.secretLog.push(t);
  if (n.mind.secretLog.length > 12) n.mind.secretLog.shift();
}

// ---------- 心智 ----------
// 秘密开局为空（底细随日子长出来）；矛盾 1-3 个（从当下词库的 conflict 槽抓——每个世界的心结措辞各长各的）；语言身份随人定
// lex：game.lexicon（缺省落种子表，纯函数兼容）
export function makeMind(def, lex) {
  const rng = mulberry32(hashStr(def.id + '|mind'));
  const pool = (lex && lex.conflict && lex.conflict.length) ? lex.conflict : SEED_LEXICON.conflict;
  const conflicts = pickUnique(rng, pool, 1 + Math.floor(rng() * 3)).map(t => ({
    key: t.key, a: t.a, b: t.b,
    lean: 0.5 + (rng() - 0.5) * 0.2,
    phase: rng() * 100
  }));
  return {
    secrets: [],      // 我藏着的
    known: [],        // 我知道别人的（传闻也在这）
    conflicts,        // 核心矛盾：永久存在，不解决
    secretLog: [],    // 私密自白——永不进快照/prompt
    crushId: null,
    fakingSick: false,
    voice: makeVoice(def, lex)
  };
}
function pickUnique(rng, pool, n) {
  const arr = [...pool]; const out = [];
  for (let i = 0; i < n && arr.length; i++) out.push(arr.splice(Math.floor(rng() * arr.length) % arr.length, 1)[0]);
  return out;
}

// v4.5.0 性别层：取向决定吸引方向——不是标签，是求偶/暗恋/婚配共用的物理
export function attractedTo(n, sex) {
  return n.orient === 'homo' ? sex === n.sex : sex !== n.sex;
}

// 开局自欺：约三成的成年人，心里住着一个不会承认的名字（npc.js 传入名册候选）
export function attachCrush(n, cands) {
  const rng = mulberry32(hashStr(n.id + '|crush'));
  const age = n.body ? n.body.ageYears : 30;
  if (age < 18 || age > 60 || !chance(rng, 0.3)) return;
  const pool = cands.filter(o => attractedTo(n, o.sex) && o.age >= 18 && o.age <= 55 && Math.abs(o.age - age) <= 20);
  if (!pool.length) return;
  const t = pool[Math.floor(rng() * pool.length) % pool.length];
  n.mind.crushId = t.id;
  n.mind.secrets.push({
    content: `嘴上说不在乎${t.name}，其实路过${t.sex === '女' ? '她' : '他'}家门口都会放慢脚步`,
    kw: ['说亲', '婚事', '喜欢', '心上人'],
    selfDeceived: true, knownBy: {}, leakRisk: 0.1, pressure: 0, day: 0
  });
}

// 新秘密：职业底细优先（③残留），攒够就从当下词库的 secretGen 槽泛化
export function newSecret(n, rng, day, game) {
  const gen = game ? lexSlot(game, 'secretGen') : SEED_LEXICON.secretGen;
  const pool = [...(SECRET_TEMPLATES[n.job] || []), ...gen]
    .filter(t => !n.mind.secrets.some(s => s.content === t.content));
  if (!pool.length) return null;
  const t = choice(rng, pool);
  return {
    content: t.content, kw: [...t.kw],
    selfDeceived: chance(rng, 0.18),
    knownBy: {}, leakRisk: 0.10 + rng() * 0.12, pressure: 0, day
  };
}

// 认知层日推进：矛盾摆动 / 新秘密 / 装病（表演）。返回对外可见的事件文案（真话不在这里）
export function mindDailyTick(n, rng, day, game) {
  const mind = n.mind;
  if (!mind) return [];
  const evts = [];
  // 1) 矛盾摆动：外扰 + 内在节律，钳在 0.15..0.85——永不收敛（第三章·九）
  for (const c of mind.conflicts) {
    c.lean += (rng() - 0.5) * 0.26 + Math.sin((day + c.phase) * 0.7) * 0.10;
    c.lean = clamp(c.lean, 0.15, 0.85);
  }
  // 2) 新秘密：日子久了，谁心里都会多一件事
  if (chance(rng, 0.08)) {
    const s = newSecret(n, rng, day, game);
    if (s) { mind.secrets.push(s); evts.push('心里藏进了一桩新事'); }
  }
  // 3) 装病（表演）：心情差时小概率装一天病——真话只进私密自白，对外只说"病了"
  if (n.needs.mood < 30 && chance(rng, 0.15)) {
    mind.fakingSick = true;
    sLog(n, `d${day} 其实没病，就是不想见人`);
    n.memory('身上不大爽利，想歇一天', day, 6);
    evts.push('说自己病了，闭门不出');
  } else {
    mind.fakingSick = false;
  }
  return evts;
}

// 事件扰动矛盾的天平（moodDelta 钩子）：大事让某一面压过去，但天平永远摆回来
export function perturbConflicts(mind, moodN) {
  if (!mind || !mind.conflicts) return;
  for (const c of mind.conflicts) c.lean = clamp(c.lean + clamp(moodN, -8, 8) * 0.015, 0.15, 0.85);
}

// 主导矛盾：离天平中心最远的那个
export function dominantConflict(mind) {
  if (!mind || !mind.conflicts.length) return null;
  return mind.conflicts.reduce((m, v) => (Math.abs(v.lean - 0.5) > Math.abs(m.lean - 0.5) ? v : m));
}

// ---------- 聊天钩子（npc.tryPairChat 调用） ----------
// 话题戳到秘密
export function probeSecret(n, topic) {
  const mind = n.mind;
  if (!mind) return null;
  return mind.secrets.find(s => (s.kw || []).some(k => topic.includes(k))) || null;
}

// 撒谎：压力抬升泄漏风险；自欺者真信那句谎——嘴硬，但不记账
export function tellLie(a, s, b, clock) {
  if (s.selfDeceived) return;
  s.pressure = (s.pressure || 0) + 1;
  s.leakRisk = clamp(0.12 + s.pressure * 0.09 + ((a.relations[b.id] || 0) < 0 ? 0.1 : 0), 0, 0.9);
  a.memory(`我对${b.name}撒了个谎，心里不大踏实`, clock.totalDay, clock.hour);
  sLog(a, `d${clock.totalDay} 对${b.name}撒谎：${s.content}`);
}

// 说漏嘴：秘密漏给听者。自欺者也会漏——但他没有"说漏"的自觉（状态 3 的自然来源）
// hook：呈现层传闻网记录这第一手（gen=1 亲耳所闻，不变形）
export function leakTo(a, b, rng, clock, hook) {
  const mind = a.mind;
  if (!mind) return;
  const s = mind.secrets.find(v => !v.knownBy[b.id]);
  if (!s) return;
  const rel = a.relations[b.id] || 0;
  const p = s.selfDeceived ? 0.10 : (s.leakRisk || 0.15) * (rel > 30 ? 1.4 : 1) * (a.needs.mood > 60 ? 1.15 : 0.9);
  if (!chance(rng, p)) return;
  s.knownBy[b.id] = 1;
  // 涌现物理层·失真：记下泄漏者当时的情绪价态——复述时按"传话人心情 vs 原始价态"的落差染色
  b.mind.known.push({ about: a.id, name: a.name, content: s.content, kw: [...s.kw], level: 1, gen: 1, valence: Math.round((a.needs.mood - 50) * 2) });
  if (b.mind.known.length > 6) b.mind.known.shift();
  if (hook) hook({ from: a.id, to: b.id, about: a.id, content: s.content, gen: 1 });
  if (s.selfDeceived) return;
  a.moodDelta(-3, `把不该说的说漏了嘴（${b.name}知道了）`, clock.totalDay, clock.hour);
}

// 话里带话：知情者话题撞上持有者的秘密 → 有意无意地点一句 → 窗户纸捅破（状态 3→4）
export function slipHint(b, a, topic, ctx) {
  const mind = b.mind;
  if (!mind || !mind.known.length) return;
  const e = mind.known.find(v => v.about === a.id && (v.kw || []).some(k => topic.includes(k)));
  if (!e || !chance(ctx.rng, 0.35)) return;
  b.say(pickLex(ctx.game, 'slyHint', ctx.rng), ctx.nowReal, { anger: true });
  const s = a.mind && a.mind.secrets.find(v => v.content === e.content);
  if (s && s.knownBy[b.id] !== 2) {
    s.knownBy[b.id] = 2;
    a.perceive('hear', `${b.name}话里像是知道了什么`, ctx.clock.totalDay, ctx.clock.hour, -4);
    a.memory(`${b.name}恐怕知道了我的事`, ctx.clock.totalDay, ctx.clock.hour);
  }
}

// 传闲话：听来的事继续走（流言在镇子里自己长）
// 每过一手 gen+1；hook 返回听者真正听到的版本——传三代，话就走样了（第十章·二：口述传三代变形）
export function gossip(from, to, rng, clock, hook) {
  const mind = from.mind;
  if (!mind || !mind.known.length) return;
  const cands = mind.known.filter(e => e.about !== to.id && !to.mind.known.some(v => v.content === e.content));
  if (!cands.length || !chance(rng, 0.10)) return;
  const e = choice(rng, cands);
  const gen = (e.gen || 1) + 1;
  let txt = e.content;
  if (hook) txt = hook({ from: from.id, to: to.id, about: e.about, content: e.content, gen }) || txt;
  // 涌现物理层·失真：复述者什么心情，话就走什么味（与传闻网三代失真叠加，不替代）
  txt = tintRecall(txt, e.valence || 0, from.needs ? from.needs.mood : 50, rng);
  to.mind.known.push({ ...e, content: txt, gen, level: 1 });
  if (to.mind.known.length > 6) to.mind.known.shift();
  to.memory(`听${from.name}说了件${e.name}的事`, clock.totalDay, clock.hour);
}

// 自欺行为暴露：路过那个人家门前，脚步自己慢了下来，脸也转了过去（这个矛盾不该被修正）
export function crushGaze(n, npcs, clock) {
  const mind = n.mind;
  if (!mind || !mind.crushId) return false;
  const t = npcs.find(v => v.id === mind.crushId);
  if (!t || !t.home) return false;
  const dx = t.home.doorX - n.x, dy = t.home.doorY - n.y;
  if (Math.abs(dx) + Math.abs(dy) >= 4) return false;
  if (dx > 0.5) n.dir = 3; else if (dx < -0.5) n.dir = 2;
  else if (dy > 0.5) n.dir = 0; else if (dy < -0.5) n.dir = 1;
  if (clock && n._crushLogDay !== clock.totalDay) {
    n._crushLogDay = clock.totalDay;
    sLog(n, `d${clock.totalDay} 路过${t.name}家门口，又放慢了脚步`);
  }
  return true;
}
