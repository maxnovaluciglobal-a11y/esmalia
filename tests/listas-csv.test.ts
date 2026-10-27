import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CLINIC_ROLES, hasPermission, type ClinicRole } from "../src/lib/access/access";
import { construirCsv } from "../src/lib/csv-export";
import {
  CLAVES_LISTAS_CSV,
  LISTAS_CSV,
  columnasParaRol,
  csvDeLista,
  fechaHoraPlanilla,
  fechaPlanilla,
  montoPlanilla,
  nombreArchivoLista,
  puedeExportarLista,
  puedeVerDineroEnLista,
  siNoPlanilla,
  type ColumnaLista,
} from "../src/lib/exportacion/listas-csv";

/**
 * "Exportar CSV" desde cada lista (EXP-04). Todo puro: formato de las
 * celdas para Excel en español y el recorte por permisos.
 */

interface Fila {
  paciente: string;
  saldoCents: number | null;
  moneda: string;
  fecha: string | null;
}

const COLUMNAS: ColumnaLista<Fila>[] = [
  { header: "Paciente", value: (f) => f.paciente },
  { header: "Fecha", value: (f) => fechaPlanilla(f.fecha, "America/Santiago") },
  { header: "Saldo", value: (f) => montoPlanilla(f.saldoCents, f.moneda), dinero: true },
  { header: "Moneda", value: (f) => f.moneda, dinero: true },
];

describe("montoPlanilla", () => {
  it("CLP sin decimales ni separador de miles", () => {
    expect(montoPlanilla(1250000, "CLP")).toBe("1250000");
    expect(montoPlanilla(0, "CLP")).toBe("0");
  });

  it("USD y MXN en unidades con coma decimal (cents / 100)", () => {
    expect(montoPlanilla(123450, "USD")).toBe("1234,50");
    expect(montoPlanilla(5, "MXN")).toBe("0,05");
  });

  it("negativos quedan como número, sin apóstrofo de fórmula", () => {
    expect(montoPlanilla(-2500, "CLP")).toBe("-2500");
    const csv = construirCsv(
      [{ v: montoPlanilla(-150, "USD") }],
      [{ header: "M", value: (f) => f.v }],
    );
    expect(csv).toBe("M\r\n-1,50");
  });

  it("sin dato es celda vacía, no cero (regla 11)", () => {
    expect(montoPlanilla(null, "CLP")).toBeNull();
    expect(montoPlanilla(undefined, "CLP")).toBeNull();
  });
});

describe("fechas para planilla", () => {
  it("fecha civil tal cual, sin correrla de día", () => {
    expect(fechaPlanilla("2026-10-21", "America/Santiago")).toBe("21-10-2026");
    expect(fechaPlanilla("2026-01-01", "Pacific/Kiritimati")).toBe("01-01-2026");
  });

  it("instante en la hora de la clínica, 24 h", () => {
    // 2026-10-21T02:30Z = 23:30 del 20 en Santiago (UTC-3 en primavera).
    expect(fechaPlanilla("2026-10-21T02:30:00Z", "America/Santiago")).toBe("20-10-2026");
    expect(fechaHoraPlanilla("2026-10-21T02:30:00Z", "America/Santiago")).toBe("20-10-2026 23:30");
    expect(fechaHoraPlanilla("2026-10-21T15:05:00Z", "America/Mexico_City")).toBe(
      "21-10-2026 09:05",
    );
  });

  it("sin fecha es celda vacía", () => {
    expect(fechaPlanilla(null)).toBe("");
    expect(fechaHoraPlanilla(undefined)).toBe("");
  });
});

describe("siNoPlanilla", () => {
  it("Sí / No / vacío", () => {
    expect(siNoPlanilla(true)).toBe("Sí");
    expect(siNoPlanilla(false)).toBe("No");
    expect(siNoPlanilla(null)).toBeNull();
  });
});

describe("permisos de cada lista", () => {
  it("cada lista exige el permiso de su pantalla", () => {
    for (const rol of CLINIC_ROLES) {
      for (const lista of CLAVES_LISTAS_CSV) {
        expect(puedeExportarLista(rol, lista), `${rol} ${lista}`).toBe(
          hasPermission(rol, LISTAS_CSV[lista].permiso),
        );
      }
    }
    expect(puedeExportarLista(null, "pacientes")).toBe(false);
    expect(puedeExportarLista("reception", "presupuestos")).toBe(false);
    expect(puedeExportarLista("accounting", "cuentas_por_cobrar")).toBe(true);
  });

  it("las columnas de dinero salen solo para quien ve finanzas", () => {
    const sinDinero = columnasParaRol(COLUMNAS, "reception", "pacientes").map((c) => c.header);
    expect(sinDinero).toEqual(["Paciente", "Fecha"]);
    const conDinero = columnasParaRol(COLUMNAS, "accounting", "pacientes").map((c) => c.header);
    expect(conDinero).toEqual(["Paciente", "Fecha", "Saldo", "Moneda"]);
    for (const rol of ["dentist", "assistant", "reception"] as ClinicRole[]) {
      expect(puedeVerDineroEnLista(rol, "inventario"), rol).toBe(false);
    }
  });

  it("en caja, quien cobra ve los montos del turno", () => {
    expect(puedeExportarLista("reception", "caja")).toBe(true);
    expect(puedeVerDineroEnLista("reception", "caja")).toBe(true);
    expect(puedeExportarLista("dentist", "caja")).toBe(false);
  });
});

describe("csvDeLista", () => {
  it("arma lo filtrado con separador ; y celdas legibles", () => {
    const filas: Fila[] = [
      { paciente: "María Núñez", saldoCents: 45000, moneda: "CLP", fecha: "2026-10-21" },
      { paciente: "=HYPERLINK(1)", saldoCents: null, moneda: "CLP", fecha: null },
    ];
    const csv = csvDeLista(filas, columnasParaRol(COLUMNAS, "owner", "pacientes"));
    expect(csv.split("\r\n")).toEqual([
      "Paciente;Fecha;Saldo;Moneda",
      "María Núñez;21-10-2026;45000;CLP",
      "'=HYPERLINK(1);;;CLP",
    ]);
  });

  it("nombre de archivo con la lista y la fecha", () => {
    expect(nombreArchivoLista("cuentas_por_cobrar", "2026-10-26")).toBe(
      "cuentas-por-cobrar-2026-10-26.csv",
    );
  });
});

describe("ninguna pantalla exporta por fuera del helper", () => {
  it("las rutas no llaman exportarCsv/descargarCsv directo", () => {
    // EXP-04: el registro de la exportación y el recorte de dinero viven en
    // ExportarCsvLista; una pantalla que descarga por su cuenta se los salta.
    const dir = new URL("../src/routes/_authenticated/_clinic/", import.meta.url);
    const directas = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /\b(exportarCsv|descargarCsv)\(/.test(readFileSync(new URL(f, dir), "utf8")));
    // pruebas-email es una herramienta interna de diagnóstico, sin datos de pacientes.
    expect(directas.filter((f) => f !== "pruebas-email.tsx")).toEqual([]);
  });
});
