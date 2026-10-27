import { describe, expect, it } from "vitest";

import { calcularRiesgo, compararPorRiesgo, type DatosDeRiesgo } from "@/lib/seguimiento/riesgo";
import { formatoTasa, medirRetorno } from "@/lib/seguimiento/retorno";

/**
 * Ola 8 · frente B: CRM-07 (riesgo de abandono) y CRM-05 (quién volvió).
 * Lógica pura, sin base.
 */

const DIA = 86_400_000;
const AHORA = Date.UTC(2026, 9, 27, 15, 0, 0);
const hace = (dias: number) => new Date(AHORA - dias * DIA).toISOString();
const despues = (iso: string, dias: number) =>
  new Date(new Date(iso).getTime() + dias * DIA).toISOString();

const base: DatosDeRiesgo = {
  ultimaVisita: hace(10),
  visitas: 3,
  tieneCitaFutura: false,
  inasistencias12m: 0,
  cancelaciones12m: 0,
  presupuestosRechazados12m: 0,
  saldoCents: 0,
};

describe("CRM-07 · riesgo de abandono", () => {
  it("sin visitas atendidas el puntaje es null (regla 11), no cero", () => {
    const r = calcularRiesgo({ ...base, visitas: 0, ultimaVisita: null }, AHORA);
    expect(r.puntaje).toBeNull();
    expect(r.nivel).toBeNull();
    expect(r.factores).toEqual([]);
  });

  it("paciente al día: puntaje 0, nivel bajo y sin factores", () => {
    const r = calcularRiesgo(base, AHORA);
    expect(r.puntaje).toBe(0);
    expect(r.nivel).toBe("bajo");
    expect(r.factores).toEqual([]);
  });

  it("explica cada punto: sin visita, sin cita, inasistencias, presupuesto y saldo", () => {
    const r = calcularRiesgo(
      {
        ...base,
        ultimaVisita: hace(400),
        inasistencias12m: 2,
        presupuestosRechazados12m: 1,
        saldoCents: 15_000,
      },
      AHORA,
    );
    const porClave = Object.fromEntries(r.factores.map((f) => [f.clave, f.puntos]));
    expect(porClave).toEqual({
      sin_visita: 30,
      sin_cita: 10,
      inasistencias: 16,
      presupuesto: 15,
      saldo: 10,
    });
    expect(r.puntaje).toBe(81);
    expect(r.nivel).toBe("alto");
    expect(r.factores.find((f) => f.clave === "sin_visita")?.texto).toBe(
      "Sin visita hace 13 meses",
    );
  });

  it("las inasistencias y cancelaciones topan en 3 y el puntaje no pasa de 100", () => {
    const r = calcularRiesgo(
      {
        ...base,
        ultimaVisita: hace(800),
        inasistencias12m: 9,
        cancelaciones12m: 9,
        presupuestosRechazados12m: 4,
        saldoCents: 1,
        planDetenido: true,
      },
      AHORA,
    );
    expect(r.factores.find((f) => f.clave === "inasistencias")?.puntos).toBe(24);
    expect(r.factores.find((f) => f.clave === "cancelaciones")?.puntos).toBe(12);
    expect(r.puntaje).toBe(100);
  });

  it("una cita agendada resta 20 y no hace negativo el puntaje", () => {
    const conCita = calcularRiesgo(
      { ...base, ultimaVisita: hace(200), tieneCitaFutura: true },
      AHORA,
    );
    expect(conCita.factores.map((f) => f.clave)).toEqual(["sin_visita", "cita_agendada"]);
    expect(conCita.puntaje).toBe(0);
  });

  it("sin cita solo pesa después de 90 días sin visita", () => {
    expect(calcularRiesgo({ ...base, ultimaVisita: hace(30) }, AHORA).puntaje).toBe(0);
    expect(calcularRiesgo({ ...base, ultimaVisita: hace(100) }, AHORA).puntaje).toBe(10);
  });

  it("un saldo desconocido (null) no suma ni resta", () => {
    const r = calcularRiesgo({ ...base, ultimaVisita: hace(200), saldoCents: null }, AHORA);
    expect(r.factores.some((f) => f.clave === "saldo")).toBe(false);
  });

  it("ordena de mayor a menor puntaje y deja 'Sin datos' al final", () => {
    const lista = [
      { nombre: "B", riesgo: calcularRiesgo({ ...base, visitas: 0, ultimaVisita: null }, AHORA) },
      { nombre: "C", riesgo: calcularRiesgo({ ...base, ultimaVisita: hace(200) }, AHORA) },
      { nombre: "A", riesgo: calcularRiesgo({ ...base, ultimaVisita: hace(600) }, AHORA) },
    ];
    expect([...lista].sort(compararPorRiesgo).map((x) => x.nombre)).toEqual(["A", "C", "B"]);
  });
});

describe("CRM-05 · medir quién volvió", () => {
  const contacto = hace(40);

  it("sin contactados las tasas son null (Sin datos), no 0 %", () => {
    const r = medirRetorno({ contactos: [], citas: [], ventanaDias: 60, ahora: AHORA });
    expect(r.contactados).toBe(0);
    expect(r.tasaAgendaron).toBeNull();
    expect(formatoTasa(r.tasaAgendaron)).toBe("Sin datos");
  });

  it("cuenta solo citas creadas después del contacto y dentro de la ventana", () => {
    const r = medirRetorno({
      contactos: [
        { patientId: "p1", contactadoEl: contacto },
        { patientId: "p2", contactadoEl: contacto },
        { patientId: "p3", contactadoEl: contacto },
        { patientId: "p4", contactadoEl: contacto },
      ],
      citas: [
        // p1 agendó y vino.
        {
          patientId: "p1",
          creadaEl: despues(contacto, 2),
          inicio: despues(contacto, 9),
          estado: "finalizada",
        },
        // p2 agendó, todavía no viene.
        {
          patientId: "p2",
          creadaEl: despues(contacto, 5),
          inicio: despues(contacto, 50),
          estado: "confirmada",
        },
        // p3 ya tenía la cita antes del contacto: no es mérito del mensaje.
        { patientId: "p3", creadaEl: hace(60), inicio: despues(contacto, 3), estado: "finalizada" },
        // p4 agendó fuera de la ventana de 30 días.
        {
          patientId: "p4",
          creadaEl: despues(contacto, 35),
          inicio: despues(contacto, 36),
          estado: "finalizada",
        },
      ],
      ventanaDias: 30,
      ahora: AHORA,
    });
    expect(r.contactados).toBe(4);
    expect(r.agendaron).toBe(2);
    expect(r.vinieron).toBe(1);
    expect(r.pacientesQueAgendaron.sort()).toEqual(["p1", "p2"]);
    expect(r.tasaAgendaron).toBe(0.5);
    expect(formatoTasa(r.tasaVinieron)).toBe("25 %");
    expect(r.conVentanaAbierta).toBe(0);
  });

  it("un paciente cuenta una vez, desde su primer contacto", () => {
    const r = medirRetorno({
      contactos: [
        { patientId: "p1", contactadoEl: hace(20) },
        { patientId: "p1", contactadoEl: hace(5) },
      ],
      citas: [{ patientId: "p1", creadaEl: hace(10), inicio: hace(2), estado: "finalizada" }],
      ventanaDias: 60,
      ahora: AHORA,
    });
    expect(r.contactados).toBe(1);
    expect(r.agendaron).toBe(1);
    expect(r.vinieron).toBe(1);
    expect(r.conVentanaAbierta).toBe(1);
  });

  it("una cita futura creada hoy no cuenta como 'vino'", () => {
    const r = medirRetorno({
      contactos: [{ patientId: "p1", contactadoEl: hace(3) }],
      citas: [
        { patientId: "p1", creadaEl: hace(1), inicio: despues(hace(0), 7), estado: "confirmada" },
      ],
      ventanaDias: 60,
      ahora: AHORA,
    });
    expect(r.agendaron).toBe(1);
    expect(r.vinieron).toBe(0);
  });
});
