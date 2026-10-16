const {chromium}=require(process.env.PW);(async()=>{const b=await chromium.launch();const p=await b.newPage();
for(const n of ["sber","tbank","alfa","vtb"]){await p.goto('file://'+__dirname+'/out/'+n+'.html');await p.pdf({path:__dirname+'/out/'+n+'.pdf',format:'A4',margin:{top:'15mm',bottom:'15mm',left:'10mm',right:'10mm'},displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;width:100%;text-align:center">Страница <span class="pageNumber"></span> из <span class="totalPages"></span></div>'});}
await b.close()})()
