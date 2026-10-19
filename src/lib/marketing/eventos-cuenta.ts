// src/lib/marketing/eventos-cuenta.ts
//
// Lado cliente de `eventos-cuenta.functions.ts`. Nunca lanza ni bloquea más
// de lo necesario: la telemetría no puede trabar un registro ni un pago.

import { esTraficoInterno, hashDeSesion } from "@/lib/marketing/eventos";
import { esAltaReciente } from "@/lib/marketing/medicion";
import {
  registrarEventoDeCuenta,
  type ResultadoEventoCuenta,
} from "@/lib/marketing/eventos-cuenta.functions";

const CLAVE_REGISTRO = "esmalia:ev-registro";

type Pedido =
  | { name: "registro_completado" }
  | { name: "checkout_iniciado"; plan: "solo" | "clinica" }
  | { name: "suscripcion_activada"; clinicId: string };

async function enviar(pedido: Pedido): Promise<ResultadoEventoCuenta | null> {
  if (typeof window === "undefined") return null;
  try {
    return await registrarEventoDeCuenta({
      data: { ...pedido, sessionHash: hashDeSesion(), internoCliente: esTraficoInterno() },
    });
  } catch {
    return null;
  }
}

let registroEnVuelo = false;

/** En cada SIGNED_IN (lo llama la raíz): alta por email, vuelta de Google o
 *  enlace de confirmación. Filtro previo con las fechas de la sesión para no
 *  llamar al servidor en cada inicio de sesión de una cuenta vieja; el
 *  servidor vuelve a validarlo con `auth.users`. Una vez aceptado no se
 *  repite en la misma pestaña. */
export function registrarRegistroCompletado(usuario: {
  createdAt?: string | null;
  confirmadoAt?: string | null;
}): void {
  if (typeof window === "undefined" || registroEnVuelo) return;
  const ahora = new Date();
  if (!esAltaReciente(usuario.createdAt, ahora) && !esAltaReciente(usuario.confirmadoAt, ahora))
    return;
  try {
    if (window.sessionStorage.getItem(CLAVE_REGISTRO) === "1") return;
  } catch {
    // Sin storage: el servidor igual valida que sea una alta nueva.
  }
  registroEnVuelo = true;
  void enviar({ name: "registro_completado" })
    .then((r) => {
      if (!r?.registrado) return;
      try {
        window.sessionStorage.setItem(CLAVE_REGISTRO, "1");
      } catch {
        // no-op
      }
    })
    .finally(() => {
      registroEnVuelo = false;
    });
}

/** Antes de redirigir a Stripe. Espera como mucho `topeMs`: la navegación
 *  cortaría el pedido en vuelo, y el usuario no puede quedar esperando. */
export async function registrarCheckoutIniciado(
  plan: "solo" | "clinica",
  topeMs = 800,
): Promise<void> {
  await Promise.race([
    enviar({ name: "checkout_iniciado", plan }),
    new Promise((r) => setTimeout(r, topeMs)),
  ]);
}

/** Vuelta de Stripe con `?checkout=success`. Si el webhook todavía no
 *  escribió la suscripción, reintenta una vez a los pocos segundos. */
export async function registrarSuscripcionActivada(clinicId: string): Promise<void> {
  const primero = await enviar({ name: "suscripcion_activada", clinicId });
  if (primero?.pendiente) {
    await new Promise((r) => setTimeout(r, 5000));
    await enviar({ name: "suscripcion_activada", clinicId });
  }
}
