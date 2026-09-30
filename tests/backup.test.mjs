import assert from "node:assert/strict";
import test from "node:test";
import{blobToBackup,backupToBlob,prepareBackupImport}from"../js/db.js";
import{DB_SCHEMA_VERSION}from"../js/config.js";

function backupWithScans(scans){
  return{schemaVersion:DB_SCHEMA_VERSION,ownedCopies:[],scans,grades:[],settings:[],priceSnapshots:[]};
}

test("le foto Blob fanno andata e ritorno in base64",async()=>{
  const bytes=new Uint8Array([1,2,3,255,0,128]);
  const encoded=await blobToBackup(new Blob([bytes],{type:"image/jpeg"}));
  assert.equal(typeof encoded.data,"string");
  assert.equal(encoded.mime,"image/jpeg");
  const decoded=backupToBlob(JSON.parse(JSON.stringify(encoded)));
  assert.ok(decoded instanceof Blob);
  assert.equal(decoded.type,"image/jpeg");
  assert.deepEqual(new Uint8Array(await decoded.arrayBuffer()),bytes);
});

test("le foto grandi sopravvivono alla codifica a blocchi",async()=>{
  const bytes=new Uint8Array(150000);
  for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  const decoded=backupToBlob(await blobToBackup(new Blob([bytes],{type:"image/png"})));
  assert.deepEqual(new Uint8Array(await decoded.arrayBuffer()),bytes);
});

test("foto non valide non producono Blob",()=>{
  assert.equal(backupToBlob({}),null);
  assert.equal(backupToBlob(null),null);
  assert.equal(backupToBlob({__type:"blob-base64",mime:"image/jpeg",data:""}),null);
  assert.equal(backupToBlob({__type:"blob-base64",mime:"image/jpeg",data:"!!!non-base64!!!"}),null);
});

test("un backup senza foto valide non sostituisce le scansioni locali",()=>{
  const prepared=prepareBackupImport(backupWithScans([
    {id:"scan:1",createdAt:"2026-01-01T00:00:00.000Z",originalBlob:{},correctedBlob:{}}
  ]));
  assert.equal(prepared.replaceScans,false);
  assert.equal(prepared.data.scans.length,0);
});

test("un backup vuoto non sostituisce le scansioni locali",()=>{
  assert.equal(prepareBackupImport(backupWithScans([])).replaceScans,false);
});

test("un backup con foto valide sostituisce le scansioni e scarta quelle senza foto",async()=>{
  const photo=await blobToBackup(new Blob([new Uint8Array([9,8,7])],{type:"image/jpeg"}));
  const prepared=prepareBackupImport(backupWithScans([
    {id:"scan:ok",createdAt:"2026-01-01T00:00:00.000Z",originalBlob:photo,correctedBlob:photo},
    {id:"scan:vuota",createdAt:"2026-01-02T00:00:00.000Z",originalBlob:{},correctedBlob:{}}
  ]));
  assert.equal(prepared.replaceScans,true);
  assert.deepEqual(prepared.data.scans.map(s=>s.id),["scan:ok"]);
  assert.ok(prepared.data.scans[0].originalBlob instanceof Blob);
  assert.ok(prepared.data.scans[0].correctedBlob instanceof Blob);
});
