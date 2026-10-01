import{conditionRank,conditionCoefficient,normalizeCondition,isSpecified,UNSPECIFIED_CONDITION}from"./conditions.js";
import{reliability}from"./prices.js";

// Valutazione di ogni SINGOLA copia in base alla sua condizione. Nessun prezzo viene inventato:
//  1. prezzo reale della stessa stampa/variante/valuta E stessa condizione ("exact");
//  2. prezzo reale della stessa stampa in una condizione vicina ("nearby", valore derivato);
//  3. solo come ultima risorsa, prezzo di riferimento x coefficiente di condizione ("estimated").
// Le valute non vengono mai mescolate: ogni valutazione usa solo prezzi nella valuta richiesta.

const PRIORITY={market:1,trend:2,mid:3,set_price:4,low:5,average:6,high:7,direct_low:8};
const LEVELS=["BASSA","MEDIA","ALTA"];
function lowerLevel(label){const i=LEVELS.indexOf(label);return LEVELS[Math.max(0,(i<0?1:i)-1)]}
function rowValue(row){const n=Number(row&&row.value);return Number.isFinite(n)&&n>0?n:null}
function variantKey(v){const k=String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");return k==="base"||k==="normal"||k==="unlimited"?"normal":k}
function variantOk(row,copy){const a=variantKey(copy&&copy.variant),b=variantKey(row&&row.variant);return !a||!b||a===b}
function byPriority(a,b){return (PRIORITY[a.priceType]||99)-(PRIORITY[b.priceType]||99)}
// Condizione dichiarata dalla fonte per quel prezzo; null = la fonte non la indica.
function rowCondition(row){
  if(!row||row.condition==null||String(row.condition).trim()==="")return null;
  const code=normalizeCondition(row.condition).code;
  return code===UNSPECIFIED_CONDITION?null:code;
}
function priceSummary(row){return{source:row.source||null,priceType:row.priceType||null,timestamp:row.timestamp||null,variant:row.variant||null}}

export function valueCopy(copy,rows,currency="EUR"){
  const condition=copy&&copy.condition||UNSPECIFIED_CONDITION;
  const out={copyId:copy&&copy.id||null,currency,condition,value:null,kind:"none",source:null,priceType:null,timestamp:null,variant:null,confidence:null,priceCondition:null,referenceValue:null,referenceCondition:null,coefficient:null,note:""};
  const list=(Array.isArray(rows)?rows:[]).filter(r=>r&&r.currency===currency&&rowValue(r)&&variantOk(r,copy));
  // Prezzo di riferimento "Near Mint": quello esplicitamente NM, altrimenti quello senza condizione indicata.
  const references=list.filter(r=>{const c=rowCondition(r);return c===null||c==="NM"}).sort((a,b)=>{
    const ea=rowCondition(a)==="NM"?0:1,eb=rowCondition(b)==="NM"?0:1;
    return byPriority(a,b)||ea-eb;
  });
  const reference=references[0]||null;
  if(reference){out.referenceValue=rowValue(reference);out.referenceCondition=rowCondition(reference)||"NM"}
  if(!isSpecified(condition)){out.kind="unrated";out.note="Condizione non specificata: completala per valutare questa copia.";return out}

  const exact=list.filter(r=>rowCondition(r)===condition).sort(byPriority)[0];
  if(exact){
    return Object.assign(out,priceSummary(exact),{value:rowValue(exact),kind:"exact",priceCondition:condition,confidence:reliability(exact),note:"Prezzo reale per questa condizione."});
  }
  const rank=conditionRank(condition),nearby=list.filter(r=>{const c=rowCondition(r);return c&&c!==condition&&Math.abs(conditionRank(c)-rank)===1}).sort((a,b)=>byPriority(a,b))[0];
  if(nearby){
    return Object.assign(out,priceSummary(nearby),{value:rowValue(nearby),kind:"nearby",priceCondition:rowCondition(nearby),confidence:lowerLevel(reliability(nearby)),note:"Prezzo derivato: la fonte non ha la condizione esatta, usata una condizione vicina."});
  }
  const coeff=conditionCoefficient(condition);
  if(reference&&coeff){
    const note=condition==="NM"
      ?"Prezzo di riferimento: la fonte non indica la condizione, assunto come Near Mint."
      :"Stima tramite coefficiente di condizione (non è un prezzo osservato per questa condizione).";
    return Object.assign(out,priceSummary(reference),{value:rowValue(reference)*coeff.mid,kind:"estimated",priceCondition:rowCondition(reference),confidence:lowerLevel(reliability(reference)),coefficient:coeff,note});
  }
  out.note="Nessun prezzo disponibile per questa stampa nella valuta scelta.";
  return out;
}

export const VALUATION_LABELS={
  exact:"Prezzo reale",
  nearby:"Prezzo derivato",
  estimated:"Stima tramite condizione",
  unrated:"Non valutata",
  none:"Prezzo non disponibile"
};

function round2(n){return Math.round(n*100)/100}

export function summarizeCollection(copies,rowsByPrinting,currency="EUR"){
  const list=Array.isArray(copies)?copies:[],lookup=rowsByPrinting instanceof Map?rowsByPrinting:new Map();
  const summary={currency,copies:list.length,uniquePrintings:new Set(list.map(c=>c.printingId)).size,total:0,valuedCopies:0,
    byGame:{pokemon:{copies:0,value:0},yugioh:{copies:0,value:0}},byCondition:{},
    kinds:{exact:0,nearby:0,estimated:0,unrated:0,none:0},
    graded:{copies:0,value:0,averageGrade:null},unreliable:[],details:new Map()};
  let gradeSum=0,gradeCount=0;
  for(const copy of list){
    const valuation=valueCopy(copy,lookup.get(copy.printingId)||[],currency),value=valuation.value;
    summary.details.set(copy.id,valuation);
    summary.kinds[valuation.kind]=(summary.kinds[valuation.kind]||0)+1;
    const cond=copy.condition||UNSPECIFIED_CONDITION;
    if(!summary.byCondition[cond])summary.byCondition[cond]={copies:0,value:0};
    summary.byCondition[cond].copies++;
    const game=summary.byGame[copy.game]||(summary.byGame[copy.game]={copies:0,value:0});
    game.copies++;
    if(value!=null){
      summary.total+=value;summary.valuedCopies++;game.value+=value;summary.byCondition[cond].value+=value;
    }else summary.unreliable.push(copy.id);
    if(copy.gradingId||copy.gradeValue!=null){
      summary.graded.copies++;if(value!=null)summary.graded.value+=value;
      const g=Number(copy.gradeValue);if(Number.isFinite(g)){gradeSum+=g;gradeCount++}
    }
  }
  summary.total=round2(summary.total);
  summary.graded.value=round2(summary.graded.value);
  summary.graded.averageGrade=gradeCount?Math.round(gradeSum/gradeCount*10)/10:null;
  for(const g of Object.values(summary.byGame))g.value=round2(g.value);
  for(const c of Object.values(summary.byCondition))c.value=round2(c.value);
  return summary;
}

// Snapshot giornaliero del valore (struttura pronta per un grafico nel tempo). Chi lo salva usa
// un'unica voce per giorno e valuta, mantenendo tutti i giorni precedenti.
export function snapshotFromSummary(summary,date=new Date()){
  return{date:date.toISOString().slice(0,10),currency:summary.currency,total:summary.total,copies:summary.copies,valuedCopies:summary.valuedCopies,
    byGame:{pokemon:summary.byGame.pokemon.value,yugioh:summary.byGame.yugioh.value},
    byCondition:Object.fromEntries(Object.entries(summary.byCondition).map(([k,v])=>[k,{copies:v.copies,value:v.value}])),
    createdAt:date.toISOString()};
}
export function mergeSnapshot(history,snapshot,limit=730){
  const rows=Array.isArray(history)?history.filter(x=>x&&x.date&&x.date!==snapshot.date):[];
  rows.push(snapshot);
  rows.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  return rows.slice(-limit);
}
