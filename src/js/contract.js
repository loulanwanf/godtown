// contract.js - 数据契约：意图契约、校验器、降级翻译（v1.3.0 地基层·第一件）
// 计划书第四章：AI 生成数据，引擎解释数据。契约之外一律拒收；
// 契约要宽（自由字段/条件字段/概率字段）；校验失败不报错崩溃，而是降级——翻译成最接近的合法意图。
// 意图五要素：类型、参数、优先级、理由（必填）、过期时间、来源。理由字段是整个项目的调试命脉。

// 已知意图类型表（v4.1：从白名单改为已知表——表内走专属快速路径；
// 表外不再拒收，标记 open 走通用裁决路径。动词不设清单，世界不按字面值拒收）
import { OPEN_ACTIONS } from './action.js';

export const INTENT_TYPES = [
  'work', 'goto', 'chat', 'eat', 'sleep', 'idle',
  'build', 'scout', 'chop', 'mine', 'say',
  'haul', 'mill', 'repair'
];

// 条件字段谓词白名单（什么情况下有效；不满足时意图合法但不生效）
export const INTENT_CONDS = ['raining', 'snowing', 'storming', 'night', 'daytime', 'hungry', 'tired'];

// 单日意图上限（防 AI 刷屏；引擎内生的脚本决策不计入）
export const DAILY_INTENT_LIMIT = 30;

// 把任意来源的原始提议洗成契约内的意图对象（宽容原则：能收的都收，结构外进 free）
// raw: { type/action, params/target/planId/npc..., priority, reason/why, cond, prob, source }
export function makeIntent(raw, ctx) {
  const c = ctx || {};
  const type = String(raw.type || raw.action || '').trim().toLowerCase();
  const params = {};
  for (const k of ['target', 'planId', 'npc', 'tx', 'ty', 'area', 'dur']) {
    if (raw[k] != null) params[k] = raw[k];
  }
  // 自由字段：AI 塞结构外的补充，引擎不解释但保留（格式宽一分，世界能长的空间就大一分）
  const KNOWN = new Set(['type', 'action', 'target', 'planId', 'npc', 'tx', 'ty', 'area', 'dur',
    'priority', 'reason', 'why', 'cond', 'prob', 'source', 'say']);
  const free = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN.has(k) && v != null && typeof v !== 'function') free[k] = v;
  }
  return {
    type,
    params,
    priority: Number.isFinite(+raw.priority) ? clamp(+raw.priority, 0, 100) : 50,
    reason: String(raw.reason || raw.why || '').trim(),   // 必填；为空由校验器兜底补可解释理由
    cond: raw.cond != null ? String(raw.cond).trim() : null,
    prob: Number.isFinite(+raw.prob) ? clamp(+raw.prob, 0, 1) : null,   // 概率字段：不一定成功
    expiresAt: c.nowMin != null ? c.nowMin + (Number(raw.expiresInMin) > 0 ? Number(raw.expiresInMin) : 240) : null,
    source: raw.source || 'llm',
    free,
    say: raw.say != null ? String(raw.say).slice(0, 40) : ''
  };
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// 条件判定：不认识的条件 → false（契约之外拒收）
export function condMet(cond, ctx) {
  if (!cond) return true;
  const c = ctx || {};
  if (cond === 'raining') return !!c.raining;
  if (cond === 'snowing') return !!c.snowing;
  if (cond === 'storming') return !!c.stormy;
  if (cond === 'night') return !!c.isNight;
  if (cond === 'daytime') return !c.isNight;
  if (cond === 'hungry') return !!c.hungry;
  if (cond === 'tired') return !!c.tired;
  return false;
}

// 校验一个意图。返回 { verdict:'pass'|'skip'|'fallback', intent, why }
// pass=合法入队；skip=条件字段不满足（合法但不生效）；fallback=非法，已翻译成最接近的合法意图
export function validateIntent(intent, ctx) {
  const c = ctx || {};
  const npc = c.npc;
  // 结构：表内类型走专属快速路径；表外类型不再拒收——
  // 标记 open，交执行器的通用裁决路径（物理上会发生什么由裁决层回答，不由清单回答）。
  // 回滚保险：OPEN_ACTIONS 关掉时退回旧行为（降级 idle）。
  if (!INTENT_TYPES.includes(intent.type)) {
    if (!OPEN_ACTIONS.enabled) {
      return {
        verdict: 'fallback',
        intent: fallbackIntent(intent, 'idle', null, '想做「' + intent.type + '」但没说成，先待着'),
        why: '未知意图类型'
      };
    }
    intent.open = true;   // 未知类型走通用路径：理由/条件/上限等其余校验照常
  }
  // 理由必填：为空不报错，兜底补一个可解释的理由（铁律4：每个决策必须可解释）
  if (!intent.reason) {
    intent.reason = defaultReason(intent, c) + '（没说为什么）';
  }
  // 条件字段不满足 → 合法但不生效
  if (!condMet(intent.cond, c)) {
    return { verdict: 'skip', intent, why: '条件未满足：' + intent.cond };
  }
  // 概率字段：不一定成功（由调用方 roll，这里只校验取值已 clamp）
  // 单日意图上限
  if (npc && npc._dayIntents >= DAILY_INTENT_LIMIT) {
    return {
      verdict: 'fallback',
      intent: fallbackIntent(intent, 'idle', null, '今天已经忙够了，想歇歇'),
      why: '超出单日意图上限'
    };
  }
  // 目标可达 + 不进别人家（校验目标 tx/ty 类意图；区域/人名目标由执行器寻路兜底）
  const tx = intent.params.tx, ty = intent.params.ty;
  if (tx != null && ty != null && c.w) {
    const x = Math.floor(tx), y = Math.floor(ty);
    const house = c.w.houses.find(h => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h);
    if (house && npc && house.ownerId !== npc.id) {
      return {
        verdict: 'fallback',
        intent: fallbackIntent(intent, 'goto', { tx: house.ox, ty: house.oy },
          '想去' + (house.ownerName || '别人家') + '屋里，想想还是在门外等吧'),
        why: '目标在他人的家'
      };
    }
    if (!c.walkableAll || !c.walkableAll(x, y)) {
      return {
        verdict: 'fallback',
        intent: fallbackIntent(intent, 'idle', null, '想去的地方过不去，就近转转'),
        why: '目标不可达'
      };
    }
  }
  return { verdict: 'pass', intent, why: '' };
}

// 降级翻译：把非法意图翻译成最接近的合法意图（保留理由——调试命脉不能丢）
export function fallbackIntent(src, type, params, reason) {
  return {
    type,
    params: params || {},
    priority: src.priority || 50,
    reason: reason || src.reason || '（动机不明）',
    cond: null,
    prob: src.prob,
    expiresAt: src.expiresAt,
    source: src.source,
    free: src.free || {},
    say: src.say || '',
    fallbackOf: src.type || String(src)
  };
}

// 缺理由时的兜底理由（按意图类型给出可解释的默认动机）
function defaultReason(intent, ctx) {
  const n = ctx && ctx.npc;
  switch (intent.type) {
    case 'eat': return '肚子饿了';
    case 'sleep': return '困了';
    case 'work': case 'chop': case 'mine': return '该干点正事了';
    case 'chat': return '想找人说说话';
    case 'build': return '镇上需要点东西';
    case 'scout': return '想去外面走走';
    case 'haul': return '总得有人把材料搬来搬去';
    case 'mill': return '坊里的原木该锯成板了';
    case 'repair': return '破了的地方得修，不然就塌了';
    case 'say': return '有话想说';
    case 'goto': return '想去那边看看';
    case 'idle': return n && n.needs && n.needs.mood < 40 ? '心情不佳，想静一静' : '闲着也是闲着';
    default: return '心里起了个念头';
  }
}

// 概率判定：prob 为空必成功；否则 roll（由外部传入 rng）
export function probPass(intent, rng) {
  if (intent.prob == null) return true;
  return rng() < intent.prob;
}
