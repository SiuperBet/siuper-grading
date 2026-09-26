function monthKey(d){return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")}
function recentMonths(count=13){
  const out=[],now=new Date();
  for(let i=0;i<count;i++){out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1))))}
  return out;
}
async function readMonth(month){
  try{const r=await fetch("./data/prices/history/"+month+".json",{cache:"no-cache"});return r.ok?await r.json():[]}catch{return[]}
}
export async function loadPriceHistory(printingId,reference){
  if(!printingId||!reference)return[];
  const months=await Promise.all(recentMonths().map(readMonth)),rows=months.flat().filter(p=>
    p.printingId===printingId&&p.source===reference.source&&p.currency===reference.currency&&p.priceType===reference.priceType&&(p.variant||"")===(reference.variant||"")
  );
  const map=new Map();
  for(const p of rows){
    const day=p.snapshotDate||String(p.timestamp||"").slice(0,10);
    if(day)map.set(day,{date:day,value:Number(p.value),source:p.source,currency:p.currency,priceType:p.priceType,variant:p.variant||""});
  }
  const refDay=String(reference.snapshotDate||reference.timestamp||new Date().toISOString()).slice(0,10);
  if(refDay&&Number.isFinite(Number(reference.value))&&Number(reference.value)>0){
    map.set(refDay,{date:refDay,value:Number(reference.value),source:reference.source,currency:reference.currency,priceType:reference.priceType,variant:reference.variant||""});
  }
  return [...map.values()].filter(p=>Number.isFinite(p.value)&&p.value>0).sort((a,b)=>a.date.localeCompare(b.date));
}
export function drawPriceHistory(canvas,points,days=30){
  const info=document.querySelector("#priceHistoryInfo"),cut=Date.now()-days*86400000,rows=points.filter(p=>new Date(p.date+"T00:00:00Z").getTime()>=cut);
  if(!rows.length){canvas.hidden=true;if(info)info.textContent="Nessun dato storico disponibile per questo intervallo.";return false}
  canvas.hidden=false;
  const ratio=Math.min(2,window.devicePixelRatio||1),cssW=Math.max(300,canvas.parentElement&&canvas.parentElement.clientWidth||320),cssH=190;
  canvas.width=Math.round(cssW*ratio);canvas.height=Math.round(cssH*ratio);canvas.style.width=cssW+"px";canvas.style.height=cssH+"px";
  const ctx=canvas.getContext("2d");ctx.scale(ratio,ratio);ctx.clearRect(0,0,cssW,cssH);
  const pad={l:50,r:12,t:16,b:30},w=cssW-pad.l-pad.r,h=cssH-pad.t-pad.b;
  const values=rows.map(x=>x.value),rawMin=Math.min(...values),rawMax=Math.max(...values);
  const margin=Math.max(.01,(rawMax-rawMin)*.15,rawMax*.05),min=Math.max(0,rawMin-margin),max=rawMax+margin,span=Math.max(.01,max-min);
  const times=rows.map(x=>new Date(x.date+"T00:00:00Z").getTime()),t0=Math.min(...times),t1=Math.max(...times),ts=Math.max(1,t1-t0);
  ctx.strokeStyle="#28344a";ctx.fillStyle="#9ca3af";ctx.font="11px sans-serif";ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=pad.t+h*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();const v=max-span*i/4;ctx.fillText(v.toFixed(2),4,y+4)}
  const xy=rows.map((p,i)=>({x:rows.length===1?pad.l+w/2:pad.l+(times[i]-t0)/ts*w,y:pad.t+(max-p.value)/span*h}));
  if(rows.length>1){
    ctx.strokeStyle="#22d3ee";ctx.lineWidth=2;ctx.beginPath();
    xy.forEach((p,i)=>{i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)});ctx.stroke();
  }
  ctx.fillStyle="#f8fafc";xy.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,rows.length===1?4:2.8,0,Math.PI*2);ctx.fill()});
  ctx.fillStyle="#9ca3af";
  if(rows.length===1){const label=rows[0].date;ctx.fillText(label,Math.max(pad.l,xy[0].x-28),cssH-8)}
  else{ctx.fillText(rows[0].date,pad.l,cssH-8);const last=rows[rows.length-1].date;ctx.fillText(last,Math.max(pad.l,cssW-75),cssH-8)}
  if(info){
    info.textContent=rows.length===1
      ?"1 rilevazione disponibile • il grafico crescerà automaticamente con i prossimi aggiornamenti • "+rows[0].source+" "+rows[0].priceType+" • "+rows[0].currency+(rows[0].variant?" • "+rows[0].variant:"")
      :rows.length+" rilevazioni • "+rows[0].source+" "+rows[0].priceType+" • "+rows[0].currency+(rows[0].variant?" • "+rows[0].variant:"");
  }
  return true;
}

export function buildOnlineMarketTrend(prices,variant="normal"){
  const rows=(prices||[]).filter(p=>p.source==="Cardmarket"&&p.currency==="EUR"&&(p.variant||"normal")===variant);
  const byType=new Map(rows.map(p=>[p.priceType,p]));
  const order=[["avg30","Media 30g"],["avg7","Media 7g"],["avg1","Media 1g"],["trend","Trend oggi"]];
  return order.map(([type,label])=>{
    const p=byType.get(type),value=p&&Number(p.value);
    return p&&Number.isFinite(value)&&value>0?{label,value,source:"Cardmarket",currency:"EUR",priceType:type,variant:p.variant||variant,timestamp:p.timestamp||null}:null;
  }).filter(Boolean);
}
export function drawOnlineMarketTrend(canvas,points){
  const info=document.querySelector("#onlineTrendInfo");
  if(!canvas||!points||points.length<2){
    if(canvas)canvas.hidden=true;
    if(info)info.textContent="Andamento online 1/7/30 giorni non disponibile per questa stampa.";
    return false;
  }
  canvas.hidden=false;
  const ratio=Math.min(2,window.devicePixelRatio||1),cssW=Math.max(300,canvas.parentElement&&canvas.parentElement.clientWidth||320),cssH=190;
  canvas.width=Math.round(cssW*ratio);canvas.height=Math.round(cssH*ratio);canvas.style.width=cssW+"px";canvas.style.height=cssH+"px";
  const ctx=canvas.getContext("2d");ctx.scale(ratio,ratio);ctx.clearRect(0,0,cssW,cssH);
  const pad={l:50,r:14,t:16,b:38},w=cssW-pad.l-pad.r,h=cssH-pad.t-pad.b,values=points.map(x=>x.value),rawMin=Math.min(...values),rawMax=Math.max(...values),margin=Math.max(.01,(rawMax-rawMin)*.18,rawMax*.05),min=Math.max(0,rawMin-margin),max=rawMax+margin,span=Math.max(.01,max-min);
  ctx.strokeStyle="#28344a";ctx.fillStyle="#9ca3af";ctx.font="11px sans-serif";ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=pad.t+h*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();ctx.fillText("€"+(max-span*i/4).toFixed(2),4,y+4)}
  const xy=points.map((p,i)=>({x:points.length===1?pad.l+w/2:pad.l+w*i/(points.length-1),y:pad.t+(max-p.value)/span*h}));
  ctx.strokeStyle="#22d3ee";ctx.lineWidth=2.4;ctx.beginPath();xy.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
  ctx.fillStyle="#f8fafc";xy.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,3.4,0,Math.PI*2);ctx.fill()});
  ctx.fillStyle="#9ca3af";ctx.textAlign="center";points.forEach((p,i)=>ctx.fillText(p.label,xy[i].x,cssH-10));ctx.textAlign="start";
  if(info)info.textContent="Cardmarket EUR • medie mobili online 30g / 7g / 1g + trend corrente. Non sono quattro prezzi osservati in date puntuali.";
  return true;
}
