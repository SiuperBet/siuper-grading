// Scala condizioni, alias delle fonti, coefficienti di stima e suggerimento dal grading.
// Modulo puro (nessun DOM, nessun database): tutti i valori configurabili sono qui.

export const UNSPECIFIED_CONDITION="NS";

export const CONDITIONS=[
  {code:"M",name:"Mint",label:"Mint (M)",description:"Praticamente perfetta, senza difetti visibili significativi."},
  {code:"NM",name:"Near Mint",label:"Near Mint (NM)",description:"Difetti minimi, quasi impercettibili."},
  {code:"EX",name:"Excellent",label:"Excellent (EX)",description:"Lievi segni di utilizzo."},
  {code:"LP",name:"Light Played",label:"Light Played (LP)",description:"Segni visibili ma contenuti."},
  {code:"MP",name:"Moderately Played",label:"Moderately Played (MP)",description:"Usura evidente."},
  {code:"PL",name:"Played",label:"Played (PL)",description:"Usura importante."},
  {code:"HP",name:"Heavily Played",label:"Heavily Played (HP)",description:"Fortemente usurata."},
  {code:"PR",name:"Poor",label:"Poor (PR)",description:"Danni importanti: pieghe, crease, strappi, macchie o altri difetti rilevanti."},
  {code:"DMG",name:"Damaged",label:"Damaged (DMG)",description:"Danni importanti: pieghe, crease, strappi, macchie o altri difetti rilevanti."}
];
export const UNSPECIFIED={code:UNSPECIFIED_CONDITION,name:"Non specificata",label:"Non specificata",description:"Condizione non indicata: la copia non viene valutata finché non la completi."};

const BY_CODE=new Map([...CONDITIONS,UNSPECIFIED].map((c,i)=>[c.code,Object.assign({rank:i},c)]));
export const CONDITION_CODES=new Set(BY_CODE.keys());

// Alias delle fonti (chiave: testo minuscolo senza spazi/punteggiatura). Il termine originale
// viene conservato a parte (conditionSource): qui serve solo per ricondurlo alla scala interna.
const ALIASES={
  m:"M",mt:"M",mint:"M",
  nm:"NM",nearmint:"NM",nmmint:"NM",nearmintmint:"NM",mintnearmint:"NM",nmm:"NM",
  ex:"EX",excellent:"EX",exnm:"EX",
  lp:"LP",lightplayed:"LP",lightlyplayed:"LP",slightlyplayed:"LP",sp:"LP",slightplay:"LP",
  gd:"LP",good:"LP",
  mp:"MP",moderatelyplayed:"MP",moderateplayed:"MP",moderatelyplay:"MP",
  pl:"PL",pld:"PL",played:"PL",
  hp:"HP",heavilyplayed:"HP",heavyplayed:"HP",hvy:"HP",
  pr:"PR",po:"PR",poor:"PR",
  dmg:"DMG",dam:"DMG",damaged:"DMG",damage:"DMG",
  ns:UNSPECIFIED_CONDITION,unspecified:UNSPECIFIED_CONDITION,nonspecificata:UNSPECIFIED_CONDITION,nd:UNSPECIFIED_CONDITION
};
// Termini che non coincidono esattamente con un grado della nostra scala.
const APPROXIMATE=new Set(["gd","good","sp","slightlyplayed","slightplay","exnm","mintnearmint","nearmintmint"]);

function aliasKey(value){return String(value==null?"":value).toLowerCase().replace(/[^a-z0-9]/g,"")}

export function normalizeCondition(raw){
  if(raw==null||String(raw).trim()==="")return{code:UNSPECIFIED_CONDITION,matched:false,approximate:false,original:null};
  const key=aliasKey(raw),code=ALIASES[key];
  if(code)return{code,matched:true,approximate:APPROXIMATE.has(key),original:String(raw)};
  return{code:UNSPECIFIED_CONDITION,matched:false,approximate:false,original:String(raw)};
}
export function conditionInfo(code){return BY_CODE.get(code)||UNSPECIFIED}
export function conditionLabel(code){return conditionInfo(code).label}
export function conditionName(code){return conditionInfo(code).name}
export function conditionRank(code){const c=BY_CODE.get(code);return c?c.rank:BY_CODE.size}
export function isSpecified(code){return Boolean(code)&&code!==UNSPECIFIED_CONDITION&&BY_CODE.has(code)}

// Coefficienti rispetto al prezzo di riferimento Near Mint. Indicativi e configurabili: vengono usati
// SOLO quando non esiste un prezzo reale per la condizione (vedi valuation.js).
export const CONDITION_COEFFICIENTS={
  M:[1.05,1.20],
  NM:[1,1],
  EX:[0.85,0.95],
  LP:[0.70,0.85],
  MP:[0.50,0.70],
  PL:[0.35,0.55],
  HP:[0.15,0.40],
  PR:[0.05,0.20],
  DMG:[0.05,0.20]
};
export function conditionCoefficient(code){
  const range=CONDITION_COEFFICIENTS[code];
  if(!range)return null;
  return{low:range[0],high:range[1],mid:(range[0]+range[1])/2};
}

// Il voto numerico e la condizione commerciale NON sono sinonimi: questa è solo una stima.
const GRADE_BANDS=[[9.5,"M"],[8.5,"NM"],[7.5,"EX"],[6.5,"LP"],[5,"MP"],[4,"PL"],[2.5,"HP"],[1.5,"PR"],[0,"DMG"]];
export function suggestCondition(grading){
  if(!grading||!Number.isFinite(Number(grading.finalGrade)))return null;
  const grade=Number(grading.finalGrade);
  let index=GRADE_BANDS.findIndex(b=>grade>=b[0]);if(index<0)index=GRADE_BANDS.length-1;
  const code=GRADE_BANDS[index][1];
  let confidence=Number.isFinite(Number(grading.confidence))?Number(grading.confidence):50;
  // Vicino al confine tra due fasce la stima è meno affidabile.
  const lower=GRADE_BANDS[index][0],upper=index>0?GRADE_BANDS[index-1][0]:null;
  const margin=upper==null?grade-lower:Math.min(grade-lower,upper-grade);
  if(margin<0.25)confidence-=8;
  confidence=Math.max(10,Math.min(95,Math.round(confidence)));
  return{code,confidence,grade,basedOnGradingConfidence:grading.confidence==null?null:Number(grading.confidence)};
}
