// wanderer.js - 离镇者：走出小镇的人在无限地图上继续活着（v4.5.0，计划书第二章·无限世界）
// "远处不是没有，是降精度"——镇内逐帧，远方逐天。
// 实体不毁：人是完整的 NPC 对象（记忆/关系/身体全带走），只是从 npcs 挪进 wanderers。
// 零内容红线：方位/状态全由坐标推导，事件全是概率物理，没有一条预设剧本。
import { O, G, clamp, rint, chance, mulberry32 } from './core.js';
import { worldToChunk, getGround, getObj, setObj, chunkHas } from './chunk.js';
import { makeSettlement } from './settlement.js';
import { markNote, chronNote } from './history.js';
import { addBelief } from './belief.js';

export const TOWN = { x: 36, y: 26 };    // 镇中心（方位/距离推导的原点）
const GATE = { x: 6, y: 66 };     // 镇口（人来的路，也是人走的路）

// 离镇者走自己的骰流（D28 模式：种子派生独立 RNG，永不偏移主骰流——语言革命的确定性是物理）
// 测试可注入 game._wandRng 接管；实战按存档种子惰性初始化
export function wrng(game) {
  if (!game._wandRng) game._wandRng = mulberry32(((game.seed || 1) ^ 0x9d2c) >>> 0);
  return game._wandRng;
}

// 方位词：由坐标角推导（八向，机制不是内容）
export function dirWord(dx, dy) {
  const names = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
  return names[Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7];
}
function distFromTown(wn) { return Math.abs(wn.x - TOWN.x) + Math.abs(wn.y - TOWN.y); }

// 落点校验：chunk 未生成就先生成（走到哪，世界展开到哪），水面不停脚
function walkableAt(game, x, y) {
  const w = game.world;
  const [cx, cy] = worldToChunk(x, y);
  if (!w.ws.has(cx, cy)) w.ws.ensure(cx, cy);
  return chunkHas(w, x, y) && getGround(w, x, y) !== G.WATER;
}

// 沿 bearing 选下一个行进目标（拒采样避水，四面碰壁就调头）
function stepTarget(game, wn, dist) {
  const wd = wn.wand;
  for (let k = 0; k < 6; k++) {
    const ang = wd.bearing + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45);
    const tx = Math.round(wn.x + Math.cos(ang) * dist);
    const ty = Math.round(wn.y + Math.sin(ang) * dist);
    if (walkableAt(game, tx, ty)) { wd.tx = tx; wd.ty = ty; return true; }
  }
  wd.bearing += Math.PI / 2;
  return false;
}

// ---------- 离镇转换：人从镇口走出去，成为荒野里的实体 ----------
export function finalizeToWanderer(game, n) {
  const day = game.clock.totalDay;
  const ang = Math.atan2(GATE.y - TOWN.y, GATE.x - TOWN.x) + (wrng(game)() - 0.5) * 1.2;
  n.wand = { bearing: ang, state: 'trail', tx: n.x, ty: n.y, sinceDay: day, daysOut: 0, settId: null, lame: false };
  game.npcs = game.npcs.filter(o => o !== n);
  game.wanderers.push(n);
  stepTarget(game, n, 20);
  return n;
}

// ---------- 日推进（降精度：逐天） ----------
export function wandererDaily(game, day) {
  const rng = wrng(game);
  for (const wn of [...game.wanderers]) {
    const wd = wn.wand;
    if (!wd) continue;
    wd.daysOut = day - wd.sinceDay;

    // —— 落脚的人：聚落养着，日子简单 ——
    if (wd.state === 'settled') {
      const s = (game.settlements || []).find(v => v.id === wd.settId);
      if (!s || s.abandoned) { wd.state = 'trail'; wd.settId = null; }   // 聚落没了，重新上路
      else {
        wn.needs.hunger = clamp(wn.needs.hunger - 30, 0, 100);
        wn.needs.energy = clamp(wn.needs.energy + 20, 0, 100);
        wn.needs.mood = clamp(wn.needs.mood + (wn.needs.mood < 50 ? 2 : 0), 0, 100);
        wd.tx = s.center.x + rint(rng, -3, 3); wd.ty = s.center.y + rint(rng, -3, 3);
        maybeNews(game, wn, day);
        maybeHomesick(game, wn, day, 0.006);
        continue;
      }
    }

    // —— 赶路的人：走、吃、活 ——
    if (wd.state === 'return') {
      wd.bearing = Math.atan2(GATE.y - wn.y, GATE.x - wn.x);
      stepTarget(game, wn, wd.lame ? 14 : rint(rng, 25, 40));
      if (Math.abs(wn.x - TOWN.x) + Math.abs(wn.y - TOWN.y) < 14) { visitStart(game, wn, day); continue; }
    } else if (wd.state === 'seek') {
      const s = (game.settlements || []).find(v => v.id === wd.settId);
      if (!s || s.abandoned) { wd.state = 'trail'; wd.settId = null; }
      else {
        wd.bearing = Math.atan2(s.center.y - wn.y, s.center.x - wn.x);
        stepTarget(game, wn, wd.lame ? 14 : rint(rng, 25, 40));
        if (Math.abs(wn.x - s.center.x) + Math.abs(wn.y - s.center.y) < 9) { joinSettlement(game, wn, s, day); continue; }
      }
    } else {
      stepTarget(game, wn, wd.lame ? 14 : rint(rng, 25, 45));
      wd.lame = false;
    }

    // 饥渴与觅食：有树有草的地方就有得采
    wn.needs.hunger = clamp(wn.needs.hunger + rint(rng, 8, 14), 0, 100);
    wn.needs.energy = clamp(wn.needs.energy - 10, 0, 100);
    wn.needs.mood = clamp(wn.needs.mood - 1, 0, 100);
    if (forageAt(game, wn) && chance(rng, 0.65)) wn.needs.hunger = clamp(wn.needs.hunger - 18, 0, 100);
    if (wn.needs.hunger >= 100 && chance(rng, 0.08)) { dieInWild(game, wn, day, '饿死在路上'); continue; }

    // 荒野的凶险：狼与风雪（概率物理，不是剧本）
    if (chance(rng, 0.012)) {
      if (chance(rng, 0.12)) { dieInWild(game, wn, day, '葬身狼吻'); continue; }
      wd.lame = true;
      wn.memory('遇上了狼，拼了命才跑脱', day, 6);
      wn.moodDelta(-6);
    }
    if ((game.weather.stormy || game.weather.snowing) && chance(rng, 0.01)) { dieInWild(game, wn, day, '倒毙在风雪里'); continue; }

    // 发现聚落：45 格内望见炊烟，多半就奔那儿去了
    if (wd.state === 'trail') {
      const s = nearestSettlement(game, wn, 45);
      if (s && chance(rng, 0.55)) {
        wd.state = 'seek'; wd.settId = s.id;
        wn.memory('远远望见了' + s.name + '的炊烟，奔那儿去', day, 6);
      } else if (wd.daysOut >= 4 && distFromTown(wn) > 55 && goodCampAt(game, wn) && chance(rng, 0.05)) {
        foundCamp(game, wn, day);
      }
    }
    maybeNews(game, wn, day);
    maybeHomesick(game, wn, day, 0.008);
  }
  // 探亲到期的人重新上路
  for (const n of [...game.npcs]) {
    if (n.visiting && day > n.visiting.untilDay) visitEnd(game, n, day);
  }
}

// ---------- 帧推进（看得见的部分：走路与闲荡） ----------
export function wandererFrame(game, dtReal) {
  if (!game.wanderers || !game.wanderers.length) return;
  for (const wn of game.wanderers) {
    const wd = wn.wand;
    if (!wd) continue;
    const dx = wd.tx - wn.x, dy = wd.ty - wn.y;
    const d = Math.abs(dx) + Math.abs(dy);
    if (d > 0.3) {
      const sp = 1.2 * dtReal;   // 格/现实秒（与动物同档）
      const t = Math.min(1, sp / d);
      const nx = wn.x + dx * t, ny = wn.y + dy * t;
      const fx = Math.floor(nx), fy = Math.floor(ny);
      if (chunkHas(game.world, fx, fy) && getGround(game.world, fx, fy) !== G.WATER) {
        wn.x = nx; wn.y = ny;
      } else {
        wd.tx = wn.x + (wrng(game)() - 0.5) * 6; wd.ty = wn.y + (wrng(game)() - 0.5) * 6;   // 撞了水就绕一绕
      }
      wn.dir = dx > 0.01 ? 3 : dx < -0.01 ? 2 : dy > 0.01 ? 0 : 1;
      wn.trailMoving = true;
    } else {
      wn.trailMoving = false;
      // 到了就附近闲荡（营地/聚落的日子也是日子）
      wd.idleCd = (wd.idleCd || 0) - dtReal;
      if (wd.idleCd <= 0) {
        wd.idleCd = 2 + wrng(game)() * 4;
        wd.tx = wn.x + (wrng(game)() - 0.5) * 4; wd.ty = wn.y + (wrng(game)() - 0.5) * 4;
      }
    }
  }
}

// ---------- 内部：生存/事件 ----------

// 本镇不投（走出去的人不回头投奔自己出来的地方）
function nearestSettlement(game, wn, maxD) {
  let best = null, bd = maxD;
  for (const s of game.settlements || []) {
    if (s.abandoned || s === game.settlements[0]) continue;
    const d = Math.abs(s.center.x - wn.x) + Math.abs(s.center.y - wn.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function forageAt(game, wn) {
  const x = Math.floor(wn.wand.tx), y = Math.floor(wn.wand.ty);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (!chunkHas(game.world, x + dx, y + dy)) continue;
    if (getObj(game.world, x + dx, y + dy) === O.TREE) return true;
    if (getGround(game.world, x + dx, y + dy) === G.GRASS) return true;
  }
  return false;
}

// 立营的好地方：草地上，近处有树、看得见水（机制：看地不看表）
function goodCampAt(game, wn) {
  const x = Math.floor(wn.x), y = Math.floor(wn.y);
  if (getGround(game.world, x, y) !== G.GRASS) return false;
  let tree = false, water = false;
  for (let dy = -6; dy <= 6 && !(tree && water); dy++) for (let dx = -6; dx <= 6; dx++) {
    const d = Math.abs(dx) + Math.abs(dy);
    if (!chunkHas(game.world, x + dx, y + dy)) continue;
    if (d <= 3 && getObj(game.world, x + dx, y + dy) === O.TREE) tree = true;
    if (d <= 6 && getGround(game.world, x + dx, y + dy) === G.WATER) water = true;
  }
  return tree && water;
}

function foundCamp(game, wn, day) {
  const s = makeSettlement({ x: Math.floor(wn.x), y: Math.floor(wn.y) }, wrng(game));
  s.founded = day;
  s.founderId = wn.id;
  game.settlements.push(s);
  wn.wand.state = 'settled'; wn.wand.settId = s.id;
  wn.memory('在这儿落脚了，往后' + s.name + '就是家', day, 6);
  game.log(wn.name + '在' + dirWord(wn.x - TOWN.x, wn.y - TOWN.y) + '边立了个新营，叫' + s.name, 'good');
  chronNote(game, 'camp', wn.name + '在远方立营（' + s.name + '）', '走出小镇的人，把世界走大了');
  markNote(game, Math.floor(wn.x), Math.floor(wn.y), 'camp', s.name + '立营处', wn.name);
}

function joinSettlement(game, wn, s, day) {
  wn.wand.state = 'settled'; wn.wand.settId = s.id;
  wn.x = s.center.x + rint(wrng(game), -2, 2); wn.y = s.center.y + rint(wrng(game), -2, 2);
  wn.wand.tx = wn.x; wn.wand.ty = wn.y;
  wn.memory('在' + s.name + '落下了脚，往后的日子有着落了', day, 6);
  game.log(wn.name + '在' + s.name + '落脚了', '');
  chronNote(game, 'settle', wn.name + '落脚' + s.name, '走出小镇的人，在别处安了家');
}

// 消息传回：行脚人捎话——走出小镇的人，和小镇还有一根线牵着
function maybeNews(game, wn, day) {
  if (!chance(wrng(game), 0.04)) return;
  const s = (game.settlements || []).find(v => v.id === wn.wand.settId);
  const status = wn.wand.state === 'settled' && s
    ? '在' + dirWord(wn.x - TOWN.x, wn.y - TOWN.y) + '边的' + s.name + '落脚了'
    : '还在' + dirWord(wn.x - TOWN.x, wn.y - TOWN.y) + '边赶路';
  game.log('有行脚人捎话：' + wn.name + status, '');
  const hearer = game.npcs.length ? game.npcs[Math.floor(wrng(game)() * game.npcs.length)] : null;
  if (hearer) {
    hearer.memory('听说' + wn.name + status, day, 6);
    // v4.9.0 信念层：远方的消息进信念——我以为的世界，山那边也有了
    addBelief(hearer, wn.name + status, {
      src: '行脚人捎话', dir: dirWord(wn.x - TOWN.x, wn.y - TOWN.y), conf: 0.6, day
    });
  }
}

// 思乡：日子太苦、镇上有老小的人，更容易想起回家的路
function maybeHomesick(game, wn, day, p) {
  let q = p;
  const kin = game.npcs.some(o => o.spouse === wn.id || (o.family && (o.family.parents.includes(wn.id) || o.family.childIds.includes(wn.id))));
  if (kin) q += 0.008;
  if (wn.needs.mood < 30) q += 0.01;
  if (!chance(wrng(game), q)) return;
  wn.wand.state = 'return'; wn.wand.settId = null;
  wn.memory('想家了，回去看看', day, 6);
}

// 客死他乡：荒野里立的坟，也是世界的考古痕迹
function dieInWild(game, wn, day, cause) {
  const x = Math.floor(wn.x), y = Math.floor(wn.y);
  walkableAt(game, x, y);   // ensure chunk——坟要落在存在的地上
  let grave = null;
  if (chunkHas(game.world, x, y) && getObj(game.world, x, y) === O.NONE) {
    setObj(game.world, x, y, O.GRAVE); grave = { x, y };
  }
  game.wanderers = game.wanderers.filter(o => o !== wn);
  game.dead.push({ id: wn.id, name: wn.name, age: wn.body.ageYears, cause: '客死他乡·' + cause, day, grave, memories: wn.memories.slice(-40) });
  if (grave) markNote(game, x, y, 'grave', wn.name + '之墓', wn.name);
  chronNote(game, 'death', wn.name + cause + '，客死他乡', '走出小镇的人，骨头埋在了远方');
  game.log('噩耗传回镇上：' + wn.name + cause + '，埋在了' + dirWord(x - TOWN.x, y - TOWN.y) + '边的荒野', 'err');
  for (const o of game.npcs) {
    const rel = o.rels && o.rels[wn.id];
    const kin = o.family && (o.family.parents.includes(wn.id) || o.family.childIds.includes(wn.id));
    o.perceive('hear', wn.name + '死在了外头', day, 6, (kin || (rel && rel.close > 25)) ? -12 : -3);
  }
  // 销户：噩耗到了，名字从各家的户口本上划掉——亡者不拴人（与 life.js 镇内死亡同款）
  for (const o of [...game.npcs, ...game.wanderers]) {
    if (!o.family) continue;
    o.family.parents = o.family.parents.filter(id => id !== wn.id);
    o.family.childIds = o.family.childIds.filter(id => id !== wn.id);
    if (o.spouse === wn.id) o.spouse = null;
  }
}

// ---------- 回乡探亲：走出去的人，还记得回家的路 ----------
function visitStart(game, wn, day) {
  game.wanderers = game.wanderers.filter(o => o !== wn);
  wn.visiting = { untilDay: day + 1 };
  wn.x = GATE.x; wn.y = GATE.y; wn.inside = false;
  wn.intent = { type: 'ready', label: '待命', untilMin: 0, reason: '回乡探亲', source: 'script' };
  game.npcs.push(wn);
  game.log(wn.name + '背着行囊回来了，说要看看家里人', 'good');
  for (const o of game.npcs) {
    if (o === wn || o.inside) continue;
    const kin = o.spouse === wn.id || (o.family && (o.family.parents.includes(wn.id) || o.family.childIds.includes(wn.id)));
    o.perceive('see', wn.name + '回镇上来了', day, game.clock.hour, kin ? 4 : 2);
    if (kin) o.moodDelta(4);
  }
  chronNote(game, 'visit', wn.name + '回乡探亲', '走出去的人，还记得回家的路');
}
function visitEnd(game, n, day) {
  n.visiting = null;
  n.departing = null;
  n.wand = { bearing: Math.atan2(n.y - TOWN.y, n.x - TOWN.x) + (wrng(game)() - 0.5) * 0.8, state: 'trail', tx: n.x, ty: n.y, sinceDay: day, daysOut: 0, settId: null, lame: false };
  game.npcs = game.npcs.filter(o => o !== n);
  game.wanderers.push(n);
  stepTarget(game, n, 20);
  game.log(n.name + '看过了家里人，又上路了', 'warn');
}
