import{mkdir,readFile,writeFile,rename}from"node:fs/promises";
import path from"node:path";

const BASE="https://api.tcgdex.net/v2";
const now=new Date().toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const catalogs=[
  {language:"it",out:"data/pokemon",fallback:"en"},
  {language:"en",out:"data/pokemon-en"},
  {language:"ja",out:"data/pokemon-ja"},
  {language:"zh-tw",out:"data/pokemon-zh-tw"},
  {language:"zh-cn",out:"data/pokemon-zh-cn"}
];

async function fetchJson(url,tries=3){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{headers:{accept:"application/json","user-agent":"siuper-grading-data-sync"}});
      if(!r.ok)throw new Error(String(r.status)+" "+r.statusText);
      return await r.json();
    }catch(e){last=e;if(i<tries-1)await sleep(650*(i+1))}
  }
  throw last;
}
async function atomicJson(file,data){
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=file+".tmp";await writeFile(tmp,JSON.stringify(data,null,2)+"\n");await rename(tmp,file);
}
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,"utf8"))}catch{return fallback}}
function printingId(cardId,language){return language==="it"?"pokemon:"+cardId:"pokemon:"+language+":"+cardId}
function cardBrief(c,set,language){
  const id=printingId(c.id,language);
  return{
    id,cardId:c.id,printingId:id,game:"pokemon",
    name:c.name||"Senza nome",number:c.localId||"",collectionNumber:c.localId||"",
    setId:set.id,setCode:set.id,setName:set.name,
    series:set.serie&&set.serie.name||"",seriesId:set.serie&&set.serie.id||"",rarity:c.rarity||"",
    printedTotal:set.cardCount&&set.cardCount.official||null,
    releaseDate:set.releaseDate||"",
    image:c.image?c.image+"/low.webp":"",imageHigh:c.image?c.image+"/high.webp":"",
    variants:c.variants&&typeof c.variants==="object"?c.variants:{},
    variantsDetailed:c.variants_detailed&&typeof c.variants_detailed==="object"?c.variants_detailed:null,
    category:c.category||"",artist:c.illustrator||c.artist||"",types:Array.isArray(c.types)?c.types:[],
    hp:c.hp??null,stage:c.stage||"",dexId:Array.isArray(c.dexId)?c.dexId:[],regulationMark:c.regulationMark||"",
    language,catalogLanguage:language,source:"TCGdex",updatedAt:now
  };
}
async function syncCatalog(cfg){
  const api=BASE+"/"+cfg.language;
  const previous=await readJson(cfg.out+"/search-index.json",[]);
  const previousBySet=new Map();
  for(const c of previous){if(!previousBySet.has(c.setId))previousBySet.set(c.setId,[]);previousBySet.get(c.setId).push(c)}
  const setBriefsRaw=await fetchJson(api+"/sets");
  const setBriefs=[...new Map(setBriefsRaw.map(x=>[String(x.id),x])).values()];
  const series=await fetchJson(api+"/series").catch(()=>[]);
  const setsOut=[],indexOut=[];let failed=0,updated=0,fallbackSets=0,emptySets=0;

  for(let i=0;i<setBriefs.length;i++){
    const s=setBriefs[i];
    try{
      const detailPrimary=await fetchJson(api+"/sets/"+encodeURIComponent(s.id));
      let cardDetail=detailPrimary,actualLanguage=cfg.language;
      if(cfg.fallback&&(!Array.isArray(detailPrimary.cards)||!detailPrimary.cards.length)){
        const fallbackDetail=await fetchJson(BASE+"/"+cfg.fallback+"/sets/"+encodeURIComponent(s.id)).catch(()=>null);
        if(fallbackDetail&&Array.isArray(fallbackDetail.cards)&&fallbackDetail.cards.length){
          cardDetail=fallbackDetail;actualLanguage=cfg.fallback;fallbackSets++;
        }
      }
      const displaySet=Object.assign({},cardDetail,{
        id:detailPrimary.id,name:detailPrimary.name,
        serie:detailPrimary.serie||cardDetail.serie,
        cardCount:cardDetail.cardCount||detailPrimary.cardCount,
        releaseDate:detailPrimary.releaseDate||cardDetail.releaseDate
      });
      const cards=(cardDetail.cards||[]).map(c=>cardBrief(c,displaySet,actualLanguage));
      if(!cards.length)emptySets++;
      setsOut.push({
        game:"pokemon",id:detailPrimary.id,name:detailPrimary.name,
        cardCount:detailPrimary.cardCount&&detailPrimary.cardCount.total||0,
        printedTotal:detailPrimary.cardCount&&detailPrimary.cardCount.official||0,
        logo:detailPrimary.logo?detailPrimary.logo+".webp":"",
        symbol:detailPrimary.symbol?detailPrimary.symbol+".webp":"",
        releaseDate:detailPrimary.releaseDate||"",
        series:detailPrimary.serie&&detailPrimary.serie.name||"",
        seriesId:detailPrimary.serie&&detailPrimary.serie.id||"",
        catalogLanguage:cfg.language,cardLanguage:actualLanguage,updatedAt:now
      });
      indexOut.push(...cards);
      await atomicJson(cfg.out+"/cards/"+encodeURIComponent(detailPrimary.id)+".json",cards);
      updated++;
    }catch(e){
      failed++;console.error("Set fallito",cfg.language,s.id,e.message);
      const old=previousBySet.get(s.id)||[];indexOut.push(...old);
      setsOut.push({
        game:"pokemon",id:s.id,name:s.name,cardCount:s.cardCount&&s.cardCount.total||0,
        printedTotal:s.cardCount&&s.cardCount.official||0,logo:s.logo?s.logo+".webp":"",
        symbol:s.symbol?s.symbol+".webp":"",releaseDate:"",series:"",seriesId:"",
        catalogLanguage:cfg.language,updatedAt:null,stale:true
      });
    }
    await sleep(65);
  }
  await atomicJson(cfg.out+"/sets.json",setsOut.sort((a,b)=>String(b.releaseDate).localeCompare(String(a.releaseDate))||a.name.localeCompare(b.name)));
  await atomicJson(cfg.out+"/series.json",series);
  await atomicJson(cfg.out+"/search-index.json",indexOut);
  const meta={databaseVersion:1,game:"pokemon",language:cfg.language,source:"TCGdex",updatedAt:now,sets:setsOut.length,cards:indexOut.length,failedSets:failed,fallbackSets,emptySets};
  await atomicJson(cfg.out+"/meta.json",meta);
  console.log(JSON.stringify(meta));
  return meta;
}

const results=[];
for(const cfg of catalogs){
  try{results.push(await syncCatalog(cfg))}
  catch(e){
    console.error("Catalogo lingua fallito",cfg.language,e.message);
    if(cfg.language==="it")throw e;
    results.push({language:cfg.language,error:e.message});
  }
}
console.log(JSON.stringify({updatedAt:now,catalogs:results},null,2));
if(!results.find(x=>x.language==="it"&&x.cards>0))process.exitCode=1;
