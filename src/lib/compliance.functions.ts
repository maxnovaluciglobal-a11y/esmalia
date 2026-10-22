import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { LecturaDeFicha } from "@/lib/clinical/lecturas-ficha";

type SupabaseCtx = SupabaseClient<Database>;

interface AuditRow {
  id: string;
  note_id: string | null;
  patient_ref: string;
  action: string;
  detail: string | null;
  actor_id: string;
  created_at: string;
}

interface ReviewRow {
  id: string;
  note_id: string | null;
  patient_ref: string;
  action: string;
  comment: string | null;
  actor_id: string;
  reviewer_id: string | null;
  note_version: number | null;
  created_at: string;
}

/** Origen del evento dentro del expediente de compliance. */
export type ComplianceSource = "audit" | "review";

export interface ComplianceEvent {
  id: string;
  source: ComplianceSource;
  createdAt: string;
  patientRef: string;
  /** Ficha a la que apunta `patientRef`, si es el id de un paciente de la
   * clínica (UX-06: la vista ya no muestra uuids crudos). */
  patientId: string | null;
  patientName: string | null;
  noteId: string | null;
  noteTitle: string | null;
  noteVersion: number | null;
  action: string;
  detail: string | null;
  actorId: string;
  actorName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
}

const filtros = z.object({
  clinicId: z.string().uuid(),
  /** Fecha inicial inclusive (YYYY-MM-DD). */
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Fecha final inclusive (YYYY-MM-DD). */
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["all", "audit", "review"]).default("all"),
  patientRef: z.string().max(64).optional(),
  /** Máximo de eventos devueltos por origen. */
  limit: z.number().int().min(1).max(2000).default(1000),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esUuid(valor: string): boolean {
  return UUID.test(valor.trim());
}

export type ComplianceFilters = z.infer<typeof filtros>;

async function nombres(
  supabase: SupabaseCtx,
  ids: Array<string | null>,
): Promise<Map<string, string | null>> {
  const unicos = [...new Set(ids.filter(Boolean) as string[])];
  if (!unicos.length) return new Map();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unicos);
  return new Map(
    ((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
      (p) => [p.id, p.full_name ?? p.email],
    ),
  );
}

/**
 * Historial de auditoría y revisión de la clínica en un rango de fechas.
 * RLS limita el resultado a las clínicas donde el usuario es miembro.
 */
export const getComplianceLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => filtros.parse(input))
  .handler(
    async ({ data, context }): Promise<{ events: ComplianceEvent[]; truncated: boolean }> => {
      const { supabase } = context;
      const desde = new Date(`${data.desde}T00:00:00.000Z`).toISOString();
      const hasta = new Date(`${data.hasta}T23:59:59.999Z`).toISOString();

      const pedirAudit = data.source !== "review";
      const pedirReview = data.source !== "audit";

      const consultaAudit = async (): Promise<AuditRow[]> => {
        if (!pedirAudit) return [];
        let q = supabase
          .from("clinical_note_audit")
          .select("id, note_id, patient_ref, action, detail, actor_id, created_at")
          .eq("clinic_id", data.clinicId)
          .gte("created_at", desde)
          .lte("created_at", hasta)
          .order("created_at", { ascending: false })
          .limit(data.limit);
        if (data.patientRef) q = q.eq("patient_ref", data.patientRef);
        const { data: filas, error } = await q;
        if (error) throw new Error("No pudimos leer el registro de auditoría.");
        return filas ?? [];
      };

      const consultaReview = async (): Promise<ReviewRow[]> => {
        if (!pedirReview) return [];
        let q = supabase
          .from("clinical_note_reviews")
          .select(
            "id, note_id, patient_ref, action, comment, actor_id, reviewer_id, note_version, created_at",
          )
          .eq("clinic_id", data.clinicId)
          .gte("created_at", desde)
          .lte("created_at", hasta)
          .order("created_at", { ascending: false })
          .limit(data.limit);
        if (data.patientRef) q = q.eq("patient_ref", data.patientRef);
        const { data: filas, error } = await q;
        if (error) throw new Error("No pudimos leer el historial de revisión.");
        return filas ?? [];
      };

      const [auditRows, reviewRows] = await Promise.all([consultaAudit(), consultaReview()]);

      const noteIds = [
        ...new Set(
          [...auditRows, ...reviewRows]
            .map((r: { note_id: string | null }) => r.note_id)
            .filter(Boolean),
        ),
      ] as string[];
      const notasRes = noteIds.length
        ? await supabase.from("clinical_notes").select("id, title").in("id", noteIds)
        : { data: [] };
      const titulos = new Map(
        ((notasRes.data ?? []) as Array<{ id: string; title: string }>).map((n) => [n.id, n.title]),
      );

      // `patient_ref` es texto: en las notas nuevas es el id del paciente.
      // Se resuelve a nombre con la RLS del usuario; lo que no se encuentra
      // (ref vieja o ficha de otra clínica) queda sin nombre.
      const refsUuid = [
        ...new Set(
          [...auditRows, ...reviewRows].map((r) => r.patient_ref).filter((ref) => esUuid(ref)),
        ),
      ];
      const pacientesRes = refsUuid.length
        ? await supabase
            .from("patients")
            .select("id, full_name")
            .eq("clinic_id", data.clinicId)
            .in("id", refsUuid)
        : { data: [] as Array<{ id: string; full_name: string }> };
      const pacientes = new Map(
        ((pacientesRes.data ?? []) as Array<{ id: string; full_name: string }>).map((p) => [
          p.id,
          p.full_name,
        ]),
      );
      const paciente = (ref: string) => ({
        patientId: pacientes.has(ref) ? ref : null,
        patientName: pacientes.get(ref) ?? null,
      });

      const mapa = await nombres(supabase, [
        ...auditRows.map((r: { actor_id: string }) => r.actor_id),
        ...reviewRows.flatMap((r: { actor_id: string; reviewer_id: string | null }) => [
          r.actor_id,
          r.reviewer_id,
        ]),
      ]);

      const events: ComplianceEvent[] = [
        ...auditRows.map((r) => ({
          id: r.id,
          source: "audit" as const,
          createdAt: r.created_at,
          patientRef: r.patient_ref,
          ...paciente(r.patient_ref),
          noteId: r.note_id,
          noteTitle: r.note_id ? (titulos.get(r.note_id) ?? null) : null,
          noteVersion: null,
          action: r.action,
          detail: r.detail,
          actorId: r.actor_id,
          actorName: mapa.get(r.actor_id) ?? null,
          reviewerId: null,
          reviewerName: null,
        })),
        ...reviewRows.map((r) => ({
          id: r.id,
          source: "review" as const,
          createdAt: r.created_at,
          patientRef: r.patient_ref,
          ...paciente(r.patient_ref),
          noteId: r.note_id,
          noteTitle: r.note_id ? (titulos.get(r.note_id) ?? null) : null,
          noteVersion: r.note_version,
          action: r.action,
          detail: r.comment,
          actorId: r.actor_id,
          actorName: mapa.get(r.actor_id) ?? null,
          reviewerId: r.reviewer_id,
          reviewerName: r.reviewer_id ? (mapa.get(r.reviewer_id) ?? null) : null,
        })),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

      return {
        events,
        truncated: auditRows.length >= data.limit || reviewRows.length >= data.limit,
      };
    },
  );

const filtrosLecturas = z.object({
  clinicId: z.string().uuid(),
  /** Fecha inicial inclusive (YYYY-MM-DD). */
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Fecha final inclusive (YYYY-MM-DD). */
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  patientId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(2000).default(1000),
});

/**
 * Lecturas de fichas clínicas de la clínica (SEG-02), las más recientes
 * primero. La RLS de `clinical_access_log` solo deja leer a owner/admin: a
 * cualquier otro rol esto le devuelve una lista vacía.
 */
export const getLecturasDeFichas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => filtrosLecturas.parse(input))
  .handler(
    async ({ data, context }): Promise<{ lecturas: LecturaDeFicha[]; truncated: boolean }> => {
      const { supabase } = context;
      const desde = new Date(`${data.desde}T00:00:00.000Z`).toISOString();
      const hasta = new Date(`${data.hasta}T23:59:59.999Z`).toISOString();

      let q = supabase
        .from("clinical_access_log")
        .select("id, patient_id, actor_id, section, accessed_at")
        .eq("clinic_id", data.clinicId)
        .gte("accessed_at", desde)
        .lte("accessed_at", hasta)
        .order("accessed_at", { ascending: false })
        .limit(data.limit);
      if (data.patientId) q = q.eq("patient_id", data.patientId);
      const { data: filas, error } = await q;
      if (error) throw new Error("No pudimos leer el registro de lecturas de fichas.");

      const rows = filas ?? [];
      const patientIds = [...new Set(rows.map((r) => r.patient_id))];
      const [actores, pacientesRes] = await Promise.all([
        nombres(
          supabase,
          rows.map((r) => r.actor_id),
        ),
        patientIds.length
          ? supabase
              .from("patients")
              .select("id, full_name")
              .eq("clinic_id", data.clinicId)
              .in("id", patientIds)
          : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
      ]);
      const pacientes = new Map(
        ((pacientesRes.data ?? []) as Array<{ id: string; full_name: string }>).map((p) => [
          p.id,
          p.full_name,
        ]),
      );

      return {
        lecturas: rows.map((r) => ({
          id: r.id,
          accessedAt: r.accessed_at,
          patientId: r.patient_id,
          patientName: pacientes.get(r.patient_id) ?? null,
          actorId: r.actor_id,
          actorName: actores.get(r.actor_id) ?? null,
          section: r.section,
        })),
        truncated: rows.length >= data.limit,
      };
    },
  );
