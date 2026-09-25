let customPromise;
export async function getCustomMasterSets(){
  if(!customPromise)customPromise=fetch("./data/master-sets/custom.json",{cache:"no-cache"}).then(r=>r.ok?r.json():{masterSets:[]}).then(x=>Array.isArray(x.masterSets)?x.masterSets:[]).catch(()=>[]);
  return customPromise;
}
export function variantKeys(card){
  const v=card&&card.variants;
  if(!v||typeof v!=="object")return["base"];
  const keys=Object.entries(v).filter(([,enabled])=>Boolean(enabled)).map(([key])=>key);
  return keys.length?keys:["base"];
}
export function masterSlotsForCards(cards,mode="number"){
  if(mode!=="variants")return cards.map(card=>({slotId:card.printingId,card:card,variant:null}));
  return cards.flatMap(card=>variantKeys(card).map(variant=>({slotId:card.printingId+"::"+variant,card:card,variant:variant})));
}
export function progressForCards(cards,ownedCopies,mode="number"){
  const copies=Array.isArray(ownedCopies)?ownedCopies:[];
  const byPrinting=new Map();
  for(const cp of copies){if(!byPrinting.has(cp.printingId))byPrinting.set(cp.printingId,[]);byPrinting.get(cp.printingId).push(cp)}
  const slots=masterSlotsForCards(cards,mode);
  let owned=0;
  for(const slot of slots){
    const cps=byPrinting.get(slot.card.printingId)||[];
    if(mode==="number"){if(cps.length)owned++}
    else if(cps.some(cp=>(cp.variant||"base").toLowerCase()===(slot.variant||"base").toLowerCase()))owned++;
  }
  return {owned:owned,total:slots.length,missing:Math.max(0,slots.length-owned),percent:slots.length?owned/slots.length*100:0,slots:slots};
}
export function progressForCustom(masterSet,ownedCopies){
  if(!masterSet||!Array.isArray(masterSet.slots)||!masterSet.slots.length)return{owned:0,total:masterSet&&masterSet.expectedSlots||0,missing:masterSet&&masterSet.expectedSlots||0,percent:0,mapped:false};
  const copies=Array.isArray(ownedCopies)?ownedCopies:[],ids=new Set(copies.map(x=>x.printingId+(x.variant?"::"+x.variant:"")));
  let owned=0;
  for(const slot of masterSet.slots){const key=slot.printingId+(slot.variant?"::"+slot.variant:"");if(ids.has(key)||(!slot.variant&&copies.some(x=>x.printingId===slot.printingId)))owned++}
  return{owned:owned,total:masterSet.slots.length,missing:masterSet.slots.length-owned,percent:masterSet.slots.length?owned/masterSet.slots.length*100:0,mapped:true};
}
