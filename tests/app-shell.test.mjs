import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const appSource=await readFile(new URL("../js/app.js",import.meta.url),"utf8");
const indexSource=await readFile(new URL("../index.html",import.meta.url),"utf8");

test("i pulsanti album sono collegati tramite querySelectorAll",()=>{
  assert.match(appSource,/\$\$\("\.album-game"\)\.forEach/);
  assert.doesNotMatch(appSource,/(?<!\$)\$\("\.album-game"\)\.forEach/);
});

test("la shell carica gli asset della versione corrente",()=>{
  assert.match(indexSource,/css\/app\.css\?v=0\.4\.0/);
  assert.match(indexSource,/js\/app\.js\?v=0\.4\.0/);
});

test("lo scanner offre la galleria (senza capture) e la fotocamera",()=>{
  const gallery=indexSource.match(/<input id="photoFile"[^>]*>/);
  assert.ok(gallery,"input galleria mancante");
  assert.doesNotMatch(gallery[0],/capture/);
  assert.match(gallery[0],/image\/jpeg/);
  assert.match(gallery[0],/image\/png/);
  assert.match(gallery[0],/image\/webp/);
  assert.match(indexSource,/<input id="photoCapture"[^>]*capture="environment"/);
  assert.match(indexSource,/id="startCameraBtn"/);
});
