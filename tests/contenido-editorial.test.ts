import { describe, expect, it } from "vitest";

import { archivoDe, todasLasPaginas } from "@/content";

// Guardia de las páginas editoriales (src/content/paginas/). Lo que se
// controla acá es lo que un error rompería en silencio: un path que no
// coincide con su archivo (404), un enlace interno a una página que no
// existe, un title o description fuera de largo, o una guía normativa
// publicada sin revisor profesional.

const RUTAS_FIJAS = new Set([
  "/",
  "/precios",
  "/faq",
  "/demo",
  "/auth",
  "/nosotros",
  "/estado",
  "/docs",
  "/docs/primeros-pasos",
  "/docs/migrar-desde-otro-sistema",
  "/docs/whatsapp",
  "/docs/portal-pacientes",
  "/docs/datos-y-seguridad",
  "/software-dental-latam",
  "/calculadora-rentabilidad-dental",
  "/recursos",
  "/recursos/fugas-clinica-dental",
  "/funciones",
  "/comparar",
  "/privacidad",
  "/terminos",
  "/dpa",
]);

const ENLACE_INTERNO = /\]\((\/[^)#\s]*)/g;

describe("contenido editorial", async () => {
  const paginas = await todasLasPaginas();
  const publicadas = paginas.filter((p) => !p.borrador);
  const pathsPublicados = new Set(publicadas.map((p) => p.path));

  it("hay páginas registradas", () => {
    expect(paginas.length).toBeGreaterThan(0);
  });

  it.each(paginas.map((p) => [p.path, p] as const))("%s: forma y largos", (_path, p) => {
    expect(archivoDe(p.path)).toMatch(/^\.\/paginas\/[a-z0-9-]+\.ts$/);
    expect(p.titulo.length).toBeLessThanOrEqual(70);
    expect(p.titulo).toMatch(/\| Esmalia$/);
    expect(p.descripcion.length).toBeGreaterThanOrEqual(100);
    expect(p.descripcion.length).toBeLessThanOrEqual(170);
    expect(p.resumen.split(/\s+/).length).toBeLessThanOrEqual(90);
    expect(p.secciones.length).toBeGreaterThan(0);
    expect(p.actualizado >= p.publicado).toBe(true);
  });

  it("los paths no se repiten", () => {
    expect(new Set(paginas.map((p) => p.path)).size).toBe(paginas.length);
  });

  it("ningún texto nombra la marca vieja", () => {
    const conMarcaVieja = paginas
      .filter((p) => new RegExp(["al", "ika"].join(""), "i").test(JSON.stringify(p)))
      .map((p) => p.path);
    expect(conMarcaVieja).toEqual([]);
  });

  it("los enlaces internos y los relacionados de páginas publicadas existen", () => {
    const rotos: string[] = [];
    for (const p of publicadas) {
      const texto = JSON.stringify(p);
      for (const m of texto.matchAll(ENLACE_INTERNO)) {
        const destino = m[1].replace(/\/$/, "") || "/";
        if (!RUTAS_FIJAS.has(destino) && !pathsPublicados.has(destino)) {
          rotos.push(`${p.path} → ${destino}`);
        }
      }
      for (const r of p.relacionados ?? []) {
        if (!RUTAS_FIJAS.has(r) && !pathsPublicados.has(r)) rotos.push(`${p.path} → ${r}`);
      }
    }
    expect(rotos).toEqual([]);
  });

  it("una guía publicada lleva revisor profesional o no es normativa", () => {
    // Las guías normativas (ley, ficha, impuestos) se publican solo con revisor.
    const NORMATIVA = /ley|decreto|sii|afip|arca|honorarios|ficha cl[ií]nica|historia cl[ií]nica/i;
    const sinRevisor = publicadas
      .filter((p) => p.coleccion === "guias" && NORMATIVA.test(p.h1) && !p.revisor)
      .map((p) => p.path);
    expect(sinRevisor).toEqual([]);
  });

  it("las comparativas citan fuentes", () => {
    const sinFuentes = publicadas
      .filter(
        (p) => (p.coleccion === "comparar" || p.coleccion === "alternativas") && !p.fuentes?.length,
      )
      .map((p) => p.path);
    expect(sinFuentes).toEqual([]);
  });
});
