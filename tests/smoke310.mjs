// smoke310.mjs - v3.1.0 语言革命 + v4.8.0 基底之上全开放 + v4.9.0 感知与名望 CDP 冒烟：36 话位词库运行时就位/台词全部从词库取/
//   归属转移动词透明（任意动词+格局=易手）/词库随日漂移且槽不空（退役地板保底）/存档带词库且往返一致/
//   信念目击覆盖/名望场 Top1/评理改道公共事件/快照两窗/零 JS 错误
// 用法：node smoke310.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9431;
const userData = mkdtempSync(join(tmpdir(), 'gdcdp310_'));
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

    // ============ ① 36 话位词库运行时就位，种子词全覆盖 ============
    const s1 = await evalJs(`(async () => {
      const { LEX_SLOTS, SEED_LEXICON, sameLexEntry } = await import('./js/lexicon.js');
      const g = window.__game;
      const slotKeys = Object.keys(LEX_SLOTS);
      const missing = slotKeys.filter(k => !Array.isArray(g.lexicon[k]));
      const seedMissing = slotKeys.filter(k => (SEED_LEXICON[k] || []).some(w => !g.lexicon[k].some(e => sameLexEntry(e, w))));
      return { slotCount: slotKeys.length, missing, seedMissing };
    })()`);
    ok(s1 && !s1.err, '①词库模块导入成功' + (s1 && s1.err ? '：' + s1.err : ''));
    eq(s1 && s1.slotCount, 36, '①话位名册 36 槽');
    eq(s1 && s1.missing && s1.missing.length, 0, '①运行时词库 36 槽全就位');
    eq(s1 && s1.seedMissing && s1.seedMissing.length, 0, '①种子词全覆盖（开局词库=种子表）');

    // ============ ② NPC 台词全部从当下词库取 ============
    const s2 = await evalJs(`(async () => {
      const { pickLex } = await import('./js/lexicon.js');
      const g = window.__game;
      // 摸 20 次话题，必须全在 chatTopic 槽里
      const topics = [];
      for (let i = 0; i < 20; i++) topics.push(pickLex(g, 'chatTopic', g.rng));
      const topicsOk = topics.every(t => g.lexicon.chatTopic.includes(t));
      // 新生儿名字/心性从词库抓
      const { makeChildDef } = await import('./js/life.js');
      const f = g.npcs[0], m = g.npcs.find(n => n.sex !== f.sex) || g.npcs[1];
      const kid = makeChildDef(f, m, g.rng, 999, g);
      const nameOk = g.lexicon.nameGiven.some(w => kid.name.endsWith(w));
      const persOk = g.lexicon.persChild.includes(kid.pers);
      // 外来人姓名/心性从词库抓
      const { makeTravelerDef } = await import('./js/social.js');
      const t = makeTravelerDef(g.rng, 888, g);
      const tOk = g.lexicon.outSur.some(s => t.name.startsWith(s)) && g.lexicon.persOut.includes(t.pers);
      return { topicsOk, nameOk, persOk, tOk, kidName: kid.name, tName: t.name };
    })()`);
    ok(s2 && s2.topicsOk === true, '②聊天话题 20 次全在 chatTopic 槽内');
    ok(s2 && s2.nameOk === true && s2.persOk === true, '②新生儿名字/心性从当下词库抓（' + (s2 && s2.kidName) + '）');
    ok(s2 && s2.tOk === true, '②外来人姓名/心性从当下词库抓（' + (s2 && s2.tName) + '）');

    // ============ ③ 基底之上全开放（v4.8.0）：资源原型/动词透明转移/距离闸/演化存档无类型管道 ============
    const s3 = await evalJs(`(async () => {
      const { makeAction, dispatch } = await import('./js/action.js');
      const { ensureHold, goodsOf } = await import('./js/hold.js');
      const { serializeEvo } = await import('./js/evolve.js');
      const G = window.__game.constructor;
      const c = new G(window.__renderer);
      c.newGame(310);
      // 3a 资源原型：9 种库存资源都有原型，公名=中文名
      const protos = (c.matters || []).filter(m => m.prototypeRes);
      // 3b 动词透明：「给」「扔」同一格局同一物理——鱼从 a 到 b
      const a = c.npcs[0], b = c.npcs[1];
      a.x = 10; a.y = 10; b.x = 11; b.y = 10;
      ensureHold(a).goods.fish = 2; ensureHold(b);
      const fishProto = protos.find(m => m.prototypeRes === 'fish');
      const v1 = dispatch(makeAction(a, '给', [fishProto, b]), c);
      const v2 = dispatch(makeAction(a, '扔', [fishProto, b]), c);
      // 3c 距离闸：太远够不着
      const far = c.npcs[2]; far.x = 60; far.y = 60;
      ensureHold(a).goods.crop = 1; ensureHold(far);
      const cropProto = protos.find(m => m.prototypeRes === 'crop');
      const v3 = dispatch(makeAction(a, '递', [cropProto, far]), c);
      // 3d 演化存档无类型管道
      const ser = serializeEvo(c);
      return { protoCount: protos.length,
        moved: goodsOf(b, 'fish'), aLeft: goodsOf(a, 'fish'),
        farMoved: goodsOf(far, 'crop'),
        noPool: !('pool' in ser) && !('wind' in ser) && !('seq' in ser),
        hasIdeas: !!(ser.ideas && Array.isArray(ser.ideas.ideas)) };
    })()`);
    ok(s3 && !s3.err, '③v4.8.0 全开放链路跑通' + (s3 && s3.err ? '：' + s3.err : ''));
    eq(s3 && s3.protoCount, 9, '③九种资源原型注册');
    eq(s3 && s3.moved, 2, '③动词透明：「给」「扔」都是易手（格局决定物理）');
    eq(s3 && s3.aLeft, 0, '③给出的真失去了（守恒）');
    eq(s3 && s3.farMoved, 0, '③距离闸：太远够不着');
    ok(s3 && s3.noPool === true && s3.hasIdeas === true, '③演化存档只剩日志/配方/旧事/观念（类型管道退役）');

    // ============ ④ 词库随日漂移 30 天：零 JS 错误，槽不空（退役地板保底） ============
    const s4 = await evalJs(`(() => {
      const g = window.__game;
      const errsBefore = (window.__errs || []).length;
      for (let i = 0; i < 30; i++) { g.clock.totalDay++; g.onNewDay(); }
      const empty = Object.entries(g.lexicon).filter(([k, v]) => !Array.isArray(v) || v.length === 0).map(([k]) => k);
      const errsAfter = (window.__errs || []).length;
      return { newErrs: errsAfter - errsBefore, empty, chatTopic: g.lexicon.chatTopic.length, motto: g.lexicon.motto.length };
    })()`);
    eq(s4 && s4.newErrs, 0, '④30 天连跑零 JS 错误');
    eq(s4 && s4.empty && s4.empty.length, 0, '④30 天后无空槽（退役地板保底）' + (s4 && s4.empty && s4.empty.length ? '：' + s4.empty.join(',') : ''));
    ok(s4 && s4.chatTopic > 0 && s4.motto > 0, '④漂移后词库仍活着（chatTopic ' + (s4 && s4.chatTopic) + ' 词 / motto ' + (s4 && s4.motto) + ' 词）');

    // ============ ⑤ 存档带词库，读档逐词一致 ============
    const s5 = await evalJs(`(async () => {
      const { sameLexEntry } = await import('./js/lexicon.js');
      const g = window.__game;
      g.saveLocal();
      const raw = localStorage.getItem('godtown.save.v2');
      const data = JSON.parse(raw);
      const saveSlots = data.lexicon ? Object.keys(data.lexicon).length : 0;
      const g2 = g.constructor.hydrate(JSON.parse(raw), window.__renderer);
      let mismatch = 0;
      for (const k of Object.keys(g.lexicon)) {
        const a = g.lexicon[k], b = g2.lexicon[k] || [];
        if (a.length !== b.length || a.some((w, i) => !sameLexEntry(w, b[i]))) mismatch++;
      }
      // 老档（无 lexicon 字段）落种子表
      const old = JSON.parse(raw); delete old.lexicon;
      const g3 = g.constructor.hydrate(old, window.__renderer);
      const oldOk = Object.keys(g3.lexicon).length === 36 && g3.lexicon.motto.length > 0;
      return { saveSlots, mismatch, oldOk };
    })()`);
    eq(s5 && s5.saveSlots, 36, '⑤存档带 36 槽词库');
    eq(s5 && s5.mismatch, 0, '⑤读档逐词一致（词库随档走）');
    eq(s5 && s5.oldOk, true, '⑤老档无词库字段 → 落种子表（向后兼容）');

    // ============ ⑥ 感知与名望（v4.9.0）：信念目击覆盖/名望场/评理改道/快照两窗 ============
    const s6 = await evalJs(`(async () => {
      const { addBelief, WITNESS_CONF } = await import('./js/belief.js');
      const { refreshStandingTop, relOf, refreshTags } = await import('./js/social.js');
      const { claimHouse, holdDaily } = await import('./js/hold.js');
      const { npcSnapshot } = await import('./js/npc.js');
      const G = window.__game.constructor;
      const c = new G(window.__renderer);
      c.newGame(490);
      const a = c.npcs[0], b = c.npcs[1];
      // 6a 信念写入 + 目击覆盖听闻
      addBelief(a, '东北边有个营地', { src: '行脚人捎话', dir: '东北', conf: 0.6, day: 1 });
      addBelief(a, '东北边有个营地', { src: '亲眼', conf: WITNESS_CONF, day: 2 });
      const witCov = a.beliefs[0].conf === WITNESS_CONF && a.beliefs[0].src === '亲眼';
      // 6b 名望场：关系堆出来，职业不加分（lead 是农夫）
      const lead = c.npcs[2];
      lead.job = '农夫';
      for (const o of c.npcs) { if (o === lead) continue; const r = relOf(o, lead.id, 1); r.trust = 90; r.depend = 80; refreshTags(r); }
      const top = refreshStandingTop(c, 1);
      // 6c 评理改道：争议 → 公共事件 → 目击者信念「谁是评理的人」
      const house = c.world.houses[0]; house.ownerId = 'dead_x';
      for (const n of c.npcs) { n.x = a.x + 1; n.y = a.y; n.inside = false; }
      claimHouse(c, a, house, [{ npc: c.npcs[3], recognized: false }, { npc: c.npcs[4], recognized: false }]);
      const cl = [...c.claims.values()][0];
      holdDaily(c, cl.since + 5);
      const witBelief = c.npcs.some(n => n !== a && (n.beliefs || []).some(x => x.text.includes('是评理的人')));
      // 6d 快照两窗：我以为 + 说话算数的人
      addBelief(b, '山那边有狼', { src: '亲眼', conf: WITNESS_CONF, day: 1 });
      const sn = npcSnapshot(b, { w: c.world, clock: c.clock, weather: c.weather, rng: c.rng, game: c, nameOf: id => id });
      const winWo = Array.isArray(sn.我以为) && sn.我以为.some(s => s.includes('山那边有狼'));
      const winTop = sn.说话算数的人 === lead.name;
      return { witCov, topOk: !!(top && top.id === lead.id), disputed: cl.disputed === true, witBelief, winWo, winTop,
        newErrs: (window.__errs || []).length };
    })()`);
    ok(s6 && !s6.err, '⑥v4.9.0 感知与名望链路跑通' + (s6 && s6.err ? '：' + s6.err : ''));
    ok(s6 && s6.witCov === true, '⑥目击覆盖听闻（亲眼 0.9 不被传闻撼动）');
    ok(s6 && s6.topOk === true, '⑥名望场 Top1=被信任/依赖的人（职业不加分）');
    ok(s6 && s6.disputed === true && s6.witBelief === true, '⑥评理改道：争议成公共事件，目击者记下「谁是评理的人」');
    ok(s6 && s6.winWo === true && s6.winTop === true, '⑥快照两窗：我以为 + 说话算数的人');

    ws.close();
  } finally {
    try { spawnSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' }); } catch { }
  }
  console.log(`\n===== smoke310 汇总：${pass} 过 / ${fail} 失败 =====`);
  if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('SMOKE_CRASH', e); try { spawnSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' }); } catch { } process.exit(1); });
