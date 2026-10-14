// tileset.js - CC0 图集加载、语义映射、程序合成件
// 图集：Kenney Tiny Town / Tiny Dungeon / Roguelike RPG Pack（均 CC0，见 assets/kenney/*/LICENSE.txt）
// 网格：16x16，图集内间距 1px；roguelike 每行 57 格
import { PAL, SHADOW } from './palette.js';

const PITCH = 17, ROG_COLS = 57;

// 语义索引：tt=tiny-town，dg=tiny-dungeon，rg=roguelike
export const MAP = {
  // 地面
  grass: ['tt', [0, 1, 2]],
  dirt: ['tt', [39, 40]],                 // 实压土地：14 是"凸起土丘"砖（满铺变坟场），39/40 平铺无缝
  dirtMound: ['tt', 14],                  // 单格松土/小丘备用
  // soil 已改为程序合成件 syn.soils（tt24/25/26 均带青草边缘，满铺出绿条）
  path: ['tt', [39, 40, 41, 42]],
  stone: ['tt', [43]],
  sand: ['dg', [48, 49, 50, 51, 53]],
  plank: ['tt', [37]],                     // 木桥板：37 是纯木板（36/38 带青草角；dg36-39 是石砖）
  water: ['rg', [0]],                      // 仅 rg0 是纯水面；57/114/171/228 都是带沙滩的转角，不可当动画帧
  // 水面波纹为程序补绘（render.drawGround WATER 分支）
  // 植物
  treeGreen: ['tt', 16], treeYellow: ['tt', 15], treeSmallG: ['tt', 28], treeSmallY: ['tt', 27],
  bush: ['rg', 535], sprout: ['tt', 17],
  flowerRed: ['rg', 343], flowerWhite: ['rg', 571], flowerBlue: ['rg', 686],
  // 建筑件
  wallWood: ['tt', 72], wallWoodMid: ['tt', 73], wallWoodAlt: ['tt', 75], wallStone: ['tt', 76],
  wallMine: ['dg', 58],
  roofRed: ['tt', [52, 54]], roofRedGable: ['tt', 66],
  roofBlue: ['tt', [48, 49, 50]],
  doorWood: ['tt', 90], windowWood: ['tt', 84],
  fenceH: ['tt', 80], fenceV: ['tt', 47], fencePost: ['tt', 82],
  fenceTL: ['tt', 70], fenceTR: ['tt', 68], fenceBL: ['tt', 46], fenceBR: ['tt', 44], fenceGate: ['tt', 69],
  sign: ['tt', 83],
  // 物件
  fountain: ['tt', 104], chest: ['dg', 89], crate: ['tt', 56],
  crater: ['dg', 56],
  lamp: ['rg', 417], anvil: ['dg', 65], grave: ['dg', 64],
  stall: ['rg', [240, 241, 300]], barrel: ['rg', 550], logpile: ['tt', 106],
  torch: ['rg', 417]
};

// 居民立绘：dungeon 角色 tile（均为 16x16 正面）+ 头部修补色（背面/侧面合成用）
export const ROSTER_SPRITE = {
  chen:  { tile: 88,  hair: '#6b4a26' },  // 陈麦冬 农夫：朴素青年
  lin:   { tile: 99,  hair: '#c98a4a' },  // 林小满 农女：金发女孩
  zhao:  { tile: 86,  hair: '#5a3a22' },  // 赵铁山 铁匠：大胡子
  zhou:  { tile: 98,  hair: '#6b4a26' },  // 周大樵 樵夫：平民汉
  wu:    { tile: 85,  hair: '#7a5230' },  // 吴渔歌：清瘦青年
  zheng: { tile: 84,  hair: '#d8d8d8' },  // 郑掌柜：紫袍老者
  wang:  { tile: 112, hair: '#3a2e22' },  // 王绣：绿衣束发
  feng:  { tile: 87,  hair: '#b8bec8' },  // 冯小明：头盔男孩（玩具头盔）
  he:    { tile: 100, hair: '#e0e0e0' },  // 何老：白发
  su:    { tile: 98, hair: '#241c2e', front: true }  // 苏吟：黑衣诗人（111 是红眼怪物，改 98 黑发青年）
};

export const SHEETS = {
  tt: { url: new URL('../assets/kenney/tiny-town/tilemap.png', import.meta.url), cols: 12 },
  dg: { url: new URL('../assets/kenney/tiny-dungeon/tilemap.png', import.meta.url), cols: 12 },
  rg: { url: new URL('../assets/kenney/roguelike/sheet.png', import.meta.url), cols: ROG_COLS }
};

function loadImg(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('素材加载失败: ' + url));
    img.src = url;
  });
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return [c, x];
}

// 图集格位（16x16 源矩形）
export function cellRect(sheet, idx) {
  const cols = SHEETS[sheet].cols;
  const n = Array.isArray(idx) ? idx[0] : idx;
  const cx = n % cols, cy = Math.floor(n / cols);
  return [cx * PITCH, cy * PITCH, 16, 16];
}

export class Tileset {
  constructor() {
    this.imgs = {};
    this.syn = {};      // 程序合成件
    this.npc = {};      // 角色四方向
    this.ready = false;
  }

  async load(onProgress) {
    const keys = Object.keys(SHEETS);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      this.imgs[k] = await loadImg(SHEETS[k].url.href);
      if (onProgress) onProgress(i + 1, keys.length);
    }
    this.buildSynthetic();
    this.buildNpcs();
    this.ready = true;
  }

  // 按语义名取图（变体：传 variant 下标，否则按 hash）
  img(name, variant = 0) {
    const m = MAP[name]; if (!m) return null;
    const v = Array.isArray(m[1]) ? m[1][variant % m[1].length] : m[1];
    return this.imgs[m[0]];
  }
  rect(name, variant = 0) {
    const m = MAP[name]; if (!m) return null;
    const v = Array.isArray(m[1]) ? m[1][variant % m[1].length] : m[1];
    return { sheet: m[0], ...this.rr(m[0], v) };
  }
  rr(sheet, idx) {
    const [sx, sy, sw, sh] = cellRect(sheet, idx);
    return { sx, sy, sw, sh };
  }
  // 直接按 sheet+idx 画（16x16）
  blit(ctx, sheet, idx, dx, dy, dw = 16, dh = 16) {
    const [sx, sy, sw, sh] = cellRect(sheet, idx);
    ctx.drawImage(this.imgs[sheet], sx, sy, sw, sh, Math.round(dx), Math.round(dy), dw, dh);
  }
  blitName(ctx, name, variant, dx, dy, dw = 16, dh = 16) {
    const r = this.rect(name, variant);
    ctx.drawImage(this.imgs[r.sheet], r.sx, r.sy, r.sw, r.sh, Math.round(dx), Math.round(dy), dw, dh);
  }
  // 裁源（合成用）
  blitPart(ctx, sheet, idx, part, dx, dy, dw, dh) {
    const [sx, sy] = cellRect(sheet, idx);
    ctx.drawImage(this.imgs[sheet], sx + part[0], sy + part[1], part[2], part[3],
      Math.round(dx), Math.round(dy), dw, dh);
  }

  // ---------- 程序合成件 ----------
  buildSynthetic() {
    const s = this.syn;
    // 耕地两变体（tt24/25/26 都带青草边缘，满铺会出现绿条，故纯程序合成）
    s.soils = [0, 1].map((v) => {
      const [c, x] = mkCanvas(16, 16);
      x.fillStyle = PAL.soil; x.fillRect(0, 0, 16, 16);
      // 土块碎点（确定性）
      let sd = (v + 1) * 9173;
      const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
      for (let i = 0; i < 26; i++) {
        const px = (rnd() * 16) | 0, py = (rnd() * 16) | 0;
        x.fillStyle = rnd() < 0.5 ? PAL.dirtLo : PAL.woodDeep;
        x.fillRect(px, py, 1, 1);
      }
      // 三条犁沟：亮沟沿 + 深沟底，缺口让沟不机械
      for (const fy of [4, 9, 14]) {
        x.fillStyle = PAL.dirtLo;
        for (let dx = 0; dx < 16; dx++) if (((dx * 7 + fy) % 5) !== 0) x.fillRect(dx, fy - 1, 1, 1);
        x.fillStyle = PAL.woodDeep;
        for (let dx = 0; dx < 16; dx++) if (((dx * 5 + fy) % 7) !== 0) x.fillRect(dx, fy, 1, 1);
      }
      return c;
    });
    // 野石三变体（rg/dg 单格石件均为石板或石碑，巨石是多格拼件，故程序补绘）
    // 每行：[y, x, w] 墨色轮廓
    const ROCK_ROWS = [
      [
        [3, 6, 4], [4, 4, 8], [5, 3, 10], [6, 3, 10], [7, 3, 10],
        [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 4, 8], [12, 5, 6]
      ],
      [
        [3, 5, 5], [4, 4, 9], [5, 3, 10], [6, 3, 10], [7, 3, 10],
        [8, 3, 10], [9, 3, 10], [10, 4, 9], [11, 4, 8], [12, 5, 6]
      ],
      [
        [4, 6, 4], [5, 4, 8], [6, 4, 8], [7, 4, 8], [8, 4, 8],
        [9, 4, 8], [10, 4, 8], [11, 5, 6], [12, 6, 4]
      ]
    ];
    const ROCK_HI = [
      [[6, 4], [7, 4], [4, 5], [5, 5], [4, 6], [5, 6]],
      [[6, 3], [7, 3], [5, 4], [4, 5], [5, 5], [6, 5]],
      [[7, 5], [6, 6], [7, 6], [5, 7]]
    ];
    const ROCK_LO = [
      [[11, 5], [11, 6], [11, 7], [11, 8], [10, 11], [11, 11], [9, 12], [10, 12]],
      [[11, 5], [11, 6], [11, 7], [11, 8], [10, 11], [11, 11], [9, 12], [10, 12]],
      [[10, 6], [10, 7], [10, 10], [9, 11], [8, 12]]
    ];
    s.rocks = ROCK_ROWS.map((rows, k) => {
      const [c, x] = mkCanvas(16, 16);
      x.fillStyle = SHADOW; x.fillRect(k === 2 ? 4 : 3, 13, k === 2 ? 8 : 10, 2);
      for (const [y, rx, w] of rows) { x.fillStyle = PAL.ink; x.fillRect(rx, y, w, 1); x.fillStyle = PAL.stone; x.fillRect(rx + 1, y, w - 2, 1); }
      x.fillStyle = PAL.stoneHi; for (const [px, py] of ROCK_HI[k]) x.fillRect(px, py, 1, 1);
      x.fillStyle = PAL.stoneLo; for (const [px, py] of ROCK_LO[k]) x.fillRect(px, py, 1, 1);
      x.fillStyle = PAL.ink; x.fillRect(7, 8, 1, 1); x.fillRect(8, 8, 1, 1); x.fillRect(8, 9, 1, 1); // 裂纹
      return c;
    });
    // 矿石：野石 + 三色矿点（高光取锁色板近似色）
    for (const [key, c1, c2] of [['copper', PAL.copper, PAL.flameHi], ['iron', PAL.iron, PAL.flowerWhite], ['gold', PAL.gold, PAL.flowerYellow]]) {
      const [c, x] = mkCanvas(16, 16);
      x.drawImage(s.rocks[0], 0, 0);
      x.fillStyle = c1; x.fillRect(5, 7, 2, 2); x.fillRect(10, 5, 2, 2); x.fillRect(8, 10, 2, 2);
      x.fillStyle = c2; x.fillRect(6, 6, 1, 1); x.fillRect(11, 9, 1, 1); x.fillRect(9, 11, 1, 1);
      s[key] = c;
    }
    // 小棚屋 16x20：红瓦顶 + 木墙 + 深木门
    {
      const [c, x] = mkCanvas(16, 20);
      this.blitPart(x, 'tt', 52, [0, 0, 16, 8], 0, 0, 16, 8);          // 瓦顶
      this.blitPart(x, 'tt', 72, [0, 4, 16, 12], 0, 8, 16, 12);        // 木墙
      this.blitPart(x, 'tt', 90, [3, 2, 10, 14], 4, 8, 8, 12);         // 深色木门
      x.fillStyle = PAL.roofRedLo; x.fillRect(0, 7, 16, 1);
      s.shed = c;
      // 棚屋三变体（积木营造：墙色/顶沿微差，建筑方言用）
      s.shedVars = [[PAL.roofRed, PAL.wood], [PAL.woodDeep, PAL.woodHi], [PAL.roofRedLo, PAL.woodLo]].map(([roof, wall]) => {
        const [vc, vx] = mkCanvas(16, 20);
        vx.drawImage(s.shed, 0, 0);
        vx.fillStyle = roof; vx.fillRect(1, 1, 14, 6);
        vx.fillStyle = wall; vx.fillRect(1, 9, 14, 3);
        vx.fillStyle = PAL.ink; vx.fillRect(4, 9, 8, 11);
        vx.fillStyle = PAL.woodDeep; vx.fillRect(5, 10, 6, 9);
        return vc;
      });
    }
    // 原木：横放的整根木头（地上实体，可被搬运）
    {
      const [c, x] = mkCanvas(16, 16);
      x.fillStyle = SHADOW; x.fillRect(2, 12, 12, 2);
      x.fillStyle = PAL.woodDeep; x.fillRect(2, 7, 11, 5);
      x.fillStyle = PAL.wood; x.fillRect(2, 8, 11, 3);
      x.fillStyle = PAL.woodHi; x.fillRect(2, 8, 11, 1);
      x.fillStyle = PAL.ink; x.fillRect(2, 7, 12, 1); x.fillRect(2, 12, 12, 1);
      // 两端年轮截面
      x.fillStyle = PAL.woodHi; x.fillRect(1, 7, 2, 5); x.fillRect(13, 7, 2, 5);
      x.fillStyle = PAL.woodLo; x.fillRect(1, 9, 2, 1); x.fillRect(13, 9, 2, 1);
      x.fillStyle = PAL.woodDeep; x.fillRect(1, 9, 1, 1); x.fillRect(14, 9, 1, 1);
      s.log = c;
    }
    // 仓库 16x20：大坡顶 + 双开板门 + 门梁
    {
      const [c, x] = mkCanvas(16, 20);
      this.blitPart(x, 'tt', 52, [0, 0, 16, 8], 0, 0, 16, 8);
      this.blitPart(x, 'tt', 75, [0, 4, 16, 12], 0, 8, 16, 12);
      x.fillStyle = PAL.roofRedLo; x.fillRect(0, 7, 16, 1);
      x.fillStyle = PAL.woodDeep; x.fillRect(3, 10, 10, 10);           // 门框
      x.fillStyle = PAL.woodLo; x.fillRect(4, 11, 3, 9); x.fillRect(9, 11, 3, 9);
      x.fillStyle = PAL.ink; x.fillRect(4, 11, 3, 1); x.fillRect(9, 11, 3, 1); x.fillRect(7, 12, 2, 3);
      x.fillStyle = PAL.woodHi; x.fillRect(3, 9, 10, 1);
      s.barn = c;
    }
    // 木匠坊 16x20：青灰顶 + 敞开作业面 + 锯木架
    {
      const [c, x] = mkCanvas(16, 20);
      this.blitPart(x, 'dg', 58, [0, 0, 16, 8], 0, 0, 16, 8);          // 石砖青灰顶
      this.blitPart(x, 'tt', 72, [0, 4, 16, 12], 0, 8, 16, 12);
      x.fillStyle = PAL.stoneLo; x.fillRect(0, 7, 16, 1);
      x.fillStyle = PAL.woodDeep; x.fillRect(2, 9, 12, 11);            // 敞开作业面
      x.fillStyle = PAL.wood; x.fillRect(2, 9, 12, 1);
      // 锯木架：斜置原木 + 两条架腿
      x.fillStyle = PAL.woodHi; x.fillRect(3, 13, 10, 2);
      x.fillStyle = PAL.ink; x.fillRect(3, 13, 10, 1);
      x.fillStyle = PAL.woodLo; x.fillRect(4, 15, 1, 4); x.fillRect(11, 15, 1, 4);
      s.workshop = c;
    }
    // 废墟：断墙碎石（不是"建好又删掉"，是没人修，慢慢垮）
    {
      const [c, x] = mkCanvas(16, 16);
      x.fillStyle = SHADOW; x.fillRect(2, 12, 12, 2);
      // 半截残墙
      x.fillStyle = PAL.stone; x.fillRect(3, 5, 6, 8);
      x.fillStyle = PAL.stoneHi; x.fillRect(3, 5, 6, 1);
      x.fillStyle = PAL.stoneLo; x.fillRect(3, 9, 6, 1); x.fillRect(6, 6, 1, 3);
      x.fillStyle = PAL.ink; x.fillRect(3, 5, 6, 1); x.fillRect(9, 6, 1, 7); x.fillRect(3, 13, 6, 1);
      // 塌落的碎块
      x.fillStyle = PAL.stoneLo; x.fillRect(10, 9, 3, 3); x.fillRect(11, 7, 2, 2);
      x.fillStyle = PAL.stone; x.fillRect(12, 10, 2, 2);
      x.fillStyle = PAL.ink; x.fillRect(10, 9, 3, 1); x.fillRect(11, 7, 2, 1);
      // 荒草从缝里长出来
      x.fillStyle = PAL.leaf; x.fillRect(4, 3, 1, 2); x.fillRect(7, 2, 1, 3); x.fillRect(12, 5, 1, 2);
      s.ruin = c;
    }
    // 林间小屋 16x20：深木顶（殖民地就地取材）+ 小旗
    {
      const [c, x] = mkCanvas(16, 20);
      this.blitPart(x, 'tt', 54, [0, 0, 16, 8], 0, 0, 16, 8);          // 深红瓦顶
      this.blitPart(x, 'tt', 73, [0, 4, 16, 12], 0, 8, 16, 12);
      x.fillStyle = PAL.woodDeep; x.fillRect(0, 7, 16, 1);
      this.blitPart(x, 'tt', 90, [3, 2, 10, 14], 4, 9, 8, 11);         // 木门
      x.fillStyle = PAL.flowerWhite; x.fillRect(11, 9, 2, 2);          // 小窗
      x.fillStyle = PAL.woodDeep; x.fillRect(12, 3, 1, 5);             // 旗杆
      x.fillStyle = PAL.flameHi; x.fillRect(13, 3, 3, 2);              // 小旗
      s.cabin = c;
    }
    // 树桩（年轮截面）
    {
      const [c, x] = mkCanvas(16, 16);
      x.fillStyle = PAL.woodDeep;                                     // 桩身
      x.fillRect(4, 10, 8, 3);
      x.fillStyle = PAL.woodLo; x.fillRect(4, 12, 8, 1);
      x.fillStyle = PAL.woodHi;                                       // 截面
      x.fillRect(3, 7, 10, 4);
      x.fillStyle = PAL.wood; x.fillRect(4, 8, 8, 2);
      x.fillStyle = PAL.woodLo;                                       // 年轮
      x.fillRect(7, 8, 2, 1); x.fillRect(6, 9, 4, 1); x.fillRect(7, 10, 2, 1);
      x.fillStyle = PAL.ink; x.fillRect(3, 7, 10, 1); x.fillRect(3, 7, 1, 4); x.fillRect(12, 7, 1, 4);
      s.stump = c;
    }
    // 作物四阶段：苗 → 青苗 → 抽穗 → 金黄成熟
    s.crops = [];
    {
      const [c0, x0] = mkCanvas(16, 16);
      x0.fillStyle = PAL.leafDeep; x0.fillRect(7, 12, 1, 2);
      x0.fillStyle = PAL.leaf; x0.fillRect(5, 11, 2, 2); x0.fillRect(9, 11, 2, 2); x0.fillRect(7, 10, 2, 2);
      s.crops.push(c0);
      const [c1, x1] = mkCanvas(16, 16);
      x1.fillStyle = PAL.leafDeep; x1.fillRect(7, 8, 1, 6);
      x1.fillStyle = PAL.leaf;
      x1.fillRect(4, 9, 3, 2); x1.fillRect(9, 9, 3, 2); x1.fillRect(5, 6, 3, 2); x1.fillRect(9, 6, 3, 2);
      x1.fillStyle = PAL.leafHi; x1.fillRect(5, 9, 1, 1); x1.fillRect(10, 6, 1, 1);
      s.crops.push(c1);
      const [c2, x2] = mkCanvas(16, 16);
      x2.fillStyle = PAL.leafDeep; x2.fillRect(7, 5, 1, 9);
      x2.fillStyle = PAL.leaf;
      x2.fillRect(3, 9, 4, 2); x2.fillRect(9, 9, 4, 2); x2.fillRect(4, 6, 4, 2); x2.fillRect(9, 6, 4, 2);
      x2.fillStyle = PAL.leafAut; x2.fillRect(6, 3, 3, 2); x2.fillRect(7, 5, 1, 1);
      s.crops.push(c2);
      const [c3, x3] = mkCanvas(16, 16);
      x3.fillStyle = PAL.leafDeep; x3.fillRect(7, 5, 1, 9);
      x3.fillStyle = PAL.leaf; x3.fillRect(3, 10, 4, 2); x3.fillRect(9, 10, 4, 2);
      x3.fillStyle = PAL.flameHi;                                   // 金黄麦穗
      x3.fillRect(4, 6, 3, 3); x3.fillRect(9, 6, 3, 3); x3.fillRect(6, 2, 3, 3);
      x3.fillStyle = PAL.leafAutLo; x3.fillRect(4, 8, 3, 1); x3.fillRect(9, 8, 3, 1); x3.fillRect(6, 4, 3, 1);
      x3.fillStyle = PAL.flowerYellow; x3.fillRect(5, 6, 1, 1); x3.fillRect(10, 7, 1, 1); x3.fillRect(7, 3, 1, 1);
      s.crops.push(c3);
    }
    // 长凳（Tiny 厚描边风）
    {
      const [c, x] = mkCanvas(16, 16);
      x.fillStyle = SHADOW; x.fillRect(3, 13, 11, 2);
      x.fillStyle = PAL.ink; x.fillRect(2, 8, 12, 4); x.fillRect(3, 11, 2, 3); x.fillRect(11, 11, 2, 3);
      x.fillStyle = PAL.wood; x.fillRect(3, 8, 10, 2);
      x.fillStyle = PAL.woodHi; x.fillRect(3, 8, 10, 1);
      x.fillStyle = PAL.woodDeep; x.fillRect(4, 12, 1, 2); x.fillRect(12, 12, 1, 2);
      s.bench = c;
    }
    // 工地脚手架
    {
      const [c, x] = mkCanvas(16, 16);
      x.strokeStyle = 'rgba(199,107,58,0.95)'; x.lineWidth = 1;
      x.strokeRect(2.5, 2.5, 11, 11);
      x.strokeStyle = PAL.woodDeep;
      x.beginPath(); x.moveTo(3, 12); x.lineTo(13, 4); x.moveTo(13, 12); x.lineTo(3, 4); x.stroke();
      x.fillStyle = PAL.wood; x.fillRect(3, 11, 10, 2);
      x.fillStyle = PAL.woodLo; x.fillRect(3, 13, 10, 1);
      x.fillStyle = PAL.roofRed; x.fillRect(3, 3, 2, 2); x.fillRect(11, 3, 2, 2);
      s.site = c;
    }
    // 野猪（厚描边 18x12）
    {
      const [c, x] = mkCanvas(18, 12);
      x.fillStyle = SHADOW; x.fillRect(2, 10, 14, 2);
      x.fillStyle = PAL.ink;
      x.fillRect(2, 3, 13, 7); x.fillRect(12, 5, 4, 4); x.fillRect(15, 4, 2, 2); // 身+头+鼻
      x.fillStyle = '#6f5440'; x.fillRect(3, 4, 11, 4);
      x.fillStyle = '#8a6850'; x.fillRect(4, 3, 9, 2);
      x.fillStyle = '#3d2e22'; x.fillRect(3, 9, 2, 2); x.fillRect(12, 9, 2, 2);
      x.fillStyle = '#e8e0d0'; x.fillRect(15, 7, 1, 1);
      x.fillStyle = '#2a2018'; x.fillRect(14, 6, 1, 1);
      x.fillStyle = '#f0e8d8'; x.fillRect(4, 5, 1, 1); x.fillRect(9, 5, 1, 1);  // 獠牙两点
      s.boar = c;
    }
    // ---- 世界层·动物（v1.8.0，厚描边 18x12 / 鸟 10x8） ----
    // 奶牛：白花大块 + 粉鼻
    {
      const [c, x] = mkCanvas(18, 12);
      x.fillStyle = SHADOW; x.fillRect(2, 10, 14, 2);
      x.fillStyle = PAL.ink;
      x.fillRect(2, 3, 13, 7); x.fillRect(12, 4, 4, 5);           // 身+头
      x.fillStyle = '#f2ede2'; x.fillRect(3, 4, 11, 5);
      x.fillStyle = '#3a3430'; x.fillRect(5, 4, 3, 3); x.fillRect(10, 6, 3, 2); // 花斑
      x.fillStyle = '#e8b8a8'; x.fillRect(13, 7, 3, 2);           // 粉鼻
      x.fillStyle = '#3a3430'; x.fillRect(3, 9, 2, 2); x.fillRect(12, 9, 2, 2); // 腿
      x.fillStyle = PAL.ink; x.fillRect(13, 5, 1, 1);             // 眼
      x.fillStyle = '#d8cfc0'; x.fillRect(12, 3, 2, 1);           // 角
      s.cow = c;
    }
    // 绵羊：一团白绒 + 黑脸
    {
      const [c, x] = mkCanvas(18, 12);
      x.fillStyle = SHADOW; x.fillRect(3, 10, 12, 2);
      x.fillStyle = PAL.ink;
      x.fillRect(2, 3, 13, 7); x.fillRect(13, 5, 3, 4);
      x.fillStyle = '#efe9dc'; x.fillRect(3, 3, 11, 6);
      x.fillStyle = '#f8f4ea'; x.fillRect(4, 3, 3, 2); x.fillRect(8, 3, 3, 2); x.fillRect(6, 6, 3, 2); // 绒球
      x.fillStyle = '#4a4038'; x.fillRect(13, 5, 3, 3);           // 黑脸
      x.fillStyle = '#e8e0d0'; x.fillRect(15, 6, 1, 1);
      x.fillStyle = '#4a4038'; x.fillRect(3, 9, 2, 2); x.fillRect(12, 9, 2, 2);
      s.sheep = c;
    }
    // 母鸡：小团 + 红冠
    {
      const [c, x] = mkCanvas(12, 10);
      x.fillStyle = SHADOW; x.fillRect(2, 8, 8, 1);
      x.fillStyle = PAL.ink;
      x.fillRect(2, 3, 7, 5); x.fillRect(7, 2, 4, 4);
      x.fillStyle = '#f2ead8'; x.fillRect(3, 4, 5, 3);
      x.fillStyle = '#e0d4bc'; x.fillRect(3, 6, 5, 1);
      x.fillStyle = '#d84a3a'; x.fillRect(8, 1, 2, 1);            // 冠
      x.fillStyle = '#e8a83a'; x.fillRect(10, 4, 2, 1);           // 喙
      x.fillStyle = PAL.ink; x.fillRect(9, 3, 1, 1);              // 眼
      x.fillStyle = '#e8a83a'; x.fillRect(4, 8, 1, 1); x.fillRect(6, 8, 1, 1);
      s.chicken = c;
    }
    // 狗：棕黄 + 立耳 + 翘尾
    {
      const [c, x] = mkCanvas(18, 12);
      x.fillStyle = SHADOW; x.fillRect(3, 10, 12, 2);
      x.fillStyle = PAL.ink;
      x.fillRect(2, 4, 12, 6); x.fillRect(12, 2, 4, 5); x.fillRect(1, 2, 2, 3); // 身+头+尾
      x.fillStyle = '#b8874f'; x.fillRect(3, 5, 10, 4); x.fillRect(12, 3, 3, 3);
      x.fillStyle = '#caa06a'; x.fillRect(4, 5, 8, 2);
      x.fillStyle = '#8a6238'; x.fillRect(12, 1, 2, 2); x.fillRect(14, 2, 1, 1); // 耳
      x.fillStyle = PAL.ink; x.fillRect(13, 4, 1, 1);             // 眼
      x.fillStyle = '#3a2e22'; x.fillRect(15, 5, 1, 1);           // 鼻
      x.fillStyle = '#8a6238'; x.fillRect(3, 9, 2, 2); x.fillRect(11, 9, 2, 2);
      s.dog = c;
    }
    // 猫：灰条 + 尖耳 + 长尾
    {
      const [c, x] = mkCanvas(16, 11);
      x.fillStyle = SHADOW; x.fillRect(3, 9, 10, 1);
      x.fillStyle = PAL.ink;
      x.fillRect(3, 4, 9, 5); x.fillRect(10, 2, 4, 4); x.fillRect(1, 2, 2, 5);
      x.fillStyle = '#8f8a96'; x.fillRect(4, 5, 7, 3); x.fillRect(10, 3, 3, 2);
      x.fillStyle = '#6f6a78'; x.fillRect(6, 5, 1, 3); x.fillRect(9, 5, 1, 3);  // 条纹
      x.fillStyle = '#8f8a96'; x.fillRect(10, 1, 1, 2); x.fillRect(12, 1, 1, 2); // 尖耳
      x.fillStyle = '#c8e0c0'; x.fillRect(11, 4, 1, 1);           // 眼
      x.fillStyle = '#6f6a78'; x.fillRect(4, 8, 2, 2); x.fillRect(10, 8, 2, 2);
      s.cat = c;
    }
    // 狼：灰影低伏 + 竖耳长尾（比狗瘦一圈，眼神不一样）
    {
      const [c, x] = mkCanvas(18, 12);
      x.fillStyle = SHADOW; x.fillRect(3, 10, 13, 2);
      x.fillStyle = PAL.ink;
      x.fillRect(2, 5, 13, 5); x.fillRect(13, 3, 4, 4); x.fillRect(0, 3, 3, 3);
      x.fillStyle = '#6a7078'; x.fillRect(3, 6, 11, 3); x.fillRect(13, 4, 3, 2);
      x.fillStyle = '#565c64'; x.fillRect(3, 6, 11, 1);           // 背线
      x.fillStyle = '#6a7078'; x.fillRect(13, 2, 1, 2); x.fillRect(15, 2, 1, 2); // 竖耳
      x.fillStyle = '#e8d84a'; x.fillRect(14, 5, 1, 1);           // 黄眼
      x.fillStyle = '#2a2e34'; x.fillRect(16, 6, 1, 1);           // 鼻
      x.fillStyle = '#4a5058'; x.fillRect(3, 9, 2, 2); x.fillRect(12, 9, 2, 2);
      s.wolf = c;
    }
    // 鹿：浅棕细腿 + 角
    {
      const [c, x] = mkCanvas(18, 13);
      x.fillStyle = SHADOW; x.fillRect(3, 11, 12, 1);
      x.fillStyle = PAL.ink;
      x.fillRect(2, 5, 11, 5); x.fillRect(11, 2, 4, 5);
      x.fillStyle = '#b0905f'; x.fillRect(3, 6, 9, 3); x.fillRect(11, 3, 3, 3);
      x.fillStyle = '#c8ab7a'; x.fillRect(4, 6, 7, 1);
      x.fillStyle = '#e8e0d0'; x.fillRect(4, 7, 1, 1); x.fillRect(7, 8, 1, 1);  // 斑点
      x.fillStyle = '#7a6238'; x.fillRect(11, 0, 1, 2); x.fillRect(13, 0, 1, 2); // 角
      x.fillStyle = '#7a6238'; x.fillRect(10, 1, 1, 1); x.fillRect(14, 1, 1, 1);
      x.fillStyle = PAL.ink; x.fillRect(13, 4, 1, 1);             // 眼
      x.fillStyle = '#7a6238'; x.fillRect(3, 9, 1, 3); x.fillRect(6, 9, 1, 3); x.fillRect(9, 9, 1, 3); x.fillRect(12, 9, 1, 3); // 细腿
      s.deer = c;
    }
    // 鸟：一小点蓝影 + 翅
    {
      const [c, x] = mkCanvas(10, 8);
      x.fillStyle = PAL.ink;
      x.fillRect(2, 3, 5, 3); x.fillRect(6, 2, 3, 3);
      x.fillStyle = '#5f7d9e'; x.fillRect(3, 4, 3, 1);
      x.fillStyle = '#8aa8c8'; x.fillRect(2, 1, 2, 2);            // 翅尖
      x.fillStyle = '#e8a83a'; x.fillRect(8, 3, 1, 1);            // 喙
      x.fillStyle = PAL.ink; x.fillRect(7, 3, 1, 1);              // 眼
      s.bird = c;
    }
  }

  // ---------- 角色四方向合成 ----------
  // 正面直接用 dungeon 原帧；背面用发色铺满整个头部（含五官位置），绝不能从背后看到脸；侧面用后发盖住半张脸
  buildNpcs() {
    // [y, x, w] 逐行发型轮廓
    // 背面：覆盖 y=1..8 的整个头部（含眼嘴所在行），再加一行后颈阴影，确保背面看不到任何五官
    const BACK_HAIR = [[1, 4, 8], [2, 4, 8], [3, 4, 8], [4, 4, 8], [5, 4, 8], [6, 4, 8], [7, 4, 8], [8, 4, 8]];
    const SIDE_HAIR = [[1, 5, 6], [2, 4, 8], [3, 4, 7], [4, 4, 6], [5, 4, 6], [6, 4, 6], [7, 5, 5]];
    const FRONT_HAIR = [[1, 5, 6], [2, 5, 6], [3, 4, 8], [4, 4, 8]];
    for (const id of Object.keys(ROSTER_SPRITE)) {
      const { tile, hair, front } = ROSTER_SPRITE[id];
      const [base, bx] = mkCanvas(16, 16);
      this.blit(bx, 'dg', tile, 0, 0);
      // 正面补发色（仅原精灵发色不符的角色；避开头盔/巫师帽等特殊头部）
      if (front) { bx.fillStyle = hair; for (const [y, hx, w] of FRONT_HAIR) bx.fillRect(hx, y, w, 1); }

      // 背面：发色铺满整个头部（y=1..8 覆盖五官），下方加后颈阴影，杜绝从背后看到脸
      const [up, ux] = mkCanvas(16, 16);
      ux.drawImage(base, 0, 0);
      ux.fillStyle = hair;
      for (const [y, hx, w] of BACK_HAIR) ux.fillRect(hx, y, w, 1);
      // 后脑勺明暗：顶部微亮、底部后颈加深，避免纯色块
      ux.fillStyle = 'rgba(255,255,255,0.10)'; ux.fillRect(4, 1, 8, 1);
      ux.fillStyle = 'rgba(0,0,0,0.22)'; ux.fillRect(4, 7, 8, 2);
      ux.fillStyle = 'rgba(0,0,0,0.30)'; ux.fillRect(5, 9, 6, 1);

      // 右侧面：后发盖住左半脸与左眼，右眼保留为朝向眼
      const [right, rx] = mkCanvas(16, 16);
      rx.drawImage(base, 0, 0);
      rx.fillStyle = hair;
      for (const [y, hx, w] of SIDE_HAIR) rx.fillRect(hx, y, w, 1);
      rx.fillStyle = 'rgba(0,0,0,0.18)'; rx.fillRect(9, 4, 1, 4);
      // 左侧面：镜像
      const [left, lx] = mkCanvas(16, 16);
      lx.translate(16, 0); lx.scale(-1, 1);
      lx.drawImage(right, 0, 0);

      this.npc[id] = { down: base, up, left, right };
    }
  }

  // 生命层：新生儿精灵（遗传父母发色；四向含后脑勺遮脸）——出生/读档时运行时注册
  registerChild(id, hair) {
    if (this.npc[id]) return;
    const BACK = [[1, 4, 8], [2, 4, 8], [3, 4, 8], [4, 4, 8], [5, 4, 8], [6, 4, 8], [7, 4, 8], [8, 4, 8]];
    const SIDE = [[1, 5, 6], [2, 4, 8], [3, 4, 7], [4, 4, 6], [5, 4, 6], [6, 4, 6], [7, 5, 5]];
    const FRONT = [[1, 5, 6], [2, 5, 6], [3, 4, 8], [4, 4, 8]];
    const [base, bx] = mkCanvas(16, 16);
    this.blit(bx, 'dg', 87, 0, 0);          // 孩童身形（冯小明同款）
    bx.fillStyle = hair;
    for (const [y, hx, w] of FRONT) bx.fillRect(hx, y, w, 1);
    const [up, ux] = mkCanvas(16, 16);
    ux.drawImage(base, 0, 0);
    ux.fillStyle = hair;
    for (const [y, hx, w] of BACK) ux.fillRect(hx, y, w, 1);
    ux.fillStyle = 'rgba(255,255,255,0.10)'; ux.fillRect(4, 1, 8, 1);
    ux.fillStyle = 'rgba(0,0,0,0.22)'; ux.fillRect(4, 7, 8, 2);
    ux.fillStyle = 'rgba(0,0,0,0.30)'; ux.fillRect(5, 9, 6, 1);
    const [right, rx] = mkCanvas(16, 16);
    rx.drawImage(base, 0, 0);
    rx.fillStyle = hair;
    for (const [y, hx, w] of SIDE) rx.fillRect(hx, y, w, 1);
    rx.fillStyle = 'rgba(0,0,0,0.18)'; rx.fillRect(9, 4, 1, 4);
    const [left, lx] = mkCanvas(16, 16);
    lx.translate(16, 0); lx.scale(-1, 1);
    lx.drawImage(right, 0, 0);
    this.npc[id] = { down: base, up, left, right };
  }
}
