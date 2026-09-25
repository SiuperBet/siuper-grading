import{mkdir,readFile,writeFile,rename}from"node:fs/promises";
import{existsSync}from"node:fs";
import path from"node:path";

const API="https://api.tcgdex.net/v2/it";
const OUT="data/pokemon";
const now=new Date().toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchJson(url,tries=3){
  let last;
  for(let i=0;i<tries;i++){
    try{const r=await fetch(url,{headers:{accept:"application/json","user-agent":"siuper-grading-data-sync"}});if(!r.ok)throw new Error(String(r.status)+" "+r.statusText);return await r.json()}
    catch(e){last=e;if(i<tries-1)await sleep(700*(i+1))}
  }
  throw last;
}
async function atomicJson(file,data){
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=file+".tmp";
  await writeFile(tmp,JSON.stringify(data,null,2)+"\n");
  await rename(tmp,file);
}
async function readJson(file,fallback){
  try{return JSON.parse(await readFile(file,"utf8"))}catch{return fallback}
}
function cardBrief(c,set){
  return{
    id:"pokemon:"+c.id,
    cardId:c.id,
    printingId:"pokemon:"+c.id,
    game:"pokemon",
    name:c.name||"Senza nome",
    number:c.localId||"",
    collectionNumber:c.localId||"",
    setId:set.id,
    setCode:set.id,
    setName:set.name,
    series:set.serie&&set.serie.name||"",
    rarity:"",
    printedTotal:set.cardCount&&set.cardCount.official||null,
    releaseDate:set.releaseDate||"",
    image:c.image?c.image+"/low.webp":"",
    imageHigh:c.image?c.image+"/high.webp":"",
    source:"TCGdex",
    updatedAt:now
  };
}
const previousPokemon=await readJson("data/pokemon/search-index.json",[]);
const previousBySet=new Map();
for(const c of previousPokemon){if(!previousBySet.has(c.setId))previousBySet.set(c.setId,[]);previousBySet.get(c.setId).push(c)}

const setBriefs=await fetchJson(API+"/sets");
const series=await fetchJson(API+"/series").catch(()=>[]);
const setsOut=[],indexOut=[];
let failed=0,updated=0;

for(let i=0;i<setBriefs.length;i++){
  const s=setBriefs[i];
  try{
    const detail=await fetchJson(API+"/sets/"+encodeURIComponent(s.id));
    const setRow={
      game:"pokemon",
      id:detail.id,
      name:detail.name,
      cardCount:detail.cardCount&&detail.cardCount.total||0,
      printedTotal:detail.cardCount&&detail.cardCount.official||0,
      logo:detail.logo?detail.logo+".webp":"",
      symbol:detail.symbol?detail.symbol+".webp":"",
      releaseDate:detail.releaseDate||"",
      series:detail.serie&&detail.serie.name||"",
      seriesId:detail.serie&&detail.serie.id||"",
      updatedAt:now
    };
    const cards=(detail.cards||[]).map(c=>cardBrief(c,detail));
    setsOut.push(setRow);indexOut.push(...cards);
    await atomicJson(OUT+"/cards/"+encodeURIComponent(detail.id)+".json",cards);
    updated++;
  }catch(e){
    failed++;console.error("Set fallito",s.id,e.message);
    const old=previousBySet.get(s.id)||[];
    indexOut.push(...old);
    setsOut.push({
      game:"pokemon",id:s.id,name:s.name,cardCount:s.cardCount&&s.cardCount.total||0,
      printedTotal:s.cardCount&&s.cardCount.official||0,logo:s.logo?s.logo+".webp":"",
      symbol:s.symbol?s.symbol+".webp":"",releaseDate:"",series:"",seriesId:"",updatedAt:null,stale:true
    });
  }
  await sleep(90);
}
await atomicJson(OUT+"/sets.json",setsOut.sort((a,b)=>String(b.releaseDate).localeCompare(String(a.releaseDate))||a.name.localeCompare(b.name,"it")));
await atomicJson(OUT+"/series.json",series);
await atomicJson("data/pokemon/search-index.json",indexOut);

const meta=await readJson("data/meta.json",{});
meta.databaseVersion=1;meta.pokemon={source:"TCGdex",updatedAt:now,sets:setsOut.length,cards:indexOut.length,failedSets:failed};
await atomicJson("data/meta.json",meta);
console.log(JSON.stringify({source:"TCGdex",sets:setsOut.length,cards:indexOut.length,updatedSets:updated,failedSets:failed},null,2));
if(!indexOut.length)process.exitCode=1;
