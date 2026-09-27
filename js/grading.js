import{GRADING_ALGORITHM_VERSION}from"./config.js";
import{GRADING_CONFIG}from"./grading-config.js";
import{put,getAll,get,remove}from"./db.js";

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function avg(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0}
function sample(canvas,maxW=720){
  const scale=Math.min(1,maxW/canvas.width),w=Math.max(80,Math.round(canvas.width*scale)),h=Math.max(112,Math.round(canvas.height*scale));
  const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(canvas,0,0,w,h);
  return{w,h,data:x.getImageData(0,0,w,h).data};
}
function grayAt(d,i){return .299*d[i]+.587*d[i+1]+.114*d[i+2]}
function chromaAt(d,i){return Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2])}
function photoQuality(s){
  const d=s.data,gray=new Float32Array(s.w*s.h);let sum=0,sat=0,dark=0,n=0,lapSum=0,lapSq=0,ln=0;
  for(let p=0,i=0;i<d.length;i+=4,p++){const g=grayAt(d,i);gray[p]=g;sum+=g;if(g>245)sat++;if(g<22)dark++;n++}
  for(let y=1;y<s.h-1;y+=2)for(let x=1;x<s.w-1;x+=2){const p=y*s.w+x,v=4*gray[p]-gray[p-1]-gray[p+1]-gray[p-s.w]-gray[p+s.w];lapSum+=v;lapSq+=v*v;ln++}
  const mean=sum/Math.max(1,n),blurVariance=lapSq/Math.max(1,ln)-Math.pow(lapSum/Math.max(1,ln),2),glare=sat/Math.max(1,n),shadow=dark/Math.max(1,n);
  const exposure=1-Math.min(1,Math.abs(mean-GRADING_CONFIG.photo.targetBrightness)/105),sharpness=clamp((blurVariance-35)/560,0,1),glareScore=clamp(1-glare/GRADING_CONFIG.photo.maxGlare,0,1),shadowScore=clamp(1-shadow/.18,0,1);
  const score=clamp(exposure*.27+sharpness*.43+glareScore*.20+shadowScore*.10,0,1);
  const warnings=[];
  if(mean<GRADING_CONFIG.photo.acceptableBrightness[0])warnings.push("foto sottoesposta");
  if(mean>GRADING_CONFIG.photo.acceptableBrightness[1])warnings.push("foto sovraesposta");
  if(blurVariance<GRADING_CONFIG.photo.minSharpness)warnings.push("nitidezza insufficiente");
  if(glare>GRADING_CONFIG.photo.maxGlare)warnings.push("riflessi eccessivi");
  return{meanBrightness:Math.round(mean),blurVariance:Math.round(blurVariance),glareRatio:Number(glare.toFixed(4)),shadowRatio:Number(shadow.toFixed(4)),score,warnings};
}
function projectionEdges(s){
  const w=s.w,h=s.h,d=s.data,gray=new Float32Array(w*h),xs=new Float32Array(w),ys=new Float32Array(h);
  for(let p=0,i=0;i<d.length;i+=4,p++)gray[p]=grayAt(d,i);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;xs[x]+=Math.abs(gray[p+1]-gray[p-1]);ys[y]+=Math.abs(gray[p+w]-gray[p-w])}
  const smooth=arr=>{const out=new Float32Array(arr.length);for(let i=0;i<arr.length;i++){let t=0,n=0;for(let k=-2;k<=2;k++){const j=i+k;if(j>=0&&j<arr.length){t+=arr[j];n++}}out[i]=t/n}return out},sx=smooth(xs),sy=smooth(ys);
  const pick=(arr,start,end)=>{
    const lo=Math.max(0,start),hi=Math.min(arr.length-1,end);let bi=lo,bv=-1,sum=0,sumSq=0,n=0;
    for(let i=lo;i<=hi;i++){const v=arr[i];sum+=v;sumSq+=v*v;n++;if(v>bv){bv=v;bi=i}}
    const mean=sum/Math.max(1,n),variance=Math.max(0,sumSq/Math.max(1,n)-mean*mean),sd=Math.sqrt(variance),z=(bv-mean)/(sd+1),relative=(bv-mean)/(Math.abs(mean)+1),confidence=clamp(z/4*.62+relative*.38,0,1);
    return{index:bi,value:bv,mean,sd,confidence};
  };
  const l=pick(sx,Math.round(w*.025),Math.round(w*.24)),r=pick(sx,Math.round(w*.76),Math.round(w*.975)),t=pick(sy,Math.round(h*.02),Math.round(h*.24)),b=pick(sy,Math.round(h*.76),Math.round(h*.98));
  const strengths=[l.value,r.value,t.value,b.value],meanStrength=avg(strengths),peakBalance=meanStrength?Math.min(...strengths)/Math.max(...strengths):0,peakConfidence=avg([l.confidence,r.confidence,t.confidence,b.confidence]),signalConfidence=clamp(peakConfidence*.78+peakBalance*.22,0,1);
  return{left:l.index,right:w-1-r.index,top:t.index,bottom:h-1-b.index,peakBalance:Number(peakBalance.toFixed(3)),peakConfidence:Number(peakConfidence.toFixed(3)),signalConfidence:Number(signalConfidence.toFixed(3))};
}
function ratioPair(a,b){const t=a+b||1,p=Math.round(a/t*1000)/10;return[p,Math.round((100-p)*10)/10]}
function centeringScore(m){
  const lr=ratioPair(m.left,m.right),tb=ratioPair(m.top,m.bottom),dev=Math.max(Math.abs(50-lr[0]),Math.abs(50-tb[0])),balancePenalty=m.peakBalance<.25?(0.25-m.peakBalance)*4:0,raw=clamp(10-dev*.18-balancePenalty,1,10),reliability=clamp(Number(m.signalConfidence)||0,0,1);
  return{lr,tb,score:Number(raw.toFixed(1)),rawScore:Number(raw.toFixed(1)),reliability:Number(reliability.toFixed(3)),edgePeakBalance:m.peakBalance};
}
function regionStats(s,x0,y0,x1,y1){
  const d=s.data,w=s.w,h=s.h;let n=0,sum=0,sumSq=0,neutralBright=0,highlights=0,strongGrad=0;
  x0=Math.max(1,Math.floor(x0));y0=Math.max(1,Math.floor(y0));x1=Math.min(w-1,Math.ceil(x1));y1=Math.min(h-1,Math.ceil(y1));
  for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const i=(y*w+x)*4,g=grayAt(d,i),ch=chromaAt(d,i),gx=Math.abs(grayAt(d,i+4)-grayAt(d,i-4)),gy=Math.abs(grayAt(d,i+w*4)-grayAt(d,i-w*4));n++;sum+=g;sumSq+=g*g;if(g>214&&ch<25)neutralBright++;if(g>244)highlights++;if(Math.hypot(gx,gy)>62)strongGrad++}
  const mean=sum/Math.max(1,n),variance=sumSq/Math.max(1,n)-mean*mean;
  return{mean,variance,neutralBright:neutralBright/Math.max(1,n),highlights:highlights/Math.max(1,n),strongGrad:strongGrad/Math.max(1,n)};
}
function damageAgainst(edge,reference){
  const whitening=Math.max(0,edge.neutralBright-reference.neutralBright*.55-.018),roughness=Math.max(0,edge.strongGrad-reference.strongGrad*.82-.012),glare=Math.max(0,edge.highlights-reference.highlights*.65-.01);
  return{whitening,roughness,glare,penalty:whitening*25+roughness*12+glare*9};
}
function cornerAnalysis(s){
  const w=s.w,h=s.h,cw=Math.max(14,Math.round(w*.12)),ch=Math.max(18,Math.round(h*.09)),ix=Math.round(cw*.62),iy=Math.round(ch*.62);
  const boxes=[[0,0,cw,ch],[w-cw,0,w,ch],[w-cw,h-ch,w,h],[0,h-ch,cw,h]],refs=[[ix,iy,cw*1.7,ch*1.7],[w-cw*1.7,iy,w-ix,ch*1.7],[w-cw*1.7,h-ch*1.7,w-ix,h-iy],[ix,h-ch*1.7,cw*1.7,h-iy]];
  const evidence=boxes.map((b,i)=>damageAgainst(regionStats(s,...b),regionStats(s,...refs[i])));
  const scores=evidence.map(e=>Number(clamp(10-e.penalty,2.5,10).toFixed(1))),worst=Math.min(...scores);
  return{corners:scores,score:Number((worst*.68+avg(scores)*.32).toFixed(1)),whitening:evidence.map(e=>Number(e.whitening.toFixed(4))),evidence};
}
function edgeAnalysis(s){
  const w=s.w,h=s.h,t=Math.max(8,Math.round(Math.min(w,h)*.035)),inset=t*1.8;
  const edgeBoxes=[[t,0,w-t,t],[t,h-t,w-t,h],[0,t,t,h-t],[w-t,t,w,h-t]],refBoxes=[[t,inset,w-t,inset+t],[t,h-inset-t,w-t,h-inset],[inset,t,inset+t,h-t],[w-inset-t,t,w-inset,h-t]];
  const evidence=edgeBoxes.map((b,i)=>damageAgainst(regionStats(s,...b),regionStats(s,...refBoxes[i])));
  const scores=evidence.map(e=>Number(clamp(10-e.penalty,2.5,10).toFixed(1))),worst=Math.min(...scores);
  return{edges:scores,score:Number((worst*.58+avg(scores)*.42).toFixed(1)),whitening:evidence.map(e=>Number(e.whitening.toFixed(4))),evidence};
}
function surfaceAnalysis(s){
  const w=s.w,h=s.h,d=s.data,x0=Math.round(w*.14),x1=Math.round(w*.86),y0=Math.round(h*.14),y1=Math.round(h*.86),rowCounts=new Uint16Array(Math.max(1,y1-y0)),colCounts=new Uint16Array(Math.max(1,x1-x0));
  let n=0,scratch=0,spot=0,strong=0;
  for(let y=y0+2;y<y1-2;y+=2)for(let x=x0+2;x<x1-2;x+=2){const i=(y*w+x)*4,g=grayAt(d,i),l=grayAt(d,i-8),r=grayAt(d,i+8),u=grayAt(d,i-w*8),dn=grayAt(d,i+w*8),local=(l+r+u+dn)/4,gx=Math.abs(r-l),gy=Math.abs(dn-u),mag=Math.hypot(gx,gy),delta=Math.abs(g-local),ch=chromaAt(d,i);n++;if(mag>72){strong++;rowCounts[y-y0]++;colCounts[x-x0]++}if(delta>42&&mag>58)scratch++;if(delta>55&&ch<35)spot++}
  const rowMax=Math.max(...rowCounts),colMax=Math.max(...colCounts),samplesPerRow=Math.max(1,Math.ceil((x1-x0)/2)),samplesPerCol=Math.max(1,Math.ceil((y1-y0)/2)),lineRatio=Math.max(rowMax/samplesPerRow,colMax/samplesPerCol),strongRatio=strong/Math.max(1,n),scratchRatio=scratch/Math.max(1,n),spotRatio=spot/Math.max(1,n);
  const base=regionStats(s,x0,y0,x1,y1),prominence=lineRatio/Math.max(.01,strongRatio),creaseLikely=lineRatio>.52&&prominence>GRADING_CONFIG.thresholds.creaseProminence&&base.highlights<.05;
  const penalty=Math.max(0,scratchRatio-.018)*48+Math.max(0,spotRatio-.012)*24+(creaseLikely?1.35:0)+Math.max(0,base.highlights-.025)*12;
  const score=Number(clamp(9.7-penalty,3.5,9.7).toFixed(1));
  return{score,scratchRatio:Number(scratchRatio.toFixed(4)),spotRatio:Number(spotRatio.toFixed(4)),strongEdgeRatio:Number(strongRatio.toFixed(4)),lineRatio:Number(lineRatio.toFixed(4)),lineProminence:Number(prominence.toFixed(2)),creaseLikely,note:"Analisi fotografica di graffi/segni lineari, macchie ad alto contrasto e possibili pieghe; texture olografiche e riflessi possono generare falsi positivi."};
}
export function analyzeCanvas(canvas,options={}){
  const s=sample(canvas),quality=photoQuality(s),margins=projectionEdges(s),centering=centeringScore(margins),corners=cornerAnalysis(s),edges=edgeAnalysis(s),surface=surfaceAnalysis(s),flags=[],caps=[];
  const th=GRADING_CONFIG.thresholds;
  if(Math.min(...corners.corners)<=th.majorCornerScore){caps.push(GRADING_CONFIG.severeDefectCaps.majorCorner);flags.push({type:"majorCorner",severity:"high",message:"Possibile danno importante rilevato in almeno un angolo."})}
  if(Math.min(...edges.edges)<=th.majorEdgeScore){caps.push(GRADING_CONFIG.severeDefectCaps.majorEdge);flags.push({type:"majorEdge",severity:"high",message:"Possibile usura/whitening importante rilevato su almeno un bordo."})}
  if(surface.score<=th.majorSurfaceScore){caps.push(GRADING_CONFIG.severeDefectCaps.majorSurface);flags.push({type:"majorSurface",severity:"high",message:"Possibile difetto superficiale importante rilevato."})}
  if(avg(edges.whitening)>th.whiteningHigh)flags.push({type:"whitening",severity:"medium",message:"Whitening chiaro rilevato lungo i bordi."});
  if(surface.scratchRatio>th.scratchHigh)flags.push({type:"scratch",severity:"medium",message:"Possibili graffi o segni lineari ad alto contrasto rilevati sulla superficie."});
  if(surface.creaseLikely)flags.push({type:"creaseCandidate",severity:"medium",message:"Possibile piega/crease lineare: richiede conferma visiva, preferibilmente anche sul retro."});
  if(centering.reliability<th.weakCenteringSignal)flags.push({type:"weakCenteringSignal",severity:"info",message:"Segnale del bordo interno debole: il centering è meno affidabile su questa foto o su questo layout."});
  const w=GRADING_CONFIG.weights;let final=centering.score*w.centering+corners.score*w.corners+edges.score*w.edges+surface.score*w.surface,appliedCap=caps.length?Math.min(...caps):null;if(appliedCap!=null)final=Math.min(final,appliedCap);final=Math.round(clamp(final,1,10)*10)/10;
  const native=options.sourceResolution&&Number(options.sourceResolution.w)>0&&Number(options.sourceResolution.h)>0?options.sourceResolution:{w:canvas.width,h:canvas.height},geometry=Number.isFinite(Number(options.borderConfidence))&&Number(options.borderConfidence)>0?clamp(Number(options.borderConfidence)/100,0,1):.62,resolution=clamp(Math.min(Number(native.w)/900,Number(native.h)/1260),0,1);
  let confidence=Math.round(100*clamp(quality.score*.50+geometry*.22+resolution*.15+centering.reliability*.13,0,.92));
  if(quality.warnings.length)confidence=Math.min(confidence,GRADING_CONFIG.confidenceCaps.poorPhoto);
  if(geometry<.55)confidence=Math.min(confidence,GRADING_CONFIG.confidenceCaps.weakGeometry);
  if(centering.reliability<th.weakCenteringSignal)confidence=Math.min(confidence,55);
  return{sampleSize:{w:s.w,h:s.h},sourceSize:{w:Math.round(Number(native.w)),h:Math.round(Number(native.h))},quality,margins,centering,corners,edges,surface,defects:flags,appliedCap,finalGrade:final,confidence,geometryConfidence:Math.round(geometry*100),side:options.side||null};
}
function damageWeighted(front,back,key,worstWeight){
  if(!back)return front[key].score;
  const a=front[key].score,b=back[key].score,worst=Math.min(a,b),mean=(a+b)/2;
  return Math.round((worst*worstWeight+mean*(1-worstWeight))*10)/10;
}
export function combineAnalyses(front,back){
  const w=GRADING_CONFIG.weights,center=back?Math.round(((front.centering.score+back.centering.score)/2)*10)/10:front.centering.score,corners=damageWeighted(front,back,"corners",.62),edges=damageWeighted(front,back,"edges",.58),surface=damageWeighted(front,back,"surface",.65);
  let final=Math.round((center*w.centering+corners*w.corners+edges*w.edges+surface*w.surface)*10)/10;
  const caps=[front.appliedCap,back&&back.appliedCap].filter(v=>v!=null),frontCrease=front.surface&&front.surface.creaseLikely,backCrease=back&&back.surface&&back.surface.creaseLikely;
  if(frontCrease&&backCrease)caps.push(GRADING_CONFIG.severeDefectCaps.crease);
  else if(frontCrease||backCrease)caps.push(6.5);
  const appliedCap=caps.length?Math.min(...caps):null;if(appliedCap!=null)final=Math.min(final,appliedCap);
  let confidence=back?Math.round((front.confidence+back.confidence)/2+6):Math.round(front.confidence*.78);
  confidence=Math.min(confidence,back?GRADING_CONFIG.confidenceCaps.frontBack:GRADING_CONFIG.confidenceCaps.frontOnly);
  if(front.quality.warnings.length||back&&back.quality.warnings.length)confidence=Math.min(confidence,GRADING_CONFIG.confidenceCaps.poorPhoto);
  return{center,corners,edges,surface,finalGrade:Number(final.toFixed(1)),confidence,appliedCap,defects:[...(front.defects||[]),...(back&&back.defects||[])],frontCrease:Boolean(frontCrease),backCrease:Boolean(backCrease)};
}
export function gradeability(analysis){
  const q=analysis&&analysis.quality||{},size=analysis&&analysis.sourceSize||{},limits=GRADING_CONFIG.photo.hardLimits,blockers=[];
  if(Number(q.blurVariance)<limits.minSharpness)blockers.push("immagine troppo sfocata");
  if(Number(q.meanBrightness)<limits.minBrightness)blockers.push("foto troppo scura");
  if(Number(q.meanBrightness)>limits.maxBrightness)blockers.push("foto troppo chiara");
  if(Number(q.glareRatio)>limits.maxGlare)blockers.push("riflessi eccessivi");
  if(Number(size.w)<limits.minWidth||Number(size.h)<limits.minHeight)blockers.push("risoluzione insufficiente");
  return{usable:blockers.length===0,blockers};
}
export function applyInspection(combined,inspection={}){
  const active=Object.entries(GRADING_CONFIG.manualDefects).filter(([key])=>Boolean(inspection&&inspection[key])),manualDefects=active.map(([key,rule])=>({type:"manual:"+key,severity:rule.severity,source:"manual",message:"Confermato manualmente: "+rule.label+".",cap:rule.cap})),caps=[combined.appliedCap,...manualDefects.map(x=>x.cap)].filter(v=>v!=null),appliedCap=caps.length?Math.min(...caps):null;
  const final=appliedCap==null?combined.finalGrade:Math.min(combined.finalGrade,appliedCap);
  return{...combined,finalGrade:Number(final.toFixed(1)),appliedCap,defects:[...(combined.defects||[]),...manualDefects],inspection:Object.fromEntries(active.map(([key])=>[key,true]))};
}
export function gradingStatus(front,back,combined){
  const backUsable=Boolean(back),warnings=[...(front&&front.quality&&front.quality.warnings||[]),...(back&&back.quality&&back.quality.warnings||[])],weakGeometry=Math.min(front&&front.geometryConfidence||0,backUsable?(back.geometryConfidence||0):100)<60,weakCenter=Boolean((front&&front.centering&&front.centering.reliability<GRADING_CONFIG.thresholds.weakCenteringSignal)||(backUsable&&back.centering&&back.centering.reliability<GRADING_CONFIG.thresholds.weakCenteringSignal));
  if(!backUsable)return{code:"provisional",label:"PROVVISORIO",message:"Manca un retro idoneo: il voto è una stima sul solo fronte."};
  if((combined&&combined.confidence||0)>=70&&!warnings.length&&!weakGeometry&&!weakCenter)return{code:"complete",label:"COMPLETO",message:"Fronte e retro idonei, geometria e segnali fotografici sufficienti."};
  return{code:"assisted",label:"ASSISTITO",message:"Fronte e retro presenti, ma almeno un segnale richiede verifica visiva."};
}
export function drawGradingOverlay(sourceCanvas,analysis,targetCanvas,label="FRONT"){
  const w=sourceCanvas.width,h=sourceCanvas.height;targetCanvas.width=w;targetCanvas.height=h;const ctx=targetCanvas.getContext("2d");ctx.drawImage(sourceCanvas,0,0,w,h);
  const sw=analysis.sampleSize&&analysis.sampleSize.w||w,sh=analysis.sampleSize&&analysis.sampleSize.h||h,m=analysis.margins||{left:0,right:0,top:0,bottom:0},left=m.left/sw*w,right=w-m.right/sw*w,top=m.top/sh*h,bottom=h-m.bottom/sh*h;
  ctx.save();ctx.lineWidth=Math.max(2,w/250);ctx.strokeStyle="#22d3ee";ctx.setLineDash([Math.max(8,w/70),Math.max(5,w/100)]);
  for(const x of[left,right]){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}for(const y of[top,bottom]){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  ctx.setLineDash([]);ctx.strokeStyle="#8b5cf6";ctx.lineWidth=Math.max(2,w/300);const cw=w*.12,ch=h*.09;[[0,0],[w-cw,0],[w-cw,h-ch],[0,h-ch]].forEach(([x,y])=>ctx.strokeRect(x,y,cw,ch));
  ctx.strokeStyle="#f59e0b";ctx.globalAlpha=.85;const et=Math.max(3,Math.min(w,h)*.035);ctx.strokeRect(et/2,et/2,w-et,h-et);ctx.globalAlpha=1;
  ctx.fillStyle="rgba(2,6,23,.80)";ctx.fillRect(0,0,w,Math.max(58,h*.07));ctx.fillStyle="#f8fafc";ctx.font="bold "+Math.max(15,Math.round(w/29))+"px sans-serif";const lr=analysis.centering.lr,tb=analysis.centering.tb;ctx.fillText(label+"  L/R "+lr[0]+"/"+lr[1]+"  T/B "+tb[0]+"/"+tb[1],Math.max(8,w*.02),Math.max(28,h*.04));ctx.restore();targetCanvas.hidden=false;
}
export async function saveGrade(payload){
  const row=Object.assign({id:"grade:"+crypto.randomUUID(),createdAt:new Date().toISOString(),gradingAlgorithmVersion:GRADING_ALGORITHM_VERSION},payload);
  await put("grades",row);return row;
}
function escHtml(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function inspectionSummary(inspection={}){
  const rows=Object.entries(GRADING_CONFIG.manualDefects).filter(([key])=>inspection&&inspection[key]).map(([,rule])=>escHtml(rule.label));
  return rows.length?'<div class="notice"><b>Difetti confermati manualmente</b><br>'+rows.join("<br>")+'</div>':"";
}
function blobCanvas(blob){
  return new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{const c=document.createElement("canvas");c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext("2d").drawImage(img,0,0);URL.revokeObjectURL(url);resolve(c)};img.onerror=e=>{URL.revokeObjectURL(url);reject(e)};img.src=url});
}
function combinedResult(front,back){return combineAnalyses(front,back)}
async function openGrade(row){
  const dialog=document.querySelector("#cardDialog"),body=document.querySelector("#cardDialogBody");if(!dialog||!body)return;
  const front=row.frontScanId?await get("scans",row.frontScanId):null,back=row.backScanId?await get("scans",row.backScanId):null,urls=[];
  const imageHtml=(scan,label)=>{
    if(!scan)return"";
    const parts=[];
    if(scan.originalBlob){const u=URL.createObjectURL(scan.originalBlob);urls.push(u);parts.push('<div><small>'+label+' originale</small><img class="detail-image" src="'+u+'" alt=""></div>')}
    if(scan.correctedBlob){const u=URL.createObjectURL(scan.correctedBlob);urls.push(u);parts.push('<div><small>'+label+' raddrizzato</small><img class="detail-image" src="'+u+'" alt=""></div>')}
    return parts.join("");
  };
  const fa=row.frontAnalysis,ba=row.backAnalysis,display=fa?combineAnalyses(fa,ba):null,metrics=display?'<div class="metric"><span>Centering</span><b>'+Number(display.center).toFixed(1)+'</b></div><div class="metric"><span>Corners</span><b>'+Number(display.corners).toFixed(1)+'</b></div><div class="metric"><span>Edges</span><b>'+Number(display.edges).toFixed(1)+'</b></div><div class="metric"><span>Surface</span><b>'+Number(display.surface).toFixed(1)+'</b></div>':"";
  const ratios=fa?'<p>FRONT L/R '+fa.centering.lr.join("/")+' • T/B '+fa.centering.tb.join("/")+(ba?'<br>BACK L/R '+ba.centering.lr.join("/")+' • T/B '+ba.centering.tb.join("/"):"")+'</p>':"";
  body.innerHTML='<h2>'+escHtml(row.cardName||"Carta non identificata")+'</h2><p>'+new Date(row.createdAt).toLocaleString("it-IT")+'</p>'+(row.statusLabel?'<p class="grade-status '+escHtml(row.statusCode||"")+'">'+escHtml(row.statusLabel)+'</p>':"")+metrics+'<div class="metric"><span>Final Grade</span><b>'+row.finalGrade+'/10</b></div><p class="confidence">Confidence '+row.confidence+'%</p>'+ratios+'<p>Algoritmo: '+escHtml(row.gradingAlgorithmVersion||"sconosciuto")+'</p>'+inspectionSummary(row.inspection)+((row.defects||[]).length?'<div class="notice">'+row.defects.map(x=>escHtml(x.message||x.type)).join(" ")+'</div>':"")+imageHtml(front,"Fronte")+imageHtml(back,"Retro")+(front&&front.correctedBlob?'<div class="scanner-actions"><button id="recalcGradeBtn" class="primary">Ricalcola con algoritmo attuale</button><button id="deleteGradeBtn" class="danger">Elimina grading</button></div>':"");
  const recalc=document.querySelector("#recalcGradeBtn");
  if(recalc)recalc.onclick=async()=>{
    recalc.disabled=true;recalc.textContent="Ricalcolo…";
    try{
      const frontCanvas=await blobCanvas(front.correctedBlob),backCanvas=back&&back.correctedBlob?await blobCanvas(back.correctedBlob):null,frontAnalysis=analyzeCanvas(frontCanvas,{side:"front",borderConfidence:front.borderDetectionConfidence||0,sourceResolution:{w:front.nativeCardWidth||frontCanvas.width,h:front.nativeCardHeight||frontCanvas.height}});
      if(!gradeability(frontAnalysis).usable)throw new Error("il fronte salvato non supera i requisiti minimi del nuovo algoritmo");
      let backAnalysis=backCanvas?analyzeCanvas(backCanvas,{side:"back",borderConfidence:back.borderDetectionConfidence||0,sourceResolution:{w:back.nativeCardWidth||backCanvas.width,h:back.nativeCardHeight||backCanvas.height}}):null;if(backAnalysis&&!gradeability(backAnalysis).usable)backAnalysis=null;
      const combined=applyInspection(combinedResult(frontAnalysis,backAnalysis),row.inspection||{}),status=gradingStatus(frontAnalysis,backAnalysis,combined);
      await saveGrade({cardId:row.cardId||null,printingId:row.printingId||null,cardName:row.cardName||null,frontScanId:row.frontScanId,backScanId:row.backScanId||null,frontAnalysis,backAnalysis,inspection:combined.inspection,finalGrade:combined.finalGrade,confidence:combined.confidence,appliedCap:combined.appliedCap,defects:combined.defects,statusCode:status.code,statusLabel:status.label,recalculatedFrom:row.id});
      dialog.close();await renderHistory();
    }catch(e){recalc.disabled=false;recalc.textContent="Ricalcola con algoritmo attuale";alert("Ricalcolo non riuscito: "+e.message)}
  };
  const del=document.querySelector("#deleteGradeBtn");
  if(del)del.onclick=async()=>{if(!confirm("Eliminare questo risultato di grading? Le foto restano disponibili per eventuali altri risultati."))return;del.disabled=true;await remove("grades",row.id);dialog.close();await renderHistory()};
  const cleanup=()=>{urls.forEach(URL.revokeObjectURL);dialog.removeEventListener("close",cleanup)};dialog.addEventListener("close",cleanup);
  dialog.showModal();
}
export async function renderHistory(){
  const root=document.querySelector("#gradingHistory");if(!root)return;
  const rows=(await getAll("grades")).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  root.innerHTML=rows.length?rows.map(r=>'<button class="history-item" data-grade-id="'+escHtml(r.id)+'"><b>'+(escHtml(r.cardName||"Carta non identificata"))+'</b><div>Grade '+r.finalGrade+'/10 • Confidence '+r.confidence+'%</div><small>'+(r.statusLabel?escHtml(r.statusLabel)+' • ':"")+new Date(r.createdAt).toLocaleString("it-IT")+' • algoritmo '+escHtml(r.gradingAlgorithmVersion)+'</small>'+(r.recalculatedFrom?'<small> • ricalcolo</small>':"")+'</button>').join(""):'<div class="notice">Nessun grading salvato.</div>';
  root.querySelectorAll("[data-grade-id]").forEach(btn=>btn.onclick=()=>{const row=rows.find(x=>x.id===btn.dataset.gradeId);if(row)openGrade(row)});
}
export function professionalInterval(grade,confidence){
  if(confidence<45)return null;
  const delta=confidence>=75?[.5,.5]:confidence>=60?[1,.75]:[1.5,1];
  const half=v=>Math.round(v*2)/2;
  return [Math.max(1,half(grade-delta[0])),Math.min(10,half(grade+delta[1]))];
}
