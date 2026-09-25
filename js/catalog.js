import{SOURCES}from"./config.js";
import{cacheGet,cachePut}from"./db.js";
import{normalizeSearchQuery,normalizeName,normalizeSetCode,scoreMatch,compareCardNumbers}from"./normalize.js";

async function json(url,opts={}){
  const key="http:"+url;
  if(!opts.force){const cached=await cacheGet(key);if(cached)return cached}
  const res=await fetch(url,{headers:{Accept:"application/json"}});
  if(!res.ok)throw new Error("Fonte non disponibile ("+res.status+")");
  const data=await res.json();
  await cachePut(key,data,opts.ttl||86400000);
  return data;
}
async function staticJson(path){try{const r=await fetch(path,{cache:"no-cache"});if(r.ok)return await r.json()}catch(e){}return null}

export function normalizePokemonBrief(c,set=null){
  const local=c.localId||c.local_id||c.number||"";
  const fallbackId=String(c.id||"");
  const sid=(c.set&&c.set.id)||(set&&set.id)||(fallbackId.includes("-")?fallbackId.split("-").slice(0,-1).join("-"):"");
  return {id:"pokemon:"+c.id,cardId:c.id,printingId:"pokemon:"+c.id,game:"pokemon",name:c.name||"Senza nome",number:local,collectionNumber:local,setId:sid,setCode:sid,setName:(c.set&&c.set.name)||(set&&set.name)||"",series:(c.set&&c.set.serie&&c.set.serie.name)||(set&&set.serie&&set.serie.name)||"",rarity:c.rarity||"",image:c.image?c.image+"/low.webp":"",imageHigh:c.image?c.image+"/high.webp":"",source:"TCGdex",raw:c};
}
export function normalizeYgoPrinting(card,set){
  const code=(set&&set.set_code)||"";
  const img=card.card_images&&card.card_images[0];
  const rarity=(set&&set.set_rarity)||"";
  const pid="yugioh:"+card.id+":"+normalizeSetCode(code)+":"+normalizeName(rarity);
  return {id:pid,cardId:String(card.id),printingId:pid,game:"yugioh",name:card.name,number:code,collectionNumber:code,setId:(set&&set.set_name)||"",setCode:code,setName:(set&&set.set_name)||"",series:"",rarity:rarity,edition:(set&&set.set_edition)||"",image:img?img.image_url_small:"",imageHigh:img?img.image_url:"",archetype:card.archetype||"",passcode:String(card.id),source:"YGOPRODeck",price:set&&set.set_price?{source:"YGOPRODeck",currency:"USD",priceType:"set_price",value:Number(set.set_price),condition:null,timestamp:null,confidence:"MEDIA"}:null,raw:{card:card,set:set}};
}
let indexPromise;
export async function getSearchIndex(){
  if(!indexPromise)indexPromise=(async()=>{const d=await staticJson("./data/search-index.json");return Array.isArray(d)?d:[]})();
  return indexPromise;
}
export function resetSearchIndex(){indexPromise=null}

export async function searchCards(query,opts={}){
  const game=opts.game||"all",limit=opts.limit||80,q=normalizeSearchQuery(query);
  if(!q.raw)return[];
  const idx=await getSearchIndex();
  let results=idx.filter(c=>game==="all"||c.game===game).map(c=>Object.assign({},c,{_score:scoreMatch(c,q)})).filter(c=>c._score>0).sort((a,b)=>b._score-a._score).slice(0,limit);
  if(results.length>=Math.min(12,limit))return results;
  const remote=[];
  if(game==="all"||game==="pokemon"){
    try{
      const all=await json(SOURCES.pokemon.base+"/it/cards",{ttl:7*86400000});
      remote.push(...all.map(normalizePokemonBrief).map(c=>Object.assign({},c,{_score:scoreMatch(c,q)})).filter(c=>c._score>0).sort((a,b)=>b._score-a._score).slice(0,limit));
    }catch(e){}
  }
  if(game==="all"||game==="yugioh"){
    try{
      let data;
      if(q.looksSetCode)data=await json(SOURCES.yugioh.base+"/cardsetsinfo.php?setcode="+encodeURIComponent(q.raw),{ttl:7*86400000});
      else data=await json(SOURCES.yugioh.base+"/cardinfo.php?fname="+encodeURIComponent(q.raw),{ttl:7*86400000});
      const cards=Array.isArray(data&&data.data)?data.data:(Array.isArray(data)?data:[]);
      for(const card of cards)for(const set of(card.card_sets||[])){const p=normalizeYgoPrinting(card,set);p._score=scoreMatch(p,q);if(p._score>0)remote.push(p)}
    }catch(e){}
  }
  const map=new Map();
  for(const x of results.concat(remote))map.set(x.printingId,x);
  return [...map.values()].sort((a,b)=>b._score-a._score).slice(0,limit);
}

export async function getSets(game,force=false){
  const local=await staticJson("./data/"+game+"/sets.json");
  if(Array.isArray(local)&&local.length)return local;
  if(game==="pokemon"){
    const sets=await json(SOURCES.pokemon.base+"/it/sets",{force:force,ttl:7*86400000});
    return sets.map(s=>({game:game,id:s.id,name:s.name,cardCount:s.cardCount?(s.cardCount.total||s.cardCount.official):null,logo:s.logo||"",releaseDate:s.releaseDate||"",series:s.serie?s.serie.name:""}));
  }
  const sets=await json(SOURCES.yugioh.base+"/cardsets.php",{force:force,ttl:7*86400000});
  return sets.map(s=>({game:game,id:s.set_code||s.set_name,name:s.set_name,cardCount:s.num_of_cards,releaseDate:s.tcg_date,setCode:s.set_code}));
}
export async function getSetCards(game,set,force=false){
  const local=await staticJson("./data/"+game+"/cards/"+encodeURIComponent(set.id)+".json");
  if(Array.isArray(local)&&local.length)return local;
  if(game==="pokemon"){
    const data=await json(SOURCES.pokemon.base+"/it/sets/"+encodeURIComponent(set.id),{force:force,ttl:7*86400000});
    return (data.cards||[]).map(c=>normalizePokemonBrief(c,data));
  }
  const data=await json(SOURCES.yugioh.base+"/cardinfo.php?cardset="+encodeURIComponent(set.name),{force:force,ttl:7*86400000});
  const out=[];
  for(const card of(data.data||[]))for(const printing of(card.card_sets||[]).filter(x=>x.set_name===set.name))out.push(normalizeYgoPrinting(card,printing));
  return out;
}
export async function getCardDetail(card){
  if(card.game==="pokemon"){
    try{const c=await json(SOURCES.pokemon.base+"/it/cards/"+encodeURIComponent(card.cardId),{ttl:7*86400000});return normalizePokemonBrief(c,c.set)}catch(e){return card}
  }
  return card;
}
export function sortCards(cards,mode){
  const copy=[...cards];
  if(mode==="name-asc")return copy.sort((a,b)=>a.name.localeCompare(b.name,"it"));
  if(mode==="name-desc")return copy.sort((a,b)=>b.name.localeCompare(a.name,"it"));
  if(mode==="number-asc")return copy.sort((a,b)=>compareCardNumbers(a.collectionNumber,b.collectionNumber));
  if(mode==="number-desc")return copy.sort((a,b)=>compareCardNumbers(b.collectionNumber,a.collectionNumber));
  return copy.sort((a,b)=>(b._score||0)-(a._score||0));
}
