import assert from "node:assert/strict";
import test from "node:test";
import{normalizeCondition,conditionCoefficient,conditionRank,suggestCondition,CONDITIONS,UNSPECIFIED_CONDITION}from"../js/conditions.js";
import{migrateCopyRow,COPY_DATA_VERSION}from"../js/copy-model.js";

test("la scala contiene tutte le condizioni richieste, in ordine dal migliore",()=>{
  assert.deepEqual(CONDITIONS.map(c=>c.code),["M","NM","EX","LP","MP","PL","HP","PR","DMG"]);
  assert.ok(conditionRank("M")<conditionRank("NM"));
  assert.ok(conditionRank("PR")<conditionRank("DMG"));
});

test("i termini delle fonti vengono ricondotti alla scala interna",()=>{
  const cases={"Near Mint":"NM","NM-Mint":"NM","Mint":"M","Excellent":"EX","Lightly Played":"LP","Light Played":"LP","Moderately Played":"MP","Played":"PL","Heavily Played":"HP","Poor":"PR","Damaged":"DMG","DAMAGED":"DMG","DMG":"DMG"};
  for(const [source,code] of Object.entries(cases))assert.equal(normalizeCondition(source).code,code,source);
});

test("il termine originale non si perde e i termini approssimati sono segnalati",()=>{
  const good=normalizeCondition("Good");
  assert.equal(good.code,"LP");
  assert.equal(good.original,"Good");
  assert.equal(good.approximate,true);
  assert.equal(normalizeCondition("Near Mint").approximate,false);
});

test("una condizione mancante o sconosciuta diventa Non specificata, mai Near Mint",()=>{
  for(const value of[null,undefined,"","   ","boh"])assert.equal(normalizeCondition(value).code,UNSPECIFIED_CONDITION);
});

test("i coefficienti sono centralizzati e Near Mint vale 100%",()=>{
  assert.deepEqual(conditionCoefficient("NM"),{low:1,high:1,mid:1});
  const lp=conditionCoefficient("LP");
  assert.equal(lp.low,0.70);assert.equal(lp.high,0.85);
  assert.ok(Math.abs(lp.mid-0.775)<1e-9);
  assert.equal(conditionCoefficient("NS"),null);
});

test("il grading suggerisce una condizione ma voto e condizione restano distinti",()=>{
  const nm=suggestCondition({finalGrade:8.8,confidence:84});
  assert.equal(nm.code,"NM");assert.equal(nm.confidence,84);assert.equal(nm.grade,8.8);
  assert.equal(suggestCondition({finalGrade:9.9,confidence:80}).code,"M");
  assert.equal(suggestCondition({finalGrade:7,confidence:70}).code,"LP");
  assert.equal(suggestCondition({finalGrade:1,confidence:60}).code,"DMG");
  assert.equal(suggestCondition(null),null);
});

test("vicino al confine tra due fasce la confidence della stima cala",()=>{
  const edge=suggestCondition({finalGrade:8.55,confidence:84}),centre=suggestCondition({finalGrade:9,confidence:84});
  assert.ok(edge.confidence<centre.confidence);
});

test("la migrazione non assegna Near Mint alle copie senza condizione",()=>{
  const row=migrateCopyRow({id:"c1",printingId:"p",game:"pokemon"});
  assert.equal(row.condition,"NS");assert.equal(row.conditionConfirmed,false);assert.equal(row.dataVersion,COPY_DATA_VERSION);
});

test("le vecchie copie NM restano NM ma vanno confermate",()=>{
  const row=migrateCopyRow({id:"c1",printingId:"p",game:"pokemon",condition:"NM"});
  assert.equal(row.condition,"NM");assert.equal(row.conditionConfirmed,false);
});

test("le vecchie copie con un'altra condizione restano confermate e il termine originale si conserva",()=>{
  const lp=migrateCopyRow({id:"c2",printingId:"p",game:"pokemon",condition:"LP"});
  assert.equal(lp.condition,"LP");assert.equal(lp.conditionConfirmed,true);assert.equal(lp.conditionSource,undefined);
  const dmg=migrateCopyRow({id:"c3",printingId:"p",game:"pokemon",condition:"DAMAGED"});
  assert.equal(dmg.condition,"DMG");assert.equal(dmg.conditionSource,"DAMAGED");assert.equal(dmg.conditionConfirmed,true);
});

test("la migrazione è idempotente e conserva gli altri campi",()=>{
  const original={id:"c4",printingId:"p",game:"yugioh",condition:"MP",pricePaid:3.5,notes:"ok"};
  const once=migrateCopyRow(original),twice=migrateCopyRow(once);
  assert.equal(twice,once);
  assert.equal(once.pricePaid,3.5);assert.equal(once.notes,"ok");assert.equal(original.dataVersion,undefined);
  assert.equal(migrateCopyRow(null),null);
});
