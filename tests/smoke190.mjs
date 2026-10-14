// smoke190.mjs - v1.9.0 演化层 CDP 冒烟：真机 Electron 里跑通 配方常识/知识会死/瓶颈创新/火灾/瘟疫/AI口信/存档
// 用法：node smoke190.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9339;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp190_'));
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  [PASS] ' + msg); }
  else { fail++; failures.push(msg); console.error('  [FAIL] ' + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg}（got ${JSON.stringify(a)} want ${JSON.stringify(b)}）`); }

async function main() {
  // 1) 起 Electron（远程调试端口 + 临时 userData）
  const proc = spawn('npx', ['electron', '.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
    cwd: new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    stdio: 'ignore', shell: true
  });
  try {
    // 2) 等 DevTools 端点起来
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

    // 3) 连 CDP
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

    // 4) 等游戏就绪 + 暂停日推进（防测试中途翻日消耗 rng）
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const v = await evalJs(`(() => !!(window.__game && window.__game.clock && window.__tileset))()`);
      if (v === true) { ready = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    ok(ready, '游戏就绪（__game/__tileset 就位）');
    if (!ready) return;
    await evalJs(`(() => { window.__game.clock.speed = 0; return true; })()`);

    // 5) 演化句柄就位
    const handles = await evalJs(`(() => ['__developDaily','__disasterDaily','__ctxInfo'].filter(k => typeof window[k] === 'function'))()`);
    ok(Array.isArray(handles) && handles.length === 3, '演化层冒烟句柄齐（develop/disaster/ctxInfo）');

    // 6) 开局常识：五门手艺注册，老手艺发给手艺人
    eq(await evalJs(`(() => Object.keys(window.__game.recipes).length)()`), 5, '五门手艺注册');
    const common = await evalJs(`(() => { const r = window.__game.recipes; return [r.plank.knownBy.has('zhou'), r.stew.knownBy.has('wang'), r.forge.knownBy.has('zhao')]; })()`);
    ok(common && common.every(Boolean), '开镇常识：周大樵会锯木/王绣会炖汤/赵铁山会锻铁');

    // 7) 知识会死：赵铁山走了，锻铁失传归零
    await evalJs(`(() => { window.__lifeForceDeath('zhao'); return true; })()`);
    const lost = await evalJs(`(() => { const r = window.__game.recipes.forge; return [r.knownBy.size, r.lost, r.mult]; })()`);
    ok(lost && lost[0] === 0 && lost[1] === true && lost[2] === 1.0, '赵铁山走了，锻铁没人会了（失传归零）');
    ok(await evalJs(`(() => window.__game.logLines.some(l => l.text.includes('没人会了')))()`) === true, '失传写进镇志');

    // 8) 瓶颈创新：木料见底，周大樵琢磨出锯木新法子（zhao已死，消费者只剩 zhou→wang，队列精确喂定）
    const innov = await evalJs(`(() => {
      const g = window.__game;
      g.stock.wood = 2;
      const orig = g.rng;
      const q = [0.01, 0.01, 0.99, 0.99];
      g.rng = () => (q.length ? q.shift() : 0.99);
      window.__developDaily(g.clock.totalDay);
      g.rng = orig;
      const r = g.recipes.plank;
      return [r.mult, r.inventor];
    })()`);
    ok(innov && innov[0] > 1.0, '危机期创新：锯木手艺长进到 ' + (innov && Math.round(innov[0] * 100)) + '%');
    ok(innov && innov[1] === 'zhou', '新法子是周大樵琢磨出来的');
    ok(await evalJs(`(() => window.__game.logLines.some(l => l.text.includes('琢磨出了新法子')))()`) === true, '创新写进镇志');

    // 9) 火灾：晴日走水（先喂 0.99 压住瘟疫爆发签，再喂起火+选房）
    const fire = await evalJs(`(() => {
      const g = window.__game;
      g.weather.type = 'sunny';
      const orig = g.rng;
      const q = [0.99, 0.001, 0.5];
      g.rng = () => (q.length ? q.shift() : 0.99);
      window.__disasterDaily(g.clock.totalDay);
      g.rng = orig;
      return g.fire ? g.fire.x + ',' + g.fire.y : null;
    })()`);
    ok(!!fire, '晴日走水，火着起来了（' + fire + '）');

    // 10) 瘟疫：雨天不起火；清掉火场，爆发签喂满 → 一人病倒（传播/转归全压 0.99）
    const sickN = await evalJs(`(() => {
      const g = window.__game;
      g.fire = null;
      g.weather.type = 'rainy';
      const orig = g.rng;
      const q = [0.001, 0.5];
      g.rng = () => (q.length ? q.shift() : 0.99);
      window.__disasterDaily(g.clock.totalDay);
      g.rng = orig;
      return g.plague ? g.plague.sick.length : -1;
    })()`);
    eq(sickN, 1, '时疫从一个人开始');
    ok(await evalJs(`(() => window.__game.logLines.some(l => l.text.includes('时疫')))()`) === true, '时疫写进镇志');

    // 11) AI 口信看得见演化层（长进/失传/时疫）
    const ctx = await evalJs(`(() => window.__ctxInfo())()`);
    ok(typeof ctx === 'string' && ctx.includes('时疫') && (ctx.includes('手艺有长进') || ctx.includes('失传')), 'AI 口信带着演化层（' + (ctx || '').slice(0, 60) + '…）');

    // 12) 存档把演化层带上
    const saved = await evalJs(`(() => {
      window.__game.saveLocal();
      const s = JSON.parse(localStorage.getItem('godtown.save.v1'));
      return [s.recipes && s.recipes.plank.mult, s.recipes && s.recipes.forge.lost, s.disaster && s.disaster.plague ? s.disaster.plague.sick.length : -1];
    })()`);
    ok(saved && saved[0] > 1.0 && saved[1] === true && saved[2] === 1, '存档含演化层（锯木' + (saved && Math.round(saved[0] * 100)) + '%/锻铁失传/时疫1人）');

    ws.close();
  } finally {
    proc.kill();
  }
}

main()
  .catch(e => { fail++; failures.push('冒烟脚本异常：' + e.message); console.error(e); })
  .finally(() => {
    console.log(`\n冒烟完成：通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) { for (const f of failures) console.log('  - ' + f); process.exitCode = 1; }
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  });
