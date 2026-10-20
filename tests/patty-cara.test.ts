import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PATTY_ARIA_LABEL, PattyCara } from "@/components/patty-cara";
import { PattyCara as PattyCaraLanding } from "@/components/marketing/v2/patty-cara";
import { avisoDeAgenda, esLecturaDePatty } from "@/lib/messaging/aviso-de-agenda";

// La cara de Patty (imagen generada con IA, no una persona real) se comparte
// entre la app y la landing. Donde aparezca, la etiqueta "IA" va visible.

const SRC = path.resolve(__dirname, "../src");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = path.join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

describe("cara de Patty", () => {
  it("siempre lleva la etiqueta IA visible, en la app y en la landing", () => {
    for (const html of [
      renderToStaticMarkup(createElement(PattyCara, {})),
      renderToStaticMarkup(createElement(PattyCara, { px: 20, decorativa: true })),
      renderToStaticMarkup(createElement(PattyCaraLanding, { px: 88 })),
    ]) {
      expect(html).toMatch(/>IA<\/span>/);
      expect(html).not.toContain("sr-only");
    }
  });

  it("se anuncia como Patty, o queda oculta si el texto de al lado ya la nombra", () => {
    const conNombre = renderToStaticMarkup(createElement(PattyCara, {}));
    expect(conNombre).toContain('role="img"');
    expect(conNombre).toContain(`aria-label="${PATTY_ARIA_LABEL}"`);

    const decorativa = renderToStaticMarkup(createElement(PattyCara, { decorativa: true }));
    expect(decorativa).toMatch(/^<span aria-hidden="true"/);
    expect(decorativa).not.toContain("role=");
  });

  it("tamaño fijo, dos resoluciones y carga diferida por defecto", () => {
    const html = renderToStaticMarkup(createElement(PattyCara, { px: 28 }));
    expect(html).toContain("width:28px;height:28px");
    expect(html).toContain('width="28" height="28"');
    expect(html).toContain("cara-128.webp 128w, /brand/patty/cara-256.webp 256w");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt=""');
  });

  it("en la app usa los tokens ai; en la landing, las clases de landing-v2.css", () => {
    const app = renderToStaticMarkup(createElement(PattyCara, {}));
    expect(app).toContain("bg-ai-soft");
    expect(app).not.toContain("lv-patty-cara");

    const landing = renderToStaticMarkup(createElement(PattyCaraLanding, { px: 26 }));
    expect(landing).toContain('class="lv-patty-cara chica"');
    expect(landing).toContain('class="ia"');
    expect(landing).not.toContain("bg-ai-soft");
  });

  it("solo la landing importa landing-v2.css", () => {
    const conCss = archivos(SRC)
      .filter((r) => /\.(tsx?|css)$/.test(r))
      .filter((r) => /(?:import|@import)[^;\n]*landing-v2\.css/.test(readFileSync(r, "utf8")))
      .map((r) => path.relative(SRC, r));
    expect(conCss).toEqual([path.join("routes", "index.tsx")]);
  });
});

describe("aviso de agenda leído por Patty", () => {
  it("la campana reconoce solo el prefijo que escribe la lectura de la IA", () => {
    const lectura = { intencion: "agendar", fecha: null, franja: null } as const;
    expect(esLecturaDePatty(avisoDeAgenda(lectura, "ia").detalle)).toBe(true);
    expect(esLecturaDePatty(avisoDeAgenda(lectura, "reglas").detalle)).toBe(false);
    expect(esLecturaDePatty(null)).toBe(false);
  });
});
