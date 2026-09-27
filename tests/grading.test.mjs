import test from"node:test";
import assert from"node:assert/strict";
import{combineAnalyses,applyInspection,gradeability,gradingStatus,professionalInterval}from"../js/grading.js";

function side({grade=9,confidence=80,crease=false,warnings=[],geometry=80,reliability=.7,sourceSize={w:820,h:1148},quality={}}={}){
  return{
    centering:{score:grade,reliability},corners:{score:grade},edges:{score:grade},surface:{score:grade,creaseLikely:crease},
    appliedCap:null,defects:[],confidence,geometryConfidence:geometry,sourceSize,quality:{warnings,blurVariance:120,meanBrightness:130,glareRatio:.01,...quality}
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
test("un retro molto danneggiato pesa più della semplice media",()=>{
  const r=combineAnalyses(side({grade:9.5}),side({grade:4}));
  assert.ok(r.corners<6.75);assert.ok(r.edges<6.75);assert.ok(r.surface<6.75);
});
test("difetto grave confermato applica il cap manuale più severo",()=>{
  const r=applyInspection(combineAnalyses(side({grade:9.5}),side({grade:9.5})),{dent:true,tear:true});
  assert.equal(r.finalGrade,2);assert.equal(r.appliedCap,2);assert.equal(r.inspection.tear,true);assert.equal(r.inspection.dent,true);
  assert.ok(r.defects.some(x=>x.type==="manual:tear"));
});
test("controllo qualità blocca sfocatura e bassa risoluzione",()=>{
  const r=gradeability(side({sourceSize:{w:320,h:448},quality:{blurVariance:12}}));
  assert.equal(r.usable,false);assert.ok(r.blockers.includes("immagine troppo sfocata"));assert.ok(r.blockers.includes("risoluzione insufficiente"));
});
test("stato completo richiede fronte retro e segnali affidabili",()=>{
  const front=side({confidence:78}),back=side({confidence:78}),combined=combineAnalyses(front,back);
  assert.equal(gradingStatus(front,back,combined).code,"complete");
  assert.equal(gradingStatus(front,null,combineAnalyses(front,null)).code,"provisional");
  assert.equal(gradingStatus(front,side({reliability:.1}),combined).code,"assisted");
});
test("intervallo si restringe quando cresce la confidence",()=>{
  assert.equal(professionalInterval(9,40),null);
  const low=professionalInterval(9,50),high=professionalInterval(9,80);
  assert.ok(low[1]-low[0]>high[1]-high[0]);
});
