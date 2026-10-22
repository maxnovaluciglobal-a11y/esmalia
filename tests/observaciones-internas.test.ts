import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { archivosFuente } from "./helpers/textos-ui";

/**
 * Las observaciones internas de una cita (`appointments.notes`, AGE-15) son
 * solo del equipo: el formulario dice "El paciente no ve esto". Este test
 * fija esa promesa en el código, sin base:
 *
 * 1. La única lectura de `appointments` que pide `notes` es el detalle del
 *    diálogo "Editar cita" (`getAppointmentFormDetails`). Ni el listado de la
 *    agenda (que se guarda en la caché sin conexión del equipo), ni el portal
 *    del paciente, ni los correos, ni WhatsApp, ni el resumen diario, ni el
 *    webhook la piden. Tampoco `select("*")`, que la traería sin nombrarla.
 * 2. El tipo `Cita` (lo que circula por la agenda, los avisos y las
 *    variables de las plantillas de WhatsApp) no tiene un campo de notas.
 * 3. El detalle con las observaciones solo lo usa la agenda (staff).
 */

const RAIZ = path.resolve(__dirname, "../src");

/** Archivos que pueden leer `appointments.notes`, con el motivo. */
const PUEDEN_LEER_NOTAS: Record<string, string> = {
  "lib/clinic-operations/cita-formulario.functions.ts":
    "getAppointmentFormDetails: precarga el diálogo Editar cita (solo staff)",
};

type Lectura = { archivo: string; columnas: string };

/** Cada `.from("appointments")…select(…)` del código, con las columnas pedidas. */
function lecturasDeCitas(): Lectura[] {
  const out: Lectura[] = [];
  for (const ruta of archivosFuente(RAIZ)) {
    const fuente = readFileSync(ruta, "utf8");
    const archivo = path.relative(RAIZ, ruta);
    for (const m of fuente.matchAll(/\.from\(\s*["']appointments["']\s*\)/g)) {
      // El select va en la misma cadena, unas líneas más abajo (antes de un `;`).
      const resto = fuente.slice(m.index! + m[0].length, m.index! + m[0].length + 600);
      const cadena = resto.split(";")[0];
      const sel = /\.select\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([A-Z_][A-Z0-9_]*))/.exec(cadena);
      if (!sel) continue; // insert/update/delete sin select de columnas
      let columnas = sel[1] ?? sel[2] ?? sel[3] ?? "";
      if (sel[4]) {
        // Constante del mismo archivo: `const APPOINTMENT_COLUMNS = "…"`.
        const def = new RegExp(`const ${sel[4]}\\s*=\\s*\\n?\\s*["'\`]([^"'\`]*)["'\`]`).exec(
          fuente,
        );
        columnas = def?.[1] ?? `<${sel[4]} sin resolver>`;
      }
      out.push({ archivo, columnas });
    }
  }
  return out;
}

describe("observaciones internas de la cita (AGE-15)", () => {
  const lecturas = lecturasDeCitas();

  it("el parser encuentra las lecturas conocidas", () => {
    const archivos = new Set(lecturas.map((l) => l.archivo));
    expect(archivos).toContain("lib/patients/portal.functions.ts");
    expect(archivos).toContain("routes/api.daily-digest.ts");
    expect(archivos).toContain("lib/clinic-operations/appointments.functions.ts");
    const agenda = lecturas.find(
      (l) =>
        l.archivo === "lib/clinic-operations/appointments.functions.ts" &&
        l.columnas.includes("treatment_label, starts_at"),
    );
    expect(agenda?.columnas).toContain("patient_confirmed_at");
  });

  it("solo el detalle de Editar cita lee `notes` (y nadie usa select *)", () => {
    const conNotas = lecturas
      .filter((l) => /(?<![\w])notes(?![\w])|^\s*\*\s*$|,\s*\*/.test(l.columnas))
      .filter((l) => !(l.archivo in PUEDEN_LEER_NOTAS))
      .map((l) => `${l.archivo}: ${l.columnas}`);
    expect(conNotas).toEqual([]);
    for (const l of lecturas) expect(l.columnas, l.archivo).not.toMatch(/sin resolver/);
  });

  it("la lectura permitida sigue existiendo (si no, sacarla de la lista)", () => {
    for (const archivo of Object.keys(PUEDEN_LEER_NOTAS)) {
      expect(
        lecturas.some((l) => l.archivo === archivo && /\bnotes\b/.test(l.columnas)),
        archivo,
      ).toBe(true);
    }
  });

  it("el tipo Cita no tiene notas: no viajan por la agenda, los avisos ni WhatsApp", () => {
    const fuente = readFileSync(path.join(RAIZ, "lib/clinic-operations/clinic-data.ts"), "utf8");
    const cita = /export interface Cita \{([\s\S]*?)\n\}/.exec(fuente)?.[1] ?? "";
    expect(cita).toContain("tratamiento");
    expect(cita).not.toMatch(/\b(?:notas|notes|observaciones)\??:/);
  });

  it("el detalle con observaciones solo lo usa la agenda", () => {
    const usos = archivosFuente(RAIZ)
      .filter((ruta) => readFileSync(ruta, "utf8").includes("getAppointmentFormDetails"))
      .map((ruta) => path.relative(RAIZ, ruta))
      .sort();
    expect(usos).toEqual([
      "lib/clinic-operations/cita-formulario.functions.ts",
      "routes/_authenticated/_clinic/agenda.tsx",
    ]);
  });

  it("el formulario le avisa al equipo que el paciente no lo ve", () => {
    const ui = readFileSync(path.join(RAIZ, "components/cita-formulario.tsx"), "utf8");
    expect(ui).toContain("Observaciones internas");
    expect(ui).toContain("El paciente no ve esto.");
  });
});
