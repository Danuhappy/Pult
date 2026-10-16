const B=require('../../bank.js'),fs=require('fs');const O=__dirname+'/out/';const E=JSON.parse(fs.readFileSync(O+'expected.json'));
const sum=(o,t)=>Math.round(o.filter(x=>x.type===t).reduce((s,x)=>s+x.amount,0)*100)/100;
(async()=>{let bad=0;
for(const f of ["tbank.csv","alfa.csv","vtb.xlsx","prihod-rashod.xlsx"]){const u8=new Uint8Array(fs.readFileSync(O+f));
 const rows=B.kindOf(f,u8)==="xlsx"?await B.readXlsx(u8):B.parseCSV(B.decodeText(u8));const r=B.fromTable(rows);
 const ok=r.ops.length===E.count&&sum(r.ops,'exp')===E.exp&&sum(r.ops,'inc')===E.inc&&new Set(r.ops.map(o=>o.key)).size===r.ops.length;
 if(!ok)bad++;console.log(ok?'OK  ':'FAIL',f,r.error||'',r.ops.length,sum(r.ops,'exp'),sum(r.ops,'inc'),'|',r.ops[0]&&JSON.stringify(r.ops[0]));}
process.exit(bad?1:0)})()
