// time.js - 游戏时钟：日/季/年/昼夜相位（环境无关）
import { SEASONS, fmtClock, clamp } from './core.js';

export const DAYS_PER_SEASON = 12;
// 速度档：1 real 秒 = speed * 2 游戏分钟
export const SPEED_STEPS = { 0: 0, 1: 2, 2: 4, 4: 8 };

export class GameClock {
  constructor() {
    this.year = 1;
    this.season = 0;      // 0春 1夏 2秋 3冬
    this.day = 1;         // 季内第 1..12 日
    this.min = 6 * 60;    // 当日分钟（从清晨 6:00 开始）
    this.speed = 1;
  }
  get hour() { return this.min / 60; }
  get totalDay() { return (this.year - 1) * 48 + this.season * DAYS_PER_SEASON + this.day; }

  tick(realDtSec) {
    const gm = SPEED_STEPS[this.speed] * realDtSec;
    if (!(gm > 0)) return { newDay: false };   // 暂停/未知速度档/NaN 一律不推进
    return this.advance(gm);
  }
  // 直接推进 n 游戏分钟（selftest/跳日共用）
  advance(gameMin) {
    const out = { newDay: false, days: 0 };
    this.min += gameMin;
    while (this.min >= 24 * 60) {
      this.min -= 24 * 60;
      this.day++;
      out.newDay = true; out.days++;
      if (this.day > DAYS_PER_SEASON) {
        this.day = 1; this.season++;
        if (this.season > 3) { this.season = 0; this.year++; }
      }
    }
    return out;
  }
  skipToMorning() {
    // 跳到次日 6:00（返回跨日信息，调用方需据此触发 onNewDay）
    return this.advance(24 * 60 - this.min + 6 * 60);
  }
  isNight() { return this.hour < 6 || this.hour >= 19.5; }
  // 光照相位: 0白天 0.5黄昏 1夜晚 → 返回夜色强度 0..1
  nightAmount() {
    const h = this.hour;
    if (h >= 7 && h < 17.5) return 0;
    if (h >= 17.5 && h < 19.5) return clamp((h - 17.5) / 2, 0, 1) * 0.8;
    if (h >= 19.5 || h < 5) return 1;
    if (h >= 5 && h < 7) return clamp((7 - h) / 2, 0, 1) * 0.8;
    return 0;
  }
  label() {
    return `第${this.year}年 ${SEASONS[this.season]} ${this.day}日 ${fmtClock(this.hour)}`;
  }
  serialize() { return { year: this.year, season: this.season, day: this.day, min: this.min, speed: this.speed }; }
  static from(o) {
    const c = new GameClock();
    if (o) { c.year = o.year || 1; c.season = o.season || 0; c.day = o.day || 1; c.min = o.min ?? 6 * 60; c.speed = o.speed ?? 1; }
    return c;
  }
}
