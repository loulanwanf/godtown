// adjudicator.js —— 裁决层：只回答"物理上会发生什么"
// 不评价"好不好"、不写台词、不查动作清单。动词对它透明——它只看目标物质。
// 流程：六关检查（axioms）→ 目标物质两两接触（matter.contact）→ 返回槽位变化清单。
// 红线：本层不做任何内容判断；"石头不燃"这类话不归这里说，这里只有数字变化。

import { checkAll } from './axioms.js';
import { contact, ATTR_DIMS } from './matter.js';

/** 是不是物质实例（有 16 槽属性数组） */
export function isMatter(x) {
  return !!x && !!x.attrs && typeof x.attrs.length === 'number';
}

/**
 * 裁决一个动作
 * @param {{actor:*, verb:string, targets:Array, cost?:number, causeDay?:number}} action
 * @param {{clock?:{totalDay:number}, day?:number}} world 最小世界上下文
 * @returns {{legal:boolean, reason:string, failed?:string, effects:Array}}
 *   effects: [{target, slot, from, to}] —— 纯数字清单，给谁看、怎么说是上层的事
 */
export function adjudicate(action, world) {
  if (!action || action.actor == null) {
    return { legal: false, reason: '无行为者', effects: [] };
  }
  const day = world && world.clock && typeof world.clock.totalDay === 'number'
    ? world.clock.totalDay
    : (world && typeof world.day === 'number' ? world.day : 0);

  // 六道关：因果/空间/代价/有限/守恒（空间诉求仅当双方都有坐标时才查）
  const probe = {
    actor: action.actor,
    cost: typeof action.cost === 'number' ? action.cost : 0,
    causeDay: typeof action.causeDay === 'number' ? action.causeDay : day,
  };
  const from = action.actor && typeof action.actor.x === 'number' ? { x: Math.floor(action.actor.x), y: Math.floor(action.actor.y) } : null;
  const firstPos = (action.targets || []).map(t => t && t.pos).find(p => p && typeof p.x === 'number');
  if (from && firstPos) { probe.from = from; probe.target = firstPos; }
  const gate = checkAll(probe, { day });
  if (!gate.ok) return { legal: false, reason: gate.reason, failed: gate.failed, effects: [] };

  // 物理执行：目标里的物质两两接触，广延量沿梯度流动
  const matters = (action.targets || []).filter(isMatter);
  const effects = [];
  if (matters.length < 2) {
    return { legal: true, reason: '没有可相互作用的物质目标，动作落空', effects };
  }
  for (let i = 0; i < matters.length - 1; i++) {
    const a = matters[i], b = matters[i + 1];
    const beforeA = Array.from(a.attrs), beforeB = Array.from(b.attrs);
    const r = contact(a, b, 0.5);
    if (!r.ok) return { legal: false, reason: r.reason, effects };
    for (let s = 0; s < ATTR_DIMS; s++) {
      if (a.attrs[s] !== beforeA[s]) effects.push({ target: a, slot: s, from: beforeA[s], to: a.attrs[s] });
      if (b.attrs[s] !== beforeB[s]) effects.push({ target: b, slot: s, from: beforeB[s], to: b.attrs[s] });
    }
  }
  return { legal: true, reason: effects.length ? '物理执行完毕' : '接触了，但双方已达均衡，无变化', effects };
}
