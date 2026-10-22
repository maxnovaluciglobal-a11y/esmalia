/**
 * Presupuesto como documento del motor (Ola 4 · PLA-08). Lógica pura: arma
 * las variables `{{presupuesto.*}}` y sus dos tablas a partir de lo que el
 * presupuesto tiene GUARDADO (snapshots de nombre, precio y descuentos), sin
 * recalcular nada. Lo usan el servidor (descarga y correo) y la vista previa
 * del editor de plantillas.
 *
 * Cómo se leen los montos (los mismos de `calculo-presupuesto.ts`):
 *   - cada línea muestra cantidad × precio unitario − su descuento propio;
 *   - la suma de las líneas es el subtotal (`quotes.subtotal_cents`);
 *   - subtotal − descuento comercial = total (`quotes.total_cents`);
 *   - total − lo que pone el convenio = lo que paga el paciente.
 * El descuento comercial se reparte entre las líneas al guardar (por eso
 * `quote_items.total_cents` ya lo trae descontado), pero en el papel se
 * muestra una sola vez, como en el detalle del presupuesto.
 *
 * Regla 6: todo en cents y con `formatMoney(cents, moneda)`.
 */
import { formatMoney } from "@/lib/finance/finance";
import { fechaDocumento } from "@/lib/formato-fecha";
import type { TablaDeContexto } from "@/lib/documentos/tipos";

export interface LineaDePresupuesto {
  seccion: string | null;
  nombre: string;
  pieza: number | null;
  cantidad: number;
  precioUnitarioCents: number;
  /** Descuento propio de la línea, en cents (la verdad contable, regla 6). */
  descuentoCents: number;
  /** Si se negoció en %, para mostrarlo. */
  descuentoPct: number | null;
  /** false = el paciente no aceptó esta línea (aceptación parcial). */
  aceptada: boolean | null;
}

export interface DatosPresupuesto {
  numero: string;
  /** Instante de creación (ISO). */
  creadoEn: string;
  /** Día civil YYYY-MM-DD, o null sin fecha de validez. */
  validoHasta: string | null;
  profesional: string | null;
  moneda: string;
  lineas: LineaDePresupuesto[];
  subtotalCents: number;
  descuentoCents: number;
  descuentoPct: number | null;
  totalCents: number;
  convenio: string | null;
  /** Lo que pone el convenio. null = sin convenio (regla 11), no cero. */
  coberturaCents: number | null;
  notas: string | null;
}

/** Valor de una línea antes del descuento comercial. */
export function valorDeLinea(
  l: Pick<LineaDePresupuesto, "cantidad" | "precioUnitarioCents" | "descuentoCents">,
): number {
  return Math.max(0, l.cantidad * l.precioUnitarioCents - l.descuentoCents);
}

/** Lo que paga el paciente: el total menos el convenio (nunca negativo). */
export function copagoDelPresupuesto(d: Pick<DatosPresupuesto, "totalCents" | "coberturaCents">) {
  return d.coberturaCents === null ? d.totalCents : Math.max(0, d.totalCents - d.coberturaCents);
}

function pct(valor: number): string {
  return `${String(valor).replace(".", ",")} %`;
}

/**
 * Tabla de prestaciones: una fila por línea, agrupadas por sección (la
 * sección es una fila destacada), en el orden guardado. La columna de
 * descuento aparece solo si alguna línea lo tiene.
 */
export function tablaDePrestaciones(d: DatosPresupuesto): TablaDeContexto {
  const conDescuento = d.lineas.some((l) => l.descuentoCents > 0);
  const columnas: TablaDeContexto["columnas"] = [
    { titulo: "Pieza", alineacion: "izquierda" },
    { titulo: "Prestación", alineacion: "izquierda" },
    { titulo: "Cant.", alineacion: "derecha" },
    { titulo: "Valor unitario", alineacion: "derecha" },
    ...(conDescuento ? [{ titulo: "Descuento", alineacion: "derecha" as const }] : []),
    { titulo: "Total", alineacion: "derecha" },
  ];
  const filas: string[][] = [];
  const destacadas: number[] = [];
  const conSecciones = d.lineas.some((l) => l.seccion);
  let seccionActual: string | null | undefined;
  for (const l of d.lineas) {
    if (conSecciones && l.seccion !== seccionActual) {
      seccionActual = l.seccion;
      destacadas.push(filas.length);
      filas.push(columnas.map((_, i) => (i === 1 ? (l.seccion ?? "Sin sección") : "")));
    }
    const descuento =
      l.descuentoCents > 0
        ? l.descuentoPct !== null
          ? `${pct(l.descuentoPct)} (${formatMoney(l.descuentoCents, d.moneda)})`
          : formatMoney(l.descuentoCents, d.moneda)
        : "—";
    filas.push([
      l.pieza ? String(l.pieza) : "—",
      l.aceptada === false ? `${l.nombre} (no aceptada)` : l.nombre,
      String(l.cantidad),
      formatMoney(l.precioUnitarioCents, d.moneda),
      ...(conDescuento ? [descuento] : []),
      formatMoney(valorDeLinea(l), d.moneda),
    ]);
  }
  const pie = columnas.map((_, i) =>
    i === 1 ? "Subtotal" : i === columnas.length - 1 ? formatMoney(d.subtotalCents, d.moneda) : "",
  );
  return {
    tipo: "tabla",
    columnas,
    filas,
    pie,
    vacia: "El presupuesto no tiene prestaciones.",
    ...(destacadas.length ? { destacadas } : {}),
  };
}

/** Resumen de montos: subtotal, descuento comercial, total, convenio y copago. */
export function tablaDeTotales(d: DatosPresupuesto): TablaDeContexto {
  const filas: string[][] = [["Subtotal", formatMoney(d.subtotalCents, d.moneda)]];
  if (d.descuentoCents > 0) {
    filas.push([
      d.descuentoPct !== null
        ? `Descuento comercial (${pct(d.descuentoPct)})`
        : "Descuento comercial",
      `-${formatMoney(d.descuentoCents, d.moneda)}`,
    ]);
  }
  filas.push(["Total del presupuesto", formatMoney(d.totalCents, d.moneda)]);
  if (d.coberturaCents !== null) {
    filas.push([
      `Cubre ${d.convenio?.trim() || "el convenio"} (estimado)`,
      `-${formatMoney(d.coberturaCents, d.moneda)}`,
    ]);
  }
  const ultima = filas.length;
  return {
    tipo: "tabla",
    columnas: [
      { titulo: "Resumen", alineacion: "izquierda" },
      { titulo: "Monto", alineacion: "derecha" },
    ],
    filas,
    pie: ["Total a pagar por el paciente", formatMoney(copagoDelPresupuesto(d), d.moneda)],
    destacadas: [ultima - (d.coberturaCents !== null ? 2 : 1)],
  };
}

/** Texto por variable `presupuesto.*` (sin las de bloque). */
export function valoresDePresupuesto(
  d: DatosPresupuesto,
  zona: string,
): Record<string, string | null> {
  return {
    "presupuesto.numero": d.numero.trim() || null,
    "presupuesto.fecha": fechaDocumento(d.creadoEn, zona),
    "presupuesto.validez": d.validoHasta
      ? `hasta el ${fechaDocumento(d.validoHasta, zona)}`
      : "sin fecha de vencimiento",
    "presupuesto.profesional": d.profesional?.trim() || null,
    "presupuesto.subtotal": formatMoney(d.subtotalCents, d.moneda),
    "presupuesto.descuento": formatMoney(d.descuentoCents, d.moneda),
    "presupuesto.total": formatMoney(d.totalCents, d.moneda),
    "presupuesto.convenio": d.convenio?.trim() || "Sin convenio",
    "presupuesto.cobertura":
      d.coberturaCents === null ? "Sin convenio" : formatMoney(d.coberturaCents, d.moneda),
    "presupuesto.copago": formatMoney(copagoDelPresupuesto(d), d.moneda),
    "presupuesto.notas": d.notas?.trim() || "Sin observaciones.",
  };
}

/** Nombre del archivo: "presupuesto-p-2026-0012.pdf". */
export function nombreDeArchivoPresupuesto(numero: string): string {
  const base = `presupuesto-${numero}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "")
    .toLowerCase();
  return `${base}.pdf`;
}

/**
 * Texto de la plantilla "Presupuesto" que siembra Esmalia (migración
 * 20261025200100; `tests/presupuesto-documento.test.ts` vigila que el SQL y
 * este texto sean el mismo). Si una clínica desactiva su plantilla, el PDF
 * sale con este texto.
 */
export const PLANTILLA_PRESUPUESTO = `# Presupuesto {{presupuesto.numero}}

{{clinica.nombre}}, {{presupuesto.fecha}}

**Paciente:** {{paciente.nombre}}, {{paciente.tipo_documento}} {{paciente.rut}}
**Previsión:** {{paciente.prevision}}
**Profesional tratante:** {{presupuesto.profesional}}

## Prestaciones

{{presupuesto.prestaciones}}

{{presupuesto.totales}}

## Condiciones

- **Validez:** {{presupuesto.validez}}. Pasada esa fecha, los valores pueden cambiar.
- Si durante el tratamiento aparece algo que no se veía en la evaluación, el cambio se conversa y se presupuesta antes de hacerlo.
- La cobertura del convenio o de la previsión es un estimado: la confirma la institución al momento de la atención.
- Para aceptar este presupuesto, avísale a la clínica o fírmalo en tu próxima visita.

**Observaciones:** {{presupuesto.notas}}`;

/** Presupuesto de ejemplo para la vista previa del editor (sin datos reales). */
export const PRESUPUESTO_DE_EJEMPLO: DatosPresupuesto = {
  numero: "P-2026-0012",
  creadoEn: "2026-10-22T15:00:00Z",
  validoHasta: "2026-11-21",
  profesional: "Dra. Carolina Rodríguez",
  moneda: "CLP",
  lineas: [
    {
      seccion: "Urgencia",
      nombre: "Endodoncia molar",
      pieza: 46,
      cantidad: 1,
      precioUnitarioCents: 180000,
      descuentoCents: 0,
      descuentoPct: null,
      aceptada: null,
    },
    {
      seccion: "Rehabilitación",
      nombre: "Corona de porcelana",
      pieza: 46,
      cantidad: 1,
      precioUnitarioCents: 250000,
      descuentoCents: 25000,
      descuentoPct: 10,
      aceptada: null,
    },
    {
      seccion: "Rehabilitación",
      nombre: "Destartraje y pulido",
      pieza: null,
      cantidad: 2,
      precioUnitarioCents: 35000,
      descuentoCents: 0,
      descuentoPct: null,
      aceptada: null,
    },
  ],
  subtotalCents: 475000,
  descuentoCents: 23750,
  descuentoPct: 5,
  totalCents: 451250,
  convenio: "Convenio Seguros Vida Sur",
  coberturaCents: 90000,
  notas: "Incluye radiografía de control.",
};
