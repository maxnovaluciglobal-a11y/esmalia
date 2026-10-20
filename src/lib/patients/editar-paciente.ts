/**
 * Edición de los datos básicos de un paciente (nombre, documento, fecha de
 * nacimiento, teléfono y email). Lógica pura: la usan el diálogo "Editar
 * datos" de la ficha (cliente) y `updatePatient` (servidor), y se prueba
 * sin base en tests/editar-paciente.test.ts.
 *
 * Antes no había forma de corregir un teléfono mal cargado desde la app:
 * `updatePatient` existía sin ningún caller, y un número equivocado dejaba
 * al paciente sin recordatorios por WhatsApp.
 */
import { z } from "zod";

import type { Paciente } from "@/lib/clinic-operations/clinic-data";
import type { ClinicRole } from "@/lib/access/access";
import { hasPermission } from "@/lib/access/access";
import { CODIGO_PAIS, esPaisTelefono, toE164 } from "@/lib/messaging/telefonos";

/** Mismas reglas que el alta (`createPatient`): formato, no futura, desde 1900. */
export function errorDeFechaDeNacimiento(fecha: string, hoy: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(new Date(fecha).getTime())) {
    return "Formato de fecha inválido.";
  }
  const d = new Date(fecha);
  if (d > hoy) return "La fecha de nacimiento no puede ser futura.";
  if (d < new Date("1900-01-01")) return "Fecha de nacimiento fuera de rango.";
  return null;
}

const fechaDeNacimiento = z.string().superRefine((s, ctx) => {
  const error = errorDeFechaDeNacimiento(s);
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
});

/**
 * Campos que edita `updatePatient` (todos opcionales: solo se escribe lo que
 * viene). `documento: ""` y `email: ""` borran el dato; `fechaNacimiento:
 * null` también (hay fichas importadas sin fecha, y obligar a inventar una
 * para corregir el teléfono sería peor). Los ids van aparte, en la propia
 * server function, para que se vea que recibe `clinicId`.
 */
export const CAMPOS_EDITABLES_DEL_PACIENTE = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(200, "El nombre es demasiado largo.")
    .optional(),
  documento: z.string().trim().max(40, "El documento es demasiado largo.").optional(),
  fechaNacimiento: fechaDeNacimiento.nullable().optional(),
  telefono: z.string().trim().max(40, "El teléfono es demasiado largo.").optional(),
  email: z.string().trim().email("Email inválido.").max(254).optional().or(z.literal("")),
  sucursalId: z.string().uuid().optional(),
  profesionalId: z.string().uuid().optional(),
  etiquetas: z.array(z.string()).optional(),
  estado: z.enum(["activo", "nuevo", "inactivo"]).optional(),
});

/** Input completo de `updatePatient` (el mismo que arma la server function). */
export const EDITAR_PACIENTE_SCHEMA = z
  .object({ clinicId: z.string().uuid(), patientId: z.string().uuid() })
  .merge(CAMPOS_EDITABLES_DEL_PACIENTE);

export type EditarPacienteInput = z.infer<typeof EDITAR_PACIENTE_SCHEMA>;

/** Los campos que muestra el diálogo, como texto (los inputs no tienen null). */
export interface DatosBasicos {
  nombre: string;
  documento: string;
  fechaNacimiento: string;
  telefono: string;
  email: string;
}

export type CampoBasico = keyof DatosBasicos;

export function datosBasicosDe(
  p: Pick<Paciente, "nombre" | "documento" | "fechaNacimiento" | "telefono" | "email">,
): DatosBasicos {
  return {
    nombre: p.nombre,
    documento: p.documento ?? "",
    fechaNacimiento: p.fechaNacimiento ?? "",
    telefono: p.telefono ?? "",
    email: p.email ?? "",
  };
}

/** Errores por campo, en el mismo texto que devuelve el servidor. Vacío = se puede guardar. */
export function validarDatosBasicos(d: DatosBasicos): Partial<Record<CampoBasico, string>> {
  const errores: Partial<Record<CampoBasico, string>> = {};
  const nombre = d.nombre.trim();
  if (!nombre) errores.nombre = "El nombre es obligatorio.";
  else if (nombre.length > 200) errores.nombre = "El nombre es demasiado largo.";
  if (d.documento.trim().length > 40) errores.documento = "El documento es demasiado largo.";
  if (d.fechaNacimiento) {
    const error = errorDeFechaDeNacimiento(d.fechaNacimiento);
    if (error) errores.fechaNacimiento = error;
  }
  if (d.telefono.trim().length > 40) errores.telefono = "El teléfono es demasiado largo.";
  const email = d.email.trim();
  if (email && !z.string().email().max(254).safeParse(email).success) {
    errores.email = "Email inválido.";
  }
  return errores;
}

/**
 * Solo lo que cambió, ya recortado. Mandar campos sin cambios no rompe nada,
 * pero tocar `document_id` dispara el recifrado y tocar el teléfono puede
 * gastar una consulta a Numverify: se evitan.
 */
export function cambiosDeDatosBasicos(
  antes: DatosBasicos,
  despues: DatosBasicos,
): Pick<EditarPacienteInput, "nombre" | "documento" | "fechaNacimiento" | "telefono" | "email"> {
  const cambios: Pick<
    EditarPacienteInput,
    "nombre" | "documento" | "fechaNacimiento" | "telefono" | "email"
  > = {};
  const t = (s: string) => s.trim();
  if (t(despues.nombre) !== t(antes.nombre)) cambios.nombre = t(despues.nombre);
  if (t(despues.documento) !== t(antes.documento)) cambios.documento = t(despues.documento);
  if (despues.fechaNacimiento !== antes.fechaNacimiento) {
    cambios.fechaNacimiento = despues.fechaNacimiento || null;
  }
  if (t(despues.telefono) !== t(antes.telefono)) cambios.telefono = t(despues.telefono);
  if (t(despues.email) !== t(antes.email)) cambios.email = t(despues.email);
  return cambios;
}

/**
 * Quién edita los datos de un paciente: los roles con `patients:manage`
 * (owner, admin, dentist, reception). Coincide con la policy
 * `patients_update_front_desk`, que es la que manda en la base; lo vigila
 * tests/editar-paciente.test.ts.
 */
export function puedeEditarPaciente(role: ClinicRole | null | undefined): boolean {
  return hasPermission(role, "patients:manage");
}

export type AvisoTelefono = { tipo: "ok" | "dudoso"; texto: string };

/**
 * Lo que el diálogo dice debajo del teléfono mientras se escribe: cómo va a
 * quedar guardado (E.164, la misma lectura que hace el servidor con el país
 * de la clínica) o que no se pudo leer. No bloquea: el servidor guarda el
 * texto tal cual y el envío por WhatsApp lo rechaza después.
 */
export function avisoDeTelefono(
  telefono: string,
  country: string | null | undefined,
): AvisoTelefono | null {
  const limpio = telefono.trim();
  if (!limpio) return null;
  const e164 = toE164(limpio, country);
  if (e164) return { tipo: "ok", texto: `Se guarda como ${e164}.` };
  const ejemplo = esPaisTelefono(country)
    ? `+${CODIGO_PAIS[country.toUpperCase() as keyof typeof CODIGO_PAIS]}`
    : "+56";
  return {
    tipo: "dudoso",
    texto: `No reconocemos este número, así que WhatsApp no podrá usarlo. Escríbelo con el código de país (por ejemplo, ${ejemplo}…).`,
  };
}
