// smoke270.mjs - v2.7.0 白纸开局 CDP 冒烟：十人无业/库存清零/本能觅食/职业从手艺长出/生存信号/演化引擎第一口气/真档job回填/跑帧无错
// 用法：node smoke270.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9390;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp270_'));
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
      const v = await evalJs(`(() => !!(window.__game && window.__game.clock && window.__tileset))()`);
      if (v === true) { ready = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    ok(ready, '游戏就绪（__game/__tileset 就位）');
    if (!ready) return;
    await evalJs(`(() => { window.__game.clock.speed = 0; return true; })()`);
    // 全局错误收集器（跑帧无 JS 错误是白纸大手术后最要紧的冒烟信号）
    await evalJs(`(() => { window.__errs = []; window.addEventListener('error', e => window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', e => window.__errs.push('rej:' + String(e.reason))); return true; })()`);

    // 1) 开局白纸：十人无业、库存全零、三张配方表全空、UI 显示「白身」（切到居民标签页查真实 DOM）
    const blank = await evalJs(`(() => {
      const g = window.__game;
      const tabBtn = document.querySelector('.gp-tab[data-tab="npcs"]');
      if (tabBtn) tabBtn.click();
      const el = document.querySelector('.npc-item .npc-job');
      return {
        ten: g.npcs.length === 10,
        allIdle: g.npcs.every(n => n.job === '' && n.workArea === ''),
        stockZero: Object.values(g.stock).every(v => v === 0),
        recipesEmpty: Object.keys(g.recipes || {}).length === 0,
        defsEmpty: Object.keys(g.recipeDefs || {}).length === 0,
        tabClicked: !!tabBtn,
        uiBaiShen: el ? el.textContent : 'no-dom'
      };
    })()`);
    ok(blank && !blank.err && blank.ten, '十名居民在场' + (blank && blank.err ? '：' + blank.err : ''));
    ok(blank && blank.allIdle === true, '开局白纸：十人全无业（种子居民不带手艺）');
    ok(blank && blank.stockZero === true, '库存全零（不带来任何存货）');
    ok(blank && blank.recipesEmpty && blank.defsEmpty, '三张配方表全空');
    ok(blank && blank.tabClicked === true, '居民标签页可切');
    eq(blank && blank.uiBaiShen, '白身', 'UI 居民卡显示「白身」');

    // 2) 本能觅食（clone 上做，不碰活局）：无业者白天决策去摘浆果
    const forage = await evalJs(`(async () => {
      const g = window.__game;
      const G = g.constructor;
      const c = G.hydrate(JSON.parse(JSON.stringify(g.serialize())), window.__renderer);
      const { O, mulberry32 } = await import('./js/core.js');
      const { getObj } = await import('./js/chunk.js');
      const n = c.npcs[0];
      n.body.ageYears = 30; n.needs.energy = 90; n.needs.hunger = 30;
      let bush = null;
      for (let y = 0; y < 72 && !bush; y++) for (let x = 0; x < 72 && !bush; x++) {
        if (getObj(c.world, x, y) === O.BUSH) bush = { x, y };
      }
      if (!bush) return { bush: false };
      c.weather.force('sunny', 24);   // 排除雨天躲雨分支拦截觅食决策
      c.clock.min = 10 * 60;
      let got = null;
      for (let i = 0; i < 60 && !got; i++) {
        c.rng = mulberry32(i * 11 + 5);
        n.x = bush.x + 3; n.y = bush.y;
        n.intent = { type: 'ready', label: '待命', untilMin: 0 };
        const d = n.scriptDecide(c.world, c.clock, c.weather, c.rng, c.npcs, c);
        // 产出革命（v2.9.0）：觅食对象集从 {BUSH} 扩到 {BUSH, CROP3} 且最近优先——
        // 断言落点是可食对象，不再锁定全图第一丛（旁边有更近的庄稼就去那儿，行为语义不变）
        if (d && d.action === 'work' && d.tx != null && [O.BUSH, O.CROP3].includes(getObj(c.world, d.tx, d.ty))) got = d;
      }
      return { bush: true, why: got ? got.why : null };
    })()`);
    ok(forage && !forage.err, '本能觅食段跑通' + (forage && forage.err ? '：' + forage.err : ''));
    ok(forage && forage.bush === true, '白纸世界里有浆果丛');
    ok(forage && forage.why !== null, '无业者白天去摘浆果：' + (forage && forage.why || '没决策'));

    // 3) 职业从手艺长出（clone）：新行当配方不因「不在名册」被拒收
    const craft = await evalJs(`(async () => {
      const g = window.__game;
      const G = g.constructor;
      const c = G.hydrate(JSON.parse(JSON.stringify(g.serialize())), window.__renderer);
      const { makeProposal, validateProposal } = await import('./js/evolve.js');
      const p = makeProposal(
        { kind: 'recipe', why: '黑石头烧过变硬，能当刀使', prob: 1,
          payload: { id: 'blackstone', name: '烧石', job: '烧石的', base: 1.0, variants: [1.2], inputs: { stone: 1 }, outputs: { gold: 1 } } },
        { source: 'gap', kind: 'recipe' }, c);
      const v = validateProposal(p, c);
      return { verdict: v.verdict, why: v.why };
    })()`);
    ok(craft && !craft.err, '职业创造段跑通' + (craft && craft.err ? '：' + craft.err : ''));
    ok(craft && craft.verdict !== 'drop', '新行当配方不因「职业不在名册」被拒收');
    ok(craft && String(craft.why || '').includes('新行当'), '校验留痕：「是个新行当，谁先学会谁转职」');

    // 4) 生存原语信号（clone）：饿肚子的人多了 → 找吃食；冻得慌 → 取暖
    const sig = await evalJs(`(async () => {
      const g = window.__game;
      const G = g.constructor;
      const c = G.hydrate(JSON.parse(JSON.stringify(g.serialize())), window.__renderer);
      const { scanGaps } = await import('./js/evolve.js');
      for (const n of c.npcs.slice(0, 4)) n.needs.hunger = 90;
      const s1 = scanGaps(c, 3);
      for (const n of c.npcs.slice(0, 4)) { n.needs.hunger = 10; n.body.feel.cold = 90; }
      const s2 = scanGaps(c, 3);
      return {
        hungry: s1.some(s => s.kind === 'recipe' && s.hint.includes('饿肚子')),
        cold: s2.some(s => s.kind === 'build' && s.hint.includes('取暖'))
      };
    })()`);
    ok(sig && !sig.err && sig.hungry === true, '饥饿信号 → 找吃食的提案' + (sig && sig.err ? '：' + sig.err : ''));
    ok(sig && sig.cold === true, '寒冷信号 → 取暖的提案');

    // 5) 演化引擎第一口气（clone）：白纸世界 evolveDaily 十二天，第一批念头自己长出来
    const evo = await evalJs(`(async () => {
      const g = window.__game;
      const G = g.constructor;
      const c = G.hydrate(JSON.parse(JSON.stringify(g.serialize())), window.__renderer);
      const { mulberry32 } = await import('./js/core.js');
      const { evolveDaily, PROPOSAL_KINDS, describeProposal } = await import('./js/evolve.js');
      c.rng = mulberry32(99);
      for (let d = 3; d <= 36; d += 3) evolveDaily(c, d);
      return {
        pool: (c.evoPool || []).length,
        kinds: (c.evoPool || []).map(p => p.kind),
        kindsOk: (c.evoPool || []).every(p => PROPOSAL_KINDS.includes(p.kind)),
        desc: (c.evoPool || [])[0] ? describeProposal((c.evoPool || [])[0]) : null
      };
    })()`);
    ok(evo && !evo.err, '演化引擎段跑通' + (evo && evo.err ? '：' + evo.err : ''));
    ok(evo && evo.pool >= 1, '白纸世界演化引擎长出第一批念头（' + (evo && evo.pool || 0) + '条入池）');
    ok(evo && evo.kindsOk === true, '提案种类全在内容层七种之内');
    ok(evo && !!evo.desc, '提案可读：' + (evo && evo.desc || '无'));

    // 6) 真档 job 回填（核心回归——hydrate 修复）：转职/注配方 → serialize → hydrate → 随档走
    const rt = await evalJs(`(() => {
      const g = window.__game;
      const G = g.constructor;
      const c = G.hydrate(JSON.parse(JSON.stringify(g.serialize())), window.__renderer);
      c.npcs[3].job = '樵夫';
      c.recipeDefs.plank = { name: '锯木', job: '樵夫', base: 1.0, variants: [1.2] };
      c.recipes.plank = { id: 'plank', mult: 1.3, knownBy: new Map([['zhou', 2]]), inventor: 'zhou', inventedDay: 2, tries: 3, lost: false, lostDay: 0 };
      const snap = JSON.parse(JSON.stringify(c.serialize()));
      const c2 = G.hydrate(snap, window.__renderer);
      return {
        job: c2.npcs[3].job,
        othersIdle: c2.npcs.filter((n, i) => i !== 3).every(n => n.job === ''),
        rec: !!(c2.recipes.plank && c2.recipes.plank.mult === 1.3 && c2.recipes.plank.knownBy.has('zhou')),
        def: !!(c2.recipeDefs.plank && c2.recipeDefs.plank.job === '樵夫')
      };
    })()`);
    ok(rt && !rt.err, '真档回填段跑通' + (rt && rt.err ? '：' + rt.err : ''));
    eq(rt && rt.job, '樵夫', '老档：职业随档走（hydrate 不再丢弃）');
    ok(rt && rt.othersIdle === true, '未转职者仍无业（不复活预设）');
    ok(rt && rt.rec && rt.def, '老档：手艺与动态配方表随档走');

    // 7) 活局跑帧：脚本 AI 在白纸世界驱动生活，无 JS 错误（脚本模式无 API key，调度不介入）
    await evalJs(`(() => { const g = window.__game; g.clock.speed = 4; return true; })()`);
    await new Promise(r => setTimeout(r, 3000));
    const run = await evalJs(`(() => {
      const g = window.__game;
      g.clock.speed = 0;
      return {
        errs: (window.__errs || []).slice(0, 5),
        alive: !!g.clock && g.clock.totalDay >= 1,
        moved: g.npcs.some(n => n.intent && n.intent.type !== 'ready' && n.intent.source && n.intent.source !== 'boot'),
        logs: (g.logLines || []).length
      };
    })()`);
    ok(run && !run.err && run.alive === true, '跑帧后游戏仍活' + (run && run.err ? '：' + run.err : ''));
    eq(run && run.errs.length, 0, '跑帧零 JS 错误（含 rejection）' + (run && run.errs.length ? '：' + JSON.stringify(run.errs) : ''));
    ok(run && run.moved === true, '脚本 AI 在白纸世界驱动出意图（有人在做点什么）');

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
