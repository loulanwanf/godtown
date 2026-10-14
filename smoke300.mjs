// smoke300.mjs - v3.0.0 过程革命 CDP 冒烟：干活有真动作（跑帧抓到动作态）/动画帧真的在变（像素级对账）/
//   七个原语都画得出来/演化设定的动作落地干活/零 JS 错误
// 用法：node smoke300.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9430;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp300_'));
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
      g.aiCfg.mode = 'script';
      if (g.aiCfg.npcPool) g.aiCfg.npcPool.enabled = false;
      g.weather.force('sunny', 24);
      g.clock.min = 8 * 60;
      return true;
    })()`);

    // ============ ① 离线跑帧：真有人进入动作态（act 非空）且渲染零 JS 错误 ============
    await evalJs(`(() => { window.__game.clock.speed = 4; return true; })()`);
    let actSamples = 0;
    const primSeen = new Set();
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2500));
      const s = await evalJs(`(() => {
        const g = window.__game;
        const acting = g.npcs.filter(n => !n.inside && n.act).map(n => n.act.prim);
        return { acting, errs: (window.__errs || []).length };
      })()`);
      if (s && s.acting && s.acting.length) { actSamples++; s.acting.forEach(p => primSeen.add(p)); }
    }
    await evalJs(`(() => { window.__game.clock.speed = 0; return true; })()`);
    const errs1 = await evalJs(`(() => (window.__errs || []).slice(0, 5))()`);
    eq(errs1.length, 0, '①跑帧 25 秒零 JS 错误（动作渲染进主循环）' + (errs1.length ? '：' + JSON.stringify(errs1) : ''));
    ok(actSamples >= 2, '①跑帧抓到干活动作态（10 次采样 ' + actSamples + ' 次有人在动手，不是原地站着）');
    ok(primSeen.size >= 1, '①动作原语真的出现：' + [...primSeen].join('/'));

    // ============ ② 动画帧真的在变：同一 NPC 同一动作，不同时刻画出来的像素不一样 ============
    const anim = await evalJs(`(async () => {
      const { motionFor } = await import('./js/core.js');
      const r = window.__renderer;
      const k = window.__game.npcs[0];
      k.dir = 3;
      k.act = motionFor('swing', 'axe');
      const cv = document.createElement('canvas'); cv.width = cv.height = 48;
      const c2 = cv.getContext('2d');
      const snap = (t) => {
        r.time = t;
        c2.clearRect(0, 0, 48, 48);
        r.drawMotion(c2, k, 24, 36, 16);
        return c2.getImageData(0, 0, 48, 48).data;
      };
      const d1 = snap(0.05), d2 = snap(0.5), d3 = snap(0.68);
      let nonzero1 = 0; for (let i = 3; i < d1.length; i += 4) if (d1[i] > 0) nonzero1++;
      let diff12 = 0; for (let i = 0; i < d1.length; i++) if (d1[i] !== d2[i]) diff12++;
      let diff23 = 0; for (let i = 0; i < d2.length; i++) if (d2[i] !== d3[i]) diff23++;
      // 七个原语逐个画一遍：每个都得画得出东西（空手的也有手臂）
      const prims = ['swing', 'smash', 'pull', 'stir', 'knead', 'tend', 'saw'];
      const drawn = {};
      for (const p of prims) {
        k.act = motionFor(p);
        const d = snap(0.3);
        let nz = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) nz++;
        drawn[p] = nz;
      }
      // 命中窗口粒子：swing 在 0.7（劈下后）比 0.1（蓄力）多出落点粒子
      k.act = motionFor('swing', 'axe');
      const fxAt = (t) => { const d = snap(t); let nz = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) nz++; return nz; };
      return { nonzero1, diff12, diff23, drawn, fxEarly: fxAt(0.1), fxHit: fxAt(0.7) };
    })()`);
    ok(anim && !anim.err, '②离屏画布动作绘制跑通' + (anim && anim.err ? '：' + anim.err : ''));
    ok(anim && anim.nonzero1 > 0, '②动作真的画出了东西（非空帧，像素数 ' + (anim && anim.nonzero1) + '）');
    ok(anim && anim.diff12 > 30 && anim.diff23 > 30, '②动画帧真的在变：蓄力≠劈下≠随挥（帧差 ' + (anim && anim.diff12) + '/' + (anim && anim.diff23) + '，原地站着不会有帧差）');
    ok(anim && Object.values(anim.drawn).every(nz => nz > 0), '②七个原语都画得出来：' + JSON.stringify(anim && anim.drawn));

    // ============ ③ 演化设定的动作落地：提案带动作 → 落表 → 干活真做出那个动作 ============
    const evo = await evalJs(`(async () => {
      const G = window.__game.constructor;
      const c = new G(window.__renderer);
      c.newGame(300);
      const { makeProposal, validateProposal, grayDeploy } = await import('./js/evolve.js');
      c.rng = () => 0.01;
      // 3a 提案带「搅舂」→ 干活就是搅舂持棍
      const p = makeProposal({ kind: 'recipe', why: 'x', prob: 1,
        payload: { id: 'stew', name: '炖菜', job: '', base: 1.0, variants: [1.2], inputs: { berry: 1 }, outputs: { crop: 1 }, motion: { prim: 'stir' } } },
        { source: 'gap', kind: 'recipe' }, c);
      validateProposal(p, c);
      grayDeploy(p, c);
      const defMotion = c.recipeDefs.stew && c.recipeDefs.stew.motion && c.recipeDefs.stew.motion.prim;
      const kn = c.npcs.find(n => c.recipes.stew.knownBy.has(n.id));
      c.stock.berry = 4;
      const ctx = { w: c.world, clock: c.clock, rng: c.rng, stock: c.stock, log: null, npcs: c.npcs, game: c };
      kn.setIntent('work', '做吃食', 999999, '开干');
      kn.intent.craft = 'stew';
      kn.doWork(ctx, 10, 1);
      const actPrim = kn.act && kn.act.prim, actTool = kn.act && kn.act.tool;
      // 3b 提案带非法动作 → 校验降级揉压 → 干活就是揉压
      const p2 = makeProposal({ kind: 'recipe', why: 'x', prob: 1,
        payload: { id: 'weird', name: '怪活', job: '', base: 1.0, variants: [1.2], inputs: { berry: 1 }, outputs: { crop: 1 }, motion: { prim: 'dance' } } },
        { source: 'gap', kind: 'recipe' }, c);
      const v2 = validateProposal(p2, c);
      grayDeploy(p2, c);
      const fb = v2.why;
      const kn2 = c.npcs.find(n => c.recipes.weird.knownBy.has(n.id));
      kn2.setIntent('work', '做怪活', 999999, '开干');
      kn2.intent.craft = 'weird';
      kn2.doWork(ctx, 10, 1);
      return { defMotion, actPrim, actTool, fb, fallbackPrim: kn2.act && kn2.act.prim };
    })()`);
    ok(evo && !evo.err, '③演化→动作全链路跑通' + (evo && evo.err ? '：' + evo.err : ''));
    eq(evo && evo.defMotion, 'stir', '③演化设定的动作随配方落表');
    ok(evo && evo.actPrim === 'stir' && evo.actTool === 'stick', '③干活真做出演化设定的动作：搅舂持棍');
    ok(evo && String(evo.fb).includes('原语名册') && evo.fallbackPrim === 'knead', '③非法动作被校验拦下降级揉压（留痕：' + (evo && evo.fb) + '）');

    // ============ ④ 存档不含动作态（瞬态），读档后干活动作由数据重建 ============
    const rt = await evalJs(`(() => {
      const g = window.__game;
      const k = g.npcs[0];
      k.act = { prim: 'swing', tool: 'axe', rate: 1.1, fx: 'chip' };
      g.saveLocal();
      const raw = localStorage.getItem('godtown.save.v2');
      const s = JSON.parse(raw);
      const npcDump = JSON.stringify(s.npcs || []);
      const g2 = g.constructor.hydrate(JSON.parse(raw), window.__renderer);
      return { hasAct: npcDump.includes('"act"'), loadedAct: g2.npcs[0].act === null || g2.npcs[0].act === undefined };
    })()`);
    ok(rt && rt.hasAct === false, '④动作态不进存档（瞬态，不是世界事实）');
    ok(rt && rt.loadedAct === true, '④读档 act 为空，干活时由配方/对象数据重建');

    ws.close();
  } finally {
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
