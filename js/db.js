import{DB_NAME,DB_SCHEMA_VERSION}from"./config.js";
let dbPromise;
function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
export function openDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_SCHEMA_VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains("ownedCopies")){const s=db.createObjectStore("ownedCopies",{keyPath:"id"});s.createIndex("printingId","printingId");s.createIndex("game","game")}
      if(!db.objectStoreNames.contains("scans")){const s=db.createObjectStore("scans",{keyPath:"id"});s.createIndex("createdAt","createdAt")}
      if(!db.objectStoreNames.contains("grades")){const s=db.createObjectStore("grades",{keyPath:"id"});s.createIndex("cardId","cardId");s.createIndex("createdAt","createdAt")}
      if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings",{keyPath:"key"});
      if(!db.objectStoreNames.contains("catalogCache")){const s=db.createObjectStore("catalogCache",{keyPath:"key"});s.createIndex("expiresAt","expiresAt")}
      if(!db.objectStoreNames.contains("priceSnapshots")){const s=db.createObjectStore("priceSnapshots",{keyPath:"id"});s.createIndex("printingId","printingId")}
    };
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });return dbPromise;
}
async function store(name,mode="readonly"){const db=await openDB();return db.transaction(name,mode).objectStore(name)}
export async function get(storeName,key){return req((await store(storeName)).get(key))}
export async function getAll(storeName){return req((await store(storeName)).getAll())}
export async function put(storeName,value){return req((await store(storeName,"readwrite")).put(value))}
export async function remove(storeName,key){return req((await store(storeName,"readwrite")).delete(key))}
export async function clear(storeName){return req((await store(storeName,"readwrite")).clear())}
export async function byIndex(storeName,index,key){return req((await store(storeName)).index(index).getAll(key))}
export async function cacheGet(key){const v=await get("catalogCache",key);if(!v||v.expiresAt<Date.now())return null;return v.value}
export async function cachePut(key,value,ttl=86400000){return put("catalogCache",{key,value,expiresAt:Date.now()+ttl,updatedAt:new Date().toISOString()})}
export async function setting(key,fallback=null){return (await get("settings",key))?.value??fallback}
export async function setSetting(key,value){return put("settings",{key,value})}

const BACKUP_STORES=["ownedCopies","scans","grades","settings","priceSnapshots"];
const PHOTO_FIELDS=["originalBlob","correctedBlob"];
const BLOB_TYPE="blob-base64";

function bytesToBase64(bytes){
  let binary="";
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
export async function blobToBackup(blob){
  return{__type:BLOB_TYPE,mime:blob.type||"application/octet-stream",data:bytesToBase64(new Uint8Array(await blob.arrayBuffer()))};
}
export function backupToBlob(value){
  if(typeof Blob!=="undefined"&&value instanceof Blob)return value.size>0?value:null;
  if(!value||value.__type!==BLOB_TYPE||typeof value.data!=="string"||!value.data)return null;
  try{
    const binary=atob(value.data),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const blob=new Blob([bytes],{type:typeof value.mime==="string"?value.mime:""});
    return blob.size>0?blob:null;
  }catch(e){return null}
}
async function scanToBackup(scan){
  const out={...scan};
  for(const field of PHOTO_FIELDS){
    if(typeof Blob!=="undefined"&&scan[field] instanceof Blob)out[field]=await blobToBackup(scan[field]);
    else delete out[field];
  }
  return out;
}
export async function exportBackup(){
  const scans=await getAll("scans");
  return {schemaVersion:DB_SCHEMA_VERSION,exportedAt:new Date().toISOString(),photoEncoding:"base64",ownedCopies:await getAll("ownedCopies"),scans:await Promise.all(scans.map(scanToBackup)),grades:await getAll("grades"),settings:await getAll("settings"),priceSnapshots:await getAll("priceSnapshots")};
}
export function validateBackup(payload){
  if(!payload||typeof payload!=="object")throw new Error("Backup non valido");
  if(payload.schemaVersion!==DB_SCHEMA_VERSION)throw new Error("Versione backup non compatibile");
  for(const name of BACKUP_STORES){
    if(payload[name]!=null&&!Array.isArray(payload[name]))throw new Error("Sezione "+name+" non valida");
  }
  for(const row of payload.ownedCopies||[]){if(!row||!row.id||!row.printingId||!row.game)throw new Error("Copia posseduta non valida")}
  for(const row of payload.scans||[]){if(!row||!row.id||!row.createdAt)throw new Error("Scansione non valida")}
  for(const row of payload.grades||[]){if(!row||!row.id||!row.createdAt||!Number.isFinite(Number(row.finalGrade)))throw new Error("Grading non valido")}
  for(const row of payload.settings||[]){if(!row||typeof row.key!=="string")throw new Error("Impostazione non valida")}
  return true;
}
// Valida e decodifica il backup prima di aprire la transazione: le transazioni IndexedDB
// si chiudono da sole se nel mezzo si attende qualcosa che non sia una richiesta IndexedDB.
export function prepareBackupImport(payload){
  validateBackup(payload);
  const data={};
  for(const name of BACKUP_STORES)data[name]=payload[name]||[];
  const scans=[];
  for(const row of data.scans){
    const scan={...row};
    for(const field of PHOTO_FIELDS){
      const blob=backupToBlob(row[field]);
      if(blob)scan[field]=blob;else delete scan[field];
    }
    if(scan.originalBlob||scan.correctedBlob)scans.push(scan);
  }
  data.scans=scans;
  return{data,replaceScans:scans.length>0,scansInBackup:(payload.scans||[]).length,validScans:scans.length};
}
export async function importBackup(payload){
  const prepared=prepareBackupImport(payload),{data,replaceScans}=prepared;
  const names=BACKUP_STORES.filter(name=>name!=="scans"||replaceScans);
  const db=await openDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(names,"readwrite");
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error("Import backup non riuscito"));
    tx.onabort=()=>reject(tx.error||new Error("Import backup annullato"));
    try{
      for(const name of names){
        const objectStore=tx.objectStore(name);
        objectStore.clear();
        for(const row of data[name])objectStore.put(row);
      }
    }catch(e){
      try{tx.abort()}catch(err){}
      reject(e);
    }
  });
  return{scansReplaced:replaceScans,scansInBackup:prepared.scansInBackup,validScans:prepared.validScans};
}
