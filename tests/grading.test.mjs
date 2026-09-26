import test from"node:test";
import assert from"node:assert/strict";
import{combineAnalyses}from"../js/grading.js";

function side({grade=9,confidence=80,crease=false,warnings=[]}={}){
  return{
    centering:{score:grade},corners:{score:grade},edges:{score:grade},surface:{score:grade,creaseLikely:crease},
    appliedCap:null,defects:[],confidence,quality:{warnings}
  };
}
test("grading fronte singolo riduce la confidence",()=>{
  const r=combineAnalyses(side(),null);assert.ok(r.confidence<=68);assert.equal(r.finalGrade,9);
});
test("crease su fronte e retro applica cap severo",()=>{
  const r=combineAnalyses(side({grade:9.5,crease:true}),side({grade:9.5,crease:true}));
  assert.ok(r.finalGrade<=5.5);assert.equal(r.appliedCap,5.5);
});
test("foto con warning limita confidence",()=>{
  const r=combineAnalyses(side({warnings:["glare"]}),side());assert.ok(r.confidence<=42);
});
