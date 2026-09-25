# Siuper Grading

PWA mobile-first, local-first e a costo 0 per Pokémon TCG e Yu-Gi-Oh!.

## Principi
- nessun account obbligatorio;
- collezione, scansioni e grading salvati in IndexedDB;
- catalogo statico aggiornabile con GitHub Actions;
- fonti separate tramite adapter;
- nessun prezzo inventato o media tra valute diverse;
- scanner e analisi client-side con fallback manuali;
- GitHub Pages come hosting statico.

## Fonti
- Pokémon: TCGdex REST API v2.
- Yu-Gi-Oh!: YGOPRODeck API v7.

Il repository nasce da zero il 25/09/2026. Non contiene codice riutilizzato da altri progetti.

Versioni iniziali:
- APP_VERSION: 0.1.0
- DATABASE_VERSION: 1
- GRADING_ALGORITHM_VERSION: 0.1.0
- PRICE_ENGINE_VERSION: 0.1.0
