import{APP_VERSION,DATABASE_VERSION,GRADING_ALGORITHM_VERSION,PRICE_ENGINE_VERSION,CONDITION_ESTIMATES}from"./config.js";
import{openDB,getAll,clear,exportBackup,importBackup,setting,setSetting}from"./db.js";
import{searchCards,getSets,getSetCards,getCardDetail,sortCards}from"./catalog.js";
import{ownedPrintingIds,addCopy,copiesFor,collectionStats,removeCopy}from"./collection.js";
import{initScanner,stopCamera,getScannerState,setRecognizedCard}from"./scanner.js";
import{renderHistory}from"./grading.js";

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let albumGame="pokemon",deferredInstall=null;

function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function cardImage(card,cls=""){return card.image?'<img class="'+cls+'" loading="lazy" src="'+esc(card.image)+'" alt="">':'<div class="img-placeholder '+cls+'"></div>'}
export function go(view){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+view));
  $$(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  if(view==="collection")renderCollection();
  if(view==="history")renderHistory();
  if(view==="album")renderSets();
  if(view!=="scanner")stopCamera();
  if(location.hash!=="#"+view)history.replaceState(null,"","#"+view);
}
function cardRow(card,owned=false){
  const encoded=encodeURIComponent(JSON.stringify(card));
  return '<article class="card-row" data-card="'+encoded+'">'+cardImage(card)+'<div><h3>'+esc(card.name)+'</h3><p>'+esc(card.collectionNumber||"—")+' • '+esc(card.setName||card.setCode||"Set non disponibile")+'</p><span class="badge '+(owned?"owned":"missing")+'">'+(owned?"✓ CE L'HO":"MI MANCA")+'</span></div><span>›</span></article>';
}
async function doSearch(){
  const query=$("#searchInput").value.trim(),root=$("#searchResults");
  if(query.length<2&&!/\d/.test(query)){root.innerHTML="";$("#searchHint").textContent="Scrivi almeno 2 caratteri, oppure un numero/codice carta.";return}
  $("#searchHint").textContent="Ricerca…";
  try{
    const game=$("#searchGame").value;let rows=await searchCards(query,{game:game}),owned=await ownedPrintingIds(),ownFilter=$("#searchOwned").value;
    if(ownFilter==="owned")rows=rows.filter(x=>owned.has(x.printingId));
    if(ownFilter==="missing")rows=rows.filter(x=>!owned.has(x.printingId));
    rows=sortCards(rows,$("#searchSort").value);
    root.innerHTML=rows.map(x=>cardRow(x,owned.has(x.printingId))).join("")||'<div class="notice">Nessun risultato compatibile.</div>';
    $("#searchHint").textContent=rows.length+" risultati. Numero/set code esatto ha priorità sul nome.";
  }catch(e){root.innerHTML='<div class="notice">Ricerca non disponibile: '+esc(e.message)+'. Se offline verranno usati i dati già in cache.</div>'}
}
function conditionEstimates(observed){
  if(!observed)return"";
  return Object.entries(CONDITION_ESTIMATES).map(([k,v])=>{
    const min=observed.value*v[0],max=observed.value*v[1],val=v[0]===v[1]?observed.currency+" "+min.toFixed(2):observed.currency+" "+min.toFixed(2)+"–"+max.toFixed(2);
    return '<div class="metric"><span>'+k+'</span><span>'+val+'</span></div>';
  }).join("");
}
async function openCard(card){
  const detail=await getCardDetail(card),copies=await copiesFor(card.printingId),prices=[];
  if(detail.price&&Number.isFinite(detail.price.value)&&detail.price.value>0)prices.push(detail.price);
  const priceHtml=prices.length?prices.map(p=>'<div class="price-line"><b>'+esc(p.source)+' • '+esc(p.priceType)+'</b><br>'+esc(p.currency)+' '+Number(p.value).toFixed(2)+'<br><small>Variante/stampa: '+esc(detail.setCode||detail.collectionNumber||"esatta")+' • Aggiornamento fonte: '+esc(p.timestamp||"data non fornita")+'</small></div>').join(""):'<div class="notice">Prezzo non disponibile per questa stampa. Non viene usato il prezzo di un’altra stampa.</div>';
  const estimate=prices.length?conditionEstimates(prices[0]):"";
  const scanner=getScannerState(),scannerAction=scanner.captures.front?'<button id="useScannerCard">Usa come identificazione scanner</button>':"";
  $("#cardDialogBody").innerHTML=(detail.imageHigh||detail.image?'<img class="detail-image" src="'+esc(detail.imageHigh||detail.image)+'" alt="">':"")+'<h2>'+esc(detail.name)+'</h2><p>'+esc(detail.collectionNumber||"—")+' • '+esc(detail.setName||"")+'</p><p>Rarità: '+esc(detail.rarity||"Dato non disponibile")+'</p><p>Copie possedute: <b>'+copies.length+'</b></p><div class="scanner-actions"><button id="addCopyDialog" class="primary">+ Aggiungi copia</button>'+scannerAction+'</div><h3>Prezzi osservati</h3>'+priceHtml+(estimate?'<h3>STIMA PER CONDIZIONE</h3><div class="notice">Intervalli derivati dal riferimento osservato e dalla configurazione NM/LP/MP/HP/Damaged. Non sono vendite osservate per condizione.</div>'+estimate:"");
  $("#addCopyDialog").onclick=async()=>{await addCopy(card);await openCard(card)};
  const use=$("#useScannerCard");if(use)use.onclick=()=>{setRecognizedCard(card);$("#cardDialog").close();go("scanner")};
  $("#cardDialog").showModal();
}
async function renderSets(force=false){
  const root=$("#setsList");root.innerHTML='<div class="notice">Caricamento espansioni…</div>';
  try{
    const sets=await getSets(albumGame,force);
    root.innerHTML=sets.map(s=>'<button class="set-row" data-set="'+encodeURIComponent(JSON.stringify(s))+'"><div><h3>'+esc(s.name)+'</h3><small>'+esc(s.series||s.setCode||"")+' • '+(s.cardCount==null?"?":s.cardCount)+' carte</small></div><span>›</span></button>').join("");
    root.querySelectorAll("[data-set]").forEach(b=>b.onclick=async()=>{const owned=await ownedPrintingIds();openSet(JSON.parse(decodeURIComponent(b.dataset.set)),owned)});
  }catch(e){root.innerHTML='<div class="notice">Impossibile caricare i set: '+esc(e.message)+'. Verranno usati i dati cache quando disponibili.</div>'}
}
async function openSet(set,ownedSet){
  const panel=$("#setDetail");panel.hidden=false;panel.innerHTML='<div class="notice">Caricamento master set…</div>';
  try{
    const cards=sortCards(await getSetCards(albumGame,set),"number-asc"),have=cards.filter(c=>ownedSet.has(c.printingId)).length,pct=cards.length?(have/cards.length*100).toFixed(1):"0.0";
    panel.innerHTML='<div class="section-head"><div><small>'+have+'/'+cards.length+' • '+pct+'%</small><h2>'+esc(set.name)+'</h2></div><button id="closeSet" class="ghost">Chiudi</button></div><div class="cards-grid">'+cards.map(c=>'<article class="grid-card '+(ownedSet.has(c.printingId)?"":"missing-card")+'" data-card="'+encodeURIComponent(JSON.stringify(c))+'">'+cardImage(c)+'<span class="status-chip '+(ownedSet.has(c.printingId)?"have":"miss")+'">'+(ownedSet.has(c.printingId)?"✓ CE L’HO":"MI MANCA")+'</span><b>'+esc(c.name)+'</b><small>'+esc(c.collectionNumber||"—")+'</small></article>').join("")+'</div>';
    $("#closeSet").onclick=()=>panel.hidden=true;bindCards(panel);
  }catch(e){panel.innerHTML='<div class="notice">Errore nel caricamento del set: '+esc(e.message)+'</div>'}
}
async function renderCollection(){
  const rows=await getAll("ownedCopies"),stats=await collectionStats();
  $("#collectionStats").innerHTML='<div class="stat"><b>'+stats.unique+'</b><small>stampe</small></div><div class="stat"><b>'+stats.copies+'</b><small>copie</small></div><div class="stat"><b>'+stats.pokemon+'/'+stats.yugioh+'</b><small>PKM / YGO</small></div>';
  $("#collectionList").innerHTML=rows.map(r=>'<article class="card-row">'+(r.image?'<img src="'+esc(r.image)+'" alt="">':"")+'<div><h3>'+esc(r.name)+'</h3><p>'+esc(r.collectionNumber)+' • '+esc(r.setName)+'</p><span class="badge owned">'+esc(r.condition)+'</span></div><button data-remove="'+esc(r.id)+'">×</button></article>').join("")||'<div class="notice">La collezione è vuota.</div>';
  $$("[data-remove]").forEach(b=>b.onclick=async()=>{await removeCopy(b.dataset.remove);renderCollection()});
}
function bindCards(root=document){root.querySelectorAll("[data-card]").forEach(el=>el.onclick=()=>openCard(JSON.parse(decodeURIComponent(el.dataset.card))))}
async function downloadBackup(){
  const data=await exportBackup(),blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="siuper-grading-backup-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function boot(){
  await openDB();$("#dbStatus").textContent="database locale pronto";
  $$(".bottom-nav button").forEach(b=>b.onclick=()=>go(b.dataset.view));$$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  $$(".game-btn").forEach(b=>b.onclick=()=>{$$(".game-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#searchGame").value=b.dataset.game});
  $$(".album-game").forEach(b=>b.onclick=()=>{$$(".album-game").forEach(x=>x.classList.remove("active"));b.classList.add("active");albumGame=b.dataset.game;$("#setDetail").hidden=true;renderSets()});
  let timer;$("#searchInput").addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(doSearch,220)});$("#searchGame").onchange=doSearch;$("#searchOwned").onchange=doSearch;$("#searchSort").onchange=doSearch;$("#refreshSets").onclick=()=>renderSets(true);
  $("#searchResults").addEventListener("click",e=>{const el=e.target.closest("[data-card]");if(el)openCard(JSON.parse(decodeURIComponent(el.dataset.card)))});
  $("#cardDialog [data-close]").onclick=()=>$("#cardDialog").close();
  $("#exportBtn").onclick=downloadBackup;$("#exportAllBtn").onclick=downloadBackup;$("#historyBtn").onclick=()=>go("history");
  $("#importFile").onchange=async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;try{await importBackup(JSON.parse(await f.text()));alert("Backup importato correttamente.");location.reload()}catch(err){alert("Backup non valido: "+err.message)}};
  $("#clearCacheBtn").onclick=async()=>{await clear("catalogCache");alert("Cache catalogo svuotata.")};
  $("#pokemonLanguage").value=await setting("pokemonLanguage","it");$("#pokemonLanguage").onchange=e=>setSetting("pokemonLanguage",e.target.value);
  $("#autoCapture").checked=await setting("autoCapture",true);$("#autoCapture").onchange=e=>setSetting("autoCapture",e.target.checked);
  $("#versionInfo").textContent="App "+APP_VERSION+" • DB "+DATABASE_VERSION+" • Grading "+GRADING_ALGORITHM_VERSION+" • Price engine "+PRICE_ENGINE_VERSION;
  initScanner({onCardIdentified:openCard});
  const hash=location.hash.slice(1);if(["home","search","album","collection","scanner","history","settings"].includes(hash))go(hash);
  window.addEventListener("hashchange",()=>{const v=location.hash.slice(1);if(["home","search","album","collection","scanner","history","settings"].includes(v))go(v)});
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("#installBtn").hidden=false});
  $("#installBtn").onclick=async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;$("#installBtn").hidden=true}};
  if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
}
boot().catch(e=>{$("#dbStatus").textContent="errore locale";console.error(e)});
