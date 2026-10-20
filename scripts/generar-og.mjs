// Genera la imagen social (og:image / twitter:image) de 1200 × 630: wordmark
// de Esmalia + el claim de la landing, sobre papel. La dibuja Chromium para
// usar las mismas tipografías web que el sitio (Cormorant Garamond + Instrument Sans).
//
// Requiere Playwright instalado globalmente (npm i -g playwright && npx
// playwright install chromium); no es dependencia del repo a propósito.
// Uso, desde la raíz del repo:
//   node scripts/generar-og.mjs
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const raizGlobal = execSync("npm root -g").toString().trim();
const { chromium } = createRequire(join(raizGlobal, "/"))("playwright");

const SALIDA = resolve("public/landing/og-esmalia.png");
// En línea como data: URL, porque una página de setContent no puede leer file://.
const fuente = (paquete, archivo) =>
  `data:font/woff2;base64,${readFileSync(resolve("node_modules", paquete, "files", archivo)).toString("base64")}`;

// El wordmark con los colores fijos de la marca (tinta + arco ocre).
const wordmark = readFileSync(resolve("scripts/marca/esmalia-wordmark.svg"), "utf8");

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
@font-face { font-family: "Cormorant Garamond"; font-weight: 500; font-style: normal;
  src: url("${fuente("@fontsource/cormorant-garamond", "cormorant-garamond-latin-500-normal.woff2")}"); }
@font-face { font-family: "Cormorant Garamond"; font-weight: 500; font-style: italic;
  src: url("${fuente("@fontsource/cormorant-garamond", "cormorant-garamond-latin-500-italic.woff2")}"); }
@font-face { font-family: "Instrument Sans"; font-weight: 400 700;
  src: url("${fuente("@fontsource-variable/instrument-sans", "instrument-sans-latin-wght-normal.woff2")}"); }
html, body { margin: 0; }
body { width: 1200px; height: 630px; background: #f3f2f2; color: #201f1d;
  display: flex; flex-direction: column; justify-content: center; padding: 0 96px;
  box-sizing: border-box; position: relative; }
.logo svg { height: 104px; width: auto; display: block; }
h1 { font-family: "Cormorant Garamond"; font-weight: 500; font-size: 72px; line-height: 1.02;
  letter-spacing: -0.015em; margin: 48px 0 0; }
h1 em { color: #7d5411; }
p { font-family: "Instrument Sans"; font-size: 24px; color: #5b5853; margin: 28px 0 0; }
.filete { position: absolute; left: 96px; right: 96px; bottom: 56px; height: 1px; background: #d9d5cf; }
</style></head><body>
<div class="logo">${wordmark}</div>
<h1>Cada silla vacía<br><em>es plata que no vuelve.</em></h1>
<p>Software de gestión dental · Hecho para Latinoamérica</p>
<div class="filete"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: SALIDA, type: "png" });
await browser.close();
console.log(`OK ${SALIDA}`);
