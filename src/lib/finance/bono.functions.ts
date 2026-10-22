import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import {
  calcularCopago,
  MEDIO_DEL_BONO,
  partesDelCobro,
  TIPO_DE_BONO_LABEL,
  TIPOS_DE_BONO,
  TRAMOS_FONASA,
  type TipoDeBono,
} from "@/lib/finance/bono-copago";
import { formatMoney, netAfterRetention, PAYMENT_METHODS } from "@/lib/finance/finance";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Cobro de una prestación con bono Fonasa / isapre y copago (MKT-03).
 *
 * Genera hasta dos filas en `payments`, en UNA sola sentencia (o entran las
 * dos o ninguna): la del bono y, si queda copago, la del paciente. Las dos
 * comparten `coverage_group_id` y llevan el desglose congelado. Como son
 * pagos normales, el saldo del paciente, la caja y los reportes las suman sin
 * cambios. La RLS de `payments` (sin assistant, regla 2) es el par en el
 * servidor del gate de la ficha (regla 15). Moneda: el trigger (regla 14).
 */

/** Previsión de la ficha, para proponer el tipo de bono y el tramo. */
export const previsionDelPaciente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ prevision: string | null; tramo: string | null; institucion: string | null }> => {
      const { data: fila, error } = await context.supabase
        .from("patients")
        .select("health_plan, health_plan_tier, health_plan_institution")
        .eq("id", data.patientId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      // Sin la columna (base vieja) o sin permiso: se cobra igual, sin sugerencia.
      if (error || !fila) return { prevision: null, tramo: null, institucion: null };
      return {
        prevision: fila.health_plan,
        tramo: fila.health_plan_tier,
        institucion: fila.health_plan_institution,
      };
    },
  );

const CobroConBonoSchema = z
  .object({
    clinicId: z.string().uuid(),
    patientId: z.string().uuid(),
    /** Lo genera el equipo: un reintento no cobra dos veces. */
    grupoId: z.string().uuid(),
    tipo: z.enum(TIPOS_DE_BONO),
    numeroBono: z.string().trim().min(1, "Ingresa el número del bono.").max(40),
    asegurador: z.string().trim().max(80).nullish(),
    tramo: z.enum(TRAMOS_FONASA).nullish(),
    precioCents: z.number().int().positive("Ingresa el precio de la prestación."),
    /** MLE / isapre: lo que cubre el bono. */
    bonoCents: z.number().int().positive().nullish(),
    /** PAD: copago fijo del paquete. */
    copagoCents: z.number().int().min(0).nullish(),
    /** Medio con que paga el copago el paciente (si hay copago). */
    metodoCopago: z.enum(PAYMENT_METHODS).default("cash"),
    medioCopagoId: z.string().uuid().nullish(),
    paidAt: z
      .string()
      .optional()
      .refine((s) => !s || !Number.isNaN(new Date(s).getTime()), "Fecha de pago inválida.")
      .refine(
        (s) => !s || new Date(s) <= new Date(),
        "No se puede registrar un pago con fecha futura.",
      ),
    treatmentPlanId: z.string().uuid().nullish(),
    treatmentItemId: z.string().uuid().nullish(),
    notas: z.string().trim().max(300).nullish(),
  })
  .refine((d) => d.tipo !== "isapre" || Boolean(d.asegurador?.trim()), {
    message: "Indica la isapre que emitió el bono.",
    path: ["asegurador"],
  });

export type CobroConBonoInput = z.input<typeof CobroConBonoSchema>;

export const registrarCobroConBono = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => CobroConBonoSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ grupoId: string; bonoCents: number; copagoCents: number }> => {
      const { supabase } = context;
      const resultado = calcularCopago(
        data.tipo === "fonasa_pad"
          ? {
              tipo: "fonasa_pad",
              precioCents: data.precioCents,
              copagoCents: data.copagoCents ?? null,
            }
          : { tipo: data.tipo, precioCents: data.precioCents, bonoCents: data.bonoCents ?? null },
      );
      if (!resultado.ok) throw new Error(resultado.motivo);

      // Reintento del mismo cobro (doble clic, red que se corta): ya está.
      const { data: previas } = await supabase
        .from("payments")
        .select("id")
        .eq("clinic_id", data.clinicId)
        .eq("coverage_group_id", data.grupoId)
        .limit(1);
      if (previas?.length)
        return {
          grupoId: data.grupoId,
          bonoCents: resultado.bonoCents,
          copagoCents: resultado.copagoCents,
        };

      const tipo: TipoDeBono = data.tipo;
      const nombreBono = MEDIO_DEL_BONO[tipo];

      // Medios configurados de la clínica (G-6): si la clínica creó uno con
      // el nombre del bono ("Bono Fonasa"), la parte del bono lo usa; el del
      // copago es el que eligió la recepción. Nombre y neto quedan
      // congelados (regla 10).
      const { data: medios } = await supabase
        .from("payment_methods")
        .select("id, name, retention_pct")
        .eq("clinic_id", data.clinicId);
      const medioBono = (medios ?? []).find(
        (m) => m.name.trim().toLowerCase() === nombreBono.toLowerCase(),
      );
      const medioCopago = data.medioCopagoId
        ? (medios ?? []).find((m) => m.id === data.medioCopagoId)
        : undefined;

      // Misma regla que registerPayment: solo se vincula a la caja abierta
      // cuando hay una sola sin sucursal.
      const { data: cajaAbierta } = await supabase
        .from("cash_registers")
        .select("id")
        .eq("clinic_id", data.clinicId)
        .eq("status", "open")
        .is("branch_id", null)
        .maybeSingle();

      const paidAt = data.paidAt ?? new Date().toISOString();

      // Solo para el texto de la nota: la moneda de la fila la fija el trigger.
      const { data: clinica } = await supabase
        .from("clinics")
        .select("currency")
        .eq("id", data.clinicId)
        .maybeSingle();
      const moneda = clinica?.currency ?? "CLP";
      const resumen =
        `${TIPO_DE_BONO_LABEL[tipo]} N.º ${data.numeroBono}` +
        (data.asegurador ? ` (${data.asegurador})` : "") +
        `: precio ${formatMoney(resultado.precioCents, moneda)}, bono ${formatMoney(resultado.bonoCents, moneda)}, copago ${formatMoney(resultado.copagoCents, moneda)}.` +
        (data.notas ? ` ${data.notas}` : "");

      const comun = {
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        cash_register_id: cajaAbierta?.id ?? null,
        paid_at: paidAt,
        treatment_plan_id: data.treatmentPlanId ?? null,
        treatment_item_id: data.treatmentItemId ?? null,
        coverage_group_id: data.grupoId,
        coverage_kind: tipo,
        voucher_number: data.numeroBono,
        coverage_insurer: data.asegurador?.trim() || (tipo === "isapre" ? null : "Fonasa"),
        coverage_tier: data.tramo ?? null,
        coverage_price_cents: resultado.precioCents,
        voucher_cents: resultado.bonoCents,
        notes: resumen.slice(0, 500),
      };

      const filas = partesDelCobro(resultado).map((parte) =>
        parte.rol === "bono"
          ? {
              ...comun,
              coverage_role: "bono" as const,
              amount_cents: parte.montoCents,
              method: "other" as const,
              payment_method_id: medioBono?.id ?? null,
              method_name_snapshot: medioBono?.name ?? nombreBono,
              // Lo cobra la clínica al asegurador: entra completo salvo que
              // la clínica haya configurado una retención para ese medio.
              net_cents: netAfterRetention(
                parte.montoCents,
                Number(medioBono?.retention_pct ?? 0) || 0,
              ),
              reference: `Bono N.º ${data.numeroBono}`,
            }
          : {
              ...comun,
              coverage_role: "copago" as const,
              amount_cents: parte.montoCents,
              method: data.metodoCopago,
              payment_method_id: medioCopago?.id ?? null,
              method_name_snapshot: medioCopago?.name ?? null,
              net_cents: medioCopago
                ? netAfterRetention(parte.montoCents, Number(medioCopago.retention_pct) || 0)
                : null,
              reference: `Copago bono N.º ${data.numeroBono}`,
            },
      );

      const { error } = await supabase.from("payments").insert(filas);
      if (error)
        throw new Error(
          mensajeDb(
            error,
            "No pudimos guardar el cobro. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda registrar pagos.",
          ),
        );
      return {
        grupoId: data.grupoId,
        bonoCents: resultado.bonoCents,
        copagoCents: resultado.copagoCents,
      };
    },
  );
