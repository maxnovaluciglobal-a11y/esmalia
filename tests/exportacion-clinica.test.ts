import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../src/integrations/supabase/types";
import {
  TABLAS_EXPORTACION,
  archivosDeStorage,
  armarZip,
  conBom,
  construirLeeme,
  csvDeTabla,
  nombreZip,
  puedeExportarClinica,
  tablaPorClave,
  type FilaExportacion,
} from "../src/lib/exportacion/exportacion-clinica";
import {
  MENSAJE_EXPORTACION_NO_REGISTRADA,
  MENSAJE_SIN_PERMISO_EXPORTACION,
  VIGENCIA_EXPORTACION_MS,
  exigirExportacionRegistrada,
  exigirPermisoExportacion,
  leerPaginaDeTabla,
} from "../src/lib/exportacion/exportacion-clinica.server";
import {
  generarExportacion,
  type DependenciasExportacion,
} from "../src/lib/exportacion/generar-exportacion";

/**
 * Exportación completa de la clínica (CS-04/CON-01). Todo puro: el cliente
 * de Supabase es un doble que registra las llamadas, sin red ni base.
 */

const CLINICA = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const USUARIO = "33333333-3333-4333-8333-333333333333";
const EXPORT_ID = "44444444-4444-4444-8444-444444444444";

// ── Doble de Supabase ─────────────────────────────────────────────────────

interface Llamada {
  tabla: string;
  select?: string;
  eq: Array<[string, unknown]>;
  order: string[];
  range?: [number, number];
}

function supabaseFalso(respuesta: (l: Llamada) => { data: unknown; error: unknown }) {
  const llamadas: Llamada[] = [];
  const cliente = {
    from(tabla: string) {
      const l: Llamada = { tabla, eq: [], order: [] };
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

// ── Rol ───────────────────────────────────────────────────────────────────

describe("quién puede exportar", () => {
  it("solo owner y admin en la interfaz", () => {
    expect(puedeExportarClinica("owner")).toBe(true);
    expect(puedeExportarClinica("admin")).toBe(true);
    for (const rol of ["dentist", "assistant", "reception", "accounting"] as const) {
      expect(puedeExportarClinica(rol)).toBe(false);
    }
    expect(puedeExportarClinica(null)).toBe(false);
    expect(puedeExportarClinica(undefined)).toBe(false);
  });

  it("el servidor deja pasar a owner y admin, leyendo el rol de esa clínica y ese usuario", async () => {
    for (const role of ["owner", "admin"]) {
      const { cliente, llamadas } = supabaseFalso(() => ({ data: { role }, error: null }));
      await expect(exigirPermisoExportacion(cliente, CLINICA, USUARIO)).resolves.toBe(role);
      expect(llamadas[0].tabla).toBe("clinic_members");
      expect(llamadas[0].eq).toEqual([
        ["clinic_id", CLINICA],
        ["user_id", USUARIO],
      ]);
    }
  });

  it("el servidor rechaza a cualquier otro rol y a quien no es miembro", async () => {
    for (const role of ["dentist", "assistant", "reception", "accounting"]) {
      const { cliente } = supabaseFalso(() => ({ data: { role }, error: null }));
      await expect(exigirPermisoExportacion(cliente, CLINICA, USUARIO)).rejects.toThrow(
        MENSAJE_SIN_PERMISO_EXPORTACION,
      );
    }
    const { cliente } = supabaseFalso(() => ({ data: null, error: null }));
    await expect(exigirPermisoExportacion(cliente, CLINICA, USUARIO)).rejects.toThrow(
      MENSAJE_SIN_PERMISO_EXPORTACION,
    );
  });
});

describe("exportación registrada", () => {
  const ahora = new Date("2026-10-19T15:00:00Z");

  it("acepta un registro propio y reciente", async () => {
    const { cliente, llamadas } = supabaseFalso(() => ({
      data: { id: EXPORT_ID, actor_id: USUARIO, created_at: "2026-10-19T14:30:00Z" },
      error: null,
    }));
    await expect(
      exigirExportacionRegistrada(cliente, CLINICA, USUARIO, EXPORT_ID, ahora),
    ).resolves.toBeUndefined();
    expect(llamadas[0].tabla).toBe("clinic_data_exports");
    expect(llamadas[0].eq).toEqual([
      ["id", EXPORT_ID],
      ["clinic_id", CLINICA],
    ]);
  });

  it("rechaza un registro de otra persona, uno vencido o uno inexistente", async () => {
    const casos = [
      { data: { id: EXPORT_ID, actor_id: OTRA, created_at: "2026-10-19T14:30:00Z" }, error: null },
      {
        data: {
          id: EXPORT_ID,
          actor_id: USUARIO,
          created_at: new Date(ahora.getTime() - VIGENCIA_EXPORTACION_MS - 1000).toISOString(),
        },
        error: null,
      },
      { data: null, error: null },
      { data: null, error: { message: "permission denied" } },
    ];
    for (const caso of casos) {
      const { cliente } = supabaseFalso(() => caso);
      await expect(
        exigirExportacionRegistrada(cliente, CLINICA, USUARIO, EXPORT_ID, ahora),
      ).rejects.toThrow(MENSAJE_EXPORTACION_NO_REGISTRADA);
    }
  });
});

// ── Definición de tablas ──────────────────────────────────────────────────

/** Columnas del bloque `Row` de una tabla en types.ts. */
function columnasDeTypes(tabla: string): string[] {
  const fuente = readFileSync(
    new URL("../src/integrations/supabase/types.ts", import.meta.url),
    "utf8",
  );
  const inicio = fuente.indexOf(`      ${tabla}: {\n        Row: {`);
  if (inicio < 0) return [];
  const fin = fuente.indexOf("        };", inicio);
  return [...fuente.slice(inicio, fin).matchAll(/^ {10}([a-z0-9_]+):/gm)].map((m) => m[1]);
}

describe("tablas exportadas", () => {
  it("cubre todo lo que prometen los términos", () => {
    const tablas = TABLAS_EXPORTACION.map((t) => t.tabla);
    for (const t of [
      "patients",
      "patient_medical_history",
      "professionals",
      "appointments",
      "clinical_notes",
      "clinical_note_versions",
      "odontogram_marks",
      "periodontal_charts",
      "periodontal_measurements",
      "quotes",
      "quote_items",
      "treatment_plans",
      "treatment_items",
      "payments",
      "cash_registers",
      "patient_consents",
      "patient_documents",
      "labs",
      "lab_orders",
      "inventory_items",
      "inventory_movements",
    ]) {
      expect(tablas).toContain(t);
    }
  });

  it("claves y archivos no se repiten", () => {
    const claves = TABLAS_EXPORTACION.map((t) => t.clave);
    const archivos = TABLAS_EXPORTACION.map((t) => t.archivo);
    expect(new Set(claves).size).toBe(claves.length);
    expect(new Set(archivos).size).toBe(archivos.length);
    expect(archivos).not.toContain("LEEME.txt");
  });

  it("cada columna existe en la tabla (types.ts), y el orden usa columnas exportadas", () => {
    for (const t of TABLAS_EXPORTACION) {
      const reales = columnasDeTypes(t.tabla);
      expect(reales.length, `${t.tabla} no está en types.ts`).toBeGreaterThan(0);
      expect(reales, t.tabla).toContain("clinic_id");
      for (const c of [...t.columnas, ...t.orden]) expect(reales, `${t.tabla}.${c}`).toContain(c);
    }
  });

  it("no exporta valores cifrados, hashes ni tokens", () => {
    for (const t of TABLAS_EXPORTACION) {
      for (const c of t.columnas) expect(c).not.toMatch(/_enc$|_hash$|token|secret|_ip$/);
    }
  });

  it("tablaPorClave solo resuelve claves de la lista", () => {
    expect(tablaPorClave("pacientes")?.tabla).toBe("patients");
    expect(tablaPorClave("whatsapp_credentials")).toBeUndefined();
  });
});

// ── CSV ───────────────────────────────────────────────────────────────────

describe("csvDeTabla", () => {
  const pacientes = tablaPorClave("pacientes")!;

  it("escribe el encabezado aunque la tabla esté vacía", () => {
    expect(csvDeTabla(pacientes, [])).toBe(pacientes.columnas.join(";"));
  });

  it("listas en JSON, booleanos legibles, vacíos para null y fórmulas neutralizadas", () => {
    const anamnesis = tablaPorClave("anamnesis")!;
    const fila: FilaExportacion = {
      id: "a1",
      patient_id: "p1",
      allergies: ["penicilina", "látex"],
      conditions: [],
      chronic_medications: ['=HYPERLINK("x")'],
      notes: "=SUM(A1)",
      updated_at: "2026-10-19T12:00:00Z",
      updated_by: null,
    };
    const [cabecera, linea] = csvDeTabla(anamnesis, [fila]).split("\r\n");
    expect(cabecera).toBe(anamnesis.columnas.join(";"));
    const celdas = linea.split(";");
    expect(celdas[2]).toBe('"[""penicilina"",""látex""]"');
    expect(celdas[3]).toBe("[]");
    expect(celdas[5]).toBe("'=SUM(A1)");
    expect(celdas[7]).toBe("");

    const prof = tablaPorClave("profesionales")!;
    const csv = csvDeTabla(prof, [{ id: "x", full_name: "Ana", is_active: true }]);
    expect(csv.split("\r\n")[1]).toContain(";true;");
  });

  it("ignora columnas que vengan de más en la fila", () => {
    const csv = csvDeTabla(pacientes, [
      { id: "p1", full_name: "Ana", document_id_enc: "\\x0102", document_id_hash: "abc" },
    ]);
    expect(csv).not.toContain("0102");
    expect(csv).not.toContain("document_id_hash");
  });
});

// ── Storage ───────────────────────────────────────────────────────────────

describe("archivosDeStorage", () => {
  it("toma documentos, firmas de consentimiento y de presupuesto de la propia clínica", () => {
    const archivos = archivosDeStorage(CLINICA, {
      documentos: [
        {
          id: "d1",
          patient_id: "p1",
          filename: "Radiografía panorámica.jpg",
          storage_path: `${CLINICA}/p1/rx.jpg`,
          size_bytes: 1000,
        },
        // otra clínica, traversal y duplicado: afuera
        { id: "d2", patient_id: "p1", filename: "x", storage_path: `${OTRA}/p1/x`, size_bytes: 1 },
        {
          id: "d3",
          patient_id: "p1",
          filename: "x",
          storage_path: `${CLINICA}/../x`,
          size_bytes: 1,
        },
        {
          id: "d4",
          patient_id: "p1",
          filename: "x",
          storage_path: `${CLINICA}/p1/rx.jpg`,
          size_bytes: 1,
        },
      ],
      consentimientos: [
        { id: "c1", patient_id: "p1", signature_storage_path: `${CLINICA}/p1/f.png` },
      ],
      presupuestos: [
        { id: "q1", patient_id: "p1", accepted_signature_path: `${CLINICA}/p1/q.png` },
        { id: "q2", patient_id: "p1", accepted_signature_path: null },
      ],
    });
    expect(archivos.map((a) => a.destino)).toEqual([
      "archivos/documentos/p1/d1-Radiografia_panoramica.jpg",
      "archivos/firmas-consentimientos/p1/c1.png",
      "archivos/firmas-presupuestos/p1/q1.png",
    ]);
    expect(archivos[0].bytes).toBe(1000);
  });
});

// ── LEEME y ZIP ───────────────────────────────────────────────────────────

describe("LEEME y ZIP", () => {
  it("el LEEME nombra cada archivo con su conteo y explica la omisión de adjuntos", () => {
    const leeme = construirLeeme({
      clinicaNombre: "Clínica Sonrisa",
      generadoEn: "19 de octubre de 2026, 12:00",
      generadoPor: "Ana Pérez",
      conteos: { pacientes: 1, citas: 12 },
      archivosIncluidos: 0,
      archivosOmitidos: 3,
      motivoOmision: "no se pudieron descargar",
    });
    for (const t of TABLAS_EXPORTACION) expect(leeme).toContain(t.archivo);
    expect(leeme).toContain("pacientes.csv (1 fila)");
    expect(leeme).toContain("citas.csv (12 filas)");
    expect(leeme).toContain("No incluidos: 3 (no se pudieron descargar)");
    expect(leeme).toContain("Ana Pérez");
  });

  it("el ZIP conserva el BOM y el texto con tildes, y los binarios intactos", () => {
    const zip = armarZip(
      { "pacientes.csv": conBom("full_name\r\nMaría Núñez") },
      { "archivos/documentos/p1/d1-rx.jpg": new Uint8Array([0xff, 0xd8, 0xff]) },
    );
    const contenido = unzipSync(zip);
    expect(Object.keys(contenido).sort()).toEqual([
      "archivos/documentos/p1/d1-rx.jpg",
      "pacientes.csv",
    ]);
    // BOM UTF-8 en bytes (TextDecoder lo quita al decodificar, por eso no se
    // mira en el string).
    expect([...contenido["pacientes.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = strFromU8(contenido["pacientes.csv"]);
    expect(csv).toContain("María Núñez");
    expect([...contenido["archivos/documentos/p1/d1-rx.jpg"]]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("nombre del ZIP con slug y fecha", () => {
    expect(nombreZip("Clínica Dental Ñuñoa", "2026-10-19")).toBe(
      "esmalia-clinica-dental-nunoa-2026-10-19.zip",
    );
  });
});

// ── Lectura paginada ──────────────────────────────────────────────────────

describe("leerPaginaDeTabla", () => {
  it("filtra por clínica, ordena, pide el rango y sigue hasta una página vacía", async () => {
    const tabla = tablaPorClave("notas_versiones")!;
    const { cliente, llamadas } = supabaseFalso((l) => ({
      data: l.range![0] === 0 ? [{ id: "v1" }, { id: "v2" }] : [],
      error: null,
    }));
    const p1 = await leerPaginaDeTabla(cliente, tabla, CLINICA, 0, 2);
    expect(p1.siguiente).toBe(2);
    expect(llamadas[0]).toMatchObject({
      tabla: "clinical_note_versions",
      select: tabla.columnas.join(","),
      eq: [["clinic_id", CLINICA]],
      order: ["note_id", "version"],
      range: [0, 1],
    });
    const p2 = await leerPaginaDeTabla(cliente, tabla, CLINICA, 2, 2);
    expect(p2).toEqual({ filas: [], siguiente: null });
  });

  it("no corta antes de tiempo si el servidor devuelve menos filas que el límite", async () => {
    const { cliente } = supabaseFalso(() => ({ data: [{ id: "a" }], error: null }));
    const p = await leerPaginaDeTabla(cliente, tablaPorClave("pacientes")!, CLINICA, 0, 1000);
    expect(p.siguiente).toBe(1);
  });

  it("un error de la base no se traga: falla con un mensaje legible", async () => {
    const { cliente } = supabaseFalso(() => ({ data: null, error: { message: "boom" } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(leerPaginaDeTabla(cliente, tablaPorClave("pagos")!, CLINICA, 0)).rejects.toThrow(
      "pagos.csv",
    );
  });
});

// ── Orquestación ──────────────────────────────────────────────────────────

function dependencias(over: Partial<DependenciasExportacion> = {}) {
  const datos: Record<string, FilaExportacion[]> = {
    pacientes: [{ id: "p1", full_name: "María Núñez" }],
    documentos: [
      {
        id: "d1",
        patient_id: "p1",
        filename: "rx.jpg",
        storage_path: `${CLINICA}/p1/rx.jpg`,
        size_bytes: 3,
      },
    ],
  };
  const leer = vi.fn<DependenciasExportacion["leer"]>(async ({ clave, offset }) => {
    const filas = offset === 0 ? (datos[clave] ?? []) : [];
    return { filas, siguiente: filas.length ? offset + filas.length : null };
  });
  const deps: DependenciasExportacion = {
    iniciar: vi.fn(async () => ({ exportId: EXPORT_ID })),
    leer,
    firmar: vi.fn(async ({ rutas }) => rutas.map((ruta) => ({ ruta, url: `https://x/${ruta}` }))),
    descargar: vi.fn(async () => new Uint8Array([1, 2, 3])),
    ...over,
  };
  return deps;
}

const OPCIONES = {
  clinicId: CLINICA,
  clinicaNombre: "Clínica Sonrisa",
  generadoPor: "Ana",
  generadoEn: "hoy",
};

describe("generarExportacion", () => {
  it("arma el ZIP con todos los CSV, el LEEME y los archivos", async () => {
    const deps = dependencias();
    const { zip, conteos } = await generarExportacion(deps, OPCIONES);
    const contenido = unzipSync(zip);
    for (const t of TABLAS_EXPORTACION) expect(contenido[t.archivo], t.archivo).toBeDefined();
    expect(contenido["LEEME.txt"]).toBeDefined();
    expect(contenido["archivos/documentos/p1/d1-rx.jpg"]).toBeDefined();
    expect(conteos.pacientes).toBe(1);
    expect(strFromU8(contenido["pacientes.csv"])).toContain("María Núñez");
    // Todas las lecturas cuelgan de la exportación registrada.
    for (const [args] of vi.mocked(deps.leer).mock.calls) expect(args.exportId).toBe(EXPORT_ID);
  });

  it("si no se puede registrar, no lee nada", async () => {
    const deps = dependencias({
      iniciar: vi.fn(async () => {
        throw new Error("No pudimos registrar la exportación");
      }),
    });
    await expect(generarExportacion(deps, OPCIONES)).rejects.toThrow("registrar");
    expect(deps.leer).not.toHaveBeenCalled();
  });

  it("sobre el tope de tamaño deja los archivos afuera y lo dice en el LEEME", async () => {
    const deps = dependencias();
    const { zip } = await generarExportacion(deps, { ...OPCIONES, maxBytesArchivos: 1 });
    const contenido = unzipSync(zip);
    expect(Object.keys(contenido).some((k) => k.startsWith("archivos/"))).toBe(false);
    expect(deps.firmar).not.toHaveBeenCalled();
    expect(strFromU8(contenido["LEEME.txt"])).toContain("No incluidos: 1");
  });

  it("un archivo que no baja no tira abajo la exportación", async () => {
    const deps = dependencias({
      descargar: vi.fn(async () => {
        throw new Error("404");
      }),
    });
    const { zip } = await generarExportacion(deps, OPCIONES);
    const leeme = strFromU8(unzipSync(zip)["LEEME.txt"]);
    expect(leeme).toContain("Incluidos en este ZIP: 0.");
    expect(leeme).toContain("No incluidos: 1 (no se pudieron descargar)");
  });
});
