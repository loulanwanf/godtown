// climate.js - 气候层：大周期/小周期/极端天气（v4.4 世界自变）
// 零内容红线：只写概率机制，不硬编码具体天气名称
// 单向依赖：core.js
import { mulberry32 } from './core.js';

export const CLIMATE = {
  enabled: true,
  // 大周期：旱涝交替，周期长度 30-60 年
  grandPeriodMin: 30,
  grandPeriodMax: 60,
  // 小周期：季节概率倾向（season 0=春 1=夏 2=秋 3=冬）
  seasonalBias: {
    0: { rain: 0.15, storm: 0.03, drought: 0.02 },
    1: { rain: 0.10, storm: 0.08, drought: 0.10 },
    2: { rain: 0.12, storm: 0.04, drought: 0.03 },
    3: { rain: 0.06, storm: 0.02, drought: 0.15 },
  },
  // 极端天气概率（每年）
  extremeProb: 0.08,
};

// 极端天气类型（物理分类，不是内容）
export const EXTREME = {
  DROUGHT: 'drought',
  FLOOD: 'flood',
  COLDWAVE: 'coldwave',
};

// 初始化气候状态
export function initClimateState(worldSeed) {
  const rng = mulberry32((worldSeed ^ 0xC1) >>> 0);
  const cycleLen = Math.floor(rng() * (CLIMATE.grandPeriodMax - CLIMATE.grandPeriodMin) + CLIMATE.grandPeriodMin);
  const phase = rng() < 0.5 ? 'wet' : 'dry';
  const yearsLeft = Math.floor(rng() * cycleLen) + 1;
  return { phase, yearsLeft, cycleLen };
}

// 气候 tick：每年一次
// state: 气候状态对象（会被原地修改）
// 返回 { weatherBias, extremeEvent, phase, cycleShifted }
export function climateTick(state, year, season, rng) {
  if (!CLIMATE.enabled) return { weatherBias: {}, extremeEvent: null, phase: 'normal', cycleShifted: false };

  // 推进大周期
  state.yearsLeft--;
  let cycleShifted = false;
  if (state.yearsLeft <= 0) {
    state.phase = state.phase === 'wet' ? 'dry' : 'wet';
    state.cycleLen = Math.floor(rng() * (CLIMATE.grandPeriodMax - CLIMATE.grandPeriodMin) + CLIMATE.grandPeriodMin);
    state.yearsLeft = state.cycleLen;
    cycleShifted = true;
  }

  // 大周期影响：湿润期降雨+干旱-，干旱期降雨-干旱+
  const grandBias = state.phase === 'wet'
    ? { rain: 0.10, drought: -0.05 }
    : { rain: -0.08, drought: 0.15 };

  // 小周期影响：季节概率调整
  const seasonal = CLIMATE.seasonalBias[season] || {};

  // 合成 weather 概率倾向
  const weatherBias = {
    rain: (grandBias.rain || 0) + (seasonal.rain || 0),
    storm: seasonal.storm || 0,
    drought: (grandBias.drought || 0) + (seasonal.drought || 0),
  };

  // 极端天气：低概率触发
  let extremeEvent = null;
  if (rng() < CLIMATE.extremeProb) {
    const types = [EXTREME.DROUGHT, EXTREME.FLOOD, EXTREME.COLDWAVE];
    extremeEvent = types[Math.floor(rng() * types.length)];
    // 大周期影响极端类型：湿润期更多洪水，干旱期更多旱灾
    if (state.phase === 'wet' && rng() < 0.6) extremeEvent = EXTREME.FLOOD;
    else if (state.phase === 'dry' && rng() < 0.6) extremeEvent = EXTREME.DROUGHT;
  }

  return { weatherBias, extremeEvent, phase: state.phase, cycleShifted };
}

// 序列化
export function serializeClimate(state) {
  if (!state) return null;
  return { phase: state.phase, yearsLeft: state.yearsLeft, cycleLen: state.cycleLen };
}

export function hydrateClimate(data) {
  if (!data) return initClimateState(0);
  return { phase: data.phase || 'wet', yearsLeft: data.yearsLeft || 1, cycleLen: data.cycleLen || 30 };
}
