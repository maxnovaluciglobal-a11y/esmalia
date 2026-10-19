import { z } from "zod";

import { gatewayChat, resolverProveedorIa } from "@/lib/ai-gateway.server";
import type {
  FranjaDelDia,
  IntencionDeAgenda,
  LecturaDeAgenda,
} from "@/lib/messaging/intencion-de-agenda";

/**
 * El modelo, para el 20% de mensajes que `interpretarMensajeDeAgenda` (reglas
 * deterministas) no puede leer con confianza. Este archivo existe separado
 * de `intencion-de-agenda.ts` a propósito — ese archivo documenta en su
 * propio encabezado que NO usa un modelo de lenguaje, y agregarle una
 * dependencia de red ahí contradiría lo que dice de sí mismo.
 *
 * Se activa solo si el interruptor `AI_ENABLED` vale "true" Y hay una
 * clave cargada (`resolverProveedorIa` devuelve null si falta cualquiera de
 * las dos). Hoy Patty está pausada (docs/IA.md): `interpretarConIA` devuelve
 * `null` de inmediato, sin llamar a ningún modelo, y el webhook sigue con
 * las reglas y el aviso genérico. El texto del paciente pasa por
 * `redactarPii` en el gateway (teléfonos, emails, documentos). Cualquier error de red, de parseo o de forma inesperada también
 * devuelve `null`: un falso negativo acá lo resuelve un humano leyendo la
 * bandeja (como ya pasaba), y eso es preferible a que un error de la IA
 * tumbe el webhook de WhatsApp.
 *
 * Deliberadamente el resultado de esta función NUNCA activa el auto-confirm
 * de citas (`505eb7d`) ni agenda nada por sí sola: el llamador
 * (`anotarSolicitudDeAgenda` en `api.whatsapp-webhook.ts`) trata su salida
 * exactamente igual que la de las reglas — crea una `appointment_request`
 * PENDIENTE para "agendar" con fecha, nunca confirma ni mueve una cita.
 */

const MAX_LARGO_IA = 500;

const RESPUESTA_IA_SCHEMA = z.object({
  intencion: z.enum(["agendar", "reagendar", "cancelar"]).nullable(),
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  franja: z.enum(["manana", "tarde"]).nullable(),
});

function isoDeHoy(hoy: Date): string {
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, "0");
  const d = String(hoy.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const SYSTEM_PROMPT = `Lees mensajes de WhatsApp de pacientes de una clínica dental, en español latinoamericano.
Devuelve SOLO un JSON con esta forma exacta, sin texto ni explicación adicional:
{"intencion": "agendar" | "reagendar" | "cancelar" | null, "fecha": "YYYY-MM-DD" | null, "franja": "manana" | "tarde" | null}

Reglas:
- "agendar": pide o quiere una hora/cita nueva.
- "reagendar": quiere cambiar o mover una cita que ya tiene.
- "cancelar": quiere cancelar su cita, o avisa que no va a poder ir.
- Si el mensaje no tiene relación clara con agendar, mover o cancelar una cita — un saludo, una pregunta de precio, un "gracias" — devuelve intencion: null.
- Si el mensaje mezcla dos intenciones contradictorias (ej. cancelar Y reagendar a la vez), devuelve intencion: null — no adivines cuál prevalece.
- "fecha" solo si el mensaje la menciona sin ambigüedad. No inventes una fecha que no está en el texto.
- Responde ÚNICAMENTE el JSON.`;

/**
 * Intenta leer el mensaje con el modelo configurado. `null` si no hay
 * proveedor de IA, si el mensaje es demasiado largo, o si cualquier cosa
 * sale mal — nunca lanza.
 */
export async function interpretarConIA(texto: string, hoy: Date): Promise<LecturaDeAgenda | null> {
  if (!texto || texto.length > MAX_LARGO_IA) return null;
  if (!resolverProveedorIa()) return null;

  try {
    const respuesta = await gatewayChat({
      system: SYSTEM_PROMPT,
      user: `Hoy es ${isoDeHoy(hoy)}. Mensaje del paciente: "${texto}"`,
      json: true,
    });
    const parsed = RESPUESTA_IA_SCHEMA.safeParse(JSON.parse(respuesta));
    if (!parsed.success || !parsed.data.intencion) return null;

    return {
      intencion: parsed.data.intencion as IntencionDeAgenda,
      fecha: parsed.data.fecha,
      franja: parsed.data.franja as FranjaDelDia | null,
    };
  } catch (error) {
    console.error("[whatsapp] interpretarConIA falló (se sigue con el aviso genérico):", error);
    return null;
  }
}
