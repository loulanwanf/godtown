// boot.js - 入口：加载 CC0 图集 → 初始化渲染器/游戏实例/输入绑定/主循环
import { Renderer } from './render.js';
import { Tileset } from './tileset.js';
import { Game } from './game.js';
import { initUI, switchTab, toast } from './ui.js';
import { tryPairChat, npcSnapshot } from './npc.js';
import { mindDailyTick } from './secret.js';
import { buyAnimal, adoptPet, makeAnimal } from './animals.js';
import { developDaily } from './develop.js';
import { disasterDaily } from './disaster.js';
import { evolveDaily } from './evolve.js';
import { ctxInfoText, poolEntries, assignModels, evolutionReady, evoEntries, requestDecisionsPooled } from './ai.js';
import { holdDaily } from './hold.js';
import { neuroObserve, neuroDaily } from './neurocore.js';

const canvas = document.getElementById('gameCanvas');
const miniMap = document.getElementById('miniMap');

// ---------- 加载遮罩 ----------
const boot = document.createElement('div');
boot.id = 'bootLoad';
boot.innerHTML = '<div class="boot-box"><div class="boot-title">创世小镇</div>'
  + '<div class="boot-sub" id="bootMsg">正在绘制世界…</div>'
  + '<div class="boot-bar"><i id="bootBar"></i></div></div>';
document.body.appendChild(boot);

(async function main() {
  const tileset = new Tileset();
  try {
    await tileset.load((done, total) => {
      const el = document.getElementById('bootBar');
      const msg = document.getElementById('bootMsg');
      if (el) el.style.width = Math.round(done / total * 100) + '%';
      if (msg) msg.textContent = `素材加载 ${done}/${total}`;
    });
  } catch (err) {
    const msg = document.getElementById('bootMsg');
    if (msg) { msg.textContent = '素材加载失败：' + err.message; msg.classList.add('err'); }
    console.error(err);
    return;
  }

  const renderer = new Renderer(canvas, miniMap, tileset);

  let game = null;
  // 优先从自定义数据路径的文件恢复（安装版），其次 localStorage
  if (window.gdIO && window.gdIO.loadData) {
    game = await Game.loadFromFile(renderer);
  }
  if (!game && Game.hasLocalSave()) {
    game = Game.loadLocal(renderer);
  }
  if (!game) { game = new Game(renderer); game.newGame(); }
  window.__game = game;
  window.__renderer = renderer;
  window.__tileset = tileset;
  // 调试/冒烟句柄：模块级纯函数（selftest 与 CDP 冒烟共用）
  window.__tryPairChat = tryPairChat;
  window.__mindDailyTick = mindDailyTick;
  window.__npcSnapshot = npcSnapshot;
  // 生命层调试/冒烟句柄：强制走一遍出生与死亡全链路
  window.__lifeForceBirth = () => window.__game.forceBirth();
  window.__lifeForceDeath = (id) => window.__game.forceDeath(id);
  // 世界层调试/冒烟句柄（v1.8.0）：买牲畜/领养伴侣/放一只野生动物
  window.__animalBuy = (kind) => { const g = window.__game; g.stock.gold = Math.max(g.stock.gold, 60); return !!buyAnimal(g, g.npcs[0], kind); };
  window.__animalAdopt = (kind) => !!adoptPet(window.__game, window.__game.npcs[8], kind);
  window.__animalWild = (kind) => { const g = window.__game; const a = makeAnimal(kind, 20, 50, g.rng); g.animals.push(a); return a.kind + '@' + Math.round(a.x) + ',' + Math.round(a.y); };
  // 演化层调试/冒烟句柄（v1.9.0）：配方/灾难日推进 + AI 口信预览
  window.__developDaily = (day) => developDaily(window.__game, day == null ? window.__game.clock.totalDay : day);
  window.__disasterDaily = (day) => disasterDaily(window.__game, day == null ? window.__game.clock.totalDay : day);
  window.__ctxInfo = () => ctxInfoText(window.__game.clock, window.__game.weather, window.__game);
  // 呈现层调试/冒烟句柄（v2.0.0）：编年史/传闻网/考古标记/高光帧
  window.__histStats = () => {
    const g = window.__game;
    return { chron: g.chron.length, rumors: g.rumors.length, marks: g.marks.size, highlights: g.highlights.length, kinds: [...new Set(g.chron.map(e => e.k))].join(',') };
  };
  window.__histSnap = () => window.__game.highlights[window.__game.highlights.length - 1] || null;
  // 演化引擎调试/冒烟句柄（v2.3.0）：演化日推进
  window.__evolveDaily = (day) => evolveDaily(window.__game, day == null ? window.__game.clock.totalDay : day);
  // 涌现物理层调试/冒烟句柄（v2.4.0）：持有/交换/认领日推进 + 认领登记快照
  window.__holdDaily = (day) => holdDaily(window.__game, day == null ? window.__game.clock.totalDay : day);
  window.__claims = () => [...(window.__game.claims || new Map()).entries()]
    .map(([k, c]) => ({ key: k, by: c.by, since: c.since, rec: Object.values(c.recognizedBy).filter(v => v === true).length, no: Object.values(c.recognizedBy).filter(v => v === false).length, disputed: !!c.disputed, settled: !!c.settled }));
  // 神经芯调试/冒烟句柄（v2.5.0）：芯状态/学习观察/日推进
  window.__neuro = () => window.__game.neurocore;
  window.__neuroObserve = (id, action) => {
    const g = window.__game;
    const n = g.npcs.find(v => v.id === id);
    if (n) neuroObserve(g, n, { action });
    return { w: { ...g.neurocore.w }, stats: { ...g.neurocore.stats } };
  };
  window.__neuroDaily = (day) => neuroDaily(window.__game, day == null ? window.__game.clock.totalDay : day);
  // 模型池调试/冒烟句柄（v2.6.0）：池端点/分配/演化链/池分支决策
  window.__aiPool = () => {
    const g = window.__game;
    return { entries: poolEntries(g.aiCfg), ready: evolutionReady(g.aiCfg), evoChain: evoEntries(g.aiCfg).map(e => e.model) };
  };
  window.__aiAssign = () => { assignModels(window.__game); return window.__game.npcs.map(n => ({ id: n.id, m: n.aiModelId })); };
  window.__aiPooledRound = async (fetchMock) => {
    const g = window.__game;
    if (fetchMock) window.__origFetch = window.__origFetch || globalThis.fetch, globalThis.fetch = fetchMock;
    try {
      g.aiCfg.npcPool = g.aiCfg.npcPool || { enabled: true, strategy: 'byPersonality', providers: [] };
      g.aiCfg.npcPool.enabled = true;
      await g.requestAiRound();
    } finally {
      if (fetchMock && window.__origFetch) globalThis.fetch = window.__origFetch;
    }
    return { chain: g.aiChainLog || [], busy: g.aiBusy, log: g.logLines.slice(-3).map(l => l.text) };
  };
  // v2.8.0 按需触发调度句柄：跑一次调度扫描 + 查调度状态（各活各的，不再全镇同步）
  window.__aiSchedTick = () => { window.__game.aiLoopTick(); return window.__aiSched(); };
  window.__aiSched = () => {
    const g = window.__game;
    const now = g._aiNowMin();
    return {
      now, busy: g.aiBusy,
      batch: g.aiBatch.map(n => n.id),
      batchStart: g.aiBatchStart,
      window: g.aiAskWindow, cap: g.aiAskCap, timeout: g.aiAskTimeout,
      people: g.npcs.map(n => ({ id: n.id, dc: n.aiDcAt, asking: !!n.aiAsking, ready: n.intent.type === 'ready' && !n.path.length, sleeping: !!(n.inside && n.intent.type === 'sleep') }))
    };
  };

  // 应用存档中的渲染风格（smooth 默认）
  renderer.setRenderStyle(game.display && game.display.renderStyle);

  initUI(game, renderer);
  switchTab('souls');

  // ---------- 画布尺寸 ----------
  function resize() {
    renderer.resize();
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    renderer.miniRect = rect;
    void dpr;
  }
  window.addEventListener('resize', resize);
  resize();
  // 镜头初始对准广场
  renderer.cam.x = 36 - (canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1)) / (16 * renderer.cam.zoom) / 2;
  renderer.cam.y = 26 - (canvas.getBoundingClientRect().height * (window.devicePixelRatio || 1)) / (16 * renderer.cam.zoom) / 2;

  // ---------- 输入 ----------
  const keys = {};
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { e.preventDefault(); const g = window.__game; const btn = document.getElementById(g.clock.speed === 0 ? 'spd1' : 'spd0'); btn.click(); }
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  // v4.6.0 观察者模式：玩家能看不能改——鼠标只负责拖地图，世界自己活着
  let dragging = false, lastMX = 0, lastMY = 0;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0 || e.button === 1 || e.button === 2 || keys['shift']) { dragging = true; lastMX = e.clientX; lastMY = e.clientY; }
  });
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    renderer.hoverTile = renderer.screenToTile(e.clientX, e.clientY, rect);
    if (dragging) {
      const dpr = window.devicePixelRatio || 1;
      renderer.cam.x -= (e.clientX - lastMX) * dpr / (16 * renderer.cam.zoom);
      renderer.cam.y -= (e.clientY - lastMY) * dpr / (16 * renderer.cam.zoom);
      lastMX = e.clientX; lastMY = e.clientY;
      clampCam();
    }
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvas.addEventListener('mouseleave', () => { renderer.hoverTile = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const steps = [1.5, 2, 2.5, 3];
    let i = steps.indexOf(renderer.cam.zoom);
    if (i < 0) i = 1;
    i += e.deltaY < 0 ? 1 : -1;
    i = Math.max(0, Math.min(steps.length - 1, i));
    renderer.cam.zoom = steps[i];
  }, { passive: false });

  // 小地图点击跳转
  miniMap.addEventListener('click', (e) => {
    const rect = miniMap.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width * 72;
    const my = (e.clientY - rect.top) / rect.height * 72;
    const dpr = window.devicePixelRatio || 1;
    renderer.cam.x = mx - (canvas.getBoundingClientRect().width * dpr) / (16 * renderer.cam.zoom) / 2;
    renderer.cam.y = my - (canvas.getBoundingClientRect().height * dpr) / (16 * renderer.cam.zoom) / 2;
    clampCam();
  });

  // v4.5.0 无限世界：视野不再有边界（计划书第二章——远处不是没有，是降精度）
  // 走出去的人去了多远，镜头就能跟到多远；世界不再有看不见的墙
  function clampCam() {}

  // ---------- 主循环 ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(0.1, (now - lastT) / 1000));
    lastT = now;
    try {
      const g = window.__game;
      const pan = 14 * dt;
      if (keys['w'] || keys['arrowup']) { renderer.cam.y -= pan; clampCam(); }
      if (keys['s'] || keys['arrowdown']) { renderer.cam.y += pan; clampCam(); }
      if (keys['a'] || keys['arrowleft']) { renderer.cam.x -= pan; clampCam(); }
      if (keys['d'] || keys['arrowright']) { renderer.cam.x += pan; clampCam(); }
      g.loop(dt);
      renderer.draw(g, dt);
    } catch (err) {
      console.error(err);
      showFatal(err);
    }
    requestAnimationFrame(frame);
  }

  // 淡出加载遮罩并开跑
  requestAnimationFrame(() => {
    boot.classList.add('hide');
    setTimeout(() => boot.remove(), 500);
  });
  requestAnimationFrame(frame);

  let fatalShown = false;
  function showFatal(err) {
    if (fatalShown) return;
    fatalShown = true;
    toast('运行异常：' + (err && err.message), 'err');
    setTimeout(() => { fatalShown = false; }, 5000);
  }
})();

// 未捕获异常兜底
window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});
