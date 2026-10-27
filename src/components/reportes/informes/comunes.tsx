/**
 * Piezas compartidas de los informes "por pregunta" (Ola 11 · frente A).
 * Reusan el lenguaje A+ de `components/reportes/aplus.tsx`: tarjeta en
 * tinta, paneles en papel, cobalto solo para datos, y toda cifra se puede
 * tocar para ver el listado que la compone (INF-03).
 */
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileDown, Printer } from "lucide-react";

import { useExportarCsvLista } from "@/components/exportar-csv-lista";
import { Button } from "@/components/ui/button";
import type { ClinicRole } from "@/lib/access/access";
import type { ColumnaLista } from "@/lib/exportacion/listas-csv";
import type { OpcionesInformes } from "@/lib/reportes/informes.functions";
import {
  formatearValor,
  textoVariacion,
  type Corte,
  type Metrica,
  type Unidad,
  type Variacion,
} from "@/lib/reportes/informes";
import { cn } from "@/lib/utils";

/** Lo que todas las vistas necesitan saber del informe en curso. */
export interface ContextoInforme {
  clinicId: string;
  desde: string;
  hasta: string;
  sucursal: string | null;
  profesional: string | null;
  currency: string;
  timezone: string;
  rol: ClinicRole | null;
  opciones: OpcionesInformes;
  onDetalle: (p: PedidoDetalle) => void;
}

/** Qué cifra se abrió: métrica + celda (corte = clave) + período. */
export interface PedidoDetalle {
  titulo: string;
  metrica: Metrica;
  corte: Corte;
  clave: string | null;
  corte2?: Corte;
  clave2?: string | null;
  desde?: string;
  hasta?: string;
  profesional?: string | null;
  sucursal?: string | null;
}

const FOCO =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Una cifra que abre su detalle. Es un botón de verdad (teclado y lector de
 * pantalla), subrayado punteado para que se note que se puede tocar.
 */
export function CifraClicable({
  children,
  onClick,
  etiqueta,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  /** Lo que lee un lector de pantalla: "Ver las 34 atenciones de Lunes". */
  etiqueta: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title="Ver el detalle"
      className={cn(
        "cifra rounded-[4px] underline decoration-dotted decoration-1 underline-offset-4 hover:decoration-solid pointer-coarse:min-h-11",
        FOCO,
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Flecha + texto de la variación. El sentido se lee, no solo se ve. */
export function VariacionTexto({
  v,
  unidad,
  currency,
  sobre = "papel",
}: {
  v: Variacion | null;
  unidad: Unidad;
  currency: string;
  sobre?: "papel" | "tinta";
}) {
  const Icono =
    !v || v.sentido === "igual" ? ArrowRight : v.sentido === "sube" ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        sobre === "tinta" ? "text-on-night-2" : "text-muted-foreground",
      )}
    >
      <Icono className="size-3.5 flex-none" aria-hidden />
      <span>{textoVariacion(v, unidad, currency)}</span>
    </span>
  );
}

export function valorTexto(unidad: Unidad, valor: number | null, currency: string): string {
  return valor === null ? "Sin datos" : formatearValor(unidad, valor, currency);
}

/**
 * Exportar: CSV con el helper de listas (EXP-04: registra la exportación y
 * saca los montos a quien no ve finanzas) + PDF con el diálogo de impresión
 * del navegador, igual que "Resultados del piloto".
 */
export function BotonesExportar<T>({
  ctx,
  filas,
  columnas,
  archivo,
  filtros,
}: {
  ctx: ContextoInforme;
  filas: readonly T[];
  columnas: readonly ColumnaLista<T>[];
  archivo: string;
  filtros?: Record<string, string>;
}) {
  const { exportar, enCurso, puede } = useExportarCsvLista({
    clinicId: ctx.clinicId,
    rol: ctx.rol,
    lista: "informes",
    filas,
    columnas,
    timezone: ctx.timezone,
    archivo,
    filtros: { desde: ctx.desde, hasta: ctx.hasta, ...filtros },
  });
  return (
    <div className="no-imprimir flex flex-wrap gap-2">
      {puede && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={enCurso || filas.length === 0}
          onClick={() => void exportar()}
        >
          <FileDown className="size-4" aria-hidden />
          Exportar CSV
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={() => window.print()}
      >
        <Printer className="size-4" aria-hidden />
        Descargar PDF
      </Button>
    </div>
  );
}

/** Encabezado de un panel en papel con acciones a la derecha. */
export function CabeceraPanel({
  titulo,
  detalle,
  acciones,
}: {
  titulo: ReactNode;
  detalle?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-display text-[26px] font-medium leading-tight sm:text-[28px]">
          {titulo}
        </h3>
        {detalle && <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">{detalle}</p>}
      </div>
      {acciones}
    </div>
  );
}
