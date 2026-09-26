import{searchCards}from"./catalog.js";
import{setting}from"./db.js";
import{normalizeCollectionNumber,normalizeName,normalizeSetCode}from"./normalize.js";

function cleanNumberToken(token){
  let s=String(token||"").toUpperCase().replace(/\s+/g,"").replace(/[|\\]/g,"/");
  if(/[0-9]/.test(s))s=s.replace(/O/g,"0");
  return s;
}
function unique(values){return[...new Set(values.filter(Boolean))]}
function extractSignals(text){
  const raw=String(text||""),upper=raw.toUpperCase().replace(/[|\\]/g,"/");
  const slashPokemon=[...upper.matchAll(/\b((?:TG|GG|SV|SWSH|SM|XY|BW|PROMO)?\s*[0-9O]{1,4}[A-Z]?\s*\/\s*(?:(?:TG|GG|SV)\s*)?[0-9O]{1,4})\b/g)].map(m=>cleanNumberToken(m[1]));
  const promoPokemon=[...upper.matchAll(/\b((?:SWSH|SVP|SMP|SM|XYP|XY|BWP|BW|PROMO)\s*-?\s*[0-9O]{1,4}[A-Z]?)\b/g)].map(m=>cleanNumberToken(m[1]));
  const standalone=[...upper.matchAll(/(?:^|\s)([0-9O]{1,4})\s*\/\s*([0-9O]{1,4})(?:\s|$)/g)].map(m=>cleanNumberToken(m[1]+"/"+m[2]));
  const ygo=[...upper.matchAll(/\b([A-Z]{2,10}[-\s]?(?:(?:EN|E|IT|FR|DE|PT|JP|JPS|SC|TC)[-\s]?)?[0-9O]{3,5})\b/g)].map(m=>cleanNumberToken(m[1]));
  const lines=raw.split(/\n+/).map(x=>x.replace(/[^\p{L}\p{M}\p{N}'’&:+.\-\/ ]/gu," ").replace(/\s+/g," ").trim()).filter(x=>{
    if(x.length<2||x.length>50)return false;const letters=(x.match(/[\p{L}\p{M}]/gu)||[]).length;return letters>=1&&letters/Math.max(1,x.length)>.18;
  });
  return{pokemon:unique([...slashPokemon,...standalone,...promoPokemon]),yugioh:unique(ygo),lines:unique(lines).slice(0,18)};
}
function drawRegion(ctx,canvas,sx,sy,sw,sh,dx,dy,dw,dh,threshold=false){
  if(!threshold){ctx.save();ctx.filter="grayscale(1) contrast(1.6)";ctx.drawImage(canvas,sx,sy,sw,sh,dx,dy,dw,dh);ctx.restore();return}
  const tmp=document.createElement("canvas");tmp.width=Math.max(1,Math.round(dw));tmp.height=Math.max(1,Math.round(dh));const tx=tmp.getContext("2d",{willReadFrequently:true});tx.drawImage(canvas,sx,sy,sw,sh,0,0,tmp.width,tmp.height);
  const im=tx.getImageData(0,0,tmp.width,tmp.height),d=im.data;let mean=0,n=0;
  for(let i=0;i<d.length;i+=4){mean+=.299*d[i]+.587*d[i+1]+.114*d[i+2];n++}mean/=Math.max(1,n);
  const cut=Math.max(80,Math.min(190,mean*.92));
  for(let i=0;i<d.length;i+=4){const g=.299*d[i]+.587*d[i+1]+.114*d[i+2],v=g<cut?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}
  tx.putImageData(im,0,0);ctx.drawImage(tmp,dx,dy,dw,dh);
}
function makeOcrComposite(canvas){
  const w=760,topSrcH=Math.max(1,Math.round(canvas.height*.34)),bottomY=Math.round(canvas.height*.60),bottomSrcH=Math.max(1,canvas.height-bottomY),topH=Math.round(w*topSrcH/canvas.width),bottomH=Math.round(w*bottomSrcH/canvas.width),fullH=Math.round(w*canvas.height/canvas.width),gap=20;
  const out=document.createElement("canvas");out.width=w;out.height=topH+bottomH*2+fullH+gap*5;const ctx=out.getContext("2d",{willReadFrequently:true});ctx.fillStyle="white";ctx.fillRect(0,0,out.width,out.height);
  let y=gap;drawRegion(ctx,canvas,0,0,canvas.width,topSrcH,0,y,w,topH,false);y+=topH+gap;drawRegion(ctx,canvas,0,bottomY,canvas.width,bottomSrcH,0,y,w,bottomH,false);y+=bottomH+gap;drawRegion(ctx,canvas,0,bottomY,canvas.width,bottomSrcH,0,y,w,bottomH,true);y+=bottomH+gap;drawRegion(ctx,canvas,0,0,canvas.width,canvas.height,0,y,w,fullH,false);
  return out;
}
function signatureFromCanvas(canvas){
  const w=24,h=34,c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);const d=ctx.getImageData(0,0,w,h).data,gray=[],rgb=[],mean=[0,0,0];
  for(let i=0;i<d.length;i+=4){const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];gray.push(g);mean[0]+=d[i];mean[1]+=d[i+1];mean[2]+=d[i+2]}
  mean[0]/=gray.length;mean[1]/=gray.length;mean[2]/=gray.length;const gMean=gray.reduce((a,b)=>a+b,0)/gray.length,ahash=gray.map(v=>v>gMean?1:0),dhash=[];
  for(let y=0;y<h;y++)for(let x=0;x<w-1;x++)dhash.push(gray[y*w+x]<gray[y*w+x+1]?1:0);
  const gx=6,gy=8,bw=w/gx,bh=h/gy;for(let by=0;by<gy;by++)for(let bx=0;bx<gx;bx++){let r=0,g=0,b=0,n=0;for(let y=Math.floor(by*bh);y<Math.floor((by+1)*bh);y++)for(let x=Math.floor(bx*bw);x<Math.floor((bx+1)*bw);x++){const i=(y*w+x)*4;r+=d[i];g+=d[i+1];b+=d[i+2];n++}rgb.push([r/n,g/n,b/n])}
  return{ahash,dhash,rgb,mean};
}
function bitSimilarity(a,b){if(!a||!b||a.length!==b.length)return 0;let same=0;for(let i=0;i<a.length;i++)if(a[i]===b[i])same++;return same/a.length}
function colorSimilarity(a,b){
  if(!a||!b||a.length!==b.length)return 0;let dist=0,n=0;for(let i=0;i<a.length;i++){const dr=a[i][0]-b[i][0],dg=a[i][1]-b[i][1],db=a[i][2]-b[i][2];dist+=Math.sqrt(dr*dr+dg*dg+db*db);n++}return Math.max(0,1-(dist/Math.max(1,n))/220);
}
function visualSimilarity(a,b){if(!a||!b)return null;return bitSimilarity(a.ahash,b.ahash)*.38+bitSimilarity(a.dhash,b.dhash)*.37+colorSimilarity(a.rgb,b.rgb)*.25}
function imageUrls(card){
  const out=[];if(card.imageHigh)out.push(card.imageHigh);if(card.image)out.push(card.image);
  for(const x of Array.isArray(card.imageCandidates)?card.imageCandidates:[]){if(x.high)out.push(x.high);if(x.low)out.push(x.low)}
  return unique(out);
}
async function signatureUrl(url){
  if(!url)return null;const r=await fetch(url,{mode:"cors",cache:"force-cache"});if(!r.ok)return null;const bmp=await createImageBitmap(await r.blob()),c=document.createElement("canvas");c.width=Math.max(16,bmp.width);c.height=Math.max(24,bmp.height);c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);if(bmp.close)bmp.close();return signatureFromCanvas(c);
}
async function bestVisualForCard(card,source){
  let best=null;for(const url of imageUrls(card).slice(0,4)){try{const ref=await signatureUrl(url),sim=visualSimilarity(source,ref);if(sim!=null&&(best==null||sim>best))best=sim}catch{}if(best!=null&&best>.88)break}return best;
}
function cardNumberKey(card){const n=String(card.collectionNumber||"");if(!n)return"";if(n.includes("/")||!card.printedTotal)return normalizeCollectionNumber(n);return normalizeCollectionNumber(n+"/"+card.printedTotal)}
function lineMatchesName(line,name){
  const l=normalizeName(line),n=normalizeName(name);if(!l||!n)return 0;if(l===n)return 1;if(l.length>=3&&(l.includes(n)||n.includes(l)))return .75;
  const lw=new Set(l.split(" ").filter(x=>x.length>1)),nw=n.split(" ").filter(x=>x.length>1);if(!nw.length)return 0;let hit=0;for(const w of nw)if(lw.has(w))hit++;return hit/nw.length>=.67?.54:0;
}
async function ocrLanguage(){
  const lang=await setting("pokemonLanguage","it");if(lang==="ja")return"jpn+eng";if(lang==="zh-cn")return"chi_sim+eng";if(lang==="zh-tw")return"chi_tra+eng";return"eng";
}
export async function recognizeCard(canvas,preferredGame="all"){
  if(!window.Tesseract)throw new Error("Motore OCR non ancora disponibile. Riprova tra pochi secondi oppure usa la ricerca manuale.");
  const prepared=makeOcrComposite(canvas),ocrLang=await ocrLanguage(),result=await window.Tesseract.recognize(prepared,ocrLang,{logger:()=>{}}),text=result.data&&result.data.text?result.data.text:"",ocrConfidence=Math.max(0,Math.min(1,((result.data&&result.data.confidence)||0)/100)),signals=extractSignals(text),queries=[];
  if(preferredGame!=="yugioh")queries.push(...signals.pokemon);if(preferredGame!=="pokemon")queries.push(...signals.yugioh);queries.push(...signals.lines.slice(0,10));
  const pool=new Map();
  for(const q of unique(queries).slice(0,16)){
    const numeric=/\d/.test(q),rows=await searchCards(q,{game:preferredGame,limit:numeric?90:35,language:"all"});
    for(const row of rows){
      const old=pool.get(row.printingId),rowNum=cardNumberKey(row),rowSet=normalizeSetCode(row.setCode||row.collectionNumber||""),exactNumber=signals.pokemon.some(x=>{const nx=normalizeCollectionNumber(x);return nx&&rowNum&&(nx===rowNum||(!x.includes("/")&&nx===normalizeCollectionNumber(row.collectionNumber)))}),exactSetCode=signals.yugioh.some(x=>normalizeSetCode(x)===rowSet||normalizeSetCode(x)===normalizeSetCode(row.collectionNumber));
      let nameEvidence=0;for(const line of signals.lines)nameEvidence=Math.max(nameEvidence,lineMatchesName(line,row.name));
      let score=(row._score||0)+(exactNumber?165:0)+(exactSetCode?185:0)+Math.round(nameEvidence*110);const candidate={card:row,score,exactNumber,exactSetCode,nameEvidence,imageSimilarity:null};
      if(!old||score>old.score)pool.set(row.printingId,candidate);
    }
  }
  let candidates=[...pool.values()].sort((a,b)=>b.score-a.score).slice(0,24),sourceSig=signatureFromCanvas(canvas);
  for(const item of candidates.slice(0,16)){const sim=await bestVisualForCard(item.card,sourceSig);item.imageSimilarity=sim;if(sim!=null)item.score+=Math.max(0,sim-.42)*220}
  candidates.sort((a,b)=>b.score-a.score);const best=candidates[0],second=candidates[1],margin=best&&second?Math.max(0,best.score-second.score):0;
  for(const item of candidates){
    let evidence=.05+ocrConfidence*.14;if(item.exactNumber)evidence+=.42;if(item.exactSetCode)evidence+=.48;evidence+=item.nameEvidence*.22;if(item.imageSimilarity!=null)evidence+=Math.max(0,item.imageSimilarity-.38)*.68;if(item===best)evidence+=Math.min(.12,margin/240);item.confidence=Math.round(100*Math.max(.04,Math.min(.99,evidence)));
  }
  return{text,ocrConfidence:Math.round(ocrConfidence*100),ocrLanguage:ocrLang,signals,candidates:candidates.slice(0,10)};
}
