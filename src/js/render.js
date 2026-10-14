// render.js - Canvas 像素渲染（CC0 图集版）：地面/过渡/物件立面/居民/天气/四段色温/局部光/小地图
import { TILE, G, O, hash2, clamp } from './core.js';
import { CHUNK, worldToChunk, chunkOrigin, localIdx, getGround, getObj, chunkHas } from './chunk.js';
import { FOG, isSeen } from './fog.js';
import { PAL, SHADOW, DAY_TINTS } from './palette.js';
import { bodyConstraints } from './body.js';
import { stageOf } from './life.js';

export class Renderer {
  constructor(canvas, miniMap, tileset) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.miniMap = miniMap;
    this.mctx = miniMap.getContext('2d');
    this.ts = tileset;
    this.cam = { x: 22, y: 10, zoom: 2.4 };
    this.rainDrops = [];
    this.snowFlakes = [];
    this.meteorFx = null;
    this.shakeAmt = 0;
    this.aurora = false;
    this.hoverTile = null;
    this.mapDirty = true;
    this._mapCanvas = null;
    this._lastT = 0;
    this.time = 0;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(r.width * dpr);
    this.canvas.height = Math.floor(r.height * dpr);
    this.applyRenderStyle(this._renderStyle || 'smooth');
    if (!this._mapCanvas) {
      this._mapCanvas = document.createElement('canvas');
      this._mapCanvas.width = 152; this._mapCanvas.height = 152;
    }
  }

  // 渲染风格：smooth=双线性抗锯齿（细腻无像素块），pixel=硬边最近邻（复古像素）
  setRenderStyle(style) {
    this._renderStyle = style === 'pixel' ? 'pixel' : 'smooth';
    this.applyRenderStyle(this._renderStyle);
  }
  applyRenderStyle(style) {
    const smooth = style === 'smooth';
    this.ctx.imageSmoothingEnabled = smooth;
    this.mctx.imageSmoothingEnabled = false;   // 小地图始终硬边，避免糊
    document.body.classList.toggle('render-smooth', smooth);
    document.body.classList.toggle('render-pixel', !smooth);
  }

  // 屏幕像素 ↔ 地块坐标
  screenToTile(px, py, rect) {
    const dpr = window.devicePixelRatio || 1;
    const x = (px - rect.left) * dpr, y = (py - rect.top) * dpr;
    const t = TILE * this.cam.zoom;
    return { x: this.cam.x + x / t, y: this.cam.y + y / t };
  }
  tileToScreen(tx, ty, rect) {
    const dpr = window.devicePixelRatio || 1;
    const ts = TILE * this.cam.zoom;
    return {
      left: rect.left + (tx - this.cam.x) * ts / dpr,
      top: rect.top + (ty - this.cam.y) * ts / dpr
    };
  }

  // ---------- 主绘制 ----------
  draw(game, dtReal) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    this.time += dtReal;
    const T = this.ts;
    const { world: w, clock, weather } = game;
    this.raining = weather.raining;
    if (weather.flash > 0) weather.flash = Math.max(0, weather.flash - dtReal * 4);

    let shx = 0, shy = 0;
    if (this.shakeAmt > 0) {
      this.shakeAmt = Math.max(0, this.shakeAmt - dtReal * 20);
      shx = (Math.random() - 0.5) * this.shakeAmt;
      shy = (Math.random() - 0.5) * this.shakeAmt;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = this._renderStyle !== 'pixel';
    ctx.fillStyle = PAL.uiBg;
    ctx.fillRect(0, 0, W, H);
    const zoom = this.cam.zoom, ts = TILE * zoom;
    ctx.setTransform(zoom, 0, 0, zoom, -this.cam.x * ts + shx, -this.cam.y * ts + shy);
    ctx.imageSmoothingEnabled = this._renderStyle !== 'pixel';

    const x0 = Math.floor(this.cam.x) - 1;
    const y0 = Math.floor(this.cam.y) - 1;
    const x1 = Math.ceil(this.cam.x + W / ts) + 1;
    const y1 = Math.ceil(this.cam.y + H / ts) + 1;

    // ===== 层1 地面（按 chunk 迭代：先取 chunk 引用，chunk 内循环直接 c.ground[localIdx]） =====
    this.forEachVisibleTile(w, x0, y0, x1, y1, (c, lx, ly, x, y, i) => {
      const g = c.ground[i];
      const px = x * TILE, py = y * TILE;
      this.drawGround(T, ctx, g, x, y, px, py);
    });
    // 地面 1px 过渡（草-硬地/水-沙）：chunk 内直接读，跨 chunk 邻位用 getGround
    this.forEachVisibleTile(w, x0, y0, x1, y1, (c, lx, ly, x, y, i) => {
      const g = c.ground[i];
      const px = x * TILE, py = y * TILE;
      const ng = (dx, dy) => {
        const nx = x + dx, ny = y + dy;
        const ncx = Math.floor(nx / CHUNK), ncy = Math.floor(ny / CHUNK);
        if (ncx === c.cx && ncy === c.cy) return c.ground[localIdx(nx - ncx * CHUNK, ny - ncy * CHUNK)];
        return getGround(w, nx, ny);
      };
      this.drawTransitions(ctx, g, ng, x, y, px, py);
    });

    // ===== 层2 建筑足迹投影 =====
    for (const h of w.houses) {
      if (h.x > x1 + 2 || h.y > y1 + 2 || h.x + h.w < x0 - 2 || h.y + h.h < y0 - 2) continue;
      ctx.fillStyle = SHADOW;
      ctx.fillRect((h.x + h.w) * TILE + 2, h.y * TILE + 4, 3, h.h * TILE - 2);
      ctx.fillRect(h.x * TILE + 4, (h.y + h.h) * TILE + 1, h.w * TILE - 4, 3);
    }

    // ===== 层3 物件（行序遮挡） =====
    this.forEachVisibleTile(w, x0, y0, x1, y1, (c, lx, ly, x, y, i) => {
      const o = c.obj[i];
      if (!o) return;
      this.drawObj(T, ctx, game, w, o, x, y);
    });

    // ===== 层4 野猪 =====
    for (const b of game.boars) {
      ctx.drawImage(T.syn.boar, Math.floor(b.x * TILE) - 9, Math.floor(b.y * TILE) - 6);
    }

    // ===== 层4.5 动物（v1.8.0 世界层：驯化/伴侣/野生） =====
    if (game.animals) {
      for (const a of game.animals) {
        if (!a.alive) continue;
        const spr = T.syn[a.kind];
        if (!spr) continue;
        ctx.drawImage(spr, Math.floor(a.x * TILE) - Math.floor(spr.width / 2), Math.floor(a.y * TILE) - spr.height + 4);
      }
    }

    // ===== 层4.6 聚落营帐（v4.5.0 无限世界：有人的非起源聚落在地图上有个看得见的窝） =====
    if (game.settlements) {
      for (const s of game.settlements) {
        if (s.abandoned || s.origin || !s.population) continue;
        const px = Math.floor(s.center.x * TILE) - 6, py = Math.floor(s.center.y * TILE) - 9;
        ctx.fillStyle = '#7a5a3a';   // 帐面
        ctx.beginPath();
        ctx.moveTo(px + 6, py);
        ctx.lineTo(px + 12, py + 9);
        ctx.lineTo(px, py + 9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#3a2a1c';   // 门口
        ctx.fillRect(px + 5, py + 5, 3, 4);
        // 炊烟：有人住的营地才有烟火气
        const sm = (this.time * 0.3 + s.center.x * 0.13) % 1;
        ctx.globalAlpha = 0.5 * (1 - sm);
        ctx.fillStyle = '#cfd3d8';
        ctx.fillRect(px + 8, py - 2 - Math.round(sm * 4), 2, 2);
        ctx.globalAlpha = 1;
      }
    }

    // ===== 层4.7 离镇者（v4.5.0 无限世界：走出小镇的人还在世界上走，要看得见） =====
    const labels = [];
    if (game.wanderers) {
      for (const wn of game.wanderers) this.drawNpcBody(T, ctx, wn, labels);
    }

    // ===== 层5 居民（世界层只画精灵，文字收到屏幕层） =====
    for (const n of game.npcs) {
      if (n.inside) continue;
      this.drawNpcBody(T, ctx, n, labels);
    }

    // ===== 层6 世界空间氛围光（夜） =====
    const hour = clock.hour;
    const night = clock.nightAmount();
    if (night > 0.25) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 路灯暖光
      this.forEachVisibleTile(w, x0, y0, x1, y1, (c, lx, ly, x, y, i) => {
        if (c.obj[i] === O.LAMP) this.glow(ctx, x * TILE + 8, y * TILE + 5, 20, `rgba(255,176,80,${0.5 * night})`);
      });
      // 窗户暖光
      for (const h of w.houses) {
        if (h.x > x1 + 2 || h.y > y1 + 2 || h.x + h.w < x0 - 2 || h.y + h.h < y0 - 2) continue;
        for (const wx of [h.x + 1, h.x + h.w - 2]) {
          this.glow(ctx, wx * TILE + 8, (h.y + 3) * TILE + 8, 15, `rgba(255,176,80,${0.4 * night})`);
        }
      }
      // 喷泉微光
      this.forEachVisibleTile(w, x0, y0, x1, y1, (c, lx, ly, x, y, i) => {
        if (c.obj[i] === O.FOUNTAIN && getObj(w, x, y - 1) !== O.FOUNTAIN && getObj(w, x - 1, y) !== O.FOUNTAIN)
          this.glow(ctx, x * TILE + 8, y * TILE + 8, 22, `rgba(120,190,255,${0.35 * night})`);
      });
      // 萤火虫
      this.forEachVisibleTile(w, x0, y0, x1, y1, (c, lx, ly, x, y, i) => {
        if (c.ground[i] !== G.GRASS || c.obj[i] !== O.NONE) return;
        const ph = Math.sin(this.time * 2.2 + hash2(x, y) * 40);
        if (hash2((x * 3 + ((this.time * 0.4) | 0)) & 255, y * 7) > 0.985 && ph > 0.55) {
          ctx.fillStyle = `rgba(248,233,140,${0.55 + ph * 0.4})`;
          ctx.fillRect(x * TILE + 4 + ((hash2(x, y * 3) * 9) | 0), y * TILE + 4 + ((hash2(x * 5, y) * 9) | 0), 1, 1);
        }
      });
      ctx.restore();
    }

    // ===== 层7 炊烟（饭点） =====
    if ((hour >= 6 && hour < 9) || (hour >= 17 && hour < 20.5)) {
      w.houses.forEach((h, hi) => {
        if (h.x > x1 + 2 || h.y > y1 + 2 || h.x + h.w < x0 - 2 || h.y + h.h < y0 - 2) return;
        const sxh = h.x * TILE + 4, sy = h.y * TILE - 2;
        for (let k = 0; k < 3; k++) {
          const p = (this.time * 0.5 + hi * 0.37 + k * 0.9) % 3;
          ctx.fillStyle = `rgba(220,220,225,${0.32 - p * 0.09})`;
          ctx.fillRect(sxh + Math.round(Math.sin(p * 3 + hi) * 2) - k, sy - p * 7, 2, 2);
        }
      });
    }

    // ===== 层7.5 探索迷雾（v4.5.1）：没到过的地方，世界对玩家也是黑的 =====
    if (game.fog && FOG.enabled) {
      ctx.fillStyle = 'rgba(10,12,16,0.92)';
      this.forEachVisibleTile(w, x0, y0, x1, y1, (c, lx, ly, x, y) => {
        if (!isSeen(game.fog, x, y)) ctx.fillRect(x * TILE - 1, y * TILE - 1, TILE + 2, TILE + 2);
      });
    }

    // ===== 屏幕空间层 =====
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 天气粒子
    if (weather.raining) this.drawRain(ctx, W, H, dtReal, weather.stormy ? 1.6 : 1);
    if (weather.snowing) this.drawSnow(ctx, W, H, dtReal);

    // 四段色温（按小时插值）
    const tint = this.tintAt(hour);
    if (tint[3] > 0.001) {
      ctx.fillStyle = `rgba(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0},${tint[3].toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (weather.precipitating) {
      ctx.fillStyle = `rgba(30,40,60,${weather.stormy ? 0.2 : 0.1})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (weather.flash > 0) {
      ctx.fillStyle = `rgba(240,248,255,${(weather.flash * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.aurora && night > 0.5) this.drawAurora(ctx, W, H);
    if (this.aurora && night <= 0.5) this.aurora = false;

    // 陨石
    if (this.meteorFx) {
      const m = this.meteorFx;
      const t = (performance.now() - m.t0) / m.dur;
      if (t >= 1) {
        const cb = m.cb; this.meteorFx = null;
        cb();
      } else {
        const tx = m.x * ts - this.cam.x * ts, ty = m.y * ts - this.cam.y * ts;
        const sx = tx + W * 0.5 * (1 - t) + 200 * (1 - t);
        const sy = ty - H * (1 - t);
        ctx.strokeStyle = 'rgba(255,200,80,0.9)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(sx + 60, sy - 60); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.fillStyle = 'rgba(255,160,60,1)';
        ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 6.29); ctx.fill();
      }
    }

    // 名牌/气泡（像素字体，屏幕空间恒定清晰）
    this.drawLabels(ctx, labels, ts);

    if (game.bannerUntil && performance.now() > game.bannerUntil) {
      game.bannerUntil = 0;
      const el = document.getElementById('eventBanner');
      if (el) el.classList.add('hidden');
    }

    this.drawMini(game);
  }

  // ---------- 可见 tile 遍历（chunk 迭代：先取 chunk 引用，chunk 内循环直接数组访问） ----------
  forEachVisibleTile(w, x0, y0, x1, y1, fn) {
    const cx0 = Math.floor(x0 / CHUNK), cy0 = Math.floor(y0 / CHUNK);
    const cx1 = Math.floor(x1 / CHUNK), cy1 = Math.floor(y1 / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = w.ws.get(cx, cy);
        if (!c) continue;  // 未生成 chunk 跳过
        const ox = cx * CHUNK, oy = cy * CHUNK;
        for (let ly = 0; ly < CHUNK; ly++) {
          const wy = oy + ly;
          if (wy < y0 || wy > y1) continue;
          for (let lx = 0; lx < CHUNK; lx++) {
            const wx = ox + lx;
            if (wx < x0 || wx > x1) continue;
            fn(c, lx, ly, wx, wy, localIdx(lx, ly));
          }
        }
      }
    }
  }

  // ---------- 地面 ----------
  drawGround(T, ctx, g, x, y, px, py) {
    const hv = (hash2(x, y) * 8) | 0;
    switch (g) {
      case G.GRASS: T.blitName(ctx, 'grass', hv % 3, px, py); break;
      case G.DIRT: T.blitName(ctx, 'dirt', hv % 3, px, py); break;
      case G.SOIL:
        ctx.drawImage(T.syn.soils[hv & 1], px, py);
        break;
      case G.PATH: T.blitName(ctx, 'path', hv % 4, px, py); break;
      case G.STONE: T.blitName(ctx, 'stone', 0, px, py); break;
      case G.SAND: T.blitName(ctx, 'sand', hv % 6, px, py); break;
      case G.BRIDGE: T.blitName(ctx, 'plank', hv % 4, px, py); break;
      case G.WATER: {
        // rg0 纯色底 + 程序波纹（两条短横高光随时间平移、跨格回绕）
        T.blitName(ctx, 'water', 0, px, py);
        ctx.fillStyle = 'rgba(207,232,255,0.5)';
        const ph = hash2(x * 5 + 3, y * 11 + 7);
        for (const [wy, sp, len, a] of [[4, 5, 3, 0], [11, -4, 2, 9]]) {
          const wx = Math.floor((this.time * sp + ph * 16 + a) % 16 + 16) % 16;
          for (let i = 0; i < len; i++) ctx.fillRect(px + ((wx + i) % 16), py + wy, 1, 1);
        }
        break;
      }
      default: T.blitName(ctx, 'grass', 0, px, py);
    }
  }

  // 1px 咬合过渡（只在特定地类边界撒点）
  drawTransitions(ctx, g, ng, x, y, px, py) {
    const dot = (color, pts) => {
      ctx.fillStyle = color;
      for (const [dx, dy] of pts) {
        if (hash2(x * 13 + dx * 7 + dy * 3, y * 29 + dy * 11) > 0.45) ctx.fillRect(px + dx, py + dy, 1, 1);
      }
    };
    if (g === G.GRASS) {
      const hard = ng(1, 0);
      const soilLike = (t) => t === G.PATH || t === G.DIRT || t === G.SOIL || t === G.SAND;
      if (soilLike(hard)) dot(PAL.dirtLo, [[15, 3], [15, 7], [15, 11], [15, 14]]);
      if (soilLike(ng(-1, 0))) dot(PAL.dirtLo, [[0, 3], [0, 7], [0, 11], [0, 14]]);
      if (soilLike(ng(0, 1))) dot(PAL.dirtLo, [[3, 15], [7, 15], [11, 15], [14, 15]]);
      if (soilLike(ng(0, -1))) dot(PAL.dirtLo, [[3, 0], [7, 0], [11, 0], [14, 0]]);
      if (hard === G.STONE || ng(-1, 0) === G.STONE) dot(PAL.stoneLo, hard === G.STONE ? [[15, 4], [15, 10]] : [[0, 4], [0, 10]]);
      if (ng(0, 1) === G.STONE) dot(PAL.stoneLo, [[4, 15], [10, 15]]);
      if (ng(0, -1) === G.STONE) dot(PAL.stoneLo, [[4, 0], [10, 0]]);
    } else if (g === G.WATER) {
      // 水岸白浪
      if (ng(0, -1) === G.SAND) { ctx.fillStyle = PAL.foam; if (hash2(x, y * 3) > 0.4) ctx.fillRect(px + 3 + ((hash2(x, y) * 8) | 0), py, 2, 1); }
      if (ng(0, 1) === G.SAND) { ctx.fillStyle = PAL.foam; if (hash2(x * 7, y) > 0.4) ctx.fillRect(px + 3 + ((hash2(x * 11, y) * 8) | 0), py + 15, 2, 1); }
      if (ng(-1, 0) === G.SAND) { ctx.fillStyle = PAL.foam; if (hash2(x * 3, y * 5) > 0.5) ctx.fillRect(px, py + 4 + ((hash2(x, y) * 8) | 0), 1, 2); }
      if (ng(1, 0) === G.SAND) { ctx.fillStyle = PAL.foam; if (hash2(x * 5, y * 9) > 0.5) ctx.fillRect(px + 15, py + 4 + ((hash2(x, y) * 8) | 0), 1, 2); }
      // 雨天涟漪
      if (this.raining && hash2((x * 7 + ((this.time * 2) | 0)) & 255, y * 13) > 0.975) {
        ctx.fillStyle = 'rgba(220,235,255,0.7)';
        ctx.fillRect(px + 5 + ((hash2(x, y) * 7) | 0), py + 5 + ((hash2(x * 3, y) * 7) | 0), 3, 1);
      }
    }
  }

  // ---------- 物件 ----------
  drawObj(T, ctx, game, w, o, x, y) {
    const px = x * TILE, py = y * TILE;
    const hv = hash2(x * 7 + 3, y * 13 + 5);
    switch (o) {
      case O.TREE: {
        const r = hv;
        let name = 'treeGreen';
        if (r > 0.88) name = 'treeYellow';
        else if (r > 0.68) name = 'treeSmallG';
        const sway = Math.sin(this.time * 1.6 + hash2(x, y) * 12) > 0.7 ? 1 : 0;
        T.blitName(ctx, name, 0, px - sway, py);
        break;
      }
      case O.ROCK: ctx.drawImage(T.syn.rocks[(hv * 3) | 0], px, py); break;
      case O.COPPER: ctx.drawImage(T.syn.copper, px, py); break;
      case O.IRON: ctx.drawImage(T.syn.iron, px, py); break;
      case O.GOLD: ctx.drawImage(T.syn.gold, px, py); break;
      case O.WALL: this.drawHouseWall(T, ctx, w, x, y); break;
      case O.DOOR: T.blitName(ctx, 'doorWood', 0, px, py); break;
      case O.FENCE: this.drawFence(T, ctx, w, x, y, px, py); break;
      case O.FOUNTAIN: {
        // 2x2 中心只画一次，放大到 32
        const up = getObj(w, x, y - 1) === O.FOUNTAIN;
        const lf = getObj(w, x - 1, y) === O.FOUNTAIN;
        if (!up && !lf) {
          ctx.fillStyle = SHADOW; ctx.fillRect(px - 4, py + 12, 30, 5);
          T.blitName(ctx, 'fountain', 0, px - 8, py - 8, 32, 32);
          // 顶部水花
          const f2 = Math.floor(this.time * 3 + x) % 2;
          ctx.fillStyle = PAL.foam;
          ctx.fillRect(px + 6 + f2, py - 2, 1, 1); ctx.fillRect(px + 10 - f2, py - 3, 1, 1);
        }
        break;
      }
      case O.FLOWER: {
        const r = hv;
        T.blitName(ctx, r < 0.6 ? 'flowerRed' : (r < 0.82 ? 'flowerWhite' : 'flowerBlue'), 0, px, py);
        break;
      }
      case O.BUSH: T.blitName(ctx, 'bush', 0, px, py); break;
      case O.CHEST: ctx.fillStyle = SHADOW; ctx.fillRect(px + 2, py + 13, 12, 2); T.blit(ctx, 'dg', 89, px, py - 1); break;
      case O.STALL:
        ctx.fillStyle = SHADOW; ctx.fillRect(px + 2, py + 14, 12, 2);
        T.blitName(ctx, 'stall', (hv * 3) | 0, px, py);
        break;
      case O.CRATER: T.blitName(ctx, 'crater', 0, px, py); break;
      case O.STUMP:
        ctx.fillStyle = SHADOW; ctx.fillRect(px + 4, py + 13, 9, 2);
        ctx.drawImage(T.syn.stump, px, py);
        break;
      case O.SHED: {
        // 积木营造：落成时定的墙色/顶色变体（建筑方言），没 style 的用默认
        ctx.fillStyle = SHADOW; ctx.fillRect(px + 2, py + 15, 13, 2);
        const st = game.styles && game.styles.get(x + ',' + y);
        ctx.drawImage(T.syn.shedVars && st ? T.syn.shedVars[st.v % 3] : T.syn.shed, px, py - 4);
        break;
      }
      case O.BENCH: ctx.drawImage(T.syn.bench, px, py); break;
      case O.LAMP:
        T.blitName(ctx, 'lamp', 0, px, py - 1);
        if (this._isNight(game)) {
          ctx.fillStyle = 'rgba(255,190,90,0.9)';
          ctx.fillRect(px + 7, py + 1, 2, 3);
        }
        break;
      case O.SITE: {
        ctx.drawImage(T.syn.site, px, py);
        const plan = (game.plans || []).find(p2 => p2.x === x && p2.y === y && !p2.done);
        if (plan) {
          // 材料没到齐，工人只能等（物质层·施工）：进度条灰着，料齐才见琥珀色
          const lack = plan.needMat && Object.entries(plan.needMat).some(([r, n]) => (plan.delivered[r] || 0) < n);
          const wb = Math.floor(12 * clamp(plan.progress / plan.need, 0, 1));
          ctx.fillStyle = 'rgba(15,17,21,0.6)'; ctx.fillRect(px + 2, py - 3, 12, 2);
          ctx.fillStyle = lack ? PAL.stoneLo : PAL.flameHi; ctx.fillRect(px + 2, py - 3, wb, 2);
        }
        break;
      }
      case O.BARREL: ctx.fillStyle = SHADOW; ctx.fillRect(px + 3, py + 14, 10, 2); T.blitName(ctx, 'barrel', 0, px, py); break;
      case O.LOGPILE: ctx.fillStyle = SHADOW; ctx.fillRect(px + 2, py + 14, 12, 2); T.blitName(ctx, 'logpile', 0, px, py); break;
      case O.ANVIL: ctx.fillStyle = SHADOW; ctx.fillRect(px + 3, py + 14, 10, 2); T.blitName(ctx, 'anvil', 0, px, py); break;
      case O.GRAVE:
        // 坟茔：镇上有人在这里长眠（生命层）
        ctx.fillStyle = SHADOW; ctx.fillRect(px + 3, py + 13, 10, 2);
        T.blitName(ctx, 'grave', 0, px, py);
        break;
      case O.LOG:
        // 原木躺地上（采集后的实体，等着有人来搬）
        ctx.drawImage(T.syn.log, px, py);
        break;
      case O.BARN:
        ctx.fillStyle = SHADOW; ctx.fillRect(px + 2, py + 15, 13, 2);
        ctx.drawImage(T.syn.barn, px, py - 4);
        break;
      case O.WORKSHOP:
        ctx.fillStyle = SHADOW; ctx.fillRect(px + 2, py + 15, 13, 2);
        ctx.drawImage(T.syn.workshop, px, py - 4);
        break;
      case O.RUIN:
        // 废墟：没人修，慢慢垮（物质层·维护）
        ctx.drawImage(T.syn.ruin, px, py);
        break;
      case O.CABIN:
        ctx.fillStyle = SHADOW; ctx.fillRect(px + 2, py + 15, 13, 2);
        ctx.drawImage(T.syn.cabin, px, py - 4);
        break;
      default:
        if (o >= O.CROP0 && o <= O.CROP3) {
          ctx.drawImage(T.syn.crops[o - O.CROP0], px, py);
        }
    }
  }

  // 房屋立面（6x5）：顶两行为红瓦+山墙，其下为三连木墙（72左/73中/75右），窗在墙首行
  drawHouseWall(T, ctx, w, x, y) {
    const h = w.houses.find(hh => x >= hh.x && x < hh.x + hh.w && y >= hh.y && y < hh.y + hh.h);
    if (!h) { T.blitName(ctx, 'wallMine', 0, x * TILE, y * TILE); return; }
    const px = x * TILE, py = y * TILE;
    const wx = x - h.x;
    if (y < h.y + 2) {
      // 瓦屋顶（山墙格先打底瓦再盖山墙件）
      T.blitName(ctx, 'roofRed', wx % 2, px, py);
      // 檐口暗线
      if (y === h.y + 1) { ctx.fillStyle = PAL.roofRedLo; ctx.fillRect(px, py + 15, 16, 1); }
      // 山墙：背排左右上角
      if (y === h.y && (x === h.x || x === h.x + h.w - 1)) T.blitName(ctx, 'roofRedGable', 0, px, py);
    } else {
      // 三连墙板拼成一面整墙，避免每格像独立小屋
      if (wx === 0) T.blitName(ctx, 'wallWood', 0, px, py);
      else if (wx === h.w - 1) T.blitName(ctx, 'wallWoodAlt', 0, px, py);
      else T.blitName(ctx, 'wallWoodMid', 0, px, py);
      // 窗（墙首行，左右各一扇，门在 front 排中央不冲突）
      if (y === h.y + 2 && (wx === 1 || wx === h.w - 2)) T.blitName(ctx, 'windowWood', 0, px, py);
    }
  }

  drawFence(T, ctx, w, x, y, px, py) {
    const has = (dx, dy) => {
      const o = getObj(w, x + dx, y + dy);
      return o === O.FENCE || o === O.WALL;
    };
    const l = has(-1, 0), r = has(1, 0), u = has(0, -1), d = has(0, 1);
    // 直角角件（恰两邻且垂直）：fenceTL=邻上+左，TR=上+右，BL=下+左，BR=下+右
    if (l && u && !r && !d) { T.blitName(ctx, 'fenceTL', 0, px, py); return; }
    if (r && u && !l && !d) { T.blitName(ctx, 'fenceTR', 0, px, py); return; }
    if (l && d && !r && !u) { T.blitName(ctx, 'fenceBL', 0, px, py); return; }
    if (r && d && !l && !u) { T.blitName(ctx, 'fenceBR', 0, px, py); return; }
    // 直段（十字/T 字路口横竖叠加；横杆 80 自带端柱，断头自然收口）
    if (l || r) T.blitName(ctx, 'fenceH', 0, px, py);
    if (u || d) T.blitName(ctx, 'fenceV', 0, px, py);
    // 孤立：单柱
    if (!l && !r && !u && !d) T.blitName(ctx, 'fencePost', 0, px, py);
  }

  glow(ctx, x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ---------- 居民 ----------
  drawNpcBody(T, ctx, n, labels) {
    const px = n.x * TILE, py = n.y * TILE;
    const moving = (n.path && n.path.length > 0) || !!n.trailMoving;
    let bob = moving ? (Math.sin(this.time * 10 + n.x) > 0 ? 1 : 0) : 0;
    // 跛行：腿脚不便时步态不匀
    if (moving && n.body && bodyConstraints(n.body).moveMul < 0.8) {
      bob = Math.sin(this.time * 10 + n.x) > 0.35 ? 1 : 0;
    }
    const sub = !moving && n.intent ? n.intent.sub : null;
    // 抖腿：原地小幅快颤——腿在抖，影子不动
    if (sub === '抖腿') bob = Math.sin(this.time * 16) > 0.55 ? 1 : 0;
    // 身量（生命层）：婴儿/儿童七成个头，少年八成八——一眼看出谁家孩子
    const st = stageOf(n.body.ageYears).id;
    const sc = (st === 'infant' || st === 'child') ? 0.75 : st === 'teen' ? 0.88 : 1;
    const sw = Math.round(16 * sc);
    // 影子
    ctx.fillStyle = SHADOW;
    ctx.fillRect(Math.round(px - 4 * sc), py + 3, Math.round(8 * sc), 2);
    const dirs = ['down', 'up', 'left', 'right'];
    const frame = T.npc[n.id] ? T.npc[n.id][dirs[n.dir] || 'down'] : T.npc.chen.down;
    ctx.drawImage(frame, Math.round(px - sw / 2), Math.round(py + 3 - sw - bob), sw, sw);
    const headTop = py + 3 - sw - bob;   // 精灵头顶：存在态特效与名牌随身量缩放
    // ---------- 存在态可视化：存在本身要被看见（计划书第十二章·八 / 铁律九） ----------
    if (sub) {
      if (sub === '打瞌睡') {
        // 打瞌睡：头顶冒像素 z（上飘渐隐，不依赖字体）
        const zt = (this.time * 0.5) % 1;
        const zy = Math.round(headTop - 8 - zt * 6);
        ctx.globalAlpha = 0.85 * (1 - zt);
        ctx.fillStyle = '#e7e9ed';
        ctx.fillRect(px + 4, zy, 4, 1);      // 上横
        ctx.fillRect(px + 6, zy + 1, 1, 1);  // 斜
        ctx.fillRect(px + 5, zy + 2, 1, 1);
        ctx.fillRect(px + 4, zy + 3, 4, 1);  // 下横
        ctx.globalAlpha = 1;
      } else if (sub === '哼小调') {
        // 哼小调：像素音符从头顶两侧交替飘起
        const nt = (this.time * 0.38) % 1;
        const nx = Math.floor(this.time * 0.38) % 2 === 0 ? px + 6 : px - 7;
        const ny = headTop - 4 - nt * 8;
        ctx.globalAlpha = 0.85 * (1 - nt);
        ctx.fillStyle = PAL.flowerYellow;
        ctx.fillRect(nx, ny + 2, 2, 2);     // 符头
        ctx.fillRect(nx + 1, ny - 2, 1, 4); // 符杆
        ctx.globalAlpha = 1;
      } else if (sub === '想心事') {
        // 想心事：头顶三点心事符号，依次亮起又暗下
        ctx.fillStyle = PAL.flowerWhite;
        for (let i = 0; i < 3; i++) {
          const a = (this.time * 0.9 + i * 0.34) % 1;
          ctx.globalAlpha = a < 0.62 ? 0.9 : 0.22;
          ctx.fillRect(px - 3 + i * 3, headTop - 8, 1, 1);
        }
        ctx.globalAlpha = 1;
      } else if (sub === '踢石子') {
        // 踢石子：石子朝面向方向飞出一小段弧线，周而复始（2x2 亮石保证路面可读）
        const dv = [[0, 1], [0, -1], [-1, 0], [1, 0]][n.dir] || [0, 1];
        const kt = (this.time * 0.7) % 1;
        const kx = px + dv[0] * kt * 12 + (dv[0] < 0 ? -2 : 0);
        const ky = py + dv[1] * kt * 12 - Math.sin(kt * Math.PI) * 5;
        ctx.globalAlpha = 0.9 * (1 - kt * 0.5);
        ctx.fillStyle = PAL.stoneHi;
        ctx.fillRect(Math.round(kx), Math.round(ky), 2, 2);
        ctx.globalAlpha = 1;
      }
    }
    labels.push({
      sx: px, sy: headTop - 2, text: n.name, moving,
      bubble: n.bubble ? n.bubble.text : null,
      anger: !!(n.bubble && n.bubble.anger)
    });
    // ---------- 干活动作层（v3.0.0 过程革命：原地站着不算干活，每种活有自己的动作序列） ----------
    // 数据驱动：npc.act={prim,tool,rate,fx}——采集挂世界对象(OBJ_MOTION)、加工挂演化配方(def.motion)；
    // 这里只懂原语怎么画（物理），什么活用什么原语是数据说了算（内容，演化引擎可改）。
    if (!moving && n.act) this.drawMotion(ctx, n, px, py, sw);
  }

  // ---------- 动作原语绘制：swing挥劈/smash抡砸/pull拉拽/stir搅舂/knead揉压/tend照料/saw拉锯 ----------
  drawMotion(ctx, n, px, py, sw) {
    const act = n.act; if (!act) return;
    const rate = act.rate || 1;
    const idOff = (n.id.charCodeAt(0) + n.id.charCodeAt(n.id.length - 1)) * 0.173;   // 各人错拍，不齐刷
    const ph = (this.time * rate + idOff) % 1;
    const cyc = Math.floor(this.time * rate + idOff);
    const dv = [[0, 1], [0, -1], [-1, 0], [1, 0]][n.dir] || [0, 1];
    const fa = Math.atan2(dv[1], dv[0]);
    const sx = px, sy = py + 3 - sw + sw * 0.42;          // 肩点（精灵脚底在 py+3）
    const gx = px + dv[0] * 7, gy = py + 1 + dv[1] * 5;   // 面前落点（工具着地点）
    const inWin = (a, b) => (ph >= a && ph <= b) ? (ph - a) / (b - a) : -1;
    let hx = sx, hy = sy, ta = fa, ft = -1, fxPos = null;
    switch (act.prim) {
      case 'swing': {   // 挥劈：后摆蓄力 → 快速劈下 → 随挥
        const sweep = ph < 0.45 ? 0 : ph < 0.62 ? (ph - 0.45) / 0.17 : 1 - (ph - 0.62) * 0.35;
        ta = fa - 1.7 + sweep * 2.4;
        hx = sx + Math.cos(ta) * 4.5; hy = sy + Math.sin(ta) * 4.5;
        ft = inWin(0.62, 0.84); fxPos = [gx, gy];
        break;
      }
      case 'smash': {   // 抡砸：举过头顶 → 砸落（弧线更大更慢）
        const sweep = ph < 0.52 ? 0 : ph < 0.68 ? (ph - 0.52) / 0.16 : 1 - (ph - 0.68) * 0.3;
        ta = fa - 2.3 + sweep * 3.1;
        hx = sx + Math.cos(ta) * 4.5; hy = sy + Math.sin(ta) * 4.5;
        ft = inWin(0.68, 0.9); fxPos = [gx, gy];
        break;
      }
      case 'pull': {    // 拉拽：持竿前指，周期性猛一提（中鱼/收竿）
        const yank = ph > 0.55 && ph < 0.75 ? Math.sin((ph - 0.55) / 0.2 * Math.PI) : 0;
        ta = fa - 0.5 - yank * 0.8;
        hx = sx + Math.cos(ta) * 4; hy = sy + Math.sin(ta) * 4;
        ft = inWin(0.58, 0.76); fxPos = [px + dv[0] * 8, py + 1 + dv[1] * 6];
        break;
      }
      case 'stir': {    // 搅舂：手绕面前一点画圈，工具朝圆心
        const cxp = px + dv[0] * 4, cyp = py - 3 + dv[1] * 3;
        const a = ph * Math.PI * 2;
        hx = cxp + Math.cos(a) * 2.5; hy = cyp + Math.sin(a) * 2.5;
        ta = Math.atan2(cyp - hy, cxp - hx);
        ft = inWin(0.04, 0.24); fxPos = [cxp, cyp];
        break;
      }
      case 'knead': {   // 揉压：双手向前下方推压，一推一收
        const push = Math.max(0, Math.sin(ph * Math.PI * 2));
        hx = px + dv[0] * (3.5 + push * 2.5); hy = sy + 2.5 + push * 1.5 + dv[1] * 2;
        ta = fa;
        ft = inWin(0.18, 0.4); fxPos = [hx + dv[0] * 2, hy + 1];
        break;
      }
      case 'tend': {    // 俯身照料：手向脚前落点一起一伏（浇水/除草/摘果）
        const dip = Math.abs(Math.sin(ph * Math.PI * 2));
        hx = gx; hy = gy - 2 - (1 - dip) * 3.5;
        ta = Math.atan2(hy - sy, hx - sx);
        ft = Math.max(inWin(0.2, 0.34), inWin(0.7, 0.84)); fxPos = [gx, gy];
        break;
      }
      case 'saw': {     // 拉锯：沿朝向往返推拉，到行程尽头溅屑
        const off = Math.sin(ph * Math.PI * 2) * 3.5;
        hx = px + dv[0] * (4.5 + off); hy = py - 2 + dv[1] * (4.5 + off);
        ta = fa;
        ft = Math.max(inWin(0.22, 0.34), inWin(0.72, 0.84)); fxPos = [gx, gy];
        break;
      }
      default: return;
    }
    // 手臂：袖子色（上衣色）两节像素臂，从肩点到手点
    ctx.fillStyle = n.shirt || '#8a8f98';
    const armLen = Math.max(3.2, Math.hypot(hx - sx, hy - sy));
    for (const d of [0.5, 0.9]) {
      ctx.fillRect(Math.round(sx + (hx - sx) * d / armLen * 2.2) - 1, Math.round(sy + (hy - sy) * d / armLen * 2.2) - 1, 2, 2);
    }
    // 工具（形状是物理，什么活拿什么工具是数据）
    this.drawTool(ctx, act.tool, hx, hy, ta);
    // 命中粒子：击中瞬间从落点溅出，确定性抖动（同周期同位置，可复现）
    if (ft >= 0 && fxPos) this.drawMotionFx(ctx, act.fx, fxPos[0], fxPos[1], ft, cyc, n);
  }

  drawTool(ctx, tool, hx, hy, ang) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const WOOD = '#8b6f47', IRON = '#b9bfc7';
    const seg = (x0, y0, x1, y1, w, col) => {
      ctx.fillStyle = col;
      const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        ctx.fillRect(Math.round(x0 + (x1 - x0) * t - w / 2), Math.round(y0 + (y1 - y0) * t - w / 2), w, w);
      }
    };
    switch (tool) {
      case 'axe': case 'pick': {
        const ex = hx + ca * 4, ey = hy + sa * 4;
        seg(hx, hy, ex, ey, 1, WOOD);
        const pxn = -sa, pyn = ca;
        if (tool === 'axe') seg(ex, ey, ex + pxn * 2.5, ey + pyn * 2.5, 2, IRON);
        else seg(ex - pxn * 2, ey - pyn * 2, ex + pxn * 2, ey + pyn * 2, 1, IRON);
        break;
      }
      case 'hammer': {
        const ex = hx + ca * 3, ey = hy + sa * 3;
        seg(hx, hy, ex, ey, 1, WOOD);
        ctx.fillStyle = IRON; ctx.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 3, 3);
        break;
      }
      case 'rod': seg(hx, hy, hx + ca * 7, hy + sa * 7, 1, '#7a5c36'); break;
      case 'saw': {
        const ex = hx + ca * 2, ey = hy + sa * 2;
        seg(hx, hy, ex, ey, 1, WOOD);
        seg(ex + sa * 1, ey - ca * 1, ex - sa * 4, ey + ca * 4, 1, IRON);
        break;
      }
      case 'stick': seg(hx, hy, hx + ca * 3, hy + sa * 3, 1, WOOD); break;
      default: break;   // hand：空着的手也是工具
    }
  }

  drawMotionFx(ctx, fx, x, y, t, cyc, n) {
    const col = { chip: '#d9b078', stone: '#aab0b8', splash: '#8fc3e8', drop: '#7fb8dd', dust: '#c9bfa8' }[fx] || '#c9bfa8';
    ctx.fillStyle = col;
    const seedX = Math.round(n.x * 16), seedY = Math.round(n.y * 16);
    for (let k = 0; k < 2; k++) {
      const h1 = hash2(cyc * 31 + k * 17, seedX + k * 5);
      const h2 = hash2(cyc * 7 + k * 23, seedY + k * 3);
      const dx = (h1 - 0.5) * (2 + t * 5);
      const dy = (h2 - 0.5) * (2 + t * 4) - t * 2.5;
      ctx.globalAlpha = Math.max(0, 0.95 - t);
      ctx.fillRect(Math.round(x + dx), Math.round(y + dy), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  drawLabels(ctx, labels, ts) {
    const zoom = this.cam.zoom;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const L of labels) {
      // L.sx/L.sy 是世界像素：屏幕 = 世界px×zoom - 相机(瓦片)×TILE×zoom
      const sx = L.sx * zoom - this.cam.x * ts;
      const sy = L.sy * zoom - this.cam.y * ts;
      ctx.font = '12px "ArkPixel", "Microsoft YaHei", monospace';
      const tw = ctx.measureText(L.text).width;
      ctx.fillStyle = 'rgba(15,17,21,0.62)';
      ctx.fillRect(sx - tw / 2 - 3, sy - 10, tw + 6, 14);
      ctx.fillStyle = '#e7e9ed';
      ctx.fillText(L.text, sx, sy);
      if (L.bubble) {
        const text = L.bubble.slice(0, 16);
        const bw = Math.min(150, ctx.measureText(text).width + 10);
        const bx = sx - bw / 2, by = sy - 34;
        // 变脸：话不投机，气泡沉成深色（认知层：禁忌被戳中）
        ctx.fillStyle = L.anger ? 'rgba(43,34,40,0.95)' : 'rgba(240,242,245,0.96)';
        ctx.fillRect(bx, by, bw, 20);
        ctx.fillStyle = L.anger ? '#f0c9c9' : '#1a1d24';
        ctx.textAlign = 'left';
        ctx.fillText(text, bx + 5, by + 14);
        ctx.textAlign = 'center';
        ctx.fillStyle = L.anger ? 'rgba(43,34,40,0.95)' : 'rgba(240,242,245,0.96)';
        ctx.fillRect(sx - 2, by + 20, 4, 3);
      }
    }
  }

  _isNight(game) { return game.clock.nightAmount() > 0.35; }

  // 小时 -> 四段色温（跨夜循环）
  tintAt(hour) {
    const h = hour < 5 ? hour + 24 : hour;
    const arr = DAY_TINTS;
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      if (h >= a.h && h <= b.h) {
        const t = (h - a.h) / (b.h - a.h);
        return a.c.map((v, k) => v + (b.c[k] - v) * t);
      }
    }
    return arr[0].c.slice();
  }

  drawRain(ctx, W, H, dt, mul) {
    const want = Math.floor((W * H / 3800) * mul);
    while (this.rainDrops.length < want) this.rainDrops.push({ x: Math.random() * W, y: Math.random() * H, v: 700 + Math.random() * 300 });
    while (this.rainDrops.length > want) this.rainDrops.pop();
    ctx.strokeStyle = 'rgba(190,214,248,0.62)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of this.rainDrops) {
      d.y += d.v * dt; d.x -= d.v * dt * 0.2;
      if (d.y > H) { d.y = -10; d.x = Math.random() * (W + 100); }
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 10);
    }
    ctx.stroke();
  }
  drawSnow(ctx, W, H, dt) {
    const want = Math.floor(W * H / 5200);
    while (this.snowFlakes.length < want) this.snowFlakes.push({ x: Math.random() * W, y: Math.random() * H, v: 40 + Math.random() * 40, ph: Math.random() * 6.28, s: Math.random() < 0.7 ? 1 : 2 });
    while (this.snowFlakes.length > want) this.snowFlakes.pop();
    ctx.fillStyle = 'rgba(240,246,252,0.9)';
    for (const f of this.snowFlakes) {
      f.y += f.v * dt; f.ph += dt * 2; f.x += Math.sin(f.ph) * 0.4;
      if (f.y > H) { f.y = -5; f.x = Math.random() * W; }
      ctx.fillRect(f.x | 0, f.y | 0, f.s, f.s);
    }
  }
  drawAurora(ctx, W, H) {
    const t = this.time * 0.4;
    for (let band = 0; band < 3; band++) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24) {
        const y = H * 0.18 + band * 26 + Math.sin(x * 0.004 + t + band * 1.7) * 30 + Math.sin(x * 0.011 - t * 1.3) * 14;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(80,220,150,${0.14 - band * 0.03})`;
      ctx.lineWidth = 18; ctx.stroke();
    }
  }

  // ---------- 小地图 ----------
  drawMini(game) {
    const m = this.mctx;
    m.imageSmoothingEnabled = false;
    const S = 152, SCALE = 2, half = S / 2 / SCALE;  // 38 tile 半径
    // 相机移动超过 8 tile 或脏标记时重建
    const moved = !this._lastMiniCam ||
      Math.abs(this.cam.x - this._lastMiniCam.x) > 8 ||
      Math.abs(this.cam.y - this._lastMiniCam.y) > 8;
    if (this.mapDirty || moved) {
      this.rebuildMiniMap(game);
      this.mapDirty = false;
      this._lastMiniCam = { x: this.cam.x, y: this.cam.y };
    }
    m.clearRect(0, 0, S, S);
    m.drawImage(this._mapCanvas, 0, 0);
    // NPC 点（以相机为中心）
    for (const n of game.npcs) {
      if (n.inside) continue;
      const mx = Math.floor((n.x - this.cam.x + half) * SCALE);
      const my = Math.floor((n.y - this.cam.y + half) * SCALE);
      if (mx < 1 || my < 1 || mx >= S - 1 || my >= S - 1) continue;
      m.fillStyle = PAL.flameHi;
      m.fillRect(mx - 1, my - 1, 3, 3);
    }
    // 相机视野框（中心）
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const viewW = rect.width * dpr / (TILE * this.cam.zoom) * SCALE;
    const viewH = rect.height * dpr / (TILE * this.cam.zoom) * SCALE;
    const ccx = half * SCALE, ccy = half * SCALE;
    m.strokeStyle = 'rgba(232,85,45,0.9)';
    m.lineWidth = 1;
    m.strokeRect(ccx - viewW / 2 + 0.5, ccy - viewH / 2 + 0.5, viewW, viewH);
  }
  rebuildMiniMap(game) {
    const w = game.world;
    const fog = game.fog;
    const c = this._mapCanvas.getContext('2d');
    const S = 152, SCALE = 2, half = S / 2 / SCALE;  // 38 tile 半径
    const colG = { 0: '#5da845', 1: '#c08455', 2: '#b0956f', 3: '#8d939e', 4: '#3d6e9e', 5: '#d4b878', 6: '#8a5c3a', 7: '#9a7648' };
    const colO = {
      1: '#2f6b35', 2: '#7d8288', 3: '#d47d3a', 4: '#9fb3c8', 5: '#e8b93c',
      6: '#9e402e', 7: '#6f4526', 8: '#8a6f47', 9: '#5fa8d8', 10: '#e05a7a', 11: '#3d8a44',
      12: '#f0c84a', 13: '#c75a3e', 14: '#332f2c',
      24: '#5d4326', 25: '#c75a3e', 26: '#a3713c', 27: '#f0a050', 28: '#d89a2e',
      29: '#8a5c34', 30: '#6f4526', 31: '#8d939e', 32: '#7d8288',
      33: '#a3713c', 34: '#c75a3e', 35: '#8d939e', 36: '#6f6a62', 37: '#b0563a'
    };
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#1a1d24';
    c.fillRect(0, 0, S, S);
    // 以相机为中心的 chunk 范围
    const cx0 = Math.floor((this.cam.x - half) / CHUNK);
    const cy0 = Math.floor((this.cam.y - half) / CHUNK);
    const cx1 = Math.floor((this.cam.x + half) / CHUNK);
    const cy1 = Math.floor((this.cam.y + half) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = w.ws.get(cx, cy);
        if (!chunk) continue;
        const ox = cx * CHUNK, oy = cy * CHUNK;
        for (let ly = 0; ly < CHUNK; ly++) {
          const wy = oy + ly;
          const my = Math.floor((wy - this.cam.y + half) * SCALE);
          if (my < 0 || my >= S) continue;
          for (let lx = 0; lx < CHUNK; lx++) {
            const wx = ox + lx;
            const mx = Math.floor((wx - this.cam.x + half) * SCALE);
            if (mx < 0 || mx >= S) continue;
            if (fog && FOG.enabled && !isSeen(fog, wx, wy)) {
              c.fillStyle = '#0a0c10';
              c.fillRect(mx, my, SCALE, SCALE);
              continue;
            }
            const i = localIdx(lx, ly);
            const o = chunk.obj[i];
            c.fillStyle = o && colO[o] ? colO[o] : (colG[chunk.ground[i]] || '#5da845');
            if (o >= 20 && o <= 23) c.fillStyle = ['#5d9e4f', '#4f8f42', '#8fbf4f', '#e8c93c'][o - 20];
            c.fillRect(mx, my, SCALE, SCALE);
          }
        }
      }
    }
  }

  meteor(x, y, cb) { this.meteorFx = { x, y, t0: performance.now(), dur: 1200, cb }; }
  shake(n) { this.shakeAmt = Math.max(this.shakeAmt, n); }
}
