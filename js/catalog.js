import{SOURCES}from"./config.js";
import{cacheGet,cachePut}from"./db.js";
import{normalizeSearchQuery,scoreMatch,compareCardNumbers}from"./normalize.js";
import{pokemonBase,normalizePokemonBrief,normalizePokemonSet}from"./data/pokemon-adapter.js";
import{normalizeYgoPrinting,normalizeYgoSet}from"./data/yugioh-adapter.js";

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
export{normalizePokemonBrief,normalizeYgoPrinting};
let indexPromise;
export async function getSearchIndex(){
  if(!indexPromise)indexPromise=(async()=>{
    const [pokemon,yugioh,legacy]=await Promise.all([
      staticJson("./data/pokemon/search-index.json"),
      staticJson("./data/yugioh/search-index.json"),
      staticJson("./data/search-index.json")
    ]);
    const rows=[...(Array.isArray(pokemon)?pokemon:[]),...(Array.isArray(yugioh)?yugioh:[])];
    if(rows.length)return rows;
    return Array.isArray(legacy)?legacy:[];
  })();
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
      const all=await json((await pokemonBase())+"/cards",{ttl:7*86400000});
      let brief=all.map(normalizePokemonBrief);
      if(q.number&&q.number.normalizedTotal){
        try{
          const sets=await json((await pokemonBase())+"/sets",{ttl:7*86400000});
          const totals=new Map(sets.map(s=>[s.id,s.cardCount&&s.cardCount.official||null]));
          brief=brief.map(x=>Object.assign({},x,{printedTotal:totals.get(x.setId)||x.printedTotal||null}));
        }catch(e){}
      }
      remote.push(...brief.map(c=>Object.assign({},c,{_score:scoreMatch(c,q)})).filter(c=>c._score>0).sort((a,b)=>b._score-a._score).slice(0,limit));
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
    const sets=await json((await pokemonBase())+"/sets",{force:force,ttl:7*86400000});
    return sets.map(normalizePokemonSet);
  }
  const sets=await json(SOURCES.yugioh.base+"/cardsets.php",{force:force,ttl:7*86400000});
  return sets.map(normalizeYgoSet);
}
export async function getSetCards(game,set,force=false){
  const local=await staticJson("./data/"+game+"/cards/"+encodeURIComponent(set.id)+".json");
  if(Array.isArray(local)&&local.length)return local;
  if(game==="pokemon"){
    const preferred=await pokemonBase();
    let data=await json(preferred+"/sets/"+encodeURIComponent(set.id),{force:force,ttl:7*86400000}).catch(()=>null);
    if(!data||!Array.isArray(data.cards)||!data.cards.length){
      const english=SOURCES.pokemon.base+"/en";
      if(preferred!==english)data=await json(english+"/sets/"+encodeURIComponent(set.id),{force:force,ttl:7*86400000}).catch(()=>data);
    }
    if(!data||!Array.isArray(data.cards))return[];
    const displaySet=Object.assign({},data,{id:set.id||data.id,name:set.name||data.name,serie:data.serie||{name:set.series||""},cardCount:data.cardCount||{official:set.printedTotal||set.cardCount||null,total:set.cardCount||null}});
    return data.cards.map(c=>normalizePokemonBrief(c,displaySet));
  }
  const data=await json(SOURCES.yugioh.base+"/cardinfo.php?cardset="+encodeURIComponent(set.name),{force:force,ttl:7*86400000});
  const out=[];
  for(const card of(data.data||[]))for(const printing of(card.card_sets||[]).filter(x=>x.set_name===set.name))out.push(normalizeYgoPrinting(card,printing));
  return out;
}
export async function getCardDetail(card){
  if(card.game==="pokemon"){
    try{const c=await json((await pokemonBase())+"/cards/"+encodeURIComponent(card.cardId),{ttl:7*86400000});return normalizePokemonBrief(c,c.set)}catch(e){return card}
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
