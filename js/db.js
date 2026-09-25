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
export async function exportBackup(){
  return {schemaVersion:DB_SCHEMA_VERSION,exportedAt:new Date().toISOString(),ownedCopies:await getAll("ownedCopies"),scans:await getAll("scans"),grades:await getAll("grades"),settings:await getAll("settings"),priceSnapshots:await getAll("priceSnapshots")};
}
export async function importBackup(payload){
  if(!payload||payload.schemaVersion!==DB_SCHEMA_VERSION)throw new Error("Versione backup non compatibile");
  for(const name of["ownedCopies","scans","grades","settings","priceSnapshots"]){
    if(!Array.isArray(payload[name]))continue;
    await clear(name);
    for(const row of payload[name])await put(name,row);
  }
}
