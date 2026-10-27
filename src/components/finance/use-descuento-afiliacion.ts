import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import type { SeleccionAfiliacion } from "@/components/finance/descuento-afiliacion-ui";
import {
  descuentoComercialDe,
  elegirMejor,
  estadoDelRastro,
  type CandidatoDescuento,
} from "@/lib/finance/descuento-afiliacion";
import { getDescuentosDeAfiliacion } from "@/lib/finance/descuento-afiliacion.functions";

/**
 * Estado del descuento de afiliación de un diálogo de presupuesto.
 *
 * - Crear (`aplicarSolo`): al cargar los candidatos se aplica solo el que más
 *   le ahorra al paciente; la persona puede cambiarlo, quitarlo o ajustar el
 *   valor. Nada se oculta: el selector lo muestra y el presupuesto guarda el
 *   origen.
 * - Editar: se conserva el origen guardado; si el presupuesto no tenía, se
 *   ofrecen los candidatos sin aplicar ninguno (no se cambia un precio ya
 *   emitido sin que alguien lo pida).
 */
export function useDescuentoDeAfiliacion({
  clinicId,
  patientId,
  activo,
  inicial,
  aplicarSolo,
  subtotalCents,
  descuentoCents,
  aplicar,
}: {
  clinicId: string;
  patientId: string;
  /** El diálogo está abierto. */
  activo: boolean;
  /** Origen guardado en el presupuesto (editar) o `null`. */
  inicial: (SeleccionAfiliacion & { name: string }) | null;
  aplicarSolo: boolean;
  subtotalCents: number;
  /** Descuento comercial que hoy muestra el diálogo, en cents. */
  descuentoCents: number;
  /** Pone el descuento comercial del diálogo (modo y valor). */
  aplicar: (modo: "pct" | "amount", valor: number) => void;
}) {
  const fetchDescuentos = useServerFn(getDescuentosDeAfiliacion);
  const consulta = useQuery({
    queryKey: ["descuentos-afiliacion", clinicId, patientId],
    queryFn: () => fetchDescuentos({ data: { clinicId, patientId } }),
    enabled: activo,
  });
  const candidatos = consulta.data?.candidatos ?? [];
  const visible = consulta.data?.visible ?? false;

  const [seleccion, setSeleccion] = useState<SeleccionAfiliacion | null>(
    inicial ? { source: inicial.source, sourceId: inicial.sourceId } : null,
  );
  const [tocado, setTocado] = useState(false);
  const inicializado = useRef(false);

  // Cada vez que el diálogo se abre vuelve a su punto de partida.
  const inicialClave = inicial ? `${inicial.source}:${inicial.sourceId}` : "";
  useEffect(() => {
    if (!activo) return;
    setSeleccion(inicial ? { source: inicial.source, sourceId: inicial.sourceId } : null);
    setTocado(false);
    inicializado.current = false;
    // `inicialClave` resume `inicial`; el objeto cambia de identidad en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, inicialClave]);

  // Presupuesto nuevo: se aplica solo el mejor, una vez, cuando llegan los candidatos.
  useEffect(() => {
    if (!activo || !aplicarSolo || !consulta.isSuccess || inicializado.current) return;
    inicializado.current = true;
    const mejor = elegirMejor(candidatos, subtotalCents);
    if (!mejor) return;
    setSeleccion({ source: mejor.source, sourceId: mejor.sourceId });
    const d = descuentoComercialDe(mejor);
    aplicar(d.modo, d.valor);
    // Solo reacciona a la llegada de los candidatos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, aplicarSolo, consulta.isSuccess, consulta.data]);

  const seleccionar = useCallback(
    (c: CandidatoDescuento | null) => {
      const antes = seleccion;
      setTocado(true);
      if (c) {
        setSeleccion({ source: c.source, sourceId: c.sourceId });
        const d = descuentoComercialDe(c);
        aplicar(d.modo, d.valor);
      } else {
        setSeleccion(null);
        // Quitar el descuento de afiliación quita su rebaja; un descuento que
        // la persona escribió a mano sin origen no se toca.
        if (antes !== null) aplicar("pct", 0);
      }
    },
    [seleccion, aplicar],
  );

  const elegido =
    seleccion === null
      ? null
      : (candidatos.find(
          (c) => c.source === seleccion.source && c.sourceId === seleccion.sourceId,
        ) ?? null);

  // El origen guardado ya no es del paciente (se pausó la membresía, se desafilió).
  const origenPerdido =
    consulta.isSuccess &&
    visible &&
    !tocado &&
    inicial !== null &&
    seleccion !== null &&
    elegido === null
      ? inicial.name
      : null;

  const estado = elegido
    ? estadoDelRastro(
        {
          percent: elegido.kind === "percent" ? elegido.percent : null,
          amountCents: elegido.cents,
        },
        { subtotalCents, discountCents: descuentoCents },
      )
    : null;

  /**
   * Qué mandar al servidor: `undefined` = no tocar el origen guardado (el rol
   * no ve afiliaciones, o todavía no cargó); `null` = sin origen; o la elección.
   */
  const enviar: SeleccionAfiliacion | null | undefined =
    !consulta.isSuccess || !visible
      ? tocado
        ? seleccion
        : undefined
      : origenPerdido
        ? null
        : seleccion;

  return {
    candidatos,
    seleccion,
    seleccionar,
    enviar,
    origenPerdido,
    aviso: estado && estado.tipo !== "igual" ? estado.texto : undefined,
  };
}
