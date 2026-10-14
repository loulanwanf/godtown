// events.js - 随机事件/神迹：陨石/宝箱/祝福/野猪/地震/集市/庙会等（环境无关，game 提供上下文）
import { O, G, rint, chance, choice } from './core.js';
import { getObj, setObj, getGround, worldToChunk, chunkOrigin, localIdx } from './chunk.js';
import { placeObj, removeObj, setGround, walkable, randPointInArea, nameAt } from './world.js';

export const EVENT_DEFS = [
  { id: 'meteor', name: '陨石坠落', desc: '一颗陨石砸进小镇，砸出陨石坑与珍贵矿脉' },
  { id: 'treasure', name: '宝箱天降', desc: '天上掉下几个宝箱，谁捡到归谁' },
  { id: 'bless', name: '丰收祝福', desc: '祝福全镇农田，所有作物立刻长一阶段' },
  { id: 'boar', name: '野猪侵扰', desc: '三头野猪冲进农田啃食作物，黄昏才散' },
  { id: 'quake', name: '地震', desc: '大地震动，岩层翻出新的矿石，居民受惊' },
  { id: 'merchant', name: '流浪商队', desc: '外来商队在集市摆摊一天，镇库进账' },
  { id: 'festival', name: '广场庙会', desc: '入夜后全镇聚在广场联欢，关系升温' },
  { id: 'aurora', name: '极光之夜', desc: '夜空出现极光，镇上人心变得柔软' },
  { id: 'drought', name: '旱魃过境', desc: '烈日炙烤两日，作物不再自然生长' }
];

export function runEvent(game, id) {
  const { world: w, npcs, clock, stock, rng, log, fx } = game;
  const day = clock.totalDay, hour = clock.hour;
  // 感知广播：事件不是系统通知，是被看见/听见的。
  // 传 at：近处亲眼看见（情绪全额），稍远听见动静（情绪减半），loud 时巨响传得更远；
  // 不传 at（全镇性）：室外看见，室内只听见动静。
  const broadcast = (text, mood, opt) => {
    opt = opt || {};
    const at = opt.at;
    for (const n of npcs) {
      let kind, mul;
      if (at) {
        const d = Math.abs(Math.floor(n.x) - at.x) + Math.abs(Math.floor(n.y) - at.y);
        if (!n.inside && d <= 12) { kind = 'see'; mul = 1; }
        else if (d <= 24 || opt.loud) { kind = 'hear'; mul = 0.5; }
        else continue; // 太远没察觉，事后靠聊天传开
      } else {
        kind = n.inside ? 'hear' : 'see';
        mul = n.inside ? 0.5 : 1;
      }
      n.perceive(kind, text, day, hour, mood ? Math.round(mood * mul) : 0);
    }
  };

  switch (id) {
    case 'meteor': {
      const pt = randPointInArea(w, choice(rng, ['plaza', 'farm', 'forest', 'market']), rng)
        || randPointInArea(w, 'plaza', rng);
      if (!pt) return false;
      fx.meteor(pt.x, pt.y, () => {
        removeObj(w, pt.x, pt.y);
        setGround(w, pt.x, pt.y, G.STONE);
        placeObj(w, pt.x, pt.y, O.CRATER);
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
        let ores = 0;
        for (const d of dirs) {
          const x = pt.x + d[0], y = pt.y + d[1];
          if (!walkable(w, x, y)) continue;
          const r = rng();
          if (r < 0.5) { placeObj(w, x, y, r < 0.25 ? O.GOLD : (r < 0.4 ? O.IRON : O.COPPER)); ores++; }
        }
        broadcast('天上掉下来一颗陨石，砸出了个大坑', -3, { at: pt, loud: true });
        for (const n of npcs) if (n.job === '铁匠') { n.moodDelta(4); n.memory('陨石里有好矿！发财了', day, hour); }
        log(`陨石坠落在${nameAt(w, pt.x, pt.y)}，砸出${ores}条矿脉`, 'hl');
        fx.shake(8);
      });
      return true;
    }
    case 'treasure': {
      let placed = 0;
      for (let k = 0; k < 30 && placed < rint(rng, 3, 6); k++) {
        const pt = randPointInArea(w, choice(rng, ['plaza', 'farm', 'forest', 'market', 'river']), rng);
        if (pt && getObj(w, pt.x, pt.y) === O.NONE) { placeObj(w, pt.x, pt.y, O.CHEST); placed++; }
      }
      broadcast('天上掉下来几个宝箱', 2, { loud: true });
      log(`天降${placed}个宝箱，居民们奔走相告`, 'hl');
      return true;
    }
    case 'bless': {
      let n = 0;
      for (const c of w.ws.iterNonVirgin()) {
        for (const [li, crop] of c.crops) {
          if (crop.stage < 3) {
            crop.stage++; crop.watered = true;
            if (c.obj[li] >= O.CROP0 && c.obj[li] <= O.CROP3) c.obj[li] = O.CROP0 + crop.stage;
            n++; c.dirty = true;
          }
        }
      }
      for (const npc of npcs) if (npc.job === '农夫') { npc.moodDelta(6); npc.memory('庄稼肉眼可见地长高了一截，神迹！', day, hour); }
      broadcast('今天田里的作物突然疯长', 1);
      log(`丰收祝福降临，${n}块农田的作物拔节生长`, 'good');
      return true;
    }
    case 'boar': {
      if (game.boars.length) return false;
      for (let i = 0; i < 3; i++) {
        const pt = randPointInArea(w, 'farm', rng);
        if (pt) game.boars.push({ x: pt.x, y: pt.y, tx: pt.x, ty: pt.y, cd: 0 });
      }
      for (const npc of npcs) {
        if (npc.job === '农夫') { npc.moodDelta(-4); npc.memory('野猪拱进田里了！得想想法子', day, hour); }
      }
      broadcast('南郊传来野猪的嚎叫', -1, { loud: true });
      log('三头野猪冲进了南郊农田', 'warn');
      return true;
    }
    case 'quake': {
      let exposed = 0;
      for (let k = 0; k < 60; k++) {
        const x = rint(rng, 49, 67), y = rint(rng, 4, 18);
        if (getGround(w, x, y) === G.DIRT && getObj(w, x, y) === O.NONE && chance(rng, 0.4)) {
          const r = rng();
          setObj(w, x, y, r < 0.6 ? O.ROCK : (r < 0.8 ? O.COPPER : (r < 0.95 ? O.IRON : O.GOLD)));
          exposed++;
        }
      }
      broadcast('地动山摇', -5, { at: { x: 58, y: 11 }, loud: true });
      for (const npc of npcs) if (npc.job === '铁匠') { npc.moodDelta(3); npc.memory('震出了新的矿脉', day, hour); }
      log(`地震！北岭矿区翻出${exposed}处新矿露头`, 'warn');
      fx.shake(14);
      return true;
    }
    case 'merchant': {
      // 集市多两个临时摊 + 镇库进账 + 居民买买买
      for (const npc of npcs) {
        if (npc.job === '商人') { npc.moodDelta(5); npc.memory('外来商队来了，热闹得很', day, hour); }
      }
      broadcast('集市来了外来商队', 0);
      stock.gold += rint(rng, 20, 60);
      log('流浪商队进驻集市街，今天镇库进账不少', 'good');
      return true;
    }
    case 'festival': {
      // 全镇傍晚去广场联欢
      game.festivalUntilMin = clock.min >= 18 * 60 ? 4 * 60 : (18 * 60 - clock.min) + 4 * 60;
      broadcast('今晚广场有庙会', 0, { loud: true });
      log('今晚镇中心广场将举办庙会，居民们纷纷赴会', 'hl');
      return true;
    }
    case 'aurora': {
      fx.aurora = 1;
      broadcast('夜空里泛起了绿色的光带，美极了', 6);
      log('极光出现在小镇上空', 'hl');
      return true;
    }
    case 'drought': {
      game.droughtDays = 2;
      broadcast('太阳毒得很，田都快裂了', -2);
      for (const npc of npcs) if (npc.job === '农夫') { npc.moodDelta(-4); npc.memory('再不下雨，庄稼要完', day, hour); }
      log('旱魃过境，未来两天作物停止生长', 'warn');
      return true;
    }
    default:
      return false;
  }
}

// 每日自动事件（清晨调用）——节奏：大部分时候什么都不发生
export function maybeAutoEvent(game) {
  if (!chance(game.rng, 0.22)) return null;
  const pool = EVENT_DEFS.filter(e => e.id !== 'festival' && e.id !== 'boar');
  const ev = choice(game.rng, pool);
  const ok = runEvent(game, ev.id);
  return ok ? ev.id : null;
}

// 野猪推进（game loop 每帧调用）
export function tickBoars(game, dtReal, gmPerReal) {
  const { world: w, rng, npcs, log, clock } = game;
  for (const b of game.boars) {
    b.cd -= dtReal;
    if (b.cd <= 0) {
      b.cd = rint(rng, 2, 5);
      const dx = rint(rng, -4, 4), dy = rint(rng, -4, 4);
      b.tx = b.x + dx; b.ty = b.y + dy;
    }
    const sp = 1.1 * dtReal;
    const dx = b.tx - b.x, dy = b.ty - b.y;
    const d = Math.abs(dx) + Math.abs(dy);
    if (d > 0.01) {
      const t = Math.min(1, sp / d);
      b.x += dx * t; b.y += dy * t;
    }
    // 啃作物
    const fx2 = Math.floor(b.x), fy2 = Math.floor(b.y);
    const o = getObj(w, fx2, fy2);
    if (o >= O.CROP0 && o <= O.CROP3 && chance(rng, 0.03)) {
      setObj(w, fx2, fy2, O.NONE);
      const [cx, cy] = worldToChunk(fx2, fy2);
      const c = w.ws.get(cx, cy);
      if (c) { const { x0, y0 } = chunkOrigin(cx, cy); c.crops.delete(localIdx(fx2 - x0, fy2 - y0)); c.dirty = true; }
      const farmer = npcs.find(n => n.job === '农夫' && Math.abs(n.x - fx2) + Math.abs(n.y - fy2) < 15);
      if (farmer) { farmer.perceive('see', '野猪正在啃庄稼', clock.totalDay, clock.hour, -2); if (log) log(`野猪啃了${farmer.name}家的庄稼`, 'warn'); }
    }
  }
  // 黄昏散去
  if (game.boars.length && (clock.hour >= 19 || clock.hour < 6)) {
    game.boars = [];
    if (log) log('野猪们闹够了，回山里去了', '');
  }
}
