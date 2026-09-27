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
  assert.match(indexSource,/css\/app\.css\?v=0\.3\.1/);
  assert.match(indexSource,/js\/app\.js\?v=0\.3\.1/);
});
