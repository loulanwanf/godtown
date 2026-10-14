// history.js - 呈现层·历史与痕迹（计划书第十章：编年史/传闻网/地形考古/关系演变/高光回放/因果链）
// 痕迹五种：文字（几十年）/口述（传三代变形）/物理（几百年）/关系（一代人）/行为（只要他活着）。
// 事后看懂的条件是至少两种痕迹能对上；完全不懂的存在必须被保证——错过的，就是错过了。
// （环境无关，game 提供上下文；只依赖 core.js）
import { clamp, chance, choice } from './core.js';
import { lexSlot } from './lexicon.js';

export const CHRON_CAP = 500;   // 编年史：文字痕迹，留得最久
export const RUMOR_CAP = 160;   // 传闻网边：口述痕迹
export const HL_CAP = 48;       // 高光帧：只留你当时在看的视角
export const RELHIST_CAP = 26;  // 关系演变采样：一代人
export const INTENT_CAP = 14;   // 因果链：最近行止
export const RELMARK_CAP = 6;   // 关系转折记号

// ---------- 编年史（第十章·五：系统写骨架，NPC 写血肉） ----------
// kind: event/birth/death/wed/leave/build/craft/disaster/custom/world
export function chronNote(game, kind, text, why) {
  if (!game.chron) game.chron = [];
  const day = game.clock ? game.clock.totalDay : 1;
  // 同日同事只记一笔：泛类（event）可被具体类（craft/death…）覆盖升级
  const last = game.chron[game.chron.length - 1];
  if (last && last.d === day && last.t === text) {
    if (last.k === 'event' && kind && kind !== 'event') { last.k = kind; if (why) last.w = why; }
    return;
  }
  game.chron.push({ d: day, y: game.clock ? game.clock.year : 1, k: kind || 'event', t: text, w: why || '' });
  if (game.chron.length > CHRON_CAP) game.chron.splice(0, game.chron.length - CHRON_CAP);
}
// 血肉：这一天，镇民心里记下了什么（记忆是行为痕迹——人没了，血肉也就没了，只剩骨架）
export function fleshOf(game, day) {
  const out = [];
  for (const n of game.npcs || []) {
    for (const m of n.memories || []) {
      if (m.d === day) out.push({ who: n.name, text: m.text, mood: m.m });
    }
  }
  // 故人的那一页也翻得出来——只要镇魂碑还在（文字痕迹对得上，就看懂了一半）
  for (const dn of game.dead || []) {
    for (const m of dn.memories || []) {
      if (m.d === day) out.push({ who: dn.name + '（故）', text: m.text, mood: m.m });
    }
  }
  return out.slice(0, 24);
}

// ---------- 传闻网（第十章·二：口述传三代变形） ----------
// 变形：每一代传下去，话走一点样——掉字、换词。不是乱改，是"记不清"。
// 语言革命（v3.1.0）：换词表进词库（swap 槽）——这个镇子的话怎么传走样，随档走、演化可改
export function distortText(game, text) {
  const rng = game && game.rng ? game.rng : Math.random;
  let s = String(text);
  // 换词：撞到哪个换哪个（词表来自当下词库）
  for (const [a, b] of lexSlot(game, 'swap')) {
    if (s.includes(a) && chance(rng, 0.6)) { s = s.replace(a, b); break; }
  }
  // 掉字：长句子传着传着就短了
  if (s.length > 10 && chance(rng, 0.5)) {
    const i = 1 + Math.floor(rng() * (s.length - 2));
    s = s.slice(0, i) + s.slice(i + 1);
  }
  return s;
}
// 记一条传闻边（from→to，关于 about）。gen>=3（第三次转述）开始变形——口述传三代。
// 返回听者真正听到的版本（可能已变形）。secret.js 的 hook 回调用。
export function recordRumor(game, info) {
  if (!game.rumors) game.rumors = [];
  let txt = info.content;
  if ((info.gen || 1) >= 3) txt = distortText(game, txt);
  game.rumors.push({
    d: game.clock ? game.clock.totalDay : 1,
    f: info.from, t: info.to, ab: info.about,
    txt, gen: info.gen || 1
  });
  if (game.rumors.length > RUMOR_CAP) game.rumors.splice(0, game.rumors.length - RUMOR_CAP);
  return txt;
}
// 传闻网视图：按"关于谁+根内容"聚成线，线里是链（谁传给谁，第几天，传成了什么样）
export function rumorThreads(game, nameOf) {
  const threads = new Map();
  for (const e of game.rumors || []) {
    const key = e.ab + '|' + (e.root || '');
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(e);
  }
  const nm = nameOf || ((id) => id);
  return [...threads.values()].map(edges => ({
    about: nm(edges[0].ab),
    hops: edges.map(e => ({ d: e.d, from: nm(e.f), to: nm(e.t), txt: e.txt, gen: e.gen }))
  })).sort((a, b) => b.hops[b.hops.length - 1].d - a.hops[a.hops.length - 1].d);
}

// ---------- 地形考古（第十章·二：物理痕迹几百年；新房子的来历就是几十年后考古的入口） ----------
// marks: Map "x,y" → {d, k, name, by}  k: built/ruin/grave
export function markNote(game, x, y, kind, name, by) {
  if (!game.marks) game.marks = new Map();
  game.marks.set(x + ',' + y, {
    d: game.clock ? game.clock.totalDay : 1,
    k: kind, name: name || '', by: by || ''
  });
}
export function markAge(game, m) {
  return Math.max(0, (game.clock ? game.clock.totalDay : 1) - m.d);
}

// ---------- 关系演变（第三章·六：每段关系有自己的历史；第十章·七：关系变化必须能懂） ----------
// 每 3 日采一笔，或单日剧烈波动补一笔。六维都留——历史不是一条好感线。
export function relHistDaily(game, day) {
  for (const n of game.npcs || []) {
    if (!n.rels) continue;
    for (const rel of Object.values(n.rels)) {
      if (!rel.hist) rel.hist = [];
      const last = rel.hist[rel.hist.length - 1];
      const b = Math.round(rel.close * 0.6 + rel.trust * 0.4 + rel.owe * 0.12 + rel.depend * 0.15 - rel.grudge * 0.55 - rel.fear * 0.25);
      const moved = last && Math.abs(b - last.b) >= 8;
      if (last && day - last.d < 3 && !moved) continue;
      rel.hist.push({
        d: day, b: clamp(b, -100, 100),
        c: Math.round(rel.close), t: Math.round(rel.trust), o: Math.round(rel.owe),
        g: Math.round(rel.grudge), f: Math.round(rel.fear), p: Math.round(rel.depend)
      });
      if (rel.hist.length > RELHIST_CAP) rel.hist.splice(0, rel.hist.length - RELHIST_CAP);
    }
  }
}
// 转折记号：吵架/把话说开/评理——曲线上的坎（social.js 调用）
export function relMark(rel, day, what) {
  if (!rel.mark) rel.mark = [];
  rel.mark.push({ d: day, w: what });
  if (rel.mark.length > RELMARK_CAP) rel.mark.splice(0, rel.mark.length - RELMARK_CAP);
}

// ---------- 高光回放（第十章·五：只能看你当时在看的视角。玩家没有上帝视角的回放） ----------
// 每条 hl 日志落一帧：当时镜头对着哪、视野里有谁、他们在做什么。镜头没对着的，就是错过了。
export function hlSnap(game, text) {
  if (!game.highlights) game.highlights = [];
  const r = game.renderer;
  const cam = r && r.cam ? { x: r.cam.x, y: r.cam.y, z: r.cam.zoom } : { x: 28, y: 20, z: 2 };
  let vw = 26, vh = 18;
  if (r && r.canvas) {
    vw = r.canvas.width / (16 * cam.z);
    vh = r.canvas.height / (16 * cam.z);
  }
  const actors = [];
  for (const n of game.npcs || []) {
    if (n.inside) continue;
    if (n.x < cam.x || n.x > cam.x + vw || n.y < cam.y || n.y > cam.y + vh) continue;
    actors.push({
      id: n.id, nm: n.name, x: +n.x.toFixed(1), y: +n.y.toFixed(1),
      dir: n.dir, shirt: n.shirt, lb: n.intent ? n.intent.label : ''
    });
    if (actors.length >= 24) break;
  }
  game.highlights.push({
    d: game.clock ? game.clock.totalDay : 1,
    t: game.clock ? game.clock.label().slice(-5) : '--',
    text, cam, vw: Math.round(vw), vh: Math.round(vh),
    wx: game.weather ? game.weather.type : 'sun',
    hour: game.clock ? game.clock.hour : 12,
    actors
  });
  if (game.highlights.length > HL_CAP) game.highlights.splice(0, game.highlights.length - HL_CAP);
}

// ---------- 因果链（第四章·四：理由字段是调试命脉；第十章·七：日常行为必须能懂） ----------
// 意图换一桩记一桩：做什么 + 为什么 + 谁让做的（script/ai/need）
export function recordIntent(n, day, t) {
  if (!n.intent) return;
  if (n._lastIntent === n.intent) return;
  n._lastIntent = n.intent;
  if (!n.intentLog) n.intentLog = [];
  n.intentLog.push({
    d: day, t, lb: n.intent.label || n.intent.type,
    rs: n.intent.reason || '', src: n.intent.source || ''
  });
  if (n.intentLog.length > INTENT_CAP) n.intentLog.splice(0, n.intentLog.length - INTENT_CAP);
}

// ---------- 存档 ----------
export function serializeHistory(game) {
  return {
    chron: game.chron || [],
    rumors: game.rumors || [],
    marks: game.marks ? [...game.marks.entries()] : [],
    highlights: game.highlights || []
  };
}
export function hydrateHistory(game, data) {
  game.chron = (data && data.chron) || [];
  game.rumors = (data && data.rumors) || [];
  game.marks = new Map((data && data.marks) || []);
  game.highlights = (data && data.highlights) || [];
  // 旧档补记：镇魂碑是镇上最老的文字——坟茔与老宅先从故者档案里考古出来
  if (!data || !data.marks) {
    for (const dn of game.dead || []) {
      if (dn.grave) markNote(game, dn.grave.x, dn.grave.y, 'grave', dn.name + '之墓', dn.name);
    }
  }
}
