// src/lib/marketing/eventos-cuenta.functions.ts
//
// Eventos del embudo que dispara el navegador de un usuario con sesión
// (registro, checkout, vuelta del checkout) pero que valida y escribe el
// servidor. Pasan por acá y no por `/api/ev` por dos razones: el servidor
// sabe si el usuario es del equipo o de la demo (`interno`), y puede
// comprobar que el hecho ocurrió (cuenta recién creada, suscripción que
// Stripe ya creó) en vez de creerle al cliente.
//
// El `sessionHash` viene del cliente para unir el evento con la visita de
// entrada de la misma pestaña (atribución por UTM / referrer). Es el mismo
// id aleatorio de `/api/ev`; nunca se guarda el id del usuario.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { esAltaReciente, suscripcionConfirmada } from "@/lib/marketing/medicion";

const Entrada = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("registro_completado"),
    sessionHash: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    internoCliente: z.boolean().optional(),
  }),
  z.object({
    name: z.literal("checkout_iniciado"),
    sessionHash: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    internoCliente: z.boolean().optional(),
    plan: z.enum(["solo", "clinica"]),
  }),
  z.object({
    name: z.literal("suscripcion_activada"),
    sessionHash: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    internoCliente: z.boolean().optional(),
    clinicId: z.string().uuid(),
  }),
]);

export type ResultadoEventoCuenta = { registrado: boolean; pendiente?: boolean };

export const registrarEventoDeCuenta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Entrada.parse(input))
  .handler(async ({ data, context }): Promise<ResultadoEventoCuenta> => {
    const { datosDelUsuario, registrarEventoServidor, conInterno } =
      await import("@/lib/marketing/eventos-servidor.server");
    const usuario = await datosDelUsuario(context.userId);
    const interno = usuario.interno || data.internoCliente === true;

    if (data.name === "registro_completado") {
      // Un inicio de sesión de una cuenta vieja no es un registro. Cuenta
      // recién creada, o recién confirmada (el enlace del correo puede
      // llegar horas después del alta).
      const ahora = new Date();
      if (!esAltaReciente(usuario.createdAt, ahora) && !esAltaReciente(usuario.confirmadoAt, ahora))
        return { registrado: false };
      const metodo = usuario.proveedor === "google" ? "google" : "email";
      await registrarEventoServidor(
        "registro_completado",
        conInterno({ metodo }, interno),
        data.sessionHash,
      );
      return { registrado: true };
    }

    if (data.name === "checkout_iniciado") {
      await registrarEventoServidor(
        "checkout_iniciado",
        conInterno({ plan: data.plan }, interno),
        data.sessionHash,
      );
      return { registrado: true };
    }

    // suscripcion_activada: lee la fila que escribe el webhook de Stripe, con
    // el cliente del usuario (RLS: sólo miembros de la clínica). No toca la
    // lógica de billing. Si el webhook todavía no llegó, `pendiente`.
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("status, stripe_subscription_id")
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) return { registrado: false };
    if (!suscripcionConfirmada(sub)) return { registrado: false, pendiente: true };

    const { data: clinica } = await context.supabase
      .from("clinics")
      .select("is_demo")
      .eq("id", data.clinicId)
      .maybeSingle();
    await registrarEventoServidor(
      "suscripcion_activada",
      conInterno(
        { estado: sub!.status, fuente: "retorno_checkout" },
        interno || Boolean(clinica?.is_demo),
      ),
      data.sessionHash,
    );
    return { registrado: true };
  });
