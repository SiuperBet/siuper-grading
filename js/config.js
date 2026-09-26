export const APP_VERSION="0.1.8";
export const DATABASE_VERSION=1;
export const GRADING_ALGORITHM_VERSION="0.2.0";
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
