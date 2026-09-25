let currentPromise;
async function loadCurrent(){
  if(!currentPromise)currentPromise=fetch("./data/prices/current.json",{cache:"no-cache"}).then(r=>r.ok?r.json():[]).catch(()=>[]);
  return currentPromise;
}
function validNumber(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null}
function normalizePokemonRuntime(card){
  const out=[],p=card.raw&&card.raw.pricing||card.pricing||{},strong=Boolean((card.raw&&card.raw.variants_detailed)||card.variants_detailed),confidence=strong?"ALTA":"MEDIA";
  const cm=p.cardmarket;
  if(cm){
    const cur=cm.unit||"EUR";
    for(const [k,v0]of Object.entries(cm)){
      if(k==="updated"||k==="unit")continue;const v=validNumber(v0);if(!v)continue;
      const holo=k.includes("-holo"),type=k.replace("-holo","");
      out.push({game:"pokemon",printingId:card.printingId,source:"Cardmarket",currency:cur,priceType:type,variant:holo?"holo":"normal",condition:null,value:v,timestamp:cm.updated||null,confidence:confidence});
    }
  }
  const tcg=p.tcgplayer;
  if(tcg){
    const cur=tcg.unit||"USD",map={lowPrice:"low",midPrice:"mid",highPrice:"high",marketPrice:"market",directLowPrice:"direct_low"};
    for(const [variant,obj]of Object.entries(tcg)){
      if(variant==="updated"||variant==="unit"||!obj||typeof obj!=="object")continue;
      for(const [field,type]of Object.entries(map)){const v=validNumber(obj[field]);if(v)out.push({game:"pokemon",printingId:card.printingId,source:"TCGPlayer",currency:cur,priceType:type,variant:variant,condition:null,value:v,timestamp:tcg.updated||null,confidence:confidence})}
    }
  }
  return out;
}
export async function getPricesForCard(card){
  const rows=(await loadCurrent()).filter(p=>p.printingId===card.printingId);
  const runtime=card.game==="pokemon"?normalizePokemonRuntime(card):(card.price?[card.price]:[]);
  const map=new Map();
  for(const p of rows.concat(runtime)){const k=[p.source,p.currency,p.priceType,p.variant||"",p.condition||""].join("|");map.set(k,p)}
  return [...map.values()].filter(p=>validNumber(p.value)).sort((a,b)=>a.currency.localeCompare(b.currency)||a.source.localeCompare(b.source)||a.priceType.localeCompare(b.priceType));
}
export function reliability(price){
  if(price.priceType==="estimated_condition")return"BASSA";
  if(!price.timestamp)return price.confidence||"MEDIA";
  const age=(Date.now()-new Date(price.timestamp).getTime())/86400000;
  if((price.confidence==="ALTA"||!price.confidence)&&age<=7)return"ALTA";
  if(age<=30)return"MEDIA";
  return"BASSA";
}
export function resetPriceCache(){currentPromise=null}

const PRICE_PRIORITY={market:1,trend:2,mid:3,set_price:4,low:5,average:6,high:7,direct_low:8};
export async function referencePricesForCards(cards,currency="EUR"){
  const current=await loadCurrent(),wanted=new Set(cards.map(c=>c.printingId)),groups=new Map();
  for(const p of current){
    if(!wanted.has(p.printingId)||p.currency!==currency||!validNumber(p.value))continue;
    if(!groups.has(p.printingId))groups.set(p.printingId,[]);
    groups.get(p.printingId).push(p);
  }
  const out=new Map();
  for(const card of cards){
    const rows=groups.get(card.printingId)||[];
    if(card.game==="pokemon")rows.push(...normalizePokemonRuntime(card).filter(p=>p.currency===currency));
    else if(card.price&&card.price.currency===currency)rows.push(card.price);
    rows.sort((a,b)=>(PRICE_PRIORITY[a.priceType]||99)-(PRICE_PRIORITY[b.priceType]||99));
    if(rows[0])out.set(card.printingId,rows[0]);
  }
  return out;
}
