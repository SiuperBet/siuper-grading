export const APP_VERSION="0.1.0";
export const DATABASE_VERSION=1;
export const GRADING_ALGORITHM_VERSION="0.1.0";
export const PRICE_ENGINE_VERSION="0.1.0";
export const DB_NAME="siuper-grading";
export const DB_SCHEMA_VERSION=1;

export const SOURCES={
  pokemon:{name:"TCGdex",base:"https://api.tcgdex.net/v2"},
  yugioh:{name:"YGOPRODeck",base:"https://db.ygoprodeck.com/api/v7"}
};

export const CONDITION_ESTIMATES={
  NM:[1,1],
  LP:[0.70,0.85],
  MP:[0.40,0.70],
  HP:[0.15,0.40],
  DAMAGED:[0.05,0.20]
};

export const GRADING_CONFIG={
  weights:{centering:.30,corners:.25,edges:.25,surface:.20},
  minPhotoConfidence:.35,
  severeDefectCaps:{crease:6,majorCorner:6.5,majorSurface:6},
  professionalDisclaimer:"Questa è una stima fotografica non ufficiale e non sostituisce una valutazione fisica effettuata da un grading service."
};
