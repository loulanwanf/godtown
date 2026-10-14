// smoke230.mjs - v2.3.0 演化引擎 CDP 冒烟：演化 Tab 渲染/风向交互/无 LLM 脚本兜底/evolveDaily 连跑/存读档
// 用法：node smoke230.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9350;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp230_'));
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
    // 重播种 rng（constructor 用 Date.now，灰度抽签要确定性）
    await evalJs(`(() => { let s = 2026; window.__game.rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; return true; })()`);

    // 1) 演化 Tab 按钮在 DOM 里
    ok(await evalJs(`!!document.querySelector('[data-tab="evolve"]')`) === true, '演化 Tab 按钮存在');

    // 2) 演化冒烟句柄就位
    ok(await evalJs(`typeof window.__evolveDaily === 'function'`) === true, '__evolveDaily 句柄就位');

    // 3) 点开演化 Tab → 三个区块渲染
    await evalJs(`document.querySelector('[data-tab="evolve"]').click()`);
    ok(await evalJs(`!!document.getElementById('evoWindText')`) === true, '风向输入框渲染了');
    ok(await evalJs(`!!document.getElementById('evoPoolList')`) === true, '候选池区块渲染了');
    ok(await evalJs(`!!document.getElementById('evoLogList')`) === true, '演化日志区块渲染了');
    eq(await evalJs(`document.querySelectorAll('.evo-wind-pre').length`), 4, '风向预设按钮 4 个');

    // 4) 风向交互：change 写入 game.evoWind（超 20 字截断）
    await evalJs(`(() => {
      const el = document.getElementById('evoWindText');
      el.value = '让镇上多些手艺人';
      el.dispatchEvent(new Event('change'));
      return true;
    })()`);
    eq(await evalJs(`window.__game.evoWind`), '让镇上多些手艺人', '风向文本 change 写入 game.evoWind');
    await evalJs(`(() => {
      const el = document.getElementById('evoWindText');
      el.value = '一二三四五六七八九十一二三四五六七八九十一二三四五';
      el.dispatchEvent(new Event('change'));
      return true;
    })()`);
    eq(await evalJs(`window.__game.evoWind.length`), 20, '风向超 20 字被截断');

    // 5) 预设按钮 + 清空
    await evalJs(`document.querySelector('.evo-wind-pre[data-w="探索"]').click()`);
    eq(await evalJs(`window.__game.evoWind`), '探索', '预设按钮写入风向');
    await evalJs(`document.getElementById('evoWindClear').click()`);
    eq(await evalJs(`window.__game.evoWind`), '', '清空按钮恢复自动');

    // 6) 无 LLM 脚本兜底：喂一条低语，连跑 10 日 evolveDaily 不报错
    //    （clock.totalDay 是派生 getter，推进天数要落笔在 clock.day 上）
    const errs = await evalJs(`(() => {
      const g = window.__game;
      const errs = [];
      g.whispers.push({ day: g.clock.totalDay, text: '多些手艺' });
      for (let d = 1; d <= 10; d++) {
        g.clock.day = d;
        try { window.__evolveDaily(d); } catch (e) { errs.push(String((e && e.message) || e)); }
      }
      return errs;
    })()`);
    ok(Array.isArray(errs) && errs.length === 0, 'evolveDaily 连跑 10 日无异常' + (errs && errs.length ? '（' + errs[0] + '）' : ''));

    // 7) 候选池结构健全：player 低语长出了 saying 提案
    const poolInfo = await evalJs(`(() => {
      const g = window.__game;
      const p = (g.evoPool || []).find(v => v.source === 'player');
      return { total: (g.evoPool || []).length, hasPlayer: !!p,
        fields: p ? [!!p.id, p.kind, !!p.why, p.status] : null };
    })()`);
    ok(poolInfo && poolInfo.total > 0, '候选池进了提案');
    ok(poolInfo && poolInfo.hasPlayer === true, '玩家低语长出了提案（player 缺口信号）');
    ok(poolInfo && poolInfo.fields && poolInfo.fields[0] === true && poolInfo.fields[2] === true, '提案有 id 与理由（why 必填）');
    eq(poolInfo && poolInfo.fields && poolInfo.fields[1], 'saying', '低语提案种类是 saying');

    // 8) 演化日志结构健全
    const logInfo = await evalJs(`(() => {
      const g = window.__game;
      const e = (g.evoLog || [])[0];
      return { total: (g.evoLog || []).length, fields: e ? [typeof e.day === 'number', !!e.action, !!e.what] : null };
    })()`);
    ok(logInfo && logInfo.total > 0, '演化日志有记录');
    ok(logInfo && logInfo.fields && logInfo.fields.every(v => v === true), '日志条目有 日/动作/内容');

    // 9) 重渲染演化 Tab：池子和日志真的画出来了
    //    （10 日跑完早期提案可能已固化离开池子——补一条新低语催一个活提案再看列表）
    await evalJs(`(() => {
      const g = window.__game;
      g.clock.day = 11;
      g.whispers.push({ day: 11, text: '手艺人多了路子宽' });
      window.__evolveDaily(11);
      return true;
    })()`);
    await evalJs(`document.querySelector('[data-tab="evolve"]').click()`);
    ok(await evalJs(`document.querySelectorAll('#evoPoolList .chron-line').length`) > 0, '候选池列表画出了提案行');
    const logLines = await evalJs(`document.querySelectorAll('#evoLogList .evo-line').length`);
    ok(logLines > 0, '演化日志画出了日志行');

    // 10) 点一条日志 → 详情展开
    await evalJs(`document.querySelector('#evoLogList .evo-line').click()`);
    ok(await evalJs(`(() => { const d = document.getElementById('evoDetail'); return d && d.style.display !== 'none' && d.innerHTML.length > 10; })()`) === true, '点击日志展开详情');

    // 11) 存档带 evo 字段
    await evalJs(`(() => { window.__game.saveLocal(); return true; })()`);
    const saved = await evalJs(`(() => {
      const s = JSON.parse(localStorage.getItem('godtown.save.v2'));
      return [!!s.evo, (s.evo && s.evo.pool.length) || 0, (s.evo && s.evo.log.length) || 0, typeof (s.evo && s.evo.seq) === 'number'];
    })()`);
    ok(saved && saved[0] === true, '存档带 evo 字段');
    ok(saved && saved[1] > 0, '存档里的候选池有数据');
    ok(saved && saved[3] === true, '存档里的提案序号在');

    // 12) 读档后演化层还在
    const gs2 = await evalJs(`(() => {
      const raw = localStorage.getItem('godtown.save.v2');
      if (!raw) return null;
      const data = JSON.parse(raw);
      const G = window.__game.constructor;
      const g = G.hydrate(data, window.__renderer);
      return { pool: g.evoPool.length, log: g.evoLog.length, wind: g.evoWind, seq: g._evoSeq };
    })()`);
    ok(gs2 && gs2.pool > 0, '读档后候选池还在');
    ok(gs2 && gs2.log > 0, '读档后演化日志还在');
    ok(gs2 && gs2.seq >= 1, '读档后提案序号还在');

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
