// smoke290.mjs - v2.9.0 产出革命 CDP 冒烟：离线铁律采集/页面内配方跑帧对账/离线演化全链路（信号→提案→灰度→固化→转职+产出）/存档往返
// 用法：node smoke290.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9410;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp290_'));
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
      g.aiCfg.mode = 'script';            // 离线铁律：无 LLM，脚本兜底驱动全镇
      if (g.aiCfg.npcPool) g.aiCfg.npcPool.enabled = false;
      g.weather.force('sunny', 24);       // 排除雨天躲雨拦截干活
      g.clock.min = 8 * 60;               // 清晨开局，白天干活窗口完整
      return true;
    })()`);

    // ============ ① 离线铁律：mode=script 4x 跑 30 秒 → 采集真的发生且零 JS 错误 ============
    await evalJs(`(() => { window.__game.clock.speed = 4; return true; })()`);
    await new Promise(r => setTimeout(r, 30000));
    const off = await evalJs(`(async () => {
      const g = window.__game;
      g.clock.speed = 0;
      const { O } = await import('./js/core.js');
      const { getObj } = await import('./js/chunk.js');
      let logs = 0;
      for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) if (getObj(g.world, x, y) === O.LOG) logs++;
      return {
        errs: (window.__errs || []).slice(0, 5),
        alive: !!g.clock,
        berry: Math.floor(g.stock.berry || 0),
        stone: Math.floor(g.stock.stone || 0),
        logs,
        worked: g.npcs.some(n => (n._workMinToday || 0) > 0 || (n.intent && n.intent.type === 'work'))
      };
    })()`);
    ok(off && !off.err && off.alive === true, '①跑帧后游戏仍活' + (off && off.err ? '：' + off.err : ''));
    eq(off && off.errs.length, 0, '①离线 30 秒零 JS 错误（含 rejection）' + (off && off.errs.length ? '：' + JSON.stringify(off.errs) : ''));
    ok(off && (off.berry > 0 || off.stone > 0 || off.logs > 0), '①无业者真的采到了东西（浆果' + (off && off.berry) + '/石料' + (off && off.stone) + '/地上原木' + (off && off.logs) + '）');
    ok(off && off.worked === true, '①有人在干活（产出不是凭空冒出来的）');

    // ============ ② 页面内注册烧石配方跑帧 → gold 进库且 stone 净减对账 ============
    const reg = await evalJs(`(() => {
      const g = window.__game;
      const k = g.npcs[0];
      // 隔离：其余人原地长歇（不进睡眠防自动醒、不进屋防被请出门），不吃不喝不采
      for (let i = 1; i < g.npcs.length; i++) {
        const n = g.npcs[i];
        n.path = []; n.inside = false;
        n.needs.hunger = 10; n.needs.energy = 90;
        n.intent = { type: 'idle', label: '歇着', untilMin: 999999, reason: '', source: 'test' };
        n.aiDcAt = 1e12; n.aiAsking = false;
      }
      k.job = '烧石的'; k.needs.hunger = 10; k.needs.energy = 100; k.needs.mood = 70;
      g.recipeDefs.smelt = { name: '烧石', job: '烧石的', base: 1.0, variants: [1.2], inputs: { stone: 2 }, outputs: { gold: 1 } };
      g.recipes.smelt = { id: 'smelt', mult: 1.0, knownBy: new Map([[k.id, 1]]), inventor: k.id, inventedDay: 1, tries: 0, lost: false, lostDay: 0 };
      g.stock.stone = 10;
      k.setIntent('work', '烧石', 999999, '开干');
      k.intent.craft = 'smelt';
      window.__gold0 = g.stock.gold || 0;
      g.clock.speed = 4;
      return true;
    })()`);
    ok(reg === true, '②烧石配方页面内注册成功');
    await new Promise(r => setTimeout(r, 25000));
    const craft = await evalJs(`(() => {
      const g = window.__game;
      g.clock.speed = 0;
      const batches = (g.stock.gold || 0) - window.__gold0;
      return {
        errs: (window.__errs || []).slice(0, 5),
        gold: g.stock.gold || 0, batches,
        stoneLeft: g.stock.stone,
        reconcile: (10 - g.stock.stone) === batches * 2
      };
    })()`);
    eq(craft && craft.errs.length, 0, '②跑帧零 JS 错误' + (craft && craft.errs.length ? '：' + JSON.stringify(craft.errs) : ''));
    ok(craft && craft.batches >= 1, '②配方活过来了：烧出' + (craft && craft.batches) + '批金（stock.gold=' + (craft && craft.gold) + '）');
    ok(craft && craft.reconcile === true, '②守恒对账：石料净减=批次×2（剩' + (craft && craft.stoneLeft) + '），一两不多一两不少');

    // ============ ③ 离线演化全链路（白纸 clone）：饿信号→提案→灰度→快进7天→固化→转职+产出 ============
    const evo = await evalJs(`(async () => {
      const G = window.__game.constructor;
      const c = new G(window.__renderer);
      c.newGame(290);
      const { evolveDaily, observeDaily, makeProposal, grayDeploy } = await import('./js/evolve.js');
      // 饿信号：四个成年人天天饿肚子
      for (const n of c.npcs.slice(0, 4)) n.needs.hunger = 90;
      c.rng = () => 0.01;                 // 确定性：灰度骰必过、选人取队首
      c.clock.day = 3;                    // scanGaps 每 3 天一扫
      evolveDaily(c, 3);
      const rec = (c.evoPool || []).find(p => p.kind === 'recipe' && p.status === 'gray');
      if (!rec) return { step: 'gray', pool: (c.evoPool || []).map(p => p.kind + ':' + p.status) };
      const pid = rec.payload.id;
      const trialKnown = c.recipes[pid] && c.recipes[pid].knownBy.size;
      // 快进 7 天 → 观察 → 固化
      c.clock.day = 11;
      for (const n of c.npcs) n.needs.mood = 70;
      observeDaily(c, 11);
      const committed = rec.status === 'commit';
      const spread = c.recipes[pid].knownBy.size;
      // 产出发生：固化后的手艺真的长粮食（berry:1→crop:1，批处理对账）
      c.stock.berry = 4;
      const crop0 = c.stock.crop || 0;
      const kn = c.npcs.find(n => c.recipes[pid].knownBy.has(n.id));
      const ctx = { w: c.world, clock: c.clock, rng: c.rng, stock: c.stock, log: null, npcs: c.npcs, game: c };
      kn.setIntent('work', '做吃食', 999999, '开干');
      kn.intent.craft = pid;
      for (let i = 0; i < 6; i++) kn.doWork(ctx, 45);
      const berryUsed = 4 - c.stock.berry, cropMade = (c.stock.crop || 0) - crop0;
      // 转职：带行当的配方走同一管道——灰度试行者干上新行当
      const p2 = makeProposal({ kind: 'recipe', why: '黑石头烧过变硬，能换钱', prob: 1,
        payload: { id: 'burnstone', name: '烧石', job: '烧石的', base: 1.0, variants: [1.2], inputs: { stone: 1 }, outputs: { gold: 1 } } },
        { source: 'gap', kind: 'recipe' }, c);
      grayDeploy(p2, c);
      const newJobbers = c.npcs.filter(n => n.job === '烧石的').length;
      c.clock.day = 19;
      for (const n of c.npcs) n.needs.mood = 70;
      observeDaily(c, 19);
      const committed2 = p2.status === 'commit';
      // 新行当的手艺也真的产出（stone:1→gold:1）
      c.stock.stone = 3;
      const gold0 = c.stock.gold || 0;
      const smelter = c.npcs.find(n => n.job === '烧石的' && c.recipes.burnstone.knownBy.has(n.id));
      smelter.setIntent('work', '烧石', 999999, '开干');
      smelter.intent.craft = 'burnstone';
      for (let i = 0; i < 3; i++) smelter.doWork(ctx, 45);
      return {
        step: 'done', trialKnown, committed, spread,
        berryUsed, cropMade, conserve: berryUsed === cropMade && berryUsed >= 2,
        newJobbers, committed2,
        stoneUsed: 3 - c.stock.stone, goldMade: (c.stock.gold || 0) - gold0
      };
    })()`);
    ok(evo && !evo.err, '③演化全链路跑通' + (evo && evo.err ? '：' + evo.err : (evo && evo.step === 'gray' ? '：池=' + JSON.stringify(evo.pool) : '')));
    ok(evo && evo.trialKnown >= 1, '③饿信号→配方提案进灰度，试行者上手（' + (evo && evo.trialKnown) + '人）');
    ok(evo && evo.committed === true && evo.spread >= 3, '③快进 7 天固化，手艺全镇传开（会者' + (evo && evo.spread) + '人）');
    ok(evo && evo.conserve === true, '③产出真的发生且守恒：浆果耗' + (evo && evo.berryUsed) + '=粮产' + (evo && evo.cropMade));
    ok(evo && evo.newJobbers >= 1 && evo.committed2 === true, '③转职：灰度试行者干上新行当「烧石的」（' + (evo && evo.newJobbers) + '人）并固化');
    ok(evo && evo.stoneUsed >= 1 && evo.stoneUsed === evo.goldMade, '③新行当手艺真的产出：石耗' + (evo && evo.stoneUsed) + '=金产' + (evo && evo.goldMade));

    // ============ ④ 存档往返：knownBy 在、craft 继续 ============
    const rt = await evalJs(`(() => {
      const g = window.__game;
      g.saveLocal();
      const raw = localStorage.getItem('godtown.save.v2');
      const s = JSON.parse(raw);
      const G = g.constructor;
      const g2 = G.hydrate(JSON.parse(raw), window.__renderer);
      const k2 = g2.npcs.find(n => n.id === g.npcs[0].id);
      const known = !!(g2.recipes.smelt && g2.recipes.smelt.knownBy.has(k2.id));
      const defIn = !!g2.recipeDefs.smelt;
      g2.stock.stone = 4;
      const gold0 = g2.stock.gold || 0;
      k2.setIntent('work', '烧石', 999999, '开干');
      k2.intent.craft = 'smelt';
      const ctx = { w: g2.world, clock: g2.clock, rng: g2.rng, stock: g2.stock, log: null, npcs: g2.npcs, game: g2 };
      for (let i = 0; i < 4; i++) k2.doWork(ctx, 45);
      return {
        saved: !!(s.recipes && s.recipes.smelt),
        known, defIn,
        stoneUsed: 4 - g2.stock.stone, goldMade: (g2.stock.gold || 0) - gold0
      };
    })()`);
    ok(rt && rt.saved === true, '④存档带动态配方（smelt 落盘）');
    ok(rt && rt.known === true && rt.defIn === true, '④读档：knownBy 与配方定义原样回来');
    ok(rt && rt.stoneUsed >= 2 && rt.goldMade >= 1, '④读档后手艺接着干：石耗' + (rt && rt.stoneUsed) + '金产' + (rt && rt.goldMade));

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
