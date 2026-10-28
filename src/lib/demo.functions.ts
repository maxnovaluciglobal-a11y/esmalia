import { createServerFn } from "@tanstack/react-start";

import { diaEnLaZona, ZONA_DE_LA_DEMO } from "@/lib/demo/dia-de-la-clinica";

/**
 * Freno anti-ráfaga (hallazgo de la auditoría de service_role, 25-sep): esta
 * función es pública y sin sesión a propósito, así que cualquiera puede
 * llamarla en loop. El chequeo de estado ("al día") ya la vuelve un no-op el
 * 99.9 % del día; el único hueco real es la ventana de la medianoche de la
 * clínica, donde varias requests concurrentes podrían pasar el chequeo antes
 * de que la primera termine. `reiniciarLaDemo` comparte el trabajo en curso
 * dentro de una instancia y este cooldown en memoria corta las ráfagas. No es
 * un rate limit general y es por instancia (Vercel puede tener varias tibias),
 * pero alcanza: el impacto de perder la carrera es "la demo se resetea dos
 * veces seguidas", nunca tocar datos de un tenant real (la clínica demo es
 * fija).
 */
const COOLDOWN_MS = 60_000;
let ultimoIntentoDeReset = 0;
/** Cuándo se comprobó por última vez que la demo estaba al día (en esta instancia). */
const REVISION_VIGENTE_MS = 5 * 60_000;
let ultimaRevisionAlDia = { en: 0, dia: "" };

/**
 * Auto-reset de la clínica demo bajo demanda: el cron de Vercel (vercel.json)
 * llama a `/api/demo-reset`, pero depende de que CRON_SECRET esté configurado
 * y de que corra a tiempo. Este server fn corre en el mismo click de "Entrar a
 * la demo" (src/routes/demo.tsx) y deja la demo al día si hace falta.
 *
 * Antes solo llamaba a la función SQL `reset_demo_clinic()`, que recrea la
 * clínica pero no trae los pasos de siembra de la app (cobros de hoy, cuentas
 * por cobrar, documento…): el primer visitante después de la medianoche de
 * Santiago veía la Caja en $0 y media app vacía hasta el cron de la madrugada.
 * Ahora usa el mismo reseteo completo que el cron (`reiniciarLaDemo`) y mira,
 * además de la fecha, que cada sección tenga datos.
 */
export const ensureDemoClinicFresh = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { reiniciarLaDemo, estadoActualDeLaDemo } = await import("@/lib/demo/reseteo.server");

  // Al día hace poco: sin consultar las ~70 áreas en cada entrada. El cambio de día lo
  // atrapa el cron horario o la primera entrada pasados 5 minutos.
  const hoy = diaEnLaZona(ZONA_DE_LA_DEMO);
  if (ultimaRevisionAlDia.dia === hoy && Date.now() - ultimaRevisionAlDia.en < REVISION_VIGENTE_MS)
    return { reset: false };
  const { estado } = await estadoActualDeLaDemo(supabaseAdmin);
  if (estado === "al-dia") {
    ultimaRevisionAlDia = { en: Date.now(), dia: hoy };
    return { reset: false };
  }

  const ahora = Date.now();
  if (ahora - ultimoIntentoDeReset < COOLDOWN_MS) return { reset: false };
  ultimoIntentoDeReset = ahora;

  try {
    const r = await reiniciarLaDemo(supabaseAdmin, { soloSiHaceFalta: true });
    ultimaRevisionAlDia = { en: 0, dia: "" };
    return { reset: r.accion !== "nada" };
  } catch (e) {
    console.error("[demo-fresh] reiniciarLaDemo failed", e instanceof Error ? e.message : e);
    return { reset: false };
  }
});
