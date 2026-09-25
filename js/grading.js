import{GRADING_ALGORITHM_VERSION,GRADING_CONFIG}from"./config.js";
import{put,getAll}from"./db.js";

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function sample(canvas,maxW=420){
  const scale=Math.min(1,maxW/canvas.width),w=Math.max(40,Math.round(canvas.width*scale)),h=Math.max(56,Math.round(canvas.height*scale));
  const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(canvas,0,0,w,h);
  return {w:w,h:h,data:x.getImageData(0,0,w,h).data};
}
function grayAt(d,i){return .299*d[i]+.587*d[i+1]+.114*d[i+2]}
function photoQuality(s){
  const d=s.data;let sum=0,sat=0;const gray=new Float32Array(s.w*s.h);
  for(let p=0,i=0;i<d.length;i+=4,p++){const g=grayAt(d,i);gray[p]=g;sum+=g;if(g>245)sat++}
  const mean=sum/gray.length;let edge=0,edgeSq=0,n=0;
  for(let y=1;y<s.h-1;y+=2)for(let x=1;x<s.w-1;x+=2){
    const p=y*s.w+x;const lap=4*gray[p]-gray[p-1]-gray[p+1]-gray[p-s.w]-gray[p+s.w];edge+=lap;edgeSq+=lap*lap;n++;
  }
  const blurVariance=edgeSq/n-(edge/n)*(edge/n),glare=sat/gray.length;
  const exposure=1-Math.min(1,Math.abs(mean-132)/105);
  const sharpness=clamp((blurVariance-35)/500,0,1);
  const glareScore=clamp(1-glare*8,0,1);
  return {meanBrightness:Math.round(mean),blurVariance:Math.round(blurVariance),glareRatio:Number(glare.toFixed(4)),score:clamp(exposure*.3+sharpness*.45+glareScore*.25,0,1)};
}
function projectionEdges(s){
  const w=s.w,h=s.h,d=s.data,gray=new Float32Array(w*h);
  for(let p=0,i=0;i<d.length;i+=4,p++)gray[p]=grayAt(d,i);
  const xs=new Float32Array(w),ys=new Float32Array(h);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;xs[x]+=Math.abs(gray[p+1]-gray[p-1]);ys[y]+=Math.abs(gray[p+w]-gray[p-w])}
  const pick=(arr,start,end)=>{let bi=start,bv=-1;for(let i=start;i<=end;i++){if(arr[i]>bv){bv=arr[i];bi=i}}return bi};
  const left=pick(xs,Math.round(w*.025),Math.round(w*.22)),right=pick(xs,Math.round(w*.78),Math.round(w*.975));
  const top=pick(ys,Math.round(h*.02),Math.round(h*.22)),bottom=pick(ys,Math.round(h*.78),Math.round(h*.98));
  return {left:left,right:w-1-right,top:top,bottom:h-1-bottom};
}
function ratioPair(a,b){const t=a+b||1;const p=Math.round(a/t*1000)/10;return [p,Math.round((100-p)*10)/10]}
function centeringScore(m){
  const lr=ratioPair(m.left,m.right),tb=ratioPair(m.top,m.bottom);
  const dev=Math.max(Math.abs(50-lr[0]),Math.abs(50-tb[0]));
  return {lr:lr,tb:tb,score:clamp(10-dev*.18,1,10)};
}
function regionStats(s,x0,y0,x1,y1){
  const d=s.data,w=s.w;let n=0,bright=0,contrast=0;
  for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const i=(y*w+x)*4,g=grayAt(d,i);n++;if(g>225)bright++;if(x+2<x1){const j=(y*w+x+2)*4;if(Math.abs(g-grayAt(d,j))>45)contrast++}}
  return {bright:bright/Math.max(1,n),contrast:contrast/Math.max(1,n)};
}
function cornerAnalysis(s){
  const w=s.w,h=s.h,cw=Math.max(8,Math.round(w*.13)),ch=Math.max(8,Math.round(h*.10));
  const regs=[regionStats(s,0,0,cw,ch),regionStats(s,w-cw,0,w,ch),regionStats(s,w-cw,h-ch,w,h),regionStats(s,0,h-ch,cw,h)];
  const scores=regs.map(r=>clamp(10-r.bright*2.2-r.contrast*1.8,3,10));
  const worst=Math.min(...scores),avg=scores.reduce((a,b)=>a+b,0)/scores.length;
  return {corners:scores.map(x=>Number(x.toFixed(1))),score:Number((worst*.65+avg*.35).toFixed(1))};
}
function edgeAnalysis(s){
  const w=s.w,h=s.h,t=Math.max(5,Math.round(Math.min(w,h)*.035));
  const regs=[regionStats(s,0,0,w,t),regionStats(s,0,h-t,w,h),regionStats(s,0,0,t,h),regionStats(s,w-t,0,w,h)];
  const scores=regs.map(r=>clamp(10-r.bright*2.4-r.contrast*1.4,3,10));
  return {edges:scores.map(x=>Number(x.toFixed(1))),score:Number((Math.min(...scores)*.55+(scores.reduce((a,b)=>a+b,0)/4)*.45).toFixed(1))};
}
function surfaceAnalysis(s){
  const r=regionStats(s,Math.round(s.w*.12),Math.round(s.h*.12),Math.round(s.w*.88),Math.round(s.h*.88));
  const penalty=Math.max(0,r.contrast-.18)*4;
  return {score:Number(clamp(9.6-penalty,4,9.6).toFixed(1)),note:"Stima limitata ai difetti fotograficamente visibili; riflessi e artwork possono ridurre l'affidabilità."};
}
export function analyzeCanvas(canvas){
  const s=sample(canvas),quality=photoQuality(s),margins=projectionEdges(s),centering=centeringScore(margins),corners=cornerAnalysis(s),edges=edgeAnalysis(s),surface=surfaceAnalysis(s);
  const w=GRADING_CONFIG.weights,caps=[],flags=[];
  let final=centering.score*w.centering+corners.score*w.corners+edges.score*w.edges+surface.score*w.surface;
  const worstCorner=Math.min(...corners.corners),worstEdge=Math.min(...edges.edges);
  if(worstCorner<=4.2){caps.push(GRADING_CONFIG.severeDefectCaps.majorCorner);flags.push({type:"majorCorner",severity:"high",message:"Possibile danno importante rilevato nell'angolo peggiore."})}
  if(worstEdge<=4.0){caps.push(GRADING_CONFIG.severeDefectCaps.majorEdge);flags.push({type:"majorEdge",severity:"high",message:"Possibile usura importante rilevata sul bordo peggiore."})}
  if(surface.score<=4.8){caps.push(GRADING_CONFIG.severeDefectCaps.majorSurface);flags.push({type:"majorSurface",severity:"high",message:"Possibile difetto superficiale importante visibile nella fotografia."})}
  const appliedCap=caps.length?Math.min(...caps):null;
  if(appliedCap!=null)final=Math.min(final,appliedCap);
  final=Math.round(clamp(final,1,10)*10)/10;
  const structuralConfidence=.58;
  let confidence=Math.round(100*clamp(quality.score*.72+structuralConfidence*.28,0,.82));
  if(quality.glareRatio>.04||quality.blurVariance<80)confidence=Math.max(20,confidence-10);
  return {sampleSize:{w:s.w,h:s.h},quality:quality,margins:margins,centering:centering,corners:corners,edges:edges,surface:surface,defects:flags,appliedCap:appliedCap,finalGrade:final,confidence:confidence};
}
export function drawGradingOverlay(sourceCanvas,analysis,targetCanvas,label="FRONT"){
  const w=sourceCanvas.width,h=sourceCanvas.height;targetCanvas.width=w;targetCanvas.height=h;
  const ctx=targetCanvas.getContext("2d");ctx.drawImage(sourceCanvas,0,0,w,h);
  const sw=analysis.sampleSize&&analysis.sampleSize.w||w,sh=analysis.sampleSize&&analysis.sampleSize.h||h,m=analysis.margins||{left:0,right:0,top:0,bottom:0};
  const left=m.left/sw*w,right=w-m.right/sw*w,top=m.top/sh*h,bottom=h-m.bottom/sh*h;
  ctx.save();ctx.lineWidth=Math.max(2,w/250);ctx.strokeStyle="#22d3ee";ctx.setLineDash([Math.max(8,w/70),Math.max(5,w/100)]);
  for(const x of[left,right]){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
  for(const y of[top,bottom]){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  ctx.setLineDash([]);ctx.strokeStyle="#8b5cf6";ctx.lineWidth=Math.max(2,w/300);
  const cw=w*.13,ch=h*.10;
  [[0,0],[w-cw,0],[w-cw,h-ch],[0,h-ch]].forEach(([x,y])=>ctx.strokeRect(x,y,cw,ch));
  ctx.fillStyle="rgba(2,6,23,.78)";ctx.fillRect(0,0,w,Math.max(54,h*.065));
  ctx.fillStyle="#f8fafc";ctx.font="bold "+Math.max(15,Math.round(w/29))+"px sans-serif";
  const lr=analysis.centering.lr,tb=analysis.centering.tb;
  ctx.fillText(label+"  L/R "+lr[0]+"/"+lr[1]+"  T/B "+tb[0]+"/"+tb[1],Math.max(8,w*.02),Math.max(28,h*.04));
  ctx.restore();targetCanvas.hidden=false;
}
export async function saveGrade(payload){
  const row=Object.assign({id:"grade:"+crypto.randomUUID(),createdAt:new Date().toISOString(),gradingAlgorithmVersion:GRADING_ALGORITHM_VERSION},payload);
  await put("grades",row);return row;
}
export async function renderHistory(){
  const root=document.querySelector("#gradingHistory");if(!root)return;
  const rows=(await getAll("grades")).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  root.innerHTML=rows.length?rows.map(r=>'<article class="history-item"><b>'+(r.cardName||"Carta non identificata")+'</b><div>Grade '+r.finalGrade+'/10 • Confidence '+r.confidence+'%</div><small>'+new Date(r.createdAt).toLocaleString("it-IT")+' • algoritmo '+r.gradingAlgorithmVersion+'</small></article>').join(""):'<div class="notice">Nessun grading salvato.</div>';
}
export function professionalInterval(grade,confidence){
  if(confidence<45)return null;
  return [Math.max(1,Math.floor(grade-1)),Math.min(10,Math.ceil(grade+.6))];
}
