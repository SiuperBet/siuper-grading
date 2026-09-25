import{normalizeName,normalizeSetCode}from"../normalize.js";

export const YUGIOH_SOURCE_ID="ygoprodeck-v7";
function slug(v){return"ygo-"+normalizeName(v||"unknown").replace(/ /g,"-")}
function hashName(v){let h=2166136261;for(const ch of String(v||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
export function ygoSetId(name){return slug(name)+"-"+hashName(name)}
export function normalizeYgoPrinting(card,set){
  const code=(set&&set.set_code)||"",img=card.card_images&&card.card_images[0],rarity=(set&&set.set_rarity)||"";
  const pid="yugioh:"+card.id+":"+normalizeSetCode(code)+":"+ygoSetId((set&&set.set_name)||"set")+":"+slug(rarity);
  return{
    id:pid,cardId:String(card.id),printingId:pid,game:"yugioh",name:card.name,
    number:code,collectionNumber:code,setId:ygoSetId((set&&set.set_name)||"set"),setCode:code,setName:(set&&set.set_name)||"",
    series:"",rarity:rarity,edition:(set&&set.set_edition)||"",
    image:"",imageHigh:"",imageRemote:img?img.image_url_small:"",
    archetype:card.archetype||"",passcode:String(card.id),type:card.type||"",attribute:card.attribute||"",
    level:card.level??null,rank:card.type&&card.type.includes("XYZ")?card.level??null:null,link:card.linkval??null,
    atk:card.atk??null,def:card.def??null,source:"YGOPRODeck",sourceId:YUGIOH_SOURCE_ID,
    price:set&&set.set_price?{source:"YGOPRODeck",currency:"USD",priceType:"set_price",value:Number(set.set_price),condition:null,timestamp:null,confidence:"MEDIA"}:null,
    raw:{card:card,set:set}
  };
}
export function normalizeYgoSet(s){
  return{game:"yugioh",id:ygoSetId(s.set_name),name:s.set_name,cardCount:s.num_of_cards,releaseDate:s.tcg_date,setCode:s.set_code,source:"YGOPRODeck"};
}
