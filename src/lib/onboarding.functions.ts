import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { clinicSetupSchema, type ClinicSummary } from "@/lib/onboarding-types";

export const getMyClinics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClinicSummary[]> => {
    const { data, error } = await context.supabase
      .from("clinic_members")
      .select("role, clinics(id, name, onboarding_completed)")
      .eq("user_id", context.userId);

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar tus clínicas."));

    return (data ?? [])
      .filter((row) => row.clinics)
      .map((row) => ({
        id: row.clinics!.id,
        name: row.clinics!.name,
        role: row.role,
        onboardingCompleted: row.clinics!.onboarding_completed,
      }));
  });

export const completeClinicSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => clinicSetupSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: clinic, error: clinicError } = await supabase
      .from("clinics")
      .insert({
        name: data.clinic.name,
        legal_name: data.clinic.legalName || null,
        tax_id: data.clinic.taxId || null,
        country: data.clinic.country,
        currency: data.clinic.currency,
        timezone: data.clinic.timezone,
        created_by: userId,
      })
      .select("id")
      .single();

    if (clinicError || !clinic)
      throw new Error(mensajeDb(clinicError, "No pudimos crear la clínica."));
    const clinicId = clinic.id;

    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .insert({
        clinic_id: clinicId,
        name: data.branch.name,
        address: data.branch.address || null,
        city: data.branch.city || null,
        phone: data.branch.phone || null,
        timezone: data.clinic.timezone,
        opens_at: data.branch.opensAt,
        closes_at: data.branch.closesAt,
      })
      .select("id")
      .single();

    if (branchError || !branch)
      throw new Error(mensajeDb(branchError, "No pudimos crear la sucursal."));

    const { error: opError } = await supabase.from("operatories").insert(
      data.branch.operatories.map((name) => ({
        clinic_id: clinicId,
        branch_id: branch.id,
        name,
      })),
    );
    if (opError)
      throw new Error(mensajeDb(opError, "No pudimos guardar los consultorios de la sucursal."));

    const { data: specialties, error: specError } = await supabase
      .from("specialties")
      .insert(
        data.specialties.map((s) => ({
          clinic_id: clinicId,
          name: s.name,
          color: s.color,
          default_duration_min: s.defaultDurationMin,
        })),
      )
      .select("id, name");
    if (specError) throw new Error(mensajeDb(specError, "No pudimos guardar las especialidades."));

    const specialtyByName = new Map((specialties ?? []).map((s) => [s.name, s.id]));

    const { error: proError } = await supabase.from("professionals").insert(
      data.professionals.map((p) => ({
        clinic_id: clinicId,
        branch_id: branch.id,
        specialty_id: p.specialtyName ? (specialtyByName.get(p.specialtyName) ?? null) : null,
        full_name: p.fullName,
        email: p.email || null,
        license_number: p.licenseNumber || null,
        color: p.color,
      })),
    );
    if (proError) throw new Error(mensajeDb(proError, "No pudimos guardar los profesionales."));

    const { error: doneError } = await supabase
      .from("clinics")
      .update({ onboarding_completed: true })
      .eq("id", clinicId);
    if (doneError)
      throw new Error(mensajeDb(doneError, "No pudimos finalizar la configuración de la clínica."));

    // Embudo (tracking plan, docs/MEDICION.md): la clínica quedó configurada.
    // Sin ids ni nombres; nunca lanza.
    try {
      const { registrarEventoServidor, datosDelUsuario, conInterno } =
        await import("@/lib/marketing/eventos-servidor.server");
      const usuario = await datosDelUsuario(userId);
      await registrarEventoServidor(
        "onboarding_completado",
        conInterno(
          {
            pais: data.clinic.country,
            profesionales: String(data.professionals.length),
            especialidades: String(data.specialties.length),
          },
          usuario.interno,
        ),
      );
    } catch (err) {
      console.warn("[ev] onboarding_completado", err instanceof Error ? err.message : err);
    }

    // Correo de bienvenida (src/lib/email). Nunca lanza y espera como mucho
    // unos segundos: en serverless una promesa suelta puede congelarse al
    // responder. Con LIFECYCLE_EMAILS_ENABLED apagado vuelve al instante.
    try {
      const { enviarBienvenida, conTope } = await import("@/lib/email/ciclo-de-vida.server");
      await conTope(enviarBienvenida({ clinicId, userId }));
    } catch (err) {
      console.warn("[lifecycle-email] bienvenida", err instanceof Error ? err.message : err);
    }

    // Aviso interno al equipo de Esmalia (CS-10): una clínica que se registra
    // sola no le llegaba a nadie. Nunca lanza; mismo tope que la bienvenida.
    try {
      const { notificarAltaDeClinica } = await import("@/lib/marketing/notify-alta.server");
      const { conTope } = await import("@/lib/email/ciclo-de-vida.server");
      await conTope(
        notificarAltaDeClinica({
          userId,
          clinicName: data.clinic.name,
          countryCode: data.clinic.country,
          profesionales: data.professionals.length,
        }),
      );
    } catch (err) {
      console.warn("[alta] aviso interno", err instanceof Error ? err.message : err);
    }

    return { clinicId, branchId: branch.id };
  });
