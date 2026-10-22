/**
 * Registro de incidentes de seguridad y brechas de datos personales (SEG-06,
 * Ley 21.719 de Chile). Lógica pura: etiquetas, estado vigente de un
 * incidente (registro inicial + seguimientos), CSV y el texto de ayuda.
 *
 * La base guarda una bitácora que no se edita: el registro inicial
 * (`security_incidents`) y sus seguimientos (`security_incident_updates`),
 * cada uno con una nota y, si cambió algo, el valor nuevo. El estado que
 * se muestra es el inicial con los cambios de cada seguimiento aplicados en
 * orden (`estadoActualDeBrecha`, probado en `tests/brechas.test.ts`).
 *
 * ⚠️ BORRADOR LEGAL: la guía de pasos sale del runbook de incidentes de
 * Esmalia y de la lectura de la Ley 21.719 hecha para este desarrollo. No
 * afirma plazos en horas que la ley no fija y la revisa un abogado antes de
 * darla por buena.
 */
import { construirCsv } from "@/lib/csv-export";
import type { ContenidoFicha, LineaFicha, SeccionFicha } from "@/lib/exportacion/ficha-paciente";
import { fechaHora } from "@/lib/formato-fecha";

export const CATEGORIAS_DE_DATOS = [
  "identificacion",
  "contacto",
  "salud",
  "financieros",
  "credenciales",
  "documentos",
  "otros",
] as const;
export type CategoriaDeDatos = (typeof CATEGORIAS_DE_DATOS)[number];

export const ETIQUETA_CATEGORIA: Record<CategoriaDeDatos, string> = {
  identificacion: "Identificación (nombre, RUT)",
  contacto: "Contacto (teléfono, correo, dirección)",
  salud: "Salud (ficha clínica, diagnósticos, imágenes)",
  financieros: "Financieros (pagos, presupuestos)",
  credenciales: "Credenciales (contraseñas, claves, enlaces de acceso)",
  documentos: "Documentos emitidos o adjuntos",
  otros: "Otros",
};

/** Datos sensibles según la ley: los de salud. */
export const CATEGORIAS_SENSIBLES: ReadonlySet<CategoriaDeDatos> = new Set(["salud"]);

export const NIVELES_DE_RIESGO = ["por_evaluar", "bajo", "medio", "alto"] as const;
export type NivelDeRiesgo = (typeof NIVELES_DE_RIESGO)[number];
export const ETIQUETA_RIESGO: Record<NivelDeRiesgo, string> = {
  por_evaluar: "Por evaluar",
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
};

export const DECISIONES_NOTIFICAR = ["por_decidir", "si", "no"] as const;
export type DecisionNotificar = (typeof DECISIONES_NOTIFICAR)[number];
export const ETIQUETA_DECISION: Record<DecisionNotificar, string> = {
  por_decidir: "Por decidir",
  si: "Sí corresponde",
  no: "No corresponde",
};

export const ESTADOS_DE_BRECHA = ["abierto", "contenido", "cerrado"] as const;
export type EstadoDeBrecha = (typeof ESTADOS_DE_BRECHA)[number];
export const ETIQUETA_ESTADO_BRECHA: Record<EstadoDeBrecha, string> = {
  abierto: "Abierto",
  contenido: "Contenido",
  cerrado: "Cerrado",
};

export interface Incidente {
  id: string;
  detected_at: string;
  occurred_at: string | null;
  title: string;
  description: string;
  data_categories: string[];
  affected_subjects_estimate: number | null;
  risk_level: string;
  risk_assessment: string | null;
  measures: string | null;
  notify_agency: string;
  notify_subjects: string;
  notification_reason: string | null;
  responsible_name: string;
  status: string;
  created_by: string | null;
  created_at: string;
}

export interface Seguimiento {
  id: string;
  incident_id: string;
  note: string;
  status: string | null;
  risk_level: string | null;
  risk_assessment: string | null;
  measures: string | null;
  affected_subjects_estimate: number | null;
  data_categories: string[] | null;
  notify_agency: string | null;
  notify_subjects: string | null;
  notification_reason: string | null;
  agency_notified_at: string | null;
  subjects_notified_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface EstadoActualBrecha {
  status: EstadoDeBrecha;
  riskLevel: NivelDeRiesgo;
  riskAssessment: string | null;
  measures: string | null;
  affectedSubjectsEstimate: number | null;
  dataCategories: CategoriaDeDatos[];
  notifyAgency: DecisionNotificar;
  notifySubjects: DecisionNotificar;
  notificationReason: string | null;
  agencyNotifiedAt: string | null;
  subjectsNotifiedAt: string | null;
  /** Hay datos de salud entre los afectados. */
  sensible: boolean;
  /** Se decidió notificar y todavía falta hacerlo (a la Agencia o a los titulares). */
  notificacionPendiente: boolean;
  ultimaActualizacion: string;
}

function categorias(valores: readonly string[]): CategoriaDeDatos[] {
  return CATEGORIAS_DE_DATOS.filter((c) => valores.includes(c));
}

/**
 * Estado vigente: el registro inicial con los cambios de cada seguimiento,
 * en orden de creación. Un campo en NULL en un seguimiento = sin cambios.
 * Las fechas de notificación conservan la primera que se registró.
 */
export function estadoActualDeBrecha(
  incidente: Incidente,
  seguimientos: readonly Seguimiento[],
): EstadoActualBrecha {
  const propios = seguimientos
    .filter((s) => s.incident_id === incidente.id)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

  let status = incidente.status as EstadoDeBrecha;
  let riskLevel = incidente.risk_level as NivelDeRiesgo;
  let riskAssessment = incidente.risk_assessment;
  let measures = incidente.measures;
  let affected = incidente.affected_subjects_estimate;
  let cats = categorias(incidente.data_categories);
  let notifyAgency = incidente.notify_agency as DecisionNotificar;
  let notifySubjects = incidente.notify_subjects as DecisionNotificar;
  let reason = incidente.notification_reason;
  let agencyAt: string | null = null;
  let subjectsAt: string | null = null;
  let ultima = incidente.created_at;

  for (const s of propios) {
    if (s.status !== null) status = s.status as EstadoDeBrecha;
    if (s.risk_level !== null) riskLevel = s.risk_level as NivelDeRiesgo;
    if (s.risk_assessment !== null) riskAssessment = s.risk_assessment;
    if (s.measures !== null) measures = s.measures;
    if (s.affected_subjects_estimate !== null) affected = s.affected_subjects_estimate;
    if (s.data_categories !== null) cats = categorias(s.data_categories);
    if (s.notify_agency !== null) notifyAgency = s.notify_agency as DecisionNotificar;
    if (s.notify_subjects !== null) notifySubjects = s.notify_subjects as DecisionNotificar;
    if (s.notification_reason !== null) reason = s.notification_reason;
    if (s.agency_notified_at !== null && agencyAt === null) agencyAt = s.agency_notified_at;
    if (s.subjects_notified_at !== null && subjectsAt === null) subjectsAt = s.subjects_notified_at;
    ultima = s.created_at;
  }

  return {
    status,
    riskLevel,
    riskAssessment,
    measures,
    affectedSubjectsEstimate: affected,
    dataCategories: cats,
    notifyAgency,
    notifySubjects,
    notificationReason: reason,
    agencyNotifiedAt: agencyAt,
    subjectsNotifiedAt: subjectsAt,
    sensible: cats.some((c) => CATEGORIAS_SENSIBLES.has(c)),
    notificacionPendiente:
      (notifyAgency === "si" && agencyAt === null) ||
      (notifySubjects === "si" && subjectsAt === null),
    ultimaActualizacion: ultima,
  };
}

/** "Sin datos" cuando el estimado no se conoce (regla 11: no fabricar un cero). */
export function textoTitulares(n: number | null): string {
  if (n === null) return "Sin datos";
  return n === 1 ? "1 titular" : `${new Intl.NumberFormat("es-CL").format(n)} titulares`;
}

// ── Exportación ───────────────────────────────────────────────────────────

export interface FilaExportBrecha {
  incidente: Incidente;
  estado: EstadoActualBrecha;
  seguimientos: Seguimiento[];
  autores: Map<string, string>;
}

function etiquetasCategorias(cats: readonly CategoriaDeDatos[]): string {
  return cats.map((c) => ETIQUETA_CATEGORIA[c]).join("; ");
}

/**
 * CSV del registro: una fila por anotación (el registro inicial y cada
 * seguimiento), así queda la bitácora completa, no solo el estado final.
 */
export function brechasACsv(filas: readonly FilaExportBrecha[], zona: string): string {
  type Linea = {
    incidente: string;
    fecha: string;
    tipo: string;
    autor: string;
    estado: string;
    riesgo: string;
    titulares: string;
    categorias: string;
    agencia: string;
    titularesNotif: string;
    texto: string;
  };
  const lineas: Linea[] = [];
  for (const f of filas) {
    const i = f.incidente;
    lineas.push({
      incidente: i.title,
      fecha: fechaHora(i.created_at, zona),
      tipo: `Registro inicial (detectado ${fechaHora(i.detected_at, zona)}${i.occurred_at ? `, ocurrido ${fechaHora(i.occurred_at, zona)}` : ""})`,
      autor: (i.created_by && f.autores.get(i.created_by)) || i.responsible_name,
      estado: ETIQUETA_ESTADO_BRECHA[i.status as EstadoDeBrecha] ?? i.status,
      riesgo: ETIQUETA_RIESGO[i.risk_level as NivelDeRiesgo] ?? i.risk_level,
      titulares: textoTitulares(i.affected_subjects_estimate),
      categorias: etiquetasCategorias(categorias(i.data_categories)),
      agencia: ETIQUETA_DECISION[i.notify_agency as DecisionNotificar] ?? i.notify_agency,
      titularesNotif:
        ETIQUETA_DECISION[i.notify_subjects as DecisionNotificar] ?? i.notify_subjects,
      texto: [
        i.description,
        i.risk_assessment ? `Evaluación: ${i.risk_assessment}` : "",
        i.measures ? `Medidas: ${i.measures}` : "",
        i.notification_reason ? `Fundamento: ${i.notification_reason}` : "",
        `Responsable: ${i.responsible_name}`,
      ]
        .filter(Boolean)
        .join(" | "),
    });
    for (const s of f.seguimientos) {
      lineas.push({
        incidente: i.title,
        fecha: fechaHora(s.created_at, zona),
        tipo: "Seguimiento",
        autor: (s.created_by && f.autores.get(s.created_by)) || "",
        estado: s.status ? (ETIQUETA_ESTADO_BRECHA[s.status as EstadoDeBrecha] ?? s.status) : "",
        riesgo: s.risk_level
          ? (ETIQUETA_RIESGO[s.risk_level as NivelDeRiesgo] ?? s.risk_level)
          : "",
        titulares:
          s.affected_subjects_estimate !== null ? textoTitulares(s.affected_subjects_estimate) : "",
        categorias: s.data_categories ? etiquetasCategorias(categorias(s.data_categories)) : "",
        agencia: [
          s.notify_agency ? ETIQUETA_DECISION[s.notify_agency as DecisionNotificar] : "",
          s.agency_notified_at ? `Notificada el ${fechaHora(s.agency_notified_at, zona)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        titularesNotif: [
          s.notify_subjects ? ETIQUETA_DECISION[s.notify_subjects as DecisionNotificar] : "",
          s.subjects_notified_at ? `Notificados el ${fechaHora(s.subjects_notified_at, zona)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        texto: [
          s.note,
          s.risk_assessment ? `Evaluación: ${s.risk_assessment}` : "",
          s.measures ? `Medidas: ${s.measures}` : "",
          s.notification_reason ? `Fundamento: ${s.notification_reason}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      });
    }
  }
  return construirCsv(lineas, [
    { header: "Incidente", value: (l) => l.incidente },
    { header: "Fecha de la anotación", value: (l) => l.fecha },
    { header: "Tipo", value: (l) => l.tipo },
    { header: "Anotó", value: (l) => l.autor },
    { header: "Estado", value: (l) => l.estado },
    { header: "Riesgo", value: (l) => l.riesgo },
    { header: "Titulares afectados (estimado)", value: (l) => l.titulares },
    { header: "Categorías de datos", value: (l) => l.categorias },
    { header: "Notificación a la Agencia", value: (l) => l.agencia },
    { header: "Notificación a los titulares", value: (l) => l.titularesNotif },
    { header: "Detalle", value: (l) => l.texto },
  ]);
}

// ── Ayuda (borrador) ──────────────────────────────────────────────────────

/**
 * Pasos ante una brecha, para la clínica. Adaptados del runbook de
 * incidentes de Esmalia (parte B). Sin plazos en horas: la Ley 21.719 pide
 * reportar "por los medios más expeditos posibles y sin dilaciones
 * indebidas"; cualquier plazo concreto lo confirma el abogado.
 */
export const PASOS_ANTE_UNA_BRECHA: ReadonlyArray<{ titulo: string; detalle: string }> = [
  {
    titulo: "Registra el incidente en cuanto lo sepas",
    detalle:
      "Anota la fecha y hora en que la clínica tomó conocimiento. No borres nada: los registros son evidencia.",
  },
  {
    titulo: "Contén",
    detalle:
      "Corta el acceso indebido: cambia contraseñas, cierra sesiones, revoca enlaces del portal y desactiva a quien no corresponda. Si el origen está en Esmalia, escríbenos a soporte@esmalia.com.",
  },
  {
    titulo: "Evalúa",
    detalle:
      "Qué datos, de cuántos pacientes, desde cuándo y si hay datos de salud (son datos sensibles). Si se puede descartar que alguien accedió de verdad, anota por qué.",
  },
  {
    titulo: "Decide si notificar, y fundaméntalo",
    detalle:
      "La ley obliga a reportar a la Agencia de Protección de Datos Personales las vulneraciones que generen riesgo, por los medios más expeditos posibles y sin dilaciones indebidas, y a informar a los titulares cuando hay datos sensibles. Consulta con tu abogado y deja escrito el fundamento, también si decides no notificar.",
  },
  {
    titulo: "Agrega seguimientos hasta cerrar",
    detalle:
      "Cada medida nueva, cambio en la evaluación o notificación hecha va como seguimiento con su fecha. Lo ya escrito no se edita.",
  },
];

/** "YYYY-MM-DDTHH:mm" de un instante en el huso de la clínica (para `<input datetime-local>`). */
export function instanteLocal(instante: Date, zona: string): string {
  const opciones: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", { ...opciones, timeZone: zona });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", { ...opciones, timeZone: "America/Santiago" });
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(instante)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Contenido del PDF del registro (lo dibuja `generarPdfFicha`, el mismo
 * dibujo que la ficha del paciente): una sección por incidente con su
 * estado vigente y la bitácora completa.
 */
export function contenidoPdfBrechas(
  filas: readonly FilaExportBrecha[],
  opciones: { clinicaNombre: string; zona: string; generadoEn: Date },
): ContenidoFicha {
  const z = opciones.zona;
  const autorDe = (autores: Map<string, string>, id: string | null) =>
    id ? (autores.get(id) ?? null) : null;

  const secciones: SeccionFicha[] = filas.map(
    ({ incidente: i, estado: e, seguimientos, autores }) => {
      const lineas: LineaFicha[] = [
        {
          texto: `Detectado el ${fechaHora(i.detected_at, z)}${i.occurred_at ? ` · ocurrió el ${fechaHora(i.occurred_at, z)}` : ""} · responsable: ${i.responsible_name}`,
          estilo: "gris",
        },
        {
          texto: `Estado: ${ETIQUETA_ESTADO_BRECHA[e.status]} · riesgo: ${ETIQUETA_RIESGO[e.riskLevel]} · titulares afectados (estimado): ${textoTitulares(e.affectedSubjectsEstimate)}`,
          estilo: "negrita",
        },
        {
          texto: `Datos afectados: ${e.dataCategories.map((c) => ETIQUETA_CATEGORIA[c]).join("; ") || "sin indicar"}${e.sensible ? " (incluye datos sensibles de salud)" : ""}`,
          estilo: e.sensible ? "alerta" : "normal",
        },
        {
          texto: `Notificar a la Agencia: ${ETIQUETA_DECISION[e.notifyAgency]}${e.agencyNotifiedAt ? ` · notificada el ${fechaHora(e.agencyNotifiedAt, z)}` : ""}`,
        },
        {
          texto: `Notificar a los titulares: ${ETIQUETA_DECISION[e.notifySubjects]}${e.subjectsNotifiedAt ? ` · notificados el ${fechaHora(e.subjectsNotifiedAt, z)}` : ""}`,
        },
      ];
      if (e.notificationReason) lineas.push({ texto: `Fundamento: ${e.notificationReason}` });
      lineas.push({ texto: "Descripción", estilo: "negrita" });
      lineas.push({ texto: i.description, sangria: true });
      if (i.risk_assessment) {
        lineas.push({ texto: `Evaluación inicial: ${i.risk_assessment}`, sangria: true });
      }
      if (i.measures) lineas.push({ texto: `Medidas iniciales: ${i.measures}`, sangria: true });
      const autorInicial = autorDe(autores, i.created_by);
      lineas.push({
        texto: `Registrado el ${fechaHora(i.created_at, z)}${autorInicial ? ` por ${autorInicial}` : ""}`,
        estilo: "gris",
      });

      if (seguimientos.length) lineas.push({ texto: "Seguimientos", estilo: "negrita" });
      for (const s of seguimientos) {
        const cambios = [
          s.status
            ? `estado: ${ETIQUETA_ESTADO_BRECHA[s.status as EstadoDeBrecha] ?? s.status}`
            : "",
          s.risk_level
            ? `riesgo: ${ETIQUETA_RIESGO[s.risk_level as NivelDeRiesgo] ?? s.risk_level}`
            : "",
          s.affected_subjects_estimate !== null
            ? `titulares: ${textoTitulares(s.affected_subjects_estimate)}`
            : "",
          s.agency_notified_at ? `Agencia notificada el ${fechaHora(s.agency_notified_at, z)}` : "",
          s.subjects_notified_at
            ? `titulares notificados el ${fechaHora(s.subjects_notified_at, z)}`
            : "",
        ].filter(Boolean);
        const autor = autorDe(autores, s.created_by);
        lineas.push({
          texto: `${fechaHora(s.created_at, z)}${autor ? ` · ${autor}` : ""}${cambios.length ? ` · ${cambios.join(" · ")}` : ""}`,
          estilo: "gris",
          sangria: true,
        });
        lineas.push({ texto: s.note, sangria: true });
        if (s.measures) lineas.push({ texto: `Medidas: ${s.measures}`, sangria: true });
        if (s.risk_assessment) {
          lineas.push({ texto: `Evaluación: ${s.risk_assessment}`, sangria: true });
        }
        if (s.notification_reason) {
          lineas.push({ texto: `Fundamento: ${s.notification_reason}`, sangria: true });
        }
      }
      return { titulo: i.title, lineas };
    },
  );

  if (!secciones.length) {
    secciones.push({
      titulo: "Sin incidentes",
      lineas: [{ texto: "No hay incidentes registrados.", estilo: "gris" }],
    });
  }

  return {
    pacienteId: "",
    pacienteNombre: "Registro de incidentes de seguridad y brechas de datos",
    clinicaNombre: opciones.clinicaNombre,
    subtitulo: "Ley 21.719 · documento confidencial",
    encabezado: [
      `Generado el ${fechaHora(opciones.generadoEn, z)} · ${filas.length} incidente${filas.length === 1 ? "" : "s"}`,
      "Bitácora: lo registrado no se edita; los cambios van como seguimientos con su fecha.",
    ],
    secciones,
    pie: `${opciones.clinicaNombre} · registro de incidentes · confidencial`,
  };
}
