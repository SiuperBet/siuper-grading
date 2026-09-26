const CACHE="siuper-grading-shell-v9";
const SHELL=["./","./index.html","./css/app.css","./manifest.webmanifest","./assets/icon.svg","./js/config.js","./js/normalize.js","./js/db.js","./js/catalog.js","./js/collection.js","./js/scanner.js","./js/recognition.js","./js/grading.js","./js/prices.js","./js/mastersets.js","./js/price-history.js","./js/data/pokemon-adapter.js","./js/data/yugioh-adapter.js","./js/app.js"];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(SHELL.map(x=>c.add(x).catch(()=>null)))));
});

self.addEventListener("message",e=>{
  if(e.data&&e.data.type==="SKIP_WAITING")self.skipWaiting();
});

self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url);if(url.origin!==location.origin)return;
  const freshFirst=e.request.mode==="navigate"||/\.(?:html|js|css|json|webmanifest)$/.test(url.pathname);
  if(freshFirst){
    e.respondWith(fetch(e.request).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request)));
  }else{
    e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r})));
  }
});
