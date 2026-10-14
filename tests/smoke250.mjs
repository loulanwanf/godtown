// smoke250.mjs - v2.5.0 神经芯 CDP 冒烟：芯结构/奖励调制/死亡游荡/落进新生儿/轮回不灭/存读档往返
// 用法：node smoke250.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9370;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp250_'));
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

    // 1) 神经芯冒烟句柄就位
    ok(await evalJs(`typeof window.__neuro === 'function'`) === true, '__neuro 句柄就位');
    ok(await evalJs(`typeof window.__neuroObserve === 'function'`) === true, '__neuroObserve 句柄就位');
    ok(await evalJs(`typeof window.__neuroDaily === 'function'`) === true, '__neuroDaily 句柄就位');

    // 2) 芯结构：开局一颗、寄宿在册、基线权重、未游荡
    const core0 = await evalJs(`(() => {
      const g = window.__game, c = g.neurocore;
      return { has: !!c, hostIn: g.npcs.some(n => n.id === c.hostId), gen: c.gen,
        keys: Object.keys(c.w).sort().join(','), floating: c.floating, rounds: c.rounds };
    })()`);
    ok(core0 && core0.has === true, '开局有一颗芯');
    ok(core0 && core0.hostIn === true, '芯寄宿在名册居民身上');
    eq(core0 && core0.gen, 1, '初始第一代');
    ok(core0 && core0.keys === 'exist,scout,wander,work', '权重表四轴（exist/scout/wander/work）');
    ok(core0 && core0.floating === false && core0.rounds === 0, '开局附身、未游荡、零轮回');

    // 3) 奖励调制：需求改善→强化最近动作（固定步长，零随机）
    const learn = await evalJs(`(() => {
      const g = window.__game, c = g.neurocore;
      const host = g.npcs.find(n => n.id === c.hostId);
      c._snap = null; c._prevAction = null;
      const before = c.w.scout;
      window.__neuroObserve(host.id, 'scout');            // 建立快照
      host.needs.mood = Math.min(100, host.needs.mood + 30);
      host.needs.energy = Math.min(100, host.needs.energy + 15);
      const r = window.__neuroObserve(host.id, 'wander'); // 上一动作 scout → 强化
      return { before, after: r.w.scout, decisions: r.stats.decisions };
    })()`);
    eq(learn && learn.after, (learn && learn.before) + 2, '需求改善→强化最近动作 +2（零随机）');
    ok(learn && learn.decisions >= 2, '决策计数在走（' + (learn && learn.decisions) + '）');

    // 4) 宿主死亡 → 芯游荡；新生儿降生 → 芯落进去（世代 +1，权重带走）
    const deathRebirth = await evalJs(`(() => {
      const g = window.__game, c = g.neurocore;
      const day0 = g.clock.totalDay;
      window.__lifeForceDeath(c.hostId);
      const floating = { floating: c.floating, since: c.deadSince === day0, host: !!c.lastHost };
      const nb = window.__lifeForceBirth();
      if (!nb) return { floating, born: false };
      return { floating, born: true, onNb: c.hostId === nb.id, gen: c.gen, carried: c.w.scout,
        still: !c.floating, nbMem: nb.memories.length, chron: g.chron.some(e => e.k === 'neuro') };
    })()`);
    ok(deathRebirth && deathRebirth.floating.floating === true, '宿主死了→芯进入游荡');
    ok(deathRebirth && deathRebirth.floating.since === true, '游荡起始日=死亡日');
    ok(deathRebirth && deathRebirth.floating.host === true, '芯记得上一任宿主的名字');
    ok(deathRebirth && deathRebirth.born === true, '死时之后有新生儿降生');
    ok(deathRebirth && deathRebirth.onNb === true, '芯落进了新降生的新生儿');
    ok(deathRebirth && deathRebirth.still === true, '承接后不再游荡');
    eq(deathRebirth && deathRebirth.gen, 2, '世代 +1');
    eq(deathRebirth && deathRebirth.carried, (learn && learn.before) + 2, '权重跟着芯走（手艺在骨头里）');
    ok(deathRebirth && deathRebirth.nbMem === 0, '新生儿没有前世记忆（转世不带记忆）');
    ok(deathRebirth && deathRebirth.chron === true, '转世记进编年史');

    // 5) 轮回不灭：游荡 30 天无承接 → 记一轮轮回、等待重置，芯不接着死
    const rounds = await evalJs(`(() => {
      const g = window.__game, c = g.neurocore;
      c.floating = true; c.deadSince = g.clock.totalDay - 31; c.hostId = 'nobody'; c.rounds = 0;
      window.__neuroDaily();
      const r1 = { rounds: c.rounds, reset: c.deadSince === g.clock.totalDay };
      c.deadSince = g.clock.totalDay - 31;
      window.__neuroDaily();
      return { r1, r2: c.rounds, deadGone: !('dead' in c) };
    })()`);
    eq(rounds && rounds.r1.rounds, 1, '游荡 30 天无承接→记一轮轮回');
    ok(rounds && rounds.r1.reset === true, '轮回后等待重置（接着等）');
    eq(rounds && rounds.r2, 2, '再等 30 天→第二轮轮回（芯不灭）');
    ok(rounds && rounds.deadGone === true, '芯死标记已作废（轮回替代）');

    // 6) 存档往返：芯整对象随档走
    await evalJs(`(() => { window.__game.saveLocal(); return true; })()`);
    const rt = await evalJs(`(() => {
      const raw = localStorage.getItem('godtown.save.v2');
      const s = JSON.parse(raw);
      const saved = { has: !!s.neurocore, gen: s.neurocore && s.neurocore.gen, rounds: s.neurocore && s.neurocore.rounds,
        w: s.neurocore && s.neurocore.w ? Object.keys(s.neurocore.w).length : 0 };
      const G = window.__game.constructor;
      const g2 = G.hydrate(JSON.parse(raw), window.__renderer);
      return { saved, hGen: g2.neurocore.gen, hRounds: g2.neurocore.rounds,
        hW: Object.keys(g2.neurocore.w).length, hIn: g2.npcs.some(n => n.id === g2.neurocore.hostId) || g2.neurocore.floating };
    })()`);
    ok(rt && rt.saved.has === true, '存档带 neurocore');
    eq(rt && rt.saved.gen, 2, '存档里世代=2');
    eq(rt && rt.saved.rounds, 2, '存档里轮回轮数随档走');
    ok(rt && rt.saved.w === 4, '存档里权重表四轴');
    eq(rt && rt.hGen, 2, '读档后世代复原');
    eq(rt && rt.hRounds, 2, '读档后轮回轮数复原');
    ok(rt && rt.hW === 4, '读档后权重表复原');
    ok(rt && rt.hIn === true, '读档后宿主 id 对得上名册（或芯在游荡）');

    // 7) 旧档迁移：无芯的档长出一颗无主的游荡芯
    const legacy = await evalJs(`(() => {
      const raw = localStorage.getItem('godtown.save.v2');
      const data = JSON.parse(raw);
      delete data.neurocore;
      const G = window.__game.constructor;
      const g3 = G.hydrate(data, window.__renderer);
      return { has: !!g3.neurocore, floating: g3.neurocore.floating,
        since: g3.neurocore.deadSince === g3.clock.totalDay, host: g3.neurocore.hostId };
    })()`);
    ok(legacy && legacy.has === true && legacy.floating === true, '旧档无芯 → 无主的游荡芯');
    ok(legacy && legacy.since === true, '游荡从读档日起算');
    ok(legacy && legacy.host === null, '无主芯没有宿主');

    ws.close();
  } finally {
    // shell:true 下 proc.kill 只杀 npx/cmd 包装层，electron 孙进程会残留并占住调试端口——
    // 必须 taskkill 整树，否则下次运行连上僵尸实例、断言全歪（v2.5.0 轮回冒烟踩过的坑）
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
