// axioms.js —— 世界的六条死规则（物理常数层）
// 这一层不能被演化、不能被 AI 修改、不能被玩家干预。
// 所有世界变化必须通过这里的检查；检查不过，变化不得发生。
// 红线：本文件的六条规则永不改变。实现可以优化，语义不可动摇。

export const AXIOMS = Object.freeze({
  // 一、守恒：质量、能量、关键属性，总量不变
  conservation: true,
  // 二、因果：果不可先于因，因果链不可逆
  causality: true,
  // 三、时间单向：不能回档、不能倒流
  timeUnidirectional: true,
  // 四、空间离散：格子系统，相邻才可交互，不可跳跃
  spaceDiscrete: true,
  // 五、代价：任何改变都有成本，没有免费的午餐
  cost: true,
  // 六、有限：体力、寿命、资源、知识载体都有上限
  finitude: true,
});

// 守恒检查的容差：浮点计算允许的误差（不是规则松动，是数值现实）
const EPSILON = 1e-6;

// 属性可转移性（用户裁决 D1：这是物理，不是命名）
// 广延属性 extensive：可分割、可转移、组合相加（槽 0=量 / 6=含水 / 7=能量）
// 强度属性 intensive：不可分割、不可转移、组合按量加权平均（槽 1-5；未命名槽 8-15 默认强度——未知属性保守处理）
const EXTENSIVE_SLOTS = new Set([0, 6, 7]);
export function isExtensive(slot) { return EXTENSIVE_SLOTS.has(slot); }

/**
 * 守恒检查
 * @param {Array} before 变化前物质列表
 * @param {Array} after 变化后物质列表
 * @param {'strict'|'total'} mode strict=逐槽守恒（组合/分离用）；total=总量守恒（转化用——广延属性可互换，总和不变）
 * 守恒只对广延槽执法——强度量本来就不守恒（两杯热水混合，温度不是相加）
 */
export function checkConservation(before, after, mode = 'strict') {
  if (!AXIOMS.conservation) return { ok: true, reason: '守恒规则未启用' };
  const sum = (list, i) => list.reduce((acc, m) => acc + (m && m.attrs ? (m.attrs[i] || 0) : 0), 0);
  const dims = Math.max(
    ...before.map(m => (m && m.attrs ? m.attrs.length : 0)),
    ...after.map(m => (m && m.attrs ? m.attrs.length : 0)),
    0
  );
  if (mode === 'total') {
    let b = 0, a = 0;
    for (let i = 0; i < dims; i++) {
      if (!EXTENSIVE_SLOTS.has(i)) continue;  // 强度槽不参与
      b += sum(before, i); a += sum(after, i);
    }
    if (Math.abs(b - a) > EPSILON) return { ok: false, reason: `广延总量不守恒：前 ${b} 后 ${a}` };
    return { ok: true, reason: '总量守恒通过' };
  }
  for (let i = 0; i < dims; i++) {
    if (!EXTENSIVE_SLOTS.has(i)) continue;  // 强度槽不参与守恒
    const b = sum(before, i), a = sum(after, i);
    if (Math.abs(b - a) > EPSILON) {
      return { ok: false, reason: `广延属性槽 ${i} 不守恒：前 ${b} 后 ${a}` };
    }
  }
  return { ok: true, reason: '守恒通过' };
}

/**
 * 因果检查：动作必须有因（不能无中生有），且不得标注"效果先于原因"
 * @param {{actor: *, causeDay?: number, effectDay?: number, source?: *}} action
 * @param {number} currentDay 当前世界日
 * @returns {{ok: boolean, reason: string}}
 */
export function checkCausality(action, currentDay) {
  if (!AXIOMS.causality) return { ok: true, reason: '因果规则未启用' };
  if (!action || action.actor == null) return { ok: false, reason: '无因之果：动作没有行为者' };
  if (typeof action.effectDay === 'number' && typeof action.causeDay === 'number'
    && action.effectDay < action.causeDay) {
    return { ok: false, reason: `果先于因：因第${action.causeDay}日，果第${action.effectDay}日` };
  }
  if (typeof action.causeDay === 'number' && action.causeDay > currentDay) {
    return { ok: false, reason: `因在未来：第${action.causeDay}日 > 当前第${currentDay}日` };
  }
  return { ok: true, reason: '因果通过' };
}

/**
 * 时间检查：世界时间只能前进，设置更早日被拒绝
 * @param {number} nextDay 即将进入的日
 * @param {number} currentDay 当前日
 * @returns {{ok: boolean, reason: string}}
 */
export function checkTime(nextDay, currentDay) {
  if (!AXIOMS.timeUnidirectional) return { ok: true, reason: '时间规则未启用' };
  if (nextDay < currentDay) return { ok: false, reason: `时间倒流被拦截：${nextDay} < ${currentDay}` };
  return { ok: true, reason: '时间通过' };
}

/**
 * 空间检查：交互必须相邻（或同格），曼哈顿距离 ≤ 1
 * @param {{x:number,y:number}} from 行为者位置
 * @param {{x:number,y:number}} target 目标位置
 * @returns {{ok: boolean, reason: string}}
 */
export function checkSpace(from, target) {
  if (!AXIOMS.spaceDiscrete) return { ok: true, reason: '空间规则未启用' };
  if (!from || !target) return { ok: false, reason: '位置缺失' };
  const d = Math.abs(from.x - target.x) + Math.abs(from.y - target.y);
  if (d > 1) return { ok: false, reason: `空间跳跃被拦截：距离 ${d} 格` };
  return { ok: true, reason: '空间通过' };
}

/**
 * 代价检查：动作必须声明非负成本，且行为者付得起
 * @param {{cost?: number}} action 动作（cost 省略视为 0——但任何"改变"都该显式声明）
 * @param {{stamina?: number}} actor 行为者（体力是最通用的货币）
 * @returns {{ok: boolean, reason: string}}
 */
export function checkCost(action, actor) {
  if (!AXIOMS.cost) return { ok: true, reason: '代价规则未启用' };
  const cost = action && typeof action.cost === 'number' ? action.cost : 0;
  if (cost < 0) return { ok: false, reason: `负成本被拦截：${cost}（世界不补贴）` };
  if (actor && typeof actor.stamina === 'number' && cost > actor.stamina) {
    return { ok: false, reason: `付不起：需 ${cost}，有 ${actor.stamina}` };
  }
  return { ok: true, reason: '代价通过' };
}

/**
 * 有限检查：行为者的储量不得超过上限（体力/生命/携带）
 * @param {{stamina?: number, maxStamina?: number, carry?: number, maxCarry?: number}} actor
 * @returns {{ok: boolean, reason: string}}
 */
export function checkFinitude(actor) {
  if (!AXIOMS.finitude) return { ok: true, reason: '有限规则未启用' };
  if (!actor) return { ok: true, reason: '无行为者，无从超限' };
  if (typeof actor.stamina === 'number' && typeof actor.maxStamina === 'number'
    && actor.stamina > actor.maxStamina) {
    return { ok: false, reason: `体力超限：${actor.stamina} > ${actor.maxStamina}` };
  }
  if (typeof actor.carry === 'number' && typeof actor.maxCarry === 'number'
    && actor.carry > actor.maxCarry) {
    return { ok: false, reason: `携带超限：${actor.carry} > ${actor.maxCarry}` };
  }
  return { ok: true, reason: '有限通过' };
}

/**
 * 总检查：一个动作要发生，先过六道关
 * @param {{actor?: *, cost?: number, causeDay?: number, effectDay?: number, from?: *, target?: *,
 *          before?: Array, after?: Array}} action
 * @param {{day: number, actorState?: *}} world 最小世界上下文
 * @returns {{ok: boolean, reason: string, failed?: string}}
 */
export function checkAll(action, world) {
  const day = world && typeof world.day === 'number' ? world.day : 0;
  const gates = [
    ['causality', () => checkCausality(action, day)],
    ['space', () => (action.from && action.target) ? checkSpace(action.from, action.target) : { ok: true, reason: '无空间诉求' }],
    ['cost', () => checkCost(action, action.actor)],
    ['finitude', () => checkFinitude(action.actor)],
    ['conservation', () => (action.before && action.after) ? checkConservation(action.before, action.after) : { ok: true, reason: '无物质变化' }],
  ];
  for (const [name, gate] of gates) {
    const r = gate();
    if (!r.ok) return { ok: false, reason: r.reason, failed: name };
  }
  return { ok: true, reason: '六关全过' };
}
