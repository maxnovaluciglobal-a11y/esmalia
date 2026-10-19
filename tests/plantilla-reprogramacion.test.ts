import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { Constants } from "@/integrations/supabase/types";
import { cuerpoConVariables, PLANTILLAS_META } from "@/lib/messaging/meta-plantillas";
import {
  MESSAGE_TEMPLATE_KIND_LABELS,
  MESSAGE_TEMPLATE_KINDS,
  renderTemplate,
} from "@/lib/messaging/messaging";
import { buildMetaTemplateParams, META_TEMPLATE_PARAM_ORDER } from "@/lib/messaging/whatsapp";

// PR 9 del rediseño A+: plantilla `appointment_rescheduled` para avisar al
// paciente cuando se mueve su cita. El texto lo aprobó Walter el 19-oct-2026.

const MIGRACIONES = path.resolve(__dirname, "../supabase/migrations");
const ENUM = "20261020000100_plantilla_reprogramacion.sql";
const SIEMBRA = "20261020000200_plantilla_reprogramacion_seed.sql";
const SIEMBRA_ANTERIOR = "20260901120200_appointment_checkin_subject_tuteo_fix.sql";

const CUERPO =
  "Hola {paciente}, tu cita en {clinica} cambió al {fecha_larga} a las {hora} con {profesional}. Si no te sirve, responde a este mensaje";

function leer(nombre: string): string {
  return readFileSync(path.join(MIGRACIONES, nombre), "utf8");
}

/** SQL sin comentarios de línea, para no contar lo que dice la cabecera. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

/** Pares (kind, name) que siembra handle_new_clinic() en un archivo. */
function plantillasDeHandleNewClinic(sql: string): string[] {
  const inicio = sql.indexOf("CREATE OR REPLACE FUNCTION public.handle_new_clinic()");
  const fin = sql.indexOf("END; $$;", inicio);
  const cuerpo = sql.slice(inicio, fin);
  return [...cuerpo.matchAll(/\(NEW\.id, '(\w+)', '([^']+)'/g)].map((m) => `${m[1]} · ${m[2]}`);
}

describe("plantilla de reprogramación (appointment_rescheduled)", () => {
  it("el kind existe en el código, con etiqueta, y en types.ts", () => {
    expect(MESSAGE_TEMPLATE_KINDS).toContain("appointment_rescheduled");
    expect(MESSAGE_TEMPLATE_KIND_LABELS.appointment_rescheduled).toBe("Aviso de reprogramación");
    expect(Constants.public.Enums.message_template_kind).toContain("appointment_rescheduled");
  });

  it("los kinds del código y los del enum de types.ts son los mismos", () => {
    expect([...MESSAGE_TEMPLATE_KINDS].sort()).toEqual(
      [...Constants.public.Enums.message_template_kind].sort(),
    );
  });

  it("el valor del enum va solo en su archivo (unsafe use of new enum value)", () => {
    const sql = sinComentarios(leer(ENUM)).trim();
    expect(sql).toBe(
      "ALTER TYPE public.message_template_kind ADD VALUE IF NOT EXISTS 'appointment_rescheduled';",
    );
  });

  it("la siembra va en una migración posterior a la del enum", () => {
    const archivos = readdirSync(MIGRACIONES).sort();
    expect(archivos.indexOf(SIEMBRA)).toBeGreaterThan(archivos.indexOf(ENUM));
    expect(sinComentarios(leer(SIEMBRA))).not.toMatch(/ALTER TYPE/);
  });

  it("ninguna versión de migración se repite", () => {
    const versiones = readdirSync(MIGRACIONES)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0]);
    expect(new Set(versiones).size).toBe(versiones.length);
  });

  it("siembra el texto aprobado en clínicas nuevas y en las existentes", () => {
    const sql = sinComentarios(leer(SIEMBRA));
    // Una vez en handle_new_clinic() y otra en el backfill.
    expect(sql.split(`'${CUERPO}'`).length - 1).toBe(2);
    expect(plantillasDeHandleNewClinic(sql)).toContain(
      "appointment_rescheduled · Aviso de reprogramación",
    );
    expect(sql).toMatch(/FROM public\.clinics c\s+ON CONFLICT DO NOTHING;/);
  });

  it("handle_new_clinic() conserva todas las plantillas que ya sembraba", () => {
    const antes = plantillasDeHandleNewClinic(leer(SIEMBRA_ANTERIOR));
    const despues = plantillasDeHandleNewClinic(leer(SIEMBRA));
    expect(antes.length).toBeGreaterThan(10);
    expect(despues).toEqual([...antes, "appointment_rescheduled · Aviso de reprogramación"]);
  });

  it("se lee como pidió Walter, en tuteo", () => {
    const texto = renderTemplate(CUERPO, {
      paciente: "Valentina",
      clinica: "Clínica Sonrisa",
      fecha_larga: "jueves 16 de octubre",
      hora: "11:00",
      profesional: "Dra. Rojas",
    });
    expect(texto).toBe(
      "Hola Valentina, tu cita en Clínica Sonrisa cambió al jueves 16 de octubre a las 11:00 con Dra. Rojas. Si no te sirve, responde a este mensaje",
    );
  });

  it("la plantilla de Meta tiene el mismo texto que la fila sembrada", () => {
    expect(PLANTILLAS_META.appointment_rescheduled.categoria).toBe("UTILITY");
    expect(cuerpoConVariables("appointment_rescheduled")).toBe(CUERPO);
  });

  it("arma los parámetros de Meta en orden y exige el profesional", () => {
    const vars = {
      paciente: "Valentina",
      clinica: "Clínica Sonrisa",
      fecha_larga: "jueves 16 de octubre",
      hora: "11:00",
      profesional: "Dra. Rojas",
    };
    expect(buildMetaTemplateParams("appointment_rescheduled", vars)).toEqual([
      "Valentina",
      "Clínica Sonrisa",
      "jueves 16 de octubre",
      "11:00",
      "Dra. Rojas",
    ]);
    expect(META_TEMPLATE_PARAM_ORDER.appointment_rescheduled).toHaveLength(5);
    expect(() =>
      buildMetaTemplateParams("appointment_rescheduled", { ...vars, profesional: "" }),
    ).toThrow(/profesional/);
  });
});
