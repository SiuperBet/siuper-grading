import{readFile,writeFile,mkdir,readdir}from"node:fs/promises";
import{existsSync}from"node:fs";

async function readJson(file,fallback){try{return JSON.parse(await readFile(file,"utf8"))}catch{return fallback}}
async function catalog(name,dir){
  const [meta,sets,index]=await Promise.all([readJson(dir+"/meta.json",{}),readJson(dir+"/sets.json",[]),readJson(dir+"/search-index.json",[])]);
  const withImage=index.filter(x=>x.image||x.imageHigh).length,withVariants=index.filter(x=>x.variants&&typeof x.variants==="object"&&Object.values(x.variants).some(Boolean)).length,emptySets=[];
  for(const set of sets){const rows=await readJson(dir+"/cards/"+encodeURIComponent(set.id)+".json",[]);if(!rows.length)emptySets.push({id:set.id,name:set.name,declared:set.cardCount||set.printedTotal||0})}
  return{name,updatedAt:meta.updatedAt||null,sets:sets.length,cards:index.length,primaryImages:withImage,primaryImageCoverage:index.length?withImage/index.length:0,variantMetadata:withVariants,variantCoverage:index.length?withVariants/index.length:0,emptySets};
}
const catalogs=[];
for(const [name,dir]of[["pokemon-it","data/pokemon"],["pokemon-en","data/pokemon-en"],["pokemon-ja","data/pokemon-ja"],["pokemon-zh-tw","data/pokemon-zh-tw"],["pokemon-zh-cn","data/pokemon-zh-cn"],["yugioh","data/yugioh"]])catalogs.push(await catalog(name,dir));
const ygo=await readJson("data/yugioh/search-index.json",[]),ygoMirrored=ygo.filter(x=>x.image&&existsSync(String(x.image).replace(/^\.\//,""))).length,prices=await readJson("data/prices/current.json",[]),tcgMap=await readJson("data/prices/tcgcsv-map.json",null),backfill=await readJson("data/prices/tcgcsv-history/summary.json",null),custom=await readJson("data/master-sets/custom.json",{masterSets:[]});
const warnings=[];
for(const c of catalogs){if(c.emptySets.length)warnings.push(c.name+": "+c.emptySets.length+" set senza carte nella fonte corrente");if(c.primaryImageCoverage<.8)warnings.push(c.name+": copertura immagini primarie "+(c.primaryImageCoverage*100).toFixed(1)+"%")}
if(!tcgMap)warnings.push("Mappatura TCGCSV non disponibile");if(tcgMap&&tcgMap.ambiguousSets)warnings.push("TCGCSV: "+tcgMap.ambiguousSets+" set ambigui esclusi automaticamente");if(tcgMap&&tcgMap.unmappedSets)warnings.push("TCGCSV: "+tcgMap.unmappedSets+" set non mappati");
const report={generatedAt:new Date().toISOString(),catalogs,yugiohMirroredImages:ygoMirrored,yugiohPrintings:ygo.length,pricePoints:prices.length,tcgcsv:tcgMap?{mappedCards:tcgMap.mappedCards,mappedSets:tcgMap.mappedSets,ambiguousSets:tcgMap.ambiguousSets,unmappedSets:tcgMap.unmappedSets}:null,tcgcsvBackfill:backfill,customMasterSets:(custom.masterSets||[]).map(x=>({id:x.id,name:x.name,expectedSlots:x.expectedSlots||0,components:(x.components||[]).length,explicitSlots:(x.slots||[]).length})),warnings};
await mkdir("data/audit",{recursive:true});await writeFile("data/audit/coverage.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
