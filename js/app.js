import{APP_VERSION,DATABASE_VERSION,GRADING_ALGORITHM_VERSION,PRICE_ENGINE_VERSION,CONDITION_ESTIMATES}from"./config.js";
import{openDB,getAll,clear,exportBackup,importBackup,setting,setSetting}from"./db.js";
import{searchCards,getSets,getSetCards,getCardDetail,sortCards}from"./catalog.js";
import{ownedPrintingIds,addCopy,copiesFor,collectionStats,removeCopy,updateCopy}from"./collection.js";
import{initScanner,stopCamera,getScannerState,setRecognizedCard}from"./scanner.js";
import{renderHistory}from"./grading.js";
import{getPricesForCard,reliability,referencePricesForCards}from"./prices.js";
import{progressForCards,getCustomMasterSets,progressForCustom,variantKeys}from"./mastersets.js";
import{loadPriceHistory,drawPriceHistory}from"./price-history.js";

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
  const rp=card._referencePrice,price=rp?'<span class="card-price">'+esc(rp.currency)+' '+Number(rp.value).toFixed(2)+' • '+esc(rp.source)+' '+esc(rp.priceType)+'</span>':"";
  return '<article class="card-row" data-card="'+encoded+'">'+cardImage(card)+'<div><h3>'+esc(card.name)+'</h3><p>'+esc(card.collectionNumber||"—")+' • '+esc(card.setName||card.setCode||"Set non disponibile")+'</p>'+price+'<span class="badge '+(owned?"owned":"missing")+'">'+(owned?"✓ CE L'HO":"MI MANCA")+'</span></div><span>›</span></article>';
}
async function doSearch(){
  const query=$("#searchInput").value.trim(),root=$("#searchResults");
  if(query.length<2&&!/\d/.test(query)){root.innerHTML="";$("#searchHint").textContent="Scrivi almeno 2 caratteri, oppure un numero/codice carta.";return}
  $("#searchHint").textContent="Ricerca…";
  try{
    const game=$("#searchGame").value,ownedCopies=await getAll("ownedCopies"),owned=new Set(ownedCopies.map(x=>x.printingId)),ownFilter=$("#searchOwned").value;
    let rows=await searchCards(query,{game:game});
    if(ownFilter==="owned")rows=rows.filter(x=>owned.has(x.printingId));
    if(ownFilter==="missing")rows=rows.filter(x=>!owned.has(x.printingId));
    const setFilter=$("#searchSet").value.trim().toLowerCase(),rarityFilter=$("#searchRarity").value.trim().toLowerCase(),condition=$("#searchCondition").value;
    if(setFilter)rows=rows.filter(x=>String(x.setName||x.setCode||"").toLowerCase().includes(setFilter));
    if(rarityFilter)rows=rows.filter(x=>String(x.rarity||"").toLowerCase().includes(rarityFilter));
    if(condition!=="all"){const ids=new Set(ownedCopies.filter(x=>x.condition===condition).map(x=>x.printingId));rows=rows.filter(x=>ids.has(x.printingId))}
    const sort=$("#searchSort").value,currency=$("#searchCurrency").value;
    if(sort.startsWith("price-")){
      const refs=await referencePricesForCards(rows,currency);rows=rows.map(x=>Object.assign({},x,{_referencePrice:refs.get(x.printingId)||null}));
      rows.sort((a,b)=>{const av=a._referencePrice?Number(a._referencePrice.value):Infinity,bv=b._referencePrice?Number(b._referencePrice.value):Infinity;return sort==="price-asc"?av-bv:(bv===Infinity?-1:av===Infinity?1:bv-av)});
    }else rows=sortCards(rows,sort);
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
function marketSearchLinks(card){
  const q=[card.name,card.setName||card.setCode,card.collectionNumber,card.rarity].filter(Boolean).join(" ");
  const ebay="https://www.ebay.it/sch/i.html?_nkw="+encodeURIComponent(q)+"&LH_Sold=1&LH_Complete=1";
  const google="https://www.google.com/search?q="+encodeURIComponent(q+" card market price");
  return '<div class="scanner-actions"><a class="file-btn" target="_blank" rel="noopener noreferrer" href="'+ebay+'">Verifica vendite concluse</a><a class="file-btn" target="_blank" rel="noopener noreferrer" href="'+google+'">Ricerca mercato</a></div>';
}
function copiesEditor(copies){
  if(!copies.length)return"";
  return '<h3>Le mie copie</h3>'+copies.map((cp,i)=>
    '<div class="copy-editor" data-copy-id="'+esc(cp.id)+'">'+
    '<b>Copia '+(i+1)+'</b>'+
    '<label>Condizione <select data-copy-field="condition">'+["NM","LP","MP","HP","DAMAGED"].map(v=>'<option value="'+v+'"'+(cp.condition===v?" selected":"")+'>'+v+'</option>').join("")+'</select></label>'+
    '<label>Lingua <input data-copy-field="language" value="'+esc(cp.language||"it")+'"></label>'+
    '<label>Variante <input data-copy-field="variant" value="'+esc(cp.variant||"")+'" placeholder="normal, holo, reverse…"></label>'+
    '<label>Prezzo pagato <input data-copy-field="pricePaid" type="number" min="0" step="0.01" value="'+(cp.pricePaid==null?"":esc(cp.pricePaid))+'"></label>'+
    '<label>Note <textarea data-copy-field="notes">'+esc(cp.notes||"")+'</textarea></label>'+
    '<div class="scanner-actions"><button data-save-copy>Salva copia</button><button class="danger" data-delete-copy>Elimina copia</button></div>'+
    '</div>'
  ).join("");
}
async function openCard(card){
  const detail=await getCardDetail(card),copies=await copiesFor(card.printingId),prices=await getPricesForCard(detail),allGrades=await getAll("grades"),cardGrades=allGrades.filter(g=>g.printingId===card.printingId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const priceHtml=prices.length?prices.map(p=>'<div class="price-line"><b>'+esc(p.source)+' • '+esc(p.priceType)+'</b><br>'+esc(p.currency)+' '+Number(p.value).toFixed(2)+'<br><small>Variante: '+esc(p.variant||detail.rarity||"non specificata")+' • Affidabilità: '+esc(reliability(p))+' • Aggiornato: '+esc(p.timestamp||"data non fornita")+'</small></div>').join(""):'<div class="notice">Prezzo non disponibile per questa stampa. Non viene usato il prezzo di un’altra stampa.</div>';
  const observedReference=prices.find(p=>p.priceType==="market")||prices.find(p=>p.priceType==="trend")||prices[0]||null;
  const estimate=observedReference?conditionEstimates(observedReference):"";
  const scanner=getScannerState(),scannerAction=scanner.captures.front?'<button id="useScannerCard">Usa come identificazione scanner</button>':"";
  const metadata=[
    ["Gioco",detail.game==="pokemon"?"Pokémon TCG":"Yu-Gi-Oh!"],
    ["Numero / codice",detail.collectionNumber||"Dato non disponibile"],
    ["Set",detail.setName||"Dato non disponibile"],
    ["Serie",detail.series||""],
    ["Rarità",detail.rarity||"Dato non disponibile"],
    ["Edizione",detail.edition||""],
    ["Artista",detail.artist||""],
    ["Tipi",Array.isArray(detail.types)?detail.types.join(", "):""],
    ["Archetipo",detail.archetype||""],
    ["Passcode",detail.passcode||""],
    ["ATK",detail.atk==null?"":detail.atk],
    ["DEF",detail.def==null?"":detail.def]
  ].filter(x=>x[1]!==""&&x[1]!=null).map(x=>'<div class="metric"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>').join("");
  const gradesHtml=cardGrades.length?'<h3>Grading salvati</h3>'+cardGrades.slice(0,5).map(g=>'<div class="metric"><span>'+new Date(g.createdAt).toLocaleDateString("it-IT")+' • '+esc(g.gradingAlgorithmVersion)+'</span><b>'+g.finalGrade+'/10 • '+g.confidence+'%</b></div>').join("")+'<button id="openHistoryFromCard">Apri storico grading</button>':"";
  $("#cardDialogBody").innerHTML=(detail.imageHigh||detail.image?'<img class="detail-image" src="'+esc(detail.imageHigh||detail.image)+'" alt="">':"")+'<h2>'+esc(detail.name)+'</h2>'+metadata+'<p>Copie possedute: <b>'+copies.length+'</b></p><div class="scanner-actions"><button id="addCopyDialog" class="primary">+ Aggiungi copia</button><button id="scanThisCard">Scanner</button>'+scannerAction+'</div>'+copiesEditor(copies)+gradesHtml+'<h3>Prezzi osservati</h3>'+priceHtml+(observedReference?'<h3>Storico prezzo</h3><div class="scanner-actions"><button data-price-days="7">7 giorni</button><button data-price-days="30">30 giorni</button><button data-price-days="90">90 giorni</button><button data-price-days="365">1 anno</button></div><canvas id="priceHistoryChart" hidden></canvas><div id="priceHistoryInfo" class="notice">Caricamento storico…</div>':"")+(estimate?'<h3>STIMA PER CONDIZIONE</h3><div class="notice">Intervalli derivati da '+esc(observedReference.source)+' '+esc(observedReference.priceType)+' nella stessa valuta. Sono stime configurabili, NON vendite osservate per condizione.</div>'+estimate:"")+marketSearchLinks(detail);
  $("#addCopyDialog").onclick=async()=>{await addCopy(card);await openCard(card)};
  $("#scanThisCard").onclick=()=>{setRecognizedCard(card);$("#cardDialog").close();go("scanner")};
  if(observedReference){
    const chart=$("#priceHistoryChart"),historyPoints=await loadPriceHistory(detail.printingId,observedReference);
    drawPriceHistory(chart,historyPoints,30);
    $("#cardDialogBody").querySelectorAll("[data-price-days]").forEach(btn=>btn.onclick=()=>drawPriceHistory(chart,historyPoints,Number(btn.dataset.priceDays)));
  }
  $("#cardDialogBody").querySelectorAll("[data-copy-id]").forEach(box=>{
    const id=box.dataset.copyId;
    const get=name=>box.querySelector('[data-copy-field="'+name+'"]').value;
    box.querySelector("[data-save-copy]").onclick=async()=>{
      const rawPaid=get("pricePaid");
      await updateCopy(id,{condition:get("condition"),language:get("language").trim()||"it",variant:get("variant").trim(),pricePaid:rawPaid===""?null:Number(rawPaid),notes:get("notes")});
      await openCard(card);
    };
    box.querySelector("[data-delete-copy]").onclick=async()=>{await removeCopy(id);await openCard(card)};
  });
  const historyBtn=$("#openHistoryFromCard");if(historyBtn)historyBtn.onclick=()=>{$("#cardDialog").close();go("history")};
  const use=$("#useScannerCard");if(use)use.onclick=()=>{setRecognizedCard(card);$("#cardDialog").close();go("scanner")};
  $("#cardDialog").showModal();
}
async function renderSets(force=false){
  const root=$("#setsList");root.innerHTML='<div class="notice">Caricamento espansioni…</div>';
  try{
    const [sets,custom,copies]=await Promise.all([getSets(albumGame,force),getCustomMasterSets(),getAll("ownedCopies")]);
    const gameCustom=custom.filter(x=>x.game===albumGame),gameCopies=copies.filter(x=>x.game===albumGame);
    const [eurRefs,usdRefs]=await Promise.all([referencePricesForCards(gameCopies,"EUR"),referencePricesForCards(gameCopies,"USD")]);
    const bySet=new Map();
    for(const cp of gameCopies){
      const key=cp.setName||cp.setCode||"";
      if(!bySet.has(key))bySet.set(key,{ids:new Set(),eur:0,usd:0});
      const info=bySet.get(key);info.ids.add(cp.printingId);
      const er=eurRefs.get(cp.printingId),ur=usdRefs.get(cp.printingId);
      if(er)info.eur+=Number(er.value)||0;if(ur)info.usd+=Number(ur.value)||0;
    }
    const row=s=>{
      const info=bySet.get(s.name)||{ids:new Set(),eur:0,usd:0},owned=info.ids.size,total=Number(s.cardCount)||0,pct=total?owned/total*100:0;
      const values=(info.eur>0?' • €'+info.eur.toFixed(2):"")+(info.usd>0?' • $'+info.usd.toFixed(2):"");
      return '<button class="set-row" data-set="'+encodeURIComponent(JSON.stringify(s))+'"><div><h3>'+esc(s.name)+'</h3><small>'+owned+'/'+(total||"?")+' • '+pct.toFixed(1)+'%'+values+'</small></div><span>›</span></button>';
    };
    const customHtml=gameCustom.length?'<div class="eyebrow">MASTER SET PERSONALIZZATI</div>'+gameCustom.map(s=>'<button class="set-row" data-custom-set="'+encodeURIComponent(JSON.stringify(s))+'"><div><h3>'+esc(s.name)+'</h3><small>'+s.expectedSlots+' slot • struttura manuale</small></div><span>›</span></button>').join(""):"";
    let officialHtml="";
    if(albumGame==="pokemon"){
      const groups=new Map();
      for(const s of sets){const key=s.series||"Altre espansioni";if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s)}
      officialHtml=[...groups.entries()].map(([series,rows])=>'<div class="series-block"><div class="eyebrow">'+esc(series)+'</div>'+rows.map(row).join("")+'</div>').join("");
    }else officialHtml=sets.map(row).join("");
    root.innerHTML=customHtml+officialHtml;
    root.querySelectorAll("[data-set]").forEach(b=>b.onclick=()=>openSet(JSON.parse(decodeURIComponent(b.dataset.set))));
    root.querySelectorAll("[data-custom-set]").forEach(b=>b.onclick=()=>openCustomMasterSet(JSON.parse(decodeURIComponent(b.dataset.customSet))));
  }catch(e){root.innerHTML='<div class="notice">Impossibile caricare i set: '+esc(e.message)+'. Verranno usati i dati cache quando disponibili.</div>'}
}
async function openCustomMasterSet(master){
  const panel=$("#setDetail"),copies=await getAll("ownedCopies"),progress=progressForCustom(master,copies);
  panel.hidden=false;
  const components=(master.components||[]).map(x=>'<div class="metric"><span>'+esc(x.name)+'</span><b>'+x.expectedSlots+' slot</b></div>').join("");
  panel.innerHTML='<div class="section-head"><div><small>'+progress.owned+'/'+progress.total+' • '+progress.percent.toFixed(1)+'%</small><h2>'+esc(master.name)+'</h2></div><button id="closeSet" class="ghost">Chiudi</button></div><div class="progressbar"><span style="width:'+progress.percent.toFixed(2)+'%"></span></div>'+components+'<div class="notice">'+esc(master.note||"")+(progress.mapped?"":" La mappatura degli slot non è ancora popolata: il conteggio resta trasparente e non vengono create carte fittizie.")+'</div>';
  $("#closeSet").onclick=()=>panel.hidden=true;
}
async function openSet(set){
  const panel=$("#setDetail");panel.hidden=false;panel.innerHTML='<div class="notice">Caricamento master set…</div>';
  try{
    const cards=await getSetCards(albumGame,set),copies=await getAll("ownedCopies"),ownedSet=new Set(copies.map(x=>x.printingId));
    const rarities=[...new Set(cards.map(x=>x.rarity).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"it"));
    const hasVariants=cards.some(c=>variantKeys(c).some(v=>v!=="base"));
    panel.innerHTML='<div class="section-head"><div><small id="setProgressText"></small><h2>'+esc(set.name)+'</h2></div><button id="closeSet" class="ghost">Chiudi</button></div><div class="progressbar"><span id="setProgressBar"></span></div><div class="set-tools"><select id="setProgressMode"><option value="number">Progresso per numero</option><option value="variants">Progresso per varianti</option></select><select id="setOwnedFilter"><option value="all">Tutte</option><option value="owned">Ce l’ho</option><option value="missing">Mi manca</option></select><input id="setTextFilter" placeholder="Nome o numero"><select id="setRarityFilter"><option value="">Tutte le rarità</option>'+rarities.map(r=>'<option>'+esc(r)+'</option>').join("")+'</select><select id="setConditionFilter"><option value="">Qualsiasi condizione</option><option>NM</option><option>LP</option><option>MP</option><option>HP</option><option>DAMAGED</option></select><select id="setCurrency"><option value="EUR">Prezzi EUR</option><option value="USD">Prezzi USD</option></select><select id="setSort"><option value="number-asc">Numero ↑</option><option value="number-desc">Numero ↓</option><option value="name-asc">Nome A-Z</option><option value="name-desc">Nome Z-A</option><option value="price-asc">Prezzo ↑</option><option value="price-desc">Prezzo ↓</option></select></div>'+(!hasVariants?'<div id="variantNotice" class="notice" hidden>Per questo set il catalogo corrente non contiene ancora metadati affidabili sulle varianti: il progresso per varianti coincide temporaneamente con quello per numero.</div>':"")+'<div id="setCardsGrid" class="cards-grid"></div>';
    $("#closeSet").onclick=()=>panel.hidden=true;
    const render=async()=>{
      const mode=$("#setProgressMode").value,progress=progressForCards(cards,copies,mode);
      $("#setProgressText").textContent=progress.owned+"/"+progress.total+" • "+progress.percent.toFixed(1)+"%";
      $("#setProgressBar").style.width=progress.percent.toFixed(2)+"%";
      const notice=$("#variantNotice");if(notice)notice.hidden=mode!=="variants";
      let rows=[...cards],text=$("#setTextFilter").value.trim().toLowerCase(),ownedFilter=$("#setOwnedFilter").value,rarity=$("#setRarityFilter").value,condition=$("#setConditionFilter").value,sort=$("#setSort").value,currency=$("#setCurrency").value;
      if(text)rows=rows.filter(x=>String(x.name||"").toLowerCase().includes(text)||String(x.collectionNumber||"").toLowerCase().includes(text));
      if(ownedFilter==="owned")rows=rows.filter(x=>ownedSet.has(x.printingId));
      if(ownedFilter==="missing")rows=rows.filter(x=>!ownedSet.has(x.printingId));
      if(rarity)rows=rows.filter(x=>x.rarity===rarity);
      if(condition){const ids=new Set(copies.filter(x=>x.condition===condition).map(x=>x.printingId));rows=rows.filter(x=>ids.has(x.printingId))}
      let refs=new Map();
      if(sort.startsWith("price-")){refs=await referencePricesForCards(rows,currency);rows.sort((a,b)=>{const av=refs.has(a.printingId)?Number(refs.get(a.printingId).value):null,bv=refs.has(b.printingId)?Number(refs.get(b.printingId).value):null;if(av==null&&bv==null)return 0;if(av==null)return 1;if(bv==null)return-1;return sort==="price-asc"?av-bv:bv-av})}
      else rows=sortCards(rows,sort);
      $("#setCardsGrid").innerHTML=rows.map(card=>{const have=ownedSet.has(card.printingId),rp=refs.get(card.printingId);return '<article class="grid-card '+(have?"":"missing-card")+'" data-card="'+encodeURIComponent(JSON.stringify(card))+'">'+cardImage(card)+'<span class="status-chip '+(have?"have":"miss")+'">'+(have?"✓ CE L’HO":"MI MANCA")+'</span><b>'+esc(card.name)+'</b><small>'+esc(card.collectionNumber||"—")+'</small>'+(rp?'<span class="card-price">'+esc(rp.currency)+' '+Number(rp.value).toFixed(2)+'</span>':"")+'</article>'}).join("")||'<div class="notice">Nessuna carta con questi filtri.</div>';
      bindCards($("#setCardsGrid"));
    };
    ["setProgressMode","setOwnedFilter","setRarityFilter","setConditionFilter","setCurrency","setSort"].forEach(id=>$("#"+id).onchange=render);
    $("#setTextFilter").oninput=render;
    await render();
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
async function loadDatabaseFreshness(){
  const read=async path=>{try{const r=await fetch(path,{cache:"no-cache"});return r.ok?await r.json():null}catch{return null}};
  const [p,y]=await Promise.all([read("./data/pokemon/meta.json"),read("./data/yugioh/meta.json")]);
  const fmt=m=>m&&m.updatedAt?new Date(m.updatedAt).toLocaleString("it-IT"):"non disponibile";
  $("#dbStatus").textContent="Pokémon: "+fmt(p)+" • Yu-Gi-Oh!: "+fmt(y);
  return{pokemon:p,yugioh:y};
}
async function boot(){
  await openDB();$("#dbStatus").textContent="database locale pronto";const freshness=await loadDatabaseFreshness();
  $$(".bottom-nav button").forEach(b=>b.onclick=()=>go(b.dataset.view));$$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  $$(".game-btn").forEach(b=>b.onclick=()=>{$$(".game-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#searchGame").value=b.dataset.game});
  $$(".album-game").forEach(b=>b.onclick=()=>{$$(".album-game").forEach(x=>x.classList.remove("active"));b.classList.add("active");albumGame=b.dataset.game;$("#setDetail").hidden=true;renderSets()});
  let timer;$("#searchInput").addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(doSearch,220)});$("#searchGame").onchange=doSearch;$("#searchOwned").onchange=doSearch;$("#searchSort").onchange=doSearch;$("#searchCurrency").onchange=doSearch;$("#searchCondition").onchange=doSearch;$("#searchSet").oninput=doSearch;$("#searchRarity").oninput=doSearch;$("#refreshSets").onclick=()=>renderSets(true);
  $("#searchResults").addEventListener("click",e=>{const el=e.target.closest("[data-card]");if(el)openCard(JSON.parse(decodeURIComponent(el.dataset.card)))});
  $("#cardDialog [data-close]").onclick=()=>$("#cardDialog").close();
  $("#exportBtn").onclick=downloadBackup;$("#exportAllBtn").onclick=downloadBackup;$("#historyBtn").onclick=()=>go("history");
  $("#importFile").onchange=async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;try{await importBackup(JSON.parse(await f.text()));alert("Backup importato correttamente.");location.reload()}catch(err){alert("Backup non valido: "+err.message)}};
  $("#clearCacheBtn").onclick=async()=>{await clear("catalogCache");alert("Cache catalogo svuotata.")};
  $("#pokemonLanguage").value=await setting("pokemonLanguage","it");$("#pokemonLanguage").onchange=e=>setSetting("pokemonLanguage",e.target.value);
  $("#autoCapture").checked=await setting("autoCapture",true);$("#autoCapture").onchange=e=>setSetting("autoCapture",e.target.checked);
  $("#versionInfo").innerHTML="App "+APP_VERSION+" • DB "+DATABASE_VERSION+" • Grading "+GRADING_ALGORITHM_VERSION+" • Price engine "+PRICE_ENGINE_VERSION+"<br>Pokémon aggiornato: "+(freshness.pokemon&&freshness.pokemon.updatedAt?new Date(freshness.pokemon.updatedAt).toLocaleString("it-IT"):"dato non disponibile")+"<br>Yu-Gi-Oh! aggiornato: "+(freshness.yugioh&&freshness.yugioh.updatedAt?new Date(freshness.yugioh.updatedAt).toLocaleString("it-IT"):"dato non disponibile");
  initScanner({onCardIdentified:openCard});
  const hash=location.hash.slice(1);if(["home","search","album","collection","scanner","history","settings"].includes(hash))go(hash);
  window.addEventListener("hashchange",()=>{const v=location.hash.slice(1);if(["home","search","album","collection","scanner","history","settings"].includes(v))go(v)});
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("#installBtn").hidden=false});
  $("#installBtn").onclick=async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;$("#installBtn").hidden=true}};
  if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
}
boot().catch(e=>{$("#dbStatus").textContent="errore locale";console.error(e)});
