// language.js - 语言：方言/口头禅/童谣/禁忌语/漂移（计划书第八章）
// 原则：语言不是贴皮，是身份——年龄越大方言越重，话会随年月漂移，三代之后祖辈的话孙辈听着费劲。
// v3.1.0 语言革命：词表不再是常量——词库住在 game.lexicon（随档走、演化可增、漂移可减），
// 本层只剩语法机制（方言替换/口头禅装饰/禁忌匹配），一个词都不拥有。
import { mulberry32, choice } from './core.js';
import { lexSlot, SEED_LEXICON } from './lexicon.js';

// 字符串哈希（FNV-1a）：同人同构造，确定性
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 每人一份声音：口头禅 2-3、方言词库 8 对（浓度由年龄决定）、禁忌 1-2、孩子有童谣
// lex：游戏当下活词库（game.lexicon）；缺省落种子表（纯函数/selftest 兼容）
// 语言革命：新生儿从「当下的词库」抓声音——孩子说的是镇上现在的话，不是开镇那天的话
export function makeVoice(def, lex) {
  const rng = mulberry32(hashStr(def.id + '|voice'));
  const src = lex || SEED_LEXICON;
  const pool = (slot) => (src[slot] && src[slot].length ? src[slot] : SEED_LEXICON[slot]);
  const pickUnique = (arr, n) => {
    const a = [...arr]; const out = [];
    for (let i = 0; i < n && a.length; i++) out.push(a.splice(Math.floor(rng() * a.length) % a.length, 1)[0]);
    return out;
  };
  return {
    catch: pickUnique(pool('catch'), 2 + Math.floor(rng() * 2)),
    dialect: pickUnique(pool('dialect'), 8),
    taboo: pickUnique(pool('taboo'), 1 + Math.floor(rng() * 2)),
    // 语言革命机制修复：白纸开局后没有「学生」职业，童谣按生活段给（≤17 岁），不再按职业判定
    nursery: ((def.age != null ? def.age : 30) <= 17) ? choice(rng, pool('nursery')) : null
  };
}

// 出口装饰：方言按年龄浓度替换 + 三成的话带口头禅（cosmetic，用 Math.random 也可）
export function decorateSay(npc, text, rng) {
  const mind = npc.mind; const v = mind && mind.voice;
  if (!v) return text;
  const r = rng || Math.random;
  const age = (npc.body && npc.body.ageYears) || npc.age || 30;
  // 年龄越大，方言越重（三代漂移的种子）
  const pD = age < 18 ? 0.12 : age < 40 ? 0.28 : age < 60 ? 0.45 : 0.6;
  let t = text;
  for (const [std, dia] of v.dialect) {
    if (t.includes(std) && r() < pD) t = t.split(std).join(dia);
  }
  if (v.catch.length && r() < 0.3) {
    const c = v.catch[Math.floor(r() * v.catch.length) % v.catch.length];
    t = r() < 0.5 ? c + '，' + t : t + '，' + c;
  }
  return t;
}

// 说话习惯漂移：每季 10% 换一句口头禅（第八章：语言随时间变）
// 语言革命：新口头禅从当下词库抓——镇上新流行的话，人会跟着学
export function driftVoice(voice, rng, lex) {
  if (!voice || !voice.catch.length || !chance10(rng)) return false;
  const pool = (lex && lex.catch && lex.catch.length) ? lex.catch : SEED_LEXICON.catch;
  const cur = new Set(voice.catch);
  const cands = pool.filter(c => !cur.has(c));
  if (!cands.length) return false;
  voice.catch[Math.floor(rng() * voice.catch.length) % voice.catch.length] = choice(rng, cands);
  return true;
}
function chance10(rng) { return rng() < 0.10; }

// 禁忌命中：话题戳到了听众心里的疤
export function tabooHit(n, text) {
  const v = n.mind && n.mind.voice;
  if (!v || !v.taboo) return false;
  return v.taboo.some(grp => grp.some(k => text.includes(k)));
}
