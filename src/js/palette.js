// palette.js - 锁色板（48色）：所有程序化补绘（角色修补/矿石/SITE/野猪/光照）必须取自本板
// 色值从 Kenney Tiny 系列素材采样，保证程序补件与图集风格统一
export const PAL = {
  // 草 4
  grassHi: '#79c45c', grass: '#5da845', grassLo: '#4a8a38', grassDeep: '#3a6e2e',
  // 树 6
  leaf: '#3d8a44', leafDeep: '#2f6b35', leafHi: '#58a850',
  leafAut: '#e0a83c', leafAutLo: '#c77b2e', bark: '#8f5a2a',
  // 土 4
  dirtHi: '#d9a06b', dirt: '#c08455', dirtLo: '#a0683f', soil: '#7d4f2e',
  // 沙 2
  sandHi: '#e3c98f', sand: '#d4b878',
  // 石 3
  stoneHi: '#aab0bb', stone: '#8d939e', stoneLo: '#6e7480',
  // 水 5
  waterHi: '#5fa8d8', water: '#4a90c4', waterLo: '#3d6e9e', waterDeep: '#2f5580', foam: '#cfe8ff',
  // 木 4
  woodHi: '#c7864a', wood: '#a3713c', woodLo: '#8a5c34', woodDeep: '#6f4526',
  // 瓦 4
  roofRed: '#c75a3e', roofRedLo: '#9e402e', roofBlue: '#7e8593', roofBlueLo: '#5f6675',
  // 金属 3
  gold: '#f0c84a', copper: '#d47d3a', iron: '#aebfce',
  // 火 3
  flameHi: '#f5b942', flame: '#e8772e', flameLo: '#e8552d',
  // 花 4
  flowerRed: '#e05a7a', flowerWhite: '#f0e8d8', flowerBlue: '#5a8cd4', flowerYellow: '#f8d94c',
  // 线/皮/界面 6
  ink: '#3a2a1e', skin: '#e8c49c', skinLo: '#c99a6e',
  uiBg: '#0f1115', uiCard: '#1a1d24', uiLine: '#262a33'
};

// 投影色（立体物统一右下暗影）
export const SHADOW = 'rgba(28,20,12,0.28)';

// 昼夜四段色温（分钟驱动平滑插值，lighting.js 使用）
// 每段：起/止小时与罩色 rgba
export const DAY_TINTS = [
  { h: 5.0, c: [26, 40, 74, 0.34] },   // 凌晨 冷蓝
  { h: 6.5, c: [255, 200, 140, 0.09] },// 清晨 暖
  { h: 8.5, c: [0, 0, 0, 0] },         // 上午 无罩
  { h: 16.0, c: [0, 0, 0, 0] },        // 下午
  { h: 17.8, c: [240, 140, 50, 0.13] },// 黄昏起橙
  { h: 19.0, c: [238, 116, 40, 0.22] },// 黄昏浓橙
  { h: 20.3, c: [16, 22, 56, 0.46] },  // 入夜
  { h: 22.5, c: [10, 14, 38, 0.58] },  // 深夜
  { h: 29.0, c: [26, 40, 74, 0.34] }   // 次日凌晨（循环）
];

// 校验：色板条目数（selftest 用）
export const PALETTE_SIZE = 48;
