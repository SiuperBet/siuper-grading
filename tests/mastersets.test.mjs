import test from"node:test";
import assert from"node:assert/strict";
import{canonicalVariant,variantKeys,progressForCards}from"../js/mastersets.js";

test("canonicalizza varianti equivalenti",()=>{
  assert.equal(canonicalVariant("Holofoil"),"holo");
  assert.equal(canonicalVariant("Reverse Holofoil"),"reverse");
  assert.equal(canonicalVariant("1st Edition"),"firstEdition");
});
test("slot varianti non confondono holo e reverse",()=>{
  const card={printingId:"p1",variants:{holo:true,reverse:true,normal:true}};
  const progress=progressForCards([card],[{printingId:"p1",variant:"Holofoil"}],"variants");
  assert.equal(progress.total,3);assert.equal(progress.owned,1);
});
test("progresso per numero conta una stampa una volta",()=>{
  const card={printingId:"p1",variants:{holo:true,reverse:true}};
  const progress=progressForCards([card],[{printingId:"p1",variant:"holo"},{printingId:"p1",variant:"reverse"}],"number");
  assert.equal(progress.total,1);assert.equal(progress.owned,1);
});
