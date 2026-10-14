// animals.js - 世界层·动物生态（驯化/伴侣/野生）（环境无关，game 提供上下文）
import { O, G, rint, chance, choice, mulberry32 } from './core.js';
import { chunkHas, getGround } from './chunk.js';
import { walkable } from './world.js';
import { ensureHold, HOLD_OWED_CAP } from './hold.js';
import { pickLex } from './lexicon.js';
import { hashStr } from './language.js';

// ---- 动物类型定义 ----
// v4.5.0 性别层：maturity=成熟天数 / gest=妊娠天数 / litter=窝崽数 / wildCap=野生种群上限
export const ANIMAL_DEFS = {
  // 驯化：农夫饲养，产奶/毛/蛋，可被吃
  cow:   { name: '奶牛',  wild: false, product: 'milk',  prodName: '牛奶', prodDays: 2, meat: 8,  hp: 30, speed: 0.6, flee: false, diet: 'herb', size: 'large', habitat: 'farm', maturity: 40, gest: 60, litter: [1, 1] },
  sheep: { name: '绵羊',  wild: false, product: 'wool',  prodName: '羊毛', prodDays: 3, meat: 4,  hp: 20, speed: 0.7, flee: false, diet: 'herb', size: 'medium', habitat: 'farm', maturity: 25, gest: 30, litter: [1, 2] },
  chicken:{ name: '母鸡', wild: false, product: 'egg',   prodName: '鸡蛋', prodDays: 1, meat: 1,  hp: 8,  speed: 0.9, flee: false, diet: 'omni', size: 'small', habitat: 'farm', maturity: 15, gest: 18, litter: [2, 4] },
  // 伴侣：有名字有性格，陪老人，守门口
  dog:   { name: '狗',    wild: false, product: null,    prodName: null,   prodDays: 0, meat: 0,  hp: 25, speed: 1.3, flee: false, companion: true, diet: 'omni', size: 'medium', habitat: 'home', maturity: 20, gest: 22, litter: [1, 3] },
  cat:   { name: '猫',    wild: false, product: null,    prodName: null,   prodDays: 0, meat: 0,  hp: 12, speed: 1.1, flee: false, companion: true, diet: 'carn', size: 'small', habitat: 'home', maturity: 18, gest: 22, litter: [1, 3] },
  // 野生：狼袭击牲畜，鹿森林游荡，鸟氛围
  wolf:  { name: '狼',    wild: true,  product: null,    prodName: null,   prodDays: 0, meat: 3,  hp: 35, speed: 1.4, flee: true,  predator: true, diet: 'carn', size: 'medium', habitat: 'wild', maturity: 30, gest: 32, litter: [1, 2], wildCap: 6 },
  deer:  { name: '鹿',    wild: true,  product: null,    prodName: null,   prodDays: 0, meat: 5,  hp: 18, speed: 1.2, flee: true, diet: 'herb', size: 'medium', habitat: 'wild', maturity: 35, gest: 40, litter: [1, 1], wildCap: 10 },
  bird:  { name: '鸟',    wild: true,  product: null,    prodName: null,   prodDays: 0, meat: 0,  hp: 4,  speed: 1.6, flee: true, ambience: true, diet: 'omni', size: 'tiny', habitat: 'sky', maturity: 10, gest: 12, litter: [1, 2], wildCap: 14 }
};

// ---- 体型等级（用于捕食判定） ----
const SIZE_ORDER = { tiny: 0, small: 1, medium: 2, large: 3 };

// ---- 从属性推导：是否捕食者 ----
export function isPredator(def) { return def.diet === 'carn'; }

// ---- 从属性推导：捕食者能否猎杀目标 ----
// 肉食 × 非肉食 × 体型 >= 猎物体型
export function canPreyOn(predatorDef, preyDef) {
  if (predatorDef.diet !== 'carn') return false;
  if (preyDef.diet === 'carn') return false;
  return SIZE_ORDER[predatorDef.size] >= SIZE_ORDER[preyDef.size];
}

// 伴侣动物名字进词库（petDog/petCat 槽，v3.1.0 语言革命）——猫狗叫什么，也是一个镇子一个样

// 伴侣性格（性格名册=物理，挂机制钩的封闭集合，不动）
const PET_PERS = ['粘人', '高冷', '贪吃', '警觉', '懒散', '活泼'];

// ---- 生成一只动物 ----
export function makeAnimal(kind, x, y, rng, opts = {}) {
  const def = ANIMAL_DEFS[kind];
  const id = opts.id || `a_${kind}_${Math.round(x)}_${Math.round(y)}_${Math.floor(rng() * 0x7fffffff)}`;   // 不用 Date.now：性别按 id 哈希定终身，墙钟会让同 seed 跑出不同世界
  const a = {
    id,
    kind, name: null, pers: null,
    // v4.5.0 性别层：畜生也分公母——按 id 哈希定终身，不耗骰流（自检测试的骰序是物理）
    sex: opts.sex || (mulberry32(hashStr(id + '|sex'))() < 0.5 ? '公' : '母'),
    ageDays: opts.ageDays != null ? opts.ageDays : def.maturity,  // 日龄（默认成年；幼崽=0）
    preg: null,                 // 怀孕状态 {daysLeft, fatherId}
    x, y, tx: x, ty: y,
    hp: def.hp, maxHp: def.hp,
    cd: 0,                    // 决策冷却（秒）
    prodCd: 0,                // 产出冷却（游戏日）
    ownerId: opts.ownerId || null,  // 驯化动物归属
    homeX: x, homeY: y,       // 家/巢位置
    alive: true,
    deadDay: 0,
    // 伴侣动物专有
    bond: 0,                  // 与主人羁绊 0-100
    waitDoor: false           // 主人死后守门口
  };
  if (def.companion) {
    a.name = opts.name || pickLex(opts.game, kind === 'dog' ? 'petDog' : 'petCat', rng);
    a.pers = choice(rng, PET_PERS);
    a.bond = opts.bond || rint(rng, 20, 60);
  }
  return a;
}

// ---- 动物日推进（每日一次） ----
export function animalDailyTick(game, day) {
  const { animals, npcs, rng, log } = game;
  if (!animals.length) return;

  // 日龄推进（旧档无 ageDays 的惰性补成成年）
  for (const a of animals) {
    if (a.alive) a.ageDays = (a.ageDays == null ? ANIMAL_DEFS[a.kind].maturity : a.ageDays) + 1;
  }

  // 驯化动物产出（幼崽不产出）
  for (const a of animals) {
    if (!a.alive) continue;
    const def = ANIMAL_DEFS[a.kind];
    if (def.wild || !def.product || a.ageDays < def.maturity) continue;
    a.prodCd--;
    if (a.prodCd <= 0) {
      a.prodCd = def.prodDays;
      // 产物进镇库（简化：不单独建库存，直接进 stock）
      if (def.product === 'milk') game.stock.crop += 1; // 牛奶归入粮食
      else if (def.product === 'wool') game.stock.wood += 0; // 羊毛暂不入库（无对应字段）
      else if (def.product === 'egg') game.stock.crop += 1;
    }
  }

  // —— v4.5.0 性别层：繁殖——公的母的凑在一起才有下一代，种群不是凭空刷出来的 ——
  if (animals.length <= 60) {
    // 受孕：未孕成年母 10 格内有成年公同类
    for (const f of animals) {
      if (!f.alive || f.sex !== '母' || f.preg) continue;
      const def = ANIMAL_DEFS[f.kind];
      if (f.ageDays < def.maturity) continue;
      if (def.wild) {
        const cnt = animals.filter(o => o.alive && o.kind === f.kind).length;
        if (cnt >= (def.wildCap || 8)) continue;
      }
      const male = animals.find(o => o.alive && o.kind === f.kind && o.sex === '公'
        && o.ageDays >= def.maturity && Math.abs(o.x - f.x) + Math.abs(o.y - f.y) <= 10);
      if (!male) continue;
      if (!chance(rng, def.wild ? 0.10 : def.companion ? 0.06 : 0.08)) continue;
      f.preg = { daysLeft: def.gest, fatherId: male.id };
    }
    // 孕期推进 → 产仔（ownerId 继承；幼崽日龄 0）
    for (const f of animals) {
      if (!f.alive || !f.preg) continue;
      f.preg.daysLeft--;
      if (f.preg.daysLeft > 0) continue;
      const def = ANIMAL_DEFS[f.kind];
      const litter = rint(rng, def.litter[0], def.litter[1]);
      let bornN = 0;
      for (let i = 0; i < litter; i++) {
        if (animals.length > 64) break;
        animals.push(makeAnimal(f.kind, f.x + rint(rng, -2, 2), f.y + rint(rng, -2, 2), rng, { ownerId: f.ownerId, ageDays: 0, game }));
        bornN++;
      }
      f.preg = null;
      if (!def.wild && bornN) {
        const owner = npcs.find(o => o.id === f.ownerId);
        if (owner) { owner.memory(`家里的${def.name}下了崽`, day, 6); owner.moodDelta(3); }
        log(`${def.name}下了${bornN > 1 ? bornN + '只' : '一'}崽`, 'good');
      }
    }
  }

  // 伴侣动物羁绊日增
  for (const a of animals) {
    if (!a.alive || !ANIMAL_DEFS[a.kind].companion || !a.ownerId) continue;
    const owner = npcs.find(n => n.id === a.ownerId);
    if (owner && owner.alive !== false) {
      a.bond = Math.min(100, a.bond + rint(rng, 0, 2));
    }
  }

  // 野生动物自然死亡（低概率）
  for (const a of animals) {
    if (!a.alive || !ANIMAL_DEFS[a.kind].wild) continue;
    if (chance(rng, 0.005)) {
      a.alive = false;
      a.deadDay = day;
    }
  }

  // 清理死尸（3日后消失）
  for (let i = animals.length - 1; i >= 0; i--) {
    const a = animals[i];
    if (!a.alive && day - a.deadDay > 3) animals.splice(i, 1);
  }
}

// ---- 动物帧推进（每帧调用） ----
export function tickAnimals(game, dtReal, gmPerReal) {
  const { animals, npcs, world: w, rng, log, clock } = game;
  if (!animals.length) return;

  for (const a of animals) {
    if (!a.alive) continue;
    const def = ANIMAL_DEFS[a.kind];

    // 决策冷却
    a.cd -= dtReal;
    if (a.cd <= 0) {
      a.cd = rint(rng, 2, 6);
      // v4.5.0 性别层：求偶优先——成年公的往 12 格内可配的母的那边凑（求偶是行为，不是标签）
      let courted = false;
      if (a.sex === '公' && a.ageDays >= def.maturity && chance(rng, 0.4)) {
        const mate = animals.find(o => o.alive && o.kind === a.kind && o.sex === '母' && !o.preg
          && o.ageDays >= def.maturity && Math.abs(o.x - a.x) + Math.abs(o.y - a.y) <= 12);
        if (mate) { a.tx = mate.x; a.ty = mate.y; courted = true; }
      }
      if (!courted) {
      // 决定新目标
      if (isPredator(def)) {
        // 捕食者：找最近的可猎杀动物
        let best = null, bestD = 999;
        for (const b of animals) {
          if (!b.alive) continue;
          if (!canPreyOn(def, ANIMAL_DEFS[b.kind])) continue;
          const d = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
          if (d < bestD && d < 20) { bestD = d; best = b; }
        }
        if (best) { a.tx = best.x; a.ty = best.y; }
        else { a.tx = a.x + rint(rng, -6, 6); a.ty = a.y + rint(rng, -6, 6); }
      } else if (def.flee) {
        // 鹿/鸟：远离 NPC
        let nearest = null, nd = 999;
        for (const n of npcs) {
          if (n.inside) continue;
          const d = Math.abs(n.x - a.x) + Math.abs(n.y - a.y);
          if (d < nd) { nd = d; nearest = n; }
        }
        if (nearest && nd < 6) {
          // 逃跑方向
          const dx = a.x - nearest.x, dy = a.y - nearest.y;
          const len = Math.max(0.1, Math.abs(dx) + Math.abs(dy));
          a.tx = a.x + (dx / len) * 8;
          a.ty = a.y + (dy / len) * 8;
        } else {
          a.tx = a.x + rint(rng, -4, 4); a.ty = a.y + rint(rng, -4, 4);
        }
      } else if (def.companion && a.ownerId) {
        // 伴侣动物：跟着主人，或守门口
        const owner = npcs.find(n => n.id === a.ownerId);
        if (owner && owner.alive !== false) {
          a.waitDoor = false;
          a.tx = owner.x + rint(rng, -2, 2); a.ty = owner.y + rint(rng, -2, 2);
        } else {
          // 主人死了：守在家门口
          a.waitDoor = true;
          a.tx = a.homeX; a.ty = a.homeY;
        }
      } else {
        // 驯化动物：在农场附近闲逛
        a.tx = a.homeX + rint(rng, -4, 4); a.ty = a.homeY + rint(rng, -4, 4);
      }
      }
      // 孕母守家：快生了，不再乱跑（v4.5.0 性别层）
      if (a.preg) { a.tx = a.homeX + rint(rng, -1, 1); a.ty = a.homeY + rint(rng, -1, 1); }
      // 无限地图：不钳制固定边界，移动校验靠 chunkHas
    }

    // 移动（幼崽腿短，走得慢些）
    const sp = def.speed * dtReal * (a.ageDays < def.maturity ? 0.6 : 1);
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const d = Math.abs(dx) + Math.abs(dy);
    if (d > 0.05) {
      const t = Math.min(1, sp / d);
      const nx = a.x + dx * t, ny = a.y + dy * t;
      // 可通行校验（简化：不查 obj，只查地面和水）
      const fx2 = Math.floor(nx), fy2 = Math.floor(ny);
      if (chunkHas(w, fx2, fy2) && getGround(w, fx2, fy2) !== G.WATER) {
        a.x = nx; a.y = ny;
      }
    }

    // 捕食者袭击：接触判定
    if (isPredator(def)) {
      for (const b of animals) {
        if (!b.alive) continue;
        if (!canPreyOn(def, ANIMAL_DEFS[b.kind])) continue;
        if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 1.2) {
          b.hp -= 5 * dtReal;
          if (b.hp <= 0) {
            b.alive = false;
            b.deadDay = clock.totalDay;
            const owner = npcs.find(n => n.id === b.ownerId);
            if (owner) {
              owner.perceive('see', `${def.name}咬死了${ANIMAL_DEFS[b.kind].name}`, clock.totalDay, clock.hour, -6);
              owner.moodDelta(-6);
            }
            log(`${def.name}咬死了一头${ANIMAL_DEFS[b.kind].name}`, 'warn');
          }
        }
      }
    }
  }
}

// ---- 驯化动物购买/获得 ----
export function buyAnimal(game, npc, kind) {
  const def = ANIMAL_DEFS[kind];
  if (def.wild || def.companion) return null;
  // 价格：奶牛 30，绵羊 15，母鸡 5
  const price = kind === 'cow' ? 30 : kind === 'sheep' ? 15 : 5;
  // 涌现物理层：先掏自己的 purse，不够镇库垫付 → 记一笔欠镇上的账（垫付不是免单）
  const hold = ensureHold(npc);
  const fromPurse = Math.min(hold.purse, price);
  const short = price - fromPurse;
  if (short > 0 && game.stock.gold < short) return null;
  hold.purse -= fromPurse;
  if (short > 0) {
    game.stock.gold -= short;
    hold.owed.push({ to: 'town', res: 'gold', qty: short, day: game.clock.totalDay });
    if (hold.owed.length > HOLD_OWED_CAP) hold.owed.shift();
  }
  // 放在农田附近（workArea 是区域 id，不是坐标）
  const farm = game.world.areas && game.world.areas.find(v => v.id === 'farm');
  const fx = farm ? farm.x + Math.floor(farm.w / 2) : Math.floor(npc.x);
  const fy = farm ? farm.y + Math.floor(farm.h / 2) : Math.floor(npc.y);
  const a = makeAnimal(kind, fx + rint(game.rng, -3, 3), fy + rint(game.rng, -3, 3), game.rng, { ownerId: npc.id, game });
  a.prodCd = def.prodDays; // 即将产出
  game.animals.push(a);
  npc.memory(`买了一头${def.name}`, game.clock.totalDay, game.clock.hour);
  npc.moodDelta(3);
  game.log(`${npc.name}买了一头${def.name}`, 'good');
  return a;
}

// ---- 伴侣动物领养 ----
export function adoptPet(game, npc, kind) {
  const def = ANIMAL_DEFS[kind];
  if (!def.companion) return null;
  const a = makeAnimal(kind, npc.x + 1, npc.y + 1, game.rng, { ownerId: npc.id, game });
  a.homeX = npc.home ? npc.home.x : npc.x;
  a.homeY = npc.home ? npc.home.y : npc.y;
  game.animals.push(a);
  npc.memory(`收养了一只${def.name}，取名叫${a.name}`, game.clock.totalDay, game.clock.hour);
  npc.moodDelta(6);
  game.log(`${npc.name}收养了一只${def.name}「${a.name}」`, 'good');
  return a;
}

// ---- 野生动物生成（每日低概率） ----
export function spawnWild(game) {
  const { rng, world: w, animals, log } = game;
  // 狼：森林边缘，每日 2%
  if (chance(rng, 0.02)) {
    const x = rint(rng, 4, 20), y = rint(rng, 6, 30);
    if (chunkHas(w, x, y) && getGround(w, x, y) === G.GRASS) {
      animals.push(makeAnimal('wolf', x, y, rng));
      log('森林边缘出现了狼的踪迹', 'warn');
    }
  }
  // 鹿：森林，每日 3%
  if (chance(rng, 0.03)) {
    const x = rint(rng, 4, 20), y = rint(rng, 6, 30);
    if (chunkHas(w, x, y) && getGround(w, x, y) === G.GRASS) {
      animals.push(makeAnimal('deer', x, y, rng));
    }
  }
  // 鸟：任意草地，每日 5%
  if (chance(rng, 0.05)) {
    const x = rint(rng, 10, 118), y = rint(rng, 10, 118);
    if (chunkHas(w, x, y) && getGround(w, x, y) === G.GRASS) {
      animals.push(makeAnimal('bird', x, y, rng));
    }
  }
}

// ---- 宰杀驯化动物 ----
export function slaughterAnimal(game, npc, animal) {
  const def = ANIMAL_DEFS[animal.kind];
  if (def.wild || def.companion) return false;
  animal.alive = false;
  animal.deadDay = game.clock.totalDay;
  game.stock.crop += def.meat; // 肉归入粮食
  npc.memory(`宰了那头${def.name}`, game.clock.totalDay, game.clock.hour);
  npc.moodDelta(-2);
  game.log(`${npc.name}宰了一头${def.name}，得了${def.meat}斤肉`, '');
  return true;
}

// ---- 畜牧日推进（每日一次）：农夫添置牲畜 / 老人领养伴侣 / 缺粮宰杀 ----
// 分工不是任命的：有田的人养牲畜，孤独的老人养猫狗，没粮的时候牲畜变成肉
export function husbandryDaily(game, day) {
  const { npcs, animals, rng, stock } = game;
  // 1) 农夫买牲畜：手里有余钱、圈里还不挤（每人最多 3 头）
  for (const n of npcs) {
    if (n.job !== '农夫' || n.body.ageYears < 18) continue;
    const owned = animals.filter(a => a.alive && a.ownerId === n.id && !ANIMAL_DEFS[a.kind].companion);
    if (owned.length >= 3) continue;
    // 涌现物理层：个人 purse 或镇库，两头都紧才不买（买得起≠镇上有钱）
    if (stock.gold < 30 && ensureHold(n).purse < 30) continue;
    if (!chance(rng, 0.25)) continue;
    const kind = chance(rng, 0.5) ? 'chicken' : (chance(rng, 0.6) ? 'sheep' : 'cow');
    buyAnimal(game, n, kind);
  }
  // 2) 老人领养伴侣：身边没个活物陪着，日子太静了（每位老人最多 1 只）
  for (const n of npcs) {
    if (n.body.ageYears < 62) continue;
    const pet = animals.find(a => a.alive && a.ownerId === n.id && ANIMAL_DEFS[a.kind].companion);
    if (pet) continue;
    if (!chance(rng, 0.15)) continue;
    adoptPet(game, n, chance(rng, 0.5) ? 'dog' : 'cat');
  }
  // 3) 缺粮宰杀：粮仓见底，圈里的牲畜就变成锅里的肉
  if (stock.crop < 8) {
    for (const n of npcs) {
      if (n.job !== '农夫') continue;
      const owned = animals.filter(a => a.alive && a.ownerId === n.id && !ANIMAL_DEFS[a.kind].companion);
      if (owned.length < 1) continue;
      if (!chance(rng, 0.4)) continue;
      slaughterAnimal(game, n, owned[0]);
      break;   // 一天宰一头就够了
    }
  }
}
