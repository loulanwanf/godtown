// smoke280.mjs - v2.8.0 按需触发 CDP 冒烟：时刻错开/与门/cap 分批 4+4/候问超时/真实主循环节奏/存档
// 核心命题：不再有全镇共享的决策时刻——谁手头的事干完、自己的冷却到了，才单独被叫醒（同刻到期顺路搭批）
// 用法：node smoke280.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9400;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp280_'));
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  [PASS] ' + msg); }
  else { fail++; failures.push(msg); console.error('  [FAIL] ' + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg}（got ${JSON.stringify(a)} want ${JSON.stringify(b)}）`); }

async function main() {
  const proc = spawn('npx', ['electron', '.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
    cwd: new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    stdio: 'ignore', shell: true
  });
  try {
    let targets = null;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        targets = await r.json();
        if (targets.some(t => t.type === 'page' && t.url.includes('index.html'))) break;
      } catch { }
      await new Promise(r => setTimeout(r, 500));
    }
    const page = targets && targets.find(t => t.type === 'page' && t.url.includes('index.html'));
    ok(!!page, 'Electron 页面起来了（index.html）');
    if (!page) return;

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable');
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) return { err: r.result.exceptionDetails.text + ' ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '').slice(0, 200) };
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (await evalJs(`(() => !!(window.__game && window.__game.clock && window.__tileset))()`) === true) { ready = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    ok(ready, '游戏就绪（__game/__tileset 就位）');
    if (!ready) return;
    await evalJs(`(() => {
      window.__errs = [];
      window.addEventListener('error', e => window.__errs.push(String(e.message)));
      window.addEventListener('unhandledrejection', e => window.__errs.push('rej:' + String(e.reason)));
      const g = window.__game;
      g.clock.speed = 0;
      g.aiCfg.mode = 'auto'; g.aiCfg.apiKey = 'k'; g.aiCfg.model = 'm';
      if (g.aiCfg.npcPool) g.aiCfg.npcPool.enabled = false;
      // mock fetch：永远成功，决策内容由 requestAiBatch 包桩按本批名单注入（只落本批，仿真）
      window.__calls = 0;
      window.__batchLog = [];
      window.__mockContent = '{}';
      window.__origFetch = window.__origFetch || globalThis.fetch;
      globalThis.fetch = async () => { window.__calls++; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: window.__mockContent } }] }) }; };
      const __origBatch = g.requestAiBatch.bind(g);
      g.requestAiBatch = (batch) => {
        window.__batchLog.push(batch.length);
        window.__mockContent = JSON.stringify({ decisions: batch.map(n => ({ npc: n.name, action: 'idle', reason: '歇口气' })) });
        return __origBatch(batch);
      };
      g.aiSchedPaused = true;   // 确定性段：自动主循环不抢调，只由 __aiSchedTick 手动驱动
      return true;
    })()`);

    // 1) 句柄就位 + 开局个人时刻天然错开（没有全镇闹钟）
    const s0 = await evalJs(`(() => {
      const s = window.__aiSched();
      return { hasTick: typeof window.__aiSchedTick === 'function', total: s.people.length, distinct: new Set(s.people.map(p => p.dc)).size, cap: s.cap, win: s.window, timeout: s.timeout };
    })()`);
    ok(s0 && !s0.err && s0.hasTick === true, '按需调度句柄就位' + (s0 && s0.err ? '：' + s0.err : ''));
    eq(s0 && s0.total, 10, '十人在场');
    ok(s0 && s0.distinct >= 3, '开局个人决策时刻错开（非全镇同刻）');
    eq(s0 && s0.cap, 4, '批上限 4（同刻到期顺路搭车）');
    eq(s0 && s0.win, 30, '收集窗口 30 游戏分钟');
    eq(s0 && s0.timeout, 90, '候问超时 90 游戏分钟');

    // 2) cap 分批：十人同时到期 → 4 + 4 两批发出，剩 2 人候问
    const seq2 = await evalJs(`(async () => {
      const g = window.__game;
      g.npcs.forEach(n => { n.inside = false; n.path = []; n.intent = { type: 'ready', label: '待命', untilMin: 0 }; n.aiDcAt = g._aiNowMin() - 10; n.aiAsking = false; });
      g.aiBatch = []; g.aiBatchStart = 0; g.aiBusy = false; window.__calls = 0;
      window.__aiSchedTick();
      await new Promise(r => setTimeout(r, 120));
      const t1 = { calls: window.__calls, asking: g.npcs.filter(n => n.aiAsking).length, batch: g.aiBatch.length, busy: g.aiBusy };
      window.__aiSchedTick();
      await new Promise(r => setTimeout(r, 120));
      const t2 = { calls: window.__calls, asking: g.npcs.filter(n => n.aiAsking).length, batch: g.aiBatch.length, busy: g.aiBusy };
      window.__aiSchedTick();
      const t3 = { calls: window.__calls, asking: g.npcs.filter(n => n.aiAsking).length, batch: g.aiBatch.length };
      // 前 8 人决策回来后冷却应被重置到未来
      const released = g.npcs.filter(n => !n.aiAsking);
      return { t1, t2, t3, releasedFuture: released.length >= 8 && released.every(n => n.aiDcAt > g._aiNowMin()), batchLog: window.__batchLog.slice() };
    })()`);
    ok(seq2 && !seq2.err, 'cap 分批段跑通' + (seq2 && seq2.err ? '：' + seq2.err : ''));
    eq(seq2 && seq2.t1.calls, 1, '第一次：4 人成批发出');
    eq(seq2 && seq2.t1.asking, 6, '第一批 4 人应答、其余 6 人候问');
    eq(seq2 && seq2.t2.calls, 2, '第二次：再 4 人成批');
    eq(seq2 && seq2.t2.asking, 2, '两批后剩 2 人候问');
    eq(seq2 && seq2.t3.calls, 2, '剩 2 人未满窗口不发（各活各的，不硬凑）');
    eq(seq2 && seq2.t3.batch, 2, '2 人留在候问队列');
    ok(Array.isArray(seq2 && seq2.batchLog) && seq2.batchLog.length === 2 && seq2.batchLog.every(x => x === 4), '两批均为 4 人（从不超载叫醒）');
    ok(seq2 && seq2.releasedFuture === true, '应答者个人冷却重置到未来（平均间隔+抖动）');

    // 3) 与门：干长活的人冷却到了也不叫
    const gate = await evalJs(`(() => {
      const g = window.__game;
      const far = g._aiNowMin() + 9999;
      g.npcs.forEach(n => { n.aiAsking = false; n.aiDcAt = far; }); g.aiBatch = []; g.aiBatchStart = 0; g.aiBusy = false;
      const w = g.npcs[0], s = g.npcs[1];
      w.inside = false; w.path = []; w.intent = { type: 'work', label: '干活', untilMin: 60 }; w.aiDcAt = g._aiNowMin() - 100;
      s.inside = false; s.path = []; s.intent = { type: 'ready', label: '待命', untilMin: 0 }; s.aiDcAt = g._aiNowMin() - 100;
      window.__aiSchedTick();
      return { batchIds: g.aiBatch.map(n => n.id), workerKept: w.aiAsking === false, standbyIn: g.aiBatch.some(n => n.id === s.id) };
    })()`);
    ok(gate && gate.workerKept === true, '与门：活没干完不打断（干长活的人节奏自己定）');
    ok(gate && gate.standbyIn === true, '与门：待命且冷却到的人入候问');
    eq(gate && gate.batchIds.length, 1, '与门：本帧只有一人合格');

    // 4) 候问超时：90 分钟没应答 → 释放，脚本接得住
    const timeout = await evalJs(`(() => {
      const g = window.__game;
      const far = g._aiNowMin() + 9999;
      g.npcs.forEach((n, i) => { n.aiAsking = false; if (i !== 0) n.aiDcAt = far; }); g.aiBatch = []; g.aiBatchStart = 0; g.aiBusy = false;
      const w = g.npcs[0];
      w.inside = false; w.path = []; w.intent = { type: 'ready', label: '待命', untilMin: 0 }; w.aiDcAt = g._aiNowMin() - 10;
      window.__aiSchedTick();
      const inQueue = g.aiBatch.length;
      g.aiBatchStart = g._aiNowMin() - 91;
      window.__aiSchedTick();
      return { inQueue, after: g.aiBatch.length, asking: w.aiAsking, scriptGateOpen: w.intent.type === 'ready' && !w.aiAsking };
    })()`);
    eq(timeout && timeout.inQueue, 1, '超时前：人在候问');
    eq(timeout && timeout.after, 0, '超时：队列清空');
    ok(timeout && timeout.asking === false && timeout.scriptGateOpen === true, '超时释放后脚本闸重新打开（活着不等神仙）');

    // 5) 真实主循环 4x 跑帧：恢复自动调度——验证脚本让位后 LLM 真的轮得到、零错误、非全员同步
    await evalJs(`(() => {
      const g = window.__game;
      g.aiSchedPaused = false;
      g.npcs.forEach(n => { n.inside = false; n.path = []; n.intent = { type: 'ready', label: '待命', untilMin: 0 }; n.aiAsking = false; n.aiDcAt = g._aiNowMin() - 10; });
      g.aiBatch = []; g.aiBatchStart = 0; g.aiBusy = false; window.__calls = 0; window.__batchLog = [];
      g.clock.speed = 4;
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 6000));
    const run = await evalJs(`(() => {
      const g = window.__game;
      g.clock.speed = 0;
      const dcs = g.npcs.map(n => n.aiDcAt);
      return {
        errs: (window.__errs || []).slice(0, 5),
        alive: !!g.clock && g.clock.totalDay >= 0,
        calls: window.__calls,
        batchLog: window.__batchLog.slice(),
        distinctDc: new Set(dcs).size,
        noOneStuck: g.npcs.every(n => !n.aiAsking || g.aiBatch.includes(n)),
        logOk: g.logLines.some(l => String(l.text).includes('居民之魂'))
      };
    })()`);
    ok(run && run.alive === true, '真实主循环跑帧后游戏仍活');
    eq(run && run.errs.length, 0, '跑帧零 JS 错误（含 rejection）' + (run && run.errs.length ? '：' + JSON.stringify(run.errs) : ''));
    ok(run && run.calls >= 3, '真实时钟下脚本让位、LLM 真的轮得到（' + (run && run.calls || 0) + ' 批按需决策）');
    ok(run && run.batchLog.length > 0 && run.batchLog.every(x => x <= 4), '真实成批从不超过 4 人：' + JSON.stringify(run && run.batchLog));
    ok(run && run.distinctDc >= 3, '跑过后各人下次决策时刻仍错开（非同步）');
    ok(run && run.noOneStuck === true, '无人卡在幽灵候问状态');

    // 6) 存档：aiDcAt 随档走
    const rt = await evalJs(`(() => {
      const g = window.__game;
      g.saveLocal();
      const raw = localStorage.getItem('godtown.save.v2');
      const s = JSON.parse(raw);
      const hasField = s.npcs.every(n => typeof n.aiDcAt === 'number');
      const G = g.constructor;
      const g2 = G.hydrate(JSON.parse(raw), window.__renderer);
      const m = new Map(g.npcs.map(n => [n.id, n.aiDcAt]));
      return { hasField, restored: g2.npcs.every(n => n.aiDcAt === m.get(n.id)), askingCleared: g2.npcs.every(n => n.aiAsking === false) };
    })()`);
    ok(rt && rt.hasField === true, '存档带全员个人决策时刻');
    ok(rt && rt.restored === true, '读档后决策时刻复原');
    ok(rt && rt.askingCleared === true, '读档后在途态清零');

    // 还原 fetch
    await evalJs(`(() => { if (window.__origFetch) globalThis.fetch = window.__origFetch; return true; })()`);
    ws.close();
  } finally {
    // shell:true 下 proc.kill 只杀包装层——必须 taskkill 整树防僵尸占端口
    try { spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { }
    try { proc.kill(); } catch { }
  }
}

main()
  .catch(e => { fail++; failures.push('冒烟脚本异常：' + e.message); console.error(e); })
  .finally(() => {
    console.log(`\n冒烟完成：通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) { for (const f of failures) console.log('  - ' + f); process.exitCode = 1; }
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  });
