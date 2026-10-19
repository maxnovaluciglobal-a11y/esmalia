/**
 * Las plantillas de correo de ciclo de vida, como funciones puras.
 * Cada una devuelve `{ subject, html, text }` a partir de datos ya resueltos.
 *
 * Tono: español neutro con tuteo (sin voseo), sin signos de exclamación y sin
 * emoji. Los números salen de los mismos cálculos que la app; cuando no hay
 * dato se dice "Sin datos", nunca un cero inventado (regla 11).
 *
 * Las muestras de QA (`scripts/email-muestras.ts`) llaman a ESTAS funciones:
 * no hay copias a mano que puedan quedar desincronizadas.
 */
import { formatMoney } from "@/lib/finance/finance";
import { GRACIA_PAGO_FALLIDO_DIAS } from "@/lib/billing";
import { CALENDLY_PUESTA_EN_MARCHA, MINUTOS_PUESTA_EN_MARCHA } from "@/lib/marketing/calendly";

import {
  elegirAccionSugerida,
  fechaConDia,
  fechaLarga,
  variacion,
  type DatosSemana,
} from "./ciclo-de-vida";
import { p, pTenue, renderCorreo, type Bloque, type CorreoRenderizado } from "./layout";

const unir = (app: string, ruta: string) => `${app.replace(/\/+$/, "")}${ruta}`;
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
const saludo = (nombre: string | null | undefined) => {
  const primero = (nombre ?? "").trim().split(/\s+/)[0];
  return primero ? `Hola, ${primero}.` : "Hola.";
};

/**
 * Los planes de Esmalia se cobran en dólares y "$69.00" a secas se confunde
 * con pesos: los montos de Stripe llevan el código de la moneda al lado.
 */
const montoConMoneda = (cents: number, currency: string) =>
  `${formatMoney(cents, currency)} ${currency.toUpperCase()}`;

/** Qué queda bloqueado cuando el trial vence sin tarjeta (`trialInformesBloqueados`). */
const LO_QUE_SE_PAUSA = "finanzas, comisiones, inventario y panel de desempeño";

// ─── a. Bienvenida ───────────────────────────────────────────────────────

export interface DatosBienvenida {
  appUrl: string;
  clinicName: string;
  nombre?: string | null;
  /** Fecha local (YYYY-MM-DD) en que termina la prueba, si se conoce. */
  finDePrueba?: string | null;
  diasDePrueba: number;
}

export function correoBienvenida(d: DatosBienvenida): CorreoRenderizado {
  const bloques: Bloque[] = [
    p(saludo(d.nombre)),
    p(
      { negrita: d.clinicName },
      ` ya tiene su espacio en Esmalia. Tienes ${d.diasDePrueba} días de prueba gratis, sin ingresar una tarjeta`,
      d.finDePrueba ? `: la prueba termina el ${fechaLarga(d.finDePrueba)}.` : ".",
    ),
    // Las 3 funciones de `requiereLlamadaOSuscripcion()` (billing.ts) no se
    // abren solas con la prueba: decirlo acá evita que la clínica lo descubra
    // al intentar usarlas.
    {
      tipo: "recuadro",
      titulo: "Tres funciones se activan con una llamada",
      partes: [
        `El WhatsApp de la clínica, el portal del paciente y la página de efectividad se activan en una llamada de puesta en marcha de ${MINUTOS_PUESTA_EN_MARCHA} minutos, o al suscribirte. En la llamada revisamos tu configuración y te ayudamos a traer tus pacientes.`,
      ],
      // Mismo Calendly que `LlamadaDesbloqueo` (llamada-desbloqueo.tsx).
      enlace: { texto: "Agendar la llamada", href: CALENDLY_PUESTA_EN_MARCHA },
    },
    { tipo: "boton", texto: "Entrar a Esmalia", href: unir(d.appUrl, "/dashboard") },
    { tipo: "subtitulo", texto: "Primeros pasos" },
    {
      tipo: "pasos",
      pasos: [
        {
          titulo: "Carga a tus profesionales y sus horarios",
          detalle: "Así la agenda sabe quién atiende y en qué horario.",
          href: unir(d.appUrl, "/profesionales"),
        },
        {
          titulo: "Importa tus pacientes desde un CSV",
          detalle: "En Pacientes puedes subir la planilla que ya usas, sin cargarlos uno por uno.",
          href: unir(d.appUrl, "/pacientes"),
        },
        {
          titulo: "Invita a tu equipo",
          detalle: "Recepción, asistentes y doctores, cada uno con su rol y sus permisos.",
          href: unir(d.appUrl, "/equipo"),
        },
        {
          titulo: "Agenda la primera cita",
          detalle: "Con eso la clínica ya está funcionando dentro de Esmalia.",
          href: unir(d.appUrl, "/agenda"),
        },
      ],
    },
    p(
      "Si algo no se entiende o necesitas ayuda para cargar tus datos, responde este correo. Lo lee una persona del equipo de Esmalia.",
    ),
  ];
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: "Tu clínica ya está en Esmalia",
    preencabezado: `Tienes ${d.diasDePrueba} días gratis, sin tarjeta. Estos son los primeros pasos.`,
    titulo: "Tu clínica ya está en Esmalia",
    bloques,
    pie: { motivo: `Recibes este correo porque creaste ${d.clinicName} en Esmalia.` },
  });
}

// ─── b. Fin de la prueba (T-3 y T-0) ─────────────────────────────────────

export interface DatosFinDePrueba {
  appUrl: string;
  clinicName: string;
  nombre?: string | null;
  cuando: "t3" | "t0";
  /** Fecha local (YYYY-MM-DD) del último día de prueba. */
  finDePrueba: string;
  /** Citas agendadas (no canceladas) desde que se creó la clínica. */
  citasAgendadas: number;
  pacientesCargados: number;
}

/** La primera frase: un dato real de la prueba antes de pedir nada. */
function fraseDeUso(d: DatosFinDePrueba): Bloque {
  if (d.citasAgendadas > 0) {
    return p(
      "En estos días, ",
      d.clinicName,
      " agendó ",
      { negrita: `${d.citasAgendadas} ${plural(d.citasAgendadas, "cita", "citas")}` },
      d.pacientesCargados > 0
        ? ` y ya tiene ${d.pacientesCargados} ${plural(d.pacientesCargados, "paciente cargado", "pacientes cargados")}.`
        : ".",
    );
  }
  if (d.pacientesCargados > 0) {
    return p(
      "En estos días cargaste ",
      {
        negrita: `${d.pacientesCargados} ${plural(d.pacientesCargados, "paciente", "pacientes")}`,
      },
      ` en ${d.clinicName}. Todavía no hay citas en la agenda: si te falta algo para empezar, responde este correo y te ayudamos.`,
    );
  }
  return p(
    `Todavía no hay citas ni pacientes en ${d.clinicName}. Si te falta algo para empezar, responde este correo y te ayudamos a cargar la agenda.`,
  );
}

export function correoFinDePrueba(d: DatosFinDePrueba): CorreoRenderizado {
  const esHoy = d.cuando === "t0";
  const cta: Bloque = {
    tipo: "boton",
    texto: "Elegir un plan",
    href: unir(d.appUrl, "/suscripcion"),
  };
  const bloques: Bloque[] = esHoy
    ? [
        p(saludo(d.nombre)),
        fraseDeUso(d),
        p(
          "Hoy termina tu prueba gratis. Desde mañana la agenda, los pacientes y las fichas clínicas siguen funcionando igual; los informes (",
          LO_QUE_SE_PAUSA,
          ") quedan en pausa hasta que elijas un plan.",
        ),
        p(
          "No cobramos nada sin que lo actives tú: el cobro empieza solo cuando eliges un plan y agregas una tarjeta.",
        ),
        cta,
        pTenue("Si tienes dudas sobre los planes, responde este correo."),
      ]
    : [
        p(saludo(d.nombre)),
        fraseDeUso(d),
        p(
          "Tu prueba gratis termina el ",
          { negrita: fechaConDia(d.finDePrueba) },
          ". Para seguir con todo sin interrupciones, elige un plan y agrega una tarjeta. ",
          { negrita: "No se cobra nada antes de esa fecha." },
        ),
        p(
          "Si decides no suscribirte, la agenda, los pacientes y las fichas siguen disponibles; los informes (",
          LO_QUE_SE_PAUSA,
          ") quedan en pausa.",
        ),
        cta,
        pTenue("Si tienes dudas sobre los planes, responde este correo."),
      ];
  const usoCorto =
    d.citasAgendadas > 0
      ? `${d.citasAgendadas} ${plural(d.citasAgendadas, "cita agendada", "citas agendadas")} hasta ahora.`
      : "";
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: esHoy ? "Tu prueba de Esmalia termina hoy" : "Tu prueba de Esmalia termina en 3 días",
    preencabezado: esHoy
      ? `${usoCorto} La agenda y las fichas siguen disponibles; los informes quedan en pausa.`.trim()
      : `${usoCorto} No se cobra nada antes del ${fechaLarga(d.finDePrueba)}.`.trim(),
    titulo: esHoy ? "Hoy termina tu prueba" : "Quedan 3 días de prueba",
    bloques,
    pie: {
      motivo: `Recibes este correo porque eres responsable de la cuenta de ${d.clinicName} en Esmalia.`,
    },
  });
}

// ─── b2. Fin de la prueba gestionada por Stripe (trial_will_end) ─────────

export interface DatosFinDePruebaStripe {
  appUrl: string;
  clinicName: string;
  nombre?: string | null;
  /** Fecha local (YYYY-MM-DD) en que termina la prueba. */
  finDePrueba: string;
  /** ¿La suscripción ya tiene una tarjeta con la que cobrar? */
  tieneMedioDePago: boolean;
  plan: string;
  /** Primer cobro, en la unidad mínima de la moneda (como Stripe). */
  montoCents: number | null;
  currency: string | null;
}

/**
 * La clínica pasó por el checkout con prueba: Stripe lleva el calendario y
 * avisa 3 días antes (`customer.subscription.trial_will_end`). Distinto del
 * aviso del trial de la base: acá ya hay una suscripción, y lo que importa
 * es si hay tarjeta para el primer cobro.
 */
export function correoFinDePruebaStripe(d: DatosFinDePruebaStripe): CorreoRenderizado {
  const monto =
    d.montoCents !== null && d.currency ? montoConMoneda(d.montoCents, d.currency) : null;
  const bloques: Bloque[] = d.tieneMedioDePago
    ? [
        p(saludo(d.nombre)),
        p(
          `La prueba del plan ${d.plan} de ${d.clinicName} termina el `,
          { negrita: fechaConDia(d.finDePrueba) },
          monto
            ? `. Ese día se hace el primer cobro, de ${monto}, con la tarjeta que registraste.`
            : ". Ese día se hace el primer cobro con la tarjeta que registraste.",
        ),
        p("No tienes que hacer nada para seguir. Todo sigue funcionando igual."),
        p(
          "Si quieres cambiar de plan o de tarjeta, o cancelar antes del cobro, entra a Suscripción y usa ",
          { negrita: "Gestionar facturación" },
          ".",
        ),
        { tipo: "boton", texto: "Revisar mi suscripción", href: unir(d.appUrl, "/suscripcion") },
        pTenue("Si tienes dudas, responde este correo."),
      ]
    : [
        p(saludo(d.nombre)),
        p(
          `La prueba del plan ${d.plan} de ${d.clinicName} termina el `,
          { negrita: fechaConDia(d.finDePrueba) },
          " y todavía no hay una tarjeta registrada.",
        ),
        p(
          "Para seguir con todo sin interrupciones, agrega una tarjeta antes de esa fecha. Si no, no podremos cobrar: la agenda, los pacientes y las fichas siguen disponibles, y los informes (",
          LO_QUE_SE_PAUSA,
          ") quedan en pausa.",
        ),
        { tipo: "boton", texto: "Agregar una tarjeta", href: unir(d.appUrl, "/suscripcion") },
        pTenue("Si tienes dudas sobre los planes, responde este correo."),
      ];
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: "Tu prueba de Esmalia termina en 3 días",
    preencabezado: d.tieneMedioDePago
      ? `El primer cobro es el ${fechaLarga(d.finDePrueba)}. No tienes que hacer nada.`
      : `Agrega una tarjeta antes del ${fechaLarga(d.finDePrueba)} para seguir con todo.`,
    titulo: "Quedan 3 días de prueba",
    bloques,
    pie: {
      motivo: `Recibes este correo porque eres responsable de la cuenta de ${d.clinicName} en Esmalia.`,
    },
  });
}

// ─── c. Suscripción activa ───────────────────────────────────────────────

export interface DatosSuscripcionActiva {
  appUrl: string;
  clinicName: string;
  nombre?: string | null;
  plan: string;
  /** Monto por período en la unidad mínima de la moneda (como Stripe). */
  montoCents: number | null;
  currency: string | null;
  intervalo?: "mes" | "año" | null;
  /** Fecha local (YYYY-MM-DD) del próximo cobro. */
  proximoCobro: string | null;
}

export function correoSuscripcionActiva(d: DatosSuscripcionActiva): CorreoRenderizado {
  const monto =
    d.montoCents !== null && d.currency
      ? `${montoConMoneda(d.montoCents, d.currency)}${d.intervalo ? ` al ${d.intervalo}` : ""}`
      : "Sin datos";
  const bloques: Bloque[] = [
    p(saludo(d.nombre)),
    p(
      "Gracias por confiar en Esmalia. La suscripción de ",
      { negrita: d.clinicName },
      " está activa.",
    ),
    {
      tipo: "tabla",
      filas: [
        { etiqueta: "Plan", valor: d.plan },
        { etiqueta: "Monto", valor: monto },
        {
          etiqueta: "Próximo cobro",
          valor: d.proximoCobro ? fechaLarga(d.proximoCobro) : "Sin datos",
        },
      ],
    },
    p("Desde Suscripción puedes ver tus facturas, cambiar la tarjeta o cancelar cuando quieras."),
    { tipo: "boton", texto: "Ver mi suscripción", href: unir(d.appUrl, "/suscripcion") },
    pTenue("Si algo de este cobro no te cuadra, responde este correo."),
  ];
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: "Tu suscripción a Esmalia está activa",
    preencabezado:
      `Plan ${d.plan}. ${d.proximoCobro ? `Próximo cobro: ${fechaLarga(d.proximoCobro)}.` : ""}`.trim(),
    titulo: "Tu suscripción está activa",
    bloques,
    pie: {
      motivo: `Recibes este correo porque eres responsable de la cuenta de ${d.clinicName} en Esmalia.`,
    },
  });
}

// ─── d. Pago fallido ─────────────────────────────────────────────────────

export interface DatosPagoFallido {
  appUrl: string;
  clinicName: string;
  nombre?: string | null;
  montoCents: number | null;
  currency: string | null;
  /** Fecha local (YYYY-MM-DD) del próximo intento de Stripe, si lo informó. */
  proximoIntento: string | null;
}

export function correoPagoFallido(d: DatosPagoFallido): CorreoRenderizado {
  const monto =
    d.montoCents !== null && d.currency ? montoConMoneda(d.montoCents, d.currency) : null;
  const bloques: Bloque[] = [
    p(saludo(d.nombre)),
    monto
      ? p(
          "Intentamos cobrar ",
          { negrita: monto },
          ` de la suscripción de ${d.clinicName} y el pago no se pudo procesar.`,
        )
      : p(`Intentamos cobrar la suscripción de ${d.clinicName} y el pago no se pudo procesar.`),
    // BIL-01 (#69): nadie queda afuera de la app. Durante la gracia todo
    // sigue igual; después se pausan solo los informes. Ver
    // `accesoPorSuscripcion` en billing.ts.
    p(
      { negrita: "Qué pasa mientras tanto: " },
      `durante los próximos ${GRACIA_PAGO_FALLIDO_DIAS} días todo sigue funcionando igual para todo el equipo. Si para entonces el pago no se resolvió, se pausan los informes (finanzas, comisiones, inventario y panel).`,
    ),
    p(
      "La agenda, los pacientes y las fichas clínicas nunca se bloquean, y puedes exportar tus datos cuando quieras.",
    ),
    ...(d.proximoIntento
      ? [p(`Stripe volverá a intentar el cobro el ${fechaLarga(d.proximoIntento)}.`)]
      : []),
    p("Para resolverlo, entra a Suscripción y actualiza la tarjeta."),
    { tipo: "boton", texto: "Actualizar la tarjeta", href: unir(d.appUrl, "/suscripcion") },
    pTenue("Si crees que es un error, responde este correo y lo revisamos."),
  ];
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: "No pudimos cobrar tu suscripción a Esmalia",
    preencabezado: `Tienes ${GRACIA_PAGO_FALLIDO_DIAS} días para actualizar la tarjeta. La ficha clínica nunca se bloquea.`,
    titulo: "No pudimos procesar el pago",
    bloques,
    pie: {
      motivo: `Recibes este correo porque eres responsable de la cuenta de ${d.clinicName} en Esmalia.`,
    },
  });
}

// ─── e. Tu semana en la clínica ──────────────────────────────────────────

export interface EntradaSemana {
  appUrl: string;
  datos: DatosSemana;
  bajaUrl: string;
}

function detalleCobrado(d: DatosSemana): { texto: string; tono: "neutro" | "sube" | "baja" } {
  if (d.cobradoCents === null || d.cobradoPrevioCents === null)
    return { texto: "", tono: "neutro" };
  const v = variacion(d.cobradoCents, d.cobradoPrevioCents);
  const previo = formatMoney(d.cobradoPrevioCents, d.currency);
  switch (v.sentido) {
    case "igual":
      return { texto: "Lo mismo que la semana anterior.", tono: "neutro" };
    case "sin_base":
      return { texto: "La semana anterior no hubo cobros registrados.", tono: "neutro" };
    case "sube":
      return {
        texto: `↑ ${v.porcentaje}\u00a0% frente a la semana anterior (${previo})`,
        tono: "sube",
      };
    case "baja":
      return {
        texto: `↓ ${v.porcentaje}\u00a0% frente a la semana anterior (${previo})`,
        tono: "baja",
      };
  }
}

export function correoSemana(e: EntradaSemana): CorreoRenderizado {
  const d = e.datos;
  const app = e.appUrl;
  const cobrado = d.cobradoCents === null ? "Sin datos" : formatMoney(d.cobradoCents, d.currency);
  const det = detalleCobrado(d);
  const accion = elegirAccionSugerida(d);

  const filas = [
    {
      etiqueta: "Citas atendidas",
      valor: String(d.citasAtendidas),
      nota: d.citasAgendadas > 0 ? `de ${d.citasAgendadas} agendadas` : undefined,
    },
    {
      etiqueta: "Asistencia",
      valor: d.tasaAsistencia === null ? "Sin datos" : `${d.tasaAsistencia}\u00a0%`,
    },
    { etiqueta: "Ausencias", valor: String(d.ausencias) },
    { etiqueta: "Pacientes nuevos", valor: String(d.pacientesNuevos) },
    {
      etiqueta: "Presupuestos aceptados",
      valor: String(d.presupuestosAceptados),
      nota:
        d.conversion === null ? "conversión: sin datos" : `conversión del ${d.conversion}\u00a0%`,
    },
    {
      etiqueta: "Deudas de más de 90 días",
      valor: d.morosidad90Pacientes > 0 ? formatMoney(d.morosidad90Cents, d.currency) : "Ninguna",
      nota:
        d.morosidad90Pacientes > 0
          ? `${d.morosidad90Pacientes} ${plural(d.morosidad90Pacientes, "paciente", "pacientes")}`
          : undefined,
    },
  ];

  const bloques: Bloque[] = [
    {
      tipo: "cifra",
      etiqueta: "Cobrado en la semana",
      valor: cobrado,
      detalle: det.texto || undefined,
      tono: det.tono,
    },
  ];
  if (d.cobradoCents === null) {
    bloques.push({
      tipo: "recuadro",
      titulo: "Para ver tu caja aquí",
      partes: [
        "Todavía no registras pagos en Esmalia. Cuando cobres desde la ficha del paciente, este resumen te va a mostrar cuánto entró cada semana y cómo se compara con la anterior.",
      ],
      enlace: { texto: "Ver Finanzas", href: unir(app, "/finanzas") },
    });
  }
  bloques.push({ tipo: "tabla", filas });
  if (accion) {
    bloques.push({
      tipo: "recuadro",
      titulo: "Acción sugerida",
      partes: [{ negrita: accion.titulo }, ". ", accion.detalle],
      enlace: { texto: accion.enlace, href: unir(app, accion.ruta) },
    });
  }
  bloques.push({ tipo: "boton", texto: "Abrir Esmalia", href: unir(app, "/dashboard") });
  bloques.push(
    pTenue(
      "Las cifras salen de los mismos cálculos que Finanzas y Reportes, con la semana de lunes a domingo.",
    ),
  );

  const asunto =
    d.cobradoCents !== null
      ? `Tu semana en ${d.clinicName}: ${cobrado} cobrados`
      : `Tu semana en ${d.clinicName}: ${d.citasAtendidas} ${plural(d.citasAtendidas, "cita atendida", "citas atendidas")}`;

  return renderCorreo({
    appUrl: app,
    asunto,
    preencabezado: accion
      ? `${accion.titulo}.`
      : `${d.citasAtendidas} ${plural(d.citasAtendidas, "cita atendida", "citas atendidas")} y ${d.pacientesNuevos} ${plural(d.pacientesNuevos, "paciente nuevo", "pacientes nuevos")}.`,
    titulo: "Tu semana en la clínica",
    bajada: `${d.clinicName} · del ${fechaConDia(d.semana.desde)} al ${fechaConDia(d.semana.hasta)}`,
    bloques,
    pie: {
      motivo: `Recibes este resumen porque administras ${d.clinicName} en Esmalia y tu rol puede ver las finanzas.`,
      bajaUrl: e.bajaUrl,
      bajaTexto: "Dejar de recibir este resumen",
    },
  });
}
