import{SOURCES}from"./config.js";
import{cacheGet,cachePut,setting}from"./db.js";
import{normalizeSearchQuery,scoreMatch,compareCardNumbers}from"./normalize.js";
import{pokemonBase,normalizePokemonBrief,normalizePokemonSet,POKEMON_LANGUAGES}from"./data/pokemon-adapter.js";
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
function pokemonDir(language="it"){return language==="it"?"pokemon":"pokemon-"+language}
function supportedPokemonLanguage(language){return Object.prototype.hasOwnProperty.call(POKEMON_LANGUAGES,language)}
let indexPromise;
export async function getSearchIndex(){
  if(!indexPromise)indexPromise=(async()=>{
    const [it,en,ja,zhtw,zhcn,yugioh,legacy]=await Promise.all([
      staticJson("./data/pokemon/search-index.json"),
      staticJson("./data/pokemon-en/search-index.json"),
      staticJson("./data/pokemon-ja/search-index.json"),
      staticJson("./data/pokemon-zh-tw/search-index.json"),
      staticJson("./data/pokemon-zh-cn/search-index.json"),
      staticJson("./data/yugioh/search-index.json"),
      staticJson("./data/search-index.json")
    ]);
    const merged=[it,en,ja,zhtw,zhcn].flatMap(x=>Array.isArray(x)?x:[]);
    const pokemon=[...new Map(merged.map(x=>[x.printingId,x])).values()];
    const rows=[...pokemon,...(Array.isArray(yugioh)?yugioh:[])];
    if(rows.length)return rows;
    return Array.isArray(legacy)?legacy:[];
  })();
  return indexPromise;
}
export function resetSearchIndex(){indexPromise=null}

export async function searchCards(query,opts={}){
  const game=opts.game||"all",limit=opts.limit||80,language=opts.language||"all",q=normalizeSearchQuery(query);
  if(!q.raw)return[];
  const idx=await getSearchIndex();
  let results=idx.filter(c=>(game==="all"||c.game===game)&&(language==="all"||c.game!=="pokemon"||c.catalogLanguage===language||c.language===language)).map(c=>Object.assign({},c,{_score:scoreMatch(c,q)})).filter(c=>c._score>0).sort((a,b)=>b._score-a._score).slice(0,limit);
  if(results.length>=Math.min(12,limit))return results;
  const remote=[];
  if(game==="all"||game==="pokemon"){
    try{
      const remoteLanguage=language!=="all"&&supportedPokemonLanguage(language)?language:await setting("pokemonLanguage","it");
      const all=await json((await pokemonBase(remoteLanguage))+"/cards",{ttl:7*86400000});
      let brief=all.map(c=>normalizePokemonBrief(c,null,remoteLanguage));
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

export async function getSets(game,force=false,language=null){
  if(game==="pokemon"){
    const lang=language||await setting("pokemonLanguage","it"),safe=supportedPokemonLanguage(lang)?lang:"it",dir=pokemonDir(safe);
    const local=await staticJson("./data/"+dir+"/sets.json");
    if(Array.isArray(local)&&local.length)return local;
    const sets=await json((await pokemonBase(safe))+"/sets",{force:force,ttl:7*86400000});
    return sets.map(s=>normalizePokemonSet(s,safe));
  }
  const local=await staticJson("./data/"+game+"/sets.json");
  if(Array.isArray(local)&&local.length)return local;
  const sets=await json(SOURCES.yugioh.base+"/cardsets.php",{force:force,ttl:7*86400000});
  return sets.map(normalizeYgoSet);
}
export async function getSetCards(game,set,force=false,language=null){
  if(game==="pokemon"){
    const lang=language||set.catalogLanguage||await setting("pokemonLanguage","it"),safe=supportedPokemonLanguage(lang)?lang:"it",dir=pokemonDir(safe);
    const local=await staticJson("./data/"+dir+"/cards/"+encodeURIComponent(set.id)+".json");
    if(Array.isArray(local)&&local.length)return local;
    let data=await json((await pokemonBase(safe))+"/sets/"+encodeURIComponent(set.id),{force:force,ttl:7*86400000}).catch(()=>null);
    let actualLanguage=safe;
    if(safe==="it"&&(!data||!Array.isArray(data.cards)||!data.cards.length)){
      const english=SOURCES.pokemon.base+"/en";
      data=await json(english+"/sets/"+encodeURIComponent(set.id),{force:force,ttl:7*86400000}).catch(()=>data);
      if(data&&Array.isArray(data.cards)&&data.cards.length)actualLanguage="en";
    }
    if(!data||!Array.isArray(data.cards))return[];
    const displaySet=Object.assign({},data,{id:set.id||data.id,name:set.name||data.name,serie:data.serie||{name:set.series||""},cardCount:data.cardCount||{official:set.printedTotal||set.cardCount||null,total:set.cardCount||null},catalogLanguage:actualLanguage});
    return data.cards.map(c=>normalizePokemonBrief(c,displaySet,actualLanguage));
  }
  const local=await staticJson("./data/"+game+"/cards/"+encodeURIComponent(set.id)+".json");
  if(Array.isArray(local)&&local.length)return local;
  const data=await json(SOURCES.yugioh.base+"/cardinfo.php?cardset="+encodeURIComponent(set.name),{force:force,ttl:7*86400000});
  const out=[];
  for(const card of(data.data||[]))for(const printing of(card.card_sets||[]).filter(x=>x.set_name===set.name))out.push(normalizeYgoPrinting(card,printing));
  return out;
}
export async function getCardDetail(card){
  if(card.game==="pokemon"){
    try{
      const lang=card.catalogLanguage||card.language||await setting("pokemonLanguage","it");
      const c=await json((await pokemonBase(lang))+"/cards/"+encodeURIComponent(card.cardId),{ttl:7*86400000});
      return normalizePokemonBrief(c,c.set,lang);
    }catch(e){return card}
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
