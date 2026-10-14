// smoke240.mjs - v2.4.0 涌现物理层 CDP 冒烟：持有结构/holdDaily 推进/占房认领/存读档往返
// 用法：node smoke240.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9360;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp240_'));
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
      if (r.result && r.result.exceptionDetails) return { err: r.result.exceptionDetails.text };
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    let ready = false;
    for (let i = 0; i < 40; i++) {
      const v = await evalJs(`(() => !!(window.__game && window.__game.clock && window.__tileset))()`);
      if (v === true) { ready = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    ok(ready, '游戏就绪（__game/__tileset 就位）');
    if (!ready) return;
    await evalJs(`(() => { window.__game.clock.speed = 0; return true; })()`);
    // 重播种 rng（占房抽签要确定性）
    await evalJs(`(() => { let s = 2026; window.__game.rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; return true; })()`);

    // 1) 涌现物理冒烟句柄就位
    ok(await evalJs(`typeof window.__holdDaily === 'function'`) === true, '__holdDaily 句柄就位');
    ok(await evalJs(`typeof window.__claims === 'function'`) === true, '__claims 句柄就位');

    // 2) 全镇统计字段在（交换/赖账/争议）
    const fields = await evalJs(`(() => {
      const g = window.__game;
      return [typeof g.exchangeStats, typeof g.owedDefaults, typeof g.claimDisputes, g.claims instanceof Map];
    })()`);
    ok(fields && fields[0] === 'object' && fields[1] === 'number' && fields[2] === 'number', 'exchangeStats/owedDefaults/claimDisputes 字段在');
    ok(fields && fields[3] === true, 'claims 是 Map');

    // 3) holdDaily 连跑 3 日无异常（clock.totalDay 是派生 getter，天数落笔形参）
    const errs = await evalJs(`(() => {
      const errs = [];
      for (let d = 1; d <= 3; d++) {
        try { window.__holdDaily(d); } catch (e) { errs.push(String((e && e.message) || e)); }
      }
      return errs;
    })()`);
    ok(Array.isArray(errs) && errs.length === 0, 'holdDaily 连跑 3 日无异常' + (errs && errs.length ? '（' + errs[0] + '）' : ''));

    // 4) holdDaily 之后全体 NPC 惰性拿到持有结构
    const holdInfo = await evalJs(`(() => {
      const ns = window.__game.npcs;
      const bad = ns.filter(n => !n.hold || typeof n.hold.purse !== 'number'
        || !n.hold.goods || typeof n.hold.goods !== 'object' || !Array.isArray(n.hold.owed));
      return { total: ns.length, bad: bad.length };
    })()`);
    ok(holdInfo && holdInfo.total > 0, 'NPC 名册在');
    eq(holdInfo && holdInfo.bad, 0, '全体 NPC 持有结构健全（purse/goods/owed）');

    // 5) 占房认领：把一位有房成年人的宅子变成无主空房、把他变成无房者，逐日推进直到他占着
    //    （注意：开局可能已有旅行者也走了认领入口——必须按 by===本人 判定新 claim，不能只看数量）
    const squat = await evalJs(`(() => {
      const g = window.__game;
      const n = g.npcs.find(n => n.body.ageYears >= 18 && !n.dying
        && g.world.houses.some(h => h.ownerId === n.id)
        && !window.__claims().some(c => c.by === n.id));   // 排除开局已认领过的（如旅行者）
      if (!n) return null;
      const h = g.world.houses.find(h => h.ownerId === n.id);
      h.ownerId = 'ghost-smoke'; h.ownerName = '冒烟故人';   // 主人已不在世 → 空房
      n.home = null;                                          // 无房成年人
      window.__smokeSquatter = n.id;
      return { id: n.id };
    })()`);
    ok(!!squat, '找到一位有房的成年人做占房候选');
    const claimed = await evalJs(`(() => {
      for (let d = 10; d <= 80; d++) {
        window.__holdDaily(d);
        const c = window.__claims().find(c => c.by === window.__smokeSquatter);
        if (c) return { d, key: c.key };
      }
      return 0;
    })()`);
    ok(claimed && claimed.d > 0, `占房发生了（第 ${claimed && claimed.d} 天登记 claim）`);

    // 6) __claims 读出的登记结构健全
    const claimInfo = await evalJs(`(() => {
      const c = window.__claims().find(c => c.by === window.__smokeSquatter);
      if (!c) return null;
      return { key: typeof c.key === 'string' && c.key.includes(','),
        since: typeof c.since === 'number',
        rec: typeof c.rec === 'number' && typeof c.no === 'number' };
    })()`);
    ok(claimInfo && claimInfo.key === true, 'claim 键是 "x,y" 形');
    ok(claimInfo && claimInfo.since === true, 'claim 有登记日 since');
    ok(claimInfo && claimInfo.rec === true, 'claim 有公认计数（认/不认）');

    // 7) 占房者真的搬进去了（房子主人接回活人）
    ok(await evalJs(`(() => {
      const g = window.__game;
      const n = g.npcs.find(n => n.id === window.__smokeSquatter);
      return !!(n && n.home && g.world.houses.some(h => h.ownerId === n.id));
    })()`) === true, '占着=人在那里（home 与 ownerId 接回）');

    // 8) 存档带涌现物理字段
    await evalJs(`(() => { window.__game.saveLocal(); return true; })()`);
    const saved = await evalJs(`(() => {
      const s = JSON.parse(localStorage.getItem('godtown.save.v2'));
      const withHold = s.npcs.filter(n => n.hold && typeof n.hold.purse === 'number').length;
      return [typeof s.exchangeStats === 'object' && s.exchangeStats !== null,
        typeof s.owedDefaults === 'number', typeof s.claimDisputes === 'number',
        Array.isArray(s.claims), s.claims.length, withHold];
    })()`);
    ok(saved && saved[0] === true, '存档带 exchangeStats');
    ok(saved && saved[1] === true && saved[2] === true, '存档带 owedDefaults/claimDisputes');
    ok(saved && saved[3] === true && saved[4] > 0, '存档带 claims（entries）');
    ok(saved && saved[5] > 0, '存档里 NPC 带 hold（' + (saved && saved[5]) + ' 人）');

    // 9) 读档后涌现物理层还在
    const gs2 = await evalJs(`(() => {
      const raw = localStorage.getItem('godtown.save.v2');
      if (!raw) return null;
      const data = JSON.parse(raw);
      const G = window.__game.constructor;
      const g = G.hydrate(data, window.__renderer);
      const n = g.npcs.find(n => n.hold && typeof n.hold.purse === 'number');
      const es = [...g.claims.entries()];
      return { claimsIsMap: g.claims instanceof Map, claims: es.length,
        exch: typeof g.exchangeStats === 'object' && g.exchangeStats !== null,
        hold: !!n, claimBy: es.length ? es[0][1].by : null };
    })()`);
    ok(gs2 && gs2.claimsIsMap === true && gs2.claims > 0, '读档后 claims Map 复原');
    ok(gs2 && gs2.exch === true, '读档后 exchangeStats 还在');
    ok(gs2 && gs2.hold === true, '读档后 NPC 持有还在');
    ok(gs2 && gs2.claimBy != null, '读档后 claim 登记人还在');

    ws.close();
  } finally {
    // shell:true 下 proc.kill 只杀 npx/cmd 包装层，electron 孙进程会残留并占住调试端口——必须 taskkill 整树
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
