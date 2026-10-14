// body.js - 身体系统：部位化/劳损/旧伤/病痛/衰老/饥渴冷热感受/行为约束（v1.3.0 地基层）
// 计划书第三章三：身体必须部位化，每部位有当前状态、旧伤、劳损；
// 状态本身就是行为约束——腿伤的老人会绕开坡，手抖的铁匠打出来的东西精度低。
// 一个瘸腿的铁匠，和健全的铁匠，是两种人生。

export const BODY_PARTS = ['head', 'neck', 'torso', 'armL', 'armR', 'legL', 'legR'];
export const PART_NAME = {
  head: '头', neck: '颈', torso: '躯干', armL: '左臂', armR: '右臂', legL: '左腿', legR: '右腿'
};

// 各职业的劳损部位（工作时慢慢磨损）
export const JOB_WEAR = {
  '农夫': { torso: 1.0, legL: 0.6, legR: 0.6 },
  '铁匠': { armR: 1.2, armL: 0.5 },
  '樵夫': { armR: 1.0, armL: 0.7, torso: 0.5 },
  '渔夫': { neck: 0.5, armR: 0.3 },
  '商人': { neck: 0.3 },
  '厨子': { armR: 0.6, armL: 0.3 },
  '学生': {},
  '医生': { armR: 0.3 },
  '诗人': { neck: 0.2 }
};

// 衰老症状表（60 岁起按概率获得，终身不退——衰老不只是变慢）
export const AGING_ALIMENTS = [
  { id: 'tremor', name: '手抖', part: 'armR', craftMul: 0.6, say: '端碗的手有点不听使唤' },
  { id: 'deaf',   name: '耳背', part: 'head',  hearMul: 0.5, say: '耳朵越来越背了' },
  { id: 'blurry', name: '眼花', part: 'head',  seeMul: 0.6, say: '看东西模模糊糊的' },
  { id: 'foggy',  name: '健忘', part: 'head',  memMul: 0.5, say: '刚想做的事一转身就忘' }
];

// 慢性病表（低概率获得，拖着不好的、疼一辈子的）
export const CHRONIC_ALIMENTS = [
  { id: 'kneel',   name: '老寒腿', part: 'legL', moveMul: 0.8, seasonMin: 3, say: '一到冷天腿就隐隐作痛' },
  { id: 'cough',   name: '咳疾',   part: 'torso', staminaMul: 0.85, say: '胸口总有点闷' },
  { id: 'ache',    name: '腰疾',   part: 'torso', moveMul: 0.9, say: '这腰是年轻时候落下的' }
];

// 工伤表（工作中突发；愈合后可能留旧伤）
export const INJURY_TABLE = {
  '农夫': [{ part: 'torso', name: '闪了腰', sev: 24, days: 6 }, { part: 'legR', name: '崴了脚', sev: 16, days: 4 }],
  '铁匠': [{ part: 'armR', name: '砸伤了手', sev: 28, days: 8 }, { part: 'armL', name: '燎伤了胳膊', sev: 18, days: 5 }],
  '樵夫': [{ part: 'armL', name: '砍伤了腿', sev: 26, days: 7 }, { part: 'legL', name: '被木头砸了', sev: 20, days: 5 }],
  '渔夫': [{ part: 'armR', name: '被鱼线勒伤', sev: 12, days: 3 }],
  '矿工': [{ part: 'legR', name: '砸伤了脚', sev: 22, days: 6 }]
};
JOB_WEAR['铁匠'] && (INJURY_TABLE['铁匠'] = INJURY_TABLE['铁匠']); // 铁匠兼矿区作业，工伤沿用

export function makeBody(seed, ageYears) {
  const parts = {};
  for (const p of BODY_PARTS) {
    parts[p] = { cond: 100, wear: 0, scar: 0 };   // cond 当前状态 0-100，wear 劳损，scar 旧伤扣减
  }
  const age = (ageYears != null && ageYears >= 0) ? ageYears : 28;   // 0 岁是合法年龄（新生儿），不能被吞掉
  return {
    ageYears: age,
    parts,
    ailments: [],          // {id,name,kind,part,untilDay|null(终身),mul:{...}}
    feel: { cold: 0, heat: 0 },   // 饥渴冷热是感受，不是数值
    _lastWearDay: 0
  };
}

// 身体约束（状态本身就是行为约束）——决策层与移动层每帧读
export function bodyConstraints(body) {
  const out = { moveMul: 1, craftMul: 1, staminaMax: 100, hearMul: 1, seeMul: 1, memMul: 1 };
  for (const a of body.ailments) {
    const m = a.mul || {};
    if (m.moveMul) out.moveMul *= m.moveMul;
    if (m.craftMul) out.craftMul *= m.craftMul;
    if (m.staminaMul) out.staminaMax = Math.min(out.staminaMax, 100 * m.staminaMul);
    if (m.hearMul) out.hearMul *= m.hearMul;
    if (m.seeMul) out.seeMul *= m.seeMul;
    if (m.memMul) out.memMul *= m.memMul;
  }
  // 部位状态直接构成约束：腿伤走得慢，手伤干活差
  const legWorst = Math.min(body.parts.legL.cond, body.parts.legR.cond);
  if (legWorst < 70) out.moveMul *= 0.55 + 0.45 * (legWorst / 70);
  const armWorst = Math.min(body.parts.armL.cond, body.parts.armR.cond);
  if (armWorst < 70) out.craftMul *= 0.5 + 0.5 * (armWorst / 70);
  // 精力上限随体质衰退（终身缓慢衰退）
  const wearAvg = BODY_PARTS.reduce((s, p) => s + body.parts[p].cond, 0) / BODY_PARTS.length;
  out.staminaMax = Math.min(out.staminaMax, 55 + wearAvg * 0.45);
  return out;
}

// 工伤入口：sev 越重 cond 掉得越多；约束按部位归类——腿伤走得慢、手伤干活差、躯干伤扛不住
export function injure(body, part, name, sev, days, totalDay) {
  const p = body.parts[part] || body.parts.torso;
  p.cond = Math.max(20, p.cond - sev);
  const kind = (part === 'legL' || part === 'legR') ? 'leg'
    : (part === 'armL' || part === 'armR') ? 'arm' : 'core';
  const mul = kind === 'leg' ? { moveMul: Math.max(0.45, 1 - sev / 60) }
    : kind === 'arm' ? { craftMul: Math.max(0.4, 1 - sev / 60) }
      : { staminaMul: Math.max(0.6, 1 - sev / 90) };
  body.ailments.push({
    id: 'inj_' + name, name, kind: 'injury', part,
    untilDay: totalDay + (days || 5), mul
  });
}

// 每日身体推进（清晨由 game.onNewDay 调用）
// workMin: 昨日工作分钟数；job: 职业；返回事件文案数组（写记忆用）
export function bodyDailyTick(body, job, workMin, weatherType, season, rng, totalDay) {
  const events = [];
  const table = JOB_WEAR[job] || {};
  // 1) 劳损累积（昨日工作越久磨损越重）+ 夜间自然缓解
  for (const p of BODY_PARTS) {
    const wearAdd = (table[p] || 0) * (workMin / 480) * 6;
    body.parts[p].wear = Math.max(0, Math.min(100, body.parts[p].wear + wearAdd - 3));
    // 劳损拖累当前状态（缓慢恢复，旧伤疤决定下限）
    const floor = body.parts[p].scar;
    if (body.parts[p].cond < 100) body.parts[p].cond = Math.min(100, body.parts[p].cond + 1.5);
    body.parts[p].cond = Math.max(floor, body.parts[p].cond - body.parts[p].wear / 40);
  }
  // 2) 劳损过度 → 突发拉伤（拖着不好的）
  for (const p of BODY_PARTS) {
    if (body.parts[p].wear > 78 && (rng() * 100) < (body.parts[p].wear - 78) * 0.5) {
      injure(body, p, '劳损酸痛', 14, 4, totalDay);
      body.parts[p].wear = 50;
      events.push(PART_NAME[p] + '劳损过度，隐隐作痛');
      break;
    }
  }
  // 3) 病痛愈合 → 旧伤留疤（疼一辈子的）
  for (const a of body.ailments) {
    if (a.kind === 'injury' && a.untilDay != null && totalDay >= a.untilDay) {
      const p = body.parts[a.part];
      p.scar = Math.min(30, p.scar + 4);          // 旧伤疤：cond 永久上限扣减
      p.cond = Math.max(p.scar, p.cond);
      a.done = true;
      events.push(a.name + '好得差不多了，就是落了点病根');
    }
  }
  body.ailments = body.ailments.filter(a => !a.done);
  // 4) 慢性病：极低概率缠上（冷的季节更高）
  if (body.ailments.filter(a => a.kind === 'chronic').length < 2) {
    const coldSeason = season === 3;
    const p = (coldSeason ? 0.020 : 0.008) * (1 + workMin / 720);
    if (rng() < p) {
      const def = CHRONIC_ALIMENTS[Math.floor(rng() * CHRONIC_ALIMENTS.length) % CHRONIC_ALIMENTS.length];
      if (!body.ailments.some(a => a.id === def.id)) {
        body.ailments.push({ id: def.id, name: def.name, kind: 'chronic', part: def.part, untilDay: null, mul: { [keyOf(def)]: def[keyOf(def)] } });
        events.push('落下了' + def.name + '，怕是要跟一辈子');
      }
    }
  }
  // 4) 衰老：60 岁起症状概率累积（手抖/耳背/眼花/健忘，终身不退）
  if (body.ageYears >= 60) {
    const p = 0.05 + (body.ageYears - 60) * 0.02;
    if (rng() < p && body.ailments.filter(a => a.kind === 'aging').length < 3) {
      const cand = AGING_ALIMENTS.filter(a => !body.ailments.some(x => x.id === a.id));
      if (cand.length) {
        const def = cand[Math.floor(rng() * cand.length) % cand.length];
        body.ailments.push({ id: def.id, name: def.name, kind: 'aging', part: def.part, untilDay: null, mul: { [keyOf(def)]: def[keyOf(def)] } });
        events.push(def.say);
      }
    }
  }
  return events;
}

function keyOf(def) {
  for (const k of ['moveMul', 'craftMul', 'staminaMul', 'hearMul', 'seeMul', 'memMul']) if (def[k] != null) return k;
  return 'moveMul';
}

// 冷热感受：不是数值，是感受（0-100，越高越难受）——按季节/天气/昼夜漂移
export function feelTarget(body, weatherType, season, hour) {
  let cold = 0, heat = 0;
  if (season === 3) cold = 52;                        // 冬
  if (season === 0) cold = 12;                        // 春
  if (season === 1) heat = 46;                        // 夏
  if (season === 2) heat = 12;                        // 秋
  if (weatherType === 'snow') cold += 30;
  else if (weatherType === 'storm') cold += 14;
  else if (weatherType === 'rain') cold += 10;
  else if (weatherType === 'sunny') { heat += season === 1 ? 22 : 10; cold = Math.max(0, cold - 14); }
  if (hour >= 20 || hour < 6) cold += 12;             // 夜里冷
  return { cold: Math.min(100, cold), heat: Math.min(100, heat) };
}

// 一句话身体摘要（UI/快照用）
export function bodySummary(body) {
  const bad = body.ailments.map(a => a.name);
  const worn = BODY_PARTS.filter(p => body.parts[p].cond < 75).map(p => PART_NAME[p]);
  if (!bad.length && !worn.length) return '身子骨硬朗';
  const s = [];
  if (bad.length) s.push(bad.slice(0, 3).join('、'));
  if (worn.length) s.push(worn.slice(0, 2).join('、') + '不大利索');
  return s.join('；');
}
