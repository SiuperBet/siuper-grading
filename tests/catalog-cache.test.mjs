import assert from "node:assert/strict";
import test from "node:test";
import{getSearchIndex,resetSearchIndex}from"../js/catalog.js";

const originalFetch=globalThis.fetch;
const pokemonRow={printingId:"pokemon:a",game:"pokemon",name:"A"};
const yugiohRow={printingId:"yugioh:b",game:"yugioh",name:"B",cardId:1};

function mockFetch(state){
  return async url=>{
    state.calls++;
    if(state.offline)throw new TypeError("offline");
    const u=String(url);
    if(state.pokemonError&&u.endsWith("/data/pokemon/search-index.json"))return{ok:false,status:500,json:async()=>null};
    let body=null;
    if(u.endsWith("/data/pokemon/search-index.json"))body=[pokemonRow];
    else if(u.endsWith("/data/yugioh/search-index.json"))body=[yugiohRow];
    else if(u.endsWith("ocg-aliases.json"))body={aliases:{}};
    else if(/search-index\.json$/.test(u)&&!u.includes("ocg"))body=[];
    if(body===null)return{ok:false,status:404,json:async()=>null};
    return{ok:true,status:200,json:async()=>body};
  };
}

test.afterEach(()=>{globalThis.fetch=originalFetch;resetSearchIndex()});

test("un errore di rete su getSearchIndex non resta in cache",async()=>{
  resetSearchIndex();
  const state={offline:true,pokemonError:false,calls:0};
  globalThis.fetch=mockFetch(state);
  assert.deepEqual(await getSearchIndex(),[]);
  state.offline=false;
  const rows=await getSearchIndex();
  assert.equal(rows.length,2);
});

test("un indice principale non disponibile non resta in cache",async()=>{
  resetSearchIndex();
  const state={offline:false,pokemonError:true,calls:0};
  globalThis.fetch=mockFetch(state);
  assert.deepEqual((await getSearchIndex()).map(x=>x.printingId),["yugioh:b"]);
  state.pokemonError=false;
  assert.equal((await getSearchIndex()).length,2);
});

test("un indice completo viene messo in cache",async()=>{
  resetSearchIndex();
  const state={offline:false,pokemonError:false,calls:0};
  globalThis.fetch=mockFetch(state);
  await getSearchIndex();
  const callsAfterFirst=state.calls;
  await getSearchIndex();
  assert.equal(state.calls,callsAfterFirst);
});
