import{setting,put}from"./db.js";
import{recognizeCard}from"./recognition.js";
import{analyzeCanvas,combineAnalyses,saveGrade,professionalInterval,drawGradingOverlay}from"./grading.js";
import{GRADING_CONFIG}from"./grading-config.js";
import{CONDITION_ESTIMATES}from"./config.js";
import{getPricesForCard,reliability}from"./prices.js";
import{addCopy}from"./collection.js";

const state={stream:null,timer:null,busy:false,currentSide:"front",original:null,corners:null,detectedCorners:null,zoom:1,panX:0,panY:0,drag:null,prevThumb:null,prevQuadNorm:null,stableFrames:0,lastQuality:null,borderConfidence:0,detectedValid:false,captureBorderConfidence:0,manualCorners:false,captures:{front:null,back:null},recognized:null,onCardIdentified:null};
const $=s=>document.querySelector(s);
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function avgQuadMovement(a,b){if(!a||!b||a.length!==4||b.length!==4)return 1;return a.reduce((sum,p,i)=>sum+dist(p,b[i]),0)/4}
function cloneCanvas(source){const c=document.createElement("canvas");c.width=source.width;c.height=source.height;c.getContext("2d").drawImage(source,0,0);return c}
function canvasBlob(canvas,type="image/jpeg",quality=.91){return new Promise(resolve=>canvas.toBlob(resolve,type,quality))}
function imageFromBlob(blob){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{URL.revokeObjectURL(img.src);resolve(img)};img.onerror=reject;img.src=URL.createObjectURL(blob)})}
function defaultCorners(img){let w=img.width*.68,h=w*1.4;if(h>img.height*.74){h=img.height*.74;w=h/1.4}const x=(img.width-w)/2,y=(img.height-h)/2;return[{x:x,y:y},{x:x+w,y:y},{x:x+w,y:y+h},{x:x,y:y+h}]}

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
function quadAngleScore(pts){
  let total=0;
  for(let i=0;i<4;i++){const p=pts[i],a=pts[(i+3)%4],b=pts[(i+1)%4],ax=a.x-p.x,ay=a.y-p.y,bx=b.x-p.x,by=b.y-p.y,den=Math.hypot(ax,ay)*Math.hypot(bx,by)||1,cos=Math.abs((ax*bx+ay*by)/den);total+=1-clamp(cos/.38,0,1)}
  return total/4;
}
function quadEdgeScore(edges,pts){
  let total=0,n=0;
  for(let e=0;e<4;e++){const a=pts[e],b=pts[(e+1)%4];for(let i=1;i<20;i++){const t=i/20,x=Math.round(a.x+(b.x-a.x)*t),y=Math.round(a.y+(b.y-a.y)*t);let best=0;for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){const xx=x+ox,yy=y+oy;if(xx>=0&&yy>=0&&xx<edges.cols&&yy<edges.rows)best=Math.max(best,edges.ucharPtr(yy,xx)[0])}total+=best/255;n++}}
  return n?total/n:0;
}
function isUsableQuad(q,minConfidence=62){return!!(q&&q.aspect>.56&&q.aspect<.82&&q.areaRatio>.11&&q.areaRatio<.91&&!q.clipped&&q.confidence>=minConfidence)}
function quadCandidateScore(q,area,total,canvas,edgeScore){
  const top=dist(q[0],q[1]),bottom=dist(q[3],q[2]),left=dist(q[0],q[3]),right=dist(q[1],q[2]),ww=(top+bottom)/2,hh=(left+right)/2,aspect=Math.min(ww,hh)/Math.max(ww,hh),areaRatio=area/total;
  if(aspect<.50||aspect>.88||areaRatio<.10||areaRatio>.94)return null;
  const clipped=q.some(p=>p.x<canvas.width*.012||p.x>canvas.width*.988||p.y<canvas.height*.012||p.y>canvas.height*.988),cx=q.reduce((a,p)=>a+p.x,0)/4,cy=q.reduce((a,p)=>a+p.y,0)/4,centerDist=Math.hypot((cx-canvas.width/2)/(canvas.width/2),(cy-canvas.height/2)/(canvas.height/2));
  const aspectScore=clamp(1-Math.abs(aspect-(2.5/3.5))/.18,0,1),angleScore=quadAngleScore(q),oppositeScore=(clamp(Math.min(top,bottom)/Math.max(top,bottom),0,1)+clamp(Math.min(left,right)/Math.max(left,right),0,1))/2,centerScore=clamp(1-centerDist/.95,0,1),sizeScore=clamp(1-Math.abs(areaRatio-.50)/.50,0,1);
  let score=aspectScore*.25+angleScore*.18+oppositeScore*.12+centerScore*.10+sizeScore*.14+edgeScore*.21;
  if(areaRatio<.18)score*=.78;if(clipped)score*=.50;
  return{points:q,aspect,areaRatio,clipped,confidence:Math.round(score*100),edgeScore:Math.round(edgeScore*100),score};
}
function scanContours(binary,canvas,best){
  const contours=new cv.MatVector(),hierarchy=new cv.Mat(),total=canvas.width*canvas.height;
  try{
    cv.findContours(binary,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i),area0=Math.abs(cv.contourArea(cnt));if(area0<total*.095||area0>total*.95){cnt.delete();continue}
      const peri=cv.arcLength(cnt,true);let chosen=null;
      for(const eps of[.010,.014,.019,.026,.036]){const approx=new cv.Mat();cv.approxPolyDP(cnt,approx,eps*peri,true);if(approx.rows===4&&cv.isContourConvex(approx)){chosen=approx;break}approx.delete()}
      if(!chosen){cnt.delete();continue}
      const pts=[];for(let j=0;j<4;j++)pts.push({x:chosen.intPtr(j,0)[0],y:chosen.intPtr(j,0)[1]});
      const q=orderQuad(pts),area=Math.abs(cv.contourArea(chosen));chosen.delete();cnt.delete();if(!q)continue;
      const candidate=quadCandidateScore(q,area,total,canvas,quadEdgeScore(binary,q));if(candidate&&(!best||candidate.score>best.score))best=candidate;
    }
  }finally{contours.delete();hierarchy.delete()}
  return best;
}
function detectQuadCV(canvas){
  if(!window.cv||!window.cv.imread)return null;
  let src,gray,blur,e1,e2,adaptive,kernel;
  try{
    src=cv.imread(canvas);gray=new cv.Mat();blur=new cv.Mat();e1=new cv.Mat();e2=new cv.Mat();adaptive=new cv.Mat();kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(3,3));
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
    cv.Canny(blur,e1,38,125);cv.morphologyEx(e1,e1,cv.MORPH_CLOSE,kernel);
    cv.Canny(blur,e2,70,190);cv.morphologyEx(e2,e2,cv.MORPH_CLOSE,kernel);
    cv.adaptiveThreshold(blur,adaptive,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,7);cv.bitwise_not(adaptive,adaptive);cv.morphologyEx(adaptive,adaptive,cv.MORPH_CLOSE,kernel);
    let best=null;best=scanContours(e1,canvas,best);best=scanContours(e2,canvas,best);best=scanContours(adaptive,canvas,best);
    if(best)delete best.score;return best;
  }catch(e){return null}finally{for(const m of[src,gray,blur,e1,e2,adaptive,kernel])if(m&&m.delete)try{m.delete()}catch(e){}}
}
function detectImageQuad(img,minConfidence=64){
  const maxSide=1200,scale=Math.min(1,maxSide/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext("2d").drawImage(img,0,0,c.width,c.height);
  const q=detectQuadCV(c);if(!isUsableQuad(q,minConfidence))return null;
  return{points:q.points.map(p=>({x:p.x/scale,y:p.y/scale})),confidence:q.confidence,aspect:q.aspect,areaRatio:q.areaRatio};
}
function orderQuad(pts){
  if(!pts||pts.length!==4)return null;
  const sum=p=>p.x+p.y,dif=p=>p.x-p.y;
  const tl=pts.reduce((a,b)=>sum(a)<sum(b)?a:b),br=pts.reduce((a,b)=>sum(a)>sum(b)?a:b),tr=pts.reduce((a,b)=>dif(a)>dif(b)?a:b),bl=pts.reduce((a,b)=>dif(a)<dif(b)?a:b);
  return [tl,tr,br,bl];
}
function polygonArea(pts){let a=0;for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p.x*q.y-q.x*p.y}return Math.abs(a)/2}
function validateCorners(img,pts){
  const q=orderQuad(pts);if(!q)return{ok:false,message:"I 4 punti non sono validi."};
  const area=polygonArea(q),ratio=area/Math.max(1,img.width*img.height),top=dist(q[0],q[1]),bottom=dist(q[3],q[2]),left=dist(q[0],q[3]),right=dist(q[1],q[2]),w=(top+bottom)/2,h=(left+right)/2,aspect=Math.min(w,h)/Math.max(w,h),minSide=Math.min(top,bottom,left,right);
  if(ratio<.08)return{ok:false,message:"Il riquadro è troppo piccolo: posiziona i 4 punti sugli angoli reali della carta."};
  if(ratio>.96)return{ok:false,message:"Il riquadro occupa quasi tutta la foto: controlla gli angoli."};
  if(aspect<.48||aspect>.91)return{ok:false,message:"Le proporzioni dei 4 punti non sono compatibili con una carta. Ricontrolla gli angoli."};
  if(minSide<Math.min(img.width,img.height)*.18)return{ok:false,message:"Due angoli risultano troppo vicini. Ricontrolla i 4 punti."};
  if(q.some(p=>p.x<0||p.y<0||p.x>img.width||p.y>img.height))return{ok:false,message:"Un punto è fuori dall'immagine."};
  return{ok:true,points:q,aspect,areaRatio:ratio};
}
async function analysisTick(){
  if(!state.stream||state.busy)return;
  const video=$("#cameraVideo");if(video.readyState<2){state.timer=setTimeout(analysisTick,500);return}
  const c=$("#analysisCanvas"),w=260,h=Math.max(160,Math.round(w*video.videoHeight/video.videoWidth));c.width=w;c.height=h;c.getContext("2d").drawImage(video,0,0,w,h);
  const q=frameQuality(c);state.lastQuality=q;
  const quad=detectQuadCV(c),shapeOk=isUsableQuad(quad,62);
  state.borderConfidence=quad?quad.confidence:0;state.detectedValid=shapeOk;
  if(shapeOk)state.detectedCorners=quad.points.map(p=>({x:p.x/w,y:p.y/h}));else state.detectedCorners=null
  let quadStable=false;
  if(shapeOk){
    const norm=quad.points.map(p=>({x:p.x/w,y:p.y/h}));
    if(state.prevQuadNorm){const movement=avgQuadMovement(norm,state.prevQuadNorm);quadStable=movement<.032}
    state.prevQuadNorm=norm;
  }else state.prevQuadNorm=null;
  if(q.good&&shapeOk&&quadStable)state.stableFrames++;else state.stableFrames=0;
  const hints=[];
  if(!quad)hints.push("carta/bordi non rilevati");
  else{
    if(quad.confidence<62)hints.push("bordi incerti: correggi i 4 punti");
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
    const blob=await canvasBlob(c);const img=await imageFromBlob(blob),fullQuad=detectQuadCV(c);
    let corners,confidence=0;if(isUsableQuad(fullQuad,66)){corners=fullQuad.points;confidence=fullQuad.confidence}else if(state.detectedValid&&state.detectedCorners&&state.borderConfidence>=66){corners=state.detectedCorners.map(p=>({x:p.x*img.width,y:p.y*img.height}));confidence=state.borderConfidence}else corners=defaultCorners(img);
    openEditor(img,corners,blob,auto,confidence);
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
function openEditor(img,corners,blob,auto,borderConfidence=0){
  state.original=img;state.corners=orderQuad(corners)||defaultCorners(img);state.originalBlob=blob;state.captureBorderConfidence=borderConfidence;state.manualCorners=false;state.zoom=1;state.panX=0;state.panY=0;
  const c=$("#editorCanvas");c.width=800;c.height=900;$("#editorZoom").value="1";$("#borderEditor").hidden=false;$("#correctedPanel").hidden=true;drawEditor();
  $("#scanQuality").textContent=borderConfidence>=66?(auto?"Scatto automatico: bordi rilevati con confidenza "+borderConfidence+"%. Verifica i 4 punti.":"Bordi rilevati con confidenza "+borderConfidence+"%. Verifica i 4 punti."):"Bordi automatici non abbastanza sicuri: regola i 4 punti sulla carta.";
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
    const geometry=validateCorners(state.original,state.corners);
    if(!geometry.ok){$("#scanQuality").textContent=geometry.message;return}
    state.corners=geometry.points;
    const corrected=perspectiveWarp(state.original,state.corners),copy=cloneCanvas(corrected),correctedBlob=await canvasBlob(copy);
    const geometryConfidence=state.manualCorners?Math.max(60,Math.min(78,state.captureBorderConfidence||60)):(state.captureBorderConfidence||0);
    const scanId="scan:"+crypto.randomUUID(),row={id:scanId,side:state.currentSide,createdAt:new Date().toISOString(),originalBlob:state.originalBlob,correctedBlob:correctedBlob,corners:state.corners.map(p=>({x:Math.round(p.x),y:Math.round(p.y)})),borderDetectionConfidence:geometryConfidence,geometrySource:state.manualCorners?"manual-confirmed":"automatic",geometryAspect:Number(geometry.aspect.toFixed(4)),geometryAreaRatio:Number(geometry.areaRatio.toFixed(4))};
    await put("scans",row);state.captures[state.currentSide]={scanId:scanId,canvas:copy,corners:row.corners,quality:state.lastQuality,borderConfidence:row.borderDetectionConfidence};
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
  const root=$("#recognitionResult");root.innerHTML='<div class="notice">OCR multilingua e confronto visivo in corso…</div>';
  try{
    const preferred=document.querySelector(".game-btn.active")?.dataset.game||"all",r=await recognizeCard(cap.canvas,preferred),rows=r.candidates;
    if(!rows.length){state.recognized=null;root.innerHTML='<div class="notice">Riconoscimento non conclusivo. OCR: '+r.ocrConfidence+'%. Usa la ricerca manuale per selezionare la stampa esatta.</div>';return}
    const best=rows[0],strongEvidence=best.exactNumber||best.exactSetCode||Number(best.imageSimilarity||0)>=.68||best.nameEvidence>=.72,autoAccepted=best.confidence>=68&&strongEvidence;
    state.recognized=autoAccepted?best.card:null;
    const visual=best.imageSimilarity==null?"n/d":Math.round(best.imageSimilarity*100)+"%";
    root.innerHTML='<div class="analysis-box"><h3>'+(autoAccepted?'Carta identificata':'Candidato principale da confermare')+'</h3><b>'+best.card.name+'</b><div>'+(best.card.collectionNumber||"—")+' • '+(best.card.setName||best.card.setCode||"")+'</div><p class="confidence">Confidenza: '+best.confidence+'% • OCR '+r.ocrConfidence+'% • Visuale '+visual+'</p>'+(autoAccepted?'':'<button id="confirmBestCandidate" class="primary">Conferma questa carta</button>')+'<small>Alternative:</small>'+rows.slice(1).map((x,i)=>'<button class="candidate-btn" data-i="'+(i+1)+'">'+x.card.name+' • '+(x.card.collectionNumber||"—")+' ('+x.confidence+'%)</button>').join(" ")+'<p><button id="manualSearchBtn">Correggi con ricerca manuale</button></p></div>';
    const confirm=$("#confirmBestCandidate");if(confirm)confirm.onclick=()=>{state.recognized=best.card;confirm.disabled=true;confirm.textContent="✓ Confermata";root.querySelector("h3").textContent="Carta identificata e confermata"};
    root.querySelectorAll(".candidate-btn").forEach(b=>b.onclick=()=>{const x=rows[Number(b.dataset.i)];state.recognized=x.card;root.querySelector("b").textContent=x.card.name;root.querySelector(".confidence").textContent="Selezione manuale tra i candidati • "+x.confidence+"%";root.querySelector("h3").textContent="Carta identificata e confermata"});
    $("#manualSearchBtn").onclick=()=>document.querySelector('[data-view="search"]').click();
  }catch(e){state.recognized=null;root.innerHTML='<div class="notice">OCR non riuscito: '+e.message+' Puoi sempre usare la ricerca manuale.</div>'}
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
  const root=$("#gradingResult");root.innerHTML='<div class="notice">Analisi fotografica avanzata in corso…</div>';await new Promise(r=>setTimeout(r,30));
  const fa=analyzeCanvas(front.canvas,{side:"front",borderConfidence:front.borderConfidence||0});
  const frontUnusable=fa.quality.blurVariance<35||fa.quality.meanBrightness<30||fa.quality.meanBrightness>232||fa.quality.glareRatio>.12;
  if(frontUnusable){root.innerHTML='<div class="notice"><b>Foto non idonea al grading.</b><br>Il fronte è troppo sfocato, troppo scuro/chiaro o presenta troppi riflessi. Acquisisci nuovamente la carta: non salvo un voto poco affidabile.</div>';return}
  const back=state.captures.back;let ba=back?analyzeCanvas(back.canvas,{side:"back",borderConfidence:back.borderConfidence||0}):null;
  const backRejected=ba&&(ba.quality.blurVariance<35||ba.quality.meanBrightness<30||ba.quality.meanBrightness>232||ba.quality.glareRatio>.12);
  if(backRejected)ba=null;
  const combined=combineAnalyses(fa,ba);
  const center=combined.center,corners=combined.corners,edges=combined.edges,surface=combined.surface,cappedFinal=combined.finalGrade,confidence=combined.confidence,appliedCap=combined.appliedCap,defects=combined.defects,interval=professionalInterval(cappedFinal,confidence);
  const saved=await saveGrade({cardId:state.recognized?state.recognized.cardId:null,printingId:state.recognized?state.recognized.printingId:null,cardName:state.recognized?state.recognized.name:null,frontScanId:front.scanId,backScanId:back?back.scanId:null,frontAnalysis:fa,backAnalysis:ba,finalGrade:cappedFinal,confidence,appliedCap,defects});
  drawGradingOverlay(front.canvas,fa,$("#gradingOverlayFront"),"FRONT");if(back&&ba)drawGradingOverlay(back.canvas,ba,$("#gradingOverlayBack"),"BACK");else $("#gradingOverlayBack").hidden=true;$("#gradingOverlays").hidden=false;
  const frontCenter='FRONT L/R '+fa.centering.lr[0]+'/'+fa.centering.lr[1]+' • T/B '+fa.centering.tb[0]+'/'+fa.centering.tb[1],backCenter=ba?'BACK L/R '+ba.centering.lr[0]+'/'+ba.centering.lr[1]+' • T/B '+ba.centering.tb[0]+'/'+ba.centering.tb[1]:"";
  const rejectedBackHtml=backRejected?'<div class="notice">Il retro acquisito è stato escluso dal calcolo perché la foto non è sufficientemente affidabile. Il grading è quindi calcolato sul solo fronte.</div>':"";\n  const defectHtml=defects.length?'<div class="notice"><b>Possibili difetti rilevati</b><br>'+defects.map(d=>d.message).join("<br>")+'</div>':"",qualityWarnings=[...(fa.quality.warnings||[]),...(ba&&ba.quality.warnings||[])],qualityHtml=qualityWarnings.length?'<div class="notice">Qualità foto: '+[...new Set(qualityWarnings)].join(" • ")+'. Il risultato ha confidenza ridotta.</div>':"",capHtml=appliedCap!=null?'<div class="notice">Grade cap fotografico applicato: massimo '+appliedCap.toFixed(1)+'.</div>':"";
  const valueHtml=await gradingValueHtml(state.recognized,cappedFinal);
  root.innerHTML='<div class="analysis-box"><h3>NOSTRO GRADING</h3><div class="metric"><span>Centering</span><b>'+center.toFixed(1)+'</b></div><div class="metric"><span>Corners</span><b>'+corners.toFixed(1)+'</b></div><div class="metric"><span>Edges</span><b>'+edges.toFixed(1)+'</b></div><div class="metric"><span>Surface</span><b>'+surface.toFixed(1)+'</b></div><div class="metric"><span>Final Grade</span><b>'+cappedFinal.toFixed(1)+'/10</b></div><p>'+frontCenter+(backCenter?'<br>'+backCenter:"")+'</p>'+rejectedBackHtml+qualityHtml+defectHtml+capHtml+'<p class="confidence">Confidence: '+confidence+'%'+(ba?" • fronte + retro":" • solo fronte: confidence ridotta")+'</p><div class="notice">'+(interval?("Intervallo fotografico indicativo: "+interval[0]+"–"+interval[1]+". "):"Confidence insufficiente per proporre un intervallo. ")+GRADING_CONFIG.professionalDisclaimer+'</div><small>Risultato salvato • '+saved.gradingAlgorithmVersion+'</small></div>'+valueHtml+(state.recognized?'<button id="addGradedCard" class="primary">Aggiungi alla collezione</button>':"");
  const addGraded=$("#addGradedCard");if(addGraded)addGraded.onclick=async()=>{await addCopy(state.recognized,{condition:conditionFromGrade(cappedFinal),notes:"Aggiunta da grading "+saved.gradingAlgorithmVersion});addGraded.disabled=true;addGraded.textContent="✓ Aggiunta alla collezione"};
}
export function getScannerState(){return state}
export function setRecognizedCard(card){state.recognized=card;const root=document.querySelector("#recognitionResult");if(root&&card)root.innerHTML='<div class="analysis-box"><h3>Identificazione corretta manualmente</h3><b>'+card.name+'</b><div>'+(card.collectionNumber||"—")+' • '+(card.setName||card.setCode||"")+'</div><p class="confidence">Selezione manuale confermata.</p></div>'}

export function initScanner(options={}){
  state.onCardIdentified=options.onCardIdentified||null;
  $("#startCameraBtn").onclick=()=>startCamera().catch(()=>{});
  $("#stopCameraBtn").onclick=stopCamera;$("#captureBtn").onclick=()=>captureFromVideo(false);
  $("#photoFile").onchange=async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;const img=await imageFromBlob(f),q=detectImageQuad(img,64);openEditor(img,q?q.points:defaultCorners(img),f,false,q?q.confidence:0)};
  $("#editorZoom").oninput=e=>{state.zoom=Number(e.target.value);drawEditor()};
  $("#resetCornersBtn").onclick=()=>{const q=detectImageQuad(state.original,60);state.corners=q?q.points:defaultCorners(state.original);state.captureBorderConfidence=q?q.confidence:0;state.manualCorners=false;state.zoom=1;state.panX=0;state.panY=0;$("#editorZoom").value="1";drawEditor()};
  $("#confirmCornersBtn").onclick=confirmCorners;$("#sideFrontBtn").onclick=()=>selectSide("front");$("#sideBackBtn").onclick=()=>selectSide("back");
  $("#ocrBtn").onclick=doRecognition;$("#gradeBtn").onclick=doGrading;
  const canvas=$("#editorCanvas");
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);const r=canvas.getBoundingClientRect(),p={x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height},screens=state.corners.map(toScreen);let best=-1,bd=1e9;screens.forEach((x,i)=>{const dd=dist(x,p);if(dd<bd){bd=dd;best=i}});state.drag=bd<55?{type:"corner",index:best}:{type:"pan",x:p.x,y:p.y,px:state.panX,py:state.panY}};
  canvas.onpointermove=e=>{if(!state.drag)return;const r=canvas.getBoundingClientRect(),p={x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};if(state.drag.type==="corner"){state.corners[state.drag.index]=toImage(p);state.manualCorners=true}else{state.panX=state.drag.px+(p.x-state.drag.x);state.panY=state.drag.py+(p.y-state.drag.y)}drawEditor()};
  canvas.onpointerup=canvas.onpointercancel=()=>state.drag=null;
  updateCaptureStatus();
}
