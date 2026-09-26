import{mkdir,readFile,writeFile,rename,rm}from"node:fs/promises";
import{execFile}from"node:child_process";
import{promisify}from"node:util";
const execFileAsync=promisify(execFile),TMP=".tmp-ygo-ocg";
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,"utf8"))}catch{return fallback}}
async function atomicJson(file,data){await mkdir(file.split("/").slice(0,-1).join("/"),{recursive:true});const tmp=file+".tmp";await writeFile(tmp,JSON.stringify(data,null,2)+"\n");await rename(tmp,file)}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":"siuper-grading-ocg-sync"}});if(!r.ok)throw new Error(String(r.status)+" "+r.statusText);return(await r.text()).trim()}
async function fetchJson(url){const r=await fetch(url,{headers:{"user-agent":"siuper-grading-ocg-sync"}});if(!r.ok)throw new Error(String(r.status)+" "+r.statusText);return await r.json()}
await mkdir(TMP,{recursive:true});const metaFile="data/yugioh/ocg-meta.json",old=await readJson(metaFile,{}),md5=await fetchText("https://ygocdb.com/api/v0/cards.zip.md5");
if(old.md5===md5&&old.cards>0){console.log(JSON.stringify({unchanged:true,md5,cards:old.cards}));process.exit(0)}
const zip=TMP+"/cards.zip";await execFileAsync("curl",["-fL","--retry","3","-A","SiuperGrading/1.0", "https://ygocdb.com/api/v0/cards.zip","-o",zip],{maxBuffer:4*1024*1024});
const {stdout}=await execFileAsync("unzip",["-p",zip,"cards.json"],{maxBuffer:160*1024*1024}),cards=JSON.parse(stdout),release=await fetchJson("https://ygocdb.com/api/v0/releaseDates.json"),releaseById=new Map(release.map(x=>[String(x.id),x.release||{}])),aliases={};
for(const [key,c]of Object.entries(cards)){
  const passcode=String(c.id||key||"");if(!/^\d+$/.test(passcode))continue;
  const text=c.text||{};
  aliases[passcode]={cid:c.cid??null,enName:c.en_name||text.en_name||"",jpName:c.jp_name||text.jp_name||"",jpRuby:c.jp_ruby||text.jp_ruby||"",zhName:c.cn_name||text.cn_name||"",scName:c.sc_name||text.sc_name||"",cnocgName:c.cnocg_n||text.cnocg_n||"",masterDuelName:c.md_name||text.md_name||"",release:releaseById.get(passcode)||null};
}
const now=new Date().toISOString(),out={version:1,source:"YGOCDB",updatedAt:now,md5,cards:Object.keys(aliases).length,aliases};
await atomicJson("data/yugioh/ocg-aliases.json",out);await atomicJson(metaFile,{version:1,source:"YGOCDB",updatedAt:now,md5,cards:out.cards});await rm(TMP,{recursive:true,force:true});console.log(JSON.stringify({source:"YGOCDB",cards:out.cards,md5},null,2));
