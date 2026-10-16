"use strict";
if (window.top !== window.self) { document.documentElement.innerHTML = ""; throw new Error("framed"); }

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const ymd = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const today = () => ymd(new Date());
const parseD = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d = parseD(s); d.setDate(d.getDate()+n); return ymd(d); };
const fmt = n => new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Math.round(n||0));
const rub = n => fmt(n)+" ₽";
const compact = n => Math.abs(n)>=1e6 ? (n/1e6).toFixed(2).replace(".",",")+" млн ₽" : Math.abs(n)>=1e5 ? Math.round(n/1e3)+" тыс ₽" : rub(n);
const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const MONTHS_G = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const WD = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];
const dLabel = s => { const d = parseD(s); return d.getDate()+" "+MONTHS_G[d.getMonth()]; };
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
function toast(t){ const el=$("#toast"); el.textContent=t; el.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,2200); }

document.documentElement.lang="ru";
const svgI = d => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICO = {
  x: svgI('<path d="M6 6l12 12M18 6L6 18"/>'), left: svgI('<path d="M15 6l-6 6 6 6"/>'), right: svgI('<path d="M9 6l6 6-6 6"/>'),
  check: svgI('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), pin: svgI('<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>'), ruble: svgI('<path d="M8 20V4h6a4 4 0 0 1 0 8H6M6 16h9"/>'),
  moon: svgI('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'), steps: svgI('<path d="M7 17L17 7M9 7h8v8"/>'), down: svgI('<path d="M12 5v14M6 13l6 6 6-6"/>')
};
/* ---------- data layer: Supabase (Auth + REST), без сторонних библиотек ---------- */
const COLS = ["tasks","habits","health","money","subs","notes","board","meta"];
const S = Object.fromEntries(COLS.map(c=>[c,{}]));
const DEF = { budget:0 };
const CFG = window.PULT_CONFIG || {};
const SESSION_KEY = "pult.session.v1";
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
let session = null, me = {id:null,name:"",email:""}, netError = "";
const firstName = () => (me.name||"").trim().split(/\s+/)[0] || "";
const settings = () => Object.assign({}, DEF, S.meta.settings || {});
const arr = col => Object.entries(S[col]).map(([id,v])=>({id,...v}));
const configured = () => typeof CFG.url === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CFG.url) && typeof CFG.key === "string" && CFG.key.length > 20;

function loadSession(){ try { const v = JSON.parse(localStorage.getItem(SESSION_KEY)); return v && v.access_token && v.refresh_token ? v : null; } catch(_) { return null; } }
function storeSession(v){ try { v ? localStorage.setItem(SESSION_KEY, JSON.stringify(v)) : localStorage.removeItem(SESSION_KEY); } catch(_){} }
function applySession(v){
  session = v; storeSession(v);
  const u = v && v.user || {};
  me = { id: u.id || null, email: u.email || "", name: (u.user_metadata && typeof u.user_metadata.name === "string") ? u.user_metadata.name.slice(0,60) : "" };
}

async function authCall(path, body, token){
  const headers = { apikey: CFG.key, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(CFG.url + "/auth/v1/" + path, { method: body === undefined ? "GET" : (path === "user" ? "PUT" : "POST"), headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch(_){}
  if (!r.ok) { const e = new Error(j.msg || j.error_description || j.message || ("HTTP " + r.status)); e.status = r.status; e.code = j.error_code || j.code; throw e; }
  return j;
}
function toSession(j){
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || (Math.floor(Date.now()/1000) + (j.expires_in || 3600)), user: j.user };
}
let refreshing = null;
async function ensureFresh(force){
  if (!session) throw new Error("no session");
  if (!force && session.expires_at - 60 > Date.now()/1000) return;
  if (!refreshing) refreshing = authCall("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(j => applySession(toSession(j)))
      .catch(e => { if (e.status === 400 || e.status === 401) { signedOut("Сессия истекла, войдите снова"); } throw e; })
      .finally(() => { refreshing = null; });
  return refreshing;
}
async function api(path, opts = {}, retried){
  await ensureFresh();
  const r = await fetch(CFG.url + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers: Object.assign({ apikey: CFG.key, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" }, opts.headers || {}),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  if (r.status === 401 && !retried) { await ensureFresh(true); return api(path, opts, true); }
  if (!r.ok) { let j = {}; try { j = await r.json(); } catch(_){} const e = new Error(j.message || ("HTTP " + r.status)); e.status = r.status; e.code = j.code; throw e; }
  return r;
}

async function loadAll(){
  const fresh = Object.fromEntries(COLS.map(c=>[c,{}]));
  for (let from = 0; ; from += 1000) {
    const r = await api("items?select=col,id,data&order=col,id", { headers: { Range: from + "-" + (from + 999), "Range-Unit": "items" } });
    const rows = await r.json();
    rows.forEach(x => { if (fresh[x.col] && ID_RE.test(x.id) && x.data && typeof x.data === "object") fresh[x.col][x.id] = x.data; });
    if (rows.length < 1000) break;
  }
  COLS.forEach(c => S[c] = fresh[c]);
  if (!moneyPicked) { const ms = monthsWithMoney(); if (ms.length && !ms.some(([k]) => k === moneyMonth)) moneyMonth = ms[0][0]; }
  netError = ""; render();
}

const pending = new Map();
async function save(col, id, data){
  if (!session) { toast("Войдите, чтобы сохранять"); return; }
  if (!COLS.includes(col) || !ID_RE.test(id)) { toast("Не получилось сохранить"); return; }
  S[col][id] = data; render();
  const key = col + "/" + id;
  const prev = pending.get(key) || Promise.resolve();
  const p = prev.then(() => api("items?on_conflict=user_id,col,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: { col, id, data } }))
    .catch(handleErr);
  pending.set(key, p); p.finally(() => { if (pending.get(key) === p) pending.delete(key); });
}
async function del(col, id){
  if (!session || !COLS.includes(col) || !ID_RE.test(id)) return;
  delete S[col][id]; render();
  try { await api("items?col=eq." + encodeURIComponent(col) + "&id=eq." + encodeURIComponent(id), { method: "DELETE", headers: { Prefer: "return=minimal" } }); }
  catch(e){ handleErr(e); }
}
function handleErr(e){
  if (e && e.code === "54000") toast("Слишком много записей, удалите старые");
  else if (e && e.code === "23514") toast("Запись слишком большая");
  else if (e && e.status === 429) toast("Слишком часто, подождите минуту");
  else if (e && e.message === "no session") return;
  else { netError = "Нет связи с сервером: изменения могут не сохраниться"; toast("Не сохранилось, проверьте интернет"); }
}

/* ---------- navigation ---------- */
const IC = {
 home:'<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
 task:'<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 5-5"/>',
 cal:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/>',
 heart:'<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
 money:'<rect x="2" y="6" width="20" height="13" rx="3"/><path d="M2 10h20M6 15h4"/>',
 note:'<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>',
 board:'<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
 habit:'<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/><path d="M9 12l2 2 4-4"/>',
 ai:'<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'
};
const VIEWS = [
 ["home","Обзор","home"],["tasks","Задачи","task"],["habits","Привычки","habit"],["cal","Календарь","cal"],["health","Здоровье","heart"],
 ["money","Финансы","money"],["notes","Заметки","note"]
];
let view = (location.hash||"").slice(1);
if (!VIEWS.some(v=>v[0]===view)) view = "home";
function navCount(k){
  const t=today();
  const n = k==="tasks" ? arr("tasks").filter(x=>!x.done && x.kind!=="event" && x.date<=t).length
          : k==="notes" ? Object.keys(S.notes).length
          : k==="board" ? arr("board").filter(c=>c.col!=="done").length : 0;
  return n ? `<span class="cnt">${n}</span>` : "";
}
function drawNav(){
  $("#nav").innerHTML = VIEWS.map(([k,t,i])=>`<button data-v="${k}" class="${k===view?"on":""}" ${k===view?'aria-current="page"':""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[i]}</svg>${t}${navCount(k)}</button>`).join("");
}
$("#nav").addEventListener("click", e=>{ const b=e.target.closest("button"); if(!b) return; go(b.dataset.v); });
function go(v){ view=v; try{history.replaceState(null,"","#"+v);}catch(_){} drawNav(); render(); window.scrollTo(0,0); }

/* ---------- render with focus preservation ---------- */
function render(){
  drawNav();
  const a = document.activeElement, keep = a && a.id && /INPUT|TEXTAREA|SELECT/.test(a.tagName) ? {id:a.id,val:a.value,s:a.selectionStart,e:a.selectionEnd} : null;
  if (view==="notes" && keep && keep.id.startsWith("note")) { drawNoteList(); return; }
  const fn = {home:vHome,habits:vHabits,tasks:vTasks,cal:vCal,health:vHealth,money:vMoney,notes:vNotes}[view];
  $("#view").innerHTML = (bannerHtml()) + fn();
  if (keep){ const el=document.getElementById(keep.id); if(el){ el.value=keep.val; el.focus(); try{el.setSelectionRange(keep.s,keep.e);}catch(_){} } }
}
function bannerHtml(){
  return netError ? `<div class="banner">${esc(netError)}</div>` : "";
}

/* ---------- scoring ---------- */
function dayScore(d){
  const ts = arr("tasks").filter(t=>t.date===d && t.kind!=="event");
  const h = S.health[d] || {};
  const hb = arr("habits").filter(x=>habitDue(x,d));
  const parts = [
    ["Задачи", ts.length ? ts.filter(t=>t.done).length/ts.length : 0, 30],
    ["Привычки", hb.length ? hb.filter(x=>(x.log||{})[d]).length/hb.length : 0, 20],
    ["Сон", h.sleep ? Math.min(h.sleep/7.5,1) : 0, 15],
    ["Шаги", h.steps ? Math.min(h.steps/8000,1) : 0, 10],
    ["Вода", h.water ? Math.min(h.water/8,1) : 0, 10],
    ["Настроение", h.mood ? h.mood/5 : 0, 15]
  ];
  return {total:Math.round(parts.reduce((s,p)=>s+p[1]*p[2],0)), parts};
}
function greet(){ const h=new Date().getHours(); return h<5?"Доброй ночи":h<12?"Доброе утро":h<18?"Добрый день":"Добрый вечер"; }

/* ---------- charts ---------- */
const SEG_COLORS = ["#EFF8FF","#BBEF1F","#FF0055","rgba(239,248,255,.55)","rgba(187,239,31,.6)","rgba(255,0,85,.65)"];
function barChart(vals, labels, color, h=140){
  const W=600, H=h, padB=18, max=Math.max(1,...vals), bw=W/vals.length;
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for(let g=1; g<=3; g++){ const y=(H-padB)*(1-g/3)+2; s+=`<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="2 5"/>`; }
  vals.forEach((v,i)=>{ const bh=(H-padB-6)*(v/max), x=i*bw+bw*.22, w=bw*.56, y=H-padB-bh;
    s+=`<rect x="${x}" y="${y}" width="${w}" height="${Math.max(bh,v?2:0)}" rx="${Math.min(5,w/2)}" fill="${i===vals.length-1?"var(--peach)":color}"><title>${esc(labels[i])}: ${fmt(v)}</title></rect>`;
    s+=`<text x="${x+w/2}" y="${H-4}" text-anchor="middle">${esc(labels[i])}</text>`; });
  return s+`</svg>`;
}
function lineChart(vals, labels, maxV, h=170, suffix=""){
  const W=640, H=h, padT=30, padB=20, padX=12, max=maxV||Math.max(1,...vals), n=vals.length, step=(W-padX*2)/(n-1||1);
  const pts=vals.map((v,i)=>[padX+i*step, padT+(H-padT-padB)*(1-v/max)]);
  let d=""; pts.forEach((p,i)=>{ if(!i){ d+=`M${p[0]},${p[1]}`; return; } const q=pts[i-1], cx=(q[0]+p[0])/2; d+=` C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`; });
  const last=pts[n-1], gid="g"+Math.random().toString(36).slice(2,7);
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF0055" stop-opacity=".45"/><stop offset="1" stop-color="#FF0055" stop-opacity="0"/></linearGradient></defs>`;
  for(let g=0; g<=2; g++){ const y=padT+(H-padT-padB)*g/2; s+=`<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="2 6"/>`; }
  s+=`<path d="${d} L${last[0]},${H-padB} L${pts[0][0]},${H-padB} Z" fill="url(#${gid})"/>`;
  s+=`<path d="${d}" fill="none" stroke="#EFF8FF" stroke-width="2.2" stroke-linecap="round"/>`;
  s+=`<line x1="${last[0]}" x2="${last[0]}" y1="${last[1]}" y2="${H-padB}" stroke="var(--lime)" stroke-dasharray="3 4"/>`;
  const lw=Math.max(34,String(fmt(vals[n-1])+suffix).length*8+14), lx=Math.min(W-lw/2, Math.max(lw/2,last[0]));
  s+=`<rect x="${lx-lw/2}" y="${Math.max(0,last[1]-28)}" width="${lw}" height="20" rx="10" fill="var(--lime)"/><text x="${lx}" y="${Math.max(0,last[1]-28)+14}" text-anchor="middle" style="fill:#14180a;font-weight:600;font-size:11px">${fmt(vals[n-1])}${suffix}</text>`;
  s+=`<circle cx="${last[0]}" cy="${last[1]}" r="5" fill="var(--lime)" stroke="#0D0303" stroke-width="2"/>`;
  labels.forEach((l,i)=>{ if(n<=14 || i%2===0) s+=`<text x="${padX+i*step}" y="${H-4}" text-anchor="middle">${esc(l)}</text>`; });
  return s+`</svg>`;
}
function ring(value, max, color, label, center){
  const r=44, c=2*Math.PI*r, p=Math.max(0,Math.min(1,value/max));
  return `<div class="ring"><svg viewBox="0 0 108 108"><circle cx="54" cy="54" r="${r}" fill="none" stroke="var(--track)" stroke-width="9"/>
    ${p>0?`<circle cx="54" cy="54" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c*p} ${c}" transform="rotate(-90 54 54)"/>`:""}
    <text x="54" y="60" text-anchor="middle" font-size="20">${esc(center)}</text></svg>${label}</div>`;
}
function donut(parts, center){
  const total=parts.reduce((s,p)=>s+p[1],0)||1, r=44, c=2*Math.PI*r; let off=0;
  let s=`<svg viewBox="0 0 108 108" style="width:150px;height:150px;flex:none"><circle cx="54" cy="54" r="${r}" fill="none" stroke="var(--track)" stroke-width="12"/>`;
  parts.forEach(([n,v,col])=>{ const len=c*v/total; s+=`<circle cx="54" cy="54" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-dasharray="${Math.max(0,len-1.5)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 54 54)"><title>${esc(n)}</title></circle>`; off+=len; });
  const fs=Math.min(14, 120/Math.max(1,String(center).length));
  return s+`<text x="54" y="${54+fs*0.35}" text-anchor="middle" style="fill:var(--fg);font-size:${fs.toFixed(1)}px;font-weight:700">${esc(center)}</text></svg>`;
}
function lastNDays(n){ const t=today(); return Array.from({length:n},(_,i)=>addDays(t,i-n+1)); }

/* ---------- OVERVIEW ---------- */
let homeTab="today";
function dayWord(n){ return n>=85?"Отличный день":n>=65?"Хороший день":n>=40?"Обычный день":n>0?"Тихий день":"День только начался"; }
function vHome(){
  const t=today(), sc=dayScore(t);
  const all=arr("tasks").sort((a,b)=>(a.date||"").localeCompare(b.date||"")||(a.time||"99").localeCompare(b.time||"99"));
  const tt=all.filter(x=>x.date===t), tasksOnly=tt.filter(x=>x.kind!=="event");
  const overdue=all.filter(x=>!x.done && x.kind!=="event" && x.date && x.date<t);
  const week=all.filter(x=>x.date>t && x.date<=addDays(t,7));
  const ym=t.slice(0,7), mon=arr("money").filter(m=>m.date && m.date.startsWith(ym));
  const expT=mon.filter(m=>m.type==="exp"&&m.date===t).reduce((s,m)=>s+m.amount,0);
  const expM=mon.filter(m=>m.type==="exp").reduce((s,m)=>s+m.amount,0);
  const h=S.health[t]||{}, days=lastNDays(14);
  const scores=days.map(d=>dayScore(d).total);
  const subsSoon=arr("subs").filter(s=>s.next && s.next>=t && s.next<=addDays(t,7)).sort((a,b)=>a.next.localeCompare(b.next));
  const doneWeek=all.filter(x=>x.done && x.date>=addDays(t,-6) && x.date<=t).length;
  const exWeek=arr("money").filter(m=>m.type==="exp" && m.date>=addDays(t,-6) && m.date<=t).reduce((s,m)=>s+m.amount,0);
  const avgScore=Math.round(scores.slice(-7).reduce((a,b)=>a+b,0)/7);
  const tabList = homeTab==="today" ? [...overdue,...tt] : homeTab==="week" ? week : null;
  return `
  <div class="spread"><div><h1>${greet()}${firstName()?", "+esc(firstName()):""}!</h1><div class="sub">Посмотрим, как прошёл день.</div></div><span class="chip">${dLabel(t)}</span></div>
  <div>
    <div class="lbl" style="margin-bottom:8px">Счёт дня</div>
    <div class="scorehead"><div class="score-n num">${sc.total}</div><div class="score-meta"><b>${dayWord(sc.total)}</b>из 100 возможных</div>
      <div class="segs">${sc.parts.map((p,i)=>`<div class="seg"><i><b style="width:${Math.round(p[1]*100)}%;background:${SEG_COLORS[i]}"></b></i>${p[0]}</div>`).join("")}</div></div>
  </div>
  <div class="tabs">${[["today","Сегодня",overdue.length+tt.length],["week","Неделя",week.length],["sum","Итоги",""]].map(([k,n,c])=>`<button class="${k===homeTab?"on":""}" data-click="homeTab" ${A(k)}>${n}<span class="num">${c}</span></button>`).join("")}</div>
  <div class="hero">
    <div class="tile a"><span class="corner">${ICO.check}</span><div><div class="lbl">Задачи сегодня</div><div class="big">${tasksOnly.filter(x=>x.done).length} из ${tasksOnly.length}</div></div><div class="mute">${overdue.length?overdue.length+" просрочено":"без просрочек"}</div></div>
    <div class="tile b"><span class="corner">${ICO.ruble}</span><div><div class="lbl">Расходы сегодня</div><div class="big">${rub(expT)}</div></div><div class="mute">за месяц ${rub(expM)}</div></div>
    <div class="tile ice"><span class="corner">${ICO.moon}</span><div><div class="lbl">Сон</div><div class="big">${h.sleep?esc(String(h.sleep).replace(".",","))+" ч":"—"}</div></div><div class="mute">${h.sleep?(h.sleep>=7?"выспался":"маловато"):"не внесён"}</div></div>
    <div class="tile"><span class="corner">${ICO.steps}</span><div><div class="lbl">Шаги</div><div class="big">${h.steps?fmt(h.steps):"—"}</div></div><div class="mute">вода ${esc(h.water||0)} из 8</div></div>
  </div>
  ${habitStrip()}
  <div class="grid g2">
    <div class="card">${tabList ? `<h2>${homeTab==="today"?"На сегодня":"Ближайшие 7 дней"} <button class="btn sm" data-click="go" ${A("tasks")}>Все задачи</button></h2>
      <div class="list">${tabList.length?tabList.map(taskRow).join(""):`<div class="empty">${homeTab==="today"?"На сегодня пусто. Добавьте задачу в разделе «Задачи».":"На неделю ничего не запланировано."}</div>`}</div>`
      : `<h2>Итоги недели</h2><div class="grid g2">
        <div><div class="lbl">Средний счёт</div><div class="big">${avgScore}</div></div>
        <div><div class="lbl">Сделано задач</div><div class="big">${doneWeek}</div></div>
        <div><div class="lbl">Потрачено</div><div class="big">${rub(exWeek)}</div></div>
        <div><div class="lbl">Заметок</div><div class="big">${Object.keys(S.notes).length}</div></div></div>`}
    </div>
    <div class="card"><h2>Продуктивность <span class="lbl">счёт дня за 2 недели</span></h2>
      ${lineChart(scores, days.map(d=>String(parseD(d).getDate())), 100)}
      ${subsSoon.length?`<div class="lbl" style="margin-top:14px">Платежи на неделе</div><div class="list">${subsSoon.map(s=>`<div class="item"><span class="dot" style="background:var(--pink)"></span><span class="t">${esc(s.name)}</span><span class="mute">${dLabel(s.next)}</span><span class="num">${rub(s.price)}</span></div>`).join("")}</div>`:""}
    </div>
  </div>
  ${boardHtml()}`;
}

/* ---------- TASKS ---------- */
let taskTab="today";
function taskRow(x){
  const t=today(), late = !x.done && x.date && x.date<t && x.kind!=="event";
  return `<div class="item ${x.done?"done":""}">
    ${x.kind==="event"?`<span class="chip" style="color:var(--teal)">событие</span>`:`<button class="check ${x.done?"on":""}" aria-label="Отметить: ${esc(x.title)}" aria-pressed="${!!x.done}" data-click="toggleTask" ${A(x.id)}></button>`}
    <span class="t">${x.prio==2?'<span style="color:var(--bad)">●</span> ':""}${esc(x.title)}</span>
    ${x.time?`<span class="num mute">${esc(x.time)}</span>`:""}
    ${x.date && x.date!==t?`<span class="chip ${late?"bad":""}">${dLabel(x.date)}</span>`:""}
    <button class="icon" aria-label="Удалить" data-click="del" ${A("tasks",x.id)}>${ICO.x}</button></div>`;
}
function toggleTask(id){ const x=S.tasks[id]; if(!x) return; save("tasks",id,{...x,done:!x.done}); }
function addTask(f){
  const title=f.title.value.trim(); if(!title) return need(f.title,"Напишите, что сделать");
  save("tasks",uid(),{title,date:f.date.value||today(),time:f.time.value||"",prio:+f.prio.value,kind:f.kind.value,done:false,created:Date.now()});
  f.title.value=""; toast("Добавлено"); return false;
}
function vTasks(){
  const t=today(), all=arr("tasks").sort((a,b)=>(a.date||"").localeCompare(b.date||"")||(a.time||"99").localeCompare(b.time||"99"));
  const groups={
    today:all.filter(x=>x.date===t || (!x.done && x.date<t && x.kind!=="event")),
    week:all.filter(x=>x.date>t && x.date<=addDays(t,7)),
    later:all.filter(x=>x.date>addDays(t,7)),
    done:all.filter(x=>x.done).reverse().slice(0,50)
  };
  const L=groups[taskTab];
  return `<div><h1>Задачи</h1><div class="sub">${groups.today.filter(x=>!x.done).length} открыто на сегодня</div></div>
  <form class="card form" data-submit="addTask">
    <label style="grid-column:1/-1">Что сделать<input type="text" id="tTitle" name="title" placeholder="Купить продукты" autocomplete="off"></label>
    <label>Дата<input type="date" id="tDate" name="date" value="${t}"></label>
    <label>Время<input type="time" id="tTime" name="time"></label>
    <label>Тип<select id="tKind" name="kind"><option value="task">Задача</option><option value="event">Событие</option></select></label>
    <label>Важность<select id="tPrio" name="prio"><option value="1">Обычная</option><option value="2">Срочно</option></select></label>
    <button class="btn pri">Добавить</button>
  </form>
  <div class="tabs">${[["today","Сегодня"],["week","7 дней"],["later","Позже"],["done","Сделано"]].map(([k,n])=>`<button class="${k===taskTab?"on":""}" data-click="taskTab" ${A(k)}>${n} <span class="mute">${groups[k].length}</span></button>`).join("")}</div>
  <div class="card"><div class="list">${L.length?L.map(taskRow).join(""):`<div class="empty">Здесь пусто.</div>`}</div></div>`;
}

/* ---------- CALENDAR ---------- */
let weekStart = (()=>{ const d=new Date(); const k=(d.getDay()+6)%7; d.setDate(d.getDate()-k); return ymd(d); })();
function vCal(){
  const t=today(), days=Array.from({length:7},(_,i)=>addDays(weekStart,i));
  const items=arr("tasks");
  const subs=arr("subs");
  return `<div class="spread"><div><h1>Календарь</h1><div class="sub">${dLabel(days[0])} — ${dLabel(days[6])}</div></div>
    <div class="row"><button class="btn sm" data-click="weekShift" ${A(-7)} aria-label="Предыдущая неделя">${ICO.left}</button><button class="btn sm" data-click="weekToday">Сегодня</button><button class="btn sm" data-click="weekShift" ${A(7)} aria-label="Следующая неделя">${ICO.right}</button></div></div>
  <div class="week">${days.map(d=>{
    const di=items.filter(x=>x.date===d).sort((a,b)=>(a.time||"99").localeCompare(b.time||"99"));
    const ds=subs.filter(s=>s.next===d);
    return `<div class="day ${d===t?"today":""}"><div class="dh"><span>${WD[parseD(d).getDay()]}</span><b>${parseD(d).getDate()}</b></div>
      ${di.map(x=>`<div class="ev ${x.kind==="event"?"":"task"} ${x.done?"done":""}" ${x.kind==="event"?"":`role="button" tabindex="0" aria-pressed="${!!x.done}"`} ${x.kind==="event"?"":`data-click="toggleTask" ${A(x.id)}`} title="${x.kind==="event"?"Событие":"Нажмите, чтобы отметить"}">${x.time?`<span class="num">${esc(x.time)}</span> `:""}${esc(x.title)}</div>`).join("")}
      ${ds.map(s=>`<div class="ev sub">${esc(s.name)} · ${rub(s.price)}</div>`).join("")}
      <button class="addday" data-click="quickDay" ${A(d)}>+ добавить</button></div>`;}).join("")}</div>
  <div class="mute" style="font-size:13px">Оранжевые — задачи, синие — события, фиолетовые — списания подписок.</div>`;
}
function quickDay(d){ go("tasks"); setTimeout(()=>{ const f=$("#tDate"); if(f){ f.value=d; $("#tTitle").focus(); } },0); }

/* ---------- HEALTH ---------- */
let healthTab="today";
function setH(field, val){ const LIM={sleep:[0,24],steps:[0,200000],water:[0,30],mood:[1,5],weight:[20,400]}; if(typeof val==="number"&&isFinite(val)&&LIM[field]&&(val<LIM[field][0]||val>LIM[field][1])){ toast("Проверьте значение"); render(); return; } const t=today(); const h={...(S.health[t]||{})}; if(val===""||val===null||isNaN(val)) delete h[field]; else h[field]=val; save("health",t,h); }
function vHealth(){
  const t=today(), h=S.health[t]||{}, days=lastNDays(14), sc=dayScore(t);
  const sleep=days.map(d=>(S.health[d]||{}).sleep||0), steps=days.map(d=>(S.health[d]||{}).steps||0);
  const lab=days.map(d=>String(parseD(d).getDate()));
  const avg=a=>{const f=a.filter(Boolean); return f.length? f.reduce((x,y)=>x+y,0)/f.length:0;};
  const weights=days.map(d=>(S.health[d]||{}).weight).filter(Boolean);
  const sl=h.sleep||0, slTxt=sl?Math.floor(sl)+":"+pad(Math.round((sl%1)*60)):"—";
  return `<div><h1>Здоровье</h1><div class="sub">Счёт дня ${sc.total} из 100</div></div>
  <div class="tabs">${[["today","Общее"],["trend","Динамика"]].map(([k,n])=>`<button class="${k===healthTab?"on":""}" data-click="healthTab" ${A(k)}>${n}</button>`).join("")}</div>
  ${healthTab==="today"?`
  <div class="card"><h2>Сегодня <span class="lbl">${dLabel(t)}</span></h2>
    <div class="rings">${ring(sc.total,100,"var(--blue)","Счёт",sc.total)}${ring(sl,8,"var(--violet)","Сон",slTxt)}${ring(h.steps||0,8000,"var(--teal)","Шаги",h.steps?(h.steps/1000).toFixed(1).replace(".",",")+"к":"0")}${ring(h.water||0,8,"var(--cyan)","Вода",(h.water||0)+"/8")}${ring(h.mood||0,5,"var(--orange)","Настроение",h.mood||"—")}</div></div>
  <div class="grid g4">
    <div class="card"><div class="lbl">Сон, часов</div><input type="text" inputmode="decimal" autocomplete="off" id="hSleep" aria-label="Сон, часов" value="${esc(h.sleep??"")}" placeholder="7.5" data-change="setHNum" ${A("sleep")} style="width:100%;margin-top:8px;font-size:20px"></div>
    <div class="card"><div class="lbl">Шаги</div><input type="text" inputmode="numeric" autocomplete="off" id="hSteps" aria-label="Шаги" value="${esc(h.steps??"")}" placeholder="8000" data-change="setHNum" ${A("steps")} style="width:100%;margin-top:8px;font-size:20px"></div>
    <div class="card"><div class="lbl">Вода, стаканов</div><div class="stepper" style="margin-top:8px"><button class="btn" data-click="water" ${A(-1)}>−</button><b class="num">${esc(h.water||0)}</b><button class="btn" data-click="water" ${A(1)}>+</button></div></div>
    <div class="card"><div class="lbl">Вес, кг</div><input type="text" inputmode="decimal" autocomplete="off" id="hWeight" aria-label="Вес, кг" value="${esc(h.weight??"")}" placeholder="—" data-change="setHNum" ${A("weight")} style="width:100%;margin-top:8px;font-size:20px"></div>
  </div>
  <div class="card"><div class="spread"><div><div class="lbl">Настроение</div><div class="mute" style="font-size:13px">1 — плохо, 5 — отлично</div></div>
    <div class="moods">${[1,2,3,4,5].map(n=>`<button class="${h.mood===n?"on":""}" data-click="mood" ${A(n)}>${n}</button>`).join("")}</div></div></div>`
  :`
  <div class="grid g2">
    <div class="card"><h2>Сон за 14 дней <span class="mute num">ср. ${avg(sleep).toFixed(1).replace(".",",")} ч</span></h2>${lineChart(sleep,lab,Math.max(10,...sleep),170," ч")}</div>
    <div class="card"><h2>Шаги за 14 дней <span class="mute num">ср. ${fmt(avg(steps))}</span></h2>${barChart(steps,lab,"var(--teal)")}</div>
  </div>
  ${weights.length>1?`<div class="card"><div class="lbl">Вес за 2 недели</div><div class="big">${esc(weights[0])} → ${esc(weights[weights.length-1])} кг</div></div>`:""}`}`;
}
/* ---------- MONEY ---------- */
const CATS = {
 "Еда":["рыба","мясо","продукт","магнит","пятер","пятёр","перекрест","ашан","хлеб","молоко","овощ","фрукт","еда","магаз","лента","вкусвилл","курица","супермаркет","pyaterochka","magnit","perekrestok","lenta","auchan","vkusvill","dixy","дикси","spar","metro c&c","светофор","fix price"],
 "Кафе":["кафе","ресторан","обед","кофе","шаурм","пицц","доставк","столовая","фастфуд","kfc","burger","бургер","mcdonald","вкусно и точка","coffee","cafe","restoran","додо","dodo"],
 "Топливо":["дизель","солярк","дт","бензин","заправк","азс","топлив","газпромнефть","лукойл","роснефть","татнефть","lukoil","tatneft","rosneft","gazprom","azs","shell","teboil"],
 "Авто и ремонт":["запчаст","шин","резин","автосервис","масло","фильтр","мойк","аккумулятор","колод","сервис","автоуслуг","avto","auto","zapchast","шиномонтаж","ремонт авто","ремонт"],
  "Дом и стройка":["цемент","доск","кирпич","профлист","саморез","стройк","леруа","краск","труб","участок","сарай","баня","leroy","дом и ремонт","для дома","петрович","максидом","castorama","стройматер"],
 "Маркетплейсы":["ozon","озон","wildberries","вайлдберриз","яндекс маркет","market.yandex","aliexpress","мегамаркет","avito","авито","маркетплейс"],
 "Транспорт":["такси","taxi","метро","автобус","проезд","транспорт","каршеринг","ржд","аэрофлот"],
 "Наличные":["наличн","банкомат","atm","снятие"],
 "Коммуналка":["коммунал","свет","газ","вода","электричеств","жкх","вывоз","квартплат"],
 "Связь":["телефон","связь","интернет","мтс","билайн","мегафон","теле2","tele2","mts","beeline","megafon","rostelecom","ростелеком"],
 "Здоровье":["аптек","врач","клиник","анализ","лекарств","стоматолог","apteka","pharm","медицин","здоровье"],
 "Одежда":["одежд","обув","куртк","штаны","кроссов","спортмастер","sportmaster"],
 "Подписки":["подписк","яндекс плюс","кинопоиск","icloud","spotify","claude","apple.com","google play","yandex plus","plus.yandex"],
 "Развлечения":["кино","театр","боулинг","отдых","игр","бар","развлечен"],
 "Дети и семья":["детск","школ","сад","игрушк","подарок"],
 "Переводы":["перевод","долг","займ"],
 "Кредиты":["кредит","рассрочк"],
 "Ипотека":["ипотек"]
};
const CATS_ALL = Object.fromEntries([...Object.keys(CATS), "Другое"].map(k => [k, 1]));
const fmtD = d => { const x = parseD(d); return x.getDate() + " " + MONTHS_G[x.getMonth()] + " " + x.getFullYear(); };
const INCOME_W = ["зарплат","доход","поступлен","аванс","получил","вернули","кэшбэк","кешбэк"];
const CAT_COLOR = ["#BBEF1F","#FF0055","#EFF8FF","#d6f76a","#ff5c8f","#b9c6d1","#8fb81a","#c20041","#7e8a94"];
function guessCat(s){ s=s.toLowerCase(); for (const [c,ws] of Object.entries(CATS)) if (ws.some(w=>s.includes(w))) return c; return "Другое"; }
function parseQuick(text){
  const s=text.trim().replace(/(\d)\s+(?=\d{3}(?!\d))/g,"$1"); if(!s) return null;
  const m=s.match(/[+]?\d+(?:[.,]\d+)?\s*(к|тыс)?(?=[\s.,]|$|р|₽)/i) || s.match(/[+]?\d+(?:[.,]\d+)?/);
  if(!m) return null;
  let amount=parseFloat(m[0].replace(/[^\d.,]/g,"").replace(",","."));
  if (m[1]) amount*=1000;
  const note=s.replace(m[0],"").replace(/^\s*(рублей|руб|р|₽)\.?(?=\s|$)/i,"").replace(/^[\s,.-]+|[\s,.-]+$/g,"");
  const isInc = s.startsWith("+") || INCOME_W.some(w=>s.toLowerCase().includes(w));
  return {type:isInc?"inc":"exp", amount, note:note||"", cat:isInc?"Доход":guessCat(note)};
}
function quickPreview(v){ if(v && v.value!==undefined) v=v.value; const p=parseQuick(v), el=$("#qPrev"); if(!el) return; el.innerHTML = p?`${p.type==="inc"?'<span class="chip good">доход</span>':'<span class="chip">расход</span>'} <b class="num">${rub(p.amount)}</b> · ${esc(p.cat)}${p.note?" · "+esc(p.note):""}`:'Пример: <span class="num">1000р рыба</span>, <span class="num">5600 дизель</span>, <span class="num">+80000 зарплата</span>'; }
function addQuick(f){ const p=parseQuick(f.q.value); if(!p) return need(f.q,"Начните с суммы, например: 1000 продукты");
  save("money",uid(),{...p,date:f.qd.value||today(),created:Date.now()}); f.q.value=""; quickPreview(""); toast("Записано: "+rub(p.amount)); return false; }
let moneyMonth = today().slice(0,7), moneyTab="dash", moneyPicked=false;
function monthsWithMoney(){ const m={}; arr("money").forEach(x=>{ if(x.date){ const k=x.date.slice(0,7); m[k]=(m[k]||0)+1; } }); return Object.keys(m).sort().reverse().map(k=>[k,m[k]]); }
function pickMonth(k){ moneyMonth=k; moneyPicked=true; render(); }
function shiftMonth(n){ moneyPicked=true;  const [y,m]=moneyMonth.split("-").map(Number); const d=new Date(y,m-1+n,1); moneyMonth=ymd(d).slice(0,7); render(); }
function setBudget(v){ if(v && v.value!==undefined) v=v.value; const st={...(S.meta.settings||{}),budget:+v||0}; save("meta","settings",st); }
function need(el,msg){ el.classList.add("bad"); el.focus(); toast(msg); el.addEventListener("input",()=>el.classList.remove("bad"),{once:true}); return false; }
const numIn = v => parseFloat(String(v).replace(/\s/g,"").replace(",","."));
/* обязательные платежи: подписки, кредиты, ипотека, коммуналка */
const PAY_KINDS = { sub:"Подписка", loan:"Кредит", mortgage:"Ипотека", util:"Коммуналка", other:"Другое" };
const PAY_CAT = { sub:"Подписки", loan:"Кредиты", mortgage:"Ипотека", util:"Коммуналка", other:"Обязательные" };
const payKind = s => PAY_KINDS[s.kind] ? s.kind : "sub";
const isDebt = s => ["loan","mortgage"].includes(payKind(s));
const monthlyOf = s => s.period === "year" ? s.price/12 : s.price;
function addSub(f){
  const name=f.sn.value.trim(), price=numIn(f.sp.value), kind=PAY_KINDS[f.sk.value]?f.sk.value:"sub";
  const rest=f.sr && f.sr.value.trim() ? numIn(f.sr.value) : null;
  if(!name) return need(f.sn,"Напишите название платежа");
  if(!(price>0)) return need(f.sp,"Укажите сумму платежа, например 15000");
  if(rest!==null && !(rest>=0)) return need(f.sr,"Остаток долга — число, например 850000");
  const data={name:name.slice(0,60),price,kind,period:f.spd.value==="year"?"year":"month",next:f.snx.value||today()};
  if(isDebt(data) && rest!==null){ data.rest=rest; data.total=rest; }
  save("subs",uid(),data); f.sn.value=""; f.sp.value=""; if(f.sr) f.sr.value="";
  toast(PAY_KINDS[kind]+" добавлен"+(kind==="mortgage"||kind==="util"?"а":"")); return false;
}
function paySub(id){ const s=S.subs[id]; if(!s) return; const d=parseD(s.next||today()); if(s.period==="year") d.setFullYear(d.getFullYear()+1); else d.setMonth(d.getMonth()+1);
  const upd={...s,next:ymd(d)}; if(isDebt(s) && typeof s.rest==="number") upd.rest=Math.max(0, Math.round((s.rest-s.price)*100)/100);
  save("subs",id,upd); save("money",uid(),{type:"exp",amount:s.price,cat:PAY_CAT[payKind(s)],note:s.name,date:today(),created:Date.now()});
  toast(isDebt(s)&&typeof upd.rest==="number" ? "Платёж записан, остаток "+rub(upd.rest) : "Платёж записан"); }
function setPayKindForm(el){ const f=el.form; if(!f) return; const box=f.querySelector("#sRestBox"); if(box) box.hidden=!["loan","mortgage"].includes(el.value); }

/* графики для аналитики */
function paceChart(cum, budget, labels, todayIdx){
  const W=640, H=180, padT=16, padB=20, padX=12, n=cum.length, max=Math.max(1, budget||0, ...cum)*1.08, step=(W-padX*2)/(n-1||1);
  const y=v=>padT+(H-padT-padB)*(1-v/max);
  const pts=cum.map((v,i)=>[padX+i*step,y(v)]).slice(0, todayIdx+1);
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Расходы нарастающим итогом">`;
  for(let g=0; g<=2; g++){ const yy=padT+(H-padT-padB)*g/2; s+=`<line x1="0" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-dasharray="2 6"/>`; }
  if (budget>0){ const by=y(budget); s+=`<line x1="${padX}" x2="${W-padX}" y1="${by}" y2="${by}" stroke="var(--pink)" stroke-width="1.5" stroke-dasharray="6 5"/><text x="${W-padX}" y="${by-6}" text-anchor="end" style="fill:var(--pink)">бюджет ${esc(compact(budget))}</text>`;
    s+=`<line x1="${padX}" y1="${y(0)}" x2="${W-padX}" y2="${by}" stroke="rgba(239,248,255,.25)" stroke-dasharray="2 4"/>`; }
  if (pts.length){ const d=pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
    s+=`<path d="${d} L${pts[pts.length-1][0]},${y(0)} L${pts[0][0]},${y(0)} Z" fill="rgba(187,239,31,.12)"/><path d="${d}" fill="none" stroke="var(--lime)" stroke-width="2.4" stroke-linejoin="round"/>`;
    const L=pts[pts.length-1]; s+=`<circle cx="${L[0]}" cy="${L[1]}" r="5" fill="var(--lime)" stroke="#0D0303" stroke-width="2"/>`; }
  labels.forEach((l,i)=>{ if(i%5===0 || i===n-1) s+=`<text x="${padX+i*step}" y="${H-4}" text-anchor="middle">${esc(l)}</text>`; });
  return s+`</svg>`;
}
function pairBars(labels, inc, exp){
  const W=640, H=180, padB=20, padT=10, max=Math.max(1,...inc,...exp), gw=W/labels.length, bw=Math.min(26, gw*.3);
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Доходы и расходы по месяцам">`;
  for(let g=1; g<=3; g++){ const y=padT+(H-padT-padB)*(1-g/3); s+=`<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="2 5"/>`; }
  labels.forEach((l,i)=>{ const cx=gw*i+gw/2;
    [[inc[i],"var(--lime)",-1],[exp[i],"var(--pink)",1]].forEach(([v,c,sgn])=>{ const h=(H-padT-padB)*(v/max), x=cx+(sgn<0?-bw-2:2);
      s+=`<rect x="${x}" y="${H-padB-h}" width="${bw}" height="${Math.max(h, v?2:0)}" rx="4" fill="${c}"><title>${esc(l)}: ${fmt(v)} ₽</title></rect>`; });
    s+=`<text x="${cx}" y="${H-4}" text-anchor="middle">${esc(l)}</text>`; });
  return s+`</svg>`;
}
const pct = (a,b) => b ? Math.round((a-b)/b*100) : null;
function monthTotals(ym){ const ops=arr("money").filter(x=>x.date && x.date.startsWith(ym));
  return { exp: ops.filter(x=>x.type==="exp").reduce((s,x)=>s+x.amount,0), inc: ops.filter(x=>x.type==="inc").reduce((s,x)=>s+x.amount,0), ops }; }
const shiftYm = (ym,n) => { const [y,m]=ym.split("-").map(Number); return ymd(new Date(y,m-1+n,1)).slice(0,7); };

function moneyDash(ops, exp, inc, st, subs){
  const [y,m]=moneyMonth.split("-").map(Number), dim=new Date(y,m,0).getDate(), t=today(), isCur=t.slice(0,7)===moneyMonth;
  const daysPassed = isCur ? Number(t.slice(8,10)) : (moneyMonth < t.slice(0,7) ? dim : 0);
  const exps=ops.filter(x=>x.type==="exp");
  if (!exps.length) return `<div class="card"><div class="empty" style="padding:0">В этом месяце расходов нет — графики появятся, когда вы запишете первые траты или загрузите выписку.</div></div>`;
  const perDay=Array(dim).fill(0); exps.forEach(x=>{ const d=Number(x.date.slice(8,10)); if(d>=1&&d<=dim) perDay[d-1]+=x.amount; });
  const cum=[]; perDay.reduce((a,v,i)=>(cum[i]=a+v), 0);
  const avg = daysPassed ? exp/daysPassed : 0, forecast = isCur ? avg*dim : exp;
  const prev = monthTotals(shiftYm(moneyMonth,-1)), dPrev = pct(exp, prev.exp);
  const oblig = subs.reduce((s,x)=>s+monthlyOf(x),0), obligShare = inc ? Math.round(oblig/inc*100) : null;
  // 6 месяцев
  const months=[...Array(6)].map((_,i)=>shiftYm(moneyMonth,i-5)), tot=months.map(monthTotals);
  // дни недели
  const wd=[0,0,0,0,0,0,0], wdN=[0,0,0,0,0,0,0]; for(let d=1; d<=Math.max(daysPassed,1) && d<=dim; d++){ const k=(new Date(y,m-1,d).getDay()+6)%7; wd[k]+=perDay[d-1]; wdN[k]++; }
  const wdAvg=wd.map((v,i)=>wdN[i]?v/wdN[i]:0);
  // категории к прошлому месяцу
  const byCat=c=>{ const o={}; c.filter(x=>x.type==="exp").forEach(x=>o[x.cat]=(o[x.cat]||0)+x.amount); return o; };
  const cNow=byCat(ops), cPrev=byCat(prev.ops);
  const catRows=Object.entries(cNow).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c,v])=>{ const p=pct(v,cPrev[c]||0); return [c,v,cPrev[c]?p:null]; });
  const top=[...exps].sort((a,b)=>b.amount-a.amount).slice(0,5);
  const chip=(p,inverse)=> p===null?`<span class="chip">новое</span>`:`<span class="chip ${(p>0)!==!!inverse?"bad":"good"}">${p>0?"▲":p<0?"▼":"•"} ${Math.abs(p)}%</span>`;
  const budgetLeftPerDay = st.budget && isCur ? Math.max(0, st.budget-exp)/Math.max(1, dim-daysPassed+1) : null;
  return `
  <div class="grid g4">
    <div class="card"><div class="lbl">В среднем в день</div><div class="big">${rub(avg)}</div><div class="mute" style="font-size:13px">за ${daysPassed} ${daysPassed%10===1&&daysPassed!==11?"день":(daysPassed%10>=2&&daysPassed%10<=4&&(daysPassed<12||daysPassed>14))?"дня":"дней"}</div></div>
    <div class="card"><div class="lbl">${isCur?"Прогноз на месяц":"Итого за месяц"}</div><div class="big">${rub(forecast)}</div><div class="mute" style="font-size:13px">${st.budget?(forecast>st.budget?`<span style="color:var(--bad)">выше бюджета на ${rub(forecast-st.budget)}</span>`:`в рамках бюджета`):"бюджет не задан"}</div></div>
    <div class="card"><div class="lbl">К прошлому месяцу</div><div class="big">${dPrev===null?"—":(dPrev>0?"+":"")+dPrev+"%"}</div><div class="mute" style="font-size:13px">${prev.exp?`было ${rub(prev.exp)}`:"нет данных за прошлый месяц"}</div></div>
    <div class="card"><div class="lbl">Обязательные платежи</div><div class="big">${rub(oblig)}</div><div class="mute" style="font-size:13px">${obligShare===null?"в месяц":`${obligShare}% от доходов`}</div></div>
  </div>
  ${budgetLeftPerDay!==null?`<div class="banner" style="background:rgba(187,239,31,.08);border-color:rgba(187,239,31,.3)">Чтобы уложиться в бюджет, тратьте не больше <b class="num">${rub(budgetLeftPerDay)}</b> в день до конца месяца.</div>`:""}
  <div class="grid g2">
    <div class="card"><h2>Расходы нарастающим итогом <span class="lbl">${st.budget?"пунктир — бюджет":"задайте бюджет, чтобы видеть линию"}</span></h2>${paceChart(cum, st.budget||0, perDay.map((_,i)=>String(i+1)), isCur?daysPassed-1:dim-1)}</div>
    <div class="card"><h2>Расходы по дням <span class="lbl">самый дорогой: ${perDay.indexOf(Math.max(...perDay))+1} ${MONTHS_G[m-1]}</span></h2>${barChart(perDay.slice(0, isCur?daysPassed:dim), perDay.slice(0, isCur?daysPassed:dim).map((_,i)=>String(i+1)), "var(--lime)")}</div>
  </div>
  <div class="grid g2">
    <div class="card"><h2>Доходы и расходы за 6 месяцев <span class="lbl"><span class="dot" style="background:var(--lime)"></span> доходы · <span class="dot" style="background:var(--pink)"></span> расходы</span></h2>${pairBars(months.map(k=>MONTHS[Number(k.slice(5,7))-1].slice(0,3)), tot.map(x=>x.inc), tot.map(x=>x.exp))}</div>
    <div class="card"><h2>По дням недели <span class="lbl">в среднем за день</span></h2>${barChart(wdAvg, ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"], "var(--ice)")}</div>
  </div>
  <div class="grid g2">
    <div class="card"><h2>Категории к прошлому месяцу</h2><div class="list">${catRows.map(([c,v,p])=>`<div class="item"><span class="t">${esc(c)}</span><span class="num">${rub(v)}</span>${chip(p)}</div>`).join("")}</div></div>
    <div class="card"><h2>Самые крупные траты</h2><div class="list">${top.map(x=>`<div class="item"><span class="mute num" style="width:60px;white-space:nowrap;flex-shrink:0">${parseD(x.date).getDate()} ${MONTHS_G[parseD(x.date).getMonth()].slice(0,3)}</span><span class="t">${esc(x.note||x.cat)} <span class="chip">${esc(x.cat)}</span></span><span class="num">${rub(x.amount)}</span></div>`).join("")}</div></div>
  </div>`;
}

function paymentsHtml(subs){
  const groups=[["debt","Кредиты и ипотека",s=>isDebt(s)],["sub","Подписки",s=>payKind(s)==="sub"],["rest","Коммуналка и другое",s=>["util","other"].includes(payKind(s))]];
  const row=s=>{ const debt=isDebt(s), hasRest=debt&&typeof s.rest==="number", months=hasRest&&s.price?Math.ceil(s.rest/s.price):null, paid=hasRest&&s.total?Math.min(100,Math.round((1-s.rest/s.total)*100)):null;
    return `<div class="item" style="flex-wrap:wrap">
      <span class="t">${esc(s.name)} <span class="chip">${PAY_KINDS[payKind(s)]}</span> <span class="chip">${s.period==="year"?"раз в год":"в месяц"}</span>
        ${hasRest?`<div class="mute" style="font-size:13px;margin-top:4px">Остаток ${rub(s.rest)}${months?` · ещё ≈ ${months} ${months%10===1&&months%100!==11?"платёж":(months%10>=2&&months%10<=4&&(months%100<12||months%100>14))?"платежа":"платежей"}`:""}</div>${paid!==null?`<div class="paybar"><b style="width:${paid}%"></b></div><div class="mute" style="font-size:12px">выплачено ${paid}%</div>`:""}`:""}</span>
      <span class="mute">${s.next?dLabel(s.next):""}</span><span class="num">${rub(s.price)}</span>
      <button class="btn sm" data-click="paySub" ${A(s.id)} title="Записать расход и перенести дату">Оплачено</button><button class="icon" aria-label="Удалить" data-click="del" ${A("subs",s.id)}>${ICO.x}</button></div>`; };
  const total=subs.reduce((a,s)=>a+monthlyOf(s),0), debt=subs.filter(isDebt).reduce((a,s)=>a+(typeof s.rest==="number"?s.rest:0),0);
  return `<form class="card form" data-submit="addSub">
      <label>Тип<select id="sKind" name="sk" data-change="setPayKindForm">${Object.entries(PAY_KINDS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>Название<input type="text" id="sName" name="sn" placeholder="Ипотека Сбер, Яндекс Плюс…" maxlength="60"></label>
      <label>Платёж, ₽<input type="text" inputmode="decimal" id="sPrice" name="sp" placeholder="15000" autocomplete="off"></label>
      <label>Период<select id="sPer" name="spd"><option value="month">Каждый месяц</option><option value="year">Раз в год</option></select></label>
      <label>Следующий платёж<input type="date" id="sNext" name="snx" value="${today()}"></label>
      <label id="sRestBox" hidden>Остаток долга, ₽<input type="text" inputmode="decimal" id="sRest" name="sr" placeholder="850000" autocomplete="off"></label>
      <button class="btn pri">Добавить</button></form>
    <div class="grid g2">
      <div class="card"><div class="lbl">Все обязательные платежи в месяц</div><div class="big">${rub(total)}</div></div>
      <div class="card"><div class="lbl">Общий остаток по кредитам</div><div class="big">${debt?rub(debt):"—"}</div></div>
    </div>
    ${subs.length?groups.map(([k,n,f])=>{ const g=subs.filter(f); return g.length?`<div class="card"><h2>${n} <span class="mute num">${rub(g.reduce((a,s)=>a+monthlyOf(s),0))} / мес</span></h2><div class="list">${g.map(row).join("")}</div></div>`:""; }).join("")
      :`<div class="card"><div class="empty" style="padding:0">Платежей пока нет. Добавьте кредит, ипотеку, подписку или коммуналку — Pulse напомнит на «Обзоре» и в календаре, а кнопка «Оплачено» сама запишет расход.</div></div>`}`;
}

function vMoney(){
  const st=settings(), [y,m]=moneyMonth.split("-").map(Number);
  const ops=arr("money").filter(x=>x.date && x.date.startsWith(moneyMonth)).sort((a,b)=>b.date.localeCompare(a.date)||(b.created||0)-(a.created||0));
  const exp=ops.filter(x=>x.type==="exp").reduce((s,x)=>s+x.amount,0), inc=ops.filter(x=>x.type==="inc").reduce((s,x)=>s+x.amount,0);
  const byCat={}; ops.filter(x=>x.type==="exp").forEach(x=>byCat[x.cat]=(byCat[x.cat]||0)+x.amount);
  const cats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]); const cmax=cats.length?cats[0][1]:1;
  const subs=arr("subs").sort((a,b)=>(a.next||"").localeCompare(b.next||""));
  const subMonth=subs.reduce((s,x)=>s+monthlyOf(x),0);
  const left = st.budget ? st.budget-exp : null;
  return `<div class="spread"><div><h1>Финансы</h1><div class="sub">${MONTHS[m-1]} ${y}</div></div>
    <div class="row"><button class="btn sm" data-click="shiftMonth" ${A(-1)} aria-label="Предыдущий месяц">${ICO.left}</button><button class="btn sm" data-click="shiftMonth" ${A(1)} aria-label="Следующий месяц">${ICO.right}</button></div></div>
  ${(()=>{ const ms=monthsWithMoney(); if(!ms.length) return ""; return `<div class="tabs" role="tablist" aria-label="Месяцы с операциями">${ms.map(([k,n])=>{ const [yy,mm]=k.split("-").map(Number); return `<button class="${k===moneyMonth?"on":""}" data-click="pickMonth" ${A(k)}>${MONTHS[mm-1]}${yy!==new Date().getFullYear()?" "+yy:""}<span class="num">${n}</span></button>`; }).join("")}</div>`; })()}
  ${!ops.length && monthsWithMoney().length && moneyTab!=="subs" ? `<div class="banner">В этом месяце операций нет. Выберите месяц выше — например, ${(()=>{const [yy,mm]=monthsWithMoney()[0][0].split("-").map(Number);return MONTHS[mm-1];})()}.</div>` : ""}
  <form class="card" data-submit="addQuick"><div class="lbl" style="margin-bottom:8px">Быстрая запись</div>
    <div class="compose"><input type="text" id="qText" aria-label="Сумма и на что потрачено" name="q" placeholder="1000р рыба" autocomplete="off" data-input="quickPreview"><input type="date" id="qDate" aria-label="Дата операции" name="qd" value="${today()}" style="max-width:170px"><button class="btn pri">Записать</button></div>
    <div id="qPrev" class="mute" style="font-size:13px;margin-top:8px"></div></form>
  ${impHtml()}
  <div class="hero">
    <div class="tile a"><span class="corner">${ICO.ruble}</span><div><div class="lbl">Баланс месяца</div><div class="big">${rub(inc-exp)}</div></div><div class="mute">доходы ${rub(inc)}</div></div>
    <div class="tile b"><span class="corner">${ICO.down}</span><div><div class="lbl">Расходы</div><div class="big">${rub(exp)}</div></div><div class="mute">${ops.filter(x=>x.type==="exp").length} операций</div></div>
    <div class="tile"><div class="lbl">Бюджет на месяц</div><input type="number" id="budget" aria-label="Бюджет на месяц, рублей" value="${esc(st.budget||"")}" placeholder="не задан" data-change="setBudget" style="width:100%;font-size:18px"><div class="${left!==null&&left<0?"":"mute"}" style="${left!==null&&left<0?"color:var(--bad)":""}">${left===null?"задайте лимит":left>=0?"осталось "+rub(left):"перерасход "+rub(-left)}</div></div>
    <div class="tile"><div class="lbl">Обязательные в месяц</div><div class="big">${rub(subMonth)}</div><div class="mute">${subs.length} платеж${subs.length%10===1&&subs.length%100!==11?"":(subs.length%10>=2&&subs.length%10<=4&&(subs.length%100<12||subs.length%100>14))?"а":"ей"}</div></div>
  </div>
  <div class="tabs">${[["dash","Аналитика"],["ops","Операции"],["cats","По категориям"],["subs","Обязательные платежи"]].map(([k,n])=>`<button class="${k===moneyTab?"on":""}" data-click="moneyTab" ${A(k)}>${n}</button>`).join("")}</div>
  ${moneyTab==="dash"?moneyDash(ops, exp, inc, st, subs):""}
  ${moneyTab==="cats"?`<div class="card"><div class="row" style="gap:26px;align-items:center">${cats.length?donut(cats.map(([c,v],i)=>[c,v,CAT_COLOR[i%CAT_COLOR.length]]),compact(exp)):""}<div class="bars" style="flex:1;min-width:240px">${cats.length?cats.map(([c,v],i)=>`<div class="bar"><span>${esc(c)}</span><i><b style="width:${v/cmax*100}%;background:${CAT_COLOR[i%CAT_COLOR.length]}"></b></i><span class="num" style="text-align:right">${rub(v)}</span></div>`).join(""):`<div class="empty">В этом месяце расходов нет.</div>`}</div></div></div>`:""}
  ${moneyTab==="ops"?`<div class="card"><div class="list">${ops.length?ops.map(x=>`<div class="item"><span class="mute num" style="width:52px">${parseD(x.date).getDate()} ${MONTHS_G[parseD(x.date).getMonth()].slice(0,3)}</span><span class="t">${esc(x.note||x.cat)} <span class="chip">${esc(x.cat)}</span></span><span class="num" style="color:${x.type==="inc"?"var(--good)":"var(--fg)"}">${x.type==="inc"?"+":"−"}${rub(x.amount)}</span><button class="icon" aria-label="Удалить" data-click="del" ${A("money",x.id)}>${ICO.x}</button></div>`).join(""):`<div class="empty">Операций нет. Запишите первую строкой выше, например «5600 дизель».</div>`}</div></div>`:""}
  ${moneyTab==="subs"?paymentsHtml(subs):""}`;
}


/* ---------- загрузка банковской выписки ---------- */
// Файл разбирается прямо в браузере (bank.js + pdf.js из vendor/), на сервер уходят только операции.
let imp = null; // { name, ops:[{date,type,amount,desc,cat,key,on,dup}], error, busy }
const IMP_MAX_BYTES = 25 * 1024 * 1024;
const BANK_CAT = [[/дом и ремонт|для дома|строймат/i,"Дом и стройка"],[/супермаркет|продукт/i,"Еда"],[/фастфуд|ресторан|кафе/i,"Кафе"],
  [/топлив|азс/i,"Топливо"],[/автоуслуг|автомобил|авто/i,"Авто и ремонт"],[/транспорт|такси|каршер/i,"Транспорт"],[/аптек|медицин|здоров|красот/i,"Здоровье"],
  [/связь|интернет|телеком/i,"Связь"],[/жкх|коммунал/i,"Коммуналка"],[/одежд|обув/i,"Одежда"],[/развлеч|отдых|кино/i,"Развлечения"],
  [/маркетплейс/i,"Маркетплейсы"],[/наличн|банкомат/i,"Наличные"],[/подписк|цифров/i,"Подписки"],[/перевод/i,"Переводы"]];
function catFor(o){
  if (o.type === "inc") return "Доход";
  const bc = (BANK_CAT.find(([re]) => o.bankCat && re.test(o.bankCat)) || [])[1];
  if (bc) return bc;
  const g = guessCat(o.desc || ""); if (g !== "Другое") return g;
  return (BANK_CAT.find(([re]) => re.test(o.desc || "")) || [])[1] || "Другое";
}
function loadPdfJs(){
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((res, rej) => {
    const sc = document.createElement("script"); sc.src = "vendor/pdfjs/pdf.min.js";
    sc.onload = () => { const L = window.pdfjsLib; if (!L) return rej(new Error("pdfjs")); L.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js"; res(L); };
    sc.onerror = () => rej(new Error("pdfjs")); document.head.appendChild(sc);
  });
}
async function pdfItems(u8){
  const L = await loadPdfJs();
  // isEvalSupported:false — pdf.js не исполняет код из файла (защита от вредоносных PDF); шрифты не рисуем, нужен только текст
  const doc = await L.getDocument({ data: u8.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, cMapUrl: "vendor/pdfjs/cmaps/", cMapPacked: true }).promise;
  const items = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      tc.items.forEach(it => { if (typeof it.str === "string") items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height, page: i }); });
    }
  } finally { doc.destroy(); }
  return items;
}
async function readStatement(name, u8){
  const B = window.BankImport, kind = B.kindOf(name, u8);
  try {
    if (kind === "pdf") {
      const items = await pdfItems(u8);
      if (!items.some(it => it.str.trim())) return { ops: [], error: "В этом PDF нет текста — похоже, это скан или фото. Скачайте выписку заново в приложении банка (PDF, CSV или Excel)." };
      const lines = B.itemsToLines(items);
      return { ops: B.finalize(B.decideTypes(B.parseTextLines(lines))), lines };
    }
    if (kind === "xls") return { ops: [], error: "Это старый формат Excel (.xls). Откройте файл и сохраните как .xlsx, или скачайте выписку в PDF или CSV." };
    if (kind === "xlsx") return B.fromTable(await B.readXlsx(u8));
    return B.fromTable(B.parseCSV(B.decodeText(u8)));
  } catch (e) {
    if (e && e.name === "PasswordException") return { ops: [], error: "Файл защищён паролем. Скачайте выписку без пароля." };
    return { ops: [], error: "Не получилось прочитать файл. Подойдёт выписка в PDF, CSV или Excel (.xlsx) из приложения банка." };
  }
}
async function stmtFile(file){
  if (!file) return;
  if (file.size > IMP_MAX_BYTES) { imp = { name: file.name, ops: [], error: "Файл больше 25 МБ. Скачайте выписку за меньший период." }; render(); return; }
  imp = { name: file.name, ops: [], busy: true }; render();
  const u8 = new Uint8Array(await file.arrayBuffer());
  const r = await readStatement(file.name, u8);
  const loose = new Set(arr("money").map(m => [m.date, m.type, Number(m.amount).toFixed(2)].join("|")));
  const ops = (r.ops || []).map(o => {
    const dup = S.money[o.key] ? "уже загружено" : loose.has([o.date, o.type, o.amount.toFixed(2)].join("|")) ? "похоже, уже записано" : "";
    return { date: o.date, type: o.type, amount: o.amount, desc: o.desc, cat: catFor(o), key: o.key, on: !dup, dup };
  }).sort((a, b) => a.date.localeCompare(b.date));
  imp = { name: file.name, ops, error: r.error || (ops.length ? "" : "Не нашёл в файле операций. Пришлите мне эту выписку в чат — настрою под ваш банк.") };
  render();
}
function stmtPick(el){ const f = el.files && el.files[0]; el.value = ""; stmtFile(f); }
function impTotals(){ const on = imp.ops.filter(o => o.on); return { n: on.length, exp: on.filter(o => o.type === "exp").reduce((s, o) => s + o.amount, 0), inc: on.filter(o => o.type === "inc").reduce((s, o) => s + o.amount, 0) }; }
function impSumHtml(){ const t = impTotals(); return `Выбрано <b class="num">${t.n}</b> из ${imp.ops.length} · расходы <b class="num">${rub(t.exp)}</b> · доходы <b class="num">${rub(t.inc)}</b>`; }
function drawImpSum(){ const el = $("#impSum"), b = $("#impSave"); if (el) el.innerHTML = impSumHtml(); if (b) { const n = impTotals().n; b.disabled = !n; b.textContent = n ? "Загрузить " + n : "Ничего не выбрано"; } }
function stmtToggle(i, el){ if (imp && imp.ops[i]) { imp.ops[i].on = !!el.checked; const r = el.closest(".improw"); if (r) r.classList.toggle("off", !el.checked); drawImpSum(); } }
function stmtAll(on){ if (!imp) return; imp.ops.forEach(o => o.on = on && !o.dup ? true : on ? o.on : false); render(); }
function stmtCat(i, el){ if (imp && imp.ops[i] && Object.prototype.hasOwnProperty.call(CATS_ALL, el.value)) imp.ops[i].cat = el.value; }
function stmtCancel(){ imp = null; render(); }
async function stmtSave(){
  if (!imp || imp.busy) return;
  const list = imp.ops.filter(o => o.on);
  if (!list.length) return;
  const now = Date.now();
  const rows = list.map((o, i) => ({ col: "money", id: o.key, data: { type: o.type, amount: o.amount, cat: o.cat, note: o.desc, date: o.date, created: now + i, src: "bank" } }));
  imp.busy = true; drawImpSum();
  rows.forEach(r => S.money[r.id] = r.data);
  try {
    for (let i = 0; i < rows.length; i += 500)
      await api("items?on_conflict=user_id,col,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: rows.slice(i, i + 500) });
  } catch (e) {
    imp.busy = false; handleErr(e);
    try { await loadAll(); } catch (_) {}
    return;
  }
  const months = {}; list.forEach(o => { const k = o.date.slice(0, 7); months[k] = (months[k] || 0) + 1; });
  moneyMonth = Object.entries(months).sort((a, b) => b[1] - a[1])[0][0]; moneyPicked = true; moneyTab = "ops";
  imp = null; render(); toast("Загружено операций: " + list.length);
}
function impHtml(){
  if (!imp) return `<div class="card drop" id="stmtDrop"><div class="spread" style="gap:12px"><div><div class="lbl">Выписка из банка</div>
      <div class="mute" style="font-size:13px;margin-top:4px">Перетащите файл сюда или выберите его. Подойдёт PDF, CSV или Excel из любого банка. Перед сохранением покажу, что нашлось.</div></div>
      <label class="btn" for="stmtIn">Загрузить выписку</label></div>
      <input type="file" id="stmtIn" class="vh" accept=".pdf,.csv,.xlsx,.xls,.txt,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-change="stmtPick"></div>`;
  if (imp.busy && !imp.ops.length) return `<div class="card"><div class="lbl">Выписка: ${esc(imp.name)}</div><div class="mute" style="margin-top:6px">Читаю файл…</div></div>`;
  if (imp.error && !imp.ops.length) return `<div class="card"><div class="spread"><div class="lbl">Выписка: ${esc(imp.name)}</div><button class="btn sm" data-click="stmtCancel">Закрыть</button></div><div class="banner" style="margin-top:10px">${esc(imp.error)}</div></div>`;
  const first = imp.ops[0].date, last = imp.ops[imp.ops.length - 1].date, dups = imp.ops.filter(o => o.dup).length;
  const cats = Object.keys(CATS_ALL);
  return `<div class="card imp"><div class="spread" style="gap:10px"><div><h2 style="margin:0">Проверьте операции из выписки</h2>
      <div class="mute" style="font-size:13px;margin-top:4px">${esc(imp.name)} · ${fmtD(first)} – ${fmtD(last)}${dups?` · ${dups} уже есть в Pulse, их не отметил`:""}</div></div>
      <div class="row" style="gap:8px"><button class="btn sm" data-click="stmtAll" ${A(true)}>Отметить все</button><button class="btn sm" data-click="stmtAll" ${A(false)}>Снять все</button></div></div>
    <div id="impSum" class="banner" style="margin:12px 0">${impSumHtml()}</div>
    <div class="list implist">${imp.ops.map((o, i) => `<label class="item improw ${o.on?"":"off"}">
        <input type="checkbox" ${o.on?"checked":""} data-change="stmtToggle" ${A(i)} aria-label="Загрузить операцию ${esc(o.desc)}">
        <span class="mute num idate">${parseD(o.date).getDate()} ${MONTHS_G[parseD(o.date).getMonth()].slice(0,3)}</span>
        <span class="t">${esc(o.desc || "Без описания")}${o.dup?` <span class="chip">${esc(o.dup)}</span>`:""}</span>
        ${o.type==="exp"?`<select aria-label="Категория" data-change="stmtCat" ${A(i)}>${cats.map(c=>`<option ${c===o.cat?"selected":""}>${esc(c)}</option>`).join("")}</select>`:`<span class="chip good">доход</span>`}
        <span class="num iamt" style="color:${o.type==="inc"?"var(--good)":"var(--fg)"}">${o.type==="inc"?"+":"−"}${rub(o.amount)}</span></label>`).join("")}</div>
    <div class="row" style="justify-content:flex-end;gap:10px;margin-top:14px"><button class="btn" data-click="stmtCancel">Отмена</button><button class="btn pri" id="impSave" data-click="stmtSave" ${impTotals().n?"":"disabled"}>${impTotals().n?"Загрузить "+impTotals().n:"Ничего не выбрано"}</button></div></div>`;
}

/* ---------- HABITS ---------- */
const DAYS_ORDER=[1,2,3,4,5,6,0];
function habitDue(x,d){ const days=x.days&&x.days.length?x.days:[0,1,2,3,4,5,6]; return days.includes(parseD(d).getDay()) && (!x.start || d>=x.start); }
function habitStreak(x){
  const log=x.log||{}; let d=today(), n=0, guard=0;
  if (!log[d]) d=addDays(d,-1);
  while (guard++<400){ if (habitDue(x,d)){ if(log[d]) n++; else break; } if (x.start && d<x.start) break; d=addDays(d,-1); }
  return n;
}
function habitRate(x,days=30){ let due=0,done=0; for(let i=0;i<days;i++){ const d=addDays(today(),-i); if(x.start && d<x.start) break; if(habitDue(x,d)){ due++; if((x.log||{})[d]) done++; } } return due?Math.round(done/due*100):0; }
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
function toggleHabit(id,d){ const x=S.habits[id]; if(!x) return; d=(typeof d==="string"&&DATE_RE.test(d))?d:today(); const log={}; Object.keys(x.log||{}).forEach(k=>{ if(DATE_RE.test(k)) log[k]=true; }); if(log[d]) delete log[d]; else log[d]=true; save("habits",id,{...x,log}); }
function daysText(days){ if(!days||!days.length||days.length===7) return "каждый день"; const k=[...days].sort((a,b)=>DAYS_ORDER.indexOf(a)-DAYS_ORDER.indexOf(b)); if(k.join()==="1,2,3,4,5") return "по будням"; if(k.join()==="6,0") return "по выходным"; return k.map(i=>WD[i]).join(", "); }
function addHabit(f){
  const name=f.hn.value.trim(); if(!name) return need(f.hn,"Напишите название привычки");
  const days=[...f.querySelectorAll('input[name=hd]:checked')].map(c=>+c.value);
  if(!days.length){ toast("Выберите хотя бы один день"); return false; }
  save("habits",uid(),{name,time:f.ht.value||"",days,log:{},start:today(),created:Date.now()});
  f.hn.value=""; toast("Привычка добавлена"); return false;
}
function habitStrip(){
  const t=today(), hs=arr("habits").filter(x=>habitDue(x,t)).sort((a,b)=>(a.time||"99").localeCompare(b.time||"99"));
  if(!hs.length) return "";
  return `<div><div class="lbl" style="margin-bottom:8px">Привычки сегодня · ${hs.filter(x=>(x.log||{})[t]).length} из ${hs.length}</div><div class="hstrip">${hs.map(x=>`<button class="hpill ${(x.log||{})[t]?"on":""}" aria-pressed="${!!(x.log||{})[t]}" data-click="toggleHabit" ${A(x.id)}><b></b>${esc(x.name)}${x.time?` <span class="num mute">${esc(x.time)}</span>`:""}</button>`).join("")}</div></div>`;
}
function vHabits(){
  const t=today(), hs=arr("habits").sort((a,b)=>(a.time||"99").localeCompare(b.time||"99")||(a.created||0)-(b.created||0));
  const dueToday=hs.filter(x=>habitDue(x,t)), doneToday=dueToday.filter(x=>(x.log||{})[t]).length;
  const last7=Array.from({length:7},(_,i)=>addDays(t,i-6));
  return `<div><h1>Привычки</h1><div class="sub">${dueToday.length?`Сегодня ${doneToday} из ${dueToday.length}`:"Добавьте первую привычку"}</div></div>
  <form class="card" data-submit="addHabit">
    <div class="form hform">
      <label>Привычка<input type="text" id="hName" name="hn" placeholder="Зарядка 10 минут" autocomplete="off"></label>
      <label>Напоминание<input type="time" id="hTime" name="ht" value="08:00"></label>
    </div>
    <div class="spread" style="margin-top:12px">
      <div class="daypick">${DAYS_ORDER.map(i=>`<label><input type="checkbox" name="hd" id="hd${i}" value="${i}" checked><span>${WD[i]}</span></label>`).join("")}</div>
      <button class="btn pri">Добавить привычку</button>
    </div>
  </form>
  ${hs.length?`<div class="habs">${hs.map(x=>{ const due=habitDue(x,t), on=!!(x.log||{})[t], st=habitStreak(x);
    return `<div class="card hab">
      <div class="hab-top"><button class="hab-check ${on?"on":""}" ${due?"":"disabled"} aria-pressed="${on}" aria-label="Отметить: ${esc(x.name)}" data-click="toggleHabit" ${A(x.id)}>${on?ICO.check:""}</button>
        <div style="flex:1;min-width:0"><div class="hab-name">${esc(x.name)}</div><div class="mute" style="font-size:13px">${daysText(x.days)}${x.time?" · "+esc(x.time):""}${due?"":" · сегодня выходной"}</div></div>
        <button class="icon" aria-label="Удалить" data-click="del" ${A("habits",x.id)}>${ICO.x}</button></div>
      <div class="week7">${last7.map(d=>{ const dd=habitDue(x,d), dn=(x.log||{})[d]; return `<div><i class="${dn?"on":dd?"":"off"}" ${dd&&d!==t?`role="button" tabindex="0" aria-pressed="${!!dn}" aria-label="${esc(x.name)}, ${dLabel(d)}" data-click="toggleHabit" ${A(x.id,d)}`:""}></i>${WD[parseD(d).getDay()]}</div>`; }).join("")}</div>
      <div class="spread"><span class="chip">${st?`серия ${st} ${st%10===1&&st%100!==11?"день":(st%10>=2&&st%10<=4&&(st%100<12||st%100>14))?"дня":"дней"}`:"серия не начата"}</span><span class="mute" style="font-size:13px">за 30 дней ${habitRate(x)}%</span></div>
    </div>`; }).join("")}</div>`:`<div class="card"><div class="empty" style="padding:0">Привычек пока нет. Например: зарядка, вода утром, 20 минут чтения, без телефона после 23:00.</div></div>`}`;
}

/* ---------- NOTES ---------- */
const STICKERS = [["star","⭐","Важное"],["fire","🔥","Срочно"],["idea","💡","Идея"],["check","✅","Сделано"],["heart","❤️","Любимое"],["money","💰","Деньги"],["home","🏠","Дом"],["work","🚚","Работа"],["book","📚","Учёба"],["pin","📍","Место"]];
const STK = Object.fromEntries(STICKERS.map(([k,e,n])=>[k,{e,n}]));
let curNote=null, noteTimer=null, noteGroup=null, noteSticker=null, noteQuery="";
const noteGroups = () => [...new Set(arr("notes").map(n=>(n.group||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
const cleanStickers = v => Array.isArray(v) ? v.filter(k=>STK[k]).slice(0,10) : [];
function noteData(id){ const n=S.notes[id]||{}; return { title:n.title||"", text:n.text||"", group:(n.group||"").slice(0,30), stickers:cleanStickers(n.stickers), pinned:!!n.pinned, updated:n.updated||Date.now() }; }
function saveNote(id, patch){ save("notes", id, { ...noteData(id), ...patch, updated: Date.now() }); }
function newNote(){ const id=uid(); curNote=id; save("notes",id,{title:"",text:"",group: noteGroup || "",stickers: noteSticker ? [noteSticker] : [],pinned:false,updated:Date.now()}); setTimeout(()=>{const e=$("#noteTitle"); e&&e.focus();},0); }
function noteInput(){ clearTimeout(noteTimer); noteTimer=setTimeout(()=>{ if(!curNote || !S.notes[curNote]) return; saveNote(curNote, {title:$("#noteTitle").value.slice(0,200), text:$("#noteText").value.slice(0,12000)}); drawNoteList(); },700); }
function pickNote(id){ curNote=id; render(); }
function setNoteGroup(el){ if(!curNote) return; saveNote(curNote, {group: String(el.value||"").trim().slice(0,30)}); }
function toggleSticker(k){ if(!curNote || !STK[k]) return; const st=noteData(curNote).stickers; saveNote(curNote, {stickers: st.includes(k) ? st.filter(x=>x!==k) : [...st, k]}); }
function togglePin(){ if(!curNote) return; saveNote(curNote, {pinned: !noteData(curNote).pinned}); }
function noteFilterGroup(g){ noteGroup = g; render(); }
function noteFilterSticker(k){ noteSticker = noteSticker===k ? null : k; render(); }
function noteSearch(el){ noteQuery = String(el.value||"").trim().toLowerCase().slice(0,60); drawNoteList(); }
function filteredNotes(){
  return arr("notes").filter(n=>{
    if (noteGroup===""  && (n.group||"").trim()) return false;
    if (noteGroup && (n.group||"").trim()!==noteGroup) return false;
    if (noteSticker && !cleanStickers(n.stickers).includes(noteSticker)) return false;
    if (noteQuery && !((n.title||"")+" "+(n.text||"")+" "+(n.group||"")).toLowerCase().includes(noteQuery)) return false;
    return true;
  }).sort((a,b)=>(!!b.pinned-!!a.pinned)||(b.updated||0)-(a.updated||0));
}
function drawNoteList(){ const el=$("#noteItems"); if(!el) return; el.innerHTML=noteListHtml(); }
function noteListHtml(){
  const ns=filteredNotes();
  return ns.length?ns.map(n=>{ const st=cleanStickers(n.stickers); return `<div class="nitem ${n.id===curNote?"on":""}" role="button" tabindex="0" aria-current="${n.id===curNote}" data-click="pickNote" ${A(n.id)}>
      <div class="nhead">${n.pinned?`<span class="npin" title="Закреплено">${ICO.pin}</span>`:""}<span class="ntitle">${esc(n.title||"Без названия")}</span>${st.length?`<span class="nstk" aria-label="Стикеры: ${esc(st.map(k=>STK[k].n).join(", "))}">${st.map(k=>STK[k].e).join("")}</span>`:""}</div>
      <div class="x">${esc((n.text||"").slice(0,80))||"пусто"}</div>
      ${(n.group||"").trim()?`<div><span class="chip ngroup">${esc(n.group.trim())}</span></div>`:""}</div>`; }).join(""):`<div class="empty">${arr("notes").length?"Ничего не найдено. Сбросьте фильтр или поиск.":"Заметок нет."}</div>`;
}
function vNotes(){
  const all=arr("notes"), list=filteredNotes();
  if(!curNote || !S.notes[curNote]) curNote = list[0]?.id || null;
  const n=curNote?noteData(curNote):null, groups=noteGroups(), noGroup=all.filter(x=>!(x.group||"").trim()).length;
  const usedSt=STICKERS.filter(([k])=>all.some(x=>cleanStickers(x.stickers).includes(k)));
  return `<div class="spread"><div><h1>Заметки</h1><div class="sub">${all.length} заметок${groups.length?` · ${groups.length} групп${groups.length%10===1&&groups.length!==11?"а":(groups.length%10>=2&&groups.length%10<=4&&(groups.length<12||groups.length>14))?"ы":""}`:""}</div></div><button class="btn pri" data-click="newNote">Новая заметка</button></div>
  <div class="ngroups" role="tablist" aria-label="Группы заметок">
    <button class="gchip ${noteGroup===null?"on":""}" data-click="noteFilterGroup" ${A(null)}>Все <span class="num">${all.length}</span></button>
    ${groups.map(g=>`<button class="gchip ${noteGroup===g?"on":""}" data-click="noteFilterGroup" ${A(g)}>${esc(g)} <span class="num">${all.filter(x=>(x.group||"").trim()===g).length}</span></button>`).join("")}
    ${groups.length&&noGroup?`<button class="gchip ${noteGroup===""?"on":""}" data-click="noteFilterGroup" ${A("")}>Без группы <span class="num">${noGroup}</span></button>`:""}
  </div>
  ${usedSt.length?`<div class="row" style="gap:6px" aria-label="Фильтр по стикерам">${usedSt.map(([k,e,nm])=>`<button class="stk ${noteSticker===k?"on":""}" data-click="noteFilterSticker" ${A(k)} aria-pressed="${noteSticker===k}" title="${esc(nm)}">${e} <span>${esc(nm)}</span></button>`).join("")}</div>`:""}
  <div class="notes"><div class="card nlist">
      <input type="text" id="noteSearch" aria-label="Поиск по заметкам" placeholder="Поиск" value="${esc(noteQuery)}" data-input="noteSearch" autocomplete="off" style="width:100%;margin-bottom:10px">
      <div id="noteItems">${noteListHtml()}</div></div>
   <div class="card">${n?`<div class="spread" style="margin-bottom:10px;flex-wrap:nowrap"><input type="text" id="noteTitle" aria-label="Заголовок заметки" value="${esc(n.title)}" placeholder="Заголовок" data-input="noteInput" maxlength="200" style="flex:1;font-size:18px;font-weight:600">
       <button class="btn sm pinbtn ${n.pinned?"on":""}" data-click="togglePin" aria-pressed="${n.pinned}" title="${n.pinned?"Открепить":"Закрепить сверху"}">${ICO.pin}<span>${n.pinned?"Закреплено":"Закрепить"}</span></button></div>
     <div class="nmeta">
       <label class="lbl" for="noteGroupIn">Группа</label>
       <input type="text" id="noteGroupIn" list="noteGroupList" value="${esc(n.group)}" placeholder="например: Дом, Работа, Идеи" maxlength="30" data-change="setNoteGroup" autocomplete="off">
       <datalist id="noteGroupList">${groups.map(g=>`<option value="${esc(g)}"></option>`).join("")}</datalist>
     </div>
     <div class="lbl" style="margin:12px 0 6px">Стикеры</div>
     <div class="stkrow">${STICKERS.map(([k,e,nm])=>`<button class="stk ${n.stickers.includes(k)?"on":""}" data-click="toggleSticker" ${A(k)} aria-pressed="${n.stickers.includes(k)}" title="${esc(nm)}">${e} <span>${esc(nm)}</span></button>`).join("")}</div>
     <textarea id="noteText" aria-label="Текст заметки" rows="14" placeholder="Текст заметки" data-input="noteInput" maxlength="12000" style="margin-top:12px">${esc(n.text)}</textarea>
     <div class="spread" style="margin-top:8px"><span class="mute" style="font-size:12px">Сохраняется само</span><button class="btn sm" data-click="delNote" ${A(curNote)}>Удалить</button></div>`
     :`<div class="empty">${all.length?"Выберите заметку слева или создайте новую.":"Нажмите «Новая заметка», чтобы начать."}</div>`}</div></div>`;
}

/* ---------- BOARD ---------- */
const KCOLS=[["idea","Идеи"],["doing","В работе"],["done","Готово"]];
function addCard(f,col){ const t=f.c.value.trim(); if(!t) return need(f.c,"Напишите текст карточки"); save("board",uid(),{title:t,col,updated:Date.now()}); f.c.value=""; return false; }
function moveCard(id,dir){ const c=S.board[id]; const i=KCOLS.findIndex(k=>k[0]===c.col)+dir; if(i<0||i>2) return; save("board",id,{...c,col:KCOLS[i][0],updated:Date.now()}); }
function boardHtml(){
  const cs=arr("board").sort((a,b)=>(b.updated||0)-(a.updated||0));
  return `<div class="spread" style="margin-top:6px"><div><h2 style="font-size:20px">Доски</h2><div class="sub">Идеи и дела, которые двигаются по этапам</div></div></div>
  <div class="kan">${KCOLS.map(([k,n],ci)=>{ const items=cs.filter(c=>c.col===k); return `<div class="card"><h2>${n} <span class="mute num">${items.length}</span></h2>
    <div style="display:flex;flex-direction:column;gap:8px">${items.map(c=>`<div class="kcard"><div>${esc(c.title)}</div><div class="spread"><div class="row">${ci>0?`<button class="btn sm" data-click="moveCard" ${A(c.id,-1)} aria-label="Назад">${ICO.left}</button>`:""}${ci<2?`<button class="btn sm" data-click="moveCard" ${A(c.id,1)} aria-label="Вперёд">${ICO.right}</button>`:""}</div><button class="icon" aria-label="Удалить" data-click="del" ${A("board",c.id)}>${ICO.x}</button></div></div>`).join("")}</div>
    <form data-submit="addCard" ${A(k)} class="compose" style="margin-top:10px"><input type="text" id="kAdd${k}" aria-label="Новая карточка в колонку ${n}" name="c" placeholder="Новая карточка" autocomplete="off"><button class="btn sm">+</button></form></div>`;}).join("")}</div>`;
}

/* ---------- actions: единый диспетчер вместо onclick в разметке ---------- */
const A = (...args) => `data-args="${esc(JSON.stringify(args))}"`;
const ACTIONS = {
  go, del, toggleTask, quickDay, shiftMonth, pickMonth, paySub, toggleHabit, pickNote, newNote, noteInput, moveCard,
  setPayKindForm, setNoteGroup, noteSearch, toggleSticker, togglePin, noteFilterGroup, noteFilterSticker,
  stmtPick, stmtToggle, stmtAll, stmtCat, stmtCancel, stmtSave,
  homeTab: k => { homeTab = k; render(); },
  taskTab: k => { taskTab = k; render(); },
  healthTab: k => { healthTab = k; render(); },
  moneyTab: k => { moneyTab = k; render(); },
  weekShift: n => { weekStart = addDays(weekStart, n); render(); },
  weekToday: () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); weekStart = ymd(d); render(); },
  setHNum: (field, el) => { const v = field === "steps" ? parseInt(el.value, 10) : parseFloat(String(el.value).replace(",", ".")); setH(field, v); },
  water: d => { const h = S.health[today()] || {}; setH("water", Math.max(0, Math.min(30, (h.water || 0) + d))); },
  mood: n => setH("mood", n),
  quickPreview: el => quickPreview(el.value),
  setBudget: el => setBudget(el.value),
  delNote: id => { del("notes", id); curNote = null; },
  addTask: f => addTask(f), addQuick: f => addQuick(f), addSub: f => addSub(f), addHabit: f => addHabit(f), addCard: (f, k) => addCard(f, k),
  logout: () => signOut()
};
const NEEDS_EL = new Set(["setHNum", "quickPreview", "setBudget", "setPayKindForm", "setNoteGroup", "noteSearch", "stmtPick", "stmtToggle", "stmtCat"]);
// перетаскивание файла выписки на карточку «Выписка из банка»
document.addEventListener("dragover", e => { const z = e.target.closest && e.target.closest("#stmtDrop"); if (z) { e.preventDefault(); z.classList.add("over"); } });
document.addEventListener("dragleave", e => { const z = e.target.closest && e.target.closest("#stmtDrop"); if (z && !z.contains(e.relatedTarget)) z.classList.remove("over"); });
document.addEventListener("drop", e => { const z = e.target.closest && e.target.closest("#stmtDrop"); if (!z) return; e.preventDefault(); z.classList.remove("over"); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) stmtFile(f); });
function runAction(el, attr, evt){
  const name = el.getAttribute(attr); const fn = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;
  if (!fn) return;
  let args = []; try { args = el.dataset.args ? JSON.parse(el.dataset.args) : []; } catch(_) { return; }
  if (!Array.isArray(args)) return;
  if (attr === "data-submit") return fn(el, ...args);
  return NEEDS_EL.has(name) ? fn(...args, el) : fn(...args);
}
document.addEventListener("click", e => { const el = e.target.closest("[data-click]"); if (el && !el.disabled) runAction(el, "data-click", e); });
document.addEventListener("change", e => { const el = e.target.closest("[data-change]"); if (el) runAction(el, "data-change", e); });
document.addEventListener("input", e => { const el = e.target.closest("[data-input]"); if (el) runAction(el, "data-input", e); });
document.addEventListener("submit", e => { const el = e.target.closest("[data-submit]"); if (!el) return; e.preventDefault(); runAction(el, "data-submit", e); });

/* ---------- вход, регистрация, восстановление пароля ---------- */
let authMode = "login", authMsg = "", authBusy = false, authVals = { email: "", name: "" };
const ERR_RU = [
  [/invalid login credentials|invalid_credentials/i, "Неверная почта или пароль"],
  [/email not confirmed|email_not_confirmed/i, "Почта не подтверждена: откройте письмо и нажмите ссылку"],
  [/already registered|user_already_exists|email_exists/i, "Такая почта уже зарегистрирована. Войдите или восстановите пароль"],
  [/password should be at least|weak_password/i, "Пароль слишком простой: минимум 8 символов, лучше с цифрами и буквами"],
  [/rate limit|too many|over_email_send_rate_limit|429/i, "Слишком много попыток, подождите несколько минут"],
  [/signups not allowed|signup_disabled/i, "Регистрация сейчас закрыта"],
  [/invalid.*email|email_address_invalid/i, "Проверьте адрес почты"]
];
const ruErr = e => { const m = String(e && (e.code || "") + " " + (e && e.message || "")); for (const [re, t] of ERR_RU) if (re.test(m)) return t; return "Не получилось. Проверьте интернет и попробуйте ещё раз"; };
const redirectTo = () => location.origin + location.pathname;

function drawAuth(){
  const app = $(".app"), box = $("#auth");
  app.hidden = true; box.hidden = false;
  if (!configured()) { box.innerHTML = `<div class="authcard"><div class="brand"><img src="icon.svg" alt="" width="30" height="30">Pulse</div><h1>Сайт ещё не настроен</h1><p class="mute">Нужно указать адрес базы Supabase в файле config.js.</p></div>`; return; }
  const titles = { login: "Вход", signup: "Регистрация", forgot: "Восстановление пароля", reset: "Новый пароль" };
  const f = id => `id="${id}" name="${id}"`;
  let fields = "";
  if (authMode === "signup") fields += `<label>Имя<input type="text" ${f("aName")} value="${esc(authVals.name)}" autocomplete="given-name" maxlength="60" required></label>`;
  if (authMode !== "reset") fields += `<label>Почта<input type="email" ${f("aEmail")} value="${esc(authVals.email)}" autocomplete="email" maxlength="254" required></label>`;
  if (authMode !== "forgot") fields += `<label>${authMode === "reset" ? "Новый пароль" : "Пароль"}<input type="password" ${f("aPass")} autocomplete="${authMode === "login" ? "current-password" : "new-password"}" minlength="8" maxlength="72" required></label>`;
  if (authMode === "signup" || authMode === "reset") fields += `<label>Повторите пароль<input type="password" ${f("aPass2")} autocomplete="new-password" minlength="8" maxlength="72" required></label>`;
  const btn = { login: "Войти", signup: "Создать кабинет", forgot: "Прислать ссылку", reset: "Сохранить пароль" }[authMode];
  box.innerHTML = `<form class="authcard" data-submit="authSubmit" novalidate>
    <div class="brand"><img src="icon.svg" alt="" width="30" height="30">Pulse</div>
    <h1>${titles[authMode]}</h1>
    ${authMode === "login" ? `<p class="mute">Ваш личный кабинет: задачи, привычки, финансы и здоровье.</p>` : ""}
    ${authMode === "signup" ? `<p class="mute">Данные кабинета видите только вы.</p>` : ""}
    <div class="authfields">${fields}</div>
    <div class="authmsg" role="status" aria-live="polite">${esc(authMsg)}</div>
    <button class="btn pri" ${authBusy ? "disabled" : ""}>${authBusy ? "Подождите…" : btn}</button>
    <div class="authlinks">
      ${authMode === "login" ? `<button type="button" class="linkbtn" data-click="authMode" ${A("signup")}>Создать аккаунт</button><button type="button" class="linkbtn" data-click="authMode" ${A("forgot")}>Забыли пароль?</button>` : ""}
      ${authMode === "signup" || authMode === "forgot" ? `<button type="button" class="linkbtn" data-click="authMode" ${A("login")}>У меня уже есть аккаунт</button>` : ""}
    </div>
  </form>`;
}
ACTIONS.authMode = m => { authMode = m; authMsg = ""; drawAuth(); };
ACTIONS.authSubmit = async form => {
  if (authBusy) return;
  const v = id => (form.querySelector("#" + id) || {}).value || "";
  const email = v("aEmail").trim(), pass = v("aPass"), pass2 = v("aPass2"), name = v("aName").trim();
  if (authMode !== "reset") authVals.email = email; if (authMode === "signup") authVals.name = name;
  const fail = t => { authMsg = t; drawAuth(); };
  if (authMode !== "reset" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Проверьте адрес почты");
  if (authMode !== "forgot" && pass.length < 8) return fail("Пароль — минимум 8 символов");
  if ((authMode === "signup" || authMode === "reset") && pass !== pass2) return fail("Пароли не совпадают");
  if (authMode === "signup" && !name) return fail("Напишите, как к вам обращаться");
  authBusy = true; authMsg = ""; drawAuth();
  try {
    if (authMode === "login") {
      applySession(toSession(await authCall("token?grant_type=password", { email, password: pass })));
      return startApp();
    }
    if (authMode === "signup") {
      const j = await authCall("signup?redirect_to=" + encodeURIComponent(redirectTo()), { email, password: pass, data: { name: name.slice(0, 60) } });
      if (j.access_token) { applySession(toSession(j)); return startApp(); }
      authMode = "login"; authMsg = "Мы отправили письмо на " + email + ". Откройте его и нажмите ссылку, потом войдите.";
    }
    if (authMode === "forgot") {
      await authCall("recover?redirect_to=" + encodeURIComponent(redirectTo()), { email });
      authMode = "login"; authMsg = "Если такой аккаунт есть, на почту придёт ссылка для смены пароля.";
    }
    if (authMode === "reset") {
      await ensureFresh();
      await authCall("user", { password: pass }, session.access_token);
      authMsg = ""; authMode = "login"; return startApp();
    }
  } catch (e) { authMsg = ruErr(e); }
  finally { authBusy = false; }
  drawAuth();
};

async function signOut(){
  const t = session && session.access_token;
  applySession(null); wipeUi(); authVals = { email: "", name: "" };
  if (t) { try { await authCall("logout", {}, t); } catch(_){} }
  authMode = "login"; authMsg = "Вы вышли из кабинета."; drawAuth();
}
function wipeUi(){
  COLS.forEach(c => S[c] = {}); curNote = null; noteGroup = null; noteSticker = null; noteQuery = ""; moneyPicked = false; moneyMonth = today().slice(0,7); moneyTab = "dash"; imp = null;
  $("#view").innerHTML = ""; $("#nav").innerHTML = ""; $("#who").textContent = "";
}
function signedOut(msg){ applySession(null); wipeUi(); authMode = "login"; authMsg = msg || ""; drawAuth(); }

// Ссылки из писем Supabase возвращают токены во фрагменте адреса (#access_token=...).
async function consumeAuthRedirect(){
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error_description|error)=/.test(h)) return false;
  const p = new URLSearchParams(h);
  try { history.replaceState(null, "", location.pathname + location.search); } catch(_){}
  if (p.get("error_description") || p.get("error")) { authMsg = "Ссылка недействительна или устарела. Попробуйте ещё раз."; return true; }
  const at = p.get("access_token"), rt = p.get("refresh_token");
  if (!at || !rt) return true;
  try {
    const user = await authCall("user", undefined, at);
    applySession({ access_token: at, refresh_token: rt, expires_at: Number(p.get("expires_at")) || (Math.floor(Date.now()/1000) + Number(p.get("expires_in") || 3600)), user });
    if (p.get("type") === "recovery") { authMode = "reset"; authMsg = "Придумайте новый пароль."; }
  } catch (e) { authMsg = "Ссылка недействительна или устарела. Попробуйте ещё раз."; }
  return true;
}

async function startApp(){
  $("#auth").hidden = true; $(".app").hidden = false;
  $("#who").textContent = firstName() || me.email;
  view = VIEWS.some(v => v[0] === (location.hash || "").slice(1)) ? location.hash.slice(1) : "home";
  drawNav(); render();
  try { await loadAll(); } catch (e) { if (session) { netError = "Не удалось загрузить данные. Проверьте интернет и обновите страницу."; render(); } }
}

/* ---------- boot ---------- */
(async () => {
  if (!configured()) return drawAuth();
  await consumeAuthRedirect();
  if (!session) { const s = loadSession(); if (s) applySession(s); }
  if (!session) return drawAuth();
  if (authMode === "reset") return drawAuth();
  try { await ensureFresh(); } catch (_) { return drawAuth(); }
  startApp();
})();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && session && authMode !== "reset" && !$(".app").hidden) loadAll().catch(() => {}); });
