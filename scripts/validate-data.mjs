import{readFile,writeFile,mkdir}from"node:fs/promises";
import{existsSync}from"node:fs";
import path from"node:path";

const errors=[],warnings=[],stats={};
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,"utf8"))}catch(e){warnings.push("File non disponibile: "+file);return fallback}}
function duplicateValues(rows,key,label){
  const seen=new Set(),dup=new Set();
  for(const r of rows){const v=r&&r[key];if(v==null)continue;if(seen.has(v))dup.add(v);else seen.add(v)}
  if(dup.size)errors.push(label+" duplicati: "+[...dup].slice(0,20).join(", "));
}
const index=await readJson("data/search-index.json",[]);
const pokemonSets=await readJson("data/pokemon/sets.json",[]);
const ygoSets=await readJson("data/yugioh/sets.json",[]);
const prices=await readJson("data/prices/current.json",[]);

stats.searchEntries=index.length;stats.pokemonSets=pokemonSets.length;stats.yugiohSets=ygoSets.length;stats.pricePoints=prices.length;
duplicateValues(index,"printingId","printingId");
duplicateValues(pokemonSets,"id","ID set Pokemon");
duplicateValues(ygoSets,"id","ID set Yu-Gi-Oh!");

for(const c of index){
  if(!c.id||!c.game||!c.name||!c.printingId)errors.push("Carta senza campi obbligatori: "+JSON.stringify(c).slice(0,180));
  if(!["pokemon","yugioh"].includes(c.game))errors.push("Gioco non valido: "+c.game);
  if(!c.setId)warnings.push("Carta senza setId: "+c.id);
}
for(const s of pokemonSets.concat(ygoSets)){
  if(!s.id||!s.name)errors.push("Set senza id/nome");
  if(Number(s.cardCount)<0)errors.push("cardCount negativo: "+s.id);
  const shard="data/"+s.game+"/cards/"+encodeURIComponent(s.id)+".json";
  if(Number(s.cardCount)>0&&!existsSync(shard))warnings.push("Shard non ancora generato: "+shard);
}
for(const p of prices){
  if(!p.printingId||!p.source||!p.currency||!p.priceType)errors.push("PriceSnapshot incompleto");
  if(!Number.isFinite(Number(p.value))||Number(p.value)<=0)errors.push("Prezzo non positivo: "+p.printingId);
  if(!["EUR","USD","GBP","JPY","CAD","AUD"].includes(p.currency))warnings.push("Valuta non prevista: "+p.currency);
}
if(!pokemonSets.length)warnings.push("Catalogo Pokemon non ancora popolato: eseguire update-pokemon-data.");
if(!ygoSets.length)warnings.push("Catalogo Yu-Gi-Oh! non ancora popolato: eseguire update-yugioh-data.");

const report={generatedAt:new Date().toISOString(),ok:errors.length===0,errors:errors,warnings:[...new Set(warnings)].slice(0,500),stats:stats};
await mkdir("data",{recursive:true});await writeFile("data/validation-report.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exitCode=1;
