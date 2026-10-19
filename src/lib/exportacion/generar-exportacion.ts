/**
 * Orquesta la exportación en el navegador: registra, baja cada tabla página
 * por página, genera la ficha en PDF de cada paciente, baja los archivos de
 * Storage si entran y arma el ZIP. Sirve para la exportación completa de la
 * clínica y para la de una sola ficha (derecho de acceso del paciente).
 *
 * Recibe las llamadas al servidor, `fetch` y el generador de PDF como
 * dependencias para poder probarse sin red.
 */
import {
  MAX_BYTES_ARCHIVOS,
  TABLAS_EXPORTACION,
  archivosDeStorage,
  armarZip,
  conBom,
  construirLeeme,
  csvDeTabla,
  rutaPdfPaciente,
  tablasExportacionPaciente,
  type FilaExportacion,
  type TablaExportacion,
} from "@/lib/exportacion/exportacion-clinica";
import {
  contenidoFicha,
  indexarFichas,
  pacientesConFicha,
  type ContenidoFicha,
} from "@/lib/exportacion/ficha-paciente";
import { generarPdfFicha } from "@/lib/exportacion/ficha-pdf";

interface DependenciasComunes {
  firmar: (args: {
    clinicId: string;
    exportId: string;
    rutas: string[];
  }) => Promise<Array<{ ruta: string; url: string | null }>>;
  descargar: (url: string) => Promise<Uint8Array>;
  /** Por defecto, jsPDF (`ficha-pdf.ts`). */
  generarPdf?: (contenido: ContenidoFicha) => Promise<Uint8Array>;
  /** Devuelve el control al navegador entre ficha y ficha (pantalla viva). */
  ceder?: () => Promise<void>;
}

export interface DependenciasExportacion extends DependenciasComunes {
  iniciar: (clinicId: string) => Promise<{ exportId: string }>;
  leer: (args: {
    clinicId: string;
    exportId: string;
    clave: string;
    offset: number;
  }) => Promise<{ filas: FilaExportacion[]; siguiente: number | null }>;
}

export interface DependenciasExportacionPaciente extends DependenciasComunes {
  iniciar: (args: { clinicId: string; patientId: string }) => Promise<{ exportId: string }>;
  leer: (args: {
    clinicId: string;
    exportId: string;
    patientId: string;
    clave: string;
    offset: number;
  }) => Promise<{ filas: FilaExportacion[]; siguiente: number | null }>;
}

export interface AvanceExportacion {
  etapa: "registrando" | "tablas" | "fichas" | "archivos" | "comprimiendo";
  /** Texto corto para mostrar en pantalla. */
  detalle: string;
  hecho: number;
  total: number;
}

export interface OpcionesExportacion {
  clinicId: string;
  clinicaNombre: string;
  generadoPor: string;
  generadoEn: string;
  /** Zona horaria de la clínica (fechas de las fichas en PDF). */
  zonaHoraria?: string;
  onAvance?: (a: AvanceExportacion) => void;
  maxBytesArchivos?: number;
}

export interface OpcionesExportacionPaciente extends OpcionesExportacion {
  patientId: string;
  pacienteNombre: string;
  /** Presupuestos y pagos: solo quien tiene `finance:view` (regla 15). */
  incluirFinanzas: boolean;
}

const LOTE_FIRMA = 50;

const cederPorDefecto = () => new Promise<void>((resolver) => setTimeout(resolver, 0));

interface Plan {
  tablas: readonly TablaExportacion[];
  exportId: string;
  leer: (
    clave: string,
    offset: number,
  ) => Promise<{ filas: FilaExportacion[]; siguiente: number | null }>;
  /** Pacientes con PDF; null = todos los de la exportación. */
  fichas: string[] | null;
  incluirFinanzas: boolean;
  paciente?: string;
}

async function armarExportacion(
  deps: DependenciasComunes,
  op: OpcionesExportacion,
  plan: Plan,
): Promise<{ zip: Uint8Array; conteos: Record<string, number> }> {
  const avisar = op.onAvance ?? (() => {});
  const ceder = deps.ceder ?? cederPorDefecto;
  const generarPdf = deps.generarPdf ?? generarPdfFicha;
  const { exportId, tablas } = plan;

  const datos: Record<string, FilaExportacion[]> = {};
  const conteos: Record<string, number> = {};
  const textos: Record<string, string> = {};

  let i = 0;
  for (const tabla of tablas) {
    avisar({
      etapa: "tablas",
      detalle: `Preparando ${tabla.archivo}`,
      hecho: i,
      total: tablas.length,
    });
    const filas: FilaExportacion[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const pagina = await plan.leer(tabla.clave, offset);
      filas.push(...pagina.filas);
      offset = pagina.siguiente;
    }
    datos[tabla.clave] = filas;
    conteos[tabla.clave] = filas.length;
    textos[tabla.archivo] = conBom(csvDeTabla(tabla, filas));
    i += 1;
  }

  // Fichas en PDF (CON-01): una por paciente, de a una, cediendo el control
  // entre ficha y ficha para que la pestaña no se congele en una clínica
  // grande. Una ficha que falla no tira abajo la exportación: sus datos
  // siguen en los CSV y el LEEME lo cuenta.
  const binarios: Record<string, Uint8Array> = {};
  const indice = indexarFichas(datos);
  const ids = plan.fichas ?? pacientesConFicha(indice).map((p) => String(p.id));
  let fichasPdf = 0;
  let fichasPdfOmitidas = 0;
  for (let n = 0; n < ids.length; n += 1) {
    avisar({
      etapa: "fichas",
      detalle: "Generando las fichas en PDF",
      hecho: n,
      total: ids.length,
    });
    const contenido = contenidoFicha(indice, ids[n], {
      clinicaNombre: op.clinicaNombre,
      zonaHoraria: op.zonaHoraria ?? "UTC",
      generadoEn: op.generadoEn,
      incluirFinanzas: plan.incluirFinanzas,
    });
    if (!contenido) {
      fichasPdfOmitidas += 1;
      continue;
    }
    try {
      binarios[rutaPdfPaciente(contenido.pacienteId, contenido.pacienteNombre)] =
        await generarPdf(contenido);
      fichasPdf += 1;
    } catch {
      fichasPdfOmitidas += 1;
    }
    await ceder();
  }

  // Archivos de Storage: entran si el total cabe en memoria con holgura.
  const archivos = archivosDeStorage(op.clinicId, {
    documentos: datos.documentos,
    consentimientos: datos.consentimientos,
    presupuestos: datos.presupuestos,
    recetas: datos.recetas,
  });
  const totalBytes = archivos.reduce((s, a) => s + a.bytes, 0);
  const tope = op.maxBytesArchivos ?? MAX_BYTES_ARCHIVOS;
  let archivosIncluidos = 0;
  let omitidos = 0;
  let motivoOmision: string | undefined;

  if (archivos.length && totalBytes > tope) {
    omitidos = archivos.length;
    motivoOmision = `pesan ${Math.round(totalBytes / (1024 * 1024))} MB, más de lo que se puede armar en el navegador`;
  } else {
    for (let desde = 0; desde < archivos.length; desde += LOTE_FIRMA) {
      const lote = archivos.slice(desde, desde + LOTE_FIRMA);
      avisar({
        etapa: "archivos",
        detalle: "Descargando radiografías, documentos y firmas",
        hecho: desde,
        total: archivos.length,
      });
      let firmadas: Array<{ ruta: string; url: string | null }> = [];
      try {
        firmadas = await deps.firmar({
          clinicId: op.clinicId,
          exportId,
          rutas: lote.map((a) => a.ruta),
        });
      } catch {
        firmadas = [];
      }
      const urlPorRuta = new Map(firmadas.map((f) => [f.ruta, f.url]));
      for (const archivo of lote) {
        const url = urlPorRuta.get(archivo.ruta);
        if (!url) {
          omitidos += 1;
          continue;
        }
        try {
          binarios[archivo.destino] = await deps.descargar(url);
          archivosIncluidos += 1;
        } catch {
          omitidos += 1;
        }
      }
    }
    if (omitidos) motivoOmision = "no se pudieron descargar";
  }

  avisar({
    etapa: "comprimiendo",
    detalle: "Armando el archivo ZIP",
    hecho: tablas.length,
    total: tablas.length,
  });
  textos["LEEME.txt"] = conBom(
    construirLeeme({
      clinicaNombre: op.clinicaNombre,
      generadoEn: op.generadoEn,
      generadoPor: op.generadoPor,
      conteos,
      archivosIncluidos,
      archivosOmitidos: omitidos,
      motivoOmision,
      tablas,
      fichasPdf,
      fichasPdfOmitidas,
      paciente: plan.paciente,
      sinFinanzas: plan.paciente ? !plan.incluirFinanzas : undefined,
    }),
  );

  return { zip: armarZip(textos, binarios), conteos };
}

/** Exportación completa de la clínica (owner/admin). */
export async function generarExportacion(
  deps: DependenciasExportacion,
  op: OpcionesExportacion,
): Promise<{ zip: Uint8Array; conteos: Record<string, number> }> {
  op.onAvance?.({
    etapa: "registrando",
    detalle: "Registrando la exportación",
    hecho: 0,
    total: 1,
  });
  const { exportId } = await deps.iniciar(op.clinicId);
  return armarExportacion(deps, op, {
    tablas: TABLAS_EXPORTACION,
    exportId,
    leer: (clave, offset) => deps.leer({ clinicId: op.clinicId, exportId, clave, offset }),
    fichas: null,
    incluirFinanzas: true,
  });
}

/** Exportación de una ficha desde la ficha del paciente (owner/admin/dentista). */
export async function generarExportacionPaciente(
  deps: DependenciasExportacionPaciente,
  op: OpcionesExportacionPaciente,
): Promise<{ zip: Uint8Array; conteos: Record<string, number> }> {
  op.onAvance?.({
    etapa: "registrando",
    detalle: "Registrando la exportación",
    hecho: 0,
    total: 1,
  });
  const { exportId } = await deps.iniciar({ clinicId: op.clinicId, patientId: op.patientId });
  return armarExportacion(deps, op, {
    tablas: tablasExportacionPaciente(op.incluirFinanzas),
    exportId,
    leer: (clave, offset) =>
      deps.leer({ clinicId: op.clinicId, exportId, patientId: op.patientId, clave, offset }),
    fichas: [op.patientId],
    incluirFinanzas: op.incluirFinanzas,
    paciente: op.pacienteNombre,
  });
}
