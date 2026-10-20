/**
 * Cuerpo de `updatePatient` (patients.functions.ts), separado de la server
 * function para poder probarlo con un cliente de Supabase real logueado
 * como cada rol (tests/editar-paciente-db.test.ts): una `createServerFn` no
 * se puede invocar fuera de un request HTTP.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import { toE164 } from "@/lib/messaging/telefonos";
import { vigilarCifradoDeDocumento } from "@/lib/patients/documento-cifrado.server";
import type { EditarPacienteInput } from "@/lib/patients/editar-paciente";
import { validatePhoneNumber } from "@/lib/patients/phoneValidation";

export const MENSAJE_SIN_PERMISO_EDITAR = "No tienes permisos para editar este paciente.";
export const MENSAJE_PACIENTE_AJENO = "No encontramos ese paciente en esta clínica.";

const ESTADO_A_DB = { activo: "active", nuevo: "new", inactivo: "inactive" } as const;

export interface DependenciasEdicion {
  /** Numverify; inyectable para no salir a la red en los tests. */
  validarTelefono?: (phone: string | null) => Promise<boolean | null>;
  /** SEG-03: verificación del cifrado del documento después de escribirlo. */
  vigilarCifrado?: typeof vigilarCifradoDeDocumento;
}

export async function actualizarPaciente(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: EditarPacienteInput,
  deps: DependenciasEdicion = {},
): Promise<{ ok: true }> {
  const validarTelefono = deps.validarTelefono ?? validatePhoneNumber;
  const vigilarCifrado = deps.vigilarCifrado ?? vigilarCifradoDeDocumento;
  const { clinicId, patientId, ...rest } = data;

  // Par en el servidor del botón "Editar datos" (regla 15). La policy
  // patients_update_front_desk ya limita a owner/admin/dentist/reception,
  // pero se corta antes de leer nada ni gastar cuota de Numverify.
  await requireClinicPermission(
    supabase,
    clinicId,
    userId,
    "patients:manage",
    MENSAJE_SIN_PERMISO_EDITAR,
  );

  // La ficha tiene que ser de ESTA clínica: un patientId de otra clínica (o
  // inexistente) se rechaza acá, antes de cualquier escritura.
  const { data: actual, error: lecturaError } = await supabase
    .from("patients")
    .select("id, phone, phone_valid")
    .eq("id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (lecturaError) throw new Error(mensajeDb(lecturaError, "No pudimos cargar el paciente."));
  if (!actual) throw new Error(MENSAJE_PACIENTE_AJENO);

  // Teléfono en E.164 con el país de la clínica, o el texto tal cual si no
  // se puede leer (mismo criterio que el alta, BIL-11). Numverify solo se
  // consulta si el número guardado realmente cambia.
  let phone: string | null = null;
  let phoneValid: boolean | null = null;
  if (rest.telefono !== undefined) {
    const limpio = rest.telefono.trim();
    if (limpio) {
      const { data: clinica } = await supabase
        .from("clinics")
        .select("country")
        .eq("id", clinicId)
        .maybeSingle();
      phone = toE164(limpio, clinica?.country ?? null) ?? limpio;
    }
    phoneValid = phone === actual.phone ? actual.phone_valid : await validarTelefono(phone);
  }

  const patch: Database["public"]["Tables"]["patients"]["Update"] = {
    ...(rest.nombre !== undefined && { full_name: rest.nombre }),
    ...(rest.documento !== undefined && { document_id: rest.documento || null }),
    ...(rest.fechaNacimiento !== undefined && { birth_date: rest.fechaNacimiento }),
    ...(rest.telefono !== undefined && { phone, phone_valid: phoneValid }),
    ...(rest.email !== undefined && { email: rest.email || null }),
    ...(rest.sucursalId !== undefined && { branch_id: rest.sucursalId }),
    ...(rest.profesionalId !== undefined && { primary_professional_id: rest.profesionalId }),
    ...(rest.etiquetas !== undefined && { tags: rest.etiquetas }),
    ...(rest.estado !== undefined && { status: ESTADO_A_DB[rest.estado] }),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  // `.select()` para saber si se escribió: un UPDATE que la RLS frena (rol
  // sin permiso, MFA sin aal2) no da error, solo deja 0 filas, y antes eso
  // se respondía como éxito.
  const { data: fila, error } = await supabase
    .from("patients")
    .update(patch)
    .eq("id", patientId)
    .eq("clinic_id", clinicId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, MENSAJE_SIN_PERMISO_EDITAR));
  if (!fila) throw new Error(MENSAJE_SIN_PERMISO_EDITAR);

  // SEG-03: el trigger patients_cifrar_documento recifra (o limpia) el
  // documento cuando cambia; acá solo se verifica, igual que en el alta.
  if (rest.documento !== undefined) {
    await vigilarCifrado(supabase, [patientId], "edicion");
  }

  return { ok: true };
}
