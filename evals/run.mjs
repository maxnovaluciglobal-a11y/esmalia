#!/usr/bin/env node
/**
 * Evals de Patty (requisito IA-05, docs/IA.md). Corre los casos sintéticos de
 * `evals/casos/` contra el proveedor configurado para un uso, con el MISMO
 * gateway y los MISMOS prompts que la app (`src/lib/ai-gateway.server.ts`,
 * `src/lib/ai/prompts.ts`).
 *
 *   node evals/run.mjs --uso clinico   # apuntes -> SOAP (30) + nota -> entidades (30)
 *   node evals/run.mjs --uso agenda    # WhatsApp -> intención y fecha (50)
 *
 * Opciones: --limite N (solo los primeros N casos de cada set), --modelo ID.
 *
 * Salvaguardas:
 *   - No corre sin la clave del proveedor en el entorno (ANTHROPIC_API_KEY,
 *     OPENAI_API_KEY o GOOGLE_VERTEX_CREDENTIALS, según AI_PROVIDER_CLINICO /
 *     AI_PROVIDER_AGENDA). Nunca lee .env: la clave se pasa a mano en la
 *     terminal, y nunca la de producción de Vercel.
 *   - No corre en CI (variable CI) salvo EVALS_EN_CI=1. No está en la suite
 *     de vitest ni en el bundle de la app.
 *   - `AI_ENABLED=true` se fija SOLO dentro de este proceso. No toca Vercel.
 *   - Los casos son inventados: nunca agregar datos reales de pacientes.
 *
 * Cada corrida gasta tokens del proveedor (~110 llamadas cortas para los dos
 * usos). Las salidas crudas quedan en `evals/resultados/` (gitignoreado).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

import {
  evaluarUmbrales,
  isoEnZona,
  puntuarAgenda,
  puntuarEntidades,
  puntuarSoap,
  resumirAgenda,
  resumirEntidades,
  resumirSoap,
} from "./metricas.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "..");

function salir(mensaje) {
  console.error(`\n✋ ${mensaje}\n`);
  process.exit(2);
}

function argumentos(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out[k] = v ?? argv[++i];
    }
  }
  return out;
}

const args = argumentos(process.argv.slice(2));
const uso = args.uso;
if (uso !== "clinico" && uso !== "agenda") {
  salir("Uso: node evals/run.mjs --uso clinico|agenda [--limite N] [--modelo ID]");
}
if (process.env.CI && process.env.EVALS_EN_CI !== "1") {
  salir(
    "Los evals no corren en CI (gastan tokens y requieren una clave). EVALS_EN_CI=1 para forzar.",
  );
}

const jiti = createJiti(import.meta.url, { alias: { "@": path.join(raiz, "src") } });
const gateway = await jiti.import(path.join(raiz, "src/lib/ai-gateway.server.ts"));
const prompts = await jiti.import(path.join(raiz, "src/lib/ai/prompts.ts"));

let proveedor;
try {
  proveedor = gateway.proveedorParaUso(uso);
} catch (error) {
  salir(error.message);
}
const CLAVE = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  vertex: "GOOGLE_VERTEX_CREDENTIALS",
};
if (!process.env[CLAVE[proveedor]]) {
  salir(
    `Falta ${CLAVE[proveedor]} en el entorno para el proveedor "${proveedor}" (uso ${uso}). ` +
      "Pásala explícitamente en la terminal; este script no lee .env.",
  );
}

// Solo en este proceso: la app desplegada sigue con Patty pausada.
process.env.AI_ENABLED = "true";
const limite = args.limite ? Number(args.limite) : Infinity;
const modelo = args.modelo;
const cfg = gateway.resolverProveedorIa(uso, modelo);
console.log(`\nEvals de Patty · uso=${uso} · proveedor=${cfg.provider} · modelo=${cfg.model}\n`);

function cargar(nombre) {
  return JSON.parse(readFileSync(path.join(aqui, "casos", `${nombre}.json`), "utf8"));
}

/** Corre `fn` sobre los casos con poca concurrencia (no saturar el rate limit). */
async function enLotes(casos, fn, concurrencia = 3) {
  const resultados = new Array(casos.length);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < casos.length) {
      const i = siguiente++;
      resultados[i] = await fn(casos[i]);
      process.stdout.write(".");
    }
  }
  await Promise.all(Array.from({ length: concurrencia }, trabajador));
  process.stdout.write("\n");
  return resultados;
}

async function llamar(opciones) {
  const inicio = Date.now();
  try {
    const texto = await gateway.gatewayChat({ uso, model: modelo, ...opciones });
    return { texto, ms: Date.now() - inicio };
  } catch (error) {
    return { error: String(error?.message ?? error), ms: Date.now() - inicio };
  }
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const informe = {
  uso,
  proveedor: cfg.provider,
  modelo: cfg.model,
  fecha: new Date().toISOString(),
};
const fallas = [];

if (uso === "clinico") {
  // ── Apuntes -> SOAP ──
  const soap = cargar("soap").casos.slice(0, limite);
  console.log(`Apuntes -> SOAP (${soap.length} casos)`);
  const rSoap = await enLotes(soap, async (caso) => {
    const r = await llamar({
      system: `${prompts.SYSTEM_BASE}\n\n${prompts.PROMPTS_NOTA.draft}`,
      user: caso.apuntes,
    });
    const puntaje = r.texto
      ? puntuarSoap(caso, r.texto)
      : { alucinaciones: [], faltantes: [], soapCompleto: false };
    return { id: caso.id, ...r, ...puntaje, requeridosTotal: (caso.requeridos ?? []).length };
  });
  for (const r of rSoap) {
    if (r.error) console.log(`  ${r.id}: ERROR ${r.error}`);
    for (const a of r.alucinaciones)
      console.log(`  ${r.id}: posible alucinación (${a.hecho}): "…${a.fragmento}…"`);
  }
  const resumenSoap = resumirSoap(rSoap);
  console.log(
    `  hechos alucinados: ${resumenSoap.hechosAlucinados} en ${resumenSoap.casosConAlucinacion} casos · ` +
      `retención de hechos: ${pct(resumenSoap.retencionDeHechos)} · SOAP completo: ${pct(resumenSoap.soapCompleto)}\n`,
  );
  fallas.push(...evaluarUmbrales("soap", resumenSoap));
  informe.soap = { resumen: resumenSoap, casos: rSoap };

  // ── Nota -> entidades ──
  const ent = cargar("entidades").casos.slice(0, limite);
  console.log(`Nota -> entidades (${ent.length} casos)`);
  const rEnt = await enLotes(ent, async (caso) => {
    const r = await llamar({
      system: prompts.PROMPT_ENTIDADES,
      user: `Nota clínica:\n${caso.nota}`,
      json: true,
    });
    let puntaje = null;
    if (r.texto) {
      try {
        puntaje = puntuarEntidades(caso, JSON.parse(gateway.limpiarJson(r.texto)));
      } catch {
        r.error = "JSON ilegible";
      }
    }
    return { id: caso.id, ...r, puntaje };
  });
  for (const r of rEnt) {
    if (r.error) console.log(`  ${r.id}: ERROR ${r.error}`);
    if (!r.puntaje) continue;
    for (const [tipo, p] of Object.entries(r.puntaje)) {
      if (p.fp.length) console.log(`  ${r.id}: ${tipo} de más: ${p.fp.join(", ")}`);
      if (p.fn.length) console.log(`  ${r.id}: ${tipo} faltantes: ${p.fn.join(", ")}`);
    }
  }
  const resumenEnt = resumirEntidades(rEnt);
  for (const tipo of ["alergias", "medicamentos", "condiciones", "dientes"]) {
    const t = resumenEnt[tipo];
    console.log(
      `  ${tipo.padEnd(13)} precisión ${pct(t.precision)} · recall ${pct(t.recall)} (VP ${t.vp}, FP ${t.fp}, FN ${t.fn})`,
    );
  }
  console.log(
    `  alergias inventadas: ${resumenEnt.alergiasInventadas} · respuestas ilegibles: ${resumenEnt.casosIlegibles}\n`,
  );
  fallas.push(...evaluarUmbrales("entidades", resumenEnt));
  informe.entidades = { resumen: resumenEnt, casos: rEnt };
} else {
  // ── WhatsApp -> intención y fecha ──
  const set = cargar("agenda");
  const casos = set.casos.slice(0, limite);
  const hoyIso = isoEnZona(set.ahora, set.zonaHoraria);
  console.log(
    `WhatsApp -> intención y fecha (${casos.length} casos, hoy=${hoyIso} ${set.zonaHoraria})`,
  );
  const INTENCIONES = new Set(["agendar", "reagendar", "cancelar"]);
  const rAg = await enLotes(casos, async (caso) => {
    const r = await llamar({
      system: prompts.PROMPT_AGENDA,
      user: prompts.mensajeUsuarioAgenda(hoyIso, caso.mensaje),
      json: true,
    });
    let lectura = null;
    if (r.texto) {
      try {
        const j = JSON.parse(gateway.limpiarJson(r.texto));
        lectura = {
          intencion: INTENCIONES.has(j.intencion) ? j.intencion : null,
          fecha:
            typeof j.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.fecha) ? j.fecha : null,
          franja: j.franja === "manana" || j.franja === "tarde" ? j.franja : null,
        };
      } catch {
        r.error = "JSON ilegible";
      }
    }
    return { caso, id: caso.id, ...r, lectura, puntaje: puntuarAgenda(caso, lectura) };
  });
  for (const r of rAg) {
    if (r.error) console.log(`  ${r.id}: ERROR ${r.error}`);
    else if (!r.puntaje.intencionOk || !r.puntaje.fechaOk) {
      console.log(
        `  ${r.id}: "${r.caso.mensaje}" → ${JSON.stringify(r.lectura)} ` +
          `(esperado ${r.caso.intencion}/${r.caso.fecha})`,
      );
    }
  }
  const resumenAg = resumirAgenda(rAg);
  console.log(
    `  intención: ${pct(resumenAg.exactitudIntencion)} · fecha: ${pct(resumenAg.exactitudFecha)} ` +
      `(cuando hay fecha: ${pct(resumenAg.exactitudFechaCuandoHayFecha)}) · fechas inventadas: ${resumenAg.fechasInventadas} · ` +
      `franja: ${pct(resumenAg.exactitudFranja)} · errores: ${resumenAg.errores}\n`,
  );
  fallas.push(...evaluarUmbrales("agenda", resumenAg));
  informe.agenda = {
    resumen: resumenAg,
    casos: rAg.map(({ caso, ...r }) => ({ ...r, esperado: caso })),
  };
}

const dirSalida = path.join(aqui, "resultados");
mkdirSync(dirSalida, { recursive: true });
const archivo = path.join(dirSalida, `${uso}-${informe.fecha.replace(/[:.]/g, "-")}.json`);
writeFileSync(archivo, JSON.stringify(informe, null, 2));
console.log(`Detalle: ${path.relative(raiz, archivo)}`);

if (fallas.length) {
  console.log(`\n❌ No pasa los umbrales de docs/IA.md:\n  - ${fallas.join("\n  - ")}\n`);
  process.exit(1);
}
console.log(
  "\n✅ Pasa los umbrales automáticos. Falta la revisión humana (20 SOAP por un odontólogo).\n",
);
