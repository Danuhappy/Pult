// Разбор PDF-образцов настоящим pdf.js в браузере (тот же код, что на сайте)
const {chromium}=require(process.env.PW);const fs=require('fs');const O=__dirname+'/out/';const E=JSON.parse(fs.readFileSync(O+'expected.json'));
const BASE=process.env.BASE||'http://localhost:8099/';
(async()=>{const b=await chromium.launch();const p=await b.newPage();let bad=0;
await p.route(/supabase\.co|googleapis|gstatic/,r=>r.abort());
p.on('console',m=>{if(m.type()==='error')console.log('console:',m.text())});
await p.goto(BASE);
for(const f of ["sber.pdf","tbank.pdf","alfa.pdf","vtb.pdf"]){
 const b64=fs.readFileSync(O+f).toString('base64');
 const r=await p.evaluate(async b64=>{const u8=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const r=await window.readStatement("x.pdf",u8);return {ops:r.ops,error:r.error,lines:r.lines||[]};},b64);
 const sum=t=>Math.round(r.ops.filter(x=>x.type===t).reduce((s,x)=>s+x.amount,0)*100)/100;
 const ok=r.ops.length===E.count&&sum('exp')===E.exp&&sum('inc')===E.inc;
 if(!ok){bad++;console.log(r.lines.slice(0,25).join('\n'));}
 console.log(ok?'OK  ':'FAIL',f,r.error||'',r.ops.length,sum('exp'),sum('inc'),'|',JSON.stringify(r.ops.slice(0,2).map(o=>[o.date,o.type,o.amount,o.desc,o.bankCat])));}
await b.close();process.exit(bad?1:0)})()
