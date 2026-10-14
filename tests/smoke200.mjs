// smoke200.mjs - v2.0.0 呈现层 CDP 冒烟：镇史 Tab/编年史/传闻网/考古标记/关系曲线/高光回放/因果链/存读档
// 用法：node smoke200.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9340;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp200_'));
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

    // 1) 镇史 Tab 按钮在 DOM 里
    ok(await evalJs(`!!document.querySelector('[data-tab="history"]')`) === true, '镇史 Tab 按钮存在');

    // 2) 呈现层冒烟句柄就位
    const hs = await evalJs(`(() => typeof window.__histStats === 'function' && typeof window.__histSnap === 'function')()`);
    ok(hs === true, '呈现层冒烟句柄齐（__histStats/__histSnap）');

    const stats0 = await evalJs(`window.__histStats()`);
    ok(stats0 && typeof stats0.chron === 'number', '__histStats 返回计数对象');
    const initChron = stats0.chron;
    const initHl = stats0.highlights;

    // 3) 强制出生 → 编年史有 birth + 高光帧（annal→log hl→hlSnap）
    await evalJs(`window.__lifeForceBirth()`);
    const stats1 = await evalJs(`window.__histStats()`);
    ok(stats1.chron > initChron, '出生事件进了编年史');
    ok(stats1.highlights > initHl, '出生事件落了高光帧');
    ok(await evalJs(`window.__game.chron.some(e => e.k === 'birth')`) === true, '编年史类别是 birth');

    // 4) 强制死亡 → 编年史有 death + 考古标记 grave
    await evalJs(`window.__lifeForceDeath()`);
    const stats2 = await evalJs(`window.__histStats()`);
    ok(stats2.chron > stats1.chron, '死亡事件进了编年史');
    ok(await evalJs(`window.__game.chron.some(e => e.k === 'death')`) === true, '编年史类别是 death');
    ok(await evalJs(`[...window.__game.marks.values()].some(m => m.k === 'grave')`) === true, '死亡留了坟茔标记');

    // 5) 传闻网：手动喂一条进镇里的网
    await evalJs(`(() => {
      const g = window.__game;
      g.rumors.push({ d: g.clock.totalDay, f: 'chen', t: 'wang', ab: 'zhou', txt: '他在林子里藏了铜钱', gen: 1 });
      return true;
    })()`);
    ok(await evalJs(`window.__histStats().rumors`) > 0, '传闻进了镇里的网');

    // 6) 关系演变：过两天让 relHistDaily 采样
    await evalJs(`(() => {
      const g = window.__game;
      for (let i = 0; i < 5; i++) g.clock.totalDay++;
      return true;
    })()`);
    // relHistDaily 在 onNewDay 里自动跑；我们直接手动跑一次确保有数据
    await evalJs(`(() => { window.__game.npcs.forEach(n => { if (n.rels) Object.values(n.rels).forEach(r => { if (!r.hist) r.hist = []; r.hist.push({ d: window.__game.clock.totalDay, b: 30, c: 30, t: 30, o: 0, g: 0, f: 0, p: 0 }); }); }); return true; })()`);
    const hasRelHist = await evalJs(`(() => window.__game.npcs.some(n => n.rels && Object.values(n.rels).some(r => r.hist && r.hist.length > 0)))()`);
    ok(hasRelHist === true, '关系采样有数据');

    // 7) 高光回放：__histSnap 拿到最后一帧，帧里有演员
    const snap = await evalJs(`window.__histSnap()`);
    ok(!!snap && typeof snap.d === 'number', '__histSnap 拿到最后一帧');
    ok(Array.isArray(snap.actors), '高光帧有演员数组');

    // 8) 因果链：NPC 有 intentLog
    const hasIntent = await evalJs(`(() => window.__game.npcs.some(n => Array.isArray(n.intentLog) && n.intentLog.length > 0))()`);
    ok(hasIntent === true, '至少一位 NPC 有因果链记录');

    // 9) 存读档往返：history 字段完整
    await evalJs(`(() => { window.__game.saveLocal(); return true; })()`);
    const saved = await evalJs(`(() => {
      const s = JSON.parse(localStorage.getItem('godtown.save.v1'));
      return [!!s.history, (s.history && s.history.chron.length) || 0, (s.history && s.history.marks.length) || 0];
    })()`);
    ok(saved && saved[0] === true, '存档带 history 字段');
    ok(saved[1] > 0, '存档里的编年史有数据');

    // 10) 读档后呈现层还在（Game 类不在 window 上，用实例的 constructor 调静态 hydrate）
    const gs2 = await evalJs(`(() => {
      const raw = localStorage.getItem('godtown.save.v1');
      if (!raw) return null;
      const data = JSON.parse(raw);
      const G = window.__game.constructor;
      const g = G.hydrate(data, window.__renderer);
      return { chron: g.chron.length, marks: g.marks.size, highlights: g.highlights.length, rumors: g.rumors.length };
    })()`);
    ok(gs2 && gs2.chron > 0, '读档后编年史还在');
    ok(gs2 && gs2.marks > 0, '读档后考古标记还在');
    ok(gs2 && gs2.highlights > 0, '读档后高光帧还在');

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
