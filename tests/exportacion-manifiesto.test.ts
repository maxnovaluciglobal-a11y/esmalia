import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { TABLAS_EXPORTACION, tablaPorClave } from "../src/lib/exportacion/exportacion-clinica";
import {
  generarExportacion,
  type DependenciasExportacion,
} from "../src/lib/exportacion/generar-exportacion";
import {
  ARCHIVO_HUELLAS,
  ARCHIVO_MANIFIESTO,
  VERSION_FORMATO_EXPORTACION,
  columnasDelManifiesto,
  describirColumna,
  sha256Hex,
  textoHuellas,
  unidadDeColumna,
  type Manifiesto,
} from "../src/lib/exportacion/manifiesto";

/**
 * Manifiesto de la exportación (EXP-02). Todo puro: los datos vienen de un
 * doble de `leer`, sin red ni base.
 */

const CLINICA = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "44444444-4444-4444-8444-444444444444";

function dependencias(): DependenciasExportacion {
  const datos: Record<string, Record<string, unknown>[]> = {
    pacientes: [
      { id: "p1", full_name: "María Núñez" },
      { id: "p2", full_name: "José Peña" },
    ],
    pagos: [{ id: "g1", patient_id: "p1", amount_cents: 15000, currency: "CLP" }],
  };
  return {
    iniciar: vi.fn(async () => ({ exportId: EXPORT_ID })),
    leer: vi.fn(async ({ clave, offset }) => {
      const filas = (offset === 0 ? (datos[clave] ?? []) : []) as never[];
      return { filas, siguiente: filas.length ? offset + filas.length : null };
    }),
    firmar: vi.fn(async ({ rutas }) => rutas.map((ruta) => ({ ruta, url: null }))),
    descargar: vi.fn(async () => new Uint8Array()),
    generarPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
    ceder: async () => {},
  };
}

const OPCIONES = {
  clinicId: CLINICA,
  clinicaNombre: "Clínica Sonrisa",
  generadoPor: "Ana",
  generadoPorId: "33333333-3333-4333-8333-333333333333",
  generadoEn: "26-10-2026 10:00",
  generadoEnUtc: "2026-10-26T13:00:00.000Z",
  zonaHoraria: "America/Santiago",
};

async function exportar() {
  const { zip, manifiesto } = await generarExportacion(dependencias(), OPCIONES);
  return { contenido: unzipSync(zip), manifiesto };
}

describe("sha256Hex", () => {
  it("coincide con node:crypto", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(await sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("textoHuellas", () => {
  it("una línea por archivo en el formato de shasum -c, ordenadas por ruta", () => {
    const texto = textoHuellas([
      { ruta: "z.csv", bytes: 1, sha256: "b".repeat(64) },
      { ruta: "a.csv", bytes: 1, sha256: "a".repeat(64) },
    ]);
    expect(texto).toBe(`${"a".repeat(64)}  a.csv\n${"b".repeat(64)}  z.csv\n`);
  });
});

describe("columnas del manifiesto", () => {
  it("montos con su unidad, fechas en UTC y claves foráneas que dicen adónde apuntan", () => {
    expect(unidadDeColumna("amount_cents", "entero")).toContain("currency");
    expect(unidadDeColumna("created_at", "fecha_hora")).toContain("UTC");
    expect(unidadDeColumna("birth_date", "fecha")).toContain("sin zona");
    expect(describirColumna("patient_id")).toContain("pacientes.csv");
    expect(describirColumna("voided_by")).toContain("anuló");
    expect(describirColumna("occurred_at")).toBe("Cuándo ocurrió.");
  });

  it("toda columna exportada tiene tipo y descripción", () => {
    for (const t of TABLAS_EXPORTACION) {
      for (const c of columnasDelManifiesto(t)) {
        expect(c.tipo_legible, `${t.tabla}.${c.nombre}`).toBeTruthy();
        expect(c.descripcion.length, `${t.tabla}.${c.nombre}`).toBeGreaterThan(3);
      }
    }
  });
});

describe("manifiesto en el ZIP", () => {
  it("trae manifiesto.json con versión, fecha, clínica y quién exportó", async () => {
    const { contenido } = await exportar();
    const m = JSON.parse(strFromU8(contenido[ARCHIVO_MANIFIESTO])) as Manifiesto;
    expect(m.formato).toBe("esmalia-exportacion");
    expect(m.version_formato).toBe(VERSION_FORMATO_EXPORTACION);
    expect(m.tipo).toBe("clinica_completa");
    expect(m.clinica).toEqual({ id: CLINICA, nombre: "Clínica Sonrisa" });
    expect(m.generado_en).toBe(OPCIONES.generadoEnUtc);
    expect(m.zona_horaria).toBe("America/Santiago");
    expect(m.generado_por).toEqual({ nombre: "Ana", user_id: OPCIONES.generadoPorId });
    expect(m.registro_exportacion_id).toBe(EXPORT_ID);
    expect(m.tablas_excluidas.map((e) => e.tabla)).toContain("whatsapp_credentials");
  });

  it("cada CSV figura con sus filas, columnas tipadas y huella; nada queda afuera", async () => {
    const { contenido, manifiesto } = await exportar();
    const porRuta = new Map(manifiesto.archivos.map((a) => [a.ruta, a]));
    for (const t of TABLAS_EXPORTACION) {
      const a = porRuta.get(t.archivo);
      expect(a, t.archivo).toBeDefined();
      expect(a!.tabla).toBe(t.tabla);
      expect(a!.columnas!.map((c) => c.nombre)).toEqual([...t.columnas]);
    }
    expect(porRuta.get("pacientes.csv")!.filas).toBe(2);
    expect(porRuta.get("pagos.csv")!.filas).toBe(1);
    const montos = porRuta.get("pagos.csv")!.columnas!.find((c) => c.nombre === "amount_cents");
    expect(montos?.tipo).toBe("entero");

    // Todos los archivos del ZIP están en el manifiesto salvo los tres que lo contienen.
    const fuera = new Set([ARCHIVO_MANIFIESTO, ARCHIVO_HUELLAS, "LEEME.txt"]);
    for (const ruta of Object.keys(contenido)) {
      if (!fuera.has(ruta)) expect(porRuta.has(ruta), ruta).toBe(true);
    }
  });

  it("las huellas son las de los bytes reales del ZIP y el conjunto se verifica", async () => {
    const { contenido, manifiesto } = await exportar();
    for (const a of manifiesto.archivos) {
      const bytes = contenido[a.ruta];
      expect(bytes, a.ruta).toBeDefined();
      expect(a.bytes).toBe(bytes.length);
      expect(a.sha256, a.ruta).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    const huellas = contenido[ARCHIVO_HUELLAS];
    expect(manifiesto.huella_del_conjunto.valor).toBe(
      createHash("sha256").update(huellas).digest("hex"),
    );
    // Formato verificable con `shasum -a 256 -c`.
    const lineas = strFromU8(huellas).trimEnd().split("\n");
    expect(lineas.length).toBe(manifiesto.archivos.length);
    for (const l of lineas) expect(l).toMatch(/^[0-9a-f]{64} {2}\S/);
  });

  it("el LEEME explica columnas, exclusiones y cómo verificar", async () => {
    const { contenido, manifiesto } = await exportar();
    // BOM UTF-8 (EF BB BF) para que Excel/Bloc de notas lean bien las tildes.
    expect([...contenido["LEEME.txt"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const leeme = strFromU8(contenido["LEEME.txt"]);
    expect(leeme).toContain(`versión ${VERSION_FORMATO_EXPORTACION}`);
    expect(leeme).toContain("LO QUE NO SALE EN ESTA EXPORTACIÓN");
    expect(leeme).toContain(`shasum -a 256 -c ${ARCHIVO_HUELLAS}`);
    expect(leeme).toContain(manifiesto.huella_del_conjunto.valor);
    expect(leeme).toContain("· amount_cents (número entero; unidad mínima de la moneda");
  });

  it("las columnas omitidas figuran con su motivo", async () => {
    const { manifiesto } = await exportar();
    const pacientes = manifiesto.archivos.find((a) => a.ruta === "pacientes.csv")!;
    const omitidas = pacientes.columnas_omitidas!.map((c) => c.nombre);
    expect(omitidas).toContain("document_id_enc");
    expect(pacientes.columnas!.map((c) => c.nombre)).not.toContain("document_id_enc");
    expect(tablaPorClave("pacientes")!.omitidas!.document_id_enc).toBeTruthy();
  });
});
