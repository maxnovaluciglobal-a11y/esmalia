import { sha256Hex } from "@/lib/firma-distancia/token";

/**
 * Dispositivos de la clínica (Ola 14 · AUT-06): lógica pura, sin base ni red.
 *
 * - Tipos: tótem (tablet de recepción), sala (TV de la sala de espera) y box
 *   (pantalla del box para el profesional).
 * - Código de vinculación: 8 caracteres de un alfabeto sin ambiguos (sin 0/O,
 *   1/I/L), se muestra "ABCD-EFGH". 31^8 ≈ 8,5·10^11 combinaciones, vence en
 *   10 minutos, sirve una vez y el servidor limita los intentos por IP.
 * - Token del dispositivo: 32 bytes al azar (el mismo generador de la firma a
 *   distancia). La base guarda solo su sha256.
 * - Privacidad de la sala: nunca RUT, motivo ni profesional; por defecto,
 *   número de turno e iniciales.
 */

export const TIPOS_DISPOSITIVO = ["totem", "sala", "box"] as const;
export type TipoDispositivo = (typeof TIPOS_DISPOSITIVO)[number];

export const MODOS_PRIVACIDAD = ["iniciales", "turno", "nombre_corto"] as const;
export type ModoPrivacidad = (typeof MODOS_PRIVACIDAD)[number];

export const ETIQUETA_TIPO: Record<TipoDispositivo, { nombre: string; detalle: string }> = {
  totem: {
    nombre: "Tótem de recepción",
    detalle: "Tablet donde el paciente marca su llegada, agenda y ve su saldo",
  },
  sala: {
    nombre: "Pantalla de sala de espera",
    detalle: "TV que muestra a quién se llama y quién sigue",
  },
  box: {
    nombre: "Pantalla del box",
    detalle: "Cita actual y la siguiente, con el botón para llamar",
  },
};

export const RUTA_TIPO: Record<TipoDispositivo, "/totem" | "/sala" | "/box"> = {
  totem: "/totem",
  sala: "/sala",
  box: "/box",
};

export const ETIQUETA_PRIVACIDAD: Record<ModoPrivacidad, { nombre: string; ejemplo: string }> = {
  iniciales: { nombre: "Turno e iniciales", ejemplo: "12 · M. G." },
  turno: { nombre: "Solo el número de turno", ejemplo: "12" },
  nombre_corto: { nombre: "Turno y nombre corto", ejemplo: "12 · María G." },
};

export function esTipoDispositivo(v: unknown): v is TipoDispositivo {
  return typeof v === "string" && (TIPOS_DISPOSITIVO as readonly string[]).includes(v);
}

export function esModoPrivacidad(v: unknown): v is ModoPrivacidad {
  return typeof v === "string" && (MODOS_PRIVACIDAD as readonly string[]).includes(v);
}

// ─── Código de vinculación ───────────────────────────────────────────────

export const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LARGO_CODIGO = 8;
export const MINUTOS_CODIGO = 10;

/** Código uniforme sobre el alfabeto (muestreo por rechazo, sin sesgo). */
export function generarCodigoVinculacion(): string {
  const n = ALFABETO_CODIGO.length;
  const tope = Math.floor(256 / n) * n;
  const salida: string[] = [];
  const buf = new Uint8Array(1);
  while (salida.length < LARGO_CODIGO) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < tope) salida.push(ALFABETO_CODIGO[buf[0] % n]);
  }
  return salida.join("");
}

/** "abcd efgh" / "ABCD-EFGH" → "ABCDEFGH", o null si no es un código posible. */
export function normalizarCodigoVinculacion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const limpio = v.toUpperCase().replace(/[\s-]/g, "");
  if (limpio.length !== LARGO_CODIGO) return null;
  for (const ch of limpio) if (!ALFABETO_CODIGO.includes(ch)) return null;
  return limpio;
}

/** "ABCDEFGH" → "ABCD-EFGH" (para leerlo en voz alta o copiarlo). */
export function formatearCodigoVinculacion(codigo: string): string {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

/** Lo que guarda la base del código (con etiqueta de uso). */
export function huellaDeCodigo(codigo: string): Promise<string> {
  return sha256Hex(`esmalia:dispositivo:${codigo}`);
}

// ─── Estado y último uso ─────────────────────────────────────────────────

export type EstadoDispositivo = "revocado" | "vinculado" | "codigo_vigente" | "sin_vincular";

export function estadoDispositivo(
  d: {
    revocado: boolean;
    vinculado: boolean;
    codigoVenceEn: string | null;
  },
  ahora: Date = new Date(),
): EstadoDispositivo {
  if (d.revocado) return "revocado";
  if (d.codigoVenceEn && new Date(d.codigoVenceEn).getTime() > ahora.getTime()) {
    return "codigo_vigente";
  }
  return d.vinculado ? "vinculado" : "sin_vincular";
}

/** "Hace 3 min", "Hace 2 h", "Hace 5 días" o "Nunca". */
export function ultimoUsoLegible(iso: string | null, ahora: Date = new Date()): string {
  if (!iso) return "Nunca";
  const min = Math.max(0, Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 2) return "Recién";
  if (min < 60) return `Hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const dias = Math.floor(h / 24);
  return dias === 1 ? "Hace 1 día" : `Hace ${dias} días`;
}

// ─── Nombres en pantallas públicas ───────────────────────────────────────

function palabras(nombre: string): string[] {
  return nombre
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
}

/**
 * Primer apellido según cómo se suele escribir el nombre en Chile:
 * "Nombre Apellido" → el último; "Nombre Paterno Materno" → el segundo;
 * "Nombre Nombre Paterno Materno" → el penúltimo.
 */
function apellidoDe(p: string[]): string {
  if (p.length === 2) return p[1];
  if (p.length === 3) return p[1];
  return p[p.length - 2];
}

const conMayuscula = (p: string) => p.charAt(0).toLocaleUpperCase("es") + p.slice(1);

/** "maría josé gonzález" → "M. G." (primer nombre y primer apellido). */
export function inicialesDe(nombre: string): string {
  const p = palabras(nombre);
  if (p.length === 0) return "";
  const primera = p[0].charAt(0).toLocaleUpperCase("es");
  if (p.length === 1) return `${primera}.`;
  return `${primera}. ${apellidoDe(p).charAt(0).toLocaleUpperCase("es")}.`;
}

/** "maría josé gonzález pérez" → "María G." */
export function nombreCortoDe(nombre: string): string {
  const p = palabras(nombre);
  if (p.length === 0) return "";
  if (p.length === 1) return conMayuscula(p[0]);
  return `${conMayuscula(p[0])} ${apellidoDe(p).charAt(0).toLocaleUpperCase("es")}.`;
}

/**
 * Cómo aparece un paciente en la TV de la sala. El servidor la calcula antes
 * de responder: el nombre completo nunca llega al navegador de la pantalla.
 */
export function etiquetaDeSala(
  nombre: string,
  turno: number | null,
  modo: ModoPrivacidad,
): { turno: string | null; nombre: string | null } {
  const t = turno != null && turno > 0 ? String(turno) : null;
  if (modo === "turno") return { turno: t, nombre: t ? null : "Paciente" };
  const n = modo === "nombre_corto" ? nombreCortoDe(nombre) : inicialesDe(nombre);
  return { turno: t, nombre: n || null };
}
