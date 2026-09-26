import{searchCards}from"./catalog.js";
import{normalizeCollectionNumber,normalizeName,normalizeSetCode}from"./normalize.js";

function cleanNumberToken(token){
  let s=String(token||"").toUpperCase().replace(/\s+/g,"").replace(/[|\\]/g,"/");
  if(/[0-9]/.test(s))s=s.replace(/O/g,"0");
  return s;
}
function unique(values){return[...new Set(values.filter(Boolean))]}
function extractSignals(text){
  const raw=String(text||"");
  const upper=raw.toUpperCase().replace(/[|\\]/g,"/");
  const slashPokemon=[...upper.matchAll(/\b((?:TG|GG|SV|SWSH|SM|XY|BW)?\s*[0-9O]{1,4}\s*\/\s*(?:(?:TG|GG|SV)\s*)?[0-9O]{1,4})\b/g)].map(m=>cleanNumberToken(m[1]));
  const promoPokemon=[...upper.matchAll(/\b((?:SWSH|SVP|SMP|SM|XYP|XY|BWP|BW)\s*-?\s*[0-9O]{1,4})\b/g)].map(m=>cleanNumberToken(m[1]));
  const ygo=[...upper.matchAll(/\b([A-Z]{2,8}[-\s]?(?:(?:EN|E|IT|FR|DE|PT)[-\s]?)?[0-9O]{3,5})\b/g)].map(m=>cleanNumberToken(m[1]));
  const lines=raw.split(/\n+/).map(x=>x.replace(/[^\p{L}\p{N}'’&:+.\-\/ ]/gu," ").replace(/\s+/g," ").trim()).filter(x=>{
    if(x.length<3||x.length>44)return false;
    const letters=(x.match(/\p{L}/gu)||[]).length;
    return letters>=2&&letters/Math.max(1,x.length)>.28;
  });
  return{pokemon:unique([...slashPokemon,...promoPokemon]),yugioh:unique(ygo),lines:unique(lines).slice(0,14)};
}
function makeOcrComposite(canvas){
  const w=720,fullH=Math.round(w*canvas.height/canvas.width),topSrcH=Math.max(1,Math.round(canvas.height*.31)),bottomY=Math.round(canvas.height*.62),bottomSrcH=Math.max(1,canvas.height-bottomY);
  const topH=Math.round(w*topSrcH/canvas.width),bottomH=Math.round(w*bottomSrcH/canvas.width),gap=22;
  const out=document.createElement("canvas");out.width=w;out.height=topH+bottomH+fullH+gap*4;
  const ctx=out.getContext("2d",{willReadFrequently:true});ctx.fillStyle="white";ctx.fillRect(0,0,out.width,out.height);
  ctx.filter="grayscale(1) contrast(1.55)";
  let y=gap;
  ctx.drawImage(canvas,0,0,canvas.width,topSrcH,0,y,w,topH);y+=topH+gap;
  ctx.drawImage(canvas,0,bottomY,canvas.width,bottomSrcH,0,y,w,bottomH);y+=bottomH+gap;
  ctx.drawImage(canvas,0,0,canvas.width,canvas.height,0,y,w,fullH);
  ctx.filter="none";
  const im=ctx.getImageData(0,0,out.width,out.height),d=im.data;
  for(let i=0;i<d.length;i+=4){
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const v=Math.max(0,Math.min(255,(g-128)*1.18+128));
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(im,0,0);
  return out;
}
function fingerprintFromCanvas(canvas){
  const w=16,h=22,c=document.createElement("canvas");c.width=w;c.height=h;
  const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h).data,vals=[];let sum=0;
  for(let i=0;i<d.length;i+=4){const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];vals.push(g);sum+=g}
  const avg=sum/vals.length;return vals.map(v=>v>avg?1:0);
}
async function fingerprintUrl(url){
  if(!url)return null;
  const r=await fetch(url,{mode:"cors",cache:"force-cache"});if(!r.ok)return null;
  const bmp=await createImageBitmap(await r.blob()),c=document.createElement("canvas");c.width=16;c.height=22;
  c.getContext("2d").drawImage(bmp,0,0,16,22);if(bmp.close)bmp.close();
  return fingerprintFromCanvas(c);
}
function similarity(a,b){if(!a||!b||a.length!==b.length)return null;let same=0;for(let i=0;i<a.length;i++)if(a[i]===b[i])same++;return same/a.length}
function cardNumberKey(card){
  const n=String(card.collectionNumber||"");
  if(!n)return"";
  if(n.includes("/")||!card.printedTotal)return normalizeCollectionNumber(n);
  return normalizeCollectionNumber(n+"/"+card.printedTotal);
}
function lineMatchesName(line,name){
  const l=normalizeName(line),n=normalizeName(name);
  if(!l||!n)return 0;
  if(l===n)return 1;
  if(l.length>=4&&(l.includes(n)||n.includes(l)))return .72;
  const lw=new Set(l.split(" ").filter(x=>x.length>1)),nw=n.split(" ").filter(x=>x.length>1);
  if(!nw.length)return 0;let hit=0;for(const w of nw)if(lw.has(w))hit++;
  return hit/nw.length>=.67?.52:0;
}
export async function recognizeCard(canvas,preferredGame="all"){
  if(!window.Tesseract)throw new Error("Motore OCR non ancora disponibile. Riprova tra pochi secondi oppure usa la ricerca manuale.");
  const prepared=makeOcrComposite(canvas);
  const result=await window.Tesseract.recognize(prepared,"eng",{logger:()=>{}});
  const text=result.data&&result.data.text?result.data.text:"";
  const ocrConfidence=Math.max(0,Math.min(1,((result.data&&result.data.confidence)||0)/100));
  const signals=extractSignals(text);
  const queries=[];
  if(preferredGame!=="yugioh")queries.push(...signals.pokemon);
  if(preferredGame!=="pokemon")queries.push(...signals.yugioh);
  queries.push(...signals.lines.slice(0,8));
  const pool=new Map();
  for(const q of unique(queries).slice(0,12)){
    const rows=await searchCards(q,{game:preferredGame,limit:18});
    for(const row of rows){
      const old=pool.get(row.printingId),rowNum=cardNumberKey(row),rowSet=normalizeSetCode(row.setCode||row.collectionNumber||"");
      const exactNumber=signals.pokemon.some(x=>{
        const nx=normalizeCollectionNumber(x);return nx&&rowNum&&(nx===rowNum||(!x.includes("/")&&nx===normalizeCollectionNumber(row.collectionNumber)));
      });
      const exactSetCode=signals.yugioh.some(x=>normalizeSetCode(x)===rowSet||normalizeSetCode(x)===normalizeSetCode(row.collectionNumber));
      let nameEvidence=0;for(const line of signals.lines)nameEvidence=Math.max(nameEvidence,lineMatchesName(line,row.name));
      let score=(row._score||0)+(exactNumber?150:0)+(exactSetCode?175:0)+Math.round(nameEvidence*105);
      const candidate={card:row,score,exactNumber,exactSetCode,nameEvidence,imageSimilarity:null};
      if(!old||score>old.score)pool.set(row.printingId,candidate);
    }
  }
  let candidates=[...pool.values()].sort((a,b)=>b.score-a.score).slice(0,8);
  const sourceFp=fingerprintFromCanvas(canvas);
  for(const item of candidates){
    try{
      const fp=await fingerprintUrl(item.card.imageHigh||item.card.image),sim=similarity(sourceFp,fp);item.imageSimilarity=sim;
      if(sim!=null)item.score+=Math.max(0,sim-.46)*150;
    }catch(e){item.imageSimilarity=null}
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0],second=candidates[1],margin=best&&second?Math.max(0,best.score-second.score):0;
  for(const item of candidates){
    let evidence=.08+ocrConfidence*.16;
    if(item.exactNumber)evidence+=.42;
    if(item.exactSetCode)evidence+=.48;
    evidence+=item.nameEvidence*.24;
    if(item.imageSimilarity!=null)evidence+=Math.max(0,item.imageSimilarity-.45)*.55;
    if(item===best)evidence+=Math.min(.10,margin/260);
    item.confidence=Math.round(100*Math.max(.05,Math.min(.99,evidence)));
  }
  return{text,ocrConfidence:Math.round(ocrConfidence*100),signals,candidates};
}
