// lexicon.js - 语言层·词库（v3.1.0 语言革命，计划书第八章）：话位是物理，词条是演化设定
// 两层拆分（同过程革命）：
//   物理（允许硬编码）：LEX_SLOTS 话位名册（人会问候/否认/质问/哭丧/取名——这是人性）、
//     语法机制（方言替换/口头禅装饰/{n} 填槽/漂移变形）、校验器（词条形状）、CONFLICT_KEYS（矛盾的种类）。
//   内容（演化设定）：game.lexicon——随档走、可增（演化提案 lex）、可减（超帽退役）、会漂移（每日变异）。
// 种子词表是初始条件（同 ROSTER 种子居民同级）：世界 bootstrap 必须有词可说话（铁律：无 LLM 也必须能玩），
// 但它不是机制——机制不依赖任何一个具体的词；每个世界从同一张种子表出发，说出各自不同的话。
import { choice, chance } from './core.js';

// ---------- 话位名册（物理）：形状与容量；cap 是有限定理——旧词会死，语言才活 ----------
// shape: phrase 整句(≤20字) / word 单词(≤6字) / pair 对子([a,b]各≤6) / group 词组(≤3词各≤4) / ab 心结对 / secret 心事
export const LEX_SLOTS = {
  chatTopic:   { cap: 12, shape: 'phrase', name: '闲聊话题' },
  childTopic:  { cap: 10, shape: 'phrase', name: '孩子话题' },
  childIdle:   { cap: 8,  shape: 'phrase', name: '孩子玩闹喊话' },
  quarrelA:    { cap: 8,  shape: 'phrase', name: '吵架质问' },
  quarrelB:    { cap: 8,  shape: 'phrase', name: '吵架回嘴' },
  reconcile:   { cap: 6,  shape: 'phrase', name: '和解的话' },
  mediate:     { cap: 6,  shape: 'phrase', name: '评理的话' },
  deny:        { cap: 6,  shape: 'phrase', name: '脱口抵赖' },
  slyHint:     { cap: 4,  shape: 'phrase', name: '话里带话' },
  tabooRetort: { cap: 4,  shape: 'phrase', name: '被戳禁忌的回敬' },
  lament:      { cap: 6,  shape: 'phrase', name: '哭丧' },
  confused:    { cap: 6,  shape: 'phrase', name: '老人迷糊话' },
  nursery:     { cap: 5,  shape: 'phrase', name: '童谣' },
  story:       { cap: 5,  shape: 'phrase', name: '说书开场' },
  weddingSong: { cap: 6,  shape: 'phrase', name: '喜歌' },
  shared:      { cap: 8,  shape: 'phrase', name: '共同记忆' },
  unsaid:      { cap: 6,  shape: 'phrase', name: '未说出口的话' },   // 含 {n} 填槽
  misread:     { cap: 8,  shape: 'phrase', name: '自以为的误解' },   // 含 {n} 填槽
  motto:       { cap: 8,  shape: 'phrase', name: '过日子的话' },
  persChild:   { cap: 8,  shape: 'phrase', name: '孩子心性' },
  persOut:     { cap: 8,  shape: 'phrase', name: '外来人来历' },
  catch:       { cap: 14, shape: 'word', name: '口头禅' },
  customTheme: { cap: 8,  shape: 'word', name: '规矩题眼' },
  eventTheme:  { cap: 8,  shape: 'word', name: '事题眼' },
  roleName:    { cap: 8,  shape: 'word', name: '角色称呼' },
  dutyWord:    { cap: 10, shape: 'word', name: '差事名目' },
  nameGiven:   { cap: 24, shape: 'word', name: '孩子名' },
  outSur:      { cap: 12, shape: 'word', name: '客籍姓' },
  outGiven:    { cap: 12, shape: 'word', name: '客籍名' },
  petDog:      { cap: 8,  shape: 'word', name: '狗名' },
  petCat:      { cap: 8,  shape: 'word', name: '猫名' },
  dialect:     { cap: 18, shape: 'pair', name: '方言对' },
  swap:        { cap: 18, shape: 'pair', name: '传话换词对' },
  taboo:       { cap: 12, shape: 'group', name: '禁忌词' },
  conflict:    { cap: 10, shape: 'ab', name: '心结' },
  secretGen:   { cap: 8,  shape: 'secret', name: '常见心事' }
};
// 矛盾的种类是物理（六种撕扯；pushScore 挂钩 leave）；具体措辞是内容（槽 conflict）
export const CONFLICT_KEYS = ['leave', 'please', 'guilt', 'novelty', 'confess', 'duty'];

// ---------- 种子词表（初始条件，不是机制）：由原散落八个文件的硬编码台词池归拢分解而来 ----------
export const SEED_LEXICON = {
  chatTopic: ['今天天气不错', '收成怎么样', '听说了吗，镇上又出新鲜事了', '改天来家吃饭啊',
    '河水涨了不少', '山上矿脉越挖越深了', '你家娃念书念得咋样', '赶明儿集市怕是要热闹',
    '听说粮行又开始催账了', '昨晚那雨下得真大'],
  childTopic: ['我们数到一百就轮到你抓！', '昨天我在河边看见白鹭了', '先生今天教了新字，你认识吗',
    '你敢爬那棵老树吗', '长大我要当樵夫，砍最大的树', '我娘做的饼最好吃',
    '河边有个洞，里面肯定住着螃蟹', '你别告诉我娘我把鞋弄丢了'],
  childIdle: ['抓住你啦！', '数到十就不许动了！', '看我捡的这块石头，像不像狗子', '嘘——我在躲猫猫', '这个给你，别还了'],
  quarrelA: ['你这话什么意思？', '这话你再说一遍？', '行，是我多事了', '你心里清楚你做过什么'],
  quarrelB: ['我又没说你什么', '有意思吗你', '跟你说不明白', '你少血口喷人'],
  reconcile: ['过去的事……翻篇吧', '那阵子是我话重了', '都老交情了，别搁在心里'],
  mediate: ['都是抬头不见低头见的，这页翻过去吧', '一个镇上的，撕破脸不好看', '这事儿我说句公道话：各退一步', '有话好好说，犯不着这样'],
  deny: ['哪有的事', '你可别瞎说', '这我不知道啊', '没那么回事'],
  slyHint: ['……嗯，谁知道呢', '……这话我可没说过'],
  tabooRetort: ['……这话别再提了', '……换个话题吧'],
  lament: ['你怎么就这么走了啊——', '你放心走好——', '往后这镇上，再没人这么唤我了', '我还有话没跟你说啊——'],
  confused: ['今天是初几来着？', '我那老花镜搁哪儿了……', '刚才想说什么来着？', '这腿脚啊，是一天不如一天了'],
  nursery: ['月亮走，我也走，我跟月亮打烧酒', '小板凳，摆一排，娃们坐下听故事来', '一二三，翻过山，山里有头老黄牛'],
  story: ['要说咱镇子的来历，得从老辈人挑担进山那会儿说起……', '话说那口老井，底下压着前朝的半截碑……', '老辈人讲，山神爷每年腊月要下山巡一回……'],
  weddingSong: ['一撒金，二撒银，撒进堂屋有喜临门', '喜洋洋，笑洋洋，今夜堂前烛火长', '新人对拜天地全，来年抱个胖娃娃', '红烛一点亮堂堂，两家并作一家忙'],
  shared: ['那年发大水，我们俩一起堵过半宿的沙袋', '一起在山神庙里躲过一场冰雹', '他家的灶塌了那回，是我帮着搭的',
    '小时候一起在河滩上摸过鱼', '那年秋收累倒了，是他把我背回来的'],
  unsaid: ['有句谢谢，一直没跟{n}说出口', '想问{n}当年为什么离开老家，可每次话到嘴边又咽了回去',
    '想跟{n}道个歉，可总觉得张不开口', '其实挺想跟{n}说：那件事我从来没怪过你'],
  misread: ['我一直拿{n}当亲兄弟看', '总觉得{n}待我跟别人不一样', '我以为{n}早就不记恨那件事了',
    '明知道{n}靠不住，可心里还是拿他当自己人', '我当{n}是过命的交情，他大概只当我是熟人'],
  motto: ['日子总要过下去', '人这一辈子，图个心安', '镇子再小，也是家', '熬过去就好了'],
  persChild: ['天不怕地不怕，就怕大人板起脸', '总觉得镇子外面的世界更大', '跟着谁学谁，学得飞快',
    '有大把的问题，没有大把的答案', '把自己的名字写得歪歪扭扭，但很得意'],
  persOut: ['从北边过来的，听说镇上日子好过', '一路帮工走到这儿，想寻个落脚处',
    '早年逃荒离了老家，在外头走了好些年', '听货郎说这镇上人心厚道，特地来看看'],
  catch: ['哎哟喂', '嗐', '可不咋地', '成', '得嘞', '我跟你说', '回头想想', '罢了罢了', '说不好', '啧', '嗯呐', '话说回来'],
  customTheme: ['互助', '惜物', '认理', '谢邻', '守夜', '分粮'],
  eventTheme: ['紧巴', '分粮', '躲灾', '谢天'],
  roleName: ['管事', '跑腿', '主事', '帮办'],
  dutyWord: ['看账', '跑腿', '捎话', '掌勺', '守夜', '教字'],
  nameGiven: ['禾', '穗儿', '知秋', '念安', '石头', '豆子', '阿桃', '春生', '冬至', '杏儿', '芦花', '谷雨', '拾一', '小舟', '满仓', '月牙'],
  outSur: ['顾', '路', '桑', '祝', '尤', '桂', '虞'],
  outGiven: ['长顺', '来喜', '二槐', '雁归', '春霖', '丰年', '有为'],
  petDog: ['阿黄', '黑子', '来福', '石头', '大毛'],
  petCat: ['咪咪', '小花', '团子', '雪团', '阿灰'],
  dialect: [['什么', '啥'], ['很', '忒'], ['舒服', '得劲'], ['厉害', '有两下子'], ['聊天', '拉呱'], ['说话', '念叨'],
    ['漂亮', '俊'], ['麻烦', '絮烦'], ['算了', '拉倒'], ['那边', '那头儿'], ['怎么', '咋'], ['知道', '晓得'],
    ['孩子', '娃'], ['吃亏', '吃瘪']],
  swap: [['铜钱', '铜板'], ['铜板', '铜钱'], ['林子', '山洼'], ['山火', '野火'], ['账', '债'], ['偷', '顺手拿'],
    ['离开', '走远'], ['哭', '抹眼泪'], ['师父', '老匠人'], ['方子', '手艺'], ['误诊', '看走了眼'], ['诗', '句子'],
    ['稿子', '残篇'], ['钱', '铜子儿']],
  taboo: [['死'], ['分家'], ['矿'], ['欠'], ['亲事', '婚事'], ['病'], ['歉收', '收成不好'], ['贼'], ['酒'], ['旧伤', '残疾']],
  conflict: [
    { key: 'leave', a: '想离开小镇去外面看看', b: '放不下镇上的日子' },
    { key: 'please', a: '想被所有人喜欢', b: '又不愿意说违心话' },
    { key: 'guilt', a: '总觉得自己是个好人', b: '却一直忘不了做过的那件亏心事' },
    { key: 'novelty', a: '想把日子过出新花样', b: '又怕镇上人说闲话' },
    { key: 'confess', a: '想对某个人说句掏心窝的话', b: '又怕说了连朋友都做不成' },
    { key: 'duty', a: '想过几天清净日子', b: '又丢不下手里的活计' }
  ],
  secretGen: [
    { content: '夜里躲在被窝里偷偷哭过', kw: ['哭'] },
    { content: '在墙缝里藏了一小袋铜钱', kw: ['钱', '铜钱'] },
    { content: '其实认不得几个字，一直装着会念', kw: ['识字', '念书'] },
    { content: '给对门送过东西，没让家里人知道', kw: ['送'] }
  ]
};

// ---------- 初始条件拷贝（深拷贝：每个世界的词库独立漂移，谁也不是谁的副本） ----------
function deepCopy(v) {
  if (Array.isArray(v)) return v.map(deepCopy);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = deepCopy(v[k]); }
  return v;
}
export function initLexicon() {
  const lex = {};
  for (const slot of Object.keys(LEX_SLOTS)) lex[slot] = deepCopy(SEED_LEXICON[slot] || []);
  return lex;
}
// 取槽（旧档兜底：槽缺失时从种子表补齐——机制不依赖档里一定有什么词）
export function lexSlot(game, slot) {
  if (!LEX_SLOTS[slot]) return [];
  const lex = game && game.lexicon;
  if (!lex || !Array.isArray(lex[slot])) return deepCopy(SEED_LEXICON[slot] || []);
  return lex[slot];
}
// 随机取一条；game 为空落种子表（纯函数/selftest 兼容）
export function pickLex(game, slot, rng) {
  const arr = lexSlot(game, slot);
  if (!arr.length) return LEX_SLOTS[slot] && LEX_SLOTS[slot].shape === 'word' ? '' : '';
  return choice(rng || Math.random, arr);
}

// ---------- 变异（语言漂移的基本动作：方言化换词 / 长句掉字——复刻传闻变形的两个物理） ----------
export function mutateWord(rng, w) {
  let s = String(w == null ? '' : w);
  if (!s) return s;
  // 方言化：撞到方言对就换（话随年月往土话里沉）
  const pairs = SEED_LEXICON.dialect;
  for (const [std, dia] of pairs) {
    if (s.includes(std) && chance(rng, 0.6)) return s.split(std).join(dia);
  }
  // 掉字：长句子传着传着就短了
  if (s.length > 8 && chance(rng, 0.5)) {
    const i = 1 + Math.floor(rng() * (s.length - 2));
    s = s.slice(0, i) + s.slice(i + 1);
  }
  return s;
}
// 可漂移的槽（名字/方言对/换词对/禁忌/心结/心事不参与变异——名从主人，对子变形会砸机制）
function mutableSlots() {
  return Object.keys(LEX_SLOTS).filter(s => {
    const sh = LEX_SLOTS[s].shape;
    return (sh === 'phrase' || sh === 'word') && !['nameGiven', 'outSur', 'outGiven', 'petDog', 'petCat'].includes(s);
  });
}
// 语言日推进：每日小概率变异一词、退役一词（词会死，语言才活；退役只在词数过半槽时发生，保底可说话）
export function lexiconDaily(game, day) {
  const rng = game.rng;
  if (!game.lexicon) game.lexicon = initLexicon();
  const slots = mutableSlots();
  // 变异：撞一个槽变一个词
  if (chance(rng, 0.06)) {
    const slot = choice(rng, slots);
    const arr = lexSlot(game, slot);
    if (arr.length) {
      const i = Math.floor(rng() * arr.length) % arr.length;
      const nw = mutateWord(rng, arr[i]);
      if (nw && nw !== arr[i] && !arr.includes(nw)) arr[i] = nw;
    }
  }
  // 退役：旧词没人说了（FIFO 死最老的）
  if (chance(rng, 0.04)) {
    const slot = choice(rng, slots);
    const arr = lexSlot(game, slot);
    if (arr.length > Math.ceil(LEX_SLOTS[slot].cap / 2)) arr.shift();
  }
}

// ---------- 校验器（物理：词条的形状；演化提案 lex 的洗练入口） ----------
// 返回 { ok, entry, why }——entry 是洗练后的规范形
function s(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
export function checkLexEntry(slot, raw) {
  const def = LEX_SLOTS[slot];
  if (!def) return { ok: false, why: '话位不在名册' };
  switch (def.shape) {
    case 'phrase': {
      const w = s(raw, 20);
      return w ? { ok: true, entry: w } : { ok: false, why: '话是空的' };
    }
    case 'word': {
      const w = s(raw, 6);
      return w ? { ok: true, entry: w } : { ok: false, why: '词是空的' };
    }
    case 'pair': {
      const a = s(Array.isArray(raw) ? raw[0] : (raw && (raw.a != null ? raw.a : raw.std)), 6);
      const b = s(Array.isArray(raw) ? raw[1] : (raw && (raw.b != null ? raw.b : raw.dia)), 6);
      return (a && b && a !== b) ? { ok: true, entry: [a, b] } : { ok: false, why: '对子不成对' };
    }
    case 'group': {
      const g = (Array.isArray(raw) ? raw : [raw]).map(v => s(v, 4)).filter(Boolean).slice(0, 3);
      return g.length ? { ok: true, entry: g } : { ok: false, why: '禁忌词是空的' };
    }
    case 'ab': {
      const o = raw && typeof raw === 'object' ? raw : {};
      const key = CONFLICT_KEYS.includes(o.key) ? o.key : null;
      const a = s(o.a, 16), b = s(o.b, 16);
      if (!key) return { ok: false, why: '心结的种类不在名册（' + CONFLICT_KEYS.join('/') + '）' };
      return (a && b) ? { ok: true, entry: { key, a, b } } : { ok: false, why: '心结缺了一头' };
    }
    case 'secret': {
      const o = raw && typeof raw === 'object' ? raw : {};
      const content = s(o.content, 24);
      const kw = (Array.isArray(o.kw) ? o.kw : []).map(v => s(v, 4)).filter(Boolean).slice(0, 3);
      return (content && kw.length) ? { ok: true, entry: { content, kw } } : { ok: false, why: '心事要有说法和由头' };
    }
  }
  return { ok: false, why: '不认识的话位形状' };
}
// 同词判定（形状感知的去重）
export function sameLexEntry(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
