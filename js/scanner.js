import{setting,put}from"./db.js";
import{recognizeCard}from"./recognition.js";
import{analyzeCanvas,saveGrade,professionalInterval,drawGradingOverlay}from"./grading.js";
import{GRADING_CONFIG}from"./grading-config.js";
import{CONDITION_ESTIMATES}from"./config.js";
import{getPricesForCard,reliability}from"./prices.js";
import{addCopy}from"./collection.js";

const state={stream:null,timer:null,busy:false,currentSide:"front",original:null,corners:null,detectedCorners:null,zoom:1,panX:0,panY:0,drag:null,prevThumb:null,stableFrames:0,lastQuality:null,borderConfidence:0,captures:{front:null,back:null},recognized:null,onCardIdentified:null};
const $=s=>document.querySelector(s);
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function cloneCanvas(source){const c=document.createElement("canvas");c.width=source.width;c.height=source.height;c.getContext("2d").drawImage(source,0,0);return c}
function canvasBlob(canvas,type="image/jpeg",quality=.91){return new Promise(resolve=>canvas.toBlob(resolve,type,quality))}
function imageFromBlob(blob){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{URL.revokeObjectURL(img.src);resolve(img)};img.onerror=reject;img.src=URL.createObjectURL(blob)})}
function defaultCorners(img){const mx=img.width*.12,my=img.height*.08;return[{x:mx,y:my},{x:img.width-mx,y:my},{x:img.width-mx,y:img.height-my},{x:mx,y:img.height-my}]}

function frameQuality(canvas){
  const ctx=canvas.getContext("2d",{willReadFrequently:true}),im=ctx.getImageData(0,0,canvas.width,canvas.height),d=im.data,w=canvas.width,h=canvas.height;
  let sum=0,sat=0,n=0,lapSum=0,lapSq=0,ln=0;const gray=new Float32Array(w*h);
  for(let i=0,p=0;i<d.length;i+=4,p++){const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];gray[p]=g;sum+=g;if(g>247)sat++;n++}
  for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2){const p=y*w+x,v=4*gray[p]-gray[p-1]-gray[p+1]-gray[p-w]-gray[p+w];lapSum+=v;lapSq+=v*v;ln++}
  const blur=lapSq/Math.max(1,ln)-Math.pow(lapSum/Math.max(1,ln),2),brightness=sum/n,glare=sat/n;
  const thumb=[];for(let y=0;y<h;y+=12)for(let x=0;x<w;x+=12)thumb.push(gray[y*w+x]);
  let motion=0;if(state.prevThumb&&state.prevThumb.length===thumb.length){for(let i=0;i<thumb.length;i++)motion+=Math.abs(thumb[i]-state.prevThumb[i]);motion/=thumb.length}else motion=99;
  state.prevThumb=thumb;
  const good=brightness>48&&brightness<218&&blur>45&&glare<.075&&motion<8.5;
  return {brightness:brightness,blur:blur,glare:glare,motion:motion,good:good};
}
function detectQuadCV(canvas){
  if(!window.cv||!window.cv.imread)return null;
  let src,gray,blur,edges,contours,hierarchy;
  try{
    src=cv.imread(canvas);gray=new cv.Mat();blur=new cv.Mat();edges=new cv.Mat();contours=new cv.MatVector();hierarchy=new cv.Mat();
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);cv.Canny(blur,edges,60,150);cv.findContours(edges,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    let best=null,bestArea=0,total=canvas.width*canvas.height;
    for(let i=0;i<contours.size();i++){const cnt=contours.get(i),peri=cv.arcLength(cnt,true),approx=new cv.Mat();cv.approxPolyDP(cnt,approx,.025*peri,true);const area=Math.abs(cv.contourArea(approx));
      if(approx.rows===4&&area>total*.12&&area>bestArea&&cv.isContourConvex(approx)){const pts=[];for(let j=0;j<4;j++)pts.push({x:approx.intPtr(j,0)[0],y:approx.intPtr(j,0)[1]});best=orderQuad(pts);bestArea=area}approx.delete();cnt.delete();}
    if(!best)return null;
    const top=dist(best[0],best[1]),bottom=dist(best[3],best[2]),left=dist(best[0],best[3]),right=dist(best[1],best[2]);
    const ww=(top+bottom)/2,hh=(left+right)/2,aspect=Math.min(ww,hh)/Math.max(ww,hh),areaRatio=bestArea/total;
    const clipped=best.some(p=>p.x<canvas.width*.018||p.x>canvas.width*.982||p.y<canvas.height*.018||p.y>canvas.height*.982);
    const aspectScore=clamp(1-Math.abs(aspect-(2.5/3.5))/.22,0,1);
    const sizeScore=areaRatio<.16?0:areaRatio>.88?0:clamp(1-Math.abs(areaRatio-.48)/.48,0,1);
    return {points:best,aspect:aspect,areaRatio:areaRatio,clipped:clipped,confidence:Math.round(100*(aspectScore*.55+sizeScore*.35+(clipped?0:.10)))};
  }catch(e){return null}finally{for(const m of[src,gray,blur,edges,contours,hierarchy])if(m&&m.delete)try{m.delete()}catch(e){}}
}
function orderQuad(pts){
  if(!pts||pts.length!==4)return null;
  const sum=p=>p.x+p.y,dif=p=>p.x-p.y;
  const tl=pts.reduce((a,b)=>sum(a)<sum(b)?a:b),br=pts.reduce((a,b)=>sum(a)>sum(b)?a:b),tr=pts.reduce((a,b)=>dif(a)>dif(b)?a:b),bl=pts.reduce((a,b)=>dif(a)<dif(b)?a:b);
  return [tl,tr,br,bl];
}
async function analysisTick(){
  if(!state.stream||state.busy)return;
  const video=$("#cameraVideo");if(video.readyState<2){state.timer=setTimeout(analysisTick,500);return}
  const c=$("#analysisCanvas"),w=260,h=Math.max(160,Math.round(w*video.videoHeight/video.videoWidth));c.width=w;c.height=h;c.getContext("2d").drawImage(video,0,0,w,h);
  const q=frameQuality(c);state.lastQuality=q;
  const quad=detectQuadCV(c),shapeOk=quad&&quad.aspect>.54&&quad.aspect<.84&&quad.areaRatio>.16&&quad.areaRatio<.88&&!quad.clipped;
  if(quad){state.detectedCorners=quad.points.map(p=>({x:p.x/w,y:p.y/h}));state.borderConfidence=quad.confidence}else{state.detectedCorners=null;state.borderConfidence=0}
  if(q.good&&shapeOk)state.stableFrames++;else state.stableFrames=0;
  const hints=[];
  if(!quad)hints.push("carta/bordi non rilevati");
  else{
    if(quad.areaRatio<=.16)hints.push("avvicina la carta");
    if(quad.areaRatio>=.88)hints.push("allontana la carta");
    if(quad.aspect<=.54||quad.aspect>=.84)hints.push("proporzioni/bordi da correggere");
    if(quad.clipped)hints.push("carta tagliata dall'inquadratura");
  }
  if(q.brightness<=48)hints.push("più luce");if(q.brightness>=218)hints.push("troppa luce");if(q.blur<=45)hints.push("immagine poco nitida");if(q.glare>=.075)hints.push("riflessi");if(q.motion>=8.5)hints.push("tieni fermo");
  $("#scanQuality").textContent=hints.length?hints.join(" • "):"Pronto • 4 bordi validi • nitida • stabile";
  const auto=await setting("autoCapture",true);
  if(auto&&state.stableFrames>=3){state.stableFrames=0;await captureFromVideo(true)}
  state.timer=setTimeout(analysisTick,520);
}

export async function startCamera(){
  stopCamera();
  try{
    state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});
    const v=$("#cameraVideo");v.srcObject=state.stream;await v.play();$("#captureBtn").disabled=false;$("#scanQuality").textContent="Analisi in corso…";analysisTick();
  }catch(e){$("#scanQuality").textContent="Fotocamera non disponibile: "+e.message;throw e}
}
export function stopCamera(){
  if(state.timer)clearTimeout(state.timer);state.timer=null;
  if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}
  const v=$("#cameraVideo");if(v)v.srcObject=null;const b=$("#captureBtn");if(b)b.disabled=true;
}
async function captureFromVideo(auto=false){
  if(state.busy||!state.stream)return;state.busy=true;
  try{
    const v=$("#cameraVideo"),scale=Math.min(1,1600/v.videoWidth),c=document.createElement("canvas");c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);c.getContext("2d").drawImage(v,0,0,c.width,c.height);
    const blob=await canvasBlob(c);const img=await imageFromBlob(blob);
    let corners=state.detectedCorners?state.detectedCorners.map(p=>({x:p.x*img.width,y:p.y*img.height})):defaultCorners(img);
    openEditor(img,corners,blob,auto);
  }finally{state.busy=false}
}
function viewTransform(){
  const c=$("#editorCanvas"),img=state.original,base=Math.min(c.width/img.width,c.height/img.height),scale=base*state.zoom;
  return {scale:scale,ox:c.width/2-img.width*scale/2+state.panX,oy:c.height/2-img.height*scale/2+state.panY};
}
function toScreen(p){const t=viewTransform();return{x:t.ox+p.x*t.scale,y:t.oy+p.y*t.scale}}
function toImage(p){const t=viewTransform();return{x:clamp((p.x-t.ox)/t.scale,0,state.original.width),y:clamp((p.y-t.oy)/t.scale,0,state.original.height)}}
function drawEditor(){
  const c=$("#editorCanvas"),ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);const t=viewTransform();ctx.drawImage(state.original,t.ox,t.oy,state.original.width*t.scale,state.original.height*t.scale);
  const pts=state.corners.map(toScreen);ctx.strokeStyle="#22d3ee";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<4;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.closePath();ctx.stroke();
  pts.forEach((p,i)=>{ctx.fillStyle="#8b5cf6";ctx.beginPath();ctx.arc(p.x,p.y,15,0,Math.PI*2);ctx.fill();ctx.fillStyle="white";ctx.font="bold 15px sans-serif";ctx.fillText(String(i+1),p.x-4,p.y+5)});
}
function openEditor(img,corners,blob,auto){
  state.original=img;state.corners=orderQuad(corners)||defaultCorners(img);state.originalBlob=blob;state.zoom=1;state.panX=0;state.panY=0;
  const c=$("#editorCanvas");c.width=800;c.height=900;$("#editorZoom").value="1";$("#borderEditor").hidden=false;$("#correctedPanel").hidden=true;drawEditor();
  $("#scanQuality").textContent=auto?"Scatto automatico eseguito. Verifica i 4 punti.":"Foto acquisita. Verifica i 4 punti.";
}
function solveLinear(A,b){
  const n=b.length;
  for(let i=0;i<n;i++){let max=i;for(let r=i+1;r<n;r++)if(Math.abs(A[r][i])>Math.abs(A[max][i]))max=r;[A[i],A[max]]=[A[max],A[i]];[b[i],b[max]]=[b[max],b[i]];const piv=A[i][i];if(Math.abs(piv)<1e-10)throw new Error("Trasformazione prospettica non valida");for(let j=i;j<n;j++)A[i][j]/=piv;b[i]/=piv;for(let r=0;r<n;r++){if(r===i)continue;const f=A[r][i];for(let j=i;j<n;j++)A[r][j]-=f*A[i][j];b[r]-=f*b[i]}}
  return b;
}
function homography(dst,src){
  const A=[],b=[];
  for(let i=0;i<4;i++){const x=dst[i].x,y=dst[i].y,u=src[i].x,v=src[i].y;A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v)}
  return solveLinear(A,b);
}
function perspectiveWarp(img,corners){
  const top=dist(corners[0],corners[1]),bottom=dist(corners[3],corners[2]),w=Math.round(clamp((top+bottom)/2,420,820)),h=Math.round(w*1.4);
  const srcC=document.createElement("canvas");srcC.width=img.width;srcC.height=img.height;const sx=srcC.getContext("2d",{willReadFrequently:true});sx.drawImage(img,0,0);
  const source=sx.getImageData(0,0,img.width,img.height),out=$("#correctedCanvas");out.width=w;out.height=h;const ox=out.getContext("2d"),target=ox.createImageData(w,h);
  const H=homography([{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}],corners),sd=source.data,td=target.data,sw=img.width,sh=img.height;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const den=H[6]*x+H[7]*y+1,u=(H[0]*x+H[1]*y+H[2])/den,v=(H[3]*x+H[4]*y+H[5])/den,di=(y*w+x)*4;if(u<0||v<0||u>=sw-1||v>=sh-1){td[di+3]=255;continue}
    const x0=Math.floor(u),y0=Math.floor(v),fx=u-x0,fy=v-y0,i00=(y0*sw+x0)*4,i10=i00+4,i01=i00+sw*4,i11=i01+4;
    for(let k=0;k<3;k++)td[di+k]=(sd[i00+k]*(1-fx)*(1-fy)+sd[i10+k]*fx*(1-fy)+sd[i01+k]*(1-fx)*fy+sd[i11+k]*fx*fy);td[di+3]=255}
  ox.putImageData(target,0,0);return out;
}
async function confirmCorners(){
  if(!state.original||!state.corners)return;
  $("#confirmCornersBtn").disabled=true;$("#confirmCornersBtn").textContent="Raddrizzamento…";
  try{
    const corrected=perspectiveWarp(state.original,state.corners),copy=cloneCanvas(corrected),correctedBlob=await canvasBlob(copy);
    const scanId="scan:"+crypto.randomUUID(),row={id:scanId,side:state.currentSide,createdAt:new Date().toISOString(),originalBlob:state.originalBlob,correctedBlob:correctedBlob,corners:state.corners.map(p=>({x:Math.round(p.x),y:Math.round(p.y)})),borderDetectionConfidence:state.detectedCorners?state.borderConfidence:0};
    await put("scans",row);state.captures[state.currentSide]={scanId:scanId,canvas:copy,corners:row.corners,quality:state.lastQuality};
    $("#borderEditor").hidden=true;$("#correctedPanel").hidden=false;renderCurrentSide();updateCaptureStatus();
    if(state.currentSide==="front"&&!state.captures.back)$("#scanQuality").textContent="Fronte pronto. Puoi acquisire il retro o continuare solo con il fronte.";
  }finally{$("#confirmCornersBtn").disabled=false;$("#confirmCornersBtn").textContent="CONFERMA BORDI"}
}
function renderCurrentSide(){
  const cap=state.captures[state.currentSide];if(!cap)return;
  const out=$("#correctedCanvas");out.width=cap.canvas.width;out.height=cap.canvas.height;out.getContext("2d").drawImage(cap.canvas,0,0);
}
function updateCaptureStatus(){
  $("#captureStatus").textContent=(state.captures.front?"fronte ✓":"fronte non acquisito")+" • "+(state.captures.back?"retro ✓":"retro opzionale");
}
function selectSide(side){
  state.currentSide=side;$("#sideFrontBtn").classList.toggle("active",side==="front");$("#sideBackBtn").classList.toggle("active",side==="back");
  if(state.captures[side]){$("#correctedPanel").hidden=false;renderCurrentSide()}else $("#correctedPanel").hidden=true;
}
async function doRecognition(){
  const cap=state.captures.front||state.captures[state.currentSide];if(!cap){$("#recognitionResult").innerHTML='<div class="notice">Acquisisci prima il fronte.</div>';return}
  const root=$("#recognitionResult");root.innerHTML='<div class="notice">OCR e matching in corso sul dispositivo…</div>';
  try{
    const preferred=document.querySelector(".game-btn.active")?.dataset.game||"all",r=await recognizeCard(cap.canvas,preferred),rows=r.candidates;
    if(!rows.length){root.innerHTML='<div class="notice">Riconoscimento non conclusivo. OCR: '+r.ocrConfidence+'%. Usa la ricerca manuale per selezionare la carta.</div>';return}
    const best=rows[0];state.recognized=best.card;
    root.innerHTML='<div class="analysis-box"><h3>Carta identificata</h3><b>'+best.card.name+'</b><div>'+ (best.card.collectionNumber||"—")+' • '+(best.card.setName||best.card.setCode||"")+'</div><p class="confidence">Confidenza: '+best.confidence+'% • OCR '+r.ocrConfidence+'%</p><small>Alternative:</small>'+rows.slice(1).map((x,i)=>'<button class="candidate-btn" data-i="'+(i+1)+'">'+x.card.name+' • '+(x.card.collectionNumber||"—")+' ('+x.confidence+'%)</button>').join(" ")+'<p><button id="manualSearchBtn">Correggi con ricerca manuale</button></p></div>';
    root.querySelectorAll(".candidate-btn").forEach(b=>b.onclick=()=>{const x=rows[Number(b.dataset.i)];state.recognized=x.card;root.querySelector("b").textContent=x.card.name;root.querySelector(".confidence").textContent="Selezione manuale tra i candidati.";});
    $("#manualSearchBtn").onclick=()=>document.querySelector('[data-view="search"]').click();
  }catch(e){root.innerHTML='<div class="notice">OCR non riuscito: '+e.message+' Puoi sempre usare la ricerca manuale.</div>'}
}
function conditionFromGrade(grade){
  if(grade>=8.5)return"NM";
  if(grade>=7)return"LP";
  if(grade>=5)return"MP";
  if(grade>=3)return"HP";
  return"DAMAGED";
}
function pricePriority(type){return({market:1,trend:2,mid:3,set_price:4,low:5,average:6,high:7,direct_low:8})[type]||99}
async function gradingValueHtml(card,grade){
  if(!card)return'<div class="notice">Carta non identificata: impossibile associare un valore alla stampa.</div>';
  const prices=await getPricesForCard(card);
  if(!prices.length)return'<div class="notice">Prezzo non disponibile per questa stampa. Dati insufficienti per stimare il valore da carta gradata.</div>';
  const condition=conditionFromGrade(grade),range=CONDITION_ESTIMATES[condition]||[1,1],byCurrency=new Map();
  for(const p of prices){if(!byCurrency.has(p.currency))byCurrency.set(p.currency,[]);byCurrency.get(p.currency).push(p)}
  const blocks=[];
  for(const [currency,rows] of byCurrency){
    rows.sort((a,b)=>pricePriority(a.priceType)-pricePriority(b.priceType));
    const p=rows[0],lo=Number(p.value)*range[0],hi=Number(p.value)*range[1];
    blocks.push('<div class="analysis-box"><b>Valore Raw osservato • '+p.source+' '+p.priceType+'</b><div>'+currency+' '+Number(p.value).toFixed(2)+' • '+(p.variant||"variante non specificata")+'</div><small>Affidabilità '+reliability(p)+' • '+(p.timestamp||"data non fornita")+'</small><div class="metric"><span>STIMA PER CONDIZIONE '+condition+'</span><b>'+(lo===hi?currency+' '+lo.toFixed(2):currency+' '+lo.toFixed(2)+'–'+hi.toFixed(2))+'</b></div><small>Stima derivata dall’intervallo configurato, non prezzo osservato per condizione.</small></div>');
  }
  return blocks.join("")+'<div class="notice">Dati insufficienti per stimare il valore da carta gradata certificata. Non viene applicato alcun moltiplicatore PSA/CGC/BGS.</div>';
}
async function doGrading(){
  const front=state.captures.front;if(!front){$("#gradingResult").innerHTML='<div class="notice">Per il grading serve almeno il fronte.</div>';return}
  const root=$("#gradingResult");root.innerHTML='<div class="notice">Analisi fotografica in corso…</div>';
  await new Promise(r=>setTimeout(r,30));
  const fa=analyzeCanvas(front.canvas),ba=state.captures.back?analyzeCanvas(state.captures.back.canvas):null;
  const avg=(key)=>ba?Math.round(((fa[key].score+ba[key].score)/2)*10)/10:fa[key].score;
  const center=avg("centering"),corners=avg("corners"),edges=avg("edges"),surface=avg("surface"),w=GRADING_CONFIG.weights;
  const final=Math.round((center*w.centering+corners*w.corners+edges*w.edges+surface*w.surface)*10)/10;
  let confidence=ba?Math.round((fa.confidence+ba.confidence)/2):Math.round(fa.confidence*.72);confidence=Math.min(confidence,ba?82:64);
  const capValues=[fa.appliedCap,ba&&ba.appliedCap].filter(v=>v!=null),appliedCap=capValues.length?Math.min(...capValues):null;
  const cappedFinal=appliedCap==null?final:Math.min(final,appliedCap),interval=professionalInterval(cappedFinal,confidence);
  const defects=[...(fa.defects||[]),...(ba&&ba.defects||[])];
  const saved=await saveGrade({cardId:state.recognized?state.recognized.cardId:null,printingId:state.recognized?state.recognized.printingId:null,cardName:state.recognized?state.recognized.name:null,frontScanId:front.scanId,backScanId:state.captures.back?state.captures.back.scanId:null,frontAnalysis:fa,backAnalysis:ba,finalGrade:cappedFinal,confidence:confidence,appliedCap:appliedCap,defects:defects});
  drawGradingOverlay(front.canvas,fa,$("#gradingOverlayFront"),"FRONT");
  if(state.captures.back&&ba)drawGradingOverlay(state.captures.back.canvas,ba,$("#gradingOverlayBack"),"BACK");else $("#gradingOverlayBack").hidden=true;
  $("#gradingOverlays").hidden=false;
  const frontCenter='FRONT L/R '+fa.centering.lr[0]+'/'+fa.centering.lr[1]+' • T/B '+fa.centering.tb[0]+'/'+fa.centering.tb[1];
  const backCenter=ba?'BACK L/R '+ba.centering.lr[0]+'/'+ba.centering.lr[1]+' • T/B '+ba.centering.tb[0]+'/'+ba.centering.tb[1]:"";
  const defectHtml=defects.length?'<div class="notice">'+defects.map(d=>d.message).join(" ")+'</div>':"";
  const capHtml=appliedCap!=null?'<div class="notice">Grade cap applicato: massimo '+appliedCap.toFixed(1)+' per un possibile difetto importante visibile nella fotografia.</div>':"";
  const valueHtml=await gradingValueHtml(state.recognized,cappedFinal);
  root.innerHTML='<div class="analysis-box"><h3>NOSTRO GRADING</h3><div class="metric"><span>Centering</span><b>'+center.toFixed(1)+'</b></div><div class="metric"><span>Corners</span><b>'+corners.toFixed(1)+'</b></div><div class="metric"><span>Edges</span><b>'+edges.toFixed(1)+'</b></div><div class="metric"><span>Surface</span><b>'+surface.toFixed(1)+'</b></div><div class="metric"><span>Final Grade</span><b>'+cappedFinal.toFixed(1)+'/10</b></div><p>'+frontCenter+(backCenter?'<br>'+backCenter:"")+'</p>'+defectHtml+capHtml+'<p class="confidence">Confidence: '+confidence+'%'+(ba?" • fronte + retro":" • solo fronte: confidence ridotta")+'</p><div class="notice">'+(interval?("Intervallo fotografico professionale indicativo: "+interval[0]+"–"+interval[1]+". "):"Confidence insufficiente per proporre un intervallo professionale. ")+GRADING_CONFIG.professionalDisclaimer+'</div><small>Risultato salvato • '+saved.gradingAlgorithmVersion+'</small></div>'+valueHtml+(state.recognized?'<button id="addGradedCard" class="primary">Aggiungi alla collezione</button>':"");
  const addGraded=$("#addGradedCard");
  if(addGraded)addGraded.onclick=async()=>{await addCopy(state.recognized,{condition:conditionFromGrade(cappedFinal),notes:"Aggiunta da grading "+saved.gradingAlgorithmVersion});addGraded.disabled=true;addGraded.textContent="✓ Aggiunta alla collezione"};
}
export function getScannerState(){return state}
export function setRecognizedCard(card){state.recognized=card;const root=document.querySelector("#recognitionResult");if(root&&card)root.innerHTML='<div class="analysis-box"><h3>Identificazione corretta manualmente</h3><b>'+card.name+'</b><div>'+(card.collectionNumber||"—")+' • '+(card.setName||card.setCode||"")+'</div><p class="confidence">Selezione manuale confermata.</p></div>'}

export function initScanner(options={}){
  state.onCardIdentified=options.onCardIdentified||null;
  $("#startCameraBtn").onclick=()=>startCamera().catch(()=>{});
  $("#stopCameraBtn").onclick=stopCamera;$("#captureBtn").onclick=()=>captureFromVideo(false);
  $("#photoFile").onchange=async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;const img=await imageFromBlob(f);openEditor(img,defaultCorners(img),f,false)};
  $("#editorZoom").oninput=e=>{state.zoom=Number(e.target.value);drawEditor()};
  $("#resetCornersBtn").onclick=()=>{state.corners=defaultCorners(state.original);state.zoom=1;state.panX=0;state.panY=0;$("#editorZoom").value="1";drawEditor()};
  $("#confirmCornersBtn").onclick=confirmCorners;$("#sideFrontBtn").onclick=()=>selectSide("front");$("#sideBackBtn").onclick=()=>selectSide("back");
  $("#ocrBtn").onclick=doRecognition;$("#gradeBtn").onclick=doGrading;
  const canvas=$("#editorCanvas");
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);const r=canvas.getBoundingClientRect(),p={x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height},screens=state.corners.map(toScreen);let best=-1,bd=1e9;screens.forEach((x,i)=>{const dd=dist(x,p);if(dd<bd){bd=dd;best=i}});state.drag=bd<55?{type:"corner",index:best}:{type:"pan",x:p.x,y:p.y,px:state.panX,py:state.panY}};
  canvas.onpointermove=e=>{if(!state.drag)return;const r=canvas.getBoundingClientRect(),p={x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};if(state.drag.type==="corner")state.corners[state.drag.index]=toImage(p);else{state.panX=state.drag.px+(p.x-state.drag.x);state.panY=state.drag.py+(p.y-state.drag.y)}drawEditor()};
  canvas.onpointerup=canvas.onpointercancel=()=>state.drag=null;
  updateCaptureStatus();
}
