// scale.js - 多尺度调度：时间尺度常量与触发判断（v4.4 世界自变）
// 单向依赖：无（纯调度抽象）

// 时间尺度（单位：游戏分钟）
// micro=每帧 / short=每小时 / medium=每半天 / daily=每天 / seasonal=每季 / geological=每年
export const SCALES = {
  MICRO:      { period: 1,      name: 'micro' },
  SHORT:      { period: 60,     name: 'short' },
  MEDIUM:     { period: 720,    name: 'medium' },
  DAILY:      { period: 1440,   name: 'daily' },
  SEASONAL:  { period: 43200,  name: 'seasonal' },
  GEOLOGICAL:{ period: 525600, name: 'geological' },
};

// 判断当前 tick 是否触发了某尺度
export function shouldTick(currentTick, scale) {
  if (currentTick <= 0) return false;
  return currentTick % scale.period === 0;
}

// 判断是否年轮转（在 onNewDay 里用 clock.year 变化判断更可靠）
export function isYearBoundary(oldYear, newYear) {
  return newYear !== oldYear;
}

// 判断是否季节更替
export function isSeasonBoundary(oldSeason, newSeason) {
  return newSeason !== oldSeason;
}
