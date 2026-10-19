import { describe, expect, it } from "vitest";

import {
  hoyEnLaClinica,
  interpretarMensajeDeAgenda,
  type LecturaDeAgenda,
} from "@/lib/messaging/intencion-de-agenda";

/**
 * F4 — lectura determinista de lo que pide un paciente sobre su hora.
 *
 * Lógica pura, sin Postgres: corre igual en el CI, que apunta a la base de
 * producción. `hoy` se pasa siempre explícito para que el resultado no
 * dependa del día en que corran los tests.
 */

// Lunes 7 de septiembre de 2026 (getDay() === 1).
const LUNES = new Date(2026, 8, 7);

const leer = (t: string, hoy: Date = LUNES) => interpretarMensajeDeAgenda(t, hoy);

describe("intención", () => {
  it("reconoce un pedido de hora", () => {
    expect(leer("Hola, quiero una hora")?.intencion).toBe("agendar");
    expect(leer("necesito un turno")?.intencion).toBe("agendar");
    expect(leer("¿tienen hora disponible?")?.intencion).toBe("agendar");
    expect(leer("me gustaria sacar hora para un control")?.intencion).toBe("agendar");
  });

  it("distingue reagendar de agendar aunque diga 'hora'", () => {
    expect(leer("necesito cambiar mi hora")?.intencion).toBe("reagendar");
    expect(leer("puedo mover la cita?")?.intencion).toBe("reagendar");
    expect(leer("lo dejamos para otro dia")?.intencion).toBe("reagendar");
  });

  it("reconoce una cancelación", () => {
    expect(leer("quiero cancelar mi hora")?.intencion).toBe("cancelar");
    expect(leer("necesito anular la cita")?.intencion).toBe("cancelar");
    expect(leer("no voy a poder ir")?.intencion).toBe("cancelar");
  });

  it("devuelve null ante 'cancelar y reagendar', que son cosas opuestas", () => {
    // Este es exactamente el 20% que le toca al modelo, no a las reglas.
    expect(leer("quiero cancelar la hora del jueves y reagendarla")).toBeNull();
  });
});

describe("lo que NO debe leer como pedido de agenda", () => {
  it("ignora una confirmación, que es de otro eje", () => {
    // `patient-confirmation.ts` se ocupa de esto y corre antes en el webhook.
    for (const t of ["si", "SI", "ok", "confirmo", "ahi voy"]) {
      expect(leer(t)).toBeNull();
    }
  });

  it("ignora una baja de WhatsApp", () => {
    for (const t of ["BAJA", "STOP", "NO MAS", "UNSUBSCRIBE"]) {
      expect(leer(t)).toBeNull();
    }
  });

  it("ignora charla suelta sin palabra de cita", () => {
    for (const t of ["gracias!", "buenos dias", "quiero saber el precio", "ya pague"]) {
      expect(leer(t)).toBeNull();
    }
  });

  it("no lee un verbo suelto sin objeto: 'quiero' no es pedir hora", () => {
    expect(leer("quiero")).toBeNull();
    expect(leer("necesito hablar con la doctora")).toBeNull();
  });

  it("no intenta leer texto largo: ese territorio es del modelo", () => {
    const largo =
      "hola buenas tardes queria consultar si tienen hora disponible porque mi hijo " +
      "tiene una molestia hace varios dias y no sabemos si es la muela del juicio o " +
      "que puede ser, ademas queriamos preguntar por el presupuesto de ortodoncia";
    expect(largo.length).toBeGreaterThan(160);
    expect(leer(largo)).toBeNull();
  });

  it("un mensaje vacío o de sólo signos no es nada", () => {
    expect(leer("")).toBeNull();
    expect(leer("???")).toBeNull();
  });
});

describe("fecha", () => {
  it("entiende hoy, mañana y pasado mañana", () => {
    expect(leer("quiero hora para hoy")?.fecha).toBe("2026-09-07");
    expect(leer("quiero hora para mañana")?.fecha).toBe("2026-09-08");
    expect(leer("quiero hora pasado mañana")?.fecha).toBe("2026-09-09");
  });

  it("un día de la semana es la PRÓXIMA ocurrencia futura", () => {
    // Lunes 7. El jueves más cercano es el 10.
    expect(leer("quiero hora para el jueves")?.fecha).toBe("2026-09-10");
    // Decir "el lunes" un lunes significa el que viene, no hoy: proponer una
    // fecha ya pasada es peor que proponer una lejana.
    expect(leer("quiero hora el lunes")?.fecha).toBe("2026-09-14");
  });

  it("'el próximo jueves' salta una semana más", () => {
    expect(leer("quiero hora el proximo jueves")?.fecha).toBe("2026-09-17");
  });

  it("entiende una fecha escrita con mes", () => {
    expect(leer("quiero hora para el 23 de septiembre")?.fecha).toBe("2026-09-23");
  });

  it("una fecha de un mes ya pasado se entiende del año que viene", () => {
    expect(leer("quiero hora el 5 de marzo")?.fecha).toBe("2027-03-05");
  });

  it("entiende el formato numérico dd/mm", () => {
    expect(leer("quiero hora el 23/09")?.fecha).toBe("2026-09-23");
  });

  it("descarta una fecha que no existe en vez de correrla de mes", () => {
    // `new Date(2027, 1, 30)` no falla: se convierte en marzo.
    expect(leer("quiero hora el 30 de febrero")?.fecha).toBeNull();
    expect(leer("quiero hora el 31/04")?.fecha).toBeNull();
  });

  it("sin fecha en el mensaje, la intención igual vale", () => {
    const r = leer("quiero una hora") as LecturaDeAgenda;
    expect(r.intencion).toBe("agendar");
    expect(r.fecha).toBeNull();
  });
});

describe("franja del día — la trampa de 'mañana'", () => {
  it("'mañana' sola es el día siguiente", () => {
    const r = leer("quiero hora para mañana") as LecturaDeAgenda;
    expect(r.fecha).toBe("2026-09-08");
    expect(r.franja).toBeNull();
  });

  it("'por la mañana' es la franja, no el día", () => {
    const r = leer("quiero hora el jueves por la mañana") as LecturaDeAgenda;
    expect(r.fecha).toBe("2026-09-10");
    expect(r.franja).toBe("manana");
  });

  it("'mañana por la mañana' es las dos cosas a la vez", () => {
    const r = leer("quiero hora mañana por la mañana") as LecturaDeAgenda;
    expect(r.fecha).toBe("2026-09-08");
    expect(r.franja).toBe("manana");
  });

  it("reconoce la tarde", () => {
    expect(leer("quiero hora el martes en la tarde")?.franja).toBe("tarde");
    expect(leer("quiero hora despues de las 5")?.franja).toBe("tarde");
  });

  it("'temprano' cuenta como mañana", () => {
    expect(leer("quiero hora temprano el viernes")?.franja).toBe("manana");
  });
});

describe("robustez", () => {
  it("no depende de tildes ni mayúsculas", () => {
    const a = leer("QUIERO HORA PARA EL MIERCOLES");
    const b = leer("quiero hora para el miércoles");
    expect(a).toEqual(b);
    expect(a?.fecha).toBe("2026-09-09");
  });

  it("cruza el fin de mes sin perderse", () => {
    // Lunes 28 de septiembre: el jueves siguiente es el 1 de octubre.
    const finDeMes = new Date(2026, 8, 28);
    expect(leer("quiero hora el jueves", finDeMes)?.fecha).toBe("2026-10-01");
  });

  it("cruza el cambio de año", () => {
    const finDeAno = new Date(2026, 11, 30); // miércoles 30-dic-2026
    expect(leer("quiero hora el viernes", finDeAno)?.fecha).toBe("2027-01-01");
  });
});

describe("hoyEnLaClinica — el huso de la clínica, no el del servidor", () => {
  it("a las 22:00 de Santiago todavía es el mismo día, aunque en UTC sea el siguiente", () => {
    // 2026-09-08T01:00:00Z = 22:00 del 7-sep en Santiago (UTC-3).
    const instante = new Date("2026-09-08T01:00:00Z");
    expect(instante.getUTCDate()).toBe(8); // en UTC ya es el 8
    const hoy = hoyEnLaClinica("America/Santiago", instante);
    expect(hoy.getDate()).toBe(7); // en la clínica sigue siendo el 7
    expect(hoy.getMonth()).toBe(8);
  });

  it("por eso 'mañana' no se corre un día", () => {
    // Se comparan HUSOS EXPLÍCITOS, no el reloj de la máquina: este test
    // corre en Santiago en el laptop y en UTC en el CI, y un test cuyo
    // resultado depende de dónde corre no prueba nada.
    const instante = new Date("2026-09-08T01:00:00Z"); // 22:00 del 7 en Santiago

    const enElServidor = interpretarMensajeDeAgenda(
      "quiero hora para mañana",
      hoyEnLaClinica("UTC", instante),
    );
    const enLaClinica = interpretarMensajeDeAgenda(
      "quiero hora para mañana",
      hoyEnLaClinica("America/Santiago", instante),
    );

    // Ésta es la diferencia exacta que produce el bug en producción: Vercel
    // corre en UTC y la clínica vive en su huso.
    expect(enElServidor?.fecha).toBe("2026-09-09");
    expect(enLaClinica?.fecha).toBe("2026-09-08");
  });

  it("cada clínica ve su propio día", () => {
    // 2026-09-08T04:00:00Z: 01:00 del 8 en Santiago, 22:00 del 7 en México.
    const instante = new Date("2026-09-08T04:00:00Z");
    expect(hoyEnLaClinica("America/Santiago", instante).getDate()).toBe(8);
    expect(hoyEnLaClinica("America/Mexico_City", instante).getDate()).toBe(7);
  });

  it("un huso inválido cae al de la clínica por defecto en vez de romper", () => {
    const instante = new Date("2026-09-08T04:00:00Z");
    expect(hoyEnLaClinica("", instante).getDate()).toBe(
      hoyEnLaClinica("America/Santiago", instante).getDate(),
    );
  });
});
