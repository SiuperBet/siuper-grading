import{APP_VERSION,DATABASE_VERSION,GRADING_ALGORITHM_VERSION,PRICE_ENGINE_VERSION}from"./config.js";
import{openDB,getAll,clear,exportBackup,importBackup,setting,setSetting}from"./db.js";
import{searchCards,getSets,getSetCards,getCardDetail,sortCards}from"./catalog.js";
import{addCopy,copiesFor,collectionStats,removeCopy,updateCopy,listCopies,migrateCollection,loadValueHistory,saveValueHistory}from"./collection.js";
import{initScanner,stopCamera,getScannerState,setRecognizedCard}from"./scanner.js";
import{renderHistory}from"./grading.js";
import{getPricesForCard,reliability,referencePricesForCards,pricesForPrintings}from"./prices.js";
import{progressForCards,getCustomMasterSets,progressForCustom,variantKeys,canonicalVariant}from"./mastersets.js";
import{loadPriceHistory,drawPriceHistory,buildOnlineMarketTrend,drawOnlineMarketTrend}from"./price-history.js";
import{CONDITIONS,UNSPECIFIED,conditionInfo,conditionName,conditionRank,conditionCoefficient}from"./conditions.js";
import{valueCopy,summarizeCollection,snapshotFromSummary,mergeSnapshot,VALUATION_LABELS}from"./valuation.js";

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let albumGame="pokemon",albumLanguage="it",albumYgoLanguage="tcg",deferredInstall=null;
const colState={game:"all",condition:"all",graded:"all",language:"all",set:"",variant:"",sort:"added-desc",currency:"EUR"};
const LANGUAGE_OPTIONS={pokemon:["it","en","ja","zh-tw","zh-cn"],yugioh:["tcg","ocg-jp","ocg-sc","ocg-tc"]};

function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function languageLabel(lang=""){return({it:"IT",en:"EN",ja:"JP","zh-tw":"ZH-TW","zh-cn":"ZH-CN",tcg:"TCG","ocg-jp":"OCG JP","ocg-sc":"OCG 简中","ocg-tc":"OCG 繁中"})[lang]||String(lang||"").toUpperCase()}
function money(v,currency){const sym=currency==="EUR"?"€":currency==="USD"?"$":String(currency||"")+" ";return sym+Number(v).toFixed(2)}
function conditionOptionsHtml(selected="",opts={}){
  return(opts.placeholder?'<option value="">Scegli la condizione…</option>':"")+CONDITIONS.map(c=>'<option value="'+c.code+'"'+(selected===c.code?" selected":"")+'>'+esc(c.label)+'</option>').join("")+'<option value="'+UNSPECIFIED.code+'"'+(selected===UNSPECIFIED.code?" selected":"")+'>'+esc(UNSPECIFIED.label)+'</option>';
}
function conditionDescription(code){return code?conditionInfo(code).description:"Scegli la condizione fisica di questa copia: puoi cambiarla in seguito."}
function activeAlbumLanguage(){return albumGame==="pokemon"?albumLanguage:albumYgoLanguage}
function stableHash(value=""){
  let h=2166136261;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36);
}
function customCardFromForm(){
  const game=$("#customGame").value,language=$("#customLanguage").value,name=$("#customName").value.trim(),setName=$("#customSetName").value.trim(),code=$("#customCode").value.trim(),rarity=$("#customRarity").value.trim(),variant=$("#customVariant").value.trim(),image=$("#customImageUrl").value.trim();
  if(!name||!code)throw new Error("Nome e numero/codice stampa sono obbligatori.");
  const key=[game,language,name,setName,code,rarity].join("|").toLowerCase(),printingId="custom:"+game+":"+language+":"+stableHash(key);
  return{id:printingId,cardId:printingId,printingId,game,name,number:code,collectionNumber:code,setId:"custom:"+stableHash(setName||"unknown"),setCode:code,setName:setName||"Stampa personalizzata",rarity,language,catalogLanguage:language,variant,image,imageHigh:image,imageCandidates:image?[{low:image,high:image,language,reference:false,label:"PERSONALE"}]:[],source:"Manuale verificata dall’utente",customPrinting:true};
}
async function addCustomPrinting(){
  const status=$("#customPrintingStatus");
  try{
    const card=customCardFromForm(),condition=$("#customCondition").value,variant=$("#customVariant").value.trim(),notes=$("#customNotes").value.trim();
    if(!condition)throw new Error("Scegli la condizione della copia (oppure “Non specificata”).");
    await addCopy(card,{condition,language:card.language,variant,notes});
    status.innerHTML='<div class="notice">✓ Stampa aggiunta alla collezione come voce personale. Non viene propagata al catalogo globale.</div>';
  }catch(e){status.innerHTML='<div class="notice">'+esc(e.message)+'</div>'}
}
function showUpdateBanner(worker){
  let banner=document.querySelector("#appUpdateBanner");
  if(!banner){
    banner=document.createElement("div");banner.id="appUpdateBanner";banner.className="app-update-banner";
    banner.innerHTML='<div><b>Nuova versione disponibile</b><small>Siuper Grading può aggiornarsi senza reinstallazione.</small></div><button id="applyAppUpdate" class="primary">Aggiorna ora</button>';
    document.body.appendChild(banner);
  }
  banner.hidden=false;
  const btn=banner.querySelector("#applyAppUpdate");
  if(btn)btn.onclick=()=>{
    btn.disabled=true;btn.textContent="Aggiornamento…";
    if(worker&&worker.postMessage)worker.postMessage({type:"SKIP_WAITING"});
  };
}
async function initPwaUpdater(){
  if(!("serviceWorker"in navigator))return;
  let refreshing=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(refreshing)return;refreshing=true;location.reload();
  });
  const reg=await navigator.serviceWorker.register("./service-worker.js",{updateViaCache:"none"});
  const canAutoReload=()=>!document.querySelector("dialog[open]")&&!(getScannerState().captures&&getScannerState().captures.front);
  const applyWaiting=worker=>{
    if(!worker||!navigator.serviceWorker.controller)return;
    if(canAutoReload())worker.postMessage({type:"SKIP_WAITING"});
    else showUpdateBanner(worker);
  };
  const inspect=()=>applyWaiting(reg.waiting);
  inspect();
  reg.addEventListener("updatefound",()=>{
    const worker=reg.installing;if(!worker)return;
    worker.addEventListener("statechange",()=>{
      if(worker.state==="installed"&&navigator.serviceWorker.controller)applyWaiting(worker);
    });
  });
  const check=()=>reg.update().catch(()=>{});
  check();
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")check()});
  window.addEventListener("online",check);
  setInterval(check,30*60*1000);
}
function imageCandidates(card,quality="low"){
  const raw=Array.isArray(card&&card.imageCandidates)?card.imageCandidates:[];
  const rows=raw.map(x=>({url:quality==="high"?(x.high||x.low):(x.low||x.high),reference:Boolean(x.reference),label:x.label||""})).filter(x=>x.url);
  if(!rows.length&&card){const url=quality==="high"?(card.imageHigh||card.image):(card.image||card.imageHigh);if(url)rows.push({url,reference:Boolean(card.imageReferenceOnly),label:card.imageReferenceOnly?"RIF. ARTE":""})}
  if(card&&card.imageReference&&!rows.some(x=>x.url===card.imageReference))rows.push({url:card.imageReference,reference:true,label:"RIF. ARTE"});
  return rows;
}
function cardImage(card,cls="",quality="low"){
  const rows=imageCandidates(card,quality);
  if(!rows.length)return '<div class="img-placeholder '+cls+'"><span>Immagine non disponibile</span></div>';
  return '<img class="'+cls+'" loading="lazy" src="'+esc(rows[0].url)+'" data-image-candidates="'+encodeURIComponent(JSON.stringify(rows))+'" data-image-index="0" alt="'+esc(card&&card.name||"Carta")+'">';
}
function initImageFallbacks(){
  if(window.__siuperImageFallbacks)return;window.__siuperImageFallbacks=true;
  document.addEventListener("error",e=>{
    const img=e.target;if(!(img instanceof HTMLImageElement)||!img.dataset.imageCandidates)return;
    let rows=[];try{rows=JSON.parse(decodeURIComponent(img.dataset.imageCandidates))}catch{}
    const next=Number(img.dataset.imageIndex||0)+1;
    if(next<rows.length){img.dataset.imageIndex=String(next);img.src=rows[next].url;return}
    const ph=document.createElement("div");ph.className="img-placeholder "+(img.className||"");ph.innerHTML="<span>Immagine non disponibile</span>";img.replaceWith(ph);
  },true);
  document.addEventListener("load",e=>{
    const img=e.target;if(!(img instanceof HTMLImageElement)||!img.dataset.imageCandidates)return;
    let rows=[];try{rows=JSON.parse(decodeURIComponent(img.dataset.imageCandidates))}catch{}
    const row=rows[Number(img.dataset.imageIndex||0)];if(!row||!row.reference)return;
    const host=img.closest(".grid-card,.card-row")||img.parentElement;if(!host||host.querySelector(".image-ref-label"))return;
    const badge=document.createElement("span");badge.className="image-ref-label";badge.textContent=row.label||"IMMAGINE RIF.";host.appendChild(badge);
  },true);
}
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
  return '<article class="card-row" data-card="'+encoded+'">'+cardImage(card)+'<div><h3>'+esc(card.name)+'</h3><p>'+esc(card.collectionNumber||"—")+' • '+esc(card.setName||card.setCode||"Set non disponibile")+(card.catalogLanguage||card.language?' • '+esc(languageLabel(card.catalogLanguage||card.language)):"")+'</p>'+price+'<span class="badge '+(owned?"owned":"missing")+'">'+(owned?"✓ CE L'HO":"MI MANCA")+'</span></div><span>›</span></article>';
}
async function doSearch(){
  const query=$("#searchInput").value.trim(),root=$("#searchResults");
  if(query.length<2&&!/\d/.test(query)){root.innerHTML="";$("#searchHint").textContent="Scrivi almeno 2 caratteri, oppure un numero/codice carta.";return}
  $("#searchHint").textContent="Ricerca…";
  try{
    const game=$("#searchGame").value,language=$("#searchLanguage")?$("#searchLanguage").value:"all",ownedCopies=await listCopies(),owned=new Set(ownedCopies.map(x=>x.printingId)),ownFilter=$("#searchOwned").value;
    let rows=await searchCards(query,{game:game,language:language});
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
// Stima per condizione a partire da un prezzo di riferimento: coefficienti centralizzati in conditions.js.
function conditionEstimates(observed){
  if(!observed)return"";
  return CONDITIONS.map(c=>{
    const k=conditionCoefficient(c.code);if(!k)return"";
    const min=observed.value*k.low,max=observed.value*k.high,val=k.low===k.high?observed.currency+" "+min.toFixed(2):observed.currency+" "+min.toFixed(2)+"–"+max.toFixed(2);
    return '<div class="metric"><span>'+esc(c.name)+' ('+c.code+')</span><span>'+val+'</span></div>';
  }).join("");
}
function marketSearchLinks(card){
  const q=[card.name,card.setName||card.setCode,card.collectionNumber,card.rarity].filter(Boolean).join(" ");
  const ebay="https://www.ebay.it/sch/i.html?_nkw="+encodeURIComponent(q)+"&LH_Sold=1&LH_Complete=1";
  const google="https://www.google.com/search?q="+encodeURIComponent(q+" card market price");
  return '<div class="scanner-actions"><a class="file-btn" target="_blank" rel="noopener noreferrer" href="'+ebay+'">Verifica vendite concluse</a><a class="file-btn" target="_blank" rel="noopener noreferrer" href="'+google+'">Ricerca mercato</a></div>';
}
function variantLabel(v=""){return({normal:"Normal",holo:"Holo",reverse:"Reverse Holo",firstEdition:"1ª edizione",unlimited:"Unlimited",promo:"Promo",wFoil:"W Foil",base:"Base"})[v]||v}
function variantField(card,current="",id=null){
  const known=variantKeys(card).filter(v=>v!=="base"),cur=canonicalVariant(current||"");
  if(!known.length)return '<input '+(id?'id="'+id+'" ':'')+'data-copy-field="variant" value="'+esc(current||"")+'" placeholder="normal, holo, reverse…">';
  const opts=[...known];if(current&&!opts.some(v=>canonicalVariant(v)===cur))opts.push(current);
  return '<select '+(id?'id="'+id+'" ':'')+'data-copy-field="variant">'+opts.map(v=>'<option value="'+esc(v)+'"'+(canonicalVariant(v)===cur?" selected":"")+'>'+esc(variantLabel(v))+'</option>').join("")+'</select>';
}
function languageSelectHtml(game,current){
  const list=[...(LANGUAGE_OPTIONS[game]||[])];if(current&&!list.includes(current))list.push(current);
  return '<select data-copy-field="language">'+list.map(l=>'<option value="'+esc(l)+'"'+(l===current?" selected":"")+'>'+esc(languageLabel(l))+'</option>').join("")+'</select>';
}
function copyBadges(cp,valuation){
  let html='<span class="cond-badge">'+esc(conditionName(cp.condition))+' ('+esc(cp.condition)+')</span>';
  if(cp.conditionConfirmed===false)html+='<span class="cond-badge warn">da confermare</span>';
  if(cp.gradeValue!=null)html+='<span class="cond-badge grade">Grading '+Number(cp.gradeValue).toFixed(1)+'/10</span>';
  if(valuation)html+='<span class="cond-badge kind-'+valuation.kind+'">'+esc(VALUATION_LABELS[valuation.kind]||"")+'</span>';
  return html;
}
// Riepilogo di una copia: condizione, grading, valore di riferimento NM, valore stimato e fonte.
function copyFactsHtml(cp,valuation,currency){
  const rows=[["Condizione",esc(conditionName(cp.condition))+(cp.conditionConfirmed===false?" • da confermare":"")]];
  if(cp.gradeValue!=null)rows.push(["Grading",Number(cp.gradeValue).toFixed(1)+"/10"]);
  if(cp.gradeConfidence!=null)rows.push(["Confidence grading",Math.round(cp.gradeConfidence)+"%"]);
  if(cp.conditionSuggestion&&cp.conditionSuggestion.code)rows.push(["Condizione suggerita dal grading",esc(conditionName(cp.conditionSuggestion.code))+" ("+Math.round(cp.conditionSuggestion.confidence||0)+"%)"]);
  if(valuation.referenceValue!=null)rows.push(["Valore NM di riferimento",money(valuation.referenceValue,currency)]);
  rows.push(valuation.value!=null?["Valore stimato di questa copia",'<b>'+money(valuation.value,currency)+'</b> • '+esc(VALUATION_LABELS[valuation.kind])]:["Valore di questa copia",esc(VALUATION_LABELS[valuation.kind]||"non disponibile")]);
  if(valuation.source)rows.push(["Fonte prezzo",esc(valuation.source)+" "+esc(valuation.priceType||"")]);
  if(valuation.timestamp)rows.push(["Aggiornato",esc(valuation.timestamp)]);
  return '<div class="copy-facts">'+rows.map(r=>'<div class="metric"><span>'+r[0]+'</span><span>'+r[1]+'</span></div>').join("")+'</div>'+(valuation.note?'<div class="value-note">'+esc(valuation.note)+'</div>':"");
}
function copyAdvancedHtml(cp,valuation,currency){
  const lines=[];
  if(cp.conditionSource)lines.push("Termine originale della fonte: "+esc(cp.conditionSource));
  if(valuation.priceCondition)lines.push("Condizione del prezzo usato: "+esc(conditionName(valuation.priceCondition)));
  if(valuation.coefficient)lines.push("Coefficiente: ×"+valuation.coefficient.low.toFixed(2)+(valuation.coefficient.low===valuation.coefficient.high?"":"–"+valuation.coefficient.high.toFixed(2))+" (usato il valore medio ×"+valuation.coefficient.mid.toFixed(3)+")");
  if(valuation.confidence)lines.push("Affidabilità del valore: "+esc(valuation.confidence));
  lines.push("Valuta: "+esc(currency));
  return '<details><summary>Dettagli valutazione</summary><div class="value-note">'+lines.join("<br>")+'</div></details>';
}
function copiesEditor(copies,card,valuations,currency,cardGrades){
  if(!copies.length)return"";
  return '<h3>Le mie copie</h3>'+copies.map((cp,i)=>{
    const valuation=valuations.get(cp.id),gradeOptions='<option value="">Nessuno</option>'+cardGrades.map(g=>'<option value="'+esc(g.id)+'"'+(cp.gradingId===g.id?" selected":"")+'>'+Number(g.finalGrade).toFixed(1)+'/10 • '+new Date(g.createdAt).toLocaleDateString("it-IT")+'</option>').join("");
    return '<div class="copy-editor" data-copy-id="'+esc(cp.id)+'">'+
    '<b>Copia '+(i+1)+'</b><div>'+copyBadges(cp,valuation)+'</div>'+
    copyFactsHtml(cp,valuation,currency)+
    '<label>Condizione <select data-copy-field="condition">'+conditionOptionsHtml(cp.condition)+'</select></label>'+
    '<small class="condition-desc" data-condition-desc>'+esc(conditionDescription(cp.condition))+'</small>'+
    '<label>Grading collegato <select data-copy-field="gradingId">'+gradeOptions+'</select></label>'+
    '<label>Lingua <span>'+languageSelectHtml(card.game,cp.language||(card.game==="yugioh"?"tcg":"it"))+'</span></label>'+
    '<label>Variante '+variantField(card,cp.variant||"")+'</label>'+
    '<label>Prezzo pagato <input data-copy-field="pricePaid" type="number" min="0" step="0.01" value="'+(cp.pricePaid==null?"":esc(cp.pricePaid))+'"></label>'+
    '<label>Note <textarea data-copy-field="notes">'+esc(cp.notes||"")+'</textarea></label>'+
    '<small class="condition-desc">Inserita il '+esc(new Date(cp.createdAt).toLocaleDateString("it-IT"))+'. Cambiando la condizione il valore della copia e il totale della collezione vengono ricalcolati.</small>'+
    '<div class="scanner-actions"><button data-save-copy>Salva copia</button><button class="danger" data-delete-copy>Elimina copia</button></div>'+
    copyAdvancedHtml(cp,valuation,currency)+
    '</div>';
  }).join("");
}
async function openCard(card){
  const detail=await getCardDetail(card),copies=await copiesFor(card.printingId),prices=await getPricesForCard(detail),allGrades=await getAll("grades"),cardGrades=allGrades.filter(g=>g.printingId===card.printingId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const currency=await setting("displayCurrency","EUR"),valuations=new Map(copies.map(cp=>[cp.id,valueCopy(cp,prices,currency)]));
  const priceHtml=prices.length?prices.map(p=>'<div class="price-line"><b>'+esc(p.source)+' • '+esc(p.priceType)+'</b><br>'+esc(p.currency)+' '+Number(p.value).toFixed(2)+'<br><small>Variante: '+esc(p.variant||detail.rarity||"non specificata")+' • Affidabilità: '+esc(reliability(p))+' • Aggiornato: '+esc(p.timestamp||"data non fornita")+'</small></div>').join(""):'<div class="notice">Prezzo non disponibile per questa stampa. Non viene usato il prezzo di un’altra stampa.</div>';
  const observedReference=prices.find(p=>p.priceType==="market")||prices.find(p=>p.priceType==="trend")||prices[0]||null;
  const onlineTrend=buildOnlineMarketTrend(prices,"normal");
  const estimate=observedReference?conditionEstimates(observedReference):"";
  const scanner=getScannerState(),scannerAction=scanner.captures.front?'<button id="useScannerCard">Usa come identificazione scanner</button>':"";
  const addVariants=variantKeys(detail).filter(v=>v!=="base");
  const addVariantHtml=addVariants.length?'<label>Variante '+variantField(detail,addVariants[0],"addCopyVariant")+'</label>':"";
  const addCopyHtml='<div class="add-copy-box" id="addCopyBox"><b>Aggiungi una copia</b><label>Condizione * <select id="addCopyCondition">'+conditionOptionsHtml("",{placeholder:true})+'</select></label><small class="condition-desc" id="addCopyConditionDesc">'+esc(conditionDescription(""))+'</small>'+addVariantHtml+'<label>Prezzo pagato <input id="addCopyPaid" type="number" min="0" step="0.01"></label><label>Note <textarea id="addCopyNotes"></textarea></label><div class="form-error" id="addCopyError"></div><button id="addCopyDialog" class="primary">+ Aggiungi copia</button></div>';
  const ocgJp=detail.ocgRelease&&detail.ocgRelease.jp?[detail.ocgRelease.jp.pack||"",detail.ocgRelease.jp.date||""].filter(Boolean).join(" • "):"";
  const ocgSc=detail.ocgRelease&&detail.ocgRelease.sc?[detail.ocgRelease.sc.pack||"",detail.ocgRelease.sc.date||""].filter(Boolean).join(" • "):"";
  const metadata=[
    ["Gioco",detail.game==="pokemon"?"Pokémon TCG":"Yu-Gi-Oh!"],
    ["Lingua / circuito",languageLabel(detail.catalogLanguage||detail.language||(detail.game==="yugioh"?"tcg":"it"))],
    ["Numero / codice",detail.collectionNumber||"Dato non disponibile"],
    ["Set",detail.setName||"Dato non disponibile"],
    ["Serie",detail.series||""],
    ["Rarità",detail.rarity||"Dato non disponibile"],
    ["Edizione",detail.edition||""],
    ["Artista",detail.artist||""],
    ["Tipi",Array.isArray(detail.types)?detail.types.join(", "):""],
    ["Archetipo",detail.archetype||""],
    ["Passcode",detail.passcode||""],
    ["Nome JP",detail.jpName||""],
    ["Nome CN",detail.scName||detail.zhName||""],
    ["OCG CID",detail.ocgCid==null?"":detail.ocgCid],
    ["Prima uscita JP",ocgJp],
    ["Prima uscita CN",ocgSc],
    ["ATK",detail.atk==null?"":detail.atk],
    ["DEF",detail.def==null?"":detail.def]
  ].filter(x=>x[1]!==""&&x[1]!=null).map(x=>'<div class="metric"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>').join("");
  const gradesHtml=cardGrades.length?'<h3>Grading salvati</h3>'+cardGrades.slice(0,5).map(g=>'<div class="metric"><span>'+new Date(g.createdAt).toLocaleDateString("it-IT")+' • '+esc(g.gradingAlgorithmVersion)+'</span><b>'+g.finalGrade+'/10 • '+g.confidence+'%</b></div>').join("")+'<button id="openHistoryFromCard">Apri storico grading</button>':"";
  $("#cardDialogBody").innerHTML=cardImage(detail,"detail-image","high")+'<h2>'+esc(detail.name)+'</h2>'+metadata+'<p>Copie possedute: <b>'+copies.length+'</b></p><div class="scanner-actions"><button id="scanThisCard">Scanner</button>'+scannerAction+'</div>'+addCopyHtml+copiesEditor(copies,detail,valuations,currency,cardGrades)+gradesHtml+'<h3>Prezzi osservati</h3>'+priceHtml+(onlineTrend.length>=2?'<h3>Andamento online</h3><canvas id="onlineTrendChart" hidden></canvas><div id="onlineTrendInfo" class="notice">Caricamento andamento Cardmarket…</div>':"")+(observedReference?'<h3>Storico giornaliero</h3><div class="scanner-actions"><button data-price-days="7">7 giorni</button><button data-price-days="30">30 giorni</button><button data-price-days="90">90 giorni</button><button data-price-days="365">1 anno</button></div><canvas id="priceHistoryChart" hidden></canvas><div id="priceHistoryInfo" class="notice">Caricamento storico…</div>':"")+(estimate?'<h3>STIMA PER CONDIZIONE</h3><div class="notice">Intervalli derivati da '+esc(observedReference.source)+' '+esc(observedReference.priceType)+' nella stessa valuta, con coefficienti configurabili. Sono stime, NON vendite osservate per condizione: se la fonte ha un prezzo della condizione esatta viene usato quello.</div>'+estimate:"")+marketSearchLinks(detail);
  const condSelect=$("#addCopyCondition");
  condSelect.onchange=()=>{$("#addCopyConditionDesc").textContent=conditionDescription(condSelect.value);$("#addCopyError").textContent=""};
  $("#addCopyDialog").onclick=async()=>{
    if(!condSelect.value){$("#addCopyError").textContent="Scegli la condizione della copia (oppure “Non specificata”).";condSelect.focus();return}
    const v=$("#addCopyVariant"),paid=$("#addCopyPaid").value;
    try{await addCopy(detail,{condition:condSelect.value,variant:v?v.value:"",pricePaid:paid===""?null:Number(paid),notes:$("#addCopyNotes").value.trim()});await openCard(detail)}
    catch(e){$("#addCopyError").textContent=e.message}
  };
  $("#scanThisCard").onclick=()=>{setRecognizedCard(card);$("#cardDialog").close();go("scanner")};
  if(onlineTrend.length>=2){
    const onlineChart=$("#onlineTrendChart");drawOnlineMarketTrend(onlineChart,onlineTrend);
  }
  if(observedReference){
    const chart=$("#priceHistoryChart"),historyPoints=await loadPriceHistory(detail.printingId,observedReference);
    drawPriceHistory(chart,historyPoints,30);
    $("#cardDialogBody").querySelectorAll("[data-price-days]").forEach(btn=>btn.onclick=()=>drawPriceHistory(chart,historyPoints,Number(btn.dataset.priceDays)));
  }
  $("#cardDialogBody").querySelectorAll("[data-copy-id]").forEach(box=>{
    const id=box.dataset.copyId;
    const get=name=>box.querySelector('[data-copy-field="'+name+'"]').value;
    const conditionField=box.querySelector('[data-copy-field="condition"]'),desc=box.querySelector("[data-condition-desc]");
    conditionField.onchange=()=>{desc.textContent=conditionDescription(conditionField.value)};
    box.querySelector("[data-save-copy]").onclick=async()=>{
      const rawPaid=get("pricePaid"),gradingId=get("gradingId"),grade=cardGrades.find(g=>g.id===gradingId);
      await updateCopy(id,{condition:get("condition"),language:get("language"),variant:get("variant").trim(),pricePaid:rawPaid===""?null:Number(rawPaid),notes:get("notes"),gradingId:grade?grade.id:null,gradeValue:grade?Number(grade.finalGrade):null,gradeConfidence:grade?Number(grade.confidence):null});
      await openCard(card);
    };
    box.querySelector("[data-delete-copy]").onclick=async()=>{await removeCopy(id);await openCard(card)};
  });
  const historyBtn=$("#openHistoryFromCard");if(historyBtn)historyBtn.onclick=()=>{$("#cardDialog").close();go("history")};
  const use=$("#useScannerCard");if(use)use.onclick=()=>{setRecognizedCard(card);$("#cardDialog").close();go("scanner")};
  $("#cardDialog").showModal();
}
async function renderSets(force=false){
  const root=$("#setsList");root.hidden=false;$("#setDetail").hidden=true;root.innerHTML='<div class="notice">Caricamento espansioni…</div>';
  try{
    const [sets,custom,copies]=await Promise.all([getSets(albumGame,force,activeAlbumLanguage()),getCustomMasterSets(),getAll("ownedCopies")]);
    const gameCustom=custom.filter(x=>x.game===albumGame&&(albumGame!=="pokemon"||!x.catalogLanguage||x.catalogLanguage===albumLanguage)),gameCopies=copies.filter(x=>x.game===albumGame&&(albumGame==="pokemon"?(x.language||"it")===albumLanguage:(albumYgoLanguage==="tcg"?!String(x.language||"tcg").startsWith("ocg-"):x.language===albumYgoLanguage)));
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
  const panel=$("#setDetail"),root=$("#setsList");root.hidden=true;panel.hidden=false;panel.innerHTML='<div class="notice">Caricamento carte del Master Set…</div>';panel.scrollIntoView({behavior:"smooth",block:"start"});
  try{
    const masterLanguage=master.catalogLanguage||albumLanguage;
    const [allSets,copies]=await Promise.all([getSets(master.game||albumGame,false,master.game==="pokemon"?masterLanguage:null),getAll("ownedCopies")]);
    const setById=new Map(allSets.map(x=>[String(x.id),x])),components=master.components||[],loaded=[];
    for(const component of components){
      const set=component.sourceSetId?setById.get(String(component.sourceSetId)):null;
      if(!set){loaded.push({component,set:null,cards:[],error:"Set sorgente non disponibile"});continue}
      try{loaded.push({component,set,cards:await getSetCards(master.game||albumGame,set,false,master.game==="pokemon"?masterLanguage:null),error:null})}
      catch(e){loaded.push({component,set,cards:[],error:e.message})}
    }
    const cards=loaded.flatMap(x=>x.cards.map(card=>Object.assign({},card,{_masterComponentId:x.component.id,_masterComponentName:x.component.name})));
    const ownedSet=new Set(copies.map(x=>x.printingId)),available=cards.length,owned=cards.filter(x=>ownedSet.has(x.printingId)).length,total=Number(master.expectedSlots)||available,percent=total?owned/total*100:0;
    const componentOptions=loaded.map(x=>'<option value="'+esc(x.component.id)+'">'+esc(x.component.name)+' ('+x.cards.length+'/'+x.component.expectedSlots+')</option>').join("");
    const statusRows=loaded.map(x=>{
      const count=x.cards.length,expected=Number(x.component.expectedSlots)||count,missing=Math.max(0,expected-count),setName=x.set?x.set.name:"sorgente non disponibile";
      return '<div class="metric"><span>'+esc(x.component.name)+'<small> • '+esc(setName)+'</small></span><b>'+count+'/'+expected+(missing?' • '+missing+' non disponibili':'')+'</b></div>';
    }).join("");
    panel.innerHTML='<div class="section-head"><div><small id="customProgressText">'+owned+'/'+total+' • '+percent.toFixed(1)+'%</small><h2>'+esc(master.name)+'</h2></div><button id="closeSet" class="ghost">Chiudi</button></div>'+
      '<div class="progressbar"><span id="customProgressBar" style="width:'+percent.toFixed(2)+'%"></span></div>'+
      statusRows+
      '<div class="notice"><b>'+available+' carte reali disponibili ora.</b> '+esc(master.note||"")+'</div>'+
      '<div class="set-tools"><select id="customComponentFilter"><option value="">Tutte le sezioni ('+available+')</option>'+componentOptions+'</select><select id="customOwnedFilter"><option value="all">Tutte</option><option value="owned">Ce l’ho</option><option value="missing">Mi manca</option></select><input id="customTextFilter" placeholder="Nome o numero"><select id="customSort"><option value="number-asc">Numero ↑</option><option value="number-desc">Numero ↓</option><option value="name-asc">Nome A-Z</option><option value="name-desc">Nome Z-A</option></select></div>'+
      '<div id="customCardsGrid" class="cards-grid"></div>';
    $("#closeSet").onclick=()=>{panel.hidden=true;root.hidden=false;root.scrollIntoView({behavior:"smooth",block:"start"})};
    const render=()=>{
      const component=$("#customComponentFilter").value,ownedFilter=$("#customOwnedFilter").value,text=$("#customTextFilter").value.trim().toLowerCase(),sort=$("#customSort").value;
      let rows=[...cards];
      if(component)rows=rows.filter(x=>x._masterComponentId===component);
      if(ownedFilter==="owned")rows=rows.filter(x=>ownedSet.has(x.printingId));
      if(ownedFilter==="missing")rows=rows.filter(x=>!ownedSet.has(x.printingId));
      if(text)rows=rows.filter(x=>String(x.name||"").toLowerCase().includes(text)||String(x.collectionNumber||"").toLowerCase().includes(text));
      rows=sortCards(rows,sort);
      $("#customCardsGrid").innerHTML=rows.map(card=>{
        const have=ownedSet.has(card.printingId);
        return '<article class="grid-card '+(have?"":"missing-card")+'" data-card="'+encodeURIComponent(JSON.stringify(card))+'">'+cardImage(card)+'<span class="status-chip '+(have?"have":"miss")+'">'+(have?"✓ CE L’HO":"MI MANCA")+'</span><b>'+esc(card.name)+'</b><small>'+esc(card._masterComponentName)+' • '+esc(card.collectionNumber||"—")+'</small></article>';
      }).join("")||'<div class="notice">Nessuna carta con questi filtri.</div>';
      bindCards($("#customCardsGrid"));
    };
    $("#customComponentFilter").onchange=render;$("#customOwnedFilter").onchange=render;$("#customSort").onchange=render;$("#customTextFilter").oninput=render;render();
  }catch(e){
    panel.innerHTML='<div class="notice">Errore nel caricamento del Master Set: '+esc(e.message)+'</div><button id="closeCustomSetError">Torna alle espansioni</button>';
    const back=$("#closeCustomSetError");if(back)back.onclick=()=>{panel.hidden=true;root.hidden=false};
  }
}
async function openSet(set){
  const panel=$("#setDetail"),root=$("#setsList");root.hidden=true;panel.hidden=false;panel.innerHTML='<div class="notice">Caricamento master set…</div>';
  try{
    const cards=await getSetCards(albumGame,set,false,activeAlbumLanguage()),copies=await listCopies(),ownedSet=new Set(copies.map(x=>x.printingId));
    const rarities=[...new Set(cards.map(x=>x.rarity).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"it"));
    const hasVariants=cards.some(c=>variantKeys(c).some(v=>v!=="base"));
    panel.innerHTML='<div class="section-head"><div><small id="setProgressText"></small><h2>'+esc(set.name)+'</h2></div><button id="closeSet" class="ghost">Chiudi</button></div><div class="progressbar"><span id="setProgressBar"></span></div><div class="set-tools"><select id="setProgressMode"><option value="number">Progresso per numero</option><option value="variants">Progresso per varianti</option></select><select id="setOwnedFilter"><option value="all">Tutte</option><option value="owned">Ce l’ho</option><option value="missing">Mi manca</option></select><input id="setTextFilter" placeholder="Nome o numero"><select id="setRarityFilter"><option value="">Tutte le rarità</option>'+rarities.map(r=>'<option>'+esc(r)+'</option>').join("")+'</select><select id="setConditionFilter"><option value="">Qualsiasi condizione</option>'+conditionOptionsHtml("")+'</select><select id="setCurrency"><option value="EUR">Prezzi EUR</option><option value="USD">Prezzi USD</option></select><select id="setSort"><option value="number-asc">Numero ↑</option><option value="number-desc">Numero ↓</option><option value="name-asc">Nome A-Z</option><option value="name-desc">Nome Z-A</option><option value="price-asc">Prezzo ↑</option><option value="price-desc">Prezzo ↓</option></select></div>'+(!hasVariants?'<div id="variantNotice" class="notice" hidden>Per questo set il catalogo corrente non contiene ancora metadati affidabili sulle varianti: il progresso per varianti coincide temporaneamente con quello per numero.</div>':"")+'<div id="setCardsGrid" class="cards-grid"></div>';
    $("#closeSet").onclick=()=>{panel.hidden=true;root.hidden=false;root.scrollIntoView({behavior:"smooth",block:"start"})};panel.scrollIntoView({behavior:"smooth",block:"start"});
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
  }catch(e){panel.innerHTML='<div class="notice">Errore nel caricamento del set: '+esc(e.message)+'</div><button id="closeSetError">Torna alle espansioni</button>';const back=$("#closeSetError");if(back)back.onclick=()=>{panel.hidden=true;root.hidden=false}}
}

// ---- La mia collezione: riepilogo economico per singola copia, filtri e ordinamenti ----
function isGraded(cp){return Boolean(cp.gradingId)||cp.gradeValue!=null}
function summaryHtml(s,copiesById){
  const c=s.currency;
  if(!s.copies)return'<div class="notice">Nessuna copia: aggiungi carte per vedere il valore della collezione.</div>';
  const conditionRows=[...CONDITIONS,UNSPECIFIED].map(cond=>({cond,data:s.byCondition[cond.code]})).filter(x=>x.data).map(x=>'<div class="metric"><span>'+esc(x.cond.name)+' ('+x.cond.code+')</span><span>'+x.data.copies+' • '+money(x.data.value,c)+'</span></div>').join("");
  const kinds=[["exact","Prezzi reali (stessa condizione)"],["nearby","Prezzi derivati (condizione vicina)"],["estimated","Stime tramite condizione"],["unrated","Condizione non specificata"],["none","Senza prezzo disponibile"]].filter(k=>s.kinds[k[0]]).map(k=>'<div class="metric"><span>'+k[1]+'</span><b>'+s.kinds[k[0]]+'</b></div>').join("");
  const unreliable=s.unreliable.slice(0,25).map(id=>{const cp=copiesById.get(id);return cp?'<div class="metric"><span>'+esc(cp.name)+' • '+esc(cp.collectionNumber||"—")+'</span><span>'+esc(conditionName(cp.condition))+'</span></div>':""}).join("");
  const gradedLine=s.graded.copies?s.graded.copies+' gradate • voto medio '+(s.graded.averageGrade==null?"n/d":s.graded.averageGrade.toFixed(1))+' • '+money(s.graded.value,c):"nessuna";
  return '<div class="summary-total"><div><small>VALORE STIMATO</small><br><b>'+money(s.total,c)+'</b></div><small>'+s.valuedCopies+' di '+s.copies+' copie valutate</small></div>'+
    '<div class="summary-grid"><div class="stat"><b>'+money(s.byGame.pokemon.value,c)+'</b><small>Pokémon • '+s.byGame.pokemon.copies+' copie</small></div><div class="stat"><b>'+money(s.byGame.yugioh.value,c)+'</b><small>Yu-Gi-Oh! • '+s.byGame.yugioh.copies+' copie</small></div><div class="stat"><b>'+s.copies+'</b><small>copie totali • '+s.uniquePrintings+' stampe</small></div><div class="stat"><b>'+s.unreliable.length+'</b><small>senza valutazione affidabile</small></div></div>'+
    '<details><summary>Per condizione</summary>'+conditionRows+'</details>'+
    '<details><summary>Carte gradate</summary><div class="metric"><span>Gradate</span><span>'+gradedLine+'</span></div><div class="value-note">Il valore delle gradate è quello della loro condizione: non applico moltiplicatori di società di grading.</div></details>'+
    '<details><summary>Affidabilità dei valori</summary>'+kinds+'<div class="value-note">Ogni copia è valutata nella sua condizione. Le valute non vengono mai mescolate né convertite: i valori sono in '+esc(c)+'.</div></details>'+
    (unreliable?'<details><summary>Copie senza valutazione affidabile ('+s.unreliable.length+')</summary>'+unreliable+(s.unreliable.length>25?'<div class="value-note">…e altre '+(s.unreliable.length-25)+'.</div>':"")+'</details>':"");
}
function collectionSorter(sort,valuations){
  const value=cp=>{const v=valuations.get(cp.id);return v&&v.value!=null?v.value:null};
  const nullsLast=(a,b,dir)=>{if(a==null&&b==null)return 0;if(a==null)return 1;if(b==null)return-1;return dir*(a-b)};
  const rank=cp=>cp.condition==="NS"?null:conditionRank(cp.condition);
  switch(sort){
    case"added-asc":return(a,b)=>String(a.createdAt).localeCompare(String(b.createdAt));
    case"value-desc":return(a,b)=>nullsLast(value(a),value(b),-1);
    case"value-asc":return(a,b)=>nullsLast(value(a),value(b),1);
    case"condition-best":return(a,b)=>nullsLast(rank(a),rank(b),1);
    case"condition-worst":return(a,b)=>nullsLast(rank(a),rank(b),-1);
    case"name-asc":return(a,b)=>String(a.name||"").localeCompare(String(b.name||""),"it");
    case"name-desc":return(a,b)=>String(b.name||"").localeCompare(String(a.name||""),"it");
    case"number-asc":return(a,b)=>String(a.collectionNumber||"").localeCompare(String(b.collectionNumber||""),"it",{numeric:true});
    case"number-desc":return(a,b)=>String(b.collectionNumber||"").localeCompare(String(a.collectionNumber||""),"it",{numeric:true});
    case"grade-desc":return(a,b)=>nullsLast(a.gradeValue==null?null:Number(a.gradeValue),b.gradeValue==null?null:Number(b.gradeValue),-1);
    case"grade-asc":return(a,b)=>nullsLast(a.gradeValue==null?null:Number(a.gradeValue),b.gradeValue==null?null:Number(b.gradeValue),1);
    default:return(a,b)=>String(b.createdAt).localeCompare(String(a.createdAt));
  }
}
async function renderCollection(){
  const rows=await listCopies(),stats=await collectionStats(),currency=colState.currency;
  $("#collectionStats").innerHTML='<div class="stat"><b>'+stats.unique+'</b><small>stampe</small></div><div class="stat"><b>'+stats.copies+'</b><small>copie</small></div><div class="stat"><b>'+stats.pokemon+'/'+stats.yugioh+'</b><small>PKM / YGO</small></div>';
  const pricesByPrinting=await pricesForPrintings(rows),summary=summarizeCollection(rows,pricesByPrinting,currency),valuations=summary.details,byId=new Map(rows.map(r=>[r.id,r]));
  $("#collectionSummary").innerHTML=summaryHtml(summary,byId);
  if(rows.length){
    // Snapshot giornaliero del valore (uno per giorno e valuta; i giorni precedenti restano): base per un grafico nel tempo.
    try{await saveValueHistory(currency,mergeSnapshot(await loadValueHistory(currency),snapshotFromSummary(summary)))}catch(e){console.warn("Storico valore non salvato",e)}
  }
  const setText=colState.set.trim().toLowerCase(),variantText=colState.variant.trim().toLowerCase();
  let list=rows.filter(cp=>{
    if(colState.game!=="all"&&cp.game!==colState.game)return false;
    if(colState.condition!=="all"&&cp.condition!==colState.condition)return false;
    if(colState.graded==="graded"&&!isGraded(cp))return false;
    if(colState.graded==="ungraded"&&isGraded(cp))return false;
    if(colState.language!=="all"&&(cp.language||"")!==colState.language)return false;
    if(setText&&!String(cp.setName||cp.setCode||"").toLowerCase().includes(setText))return false;
    if(variantText&&!String(cp.variant||"").toLowerCase().includes(variantText))return false;
    return true;
  });
  list.sort(collectionSorter(colState.sort,valuations));
  $("#collectionList").innerHTML=list.map(r=>{
    const card=encodeURIComponent(JSON.stringify(r)),v=valuations.get(r.id),valueLine=v&&v.value!=null?'<span class="card-price">'+money(v.value,currency)+' • '+esc(VALUATION_LABELS[v.kind])+'</span>':'<span class="card-price">'+esc(VALUATION_LABELS[v?v.kind:"none"])+'</span>';
    return '<article class="card-row" data-card="'+card+'">'+cardImage(r)+'<div><h3>'+esc(r.name)+'</h3><p>'+esc(r.collectionNumber)+' • '+esc(r.setName)+(r.language?' • '+esc(languageLabel(r.language)):"")+(r.variant?' • '+esc(variantLabel(r.variant)):"")+'</p><div>'+copyBadges(r,null)+'</div>'+valueLine+'</div><button data-remove="'+esc(r.id)+'" aria-label="Rimuovi copia">×</button></article>';
  }).join("")||'<div class="notice">'+(rows.length?"Nessuna copia con questi filtri.":"La collezione è vuota.")+'</div>';
  bindCards($("#collectionList"));$$("[data-remove]").forEach(b=>b.onclick=async e=>{e.stopPropagation();await removeCopy(b.dataset.remove);renderCollection()});
}
function bindCollectionControls(){
  const wire=(id,key,event="onchange")=>{const el=$("#"+id);if(!el)return;el[event]=()=>{colState[key]=el.value;renderCollection()}};
  wire("colGame","game");wire("colCondition","condition");wire("colGraded","graded");wire("colLanguage","language");wire("colSort","sort");
  let timer;const text=(id,key)=>{const el=$("#"+id);if(!el)return;el.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{colState[key]=el.value;renderCollection()},220)}};
  text("colSet","set");text("colVariant","variant");
  const cur=$("#colCurrency");if(cur){cur.value=colState.currency;cur.onchange=async()=>{colState.currency=cur.value;await setSetting("displayCurrency",cur.value);renderCollection()}}
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
  initImageFallbacks();
  await openDB();$("#dbStatus").textContent="database locale pronto";
  // Migrazione sicura delle copie esistenti (condizione per singola copia): non cancella nulla e non assegna Near Mint alle copie senza condizione.
  try{await migrateCollection()}catch(e){console.warn("Migrazione collezione non completata",e)}
  const freshness=await loadDatabaseFreshness();
  $("#searchCondition").innerHTML='<option value="all">Qualsiasi condizione</option>'+conditionOptionsHtml("");
  $("#customCondition").innerHTML=conditionOptionsHtml("",{placeholder:true});
  $("#colCondition").innerHTML='<option value="all">Qualsiasi condizione</option>'+conditionOptionsHtml("");
  colState.currency=await setting("displayCurrency","EUR");bindCollectionControls();
  $$(".bottom-nav button").forEach(b=>b.onclick=()=>go(b.dataset.view));$$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  $$(".game-btn").forEach(b=>b.onclick=()=>{$$(".game-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#searchGame").value=b.dataset.game});
  $$(".album-game").forEach(b=>b.onclick=()=>{$$(".album-game").forEach(x=>x.classList.remove("active"));b.classList.add("active");albumGame=b.dataset.game;const pw=$("#albumPokemonLanguageWrap"),yw=$("#albumYugiohLanguageWrap");if(pw)pw.hidden=albumGame!=="pokemon";if(yw)yw.hidden=albumGame!=="yugioh";$("#setDetail").hidden=true;renderSets()});
  let timer;$("#searchInput").addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(doSearch,220)});$("#searchGame").onchange=doSearch;const searchLanguage=$("#searchLanguage");if(searchLanguage)searchLanguage.onchange=doSearch;$("#searchOwned").onchange=doSearch;$("#searchSort").onchange=doSearch;$("#searchCurrency").onchange=doSearch;$("#searchCondition").onchange=doSearch;$("#searchSet").oninput=doSearch;$("#searchRarity").oninput=doSearch;$("#refreshSets").onclick=()=>renderSets(true);
  $("#searchResults").addEventListener("click",e=>{const el=e.target.closest("[data-card]");if(el)openCard(JSON.parse(decodeURIComponent(el.dataset.card)))});
  const addCustom=$("#addCustomPrinting");if(addCustom)addCustom.onclick=addCustomPrinting;
  $("#cardDialog [data-close]").onclick=()=>$("#cardDialog").close();
  $("#exportBtn").onclick=downloadBackup;$("#exportAllBtn").onclick=downloadBackup;$("#historyBtn").onclick=()=>go("history");
  $("#importFile").onchange=async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;try{const result=await importBackup(JSON.parse(await f.text()));alert("Backup importato correttamente."+(result.scansInBackup&&!result.scansReplaced?"\nIl backup non conteneva foto valide: le scansioni già presenti sul dispositivo sono state mantenute.":""));location.reload()}catch(err){alert("Backup non valido: "+err.message)}};
  $("#clearCacheBtn").onclick=async()=>{await clear("catalogCache");alert("Cache catalogo svuotata.")};
  albumLanguage=await setting("albumPokemonLanguage",await setting("pokemonLanguage","it"));const albumLanguageEl=$("#albumPokemonLanguage");if(albumLanguageEl){albumLanguageEl.value=albumLanguage;albumLanguageEl.onchange=async e=>{albumLanguage=e.target.value;await setSetting("albumPokemonLanguage",albumLanguage);$("#setDetail").hidden=true;renderSets()}};
  albumYgoLanguage=await setting("albumYugiohLanguage","tcg");const albumYgoLanguageEl=$("#albumYugiohLanguage");if(albumYgoLanguageEl){albumYgoLanguageEl.value=albumYgoLanguage;albumYgoLanguageEl.onchange=async e=>{albumYgoLanguage=e.target.value;await setSetting("albumYugiohLanguage",albumYgoLanguage);$("#setDetail").hidden=true;renderSets()}};
  const pokemonLanguageEl=$("#pokemonLanguage");if(pokemonLanguageEl){pokemonLanguageEl.value=await setting("pokemonLanguage","it");pokemonLanguageEl.onchange=async e=>{await setSetting("pokemonLanguage",e.target.value);albumLanguage=e.target.value;if(albumLanguageEl)albumLanguageEl.value=albumLanguage;await setSetting("albumPokemonLanguage",albumLanguage)}};
  $("#autoCapture").checked=await setting("autoCapture",true);$("#autoCapture").onchange=e=>setSetting("autoCapture",e.target.checked);
  $("#versionInfo").innerHTML="App "+APP_VERSION+" • DB "+DATABASE_VERSION+" • Grading "+GRADING_ALGORITHM_VERSION+" • Price engine "+PRICE_ENGINE_VERSION+"<br>Pokémon aggiornato: "+(freshness.pokemon&&freshness.pokemon.updatedAt?new Date(freshness.pokemon.updatedAt).toLocaleString("it-IT"):"dato non disponibile")+"<br>Yu-Gi-Oh! aggiornato: "+(freshness.yugioh&&freshness.yugioh.updatedAt?new Date(freshness.yugioh.updatedAt).toLocaleString("it-IT"):"dato non disponibile");
  initScanner({onCardIdentified:openCard});
  const hash=location.hash.slice(1);if(["home","search","album","collection","scanner","history","settings"].includes(hash))go(hash);
  window.addEventListener("hashchange",()=>{const v=location.hash.slice(1);if(["home","search","album","collection","scanner","history","settings"].includes(v))go(v)});
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("#installBtn").hidden=false});
  $("#installBtn").onclick=async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;$("#installBtn").hidden=true}};
}
initPwaUpdater().catch(console.warn);
boot().catch(e=>{$("#dbStatus").textContent="errore locale";console.error(e)});
