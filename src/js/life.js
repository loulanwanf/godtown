// life.js - 生命层：生命周期/遗传/死亡/葬礼/传承（v1.5.0，计划书第三章·十、十一）
// 出生 → 婴儿 → 儿童 → 少年 → 成年 → 老年 → 死亡。
// 童年有童年的世界；老年不只是变慢——记忆在流失，时间感在错乱；
// 死亡有过程——病榻、告别、葬礼、谁来哭、遗物怎么分。
import { O, G, clamp, rint, chance, choice } from './core.js';
import { chunkHas, getGround, getObj, setObj } from './chunk.js';
import { markNote, chronNote } from './history.js';
import { pickLex } from './lexicon.js';
import { attractedTo } from './secret.js';
import { relOf } from './social.js';
import { injure } from './body.js';

// ---------- 生命周期阶段 ----------
export const STAGES = [
  { id: 'infant', name: '婴儿', max: 2 },
  { id: 'child', name: '儿童', max: 12 },
  { id: 'teen', name: '少年', max: 17 },
  { id: 'adult', name: '成年', max: 59 },
  { id: 'elder', name: '老年', max: 999 }
];
export function stageOf(age) {
  const a = age || 0;
  for (const s of STAGES) if (a <= s.max) return s;
  return STAGES[STAGES.length - 1];
}
export function isKid(n) {
  const id = stageOf(n.body.ageYears).id;
  return id === 'child' || id === 'teen';
}

// ---------- 遗传（第三章·十一：外貌从父母零件库随机组合；性格加权 + 扰动） ----------
// 语言革命（v3.1.0）：孩子名/心性从当下词库取（nameGiven/persChild 槽）——名字也是一个镇子一个样
// TRAIT_POOL 是性格名册（物理：性格词挂机制钩，封闭集合）——不是话术，不动
const MUT_HAIR = ['#3b2f2a', '#6b3b1f', '#c8c8c8', '#26201a', '#14181f'];
const MUT_SHIRT = ['#7a9e4f', '#c76b3a', '#4a7d8c', '#9c4f43', '#5f7d5a', '#757d8c'];
const TRAIT_POOL = ['好奇', '胆小', '爱哭', '倔', '黏人', '爱笑', '调皮', '安静', '早熟'];

// 生成孩子档案（不改世界，只出 def——由 game 层 new NPC 落地）
export function makeChildDef(father, mother, rng, seq, game) {
  const sex = rng() < 0.5 ? '男' : '女';
  const surname = (father ? father.name : mother.name)[0];
  const given = pickLex(game, 'nameGiven', rng);
  // 外貌：父母零件库随机组合 + 小概率突变（父已不在时，零件全随母亲——v4.5.0 父空守卫）
  const r1 = rng();
  const hair = r1 < 0.44 ? (father || mother).hair : r1 < 0.88 ? mother.hair : choice(rng, MUT_HAIR);
  const r2 = rng();
  const shirt = r2 < 0.46 ? (father || mother).shirt : r2 < 0.92 ? mother.shirt : choice(rng, MUT_SHIRT);
  // 性格：父母性状库抽取 + 扰动（突变 25% 换一个——孩子会长成大人想不到的样子）
  const inherit = [...((father && father.traits) || []), ...((mother && mother.traits) || [])];
  const t1 = inherit.length && rng() > 0.25 ? choice(rng, inherit) : choice(rng, TRAIT_POOL);
  const t2 = inherit.length && rng() > 0.25 ? choice(rng, inherit) : choice(rng, TRAIT_POOL);
  const traits = [...new Set([t1, t2])];
  return {
    id: 'c' + seq, name: surname + given, sex, age: 0,
    job: '孩童', workArea: 'plaza', traits,
    hair, shirt,
    pers: pickLex(game, 'persChild', rng),
    family: { parents: [father && father.id, mother && mother.id].filter(Boolean), childIds: [] }
  };
}

// 成年（18 岁）：白纸开局后没有预设的活计可接，转职由演化引擎完成
export function assignAdultJob(n, npcs, rng, day) {
  // 白纸开局（v2.7.0）：成年不再分配职业——种子世界没有预设的活计，
  // 职业是学会手艺的果（演化引擎配方固化时，第一个学会的无业者自动转职）
  n.job = ''; n.workArea = '';   // 从"孩童"长成无业成年人
  n.memory('成年了，得自己琢磨着干点什么', day, 6);
  return '';
}

// ---------- 童年有自己的世界（第三章·十） ----------
// 语言革命：孩子话题/玩闹喊话/老人迷糊话/哭丧全部进词库（childTopic/childIdle/confused/lament 槽）

// 孩子的日常决策（插在通用需求判断之后、成人工作之前——孩子不做工、不营造、不出镇）
export function decideChild(n, w, clock, rng, others) {
  const h = clock.hour;
  const st = stageOf(n.body.ageYears);
  // 少年上学（沿用学生的时窗）
  if (st.id === 'teen' && ((h >= 9 && h < 11) || (h >= 14 && h < 16))) {
    return { action: 'study', why: '该去认字念书了' };
  }
  // 天黑回家
  if (h >= 19) return { action: 'home', why: '天黑了，回家吃饭' };
  // 扪孩子玩
  const kids = others.filter(o => o.id !== n.id && !o.inside && o.intent.type !== 'sleep' && isKid(o));
  if (kids.length && chance(rng, 0.45)) {
    const k = kids[Math.floor(rng() * kids.length) % kids.length];
    return { action: 'play', with: k.id, why: '找' + k.name + '玩去' };
  }
  // 跟着爹娘
  const parent = others.find(o => !o.inside && (n.family.parents || []).includes(o.id));
  if (parent && chance(rng, 0.22)) return { action: 'follow', npc: parent.id, why: '跟着' + parent.name + '去' };
  return { action: 'play', with: null, why: '自己玩一会儿' };
}

// ---------- 老年不只是变慢（第三章·十：记忆流失 / 时间感错乱 / 认错人） ----------
// 每日推进：记忆在流失（真的会忘——记忆被删掉，不是染色）
export function elderDaily(n, rng, day) {
  const evts = [];
  const age = n.body.ageYears;
  if (age < 62 || !n.memories || n.memories.length <= 6) return evts;
  const p = 0.02 + Math.min(0.06, (age - 62) * 0.002);
  if (rng() < p) {
    const old = n.memories.filter(m => day - m.d > 8);
    if (old.length) {
      const victim = old[Math.floor(rng() * old.length) % old.length];
      n.memories.splice(n.memories.indexOf(victim), 1);
      evts.push('忘了些旧事，怎么想也想不起来');
    }
  }
  return evts;
}
// 闲时自语：把眼前的年轻人认成故人（"可能把孙子当成死去的儿子"）
export function elderConfusedSay(n, npcs, dead, rng, nowReal, clock, game) {
  if (n.body.ageYears < 65) return false;
  const youngster = npcs.find(o => o.id !== n.id && !o.inside && o.body && o.body.ageYears < 20
    && Math.abs(o.x - n.x) + Math.abs(o.y - n.y) < 3);
  if (youngster && dead && dead.length && chance(rng, 0.5)) {
    const gone = dead[Math.floor(rng() * dead.length) % dead.length];
    // 语言革命：认错人的尾句也从当下迷糊话词库接——老人的话是活的
    n.say(gone.name + '？……哦，不是。' + pickLex(game, 'confused', rng), nowReal);
    n.memory('又把人认成了' + gone.name, clock.totalDay, clock.hour);
    return true;
  }
  if (chance(rng, 0.6)) {
    n.say(pickLex(game, 'confused', rng), nowReal);
    return true;
  }
  return false;
}

// ---------- 死亡有过程（第三章·十） ----------
// 每日死亡判定：衰老/病痛/伤重——慢性病折寿，重伤折寿，饥饿折寿
export function dailyMortality(n, rng) {
  const age = n.body.ageYears;
  if (age < 3) return null;
  let p = 0.00012;
  if (age >= 75) p = 0.004 + (age - 75) * 0.0007;
  else if (age >= 60) p = 0.0012 + (age - 60) * 0.00009;
  else if (age >= 45) p = 0.0004 + (age - 45) * 0.00004;
  const chronic = n.body.ailments.filter(a => a.kind === 'chronic' || a.kind === 'aging').length;
  p += chronic * 0.0015;   // 慢性病是拖，不是判（旧版 ×0.004：一条老寒腿等于年内必死，小镇凶得没有道理）
  const worst = Math.min(...Object.values(n.body.parts).map(s => s.cond));
  if (worst < 45) p += 0.004;
  if (n.needs.hunger > 92) p += 0.003;
  if (rng() < p) return age >= 70 ? '寿终正寝' : worst < 40 ? '伤重不治' : '病故';
  return null;
}
// 病榻：死亡有过程，不猝不及防（意外死亡走事件层）
export function startDying(n, cause, rng) {
  n.dying = { cause, days: 2 + Math.floor(rng() * 4) };
  n.moodDelta(-10);
}

// 谁是血亲（葬礼的哭者与遗物的继承人）
function isFamily(a, b) {
  if (!a.family || !b.family) return false;
  if (a.spouse === b.id || b.spouse === a.id) return true;
  if (a.family.parents.includes(b.id) || b.family.parents.includes(a.id)) return true;
  return a.family.childIds.some(c => b.family.childIds.includes(c));
}

// 遗物：职业的旧物件，交给最亲的人
const RELIC_BY_JOB = {
  '农夫': '那把磨得发亮的锄头', '铁匠': '那柄用惯了的小锤', '樵夫': '那把断了齿的锯',
  '渔夫': '那卷旧渔线', '商人': '那把油亮的算盘', '厨子': '那口老汤勺',
  '学生': '那本卷角的识字课本', '医生': '那只随身药箱', '诗人': '那卷没写完的诗稿',
  '孩童': '那只小木马'
};

// 去世 + 葬礼启动：全镇都听见（感知广播），远近不同痛；坟茔、遗物、孀居、断念
export function dieAndFuneral(game, n) {
  const w = game.world, clock = game.clock, rng = game.rng;
  const cause = (n.dying && n.dying.cause) || '病故';
  const age = n.body.ageYears;
  const living = game.npcs.filter(o => o !== n);
  // 谁来哭：血亲与知己
  const kin = living.filter(o => isFamily(o, n) || (o.relations[n.id] || 0) >= 45);
  // 广而告之：远近不同痛（感知广播 + 心情冲击）
  for (const o of living) {
    const deep = isFamily(o, n) ? -25 : ((o.relations[n.id] || 0) >= 45 ? -12 : -4);
    o.perceive('hear', n.name + '走了', clock.totalDay, clock.hour, deep);
  }
  // 遗物怎么分：交给最亲的人（血亲优先，其次关系最好）
  const heir = living.slice().sort((a, b) =>
    ((isFamily(b, n) ? 100 : 0) + (b.relations[n.id] || 0)) - ((isFamily(a, n) ? 100 : 0) + (a.relations[n.id] || 0)))[0];
  if (heir) {
    const relic = RELIC_BY_JOB[n.job] || '那件旧物件';
    heir.memory(n.name + '把' + relic + '留给了我', clock.totalDay, clock.hour);
    heir.moodDelta(-4);
  }
  // 未说出口的话，跟着人进了土里（社会层：说了十年"改天"的那句，终究没说）
  for (const o of living) {
    const rel = o.rels && o.rels[n.id];
    if (rel && rel.unsaid) {
      o.memory('有句话，终究没来得及对' + n.name + '说出口', clock.totalDay, clock.hour);
      rel.unsaid = null;
    }
  }
  // 坟茔：葬在屋后能望见家的地方
  let grave = null;
  const hx = n.home ? n.home.hx : 36, hy = n.home ? n.home.hy : 26;
  for (let r = 2; r <= 7 && !grave; r++) {
    for (let k = 0; k < 16 && !grave; k++) {
      const ang = rng() * Math.PI * 2;
      const x = hx + Math.round(Math.cos(ang) * r), y = hy + Math.round(Math.sin(ang) * r);
      if (x < 1 || y < 1) continue;
      if (!chunkHas(w, x, y)) continue;
      if (getGround(w, x, y) === G.GRASS && getObj(w, x, y) === O.NONE) {
        setObj(w, x, y, O.GRAVE);
        grave = { x, y };
      }
    }
  }
  if (grave && game.renderer) game.renderer.mapDirty = true;
  // 镇史记一笔（呈现层编年史的种子）；故人的记忆随碑存档——血肉不随人走
  game.dead.push({ id: n.id, name: n.name, age, cause, day: clock.totalDay, grave, memories: n.memories.slice(-40) });
  // 呈现层·地形考古：坟茔是镇上最老的物理痕迹；编年史：骨架
  markNote(game, grave ? grave.x : hx, grave ? grave.y : hy, 'grave', n.name + '之墓', n.name);
  chronNote(game, 'death', n.name + cause + '，享年' + age + '岁', (n.dying && n.dying.cause) ? '病榻' + ((n.dying.days || 0) + 1) + '日' : '');
  // 遗绪：暗恋断了、伴侣孀居
  for (const o of living) {
    if (o.mind && o.mind.crushId === n.id) {
      o.mind.crushId = null;
      o.memory('心里那个人不在了', clock.totalDay, clock.hour);
    }
    if (o.spouse === n.id) {
      o.spouse = null;
      o.memory('从此一个人过了', clock.totalDay, clock.hour);
      o.moodDelta(-6);
    }
  }
  // 销户：亡者不再拴人——「有老有小走不了」的锚是活人给的，不是牌位给的
  // （v4.5.0 离镇系统暴露的陈疾：family 名单只进不出，日子久了人人背着死锚，镇子一潭死水）
  for (const o of [...living, ...(game.wanderers || [])]) {
    if (!o.family) continue;
    o.family.parents = o.family.parents.filter(id => id !== n.id);
    o.family.childIds = o.family.childIds.filter(id => id !== n.id);
  }
  // 移出名册
  game.npcs = living;
  if (game.selNpcId === n.id) game.selNpcId = null;
  game.log(n.name + cause + '，享年' + age + '岁', 'err');
  if (typeof document !== 'undefined' && game.banner) game.banner(n.name + '走了');
  // 葬礼：亲属到坟前哭丧（第八章·哭丧）
  game._funeral = {
    grave, name: n.name,
    mourners: kin.slice(0, 6).map(o => o.id),
    startedMin: clock.min, said: {}
  };
  return grave;
}

// ---------- 传承（婚配最小闭环，完整习俗在 v1.6 社会层） ----------
// 结伴：相互好感都够的成年男女，低概率成伴
// v4.4.2：门槛 45→26。实测（多世界长跑）在现实社交速率下，一起聊天每次亲密度才 +1~3，
// 双方都攒到 45 要几十次同一对说笑；而 pairCheck 每日仅 5% 触发，于是"没人成亲"成了常态。
// 26 是"处得惯"的量——成亲靠的是反复来往，不是一见倾心。
export function pairCheck(game) {
  const rng = game.rng;
  if (!chance(rng, 0.05)) return null;
  const adults = game.npcs.filter(n => n.body.ageYears >= 18 && n.body.ageYears <= 59 && !n.spouse && !n.dying && !n.visiting);
  for (let i = 0; i < adults.length; i++) {
    for (let j = i + 1; j < adults.length; j++) {
      const a = adults[i], b = adults[j];
      if (a.sex === b.sex) continue;
      // v4.5.0 性别层：婚配是生育制度——除了男女之配，还得两人互相都有意思（取向不投的不来电）
      if (!attractedTo(a, b.sex) || !attractedTo(b, a.sex)) continue;
      if ((a.relations[b.id] || 0) >= 26 && (b.relations[a.id] || 0) >= 26) {
        a.spouse = b.id; b.spouse = a.id;
        a.memory('和' + b.name + '成了伴儿，往后互相有个照应', game.clock.totalDay, game.clock.hour);
        b.memory('和' + a.name + '成了伴儿，往后互相有个照应', game.clock.totalDay, game.clock.hour);
        a.moodDelta(8); b.moodDelta(8);
        game.log(a.name + '和' + b.name + '成了伴儿', 'good');
        return { a: a.id, b: b.id };
      }
    }
  }
  return null;
}

// ---------- 性别层（v4.5.0，计划书第三章·身体：性与生育） ----------
// 欲望日推进：积累/夫妻纾解/压抑——欲望是需求，不是标签
export function desireDaily(game, day) {
  const rng = game.rng;
  for (const n of game.npcs) {
    const age = n.body.ageYears;
    if (age < 16 || n.dying) continue;
    n.needs.desire = clamp((n.needs.desire || 0) + (age >= 46 ? rint(rng, 1, 2) : rint(rng, 2, 5)), 0, 100);
  }
  // 夫妻同衾：纾解（每对只处理一次——id 序去重）
  for (const n of game.npcs) {
    if (!n.spouse || n.dying) continue;
    const sp = game.npcs.find(o => o.id === n.spouse);
    if (!sp || sp.id < n.id) continue;
    if (!chance(rng, 0.6)) continue;
    const ease = rint(rng, 40, 70);
    n.needs.desire = clamp(n.needs.desire - ease, 0, 100);
    sp.needs.desire = clamp(sp.needs.desire - ease, 0, 100);
    n.moodDelta(2); sp.moodDelta(2);
    const r = relOf(n, sp.id, day); r.close = clamp(r.close + 1, -100, 100);
    n.relations[sp.id] = clamp((n.relations[sp.id] || 0) + 1, -100, 100);
  }
  // 压抑：火烧得旺又没着落，日子就燥
  for (const n of game.npcs) {
    if (!n.spouse && (n.needs.desire || 0) > 75) n.moodDelta(-2);
  }
}

// 受孕（原 tryBirth——从"当天掉孩子"改成十月怀胎的起点）：已婚未孕的育龄女性按欲望概率受孕
export function tryBirth(game, rng) {
  for (const m of game.npcs) {
    if (m.sex !== '女' || m.dying || m.preg || !m.spouse) continue;
    const age = m.body.ageYears;
    if (age < 18 || age > 44) continue;
    const father = game.npcs.find(o => o.id === m.spouse);
    if (!father || father.dying) continue;
    const heat = ((m.needs.desire || 0) + (father.needs.desire || 0)) / 2;
    if (!chance(rng, 0.015 + Math.min(100, heat) / 100 * 0.035)) continue;
    m.preg = { day0: game.clock.totalDay, due: game.clock.totalDay + 280, fatherId: father.id };
    m.memory('有了身子，心里又慌又喜', game.clock.totalDay, 6);
    father.memory('要当爹了', game.clock.totalDay, 6);
    return { mother: m, father };
  }
  return null;
}

// 孕期日推进：身子重、心情荡；里程碑写进记忆（怀孕的辛苦）
export function pregDaily(game, day) {
  const rng = game.rng;
  for (const m of game.npcs) {
    if (!m.preg || m.dying) continue;
    m.needs.energy = clamp(m.needs.energy - 2, 0, 100);
    m.moodDelta(rint(rng, -3, 3));
    const passed = day - m.preg.day0;
    const mark = { 30: '把了脉，是有喜了', 150: '的肚子一天天显了，谁都看得出来', 260: '临盆就在这几日了' }[passed];
    if (mark) {
      m.memory(mark, day, 6);
      const father = game.npcs.find(o => o.id === m.preg.fatherId);
      if (father) father.memory(m.name + mark, day, 6);
      game.log(m.name + mark, 'good');
    }
  }
}

// 分娩日推进：添丁是喜事，也是鬼门关——夭折/难产/产后血崩都是真风险（生产的危险）
export function birthDaily(game, day) {
  const rng = game.rng;
  const out = [];
  for (const m of [...game.npcs]) {
    if (!m.preg || day < m.preg.due) continue;
    const father = game.npcs.find(o => o.id === m.preg.fatherId) || null;
    m.preg = null;
    // 夭折：孩子没留住
    if (chance(rng, 0.02)) {
      m.memory('孩子没留住，月子里哭干了眼', day, 6);
      m.moodDelta(-15);
      if (father) { father.memory('孩子没留住', day, 6); father.moodDelta(-12); }
      game.log(m.name + '的孩子没能留住', 'err');
      continue;
    }
    // 难产：母亲受创；身子骨本就差的可能挺不过来
    if (chance(rng, 0.08)) {
      injure(m.body, 'torso', '难产', 25, 12, day);
      m.memory('生产这一遭，去了半条命', day, 6);
      m.moodDelta(-8);
      const worst = Math.min(...Object.values(m.body.parts).map(s => s.cond));
      if (worst < 40 && chance(rng, 0.25)) {
        game.log(m.name + '产后血崩，人眼看着不行了', 'err');
        startDying(m, '产后血崩', rng);
      }
    }
    game._lifeSeq = game._lifeSeq || 1;
    const def = makeChildDef(father, m, rng, game._lifeSeq, game);
    game._lifeSeq++;
    out.push({ def, father, mother: m });
  }
  return out;
}
