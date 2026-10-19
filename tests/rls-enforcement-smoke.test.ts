import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

/**
 * Blind spot detectado por el contraauditor de arquitectura (2026-08-21,
 * architecture-5): TODOS los tests de `tests/*.test.ts` que validan RLS
 * (`multi-clinic-isolation.test.ts`, `payments-finance-rls.test.ts`,
 * `clinical-notes-rls.test.ts`) corren sobre una conexión `pg.Client` cuyo
 * rol tiene `BYPASSRLS` (confirmado con `SELECT rolbypassrls FROM pg_roles`
 * en el comentario de `payments-finance-rls.test.ts`). Esos tests validan
 * que las funciones `is_clinic_member`/`has_clinic_role` devuelven el valor
 * correcto — es decir, que la EXPRESIÓN de la policy es correcta — pero
 * ninguno prueba que la policy esté efectivamente ENFORCEADA en runtime.
 * Si alguien corre por error `ALTER TABLE patients DISABLE ROW LEVEL
 * SECURITY` o borra una policy, ese cambio pasaría desapercibido: todos los
 * tests existentes seguirían en verde porque bypasean la policy de todas
 * formas.
 *
 * Este archivo NO repite el test de aislamiento funcional (eso ya lo cubre
 * `multi-clinic-isolation.test.ts`). Agrega la dimensión que falta: usa
 * `@supabase/supabase-js` con la SUPABASE_PUBLISHABLE_KEY (anon) + login
 * real de dos usuarios de prueba efímeros — el mismo camino que usa la app
 * en producción (PostgREST), sin ninguna conexión con permisos elevados de
 * por medio — y confirma que un usuario autenticado de la clínica A no
 * puede leer filas de la clínica B en las 4 tablas más sensibles
 * (`clinical_notes`, `patients`, `payments`, `odontogram_marks`), aunque
 * conozca los IDs exactos. Si RLS está deshabilitada o la policy fue
 * borrada, esta prueba es la que se pone roja — las demás no.
 *
 * Setup/cleanup usa el cliente con SUPABASE_SERVICE_ROLE_KEY (bypassa RLS
 * a propósito, solo para sembrar/limpiar datos, igual que hace el resto de
 * la suite con la conexión postgres directa). No hay transacción que
 * revierta sola (PostgREST no soporta BEGIN/ROLLBACK entre requests), así
 * que el cleanup en `afterAll` es explícito.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Este test necesita SUPABASE_URL, ` +
        `SUPABASE_PUBLISHABLE_KEY y SUPABASE_SERVICE_ROLE_KEY (mismos nombres ` +
        `que .env) exportados en el shell antes de correr \`npm run test\` — ` +
        `no se leen automáticamente desde .env.`,
    );
  }
  return value;
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const ANON_KEY = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

interface ClinicaSeed {
  clinicId: string;
  userId: string;
  email: string;
  password: string;
  patientId: string;
  noteId: string;
  paymentId: string;
  markId: string;
  client: SupabaseClient;
  // arq-2: extensión con las 7 tablas nuevas de las migraciones del 26-ago-2026.
  professionalId: string;
  scheduleId: string;
  medicalHistoryId: string;
  emailTemplateId: string;
  documentId: string;
  consentTemplateId: string;
  consentId: string;
  movementItemId: string;
  movementId: string;
  commissionClinicId: string; // commission_rules tiene PK compuesta (clinic_id, professional_id), no id propio
  quoteId: string;
}

describe("RLS enforcement smoke test (usuario real, sin bypass)", () => {
  let admin: SupabaseClient;
  let clinicaA: ClinicaSeed;
  let clinicaB: ClinicaSeed;

  async function sembrarClinica(nombre: string, pacienteNombre: string): Promise<ClinicaSeed> {
    const email = `rls-smoke-${randomUUID()}@esmalia-test.invalid`;
    const password = `Sm0ke-${randomUUID()}`;

    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userErr || !userRes.user) {
      throw new Error(`No se pudo crear usuario de prueba: ${userErr?.message}`);
    }
    const userId = userRes.user.id;

    const { data: clinic, error: clinicErr } = await admin
      .from("clinics")
      .insert({ name: nombre, created_by: userId })
      .select("id")
      .single();
    if (clinicErr || !clinic) {
      throw new Error(`No se pudo crear clínica de prueba: ${clinicErr?.message}`);
    }
    const clinicId = clinic.id as string;

    // El trigger on_clinic_created ya agrega al owner a clinic_members;
    // ON CONFLICT DO NOTHING por si acaso, igual que sembrarEscenario().
    await admin
      .from("clinic_members")
      .upsert(
        { clinic_id: clinicId, user_id: userId, role: "owner" },
        { onConflict: "clinic_id,user_id" },
      );

    const { data: patient, error: patientErr } = await admin
      .from("patients")
      .insert({ clinic_id: clinicId, full_name: pacienteNombre, created_by: userId })
      .select("id")
      .single();
    if (patientErr || !patient) {
      throw new Error(`No se pudo crear paciente de prueba: ${patientErr?.message}`);
    }
    const patientId = patient.id as string;

    const { data: note, error: noteErr } = await admin
      .from("clinical_notes")
      .insert({
        clinic_id: clinicId,
        patient_ref: patientId,
        title: "Nota smoke test",
        content: "Contenido confidencial de prueba",
        created_by: userId,
      })
      .select("id")
      .single();
    if (noteErr || !note) {
      throw new Error(`No se pudo crear nota clínica de prueba: ${noteErr?.message}`);
    }

    const { data: payment, error: paymentErr } = await admin
      .from("payments")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        amount_cents: 12345,
        created_by: userId,
      })
      .select("id")
      .single();
    if (paymentErr || !payment) {
      throw new Error(`No se pudo crear pago de prueba: ${paymentErr?.message}`);
    }

    const { data: mark, error: markErr } = await admin
      .from("odontogram_marks")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        tooth_number: 11,
        surface: "vestibular",
        condition: "caries",
        recorded_by: userId,
      })
      .select("id")
      .single();
    if (markErr || !mark) {
      throw new Error(`No se pudo crear marca de odontograma de prueba: ${markErr?.message}`);
    }

    // --- arq-2: seed de las 7 tablas nuevas de las migraciones del 26-ago-2026 ---
    // Cada seed es independiente y no fatal: si una tabla todavía no fue
    // aplicada al Supabase real (migración pendiente), esto lo deja en "" y
    // el/los it() correspondientes van a fallar con un mensaje explícito —
    // es información real (falta aplicar la migración), no hay que
    // esconderla ni saltearla en silencio.
    async function seedOptional<T>(
      label: string,
      fn: () => Promise<{ data: T | null; error: { message: string } | null }>,
    ): Promise<T | null> {
      try {
        const { data, error } = await fn();
        if (error || !data) {
          console.warn(
            `[rls-enforcement-smoke] seed opcional "${label}" falló (¿migración sin aplicar?): ${error?.message}`,
          );
          return null;
        }
        return data;
      } catch (e) {
        console.warn(
          `[rls-enforcement-smoke] seed opcional "${label}" lanzó excepción: ${(e as Error).message}`,
        );
        return null;
      }
    }

    const professional = await seedOptional("professionals", () =>
      admin
        .from("professionals")
        .insert({ clinic_id: clinicId, full_name: `Profesional Smoke ${nombre}` })
        .select("id")
        .single(),
    );
    const professionalId = (professional as { id: string } | null)?.id ?? "";

    const schedule = professionalId
      ? await seedOptional("professional_schedules", () =>
          admin
            .from("professional_schedules")
            .insert({
              clinic_id: clinicId,
              professional_id: professionalId,
              day_of_week: 1,
              start_time: "09:00",
              end_time: "18:00",
            })
            .select("id")
            .single(),
        )
      : null;
    const scheduleId = (schedule as { id: string } | null)?.id ?? "";

    const medicalHistory = await seedOptional("patient_medical_history", () =>
      admin
        .from("patient_medical_history")
        .insert({
          clinic_id: clinicId,
          patient_id: patientId,
          allergies: ["penicilina"],
          notes: "Anamnesis confidencial de prueba",
          updated_by: userId,
        })
        .select("id")
        .single(),
    );
    const medicalHistoryId = (medicalHistory as { id: string } | null)?.id ?? "";

    const emailTemplate = await seedOptional("message_templates (channel=email)", () =>
      admin
        .from("message_templates")
        .insert({
          clinic_id: clinicId,
          kind: "custom",
          name: `Template email smoke ${randomUUID()}`,
          channel: "email",
          subject: "Asunto confidencial de prueba",
          body: "<p>Cuerpo confidencial de prueba</p>",
          created_by: userId,
        })
        .select("id")
        .single(),
    );
    const emailTemplateId = (emailTemplate as { id: string } | null)?.id ?? "";

    const document = await seedOptional("patient_documents", () =>
      admin
        .from("patient_documents")
        .insert({
          clinic_id: clinicId,
          patient_id: patientId,
          kind: "other",
          storage_path: `${clinicId}/${patientId}/smoke-test.pdf`,
          filename: "smoke-test.pdf",
          mime_type: "application/pdf",
          size_bytes: 1,
          uploaded_by: userId,
        })
        .select("id")
        .single(),
    );
    const documentId = (document as { id: string } | null)?.id ?? "";

    const consentTemplate = await seedOptional("consent_templates", () =>
      admin
        .from("consent_templates")
        .insert({
          clinic_id: clinicId,
          title: "Consentimiento smoke test",
          body: "Texto confidencial de prueba",
          created_by: userId,
        })
        .select("id")
        .single(),
    );
    const consentTemplateId = (consentTemplate as { id: string } | null)?.id ?? "";

    const consent = await seedOptional("patient_consents", () =>
      admin
        .from("patient_consents")
        .insert({
          clinic_id: clinicId,
          patient_id: patientId,
          template_id: consentTemplateId || null,
          title_snapshot: "Consentimiento smoke test",
          // Obligatorios desde 20261019190000 (CLI-12): procedimiento e informante.
          procedure_snapshot: "Procedimiento smoke test",
          informed_by_professional_id: professionalId || null,
          body_snapshot: "Texto confidencial de prueba firmado",
          signature_storage_path: `${clinicId}/${patientId}/firma-smoke.png`,
          signed_by_name: pacienteNombre,
          recorded_by: userId,
        })
        .select("id")
        .single(),
    );
    const consentId = (consent as { id: string } | null)?.id ?? "";

    const movementItem = await seedOptional("inventory_items", () =>
      admin
        .from("inventory_items")
        .insert({
          clinic_id: clinicId,
          name: "Insumo smoke test",
          unit: "unidad",
          created_by: userId,
        })
        .select("id")
        .single(),
    );
    const movementItemId = (movementItem as { id: string } | null)?.id ?? "";

    const movement = movementItemId
      ? await seedOptional("inventory_movements (lot_number/expiration_date)", () =>
          admin
            .from("inventory_movements")
            .insert({
              clinic_id: clinicId,
              item_id: movementItemId,
              kind: "entrada",
              quantity: 1,
              lot_number: "LOTE-SMOKE",
              expiration_date: "2030-01-01",
              recorded_by: userId,
            })
            .select("id")
            .single(),
        )
      : null;
    const movementId = (movement as { id: string } | null)?.id ?? "";

    const commissionRule = professionalId
      ? await seedOptional("commission_rules", () =>
          admin
            .from("commission_rules")
            .insert({
              clinic_id: clinicId,
              professional_id: professionalId,
              kind: "percent",
              percent_bps: 1000,
              updated_by: userId,
            })
            .select("clinic_id")
            .single(),
        )
      : null;
    const commissionClinicId = (commissionRule as { clinic_id: string } | null)?.clinic_id ?? "";

    const quote = await seedOptional("quotes (accepted_signature_path)", () =>
      admin
        .from("quotes")
        .insert({
          clinic_id: clinicId,
          patient_id: patientId,
          number: `SMOKE-${randomUUID().slice(0, 8)}`,
          accepted_signature_path: `${clinicId}/${patientId}/firma-presupuesto-smoke.png`,
          created_by: userId,
        })
        .select("id")
        .single(),
    );
    const quoteId = (quote as { id: string } | null)?.id ?? "";

    const client = createClient(SUPABASE_URL, ANON_KEY);
    const { error: loginErr } = await client.auth.signInWithPassword({ email, password });
    if (loginErr) {
      throw new Error(`No se pudo loguear al usuario de prueba: ${loginErr.message}`);
    }

    return {
      clinicId,
      userId,
      email,
      password,
      patientId,
      noteId: note.id as string,
      paymentId: payment.id as string,
      markId: mark.id as string,
      client,
      professionalId,
      scheduleId,
      medicalHistoryId,
      emailTemplateId,
      documentId,
      consentTemplateId,
      consentId,
      movementItemId,
      movementId,
      commissionClinicId,
      quoteId,
    };
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    clinicaA = await sembrarClinica("Clínica RLS Smoke A", "Paciente Smoke A");
    clinicaB = await sembrarClinica("Clínica RLS Smoke B", "Paciente Smoke B");
  }, 60_000);

  afterAll(async () => {
    // El ON DELETE CASCADE de clinics se lleva patients/clinical_notes/
    // payments/odontogram_marks/clinic_members de cada clínica de prueba, y
    // también (arq-2) professionals/professional_schedules/
    // patient_medical_history/message_templates/patient_documents/
    // consent_templates/patient_consents/inventory_items/
    // inventory_movements/commission_rules/quotes — todas referencian
    // clinic_id con ON DELETE CASCADE (confirmado leyendo cada migración en
    // supabase/migrations/20260826*.sql y 20260812210000_*.sql). No se
    // suben archivos reales al bucket `clinical-documents`: los
    // storage_path/signature_storage_path sembrados son strings de prueba
    // sin objeto real detrás, así que no hay nada que limpiar en Storage.
    for (const clinicId of [clinicaA?.clinicId, clinicaB?.clinicId].filter(Boolean)) {
      await admin.from("clinics").delete().eq("id", clinicId);
    }
    for (const userId of [clinicaA?.userId, clinicaB?.userId].filter(Boolean)) {
      await admin.auth.admin.deleteUser(userId);
    }

    // Verificación explícita de que el cascade realmente barrió todo lo
    // sembrado (no confiar a ciegas en el ON DELETE CASCADE): si alguna
    // fila sobrevivió, esto tira la lista para que quede en el output del
    // test run en vez de quedar silenciosamente huérfana en prod.
    const clinicIds = [clinicaA?.clinicId, clinicaB?.clinicId].filter(Boolean) as string[];
    if (clinicIds.length > 0) {
      const tablesToVerify = [
        "professionals",
        "professional_schedules",
        "patient_medical_history",
        "patient_documents",
        "consent_templates",
        "patient_consents",
        "inventory_items",
        "inventory_movements",
        "commission_rules",
        "quotes",
        "message_templates",
      ];
      const leftovers: string[] = [];
      for (const table of tablesToVerify) {
        const { count, error } = await admin
          .from(table)
          .select("*", { count: "exact", head: true })
          .in("clinic_id", clinicIds);
        if (error) continue; // tabla inexistente (migración no aplicada) — nada que verificar
        if (count && count > 0) {
          leftovers.push(`${table}: ${count} fila(s) restante(s)`);
        }
      }
      if (leftovers.length > 0) {
        throw new Error(
          `Cleanup incompleto — quedaron filas de las clínicas de prueba tras el cascade: ${leftovers.join(", ")}`,
        );
      }
    }
  }, 60_000);

  it("sanity: el usuario de la clínica A SÍ puede leer sus propios datos por la API real", async () => {
    const { data, error } = await clinicaA.client
      .from("patients")
      .select("id")
      .eq("id", clinicaA.patientId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("un usuario autenticado de la clínica A no puede leer patients de la clínica B por ID", async () => {
    const { data, error } = await clinicaA.client
      .from("patients")
      .select("id")
      .eq("id", clinicaB.patientId);
    // RLS filtra silenciosamente (0 filas), no un error explícito —
    // PostgREST no distingue "no existe" de "existe pero no autorizado".
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer clinical_notes de la clínica B por ID", async () => {
    const { data, error } = await clinicaA.client
      .from("clinical_notes")
      .select("id, content")
      .eq("id", clinicaB.noteId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer payments de la clínica B por ID", async () => {
    const { data, error } = await clinicaA.client
      .from("payments")
      .select("id, amount_cents")
      .eq("id", clinicaB.paymentId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer odontogram_marks de la clínica B por ID", async () => {
    const { data, error } = await clinicaA.client
      .from("odontogram_marks")
      .select("id, condition")
      .eq("id", clinicaB.markId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un SELECT sin filtro por clinic_id tampoco filtra la clínica B (RLS, no la app, hace el trabajo)", async () => {
    // Simula el peor caso: un query real que se olvidó el .eq("clinic_id", x).
    // Si RLS estuviera deshabilitada esto devolvería filas de ambas clínicas.
    const { data, error } = await clinicaA.client
      .from("patients")
      .select("id, clinic_id")
      .in("id", [clinicaA.patientId, clinicaB.patientId]);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(clinicaA.patientId);
  });

  it("simétrico: el usuario de la clínica B tampoco puede leer datos de la clínica A", async () => {
    const [patients, notes, payments, marks] = await Promise.all([
      clinicaB.client.from("patients").select("id").eq("id", clinicaA.patientId),
      clinicaB.client.from("clinical_notes").select("id").eq("id", clinicaA.noteId),
      clinicaB.client.from("payments").select("id").eq("id", clinicaA.paymentId),
      clinicaB.client.from("odontogram_marks").select("id").eq("id", clinicaA.markId),
    ]);
    for (const res of [patients, notes, payments, marks]) {
      expect(res.error).toBeNull();
      expect(res.data).toEqual([]);
    }
  });

  // --- arq-2: extensión a las 7 tablas nuevas de las migraciones del
  // 26-ago-2026. Si el seed de alguna falló porque la migración todavía no
  // se aplicó al Supabase real, el id sembrado queda "" y el it()
  // correspondiente falla acá con un mensaje explícito — es la señal real
  // de que falta el paso 2 de la migración (ver CLAUDE.md regla #5), no se
  // debe esconder ni saltear en silencio.

  it("un usuario autenticado de la clínica A no puede leer professional_schedules de la clínica B por ID", async () => {
    if (!clinicaB.scheduleId) {
      throw new Error(
        "Seed de professional_schedules falló — probablemente la migración 20260826170000 no está aplicada al Supabase real.",
      );
    }
    const { data, error } = await clinicaA.client
      .from("professional_schedules")
      .select("id")
      .eq("id", clinicaB.scheduleId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer patient_medical_history de la clínica B por ID", async () => {
    if (!clinicaB.medicalHistoryId) {
      throw new Error(
        "Seed de patient_medical_history falló — probablemente la migración 20260826180000 no está aplicada al Supabase real.",
      );
    }
    const { data, error } = await clinicaA.client
      .from("patient_medical_history")
      .select("id, allergies")
      .eq("id", clinicaB.medicalHistoryId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer message_templates de canal email de la clínica B por ID", async () => {
    if (!clinicaB.emailTemplateId) {
      throw new Error(
        "Seed de message_templates (channel=email) falló — probablemente la migración 20260826190000 no está aplicada al Supabase real.",
      );
    }
    const { data, error } = await clinicaA.client
      .from("message_templates")
      .select("id, subject, body")
      .eq("id", clinicaB.emailTemplateId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer patient_documents de la clínica B por ID", async () => {
    if (!clinicaB.documentId) {
      throw new Error(
        "Seed de patient_documents falló — probablemente la migración 20260826200000 no está aplicada al Supabase real.",
      );
    }
    const { data, error } = await clinicaA.client
      .from("patient_documents")
      .select("id, storage_path")
      .eq("id", clinicaB.documentId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer patient_consents de la clínica B por ID", async () => {
    if (!clinicaB.consentId) {
      throw new Error(
        "Seed de patient_consents falló — probablemente la migración 20260826200000 no está aplicada al Supabase real.",
      );
    }
    const { data, error } = await clinicaA.client
      .from("patient_consents")
      .select("id, body_snapshot, signature_storage_path")
      .eq("id", clinicaB.consentId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer inventory_movements (lote/vencimiento) de la clínica B por ID", async () => {
    if (!clinicaB.movementId) {
      throw new Error(
        "Seed de inventory_movements con lot_number/expiration_date falló — probablemente la migración 20260826220000 no está aplicada al Supabase real.",
      );
    }
    const { data, error } = await clinicaA.client
      .from("inventory_movements")
      .select("id, lot_number, expiration_date")
      .eq("id", clinicaB.movementId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer commission_rules de la clínica B", async () => {
    if (!clinicaB.commissionClinicId || !clinicaB.professionalId) {
      throw new Error(
        "Seed de commission_rules falló — probablemente la migración 20260826240000 no está aplicada al Supabase real.",
      );
    }
    const { data, error } = await clinicaA.client
      .from("commission_rules")
      .select("clinic_id, professional_id, percent_bps")
      .eq("clinic_id", clinicaB.commissionClinicId)
      .eq("professional_id", clinicaB.professionalId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario autenticado de la clínica A no puede leer quotes (accepted_signature_path) de la clínica B por ID", async () => {
    if (!clinicaB.quoteId) {
      throw new Error(
        "Seed de quotes con accepted_signature_path falló — probablemente la migración 20260826250000 no está aplicada al Supabase real, o quotes en sí no existe.",
      );
    }
    const { data, error } = await clinicaA.client
      .from("quotes")
      .select("id, accepted_signature_path")
      .eq("id", clinicaB.quoteId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
