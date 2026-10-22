/**
 * Derechos del titular de los datos (SEG-09, Ley 21.719 de Chile). Lógica
 * pura, compartida por el portal del paciente, la bandeja de la clínica y
 * los tests (`tests/derechos-titular.test.ts`).
 *
 * ⚠️ BORRADOR LEGAL: los textos que ve el paciente, el plazo de 30 días
 * corridos y la prórroga única por otros 30 salen de la lectura de la ley
 * hecha para este desarrollo y no los revisó todavía un abogado. Todo texto
 * con alcance legal lleva `BORRADOR_LEGAL` en la pantalla de la clínica.
 *
 * El plazo lo fija la BASE al insertar (`due_date`, trigger de
 * `data_subject_requests`); acá se replica el cálculo para mostrarlo antes
 * de enviar y para probarlo. Las dos cuentas tienen que dar lo mismo (lo
 * verifica `tests/derechos-titular-db.test.ts`).
 */

export const TIPOS_DE_SOLICITUD = [
  "acceso",
  "rectificacion",
  "supresion",
  "oposicion",
  "portabilidad",
  "bloqueo",
] as const;
export type TipoSolicitud = (typeof TIPOS_DE_SOLICITUD)[number];

export const ESTADOS_DE_SOLICITUD = ["recibida", "en_revision", "respondida", "rechazada"] as const;
export type EstadoSolicitud = (typeof ESTADOS_DE_SOLICITUD)[number];

export const CANALES_DE_SOLICITUD = ["portal", "portal_automatico", "clinica"] as const;
export type CanalSolicitud = (typeof CANALES_DE_SOLICITUD)[number];

export const EVENTOS_DE_SOLICITUD = [
  "recibida",
  "en_revision",
  "prorrogada",
  "respondida",
  "rechazada",
  "correo_enviado",
] as const;
export type EventoSolicitud = (typeof EVENTOS_DE_SOLICITUD)[number];

/** Aviso que acompaña todo texto con alcance legal en la pantalla de la clínica. */
export const BORRADOR_LEGAL =
  "Borrador para revisión del abogado: los plazos y textos legales todavía no están validados.";

/** Por qué un botón está apagado en la clínica demo (de solo lectura). */
export const MENSAJE_DEMO_SOLO_LECTURA =
  "La clínica demo es de solo lectura: crea tu clínica para usar esta función.";

/** Días corridos para responder, desde la recepción (Ley 21.719; borrador). */
export const PLAZO_DIAS = 30;
/** Prórroga única, por igual período (borrador). */
export const PRORROGA_DIAS = 30;
/** Desde cuántos días antes del vencimiento se avisa "por vencer". */
export const DIAS_AVISO_POR_VENCER = 5;

/** Tope antiabuso del portal: igual que los pedidos de hora (3 por paciente cada 24 h). */
export const MAX_SOLICITUDES_PORTAL_24H = 3;
/** Descargas de los propios datos por paciente cada 24 h. */
export const MAX_DESCARGAS_PORTAL_24H = 5;
/** Cambios de preferencias de comunicación por paciente cada 24 h. */
export const MAX_CAMBIOS_COMUNICACION_24H = 6;

export const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
  acceso: "Acceso",
  rectificacion: "Rectificación",
  supresion: "Supresión",
  oposicion: "Oposición",
  portabilidad: "Portabilidad",
  bloqueo: "Bloqueo",
};

export const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  recibida: "Recibida",
  en_revision: "En revisión",
  respondida: "Respondida",
  rechazada: "Rechazada fundadamente",
};

export const ETIQUETA_CANAL: Record<CanalSolicitud, string> = {
  portal: "Portal del paciente",
  portal_automatico: "Portal (resuelta en el acto)",
  clinica: "Registrada por la clínica",
};

export const ETIQUETA_EVENTO: Record<EventoSolicitud, string> = {
  recibida: "Recibida",
  en_revision: "Pasó a revisión",
  prorrogada: "Plazo prorrogado",
  respondida: "Respondida",
  rechazada: "Rechazada fundadamente",
  correo_enviado: "Respuesta enviada por correo",
};

/**
 * Lo que el paciente puede pedir desde el portal como solicitud (las que
 * se resuelven solas, la descarga y la baja de comunicaciones, no pasan por
 * acá). "acceso" queda para pedir una copia íntegra de la ficha clínica,
 * que la clínica entrega aparte.
 */
export const TIPOS_PEDIBLES_EN_PORTAL = [
  "rectificacion",
  "supresion",
  "bloqueo",
  "oposicion",
  "acceso",
] as const satisfies readonly TipoSolicitud[];
export type TipoPedibleEnPortal = (typeof TIPOS_PEDIBLES_EN_PORTAL)[number];

/** Texto que ve el paciente para cada pedido (tuteo neutro). */
export const DERECHO_EN_PORTAL: Record<
  TipoPedibleEnPortal,
  { titulo: string; explicacion: string; placeholder: string }
> = {
  rectificacion: {
    titulo: "Corregir un dato",
    explicacion:
      "Si algún dato tuyo está mal o desactualizado, cuéntanos cuál y cómo debería quedar. La clínica lo revisa y te responde; tu ficha no cambia sola.",
    placeholder: "Por ejemplo: mi correo correcto es nombre@ejemplo.com",
  },
  supresion: {
    titulo: "Pedir que se eliminen datos",
    explicacion:
      "Puedes pedir que se eliminen tus datos que no son clínicos (por ejemplo, de contacto para promociones). Tu ficha clínica no se puede eliminar: la ley obliga a la clínica a conservarla por 15 años (Decreto 41). Si es tu caso, la clínica te responde explicándolo.",
    placeholder: "Cuéntanos qué datos quieres que se eliminen y por qué",
  },
  bloqueo: {
    titulo: "Pedir que se bloqueen datos",
    explicacion:
      "Puedes pedir que la clínica deje de usar temporalmente algún dato tuyo mientras se revisa, por ejemplo, una corrección que pediste.",
    placeholder: "Cuéntanos qué datos y por qué",
  },
  oposicion: {
    titulo: "Oponerte a un uso de tus datos",
    explicacion:
      "Si no quieres que la clínica use tus datos para algo en particular (más allá de dejar de recibir mensajes, que puedes hacer arriba), cuéntanos para qué.",
    placeholder: "Por ejemplo: no quiero que usen mi foto en redes sociales",
  },
  acceso: {
    titulo: "Pedir una copia completa de tu ficha clínica",
    explicacion:
      "La descarga de arriba trae un resumen. Si necesitas la copia íntegra de tu ficha clínica (notas, odontograma, imágenes), pídela y la clínica te la entrega.",
    placeholder: "Opcional: para qué la necesitas o en qué formato la prefieres",
  },
};

// ── Fechas civiles ────────────────────────────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000;

/** Fecha civil (YYYY-MM-DD) de un instante en el huso indicado. */
export function fechaCivilEn(instante: Date, zona: string): string {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(instante)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** Suma días a una fecha civil (sin husos de por medio). */
export function sumarDias(fechaCivil: string, dias: number): string {
  const [a, m, d] = fechaCivil.split("-").map(Number);
  const t = Date.UTC(a, m - 1, d) + dias * DIA_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Días entre dos fechas civiles (b − a). */
export function diasEntre(a: string, b: string): number {
  const [a1, m1, d1] = a.split("-").map(Number);
  const [a2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / DIA_MS);
}

// ── Plazo ─────────────────────────────────────────────────────────────────

/**
 * Último día para responder: la fecha de recepción en el huso de la
 * clínica más 30 días corridos. Mismo cálculo que el trigger.
 */
export function venceEl(recibidaEn: Date | string, zona: string): string {
  const instante = typeof recibidaEn === "string" ? new Date(recibidaEn) : recibidaEn;
  return sumarDias(fechaCivilEn(instante, zona), PLAZO_DIAS);
}

/** El vencimiento que rige: el prorrogado si lo hay. */
export function vencimientoVigente(s: {
  due_date: string;
  extended_due_date: string | null;
}): string {
  return s.extended_due_date ?? s.due_date;
}

export type Semaforo = "cerrada" | "en_plazo" | "por_vencer" | "vence_hoy" | "vencida";

export const ETIQUETA_SEMAFORO: Record<Semaforo, string> = {
  cerrada: "Cerrada",
  en_plazo: "En plazo",
  por_vencer: "Por vencer",
  vence_hoy: "Vence hoy",
  vencida: "Vencida",
};

export function estaCerrada(estado: EstadoSolicitud): boolean {
  return estado === "respondida" || estado === "rechazada";
}

/**
 * Estado del plazo de una solicitud a la fecha `hoy` (civil, en el huso de
 * la clínica): días que quedan y el color del semáforo.
 */
export function semaforoDePlazo(
  s: { status: EstadoSolicitud; due_date: string; extended_due_date: string | null },
  hoy: string,
): { semaforo: Semaforo; diasRestantes: number | null } {
  if (estaCerrada(s.status)) return { semaforo: "cerrada", diasRestantes: null };
  const dias = diasEntre(hoy, vencimientoVigente(s));
  if (dias < 0) return { semaforo: "vencida", diasRestantes: dias };
  if (dias === 0) return { semaforo: "vence_hoy", diasRestantes: 0 };
  if (dias <= DIAS_AVISO_POR_VENCER) return { semaforo: "por_vencer", diasRestantes: dias };
  return { semaforo: "en_plazo", diasRestantes: dias };
}

/** "Quedan 12 días" / "Vence hoy" / "Venció hace 3 días". */
export function textoDiasRestantes(dias: number | null): string {
  if (dias === null) return "";
  if (dias === 0) return "Vence hoy";
  if (dias === 1) return "Queda 1 día";
  if (dias > 1) return `Quedan ${dias} días`;
  return dias === -1 ? "Venció ayer" : `Venció hace ${-dias} días`;
}

/** ¿Se puede prorrogar? Una sola vez, abierta y antes de que venza. */
export function puedeProrrogar(
  s: { status: EstadoSolicitud; due_date: string; extended_due_date: string | null },
  hoy: string,
): boolean {
  return !estaCerrada(s.status) && s.extended_due_date === null && hoy <= s.due_date;
}

/** Acciones que admite una solicitud según su estado (la base vuelve a validarlas). */
export function accionesPermitidas(
  estado: EstadoSolicitud,
): Array<"en_revision" | "responder" | "rechazar"> {
  if (estado === "recibida") return ["en_revision", "responder", "rechazar"];
  if (estado === "en_revision") return ["responder", "rechazar"];
  return [];
}

/** Orden de la bandeja: abiertas por vencimiento, después cerradas por fecha. */
export function ordenarBandeja<
  T extends {
    status: EstadoSolicitud;
    due_date: string;
    extended_due_date: string | null;
    received_at: string;
  },
>(solicitudes: readonly T[]): T[] {
  return [...solicitudes].sort((a, b) => {
    const ca = estaCerrada(a.status);
    const cb = estaCerrada(b.status);
    if (ca !== cb) return ca ? 1 : -1;
    if (!ca) {
      const va = vencimientoVigente(a);
      const vb = vencimientoVigente(b);
      if (va !== vb) return va < vb ? -1 : 1;
    }
    return a.received_at < b.received_at ? 1 : -1;
  });
}

// ── Antiabuso ─────────────────────────────────────────────────────────────

/** ¿Ya se alcanzó el tope diario? `recientes` = filas de las últimas 24 h. */
export function superaTopeDiario(recientes: number | null | undefined, tope: number): boolean {
  return (recientes ?? 0) >= tope;
}

// ── Respuesta por correo ──────────────────────────────────────────────────

/**
 * Textos de partida para la respuesta (BORRADOR para el abogado). La
 * clínica los edita antes de enviar; no se mandan solos.
 */
export const RESPUESTA_SUGERIDA: Partial<
  Record<TipoSolicitud, { rechazo?: string; respuesta?: string }>
> = {
  supresion: {
    rechazo:
      "Recibimos tu solicitud de eliminar tus datos. Tu ficha clínica (atenciones, diagnósticos, tratamientos e imágenes) no se puede eliminar: el Decreto 41 del Ministerio de Salud obliga a la clínica a conservarla por al menos 15 años. Mientras tanto, solo la usamos para tu atención y no la compartimos con nadie sin tu autorización. Los datos que no son clínicos y no necesitamos conservar (por ejemplo, para promociones) ya fueron eliminados.",
  },
  rectificacion: {
    respuesta:
      "Recibimos tu solicitud y corregimos el dato en tu ficha. Si encuentras otro dato incorrecto, avísanos.",
  },
  oposicion: {
    respuesta:
      "Recibimos tu solicitud. Desde hoy dejamos de usar tus datos para lo que indicaste. Seguimos usándolos solo para tu atención.",
  },
  bloqueo: {
    respuesta:
      "Recibimos tu solicitud. Dejamos bloqueados los datos que indicaste mientras revisamos tu caso; no se usarán hasta que te respondamos.",
  },
  acceso: {
    respuesta:
      "Recibimos tu solicitud. Te enviamos una copia de tu ficha clínica completa por el medio que acordamos.",
  },
};

/** Texto por defecto del correo con la respuesta (el cuerpo es la respuesta escrita). */
export function asuntoRespuesta(tipo: TipoSolicitud, clinica: string): string {
  return `Respuesta a tu solicitud de ${ETIQUETA_TIPO[tipo].toLowerCase()} de datos · ${clinica}`;
}

export function mensajeRespuesta(d: {
  paciente: string | null;
  clinica: string;
  tipo: TipoSolicitud;
  recibidaEl: string;
  estado: "respondida" | "rechazada";
  respuesta: string;
}): string {
  const saludo = (d.paciente ?? "").trim().split(/\s+/)[0];
  return [
    saludo ? `Hola, ${saludo}:` : "Hola:",
    `Te respondemos la solicitud de ${ETIQUETA_TIPO[d.tipo].toLowerCase()} de tus datos personales que recibimos el ${d.recibidaEl}.`,
    d.respuesta.trim(),
    "Si tienes dudas sobre esta respuesta, puedes escribir a la clínica por el canal de siempre.",
    `Saludos,\n${d.clinica}`,
  ].join("\n\n");
}
