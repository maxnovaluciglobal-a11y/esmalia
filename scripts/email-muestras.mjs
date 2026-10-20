#!/usr/bin/env node
/**
 * Muestras de QA de los correos de ciclo de vida.
 *
 *   node scripts/email-muestras.mjs
 *
 * Genera `.email-muestras/*.html` (y `.txt`, la versión de texto plano) con
 * datos de ejemplo, llamando a LAS MISMAS funciones de plantilla que usa el
 * envío real (`src/lib/email/plantillas.ts`). No hay copias a mano: a DypOS
 * se le desincronizaron dos veces las muestras de los correos reales.
 *
 * Carga el TypeScript con Vite (dependencia directa del proyecto), así que
 * resuelve el alias `@/` igual que la app. No toca la base ni manda nada.
 *
 * El logo apunta a `--app-url` (por defecto producción). Para revisar con un
 * build local: `node scripts/email-muestras.mjs --app-url http://localhost:8080`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const salida = path.join(raiz, ".email-muestras");

const i = process.argv.indexOf("--app-url");
const appUrl = i > -1 ? process.argv[i + 1] : "https://esmalia.com";

const vite = await createServer({
  root: raiz,
  configFile: false,
  logLevel: "error",
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});

try {
  const t = await vite.ssrLoadModule("/src/lib/email/plantillas.ts");

  const semana = {
    clinicName: "Clínica Dental Sonrisa",
    currency: "CLP",
    semana: { desde: "2026-09-28", hasta: "2026-10-04" },
    cobradoCents: 4_870_000,
    cobradoPrevioCents: 4_120_000,
    citasAgendadas: 58,
    citasAtendidas: 49,
    tasaAsistencia: 84,
    ausencias: 6,
    ausenciasPrevias: 3,
    pacientesNuevos: 7,
    presupuestosCreados: 9,
    presupuestosAceptados: 4,
    conversion: 57,
    morosidad90Cents: 1_340_000,
    morosidad90Pacientes: 3,
    presupuestosSinSeguimiento: 3,
  };
  const bajaUrl = `${appUrl}/correos/baja?token=MUESTRA`;

  const muestras = {
    "1-bienvenida": t.correoBienvenida({
      appUrl,
      clinicName: "Clínica Dental Sonrisa",
      nombre: "Patricia Morales",
      finDePrueba: "2026-10-23",
      diasDePrueba: 14,
    }),
    "1b-llamada-pendiente": t.correoLlamadaPendiente({
      appUrl,
      clinicName: "Clínica Dental Sonrisa",
      nombre: "Patricia Morales",
    }),
    "2a-fin-de-prueba-t3": t.correoFinDePrueba({
      appUrl,
      clinicName: "Clínica Dental Sonrisa",
      nombre: "Patricia Morales",
      cuando: "t3",
      finDePrueba: "2026-10-15",
      citasAgendadas: 42,
      pacientesCargados: 186,
    }),
    "2b-fin-de-prueba-t0": t.correoFinDePrueba({
      appUrl,
      clinicName: "Clínica Dental Sonrisa",
      nombre: "Patricia Morales",
      cuando: "t0",
      finDePrueba: "2026-10-15",
      citasAgendadas: 0,
      pacientesCargados: 0,
    }),
    "3-suscripcion-activa": t.correoSuscripcionActiva({
      appUrl,
      clinicName: "Clínica Dental Sonrisa",
      nombre: "Patricia Morales",
      plan: "Clínica",
      montoCents: 6900,
      currency: "USD",
      intervalo: "mes",
      proximoCobro: "2026-11-09",
    }),
    "4-pago-fallido": t.correoPagoFallido({
      appUrl,
      clinicName: "Clínica Dental Sonrisa",
      nombre: "Patricia Morales",
      montoCents: 6900,
      currency: "USD",
      proximoIntento: "2026-10-12",
    }),
    "5a-semana": t.correoSemana({ appUrl, datos: semana, bajaUrl }),
    "5b-semana-sin-pagos": t.correoSemana({
      appUrl,
      datos: {
        ...semana,
        cobradoCents: null,
        cobradoPrevioCents: null,
        presupuestosSinSeguimiento: 0,
        ausencias: 2,
        ausenciasPrevias: 2,
        morosidad90Pacientes: 0,
        morosidad90Cents: 0,
        conversion: null,
      },
      bajaUrl,
    }),
  };

  mkdirSync(salida, { recursive: true });
  for (const [nombre, correo] of Object.entries(muestras)) {
    writeFileSync(path.join(salida, `${nombre}.html`), correo.html);
    writeFileSync(
      path.join(salida, `${nombre}.txt`),
      `Asunto: ${correo.subject}\n\n${correo.text}`,
    );
    console.log(`${nombre}: ${correo.subject}`);
  }
  console.log(`\nMuestras en ${path.relative(process.cwd(), salida) || salida}/`);
} finally {
  await vite.close();
}
