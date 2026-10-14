// ui.js - DOM 交互：上帝面板/居民面板/设置弹窗/日志/顶栏
import { O, G, O_NAME, WEATHERS, STOCK_NAME, SEASONS } from './core.js';
import { Game } from './game.js';
import { ROSTER } from './npc.js';
import { bodySummary, PART_NAME } from './body.js';
import { stageOf } from './life.js';
import { powerOf } from './social.js';
import { rumorThreads, markAge, fleshOf } from './history.js';
import { dirWord, TOWN } from './wanderer.js';

// 镜头定位到世界坐标（v4.5.0 无限世界：点远方的人，镜头就跟到远方）
function locateAt(wx, wy) {
  const r = window.__renderer;
  if (!r) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = r.canvas.getBoundingClientRect();
  r.cam.x = wx - (rect.width * dpr) / (16 * r.cam.zoom) / 2;
  r.cam.y = wy - (rect.height * dpr) / (16 * r.cam.zoom) / 2;
  r.mapDirty = true;
}

const $ = (id) => document.getElementById(id);

export function initUI(game, renderer) {
  buildSoulsTab(game);
  bindTopbar(game, renderer);
  bindSettings(game);
  bindTabs();

  game.uiHooks.onLog = (line) => appendLog(line);
  game.uiHooks.onTickUI = () => {
    tickTopbar(game);
    refreshInspector(game);
  };
  game.uiHooks.onNewDay = () => {
    if (currentTab === 'souls') buildSoulsTab(game);
    if (currentTab === 'evolve') buildEvolveTab(game);
  };

  toastWrapInit();
  appendLog({ t: '--', day: 1, text: '欢迎来到雾溪镇', cls: 'hl' });
}

// ---------- 顶栏 ----------
function tickTopbar(game) {
  $('tbClock').textContent = game.clock.label();
  $('tbWeather').textContent = WEATHERS[game.weather.type] + (game.weather.forced ? '（神定）' : '');
  const s = game.stock;
  $('tbStock').innerHTML = Object.keys(s).map(k => `${STOCK_NAME[k] || k} <b>${Math.floor(s[k])}</b>`).join('');
}

function bindTopbar(game, renderer) {
  const speeds = [0, 1, 2, 4];
  for (const sp of speeds) {
    $('spd' + sp).addEventListener('click', () => {
      game.clock.speed = sp;
      for (const v of speeds) $('spd' + v).classList.toggle('on', v === sp);
    });
  }
  $('btnNextDay').addEventListener('click', () => {
    const r = game.clock.skipToMorning();
    if (r && r.newDay) game.onNewDay(r.days);   // 跨日信号不能丢：庄稼/身体/自动事件都要走
    game.log('创世神拨快了时间，天亮了', 'hl');
    tickTopbar(game);
  });
  // 导出：仅用于跨设备迁移最新状态，不是回档入口
  $('btnSave').addEventListener('click', async () => {
    game.saveLocal();   // 确保导出的是最新状态
    if (window.gdIO) {
      const r = await window.gdIO.saveFile(`创世小镇-第${game.clock.totalDay}天.json`, JSON.stringify(game.serialize(), null, 1));
      if (r && r.ok) toast('已导出到 ' + r.path, 'ok');
    } else {
      toast('便携版请在设置中导出', 'err');
    }
  });
  // 导入：仅用于跨设备迁移（替换当前世界），不是回档
  // 入口放在设置弹窗内，避免与"导出"并列造成"存/读"对等错觉
  $('btnSettings').addEventListener('click', () => openSettings(game));
}
export function swapGame(oldGame, newGame, renderer) {
  newGame.uiHooks = oldGame.uiHooks;
  window.__game = newGame;
  newGame.renderer = renderer;
  toast('世界已恢复', 'ok');
}

// ---------- 标签页 ----------
let currentTab = 'souls';
function bindTabs() {
  document.querySelectorAll('.gp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gp-tab').forEach(b => b.classList.toggle('on', b === btn));
      currentTab = btn.dataset.tab;
      const game = window.__game;
      if (currentTab === 'souls') buildSoulsTab(game);
      if (currentTab === 'history') buildHistoryTab(game);
      if (currentTab === 'evolve') buildEvolveTab(game);
    });
  });
}
export function switchTab(tab) {
  const btn = document.querySelector(`.gp-tab[data-tab="${tab}"]`);
  if (btn) btn.click();
}

// ---------- 众生页（v4.6.0 观察者模式：世界上诞生过的所有人，不只小镇） ----------
// 人口普查：全世界的人 = 在镇 + 在远方 + 已逝 + 下落不明（离镇后再无音讯）
export function census(game) {
  const npcs = game.npcs || [];
  const wands = game.wanderers || [];
  const dead = game.dead || [];
  const left = game.left || [];
  const wandIds = new Set(wands.map(w => w.id));
  const deadIds = new Set(dead.map(d => d.id));
  const missingList = left.filter(r => !wandIds.has(r.id) && !deadIds.has(r.id));
  let sexM = 0, sexF = 0;
  for (const p of [...npcs, ...wands]) { if (p.sex === '女') sexF++; else sexM++; }
  return {
    born: npcs.length + wands.length + dead.length + missingList.length,
    alive: npcs.length + wands.length,
    inTown: npcs.length,
    away: wands.length,
    dead: dead.length,
    missing: missingList.length,
    missingList,
    sexM, sexF,
    settlements: (game.settlements || []).filter(s => !s.abandoned && s.population > 0).length
  };
}

function wandererStateWord(w, game) {
  const wd = w.wand;
  if (!wd) return '在路上';
  if (wd.state === 'settled') {
    const s = (game.settlements || []).find(v => v.id === wd.settId);
    return '在' + (s ? s.name : '营地') + '落脚了';
  }
  if (wd.state === 'seek') {
    const s = (game.settlements || []).find(v => v.id === wd.settId);
    return '去投奔' + (s ? s.name : '远方的聚落');
  }
  if (wd.state === 'return') return '回镇探亲的路上';
  return '赶路';
}

// 当前展开的画像（实时刷新用）：{ id, type: npc|wanderer|dead|missing }
let _insp = null;
let _inspTick = 0;

function buildSoulsTab(game) {
  const body = $('gpBody');
  const c = census(game);
  body.innerHTML = `
    <div class="gp-sec">
      <div class="gp-sec-title">
        <span>众生 · 这个世界诞生过的所有人</span>
        <span class="mini-act" id="aiModeBadge"></span>
      </div>
      <div class="gp-tip census-line">诞生 <b>${c.born}</b> · 在世 <b>${c.alive}</b>（镇 ${c.inTown} / 远方 ${c.away}）· 已逝 <b>${c.dead}</b>${c.missing ? ` · 下落不明 <b>${c.missing}</b>` : ''} · 男 ${c.sexM} / 女 ${c.sexF}${c.settlements ? ` · 聚落 ${c.settlements}` : ''}</div>
      <div class="gp-tip">点名字展开画像；画像里能定位到他本人（逝者定位到坟）。</div>
      <div id="npcList"></div>
    </div>
    <div class="gp-sec" id="inspSec" style="display:none">
      <div class="gp-sec-title">生灵册 · <span id="inspName"></span></div>
      <div id="inspBody"></div>
    </div>
  `;
  const badge = $('aiModeBadge');
  if (game.aiEnabled()) { badge.textContent = 'AI驱动中'; badge.style.color = 'var(--ok)'; }
  else { badge.textContent = '本能驱动（未接AI）'; badge.style.color = 'var(--text-faint)'; }
  badge.addEventListener('click', () => openSettings(game));
  badge.style.cursor = 'pointer';

  const list = $('npcList');
  const addGroup = (label, count) => {
    const h = document.createElement('div');
    h.className = 'gp-sec-title census-group';
    h.textContent = `${label} · ${count}`;
    list.appendChild(h);
  };
  const addRow = (opts) => {
    const item = document.createElement('div');
    item.className = 'npc-item' + (_insp && _insp.id === opts.id ? ' sel' : '');
    item.innerHTML = `
      <span class="npc-dot" style="background:${opts.color || '#888'}"></span>
      <span class="npc-name">${escapeHtml(opts.name)}</span>
      <span class="npc-job">${escapeHtml(opts.meta || '')}</span>
      <span class="npc-act">${escapeHtml(opts.state)}</span>
    `;
    item.addEventListener('click', () => {
      _insp = { id: opts.id, type: opts.type };
      _inspTick = 0;
      buildSoulsTab(game);
    });
    list.appendChild(item);
  };

  if (game.npcs.length) {
    addGroup('在镇', game.npcs.length);
    for (const n of game.npcs) {
      addRow({ id: n.id, type: 'npc', color: n.shirt, name: n.name, meta: `${n.sex} · ${n.body.ageYears}岁 · ${n.job || '白身'}`, state: n.inside ? '在家' : n.intent.label });
    }
  }
  if ((game.wanderers || []).length) {
    addGroup('在远方', game.wanderers.length);
    for (const w of game.wanderers) {
      const dir = dirWord(w.x - TOWN.x, w.y - TOWN.y);
      const dist = Math.round(Math.abs(w.x - TOWN.x) + Math.abs(w.y - TOWN.y));
      addRow({ id: w.id, type: 'wanderer', color: w.shirt, name: w.name, meta: `${w.sex} · ${w.body.ageYears}岁 · ${w.job || '白身'}`, state: `${dir}边 ${dist} 格 · ${wandererStateWord(w, game)}` });
    }
  }
  if ((game.dead || []).length) {
    addGroup('已逝', game.dead.length);
    for (const d of [...game.dead].reverse()) {
      addRow({ id: d.id, type: 'dead', color: '#5a5f6b', name: d.name, meta: `享年${d.age}`, state: `${d.cause} · 第${d.day}日` });
    }
  }
  if (c.missingList.length) {
    addGroup('下落不明', c.missingList.length);
    for (const r of [...c.missingList].reverse()) {
      addRow({ id: r.id, type: 'missing', color: '#3f4650', name: r.name, meta: `${r.age}岁离镇`, state: `第${r.day}日：${r.why || '去外面看看'}` });
    }
  }
  // 镇上的规矩（社会层·习俗）：谁立的、多少人守着
  if ((game.customs || []).length) {
    const sec = document.createElement('div');
    sec.className = 'gp-sec';
    sec.innerHTML = `<div class="gp-sec-title">镇上的规矩 · ${game.customs.length} 条</div>`
      + game.customs.slice(-8).map(cu =>
        `<div class="rel-line"><span>${escapeHtml(cu.name)}</span><span class="rv">${escapeHtml(cu.desc)}（${escapeHtml(cu.by)}立的 · ${cu.holders.length}人守）</span></div>`
      ).join('');
    body.appendChild(sec);
  }
  // 切回众生页时画像保持展开
  if (_insp) {
    const pools = { npc: game.npcs, wanderer: game.wanderers || [], dead: game.dead || [], missing: c.missingList };
    if ((pools[_insp.type] || []).some(v => v.id === _insp.id)) buildInspector(game, _insp.id, _insp.type);
    else _insp = null;
  }
}

function needBar(label, v, invert) {
  // invert: 值越高越糟（饥饿）
  const good = invert ? 100 - v : v;
  const cls = good > 60 ? 'ok' : good > 30 ? 'warn' : 'err';
  return `<div class="need-row"><span class="nl">${label}</span>
    <span class="need-bar"><i class="${cls}" style="width:${Math.round(v)}%"></i></span>
    <span class="nv">${Math.round(v)}</span></div>`;
}

// 画像实时刷新：世界每 0.5s 叫一次，画像展开时每 2s 跟着重绘（无展开不白跑）
function refreshInspector() {
  if (!_insp || currentTab !== 'souls') return;
  if (++_inspTick < 4) return;
  _inspTick = 0;
  const g = window.__game;
  if (g) buildInspector(g, _insp.id, _insp.type);
}

function buildInspector(game, id, type) {
  type = type || 'npc';
  if (type === 'dead') return buildDeadInspector(game, id);
  if (type === 'missing') return buildMissingInspector(game, id);
  const isWand = type === 'wanderer';
  const n = isWand ? (game.wanderers || []).find(v => v.id === id) : game.npcs.find(v => v.id === id);
  if (!n) { $('inspSec').style.display = 'none'; _insp = null; return; }
  $('inspSec').style.display = '';
  $('inspName').textContent = n.name + ' · ' + (n.job || '白身');
  const everyone = [...game.npcs, ...(game.wanderers || [])];
  const rels = Object.entries(n.relations).map(([rid, v]) => {
    const other = everyone.find(o => o.id === rid);
    const rel = n.rels && n.rels[rid];
    return { name: other ? other.name : rid, v, tags: rel ? rel.tags : [] };
  }).sort((a, b) => b.v - a.v);
  const relHtml = rels.map(r =>
    `<div class="rel-line"><span>${r.name}${r.tags.length ? `<i style="color:var(--text-faint)"> ·${r.tags.join('/')}</i>` : ''}</span><span class="rv ${r.v >= 30 ? 'good' : r.v <= -10 ? 'bad' : ''}">${r.v > 0 ? '+' : ''}${r.v}</span></div>`
  ).join('');
  // 心里没说出口的话与自以为的误会（社会层：单向存储，玩家在生灵册里也只能看这一份）
  const hidden = [];
  for (const rel of Object.values(n.rels || {})) {
    const other = everyone.find(o => o.id === rel.o);
    const nm = other ? other.name : rel.o;
    if (rel.unsaid) hidden.push(`对${nm}：${rel.unsaid}`);
    if (rel.meta) hidden.push(`对${nm}：${rel.meta.belief}`);
  }
  const hiddenHtml = hidden.length
    ? `<div class="gp-tip" style="margin-top:6px">没说出口的与自以为的——<br>${hidden.slice(0, 4).map(escapeHtml).join('<br>')}</div>`
    : '';
  const memHtml = n.memories.slice(-8).reverse().map(m =>
    `<div class="mem-line"><b>${m.d}日 ${m.t}</b> ${escapeHtml(m.text)}</div>`
  ).join('') || '<div class="gp-tip">还没有记忆。</div>';
  // 呈现层·因果链：每个决策必须可解释（理由字段是调试命脉）
  const chainHtml = (n.intentLog || []).slice(-8).reverse().map(it =>
    `<div class="mem-line"><b>${it.d}日 ${it.t}</b> ${escapeHtml(it.lb)}${it.rs ? `<br><i style="color:var(--text-faint)">← ${escapeHtml(it.rs)}${it.src === 'ai' ? '（居民之魂）' : ''}</i>` : ''}</div>`
  ).join('') || '<div class="gp-tip">还没有记下他的行止。</div>';
  const ail = (n.body.ailments || []).map(a =>
    `<span class="ail-tag" title="${escapeAttr(a.say || '旧伤未愈')}">${a.name}</span>`
  ).join('');
  const scars = (n.body.parts || []);
  const wearLines = Object.entries(scars).map(([p, s]) => {
    const cd = Math.round(s.cond);
    const cls = cd > 70 ? 'ok' : cd > 40 ? 'warn' : 'err';
    return `<div class="part-row"><span class="nl">${PART_NAME[p] || p}</span><span class="need-bar"><i class="${cls}" style="width:${cd}%"></i></span><span class="nv">${cd}</span></div>`;
  }).join('');
  const feelTxt = n.body.feel.cold > 60 ? '觉得冷' : n.body.feel.heat > 60 ? '觉得热' : '冷热适宜';
  const father = n.preg && n.preg.fatherId ? everyone.find(o => o.id === n.preg.fatherId) : null;
  const whereNow = isWand
    ? wandererStateWord(n, game) + `（出走 ${n.wand ? n.wand.daysOut : 0} 日）`
    : (n.inside ? '在家' : n.intent.label) + (n.inside ? '' : ' @ ' + n.currentArea(game.world));
  $('inspBody').innerHTML = `
    <div class="insp-block">
      <div class="insp-sub">${n.pers || ''}</div>
      <div class="gp-row" style="margin:0 0 6px"><button class="gbtn" id="inspLocate">定位到他</button></div>
      ${needBar('心情', n.needs.mood)}
      ${needBar('精力', n.needs.energy)}
      ${needBar('饱食', 100 - n.needs.hunger)}
      ${needBar('社交', 100 - n.needs.social)}
      ${needBar('欲望', n.needs.desire != null ? n.needs.desire : 0)}
      ${n.preg ? `<div class="gp-tip" style="margin:4px 0 0">身孕 ${game.clock.totalDay - n.preg.day0} 日${father ? '，孩他爹是' + father.name : ''}，约 ${Math.max(0, n.preg.due - game.clock.totalDay)} 日后生产</div>` : ''}
      <div class="gp-tip" style="margin:6px 0 0">当前：<b>${whereNow}</b></div>
      ${!isWand && n.intent.reason ? `<div class="gp-tip">因为：${escapeHtml(n.intent.reason)}</div>` : ''}
      ${!isWand ? `<div class="gp-tip">镇上说话的分量：${powerOf(n, game.npcs)}${n.origin ? ' · ' + n.origin : ''}</div>` : ''}
    </div>
    <div class="insp-block">
      <div class="gp-sec-title">身体 · ${bodySummary(n.body)}（${n.body.ageYears}岁 · ${stageOf(n.body.ageYears).name} · ${feelTxt}）</div>
      ${wearLines}
      ${ail ? `<div class="ail-list">${ail}</div>` : '<div class="gp-tip">无病无痛。</div>'}
    </div>
    <div class="insp-block"><div class="gp-sec-title">关系</div>${relHtml}${hiddenHtml}</div>
    <div class="insp-block"><div class="gp-sec-title">记忆</div>${memHtml}</div>
    <div class="insp-block"><div class="gp-sec-title">行止因果 · 做什么，为什么</div>${chainHtml}</div>
  `;
  $('inspLocate').addEventListener('click', () => locateAt(n.x, n.y));
}

// 逝者画像：生平卡——他来过，活过，留下了什么
function buildDeadInspector(game, id) {
  const d = (game.dead || []).find(v => v.id === id);
  if (!d) { $('inspSec').style.display = 'none'; _insp = null; return; }
  $('inspSec').style.display = '';
  $('inspName').textContent = d.name + ' · 已逝';
  const memHtml = (d.memories || []).slice(-8).reverse().map(m =>
    `<div class="mem-line"><b>${m.d}日 ${m.t}</b> ${escapeHtml(m.text)}</div>`
  ).join('') || '<div class="gp-tip">没留下什么话。</div>';
  $('inspBody').innerHTML = `
    <div class="insp-block">
      <div class="insp-sub">第${d.day}日，${escapeHtml(d.cause)}，享年${d.age}岁。</div>
      ${d.grave ? '<div class="gp-row" style="margin:6px 0 0"><button class="gbtn" id="inspLocate">去看坟</button></div>' : '<div class="gp-tip" style="margin-top:6px">连坟都没留下。</div>'}
    </div>
    <div class="insp-block"><div class="gp-sec-title">生前的记忆</div>${memHtml}</div>
  `;
  if (d.grave) $('inspLocate').addEventListener('click', () => locateAt(d.grave.x, d.grave.y));
}

// 下落不明者画像：离镇后再无音讯的人，只留下一页薄纸
function buildMissingInspector(game, id) {
  const r = (game.left || []).find(v => v.id === id);
  if (!r) { $('inspSec').style.display = 'none'; _insp = null; return; }
  $('inspSec').style.display = '';
  $('inspName').textContent = r.name + ' · 下落不明';
  $('inspBody').innerHTML = `
    <div class="insp-block">
      <div class="insp-sub">第${r.day}日离镇（${r.age}岁${r.job ? ' · ' + r.job : ''}）。</div>
      <div class="gp-tip" style="margin-top:6px">临走时说：${escapeHtml(r.why || '去外面看看')}。此后再无音讯。</div>
    </div>
  `;
}

// ---------- 镇史页（呈现层 v2.0.0，计划书第十章：编年史/传闻网/地形考古/关系演变/高光回放） ----------
const CHRON_KIND = { event: '事', birth: '生', death: '故', wed: '喜', leave: '走', build: '建', craft: '艺', disaster: '劫', custom: '俗', world: '界', evo: '化' };
let histSub = 'chron';
function buildHistoryTab(game) {
  const body = $('gpBody');
  body.innerHTML = `
    <div class="gp-sec">
      <div class="gp-sec-title">镇史 · 考古的工具</div>
      <div class="gp-grid3" id="histSubNav"></div>
      <div class="gp-tip" style="margin-top:6px">事后看懂的条件是至少两种痕迹能对上；错过的，就是错过了。</div>
    </div>
    <div id="histBody"></div>
  `;
  const subs = [['chron', '编年史'], ['rumor', '传闻网'], ['site', '地形考古'], ['rel', '关系演变'], ['hl', '高光回放']];
  const nav = $('histSubNav');
  for (const [id, label] of subs) {
    const b = document.createElement('button');
    b.className = 'gbtn' + (histSub === id ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      histSub = id;
      nav.querySelectorAll('.gbtn').forEach(x => x.classList.toggle('on', x === b));
      buildHistBody(game);
    });
    nav.appendChild(b);
  }
  buildHistBody(game);
}
function buildHistBody(game) {
  const box = $('histBody');
  if (histSub === 'chron') return buildChronView(game, box);
  if (histSub === 'rumor') return buildRumorView(game, box);
  if (histSub === 'site') return buildSiteView(game, box);
  if (histSub === 'rel') return buildRelHistView(game, box);
  if (histSub === 'hl') return buildHlView(game, box);
}
// —— 编年史：系统写骨架，NPC 写血肉 ——
function buildChronView(game, box) {
  const entries = (game.chron || []).slice().reverse();
  if (!entries.length) {
    box.innerHTML = '<div class="gp-sec"><div class="gp-tip">镇史还是白纸——日子过下去，骨架自己会长出来。</div></div>';
    return;
  }
  let html = '<div class="gp-sec"><div class="gp-sec-title">编年史 · 点一条看血肉</div><div id="chronList">';
  let lastY = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.y !== lastY) { lastY = e.y; html += `<div class="chron-year">第${e.y}年</div>`; }
    html += `<div class="chron-line" data-i="${i}"><span class="ck k-${e.k}">${CHRON_KIND[e.k] || '事'}</span><span class="cd">${e.d}日</span><span class="ct">${escapeHtml(e.t)}</span></div>`;
  }
  html += '</div></div><div class="gp-sec" id="chronDetail" style="display:none"></div>';
  box.innerHTML = html;
  $('chronList').addEventListener('click', (ev) => {
    const line = ev.target.closest('.chron-line');
    if (!line) return;
    const e = entries[+line.dataset.i];
    const flesh = fleshOf(game, e.d);
    const det = $('chronDetail');
    det.style.display = '';
    det.innerHTML = `<div class="gp-sec-title">第${e.d}日 · ${escapeHtml(e.t)}</div>`
      + (e.w ? `<div class="gp-tip">起因：${escapeHtml(e.w)}</div>` : '')
      + (flesh.length
        ? flesh.map(f => `<div class="mem-line"><b>${escapeHtml(f.who)}</b> ${escapeHtml(f.text)}</div>`).join('')
        : '<div class="gp-tip">这一天只剩下骨架——当时的人没把它记在心里，或者记着的人已经不在了。</div>');
  });
}
// —— 传闻网：闲话走过的每一条路；传三代，话走样 ——
function buildRumorView(game, box) {
  const nameOf = (id) => { const n = game.npcs.find(v => v.id === id); return n ? n.name : id; };
  const threads = rumorThreads(game, nameOf);
  if (!threads.length) {
    box.innerHTML = '<div class="gp-sec"><div class="gp-sec-title">传闻网</div><div class="gp-tip">镇上还没有传闻——闲话要有人先说漏嘴，才会自己长。</div></div>';
    return;
  }
  box.innerHTML = '<div class="gp-sec"><div class="gp-sec-title">传闻网 · 一句话走过的路</div>'
    + threads.slice(0, 10).map(th => `
      <div class="rumor-thread">
        <div class="rt-head">关于 <b>${escapeHtml(th.about)}</b> 的事（${th.hops.length}手）</div>
        ${th.hops.map(h => `<div class="rt-hop"><span class="rt-day">${h.d}日</span> ${escapeHtml(h.from)} → ${escapeHtml(h.to)}<i>（第${h.gen}手）</i><br><span class="rt-txt">「${escapeHtml(h.txt)}」</span></div>`).join('')}
      </div>`).join('')
    + '<div class="gp-tip">同一句话，传到我耳朵里已经不是原来那句——口述传三代变形。</div></div>';
}
// —— 地形考古：物理痕迹几百年；年代不可考的，就是不考 ——
const MARK_KIND = { built: '建', ruin: '墟', grave: '坟' };
function buildSiteView(game, box) {
  const marks = game.marks ? [...game.marks.entries()] : [];
  if (!marks.length) {
    box.innerHTML = '<div class="gp-sec"><div class="gp-sec-title">地形考古</div><div class="gp-tip">还没有可考的遗迹。</div></div>';
    return;
  }
  const rows = marks.map(([key, m]) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, ...m, age: markAge(game, m) };
  }).sort((a, b) => b.d - a.d);
  box.innerHTML = '<div class="gp-sec"><div class="gp-sec-title">地形考古 · 点一处去看</div>'
    + rows.slice(0, 30).map((m, i) => `
      <div class="site-line" data-i="${i}">
        <span class="ck sk-${m.k}">${MARK_KIND[m.k] || '迹'}</span>
        <span class="ct">${escapeHtml(m.name)}（${m.x},${m.y}）${m.by ? ' · ' + escapeHtml(m.by) : ''}</span>
        <span class="rv">第${m.d}日 · ${m.age === 0 ? '就在今天' : '已' + m.age + '日'}</span>
      </div>`).join('')
    + '<div class="gp-tip">坟茔、废墟、老屋——世界的历史不是写在文本里的，是刻在地形里的。</div></div>';
  box.querySelector('.gp-sec').addEventListener('click', (ev) => {
    const line = ev.target.closest('.site-line');
    if (!line) return;
    const m = rows[+line.dataset.i];
    jumpCam(m.x, m.y);
    toast(`去看${m.name}`, 'ok');
  });
}
// —— 关系演变：每段关系有自己的历史；曲线上的坎都记得 ——
let relSelA = null, relSelB = null;
function buildRelHistView(game, box) {
  if (!game.npcs.length) { box.innerHTML = ''; return; }
  if (!relSelA || !game.npcs.find(n => n.id === relSelA)) relSelA = game.npcs[0].id;
  box.innerHTML = `
    <div class="gp-sec">
      <div class="gp-sec-title">关系演变 · 谁对谁的这一路</div>
      <div class="set-row"><label>谁</label><select id="relA" style="flex:1"></select></div>
      <div class="set-row"><label>对谁</label><select id="relB" style="flex:1"></select></div>
      <canvas id="relCanvas" width="264" height="130" style="width:100%;image-rendering:pixelated;background:rgba(0,0,0,.18);border-radius:4px"></canvas>
      <div id="relLegend"></div>
    </div>`;
  const selA = $('relA'), selB = $('relB');
  for (const n of game.npcs) {
    const o = document.createElement('option'); o.value = n.id; o.textContent = n.name; selA.appendChild(o);
  }
  selA.value = relSelA;
  function fillB() {
    selB.innerHTML = '';
    const a = game.npcs.find(n => n.id === selA.value);
    const others = game.npcs.filter(n => n.id !== selA.value);
    for (const n of others) {
      const o = document.createElement('option'); o.value = n.id; o.textContent = n.name; selB.appendChild(o);
    }
    const known = a && a.rels ? others.filter(n => a.rels[n.id]) : [];
    if (relSelB && others.some(n => n.id === relSelB)) selB.value = relSelB;
    else if (known.length) selB.value = known[0].id;
    relSelB = selB.value;
    drawRelCurve(game, selA.value, selB.value);
  }
  selA.addEventListener('change', () => { relSelA = selA.value; fillB(); });
  selB.addEventListener('change', () => { relSelB = selB.value; drawRelCurve(game, selA.value, selB.value); });
  fillB();
}
function drawRelCurve(game, aId, bId) {
  const cv = $('relCanvas');
  const ctx = cv.getContext('2d');
  const a = game.npcs.find(n => n.id === aId), b = game.npcs.find(n => n.id === bId);
  const rel = a && a.rels ? a.rels[bId] : null;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const legend = $('relLegend');
  if (!a || !b) { legend.innerHTML = ''; return; }
  const hist = rel && rel.hist ? rel.hist : [];
  if (hist.length < 2) {
    legend.innerHTML = `<div class="gp-tip">${a.name}对${b.name}的这段关系还没攒下历史——演变要日子来堆。</div>`;
    return;
  }
  const X = (i) => 12 + i * (cv.width - 24) / Math.max(1, hist.length - 1);
  const Y = (v) => cv.height / 2 - (v / 100) * (cv.height / 2 - 14);
  // 零线
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.beginPath(); ctx.moveTo(8, Y(0)); ctx.lineTo(cv.width - 8, Y(0)); ctx.stroke();
  const lines = [['c', '#8fbc5a', '亲密'], ['t', '#6ba3e0', '信任'], ['g', '#e06a5a', '怨恨']];
  for (const [k, color, label] of lines) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.6;
    ctx.beginPath();
    hist.forEach((h, i) => { const x = X(i), y = Y(h[k]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  // 转折记号：曲线上的坎
  if (rel.mark && rel.mark.length) {
    ctx.fillStyle = '#e8d264';
    for (const mk of rel.mark) {
      const i = hist.findIndex(h => h.d >= mk.d);
      if (i < 0) continue;
      ctx.beginPath(); ctx.arc(X(i), cv.height - 8, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    legend.innerHTML = `<div class="gp-tip">黄点：${rel.mark.map(m => `第${m.d}日${escapeHtml(m.w)}`).join('；')}。</div>`;
  } else legend.innerHTML = '';
  const last = hist[hist.length - 1];
  legend.innerHTML = `<div class="gp-tip">绿=亲密 ${last.c} ｜ 蓝=信任 ${last.t} ｜ 红=怨恨 ${last.g}${legend.innerHTML ? '<br>' + legend.innerHTML : ''}</div>`;
}
// —— 高光回放：只能看你当时在看的视角 ——
function buildHlView(game, box) {
  const hls = (game.highlights || []).slice().reverse();
  if (!hls.length) {
    box.innerHTML = '<div class="gp-sec"><div class="gp-sec-title">高光回放</div><div class="gp-tip">还没有高光时刻被记下来。</div></div>';
    return;
  }
  box.innerHTML = '<div class="gp-sec"><div class="gp-sec-title">高光回放 · 点一帧回到当时</div>'
    + hls.slice(0, 20).map((h, i) => `
      <div class="hl-line" data-i="${i}">
        <span class="cd">${h.d}日 ${h.t}</span>
        <span class="ct">${escapeHtml(h.text)}</span>
        <span class="rv">视野里${h.actors.length}人</span>
      </div>`).join('')
    + '<div class="gp-tip">玩家没有上帝视角的回放——镜头没对着的，就是错过了。</div></div>';
  box.querySelector('.gp-sec').addEventListener('click', (ev) => {
    const line = ev.target.closest('.hl-line');
    if (!line) return;
    openReplay(game, hls[+line.dataset.i]);
  });
}
const GROUND_RGB = { 0: '#4e6e38', 1: '#6e5238', 2: '#8a7a52', 3: '#7a7a7a', 4: '#3a5e88', 5: '#b3a06b', 6: '#5e4028', 7: '#7a5f42' };
function openReplay(game, h) {
  let modal = $('replayModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'replayModal';
    modal.className = 'modal hidden';
    modal.innerHTML = `<div class="modal-card"><div class="modal-head" id="replayHead"></div>
      <div class="modal-body" style="text-align:center"><canvas id="replayCanvas" width="480" height="320" style="max-width:100%;image-rendering:pixelated;border-radius:4px"></canvas>
      <div class="gp-tip" id="replayFoot" style="margin-top:8px"></div></div>
      <div class="modal-foot"><button class="btn primary" id="replayClose">合上这一页</button></div></div>`;
    document.body.appendChild(modal);
    $('replayClose').addEventListener('click', () => modal.classList.add('hidden'));
  }
  modal.classList.remove('hidden');
  $('replayHead').textContent = `第${h.d}日 ${h.t} · ${h.text}`;
  $('replayFoot').textContent = `这是你当时看着的视角（视野里${h.actors.length}人）。错过的，就是错过了。`;
  const cv = $('replayCanvas');
  const ctx = cv.getContext('2d');
  const sx = cv.width / h.vw, sy = cv.height / h.vh;
  // 当时的地：按现在的地形画个大概——地在，戏是人演的
  for (let ty = 0; ty < h.vh; ty++) {
    for (let tx = 0; tx < h.vw; tx++) {
      const wx = Math.floor(h.cam.x) + tx, wy = Math.floor(h.cam.y) + ty;
      if (wx < 0 || wy < 0 || wx >= 72 || wy >= 72) continue;
      const gi = wy * 72 + wx;
      ctx.fillStyle = GROUND_RGB[game.world.ground[gi]] || '#4e6e38';
      ctx.fillRect(tx * sx, ty * sy, sx + 0.5, sy + 0.5);
      const o = game.world.obj[gi];
      if (o === O.TREE) { ctx.fillStyle = '#2e4a22'; ctx.beginPath(); ctx.arc(tx * sx + sx / 2, ty * sy + sy / 2, sx * 0.32, 0, Math.PI * 2); ctx.fill(); }
      else if (o === O.GRAVE || o === O.RUIN) { ctx.fillStyle = o === O.GRAVE ? '#9a9a8a' : '#4a4038'; ctx.fillRect(tx * sx + sx * 0.25, ty * sy + sy * 0.2, sx * 0.5, sy * 0.6); }
      else if (o === O.WALL || o === O.SHED || o === O.BARN || o === O.WORKSHOP || o === O.CABIN) { ctx.fillStyle = '#6b4a30'; ctx.fillRect(tx * sx + 1, ty * sy + 1, sx - 2, sy - 2); }
    }
  }
  // 当时的天色与天气（第七层是情绪的来源）
  const night = h.hour < 5.5 || h.hour > 19.5;
  const dusk = !night && (h.hour < 7 || h.hour > 17.5);
  ctx.fillStyle = night ? 'rgba(10,14,40,.45)' : dusk ? 'rgba(120,70,20,.18)' : 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (h.wx === 'rain' || h.wx === 'storm') { ctx.fillStyle = 'rgba(40,60,90,.25)'; ctx.fillRect(0, 0, cv.width, cv.height); }
  if (h.wx === 'snow') { ctx.fillStyle = 'rgba(220,230,240,.22)'; ctx.fillRect(0, 0, cv.width, cv.height); }
  // 当时的人：谁在视野里、在做什么——只有他们被记下来
  for (const a of h.actors) {
    const px = (a.x - h.cam.x) * sx, py = (a.y - h.cam.y) * sy;
    if (px < 0 || py < 0 || px > cv.width || py > cv.height) continue;
    ctx.fillStyle = a.shirt || '#c8b060';
    ctx.beginPath(); ctx.arc(px, py, Math.max(3, sx * 0.3), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(a.nm, px, py - 6);
    if (a.lb) { ctx.fillStyle = 'rgba(230,220,180,.85)'; ctx.fillText(a.lb, px, py + 14); }
  }
  // 回忆的暗角
  const vg = ctx.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.35, cv.width / 2, cv.height / 2, cv.height * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, cv.width, cv.height);
}

// ---------- 演化页（v4.8.0：类型管道退役，只剩观念池与演化日志） ----------
const EVO_ACTION_NAME = { '入池': '念', '降级': '降', '丢弃': '弃', '灰度': '试', '修正': '修', '固化': '成', '回滚': '毁' };
function buildEvolveTab(game) {
  const body = $('gpBody');
  const log = (game.evoLog || []).slice().reverse();
  body.innerHTML = `
    <div class="gp-sec">
      <div class="gp-sec-title">观念池 · 镇上活着的念头（${(game.ideas || []).filter(i => i.status !== 'dead').length}）</div>
      <div id="ideaList"></div>
    </div>
    <div class="gp-sec">
      <div class="gp-sec-title">演化日志 · 长出了什么、为什么</div>
      <div id="evoLogList"></div>
    </div>
  `;
  // 观念池：镇上活着的念头（v4.7.0 真正的演化）
  const ideas = (game.ideas || []).filter(i => i.status !== 'dead');
  $('ideaList').innerHTML = ideas.length
    ? ideas.slice().reverse().slice(0, 20).map(i => {
      const holders = i.holders.length;
      const statusMark = { wild: '野', spreading: '传', crystallized: '成' }[i.status] || '死';
      const fitPct = Math.round((i.fitness || 0) * 100);
      return `<div class="chron-line"><span class="ck k-idea">${statusMark}</span><span class="ct">${escapeHtml(i.text)}<i style="opacity:.6">（${holders}人信·适应${fitPct}%${i.mutatedFrom ? '·变' : ''}）</i></span></div>`;
    }).join('')
    : '<div class="gp-tip">观念池空着——居民心里还没长出念头。</div>';
  // 演化日志：结晶/旧档余温都落在这里
  if (!log.length) {
    $('evoLogList').innerHTML = '<div class="gp-tip">演化日志还是白纸——日子过下去，新东西自己会冒出来。</div>';
    return;
  }
  $('evoLogList').innerHTML = log.slice(0, 40).map((e) =>
    `<div class="chron-line"><span class="ck k-evo">${EVO_ACTION_NAME[e.action] || '事'}</span><span class="cd">${e.day}日</span><span class="ct">${escapeHtml(e.what)}<i style="opacity:.6">（${escapeHtml(e.outcome || '')}）</i></span></div>`
  ).join('');
}

function jumpCam(x, y) {
  const r = window.__renderer;
  if (!r || !r.canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = r.canvas.getBoundingClientRect();
  const vw = rect.width * dpr / (16 * r.cam.zoom);
  const vh = rect.height * dpr / (16 * r.cam.zoom);
  r.cam.x = Math.max(-4, Math.min(72 - vw + 4, x - vw / 2));
  r.cam.y = Math.max(-4, Math.min(72 - vh + 4, y - vh / 2));
}

// ---------- 设置弹窗（锁定式） ----------
// 池端点序列化：providers → textarea 文本（每行 `地址|密钥|模型1,模型2`）
function poolText(c) {
  return ((c.npcPool && c.npcPool.providers) || [])
    .map(p => `${p.baseUrl}|${p.apiKey || ''}|${(p.models || []).join(',')}`)
    .join('\n');
}
// textarea 文本 → providers（坏行跳过）
function poolProviders(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split('|').map(s => s.trim());
    if (parts.length < 3 || !parts[0] || !parts[2]) continue;
    const models = parts[2].split(/[，,]/).map(s => s.trim()).filter(Boolean);
    if (!models.length) continue;
    out.push({ baseUrl: parts[0], apiKey: parts[1] || '', models });
  }
  return out;
}
// textarea 文本 → backup 列表（每行 `地址|密钥|模型`，坏行跳过）
function evoBackup(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split('|').map(s => s.trim());
    if (parts.length < 3 || !parts[0] || !parts[2]) continue;
    out.push({ baseUrl: parts[0], apiKey: parts[1] || '', model: parts[2] });
  }
  return out;
}
function openSettings(game) {
  const c = game.aiCfg;
  $('settingsBody').innerHTML = `
    <div class="set-sec">
      <div class="set-sec-title">居民大脑 · OpenAI 兼容接口</div>
      <div class="set-row">
        <label>驱动模式</label>
        <select id="setMode">
          <option value="auto">自动（有API用AI，否则脚本）</option>
          <option value="llm">强制 AI</option>
          <option value="script">纯脚本（离线）</option>
        </select>
      </div>
      <div class="set-row">
        <label>接口地址</label>
        <input type="text" id="setBase" value="${escapeAttr(c.baseUrl)}" placeholder="https://api.siliconflow.cn/v1" />
      </div>
      <div class="set-row">
        <label>API Key</label>
        <input type="password" id="setKey" value="${escapeAttr(c.apiKey)}" placeholder="sk-..." />
      </div>
      <div class="set-row">
        <label>模型</label>
        <input type="text" id="setModel" value="${escapeAttr(c.model)}" placeholder="Qwen/Qwen2.5-7B-Instruct" />
      </div>
      <div class="set-row">
        <label></label>
        <button class="btn set-test" id="setTest">测试连通</button>
        <span id="setTestOut" class="gp-tip" style="margin:0"></span>
      </div>
      <div class="set-row">
        <label>决策间隔（人均）</label>
        <input type="range" id="setInterval" min="1" max="6" value="${c.intervalH}" />
        <span class="val" id="setIntervalVal">${c.intervalH}小时</span>
      </div>
      <div class="set-tip">任意 OpenAI 兼容中转/网关均可。居民各活各的：谁手头的事干完、谁的间隔到了，才单独问一次 AI（同刻到期的人顺路凑一批，时刻彼此错开）；应答慢了或解析失败，本能脚本自动顶上，不影响运行。</div>
    </div>
    <div class="set-sec">
      <div class="set-sec-title">NPC 模型池 · 不同居民不同模型</div>
      <div class="set-row">
        <label>启用模型池</label>
        <input type="checkbox" id="setPoolOn" ${c.npcPool && c.npcPool.enabled ? 'checked' : ''} />
        <span class="gp-tip">开启后按性格分配模型（byPersonality），不同居民由不同模型驱动，声音自然分化</span>
      </div>
      <div class="set-row">
        <label>池端点</label>
        <textarea id="setPool" rows="4" placeholder="每行一条：接口地址|APIKey|模型1,模型2&#10;例：http://localhost:8787/v1|sk-xxx|gemini-2.5-flash,qwen3-32b">${escapeAttr(poolText(c))}</textarea>
      </div>
      <div class="set-tip">聚合网关（FreeLLMAPI / freellm 等）填一条即可覆盖全部免费模型；多家直连就填多行。单行 Key 可留空（零认证网关）。格式：地址|密钥|模型1,模型2</div>
    </div>
    <div class="set-sec">
      <div class="set-sec-title">演化引擎 · 独占的脑（不与居民共享）</div>
      <div class="set-row">
        <label>启用独占</label>
        <input type="checkbox" id="setEvoOn" ${c.evolutionModel && c.evolutionModel.enabled ? 'checked' : ''} />
        <span class="gp-tip">世界演化提案用能力最强的模型（如 gemini-2.5-flash），低频调用不抢居民额度</span>
      </div>
      <div class="set-row">
        <label>接口地址</label>
        <input type="text" id="setEvoBase" value="${escapeAttr(c.evolutionModel && c.evolutionModel.baseUrl || '')}" placeholder="https://generativelanguage.googleapis.com/v1beta/openai" />
      </div>
      <div class="set-row">
        <label>API Key</label>
        <input type="password" id="setEvoKey" value="${escapeAttr(c.evolutionModel && c.evolutionModel.apiKey || '')}" placeholder="免费层 Key" />
      </div>
      <div class="set-row">
        <label>模型</label>
        <input type="text" id="setEvoModel" value="${escapeAttr(c.evolutionModel && c.evolutionModel.model || '')}" placeholder="gemini-2.5-flash" />
      </div>
      <div class="set-row">
        <label>备援</label>
        <textarea id="setEvoBackup" rows="2" placeholder="每行一条：地址|密钥|模型（如智谱 glm-4.7-flash / Cerebras qwen3-235b）">${escapeAttr((c.evolutionModel && c.evolutionModel.backup || []).map(b => `${b.baseUrl}|${b.apiKey || ''}|${b.model}`).join('\n'))}</textarea>
      </div>
    </div>
    <div class="set-sec">
      <div class="set-sec-title">本地兜底（全部端点挂掉时）</div>
      <div class="set-row">
        <label>Ollama 地址</label>
        <input type="text" id="setLocalBase" value="${escapeAttr(c.localFallback && c.localFallback.baseUrl || '')}" placeholder="http://localhost:11434/v1" />
      </div>
      <div class="set-row">
        <label>本地模型</label>
        <input type="text" id="setLocalModel" value="${escapeAttr(c.localFallback && c.localFallback.model || '')}" placeholder="qwen3.8:27b" />
      </div>
      <div class="set-tip">故障链：池端点 → 池内其他模型 → 本地 Ollama → 脚本本能。游戏永不因 API 问题卡死。</div>
    </div>
    <div class="set-sec">
      <div class="set-sec-title">显示</div>
      <div class="set-row">
        <label>渲染风格</label>
        <select id="setRender">
          <option value="smooth">平滑（抗锯齿，无像素块）</option>
          <option value="pixel">像素（硬边，复古风）</option>
        </select>
      </div>
      <div class="set-tip">平滑模式下贴图边缘做双线性过滤，画面更细腻；像素模式保持 16×16 硬边复古感。</div>
    </div>
    <div class="set-sec" id="setDataDirSec">
      <div class="set-sec-title">数据存储</div>
      <div class="set-row">
        <label>存储位置</label>
        <span id="setDataDirPath" style="flex:1;font-size:12px;color:var(--text-dim);word-break:break-all">查询中…</span>
        <button class="btn" id="setDataDirBtn">更改…</button>
      </div>
      <div class="set-tip">世界快照自动保存在此目录。更改后现有存档会迁移到新位置。</div>
    </div>
    <div class="set-sec">
      <div class="set-sec-title">世界</div>
      <div class="set-row">
        <label>导入世界</label>
        <button class="btn" id="setImport">从文件导入…</button>
      </div>
      <div class="set-tip">导入会替换当前世界，用于从其他设备迁移。当前世界将被覆盖，不可恢复。</div>
      <div class="set-row">
        <label>放弃世界</label>
        <button class="btn btn-danger" id="setClear">放弃这个世界，另起一个</button>
      </div>
      <div class="set-tip">当前世界将永远消失，不能再回来。新世界从第一天开始，与旧世界没有任何关系。</div>
    </div>
  `;
  $('setMode').value = c.mode;
  $('setRender').value = (game.display && game.display.renderStyle) || 'smooth';
  $('setInterval').addEventListener('input', (e) => {
    $('setIntervalVal').textContent = e.target.value + '小时';
  });
  $('setTest').addEventListener('click', async () => {
    const out = $('setTestOut');
    out.textContent = '测试中…';
    out.style.color = 'var(--text-dim)';
    try {
      const { callLLM } = await import('./ai.js');
      const t0 = performance.now();
      const r = await callLLM({
        baseUrl: $('setBase').value.trim(), apiKey: $('setKey').value.trim(),
        model: $('setModel').value.trim(), timeoutSec: 30, temperature: 0.3, maxTokens: 30
      }, '你是连通性测试。', '只回复两个字：正常');
      out.textContent = `正常（${Math.round(performance.now() - t0)}ms）：${String(r).slice(0, 12)}`;
      out.style.color = 'var(--ok)';
    } catch (e) {
      out.textContent = '失败：' + String(e && e.message).slice(0, 80);
      out.style.color = 'var(--err)';
    }
  });
  // 数据存储路径：查询 + 更改
  (async () => {
    if (!window.gdIO || !window.gdIO.getDataDir) {
      const sec = $('setDataDirSec');
      if (sec) sec.style.display = 'none';
      return;
    }
    try {
      const dir = await window.gdIO.getDataDir();
      $('setDataDirPath').textContent = dir;
      const portable = await window.gdIO.isPortable();
      if (portable) {
        $('setDataDirBtn').style.display = 'none';
        $('setDataDirPath').textContent = dir + '（便携版）';
      }
    } catch { $('setDataDirPath').textContent = '查询失败'; }
  })();
  $('setDataDirBtn').addEventListener('click', async () => {
    if (!window.gdIO || !window.gdIO.chooseDataDir) return;
    const r = await window.gdIO.chooseDataDir();
    if (r && r.ok) {
      $('setDataDirPath').textContent = r.dir;
      toast('数据存储位置已更改，存档已迁移', 'ok');
    }
  });
  $('setImport').addEventListener('click', async () => {
    if (!window.gdIO) { toast('便携版不支持文件导入', 'err'); return; }
    const r = await window.gdIO.loadFile();
    if (!r || !r.ok) return;
    if (!confirm('导入将替换当前世界，当前世界将被覆盖且不可恢复。确定要继续吗？')) return;
    try {
      const data = JSON.parse(r.text);
      const g = Game.hydrate(data, window.__renderer);
      g.saveLocal();   // 导入后立即落盘，确保连续性
      swapGame(game, g, window.__renderer);
      closeSettings();
      toast('世界迁移完成', 'ok');
    } catch (e) {
      toast('导入失败：' + e.message, 'err');
    }
  });
  $('setClear').addEventListener('click', () => {
    if (!confirm('这个世界将永远消失，不能再回来。确定吗？')) return;
    Game.clearLocal();
    const renderer = window.__renderer;
    const g = new Game(renderer);
    g.aiCfg = game.aiCfg;
    g.newGame();
    swapGame(game, g, renderer);
    closeSettings();
    toast('旧世界已消逝，新世界开始了', 'ok');
  });
  $('settingsModal').classList.remove('hidden');
}
function closeSettings() { $('settingsModal').classList.add('hidden'); }
function bindSettings(game) {
  $('settingsCancel').addEventListener('click', closeSettings);
  $('settingsSave').addEventListener('click', () => {
    const g = window.__game;
    g.aiCfg.mode = $('setMode').value;
    g.aiCfg.baseUrl = $('setBase').value.trim();
    g.aiCfg.apiKey = $('setKey').value.trim();
    g.aiCfg.model = $('setModel').value.trim();
    g.aiCfg.intervalH = +$('setInterval').value;
    // 模型池（v2.6.0）
    g.aiCfg.npcPool = {
      ...(g.aiCfg.npcPool || {}),
      enabled: $('setPoolOn').checked,
      strategy: 'byPersonality',
      providers: poolProviders($('setPool').value)
    };
    g.aiCfg.evolutionModel = {
      ...(g.aiCfg.evolutionModel || {}),
      enabled: $('setEvoOn').checked,
      baseUrl: $('setEvoBase').value.trim(),
      apiKey: $('setEvoKey').value.trim(),
      model: $('setEvoModel').value.trim(),
      backup: evoBackup($('setEvoBackup').value)
    };
    g.aiCfg.localFallback = {
      baseUrl: $('setLocalBase').value.trim() || 'http://localhost:11434/v1',
      model: $('setLocalModel').value.trim() || 'qwen3.8:27b'
    };
    g.display.renderStyle = $('setRender').value;
    window.__renderer.setRenderStyle(g.display.renderStyle);
    g.saveLocal();
    closeSettings();
    toast('设置已保存', 'ok');
    switchTab(currentTab);
  });
}

// ---------- 日志 ----------
function appendLog(line) {
  const box = $('logBox');
  const div = document.createElement('div');
  div.className = 'log-line' + (line.cls ? ' ' + line.cls : '');
  div.innerHTML = `<span class="lt">${line.day}日 ${line.t}</span>${escapeHtml(line.text)}`;
  box.appendChild(div);
  while (box.children.length > 200) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

// ---------- toast ----------
function toastWrapInit() {
  if (!$('toastWrap')) {
    const w = document.createElement('div');
    w.id = 'toastWrap';
    document.body.appendChild(w);
  }
}
export function toast(text, cls) {
  const w = $('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast' + (cls ? ' ' + cls : '');
  t.textContent = text;
  w.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- 工具 ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escapeAttr(s) { return escapeHtml(s); }
