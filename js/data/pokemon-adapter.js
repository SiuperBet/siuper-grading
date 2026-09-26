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
  const printingId=pokemonPrintingId(c.id,lang);
  return{
    id:printingId,cardId:c.id,printingId:printingId,game:"pokemon",
    name:c.name||"Senza nome",number:local,collectionNumber:local,setId:sid,setCode:sid,
    setName:(c.set&&c.set.name)||(set&&set.name)||"",
    series:(c.set&&c.set.serie&&c.set.serie.name)||(set&&set.serie&&set.serie.name)||"",
    rarity:c.rarity||"",
    printedTotal:(c.set&&c.set.cardCount&&c.set.cardCount.official)||(set&&set.cardCount&&set.cardCount.official)||null,
    image:c.image?c.image+"/low.webp":"",imageHigh:c.image?c.image+"/high.webp":"",
    artist:c.illustrator||c.artist||"",types:c.types||[],variants:c.variants||{},category:c.category||"",
    hp:c.hp||null,stage:c.stage||"",dexId:c.dexId||[],regulationMark:c.regulationMark||"",
    language:lang,catalogLanguage:lang,
    source:"TCGdex",sourceId:POKEMON_SOURCE_ID,raw:c
  };
}
export function normalizePokemonSet(s,language="it"){
  return{
    game:"pokemon",id:s.id,name:s.name,
    cardCount:s.cardCount?(s.cardCount.total||s.cardCount.official):null,
    printedTotal:s.cardCount&&s.cardCount.official||null,logo:s.logo||"",releaseDate:s.releaseDate||"",
    series:s.serie?s.serie.name:"",catalogLanguage:language,source:"TCGdex"
  };
}
