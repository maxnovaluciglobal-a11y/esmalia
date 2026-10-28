import { LECCIONES } from "@/content/ayuda/academia";
import { NOVEDADES } from "@/content/ayuda/novedades";
import { RECORRIDOS } from "@/content/ayuda/recorridos";
import {
  paso,
  contarFilas,
  USUARIO_DEMO_ID,
  type Admin,
  type ContextoDemo,
  type PasoDeSiembra,
} from "@/lib/demo/contexto.server";

/**
 * Demo completa · configuración de la clínica: horarios de cada sucursal, ajustes de la
 * agenda, catálogo de medicamentos, equipo con roles y permisos por persona, y el avance
 * de la Academia. Todo con nombres y datos inventados (las direcciones de correo del
 * equipo son del dominio de ejemplo `demo.esmalia.com`).
 *
 * Cada paso es idempotente: si la tabla ya tiene filas de la clínica, no hace nada.
 */

async function sembrarHorariosDeSucursal(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "branch_hours", ctx.clinicId)) > 0) return;
  const filas = ctx.sucursales.flatMap((s) =>
    // 1 = lunes … 6 = sábado, como `professional_schedules`.
    [1, 2, 3, 4, 5, 6].map((dia) => ({
      clinic_id: ctx.clinicId,
      branch_id: s.id,
      day_of_week: dia,
      opens_at: "09:00",
      closes_at: dia === 6 ? "14:00" : "19:00",
    })),
  );
  if (filas.length === 0) return;
  const { error } = await ctx.admin.from("branch_hours").insert(filas);
  if (error) throw new Error(error.message);
}

async function sembrarAjustesDeAgenda(ctx: ContextoDemo) {
  const { error } = await ctx.admin.from("clinic_agenda_settings").upsert(
    {
      clinic_id: ctx.clinicId,
      slot_minutes: 15,
      default_duration_min: 30,
      allow_overbooking: false,
      updated_by: USUARIO_DEMO_ID,
    },
    { onConflict: "clinic_id" },
  );
  if (error) throw new Error(error.message);
}

const MEDICAMENTOS = [
  {
    active_ingredient: "Ibuprofeno",
    concentration: "400 mg",
    form: "Comprimido",
    route: "oral",
    dose: "1 comprimido",
    frequency: "Cada 8 horas",
    duration: "3 días",
    instructions: "Tomar con alimentos.",
    pharmacological_group: "aine",
    atc_code: "M01AE01",
  },
  {
    active_ingredient: "Paracetamol",
    concentration: "1 g",
    form: "Comprimido",
    route: "oral",
    dose: "1 comprimido",
    frequency: "Cada 8 horas",
    duration: "3 días",
    instructions: "No superar 3 g al día.",
    pharmacological_group: "analgesicos",
    atc_code: "N02BE01",
  },
  {
    active_ingredient: "Amoxicilina",
    concentration: "500 mg",
    form: "Cápsula",
    route: "oral",
    dose: "1 cápsula",
    frequency: "Cada 8 horas",
    duration: "7 días",
    instructions: "Completar el tratamiento aunque desaparezcan las molestias.",
    pharmacological_group: "penicilinas",
    atc_code: "J01CA04",
  },
  {
    active_ingredient: "Clorhexidina",
    concentration: "0,12 %",
    form: "Colutorio",
    route: "enjuague_bucal",
    dose: "15 ml",
    frequency: "Cada 12 horas",
    duration: "7 días",
    instructions: "Enjuagar 30 segundos y no tragar.",
    pharmacological_group: "antisepticos",
    atc_code: "A01AB03",
  },
  {
    active_ingredient: "Ketorolaco",
    concentration: "10 mg",
    form: "Comprimido",
    route: "oral",
    dose: "1 comprimido",
    frequency: "Cada 12 horas",
    duration: "2 días",
    instructions: "Solo si el dolor es intenso y por el tiempo indicado.",
    pharmacological_group: "aine",
    atc_code: "M01AB15",
  },
] as const;

async function sembrarMedicamentos(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "clinic_medications", ctx.clinicId)) > 0) return;
  const { error } = await ctx.admin
    .from("clinic_medications")
    .insert(
      MEDICAMENTOS.map((m) => ({ clinic_id: ctx.clinicId, created_by: USUARIO_DEMO_ID, ...m })),
    );
  if (error) throw new Error(error.message);
}

// ─── Equipo ──────────────────────────────────────────────────────────────

type IntegranteDemo = {
  email: string;
  nombre: string;
  rol: "admin" | "assistant" | "reception";
  profesion: "administracion" | "asistente_dental" | "recepcion";
  /** Permisos por persona: dados (grant) o quitados (revoke), con su motivo. */
  permisos: readonly { permiso: string; efecto: "grant" | "revoke"; motivo: string }[];
};

const INTEGRANTES: readonly IntegranteDemo[] = [
  {
    email: "rodrigo.pinto@demo.esmalia.com",
    nombre: "Rodrigo Pinto Salas",
    rol: "admin",
    profesion: "administracion",
    permisos: [
      {
        permiso: "payments:reverse",
        efecto: "revoke",
        motivo: "Reversar un cobro lo autoriza la dueña de la clínica.",
      },
    ],
  },
  {
    email: "francisca.lagos@demo.esmalia.com",
    nombre: "Francisca Lagos Pérez",
    rol: "reception",
    profesion: "recepcion",
    permisos: [
      {
        permiso: "finance:view",
        efecto: "grant",
        motivo: "Revisa la caja del día al cerrar el turno.",
      },
    ],
  },
  {
    email: "catalina.vera@demo.esmalia.com",
    nombre: "Catalina Vera Ortiz",
    rol: "assistant",
    profesion: "asistente_dental",
    permisos: [
      {
        permiso: "team:view",
        efecto: "grant",
        motivo: "Ve al equipo para coordinar los turnos de apoyo.",
      },
    ],
  },
];

/** Cuenta de ejemplo del equipo: sin correo de invitación y con una clave aleatoria que nadie conoce. */
async function usuarioDeEjemplo(admin: Admin, email: string, nombre: string): Promise<string> {
  const { data: perfil } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (perfil) return perfil.id;
  const clave = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: clave,
    email_confirm: true,
    user_metadata: { full_name: nombre },
  });
  if (data?.user) return data.user.id;
  // Ya existía en auth.users sin perfil (resto de un reseteo a medias): se busca por correo.
  const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existente = lista?.users.find((u) => u.email?.toLowerCase() === email);
  if (existente) return existente.id;
  throw new Error(error?.message ?? "No se pudo crear la cuenta de ejemplo");
}

async function sembrarEquipo(ctx: ContextoDemo) {
  const { data: miembros } = await ctx.admin
    .from("clinic_members")
    .select("id")
    .eq("clinic_id", ctx.clinicId);
  if ((miembros?.length ?? 0) > 1) return;
  for (const i of INTEGRANTES) {
    const userId = await usuarioDeEjemplo(ctx.admin, i.email, i.nombre);
    const { data: miembro, error } = await ctx.admin
      .from("clinic_members")
      .insert({
        clinic_id: ctx.clinicId,
        user_id: userId,
        role: i.rol,
        profession: i.profesion,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (i.permisos.length === 0) continue;
    const { error: errPermisos } = await ctx.admin
      .from("clinic_member_permission_overrides")
      .insert(
        i.permisos.map((p) => ({
          clinic_id: ctx.clinicId,
          member_id: miembro.id,
          permission: p.permiso,
          effect: p.efecto,
          reason: p.motivo,
          created_by: USUARIO_DEMO_ID,
        })),
      );
    if (errPermisos) throw new Error(errPermisos.message);
  }
}

// ─── Academia ────────────────────────────────────────────────────────────

/** Avance de la Academia de quien entra a la demo: unas lecciones vistas, dos recorridos y novedades leídas. */
async function sembrarAvanceDeLaAcademia(ctx: ContextoDemo) {
  const { count } = await ctx.admin
    .from("help_progress")
    .select("item_key", { count: "exact", head: true })
    .eq("user_id", USUARIO_DEMO_ID);
  if ((count ?? 0) > 0) return;
  const hecho = (kind: string, ids: readonly string[]) =>
    ids.map((item_key) => ({ user_id: USUARIO_DEMO_ID, kind, item_key }));
  const filas = [
    ...hecho(
      "leccion",
      LECCIONES.slice(0, Math.max(3, Math.ceil(LECCIONES.length / 3))).map((l) => l.id),
    ),
    ...hecho(
      "tour",
      RECORRIDOS.slice(0, 2).map((r) => r.id),
    ),
    ...hecho(
      "novedad",
      NOVEDADES.slice(0, 3).map((n) => n.id),
    ),
  ];
  if (filas.length === 0) return;
  const { error } = await ctx.admin
    .from("help_progress")
    .upsert(filas, { onConflict: "user_id,kind,item_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export function pasosDeClinica(admin: Admin): PasoDeSiembra[] {
  return [
    paso(admin, "horarios de sucursal", sembrarHorariosDeSucursal),
    paso(admin, "ajustes de agenda", sembrarAjustesDeAgenda),
    paso(admin, "medicamentos", sembrarMedicamentos),
    paso(admin, "equipo y permisos", sembrarEquipo),
    paso(admin, "avance de la Academia", sembrarAvanceDeLaAcademia),
  ];
}
