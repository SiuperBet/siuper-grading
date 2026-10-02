import assert from "node:assert/strict";
import test from "node:test";
import{getPricesForCard,resetPriceCache}from"../js/prices.js";

const card={printingId:"yugioh:test-1",game:"yugioh"};
const price={game:"yugioh",printingId:"yugioh:test-1",source:"Test",currency:"EUR",priceType:"market",variant:"",condition:null,value:1.5};
const originalFetch=globalThis.fetch;

test.afterEach(()=>{globalThis.fetch=originalFetch;resetPriceCache()});

test("un errore di rete su loadCurrent non resta in cache",async()=>{
  resetPriceCache();
  let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)throw new TypeError("offline");return{ok:true,status:200,json:async()=>[price]}};
  assert.deepEqual(await getPricesForCard(card),[]);
  const retry=await getPricesForCard(card);
  assert.equal(retry.length,1);
  assert.equal(calls,2);
});

test("una risposta HTTP non valida non resta in cache",async()=>{
  resetPriceCache();
  let calls=0;
  globalThis.fetch=async()=>{calls++;return calls===1?{ok:false,status:503,json:async()=>[]}:{ok:true,status:200,json:async()=>[price]}};
  assert.deepEqual(await getPricesForCard(card),[]);
  assert.equal((await getPricesForCard(card)).length,1);
});

test("una risposta valida viene messa in cache",async()=>{
  resetPriceCache();
  let calls=0;
  globalThis.fetch=async()=>{calls++;return{ok:true,status:200,json:async()=>[price]}};
  await getPricesForCard(card);
  await getPricesForCard(card);
  assert.equal(calls,1);
});
