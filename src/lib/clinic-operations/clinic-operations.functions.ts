import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";
import { LAB_ORDER_STATUSES, type Lab, type LabOrder, type Warehouse } from "@/lib/finance/finance";
import { throwIfTrialBlocksInformes } from "@/lib/finance/finance-reports.functions";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import {
  GUIAS_COLOR,
  MARGENES,
  MATERIALES,
  colorValido,
  detalleDesdeFila,
} from "@/lib/clinic-operations/lab-orden-detalle";

/**
 * Operación de clínica mediana (Tanda C): laboratorios, bodegas, estados de
 * cita configurables y fusión de fichas.
 */

// ─── LABORATORIOS ────────────────────────────────────────────────────────

const LAB_COLUMNS = "id, name, contact_name, contact_phone, contact_email, notes, is_active";

export const listLabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), incluirInactivos: z.boolean().default(false) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Lab[]> => {
    let query = context.supabase.from("labs").select(LAB_COLUMNS).eq("clinic_id", data.clinicId);
    if (!data.incluirInactivos) query = query.eq("is_active", true);
    const { data: rows, error } = await query.order("name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los laboratorios."));
    return (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      contactName: r.contact_name,
      contactPhone: r.contact_phone,
      contactEmail: r.contact_email,
      notes: r.notes,
      isActive: r.is_active,
    }));
  });

const LabFields = {
  name: z.string().trim().min(1, "El nombre del laboratorio es obligatorio."),
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  contactEmail: z.string().trim().max(160).nullish(),
  notes: z.string().trim().max(1000).nullish(),
};

export const createLab = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), ...LabFields }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: inserted, error } = await context.supabase
      .from("labs")
      .insert({
        clinic_id: data.clinicId,
        name: data.name,
        contact_name: data.contactName?.trim() || null,
        contact_phone: data.contactPhone?.trim() || null,
        contact_email: data.contactEmail?.trim() || null,
        notes: data.notes?.trim() || null,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505")
        throw new Error(`Ya existe un laboratorio llamado "${data.name}".`);
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar laboratorios.",
        ),
      );
    }
    return { id: inserted.id };
  });

const LAB_ORDER_COLUMNS =
  "id, lab_id, lab_name_snapshot, patient_id, treatment_item_id, professional_id, description, tooth_numbers, status, sent_on, due_on, received_on, cost_cents, currency, notes, catalog_item_id, catalog_name_snapshot, shade_guide, shade, material, margin_type";

export const listLabOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /** Sin `patientId` trae toda la clínica (la bandeja del taller). */
        patientId: z.string().uuid().nullish(),
        /** Vacío = todos los estados. */
        estado: z.enum(LAB_ORDER_STATUSES).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<LabOrder[]> => {
    const { supabase, userId } = context;

    // Task 11, fix round 1 (Important #2): esta función no tiene un chequeo
    // de rol que rechace — el chequeo de abajo (`puedeVerCostos`) solo decide
    // si se muestra el costo, cualquier miembro de la clínica puede llamarla.
    // Se le agrega solo la capa de trial, encima de lo que ya autorizaba.
    await throwIfTrialBlocksInformes(supabase, data.clinicId);

    // El costo es lo que la clínica le paga al laboratorio: mismo tipo de dato
    // que un gasto. La fila entera es operativa y la ve todo el equipo, pero
    // el número solo quien tiene `finance:view` (auditoría 04-sep).
    const { data: membresia } = await supabase
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", data.clinicId)
      .eq("user_id", userId)
      .maybeSingle();
    const puedeVerCostos = membresia?.role
      ? permissionsForRole(membresia.role as ClinicRole).includes("finance:view")
      : false;

    let query = supabase
      .from("lab_orders")
      .select(LAB_ORDER_COLUMNS)
      .eq("clinic_id", data.clinicId);
    if (data.patientId) query = query.eq("patient_id", data.patientId);
    if (data.estado) query = query.eq("status", data.estado);

    const { data: rows, error } = await query
      .order("sent_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las órdenes de laboratorio."));

    // Nombres de paciente en una segunda consulta y no con embed: el patrón
    // del repo evita `select('t(col)')` cuando los tipos generados no lo pillan.
    const ids = [...new Set((rows ?? []).map((r) => r.patient_id))];
    const nombres = new Map<string, string>();
    if (ids.length) {
      const { data: pacientes } = await supabase
        .from("patients")
        .select("id, full_name")
        .eq("clinic_id", data.clinicId)
        .in("id", ids);
      for (const p of pacientes ?? []) nombres.set(p.id, p.full_name);
    }

    return (rows ?? []).map((r) => ({
      id: r.id,
      labId: r.lab_id,
      labNameSnapshot: r.lab_name_snapshot,
      patientId: r.patient_id,
      patientName: nombres.get(r.patient_id) ?? "—",
      treatmentItemId: r.treatment_item_id,
      professionalId: r.professional_id,
      description: r.description,
      toothNumbers: r.tooth_numbers,
      status: r.status as LabOrder["status"],
      sentOn: r.sent_on,
      dueOn: r.due_on,
      receivedOn: r.received_on,
      costCents: puedeVerCostos ? r.cost_cents : null,
      currency: r.currency,
      notes: r.notes,
      catalogItemId: r.catalog_item_id,
      catalogNameSnapshot: r.catalog_name_snapshot,
      ...detalleDesdeFila(r),
    }));
  });

export const createLabOrder = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        labId: z.string().uuid().nullish(),
        treatmentItemId: z.string().uuid().nullish(),
        professionalId: z.string().uuid().nullish(),
        description: z.string().trim().min(1, "Describe qué se manda al laboratorio.").max(300),
        toothNumbers: z.array(z.number().int()).max(32).nullish(),
        sentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dueOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        costCents: z.number().int().min(0).nullish(),
        // Sin `currency`: la fija el trigger `moneda_desde_la_clinica` desde
        // `clinics.currency`. La moneda no la decide el cliente.
        notes: z.string().trim().max(1000).nullish(),
        // Ola 9 · LAB-03 a LAB-07.
        catalogItemId: z.string().uuid().nullish(),
        shadeGuide: z.enum(GUIAS_COLOR).nullish(),
        shade: z.string().trim().max(8).nullish(),
        material: z.enum(MATERIALES).nullish(),
        marginType: z.enum(MARGENES).nullish(),
      })
      .refine((d) => colorValido(d.shadeGuide ?? null, d.shade || null), {
        message: "Ese color no existe en la guía elegida.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase } = context;

    // Snapshot del nombre del laboratorio (regla 10): si después lo dan de
    // baja o lo renombran, la orden vieja sigue diciendo a dónde fue.
    let labName: string | null = null;
    if (data.labId) {
      const { data: lab } = await supabase
        .from("labs")
        .select("name")
        .eq("id", data.labId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      labName = lab?.name ?? null;
    }

    // LAB-07: el trabajo del catálogo tiene que ser de ese laboratorio y de
    // esta clínica. Su nombre queda como snapshot y, si el cliente no mandó
    // costo (quien no ve finanzas no lo recibe), lo completa el servidor.
    let catalogo: { name: string; cost_cents: number | null } | null = null;
    if (data.catalogItemId) {
      const { data: item } = await supabase
        .from("lab_catalog_items")
        .select("name, cost_cents, lab_id")
        .eq("id", data.catalogItemId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      if (!item || item.lab_id !== data.labId) {
        throw new Error("Ese trabajo no está en el catálogo del laboratorio elegido.");
      }
      catalogo = item;
    }

    const { data: inserted, error } = await supabase
      .from("lab_orders")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        lab_id: data.labId ?? null,
        lab_name_snapshot: labName,
        treatment_item_id: data.treatmentItemId ?? null,
        professional_id: data.professionalId ?? null,
        description: data.description,
        tooth_numbers: data.toothNumbers ?? null,
        sent_on: data.sentOn,
        due_on: data.dueOn ?? null,
        cost_cents: data.costCents ?? catalogo?.cost_cents ?? null,
        notes: data.notes?.trim() || null,
        catalog_item_id: data.catalogItemId ?? null,
        catalog_name_snapshot: catalogo?.name ?? null,
        shade_guide: data.shadeGuide ?? null,
        shade: data.shadeGuide ? data.shade || null : null,
        material: data.material ?? null,
        margin_type: data.marginType ?? null,
      })
      .select("id")
      .single();
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda registrar órdenes.",
        ),
      );
    return { id: inserted.id };
  });

export const setLabOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        orderId: z.string().uuid(),
        status: z.enum(LAB_ORDER_STATUSES),
        /** Se sella al marcar 'recibido'; el resto de estados no lo tocan. */
        receivedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("lab_orders")
      .update({
        status: data.status,
        // Volver a un estado anterior limpia la fecha de recepción: dejarla
        // haría que una orden "en proceso" muestre cuándo llegó.
        received_on: data.status === "recibido" ? (data.receivedOn ?? null) : null,
      })
      .eq("id", data.orderId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar órdenes.",
        ),
      );
    return { ok: true };
  });

// ─── BODEGAS ─────────────────────────────────────────────────────────────

export const listWarehouses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Warehouse[]> => {
    const { data: rows, error } = await context.supabase
      .from("warehouses")
      .select("id, name, branch_id, is_active, position")
      .eq("clinic_id", data.clinicId)
      .eq("is_active", true)
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las bodegas."));
    return (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      branchId: r.branch_id,
      isActive: r.is_active,
      position: r.position,
    }));
  });

/** Saldo de cada ítem por bodega, para el selector del inventario. */
export const listStockByWarehouse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), warehouseId: z.string().uuid().nullish() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Record<string, number>> => {
    let query = context.supabase
      .from("inventory_stock")
      .select("item_id, warehouse_id, current_stock")
      .eq("clinic_id", data.clinicId);
    if (data.warehouseId) query = query.eq("warehouse_id", data.warehouseId);

    const { data: rows, error } = await query;
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el stock por bodega."));

    // Sin bodega elegida se agrega el total de la clínica, que coincide con
    // `inventory_items.current_stock` — se recalcula igual para que un
    // desajuste entre las dos vistas sea visible en vez de quedar oculto.
    const out: Record<string, number> = {};
    for (const r of rows ?? []) {
      out[r.item_id] = (out[r.item_id] ?? 0) + Number(r.current_stock);
    }
    return out;
  });

// ─── ESTADOS DE CITA CONFIGURABLES ───────────────────────────────────────

export interface AppointmentStatusOption {
  id: string;
  label: string;
  /** A cuál de los seis canónicos equivale. */
  canonical: string;
  color: string;
  isActive: boolean;
  position: number;
}

export const listAppointmentStatuses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), incluirInactivos: z.boolean().default(false) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<AppointmentStatusOption[]> => {
    let query = context.supabase
      .from("appointment_statuses")
      .select("id, label, canonical, color, is_active, position")
      .eq("clinic_id", data.clinicId);
    if (!data.incluirInactivos) query = query.eq("is_active", true);

    const { data: rows, error } = await query
      .order("position", { ascending: true })
      .order("label", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los estados de cita."));
    return (rows ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      canonical: r.canonical,
      color: r.color,
      isActive: r.is_active,
      position: r.position,
    }));
  });

export const upsertAppointmentStatus = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        statusId: z.string().uuid().nullish(),
        label: z.string().trim().min(1, "La etiqueta es obligatoria.").max(60),
        canonical: z.enum([
          "tentativa",
          "confirmada",
          "en-sala",
          "ausente",
          "finalizada",
          "cancelada",
        ]),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido."),
        position: z.number().int().min(0).max(999).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const fila = {
      label: data.label,
      canonical: data.canonical,
      color: data.color,
      position: data.position,
    };
    const { error } = data.statusId
      ? await context.supabase
          .from("appointment_statuses")
          .update(fila)
          .eq("id", data.statusId)
          .eq("clinic_id", data.clinicId)
      : await context.supabase
          .from("appointment_statuses")
          .insert({ clinic_id: data.clinicId, ...fila });
    if (error) {
      if (error.code === "23505") throw new Error(`Ya existe un estado llamado "${data.label}".`);
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar estados de cita.",
        ),
      );
    }
    return { ok: true };
  });

export const setAppointmentStatusActive = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        statusId: z.string().uuid(),
        isActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("appointment_statuses")
      .update({ is_active: data.isActive })
      .eq("id", data.statusId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar estados de cita.",
        ),
      );
    return { ok: true };
  });

// ─── FUSIÓN DE FICHAS ────────────────────────────────────────────────────

/**
 * Candidatos a duplicado dentro de la clínica.
 *
 * Agrupa por documento de identidad primero (es el criterio duro) y por
 * nombre normalizado después. Deliberadamente NO fusiona nada solo: dos
 * personas pueden llamarse igual, y unir dos historias clínicas por parecido
 * de nombre sería un error irreversible en la práctica. Esto solo propone.
 */
export const listDuplicateCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      {
        motivo: "documento" | "nombre";
        clave: string;
        pacientes: { id: string; nombre: string; documento: string | null }[];
      }[]
    > => {
      const { data: rows, error } = await context.supabase
        .from("patients")
        .select("id, full_name, document_id")
        .eq("clinic_id", data.clinicId)
        .is("merged_into", null);
      if (error) throw new Error(mensajeDb(error, "No pudimos revisar las fichas duplicadas."));

      const normalizar = (s: string) =>
        s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim();

      const porDocumento = new Map<string, typeof rows>();
      const porNombre = new Map<string, typeof rows>();

      for (const p of rows ?? []) {
        const doc = p.document_id?.replace(/[^0-9kK]/g, "").toLowerCase();
        if (doc) porDocumento.set(doc, [...(porDocumento.get(doc) ?? []), p]);
        const nom = normalizar(p.full_name);
        if (nom) porNombre.set(nom, [...(porNombre.get(nom) ?? []), p]);
      }

      const grupos: {
        motivo: "documento" | "nombre";
        clave: string;
        pacientes: { id: string; nombre: string; documento: string | null }[];
      }[] = [];
      const yaAgrupados = new Set<string>();

      const empujar = (motivo: "documento" | "nombre", mapa: Map<string, typeof rows>) => {
        for (const [clave, lista] of mapa) {
          if (lista.length < 2) continue;
          // Un paciente ya señalado por documento no se repite por nombre: el
          // documento es criterio más fuerte y mostrarlo dos veces confunde.
          if (lista.every((p) => yaAgrupados.has(p.id))) continue;
          for (const p of lista) yaAgrupados.add(p.id);
          grupos.push({
            motivo,
            clave,
            pacientes: lista.map((p) => ({
              id: p.id,
              nombre: p.full_name,
              documento: p.document_id,
            })),
          });
        }
      };

      empujar("documento", porDocumento);
      empujar("nombre", porNombre);
      return grupos;
    },
  );

/**
 * Fusiona dos fichas. La validación de permisos y la reasignación de las tablas
 * (citas, pagos, cuentas, presupuestos, empresa con convenio, membresía y sus
 * cuotas, inscripciones a citas grupales…) viven en la RPC `merge_patients`, que corre todo en una transacción:
 * si fallara a mitad de camino, el paciente quedaría con las citas movidas y
 * las notas no, que es peor que no haber fusionado.
 */
export const mergePatients = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /** La que se absorbe. Queda marcada, no borrada. */
        sourceId: z.string().uuid(),
        /** La que sobrevive. */
        targetId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("merge_patients", {
      p_clinic_id: data.clinicId,
      p_source_id: data.sourceId,
      p_target_id: data.targetId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
