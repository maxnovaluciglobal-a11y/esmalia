import { describe, expect, it } from "vitest";

import {
  cumpleFiltro,
  describirSegmento,
  edadEn,
  elegibilidad,
  FILTRO_VACIO,
  resumirElegibilidad,
  type PacienteParaCampana,
} from "@/lib/seguimiento/campanas";
import {
  armarControlesPendientes,
  sumarMeses,
  textoDeControl,
  vencimientoDe,
} from "@/lib/seguimiento/controles";
import { casosDetenidos, type PlanActivo } from "@/lib/seguimiento/detenidos";
import { analizarMensaje, renderMensaje, valoresParaPaciente } from "@/lib/seguimiento/plantillas";
import {
  agruparBandeja,
  fechaAlPosponer,
  filtrarPorPersona,
  type Tarea,
} from "@/lib/seguimiento/tareas";

/** Ola 8 · frente B: FIC-13, REC-08, CRM-02, CRM-03, CRM-04 y CRM-06 (lógica pura). */

describe("FIC-13 y REC-08 · controles", () => {
  it("suma meses ajustando al último día del mes", () => {
    expect(sumarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(sumarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(sumarMeses("2026-10-27", 6)).toBe("2027-04-27");
    expect(sumarMeses("2026-11-15", 14)).toBe("2028-01-15");
  });

  it("vencido, por vencer (30 días) o más adelante", () => {
    expect(vencimientoDe("2026-10-20", "2026-10-27")).toBe("vencido");
    expect(vencimientoDe("2026-11-20", "2026-10-27")).toBe("por_vencer");
    expect(vencimientoDe("2027-01-20", "2026-10-27")).toBe("mas_adelante");
  });

  it("junta manuales y recall, sin repetir paciente, con lo vencido y sin cita arriba", () => {
    const lista = armarControlesPendientes({
      manuales: [
        {
          id: "c1",
          patientId: "p1",
          patientName: "Ana",
          patientPhone: null,
          reason: "Endodoncia 36",
          dueOn: "2026-10-01",
          months: 3,
          createdAt: "",
        },
        {
          id: "c2",
          patientId: "p2",
          patientName: "Beto",
          patientPhone: null,
          reason: "Blanqueamiento",
          dueOn: "2026-11-10",
          months: 1,
          createdAt: "",
        },
        {
          id: "c3",
          patientId: "p3",
          patientName: "Caro",
          patientPhone: null,
          reason: "Lejos",
          dueOn: "2027-06-01",
          months: 12,
          createdAt: "",
        },
        {
          id: "c4",
          patientId: "p4",
          patientName: "Dani",
          patientPhone: null,
          reason: "Con cita",
          dueOn: "2026-10-10",
          months: 1,
          createdAt: "",
        },
      ],
      automaticos: [
        { patientId: "p1", patientName: "Ana", patientPhone: null, mesesSinVisita: 7 },
        { patientId: "p5", patientName: "Eli", patientPhone: null, mesesSinVisita: 8 },
      ],
      conCitaFutura: new Set(["p4"]),
      hoy: "2026-10-27",
    });
    expect(lista.map((c) => c.clave)).toEqual(["manual:c1", "auto:p5", "manual:c2", "manual:c4"]);
    expect(lista[0].diasDeAtraso).toBe(26);
    expect(lista.find((c) => c.patientId === "p4")?.tieneCita).toBe(true);
    expect(lista.some((c) => c.controlId === "c3")).toBe(false);
  });

  it("arma el texto de WhatsApp con el motivo, sin datos clínicos de más", () => {
    expect(
      textoDeControl({
        primerNombre: "Ana",
        clinica: "Sonrisa",
        motivo: "control de la endodoncia.",
        origen: "manual",
      }),
    ).toBe(
      "Hola, Ana, te escribimos de Sonrisa para recordarte tu control: control de la endodoncia. ¿Te acomoda agendar una hora?",
    );
  });
});

const tarea = (t: Partial<Tarea>): Tarea => ({
  id: "t",
  title: "Llamar",
  notes: null,
  kind: "llamada",
  patientId: null,
  patientName: null,
  patientPhone: null,
  quoteId: null,
  controlId: null,
  assignedTo: null,
  assignedName: null,
  dueOn: "2026-10-27",
  status: "pendiente",
  postponedCount: 0,
  completedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...t,
});

describe("CRM-02 · bandeja de tareas", () => {
  const tareas = [
    tarea({ id: "a", dueOn: "2026-10-20", assignedTo: "yo" }),
    tarea({ id: "b", dueOn: "2026-10-27", assignedTo: "otra" }),
    tarea({ id: "c", dueOn: "2026-11-02" }),
    tarea({ id: "d", dueOn: "2026-10-01", status: "hecha", assignedTo: "yo" }),
  ];

  it("agrupa solo las pendientes en vencidas, hoy y próximas", () => {
    const g = agruparBandeja(tareas, "2026-10-27");
    expect(g.vencidas.map((t) => t.id)).toEqual(["a"]);
    expect(g.hoy.map((t) => t.id)).toEqual(["b"]);
    expect(g.proximas.map((t) => t.id)).toEqual(["c"]);
  });

  it("filtra por persona: mías, todo el equipo y sin asignar", () => {
    expect(filtrarPorPersona(tareas, "mias", "yo").map((t) => t.id)).toEqual(["a", "d"]);
    expect(filtrarPorPersona(tareas, "sin_asignar", "yo").map((t) => t.id)).toEqual(["c"]);
    expect(filtrarPorPersona(tareas, "todas", "yo")).toHaveLength(4);
  });

  it("posponer una tarea vencida cuenta desde hoy", () => {
    expect(fechaAlPosponer("2026-10-01", "2026-10-27", "1d")).toBe("2026-10-28");
    expect(fechaAlPosponer("2026-11-02", "2026-10-27", "1s")).toBe("2026-11-09");
    expect(fechaAlPosponer("2026-10-27", "2026-10-27", "3d")).toBe("2026-10-30");
  });
});

describe("CRM-06 · casos detenidos", () => {
  const AHORA = Date.UTC(2026, 9, 27);
  const plan = (p: Partial<PlanActivo>): PlanActivo => ({
    planId: "x",
    patientId: "p",
    patientName: "Ana",
    planName: "Plan",
    creadoEl: "2026-06-01T00:00:00Z",
    iniciadoEl: null,
    quoteId: null,
    itemsPendientes: 2,
    itemsCompletados: 0,
    ultimoItemCompletadoEl: null,
    ultimaVisitaEl: null,
    tieneCitaFutura: false,
    ...p,
  });

  it("detecta aceptados sin empezar y tratamientos a medias, el más antiguo primero", () => {
    const casos = casosDetenidos(
      [
        plan({ planId: "sin", creadoEl: "2026-08-01T00:00:00Z" }),
        plan({
          planId: "medias",
          itemsCompletados: 1,
          ultimoItemCompletadoEl: "2026-07-01T00:00:00Z",
        }),
        plan({ planId: "reciente", creadoEl: "2026-10-20T00:00:00Z" }),
        plan({ planId: "con-cita", tieneCitaFutura: true }),
        plan({ planId: "terminado", itemsPendientes: 0, itemsCompletados: 3 }),
        plan({ planId: "visito", ultimaVisitaEl: "2026-10-15T00:00:00Z" }),
      ],
      30,
      AHORA,
    );
    expect(casos.map((c) => c.planId)).toEqual(["medias", "sin"]);
    expect(casos[0].tipo).toBe("a_medias");
    expect(casos[1].tipo).toBe("sin_empezar");
    expect(casos[0].diasSinAvance).toBe(118);
  });
});

describe("CRM-03 · plantillas con variables en español", () => {
  it("avisa variables desconocidas y llaves sueltas", () => {
    expect(analizarMensaje("Hola {{paciente.nombre}}").problemas).toEqual([]);
    expect(analizarMensaje("Hola {{paciente.rut}}").desconocidas).toEqual(["paciente.rut"]);
    expect(analizarMensaje("Hola {paciente}").problemas.join(" ")).toMatch(/llaves/);
    expect(analizarMensaje("x", "{{clinica.nombre}}").problemas).toContain(
      "Escribe el texto del mensaje.",
    );
  });

  it("reemplaza los datos y quita la línea corta de un dato vacío", () => {
    const valores = valoresParaPaciente({
      paciente: "Ana Pérez Soto",
      clinica: "Sonrisa",
      telefonoClinica: null,
      linkReserva: null,
    });
    const texto = renderMensaje(
      "Hola, {{paciente.primer_nombre}}.\n\nReserva aquí: {{reserva.link}}\nLlámanos al {{clinica.telefono}}\n\n{{clinica.nombre}}",
      valores,
    );
    expect(texto).toBe("Hola, Ana.\n\nSonrisa");
  });

  it("en una línea larga quita solo el dato vacío y la puntuación colgando", () => {
    const texto = renderMensaje(
      "Te escribimos porque hace tiempo que no vienes a tu control, reserva aquí: {{reserva.link}}",
      { "reserva.link": null },
    );
    expect(texto).toBe("Te escribimos porque hace tiempo que no vienes a tu control, reserva aquí");
  });

  it("no interpreta llaves de un valor de la ficha", () => {
    const texto = renderMensaje("Hola {{paciente.nombre}}", {
      "paciente.nombre": "{{clinica.nombre}}",
    });
    expect(texto).toBe("Hola {{clinica.nombre}}");
  });
});

const paciente = (p: Partial<PacienteParaCampana>): PacienteParaCampana => ({
  id: "p",
  nombre: "Ana",
  telefono: "+56912345678",
  email: "ana@ejemplo.cl",
  fechaNacimiento: "1990-05-10",
  waOptIn: true,
  waOptOutAt: null,
  emailOptOutAt: null,
  ultimaVisita: "2026-01-10T12:00:00Z",
  tieneCitaFutura: false,
  tienePresupuestoPendiente: false,
  ...p,
});

describe("CRM-04 · grupo y destinatarios de una campaña", () => {
  const hoy = "2026-10-27";

  it("filtra por meses sin visita (o nunca), cita futura, edad y presupuesto", () => {
    const f = { ...FILTRO_VACIO, sinVisitaDesdeMeses: 6, sinCitaFutura: true };
    expect(cumpleFiltro(paciente({}), f, hoy)).toBe(true);
    expect(cumpleFiltro(paciente({ ultimaVisita: null }), f, hoy)).toBe(true);
    expect(cumpleFiltro(paciente({ ultimaVisita: "2026-09-01" }), f, hoy)).toBe(false);
    expect(cumpleFiltro(paciente({ tieneCitaFutura: true }), f, hoy)).toBe(false);
    const edad = { ...FILTRO_VACIO, edadMinima: 18, edadMaxima: 40 };
    expect(cumpleFiltro(paciente({}), edad, hoy)).toBe(true);
    expect(cumpleFiltro(paciente({ fechaNacimiento: null }), edad, hoy)).toBe(false);
    expect(
      cumpleFiltro(paciente({}), { ...FILTRO_VACIO, conPresupuestoPendiente: true }, hoy),
    ).toBe(false);
    expect(edadEn("2008-10-28", hoy)).toBe(17);
  });

  it("describe el grupo en palabras", () => {
    expect(describirSegmento({ tipo: "filtro", filtro: FILTRO_VACIO })).toBe(
      "Todos los pacientes activos",
    );
    expect(
      describirSegmento({
        tipo: "filtro",
        filtro: { ...FILTRO_VACIO, sinVisitaDesdeMeses: 12, sinCitaFutura: true, edadMinima: 18 },
      }),
    ).toBe("Sin visita hace 12 meses o más · sin cita agendada · desde 18 años");
  });

  it("correo: respeta la baja y usa el correo del tutor que ya se resolvió", () => {
    const valido = () => true;
    expect(
      elegibilidad({
        paciente: paciente({ emailOptOutAt: "2026-10-01T00:00:00Z" }),
        canal: "correo",
        contacto: { email: "ana@ejemplo.cl", telefono: null, para: "paciente" },
        telefonoValido: valido,
      }),
    ).toEqual({ ok: false, motivo: "baja_correo" });
    expect(
      elegibilidad({
        paciente: paciente({}),
        canal: "correo",
        contacto: { email: "mama@ejemplo.cl", telefono: null, para: "tutor" },
        telefonoValido: valido,
      }),
    ).toEqual({ ok: true, destino: "mama@ejemplo.cl", para: "tutor" });
    expect(
      elegibilidad({
        paciente: paciente({}),
        canal: "correo",
        contacto: { email: null, telefono: null, para: "paciente" },
        telefonoValido: valido,
      }),
    ).toEqual({ ok: false, motivo: "sin_correo" });
  });

  it("WhatsApp: exige consentimiento, sin baja y teléfono válido", () => {
    const contacto = { email: null, telefono: "+56912345678", para: "paciente" as const };
    expect(
      elegibilidad({
        paciente: paciente({ waOptIn: false }),
        canal: "whatsapp",
        contacto,
        telefonoValido: () => true,
      }),
    ).toEqual({ ok: false, motivo: "sin_consentimiento_whatsapp" });
    expect(
      elegibilidad({
        paciente: paciente({ waOptOutAt: "2026-10-01T00:00:00Z" }),
        canal: "whatsapp",
        contacto,
        telefonoValido: () => true,
      }),
    ).toEqual({ ok: false, motivo: "baja_whatsapp" });
    expect(
      elegibilidad({
        paciente: paciente({}),
        canal: "whatsapp",
        contacto,
        telefonoValido: () => false,
      }),
    ).toEqual({ ok: false, motivo: "sin_telefono" });
    const r = resumirElegibilidad([
      { elegibilidad: { ok: true, destino: "x", para: "paciente" } },
      { elegibilidad: { ok: false, motivo: "sin_telefono" } },
      { elegibilidad: { ok: false, motivo: "sin_telefono" } },
    ]);
    expect(r).toEqual({ enGrupo: 3, elegibles: 1, omitidos: { sin_telefono: 2 } });
  });
});
