let customPromise;
export async function getCustomMasterSets(){
  if(!customPromise)customPromise=fetch("./data/master-sets/custom.json",{cache:"no-cache"}).then(r=>r.ok?r.json():{masterSets:[]}).then(x=>Array.isArray(x.masterSets)?x.masterSets:[]).catch(()=>[]);
  return customPromise;
}
export function canonicalVariant(value=""){
  const raw=String(value||"").trim().toLowerCase().replace(/[_\s-]+/g,"");
  const map={base:"base",normal:"normal",regular:"normal",standard:"normal",holo:"holo",holofoil:"holo",foil:"holo",reverse:"reverse",reverseholo:"reverse",reverseholofoil:"reverse",firstedition:"firstEdition",first:"firstEdition",unlimited:"unlimited",promo:"promo",wfoil:"wFoil"};
  return map[raw]||raw||"base";
}
function variantEntries(card){
  const rows=[];
  const add=(key,val)=>{
    if(val===false||val==null)return;
    if(typeof val==="object"&&Object.prototype.hasOwnProperty.call(val,"available")&&!val.available)return;
    const v=canonicalVariant(key);if(v&&!rows.includes(v))rows.push(v);
  };
  const v=card&&card.variants;if(v&&typeof v==="object")for(const[key,val]of Object.entries(v))add(key,val);
  const vd=card&&(card.variantsDetailed||card.variants_detailed);if(vd&&typeof vd==="object")for(const[key,val]of Object.entries(vd))add(key,val);
  return rows;
}
export function variantKeys(card){
  const keys=variantEntries(card);
  if(!keys.length)return["base"];
  if(keys.includes("base")&&keys.length>1)return keys.filter(x=>x!=="base");
  return keys;
}
export function masterSlotsForCards(cards,mode="number"){
  if(mode!=="variants")return cards.map(card=>({slotId:card.printingId,card,variant:null}));
  return cards.flatMap(card=>variantKeys(card).map(variant=>({slotId:card.printingId+"::"+variant,card,variant})));
}
export function progressForCards(cards,ownedCopies,mode="number"){
  const copies=Array.isArray(ownedCopies)?ownedCopies:[],byPrinting=new Map();
  for(const cp of copies){if(!byPrinting.has(cp.printingId))byPrinting.set(cp.printingId,[]);byPrinting.get(cp.printingId).push(cp)}
  const slots=masterSlotsForCards(cards,mode);let owned=0;
  for(const slot of slots){
    const cps=byPrinting.get(slot.card.printingId)||[];
    if(mode==="number"){if(cps.length)owned++}
    else if(cps.some(cp=>canonicalVariant(cp.variant||"base")===canonicalVariant(slot.variant||"base")))owned++;
  }
  return{owned,total:slots.length,missing:Math.max(0,slots.length-owned),percent:slots.length?owned/slots.length*100:0,slots};
}
export function progressForCustom(masterSet,ownedCopies){
  if(!masterSet||!Array.isArray(masterSet.slots)||!masterSet.slots.length)return{owned:0,total:masterSet&&masterSet.expectedSlots||0,missing:masterSet&&masterSet.expectedSlots||0,percent:0,mapped:false};
  const copies=Array.isArray(ownedCopies)?ownedCopies:[];let owned=0;
  for(const slot of masterSet.slots){
    if(copies.some(x=>x.printingId===slot.printingId&&(!slot.variant||canonicalVariant(x.variant||"base")===canonicalVariant(slot.variant))))owned++;
  }
  return{owned,total:masterSet.slots.length,missing:masterSet.slots.length-owned,percent:masterSet.slots.length?owned/masterSet.slots.length*100:0,mapped:true};
}
