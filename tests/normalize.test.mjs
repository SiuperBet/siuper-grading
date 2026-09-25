import test from"node:test";
import assert from"node:assert/strict";
import{normalizeName,normalizeSetCode,normalizeSetCodeLoose,normalizeCollectionNumber,compareCardNumbers,scoreMatch}from"../js/normalize.js";

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

test("025 trova numero 25",()=>{
  const c={name:"Pikachu",collectionNumber:"25",printedTotal:165,setCode:"sv3pt5"};
  assert.ok(scoreMatch(c,"025")>=70);
});
test("4/102 usa anche il totale stampato",()=>{
  const base={name:"Charizard",collectionNumber:"4",printedTotal:102,setCode:"base1"};
  const other={name:"Altra",collectionNumber:"4",printedTotal:130,setCode:"x"};
  assert.ok(scoreMatch(base,"4/102")>scoreMatch(other,"4/102"));
});
test("LOB-001 e LOB-EN001 hanno alias storico compatibile",()=>{
  assert.equal(normalizeSetCodeLoose("LOB-001"),normalizeSetCodeLoose("LOB-EN001"));
  const c={name:"Blue-Eyes White Dragon",collectionNumber:"LOB-EN001",setCode:"LOB-EN001"};
  assert.ok(scoreMatch(c,"LOB-001")>=90);
});
