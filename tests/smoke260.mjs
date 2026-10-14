// smoke260.mjs - v2.6.0 模型池 CDP 冒烟：三层配置/byPersonality分配/池分支决策/故障链降级/演化独占/存档往返
// 用法：node smoke260.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9380;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp260_'));
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
      if (r.result && r.result.exceptionDetails) return { err: r.result.exceptionDetails.text + ' ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '').slice(0, 120) };
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

    // 1) 冒烟句柄就位 + 默认配置（三层关闭=现状行为）
    ok(await evalJs(`typeof window.__aiPool === 'function' && typeof window.__aiAssign === 'function' && typeof window.__aiPooledRound === 'function'`) === true, '模型池冒烟句柄就位');
    const def = await evalJs(`window.__aiPool()`);
    ok(def && Array.isArray(def.entries) && def.entries.length === 0, '默认池为空（三段默认关闭=v2.5 行为）');
    ok(def && def.ready === false && def.evoChain.length === 0, '默认演化独占未就绪');

    // 2) 配池 → 分配：全员在池内、byPersonality 确定性、声音分化
    // （配池后 aiEnabled 变 true，主循环可能把到期的 ready 者自动收去发真实请求——v2.8 起推远全员个人冷却 aiDcAt 防抢跑）
    const assign1 = await evalJs(`(() => {
      const g = window.__game;
      g.aiCfg.npcPool = { enabled: true, strategy: 'byPersonality',
        providers: [{ baseUrl: 'https://gw.test/v1', apiKey: 'k', models: ['model-a', 'model-b', 'model-c'] }] };
      g.npcs.forEach(n => { n.aiDcAt = g.clock.totalDay * 1440 + g.clock.min + 1000000; });
      return window.__aiAssign();
    })()`);
    const poolInfo = await evalJs(`window.__aiPool()`);
    eq(poolInfo && poolInfo.entries.length, 3, 'providers 折叠成 3 端点');
    ok(Array.isArray(assign1) && assign1.every(x => ['model-a', 'model-b', 'model-c'].includes(x.m)), '全员分配且在池内');
    ok(new Set(assign1.map(x => x.m)).size >= 2, '10 个性格各异的居民散到至少 2 个模型');
    const assign2 = await evalJs(`window.__aiAssign()`);
    ok(JSON.stringify(assign1) === JSON.stringify(assign2), '分配确定性（两次一致）');

    // 3) 池分支决策轮：mock fetch 成功 → 分工运转 + 决策落地（先唤醒全员，避免有人在屋里睡觉被契约闸跳过）
    const round1 = await evalJs(`(async () => {
      const g = window.__game;
      g.npcs.forEach(n => { n.inside = false; n.intent = { type: 'ready', label: '待命', untilMin: 0 }; n.aiDcAt = g._aiNowMin() + 1000000; });
      const busy0 = g.aiBusy;
      const cfgSnap = JSON.stringify({ poolOn: g.aiCfg.npcPool && g.aiCfg.npcPool.enabled, providers: g.aiCfg.npcPool && (g.aiCfg.npcPool.providers || []).length, mode: g.aiCfg.mode, nowMin: g._aiNowMin(), dcFar: g.npcs.every(n => n.aiDcAt > g._aiNowMin()), speed: g.clock.speed });
      let r = null, caught = null;
      try {
        r = await window.__aiPooledRound(async () => ({
          ok: true, status: 200,
          json: async () => ({ choices: [{ message: { content: '{"decisions":[{"npc":"陈麦冬","action":"idle","reason":"晒太阳"},{"npc":"赵铁山","action":"idle","reason":"歇会儿"}]}' } }] })
        }));
      } catch (e) { caught = String(e && e.message); }
      return { busy0, cfgSnap, caught, busy1: g.aiBusy, chain: (r && r.chain) || [], log: (r && r.log) || [], allLog: g.logLines.map(l => l.text) };
    })()`);
    ok(round1 && !round1.err && !round1.caught, '池分支决策轮跑通' + (round1 && (round1.err || round1.caught) ? '：' + (round1.err || round1.caught) : ''));
    if (!(round1 && round1.log.some(t => t.includes('居民之魂分工运转')) && round1.log.some(t => t.includes('居民之魂更新了')))) {
      console.log('  [DIAG] busy0/busy1 =', round1 && round1.busy0, '/', round1 && round1.busy1);
      console.log('  [DIAG] cfgSnap =', round1 && round1.cfgSnap);
      console.log('  [DIAG] round1.log =', JSON.stringify(round1 && round1.log));
      console.log('  [DIAG] round1.tail =', JSON.stringify((round1 && round1.allLog || []).slice(-6)));
      console.log('  [DIAG] round1.chain =', JSON.stringify((round1 && round1.chain || []).map(e => ({ p: e.purpose, via: e.via, f: (e.failed || []).length }))));
    }
    ok(round1 && round1.log.some(t => t.includes('居民之魂分工运转')), '分工运转日志');
    ok(round1 && round1.log.some(t => t.includes('居民之魂更新了')), '决策落地日志');

    // 4) 故障链：全部端点挂 → 组内空手、chainLog 留痕、不炸不锁死
    const round2 = await evalJs(`(async () => {
      const g = window.__game;
      const r = await window.__aiPooledRound(async () => { throw new Error('all down'); });
      r.err = undefined;
      return r;
    })()`);
    if (!(round2 && round2.busy === false && round2.chain && round2.chain.some(e => e.purpose === 'npc' && e.failed && e.failed.length >= 2))) {
      console.log('  [DIAG] round2 =', JSON.stringify({ busy: round2 && round2.busy, err: round2 && round2.err, chain: (round2 && round2.chain || []).map(e => ({ p: e.purpose, via: e.via, f: (e.failed || []).length })) }));
    }
    ok(round2 && round2.busy === false, '全挂后轮结束不锁死');
    ok(round2 && Array.isArray(round2.chain) && round2.chain.some(e => e.purpose === 'npc' && e.failed && e.failed.length >= 2), 'chainLog 留全挂降级痕');

    // 5) 演化独占：链序 主→备援→本地；不共享 NPC 池；主挂备援接住
    const evo = await evalJs(`(async () => {
      const g = window.__game;
      g.aiCfg.evolutionModel = { enabled: true, baseUrl: 'https://evo.test/v1', apiKey: 'ek', model: 'gemini-2.5-flash',
        backup: [{ baseUrl: 'https://bak.test/v1', apiKey: '', model: 'glm-4.7-flash' }] };
      g.aiCfg.localFallback = { baseUrl: 'http://localhost:11434/v1', model: 'lf' };
      const info = window.__aiPool();
      const { requestEvoProposal } = await import('./js/ai.js');
      const urls = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        urls.push(String(url));
        if (String(url).startsWith('https://evo.test')) return { ok: false, status: 429, text: async () => 'rate' };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"kind":"saying","payload":{"text":"天冷添衣","spreadBy":"chat"},"why":"换季","prob":0.5}' } }] }) };
      };
      let p = null, perr = null;
      try { p = await requestEvoProposal(g.aiCfg, { hint: '冒烟信号', source: 'smoke' }, g); } catch (e) { perr = e.message; }
      globalThis.fetch = realFetch;
      return { info, urls, kind: p && p.kind, perr, chainLog0: (g.aiChainLog || [])[g.aiChainLog.length - 1] || null };
    })()`);
    ok(evo && !evo.err, '演化独占段跑通' + (evo && evo.err ? '：' + evo.err : ''));
    ok(evo && evo.info.ready === true, '演化独占就绪');
    ok(evo && evo.info.evoChain.join(',') === 'gemini-2.5-flash,glm-4.7-flash,lf', '演化链序：主→备援→本地');
    ok(evo && evo.info.evoChain.every(m => !['model-a', 'model-b', 'model-c'].includes(m)), '演化链不含 NPC 池模型');
    ok(evo && evo.kind === 'saying', '主挂 → 备援接住提案' + (evo && evo.perr ? '（' + evo.perr + '）' : ''));
    ok(evo && evo.urls.every(u => u.startsWith('https://evo.test') || u.startsWith('https://bak.test')), '请求只打演化端点');
    ok(evo && evo.chainLog0 && evo.chainLog0.purpose === 'evolution' && evo.chainLog0.via === 'glm-4.7-flash', '演化降级记 chainLog');

    // 6) 存档往返：aiModelId 随档走
    await evalJs(`(() => { window.__game.saveLocal(); return true; })()`);
    const rt = await evalJs(`(() => {
      const raw = localStorage.getItem('godtown.save.v2');
      const s = JSON.parse(raw);
      const savedOk = (s.npcs || []).length > 0 && s.npcs.every(n => n.aiModelId && ['model-a', 'model-b', 'model-c'].includes(n.aiModelId));
      const poolSaved = s.aiCfg && s.aiCfg.npcPool && s.aiCfg.npcPool.enabled === true && (s.aiCfg.npcPool.providers || []).length === 1;
      const evoSaved = s.aiCfg && s.aiCfg.evolutionModel && s.aiCfg.evolutionModel.enabled === true && s.aiCfg.evolutionModel.model === 'gemini-2.5-flash';
      const G = window.__game.constructor;
      const g2 = G.hydrate(JSON.parse(raw), window.__renderer);
      const hOk = g2.npcs.every(n => n.aiModelId && ['model-a', 'model-b', 'model-c'].includes(n.aiModelId));
      return { savedOk, poolSaved, evoSaved, hOk };
    })()`);
    ok(rt && rt.savedOk === true, '存档带全员的 aiModelId');
    ok(rt && rt.poolSaved === true, '模型池配置随档走');
    ok(rt && rt.evoSaved === true, '演化独占配置随档走');
    ok(rt && rt.hOk === true, '读档后分配复原');

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
