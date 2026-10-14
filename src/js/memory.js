// memory.js - 记忆失真：每次回忆按当前情绪重写，记忆自己会漂移
// 设计来自计划书第三章第七节：事实记忆/情感记忆/重构记忆/压抑记忆/虚假记忆
// 核心规则：记忆存原始版本（orig），每次检索时按当前情绪重写为 text，drift 记录被重写次数
import { fmtClock } from './core.js';

// mood 0..100 → valence -100..100
function moodToValence(mood) {
  return Math.round((mood - 50) * 2);
}

// 软化为当前情绪色调（用前缀/后缀轻量改写，不破坏事实主干）
function soften(text, rng) {
  // 坏事在好心情下回忆：觉得没那么糟
  const R = rng || Math.random;   // D34：游戏内调用必须传 rng——染色会回写记忆，野骰子会让世界不可复现
  const prefixes = ['好像', '说起来', '现在想想'];
  const suffixes = ['…其实也没什么', '…也就那样吧', ''];
  const p = prefixes[Math.floor(R() * prefixes.length)];
  const s = suffixes[Math.floor(R() * suffixes.length)];
  if (s) return p + text + s;
  return p + text;
}
function sour(text, rng) {
  // 好事在坏心情下回忆：觉得也就那样
  const R = rng || Math.random;
  const prefixes = ['说起来', '仔细想想', '现在觉得'];
  const suffixes = ['…也没什么了不起', '…也就一般', ''];
  const p = prefixes[Math.floor(R() * prefixes.length)];
  const s = suffixes[Math.floor(R() * suffixes.length)];
  if (s) return p + text + s;
  return p + text;
}
function reinforce(text, positive) {
  // 情绪一致时反复回忆：强化细节（追加主观定性）
  if (positive) return text + '（现在还觉得挺好）';
  return text + '（现在想起来还是难受）';
}

// 复述染色（纯函数版）：按"复述者当前心情"与"内容原始价态"的落差染色文本，不改任何状态
// 失真物理的零件：传话的人什么心情，话就走什么味（涌现物理层设计稿·物理二）
export function tintRecall(text, fromValence, currentMood, rng) {
  const cur = moodToValence(currentMood);
  const delta = cur - (fromValence || 0);
  if (delta > 25 && (fromValence || 0) < 0) return soften(text, rng);   // 开心复述坏事 → 软化
  if (delta < -25 && (fromValence || 0) > 0) return sour(text, rng);    // 难过复述好事 → 酸蚀
  return text;
}

// 新建一条记忆（mood 为事件发生时的心情 0..100）
// opts.isIncident（v4.2 发现层）：标记为"意外"记忆——recentMemories 检索时优先返回
export function makeMemory(text, totalDay, hour, mood, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    d: totalDay,
    t: fmtClock(hour),
    text,            // 当前回忆版本（会漂移）
    orig: text,      // 原始事实版本（永不改）
    valence: moodToValence(mood || 50),
    drift: 0,        // 被重写次数
    isIncident: !!o.isIncident   // v4.2：意外记忆标记
  };
}

// 回忆一条记忆：按当前心情染色，写入 text 并返回
export function recall(mem, currentMood, rng) {
  if (!mem) return '';
  if (mem.orig == null) mem.orig = mem.text;    // 旧档兼容：无 orig 则以当前 text 为原始
  if (mem.valence == null) mem.valence = 0;     // 旧档兼容：无价态则中性
  const cur = moodToValence(currentMood);
  const delta = cur - mem.valence;
  // 漂移系数：重写越多，偏移越极端
  const driftBoost = 1 + mem.drift * 0.12;

  if (delta > 25 && mem.valence < 0) {
    // 现在开心，回忆坏事 → 软化
    mem.text = soften(mem.orig, rng);
  } else if (delta < -25 && mem.valence > 0) {
    // 现在难过，回忆好事 → 酸蚀
    mem.text = sour(mem.orig, rng);
  } else if (Math.abs(delta) < 12 && mem.drift > 2) {
    // 情绪一致且反复回忆 → 强化
    mem.text = reinforce(mem.orig, cur > 0);
  } else {
    // 情绪无显著冲突：文本趋向原始（轻微回归，避免无限漂移）
    if (mem.drift > 5) mem.text = mem.orig;
  }
  mem.drift++;
  // 漂移次数过多时，把染色版固化为新的"事实"基线（重构记忆）
  if (mem.drift > 10) {
    mem.orig = mem.text;
    mem.valence = cur;
    mem.drift = 0;
  }
  return mem.text;
}

// 取最近 n 条记忆的回忆版本（按当前心情染色）
// 强负面记忆（valence < -60）有概率被压抑——不进入近事，但记忆本身仍保留
// v4.2 发现层：isIncident 记忆优先返回（意外要被记住，不被压抑跳过）
export function recentMemories(npc, n, rng) {
  const mood = npc.needs ? npc.needs.mood : 50;
  const R = rng || Math.random;
  const arr = npc.memories || [];
  const out = [];
  const picked = new Set();
  // 第一遍：isIncident 优先（意外不被压抑跳过——它们是要被记住的）
  for (let i = arr.length - 1; i >= 0 && out.length < n; i--) {
    const m = arr[i];
    if (!m.isIncident) continue;
    picked.add(i);
    const text = recall(m, mood, rng);
    out.unshift(`${m.d}日${m.t} ${text}`);
  }
  // 第二遍：普通记忆补齐（跳过已选的 + 被压抑的）
  for (let i = arr.length - 1; i >= 0 && out.length < n; i--) {
    if (picked.has(i)) continue;
    const m = arr[i];
    // 压抑：强负面记忆在心情不差时倾向于回避（25% 概率跳过）
    if (m.valence != null && m.valence < -60 && mood > 40 && R() < 0.25) continue;
    const text = recall(m, mood, rng);
    out.unshift(`${m.d}日${m.t} ${text}`);
  }
  return out;
}
