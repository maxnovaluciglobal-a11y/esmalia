import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { SoloLecturaContext } from "@/hooks/use-solo-lectura";
import { EXPLICACION_BOTON_SOLO_LECTURA } from "@/lib/solo-lectura";

// UX-05 (Ola 0): una acción deshabilitada dice por qué, de forma visible en
// el celular y anunciada por el lector de pantalla (aria-describedby). Un
// `title` solo no cuenta: no se ve al tocar ni lo leen bien los lectores.

/** El texto del elemento con ese id (o null si no existe). */
function textoDelId(html: string, id: string): string | null {
  const re = new RegExp(`id="${id.replace(/[:]/g, "\\$&")}"[^>]*>([^<]*)<`);
  return re.exec(html)?.[1] ?? null;
}

/** Ids a los que apunta el `aria-describedby` del <button>. */
function describedByDelBoton(html: string): string[] {
  const boton = /<button[^>]*>/.exec(html)?.[0] ?? "";
  expect(boton).toContain("disabled");
  const ids = /aria-describedby="([^"]+)"/.exec(boton)?.[1];
  return ids ? ids.split(" ") : [];
}

const boton = () => createElement("button", { type: "button" }, "Guardar");

describe("AccionDeshabilitada", () => {
  it("sin motivo devuelve el botón tal cual, habilitado", () => {
    const html = renderToStaticMarkup(
      createElement(AccionDeshabilitada, { motivo: null }, boton()),
    );
    expect(html).toBe('<button type="button">Guardar</button>');
  });

  it("con motivo en texto: deshabilita, lo muestra y lo enlaza", () => {
    const motivo = "Falta el paciente.";
    const html = renderToStaticMarkup(createElement(AccionDeshabilitada, { motivo }, boton()));
    const ids = describedByDelBoton(html);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.map((id) => textoDelId(html, id))).toContain(motivo);
    expect(html).not.toContain("title=");
  });

  it("con motivo en globo: el botón lo anuncia y el envoltorio es enfocable", () => {
    const motivo = "Resuelve la revisión pendiente.";
    const html = renderToStaticMarkup(
      createElement(AccionDeshabilitada, { motivo, como: "globo" }, boton()),
    );
    const ids = describedByDelBoton(html);
    expect(ids.map((id) => textoDelId(html, id))).toContain(motivo);
    expect(html).toMatch(/<span[^>]*tabindex="0"[^>]*data-accion-deshabilitada/);
    expect(html).not.toContain("title=");
  });
});

describe("BloqueoEscritura", () => {
  const render = (soloLectura: boolean) =>
    renderToStaticMarkup(
      createElement(
        SoloLecturaContext.Provider,
        { value: soloLectura },
        createElement(BloqueoEscritura, null, boton()),
      ),
    );

  it("fuera de solo lectura no toca el botón", () => {
    expect(render(false)).toBe('<button type="button">Guardar</button>');
  });

  it("en solo lectura expone el motivo por aria-describedby, sin title", () => {
    const html = render(true);
    const ids = describedByDelBoton(html);
    expect(ids.map((id) => textoDelId(html, id))).toContain(EXPLICACION_BOTON_SOLO_LECTURA);
    expect(html).not.toContain("title=");
  });

  it("el componente no vuelve al title como única explicación", () => {
    const fuente = readFileSync(
      path.resolve(__dirname, "../src/components/solo-lectura.tsx"),
      "utf8",
    );
    expect(fuente).toContain("AccionDeshabilitada");
    expect(fuente).not.toMatch(/\btitle=\{/);
  });
});
