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
  check: svgI('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), ruble: svgI('<path d="M8 20V4h6a4 4 0 0 1 0 8H6M6 16h9"/>'),
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
 ["money","Финансы","money"],["notes","Заметки","note"],["board","Доски","board"]
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
  const fn = {home:vHome,habits:vHabits,tasks:vTasks,cal:vCal,health:vHealth,money:vMoney,notes:vNotes,board:vBoard}[view];
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
      <div class="list">${tabList.length?tabList.map(taskRow).join(""):`<div class="empty">${homeTab==="today"?"На сегодня пусто. Добавьте задачу или напишите ассистенту.":"На неделю ничего не запланировано."}</div>`}</div>`
      : `<h2>Итоги недели</h2><div class="grid g2">
        <div><div class="lbl">Средний счёт</div><div class="big">${avgScore}</div></div>
        <div><div class="lbl">Сделано задач</div><div class="big">${doneWeek}</div></div>
        <div><div class="lbl">Потрачено</div><div class="big">${rub(exWeek)}</div></div>
        <div><div class="lbl">Заметок</div><div class="big">${Object.keys(S.notes).length}</div></div></div>`}
    </div>
    <div class="card"><h2>Продуктивность <span class="lbl">счёт дня за 2 недели</span></h2>
      ${lineChart(scores, days.map(d=>String(parseD(d).getDate())), 100)}
      ${subsSoon.length?`<div class="lbl" style="margin-top:14px">Списания на неделе</div><div class="list">${subsSoon.map(s=>`<div class="item"><span class="dot" style="background:var(--pink)"></span><span class="t">${esc(s.name)}</span><span class="mute">${dLabel(s.next)}</span><span class="num">${rub(s.price)}</span></div>`).join("")}</div>`:""}
    </div>
  </div>`;
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
 "Еда":["рыба","мясо","продукт","магнит","пятер","пятёр","перекрест","ашан","хлеб","молоко","овощ","фрукт","еда","магаз","лента","вкусвилл","курица"],
 "Кафе":["кафе","ресторан","обед","кофе","шаурм","пицц","доставк","столовая"],
 "Топливо":["дизель","солярк","дт","бензин","заправк","азс","топлив","газпромнефть","лукойл","роснефть","татнефть"],
 "Авто и ремонт":["запчаст","шин","резин","ремонт","автосервис","масло","фильтр","мойк","аккумулятор","колод","сервис"],
  "Дом и стройка":["цемент","доск","кирпич","профлист","саморез","стройк","леруа","краск","труб","участок","сарай","баня"],
 "Коммуналка":["коммунал","свет","газ","вода","электричеств","жкх","вывоз"],
 "Связь":["телефон","связь","интернет","мтс","билайн","мегафон","теле2","tele2"],
 "Здоровье":["аптек","врач","клиник","анализ","лекарств","стоматолог"],
 "Одежда":["одежд","обув","куртк","штаны","кроссов"],
 "Подписки":["подписк","яндекс плюс","кинопоиск","icloud","spotify","claude"],
 "Развлечения":["кино","театр","боулинг","отдых","игр","бар"],
 "Дети и семья":["детск","школ","сад","игрушк","подарок"],
 "Переводы":["перевод","долг","займ"]
};
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
let moneyMonth = today().slice(0,7), moneyTab="ops", moneyPicked=false;
function monthsWithMoney(){ const m={}; arr("money").forEach(x=>{ if(x.date){ const k=x.date.slice(0,7); m[k]=(m[k]||0)+1; } }); return Object.keys(m).sort().reverse().map(k=>[k,m[k]]); }
function pickMonth(k){ moneyMonth=k; moneyPicked=true; render(); }
function shiftMonth(n){ moneyPicked=true;  const [y,m]=moneyMonth.split("-").map(Number); const d=new Date(y,m-1+n,1); moneyMonth=ymd(d).slice(0,7); render(); }
function setBudget(v){ if(v && v.value!==undefined) v=v.value; const st={...(S.meta.settings||{}),budget:+v||0}; save("meta","settings",st); }
function need(el,msg){ el.classList.add("bad"); el.focus(); toast(msg); el.addEventListener("input",()=>el.classList.remove("bad"),{once:true}); return false; }
const numIn = v => parseFloat(String(v).replace(/\s/g,"").replace(",","."));
function addSub(f){ const name=f.sn.value.trim(), price=numIn(f.sp.value);
  if(!name) return need(f.sn,"Напишите название подписки");
  if(!(price>0)) return need(f.sp,"Укажите цену, например 399");
  save("subs",uid(),{name,price,period:f.spd.value,next:f.snx.value||today()}); f.sn.value="";f.sp.value=""; toast("Подписка добавлена"); return false; }
function paySub(id){ const s=S.subs[id]; if(!s) return; const d=parseD(s.next||today()); if(s.period==="year") d.setFullYear(d.getFullYear()+1); else d.setMonth(d.getMonth()+1);
  save("subs",id,{...s,next:ymd(d)}); save("money",uid(),{type:"exp",amount:s.price,cat:"Подписки",note:s.name,date:today(),created:Date.now()}); toast("Списание записано"); }
function vMoney(){
  const st=settings(), [y,m]=moneyMonth.split("-").map(Number);
  const ops=arr("money").filter(x=>x.date && x.date.startsWith(moneyMonth)).sort((a,b)=>b.date.localeCompare(a.date)||(b.created||0)-(a.created||0));
  const exp=ops.filter(x=>x.type==="exp").reduce((s,x)=>s+x.amount,0), inc=ops.filter(x=>x.type==="inc").reduce((s,x)=>s+x.amount,0);
  const byCat={}; ops.filter(x=>x.type==="exp").forEach(x=>byCat[x.cat]=(byCat[x.cat]||0)+x.amount);
  const cats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]); const cmax=cats.length?cats[0][1]:1;
  const subs=arr("subs").sort((a,b)=>(a.next||"").localeCompare(b.next||""));
  const subMonth=subs.reduce((s,x)=>s+(x.period==="year"?x.price/12:x.price),0);
  const left = st.budget ? st.budget-exp : null;
  return `<div class="spread"><div><h1>Финансы</h1><div class="sub">${MONTHS[m-1]} ${y}</div></div>
    <div class="row"><button class="btn sm" data-click="shiftMonth" ${A(-1)} aria-label="Предыдущий месяц">${ICO.left}</button><button class="btn sm" data-click="shiftMonth" ${A(1)} aria-label="Следующий месяц">${ICO.right}</button></div></div>
  ${(()=>{ const ms=monthsWithMoney(); if(!ms.length) return ""; return `<div class="tabs" role="tablist" aria-label="Месяцы с операциями">${ms.map(([k,n])=>{ const [yy,mm]=k.split("-").map(Number); return `<button class="${k===moneyMonth?"on":""}" data-click="pickMonth" ${A(k)}>${MONTHS[mm-1]}${yy!==new Date().getFullYear()?" "+yy:""}<span class="num">${n}</span></button>`; }).join("")}</div>`; })()}
  ${!ops.length && monthsWithMoney().length ? `<div class="banner">В этом месяце операций нет. Выберите месяц выше — например, ${(()=>{const [yy,mm]=monthsWithMoney()[0][0].split("-").map(Number);return MONTHS[mm-1];})()}.</div>` : ""}
  <form class="card" data-submit="addQuick"><div class="lbl" style="margin-bottom:8px">Быстрая запись</div>
    <div class="compose"><input type="text" id="qText" aria-label="Сумма и на что потрачено" name="q" placeholder="1000р рыба" autocomplete="off" data-input="quickPreview"><input type="date" id="qDate" aria-label="Дата операции" name="qd" value="${today()}" style="max-width:170px"><button class="btn pri">Записать</button></div>
    <div id="qPrev" class="mute" style="font-size:13px;margin-top:8px"></div></form>
  <div class="hero">
    <div class="tile a"><span class="corner">${ICO.ruble}</span><div><div class="lbl">Баланс месяца</div><div class="big">${rub(inc-exp)}</div></div><div class="mute">доходы ${rub(inc)}</div></div>
    <div class="tile b"><span class="corner">${ICO.down}</span><div><div class="lbl">Расходы</div><div class="big">${rub(exp)}</div></div><div class="mute">${ops.filter(x=>x.type==="exp").length} операций</div></div>
    <div class="tile"><div class="lbl">Бюджет на месяц</div><input type="number" id="budget" aria-label="Бюджет на месяц, рублей" value="${esc(st.budget||"")}" placeholder="не задан" data-change="setBudget" style="width:100%;font-size:18px"><div class="${left!==null&&left<0?"":"mute"}" style="${left!==null&&left<0?"color:var(--bad)":""}">${left===null?"задайте лимит":left>=0?"осталось "+rub(left):"перерасход "+rub(-left)}</div></div>
    <div class="tile"><div class="lbl">Подписки в месяц</div><div class="big">${rub(subMonth)}</div><div class="mute">${subs.length} шт.</div></div>
  </div>
  <div class="tabs">${[["ops","Операции"],["cats","По категориям"],["subs","Подписки"]].map(([k,n])=>`<button class="${k===moneyTab?"on":""}" data-click="moneyTab" ${A(k)}>${n}</button>`).join("")}</div>
  ${moneyTab==="cats"?`<div class="card"><div class="row" style="gap:26px;align-items:center">${cats.length?donut(cats.map(([c,v],i)=>[c,v,CAT_COLOR[i%CAT_COLOR.length]]),compact(exp)):""}<div class="bars" style="flex:1;min-width:240px">${cats.length?cats.map(([c,v],i)=>`<div class="bar"><span>${esc(c)}</span><i><b style="width:${v/cmax*100}%;background:${CAT_COLOR[i%CAT_COLOR.length]}"></b></i><span class="num" style="text-align:right">${rub(v)}</span></div>`).join(""):`<div class="empty">В этом месяце расходов нет.</div>`}</div></div></div>`:""}
  ${moneyTab==="ops"?`<div class="card"><div class="list">${ops.length?ops.map(x=>`<div class="item"><span class="mute num" style="width:52px">${parseD(x.date).getDate()} ${MONTHS_G[parseD(x.date).getMonth()].slice(0,3)}</span><span class="t">${esc(x.note||x.cat)} <span class="chip">${esc(x.cat)}</span></span><span class="num" style="color:${x.type==="inc"?"var(--good)":"var(--fg)"}">${x.type==="inc"?"+":"−"}${rub(x.amount)}</span><button class="icon" aria-label="Удалить" data-click="del" ${A("money",x.id)}>${ICO.x}</button></div>`).join(""):`<div class="empty">Операций нет. Запишите первую строкой выше, например «5600 дизель».</div>`}</div></div>`:""}
  ${moneyTab==="subs"?`<form class="card form" data-submit="addSub">
      <label>Название<input type="text" id="sName" name="sn" placeholder="Яндекс Плюс"></label>
      <label>Цена, ₽<input type="text" inputmode="decimal" id="sPrice" name="sp" placeholder="399" autocomplete="off"></label>
      <label>Период<select id="sPer" name="spd"><option value="month">Каждый месяц</option><option value="year">Раз в год</option></select></label>
      <label>Следующее списание<input type="date" id="sNext" name="snx" value="${today()}"></label>
      <button class="btn pri">Добавить</button></form>
    <div class="card"><div class="list">${subs.length?subs.map(s=>`<div class="item"><span class="t">${esc(s.name)} <span class="chip">${s.period==="year"?"в год":"в месяц"}</span></span><span class="mute">${s.next?dLabel(s.next):""}</span><span class="num">${rub(s.price)}</span><button class="btn sm" data-click="paySub" ${A(s.id)} title="Записать расход и перенести дату">Оплачено</button><button class="icon" aria-label="Удалить" data-click="del" ${A("subs",s.id)}>${ICO.x}</button></div>`).join(""):`<div class="empty">Подписок пока нет.</div>`}</div></div>`:""}`;
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
    </div>`; }).join("")}</div>`:`<div class="card"><div class="empty" style="padding:0">Привычек пока нет. Например: зарядка, вода утром, 20 минут чтения, без телефона после 23:00.</div></div>`}
  <div class="card"><h2>Уведомления</h2><div class="mute" style="font-size:14px;max-width:62ch">Уведомления приходят через «Напоминания» на iPhone. Напишите в чат с Claude, какие привычки и во сколько напоминать, и он поставит повторяющиеся напоминания. Отмечать выполнение можно здесь или на «Обзоре».</div></div>`;
}

/* ---------- NOTES ---------- */
let curNote=null, noteTimer=null;
function newNote(){ const id=uid(); curNote=id; save("notes",id,{title:"",text:"",updated:Date.now()}); setTimeout(()=>{const e=$("#noteTitle"); e&&e.focus();},0); }
function noteInput(){ clearTimeout(noteTimer); noteTimer=setTimeout(()=>{ if(!curNote) return; save("notes",curNote,{title:$("#noteTitle").value,text:$("#noteText").value,updated:Date.now()}); },700); }
function pickNote(id){ curNote=id; render(); }
function drawNoteList(){ const el=$("#noteList"); if(!el) return; el.innerHTML=noteListHtml(); }
function noteListHtml(){
  const ns=arr("notes").sort((a,b)=>(b.updated||0)-(a.updated||0));
  return ns.length?ns.map(n=>`<div class="nitem ${n.id===curNote?"on":""}" role="button" tabindex="0" aria-current="${n.id===curNote}" data-click="pickNote" ${A(n.id)}><div>${esc(n.title||"Без названия")}</div><div class="x">${esc((n.text||"").slice(0,80))||"пусто"}</div></div>`).join(""):`<div class="empty">Заметок нет.</div>`;
}
function vNotes(){
  const ns=arr("notes"); if(!curNote || !S.notes[curNote]) curNote = ns.sort((a,b)=>(b.updated||0)-(a.updated||0))[0]?.id || null;
  const n=curNote?S.notes[curNote]:null;
  return `<div class="spread"><div><h1>Заметки</h1><div class="sub">${ns.length} заметок</div></div><button class="btn pri" data-click="newNote">Новая заметка</button></div>
  <div class="notes"><div class="card" id="noteList">${noteListHtml()}</div>
   <div class="card">${n?`<input type="text" id="noteTitle" aria-label="Заголовок заметки" value="${esc(n.title)}" placeholder="Заголовок" data-input="noteInput" style="width:100%;font-size:18px;font-weight:600;margin-bottom:10px">
     <textarea id="noteText" aria-label="Текст заметки" rows="16" placeholder="Текст заметки" data-input="noteInput">${esc(n.text)}</textarea>
     <div class="spread" style="margin-top:8px"><span class="mute" style="font-size:12px">Сохраняется само</span><button class="btn sm" data-click="delNote" ${A(curNote)}>Удалить</button></div>`
     :`<div class="empty">Нажмите «Новая заметка», чтобы начать.</div>`}</div></div>`;
}

/* ---------- BOARD ---------- */
const KCOLS=[["idea","Идеи"],["doing","В работе"],["done","Готово"]];
function addCard(f,col){ const t=f.c.value.trim(); if(!t) return need(f.c,"Напишите текст карточки"); save("board",uid(),{title:t,col,updated:Date.now()}); f.c.value=""; return false; }
function moveCard(id,dir){ const c=S.board[id]; const i=KCOLS.findIndex(k=>k[0]===c.col)+dir; if(i<0||i>2) return; save("board",id,{...c,col:KCOLS[i][0],updated:Date.now()}); }
function vBoard(){
  const cs=arr("board").sort((a,b)=>(b.updated||0)-(a.updated||0));
  return `<div><h1>Доски</h1><div class="sub">Идеи и дела, которые двигаются по этапам</div></div>
  <div class="kan">${KCOLS.map(([k,n],ci)=>{ const items=cs.filter(c=>c.col===k); return `<div class="card"><h2>${n} <span class="mute num">${items.length}</span></h2>
    <div style="display:flex;flex-direction:column;gap:8px">${items.map(c=>`<div class="kcard"><div>${esc(c.title)}</div><div class="spread"><div class="row">${ci>0?`<button class="btn sm" data-click="moveCard" ${A(c.id,-1)} aria-label="Назад">${ICO.left}</button>`:""}${ci<2?`<button class="btn sm" data-click="moveCard" ${A(c.id,1)} aria-label="Вперёд">${ICO.right}</button>`:""}</div><button class="icon" aria-label="Удалить" data-click="del" ${A("board",c.id)}>${ICO.x}</button></div></div>`).join("")}</div>
    <form data-submit="addCard" ${A(k)} class="compose" style="margin-top:10px"><input type="text" id="kAdd${k}" aria-label="Новая карточка в колонку ${n}" name="c" placeholder="Новая карточка" autocomplete="off"><button class="btn sm">+</button></form></div>`;}).join("")}</div>`;
}

/* ---------- actions: единый диспетчер вместо onclick в разметке ---------- */
const A = (...args) => `data-args="${esc(JSON.stringify(args))}"`;
const ACTIONS = {
  go, del, toggleTask, quickDay, shiftMonth, pickMonth, paySub, toggleHabit, pickNote, newNote, noteInput, moveCard,
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
const NEEDS_EL = new Set(["setHNum", "quickPreview", "setBudget"]);
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
  if (!configured()) { box.innerHTML = `<div class="authcard"><div class="brand"><i></i>Пульт</div><h1>Сайт ещё не настроен</h1><p class="mute">Нужно указать адрес базы Supabase в файле config.js.</p></div>`; return; }
  const titles = { login: "Вход", signup: "Регистрация", forgot: "Восстановление пароля", reset: "Новый пароль" };
  const f = id => `id="${id}" name="${id}"`;
  let fields = "";
  if (authMode === "signup") fields += `<label>Имя<input type="text" ${f("aName")} value="${esc(authVals.name)}" autocomplete="given-name" maxlength="60" required></label>`;
  if (authMode !== "reset") fields += `<label>Почта<input type="email" ${f("aEmail")} value="${esc(authVals.email)}" autocomplete="email" maxlength="254" required></label>`;
  if (authMode !== "forgot") fields += `<label>${authMode === "reset" ? "Новый пароль" : "Пароль"}<input type="password" ${f("aPass")} autocomplete="${authMode === "login" ? "current-password" : "new-password"}" minlength="8" maxlength="72" required></label>`;
  if (authMode === "signup" || authMode === "reset") fields += `<label>Повторите пароль<input type="password" ${f("aPass2")} autocomplete="new-password" minlength="8" maxlength="72" required></label>`;
  const btn = { login: "Войти", signup: "Создать кабинет", forgot: "Прислать ссылку", reset: "Сохранить пароль" }[authMode];
  box.innerHTML = `<form class="authcard" data-submit="authSubmit" novalidate>
    <div class="brand"><i></i>Пульт</div>
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
  COLS.forEach(c => S[c] = {}); curNote = null; moneyPicked = false; moneyMonth = today().slice(0,7);
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
