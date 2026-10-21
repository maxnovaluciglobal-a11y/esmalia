/**
 * F5 — ¿la automatización está sirviendo?
 *
 * ── Qué se puede medir hoy y qué no ───────────────────────────────────────
 * El plan pide "página de efectividad con evals propios". Los evals de un
 * modelo de lenguaje necesitan un modelo corriendo, y todavía no hay API
 * keys. Pero sí se puede medir **el eval de las reglas de F4**: cuántos
 * mensajes se resuelven solos y cuántos necesitan que una persona los lea.
 * Ese número es justamente el que decide si pagar inferencia vale la pena.
 *
 * ── La trampa de esta pantalla es estadística, no técnica ─────────────────
 * Con pocos datos, un porcentaje miente con cara de conclusión: 1 de 2 es
 * "50%" y no significa nada. Una clínica que arranca vería cifras que
 * parecen hallazgos. Por eso `proporcion()` **devuelve `null` en el
 * porcentaje** cuando la muestra no alcanza, y la pantalla muestra el conteo
 * crudo en su lugar. Es preferible decir "3 de 5" que "60%".
 *
 * ── Y una advertencia que la pantalla tiene que decir en voz alta ─────────
 * Comparar ausencias con y sin recordatorio **no es un experimento**. La
 * clínica elige a quién le manda recordatorio, y esa elección puede estar
 * correlacionada con quién iba a faltar igual. La comparación sirve como
 * señal, no como prueba de causa.
 */

/** Debajo de esto no se muestra porcentaje: el ruido supera a la señal. */
export const MUESTRA_MINIMA = 20;

export type EstadoCita =
  "tentativa" | "confirmada" | "en-sala" | "ausente" | "finalizada" | "cancelada";

/** Estados en los que la cita ya tuvo desenlace: se sabe si vino o no. */
const CON_DESENLACE = new Set<EstadoCita>(["en-sala", "ausente", "finalizada"]);

export interface CitaMedible {
  status: EstadoCita;
  /** true si se le mandó al menos un recordatorio o check-in. */
  tuvoRecordatorio: boolean;
  /** true si el paciente avisó que venía (eje `patient_confirmed_at`). */
  avisoElPaciente: boolean;
}

export interface MensajeMedible {
  patientId: string;
  direction: "inbound" | "outbound";
  body: string | null;
  createdAt: string;
}

export interface Proporcion {
  numerador: number;
  denominador: number;
  /** `null` cuando el denominador no llega a `MUESTRA_MINIMA`. */
  porcentaje: number | null;
}

export function proporcion(numerador: number, denominador: number): Proporcion {
  const n = Math.max(0, Math.trunc(numerador));
  const d = Math.max(0, Math.trunc(denominador));
  return {
    numerador: Math.min(n, d),
    denominador: d,
    porcentaje: d >= MUESTRA_MINIMA ? Math.round((Math.min(n, d) / d) * 100) : null,
  };
}

/** Ausencias sobre las citas que ya tuvieron desenlace. */
export function tasaDeAusencia(citas: CitaMedible[]): Proporcion {
  const conDesenlace = citas.filter((c) => CON_DESENLACE.has(c.status));
  return proporcion(conDesenlace.filter((c) => c.status === "ausente").length, conDesenlace.length);
}

export interface Comparacion {
  con: Proporcion;
  sin: Proporcion;
  /**
   * Diferencia en puntos porcentuales (sin − con), o `null` si alguno de los
   * dos lados no tiene muestra suficiente. Positivo = el grupo "con" falta
   * menos.
   */
  diferencia: number | null;
}

function comparar(citas: CitaMedible[], tiene: (c: CitaMedible) => boolean): Comparacion {
  const conDesenlace = citas.filter((c) => CON_DESENLACE.has(c.status));
  const con = tasaDeAusencia(conDesenlace.filter(tiene));
  const sin = tasaDeAusencia(conDesenlace.filter((c) => !tiene(c)));
  const diferencia =
    con.porcentaje !== null && sin.porcentaje !== null ? sin.porcentaje - con.porcentaje : null;
  return { con, sin, diferencia };
}

/** ⚠️ Observacional, no experimental: la clínica elige a quién le manda. */
export function ausenciaSegunRecordatorio(citas: CitaMedible[]): Comparacion {
  return comparar(citas, (c) => c.tuvoRecordatorio);
}

/** ⚠️ Idem: quien se toma el trabajo de avisar quizá ya iba a venir. */
export function ausenciaSegunAviso(citas: CitaMedible[]): Comparacion {
  return comparar(citas, (c) => c.avisoElPaciente);
}

export interface CoberturaDeMensajes {
  /** Entrantes que el sistema resolvió sin que nadie los leyera. */
  resueltos: Proporcion;
  /** Desglose de por qué se resolvió cada uno. */
  porTipo: { agenda: number; aviso: number; baja: number };
  /** Los que quedaron para que una persona los leyera. */
  paraLeer: number;
  total: number;
}

/**
 * El eval de las reglas: cuántos mensajes entrantes se resolvieron solos.
 *
 * ⚠️ **El complemento NO es "lo que arreglaría un modelo".** En `paraLeer`
 * entran también los mensajes que legítimamente no son automatizables — un
 * "gracias", una consulta de precio, una foto. El modelo convertiría *parte*
 * de ese grupo, no todo. Presentarlo como oportunidad entera sería inflar el
 * caso de negocio de una funcionalidad que todavía hay que pagar.
 */
export function coberturaDeMensajes(
  mensajes: MensajeMedible[],
  clasificar: (texto: string) => "agenda" | "aviso" | "baja" | null,
): CoberturaDeMensajes {
  const entrantes = mensajes.filter((m) => m.direction === "inbound");
  const porTipo = { agenda: 0, aviso: 0, baja: 0 };
  for (const m of entrantes) {
    const tipo = m.body ? clasificar(m.body) : null;
    if (tipo) porTipo[tipo] += 1;
  }
  const resueltos = porTipo.agenda + porTipo.aviso + porTipo.baja;
  return {
    resueltos: proporcion(resueltos, entrantes.length),
    porTipo,
    paraLeer: entrantes.length - resueltos,
    total: entrantes.length,
  };
}

/**
 * Mediana de minutos entre un mensaje del paciente y la primera respuesta de
 * la clínica.
 *
 * Mediana y no promedio a propósito: una sola conversación olvidada tres días
 * arrastra el promedio y da una cifra que no describe a nadie. Los hilos sin
 * responder **no cuentan** — no son "una respuesta muy lenta", son otra cosa,
 * y se muestran aparte.
 */
export function medianaDeRespuestaEnMinutos(mensajes: MensajeMedible[]): number | null {
  const porPaciente = new Map<string, MensajeMedible[]>();
  for (const m of mensajes) {
    const lista = porPaciente.get(m.patientId) ?? [];
    lista.push(m);
    porPaciente.set(m.patientId, lista);
  }

  const esperas: number[] = [];
  for (const lista of porPaciente.values()) {
    const orden = [...lista].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let entranteAbierto: MensajeMedible | null = null;
    for (const m of orden) {
      if (m.direction === "inbound") {
        // Varios entrantes seguidos cuentan como una sola espera, desde el
        // primero: el paciente ya estaba esperando.
        entranteAbierto = entranteAbierto ?? m;
        continue;
      }
      if (entranteAbierto) {
        const delta =
          new Date(m.createdAt).getTime() - new Date(entranteAbierto.createdAt).getTime();
        if (delta >= 0) esperas.push(Math.round(delta / 60000));
        entranteAbierto = null;
      }
    }
  }

  if (esperas.length === 0) return null;
  esperas.sort((a, b) => a - b);
  const medio = Math.floor(esperas.length / 2);
  return esperas.length % 2 === 1
    ? esperas[medio]
    : Math.round((esperas[medio - 1] + esperas[medio]) / 2);
}

/** Formatea una duración en minutos como algo legible. */
export function formatearEspera(minutos: number): string {
  if (minutos < 1) return "menos de un minuto";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return horas === 1 ? "1 hora" : `${horas} horas`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "1 día" : `${dias} días`;
}

// ─── Lo que volvió ────────────────────────────────────────────────────────

/** Días después de un mensaje de outreach en los que una cita nueva cuenta como "volvió". */
export const DIAS_PARA_VOLVER = 14;

export interface EnvioDeOutreach {
  patientId: string;
  kind: string;
  createdAt: string;
}

export interface CitaCreada {
  patientId: string;
  createdAt: string;
}

export interface VueltaPorTipo {
  kind: string;
  /** Envíos cuya ventana ya cerró, y cuántos terminaron en una cita agendada. */
  volvieron: Proporcion;
  /** Envíos cuya ventana sigue abierta: todavía no se sabe. */
  enCurso: number;
}

export interface CitasTrasOutreach {
  total: Proporcion;
  enCurso: number;
  porTipo: VueltaPorTipo[];
}

/**
 * Por cada mensaje de outreach enviado (recall, presupuesto, saldo…), ¿el
 * paciente agendó una cita en los `dias` siguientes? Cuenta la fecha en que
 * se **creó** la cita, no la fecha de la cita: lo que se mide es la reacción
 * al mensaje.
 *
 * - Un envío cuya ventana no terminó no entra en el denominador (un "no
 *   todavía" no es un "no"); se informa aparte como `enCurso`.
 * - Una misma cita puede seguir a dos mensajes (recall y saldo el mismo día):
 *   cada mensaje cuenta la suya. Es una tasa por mensaje, no un total de
 *   citas generadas.
 * - ⚠️ Observacional, como el resto de la pantalla: quien recibe un recall
 *   quizá iba a llamar igual.
 */
export function citasTrasOutreach(
  envios: EnvioDeOutreach[],
  citas: CitaCreada[],
  ahora: number,
  dias: number = DIAS_PARA_VOLVER,
): CitasTrasOutreach {
  const ventanaMs = dias * 24 * 60 * 60 * 1000;
  const citasPorPaciente = new Map<string, number[]>();
  for (const c of citas) {
    const lista = citasPorPaciente.get(c.patientId) ?? [];
    lista.push(new Date(c.createdAt).getTime());
    citasPorPaciente.set(c.patientId, lista);
  }

  const porKind = new Map<string, { cerrados: number; volvieron: number; enCurso: number }>();
  for (const e of envios) {
    const enviado = new Date(e.createdAt).getTime();
    const cuenta = porKind.get(e.kind) ?? { cerrados: 0, volvieron: 0, enCurso: 0 };
    porKind.set(e.kind, cuenta);
    if (enviado + ventanaMs > ahora) {
      cuenta.enCurso += 1;
      continue;
    }
    cuenta.cerrados += 1;
    const agendo = (citasPorPaciente.get(e.patientId) ?? []).some(
      (t) => t > enviado && t <= enviado + ventanaMs,
    );
    if (agendo) cuenta.volvieron += 1;
  }

  let cerrados = 0;
  let volvieron = 0;
  let enCurso = 0;
  const porTipo: VueltaPorTipo[] = [];
  for (const [kind, c] of porKind) {
    cerrados += c.cerrados;
    volvieron += c.volvieron;
    enCurso += c.enCurso;
    porTipo.push({ kind, volvieron: proporcion(c.volvieron, c.cerrados), enCurso: c.enCurso });
  }
  porTipo.sort(
    (a, b) =>
      b.volvieron.denominador + b.enCurso - (a.volvieron.denominador + a.enCurso) ||
      a.kind.localeCompare(b.kind),
  );
  return { total: proporcion(volvieron, cerrados), enCurso, porTipo };
}
