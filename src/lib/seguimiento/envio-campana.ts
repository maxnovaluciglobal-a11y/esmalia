/**
 * CRM-04 · Envío de una campaña por correo (Ola 8). El núcleo del envío, con
 * sus dependencias inyectadas para poder probarlo sin red ni base:
 *
 *  1. Reclama una tanda de destinatarios (`reclamar`: pendiente → enviando,
 *     atómico en la base). Lo que no se reclamó no sale; lo reclamado no se
 *     vuelve a reclamar, así que repetir el envío (doble clic, dos pestañas,
 *     un reintento) nunca duplica un correo.
 *  2. Por cada uno vuelve a mirar la baja de correos al momento de enviar
 *     (pudo darse de baja después de confirmar la campaña).
 *  3. Envía con `enviar`, que aplica el modo de prueba de la clínica
 *     (`email_sandbox_config`): en prueba bloquea o desvía, nunca llega a un
 *     paciente real.
 *  4. Registra el mensaje y marca el destinatario enviado o "no salió" con el
 *     motivo. Un error con un paciente no frena a los demás.
 *
 * WhatsApp no pasa por acá: su cola la despacha una persona, de a uno.
 */
import { correoDeCampana } from "@/lib/seguimiento/correo-campana";
import { renderMensaje, type ValoresDeMensaje } from "@/lib/seguimiento/plantillas";

export interface DestinatarioReclamado {
  id: string;
  patientId: string;
  destination: string;
}

export interface PacienteAlEnviar {
  nombre: string;
  emailOptOutAt: string | null;
  archivado: boolean;
}

export type ResultadoDeEnvio =
  { ok: true; externalId: string | null } | { ok: false; reason: string };

export interface DependenciasDeEnvio {
  canal: "correo" | "whatsapp";
  clinica: string;
  appUrl: string;
  asunto: string;
  cuerpo: string;
  valoresBase: (paciente: string, patientId: string) => ValoresDeMensaje;
  reclamar: (limite: number) => Promise<DestinatarioReclamado[]>;
  paciente: (patientId: string) => Promise<PacienteAlEnviar | null>;
  enlaceDeBaja: (patientId: string) => Promise<string | null>;
  enviar: (correo: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<ResultadoDeEnvio>;
  registrar: (m: {
    patientId: string;
    destino: string;
    html: string;
    resultado: ResultadoDeEnvio;
  }) => Promise<string | null>;
  marcar: (
    id: string,
    cambio: { status: "enviado" | "fallido"; reason: string | null; messageId: string | null },
  ) => Promise<void>;
}

export interface ResumenDeTanda {
  procesados: number;
  enviados: number;
  fallidos: number;
  /** Puede haber más pendientes (la tanda vino llena). */
  quedan: boolean;
}

export async function enviarTandaDeCorreo(
  deps: DependenciasDeEnvio,
  limite: number,
): Promise<ResumenDeTanda> {
  if (deps.canal !== "correo") {
    throw new Error(
      "Una campaña por WhatsApp no se envía sola: cada mensaje lo abre una persona desde la cola.",
    );
  }
  const tanda = await deps.reclamar(limite);
  let enviados = 0;
  let fallidos = 0;

  for (const d of tanda) {
    try {
      const paciente = await deps.paciente(d.patientId);
      if (!paciente || paciente.archivado) {
        await deps.marcar(d.id, {
          status: "fallido",
          reason: "La ficha del paciente ya no está activa.",
          messageId: null,
        });
        fallidos += 1;
        continue;
      }
      if (paciente.emailOptOutAt) {
        await deps.marcar(d.id, {
          status: "fallido",
          reason: "El paciente se dio de baja de los correos antes del envío.",
          messageId: null,
        });
        fallidos += 1;
        continue;
      }
      const valores = deps.valoresBase(paciente.nombre, d.patientId);
      const asunto = renderMensaje(deps.asunto, valores).replace(/\s+/g, " ").trim();
      const mensaje = renderMensaje(deps.cuerpo, valores);
      const correo = correoDeCampana({
        appUrl: deps.appUrl,
        asunto,
        mensaje,
        clinica: deps.clinica,
        bajaUrl: await deps.enlaceDeBaja(d.patientId),
      });
      const resultado = await deps.enviar({
        to: d.destination,
        subject: correo.subject,
        html: correo.html,
        text: correo.text,
      });
      const messageId = await deps.registrar({
        patientId: d.patientId,
        destino: d.destination,
        html: correo.html,
        resultado,
      });
      await deps.marcar(d.id, {
        status: resultado.ok ? "enviado" : "fallido",
        reason: resultado.ok ? null : resultado.reason,
        messageId,
      });
      if (resultado.ok) enviados += 1;
      else fallidos += 1;
    } catch (e) {
      fallidos += 1;
      try {
        await deps.marcar(d.id, {
          status: "fallido",
          reason: e instanceof Error ? e.message.slice(0, 400) : "Error inesperado al enviar.",
          messageId: null,
        });
      } catch {
        // Queda "enviando": no se reintenta solo (mejor un correo de menos que uno repetido).
      }
    }
  }

  return { procesados: tanda.length, enviados, fallidos, quedan: tanda.length >= limite };
}
