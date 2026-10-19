import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CLINIC_ROLES,
  isClinicRole,
  type ClinicAccess,
  type ClinicMember,
  type ClinicRole,
} from "@/lib/access/access";
import { assertNotDemoClinic } from "@/lib/access/clinic-guards.server";
import { leerCookieConAnterior } from "@/lib/compat/nombres-anteriores";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura, requireEscrituraPorFila } from "@/lib/solo-lectura.middleware";

const ACTIVE_CLINIC_COOKIE_NAME = "esmalia_active_clinic";
const ACTIVE_CLINIC_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Selector de clínica activa (progresivo #7, plan Carlos 05-sep-2026): cuál
 * membresía usar cuando el mismo usuario pertenece a 2+ clínicas. Cookie y
 * no localStorage a propósito — `getMyAccess` corre en el servidor durante
 * SSR y necesita saber la clínica correcta ANTES del primer render; con
 * localStorage el server no vería la preferencia hasta hidratar, mostrando
 * la clínica equivocada un instante (mismo problema que no tiene la
 * simulación de rol, que sí es solo cosmética y puede esperar al cliente). */
function readActiveClinicCookie(): string | null {
  const req = getRequest();
  const cookieHeader = req?.headers.get("cookie") ?? "";
  // El nombre va anclado a inicio de string o justo después de "; " (ver
  // leerCookieConAnterior): sin eso, una cookie que solo TERMINE en el nombre
  // (ej. "x_esmalia_active_clinic") matchearía igual (revisión 06-sep-2026).
  return leerCookieConAnterior(cookieHeader, ACTIVE_CLINIC_COOKIE_NAME);
}

/** Pura y exportada para poder testearla sin una conexión real a Supabase:
 * dada la lista de membresías (algunas pueden tener `clinics: null` si la
 * clínica se borró) y una preferencia (de la cookie), decide cuál es la
 * activa. Si la preferida no matchea ninguna membresía real, cae a la
 * primera — mismo comportamiento que antes de que existiera el selector. */
export function resolveActiveMembership<T extends { clinics: { id: string } | null }>(
  memberships: T[],
  preferredClinicId: string | null,
): T | null {
  const validas = memberships.filter((m) => m.clinics);
  const preferida = preferredClinicId && validas.find((m) => m.clinics!.id === preferredClinicId);
  return preferida || validas[0] || null;
}

/** Sesión + clínica activa + rol del usuario autenticado. */
export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClinicAccess> => {
    const { supabase, userId } = context;

    const [{ data: profile }, { data: memberships, error }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email, avatar_url")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("clinic_members")
        .select(
          "role, clinics(id, name, onboarding_completed, timezone, country, is_demo, currency, onboarding_call_at)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar tu acceso a la clínica."));

    const membresiasValidas = (memberships ?? []).filter((m) => m.clinics);
    const membership = resolveActiveMembership(membresiasValidas, readActiveClinicCookie());
    const role =
      membership && isClinicRole(membership.role) ? (membership.role as ClinicRole) : null;

    // ux-3: si el usuario tiene ficha de profesional en la clínica activa
    // (ej. es dentist), resolvemos su professional_id acá una sola vez —
    // así /comisiones (y cualquier otra pantalla "ver lo mío") no tiene que
    // hacer esta query por su cuenta.
    let myProfessionalId: string | null = null;
    if (membership?.clinics) {
      const { data: myPro } = await supabase
        .from("professionals")
        .select("id")
        .eq("clinic_id", membership.clinics.id)
        .eq("user_id", userId)
        .maybeSingle();
      myProfessionalId = myPro?.id ?? null;
    }

    return {
      userId,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      memberships: membresiasValidas.map((m) => ({
        clinicId: m.clinics!.id,
        clinicName: m.clinics!.name,
      })),
      clinic: membership?.clinics
        ? {
            id: membership.clinics.id,
            name: membership.clinics.name,
            onboardingCompleted: membership.clinics.onboarding_completed,
            timezone: membership.clinics.timezone || "America/Santiago",
            country: membership.clinics.country || "CL",
            isDemo: membership.clinics.is_demo ?? false,
            currency: membership.clinics.currency || "CLP",
            onboardingCallAt: membership.clinics.onboarding_call_at ?? null,
          }
        : null,
      role,
    };
  });

/** Cambia cuál de las clínicas del usuario es la activa (progresivo #7). Solo
 * tiene efecto real con 2+ membresías; con una sola, `getMyAccess` ya la
 * resuelve sola. Valida membresía real antes de aceptar el cambio — la
 * cookie es solo una preferencia de UI, nunca una fuente de autorización. */
export const setActiveClinic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const { data: membership, error } = await supabase
      .from("clinic_members")
      .select("id")
      .eq("user_id", userId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos verificar tu acceso a esa clínica."));
    if (!membership) throw new Error("No formas parte de esa clínica.");

    const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
    setResponseHeader(
      "Set-Cookie",
      `${ACTIVE_CLINIC_COOKIE_NAME}=${encodeURIComponent(data.clinicId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACTIVE_CLINIC_COOKIE_MAX_AGE_SECONDS}${secureFlag}`,
    );
    return { ok: true };
  });

/** Integrantes de una clínica. RLS solo devuelve filas de clínicas donde el usuario es miembro. */
export const listClinicMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ClinicMember[]> => {
    const { data: rows, error } = await context.supabase
      .from("clinic_members")
      .select("id, user_id, role")
      .eq("clinic_id", data.clinicId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el equipo de la clínica."));

    const userIds = (rows ?? []).map((row) => row.user_id);
    const { data: profiles } = userIds.length
      ? await context.supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url")
          .in("id", userIds)
      : { data: [] };

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    return (rows ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      role: (isClinicRole(row.role) ? row.role : "assistant") as ClinicRole,
      fullName: profileById.get(row.user_id)?.full_name ?? null,
      email: profileById.get(row.user_id)?.email ?? null,
      avatarUrl: profileById.get(row.user_id)?.avatar_url ?? null,
    }));
  });

/**
 * Cambia el rol de un integrante. La autorización real vive en RLS
 * (`members_update_managers`), esto añade la validación de negocio.
 */
export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("clinic_members", "memberId")])
  .validator((input: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        role: z.enum(CLINIC_ROLES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: member, error: readError } = await supabase
      .from("clinic_members")
      .select("id, user_id, clinic_id, role")
      .eq("id", data.memberId)
      .maybeSingle();

    if (readError)
      throw new Error(
        mensajeDb(readError, "No pudimos cargar los datos de ese integrante para cambiar su rol."),
      );
    if (!member) throw new Error("No encontramos a ese integrante.");
    if (member.user_id === userId) throw new Error("No puedes cambiar tu propio rol.");
    if (member.role === "owner")
      throw new Error("El rol de propietario no se puede modificar aquí.");
    if (data.role === "owner") throw new Error("Solo puede existir un propietario por clínica.");
    // `clinic_members` no tiene el trigger `block_demo_writes`: sin esto la
    // demo pública podía reacomodar los roles de su propio equipo.
    await assertNotDemoClinic(supabase, member.clinic_id);

    const { error } = await supabase
      .from("clinic_members")
      .update({ role: data.role })
      .eq("id", data.memberId);

    if (error) throw new Error("No tienes permisos para cambiar roles en esta clínica.");
    return { ok: true };
  });

/**
 * Invita a una persona nueva al equipo de la clínica: crea (o reutiliza)
 * el usuario en Supabase Auth vía Admin API y lo agrega a `clinic_members`.
 *
 * Autorización en dos capas, igual que el resto del módulo:
 * 1. Chequeo explícito acá (misma condición que `can_manage_clinic`:
 *    el caller debe ser owner/admin de la clínica) — no depender solo de RLS
 *    porque el insert real lo hace `supabaseAdmin` con service_role, que
 *    bypassea RLS por diseño.
 * 2. La policy `members_insert_managers` sigue protegiendo cualquier otro
 *    camino de escritura contra esta tabla que no pase por acá.
 */
export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        email: z.string().trim().toLowerCase().email("Email inválido."),
        fullName: z.string().trim().min(1, "El nombre es obligatorio.").max(200),
        role: z.enum(CLINIC_ROLES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.role === "owner") {
      throw new Error("Solo puede existir un propietario por clínica.");
    }

    // Defensa en profundidad: mismo criterio que can_manage_clinic(clinic_id)
    // (helper SQL), verificado acá porque el insert de más abajo lo hace el
    // cliente admin (service_role), que no pasa por RLS.
    const { data: membership, error: membershipError } = await supabase
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", data.clinicId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError)
      throw new Error(
        mensajeDb(membershipError, "No pudimos verificar tus permisos para invitar integrantes."),
      );
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new Error("No tienes permisos para invitar integrantes en esta clínica.");
    }

    // Auditoría 10-oct-2026: la cuenta de la demo pública es owner de su
    // clínica, así que pasaba el chequeo de arriba y `inviteUserByEmail`
    // mandaba invitaciones de Supabase a cualquier dirección (spam con
    // nuestro dominio y cuentas nuevas en auth.users). El trigger
    // `block_demo_writes` no lo frenaba: la invitación sale antes del insert,
    // y el insert lo hace service_role.
    await assertNotDemoClinic(supabase, data.clinicId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ¿La clínica ya tiene un miembro con ese email? Evita duplicar el alta.
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();

    if (existingProfile) {
      const { data: existingMember } = await supabaseAdmin
        .from("clinic_members")
        .select("id")
        .eq("clinic_id", data.clinicId)
        .eq("user_id", existingProfile.id)
        .maybeSingle();
      if (existingMember) {
        throw new Error("Esa persona ya es parte del equipo de esta clínica.");
      }
    }

    let newUserId = existingProfile?.id ?? null;

    if (!newUserId) {
      const { data: invited, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
          data: { full_name: data.fullName },
        });

      if (inviteError || !invited?.user) {
        // Ya existe en auth.users pero sin profile (caso raro) — no reintentamos
        // login/lookup manual acá, es más seguro pedirle a Walter que lo revise.
        throw new Error(
          inviteError?.message?.includes("already been registered")
            ? "Ya existe una cuenta con ese email. Contacta a soporte para agregarla a esta clínica."
            : "No se pudo invitar a esa persona. Intenta de nuevo.",
        );
      }
      newUserId = invited.user.id;
    }

    const { error: memberError } = await supabaseAdmin.from("clinic_members").insert({
      clinic_id: data.clinicId,
      user_id: newUserId,
      role: data.role,
    });

    if (memberError) {
      if (memberError.code === "23505") {
        throw new Error("Esa persona ya es parte del equipo de esta clínica.");
      }
      throw new Error("No se pudo agregar a esa persona al equipo.");
    }

    return { ok: true, invited: !existingProfile };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("clinic_members", "memberId")])
  .validator((input: unknown) => z.object({ memberId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: member, error: readError } = await supabase
      .from("clinic_members")
      .select("id, user_id, role, clinic_id")
      .eq("id", data.memberId)
      .maybeSingle();

    if (readError)
      throw new Error(
        mensajeDb(
          readError,
          "No pudimos cargar los datos de ese integrante para quitarlo del equipo.",
        ),
      );
    if (!member) throw new Error("No encontramos a ese integrante.");
    if (member.user_id === userId) throw new Error("No puedes quitarte a ti mismo del equipo.");
    if (member.role === "owner")
      throw new Error("No se puede quitar al propietario de la clínica.");
    await assertNotDemoClinic(supabase, member.clinic_id);

    const { error } = await supabase.from("clinic_members").delete().eq("id", data.memberId);
    if (error) throw new Error("No tienes permisos para quitar integrantes.");
    return { ok: true };
  });
