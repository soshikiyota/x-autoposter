const { TwitterApi } = require('twitter-api-v2');

// ===== helpers =====
const SALT = process.env.SALT || 'soshi';
function jstNow(){ return new Date(Date.now() + 9*3600*1000); }
function pad2(n){ return String(n).padStart(2,'0'); }
function padHHMM(h,m){ return `${pad2(h)}:${pad2(m)}`; }
function ymdNum(d){ return Number(`${d.getUTCFullYear()}${pad2(d.getUTCMonth()+1)}${pad2(d.getUTCDate())}`); }
function mulberry32(seed){ return function(){ let t=seed+=0x6D2B79F5; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function hashStr(s){ let h=2166136261>>>0; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
function rngForToday(){ const seed=(ymdNum(jstNow()) ^ hashStr(SALT))>>>0; return mulberry32(seed); }
function randInt(rng,a,b){ return Math.floor(rng()*(b-a+1))+a; }
function slots5min(h1,h2){ const out=[]; for(let h=h1;h<=h2;h++){ for(let m=0;m<60;m+=5) out.push(padHHMM(h,m)); } return out; }
function minutesFromHHMM(s){ const [H,M]=s.split(':').map(Number); return H*60+M; }

// ===== today plan =====
const nowJ = jstNow();
const rng = rngForToday();
const dow = nowJ.getUTCDay(); // 0=Sun..6=Sat
const isWeekday = (dow>=1 && dow<=5);

// daily count ≒20
function triangularInt(r,min,mode,max){
  const u=r(), c=(mode-min)/(max-min); let val;
  if(u<c) val=min+Math.sqrt(u*(max-min)*(mode-min));
  else    val=max-Math.sqrt((1-u)*(max-min)*(max-mode));
  return Math.max(min, Math.min(max, Math.round(val)));
}
const COUNT = triangularInt(rng,19,21,23); // ←20本前後

// time windows
const windows = [
  { name:'early',   range:[5,8],   w:0.75 },
  { name:'morning', range:[6,10],  w:1.0 },
  { name:'noon',    range:[11,15], w:1.2 },
  { name:'evening', range:[18,21], w:1.3 },
  { name:'late',    range:[22,23], w:0.6 },
].map(w=>({ ...w, w: w.w*((dow===0||dow===6)?1.1:1) }));

// pick slots (no ±10min double)
const selected = [];
(function pickSlots(){
  const taken = new Set(), near=new Set();
  const totalW = windows.reduce((s,w)=>s+w.w,0);
  const alloc = windows.map(w=>({range:w.range, n: Math.floor(COUNT*(w.w/totalW)), name:w.name}));
  let rem = COUNT - alloc.reduce((s,a)=>s+a.n,0);
  while(rem-->0) alloc[randInt(rng,0,alloc.length-1)].n++;
  for(const a of alloc){
    const pool = slots5min(a.range[0], a.range[1]);
    let n=a.n, tries=0;
    while(n>0 && tries<10000){
      tries++;
      const s = pool[randInt(rng,0,pool.length-1)];
      if(taken.has(s) || near.has(s)) continue;
      const [H,M]=s.split(':').map(Number);
      for(let d=-2; d<=2; d++){
        const mm=H*60+M+d*5; if(mm<0||mm>=24*60) continue;
        const h2=Math.floor(mm/60), m2=mm%60; near.add(padHHMM(h2,m2));
      }
      taken.add(s); selected.push({time:s, hour:H, band:a.name});
      n--;
    }
  }
  selected.sort((a,b)=>a.time<b.time?-1:1);
})();

// inject 1–2 question slots (early/evening)
const questionCount = randInt(rng,1,2);
(function assignQuestionSlots(){
  const candidates = selected.filter(x => x.band==='early' || x.band==='evening');
  const chosen = new Set();
  let tries = 0;
  while(chosen.size < Math.min(questionCount, candidates.length) && tries++<5000){
    const pick = candidates[randInt(rng,0,candidates.length-1)];
    if(chosen.has(pick.time)) continue;
    chosen.add(pick.time);
  }
  for (const s of selected){ if (chosen.has(s.time)) s.kind = 'question'; }
})();

// themes & rules
const THEMES = [
  '日常の一言','仕事のTips','生活のTips','副業・小さな前進',
  '借金/マネー習慣','ゴルフ練習・気づき','サーフィン/海の感覚','釣り・自然',
  '時事ネタ(抽象コメント)',
];
function allowedThemesFor(timeHHMM){
  const h = minutesFromHHMM(timeHHMM)/60;
  if (isWeekday && h>=9 && h<18) {
    return ['日常の一言','仕事のTips','生活のTips','副業・小さな前進','借金/マネー習慣','時事ネタ(抽象コメント)'];
  }
  if (h>=5 && h<9) return THEMES;
  return THEMES;
}
function toneFor(theme, kind){
  if (kind==='question') return 'soft';
  if (['仕事のTips','副業・小さな前進','借金/マネー習慣'].includes(theme)) return 'hard';
  if (['時事ネタ(抽象コメント)'].includes(theme)) return 'balanced';
  return 'soft';
}
function baseWeight(theme, hour){
  const isWork = (isWeekday && hour>=9 && hour<18);
  if (isWork) {
    if (theme==='仕事のTips') return 1.35;
    if (theme==='生活のTips') return 1.25;
    if (theme==='副業・小さな前進') return 1.2;
    if (theme==='借金/マネー習慣') return 1.1;
    if (theme==='時事ネタ(抽象コメント)') return 0.6;
    return 1.0;
  } else {
    if (theme==='サーフィン/海の感覚') return (hour<9?1.35:1.2);
    if (theme==='ゴルフ練習・気づき') return 1.2;
    if (theme==='釣り・自然') return 1.1;
    return 1.0;
  }
}

// cooldown & caps
const COOLDOWN_MIN = 120;
const capByTheme = new Map();
capByTheme.set('時事ネタ(抽象コメント)', Math.max(1, Math.floor(COUNT*0.10)));
const usedCount = new Map();
const themePlan = [];
const lastTimeByTheme = new Map();

function pickThemeForSlot(idx){
  const slot = selected[idx];
  if (slot.kind === 'question') return { theme:'質問', kind:'question' };

  const allow = allowedThemesFor(slot.time);
  const last1 = themePlan[idx-1]?.theme || null;
  const last2 = themePlan[idx-2]?.theme || null;
  const banned = (last1 && last1===last2) ? last1 : null;

  let candidates = [];
  for (const th of allow){
    if (banned && th===banned) continue;
    const cap = capByTheme.get(th) ?? Infinity;
    if ((usedCount.get(th)||0) >= cap) continue;
    const lastT = lastTimeByTheme.get(th);
    if (lastT!=null) {
      const gap = minutesFromHHMM(slot.time) - lastT;
      if (gap < COOLDOWN_MIN) continue;
    }
    candidates.push(th);
  }
  if (!candidates.length){
    for (const th of allow){
      if (banned && th===banned) continue;
      const cap = capByTheme.get(th) ?? Infinity;
      if ((usedCount.get(th)||0) >= cap) continue;
      const lastT = lastTimeByTheme.get(th);
      const gap = (lastT==null) ? 1e9 : (minutesFromHHMM(slot.time)-lastT);
      if (gap >= 60) candidates.push(th);
    }
  }
  if (!candidates.length) candidates = allow.slice();

  const weights = candidates.map(t => baseWeight(t, slot.hour));
  const sum = weights.reduce((s,x)=>s+x,0);
  let r = rng()*sum, idxPick=0;
  for(let i=0;i<candidates.length;i++){ r -= weights[i]; if(r<=0){ idxPick=i; break; } }
  const chosen = candidates[idxPick];

  lastTimeByTheme.set(chosen, minutesFromHHMM(slot.time));
  usedCount.set(chosen, (usedCount.get(chosen)||0)+1);
  return { theme: chosen, kind:'normal' };
}
for (let i=0;i<selected.length;i++){
  const { theme, kind } = pickThemeForSlot(i);
  const tone = toneFor(theme, kind);
  themePlan.push({ time:selected[i].time, hour:selected[i].hour, theme, kind, tone });
}

// quiet window (manual posting protection)
function inQuietWindow(nowJ) {
  const rule = (process.env.QUIET_WINDOWS || '').trim();
  if(!rule) return false;
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dname = dayNames[nowJ.getUTCDay()];
  const hh = String(nowJ.getUTCHours()).padStart(2,'0');
  const mm = String(nowJ.getUTCMinutes()).padStart(2,'0');
  const cur = `${hh}:${mm}`;
  return rule.split(';').some(seg=>{
    const s = seg.trim();
    if(!s) return false;
    const [day, range] = s.split(' ').map(x=>x.trim());
    if(day !== dname) return false;
    const [from,to] = range.split('-');
    return (cur >= from && cur <= to);
  });
}
if (inQuietWindow(nowJ)) {
  console.log('skip (quiet window for manual posts)');
  process.exit(0);
}

// ===== post decision =====
// ===== post decision =====
const curH = nowJ.getUTCHours(), curM = Math.floor(nowJ.getUTCMinutes()/5)*5;
const CUR = padHHMM(curH,curM);
let slotIdx = themePlan.findIndex(x => x.time === CUR);

// コメントアウトでskipを無効化した場合でも、ここで“即席スロット”を作って埋める
function pickImmediateTheme() {
  const hour = nowJ.getUTCHours();
  const allow = allowedThemesFor(CUR);
  // 重み抽選で1つ選ぶ
  const weights = allow.map(t => baseWeight(t, hour));
  const sum = weights.reduce((s,x)=>s+x,0);
  let r = rng()*sum, idx=0;
  for (let i=0;i<allow.length;i++){ r -= weights[i]; if(r<=0){ idx=i; break; } }
  const theme = allow[idx];
  const tone = toneFor(theme, 'normal');
  return { time: CUR, hour, theme, kind:'normal', tone };
}

let slot;
if (slotIdx === -1) {
  // 本来はskipする時間帯 → テスト用に即席スロットを生成して投稿続行
  slot = pickImmediateTheme();
} else {
  slot = themePlan[slotIdx];
}

// ===== OpenAI generation =====
async function genWithOpenAI(){
  const tone = slot.tone;
  const styleLine =
    tone==='soft'     ? "語尾はやわらかく、フランクでXらしい口語。時々くだけた表現もOK。"
  : tone==='hard'     ? "語尾は断定しすぎない事実語り。落ち着いた口調で説得力を優先。"
  :                     "語尾は中庸。柔らかさと情報性のバランスをとる。";

const system = [
  "X向けの自然な日本語の投稿文を作る。",
  "140文字以内。ハッシュタグ禁止。絵文字は入れても1個まで。",
  "テンプレ感のある決まり文句は避ける。広告っぽさ・過度な断定はNG。",
  "前後の文脈がなくても自然に読めるように。",
  "通常は1文〜2文。ただし全テーマにおいて約2割の確率で、短いリスト型（2点まで）にしてよい。",
  "語尾や文体は日本人の自然なツイートっぽさを優先し、教科書的な表現は避ける。",
  "柔らかめの場合は『〜かな』『〜だな』『〜してみた』のような自然な砕け方を混ぜる。",
  "硬めの場合は断定は避けつつ『〜しておくと良い』『〜しやすい』のような助言口調にする。"
].join(" ");

  const extraByTheme = {
    '日常の一言': "素朴な日常の気づきや小さな感情の揺れを率直に。",
    '仕事のTips': "具体的で再現性のある小ワザをひとつ。時間帯に合う内容で。",
    '生活のTips': "暮らしを少し良くする微小な工夫をひとつ。実体験ベースで。",
    '副業・小さな前進': "やったこと→気づき→次の一歩を簡潔に。",
    '借金/マネー習慣': "煽らず、行動ベースで。数字の断定や誇張は避ける。",
    'ゴルフ練習・気づき': "練習や感覚のメモを短く。専門用語は多用しない。",
    'サーフィン/海の感覚': "体の感覚を淡々と。安全配慮や無理しない姿勢を一言。",
    '釣り・自然': "自然条件と自分の工夫を短く。誇張しない。",
    '時事ネタ(抽象コメント)': "固有名詞は避け、現象の抽象パターンや学びを一言で。"
  };

  const isQuestion = (slot.kind==='question');
  let themeLabel = slot.theme;
  let extra = extraByTheme[slot.theme] || "";
  let user;

  if (isQuestion) {
    themeLabel = '共感質問';
    extra = "相手が答えやすい短い質問。Yes/Noで終わらず、軽い体験共有を促す。語尾は柔らかく。";
    user = `テーマ:「${themeLabel}」。\n${extra}\n出力は本文のみ。`;
  } else {
    user = `テーマ:「${slot.theme}」。\n${extra}\n出力は本文のみ。`;
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.95,
      presence_penalty: 0.4,
      frequency_penalty: 0.3,
      max_tokens: 120,
      messages: [
        { role:'system', content: system },
        { role:'user', content: user }
      ]
    })
  });
  const json = await resp.json();
  if(!resp.ok) throw new Error(`OpenAI error: ${resp.status} ${JSON.stringify(json)}`);
  let text = (json.choices?.[0]?.message?.content || "").trim();
  text = text.replace(/#[\p{L}0-9_一-龥ー]+/gu,"").trim();
  const arr = Array.from(text); if(arr.length>140) text = arr.slice(0,140).join('');
  return text;
}

// ===== post =====
async function postToX(text){
  const client = new TwitterApi({
    appKey: process.env.X_CONSUMER_KEY,
    appSecret: process.env.X_CONSUMER_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });
  const r = await client.v2.tweet(text);
  return r?.data?.id;
}

(async()=>{
  try{
    const text = await genWithOpenAI();
    if(!text) throw new Error('empty text');
    const id = await postToX(text);
    const CUR = padHHMM(nowJ.getUTCHours(), Math.floor(nowJ.getUTCMinutes()/5)*5);
    const slot = themePlan.find(x=>x.time===CUR);
    console.log('posted', CUR, id, `[${slot.theme}/${slot.kind||'normal'}|${slot.tone}]`, text);
  }catch(e){
    console.error('failed', e);
    process.exit(1);
  }
})();
