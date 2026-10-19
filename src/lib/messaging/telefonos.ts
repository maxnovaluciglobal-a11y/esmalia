// src/lib/messaging/telefonos.ts
//
// Normalización de teléfonos por país para WhatsApp (wa.me y Cloud API).
//
// Antes (auditoría 360, BIL-11) había UNA regla para todos: "si no trae
// código, es de Chile". Un celular de México, Colombia, Perú o Argentina
// escrito en formato local terminaba como un número de otra persona en otro
// país (MX "55 1234 5678" → Brasil, AR "11 2345-6789" → EE. UU.), y el
// recordatorio con nombre, clínica y hora de la cita le llegaba a un tercero.
//
// Reglas de este módulo:
// - El país de la clínica (`clinics.country`) es obligatorio para leer un
//   número en formato LOCAL. Sin país conocido no se adivina: `null`.
// - Un número escrito en formato internacional ("+52 …" o "0052 …") no
//   necesita país: el propio número lo dice.
// - Si el código es de uno de los 5 países soportados, se aplican sus reglas
//   también al formato internacional (así "+52 1 55…" y "+52 55…" dan el
//   mismo resultado, y lo mismo "+54 11…" y "+54 9 11…").
// - Lógica pura, sin dependencias (CLAUDE.md: "no hay libphonenumber"): se
//   usa en el cliente y en el servidor.

export const PAISES_TELEFONO = ["CL", "MX", "CO", "PE", "AR"] as const;
export type PaisTelefono = (typeof PAISES_TELEFONO)[number];

/** Código de país (sin "+") de cada país soportado. */
export const CODIGO_PAIS: Record<PaisTelefono, string> = {
  CL: "56",
  MX: "52",
  CO: "57",
  PE: "51",
  AR: "54",
};

const PAIS_POR_CODIGO = new Map<string, PaisTelefono>(
  PAISES_TELEFONO.map((p) => [CODIGO_PAIS[p], p]),
);

export function esPaisTelefono(country: string | null | undefined): country is PaisTelefono {
  return (PAISES_TELEFONO as readonly string[]).includes((country ?? "").toUpperCase());
}

/**
 * Argentina: códigos de área de 3 dígitos (ENACOM). El "11" (AMBA) es el
 * único de 2; el resto son de 4. Hace falta para saber dónde está el "15"
 * de celular: "351 15 123-4567" (Córdoba) vs. "2944 15 12-3456" (Bariloche).
 */
const AR_AREAS_3 = new Set([
  "220",
  "221",
  "223",
  "230",
  "236",
  "237",
  "249",
  "260",
  "261",
  "263",
  "264",
  "266",
  "280",
  "291",
  "294",
  "297",
  "298",
  "299",
  "336",
  "341",
  "342",
  "343",
  "345",
  "348",
  "351",
  "353",
  "358",
  "362",
  "364",
  "370",
  "376",
  "379",
  "380",
  "381",
  "383",
  "385",
  "387",
  "388",
]);

/**
 * Cada función recibe los dígitos del número NACIONAL (sin código de país) y
 * devuelve el número completo para WhatsApp (código + nacional, solo dígitos)
 * o null si no tiene forma de número de ese país.
 */
const NACIONAL: Record<PaisTelefono, (d: string) => string | null> = {
  // Chile: 9 dígitos. Celulares 9XXXXXXXX, fijos 2XXXXXXXX (Santiago) o
  // área + número. Se acepta el "0" de discado viejo adelante.
  CL(d) {
    const n = d.replace(/^0+/, "");
    return /^[2-9]\d{8}$/.test(n) ? `56${n}` : null;
  },

  // México: 10 dígitos desde 2019. Se aceptan los prefijos viejos 044/045
  // (celular), 01 (larga distancia) y el "1" de celular que WhatsApp todavía
  // usa en algunos wa_id ("521…"). Todos quedan como 52 + 10 dígitos.
  MX(d) {
    let n = d;
    if (n.length === 13 && /^04[45]/.test(n)) n = n.slice(3);
    else if (n.length === 12 && n.startsWith("01")) n = n.slice(2);
    else if (n.length === 11 && n.startsWith("1")) n = n.slice(1);
    return /^[2-9]\d{9}$/.test(n) ? `52${n}` : null;
  },

  // Colombia: 10 dígitos. Celulares 3XXXXXXXXX; fijos 60 + indicativo +
  // número (plan de 2021).
  CO(d) {
    const n = d.replace(/^0+/, "");
    return /^(?:3\d{9}|60\d{8})$/.test(n) ? `57${n}` : null;
  },

  // Perú: celulares 9 dígitos que empiezan con 9; fijos 8 dígitos
  // (Lima "1" + 7, provincias área de 2 + 6). Se acepta el "0" de discado.
  PE(d) {
    const n = d.replace(/^0+/, "");
    return /^(?:9\d{8}|[1-8]\d{7})$/.test(n) ? `51${n}` : null;
  },

  // Argentina: 10 dígitos nacionales (área + abonado). Para WhatsApp los
  // celulares van como 54 + 9 + área + abonado, SIN el "15". Se aceptan el
  // "0" de discado, el "15" después del área y el "9" adelante. Un número de
  // 10 dígitos sin "15" se trata como celular (le agrega el 9): WhatsApp
  // casi no existe en fijos, y sin el 9 un celular no llega.
  AR(d) {
    let n = d.replace(/^0+/, "");
    if (n.length === 11 && n.startsWith("9")) n = n.slice(1);
    if (n.length === 12) {
      let area: number | null = null;
      if (n.startsWith("11") && n.slice(2, 4) === "15") area = 2;
      else if (AR_AREAS_3.has(n.slice(0, 3)) && n.slice(3, 5) === "15") area = 3;
      else if (n.slice(4, 6) === "15") area = 4;
      if (area === null) return null;
      n = n.slice(0, area) + n.slice(area + 2);
    }
    return /^(?:11|[23]\d)\d{8}$/.test(n) ? `549${n}` : null;
  },
};

/**
 * Convierte un teléfono al formato de wa.me / Cloud API: código de país +
 * número nacional, solo dígitos, sin "+".
 *
 * `country` es el país de la clínica (`clinics.country`). Es obligatorio
 * para números en formato local: sin él, o con un país no soportado, un
 * número local devuelve null (no se adivina el país). Un número con "+" o
 * "00" adelante se lee como internacional.
 *
 * Devuelve null si el número no se puede leer con seguridad. El caller NO
 * debe enviar en ese caso.
 */
export function normalizeToWaMe(
  phone: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const raw = (phone ?? "").trim().replace(/^[(\s]+/, "");
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  const internacional = raw.startsWith("+") || digits.startsWith("00");
  if (internacional) {
    const full = raw.startsWith("+") ? digits : digits.slice(2);
    const pais = PAIS_POR_CODIGO.get(full.slice(0, 2));
    if (pais) return NACIONAL[pais](full.slice(2));
    // Otro país (un paciente que vive afuera): se respeta tal cual, con el
    // largo que permite E.164.
    return /^[1-9]\d{7,14}$/.test(full) ? full : null;
  }

  if (!esPaisTelefono(country)) return null;
  const pais = country.toUpperCase() as PaisTelefono;

  // Formato local del país de la clínica.
  const local = NACIONAL[pais](digits);
  if (local) return local;

  // Mismo país, pero escrito con el código y sin "+" ("56912345678").
  const codigo = CODIGO_PAIS[pais];
  if (digits.startsWith(codigo)) return NACIONAL[pais](digits.slice(codigo.length));

  return null;
}

/** El mismo número en E.164 ("+56912345678"), o null si no se puede leer. */
export function toE164(
  phone: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const n = normalizeToWaMe(phone, country);
  return n ? `+${n}` : null;
}

/** Construye la URL de wa.me con el mensaje encoded. null si el número no se puede leer. */
export function buildWaMeUrl(
  phone: string | null | undefined,
  message: string,
  country: string | null | undefined,
): string | null {
  const normalized = normalizeToWaMe(phone, country);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/** Mensaje para el staff cuando un número no se puede leer para el país de la clínica. */
export function mensajeTelefonoInvalido(phone: string, country: string | null | undefined): string {
  const pais = esPaisTelefono(country) ? country.toUpperCase() : null;
  return pais
    ? `El teléfono ${phone} no tiene formato de número de ${NOMBRE_PAIS[pais as PaisTelefono]}. ` +
        `Corrígelo en la ficha o escríbelo con el código de país (por ejemplo, +${CODIGO_PAIS[pais as PaisTelefono]}…).`
    : `No sabemos el país de la clínica, así que no podemos leer el teléfono ${phone}. ` +
        `Escríbelo con el código de país (por ejemplo, +56…).`;
}

const NOMBRE_PAIS: Record<PaisTelefono, string> = {
  CL: "Chile",
  MX: "México",
  CO: "Colombia",
  PE: "Perú",
  AR: "Argentina",
};
