import{mkdir,readFile,writeFile,rename,rm}from"node:fs/promises";
import{createWriteStream}from"node:fs";
import{Readable}from"node:stream";
import{pipeline}from"node:stream/promises";
import{execFile}from"node:child_process";
import{promisify}from"node:util";
import path from"node:path";

const execFileAsync=promisify(execFile),START="2024-02-08",BATCH=Math.max(1,Number(process.env.TCGCSV_BACKFILL_BATCH||3)),ROOT="data/prices/tcgcsv-history",TMP=".tmp-tcgcsv-history",UA="siuper-grading-history-backfill/1.0";
const iso=d=>d.toISOString().slice(0,10),dayMs=86400000;
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,"utf8"))}catch{return fallback}}
async function atomicJson(file,data){await mkdir(path.dirname(file),{recursive:true});const tmp=file+".tmp";await writeFile(tmp,JSON.stringify(data)+"\n");await rename(tmp,file)}
function targetDates(){
  const today=new Date(),end=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-1)),start=new Date(START+"T00:00:00Z"),yearAgo=new Date(end.getTime()-365*dayMs),set=new Set([START,iso(end)]);
  for(let d=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,15));d<yearAgo;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,15)))set.add(iso(d));
  for(let d=new Date(yearAgo);d<=end;d=new Date(d.getTime()+7*dayMs))set.add(iso(d));
  return[...set].filter(x=>x>=START&&x<=iso(end)).sort();
}
async function download(url,file){
  await mkdir(path.dirname(file),{recursive:true});
  await execFileAsync("curl",["-fL","--retry","4","--retry-delay","2","--connect-timeout","20","-A","Mozilla/5.0 SiuperGrading/1.0",url,"-o",file],{maxBuffer:1024*1024*4});
}
function num(v){const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function cleanVariant(v=""){return String(v).trim()||"Unknown"}

const map=await readJson("data/prices/tcgcsv-map.json",null);if(!map||!Array.isArray(map.cards)||!map.cards.length)throw new Error("TCGCSV mapping not available");
const byGroup=new Map();
for(const c of map.cards){const g=String(c.groupId),p=Number(c.productId);if(!byGroup.has(g))byGroup.set(g,new Set());byGroup.get(g).add(p)}
const state=await readJson(ROOT+"/state.json",{version:1,completed:[],failed:{}}),datesDoc=await readJson(ROOT+"/dates.json",{version:1,source:"TCGCSV / TCGplayer",currency:"USD",dates:[]}),targets=targetDates(),done=new Set(state.completed||[]),todo=targets.filter(x=>!done.has(x)).slice(0,BATCH);
let processed=0,priceRows=0;
await mkdir(ROOT+"/groups",{recursive:true});await rm(TMP,{recursive:true,force:true});await mkdir(TMP,{recursive:true});

for(const date of todo){
  const archive=TMP+"/prices-"+date+".ppmd.7z",outDir=TMP+"/extract-"+date;
  try{
    await download("https://tcgcsv.com/archive/tcgplayer/prices-"+date+".ppmd.7z",archive);
    await mkdir(outDir,{recursive:true});
    await execFileAsync("7z",["x",archive,"-o"+outDir,date+"/3/*","-r","-y"],{maxBuffer:1024*1024*4});
    const dateIndex=datesDoc.dates.length;
    for(const[g,products]of byGroup){
      const priceFile=outDir+"/"+date+"/3/"+g+"/prices",payload=await readJson(priceFile,null);if(!payload||!Array.isArray(payload.results))continue;
      const matched=payload.results.filter(r=>products.has(Number(r.productId)));if(!matched.length)continue;
      const groupFile=ROOT+"/groups/"+g+".json",doc=await readJson(groupFile,{version:1,groupId:Number(g),currency:"USD",series:{}});
      for(const r of matched){
        const key=String(r.productId)+"|"+cleanVariant(r.subTypeName),arr=doc.series[key]||(doc.series[key]=[]),point=[dateIndex,num(r.marketPrice),num(r.lowPrice),num(r.midPrice),num(r.directLowPrice)];
        const at=arr.findIndex(x=>x[0]===dateIndex);if(at>=0)arr[at]=point;else arr.push(point);priceRows++;
      }
      await atomicJson(groupFile,doc);
    }
    datesDoc.dates.push(date);state.completed.push(date);delete state.failed[date];processed++;
    await atomicJson(ROOT+"/dates.json",datesDoc);await atomicJson(ROOT+"/state.json",state);
  }catch(e){
    state.failed[date]={message:e.message,at:new Date().toISOString(),attempts:Number(state.failed[date]&&state.failed[date].attempts||0)+1};
    await atomicJson(ROOT+"/state.json",state);console.error("Backfill failed",date,e.message);
  }finally{await rm(archive,{force:true}).catch(()=>{});await rm(outDir,{recursive:true,force:true}).catch(()=>{})}
}
await rm(TMP,{recursive:true,force:true});
const remaining=targets.filter(x=>!new Set(state.completed).has(x)),summary={version:1,source:"TCGCSV / TCGplayer",archiveStart:START,updatedAt:new Date().toISOString(),targetDates:targets.length,completedDates:state.completed.length,remainingDates:remaining.length,failedDates:Object.keys(state.failed||{}).length,mappedCards:map.mappedCards||map.cards.length,groups:byGroup.size,lastProcessed:state.completed[state.completed.length-1]||null,nextDate:remaining[0]||null};
await atomicJson(ROOT+"/summary.json",summary);
console.log(JSON.stringify({...summary,processedThisRun:processed,priceRowsThisRun:priceRows},null,2));
