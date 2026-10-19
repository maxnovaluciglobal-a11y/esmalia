import { strFromU8, unzipSync } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../src/integrations/supabase/types";
import {
  CLAVES_EXPORTACION_PACIENTE,
  TABLAS_EXPORTACION,
  nombreZipPaciente,
  puedeExportarPaciente,
  rutaPdfPaciente,
  tablaPorClave,
  tablasExportacionPaciente,
  type FilaExportacion,
} from "../src/lib/exportacion/exportacion-clinica";
import {
  BLOQUE_PADRES,
  MENSAJE_EXPORTACION_NO_REGISTRADA,
  MENSAJE_SIN_PERMISO_EXPORTACION_PACIENTE,
  exigirExportacionRegistrada,
  exigirPermisoExportacionPaciente,
  leerPaginaDePaciente,
} from "../src/lib/exportacion/exportacion-clinica.server";
import {
  contenidoFicha,
  indexarFichas,
  pacientesConFicha,
  type ContenidoFicha,
} from "../src/lib/exportacion/ficha-paciente";
import { generarPdfFicha } from "../src/lib/exportacion/ficha-pdf";
import {
  generarExportacion,
  generarExportacionPaciente,
  type DependenciasExportacion,
  type DependenciasExportacionPaciente,
} from "../src/lib/exportacion/generar-exportacion";

/**
 * Exportación v2 (CON-01): tablas que faltaban, ficha legible en PDF por
 * paciente y exportación de una sola ficha. Todo puro: sin red ni base.
 */

const CLINICA = "11111111-1111-4111-8111-111111111111";
const USUARIO = "33333333-3333-4333-8333-333333333333";
const EXPORT_ID = "44444444-4444-4444-8444-444444444444";
const PACIENTE = "55555555-5555-4555-8555-555555555555";
const OTRO = "66666666-6666-4666-8666-666666666666";
const ABSORBIDA = "77777777-7777-4777-8777-777777777777";

// ── Tablas ────────────────────────────────────────────────────────────────

describe("tablas nuevas de la exportación", () => {
  it("cubre ortodoncia, gastos, convenios, aranceles, comisiones, mensajes y auditorías", () => {
    const tablas = TABLAS_EXPORTACION.map((t) => t.tabla);
    for (const t of [
      "ortho_cases",
      "ortho_controls",
      "expenses",
      "agreements",
      "agreement_coverage",
      "procedures",
      "payment_methods",
      "commission_rules",
      "commission_settlements",
      "messages",
      "patient_medical_history_audit",
      "patient_guardians_audit",
      "clinical_note_audit",
      "clinical_note_reviews",
      "clinical_access_log",
      "patient_vital_signs",
      "patient_guardians",
      "prescriptions",
      "odontogram_marks",
    ]) {
      expect(tablas, t).toContain(t);
    }
  });

  it("las notas salen con firma y adendas; el odontograma con estado; la ficha archivada", () => {
    const notas = tablaPorClave("notas")!.columnas;
    for (const c of ["addendum_of", "signed_at", "signer_name", "signer_license"]) {
      expect(notas).toContain(c);
    }
    const odonto = tablaPorClave("odontograma")!.columnas;
    expect(odonto).toEqual(expect.arrayContaining(["status", "conservation", "superseded_at"]));
    expect(tablaPorClave("pacientes")!.columnas).toContain("archived_at");
  });

  it("el filtro por paciente usa columnas exportadas y los padres existen", () => {
    for (const t of TABLAS_EXPORTACION) {
      const f = t.paciente;
      if (!f) continue;
      if (f.por === "padre") {
        const padre = tablaPorClave(f.padre);
        expect(padre, `${t.clave} → ${f.padre}`).toBeDefined();
        expect(padre!.paciente?.por, `padre de ${t.clave}`).not.toBe("padre");
        expect(t.columnas, t.clave).toContain(f.columna);
      } else {
        expect(t.columnas, t.clave).toContain(f.por);
      }
    }
  });

  it("la ficha de un paciente no lleva tablas de la clínica, y sin finanzas no lleva dinero", () => {
    const todas = tablasExportacionPaciente(true).map((t) => t.clave);
    for (const c of [
      "gastos",
      "sucursales",
      "inventario",
      "comisiones_liquidaciones",
      "lecturas_ficha",
    ]) {
      expect(todas).not.toContain(c);
    }
    expect(todas).toEqual(expect.arrayContaining(["pacientes", "notas", "pagos", "recetas"]));
    expect(CLAVES_EXPORTACION_PACIENTE).toEqual(todas);
    const sinDinero = tablasExportacionPaciente(false).map((t) => t.clave);
    for (const c of ["presupuestos", "presupuestos_items", "pagos"]) {
      expect(sinDinero).not.toContain(c);
    }
    expect(sinDinero).toContain("notas");
  });

  it("solo owner, admin y dentist exportan una ficha", () => {
    for (const r of ["owner", "admin", "dentist"] as const)
      expect(puedeExportarPaciente(r)).toBe(true);
    for (const r of ["assistant", "reception", "accounting"] as const) {
      expect(puedeExportarPaciente(r)).toBe(false);
    }
    expect(puedeExportarPaciente(null)).toBe(false);
  });

  it("nombres de archivo", () => {
    expect(rutaPdfPaciente("p1", "María José Núñez")).toBe("pacientes/p1-maria-jose-nunez.pdf");
    expect(nombreZipPaciente("María Núñez", "2026-10-19")).toBe(
      "esmalia-ficha-maria-nunez-2026-10-19.zip",
    );
  });
});

// ── Datos de prueba ───────────────────────────────────────────────────────

function datosDePrueba(): Record<string, FilaExportacion[]> {
  return {
    pacientes: [
      {
        id: PACIENTE,
        full_name: "María Núñez",
        document_id: "12.345.678-9",
        birth_date: "1990-05-02",
        status: "active",
        merged_into: null,
        created_at: "2026-01-10T12:00:00Z",
      },
      { id: ABSORBIDA, full_name: "Maria Nunez (duplicada)", merged_into: PACIENTE },
      { id: OTRO, full_name: "Pedro Pérez", merged_into: null },
    ],
    anamnesis: [
      {
        id: "a1",
        patient_id: PACIENTE,
        allergies: ["Penicilina"],
        allergy_details: [{ name: "Penicilina", severity: "severe", reaction: "urticaria" }],
        conditions: ["Diabetes tipo 2"],
        chronic_medications: [],
        risk_questionnaire: { anticoagulants: { answer: "yes", detail: "aspirina" } },
        notes: null,
        updated_at: "2026-10-01T12:00:00Z",
      },
    ],
    anamnesis_historial: [{ id: "h1", patient_id: PACIENTE }],
    odontograma: [
      {
        id: "m1",
        patient_id: PACIENTE,
        tooth_number: 16,
        surface: "oclusal",
        condition: "caries",
        status: "planificado",
        conservation: null,
        superseded_at: null,
        recorded_at: "2026-10-01T12:00:00Z",
      },
      {
        id: "m2",
        patient_id: PACIENTE,
        tooth_number: 11,
        surface: "whole",
        condition: "corona",
        status: "existente",
        conservation: "malo",
        superseded_at: null,
        recorded_at: "2026-10-01T12:00:00Z",
      },
      {
        id: "m0",
        patient_id: PACIENTE,
        tooth_number: 16,
        surface: "oclusal",
        condition: "sano",
        status: "existente",
        superseded_at: "2026-10-01T12:00:00Z",
      },
      { id: "x", patient_id: OTRO, tooth_number: 21, surface: "whole", condition: "ausente" },
    ],
    periodontograma: [{ id: "c1", patient_id: PACIENTE, recorded_at: "2026-09-01T12:00:00Z" }],
    periodontograma_mediciones: [
      {
        id: "pm1",
        chart_id: "c1",
        tooth_number: 16,
        point: "mv",
        pocket_depth_mm: 5,
        bleeding: true,
      },
      {
        id: "pm2",
        chart_id: "c1",
        tooth_number: 16,
        point: "v",
        pocket_depth_mm: 3,
        bleeding: false,
      },
      { id: "pm3", chart_id: "c1", tooth_number: 16, point: "whole", mobility: 2, furcation: 1 },
    ],
    notas: [
      {
        id: "n1",
        patient_ref: PACIENTE,
        title: "Control",
        content: "Se indica obturación de 16.",
        status: "signed",
        signed_at: "2026-10-02T15:00:00Z",
        signer_name: "Dra. Ana Rojas",
        signer_license: "RCM 1234",
        addendum_of: null,
        created_at: "2026-10-02T14:00:00Z",
      },
      {
        id: "n2",
        patient_ref: PACIENTE,
        title: "Corrección",
        content: "La pieza es 26, no 16.",
        status: "signed",
        signed_at: "2026-10-03T15:00:00Z",
        signer_name: "Dra. Ana Rojas",
        signer_license: "RCM 1234",
        addendum_of: "n1",
        created_at: "2026-10-03T14:00:00Z",
      },
      {
        id: "n3",
        patient_ref: ABSORBIDA,
        title: "Nota de la ficha duplicada",
        content: "Primera consulta.",
        status: "draft",
        addendum_of: null,
        created_at: "2025-01-01T14:00:00Z",
      },
      { id: "n4", patient_ref: OTRO, title: "Nota de otro", content: "x", status: "draft" },
    ],
    notas_versiones: [
      { id: "v1", note_id: "n1", version: 1 },
      { id: "v2", note_id: "n1", version: 2 },
    ],
    recetas: [
      {
        id: "r1",
        patient_id: PACIENTE,
        year: 2026,
        number: 7,
        issued_at: "2026-10-02T15:00:00Z",
        professional_name_snapshot: "Dra. Ana Rojas",
        professional_license_snapshot: "RCM 1234",
        clinic_name_snapshot: "Clínica Sonrisa",
        patient_name_snapshot: "María Núñez",
        patient_birth_date_snapshot: "1990-05-02",
        items: [
          {
            medication: "Ibuprofeno",
            presentation: "400 mg",
            dose: "1 comprimido",
            frequency: "cada 8 horas",
            duration: "3 días",
          },
        ],
        content_sha256: "abcdef0123456789abcdef",
        voided_at: null,
      },
    ],
    presupuestos: [
      {
        id: "q1",
        patient_id: PACIENTE,
        number: "P-2026-0001",
        status: "accepted",
        currency: "CLP",
        total_cents: 45000,
        accepted_at: "2026-10-02T16:00:00Z",
        accepted_by_name: "María Núñez",
        created_at: "2026-10-02T15:30:00Z",
      },
    ],
    presupuestos_items: [
      {
        id: "qi1",
        quote_id: "q1",
        name_snapshot: "Obturación resina",
        tooth_number: 16,
        quantity: 1,
        patient_cents: 45000,
      },
    ],
    pagos: [
      {
        id: "pg1",
        patient_id: PACIENTE,
        paid_at: "2026-10-02T17:00:00Z",
        currency: "CLP",
        amount_cents: 20000,
        method_name_snapshot: "Efectivo",
      },
      {
        id: "pg2",
        patient_id: PACIENTE,
        paid_at: "2026-10-03T17:00:00Z",
        currency: "CLP",
        amount_cents: 5000,
        method_name_snapshot: "Efectivo",
        reversed_at: "2026-10-03T18:00:00Z",
        reversal_reason: "error de digitación",
      },
    ],
    consentimientos: [
      {
        id: "k1",
        patient_id: ABSORBIDA,
        title_snapshot: "Consentimiento de endodoncia",
        body_snapshot: "Entiendo el procedimiento.",
        signed_by_name: "María Núñez",
        signer_role: "patient",
        signed_at: "2025-01-01T15:00:00Z",
      },
    ],
    tutores: [],
  };
}

const OPCIONES_FICHA = {
  clinicaNombre: "Clínica Sonrisa",
  zonaHoraria: "America/Santiago",
  generadoEn: "19 de octubre de 2026, 12:00",
  incluirFinanzas: true,
};

function todoElTexto(c: ContenidoFicha): string {
  return c.secciones.map((s) => [s.titulo, ...s.lineas.map((l) => l.texto)].join("\n")).join("\n");
}

// ── Contenido de la ficha ─────────────────────────────────────────────────

describe("contenidoFicha", () => {
  const indice = indexarFichas(datosDePrueba());

  it("una ficha por paciente, sin las fusionadas en otra", () => {
    expect(pacientesConFicha(indice).map((p) => p.id)).toEqual([PACIENTE, OTRO]);
    expect(contenidoFicha(indice, "no-existe", OPCIONES_FICHA)).toBeNull();
  });

  it("trae datos, alertas, anamnesis, odontograma con estado y periodontograma resumido", () => {
    const c = contenidoFicha(indice, PACIENTE, OPCIONES_FICHA)!;
    const t = todoElTexto(c);
    expect(c.pacienteNombre).toBe("María Núñez");
    expect(c.encabezado[0]).toContain("12.345.678-9");
    expect(t).toContain("Fecha de nacimiento: 02-05-1990");
    // Alertas: alergia grave y anticoagulantes son críticas.
    const alertas = c.secciones.find((s) => s.titulo === "Alertas clínicas")!;
    expect(alertas.lineas[0]).toMatchObject({ estilo: "alerta" });
    expect(alertas.lineas[0].texto).toContain("Penicilina (grave)");
    expect(t).toContain("Anticoagulantes o antiagregantes (aspirina)");
    expect(t).toContain("• Penicilina · Grave · reacción: urticaria");
    expect(t).toContain("Historial: 1 cambio registrado");
    // Odontograma: solo vigentes, ordenadas por pieza, con estado y conservación.
    const odonto = c.secciones.find((s) => s.titulo.startsWith("Odontograma"))!;
    expect(odonto.lineas.map((l) => l.texto)).toEqual([
      "• Pieza 11 · Pieza completa · Corona · Existente · Mal estado",
      "• Pieza 16 · Oclusal / Incisal · Caries · Por realizar",
      "Historial: 1 marca reemplazada (detalle en odontograma.csv).",
    ]);
    expect(t).not.toContain("Pieza 21");
    // Periodontograma: sondaje máximo, sangrado, movilidad y furca.
    expect(t).toContain("Sondaje máximo 5 mm");
    expect(t).toContain("Sangrado en 1 de 2 sitios (50 %)");
    expect(t).toContain("Movilidad: 16 (2)");
    expect(t).toContain("Furca: 16 (I)");
  });

  it("notas firmadas con su firma y sus adendas debajo, incluidas las de la ficha fusionada", () => {
    const c = contenidoFicha(indice, PACIENTE, OPCIONES_FICHA)!;
    const notas = c.secciones
      .find((s) => s.titulo === "Notas clínicas")!
      .lineas.map((l) => l.texto);
    const i = notas.findIndex((l) => l.startsWith("Control"));
    expect(notas[i + 1]).toBe("Se indica obturación de 16.");
    expect(notas[i + 2]).toMatch(
      /^Firmada por Dra\. Ana Rojas · Registro profesional RCM 1234 · .*2026/,
    );
    expect(notas).toContain("2 versiones (historial completo en notas-clinicas-versiones.csv).");
    const adenda = notas.findIndex((l) => l.startsWith("Adenda: Corrección"));
    expect(adenda).toBeGreaterThan(i);
    expect(notas[adenda + 1]).toBe("La pieza es 26, no 16.");
    // La nota de la ficha absorbida aparece (y antes, por fecha); la de otro paciente no.
    expect(notas.findIndex((l) => l.startsWith("Nota de la ficha duplicada"))).toBeLessThan(i);
    expect(notas).toContain("Borrador sin firmar.");
    expect(notas.join("\n")).not.toContain("Nota de otro");
    // El consentimiento firmado en la ficha duplicada también.
    expect(todoElTexto(c)).toContain("Consentimiento de endodoncia");
    expect(todoElTexto(c)).toContain("Firmó: María Núñez · el paciente");
  });

  it("recetas con el mismo contenido que la receta impresa", () => {
    const t = todoElTexto(contenidoFicha(indice, PACIENTE, OPCIONES_FICHA)!);
    expect(t).toContain("Receta");
    expect(t).toContain("1. Ibuprofeno 400 mg");
    expect(t).toContain("Registro profesional: RCM 1234");
    expect(t).toContain("Código de verificación: abcdef0123456789");
  });

  it("presupuestos y pagos con la moneda de la clínica; el pago anulado no suma", () => {
    const t = todoElTexto(contenidoFicha(indice, PACIENTE, OPCIONES_FICHA)!);
    expect(t).toContain("Presupuesto P-2026-0001 · Aceptado · Total $45.000");
    expect(t).toContain("Obturación resina · pieza 16 · paga el paciente $45.000");
    expect(t).toContain("ANULADO");
    expect(t).toContain("Total pagado: $20.000");
  });

  it("sin finanzas no muestra montos y lo explica", () => {
    const c = contenidoFicha(indice, PACIENTE, { ...OPCIONES_FICHA, incluirFinanzas: false })!;
    const t = todoElTexto(c);
    expect(t).not.toContain("$45.000");
    expect(t).not.toContain("Total pagado");
    expect(t).toContain("No incluidos en esta copia");
  });
});

// ── PDF ───────────────────────────────────────────────────────────────────

describe("generarPdfFicha", () => {
  it("genera un PDF válido con jsPDF", async () => {
    const indice = indexarFichas(datosDePrueba());
    const pdf = await generarPdfFicha(contenidoFicha(indice, PACIENTE, OPCIONES_FICHA)!);
    expect(strFromU8(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

// ── Orquestación ──────────────────────────────────────────────────────────

function lectorDe(datos: Record<string, FilaExportacion[]>) {
  return async ({ clave, offset }: { clave: string; offset: number }) => {
    const filas = offset === 0 ? (datos[clave] ?? []) : [];
    return { filas, siguiente: filas.length ? offset + filas.length : null };
  };
}

const sinEspera = async () => {};

describe("exportación completa con fichas en PDF", () => {
  it("un PDF por paciente en pacientes/ y el LEEME lo cuenta", async () => {
    const generarPdf = vi.fn(async (c: ContenidoFicha) =>
      new TextEncoder().encode(`%PDF ${c.pacienteId}`),
    );
    const deps: DependenciasExportacion = {
      iniciar: vi.fn(async () => ({ exportId: EXPORT_ID })),
      leer: vi.fn(lectorDe(datosDePrueba())),
      firmar: vi.fn(async () => []),
      descargar: vi.fn(async () => new Uint8Array()),
      generarPdf,
      ceder: sinEspera,
    };
    const { zip } = await generarExportacion(deps, {
      clinicId: CLINICA,
      clinicaNombre: "Clínica Sonrisa",
      generadoPor: "Ana",
      generadoEn: "hoy",
      zonaHoraria: "America/Santiago",
    });
    const contenido = unzipSync(zip);
    expect(
      Object.keys(contenido)
        .filter((k) => k.startsWith("pacientes/"))
        .sort(),
    ).toEqual([`pacientes/${PACIENTE}-maria-nunez.pdf`, `pacientes/${OTRO}-pedro-perez.pdf`]);
    for (const t of TABLAS_EXPORTACION) expect(contenido[t.archivo], t.archivo).toBeDefined();
    expect(strFromU8(contenido["LEEME.txt"])).toContain("- Generadas: 2.");
  });

  it("una ficha que falla no tira abajo la exportación", async () => {
    const deps: DependenciasExportacion = {
      iniciar: vi.fn(async () => ({ exportId: EXPORT_ID })),
      leer: vi.fn(lectorDe(datosDePrueba())),
      firmar: vi.fn(async () => []),
      descargar: vi.fn(async () => new Uint8Array()),
      generarPdf: vi.fn(async (c: ContenidoFicha) => {
        if (c.pacienteId === OTRO) throw new Error("jsPDF");
        return new Uint8Array([1]);
      }),
      ceder: sinEspera,
    };
    const { zip } = await generarExportacion(deps, {
      clinicId: CLINICA,
      clinicaNombre: "Clínica Sonrisa",
      generadoPor: "Ana",
      generadoEn: "hoy",
    });
    const leeme = strFromU8(unzipSync(zip)["LEEME.txt"]);
    expect(leeme).toContain("- Generadas: 1. No se pudieron generar: 1");
  });
});

describe("exportación de una ficha", () => {
  function deps(incluirFinanzas: boolean) {
    const datos = datosDePrueba();
    const leer = vi.fn<DependenciasExportacionPaciente["leer"]>(lectorDe(datos));
    const d: DependenciasExportacionPaciente = {
      iniciar: vi.fn(async () => ({ exportId: EXPORT_ID })),
      leer,
      firmar: vi.fn(async () => []),
      descargar: vi.fn(async () => new Uint8Array()),
      generarPdf: vi.fn(async () => new Uint8Array([1])),
      ceder: sinEspera,
    };
    const op = {
      clinicId: CLINICA,
      patientId: PACIENTE,
      pacienteNombre: "María Núñez",
      clinicaNombre: "Clínica Sonrisa",
      generadoPor: "Dra. Ana Rojas",
      generadoEn: "hoy",
      incluirFinanzas,
    };
    return { d, op };
  }

  it("registra con el paciente, lee solo tablas de la ficha y genera un solo PDF", async () => {
    const { d, op } = deps(true);
    const { zip } = await generarExportacionPaciente(d, op);
    expect(d.iniciar).toHaveBeenCalledWith({ clinicId: CLINICA, patientId: PACIENTE });
    const claves = vi.mocked(d.leer).mock.calls.map(([a]) => a.clave);
    expect(new Set(claves)).toEqual(new Set(CLAVES_EXPORTACION_PACIENTE));
    for (const [a] of vi.mocked(d.leer).mock.calls) {
      expect(a).toMatchObject({ exportId: EXPORT_ID, patientId: PACIENTE });
    }
    const contenido = unzipSync(zip);
    expect(Object.keys(contenido).filter((k) => k.startsWith("pacientes/"))).toEqual([
      `pacientes/${PACIENTE}-maria-nunez.pdf`,
    ]);
    expect(contenido["gastos.csv"]).toBeUndefined();
    const leeme = strFromU8(contenido["LEEME.txt"]);
    expect(leeme).toContain("EXPORTACIÓN DE LA FICHA DE María Núñez");
    expect(leeme).not.toContain("gastos.csv");
  });

  it("sin finanzas no pide presupuestos ni pagos y el LEEME lo dice", async () => {
    const { d, op } = deps(false);
    const { zip } = await generarExportacionPaciente(d, op);
    const claves = vi.mocked(d.leer).mock.calls.map(([a]) => a.clave);
    expect(claves).not.toContain("pagos");
    expect(claves).not.toContain("presupuestos");
    const contenido = unzipSync(zip);
    expect(contenido["pagos.csv"]).toBeUndefined();
    expect(strFromU8(contenido["LEEME.txt"])).toContain("Sin presupuestos ni pagos");
  });

  it("si no se puede registrar, no lee nada", async () => {
    const { d, op } = deps(true);
    d.iniciar = vi.fn(async () => {
      throw new Error("No pudimos registrar la exportación");
    });
    await expect(generarExportacionPaciente(d, op)).rejects.toThrow("registrar");
    expect(d.leer).not.toHaveBeenCalled();
  });
});

// ── Servidor ──────────────────────────────────────────────────────────────

interface Llamada {
  tabla: string;
  select?: string;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown[]]>;
  order: string[];
  range?: [number, number];
}

function supabaseFalso(respuesta: (l: Llamada) => { data: unknown; error: unknown }) {
  const llamadas: Llamada[] = [];
  const cliente = {
    from(tabla: string) {
      const l: Llamada = { tabla, eq: [], in: [], order: [] };
      llamadas.push(l);
      const b = {
        select(cols: string) {
          l.select = cols;
          return b;
        },
        eq(col: string, val: unknown) {
          l.eq.push([col, val]);
          return b;
        },
        in(col: string, vals: unknown[]) {
          l.in.push([col, vals]);
          return b;
        },
        order(col: string) {
          l.order.push(col);
          return b;
        },
        range(desde: number, hasta: number) {
          l.range = [desde, hasta];
          return Promise.resolve(respuesta(l));
        },
        maybeSingle() {
          return Promise.resolve(respuesta(l));
        },
      };
      return b;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, llamadas };
}

describe("permiso y registro de la exportación de una ficha", () => {
  const ahora = new Date("2026-10-19T15:00:00Z");
  const registro = (over: Record<string, unknown> = {}) => ({
    data: {
      id: EXPORT_ID,
      actor_id: USUARIO,
      created_at: "2026-10-19T14:30:00Z",
      formato: "paciente_zip",
      patient_id: PACIENTE,
      ...over,
    },
    error: null,
  });

  it("el dentista pasa; asistente, recepción y contabilidad no", async () => {
    for (const role of ["owner", "admin", "dentist"]) {
      const { cliente } = supabaseFalso(() => ({ data: { role }, error: null }));
      await expect(exigirPermisoExportacionPaciente(cliente, CLINICA, USUARIO)).resolves.toBe(role);
    }
    for (const role of ["assistant", "reception", "accounting"]) {
      const { cliente } = supabaseFalso(() => ({ data: { role }, error: null }));
      await expect(exigirPermisoExportacionPaciente(cliente, CLINICA, USUARIO)).rejects.toThrow(
        MENSAJE_SIN_PERMISO_EXPORTACION_PACIENTE,
      );
    }
  });

  it("acepta el registro propio de ese paciente", async () => {
    const { cliente, llamadas } = supabaseFalso(() => registro());
    await expect(
      exigirExportacionRegistrada(cliente, CLINICA, USUARIO, EXPORT_ID, ahora, PACIENTE),
    ).resolves.toBeUndefined();
    expect(llamadas[0].select).toContain("patient_id");
  });

  it("rechaza el registro de otro paciente o el de la exportación completa", async () => {
    for (const caso of [
      registro({ patient_id: OTRO }),
      registro({ formato: "zip_csv", patient_id: null }),
      registro({ actor_id: OTRO }),
    ]) {
      const { cliente } = supabaseFalso(() => caso);
      await expect(
        exigirExportacionRegistrada(cliente, CLINICA, USUARIO, EXPORT_ID, ahora, PACIENTE),
      ).rejects.toThrow(MENSAJE_EXPORTACION_NO_REGISTRADA);
    }
  });

  it("la exportación completa no lee patient_id (anda sin la migración nueva)", async () => {
    const { cliente, llamadas } = supabaseFalso(() =>
      registro({ formato: "zip_csv", patient_id: undefined }),
    );
    await exigirExportacionRegistrada(cliente, CLINICA, USUARIO, EXPORT_ID, ahora);
    expect(llamadas[0].select).not.toContain("patient_id");
  });
});

describe("leerPaginaDePaciente", () => {
  const ids = [PACIENTE, ABSORBIDA];

  it("filtra por clínica y por la ficha (con las fusionadas)", async () => {
    const { cliente, llamadas } = supabaseFalso(() => ({ data: [{ id: "m1" }], error: null }));
    const p = await leerPaginaDePaciente(cliente, tablaPorClave("odontograma")!, CLINICA, ids, 0);
    expect(p).toEqual({ filas: [{ id: "m1" }], siguiente: 1 });
    expect(llamadas[0]).toMatchObject({
      tabla: "odontogram_marks",
      eq: [["clinic_id", CLINICA]],
      in: [["patient_id", ids]],
      order: ["id"],
      range: [0, 999],
    });
    await leerPaginaDePaciente(cliente, tablaPorClave("notas")!, CLINICA, ids, 0);
    expect(llamadas.at(-1)!.in).toEqual([["patient_ref", ids]]);
    await leerPaginaDePaciente(cliente, tablaPorClave("pacientes")!, CLINICA, ids, 0);
    expect(llamadas.at(-1)!.in).toEqual([["id", ids]]);
  });

  it("una tabla que no es de la ficha no se lee", async () => {
    const { cliente, llamadas } = supabaseFalso(() => ({ data: [], error: null }));
    await expect(
      leerPaginaDePaciente(cliente, tablaPorClave("gastos")!, CLINICA, ids, 0),
    ).rejects.toThrow();
    expect(llamadas).toHaveLength(0);
  });

  it("las tablas hijas se leen por los ids del padre, de a bloques", async () => {
    const notas = Array.from({ length: BLOQUE_PADRES + 5 }, (_, i) => ({ id: `n${i}` }));
    const { cliente, llamadas } = supabaseFalso((l) => {
      if (l.tabla === "clinical_notes") {
        return { data: l.range![0] === 0 ? notas : [], error: null };
      }
      // versiones: una por página y bloque, después vacío
      return { data: l.range![0] === 0 ? [{ id: `v-${l.in[0][1][0]}` }] : [], error: null };
    });
    const tabla = tablaPorClave("notas_versiones")!;
    const p1 = await leerPaginaDePaciente(cliente, tabla, CLINICA, ids, 0);
    const versiones = llamadas.find((l) => l.tabla === "clinical_note_versions")!;
    expect(versiones.in[0][0]).toBe("note_id");
    expect(versiones.in[0][1]).toHaveLength(BLOQUE_PADRES);
    expect(llamadas.find((l) => l.tabla === "clinical_notes")!.in).toEqual([["patient_ref", ids]]);
    expect(p1.filas).toEqual([{ id: "v-n0" }]);

    // Fin del primer bloque: salta al segundo; fin del segundo: termina.
    const p2 = await leerPaginaDePaciente(cliente, tabla, CLINICA, ids, p1.siguiente!);
    expect(p2.filas).toEqual([]);
    expect(p2.siguiente).not.toBeNull();
    const p3 = await leerPaginaDePaciente(cliente, tabla, CLINICA, ids, p2.siguiente!);
    expect(p3.filas).toEqual([{ id: `v-n${BLOQUE_PADRES}` }]);
    const ultimo = llamadas.filter((l) => l.tabla === "clinical_note_versions").at(-1)!;
    expect(ultimo.in[0][1]).toHaveLength(5);
    const p4 = await leerPaginaDePaciente(cliente, tabla, CLINICA, ids, p3.siguiente!);
    expect(p4).toEqual({ filas: [], siguiente: null });
  });
});
