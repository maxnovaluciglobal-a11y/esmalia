/**
 * Ficha del paciente legible, para el PDF que va dentro de la exportación
 * (hallazgo CON-01, auditoría 360 del 18-oct-2026).
 *
 * Esta parte es pura: recibe las filas que ya bajó la exportación (las
 * mismas de los CSV) y arma el contenido en secciones y líneas de texto. El
 * dibujo en PDF está en `ficha-pdf.ts`. Así se prueba entero sin jsPDF, sin
 * red y sin base (`tests/exportacion-ficha-paciente.test.ts`).
 *
 * Reutiliza los textos de la app: etiquetas del odontograma, alertas de la
 * anamnesis, la línea de firma de las notas (CLI-08) y el contenido de la
 * receta (`contenidoReceta`), para que el PDF diga lo mismo que la pantalla.
 */
import {
  PREGUNTAS_RIESGO,
  alertasDeAnamnesis,
  conciliarAlergias,
  etiquetaSeveridad,
  formatearPresion,
  leerCuestionario,
  leerDetallesDeAlergias,
} from "@/lib/clinical/anamnesis";
import { lineaDeFirma } from "@/lib/clinical/clinical-notes";
import {
  CONDITION_LABELS,
  MARK_CONSERVATION_LABELS,
  MARK_STATUS_LABELS,
  SURFACE_LABELS,
  TOOTH_SURFACES,
} from "@/lib/clinical/odontogram";
import { ORTHO_CASE_KIND_LABELS, ORTHO_CASE_STATUS_LABELS } from "@/lib/clinical/ortho";
import { FURCATION_LABELS } from "@/lib/clinical/periodontal";
import {
  RecetaItemSchema,
  contenidoReceta,
  edadEnAnios,
  type RecetaEmitida,
  type RecetaItem,
} from "@/lib/clinical/recetas";
import {
  QUOTE_STATUS_LABELS,
  TREATMENT_ITEM_STATUS_LABELS,
  TREATMENT_PLAN_STATUS_LABELS,
  formatMoney,
} from "@/lib/finance/finance";
import {
  TABLAS_EXPORTACION,
  type FilaExportacion,
  type ValorExportacion,
} from "@/lib/exportacion/exportacion-clinica";
import { fichasAbsorbidas } from "@/lib/patients/fusion";
import { etiquetaParentesco } from "@/lib/patients/tutor";
import { fecha, fechaHora } from "@/lib/formato-fecha";

// ── Contenido ─────────────────────────────────────────────────────────────

export type EstiloLinea = "normal" | "negrita" | "gris" | "alerta";

export interface LineaFicha {
  texto: string;
  estilo?: EstiloLinea;
  /** Sangría (detalle de un ítem). */
  sangria?: boolean;
}

export interface SeccionFicha {
  titulo: string;
  lineas: LineaFicha[];
}

export interface ContenidoFicha {
  pacienteId: string;
  pacienteNombre: string;
  clinicaNombre: string;
  /** Líneas bajo el nombre del paciente (documento, generación). */
  encabezado: string[];
  secciones: SeccionFicha[];
  pie: string;
}

export interface OpcionesFicha {
  clinicaNombre: string;
  /** Zona horaria de la clínica, para fechas y horas. */
  zonaHoraria: string;
  /** Fecha y hora legibles de la generación. */
  generadoEn: string;
  /** Presupuestos y pagos: solo si quien exporta ve finanzas. */
  incluirFinanzas: boolean;
}

// ── Índice por paciente ───────────────────────────────────────────────────

/**
 * Las filas de cada tabla agrupadas por paciente (o por la fila padre, para
 * las tablas que cuelgan de otra). Se arma una vez por exportación: generar
 * miles de fichas recorriendo cada tabla entera por paciente sería
 * cuadrático.
 */
export interface IndiceFichas {
  pacientes: Map<string, FilaExportacion>;
  grupos: Map<string, Map<string, FilaExportacion[]>>;
  fusiones: { id: string; merged_into: string | null }[];
}

function texto(v: ValorExportacion | undefined): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

function numero(v: ValorExportacion | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function lista(v: ValorExportacion | undefined): string[] {
  return Array.isArray(v) ? v.map((x) => texto(x)).filter(Boolean) : [];
}

export function indexarFichas(datos: Record<string, readonly FilaExportacion[]>): IndiceFichas {
  const pacientes = new Map<string, FilaExportacion>();
  for (const p of datos.pacientes ?? []) pacientes.set(texto(p.id), p);

  const grupos = new Map<string, Map<string, FilaExportacion[]>>();
  for (const tabla of TABLAS_EXPORTACION) {
    const filtro = tabla.paciente;
    if (!filtro || filtro.por === "id") continue;
    const columna = filtro.por === "padre" ? filtro.columna : filtro.por;
    const grupo = new Map<string, FilaExportacion[]>();
    for (const fila of datos[tabla.clave] ?? []) {
      const clave = texto(fila[columna]);
      if (!clave) continue;
      const actual = grupo.get(clave);
      if (actual) actual.push(fila);
      else grupo.set(clave, [fila]);
    }
    grupos.set(tabla.clave, grupo);
  }

  const fusiones = [...pacientes.values()]
    .filter((p) => texto(p.merged_into))
    .map((p) => ({ id: texto(p.id), merged_into: texto(p.merged_into) }));
  return { pacientes, grupos, fusiones };
}

function filasDe(indice: IndiceFichas, clave: string, ids: readonly string[]): FilaExportacion[] {
  const grupo = indice.grupos.get(clave);
  if (!grupo) return [];
  return ids.flatMap((id) => grupo.get(id) ?? []);
}

/** Pacientes que llevan PDF: todos menos las fichas fusionadas en otra. */
export function pacientesConFicha(indice: IndiceFichas): FilaExportacion[] {
  return [...indice.pacientes.values()].filter((p) => !texto(p.merged_into));
}

// ── Formato ───────────────────────────────────────────────────────────────

// Mismo formato que la app (UX-09): `@/lib/formato-fecha`.
function crearFechas(zona: string) {
  const valida = (iso: string) => !Number.isNaN(Date.parse(iso));
  return {
    /** Fecha y hora de un instante (timestamptz), en la zona de la clínica. */
    fechaHora: (v: ValorExportacion | undefined) => {
      const iso = texto(v);
      return iso && valida(iso) ? fechaHora(iso, zona) : "";
    },
    /** Fecha de un instante (timestamptz), en la zona de la clínica. */
    fecha: (v: ValorExportacion | undefined) => {
      const iso = texto(v);
      return iso && valida(iso) ? fecha(iso, zona) : "";
    },
    /** Fecha sin hora (`date`): no tiene zona, se muestra tal cual. */
    dia: (v: ValorExportacion | undefined) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(v));
      return m ? fecha(`${m[1]}-${m[2]}-${m[3]}`) : "";
    },
  };
}

function unir(partes: Array<string | null | undefined | false>): string {
  return partes.filter((p): p is string => Boolean(p)).join(" · ");
}

function etiqueta(mapa: Record<string, string>, valor: ValorExportacion | undefined): string {
  const v = texto(valor);
  return mapa[v] ?? v;
}

function plata(cents: ValorExportacion | undefined, moneda: ValorExportacion | undefined): string {
  const n = numero(cents);
  const m = texto(moneda);
  if (n === null || !m) return "";
  try {
    return formatMoney(n, m);
  } catch {
    return `${n} (${m}, unidad mínima)`;
  }
}

function porFecha(columna: string, descendente = false) {
  return (a: FilaExportacion, b: FilaExportacion) => {
    const r = texto(a[columna]).localeCompare(texto(b[columna]));
    return descendente ? -r : r;
  };
}

const ESTADO_PACIENTE: Record<string, string> = {
  active: "Activo",
  new: "Nuevo",
  inactive: "Inactivo",
};

const ROL_FIRMANTE: Record<string, string> = {
  patient: "el paciente",
  guardian: "su representante legal",
};

// ── Secciones ─────────────────────────────────────────────────────────────

type Fechas = ReturnType<typeof crearFechas>;

function seccionDatos(p: FilaExportacion, absorbidas: string[], f: Fechas): SeccionFicha {
  const lineas: LineaFicha[] = [
    { texto: `Nombre: ${texto(p.full_name)}` },
    { texto: `Documento: ${texto(p.document_id) || "Sin registrar"}` },
    { texto: `Fecha de nacimiento: ${f.dia(p.birth_date) || "Sin registrar"}` },
    { texto: `Teléfono: ${texto(p.phone) || "Sin registrar"}` },
    { texto: `Correo: ${texto(p.email) || "Sin registrar"}` },
    { texto: `Estado: ${etiqueta(ESTADO_PACIENTE, p.status) || "Sin registrar"}` },
    { texto: `Ficha creada: ${f.fechaHora(p.created_at)}` },
  ];
  if (texto(p.archived_at)) {
    lineas.push({ texto: `Ficha archivada el ${f.fechaHora(p.archived_at)}`, estilo: "gris" });
  }
  if (absorbidas.length) {
    lineas.push({
      texto: `Incluye ${absorbidas.length} ${
        absorbidas.length === 1 ? "ficha fusionada" : "fichas fusionadas"
      } en esta: sus notas, anamnesis, documentos y consentimientos aparecen abajo.`,
      estilo: "gris",
    });
  }
  return { titulo: "Datos del paciente", lineas };
}

function alergiasDe(a: FilaExportacion) {
  return conciliarAlergias(lista(a.allergies), leerDetallesDeAlergias(a.allergy_details));
}

function seccionAlertas(anamnesis: FilaExportacion[]): SeccionFicha {
  const lineas: LineaFicha[] = [];
  const vistas = new Set<string>();
  for (const a of anamnesis) {
    for (const alerta of alertasDeAnamnesis({
      alergias: alergiasDe(a),
      cuestionario: leerCuestionario(a.risk_questionnaire),
    })) {
      if (vistas.has(alerta.texto)) continue;
      vistas.add(alerta.texto);
      lineas.push({
        texto: `${alerta.nivel === "critica" ? "IMPORTANTE" : "Precaución"}: ${alerta.texto}`,
        estilo: alerta.nivel === "critica" ? "alerta" : "negrita",
      });
    }
  }
  if (!lineas.length) lineas.push({ texto: "Sin alertas registradas.", estilo: "gris" });
  return { titulo: "Alertas clínicas", lineas };
}

function seccionAnamnesis(
  anamnesis: FilaExportacion[],
  historial: number,
  pacienteId: string,
  f: Fechas,
): SeccionFicha {
  const lineas: LineaFicha[] = [];
  if (!anamnesis.length) lineas.push({ texto: "Sin anamnesis registrada.", estilo: "gris" });
  for (const a of anamnesis) {
    if (anamnesis.length > 1) {
      lineas.push({
        texto:
          texto(a.patient_id) === pacienteId
            ? "Anamnesis de esta ficha"
            : "Anamnesis de una ficha fusionada en esta",
        estilo: "negrita",
      });
    }
    const alergias = alergiasDe(a);
    lineas.push({ texto: "Alergias:", estilo: "negrita" });
    if (!alergias.length) lineas.push({ texto: "Ninguna registrada.", sangria: true });
    for (const al of alergias) {
      lineas.push({
        texto: `• ${unir([
          al.name,
          etiquetaSeveridad[al.severity],
          al.reaction ? `reacción: ${al.reaction}` : null,
        ])}`,
        sangria: true,
      });
    }
    const enfermedades = lista(a.conditions);
    lineas.push({ texto: `Enfermedades: ${enfermedades.join(", ") || "Ninguna registrada."}` });
    const medicacion = lista(a.chronic_medications);
    lineas.push({
      texto: `Medicación habitual: ${medicacion.join(", ") || "Ninguna registrada."}`,
    });

    const cuestionario = leerCuestionario(a.risk_questionnaire);
    const respondidas = PREGUNTAS_RIESGO.filter((p) => cuestionario[p.key]);
    if (respondidas.length) {
      lineas.push({ texto: "Cuestionario de riesgo:", estilo: "negrita" });
      for (const p of respondidas) {
        const r = cuestionario[p.key]!;
        lineas.push({
          texto: `• ${p.label}: ${r.answer === "yes" ? "Sí" : "No"}${r.detail ? ` (${r.detail})` : ""}`,
          sangria: true,
        });
      }
    }
    if (texto(a.notes)) lineas.push({ texto: `Notas: ${texto(a.notes)}` });
    if (texto(a.updated_at)) {
      lineas.push({ texto: `Última actualización: ${f.fechaHora(a.updated_at)}`, estilo: "gris" });
    }
  }
  if (historial) {
    lineas.push({
      texto: `Historial: ${historial} ${historial === 1 ? "cambio registrado" : "cambios registrados"} (detalle en auditoria-anamnesis.csv).`,
      estilo: "gris",
    });
  }
  return { titulo: "Anamnesis", lineas };
}

function seccionSignos(signos: FilaExportacion[], f: Fechas): SeccionFicha | null {
  if (!signos.length) return null;
  const lineas = [...signos].sort(porFecha("measured_at", true)).map((s) => {
    const sis = numero(s.systolic_mmhg);
    const dia = numero(s.diastolic_mmhg);
    const pulso = numero(s.heart_rate_bpm);
    const temp = numero(s.temperature_c);
    return {
      texto: `• ${unir([
        f.fechaHora(s.measured_at),
        sis !== null && dia !== null ? `Presión ${formatearPresion(sis, dia)}` : null,
        pulso !== null ? `Pulso ${pulso} lpm` : null,
        temp !== null ? `Temperatura ${String(temp).replace(".", ",")} °C` : null,
        texto(s.notes) || null,
      ])}`,
    };
  });
  return { titulo: "Signos vitales", lineas };
}

function seccionTutores(tutores: FilaExportacion[], f: Fechas): SeccionFicha | null {
  if (!tutores.length) return null;
  const ordenados = [...tutores].sort(
    (a, b) =>
      Number(Boolean(texto(a.archived_at))) - Number(Boolean(texto(b.archived_at))) ||
      Number(b.is_primary === true) - Number(a.is_primary === true),
  );
  const lineas: LineaFicha[] = ordenados.map((t) => ({
    texto: `• ${unir([
      texto(t.full_name),
      texto(t.document_id) ? `Documento ${texto(t.document_id)}` : null,
      texto(t.relationship_detail) || etiqueta(etiquetaParentesco, t.relationship),
      texto(t.phone) || null,
      texto(t.email) || null,
      t.is_primary === true ? "Principal" : null,
      texto(t.archived_at) ? `Archivado el ${f.fecha(t.archived_at)}` : null,
    ])}`,
    estilo: texto(t.archived_at) ? "gris" : undefined,
  }));
  return { titulo: "Tutores o representantes legales", lineas };
}

function ordenSuperficie(s: ValorExportacion | undefined): number {
  const i = (TOOTH_SURFACES as readonly string[]).indexOf(texto(s));
  return i < 0 ? 99 : i;
}

function seccionOdontograma(marcas: FilaExportacion[]): SeccionFicha {
  const vigentes = marcas
    .filter((m) => !texto(m.superseded_at))
    .sort(
      (a, b) =>
        (numero(a.tooth_number) ?? 0) - (numero(b.tooth_number) ?? 0) ||
        ordenSuperficie(a.surface) - ordenSuperficie(b.surface) ||
        texto(a.recorded_at).localeCompare(texto(b.recorded_at)),
    );
  const lineas: LineaFicha[] = vigentes.map((m) => ({
    texto: `• ${unir([
      `Pieza ${texto(m.tooth_number)}`,
      etiqueta(SURFACE_LABELS, m.surface),
      etiqueta(CONDITION_LABELS, m.condition),
      etiqueta(MARK_STATUS_LABELS, m.status),
      texto(m.conservation) ? etiqueta(MARK_CONSERVATION_LABELS, m.conservation) : null,
      texto(m.material) ? `Material: ${texto(m.material)}` : null,
      texto(m.notes) || null,
    ])}`,
  }));
  if (!lineas.length) lineas.push({ texto: "Sin marcas registradas.", estilo: "gris" });
  const reemplazadas = marcas.length - vigentes.length;
  if (reemplazadas) {
    lineas.push({
      texto: `Historial: ${reemplazadas} ${reemplazadas === 1 ? "marca reemplazada" : "marcas reemplazadas"} (detalle en odontograma.csv).`,
      estilo: "gris",
    });
  }
  return { titulo: "Odontograma (marcas vigentes)", lineas };
}

function seccionPeriodontograma(
  charts: FilaExportacion[],
  mediciones: (chartId: string) => FilaExportacion[],
  f: Fechas,
): SeccionFicha | null {
  if (!charts.length) return null;
  const lineas: LineaFicha[] = [];
  for (const c of [...charts].sort(porFecha("recorded_at", true))) {
    const ms = mediciones(texto(c.id));
    const piezas = new Set(ms.map((m) => texto(m.tooth_number)));
    const sitios = ms.filter((m) => texto(m.point) !== "whole");
    const profundidades = sitios
      .map((m) => numero(m.pocket_depth_mm))
      .filter((n): n is number => n !== null);
    const bolsas = profundidades.filter((n) => n >= 4).length;
    const conDatoSangrado = sitios.filter((m) => typeof m.bleeding === "boolean");
    const sangran = conDatoSangrado.filter((m) => m.bleeding === true).length;
    const movilidad = ms
      .filter((m) => (numero(m.mobility) ?? 0) > 0)
      .map((m) => `${texto(m.tooth_number)} (${texto(m.mobility)})`);
    const furca = ms
      .filter((m) => (numero(m.furcation) ?? 0) > 0)
      .map(
        (m) =>
          `${texto(m.tooth_number)} (${(FURCATION_LABELS[numero(m.furcation) ?? 0] ?? texto(m.furcation)).split(" ")[0]})`,
      );
    lineas.push({ texto: f.fechaHora(c.recorded_at), estilo: "negrita" });
    lineas.push({
      texto: unir([
        `${piezas.size} ${piezas.size === 1 ? "pieza medida" : "piezas medidas"}`,
        profundidades.length ? `Sondaje máximo ${Math.max(...profundidades)} mm` : null,
        bolsas ? `${bolsas} ${bolsas === 1 ? "sitio" : "sitios"} con bolsa de 4 mm o más` : null,
        conDatoSangrado.length
          ? `Sangrado en ${sangran} de ${conDatoSangrado.length} sitios (${Math.round(
              (sangran / conDatoSangrado.length) * 100,
            )} %)`
          : null,
      ]),
      sangria: true,
    });
    if (movilidad.length) {
      lineas.push({ texto: `Movilidad: ${movilidad.join(", ")}`, sangria: true });
    }
    if (furca.length) lineas.push({ texto: `Furca: ${furca.join(", ")}`, sangria: true });
    if (texto(c.notes)) lineas.push({ texto: `Notas: ${texto(c.notes)}`, sangria: true });
  }
  lineas.push({
    texto: "Mediciones punto por punto en periodontograma-mediciones.csv.",
    estilo: "gris",
  });
  return { titulo: "Periodontograma (resumen)", lineas };
}

function lineaFirma(n: FilaExportacion, f: Fechas): string {
  const base = lineaDeFirma({
    status: texto(n.status) === "signed" ? "signed" : "draft",
    // La fecha va aparte, con año y en la zona de la clínica.
    signedAt: null,
    signerName: texto(n.signer_name) || null,
    signerLicense: texto(n.signer_license) || null,
  });
  if (!base) return "Borrador sin firmar.";
  return texto(n.signed_at) ? `${base} · ${f.fechaHora(n.signed_at)}` : base;
}

function seccionNotas(
  notas: FilaExportacion[],
  versionesDe: (notaId: string) => number,
  f: Fechas,
): SeccionFicha {
  const lineas: LineaFicha[] = [];
  const ids = new Set(notas.map((n) => texto(n.id)));
  const adendasDe = new Map<string, FilaExportacion[]>();
  const principales: FilaExportacion[] = [];
  for (const n of notas) {
    const padre = texto(n.addendum_of);
    if (padre && ids.has(padre)) {
      adendasDe.set(padre, [...(adendasDe.get(padre) ?? []), n]);
    } else {
      principales.push(n);
    }
  }
  for (const n of principales.sort(porFecha("created_at"))) {
    const esAdendaSuelta = Boolean(texto(n.addendum_of));
    lineas.push({
      texto: unir([
        esAdendaSuelta ? `Adenda: ${texto(n.title)}` : texto(n.title) || "Nota sin título",
        texto(n.status) === "signed" ? "Firmada" : "Borrador",
        `creada ${f.fechaHora(n.created_at)}`,
      ]),
      estilo: "negrita",
    });
    lineas.push({ texto: texto(n.content) || "Sin contenido registrado." });
    if (texto(n.summary)) lineas.push({ texto: `Resumen: ${texto(n.summary)}`, estilo: "gris" });
    lineas.push({ texto: lineaFirma(n, f), estilo: "gris" });
    const versiones = versionesDe(texto(n.id));
    if (versiones > 1) {
      lineas.push({
        texto: `${versiones} versiones (historial completo en notas-clinicas-versiones.csv).`,
        estilo: "gris",
      });
    }
    for (const a of (adendasDe.get(texto(n.id)) ?? []).sort(porFecha("created_at"))) {
      lineas.push({
        texto: `Adenda: ${unir([texto(a.title), `creada ${f.fechaHora(a.created_at)}`])}`,
        estilo: "negrita",
        sangria: true,
      });
      lineas.push({ texto: texto(a.content) || "Sin contenido registrado.", sangria: true });
      lineas.push({
        texto: texto(a.status) === "signed" ? lineaFirma(a, f) : "Adenda en borrador, sin firmar.",
        estilo: "gris",
        sangria: true,
      });
    }
  }
  if (!lineas.length) lineas.push({ texto: "Sin notas clínicas.", estilo: "gris" });
  return { titulo: "Notas clínicas", lineas };
}

function seccionConsentimientos(
  consentimientos: FilaExportacion[],
  f: Fechas,
): SeccionFicha | null {
  if (!consentimientos.length) return null;
  const lineas: LineaFicha[] = [];
  for (const c of [...consentimientos].sort(porFecha("signed_at"))) {
    lineas.push({
      texto: unir([texto(c.title_snapshot), `firmado ${f.fechaHora(c.signed_at)}`]),
      estilo: "negrita",
    });
    const piezas = lista(c.tooth_numbers);
    if (texto(c.procedure_snapshot) || piezas.length) {
      lineas.push({
        texto: unir([
          texto(c.procedure_snapshot) ? `Procedimiento: ${texto(c.procedure_snapshot)}` : null,
          piezas.length ? `Piezas: ${piezas.join(", ")}` : null,
        ]),
        sangria: true,
      });
    }
    const rol = texto(c.signer_role);
    lineas.push({
      texto: `Firmó: ${unir([
        texto(c.signed_by_name),
        rol ? (ROL_FIRMANTE[rol] ?? rol) : null,
        texto(c.signer_relationship_snapshot) || null,
        texto(c.signer_document_snapshot) ? `Documento ${texto(c.signer_document_snapshot)}` : null,
      ])}`,
      sangria: true,
    });
    if (texto(c.informed_by_name_snapshot)) {
      lineas.push({
        texto: `Informó: ${unir([
          texto(c.informed_by_name_snapshot),
          texto(c.informed_by_license_snapshot)
            ? `Registro ${texto(c.informed_by_license_snapshot)}`
            : null,
        ])}`,
        sangria: true,
      });
    }
    lineas.push({ texto: texto(c.body_snapshot), sangria: true });
    if (texto(c.risks_snapshot)) {
      lineas.push({ texto: `Riesgos: ${texto(c.risks_snapshot)}`, sangria: true });
    }
    if (texto(c.alternatives_snapshot)) {
      lineas.push({ texto: `Alternativas: ${texto(c.alternatives_snapshot)}`, sangria: true });
    }
    if (texto(c.revoked_at)) {
      lineas.push({
        texto: `Revocado el ${f.fechaHora(c.revoked_at)}`,
        estilo: "alerta",
        sangria: true,
      });
    }
  }
  lineas.push({
    texto: "La imagen de cada firma está en archivos/firmas-consentimientos/.",
    estilo: "gris",
  });
  return { titulo: "Consentimientos informados", lineas };
}

function itemsDeReceta(valor: ValorExportacion | undefined): RecetaItem[] {
  if (!Array.isArray(valor)) return [];
  const items: RecetaItem[] = [];
  for (const item of valor) {
    const r = RecetaItemSchema.safeParse(item);
    if (r.success) items.push(r.data);
  }
  return items;
}

function recetaEmitida(r: FilaExportacion): RecetaEmitida {
  return {
    id: texto(r.id),
    year: numero(r.year) ?? 0,
    number: numero(r.number) ?? 0,
    issuedAt: texto(r.issued_at),
    professionalName: texto(r.professional_name_snapshot),
    professionalLicense: texto(r.professional_license_snapshot),
    professionalSpecialty: texto(r.professional_specialty_snapshot) || null,
    clinicName: texto(r.clinic_name_snapshot),
    clinicLegalName: texto(r.clinic_legal_name_snapshot) || null,
    clinicTaxId: texto(r.clinic_tax_id_snapshot) || null,
    clinicAddress: texto(r.clinic_address_snapshot) || null,
    clinicPhone: texto(r.clinic_phone_snapshot) || null,
    patientName: texto(r.patient_name_snapshot),
    patientBirthDate: texto(r.patient_birth_date_snapshot) || null,
    items: itemsDeReceta(r.items),
    instructions: texto(r.instructions) || null,
    contentSha256: texto(r.content_sha256),
    voidedAt: texto(r.voided_at) || null,
    voidReason: texto(r.void_reason) || null,
  };
}

function seccionRecetas(recetas: FilaExportacion[], f: Fechas): SeccionFicha | null {
  if (!recetas.length) return null;
  const lineas: LineaFicha[] = [];
  for (const fila of [...recetas].sort(porFecha("issued_at"))) {
    const receta = recetaEmitida(fila);
    const c = contenidoReceta(receta, {
      fecha: f.fechaHora(fila.issued_at),
      edad: edadEnAnios(receta.patientBirthDate, receta.issuedAt),
    });
    lineas.push({
      texto: unir([c.titulo, `emitida ${f.fechaHora(fila.issued_at)}`]),
      estilo: "negrita",
    });
    if (c.anulada) lineas.push({ texto: c.anulada, estilo: "alerta", sangria: true });
    for (const m of c.medicamentos) {
      lineas.push({ texto: `${m.titulo}: ${m.posologia}`, sangria: true });
      if (m.indicaciones) lineas.push({ texto: m.indicaciones, estilo: "gris", sangria: true });
    }
    if (c.indicacionesGenerales) {
      lineas.push({ texto: `Indicaciones: ${c.indicacionesGenerales}`, sangria: true });
    }
    lineas.push({
      texto: `Profesional: ${c.profesional.join(" · ")}`,
      estilo: "gris",
      sangria: true,
    });
    lineas.push({ texto: c.pie, estilo: "gris", sangria: true });
  }
  return { titulo: "Recetas", lineas };
}

function seccionPresupuestos(
  presupuestos: FilaExportacion[],
  itemsDe: (id: string) => FilaExportacion[],
  f: Fechas,
): SeccionFicha | null {
  if (!presupuestos.length) return null;
  const lineas: LineaFicha[] = [];
  for (const q of [...presupuestos].sort(porFecha("created_at"))) {
    const moneda = q.currency;
    lineas.push({
      texto: unir([
        `Presupuesto ${texto(q.number)}`,
        etiqueta(QUOTE_STATUS_LABELS, q.status),
        `Total ${plata(q.total_cents, moneda)}`,
        `creado ${f.fecha(q.created_at)}`,
      ]),
      estilo: "negrita",
    });
    if (texto(q.accepted_at)) {
      lineas.push({
        texto: unir([
          `Aceptado el ${f.fechaHora(q.accepted_at)}`,
          texto(q.accepted_by_name) ? `por ${texto(q.accepted_by_name)}` : null,
        ]),
        sangria: true,
      });
    }
    if (texto(q.agreement_name_snapshot)) {
      lineas.push({
        texto: `Convenio: ${texto(q.agreement_name_snapshot)} · cubre ${plata(q.coverage_total_cents, moneda)}`,
        sangria: true,
      });
    }
    for (const it of [...itemsDe(texto(q.id))].sort(
      (a, b) => (numero(a.position) ?? 0) - (numero(b.position) ?? 0),
    )) {
      lineas.push({
        texto: `• ${unir([
          texto(it.name_snapshot),
          texto(it.tooth_number) ? `pieza ${texto(it.tooth_number)}` : null,
          (numero(it.quantity) ?? 1) !== 1 ? `x${texto(it.quantity)}` : null,
          `paga el paciente ${plata(it.patient_cents ?? it.total_cents, moneda)}`,
        ])}`,
        sangria: true,
      });
    }
  }
  return { titulo: "Presupuestos", lineas };
}

function seccionPlanes(
  planes: FilaExportacion[],
  itemsDe: (id: string) => FilaExportacion[],
  f: Fechas,
  conMontos: boolean,
): SeccionFicha | null {
  if (!planes.length) return null;
  const lineas: LineaFicha[] = [];
  for (const p of [...planes].sort(porFecha("created_at"))) {
    lineas.push({
      texto: unir([
        texto(p.name) || "Plan de tratamiento",
        etiqueta(TREATMENT_PLAN_STATUS_LABELS, p.status),
        conMontos ? `Total ${plata(p.total_cents, p.currency)}` : null,
        `creado ${f.fecha(p.created_at)}`,
      ]),
      estilo: "negrita",
    });
    for (const it of [...itemsDe(texto(p.id))].sort(
      (a, b) => (numero(a.position) ?? 0) - (numero(b.position) ?? 0),
    )) {
      lineas.push({
        texto: `• ${unir([
          texto(it.name_snapshot),
          texto(it.tooth_number) ? `pieza ${texto(it.tooth_number)}` : null,
          etiqueta(TREATMENT_ITEM_STATUS_LABELS, it.status),
          texto(it.completed_at) ? `realizado ${f.fecha(it.completed_at)}` : null,
        ])}`,
        sangria: true,
      });
    }
  }
  return { titulo: "Planes de tratamiento", lineas };
}

function seccionPagos(pagos: FilaExportacion[], f: Fechas): SeccionFicha | null {
  if (!pagos.length) return null;
  const lineas: LineaFicha[] = [];
  const totales = new Map<string, number>();
  for (const p of [...pagos].sort(porFecha("paid_at"))) {
    const reversado = Boolean(texto(p.reversed_at));
    if (!reversado) {
      const m = texto(p.currency);
      totales.set(m, (totales.get(m) ?? 0) + (numero(p.amount_cents) ?? 0));
    }
    lineas.push({
      texto: `• ${unir([
        f.fecha(p.paid_at),
        plata(p.amount_cents, p.currency),
        texto(p.method_name_snapshot) || texto(p.method) || null,
        texto(p.reference) ? `Ref. ${texto(p.reference)}` : null,
        reversado
          ? `ANULADO el ${f.fecha(p.reversed_at)}${texto(p.reversal_reason) ? ` (${texto(p.reversal_reason)})` : ""}`
          : null,
      ])}`,
      estilo: reversado ? "gris" : undefined,
    });
  }
  for (const [moneda, total] of totales) {
    lineas.push({ texto: `Total pagado: ${plata(total, moneda)}`, estilo: "negrita" });
  }
  return { titulo: "Pagos", lineas };
}

function seccionOrtodoncia(
  casos: FilaExportacion[],
  controlesDe: (id: string) => FilaExportacion[],
  f: Fechas,
  conMontos: boolean,
): SeccionFicha | null {
  if (!casos.length) return null;
  const lineas: LineaFicha[] = [];
  for (const c of [...casos].sort(porFecha("started_on"))) {
    const controles = [...controlesDe(texto(c.id))].sort(porFecha("control_date"));
    const asistidos = controles.filter((x) => x.attended === true).length;
    lineas.push({
      texto: unir([
        etiqueta(ORTHO_CASE_KIND_LABELS, c.kind),
        etiqueta(ORTHO_CASE_STATUS_LABELS, c.status),
        `inicio ${f.dia(c.started_on)}`,
        texto(c.expected_end_on) ? `término estimado ${f.dia(c.expected_end_on)}` : null,
        conMontos && numero(c.monthly_fee_cents) !== null
          ? `cuota ${plata(c.monthly_fee_cents, c.currency)}`
          : null,
      ]),
      estilo: "negrita",
    });
    lineas.push({
      texto: controles.length
        ? `${controles.length} controles (${asistidos} con asistencia), el último el ${f.dia(
            controles[controles.length - 1].control_date,
          )}`
        : "Sin controles registrados.",
      sangria: true,
    });
    if (texto(c.notes)) lineas.push({ texto: `Notas: ${texto(c.notes)}`, sangria: true });
  }
  return { titulo: "Ortodoncia", lineas };
}

function seccionDocumentos(documentos: FilaExportacion[], f: Fechas): SeccionFicha | null {
  if (!documentos.length) return null;
  const lineas: LineaFicha[] = [...documentos].sort(porFecha("created_at")).map((d) => ({
    texto: `• ${unir([
      texto(d.filename),
      texto(d.kind) || null,
      f.fecha(d.created_at),
      texto(d.notes) || null,
      texto(d.archived_at) ? `archivado el ${f.fecha(d.archived_at)}` : null,
    ])}`,
    estilo: texto(d.archived_at) ? "gris" : undefined,
  }));
  lineas.push({ texto: "Los archivos están en archivos/documentos/.", estilo: "gris" });
  return { titulo: "Documentos y radiografías", lineas };
}

// ── Ficha completa ────────────────────────────────────────────────────────

/** Contenido de la ficha de un paciente, o null si no está en los datos. */
export function contenidoFicha(
  indice: IndiceFichas,
  pacienteId: string,
  op: OpcionesFicha,
): ContenidoFicha | null {
  const p = indice.pacientes.get(pacienteId);
  if (!p) return null;
  const f = crearFechas(op.zonaHoraria);
  const absorbidas = fichasAbsorbidas(pacienteId, indice.fusiones);
  const ids = [pacienteId, ...absorbidas];
  const de = (clave: string) => filasDe(indice, clave, ids);
  const hijos = (clave: string) => (id: string) => filasDe(indice, clave, [id]);

  const anamnesis = de("anamnesis").sort(
    (a, b) =>
      Number(texto(b.patient_id) === pacienteId) - Number(texto(a.patient_id) === pacienteId),
  );
  const nombre = texto(p.full_name) || "Paciente";

  const secciones: Array<SeccionFicha | null> = [
    seccionDatos(p, absorbidas, f),
    seccionAlertas(anamnesis),
    seccionAnamnesis(anamnesis, de("anamnesis_historial").length, pacienteId, f),
    seccionSignos(de("signos_vitales"), f),
    seccionTutores(de("tutores"), f),
    seccionOdontograma(de("odontograma")),
    seccionPeriodontograma(de("periodontograma"), hijos("periodontograma_mediciones"), f),
    seccionNotas(de("notas"), (id) => hijos("notas_versiones")(id).length, f),
    seccionConsentimientos(de("consentimientos"), f),
    seccionRecetas(de("recetas"), f),
    seccionOrtodoncia(de("ortodoncia"), hijos("ortodoncia_controles"), f, op.incluirFinanzas),
    seccionPlanes(de("planes"), hijos("planes_items"), f, op.incluirFinanzas),
    ...(op.incluirFinanzas
      ? [
          seccionPresupuestos(de("presupuestos"), hijos("presupuestos_items"), f),
          seccionPagos(de("pagos"), f),
        ]
      : [
          {
            titulo: "Presupuestos y pagos",
            lineas: [
              {
                texto:
                  "No incluidos en esta copia: los entrega el propietario o un administrador de la clínica.",
                estilo: "gris" as const,
              },
            ],
          },
        ]),
    seccionDocumentos(de("documentos"), f),
  ];

  return {
    pacienteId,
    pacienteNombre: nombre,
    clinicaNombre: op.clinicaNombre,
    encabezado: [
      unir([
        texto(p.document_id) ? `Documento: ${texto(p.document_id)}` : null,
        texto(p.birth_date) ? `Nacimiento: ${f.dia(p.birth_date)}` : null,
      ]),
      `Copia generada el ${op.generadoEn} desde Esmalia`,
    ].filter(Boolean),
    secciones: secciones.filter((s): s is SeccionFicha => s !== null),
    pie: `${op.clinicaNombre} · ${nombre} · documento confidencial`,
  };
}
