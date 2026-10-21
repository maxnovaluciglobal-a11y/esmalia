import { describe, expect, it } from "vitest";

import {
  DIAS_PARA_VOLVER,
  MUESTRA_MINIMA,
  ausenciaSegunAviso,
  ausenciaSegunRecordatorio,
  citasTrasOutreach,
  coberturaDeMensajes,
  formatearEspera,
  medianaDeRespuestaEnMinutos,
  proporcion,
  tasaDeAusencia,
  type CitaMedible,
  type EstadoCita,
  type MensajeMedible,
} from "@/lib/messaging/efectividad";

/** F5 — lógica pura, sin Postgres: corre igual en el CI. */

function citas(spec: [EstadoCita, boolean, boolean][]): CitaMedible[] {
  return spec.map(([status, tuvoRecordatorio, avisoElPaciente]) => ({
    status,
    tuvoRecordatorio,
    avisoElPaciente,
  }));
}

/** n citas iguales, para llegar a la muestra mínima sin escribirlas a mano. */
const repetir = (n: number, c: [EstadoCita, boolean, boolean]): [EstadoCita, boolean, boolean][] =>
  Array.from({ length: n }, () => c);

describe("proporcion — un porcentaje con muestra chica es una mentira con cara de dato", () => {
  it("no da porcentaje por debajo de la muestra mínima", () => {
    const p = proporcion(1, 2);
    expect(p.porcentaje).toBeNull();
    expect(p.numerador).toBe(1);
    expect(p.denominador).toBe(2);
  });

  it("da porcentaje justo al llegar a la muestra mínima", () => {
    expect(proporcion(5, MUESTRA_MINIMA).porcentaje).toBe(25);
    expect(proporcion(5, MUESTRA_MINIMA - 1).porcentaje).toBeNull();
  });

  it("un denominador en cero no explota ni divide", () => {
    const p = proporcion(0, 0);
    expect(p.porcentaje).toBeNull();
    expect(p.denominador).toBe(0);
  });

  it("no deja que el numerador supere al denominador", () => {
    expect(proporcion(9, 3).numerador).toBe(3);
  });
});

describe("tasaDeAusencia", () => {
  it("sólo cuenta citas que ya tuvieron desenlace", () => {
    const r = tasaDeAusencia(
      citas([
        ["ausente", true, false],
        ["finalizada", true, false],
        // Estas tres no cuentan: todavía no se sabe si vinieron.
        ["tentativa", true, false],
        ["confirmada", true, false],
        ["cancelada", true, false],
      ]),
    );
    expect(r.denominador).toBe(2);
    expect(r.numerador).toBe(1);
  });

  it("una cita cancelada no es una ausencia", () => {
    const r = tasaDeAusencia(citas(repetir(30, ["cancelada", true, false])));
    expect(r.denominador).toBe(0);
    expect(r.porcentaje).toBeNull();
  });
});

describe("comparaciones", () => {
  it("mide ausencia con y sin recordatorio", () => {
    const r = ausenciaSegunRecordatorio(
      citas([
        ...repetir(5, ["ausente", true, false]),
        ...repetir(20, ["finalizada", true, false]),
        ...repetir(10, ["ausente", false, false]),
        ...repetir(15, ["finalizada", false, false]),
      ]),
    );
    expect(r.con.porcentaje).toBe(20); // 5 de 25
    expect(r.sin.porcentaje).toBe(40); // 10 de 25
    expect(r.diferencia).toBe(20); // el grupo con recordatorio falta 20 pp menos
  });

  it("no calcula diferencia si un lado no tiene muestra suficiente", () => {
    const r = ausenciaSegunRecordatorio(
      citas([
        ...repetir(25, ["finalizada", true, false]),
        ...repetir(3, ["ausente", false, false]),
      ]),
    );
    expect(r.con.porcentaje).toBe(0);
    expect(r.sin.porcentaje).toBeNull();
    expect(r.diferencia).toBeNull();
  });

  it("mide ausencia según haya avisado el paciente", () => {
    const r = ausenciaSegunAviso(
      citas([
        ...repetir(2, ["ausente", true, true]),
        ...repetir(38, ["finalizada", true, true]),
        ...repetir(10, ["ausente", true, false]),
        ...repetir(30, ["finalizada", true, false]),
      ]),
    );
    expect(r.con.porcentaje).toBe(5); // 2 de 40
    expect(r.sin.porcentaje).toBe(25); // 10 de 40
    expect(r.diferencia).toBe(20);
  });
});

describe("coberturaDeMensajes — el eval de las reglas", () => {
  const clasificar = (t: string) =>
    t.includes("hora") ? ("agenda" as const) : t === "si" ? ("aviso" as const) : null;

  const msg = (direction: "inbound" | "outbound", body: string): MensajeMedible => ({
    patientId: "p1",
    direction,
    body,
    createdAt: "2026-09-07T10:00:00Z",
  });

  it("cuenta sólo los entrantes", () => {
    const r = coberturaDeMensajes(
      [msg("inbound", "quiero hora"), msg("outbound", "quiero hora")],
      clasificar,
    );
    expect(r.total).toBe(1);
  });

  it("separa lo que se resolvió solo de lo que hay que leer", () => {
    const r = coberturaDeMensajes(
      [
        msg("inbound", "quiero hora"),
        msg("inbound", "si"),
        msg("inbound", "gracias!"),
        msg("inbound", "cuanto sale una limpieza?"),
      ],
      clasificar,
    );
    expect(r.porTipo).toEqual({ agenda: 1, aviso: 1, baja: 0 });
    expect(r.paraLeer).toBe(2);
    expect(r.resueltos.numerador).toBe(2);
    expect(r.resueltos.denominador).toBe(4);
  });

  it("un mensaje sin texto (una foto) cuenta como para leer", () => {
    const r = coberturaDeMensajes(
      [{ patientId: "p1", direction: "inbound", body: null, createdAt: "2026-09-07T10:00:00Z" }],
      clasificar,
    );
    expect(r.paraLeer).toBe(1);
  });

  it("sin mensajes no inventa una cobertura", () => {
    const r = coberturaDeMensajes([], clasificar);
    expect(r.total).toBe(0);
    expect(r.resueltos.porcentaje).toBeNull();
  });
});

describe("medianaDeRespuestaEnMinutos", () => {
  const m = (
    patientId: string,
    direction: "inbound" | "outbound",
    createdAt: string,
  ): MensajeMedible => ({ patientId, direction, body: "x", createdAt });

  it("mide desde el mensaje del paciente hasta la respuesta", () => {
    expect(
      medianaDeRespuestaEnMinutos([
        m("p1", "inbound", "2026-09-07T10:00:00Z"),
        m("p1", "outbound", "2026-09-07T10:30:00Z"),
      ]),
    ).toBe(30);
  });

  it("varios entrantes seguidos son UNA espera, contada desde el primero", () => {
    expect(
      medianaDeRespuestaEnMinutos([
        m("p1", "inbound", "2026-09-07T10:00:00Z"),
        m("p1", "inbound", "2026-09-07T10:20:00Z"),
        m("p1", "outbound", "2026-09-07T11:00:00Z"),
      ]),
    ).toBe(60);
  });

  it("un hilo sin responder NO cuenta como respuesta lentísima", () => {
    // Si contara, un solo hilo olvidado envenenaría la cifra de todos.
    expect(
      medianaDeRespuestaEnMinutos([
        m("p1", "inbound", "2026-09-07T10:00:00Z"),
        m("p2", "inbound", "2026-09-07T10:00:00Z"),
        m("p2", "outbound", "2026-09-07T10:10:00Z"),
      ]),
    ).toBe(10);
  });

  it("usa mediana y no promedio: un caso extremo no arrastra la cifra", () => {
    const datos = [
      m("p1", "inbound", "2026-09-07T10:00:00Z"),
      m("p1", "outbound", "2026-09-07T10:05:00Z"),
      m("p2", "inbound", "2026-09-07T10:00:00Z"),
      m("p2", "outbound", "2026-09-07T10:10:00Z"),
      m("p3", "inbound", "2026-09-07T10:00:00Z"),
      m("p3", "outbound", "2026-09-10T10:00:00Z"), // 3 días
    ];
    // Promedio ≈ 1445 min. Mediana = 10.
    expect(medianaDeRespuestaEnMinutos(datos)).toBe(10);
  });

  it("no mezcla pacientes: la respuesta a uno no cierra la espera de otro", () => {
    expect(
      medianaDeRespuestaEnMinutos([
        m("p1", "inbound", "2026-09-07T10:00:00Z"),
        m("p2", "outbound", "2026-09-07T10:01:00Z"),
      ]),
    ).toBeNull();
  });

  it("sin ninguna respuesta devuelve null en vez de cero", () => {
    // Cero minutos diría "respondemos al instante", que es lo contrario.
    expect(medianaDeRespuestaEnMinutos([m("p1", "inbound", "2026-09-07T10:00:00Z")])).toBeNull();
  });
});

describe("formatearEspera", () => {
  it("dice la unidad que corresponde", () => {
    expect(formatearEspera(0)).toBe("menos de un minuto");
    expect(formatearEspera(45)).toBe("45 min");
    expect(formatearEspera(60)).toBe("1 hora");
    expect(formatearEspera(300)).toBe("5 horas");
    expect(formatearEspera(1440)).toBe("1 día");
    expect(formatearEspera(4320)).toBe("3 días");
  });
});

describe("citasTrasOutreach", () => {
  const DIA = 24 * 60 * 60 * 1000;
  const AHORA = Date.parse("2026-10-21T12:00:00Z");
  const hace = (d: number) => new Date(AHORA - d * DIA).toISOString();

  it("cuenta el envío si el paciente agendó dentro de la ventana", () => {
    const r = citasTrasOutreach(
      [
        { patientId: "a", kind: "hygiene_recall", createdAt: hace(30) },
        { patientId: "b", kind: "hygiene_recall", createdAt: hace(30) },
        { patientId: "c", kind: "quote_follow_up", createdAt: hace(20) },
      ],
      [
        { patientId: "a", createdAt: hace(25) }, // 5 días después: vuelve
        { patientId: "b", createdAt: hace(10) }, // 20 días después: fuera de la ventana
        { patientId: "c", createdAt: hace(21) }, // antes del mensaje: no cuenta
      ],
      AHORA,
    );
    expect(r.total).toMatchObject({ numerador: 1, denominador: 3 });
    expect(r.enCurso).toBe(0);
    const recall = r.porTipo.find((t) => t.kind === "hygiene_recall")!;
    expect(recall.volvieron).toMatchObject({ numerador: 1, denominador: 2 });
    const presupuesto = r.porTipo.find((t) => t.kind === "quote_follow_up")!;
    expect(presupuesto.volvieron).toMatchObject({ numerador: 0, denominador: 1 });
  });

  it("deja en curso los envíos cuya ventana no cerró, aunque ya hayan agendado", () => {
    const r = citasTrasOutreach(
      [{ patientId: "a", kind: "payment_due", createdAt: hace(3) }],
      [{ patientId: "a", createdAt: hace(1) }],
      AHORA,
    );
    expect(r.total.denominador).toBe(0);
    expect(r.enCurso).toBe(1);
    expect(r.porTipo[0]).toMatchObject({ kind: "payment_due", enCurso: 1 });
  });

  it("el borde: justo a los 14 días cuenta, un minuto después no", () => {
    const enviado = AHORA - 30 * DIA;
    const r = citasTrasOutreach(
      [
        { patientId: "a", kind: "hygiene_recall", createdAt: new Date(enviado).toISOString() },
        { patientId: "b", kind: "hygiene_recall", createdAt: new Date(enviado).toISOString() },
      ],
      [
        { patientId: "a", createdAt: new Date(enviado + DIAS_PARA_VOLVER * DIA).toISOString() },
        {
          patientId: "b",
          createdAt: new Date(enviado + DIAS_PARA_VOLVER * DIA + 60_000).toISOString(),
        },
      ],
      AHORA,
    );
    expect(r.total).toMatchObject({ numerador: 1, denominador: 2 });
  });

  it("sin envíos no inventa nada", () => {
    const r = citasTrasOutreach([], [{ patientId: "a", createdAt: hace(1) }], AHORA);
    expect(r).toEqual({
      total: { numerador: 0, denominador: 0, porcentaje: null },
      enCurso: 0,
      porTipo: [],
    });
  });

  it("el porcentaje aparece recién con muestra suficiente", () => {
    const envios = Array.from({ length: MUESTRA_MINIMA }, (_, i) => ({
      patientId: `p${i}`,
      kind: "hygiene_recall",
      createdAt: hace(30),
    }));
    const citasCreadas = envios
      .slice(0, 5)
      .map((e) => ({ patientId: e.patientId, createdAt: hace(28) }));
    expect(citasTrasOutreach(envios, citasCreadas, AHORA).total.porcentaje).toBe(25);
  });
});
