// smoke320.mjs - v3.2.0 存档去回档 CDP 冒烟：顶栏无读档按钮/导出正常/设置弹窗有导入+放弃确认/数据路径查询
// 用法：node smoke320.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9432;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp320_'));
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
      return true;
    })()`);

    // ============ ① 顶栏：有导出无读档 ============
    const s1 = await evalJs(`(() => {
      const btnSave = document.getElementById('btnSave');
      const btnLoad = document.getElementById('btnLoad');
      return {
        saveText: btnSave ? btnSave.textContent : null,
        saveTitle: btnSave ? btnSave.title : null,
        loadExists: !!btnLoad
      };
    })()`);
    eq(s1 && s1.saveText, '导出', '①顶栏按钮文案=导出');
    ok(s1 && s1.saveTitle && s1.saveTitle.includes('跨设备迁移'), '①导出按钮 tooltip 标明用途');
    eq(s1 && s1.loadExists, false, '①顶栏无读档按钮（已删除）');

    // ============ ② 设置弹窗：有导入/放弃/数据路径 ============
    const s2 = await evalJs(`(async () => {
      document.getElementById('btnSettings').click();
      await new Promise(r => setTimeout(r, 300));
      const modal = document.getElementById('settingsModal');
      const importBtn = document.getElementById('setImport');
      const clearBtn = document.getElementById('setClear');
      const dataDirSec = document.getElementById('setDataDirSec');
      const dataDirPath = document.getElementById('setDataDirPath');
      const dataDirBtn = document.getElementById('setDataDirBtn');
      // 等数据路径异步查询完成
      await new Promise(r => setTimeout(r, 500));
      return {
        visible: !modal.classList.contains('hidden'),
        importText: importBtn ? importBtn.textContent : null,
        clearText: clearBtn ? clearBtn.textContent : null,
        clearDanger: clearBtn ? clearBtn.classList.contains('btn-danger') : false,
        dataDirVisible: dataDirSec ? dataDirSec.style.display !== 'none' : false,
        dataDirPath: dataDirPath ? dataDirPath.textContent : null,
        dataDirBtnVisible: dataDirBtn ? dataDirBtn.style.display !== 'none' : false
      };
    })()`);
    eq(s2 && s2.visible, true, '②设置弹窗打开');
    eq(s2 && s2.importText, '从文件导入…', '②导入按钮存在');
    eq(s2 && s2.clearText, '放弃这个世界，另起一个', '②放弃按钮文案正确');
    eq(s2 && s2.clearDanger, true, '②放弃按钮有危险样式');
    ok(s2 && s2.dataDirVisible, '②数据存储区域可见');
    ok(s2 && s2.dataDirPath && s2.dataDirPath.length > 3 && s2.dataDirPath !== '查询中…', '②数据路径已显示：' + (s2 && s2.dataDirPath));

    // ============ ③ 自动存档覆盖式（不读档入口） ============
    const s3 = await evalJs(`(async () => {
      const g = window.__game;
      // 存一次
      g.saveLocal();
      const day1 = g.clock.totalDay;
      // 推进一天
      g.clock.totalDay++;
      g.onNewDay();
      // localStorage 里应该是最新的一天（覆盖式，不留历史）
      const raw = localStorage.getItem('godtown.save.v2');
      const data = JSON.parse(raw);
      // clock 序列化格式：{year, season, day, min, speed}，totalDay 是运行时计算值
      const savedTotal = data.clock ? (data.clock.year - 1) * 120 + (data.clock.season || 0) * 30 + (data.clock.day || 1) : 0;
      return { savedDay: savedTotal, currentDay: g.clock.totalDay };
    })()`);
    ok(s3 && s3.savedDay === s3.currentDay, '③自动存档覆盖式：只存最新状态（第' + (s3 && s3.currentDay) + '天）');

    // ============ ④ 文件存储双写 ============
    const s4 = await evalJs(`(async () => {
      if (!window.gdIO || !window.gdIO.loadData) return { skip: true };
      const r = await window.gdIO.loadData();
      return { hasFile: r && r.ok && !!r.text, empty: r && r.empty };
    })()`);
    if (s4 && s4.skip) {
      ok(true, '④文件存储不可用（Web 模式跳过）');
    } else {
      ok(s4 && s4.hasFile, '④文件存储双写成功（godtown-save.json 存在）');
    }

    // ============ ⑤ 零 JS 错误 ============
    const s5 = await evalJs(`(() => (window.__errs || []).length)()`);
    eq(s5, 0, '⑤全程零 JS 错误');

    // 清理
    await evalJs(`(() => { document.getElementById('settingsCancel').click(); return true; })()`);

  } finally {
    try { proc.kill(); } catch { }
    spawnSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' });
  }

  console.log(`\n冒烟完成：通过 ${pass} 项，失败 ${fail} 项`);
  if (failures.length) { console.log('失败清单：'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}
main();
