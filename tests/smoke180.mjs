// smoke180.mjs - v1.8.0 世界层 CDP 冒烟：真机 Electron 里跑通 动物生态（贴图/购买/领养/野生/帧推进/存档）
// 用法：node smoke180.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9338;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp180_'));
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

    // 4) 等游戏就绪
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const v = await evalJs(`(() => !!(window.__game && window.__game.clock && window.__tileset))()`);
      if (v === true) { ready = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    ok(ready, '游戏就绪（__game/__tileset 就位）');
    if (!ready) return;

    // 5) 八种动物贴图都注册了
    const sprites = await evalJs(`(() => ['cow','sheep','chicken','dog','cat','wolf','deer','bird'].filter(k => window.__tileset.syn[k] && window.__tileset.syn[k].width > 0))()`);
    ok(Array.isArray(sprites) && sprites.length === 8, '八种动物贴图注册齐（' + (sprites || []).join(',') + '）');

    // 6) 初始镇上没有动物
    eq(await evalJs(`(() => window.__game.animals.length)()`), 0, '开局镇上没有动物');

    // 7) 买一头奶牛：镇库扣钱，动物落农田
    ok(await evalJs(`(() => window.__animalBuy('cow'))()`) === true, '陈麦冬买了一头奶牛');
    eq(await evalJs(`(() => window.__game.animals.filter(a => a.kind === 'cow').length)()`), 1, '镇上有一头奶牛');

    // 8) 领养一只狗：有名字有性格
    ok(await evalJs(`(() => window.__animalAdopt('dog'))()`) === true, '领养狗成功');
    const dogName = await evalJs(`(() => { const d = window.__game.animals.find(a => a.kind === 'dog'); return d && d.name; })()`);
    ok(!!dogName, '领养的狗有名字（' + dogName + '）');

    // 9) 放一只狼和一只鹿进世界
    const wild = await evalJs(`(() => window.__animalWild('wolf') + '|' + window.__animalWild('deer'))()`);
    ok(typeof wild === 'string' && wild.includes('wolf'), '野生动物进场（' + wild + '）');

    // 10) 帧推进不炸：连跑 90 帧（1.5 秒），动物挪窝/无异常
    const moved = await evalJs(`(async () => {
      const g = window.__game;
      const before = g.animals.map(a => a.x + ',' + a.y).join('|');
      await new Promise(r => setTimeout(r, 1500));
      const after = g.animals.map(a => a.x + ',' + a.y).join('|');
      return before !== after;
    })()`);
    ok(moved === true, '帧推进：动物在动（1.5 秒后位置变了）');

    // 11) 存档把动物带上
    const saved = await evalJs(`(() => { window.__game.saveLocal(); const s = JSON.parse(localStorage.getItem('godtown.save.v1')); return s.animals ? s.animals.length : -1; })()`);
    ok(saved >= 4, '存档里有动物（' + saved + ' 头/只）');

    // 12) 镇志里有动物的事
    const logged = await evalJs(`(() => window.__game.logLines.some(l => l.text.includes('买了一头') || l.text.includes('收养了一只')))()`);
    ok(logged === true, '镇志记下了买畜/收养');

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
