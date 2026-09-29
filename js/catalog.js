import{SOURCES}from"./config.js";
import{cacheGet,cachePut,setting}from"./db.js";
import{normalizeSearchQuery,scoreMatch,compareCardNumbers}from"./normalize.js";
import{pokemonBase,normalizePokemonBrief,normalizePokemonSet,decoratePokemonImages,POKEMON_LANGUAGES}from"./data/pokemon-adapter.js";
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
function ygoCatalogDir(language="tcg"){return({"ocg-jp":"yugioh-ocg-jp","ocg-sc":"yugioh-ocg-sc","ocg-tc":"yugioh-ocg-tc"})[language]||"yugioh"}
function isOcgLanguage(language=""){return /^ocg-(?:jp|sc|tc)$/.test(language)}
function matchesLanguage(card,language){
  if(!language||language==="all")return true;
  if(card.game==="pokemon")return card.catalogLanguage===language||card.language===language;
  if(card.game==="yugioh"){
    if(language==="tcg")return !isOcgLanguage(card.catalogLanguage||card.language||"");
    if(isOcgLanguage(language))return card.catalogLanguage===language||card.language===language;
    return false;
  }
  return false;
}
let ygoOcgPromise;
async function ygoOcgData(){
  if(!ygoOcgPromise)ygoOcgPromise=staticJson("./data/yugioh/ocg-aliases.json").then(x=>x&&x.aliases?x.aliases:{});
  return ygoOcgPromise;
}
function decorateYgoOcg(card,aliases){
  if(!card||card.game!=="yugioh")return card;const a=aliases&&aliases[String(card.cardId)]||null;if(!a)return card;
  const names=[a.jpName,a.jpRuby,a.zhName,a.scName,a.cnocgName,a.masterDuelName,a.enName].filter(Boolean);
  return Object.assign({},card,{aliases:[...new Set(names)],jpName:a.jpName||"",jpRuby:a.jpRuby||"",zhName:a.zhName||"",scName:a.scName||"",ocgCid:a.cid??null,ocgRelease:a.release||null});
}
let indexPromise;
async function loadSearchIndex(){
  const [it,en,ja,zhtw,zhcn,yugioh,ygoJp,ygoSc,ygoTc,ocg,legacy]=await Promise.all([
    staticJson("./data/pokemon/search-index.json"),
    staticJson("./data/pokemon-en/search-index.json"),
    staticJson("./data/pokemon-ja/search-index.json"),
    staticJson("./data/pokemon-zh-tw/search-index.json"),
    staticJson("./data/pokemon-zh-cn/search-index.json"),
    staticJson("./data/yugioh/search-index.json"),
    staticJson("./data/yugioh-ocg-jp/search-index.json"),
    staticJson("./data/yugioh-ocg-sc/search-index.json"),
    staticJson("./data/yugioh-ocg-tc/search-index.json"),
    ygoOcgData(),
    staticJson("./data/search-index.json")
  ]);
  const merged=[it,en,ja,zhtw,zhcn].flatMap(x=>Array.isArray(x)?x:[]);
  const pokemon=[...new Map(merged.map(x=>[x.printingId,x])).values()];
  const ygoRows=[yugioh,ygoJp,ygoSc,ygoTc].flatMap(x=>Array.isArray(x)?x:[]).map(x=>decorateYgoOcg(x,ocg));
  const rows=[...pokemon,...new Map(ygoRows.map(x=>[x.printingId,x])).values()];
  const result=rows.length?rows:(Array.isArray(legacy)?legacy:[]);
  // Gli indici OCG sono facoltativi; se manca uno degli indici principali (rete assente,
  // errore HTTP, JSON non valido) o il risultato e' vuoto, non va messo in cache.
  const failed=[it,en,ja,zhtw,zhcn,yugioh].some(x=>!Array.isArray(x))||result.length===0;
  return{rows:result,failed};
}
export async function getSearchIndex(){
  if(!indexPromise){
    const request=loadSearchIndex().then(
      r=>{if(r.failed&&indexPromise===request)indexPromise=null;return r.rows},
      e=>{if(indexPromise===request)indexPromise=null;throw e}
    );
    indexPromise=request;
  }
  return indexPromise;
}
export function resetSearchIndex(){indexPromise=null}

export async function searchCards(query,opts={}){
  const game=opts.game||"all",limit=opts.limit||80,language=opts.language||"all",q=normalizeSearchQuery(query);
  if(!q.raw)return[];
  const idx=await getSearchIndex();
  let results=idx.filter(c=>(game==="all"||c.game===game)&&matchesLanguage(c,language)).map(c=>Object.assign({},c,{_score:scoreMatch(c,q)})).filter(c=>c._score>0).sort((a,b)=>b._score-a._score).slice(0,limit).map(c=>c.game==="pokemon"?decoratePokemonImages(c,null,c.catalogLanguage||c.language||"it"):c);
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
  if((game==="all"||game==="yugioh")&&(language==="all"||language==="tcg")){
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
  const ygoLanguage=language||"tcg",dir=ygoCatalogDir(ygoLanguage),local=await staticJson("./data/"+dir+"/sets.json");
  if(Array.isArray(local)&&local.length)return local;
  if(isOcgLanguage(ygoLanguage))return[];
  const sets=await json(SOURCES.yugioh.base+"/cardsets.php",{force:force,ttl:7*86400000});
  return sets.map(normalizeYgoSet);
}
export async function getSetCards(game,set,force=false,language=null){
  if(game==="pokemon"){
    const lang=language||set.catalogLanguage||await setting("pokemonLanguage","it"),safe=supportedPokemonLanguage(lang)?lang:"it",dir=pokemonDir(safe);
    const local=await staticJson("./data/"+dir+"/cards/"+encodeURIComponent(set.id)+".json");
    if(Array.isArray(local)&&local.length)return local.map(c=>decoratePokemonImages(c,set,safe));
    let data=await json((await pokemonBase(safe))+"/sets/"+encodeURIComponent(set.id),{force:force,ttl:7*86400000}).catch(()=>null);
    let actualLanguage=safe;
    if(safe==="it"&&(!data||!Array.isArray(data.cards)||!data.cards.length)){
      const english=SOURCES.pokemon.base+"/en";
      data=await json(english+"/sets/"+encodeURIComponent(set.id),{force:force,ttl:7*86400000}).catch(()=>data);
      if(data&&Array.isArray(data.cards)&&data.cards.length)actualLanguage="en";
    }
    if(!data||!Array.isArray(data.cards))return[];
    const displaySet=Object.assign({},data,{id:set.id||data.id,name:set.name||data.name,serie:data.serie||{name:set.series||"",id:set.seriesId||""},seriesId:set.seriesId||data.serie&&data.serie.id||"",cardCount:data.cardCount||{official:set.printedTotal||set.cardCount||null,total:set.cardCount||null},catalogLanguage:actualLanguage});
    return data.cards.map(c=>normalizePokemonBrief(c,displaySet,actualLanguage));
  }
  const ygoLanguage=language||set.catalogLanguage||"tcg",dir=ygoCatalogDir(ygoLanguage),local=await staticJson("./data/"+dir+"/cards/"+encodeURIComponent(set.id)+".json");
  if(Array.isArray(local)&&local.length){const ocg=await ygoOcgData();return local.map(x=>decorateYgoOcg(x,ocg))}
  if(isOcgLanguage(ygoLanguage))return[];
  const data=await json(SOURCES.yugioh.base+"/cardinfo.php?cardset="+encodeURIComponent(set.name),{force:force,ttl:7*86400000});
  const out=[];
  const ocg=await ygoOcgData();for(const card of(data.data||[]))for(const printing of(card.card_sets||[]).filter(x=>x.set_name===set.name))out.push(decorateYgoOcg(normalizeYgoPrinting(card,printing),ocg));
  return out;
}
export async function getCardDetail(card){
  if(card.game==="pokemon"){
    try{
      const lang=card.catalogLanguage||card.language||await setting("pokemonLanguage","it");
      const c=await json((await pokemonBase(lang))+"/cards/"+encodeURIComponent(card.cardId),{ttl:7*86400000});
      return normalizePokemonBrief(c,c.set,lang);
    }catch(e){return decoratePokemonImages(card,null,card.catalogLanguage||card.language||"it")}
  }
  if(card.game==="yugioh")return decorateYgoOcg(card,await ygoOcgData());
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
