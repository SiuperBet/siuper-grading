import assert from "node:assert/strict";
import test from "node:test";
import{valueCopy,summarizeCollection,snapshotFromSummary,mergeSnapshot}from"../js/valuation.js";

const near=(a,b)=>Math.abs(a-b)<1e-9;
const price=(over)=>Object.assign({source:"Test",currency:"EUR",priceType:"market",variant:"normal",condition:null,value:10,confidence:"MEDIA"},over);

test("usa il prezzo reale della stessa condizione quando esiste",()=>{
  const rows=[price({condition:"LP",value:15}),price({condition:"NM",value:20})];
  const v=valueCopy({id:"c1",condition:"LP",variant:"normal"},rows,"EUR");
  assert.equal(v.kind,"exact");assert.equal(v.value,15);assert.equal(v.priceCondition,"LP");
});

test("senza prezzo esatto usa una condizione vicina e lo dichiara derivato",()=>{
  const v=valueCopy({id:"c1",condition:"EX",variant:"normal"},[price({condition:"NM",value:20})],"EUR");
  assert.equal(v.kind,"nearby");assert.equal(v.value,20);assert.equal(v.priceCondition,"NM");
});

test("solo come ultima risorsa applica il coefficiente di condizione al riferimento",()=>{
  const rows=[price({condition:null,value:40})];
  const mp=valueCopy({id:"c1",condition:"MP"},rows,"EUR");
  assert.equal(mp.kind,"estimated");assert.ok(near(mp.value,24));assert.ok(mp.coefficient&&near(mp.coefficient.mid,0.6));
  assert.equal(mp.referenceValue,40);
  const nm=valueCopy({id:"c2",condition:"NM"},rows,"EUR");
  assert.equal(nm.kind,"estimated");assert.equal(nm.value,40);
});

test("una copia con condizione non specificata non viene valutata",()=>{
  const v=valueCopy({id:"c1",condition:"NS"},[price({condition:null,value:40})],"EUR");
  assert.equal(v.kind,"unrated");assert.equal(v.value,null);assert.equal(v.referenceValue,40);
});

test("le valute non vengono mai mescolate",()=>{
  const v=valueCopy({id:"c1",condition:"NM"},[price({currency:"USD",value:50})],"EUR");
  assert.equal(v.kind,"none");assert.equal(v.value,null);
});

test("non usa il prezzo di un'altra variante",()=>{
  const v=valueCopy({id:"c1",condition:"NM",variant:"holo"},[price({variant:"normal",value:5})],"EUR");
  assert.equal(v.kind,"none");
});

test("il totale somma ogni singola copia con la sua condizione, non 3 x Near Mint",()=>{
  const byPrinting=new Map([
    ["p1",[price({condition:"NM",value:20}),price({condition:"LP",value:15})]],
    ["p2",[price({condition:null,value:20,variant:""})]]
  ]);
  const copies=[
    {id:"a",printingId:"p1",game:"pokemon",condition:"NM",variant:"normal"},
    {id:"b",printingId:"p1",game:"pokemon",condition:"LP",variant:"normal",gradeValue:8,gradingId:"g1"},
    {id:"c",printingId:"p2",game:"yugioh",condition:"MP"},
    {id:"d",printingId:"p2",game:"yugioh",condition:"NS"}
  ];
  const s=summarizeCollection(copies,byPrinting,"EUR");
  assert.equal(s.total,47);
  assert.equal(s.copies,4);assert.equal(s.valuedCopies,3);
  assert.equal(s.byGame.pokemon.value,35);assert.equal(s.byGame.yugioh.value,12);
  assert.equal(s.byCondition.NM.copies,1);assert.equal(s.byCondition.LP.value,15);
  assert.deepEqual({exact:s.kinds.exact,estimated:s.kinds.estimated,unrated:s.kinds.unrated},{exact:2,estimated:1,unrated:1});
  assert.deepEqual(s.unreliable,["d"]);
  assert.equal(s.graded.copies,1);assert.equal(s.graded.value,15);assert.equal(s.graded.averageGrade,8);
});

test("cambiando la condizione cambia il valore della copia",()=>{
  const rows=[price({condition:"NM",value:20}),price({condition:"HP",value:4})];
  assert.equal(valueCopy({id:"c",condition:"NM"},rows,"EUR").value,20);
  assert.equal(valueCopy({id:"c",condition:"HP"},rows,"EUR").value,4);
});

test("gli snapshot giornalieri si aggiornano per giorno senza perdere i precedenti",()=>{
  const s=summarizeCollection([{id:"a",printingId:"p1",game:"pokemon",condition:"NM"}],new Map([["p1",[price({condition:"NM",value:20})]]]),"EUR");
  const day1=snapshotFromSummary(s,new Date("2026-10-01T10:00:00Z")),day2=snapshotFromSummary(s,new Date("2026-10-02T10:00:00Z"));
  let history=mergeSnapshot([],day1);
  history=mergeSnapshot(history,day2);
  history=mergeSnapshot(history,Object.assign({},day2,{total:99}));
  assert.deepEqual(history.map(x=>x.date),["2026-10-01","2026-10-02"]);
  assert.equal(history[1].total,99);assert.equal(history[0].total,20);
});
