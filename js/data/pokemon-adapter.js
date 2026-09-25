import{SOURCES}from"../config.js";
import{setting}from"../db.js";

export const POKEMON_SOURCE_ID="tcgdex";
export async function pokemonBase(){
  const lang=await setting("pokemonLanguage","it");
  return SOURCES.pokemon.base+"/"+(lang==="en"?"en":"it");
}
export function normalizePokemonBrief(c,set=null){
  const local=c.localId||c.local_id||c.number||"",fallbackId=String(c.id||"");
  const sid=(c.set&&c.set.id)||(set&&set.id)||(fallbackId.includes("-")?fallbackId.split("-").slice(0,-1).join("-"):"");
  return{
    id:"pokemon:"+c.id,cardId:c.id,printingId:"pokemon:"+c.id,game:"pokemon",
    name:c.name||"Senza nome",number:local,collectionNumber:local,setId:sid,setCode:sid,
    setName:(c.set&&c.set.name)||(set&&set.name)||"",
    series:(c.set&&c.set.serie&&c.set.serie.name)||(set&&set.serie&&set.serie.name)||"",
    rarity:c.rarity||"",
    printedTotal:(c.set&&c.set.cardCount&&c.set.cardCount.official)||(set&&set.cardCount&&set.cardCount.official)||null,
    image:c.image?c.image+"/low.webp":"",imageHigh:c.image?c.image+"/high.webp":"",
    artist:c.illustrator||c.artist||"",types:c.types||[],variants:c.variants||{},category:c.category||"",
    hp:c.hp||null,stage:c.stage||"",dexId:c.dexId||[],regulationMark:c.regulationMark||"",
    source:"TCGdex",sourceId:POKEMON_SOURCE_ID,raw:c
  };
}
export function normalizePokemonSet(s){
  return{
    game:"pokemon",id:s.id,name:s.name,
    cardCount:s.cardCount?(s.cardCount.total||s.cardCount.official):null,
    printedTotal:s.cardCount&&s.cardCount.official||null,logo:s.logo||"",releaseDate:s.releaseDate||"",
    series:s.serie?s.serie.name:"",source:"TCGdex"
  };
}
