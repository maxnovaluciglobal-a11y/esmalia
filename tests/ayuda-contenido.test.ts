import { describe, expect, it } from "vitest";

import { LECCIONES } from "@/content/ayuda/academia";
import { articulosDeAyuda } from "@/content/ayuda/indice";
import { NOVEDADES } from "@/content/ayuda/novedades";
import { AYUDA_PANTALLAS } from "@/content/ayuda/pantallas";
import { AYUDA_PUESTA_EN_MARCHA } from "@/content/ayuda/puesta-en-marcha";
import { RECORRIDOS } from "@/content/ayuda/recorridos";
import type { Video } from "@/content/ayuda/tipos";
import { CLINIC_ROLES } from "@/lib/access/access";
import {
  leccionesVisibles,
  pistaDelRol,
  pistasVisibles,
  leccionesDeLaPista,
  ORDEN_PISTAS,
} from "@/lib/ayuda/academia";
import { buscarAyuda, palabrasDe, type ArticuloBuscable } from "@/lib/ayuda/buscador";
import { pantallaDeRuta, RUTA_DE_PANTALLA } from "@/lib/ayuda/pantalla-actual";
import { leerCaptura, rutaSinConsulta, bytesDeBase64 } from "@/lib/ayuda/reportes";

/**
 * Ola 12 (ONB-01/02/03/04/09/10, NAV-06/10): contenido y lógica pura de la
 * ayuda. Sin base ni red.
 */

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

function todosLosVideos(): { donde: string; video: Video }[] {
  return [
    ...AYUDA_PANTALLAS.map((p) => ({ donde: `pantalla ${p.id}`, video: p.video })),
    ...LECCIONES.map((l) => ({ donde: `lección ${l.id}`, video: l.video })),
    ...Object.entries(AYUDA_PUESTA_EN_MARCHA).map(([id, p]) => ({
      donde: `puesta en marcha ${id}`,
      video: p.video,
    })),
  ];
}

describe("buscador de la ayuda", () => {
  const art = (id: string, titulo: string, extra: Partial<ArticuloBuscable> = {}) =>
    ({
      id,
      tipo: "pantalla",
      titulo,
      resumen: "",
      texto: "",
      palabras: [],
      href: `/x/${id}`,
      ...extra,
    }) as ArticuloBuscable;

  const base = [
    art("caja", "Caja", { texto: "Cierra con el arqueo. Registra el pago desde la ficha." }),
    art("presupuestos", "Presupuestos", { resumen: "Sigue cada presupuesto." }),
    art("agenda", "Agenda", { palabras: ["turno", "cita"] }),
  ];

  it("no distingue tildes ni mayúsculas", () => {
    const r = buscarAyuda([art("a", "Cotización rápida")], "COTIZACION");
    expect(r.map((x) => x.articulo.id)).toEqual(["a"]);
  });

  it("ignora palabras vacías y exige cada palabra útil", () => {
    expect(palabrasDe("¿Cómo cierro la caja?")).toEqual(["cierro", "caja"]);
    expect(buscarAyuda(base, "cómo arqueo de la caja").map((x) => x.articulo.id)).toEqual(["caja"]);
    expect(buscarAyuda(base, "caja inexistente")).toEqual([]);
  });

  it("busca desde el comienzo de la palabra", () => {
    expect(buscarAyuda(base, "presu").map((x) => x.articulo.id)).toEqual(["presupuestos"]);
    // "aja" no está al comienzo de ninguna palabra de "Caja".
    expect(buscarAyuda(base, "aja")).toEqual([]);
  });

  it("usa sinónimos de clínica (abono → pago/cobro, cotización → presupuesto)", () => {
    expect(buscarAyuda(base, "cotizacion").map((x) => x.articulo.id)).toEqual(["presupuestos"]);
    expect(buscarAyuda(base, "abono").map((x) => x.articulo.id)).toEqual(["caja"]);
  });

  it("el título pesa más que el texto", () => {
    const r = buscarAyuda(
      [art("texto", "Otra cosa", { texto: "agenda" }), art("titulo", "Agenda")],
      "agenda",
    );
    expect(r.map((x) => x.articulo.id)).toEqual(["titulo", "texto"]);
  });

  it("consulta vacía no devuelve todo", () => {
    expect(buscarAyuda(base, "   ")).toEqual([]);
    expect(buscarAyuda(base, "de la")).toEqual([]);
  });

  it("encuentra las pantallas reales por lo que la gente escribe", () => {
    const arts = articulosDeAyuda("owner");
    const primero = (q: string) => buscarAyuda(arts, q)[0]?.articulo.id;
    expect(primero("cerrar caja")).toBe("pantalla-caja");
    expect(primero("cotización")).toBe("pantalla-presupuestos");
    expect(primero("reserva en línea")).toBe("pantalla-reserva-en-linea");
    expect(primero("permisos")).toBe("pantalla-equipo");
  });
});

describe("Academia: qué ve cada rol", () => {
  it("cada rol de la app cae en una pista", () => {
    for (const rol of CLINIC_ROLES) expect(pistaDelRol(rol)).not.toBeNull();
    expect(pistaDelRol(null)).toBeNull();
    expect(pistaDelRol("owner")).toBe("dueno");
    expect(pistaDelRol("admin")).toBe("dueno");
    expect(pistaDelRol("dentist")).toBe("profesional");
    expect(pistaDelRol("reception")).toBe("recepcion");
    expect(pistaDelRol("coordinator")).toBe("recepcion");
    expect(pistaDelRol("accounting")).toBe("recepcion");
    expect(pistaDelRol("assistant")).toBe("asistente");
    expect(pistaDelRol("lab_technician")).toBe("tecnico");
  });

  it("dueño y administración ven todas las pistas; el resto solo la suya", () => {
    expect(pistasVisibles("owner")).toEqual([...ORDEN_PISTAS]);
    expect(pistasVisibles("admin")).toEqual([...ORDEN_PISTAS]);
    expect(pistasVisibles("reception")).toEqual(["recepcion"]);
    expect(pistasVisibles("dentist")).toEqual(["profesional"]);
    expect(pistasVisibles(null)).toEqual([]);
  });

  it("recepción no ve lecciones del dueño ni del profesional; sí las básicas", () => {
    const ids = leccionesVisibles(LECCIONES, "reception").map((l) => l.id);
    expect(ids).toContain("primer-dia");
    expect(ids).toContain("recepcion-cobrar");
    expect(ids).not.toContain("dueno-numeros");
    expect(ids).not.toContain("profesional-ficha");
  });

  it("el técnico ve sus órdenes y el inventario compartido con asistente", () => {
    const ids = leccionesVisibles(LECCIONES, "lab_technician").map((l) => l.id);
    expect(ids).toContain("tecnico-ordenes");
    expect(ids).toContain("asistente-inventario");
    expect(ids).not.toContain("recepcion-cobrar");
  });

  it("toda pista tiene al menos una lección propia y el dueño las ve todas", () => {
    for (const p of ORDEN_PISTAS)
      expect(leccionesDeLaPista(LECCIONES, p).length).toBeGreaterThan(0);
    expect(leccionesVisibles(LECCIONES, "owner")).toHaveLength(LECCIONES.length);
  });

  it("el buscador no encuentra lecciones de otra pista", () => {
    const arts = articulosDeAyuda("reception").filter((a) => a.tipo === "leccion");
    expect(arts.some((a) => a.id === "leccion-dueno-numeros")).toBe(false);
    expect(arts.some((a) => a.id === "leccion-recepcion-cobrar")).toBe(true);
  });
});

describe("contenido de la ayuda", () => {
  it("ids estables y únicos (se guardan como progreso)", () => {
    for (const lista of [LECCIONES.map((l) => l.id), NOVEDADES.map((n) => n.id)]) {
      expect(new Set(lista).size).toBe(lista.length);
      for (const id of lista) expect(id).toMatch(ID);
    }
    const pantallas = AYUDA_PANTALLAS.map((p) => p.id);
    expect(new Set(pantallas).size).toBe(pantallas.length);
  });

  it("todo video está pendiente o tiene un enlace https real (nunca uno inventado)", () => {
    for (const { donde, video } of todosLosVideos()) {
      expect(video.guion.length, donde).toBeGreaterThan(20);
      expect(video.duracion, donde).toMatch(/^\d+ min$/);
      if (video.estado === "listo") expect(video.url, donde).toMatch(/^https:\/\//);
    }
  });

  it("cada pantalla tiene ayuda breve: 2 a 6 pasos", () => {
    for (const p of AYUDA_PANTALLAS) {
      expect(p.pasos.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.pasos.length, p.id).toBeLessThanOrEqual(6);
    }
  });

  it("cada recorrido es de una pantalla con ayuda y tiene 2 a 5 pasos", () => {
    const pantallas = new Set(AYUDA_PANTALLAS.map((p) => p.id));
    for (const r of RECORRIDOS) {
      expect(pantallas.has(r.id), r.id).toBe(true);
      expect(r.pasos.length).toBeGreaterThanOrEqual(2);
      expect(r.pasos.length).toBeLessThanOrEqual(5);
    }
  });

  it("novedades de la más nueva a la más vieja, con fecha válida", () => {
    const fechas = NOVEDADES.map((n) => n.fecha);
    for (const f of fechas) expect(f).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([...fechas].sort().reverse()).toEqual(fechas);
  });
});

describe("pantalla actual", () => {
  it("reconoce las pantallas principales y distingue la ficha", () => {
    expect(pantallaDeRuta("/dashboard")).toBe("hoy");
    expect(pantallaDeRuta("/agenda")).toBe("agenda");
    expect(pantallaDeRuta("/pacientes")).toBe("pacientes");
    expect(pantallaDeRuta("/pacientes/0b9c1e3a-1111-4222-8333-444455556666")).toBe("ficha");
    expect(pantallaDeRuta("/presupuestos/abc")).toBe("presupuestos");
    expect(pantallaDeRuta("/caja")).toBe("caja");
    expect(pantallaDeRuta("/cajas")).toBe("caja");
    expect(pantallaDeRuta("/reportes")).toBe("informes");
    expect(pantallaDeRuta("/ayuda")).toBeNull();
    expect(pantallaDeRuta("/")).toBeNull();
  });

  it("toda pantalla con ayuda tiene a dónde practicar", () => {
    for (const p of AYUDA_PANTALLAS) expect(RUTA_DE_PANTALLA[p.id]).toMatch(/^\//);
  });
});

describe("reportes: lo que viaja", () => {
  it("la ruta va sin query string ni hash", () => {
    expect(rutaSinConsulta("/pacientes?q=Juan%20P%C3%A9rez")).toBe("/pacientes");
    expect(rutaSinConsulta("/agenda#x")).toBe("/agenda");
    expect(rutaSinConsulta("//evil.com/x")).toBeNull();
    expect(rutaSinConsulta("https://evil.com")).toBeNull();
  });

  it("solo acepta imágenes y con tope de tamaño", () => {
    expect(leerCaptura("data:image/jpeg;base64,AAAA")).toEqual({
      mime: "image/jpeg",
      base64: "AAAA",
    });
    expect(leerCaptura("data:text/html;base64,AAAA")).toBeNull();
    expect(leerCaptura("data:image/svg+xml;base64,AAAA")).toBeNull();
    const grande = "A".repeat(2_100_000);
    expect(bytesDeBase64(grande)).toBeGreaterThan(1_500_000);
    expect(leerCaptura(`data:image/png;base64,${grande}`)).toBeNull();
  });
});
