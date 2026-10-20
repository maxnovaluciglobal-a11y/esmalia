/**
 * Métricas y casos de los evals de Patty (IA-05). Puro: no llama a ningún
 * modelo. Verifica que los sets tengan el tamaño pedido por docs/IA.md, que
 * los casos sean coherentes y que el puntaje cuente bien.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error módulo .mjs sin tipos (vive fuera de src/, no entra al bundle)
import * as m from "../evals/metricas.mjs";

const leer = (n: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, `../evals/casos/${n}.json`), "utf8"));

describe("sets de casos (IA-05)", () => {
  it("tamaños: 30 SOAP, 30 entidades, 50 WhatsApp, ids únicos", () => {
    for (const [n, total] of [
      ["soap", 30],
      ["entidades", 30],
      ["agenda", 50],
    ] as const) {
      const casos = leer(n).casos as Array<{ id: string }>;
      expect(casos).toHaveLength(total);
      expect(new Set(casos.map((c) => c.id)).size).toBe(total);
    }
  });

  it("SOAP: todo caso tiene hechos prohibidos y ninguno calza con sus propios apuntes", () => {
    for (const c of leer("soap").casos) {
      expect(c.prohibidos.length, c.id).toBeGreaterThan(0);
      const apuntes = m.normalizar(c.apuntes);
      for (const h of c.prohibidos) {
        expect(new RegExp(h.patron, "i").test(apuntes), `${c.id}: ${h.hecho}`).toBe(false);
      }
    }
  });

  it("agenda: 'ahora' es martes 20-oct-2026 en Santiago y las fechas esperadas son válidas", () => {
    const set = leer("agenda");
    expect(m.isoEnZona(set.ahora, set.zonaHoraria)).toBe("2026-10-20");
    for (const c of set.casos) {
      expect([null, "agendar", "reagendar", "cancelar"]).toContain(c.intencion);
      if (c.fecha) expect(c.fecha >= "2026-10-20", c.id).toBe(true);
    }
  });

  it("los casos no traen PII con forma de dato real (emails, RUT, teléfonos)", () => {
    const todo = ["soap", "entidades", "agenda"]
      .map((n) => readFileSync(path.resolve(__dirname, `../evals/casos/${n}.json`), "utf8"))
      .join("\n");
    expect(todo).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(todo).not.toMatch(/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/);
    expect(todo).not.toMatch(/\+?56\s?9\s?\d{4}/);
  });
});

describe("puntaje", () => {
  it("SOAP: cuenta el hecho prohibido y el requerido faltante", () => {
    const caso = {
      prohibidos: [{ hecho: "alergia", patron: "alergi[ao] a" }],
      requeridos: [{ hecho: "pieza 36", patron: "\\b36\\b" }],
    };
    const r = m.puntuarSoap(
      caso,
      "Subjetivo: dolor. Objetivo: -. Análisis: -. Plan: Alergia a sulfas.",
    );
    expect(r.alucinaciones).toHaveLength(1);
    expect(r.faltantes).toEqual(["pieza 36"]);
    expect(r.soapCompleto).toBe(true);
  });

  it("entidades: alias sin tildes, toleradas y piezas FDI", () => {
    const caso = {
      esperado: {
        alergias: [["penicilina"]],
        medicamentos: [["acido folico", "folico"]],
        condiciones: [],
        dientes: ["36"],
      },
      toleradas: { condiciones: [["embaraz"]] },
    };
    const r = m.puntuarEntidades(caso, {
      allergies: [{ term: "Penicilina" }, { term: "Látex" }],
      medications: ["Ácido fólico"],
      diagnoses: [
        { term: "Embarazo", tooth: null },
        { term: "Caries", tooth: "pieza 3.6" },
      ],
      treatments: [{ term: "Resina", tooth: "47" }],
    });
    expect(r.alergias).toEqual({ vp: 1, fp: ["latex"], fn: [] });
    expect(r.medicamentos.vp).toBe(1);
    expect(r.condiciones.fp).toEqual(["caries"]); // embarazo tolerado, caries no
    expect(r.dientes).toEqual({ vp: 1, fp: ["47"], fn: [] });
    const resumen = m.resumirEntidades([{ puntaje: r }]);
    expect(resumen.alergiasInventadas).toBe(1);
    expect(resumen.alergias.precision).toBe(0.5);
  });

  it("agenda: fecha inventada cuando el mensaje no da fecha", () => {
    const caso = { intencion: "agendar", fecha: null, franja: null };
    const p = m.puntuarAgenda(caso, { intencion: "agendar", fecha: "2026-10-21", franja: null });
    expect(p).toMatchObject({ intencionOk: true, fechaOk: false, fechaInventada: true });
    expect(m.puntuarAgenda(caso, null).intencionOk).toBe(false);
    const resumen = m.resumirAgenda([{ caso, puntaje: p }]);
    expect(m.evaluarUmbrales("agenda", resumen)).toContain("1 fechas inventadas (meta 0)");
  });
});
