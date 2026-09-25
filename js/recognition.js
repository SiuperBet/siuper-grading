import{searchCards}from"./catalog.js";
import{normalizeCollectionNumber,normalizeName,normalizeSetCode}from"./normalize.js";

function extractSignals(text){
  const upper=String(text||"").toUpperCase();
  const pokemon=[...upper.matchAll(/\b(?:TG|GG|SV|SWSH|SM)?\d{1,4}(?:\/(?:TG|GG|SV)?\d{1,4})?\b/g)].map(m=>m[0]);
  const ygo=[...upper.matchAll(/\b[A-Z]{2,8}[-\s]?(?:(?:EN|E|IT|FR|DE|PT)[-\s]?)?\d{3,5}\b/g)].map(m=>m[0]);
  const lines=String(text||"").split(/\n+/).map(x=>x.trim()).filter(x=>x.length>=3&&x.length<=48);
  return {pokemon:[...new Set(pokemon)],yugioh:[...new Set(ygo)],lines:lines.slice(0,10)};
}
function grayHash(data,w,h){
  const out=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const a=(y*w+x)*4,b=(y*w+x+1)*4;
    const ga=.299*data[a]+.587*data[a+1]+.114*data[a+2];
    const gb=.299*data[b]+.587*data[b+1]+.114*data[b+2];
    out.push(ga>gb?1:0);
  }
  return out;
}
function hashCanvas(canvas){
  const c=document.createElement("canvas");c.width=9;c.height=8;
  const ctx=c.getContext("2d",{willReadFrequently:true});
  const sx=Math.round(canvas.width*.08),sy=Math.round(canvas.height*.12),sw=Math.round(canvas.width*.84),sh=Math.round(canvas.height*.72);
  ctx.drawImage(canvas,sx,sy,sw,sh,0,0,9,8);
  return grayHash(ctx.getImageData(0,0,9,8).data,9,8);
}
async function hashUrl(url){
  if(!url)return null;
  const r=await fetch(url,{mode:"cors"});if(!r.ok)return null;
  const bmp=await createImageBitmap(await r.blob());
  const c=document.createElement("canvas");c.width=9;c.height=8;
  const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,9,8);
  if(bmp.close)bmp.close();
  return grayHash(ctx.getImageData(0,0,9,8).data,9,8);
}
function similarity(a,b){if(!a||!b||a.length!==b.length)return null;let d=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])d++;return 1-d/a.length}

export async function recognizeCard(canvas,preferredGame="all"){
  if(!window.Tesseract)throw new Error("Motore OCR non ancora disponibile. Riprova tra pochi secondi oppure usa la ricerca manuale.");
  const result=await window.Tesseract.recognize(canvas,"eng",{logger:()=>{}});
  const text=result.data&&result.data.text?result.data.text:"";
  const ocrConfidence=Math.max(0,Math.min(1,((result.data&&result.data.confidence)||0)/100));
  const signals=extractSignals(text);
  const queries=[];
  if(preferredGame!=="yugioh")queries.push(...signals.pokemon);
  if(preferredGame!=="pokemon")queries.push(...signals.yugioh);
  queries.push(...signals.lines.slice(0,5));
  const pool=new Map();
  for(const q of [...new Set(queries)].slice(0,8)){
    const rows=await searchCards(q,{game:preferredGame,limit:12});
    for(const row of rows){
      const old=pool.get(row.printingId);
      let bonus=0;
      if(signals.pokemon.some(x=>normalizeCollectionNumber(x)===normalizeCollectionNumber(row.collectionNumber)))bonus+=90;
      if(signals.yugioh.some(x=>normalizeSetCode(x)===normalizeSetCode(row.setCode)))bonus+=100;
      if(signals.lines.some(x=>normalizeName(x)===normalizeName(row.name)))bonus+=65;
      const score=(row._score||0)+bonus;
      if(!old||score>old.score)pool.set(row.printingId,{card:row,score:score});
    }
  }
  let candidates=[...pool.values()].sort((a,b)=>b.score-a.score).slice(0,5);
  const sourceHash=hashCanvas(canvas);
  for(const item of candidates){
    try{const h=await hashUrl(item.card.image);const sim=similarity(sourceHash,h);item.imageSimilarity=sim;if(sim!=null)item.score+=Math.max(0,(sim-.35))*55}catch(e){item.imageSimilarity=null}
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  const second=candidates[1];
  for(const item of candidates){
    const margin=best&&second&&item===best?Math.max(0,best.score-second.score):0;
    const evidence=Math.min(1,item.score/210);
    item.confidence=Math.round(100*Math.min(.99,(evidence*.72+ocrConfidence*.18+Math.min(.1,margin/300))));
  }
  return {text:text,ocrConfidence:Math.round(ocrConfidence*100),signals:signals,candidates:candidates};
}
