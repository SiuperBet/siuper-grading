import{mkdir,writeFile,rename,rm}from"node:fs/promises";
import{execFile}from"node:child_process";
import{promisify}from"node:util";
import path from"node:path";

const execFileAsync=promisify(execFile);
const ZIP=".tmp-ygojson-aggregate.zip",TMP=".tmp-ygojson-ocg";
const SOURCE="https://github.com/iconmaster5326/YGOJSON/releases/download/v1/aggregate.zip";
const locales={
  jp:{dir:"data/yugioh-ocg-jp",catalogLanguage:"ocg-jp",defaultLanguage:"ja",label:"OCG JP"},
  sc:{dir:"data/yugioh-ocg-sc",catalogLanguage:"ocg-sc",defaultLanguage:"zh-CN",label:"OCG 简中"},
  tc:{dir:"data/yugioh-ocg-tc",catalogLanguage:"ocg-tc",defaultLanguage:"zh-TW",label:"OCG 繁中"}
};
const now=new Date().toISOString();

async function atomicJson(file,data){
  await mkdir(path.dirname(file),{recursive:true});const tmp=file+".tmp";
  await writeFile(tmp,JSON.stringify(data,null,2)+"\n");await rename(tmp,file);
}
function firstValue(obj){return obj&&typeof obj==="object"?Object.values(obj).find(Boolean)||"":""}
function cardName(card,lang){
  const t=card&&card.text||{};
  return t[lang]&&t[lang].name||t.en&&t.en.name||t.ja&&t.ja.name||firstValue(t)&&firstValue(t).name||"Senza nome";
}
function ygoId(card){
  const id=card&&card.externalIDs&&card.externalIDs.ygoprodeck&&card.externalIDs.ygoprodeck.id;
  return id!=null?String(id):String(card&&card.passwords&&card.passwords[0]||"");
}
function printEditions(localeInfo,printing,content){
  const info=localeInfo&&localeInfo.cardInfo||{},found=[];
  for(const [edition,rows]of Object.entries(info))if(rows&&Object.prototype.hasOwnProperty.call(rows,printing.id))found.push(edition);
  if(found.length)return found;
  const editions=localeInfo&&localeInfo.editions||content&&content.editions||[];
  return editions.length?editions:[""];
}
function exactImage(localeInfo,edition,printingId){
  const info=localeInfo&&localeInfo.cardInfo||{},row=info[edition]&&info[edition][printingId];
  return row&&row.image||"";
}
function refImage(card,printing){
  const images=card&&card.images||[];
  const selected=printing&&printing.imageID&&images.find(x=>x.id===printing.imageID);
  return selected&&selected.card||images[0]&&images[0].card||"";
}
function setName(set,lang){
  return set&&set.name&&set.name[lang]||set&&set.name&&set.name.en||set&&set.name&&set.name.ja||firstValue(set&&set.name)||"Set OCG";
}
function applies(content,locale){
  return !Array.isArray(content.locales)||!content.locales.length||content.locales.includes(locale);
}
function setId(locale,set){return"ygojson-"+locale+"-"+set.id}
function printingId(locale,p,edition){return"yugioh-ocg:"+locale+":"+p.id+":"+(edition||"none")}
function normalizeEdition(v=""){return v==="1st"?"firstEdition":v||""}

await rm(TMP,{recursive:true,force:true});await rm(ZIP,{force:true});
await execFileAsync("curl",["-fL","--retry","4","--retry-delay","2","-A","SiuperGrading/0.2","-o",ZIP,SOURCE],{maxBuffer:8*1024*1024});
const listing=(await execFileAsync("unzip",["-Z1",ZIP],{maxBuffer:8*1024*1024})).stdout.split(/\r?\n/).filter(Boolean);
const cardPath=listing.find(x=>/(^|\/)cards\.json$/.test(x)),setPath=listing.find(x=>/(^|\/)sets\.json$/.test(x));
if(!cardPath||!setPath)throw new Error("YGOJSON aggregate does not contain cards.json and sets.json");
const cards=JSON.parse((await execFileAsync("unzip",["-p",ZIP,cardPath],{maxBuffer:400*1024*1024})).stdout);
const sets=JSON.parse((await execFileAsync("unzip",["-p",ZIP,setPath],{maxBuffer:400*1024*1024})).stdout);
if(!Array.isArray(cards)||!Array.isArray(sets))throw new Error("Unexpected YGOJSON aggregate format");
const cardByUuid=new Map(cards.map(c=>[String(c.id),c]));

for(const [locale,cfg]of Object.entries(locales)){
  const setRows=[],index=[];
  for(const set of sets){
    const localeInfo=set&&set.locales&&set.locales[locale];if(!localeInfo)continue;
    const lang=localeInfo.language||cfg.defaultLanguage,name=setName(set,lang),sid=setId(locale,set),rows=[],seen=new Set();
    for(const content of set.contents||[]){
      if(!applies(content,locale))continue;
      for(const p of content.cards||[]){
        const card=cardByUuid.get(String(p.card));if(!card)continue;
        const editions=printEditions(localeInfo,p,content);
        for(const editionRaw of editions){
          const edition=normalizeEdition(editionRaw),pid=printingId(locale,p,editionRaw);
          if(seen.has(pid))continue;seen.add(pid);
          const prefix=localeInfo.prefix,code=prefix==null?(p.suffix||""):(String(prefix||"")+String(p.suffix||""));
          const image=exactImage(localeInfo,editionRaw,p.id),reference=refImage(card,p),language=p.language||lang||cfg.defaultLanguage;
          const row={
            id:pid,cardId:ygoId(card)||String(card.id),printingId:pid,game:"yugioh",
            name:cardName(card,language),number:code,collectionNumber:code,
            setId:sid,setCode:code,setName:name,series:"",
            rarity:p.rarity||"",edition,language,catalogLanguage:cfg.catalogLanguage,locale,
            passcode:ygoId(card),type:card.cardType||"",attribute:card.attribute||"",
            level:card.level??null,rank:card.rank??null,link:Array.isArray(card.linkArrows)?card.linkArrows.length:null,
            atk:card.atk??null,def:card.def??null,
            image:image||"",imageHigh:image||"",imageReference:reference||"",
            imageIsExact:Boolean(image),imageReferenceOnly:!image&&Boolean(reference),
            source:"YGOJSON",sourceId:"ygojson-v1",sourcePrintingId:p.id,sourceSetId:set.id,
            updatedAt:now
          };
          rows.push(row);index.push(row);
        }
      }
    }
    if(!rows.length)continue;
    await atomicJson(cfg.dir+"/cards/"+encodeURIComponent(sid)+".json",rows);
    setRows.push({game:"yugioh",id:sid,name,cardCount:rows.length,printedTotal:rows.length,releaseDate:localeInfo.date||set.date||"",setCode:localeInfo.prefix||"",catalogLanguage:cfg.catalogLanguage,language:lang,locale,source:"YGOJSON",updatedAt:now});
  }
  setRows.sort((a,b)=>String(b.releaseDate).localeCompare(String(a.releaseDate))||a.name.localeCompare(b.name));
  index.sort((a,b)=>a.setName.localeCompare(b.setName)||String(a.collectionNumber).localeCompare(String(b.collectionNumber),undefined,{numeric:true}));
  await atomicJson(cfg.dir+"/sets.json",setRows);await atomicJson(cfg.dir+"/search-index.json",index);
  await atomicJson(cfg.dir+"/meta.json",{databaseVersion:1,game:"yugioh",source:"YGOJSON v1",updatedAt:now,locale,catalogLanguage:cfg.catalogLanguage,sets:setRows.length,printings:index.length,exactImages:index.filter(x=>x.imageIsExact).length,referenceImages:index.filter(x=>x.imageReferenceOnly).length});
  console.log(JSON.stringify({locale,catalogLanguage:cfg.catalogLanguage,sets:setRows.length,printings:index.length,exactImages:index.filter(x=>x.imageIsExact).length}));
}
await rm(TMP,{recursive:true,force:true});await rm(ZIP,{force:true});
