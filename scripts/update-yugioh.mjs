import{mkdir,readFile,writeFile,rename,stat}from"node:fs/promises";
import{existsSync}from"node:fs";
import path from"node:path";

const API="https://db.ygoprodeck.com/api/v7";
const OUT="data/yugioh";
const ASSET="assets/yugioh/thumbs";
const now=new Date().toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const slug=s=>"ygo-"+String(s||"set").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const compact=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");

async function fetchJson(url,tries=3){
  let last;
  for(let i=0;i<tries;i++){
    try{const r=await fetch(url,{headers:{accept:"application/json","user-agent":"siuper-grading-data-sync"}});if(!r.ok)throw new Error(String(r.status)+" "+r.statusText);return await r.json()}
    catch(e){last=e;if(i<tries-1)await sleep(800*(i+1))}
  }
  throw last;
}
async function atomicJson(file,data){
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=file+".tmp";await writeFile(tmp,JSON.stringify(data,null,2)+"\n");await rename(tmp,file);
}
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,"utf8"))}catch{return fallback}}
function printingId(card,set){
  return"yugioh:"+card.id+":"+compact(set.set_code)+":"+slug(set.set_name)+":"+slug(set.set_rarity||"unknown");
}
function normalizePrinting(card,set){
  const imageId=card.card_images&&card.card_images[0]&&card.card_images[0].id;
  const price=Number(set.set_price);
  return{
    id:printingId(card,set),cardId:String(card.id),printingId:printingId(card,set),game:"yugioh",
    name:card.name||"Senza nome",number:set.set_code||"",collectionNumber:set.set_code||"",
    setId:slug(set.set_name),setCode:set.set_code||"",setName:set.set_name||"",
    rarity:set.set_rarity||"",edition:set.set_edition||"",archetype:card.archetype||"",
    passcode:String(card.id),type:card.type||"",attribute:card.attribute||"",level:card.level??null,
    rank:card.type&&card.type.includes("XYZ")?card.level??null:null,link:card.linkval??null,
    atk:card.atk??null,def:card.def??null,
    image:imageId?"./assets/yugioh/thumbs/"+imageId+".jpg":"",imageHigh:imageId?"./assets/yugioh/thumbs/"+imageId+".jpg":"",
    artworkIds:(card.card_images||[]).map(x=>x.id),
    price:Number.isFinite(price)&&price>0?{source:"YGOPRODeck",currency:"USD",priceType:"set_price",condition:null,value:price,timestamp:now,confidence:"MEDIA"}:null,
    source:"YGOPRODeck",updatedAt:now
  };
}
async function mirrorOne(id){
  const file=ASSET+"/"+id+".jpg";
  if(existsSync(file))return"cached";
  const url="https://images.ygoprodeck.com/images/cards_small/"+id+".jpg";
  try{
    const r=await fetch(url,{headers:{"user-agent":"siuper-grading-asset-sync"}});if(!r.ok)throw new Error(String(r.status));
    const buf=Buffer.from(await r.arrayBuffer());if(buf.length<1000)throw new Error("asset too small");
    await mkdir(ASSET,{recursive:true});await writeFile(file,buf);return"new";
  }catch(e){console.error("Immagine fallita",id,e.message);return"failed"}
}
async function mapLimit(items,limit,fn){
  let at=0;const results=[];async function worker(){while(at<items.length){const i=at++;results[i]=await fn(items[i])}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return results;
}

const [setsRaw,cardsRaw]=await Promise.all([fetchJson(API+"/cardsets.php"),fetchJson(API+"/cardinfo.php")]);
const cards=cardsRaw.data||[];
const setRows=setsRaw.map(s=>({game:"yugioh",id:slug(s.set_name),name:s.set_name,setCode:s.set_code||"",cardCount:s.num_of_cards||0,releaseDate:s.tcg_date||"",updatedAt:now}));
const setByName=new Map(setRows.map(s=>[s.name,s]));
const groups=new Map(),index=[];
for(const card of cards){
  for(const set of card.card_sets||[]){
    if(!setByName.has(set.set_name))setByName.set(set.set_name,{game:"yugioh",id:slug(set.set_name),name:set.set_name,setCode:(set.set_code||"").split("-")[0],cardCount:0,releaseDate:"",updatedAt:now});
    const p=normalizePrinting(card,set),key=p.setId;if(!groups.has(key))groups.set(key,new Map());groups.get(key).set(p.printingId,p);
  }
}
for(const [key,map]of groups){const rows=[...map.values()];index.push(...rows);await atomicJson(OUT+"/cards/"+encodeURIComponent(key)+".json",rows)}

await atomicJson(OUT+"/sets.json",[...setByName.values()].sort((a,b)=>String(b.releaseDate).localeCompare(String(a.releaseDate))||a.name.localeCompare(b.name)));
await atomicJson("data/yugioh/search-index.json",index);

let mirror={new:0,cached:0,failed:0};
if(process.env.MIRROR_IMAGES!=="false"){
  const ids=[...new Set(cards.flatMap(c=>(c.card_images||[]).slice(0,1).map(x=>x.id)).filter(Boolean))];
  const rs=await mapLimit(ids,8,mirrorOne);for(const r of rs)mirror[r]++;
}
const meta=await readJson("data/meta.json",{});
meta.databaseVersion=1;meta.yugioh={source:"YGOPRODeck v7",updatedAt:now,sets:setByName.size,printings:index.length,images:mirror};
await atomicJson("data/meta.json",meta);
console.log(JSON.stringify({source:"YGOPRODeck v7",sets:setByName.size,printings:index.length,images:mirror},null,2));
if(!index.length)process.exitCode=1;
