// weather.js - 天气系统：按季概率轮换 + 上帝强制覆盖（环境无关）
import { WEATHERS, choice, rint } from './core.js';

// 各季节天气权重表（单位：游戏小时）
const SEASON_TABLES = {
  0: [['sunny', 14], ['cloudy', 8], ['rain', 5], ['storm', 1]],          // 春
  1: [['sunny', 16], ['cloudy', 6], ['rain', 4], ['storm', 2]],          // 夏
  2: [['sunny', 12], ['cloudy', 8], ['rain', 6], ['storm', 1]],          // 秋
  3: [['sunny', 10], ['cloudy', 8], ['rain', 2], ['snow', 8]]            // 冬（snow 顶替 storm）
};

export class WeatherSys {
  constructor(rng) {
    this.rng = rng;
    this.type = 'sunny';
    this.remainMin = 6 * 60;
    this.forced = false;   // 上帝强制中，到期前不被自然轮换
    this.flash = 0;        // 闪电闪光强度（渲染用，衰减）
  }
  get label() { return WEATHERS[this.type]; }
  get raining() { return this.type === 'rain' || this.type === 'storm'; }
  get snowing() { return this.type === 'snow'; }
  get stormy() { return this.type === 'storm'; }
  get precipitating() { return this.raining || this.snowing; }

  tick(gameMin, season, onStormBolt) {
    // 闪电（flash 衰减由渲染层按真实时间处理）
    if (this.stormy && this.rng() < gameMin * 0.02) {
      this.flash = 1;
      if (onStormBolt) onStormBolt();
    }

    this.remainMin -= gameMin;
    if (this.remainMin > 0) return null;
    // 到期 → 按季轮换
    const table = SEASON_TABLES[season] || SEASON_TABLES[0];
    const pool = [];
    for (const [t, hrs] of table) { for (let i = 0; i < hrs; i++) pool.push(t); }
    // 避免连续两次同类型（除晴）
    let next = choice(this.rng, pool);
    let guard = 0;
    while (next === this.type && this.type !== 'sunny' && guard++ < 5) next = choice(this.rng, pool);
    const hours = rint(this.rng, 4, 12);
    this.set(next, hours, false);
    return next;
  }
  // 上帝操作：强制天气 n 小时
  force(type, hours) {
    this.set(type, hours, true);
  }
  set(type, hours, forced) {
    this.type = type;
    this.remainMin = hours * 60;
    this.forced = !!forced;
  }
  serialize() { return { type: this.type, remainMin: this.remainMin, forced: this.forced }; }
  static from(o, rng) {
    const w = new WeatherSys(rng);
    if (o) { w.type = o.type || 'sunny'; w.remainMin = o.remainMin ?? 360; w.forced = !!o.forced; }
    return w;
  }
}
