import { createFileRoute } from "@tanstack/react-router";

import { cronAutorizado } from "@/lib/cron-auth.server";
import {
  armarAviso,
  evaluarFrescuraDelBackup,
  tocaAvisar,
  type CorridaDeBackup,
} from "@/lib/backup-watchdog";

/**
 * Vigía del backup diario: avisa si no hay un backup exitoso reciente o si el
 * workflow no corre. Lo dispara cada hora Vercel Cron (vercel.json, minuto 52)
 * y, de respaldo, `.github/workflows/backup-watchdog.yml`, los dos con
 * `CRON_SECRET`. Es independiente de GitHub Actions a propósito: si el
 * scheduler de Actions falla, el vigía igual lo ve y avisa por correo.
 *
 * Lee la API pública de GitHub (el repo es público, sin token). Si GitHub no
 * responde o limita por IP, NO da falsa alarma: devuelve 502 y reporta a
 * Sentry. Destinatarios: `BACKUP_ALERT_EMAILS` (lista separada por comas, para
 * que llegue a más de una casilla) o, si falta, los de `LEADS_NOTIFY_EMAILS` /
 * `ESMALIA_STAFF_EMAILS`. Mientras el problema siga, el correo se repite cada
 * 6 h UTC; Sentry recibe un evento en cada corrida.
 *
 * Diseño y límites: `docs/BACKUPS.md` → «Alerta de backup atrasado».
 */
const REPO = process.env.GITHUB_REPOSITORY_BACKUP ?? "maxnovaluciglobal-a11y/esmalia";

export const Route = createFileRoute("/api/backup-watchdog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) return new Response("CRON_SECRET no configurado", { status: 500 });
        if (!cronAutorizado(request.headers.get("authorization"), secret)) {
          return new Response("unauthorized", { status: 401 });
        }

        const json = (cuerpo: unknown, status = 200) =>
          new Response(JSON.stringify(cuerpo), {
            status,
            headers: { "content-type": "application/json" },
          });

        const { capturarErrorDelServidor } = await import("@/lib/sentry.server");
        const ahora = new Date();

        let corridas: CorridaDeBackup[];
        try {
          const res = await fetch(
            `https://api.github.com/repos/${REPO}/actions/workflows/backup.yml/runs?per_page=15`,
            {
              headers: {
                accept: "application/vnd.github+json",
                "user-agent": "esmalia-backup-watchdog",
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
          const cuerpo = (await res.json()) as { workflow_runs?: CorridaDeBackup[] };
          if (!Array.isArray(cuerpo.workflow_runs))
            throw new Error("respuesta de GitHub sin workflow_runs");
          corridas = cuerpo.workflow_runs;
        } catch (err) {
          // No sabemos si el backup está bien: no se alarma, se reporta y se reintenta en una hora.
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[backup-watchdog] no se pudo consultar GitHub", msg);
          await capturarErrorDelServidor(
            new Error(`backup-watchdog: no se pudo consultar GitHub: ${msg}`),
            {
              ruta: "/api/backup-watchdog",
              metodo: "GET",
            },
          );
          return json({ estado: "indeterminado", error: msg }, 502);
        }

        const estado = evaluarFrescuraDelBackup(corridas, ahora);
        console.log(
          `[backup-watchdog] estado=${estado.estado} horas=${
            estado.horasDesdeElUltimoExito === null
              ? "n/a"
              : Math.round(estado.horasDesdeElUltimoExito)
          }`,
        );
        if (estado.estado === "ok") return json(estado);

        await capturarErrorDelServidor(new Error("El backup diario de Esmalia está atrasado"), {
          ruta: "/api/backup-watchdog",
          metodo: "GET",
        });

        let correo: "enviado" | "no-toca" | "sin-destinatarios" | "error" = "no-toca";
        if (tocaAvisar(ahora)) {
          const { destinatariosStaff } = await import("@/lib/marketing/notify-lead.server");
          const lista = process.env.BACKUP_ALERT_EMAILS?.trim()
            ? process.env.BACKUP_ALERT_EMAILS.split(",")
                .map((e) => e.trim())
                .filter(Boolean)
            : destinatariosStaff();
          const apiKey = process.env.RESEND_API_KEY;
          const from = process.env.EMAIL_FROM;
          if (lista.length === 0 || !apiKey || !from) {
            correo = "sin-destinatarios";
            console.error(
              "[backup-watchdog] backup atrasado y no hay a quién avisar (BACKUP_ALERT_EMAILS / RESEND_API_KEY / EMAIL_FROM)",
            );
          } else {
            try {
              const { Resend } = await import("resend");
              const aviso = armarAviso(estado, REPO);
              const { error } = await new Resend(apiKey).emails.send({
                from,
                to: lista,
                subject: aviso.asunto,
                text: aviso.texto,
                html: aviso.html,
              });
              if (error) throw new Error(error.message);
              correo = "enviado";
            } catch (err) {
              correo = "error";
              await capturarErrorDelServidor(err, {
                ruta: "/api/backup-watchdog correo",
                metodo: "GET",
              });
            }
          }
        }
        // 200 aunque esté atrasado: el endpoint funcionó. El problema va por correo y Sentry.
        return json({ ...estado, correo });
      },
    },
  },
});
