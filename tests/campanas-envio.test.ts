import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveEmailRecipient, type EmailSandboxConfig } from "@/lib/messaging/email-sandbox";
import {
  enviarTandaDeCorreo,
  type DependenciasDeEnvio,
  type DestinatarioReclamado,
  type PacienteAlEnviar,
} from "@/lib/seguimiento/envio-campana";

/**
 * CRM-04 · envío de campañas (Ola 8 · frente B).
 *
 * El núcleo del envío por correo (`enviarTandaDeCorreo`) con dependencias
 * falsas que imitan la base: un reclamo atómico (pendiente → enviando) y el
 * gate real del modo de prueba (`resolveEmailRecipient`). Comprueba que:
 *  - en modo de prueba nada llega a un paciente (se bloquea o se desvía);
 *  - la baja de correos se vuelve a mirar al enviar;
 *  - el correo va al destino confirmado (el del tutor, si era menor);
 *  - repetir el envío no duplica correos;
 *  - WhatsApp no tiene envío automático.
 * Y, sobre el código: ningún cron ni ruta de API toca las campañas, y abrir un
 * WhatsApp de campaña exige la sesión de una persona.
 */

type Estado = "pendiente" | "enviando" | "enviado" | "fallido";

function baseFalsa(opciones: {
  destinatarios: { id: string; patientId: string; destination: string }[];
  pacientes: Record<string, PacienteAlEnviar>;
  sandbox: EmailSandboxConfig;
  canal?: "correo" | "whatsapp";
}) {
  const estado = new Map<string, Estado>(opciones.destinatarios.map((d) => [d.id, "pendiente"]));
  const enviados: { to: string; subject: string; html: string }[] = [];
  const marcas: { id: string; status: string; reason: string | null }[] = [];
  const deps: DependenciasDeEnvio = {
    canal: opciones.canal ?? "correo",
    clinica: "Clínica Sonrisa",
    appUrl: "https://esmalia.test",
    asunto: "Tu control, {{paciente.primer_nombre}}",
    cuerpo: "Hola, {{paciente.primer_nombre}}.\n\nTe esperamos en {{clinica.nombre}}.",
    valoresBase: (paciente) => ({
      "paciente.nombre": paciente,
      "paciente.primer_nombre": paciente.split(" ")[0],
      "clinica.nombre": "Clínica Sonrisa",
    }),
    // Como `reclamar_envios_de_campana`: solo pendientes, y los marca.
    reclamar: async (limite) => {
      const tomados: DestinatarioReclamado[] = [];
      for (const d of opciones.destinatarios) {
        if (tomados.length >= limite) break;
        if (estado.get(d.id) !== "pendiente") continue;
        estado.set(d.id, "enviando");
        tomados.push(d);
      }
      return tomados;
    },
    paciente: async (id) => opciones.pacientes[id] ?? null,
    enlaceDeBaja: async (id) => `https://esmalia.test/correos/baja?t=${id}`,
    // Como `sendEmail`: el gate del modo de prueba decide el destinatario real.
    enviar: async (correo) => {
      const decision = resolveEmailRecipient(correo.to, opciones.sandbox);
      if (decision.action === "block") return { ok: false, reason: decision.reason };
      enviados.push({ ...correo, to: decision.recipient });
      return { ok: true, externalId: `ext-${enviados.length}` };
    },
    registrar: async () => `msg-${Math.random().toString(36).slice(2)}`,
    marcar: async (id, cambio) => {
      const actual = estado.get(id);
      if (actual !== "enviando") throw new Error(`transición inválida desde ${actual}`);
      estado.set(id, cambio.status);
      marcas.push({ id, status: cambio.status, reason: cambio.reason });
    },
  };
  return { deps, estado, enviados, marcas };
}

const PRODUCCION: EmailSandboxConfig = {
  mode: "production",
  redirectTo: "",
  allowlist: [],
  redirectEnabled: false,
  prefixSubject: false,
  minEntregasProduccion: 0,
};

const pacientes: Record<string, PacienteAlEnviar> = {
  p1: { nombre: "Ana Pérez", emailOptOutAt: null, archivado: false },
  p2: { nombre: "Beto Soto", emailOptOutAt: "2026-10-26T10:00:00Z", archivado: false },
  p3: { nombre: "Caro Díaz", emailOptOutAt: null, archivado: false },
};

const destinatarios = [
  { id: "r1", patientId: "p1", destination: "ana@ejemplo.cl" },
  { id: "r2", patientId: "p2", destination: "beto@ejemplo.cl" },
  // Menor: el destino confirmado es el correo del tutor.
  { id: "r3", patientId: "p3", destination: "mama.de.caro@ejemplo.cl" },
];

describe("CRM-04 · campaña por correo", () => {
  it("en producción envía al destino confirmado (tutor incluido) y personaliza el texto", async () => {
    const { deps, enviados, estado } = baseFalsa({ destinatarios, pacientes, sandbox: PRODUCCION });
    const r = await enviarTandaDeCorreo(deps, 25);
    expect(r).toEqual({ procesados: 3, enviados: 2, fallidos: 1, quedan: false });
    expect(enviados.map((e) => e.to)).toEqual(["ana@ejemplo.cl", "mama.de.caro@ejemplo.cl"]);
    expect(enviados[0].subject).toBe("Tu control, Ana");
    expect(enviados[0].html).toContain("Hola, Ana.");
    expect(enviados[0].html).toContain("https://esmalia.test/correos/baja?t=p1");
    expect(estado.get("r2")).toBe("fallido");
  });

  it("respeta la baja de correos al momento de enviar", async () => {
    const { deps, enviados, marcas } = baseFalsa({ destinatarios, pacientes, sandbox: PRODUCCION });
    await enviarTandaDeCorreo(deps, 25);
    expect(enviados.some((e) => e.to === "beto@ejemplo.cl")).toBe(false);
    expect(marcas.find((m) => m.id === "r2")?.reason).toMatch(/baja/);
  });

  it("en modo de prueba sin redirección no sale ningún correo", async () => {
    const sandbox: EmailSandboxConfig = { ...PRODUCCION, mode: "sandbox" };
    const { deps, enviados, estado } = baseFalsa({ destinatarios, pacientes, sandbox });
    const r = await enviarTandaDeCorreo(deps, 25);
    expect(enviados).toEqual([]);
    expect(r.enviados).toBe(0);
    expect([...estado.values()].every((e) => e === "fallido")).toBe(true);
  });

  it("en modo de prueba con redirección todo llega a la casilla de pruebas, nunca al paciente", async () => {
    const sandbox: EmailSandboxConfig = {
      ...PRODUCCION,
      mode: "sandbox",
      redirectEnabled: true,
      redirectTo: "pruebas@clinica.cl",
    };
    const { deps, enviados } = baseFalsa({ destinatarios, pacientes, sandbox });
    await enviarTandaDeCorreo(deps, 25);
    expect(enviados.length).toBeGreaterThan(0);
    expect(enviados.every((e) => e.to === "pruebas@clinica.cl")).toBe(true);
  });

  it("repetir el envío (doble clic, otra pestaña) no duplica correos", async () => {
    const { deps, enviados } = baseFalsa({ destinatarios, pacientes, sandbox: PRODUCCION });
    const [a, b] = await Promise.all([
      enviarTandaDeCorreo(deps, 25),
      enviarTandaDeCorreo(deps, 25),
    ]);
    const c = await enviarTandaDeCorreo(deps, 25);
    expect(a.procesados + b.procesados + c.procesados).toBe(3);
    expect(c.procesados).toBe(0);
    expect(enviados).toHaveLength(2);
    expect(new Set(enviados.map((e) => e.to)).size).toBe(2);
  });

  it("de a tandas: avisa que quedan pendientes", async () => {
    const { deps } = baseFalsa({ destinatarios, pacientes, sandbox: PRODUCCION });
    const primera = await enviarTandaDeCorreo(deps, 2);
    expect(primera).toMatchObject({ procesados: 2, quedan: true });
    const segunda = await enviarTandaDeCorreo(deps, 2);
    expect(segunda).toMatchObject({ procesados: 1, quedan: false });
  });
});

describe("CRM-04 · WhatsApp nunca se envía solo", () => {
  it("el envío automático rechaza una campaña por WhatsApp sin reclamar a nadie", async () => {
    const { deps, estado } = baseFalsa({
      destinatarios,
      pacientes,
      sandbox: PRODUCCION,
      canal: "whatsapp",
    });
    await expect(enviarTandaDeCorreo(deps, 25)).rejects.toThrow(/WhatsApp no se envía sola/);
    expect([...estado.values()].every((e) => e === "pendiente")).toBe(true);
  });

  const RAIZ = path.resolve(__dirname, "..");
  const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

  it("ningún cron, workflow ni ruta de API toca las campañas", () => {
    const vercel = leer("vercel.json");
    expect(vercel).not.toMatch(/campan|outreach_campaign|seguimiento/i);
    const workflows = readdirSync(path.join(RAIZ, ".github/workflows")).map((f) =>
      leer(`.github/workflows/${f}`),
    );
    for (const w of workflows) expect(w).not.toMatch(/campan|outreach_campaign/i);
    const apis = readdirSync(path.join(RAIZ, "src/routes")).filter((f) => f.startsWith("api."));
    for (const f of apis) {
      if (f === "api.demo-reset.ts") continue; // siembra la demo con el rol de servicio
      expect(leer(`src/routes/${f}`), f).not.toMatch(
        /outreach_campaign|abrirWhatsAppDeCampana|enviarTandaDeCampana/,
      );
    }
  });

  it("abrir un WhatsApp de campaña pasa por la sesión del usuario y deja el mensaje 'en cola'", () => {
    const fuente = leer("src/lib/seguimiento/campanas.functions.ts");
    const inicio = fuente.indexOf("export const abrirWhatsAppDeCampana");
    const bloque = fuente.slice(inicio, fuente.indexOf("export const omitirDestinatario"));
    expect(bloque).toContain(".middleware([requireEscritura])");
    expect(bloque).toContain('status: "queued"');
    expect(bloque).not.toMatch(/tryMetaTemplateSend|graph\.facebook/);
    expect(bloque).toContain("buildWaMeUrl");
  });

  it("un segmento guardado de Pacientes entra por resolverSegmento y pasa igual por las bajas del canal", () => {
    const fuente = leer("src/lib/seguimiento/campanas.server.ts");
    expect(fuente).toContain('from "@/lib/patients/segmentos.server"');
    expect(fuente).toMatch(/resolverSegmento\(supabase, args\)/);
    // Todo el grupo (filtro o segmento) pasa por `elegibilidad`, que aplica bajas y consentimiento.
    expect(fuente).toMatch(/elegibilidad: elegibilidad\(/);
    expect(fuente).not.toContain("todavía no están disponibles");
  });

  it("la base exige una persona para marcar un WhatsApp de campaña como abierto", () => {
    const sql = leer("supabase/migrations/20261105200000_seguimiento_de_pacientes.sql");
    expect(sql).toMatch(/new\.status = 'abierto' and auth\.uid\(\) is null/);
    expect(sql).toMatch(/c\.channel = 'correo'/);
  });
});
