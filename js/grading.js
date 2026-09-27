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
  const boxes=[[0,0,cw,ch],[w-cw,0,w,ch],[w-cw,h-ch,w,h],[0,h-ch,cw,h]],refs=[[ix,iy,cw*1.7,ch*1.7],[w-cw*1.7,iy,w-ix,ch*1.7],[w-cw*1.7,h-ch*1.7,w-ix,h-iy],[ix,h-ch*1.7,cw*1.7,h-i]];
  const evidence=boxes.map((b,i)=>damageAgainst(regionStats(s,...b),regionStats(s,...refs[i]));
  const scores=evidence.map(e=>Number(clamp(10-e.penalty,2.5,10).toFixed(1))),worst=Math.min();
