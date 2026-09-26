import{readFile,writeFile,mkdir}from"node:fs/promises";
import{existsSync}from"node:fs";

const errors=[],warnings=[],stats={};
async function readJson(file,fallback,quiet=false){try{return JSON.parse(await readFile(file,"utf8"))}catch(e){if(!quiet)warnings.push("File non disponibile: "+file);return fallback}}
function duplicateValues(rows,key,label){
  const seen=new Set(),dup=new Set();for(const r of rows){const v=r&&r[key];if(v==null)continue;if(seen.has(v))dup.add(v);else seen.add(v)}
  if(dup.size)errors.push(label+" duplicati: "+[...dup].slice(0,20).join(", "));
}
const configs=[
  ["pokemon-it","data/pokemon"],["pokemon-en","data/pokemon-en"],["pokemon-ja","data/pokemon-ja"],["pokemon-zh-tw","data/pokemon-zh-tw"],["pokemon-zh-cn","data/pokemon-zh-cn"],["yugioh","data/yugioh"]
],allIndexes=[],catalogStats={};
for(const[name,dir]of configs){
  const index=await readJson(dir+"/search-index.json",[],name!=="pokemon-it"&&name!=="yugioh"),sets=await readJson(dir+"/sets.json",[],name!=="pokemon-it"&&name!=="yugioh");
  catalogStats[name]={cards:index.length,sets:sets.length};duplicateValues(index,"printingId",name+" printingId");duplicateValues(sets,"id",name+" setId");allIndexes.push(...index);
  let empty=0,missing=0;
  for(const set of sets){
    if(!set.id||!set.name)errors.push(name+" set senza id/nome");
    if(Number(set.cardCount)<0)errors.push(name+" cardCount negativo: "+set.id);
    const shard=dir+"/cards/"+encodeURIComponent(set.id)+".json";
    if(!existsSync(shard)){if(Number(set.cardCount)>0)missing++;continue}
    const rows=await readJson(shard,[],true);if(!rows.length)empty++;
  }
  catalogStats[name].emptySets=empty;catalogStats[name].missingShards=missing;
  if(missing)warnings.push(name+": "+missing+" shard dichiarati ma mancanti");
}
duplicateValues(allIndexes,"printingId","printingId globale");
for(const c of allIndexes){
  if(!c.id||!c.game||!c.name||!c.printingId)errors.push("Carta senza campi obbligatori: "+JSON.stringify(c).slice(0,180));
  if(!["pokemon","yugioh"].includes(c.game))errors.push("Gioco non valido: "+c.game);
  if(!c.setId)warnings.push("Carta senza setId: "+c.id);
  if(c.game==="pokemon"&&c.catalogLanguage&&!["it","en","ja","zh-tw","zh-cn"].includes(c.catalogLanguage))warnings.push("Lingua Pokemon inattesa: "+c.catalogLanguage);
}
const prices=await readJson("data/prices/current.json",[]);
for(const p of prices){
  if(!p.printingId||!p.source||!p.currency||!p.priceType)errors.push("PriceSnapshot incompleto");
  if(!Number.isFinite(Number(p.value))||Number(p.value)<=0)errors.push("Prezzo non positivo: "+p.printingId);
  if(!["EUR","USD","GBP","JPY","CAD","AUD"].includes(p.currency))warnings.push("Valuta non prevista: "+p.currency);
}
const tcgMap=await readJson("data/prices/tcgcsv-map.json",null,true);
if(tcgMap){
  if(!Array.isArray(tcgMap.cards)||!tcgMap.cards.length)errors.push("TCGCSV map senza carte");
  else{duplicateValues(tcgMap.cards,"printingId","TCGCSV printingId");for(const m of tcgMap.cards.slice(0,1000))if(!m.groupId||!m.productId||!m.printingId)errors.push("TCGCSV mapping incompleto")}
}
const backfill=await readJson("data/prices/tcgcsv-history/summary.json",null,true);
stats.catalogs=catalogStats;stats.totalSearchEntries=allIndexes.length;stats.pricePoints=prices.length;stats.tcgcsvMappedCards=tcgMap&&tcgMap.mappedCards||0;stats.tcgcsvBackfill=backfill;
if(!catalogStats["pokemon-it"].sets)warnings.push("Catalogo Pokemon IT non popolato.");if(!catalogStats.yugioh.sets)warnings.push("Catalogo Yu-Gi-Oh! non popolato.");
const report={generatedAt:new Date().toISOString(),ok:errors.length===0,errors,warnings:[...new Set(warnings)].slice(0,500),stats};
await mkdir("data",{recursive:true});await writeFile("data/validation-report.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(errors.length)process.exitCode=1;
