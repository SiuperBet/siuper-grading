import{SOURCES}from"../config.js";
import{setting}from"../db.js";

export const POKEMON_SOURCE_ID="tcgdex";
export const POKEMON_LANGUAGES={
  it:"Italiano",
  en:"English",
  ja:"日本語",
  "zh-tw":"中文（繁體）",
  "zh-cn":"中文（简体）"
};
const ASSET_SET_ALIASES={
  "swsh4.5sv":"swsh4.5",
  "swsh12.5gg":"swsh12.5",
  "swsh9tg":"swsh9",
  "swsh9.5tg":"swsh9",
  "swsh10tg":"swsh10",
  "swsh10.5tg":"swsh10",
  "swsh11tg":"swsh11",
  "swsh11.5tg":"swsh11",
  "swsh12tg":"swsh12",
  "swsh12.5tg":"swsh12"
};
function cleanBase(url=""){return String(url).replace(/\/(?:low|high)\.(?:webp|png|jpg)$/i,"").replace(/\/$/,"")}
function addCandidate(list,seen,base,language,reference=false,label=""){
  if(!base)return;
  const low=base+"/low.webp",high=base+"/high.webp";
  if(seen.has(low))return;
  seen.add(low);list.push({low,high,language,reference,label:label||language.toUpperCase()});
}
export function buildPokemonImageCandidates(card={},set=null,language=null){
  const lang=language||card.catalogLanguage||card.language||(set&&set.catalogLanguage)||"it";
  const local=String(card.localId||card.local_id||card.collectionNumber||card.number||"").trim();
  const setId=(card.set&&card.set.id)||card.setId||(set&&set.id)||"";
  const seriesId=(card.set&&card.set.serie&&card.set.serie.id)||card.seriesId||(set&&set.seriesId)||(set&&set.serie&&set.serie.id)||"";
  const list=[],seen=new Set(),existing=cleanBase(card.imageHigh||card.image||"");
  if(existing)addCandidate(list,seen,existing,lang,false,lang.toUpperCase());
  if(seriesId&&setId&&local){
    const alias=ASSET_SET_ALIASES[setId];
    if(alias)addCandidate(list,seen,"https://assets.tcgdex.net/"+lang+"/"+seriesId+"/"+alias+"/"+encodeURIComponent(local),lang,false,lang.toUpperCase());
    addCandidate(list,seen,"https://assets.tcgdex.net/"+lang+"/"+seriesId+"/"+setId+"/"+encodeURIComponent(local),lang,false,lang.toUpperCase());
    if(lang==="it")addCandidate(list,seen,"https://assets.tcgdex.net/en/"+seriesId+"/"+setId+"/"+encodeURIComponent(local),"en",true,"REF EN");
  }
  const cardId=String(card.cardId||card.id||"").replace(/^pokemon:(?:[a-z-]+:)?/,"");
  if(cardId&&(lang==="it"||lang==="en")){
    const external="https://img.illudex.com/"+encodeURIComponent(cardId)+"/high.webp";
    if(!seen.has(external)){seen.add(external);list.push({low:external,high:external,language:"en",reference:true,label:lang==="it"?"REF EN • ILLUDEX":"ILLUDEX"})}
  }
  return list;
}
export function decoratePokemonImages(card,set=null,language=null){
  const candidates=buildPokemonImageCandidates(card,set,language);
  return Object.assign({},card,{
    seriesId:card.seriesId||(set&&set.seriesId)||(set&&set.serie&&set.serie.id)||"",
    imageCandidates:candidates,
    image:candidates[0]?candidates[0].low:(card.image||""),
    imageHigh:candidates[0]?candidates[0].high:(card.imageHigh||"")
  });
}
export function pokemonPrintingId(cardId,language="it"){
  const lang=String(language||"it").toLowerCase();
  return lang==="it"?"pokemon:"+cardId:"pokemon:"+lang+":"+cardId;
}
export async function pokemonBase(language=null){
  const lang=language||await setting("pokemonLanguage","it");
  const safe=Object.prototype.hasOwnProperty.call(POKEMON_LANGUAGES,lang)?lang:"it";
  return SOURCES.pokemon.base+"/"+safe;
}
export function normalizePokemonBrief(c,set=null,language=null){
  const lang=language||c.catalogLanguage||c.language||(set&&set.catalogLanguage)||"it";
  const local=c.localId||c.local_id||c.number||"",fallbackId=String(c.id||"");
  const sid=(c.set&&c.set.id)||(set&&set.id)||(fallbackId.includes("-")?fallbackId.split("-").slice(0,-1).join("-"):"");
  const seriesId=(c.set&&c.set.serie&&c.set.serie.id)||(set&&set.seriesId)||(set&&set.serie&&set.serie.id)||"";
  const printingId=pokemonPrintingId(c.id,lang);
  return decoratePokemonImages({
    id:printingId,cardId:c.id,printingId:printingId,game:"pokemon",
    name:c.name||"Senza nome",number:local,collectionNumber:local,setId:sid,setCode:sid,
    setName:(c.set&&c.set.name)||(set&&set.name)||"",
    series:(c.set&&c.set.serie&&c.set.serie.name)||(set&&set.serie&&set.serie.name)||(set&&set.series)||"",
    seriesId,
    rarity:c.rarity||"",
    printedTotal:(c.set&&c.set.cardCount&&c.set.cardCount.official)||(set&&set.cardCount&&set.cardCount.official)||null,
    image:c.image?c.image+"/low.webp":"",imageHigh:c.image?c.image+"/high.webp":"",
    artist:c.illustrator||c.artist||"",types:c.types||[],variants:c.variants||{},category:c.category||"",
    hp:c.hp||null,stage:c.stage||"",dexId:c.dexId||[],regulationMark:c.regulationMark||"",
    language:lang,catalogLanguage:lang,
    source:"TCGdex",sourceId:POKEMON_SOURCE_ID,raw:c
  },set,lang);
}
export function normalizePokemonSet(s,language="it"){
  return{
    game:"pokemon",id:s.id,name:s.name,
    cardCount:s.cardCount?(s.cardCount.total||s.cardCount.official):null,
    printedTotal:s.cardCount&&s.cardCount.official||null,logo:s.logo||"",releaseDate:s.releaseDate||"",
    series:s.serie?s.serie.name:"",seriesId:s.serie?s.serie.id:"",catalogLanguage:language,source:"TCGdex"
  };
}
