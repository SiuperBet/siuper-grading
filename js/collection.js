import{getAll,put,remove,byIndex,setting,setSetting}from"./db.js";
import{normalizeCondition,UNSPECIFIED_CONDITION}from"./conditions.js";
import{COPY_DATA_VERSION,migrateCopyRow}from"./copy-model.js";
export function newId(prefix="id"){return prefix+":"+crypto.randomUUID()}
export async function ownedPrintingIds(){return new Set((await getAll("ownedCopies")).map(x=>x.printingId))}
export async function copiesFor(printingId){return(await byIndex("ownedCopies","printingId",printingId)).map(migrateCopyRow)}
export async function listCopies(){return(await getAll("ownedCopies")).map(migrateCopyRow)}

// Ogni riga di ownedCopies è UNA singola copia fisica, con la sua condizione.
// La condizione è obbligatoria: va scelta (anche "Non specificata", esplicitamente) prima del salvataggio.
export async function addCopy(card,extra={}){
  if(extra.condition==null||String(extra.condition).trim()==="")throw new Error("Scegli la condizione della copia (oppure “Non specificata”).");
  const normalized=normalizeCondition(extra.condition);
  const row={id:newId("copy"),dataVersion:COPY_DATA_VERSION,game:card.game,cardId:card.cardId,printingId:card.printingId,name:card.name,setName:card.setName||"",setCode:card.setCode||"",collectionNumber:card.collectionNumber||"",image:card.image||"",imageHigh:card.imageHigh||"",imageCandidates:Array.isArray(card.imageCandidates)?card.imageCandidates:[],seriesId:card.seriesId||"",
    condition:normalized.code,
    conditionSource:extra.conditionSource||(normalized.original&&normalized.original!==normalized.code?normalized.original:null),
    conditionConfirmed:true,
    conditionSuggestion:extra.conditionSuggestion||null,
    gradingId:extra.gradingId||null,
    gradeValue:extra.gradeValue==null?null:Number(extra.gradeValue),
    gradeConfidence:extra.gradeConfidence==null?null:Number(extra.gradeConfidence),
    language:extra.language||card.catalogLanguage||card.language||(card.game==="yugioh"?"tcg":"it"),variant:Object.prototype.hasOwnProperty.call(extra,"variant")?extra.variant:(card.variant||((card.variants&&card.variants.normal)?"normal":"")),pricePaid:extra.pricePaid==null?null:extra.pricePaid,notes:extra.notes||"",createdAt:new Date().toISOString()};
  await put("ownedCopies",row);return row;
}
const EDITABLE=["condition","language","variant","pricePaid","notes","gradingId","gradeValue","gradeConfidence"];
export async function updateCopy(id,patch={}){
  const rows=await getAll("ownedCopies");
  const found=rows.find(x=>x.id===id);
  if(!found)throw new Error("Copia non trovata");
  const next={...migrateCopyRow(found)};
  for(const key of EDITABLE){
    if(Object.prototype.hasOwnProperty.call(patch,key))next[key]=patch[key];
  }
  if(Object.prototype.hasOwnProperty.call(patch,"condition")){
    const normalized=normalizeCondition(patch.condition);
    next.condition=normalized.code;
    next.conditionConfirmed=true;
    if(normalized.original&&normalized.original!==normalized.code)next.conditionSource=normalized.original;
  }
  next.updatedAt=new Date().toISOString();
  await put("ownedCopies",next);
  return next;
}
export async function removeCopy(id){return remove("ownedCopies",id)}

// Migra in modo sicuro le copie salvate con lo schema precedente. Idempotente: se non c'è nulla da
// migrare non scrive niente. Non cancella e non assegna Near Mint alle copie senza condizione.
export async function migrateCollection(){
  const rows=await getAll("ownedCopies");let changed=0;
  for(const row of rows){
    const next=migrateCopyRow(row);
    if(next!==row){await put("ownedCopies",next);changed++}
  }
  return{total:rows.length,migrated:changed};
}
export async function collectionStats(){
  const rows=await getAll("ownedCopies"),unique=new Set(rows.map(x=>x.printingId));
  return {copies:rows.length,unique:unique.size,pokemon:rows.filter(x=>x.game==="pokemon").length,yugioh:rows.filter(x=>x.game==="yugioh").length};
}
// Storico del valore della collezione: una voce per giorno e valuta, i giorni precedenti restano.
export async function loadValueHistory(currency){return(await setting("collectionValueHistory:"+currency,[]))||[]}
export async function saveValueHistory(currency,rows){return setSetting("collectionValueHistory:"+currency,rows)}
export{UNSPECIFIED_CONDITION};
