/**
 * Receta → FHIR R4 (MKT-05). Función pura: arma el JSON, no lo manda a
 * ningún lado. Todavía no hay integración con la receta electrónica del
 * Minsal; esto deja la receta lista para cuando la haya. El mapeo completo,
 * campo por campo, está en docs/RECETA_FHIR.md.
 *
 * Una receta con varios medicamentos son varios `MedicationRequest` (uno por
 * medicamento) con el mismo `groupIdentifier` (el folio de la receta), más el
 * `Patient` y el `Practitioner`, todo en un `Bundle` de tipo `collection`.
 *
 * Los `system` de los identificadores son de Esmalia (`SISTEMAS_FHIR`)
 * mientras no exista la integración: el día que se conecte con el Minsal se
 * cambian por los de la guía nacional (HL7 Chile, CL Core) en este único
 * lugar.
 */
import { normalizarDocumento } from "@/lib/patients/rut";
import { nombreConPresentacion } from "@/lib/clinical/recetas";
import type { RecetaItemGuardado } from "@/lib/clinical/receta-estructurada";
import { ETIQUETA_VIA, VIA_EN_POSOLOGIA, type ViaAdministracion } from "@/lib/clinical/vademecum";

const BASE = "https://esmalia.com/fhir";

export const SISTEMAS_FHIR = {
  /** Folio de la receta en la clínica. */
  receta: `${BASE}/sid/receta`,
  /** RUN/RUT chileno. */
  rut: `${BASE}/sid/cl-rut`,
  /** Otro documento de identidad (pasaporte, DNI). */
  documento: `${BASE}/sid/documento`,
  /** Registro Nacional de Prestadores Individuales (Superintendencia de Salud). */
  registroSis: `${BASE}/sid/cl-registro-sis`,
  /** Registro o colegiatura profesional (otros países). */
  registroProfesional: `${BASE}/sid/registro-profesional`,
  atc: "http://www.whocc.no/atc",
  snomed: "http://snomed.info/sct",
  ucum: "http://unitsofmeasure.org",
  tipoIdentificador: "http://terminology.hl7.org/CodeSystem/v2-0203",
} as const;

/** Vía → SNOMED CT (value set de rutas de FHIR R4). */
export const VIA_SNOMED: Record<ViaAdministracion, { code: string; display: string }> = {
  oral: { code: "26643006", display: "Oral route" },
  sublingual: { code: "37839007", display: "Sublingual route" },
  enjuague_bucal: { code: "372473007", display: "Oromucosal route" },
  topica_bucal: { code: "372473007", display: "Oromucosal route" },
  dental: { code: "372449004", display: "Dental route" },
  cutanea: { code: "448598008", display: "Cutaneous route" },
};

const UCUM_DURACION = { d: "d", wk: "wk", mo: "mo" } as const;
const TEXTO_DURACION = { d: "días", wk: "semanas", mo: "meses" } as const;

export interface RecetaParaFhir {
  /** id de `prescriptions`. */
  id: string;
  /** Folio con el que se imprimió: "2026-0012". */
  folio: string;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  paciente: {
    id: string;
    nombre: string;
    tipoDocumento: string | null;
    documento: string | null;
    fechaNacimiento: string | null;
  };
  profesional: {
    /** null si se borró su ficha (el nombre y el registro quedan en la receta). */
    id: string | null;
    nombre: string;
    registroSis: string | null;
    registroProfesional: string | null;
  };
  items: readonly RecetaItemGuardado[];
  indicacionesGenerales: string | null;
}

type Json = Record<string, unknown>;

function sinVacios<T extends Json>(objeto: T): T {
  const out: Json = {};
  for (const [k, v] of Object.entries(objeto)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

function identificadorPaciente(p: RecetaParaFhir["paciente"]): Json | null {
  const valor = p.documento?.trim();
  if (!valor) return null;
  if (p.tipoDocumento === "rut") {
    // Sin puntos, con guion: "12.345.678-5" → "12345678-5".
    const n = normalizarDocumento(valor) ?? valor;
    return {
      use: "official",
      type: {
        coding: [
          {
            system: SISTEMAS_FHIR.tipoIdentificador,
            code: "NI",
            display: "National unique individual identifier",
          },
        ],
        text: "RUT",
      },
      system: SISTEMAS_FHIR.rut,
      value: n.length > 1 ? `${n.slice(0, -1)}-${n.slice(-1)}` : n,
    };
  }
  const pasaporte = p.tipoDocumento === "pasaporte";
  return sinVacios({
    use: "official",
    type: sinVacios({
      coding: pasaporte
        ? [{ system: SISTEMAS_FHIR.tipoIdentificador, code: "PPN", display: "Passport number" }]
        : undefined,
      text: pasaporte ? "Pasaporte" : p.tipoDocumento === "dni" ? "DNI" : "Documento",
    }),
    system: SISTEMAS_FHIR.documento,
    value: valor,
  });
}

function recursoPaciente(r: RecetaParaFhir): Json {
  const id = identificadorPaciente(r.paciente);
  return sinVacios({
    resourceType: "Patient",
    id: r.paciente.id,
    identifier: id ? [id] : undefined,
    name: [{ text: r.paciente.nombre }],
    birthDate: r.paciente.fechaNacimiento ?? undefined,
  });
}

function idProfesional(r: RecetaParaFhir): string {
  return r.profesional.id ?? `${r.id}-profesional`;
}

function recursoProfesional(r: RecetaParaFhir): Json {
  const identificadores: Json[] = [];
  if (r.profesional.registroSis) {
    identificadores.push({
      use: "official",
      type: {
        coding: [
          { system: SISTEMAS_FHIR.tipoIdentificador, code: "PRN", display: "Provider number" },
        ],
        text: "Registro Superintendencia de Salud",
      },
      system: SISTEMAS_FHIR.registroSis,
      value: r.profesional.registroSis.trim(),
    });
  }
  const general = r.profesional.registroProfesional?.trim();
  if (general && general !== r.profesional.registroSis?.trim()) {
    identificadores.push({
      type: {
        coding: [
          { system: SISTEMAS_FHIR.tipoIdentificador, code: "LN", display: "License number" },
        ],
        text: "Registro profesional",
      },
      system: SISTEMAS_FHIR.registroProfesional,
      value: general,
    });
  }
  return sinVacios({
    resourceType: "Practitioner",
    id: idProfesional(r),
    identifier: identificadores,
    name: [{ text: r.profesional.nombre }],
  });
}

/** "1 cápsula, vía oral, cada 8 horas, por 7 días" */
export function textoDeDosificacion(item: RecetaItemGuardado): string {
  const via = item.route ? VIA_EN_POSOLOGIA[item.route] : null;
  return [item.dose, via, item.frequency, item.duration]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(", ");
}

function dosificacion(item: RecetaItemGuardado): Json {
  const repeat = sinVacios({
    frequency: item.timing?.frequency,
    period: item.timing?.period,
    periodUnit: item.timing?.period_unit,
    boundsDuration:
      item.duration_value && item.duration_unit
        ? {
            value: item.duration_value,
            unit: TEXTO_DURACION[item.duration_unit],
            system: SISTEMAS_FHIR.ucum,
            code: UCUM_DURACION[item.duration_unit],
          }
        : undefined,
  });
  const via = item.route
    ? {
        coding: [{ system: SISTEMAS_FHIR.snomed, ...VIA_SNOMED[item.route] }],
        text: ETIQUETA_VIA[item.route],
      }
    : undefined;
  return sinVacios({
    sequence: 1,
    text: textoDeDosificacion(item),
    patientInstruction: item.instructions?.trim() || undefined,
    timing: Object.keys(repeat).length ? { repeat } : undefined,
    asNeededBoolean: item.as_needed ? true : undefined,
    route: via,
    doseAndRate: item.dose_quantity
      ? [{ doseQuantity: { value: item.dose_quantity.value, unit: item.dose_quantity.unit } }]
      : undefined,
  });
}

function solicitud(r: RecetaParaFhir, item: RecetaItemGuardado, i: number): Json {
  const anulada = r.voidedAt !== null;
  return sinVacios({
    resourceType: "MedicationRequest",
    id: `${r.id}-${i + 1}`,
    identifier: [{ system: SISTEMAS_FHIR.receta, value: `${r.folio}-${i + 1}` }],
    groupIdentifier: { system: SISTEMAS_FHIR.receta, value: r.folio },
    status: anulada ? "cancelled" : "active",
    statusReason: anulada && r.voidReason ? { text: r.voidReason } : undefined,
    intent: "order",
    medicationCodeableConcept: sinVacios({
      coding: item.atc
        ? [
            {
              system: SISTEMAS_FHIR.atc,
              code: item.atc,
              display: item.ingredient ?? item.medication,
            },
          ]
        : undefined,
      text: nombreConPresentacion(item),
    }),
    subject: { reference: `Patient/${r.paciente.id}`, display: r.paciente.nombre },
    authoredOn: r.issuedAt,
    requester: { reference: `Practitioner/${idProfesional(r)}`, display: r.profesional.nombre },
    note: r.indicacionesGenerales?.trim() ? [{ text: r.indicacionesGenerales.trim() }] : undefined,
    dosageInstruction: [dosificacion(item)],
  });
}

/**
 * La receta como `Bundle` FHIR R4 (`collection`): Patient, Practitioner y un
 * MedicationRequest por medicamento.
 */
export function recetaAFhir(r: RecetaParaFhir): Json {
  const entrada = (recurso: Json) => ({
    fullUrl: `${BASE}/${String(recurso.resourceType)}/${String(recurso.id)}`,
    resource: recurso,
  });
  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: r.issuedAt,
    identifier: { system: SISTEMAS_FHIR.receta, value: r.folio },
    entry: [
      entrada(recursoPaciente(r)),
      entrada(recursoProfesional(r)),
      ...r.items.map((item, i) => entrada(solicitud(r, item, i))),
    ],
  };
}
