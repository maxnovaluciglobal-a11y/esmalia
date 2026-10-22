// Registro de brechas (SEG-06, Ley 21.719): estado vigente a partir de la
// bitácora y exportación. Puro: sin base ni red.
import { describe, expect, it } from "vitest";

import {
  PASOS_ANTE_UNA_BRECHA,
  brechasACsv,
  estadoActualDeBrecha,
  textoTitulares,
  type Incidente,
  type Seguimiento,
} from "@/lib/derechos/brechas";

const INC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function incidente(extra: Partial<Incidente> = {}): Incidente {
  return {
    id: INC,
    detected_at: "2026-10-20T13:00:00Z",
    occurred_at: null,
    title: "Correo con ficha a destinatario equivocado",
    description: "Se envió el PDF de una ficha a otro paciente por error.",
    data_categories: ["identificacion", "contacto"],
    affected_subjects_estimate: null,
    risk_level: "por_evaluar",
    risk_assessment: null,
    measures: null,
    notify_agency: "por_decidir",
    notify_subjects: "por_decidir",
    notification_reason: null,
    responsible_name: "Ana Owner",
    status: "abierto",
    created_by: "u-1",
    created_at: "2026-10-20T13:05:00Z",
    ...extra,
  };
}

function seguimiento(created_at: string, extra: Partial<Seguimiento> = {}): Seguimiento {
  return {
    id: `s-${created_at}`,
    incident_id: INC,
    note: "Seguimiento",
    status: null,
    risk_level: null,
    risk_assessment: null,
    measures: null,
    affected_subjects_estimate: null,
    data_categories: null,
    notify_agency: null,
    notify_subjects: null,
    notification_reason: null,
    agency_notified_at: null,
    subjects_notified_at: null,
    created_by: "u-2",
    created_at,
    ...extra,
  };
}

describe("estado vigente de un incidente", () => {
  it("sin seguimientos es el registro inicial", () => {
    const e = estadoActualDeBrecha(incidente(), []);
    expect(e.status).toBe("abierto");
    expect(e.riskLevel).toBe("por_evaluar");
    expect(e.affectedSubjectsEstimate).toBeNull();
    expect(e.sensible).toBe(false);
    expect(e.notificacionPendiente).toBe(false);
    expect(e.ultimaActualizacion).toBe("2026-10-20T13:05:00Z");
  });

  it("aplica los cambios en orden de creación, aunque lleguen desordenados", () => {
    const e = estadoActualDeBrecha(incidente(), [
      seguimiento("2026-10-22T10:00:00Z", { status: "cerrado", risk_level: "medio" }),
      seguimiento("2026-10-21T10:00:00Z", {
        status: "contenido",
        risk_level: "alto",
        affected_subjects_estimate: 1,
        data_categories: ["identificacion", "salud"],
        notify_agency: "si",
        notify_subjects: "si",
        notification_reason: "Datos de salud expuestos",
      }),
    ]);
    expect(e.status).toBe("cerrado");
    expect(e.riskLevel).toBe("medio");
    expect(e.affectedSubjectsEstimate).toBe(1);
    expect(e.dataCategories).toEqual(["identificacion", "salud"]);
    expect(e.sensible).toBe(true);
    expect(e.notificationReason).toBe("Datos de salud expuestos");
    expect(e.ultimaActualizacion).toBe("2026-10-22T10:00:00Z");
  });

  it("un campo nulo en un seguimiento no borra lo anterior (0 sí es un valor)", () => {
    const e = estadoActualDeBrecha(incidente({ affected_subjects_estimate: 40 }), [
      seguimiento("2026-10-21T10:00:00Z", { affected_subjects_estimate: 0 }),
      seguimiento("2026-10-22T10:00:00Z", { note: "Solo una nota" }),
    ]);
    expect(e.affectedSubjectsEstimate).toBe(0);
  });

  it("marca la notificación pendiente hasta registrar la fecha, y conserva la primera", () => {
    const decidido = seguimiento("2026-10-21T10:00:00Z", { notify_agency: "si" });
    expect(estadoActualDeBrecha(incidente(), [decidido]).notificacionPendiente).toBe(true);
    const e = estadoActualDeBrecha(incidente(), [
      decidido,
      seguimiento("2026-10-21T12:00:00Z", { agency_notified_at: "2026-10-21T11:30:00Z" }),
      seguimiento("2026-10-22T12:00:00Z", { agency_notified_at: "2026-10-22T11:30:00Z" }),
    ]);
    expect(e.notificacionPendiente).toBe(false);
    expect(e.agencyNotifiedAt).toBe("2026-10-21T11:30:00Z");
  });

  it("ignora seguimientos de otro incidente", () => {
    const e = estadoActualDeBrecha(incidente(), [
      seguimiento("2026-10-21T10:00:00Z", { incident_id: "otro", status: "cerrado" }),
    ]);
    expect(e.status).toBe("abierto");
  });
});

describe("exportación y textos", () => {
  it("CSV con la bitácora completa: registro inicial y cada seguimiento", () => {
    const seg = [
      seguimiento("2026-10-21T10:00:00Z", {
        note: "Se pidió borrar el correo",
        status: "contenido",
      }),
    ];
    const csv = brechasACsv(
      [
        {
          incidente: incidente(),
          estado: estadoActualDeBrecha(incidente(), seg),
          seguimientos: seg,
          autores: new Map([
            ["u-1", "Ana Owner"],
            ["u-2", "Beto Admin"],
          ]),
        },
      ],
      "America/Santiago",
    );
    const lineas = csv.trim().split(/\r?\n/);
    expect(lineas).toHaveLength(3);
    expect(lineas[1]).toContain("Registro inicial");
    expect(lineas[2]).toContain("Seguimiento");
    expect(lineas[2]).toContain("Beto Admin");
    expect(lineas[2]).toContain("Contenido");
  });

  it("sin estimado dice 'Sin datos' en vez de un cero inventado", () => {
    expect(textoTitulares(null)).toBe("Sin datos");
    expect(textoTitulares(0)).toBe("0 titulares");
    expect(textoTitulares(1)).toBe("1 titular");
  });

  it("la guía no afirma plazos en horas que la ley chilena no fija", () => {
    const texto = PASOS_ANTE_UNA_BRECHA.map((p) => `${p.titulo} ${p.detalle}`).join(" ");
    expect(texto).not.toMatch(/\b\d+\s*(h|horas)\b/i);
    expect(texto).toContain("sin dilaciones indebidas");
  });
});
