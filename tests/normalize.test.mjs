import test from"node:test";
import assert from"node:assert/strict";
import{normalizeName,normalizeSetCode,normalizeCollectionNumber,compareCardNumbers,scoreMatch}from"../js/normalize.js";

test("normalizza nome case e accenti",()=>{assert.equal(normalizeName("  Pokémon   Élite  "),"pokemon elite")});
test("normalizza numero Pokemon completo",()=>{assert.equal(normalizeCollectionNumber(" TG01 / TG30 "),"TG01/TG30")});
test("normalizza promo Pokemon",()=>{assert.equal(normalizeCollectionNumber("SWSH001"),"SWSH001")});
test("normalizza set code Yu-Gi-Oh senza trattino",()=>{assert.equal(normalizeSetCode("lob-en001"),"LOBEN001")});
test("ricerca numero esatto pesa più del nome parziale",()=>{
  const exact={name:"Altra carta",collectionNumber:"4/102",setCode:"base1"};
  const byName={name:"Charizard",collectionNumber:"99/102",setCode:"base1"};
  assert.ok(scoreMatch(exact,"4/102")>scoreMatch(byName,"4/102"));
});
test("ricerca set code Yu-Gi-Oh case insensitive e senza trattino",()=>{
  const c={name:"Blue-Eyes White Dragon",collectionNumber:"LOB-EN001",setCode:"LOB-EN001"};
  assert.ok(scoreMatch(c,"loben001")>=100);
});
test("ordinamento numerico non alfabetico",()=>{
  const xs=["11","2","10","1"].sort(compareCardNumbers);
  assert.deepEqual(xs,["1","2","10","11"]);
});
test("ordinamento prefissi numerici",()=>{
  const xs=["TG10","TG02","TG01","SV49"].sort(compareCardNumbers);
  assert.deepEqual(xs,["SV49","TG01","TG02","TG10"]);
});
