// src/lib/marketing/leads.functions.ts
//
// Captura pública de leads. SIN requireSupabaseAuth a propósito: quien usa la
// calculadora no tiene sesión. Sigue el patrón que ya usan el portal del
// paciente y el webhook de WhatsApp — escritura con supabaseAdmin y filtros
// explícitos, sobre una tabla sin GRANT para authenticated.

import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { hashIp, normalizarTelefonoPorPais } from "@/lib/marketing/leads";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireEsmaliaStaffEmail } from "@/lib/admin/staff-gate";

const MAX_POR_IP_POR_HORA = 5;

const EsquemaLead = z
  .object({
    email: z.string().trim().email().max(254).optional().or(z.literal("")),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    name: z.string().trim().max(120).optional(),
    clinicName: z.string().trim().max(120).optional(),
    countryCode: z.enum(["CL", "MX", "CO", "PE", "AR"]),
    source: z.enum(["calculadora", "checklist", "benchmark", "demo"]),
    consent: z.literal(true),
    consentText: z.string().trim().min(10).max(500),
    consentWhatsapp: z.boolean().default(false),
    meta: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
    utm: z.record(z.string(), z.string().max(100)).optional(),
    // Honeypot: un humano nunca ve este campo, así que tiene que venir vacío.
    // SIN tope de longitud a propósito: probado contra el server real, un
    // `company: z.string().max(0)` rechaza cualquier valor no vacío en la
    // VALIDACIÓN (`too_big`, antes de que el handler corra), así que el
    // `if (data.company) return { ok: true }` de abajo quedaba código
    // muerto — el caso "honeypot lleno" del plan de pruebas nunca llegaba a
    // fingir éxito, tiraba un error de validación en su lugar. Un bot que
    // llena el campo con basura tiene que poder pasar la validación para
    // que el handler sea quien decida qué responder.
    company: z.string().optional(),
  })
  .refine((d) => !!(d.email && d.email.length) || !!(d.phone && d.phone.length), {
    message: "Dejanos un email o un WhatsApp para poder enviarte el material.",
  });

/**
 * Sal para `hashIp`. Mismo patrón que `getSecret()` en
 * `src/lib/patients/portal-token.server.ts`: un valor fijo en el repo (como
 * el `"sal-de-desarrollo"` que había acá antes) es un secreto público conocido
 * — cualquiera que lea el código puede reproducir el hash de cualquier IP en
 * cualquier deploy que no tenga `PORTAL_TOKEN_SECRET` seteada. En producción
 * sin esa env var, mejor fallar fuerte que hashear con un secreto adivinable.
 * Fuera de producción cae a un valor random generado una vez por proceso
 * (cacheado en el módulo, no en cada llamada) — así el hash de una misma IP
 * es estable dentro de la ventana de rate-limit de una hora, aunque no
 * sobreviva un restart de `npm run dev`.
 */
let salIpDev: string | null = null;

function obtenerSalIp(): string {
  const raw = process.env.PORTAL_TOKEN_SECRET;
  if (raw) return raw;

  if (process.env.NODE_ENV !== "production") {
    if (!salIpDev) {
      console.warn(
        "[leads] Usando sal de desarrollo generada al azar (no persiste entre restarts). Setear PORTAL_TOKEN_SECRET en producción.",
      );
      salIpDev = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    return salIpDev;
  }

  throw new Error(
    "PORTAL_TOKEN_SECRET no configurada. Setear en Vercel Env Vars (32+ bytes random).",
  );
}

type SupabaseAdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

type LeadExistente = {
  id: string;
  submissions_count: number;
  email: string | null;
  phone: string | null;
};

/**
 * Busca una fila existente que matchee por email O por teléfono — no sólo por
 * la columna que se eligió como "conflicto principal". Si sólo se busca por
 * una columna (como hacía el borrador original) un lead que ya existe por
 * OTRA columna nunca se encuentra: el SELECT no lo ve, el INSERT choca contra
 * el índice único de esa otra columna, y sin este broadening no había forma
 * de recuperarse — el lead se perdía con un error duro.
 *
 * Caso raro: si `email` matchea una fila y `phone` matchea una fila DISTINTA
 * (dos personas reales que comparten un solo dato de contacto — p.ej. un
 * teléfono de recepción compartido), preferimos la fila del email: es el
 * identificador más fuerte de los dos. No fusionamos en silencio los datos
 * de dos personas distintas — el caller decide qué hacer con el resto
 * (`campoDelConflicto` + el retry de UPDATE más abajo cubren el caso en que
 * esto termina chocando contra el índice único de la otra fila).
 */
async function buscarExistente(
  supabaseAdmin: SupabaseAdminClient,
  email: string | null,
  phone: string | null,
): Promise<LeadExistente | null> {
  if (!email && !phone) return null;

  // Dos consultas con `.eq()` en vez de `.or(\`email.eq.${email},…\`)`:
  // interpolar en el filtro de PostgREST dejaba que un email con comas o
  // paréntesis (válido para RFC 5322, o colado por quien llama al server fn
  // directo) agregara condiciones propias al OR — auditoría 10-oct-2026.
  const columnas = "id, submissions_count, email, phone";
  const [porEmail, porTelefono] = await Promise.all([
    email
      ? supabaseAdmin.from("marketing_leads").select(columnas).eq("email", email)
      : Promise.resolve({ data: [] as LeadExistente[] }),
    phone
      ? supabaseAdmin.from("marketing_leads").select(columnas).eq("phone", phone)
      : Promise.resolve({ data: [] as LeadExistente[] }),
  ]);
  const vistos = new Set<string>();
  const data = [...(porEmail.data ?? []), ...(porTelefono.data ?? [])].filter((d) => {
    if (vistos.has(d.id)) return false;
    vistos.add(d.id);
    return true;
  });
  if (data.length === 0) return null;
  if (data.length === 1) return data[0];

  // Dos filas distintas matchearon (una por email, otra por phone). Ver
  // comentario del docstring: preferimos la del email.
  return (email && data.find((d) => d.email === email)) || data[0];
}

/** Si un UPDATE tira 23505, de qué columna vino según el nombre del índice
 *  único que violó (ver la migración de Task 1: `marketing_leads_email_key`
 *  / `marketing_leads_phone_key`). `null` si no se puede determinar. */
function campoDelConflicto(
  error: { message?: string; details?: string } | null,
): "email" | "phone" | null {
  const texto = `${error?.message ?? ""} ${error?.details ?? ""}`;
  if (texto.includes("marketing_leads_email_key")) return "email";
  if (texto.includes("marketing_leads_phone_key")) return "phone";
  return null;
}

/**
 * `EsquemaLead.parse` tira `ZodError` cuando la validación falla — su
 * `.message` es un blob JSON crudo (`[{"code":"custom","message":"...",...}]`),
 * no texto legible. Sin este wrapper ese blob llegaba tal cual al
 * `role="alert"` de `lead-form.tsx`, frente a un prospecto real. El
 * chequeo simétrico en el cliente (ver `onSubmit` de `LeadForm`) cubre el
 * caso más común (email y phone vacíos) antes del round-trip; esto es la
 * red de seguridad para cualquier otro caso que el cliente no cubra (p.ej.
 * un email mal formado que pasa el `type="email"` del browser).
 */
function parsearLead(input: unknown) {
  try {
    return EsquemaLead.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const mensaje = err.issues[0]?.message;
      throw new Error(mensaje || "Revisa los datos del formulario e inténtalo de nuevo.");
    }
    throw err;
  }
}

export const submitMarketingLead = createServerFn({ method: "POST" })
  .validator(parsearLead)
  .handler(async ({ data }) => {
    // Honeypot lleno: fingimos éxito. Devolver un error le confirma al bot
    // que detectamos la trampa y le enseña a evitarla.
    if (data.company) return { ok: true as const };

    const ipCruda =
      (getRequestHeader("x-forwarded-for") ?? "").split(",")[0]?.trim() || "desconocida";
    const sal = obtenerSalIp();
    const ipHash = await hashIp(ipCruda, sal);
    const userAgent = (getRequestHeader("user-agent") ?? "").slice(0, 255) || null;

    return escribirLeadEnBase(data, ipHash, userAgent);
  });

type DatosLead = z.infer<typeof EsquemaLead>;

/**
 * Task 16 (cierre del hallazgo diferido "cero tests" de la revisión final de
 * rama): todo lo que antes vivía DENTRO del `.handler(...)` de arriba, a
 * partir de calcular `ipHash`, cortado tal cual a esta función interna —
 * mismo código, mismo orden, sin cambio de comportamiento. El único ajuste
 * real es que `userAgent` (antes leído con `getRequestHeader("user-agent")`
 * en el punto donde se arma `fila`, más abajo) ahora se calcula arriba junto
 * con `ipHash` y se recibe acá como parámetro — es una lectura pura sin
 * efectos secundarios ni dependencia de nada calculado entre medio, así que
 * adelantarla no cambia qué termina guardado en la fila.
 *
 * Por qué este corte existe: `getRequestHeader` (como `getRequest()`, ver el
 * comentario de `tests/finance-reports-permission.test.ts`) exige un
 * contexto de request HTTP real — usarlo fuera de una request real explota
 * con "No StartEvent found in AsyncLocalStorage" (confirmado corriendo
 * exactamente eso en un script aislado antes de este refactor). Sin este
 * corte, NINGÚN test de vitest podía ejercitar la lógica de escritura real
 * de `submitMarketingLead` — que es la mayoría de la función (upsert por
 * contacto, resolución de conflictos 23505, preservación de consentimiento,
 * emisión del token de descarga). El handler público sigue llamando
 * `getRequestHeader` normalmente; esta función sólo recibe los dos valores
 * ya resueltos. `export`ada para que `tests/marketing-leads-submit.test.ts`
 * pueda invocarla directo contra Supabase real, sin pasar por
 * `createServerFn` (que tampoco se puede invocar fuera de una request real,
 * aunque `submitMarketingLead` no use `requireSupabaseAuth`).
 *
 * `createServerOnlyFn(...)`: a diferencia de `submitMarketingLead`/
 * `listMarketingLeads`, esta función NO vive dentro de un `.handler()` de
 * `createServerFn` — es una función de módulo suelta, y el import dinámico
 * de `client.server` de acá abajo quedaba fuera del único lugar donde el
 * plugin de import-protection de TanStack Start sabe pelarlo del bundle de
 * cliente. Sin este wrapper, cualquier ruta que importe este archivo
 * (`/calculadora-rentabilidad-dental`, `/recursos/fugas-clinica-dental`,
 * `/admin/leads` — y de hecho TODO el árbol de rutas, porque
 * `routeTree.gen.ts` importa cada ruta de forma eager) tira 500 en
 * `vite dev` con "[import-protection] Import denied in client environment"
 * apenas Vite analiza el grafo de módulos del cliente — confirmado en vivo
 * con el navegador real, no sólo leyendo el mensaje del plugin. En
 * `vite build` no se nota porque Rollup hace tree-shaking real y esta
 * función queda muerta si nada del cliente la llama, pero `vite dev`
 * transforma módulo por módulo sin ese tree-shaking. `createServerOnlyFn`
 * es identidad en runtime (`(fn) => fn`, confirmado leyendo
 * `@tanstack/start-fn-stubs/dist/esm/envOnly.js`) — sólo le avisa al plugin,
 * en build time, que este cuerpo es intencionalmente server-only y no debe
 * evaluarse para el bundle de cliente. No cambia la firma ni el
 * comportamiento: sigue siendo `async (data, ipHash, userAgent) => {...}`,
 * invocable igual desde los tests.
 */
export const escribirLeadEnBase = createServerOnlyFn(async function escribirLeadEnBase(
  data: DatosLead,
  ipHash: string,
  userAgent: string | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Evento de intento ANTES del chequeo de rate limit, para TODO envío que
  // pasó el honeypot — insert o update. `marketing_leads` no sirve para
  // contar intentos: un contacto ya conocido resuelve en UPDATE (misma
  // fila, sin fila nueva), así que contar filas de `marketing_leads` deja
  // reenviar sin límite real al mismo contacto una y otra vez. Insert
  // best-effort: si falla no bloqueamos el alta del lead por un problema
  // de instrumentación (ver log de abajo, no se traga en silencio total).
  //
  // Revisión final de rama (Important #3): este evento se llamaba
  // "lead_enviado", el MISMO nombre que dispara `lead-form.tsx` desde el
  // cliente cuando el submit tiene éxito (Task 6) — cada envío exitoso
  // generaba 2 filas con ese nombre, y cada intento bloqueado 1, así que
  // ningún conteo del embudo real daba un número correcto. Este es el
  // evento de INTENTO (cuenta para el rate limiter, pasó el honeypot, no
  // necesariamente tuvo éxito) — nombre propio "lead_intento", distinto de
  // la conversión real que sigue siendo "lead_enviado" del lado cliente.
  const { error: eventoError } = await supabaseAdmin
    .from("marketing_events")
    .insert({ name: "lead_intento", props: { ip_hash: ipHash } });
  if (eventoError) {
    console.error("[leads] no se pudo registrar el evento de rate-limit:", eventoError.message);
  }

  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("marketing_events")
    .select("id", { count: "exact", head: true })
    .eq("name", "lead_intento")
    .eq("props->>ip_hash", ipHash)
    .gte("created_at", desde);
  // El evento de ESTE intento ya quedó insertado y contado arriba, por eso
  // acá es `>` y no `>=`: los primeros MAX_POR_IP_POR_HORA intentos (conteo
  // 1..MAX) pasan, recién el intento MAX+1 (conteo > MAX) se bloquea —
  // mismo umbral efectivo de siempre (5 por hora), ahora contando TODOS
  // los intentos (inserts y updates), no sólo los que crean fila nueva.
  if ((count ?? 0) > MAX_POR_IP_POR_HORA) {
    throw new Error("Recibimos varios envíos desde tu conexión. Prueba de nuevo en un rato.");
  }

  const email = data.email?.trim().toLowerCase() || null;
  const phone = data.phone ? normalizarTelefonoPorPais(data.phone, data.countryCode) : null;
  if (!email && !phone) {
    throw new Error("El número no parece válido. Revisalo o dejanos tu email.");
  }

  // Numverify best-effort: nunca bloquea el alta. Mismo criterio que en
  // el alta de pacientes — un falso negativo perdiendo un lead real sería
  // peor que no validar.
  let phoneValid: boolean | null = null;
  if (phone) {
    try {
      const { validatePhoneNumber } = await import("@/lib/patients/phoneValidation");
      phoneValid = await validatePhoneNumber(phone);
    } catch {
      phoneValid = null;
    }
  }

  // `fila` completa: se usa tal cual para el INSERT (primer alta, no hay
  // nada previo que preservar) y como fuente para el payload de UPDATE
  // (ver `datosActualizacion` más abajo, que recorta y condiciona algunos
  // campos antes de escribir).
  const fila = {
    email,
    phone,
    phone_valid: phoneValid,
    name: data.name?.trim() || null,
    clinic_name: data.clinicName?.trim() || null,
    country_code: data.countryCode,
    source: data.source,
    utm: data.utm ?? null,
    meta: data.meta ?? null,
    consent_at: new Date().toISOString(),
    consent_text: data.consentText,
    consent_whatsapp: data.consentWhatsapp,
    ip_hash: ipHash,
    user_agent: userAgent,
    // Revisión final de rama (Important #2): `source` cumple doble
    // propósito (Task 3 lo pisa con la última fuente que envió el lead) y
    // `api.recurso.$slug.ts` no puede seguir usándolo para autorizar la
    // descarga — un checklist seguido de una calculadora rompía el link
    // para siempre. `download_slug` es independiente: se setea acá, en el
    // INSERT, sólo para el lead magnet que efectivamente entrega token
    // (hoy sólo "checklist"), y `datosActualizacion` de abajo lo excluye
    // de todo UPDATE — igual que `consent_at`/`consent_text`, es evidencia
    // de qué recurso desbloqueó este token que un envío posterior no debe
    // poder pisar.
    download_slug: data.source === "checklist" ? "fugas-clinica-dental" : null,
  };

  /**
   * Payload de UPDATE — NO es `fila` tal cual. Dos ajustes respecto del
   * INSERT:
   *
   * 1. `consent_at`/`consent_text` NO se tocan. Esta tabla existe para
   *    poder probar consentimiento (Ley 21.719 pone la carga de la prueba
   *    en Esmalia) — pisar el texto/fecha del consentimiento ORIGINAL en
   *    cada reenvío destruye esa prueba. Quedan como se guardaron en el
   *    primer INSERT.
   * 2. `phone`, `phone_valid`, `name`, `clinic_name` y `email` sólo se
   *    escriben si el envío actual trajo un valor. Un segundo envío más
   *    angosto (p.ej. sólo email, para un lead magnet distinto) no debe
   *    poder vaciar datos de contacto que un envío anterior sí capturó —
   *    omitir la clave del objeto de `.update()` deja el valor existente
   *    en la fila intacto (PostgREST sólo toca las columnas presentes en
   *    el payload).
   *
   * `country_code`, `source`, `utm`, `meta`, `consent_whatsapp`, `ip_hash`
   * y `user_agent` sí se pisan siempre con lo más reciente — es la
   * intención original del diseño ("pisar con el resultado más reciente")
   * y ninguno de ellos es evidencia de consentimiento ni un dato de
   * contacto que un envío parcial pueda "perder" sin querer.
   */
  function datosActualizacion(f: typeof fila) {
    const {
      consent_at: _consentAt,
      consent_text: _consentText,
      // Revisión final de rama (Important #2, corregido en el re-review:
      // la primera versión excluía esta columna del UPDATE por completo,
      // igual que consent_at/consent_text — pero a diferencia del
      // consentimiento, no hay nada que "proteger" de un reenvío: un lead
      // que llenó la calculadora ANTES que el checklist queda con
      // download_slug null para siempre, y el link de descarga que
      // debería recibir en su segundo envío nunca se genera. Mismo
      // criterio que phone/name/clinic_name: se escribe si el envío
      // actual trae un valor, nunca se vacía si no lo trae.
      download_slug: nuevoDownloadSlug,
      email: nuevoEmail,
      phone: nuevoPhone,
      phone_valid: nuevoPhoneValid,
      name: nuevoNombre,
      clinic_name: nuevaClinica,
      ...siempreFrescos
    } = f;
    return {
      ...siempreFrescos,
      ...(nuevoEmail ? { email: nuevoEmail } : {}),
      ...(nuevoPhone ? { phone: nuevoPhone, phone_valid: nuevoPhoneValid } : {}),
      ...(nuevoNombre ? { name: nuevoNombre } : {}),
      ...(nuevaClinica ? { clinic_name: nuevaClinica } : {}),
      ...(nuevoDownloadSlug ? { download_slug: nuevoDownloadSlug } : {}),
    };
  }

  // Task 13 (ronda de fix 1, Important): cada rama de escritura de abajo
  // encadena `.select("download_token, download_delivered_at")` sobre la
  // fila que ELLA MISMA acaba de tocar (por `id`, no por contacto) y guarda
  // el resultado acá. Antes esto se resolvía con una query aparte
  // (`buscarDownloadToken`) que volvía a buscar por email/phone — con el
  // mismo bug de fondo que `buscarExistente` documenta (dos personas que
  // comparten un dato de contacto matchean filas DISTINTAS), pero SIN la
  // resolución que `buscarExistente` sí tiene para ese caso: podía devolver
  // el token de otro lead. Encadenar el `.select()` sobre la escritura
  // puntual hace que la fila sea exacta por construcción — no hay
  // ambigüedad posible porque no hay ningún re-matching.
  type InfoDescarga = { download_token: string | null; download_delivered_at: string | null };
  const SELECT_DESCARGA = "download_token, download_delivered_at";

  async function actualizar(existente: LeadExistente) {
    return await supabaseAdmin
      .from("marketing_leads")
      .update({ ...datosActualizacion(fila), submissions_count: existente.submissions_count + 1 })
      .eq("id", existente.id)
      .select(SELECT_DESCARGA);
  }

  // Upsert por contacto: el mismo dentista que vuelve a usar la calculadora
  // actualiza su fila, no genera una nueva. DypOS no tiene dedupe y produce
  // duplicados en cada recarga.
  //
  // OJO: NO se puede resolver con `.upsert({ onConflict })` de supabase-js
  // (como proponía el borrador original). Verificado contra la base real:
  // los dos índices únicos de la migración de Task 1 son PARCIALES
  // (`WHERE email IS NOT NULL` / `WHERE phone IS NOT NULL`), y el de email
  // además es sobre una expresión (`lower(email)`, no la columna `email`).
  // PostgREST arma `ON CONFLICT (col)` a partir del nombre de columna que
  // le pasás en `onConflict` — no puede expresar el predicate parcial ni
  // una expresión — así que Postgres nunca encuentra un índice único que
  // matchee y tira 42P10 ("no unique or exclusion constraint matching").
  // Se resuelve a mano: SELECT por el contacto, UPDATE si existe, INSERT si
  // no. Como ya normalizamos `email` a minúsculas nosotros mismos antes de
  // guardar, el `.eq("email", email)` de `buscarExistente` es equivalente
  // al índice sobre `lower(email)` — no hace falta ILIKE.
  let dbError: { message: string } | null = null;
  let filaEscrita: InfoDescarga | null = null;
  const existente = await buscarExistente(supabaseAdmin, email, phone);
  const esNuevo = !existente;

  if (existente) {
    const { error, data: dataActualizada } = await actualizar(existente);
    if (error?.code === "23505") {
      // Dos escenarios posibles, y no se pueden distinguir de antemano:
      // (a) carrera real — otra request tocó el mismo contacto entre el
      //     SELECT de `buscarExistente` y este UPDATE — o (b) el caso raro
      //     del docstring de `buscarExistente`: el email matcheó esta fila
      //     pero el teléfono nuevo pertenece a OTRA fila distinta.
      const otraVez = await buscarExistente(supabaseAdmin, email, phone);
      if (otraVez && otraVez.id !== existente.id) {
        // Escenario (a): hay una fila más reciente que matchea mejor.
        const { error: error2, data: dataActualizada2 } = await actualizar(otraVez);
        dbError = error2;
        filaEscrita = dataActualizada2?.[0] ?? null;
      } else {
        // Escenario (b) (o (a) resuelto igual que antes): no perdemos el
        // lead entero por un solo campo cruzado con otra persona — se
        // reintenta sin la columna que chocó, dejando el valor que esa
        // fila ya tenía. No le "robamos" el dato a la otra fila.
        const campo = campoDelConflicto(error);
        const filaSinConflicto = campo ? { ...fila, [campo]: existente[campo] } : fila;
        const { error: error2, data: dataActualizada2 } = await supabaseAdmin
          .from("marketing_leads")
          .update({
            ...datosActualizacion(filaSinConflicto),
            submissions_count: existente.submissions_count + 1,
          })
          .eq("id", existente.id)
          .select(SELECT_DESCARGA);
        dbError = error2;
        filaEscrita = dataActualizada2?.[0] ?? null;
      }
    } else {
      dbError = error;
      filaEscrita = dataActualizada?.[0] ?? null;
    }
  } else {
    const { error, data: dataInsertada } = await supabaseAdmin
      .from("marketing_leads")
      .insert(fila)
      .select(SELECT_DESCARGA);
    if (error?.code === "23505") {
      // Carrera: otra request insertó el mismo contacto entre el SELECT y
      // el INSERT de arriba. Ya existe la fila — la actualizamos en vez de
      // fallar (perder el lead sería peor que una carrera bien resuelta).
      const reciente = await buscarExistente(supabaseAdmin, email, phone);
      if (reciente) {
        const { error: error2, data: dataActualizada } = await actualizar(reciente);
        dbError = error2;
        filaEscrita = dataActualizada?.[0] ?? null;
      } else {
        dbError = error;
      }
    } else {
      dbError = error;
      filaEscrita = dataInsertada?.[0] ?? null;
    }
  }

  if (dbError) throw new Error("No pudimos registrar tus datos. Prueba de nuevo.");

  // Antes de esto, un lead quedaba invisible salvo que alguien entrara a
  // `/admin/leads` por las suyas — ver notify-lead.server.ts. `await` a
  // propósito (no fire-and-forget): la función nunca lanza (try/catch propio),
  // así que no hay riesgo de que un fallo de Resend rompa el alta del lead,
  // y esperar evita que el proceso serverless se congele/mate la request
  // antes de que el envío termine.
  const { notificarNuevoLead } = await import("@/lib/marketing/notify-lead.server");
  await notificarNuevoLead({
    esNuevo,
    source: data.source,
    countryCode: data.countryCode,
    name: fila.name,
    clinicName: fila.clinic_name,
    email: fila.email,
    phone: fila.phone,
  });

  // Task 13: el checklist gatea un PDF detrás de un token de descarga. El
  // resto de los canales (calculadora, benchmark) no tienen nada que
  // descargar, así que ni siquiera miramos `filaEscrita` para ellos.
  //
  // Ronda de fix 1 (Important): si esta fila YA tiene
  // `download_delivered_at` (un lead que vuelve a llenar el mismo
  // formulario después de haber descargado), el token de un solo uso ya
  // se quemó — devolverlo igual sólo le muestra al lead un botón
  // "Descargar PDF" que el endpoint va a rechazar con 403. Sin
  // `downloadToken` en la respuesta, `LeadForm` no ofrece el botón (ver su
  // lógica condicional) y el mensaje de éxito queda el genérico, que
  // sigue siendo honesto — no hace falta texto especial nuevo.
  if (
    data.source === "checklist" &&
    filaEscrita?.download_token &&
    !filaEscrita.download_delivered_at
  ) {
    return { ok: true as const, downloadToken: filaEscrita.download_token };
  }

  return { ok: true as const };
});

/** Lectura de leads para el equipo de Esmalia. No existe un rol "staff de la
 *  empresa" en el schema (todos los roles son de clínica), así que el gate es
 *  una allowlist de emails por env var. */
export const listMarketingLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireEsmaliaStaffEmail(supabaseAdmin, context.userId, context.claims);

    const { data, error } = await supabaseAdmin
      .from("marketing_leads")
      .select(
        "id, email, phone, name, clinic_name, country_code, source, meta, submissions_count, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("No pudimos cargar los leads.");
    return data ?? [];
  });
