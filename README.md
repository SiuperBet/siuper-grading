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

Versioni correnti:
- APP_VERSION: 0.3.0
- DATABASE_VERSION: 1
- GRADING_ALGORITHM_VERSION: 0.4.0
- PRICE_ENGINE_VERSION: 0.2.0

## Grading fotografico
- acquisizione fronte e retro con controllo qualità e prospettiva;
- correzione manuale dei quattro angoli;
- analisi separata di centering, corners, edges e surface;
- peso prudente del lato peggiore per angoli, bordi e superficie;
- confidenza basata anche sull'affidabilità del segnale di centering;
- esito `COMPLETO`, `ASSISTITO` o `PROVVISORIO`;
- checklist visiva per pieghe, ammaccature, strappi, acqua, alterazioni e whitening grave;
- cap automatici e manuali sui difetti severi;
- storico versionato, ricalcolo con algoritmo corrente ed eliminazione del singolo risultato.

Il risultato resta una stima fotografica non ufficiale: luce, olografie e difetti non visibili in foto richiedono sempre controllo fisico.
