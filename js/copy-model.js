import{normalizeCondition,UNSPECIFIED_CONDITION,CONDITION_CODES}from"./conditions.js";

// Versione dello schema delle singole copie (righe di ownedCopies). Non è la versione di IndexedDB:
// le copie vengono migrate al volo, senza upgrade del database e senza perdere dati.
export const COPY_DATA_VERSION=2;

// Migrazione sicura e idempotente di una copia salvata (database locale o file di backup).
// - non assegna mai Near Mint "a caso": se la condizione manca diventa "Non specificata";
// - le vecchie copie con NM erano quasi certamente il valore predefinito: restano NM ma vanno confermate;
// - il termine originale della condizione resta in conditionSource.
export function migrateCopyRow(row){
  if(!row||typeof row!=="object")return row;
  if(row.dataVersion>=COPY_DATA_VERSION&&CONDITION_CODES.has(row.condition)&&typeof row.conditionConfirmed==="boolean")return row;
  const raw=row.condition,normalized=normalizeCondition(raw),next={...row},legacy=row.dataVersion==null;
  next.condition=normalized.code;
  if(raw!=null&&String(raw).trim()!==""&&String(raw)!==normalized.code&&next.conditionSource==null)next.conditionSource=String(raw);
  if(typeof next.conditionConfirmed!=="boolean"){
    if(!legacy)next.conditionConfirmed=true;
    else if(raw==null||String(raw).trim()==="")next.conditionConfirmed=false;
    else next.conditionConfirmed=!(normalized.code==="NM");
  }
  if(next.condition===UNSPECIFIED_CONDITION&&legacy&&(raw==null||String(raw).trim()===""))next.conditionConfirmed=false;
  next.dataVersion=COPY_DATA_VERSION;
  return next;
}
export function copyNeedsMigration(row){
  return Boolean(row)&&typeof row==="object"&&migrateCopyRow(row)!==row;
}
