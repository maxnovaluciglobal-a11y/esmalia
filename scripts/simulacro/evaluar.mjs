// Paso final del simulacro: junta las mediciones, decide y escribe el reporte.
//
// Uso: node evaluar.mjs <workdir> <dir de salida> [nombre del backup]
//   <workdir>/backup.json         el backup descifrado
//   <workdir>/mediciones.json     la línea de JSON de verificar.sql
//   <workdir>/migraciones.json    { ok, fallidas: [archivo] }
//   <workdir>/tiempos.tsv         paso<TAB>segundos<TAB>rto(1|0)
//   <workdir>/storage/manifest.json  (opcional)
// Escribe <salida>/reporte.md y <salida>/reporte.json (sin datos de pacientes)
// y sale con 1 si alguna verificación falló.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluarSimulacro, reporteMarkdown } from "./lib.mjs";

const [workdir, salida, origen = ""] = process.argv.slice(2);
const leer = (f) => JSON.parse(readFileSync(join(workdir, f), "utf8"));

const backup = leer("backup.json");
const mediciones = existsSync(join(workdir, "mediciones.json"))
  ? leer("mediciones.json")
  : {
      conteos: {},
      fksRotas: [],
      fksRevisadas: 0,
      usuariosRestaurados: [],
      usuariosStub: 0,
      objetos: {},
    };
const migraciones = existsSync(join(workdir, "migraciones.json"))
  ? leer("migraciones.json")
  : { ok: 0, fallidas: ["(no se aplicaron)"] };
const manifestPath = join(workdir, "storage", "manifest.json");
const manifiesto = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const tiempos = existsSync(join(workdir, "tiempos.tsv"))
  ? readFileSync(join(workdir, "tiempos.tsv"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [paso, segundos, rto] = l.split("\t");
        return { paso, segundos: Number(segundos), rto: rto === "1" };
      })
  : [];

const resultado = evaluarSimulacro({
  backup,
  conteosBase: mediciones.conteos,
  fksRotas: mediciones.fksRotas,
  fksRevisadas: mediciones.fksRevisadas,
  usuariosRestaurados: mediciones.usuariosRestaurados,
  usuariosStub: mediciones.usuariosStub,
  manifiesto,
  objetosBase: mediciones.objetos,
  migraciones,
  tiempos,
});

const fecha = new Date().toISOString();
const md = reporteMarkdown(resultado, { origen, fecha });
mkdirSync(salida, { recursive: true });
writeFileSync(join(salida, "reporte.md"), md);
writeFileSync(
  join(salida, "reporte.json"),
  JSON.stringify({ fecha, origen, ...resultado }, null, 2) + "\n",
);
process.stdout.write(md);
process.exit(resultado.estado === "ok" ? 0 : 1);
