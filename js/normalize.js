export function stripDiacritics(value=""){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
export function normalizeName(value=""){return stripDiacritics(String(value)).toLowerCase().replace(/[’']/g,"").replace(/[^\p{L}\p{M}\p{N}]+/gu," ").trim().replace(/\s+/g," ").normalize("NFC")}
export function normalizeSetCode(value=""){return stripDiacritics(String(value)).toUpperCase().replace(/[^A-Z0-9]/g,"")}
export function normalizeSetCodeLoose(value=""){
  const raw=stripDiacritics(String(value)).toUpperCase().replace(/[^A-Z0-9-]/g,"");
  const m=raw.match(/^([A-Z]{2,8})-?(?:EN|E|IT|FR|DE|PT|JP|JPS|SC|TC|KR)?-?(\d{1,5})$/);
  return m?m[1]+String(Number(m[2])):normalizeSetCode(value);
}
export function canonicalNumberToken(value=""){
  const clean=String(value).toUpperCase().replace(/[^A-Z0-9]/g,"");
  const m=clean.match(/^([A-Z]*)(\d+)$/);
  return m?m[1]+String(Number(m[2])):clean;
}
export function parseCollectionNumber(value=""){
  const raw=String(value==null?"":value).trim().toUpperCase().replace(/\s+/g,"");
  const parts=raw.split("/");
  const clean=v=>v.replace(/[^A-Z0-9]/g,"");
  return {rawNumber:raw,normalizedPrimary:clean(parts[0]||""),normalizedTotal:clean(parts[1]||"")};
}
export function normalizeCollectionNumber(value=""){const p=parseCollectionNumber(value);return p.normalizedTotal?p.normalizedPrimary+"/"+p.normalizedTotal:p.normalizedPrimary}
export function normalizeSearchQuery(value=""){
  const raw=String(value==null?"":value).trim();
  const compact=normalizeSetCode(raw);
  const number=parseCollectionNumber(raw);
  const looksSetCode=/^[a-z]{2,8}[-\s]?(?:en|e|it|fr|de|pt|jp|jps|sc|tc|kr)?\d{1,5}$/i.test(raw);
  const looksNumber=/^(?:[a-z]{0,8})?\d{1,5}(?:\/(?:[a-z]{0,8})?\d{1,5})?$/i.test(raw.replace(/\s/g,""));
  return {raw:raw,name:normalizeName(raw),compact:compact,number:number,looksSetCode:looksSetCode,looksNumber:looksNumber};
}
function tokenParts(v=""){const m=String(v).toUpperCase().match(/^([A-Z]*)(\d+)(.*)$/);return m?[m[1],Number(m[2]),m[3]]:[String(v).toUpperCase(),Number.MAX_SAFE_INTEGER,""]}
export function compareCardNumbers(a,b){
  const pa=parseCollectionNumber(a),pb=parseCollectionNumber(b);
  const aa=tokenParts(pa.normalizedPrimary),bb=tokenParts(pb.normalizedPrimary);
  return aa[0].localeCompare(bb[0])||aa[1]-bb[1]||aa[2].localeCompare(bb[2])||pa.normalizedTotal.localeCompare(pb.normalizedTotal);
}
export function scoreMatch(card,query){
  const q=typeof query==="string"?normalizeSearchQuery(query):query;
  const name=normalizeName(card.name),aliases=(Array.isArray(card.aliases)?card.aliases:[]).map(normalizeName).filter(Boolean),num=normalizeCollectionNumber(card.collectionNumber||card.number),code=normalizeSetCode(card.setCode||"");
  const looseCode=normalizeSetCodeLoose(card.setCode||""),qLoose=normalizeSetCodeLoose(q.raw);
  const cardNum=parseCollectionNumber(num),primaryEq=canonicalNumberToken(cardNum.normalizedPrimary)===canonicalNumberToken(q.number.normalizedPrimary);
  const cardTotal=canonicalNumberToken(cardNum.normalizedTotal||card.printedTotal||""),qTotal=canonicalNumberToken(q.number.normalizedTotal||"");
  let s=0;
  if(q.compact&&code===q.compact)s+=100;
  else if(q.looksSetCode&&qLoose&&looseCode===qLoose)s+=90;
  if(q.number.normalizedPrimary&&num===normalizeCollectionNumber(q.raw))s+=95;
  else if(q.number.normalizedPrimary&&primaryEq&&qTotal&&cardTotal===qTotal)s+=92;
  else if(q.number.normalizedPrimary&&primaryEq)s+=70;
  if(q.name&&name===q.name)s+=85;
  else if(q.name&&aliases.includes(q.name))s+=82;
  else if(q.name&&name.includes(q.name))s+=45;
  else if(q.name&&aliases.some(x=>x.includes(q.name)))s+=43;
  if(q.compact&&code.includes(q.compact)&&code!==q.compact)s+=55;
  return s;
}
