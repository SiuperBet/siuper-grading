import{getAll,put,remove,byIndex}from"./db.js";
export function newId(prefix="id"){return prefix+":"+crypto.randomUUID()}
export async function ownedPrintingIds(){return new Set((await getAll("ownedCopies")).map(x=>x.printingId))}
export async function copiesFor(printingId){return byIndex("ownedCopies","printingId",printingId)}
export async function addCopy(card,extra={}){
  const row={id:newId("copy"),game:card.game,cardId:card.cardId,printingId:card.printingId,name:card.name,setName:card.setName||"",setCode:card.setCode||"",collectionNumber:card.collectionNumber||"",image:card.image||"",condition:extra.condition||"NM",language:extra.language||"it",variant:extra.variant||card.variant||"",pricePaid:extra.pricePaid==null?null:extra.pricePaid,notes:extra.notes||"",createdAt:new Date().toISOString()};
  await put("ownedCopies",row);return row;
}
export async function updateCopy(id,patch={}){
  const rows=await getAll("ownedCopies");
  const current=rows.find(x=>x.id===id);
  if(!current)throw new Error("Copia non trovata");
  const next={...current};
  for(const key of["condition","language","variant","pricePaid","notes"]){
    if(Object.prototype.hasOwnProperty.call(patch,key))next[key]=patch[key];
  }
  next.updatedAt=new Date().toISOString();
  await put("ownedCopies",next);
  return next;
}
export async function removeCopy(id){return remove("ownedCopies",id)}
export async function collectionStats(){
  const rows=await getAll("ownedCopies"),unique=new Set(rows.map(x=>x.printingId));
  return {copies:rows.length,unique:unique.size,pokemon:rows.filter(x=>x.game==="pokemon").length,yugioh:rows.filter(x=>x.game==="yugioh").length};
}
