import{mkdir,readFile,writeFile,rename}from"node:fs/promises";
import path from"node:path";

const POKEMON="https://api.tcgdex.net/v2/it";
const YGO="https://db.ygoprodeck.com/api/v7";
const LIMIT=Number(process.env.POKEMON_PRICE_BATCH||300);
const now=new Date().toISOString();
const day=now.slice(0,10),month=now.slice(0,7);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchJson(url,tries=3){
  let last;
  for(let i=0;i<tries;i++){
    try{const r=await fetch(url,{headers:{accept:"application/json","user-agent":"siuper-grading-price-sync"}});if(!r.ok)throw new Error(String(r.status)+" "+r.statusText);return await r.json()}
    catch(e){last=e;if(i<tries-1)await sleep(700*(i+1))}
  }
  throw last;
}
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,"utf8"))}catch{return fallback}}
async function atomicJson(file,data){await mkdir(path.dirname(file),{recursive:true});const tmp=file+".tmp";await writeFile(tmp,JSON.stringify(data,null,2)+"\n");await rename(tmp,file)}
const keyOf=r=>[r.game,r.printingId,r.source,r.currency,r.variant||"",r.priceType,r.condition||""].join("|");

function pokemonPrices(card){
  const out=[],p=card.pricing||{},strong=Boolean(card.variants_detailed),confidence=strong?"ALTA":"MEDIA";
  const cm=p.cardmarket;
  if(cm){
    const unit=cm.unit||"EUR";
    for(const [k,v]of Object.entries(cm)){
      if(["updated","unit"].includes(k)||typeof v!=="number"||v<=0)continue;
      const holo=k.includes("-holo"),type=k.replace("-holo","");
      out.push({game:"pokemon",cardId:card.id,printingId:"pokemon:"+card.id,source:"Cardmarket",currency:unit,priceType:type,variant:holo?"holo":"normal",condition:null,value:v,timestamp:cm.updated||now,confidence:confidence});
    }
  }
  const tcg=p.tcgplayer;
  if(tcg){
    const unit=tcg.unit||"USD";
    for(const [variant,obj]of Object.entries(tcg)){
      if(["updated","unit"].includes(variant)||!obj||typeof obj!=="object")continue;
      const map={lowPrice:"low",midPrice:"mid",highPrice:"high",marketPrice:"market",directLowPrice:"direct_low"};
      for(const [field,type]of Object.entries(map)){const v=Number(obj[field]);if(Number.isFinite(v)&&v>0)out.push({game:"pokemon",cardId:card.id,printingId:"pokemon:"+card.id,source:"TCGPlayer",currency:unit,priceType:type,variant:variant,condition:null,value:v,timestamp:tcg.updated||now,confidence:confidence})}
    }
  }
  return out;
}
function ygoPrices(cards){
  const out=[];
  for(const card of cards)for(const set of card.card_sets||[]){
    const value=Number(set.set_price);if(!Number.isFinite(value)||value<=0)continue;
    const clean=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    const slug=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
    const hashName=v=>{let h=2166136261;for(const ch of String(v||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};
    const sid="ygo-"+slug(set.set_name)+"-"+hashName(set.set_name);
    const pid="yugioh:"+card.id+":"+clean(set.set_code)+":"+sid+":ygo-"+slug(set.set_rarity||"unknown");
    out.push({game:"yugioh",cardId:String(card.id),printingId:pid,source:"YGOPRODeck",currency:"USD",priceType:"set_price",variant:set.set_rarity||"",condition:null,value:value,timestamp:now,confidence:"MEDIA"});
  }
  return out;
}

const pokemonSearch=await readJson("data/pokemon/search-index.json",[]);
const pokemonCards=[...new Map(pokemonSearch.map(x=>[x.cardId,x])).values()];
const cursorFile="data/prices/pokemon-cursor.json",cursorData=await readJson(cursorFile,{cursor:0});
const start=pokemonCards.length?cursorData.cursor%pokemonCards.length:0;
const selected=[];
for(let i=0;i<Math.min(LIMIT,pokemonCards.length);i++)selected.push(pokemonCards[(start+i)%pokemonCards.length]);

const fetchedPokemon=[];
for(let i=0;i<selected.length;i++){
  try{const card=await fetchJson(POKEMON+"/cards/"+encodeURIComponent(selected[i].cardId));fetchedPokemon.push(...pokemonPrices(card))}
  catch(e){console.error("Prezzo Pokemon fallito",selected[i].cardId,e.message)}
  await sleep(80);
}
await atomicJson(cursorFile,{cursor:pokemonCards.length?(start+selected.length)%pokemonCards.length:0,updatedAt:now,batch:selected.length,total:pokemonCards.length});

let fetchedYgo=[];
try{const y=await fetchJson(YGO+"/cardinfo.php");fetchedYgo=ygoPrices(y.data||[])}catch(e){console.error("Prezzi Yu-Gi-Oh! non aggiornati:",e.message)}

const current=await readJson("data/prices/current.json",[]);
const map=new Map(current.map(r=>[keyOf(r),r]));
const changes=[];
for(const r of fetchedPokemon.concat(fetchedYgo)){
  const k=keyOf(r),old=map.get(k);
  if(!old||Number(old.value)!==Number(r.value)){changes.push(r)}
  map.set(k,r);
}
const next=[...map.values()].sort((a,b)=>a.printingId.localeCompare(b.printingId)||a.source.localeCompare(b.source)||a.priceType.localeCompare(b.priceType));
await atomicJson("data/prices/current.json",next);

if(changes.length){
  const historyFile="data/prices/history/"+month+".json";
  const history=await readJson(historyFile,[]);
  history.push(...changes.map(r=>Object.assign({snapshotDate:day},r)));
  await atomicJson(historyFile,history);
}
console.log(JSON.stringify({pokemonRequested:selected.length,pokemonPricePoints:fetchedPokemon.length,yugiohPricePoints:fetchedYgo.length,changed:changes.length,current:next.length},null,2));
