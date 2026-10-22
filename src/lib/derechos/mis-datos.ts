/**
 * "Mis datos" del portal del paciente (SEG-09: derechos de acceso y
 * portabilidad). Parte pura: recibe las filas que el servidor ya leyó para
 * ESE paciente y arma el contenido en tres formatos:
 *
 * - JSON: estructurado y legible por máquina (portabilidad). Montos en la
 *   unidad mínima de la moneda (`*_cents`) más la moneda, fechas en ISO.
 * - CSV: una fila por dato, en formato largo (sección, fecha, descripción,
 *   detalle, monto), para abrirlo en una planilla.
 * - PDF: legible, con el mismo dibujo que la ficha exportada por la clínica
 *   (`generarPdfFicha`, a partir de `contenidoPdfMisDatos`).
 *
 * Cinturón: además de que cada consulta del servidor filtra por clínica y
 * paciente, `armarMisDatos` descarta cualquier fila que no sea de las fichas
 * del paciente (la suya y las fusionadas en ella). Un error en una consulta
 * nunca puede meter datos de otra persona en la descarga
 * (`tests/derechos-titular.test.ts`).
 *
 * Qué NO trae: el texto de las notas clínicas, el odontograma, imágenes ni
 * documentos adjuntos (eso es la copia íntegra de la ficha, que se pide a la
 * clínica), ni el número de documento de identidad (se guarda cifrado; se
 * indica que está registrado).
 */
import type { ContenidoFicha, LineaFicha, SeccionFicha } from "@/lib/exportacion/ficha-paciente";
import {
  PAYMENT_METHOD_LABELS,
  QUOTE_STATUS_LABELS,
  TREATMENT_PLAN_STATUS_LABELS,
  formatMoney,
  type PaymentMethod,
  type QuoteStatus,
  type TreatmentPlanStatus,
} from "@/lib/finance/finance";
import { construirCsv } from "@/lib/csv-export";
import { fecha, fechaHora } from "@/lib/formato-fecha";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_TIPO,
  type EstadoSolicitud,
  type TipoSolicitud,
} from "@/lib/derechos/derechos";

// ── Filas de entrada (lo que lee el servidor) ─────────────────────────────

export interface FilaPaciente {
  id: string;
  full_name: string;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  commune: string | null;
  health_plan: string | null;
  health_plan_institution: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  /** Solo si hay documento registrado; nunca el valor. */
  tiene_documento: boolean;
  wa_opt_out_at: string | null;
  email_opt_out_at: string | null;
  created_at: string;
}

export interface FilasDelTitular {
  paciente: FilaPaciente;
  anamnesis: Array<{
    patient_id: string;
    allergies: string[] | null;
    conditions: string[] | null;
    chronic_medications: string[] | null;
  }>;
  notas: Array<{
    patient_ref: string;
    title: string;
    signed_at: string | null;
    created_at: string;
    signer_name: string | null;
    status: string;
  }>;
  citas: Array<{
    patient_id: string;
    starts_at: string;
    treatment_label: string | null;
    status: string;
  }>;
  presupuestos: Array<{
    patient_id: string;
    number: string;
    created_at: string;
    status: string;
    total_cents: number;
    currency: string;
  }>;
  planes: Array<{
    patient_id: string;
    name: string;
    created_at: string;
    status: string;
    total_cents: number;
    currency: string;
  }>;
  pagos: Array<{
    patient_id: string;
    paid_at: string;
    amount_cents: number;
    currency: string;
    method: string;
    method_name_snapshot: string | null;
    reversed_at: string | null;
  }>;
  documentos: Array<{
    patient_id: string;
    title: string;
    year: number;
    number: number;
    issued_at: string;
    professional_name_snapshot: string;
    voided_at: string | null;
  }>;
  consentimientos: Array<{
    patient_id: string;
    title_snapshot: string;
    signed_at: string;
    signed_by_name: string;
    revoked_at: string | null;
  }>;
  solicitudes: Array<{
    patient_id: string;
    kind: string;
    status: string;
    received_at: string;
    responded_at: string | null;
  }>;
}

// ── Salida ────────────────────────────────────────────────────────────────

export interface MisDatos {
  formato: "esmalia.mis-datos";
  version: 1;
  generado_en: string;
  clinica: { nombre: string; zona_horaria: string };
  paciente: {
    nombre: string;
    fecha_nacimiento: string | null;
    correo: string | null;
    telefono: string | null;
    direccion: string | null;
    comuna: string | null;
    prevision: string | null;
    contacto_emergencia: {
      nombre: string;
      telefono: string | null;
      relacion: string | null;
    } | null;
    documento_de_identidad: "registrado" | "no_registrado";
    paciente_desde: string;
  };
  comunicaciones: {
    whatsapp: { recibe: boolean; baja_el: string | null };
    correo: { recibe: boolean; baja_el: string | null };
  };
  salud: { alergias: string[]; condiciones: string[]; medicamentos_cronicos: string[] };
  atenciones: Array<{ fecha: string; titulo: string; profesional: string | null }>;
  citas: Array<{ inicio: string; tratamiento: string | null; estado: string }>;
  presupuestos: Array<{
    numero: string;
    fecha: string;
    estado: string;
    total_cents: number;
    moneda: string;
  }>;
  planes_de_tratamiento: Array<{
    nombre: string;
    fecha: string;
    estado: string;
    total_cents: number;
    moneda: string;
  }>;
  pagos: Array<{
    fecha: string;
    monto_cents: number;
    moneda: string;
    medio: string;
    anulado: boolean;
  }>;
  documentos_emitidos: Array<{
    titulo: string;
    folio: string;
    fecha: string;
    profesional: string;
    anulado: boolean;
  }>;
  consentimientos: Array<{
    titulo: string;
    firmado_el: string;
    firmado_por: string;
    revocado: boolean;
  }>;
  solicitudes_de_derechos: Array<{
    tipo: string;
    recibida_el: string;
    estado: string;
    respondida_el: string | null;
  }>;
}

const ESTADO_CITA: Record<string, string> = {
  tentativa: "Por confirmar",
  confirmada: "Confirmada",
  "en-sala": "En atención",
  ausente: "No asistió",
  finalizada: "Atendida",
  cancelada: "Cancelada",
};

function de<T>(filas: readonly T[], ids: ReadonlySet<string>, campo: (f: T) => string): T[] {
  return filas.filter((f) => ids.has(campo(f)));
}

function unicos(listas: Array<string[] | null | undefined>): string[] {
  const out = new Set<string>();
  for (const l of listas) for (const v of l ?? []) if (v?.trim()) out.add(v.trim());
  return [...out];
}

/**
 * Arma los datos del paciente. `idsDeLaFicha` = su id más los de las fichas
 * fusionadas en la suya; cualquier fila de otro paciente se descarta.
 */
export function armarMisDatos(
  filas: FilasDelTitular,
  idsDeLaFicha: readonly string[],
  opciones: { clinicaNombre: string; zonaHoraria: string; generadoEn: Date },
): MisDatos {
  const ids = new Set(idsDeLaFicha);
  const p = filas.paciente;
  if (!ids.has(p.id)) throw new Error("La ficha no corresponde al paciente del portal.");

  const anamnesis = de(filas.anamnesis, ids, (f) => f.patient_id);
  const notas = de(filas.notas, ids, (f) => f.patient_ref).filter((n) => n.status === "signed");
  const porFecha = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

  const prevision = [p.health_plan, p.health_plan_institution].filter(Boolean).join(" · ") || null;

  return {
    formato: "esmalia.mis-datos",
    version: 1,
    generado_en: opciones.generadoEn.toISOString(),
    clinica: { nombre: opciones.clinicaNombre, zona_horaria: opciones.zonaHoraria },
    paciente: {
      nombre: p.full_name,
      fecha_nacimiento: p.birth_date,
      correo: p.email,
      telefono: p.phone,
      direccion: p.address,
      comuna: p.commune,
      prevision,
      contacto_emergencia: p.emergency_contact_name
        ? {
            nombre: p.emergency_contact_name,
            telefono: p.emergency_contact_phone,
            relacion: p.emergency_contact_relationship,
          }
        : null,
      documento_de_identidad: p.tiene_documento ? "registrado" : "no_registrado",
      paciente_desde: p.created_at,
    },
    comunicaciones: {
      whatsapp: { recibe: !p.wa_opt_out_at, baja_el: p.wa_opt_out_at },
      correo: { recibe: !p.email_opt_out_at, baja_el: p.email_opt_out_at },
    },
    salud: {
      alergias: unicos(anamnesis.map((a) => a.allergies)),
      condiciones: unicos(anamnesis.map((a) => a.conditions)),
      medicamentos_cronicos: unicos(anamnesis.map((a) => a.chronic_medications)),
    },
    atenciones: notas
      .map((n) => ({
        fecha: n.signed_at ?? n.created_at,
        titulo: n.title,
        profesional: n.signer_name,
      }))
      .sort((a, b) => porFecha(a.fecha, b.fecha)),
    citas: de(filas.citas, ids, (f) => f.patient_id)
      .map((c) => ({
        inicio: c.starts_at,
        tratamiento: c.treatment_label,
        estado: ESTADO_CITA[c.status] ?? c.status,
      }))
      .sort((a, b) => porFecha(a.inicio, b.inicio)),
    presupuestos: de(filas.presupuestos, ids, (f) => f.patient_id)
      .map((q) => ({
        numero: q.number,
        fecha: q.created_at,
        estado: QUOTE_STATUS_LABELS[q.status as QuoteStatus] ?? q.status,
        total_cents: q.total_cents,
        moneda: q.currency,
      }))
      .sort((a, b) => porFecha(a.fecha, b.fecha)),
    planes_de_tratamiento: de(filas.planes, ids, (f) => f.patient_id)
      .map((t) => ({
        nombre: t.name,
        fecha: t.created_at,
        estado: TREATMENT_PLAN_STATUS_LABELS[t.status as TreatmentPlanStatus] ?? t.status,
        total_cents: t.total_cents,
        moneda: t.currency,
      }))
      .sort((a, b) => porFecha(a.fecha, b.fecha)),
    pagos: de(filas.pagos, ids, (f) => f.patient_id)
      .map((x) => ({
        fecha: x.paid_at,
        monto_cents: x.amount_cents,
        moneda: x.currency,
        medio:
          x.method_name_snapshot ?? PAYMENT_METHOD_LABELS[x.method as PaymentMethod] ?? x.method,
        anulado: Boolean(x.reversed_at),
      }))
      .sort((a, b) => porFecha(a.fecha, b.fecha)),
    documentos_emitidos: de(filas.documentos, ids, (f) => f.patient_id)
      .map((d) => ({
        titulo: d.title,
        folio: `${d.year}-${String(d.number).padStart(4, "0")}`,
        fecha: d.issued_at,
        profesional: d.professional_name_snapshot,
        anulado: Boolean(d.voided_at),
      }))
      .sort((a, b) => porFecha(a.fecha, b.fecha)),
    consentimientos: de(filas.consentimientos, ids, (f) => f.patient_id)
      .map((c) => ({
        titulo: c.title_snapshot,
        firmado_el: c.signed_at,
        firmado_por: c.signed_by_name,
        revocado: Boolean(c.revoked_at),
      }))
      .sort((a, b) => porFecha(a.firmado_el, b.firmado_el)),
    solicitudes_de_derechos: de(filas.solicitudes, ids, (f) => f.patient_id)
      .map((s) => ({
        tipo: ETIQUETA_TIPO[s.kind as TipoSolicitud] ?? s.kind,
        recibida_el: s.received_at,
        estado: ETIQUETA_ESTADO[s.status as EstadoSolicitud] ?? s.status,
        respondida_el: s.responded_at,
      }))
      .sort((a, b) => porFecha(a.recibida_el, b.recibida_el)),
  };
}

// ── Formatos ──────────────────────────────────────────────────────────────

export type FormatoMisDatos = "pdf" | "json" | "csv";

export function nombreArchivoMisDatos(formato: FormatoMisDatos, hoy: string): string {
  return `mis-datos-${hoy}.${formato}`;
}

export function misDatosAJson(datos: MisDatos): string {
  return JSON.stringify(datos, null, 2);
}

function plata(cents: number, moneda: string): string {
  try {
    return formatMoney(cents, moneda);
  } catch {
    return `${cents} (${moneda}, unidad mínima)`;
  }
}

interface FilaCsv {
  seccion: string;
  fecha: string;
  descripcion: string;
  detalle: string;
  monto: string;
}

function filasCsv(d: MisDatos): FilaCsv[] {
  const z = d.clinica.zona_horaria;
  const filas: FilaCsv[] = [];
  const add = (seccion: string, f: Partial<FilaCsv>) =>
    filas.push({ seccion, fecha: "", descripcion: "", detalle: "", monto: "", ...f });

  const p = d.paciente;
  add("Datos personales", { descripcion: "Nombre", detalle: p.nombre });
  if (p.fecha_nacimiento)
    add("Datos personales", { descripcion: "Fecha de nacimiento", detalle: p.fecha_nacimiento });
  if (p.correo) add("Datos personales", { descripcion: "Correo", detalle: p.correo });
  if (p.telefono) add("Datos personales", { descripcion: "Teléfono", detalle: p.telefono });
  if (p.direccion)
    add("Datos personales", {
      descripcion: "Dirección",
      detalle: [p.direccion, p.comuna].filter(Boolean).join(", "),
    });
  if (p.prevision) add("Datos personales", { descripcion: "Previsión", detalle: p.prevision });
  if (p.contacto_emergencia) {
    add("Datos personales", {
      descripcion: "Contacto de emergencia",
      detalle: [
        p.contacto_emergencia.nombre,
        p.contacto_emergencia.relacion,
        p.contacto_emergencia.telefono,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  add("Datos personales", {
    descripcion: "Documento de identidad",
    detalle: p.documento_de_identidad === "registrado" ? "Registrado" : "No registrado",
  });
  add("Comunicaciones", {
    descripcion: "WhatsApp",
    detalle: d.comunicaciones.whatsapp.recibe ? "Recibe mensajes" : "Dado de baja",
    fecha: d.comunicaciones.whatsapp.baja_el ? fechaHora(d.comunicaciones.whatsapp.baja_el, z) : "",
  });
  add("Comunicaciones", {
    descripcion: "Correo",
    detalle: d.comunicaciones.correo.recibe ? "Recibe correos" : "Dado de baja",
    fecha: d.comunicaciones.correo.baja_el ? fechaHora(d.comunicaciones.correo.baja_el, z) : "",
  });
  for (const a of d.salud.alergias) add("Salud", { descripcion: "Alergia", detalle: a });
  for (const c of d.salud.condiciones) add("Salud", { descripcion: "Condición", detalle: c });
  for (const m of d.salud.medicamentos_cronicos)
    add("Salud", { descripcion: "Medicamento crónico", detalle: m });
  for (const a of d.atenciones)
    add("Atenciones", {
      fecha: fecha(a.fecha, z),
      descripcion: a.titulo,
      detalle: a.profesional ?? "",
    });
  for (const c of d.citas)
    add("Citas", {
      fecha: fechaHora(c.inicio, z),
      descripcion: c.tratamiento ?? "Consulta",
      detalle: c.estado,
    });
  for (const q of d.presupuestos)
    add("Presupuestos", {
      fecha: fecha(q.fecha, z),
      descripcion: `Presupuesto ${q.numero}`,
      detalle: q.estado,
      monto: plata(q.total_cents, q.moneda),
    });
  for (const t of d.planes_de_tratamiento)
    add("Planes de tratamiento", {
      fecha: fecha(t.fecha, z),
      descripcion: t.nombre,
      detalle: t.estado,
      monto: plata(t.total_cents, t.moneda),
    });
  for (const x of d.pagos)
    add("Pagos", {
      fecha: fecha(x.fecha, z),
      descripcion: x.medio,
      detalle: x.anulado ? "Anulado" : "",
      monto: plata(x.monto_cents, x.moneda),
    });
  for (const doc of d.documentos_emitidos)
    add("Documentos emitidos", {
      fecha: fecha(doc.fecha, z),
      descripcion: `${doc.titulo} (${doc.folio})`,
      detalle: [doc.profesional, doc.anulado ? "Anulado" : ""].filter(Boolean).join(" · "),
    });
  for (const c of d.consentimientos)
    add("Consentimientos", {
      fecha: fecha(c.firmado_el, z),
      descripcion: c.titulo,
      detalle: [`Firmó ${c.firmado_por}`, c.revocado ? "Revocado" : ""].filter(Boolean).join(" · "),
    });
  for (const s of d.solicitudes_de_derechos)
    add("Solicitudes de derechos", {
      fecha: fecha(s.recibida_el, z),
      descripcion: s.tipo,
      detalle: s.estado,
    });
  return filas;
}

export function misDatosACsv(d: MisDatos): string {
  return construirCsv(filasCsv(d), [
    { header: "Sección", value: (f) => f.seccion },
    { header: "Fecha", value: (f) => f.fecha },
    { header: "Descripción", value: (f) => f.descripcion },
    { header: "Detalle", value: (f) => f.detalle },
    { header: "Monto", value: (f) => f.monto },
  ]);
}

function lineas(...xs: Array<LineaFicha | null>): LineaFicha[] {
  return xs.filter((l): l is LineaFicha => l !== null);
}

/** Contenido del PDF legible (lo dibuja `generarPdfFicha`). */
export function contenidoPdfMisDatos(d: MisDatos): ContenidoFicha {
  const z = d.clinica.zona_horaria;
  const secciones: SeccionFicha[] = [];
  const seccion = (titulo: string, lineas: LineaFicha[], vacio: string) =>
    secciones.push({ titulo, lineas: lineas.length ? lineas : [{ texto: vacio, estilo: "gris" }] });

  const p = d.paciente;
  seccion(
    "Datos personales",
    [
      p.fecha_nacimiento ? { texto: `Fecha de nacimiento: ${fecha(p.fecha_nacimiento)}` } : null,
      p.correo ? { texto: `Correo: ${p.correo}` } : null,
      p.telefono ? { texto: `Teléfono: ${p.telefono}` } : null,
      p.direccion
        ? { texto: `Dirección: ${[p.direccion, p.comuna].filter(Boolean).join(", ")}` }
        : null,
      p.prevision ? { texto: `Previsión: ${p.prevision}` } : null,
      p.contacto_emergencia
        ? {
            texto: `Contacto de emergencia: ${[p.contacto_emergencia.nombre, p.contacto_emergencia.relacion, p.contacto_emergencia.telefono].filter(Boolean).join(" · ")}`,
          }
        : null,
      {
        texto:
          p.documento_de_identidad === "registrado"
            ? "Documento de identidad: registrado (se guarda cifrado; no se incluye en esta copia)"
            : "Documento de identidad: no registrado",
      },
      { texto: `Paciente desde el ${fecha(p.paciente_desde, z)}`, estilo: "gris" },
    ].filter((l): l is LineaFicha => l !== null),
    "",
  );
  seccion(
    "Comunicaciones",
    [
      {
        texto: d.comunicaciones.whatsapp.recibe
          ? "WhatsApp: recibes mensajes de la clínica"
          : `WhatsApp: te diste de baja el ${fecha(d.comunicaciones.whatsapp.baja_el, z)}`,
      },
      {
        texto: d.comunicaciones.correo.recibe
          ? "Correo: recibes correos de la clínica"
          : `Correo: te diste de baja el ${fecha(d.comunicaciones.correo.baja_el, z)}`,
      },
    ],
    "",
  );
  seccion(
    "Salud (resumen)",
    lineas(
      d.salud.alergias.length
        ? { texto: `Alergias: ${d.salud.alergias.join(", ")}`, estilo: "alerta" }
        : null,
      d.salud.condiciones.length
        ? { texto: `Condiciones: ${d.salud.condiciones.join(", ")}` }
        : null,
      d.salud.medicamentos_cronicos.length
        ? { texto: `Medicamentos de uso habitual: ${d.salud.medicamentos_cronicos.join(", ")}` }
        : null,
    ),
    "Sin alergias, condiciones ni medicamentos registrados.",
  );
  seccion(
    "Atenciones registradas en tu ficha",
    d.atenciones.map((a) => ({
      texto: `${fecha(a.fecha, z)} · ${a.titulo}${a.profesional ? ` · ${a.profesional}` : ""}`,
    })),
    "Sin atenciones firmadas.",
  );
  seccion(
    "Citas",
    d.citas.map((c) => ({
      texto: `${fechaHora(c.inicio, z)} · ${c.tratamiento ?? "Consulta"} · ${c.estado}`,
    })),
    "Sin citas.",
  );
  seccion(
    "Presupuestos",
    d.presupuestos.map((q) => ({
      texto: `${fecha(q.fecha, z)} · Presupuesto ${q.numero} · ${q.estado} · ${plata(q.total_cents, q.moneda)}`,
    })),
    "Sin presupuestos.",
  );
  seccion(
    "Planes de tratamiento",
    d.planes_de_tratamiento.map((t) => ({
      texto: `${fecha(t.fecha, z)} · ${t.nombre} · ${t.estado} · ${plata(t.total_cents, t.moneda)}`,
    })),
    "Sin planes de tratamiento.",
  );
  seccion(
    "Pagos",
    d.pagos.map((x) => ({
      texto: `${fecha(x.fecha, z)} · ${plata(x.monto_cents, x.moneda)} · ${x.medio}${x.anulado ? " · anulado" : ""}`,
    })),
    "Sin pagos.",
  );
  seccion(
    "Documentos emitidos",
    d.documentos_emitidos.map((doc) => ({
      texto: `${fecha(doc.fecha, z)} · ${doc.titulo} (${doc.folio}) · ${doc.profesional}${doc.anulado ? " · anulado" : ""}`,
    })),
    "Sin documentos emitidos.",
  );
  seccion(
    "Consentimientos",
    d.consentimientos.map((c) => ({
      texto: `${fecha(c.firmado_el, z)} · ${c.titulo} · firmó ${c.firmado_por}${c.revocado ? " · revocado" : ""}`,
    })),
    "Sin consentimientos.",
  );
  seccion(
    "Solicitudes sobre tus datos",
    d.solicitudes_de_derechos.map((s) => ({
      texto: `${fecha(s.recibida_el, z)} · ${s.tipo} · ${s.estado}`,
    })),
    "Sin solicitudes anteriores.",
  );
  secciones.push({
    titulo: "Qué no incluye esta copia",
    lineas: [
      {
        texto:
          "El texto completo de las notas clínicas, el odontograma, las imágenes y los documentos adjuntos forman parte de tu ficha clínica completa. Puedes pedir una copia íntegra a la clínica desde el portal.",
        estilo: "gris",
      },
    ],
  });

  return {
    pacienteId: "",
    pacienteNombre: p.nombre,
    clinicaNombre: d.clinica.nombre,
    subtitulo: "Tus datos personales",
    encabezado: [`Generado el ${fechaHora(d.generado_en, z)} desde el portal del paciente`],
    secciones,
    pie: `${d.clinica.nombre} · copia de tus datos personales · confidencial`,
  };
}
