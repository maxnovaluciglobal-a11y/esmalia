/**
 * Resumen de la caja del día (rediseño A+, pase de fidelidad de la caja).
 *
 * Lógica pura: el server fn (`caja-del-dia.functions.ts`) trae las filas del
 * día de la clínica y acá se arma lo que pinta la pantalla: cobrado por hora,
 * mezcla por medio de pago, movimientos, atendidas sin cobro y comisiones.
 * Sin base de datos para poder probarlo entero (tests/caja-del-dia.test.ts).
 *
 * Dinero siempre en cents (regla 6). Las horas se leen en el huso de la
 * clínica (regla 7), nunca en el del navegador ni en UTC.
 */
import { hora } from "@/lib/formato-fecha";
import { calcularComision, type CommissionRuleAmounts } from "@/lib/finance/commissions";
import { esCobroEnEfectivo } from "@/lib/finance/cash-registers";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/finance/finance";

/** Un pago vigente (no reversado) del día, tal como sale de `payments`. */
export interface PagoDelDia {
  id: string;
  amountCents: number;
  method: string;
  /** Nombre del medio propio de la clínica al cobrar (Ola 3: "Redcompra", "Webpay"…). */
  methodName: string | null;
  paidAt: string;
  patientId: string;
  treatmentItemId: string | null;
  receivableId: string | null;
  /** Mismo grupo = un cobro repartido en varios medios (Ola 3). */
  paymentGroupId: string | null;
  notes: string | null;
}

export interface CitaDelDia {
  id: string;
  patientId: string;
  professionalId: string;
  startsAt: string;
  status: string;
  treatmentLabel: string | null;
}

export interface ItemCobrado {
  name: string;
  professionalId: string | null;
  toothNumber: number | null;
}

export interface ProfesionalDelDia {
  id: string;
  nombre: string;
  /** Hex guardado en `professionals.color` (AGE-06); la UI lo lleva al token. */
  color: string | null;
}

/** Nombre visible de un medio: el de la clínica si lo hay, si no el genérico. */
export function etiquetaDeMedio(method: string, methodName: string | null | undefined): string {
  const propio = methodName?.trim();
  if (propio) return propio;
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}

/**
 * "Rosa Fernández Muñoz" → "R. Fernández". En el mostrador la lista se lee
 * de reojo y el nombre completo de cada paciente queda a la vista de quien
 * espera. Un solo nombre queda tal cual.
 */
export function nombreCorto(nombre: string | null | undefined): string {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "Paciente";
  if (partes.length === 1) return partes[0];
  return `${partes[0].charAt(0).toUpperCase()}. ${partes[1]}`;
}

/** Hora del día (0-23) de un instante, en el huso de la clínica. */
export function horaDelDia(iso: string, timeZone: string): number | null {
  const hhmm = hora(iso, timeZone);
  const h = Number.parseInt(hhmm.slice(0, 2), 10);
  return Number.isNaN(h) ? null : h;
}

export interface CobroPorHora {
  hora: number;
  cents: number;
  cantidad: number;
}

/**
 * Cobrado por hora. El rango arranca en `desde` y termina en `hasta`
 * (horario típico de una clínica), pero se estira si hubo cobros antes o
 * después: una hora con plata nunca queda fuera del gráfico.
 */
export function cobrosPorHora(
  pagos: readonly Pick<PagoDelDia, "amountCents" | "paidAt">[],
  timeZone: string,
  rango: { desde: number; hasta: number } = { desde: 9, hasta: 18 },
): CobroPorHora[] {
  const porHora = new Map<number, { cents: number; cantidad: number }>();
  let desde = rango.desde;
  let hasta = rango.hasta;
  for (const p of pagos) {
    const h = horaDelDia(p.paidAt, timeZone);
    if (h === null) continue;
    const actual = porHora.get(h) ?? { cents: 0, cantidad: 0 };
    actual.cents += p.amountCents;
    actual.cantidad += 1;
    porHora.set(h, actual);
    desde = Math.min(desde, h);
    hasta = Math.max(hasta, h);
  }
  const salida: CobroPorHora[] = [];
  for (let h = desde; h <= hasta; h++) {
    const v = porHora.get(h);
    salida.push({ hora: h, cents: v?.cents ?? 0, cantidad: v?.cantidad ?? 0 });
  }
  return salida;
}

export interface MedioDelDia {
  medio: string;
  enEfectivo: boolean;
  cents: number;
  cantidad: number;
  /** Porcentaje entero del total; la suma da 100 (resto mayor). */
  porcentaje: number;
}

/**
 * Porcentajes enteros que suman 100 (método del resto mayor). Redondear cada
 * uno por separado puede dar 99 o 101 y la barra apilada no cierra.
 */
export function porcentajesQueSuman100(valores: readonly number[]): number[] {
  const total = valores.reduce((s, v) => s + v, 0);
  if (total <= 0) return valores.map(() => 0);
  const exactos = valores.map((v) => (v * 100) / total);
  const base = exactos.map(Math.floor);
  let resto = 100 - base.reduce((s, v) => s + v, 0);
  const orden = exactos
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of orden) {
    if (resto <= 0) break;
    base[i] += 1;
    resto -= 1;
  }
  return base;
}

/**
 * Mezcla por medio de pago. Efectivo primero (es lo que se cuenta en el
 * arqueo); después, de mayor a menor. Un medio propio llamado igual que el
 * efectivo no se mezcla con él (la clave incluye si pasa por el cajón).
 */
export function mezclaPorMedio(
  pagos: readonly Pick<PagoDelDia, "amountCents" | "method" | "methodName">[],
): MedioDelDia[] {
  const porMedio = new Map<string, Omit<MedioDelDia, "porcentaje">>();
  for (const p of pagos) {
    const medio = etiquetaDeMedio(p.method, p.methodName);
    const enEfectivo = esCobroEnEfectivo(p.method);
    const clave = `${enEfectivo ? "cash" : "banco"}|${medio}`;
    const actual = porMedio.get(clave) ?? { medio, enEfectivo, cents: 0, cantidad: 0 };
    actual.cents += p.amountCents;
    actual.cantidad += 1;
    porMedio.set(clave, actual);
  }
  const lista = [...porMedio.values()].sort(
    (a, b) =>
      Number(b.enEfectivo) - Number(a.enEfectivo) ||
      b.cents - a.cents ||
      a.medio.localeCompare(b.medio),
  );
  const pct = porcentajesQueSuman100(lista.map((m) => m.cents));
  return lista.map((m, i) => ({ ...m, porcentaje: pct[i] }));
}

export interface ParteDelCobro {
  medio: string;
  enEfectivo: boolean;
  cents: number;
}

export interface MovimientoDelDia {
  /** Id del grupo (cobro repartido) o del pago suelto. */
  id: string;
  paidAt: string;
  hora: string;
  patientId: string;
  paciente: string;
  concepto: string;
  professionalId: string | null;
  profesional: string | null;
  partes: ParteDelCobro[];
  totalCents: number;
}

/**
 * Concepto legible de un cobro: la prestación cobrada (con la pieza), la
 * cuota de un plan de pago, la nota del cobro o, si no hay nada, la cita del
 * día. "Abono" cuando no hay de dónde sacarlo.
 */
function conceptoDe(
  item: ItemCobrado | undefined,
  pago: Pick<PagoDelDia, "receivableId" | "notes">,
  cita: CitaDelDia | undefined,
): string {
  if (item) return item.toothNumber ? `${item.name} · ${item.toothNumber}` : item.name;
  if (pago.receivableId) return "Cuota de plan de pago";
  const nota = pago.notes?.trim();
  if (nota) return nota;
  const tratamiento = cita?.treatmentLabel?.trim();
  if (tratamiento) return tratamiento;
  return "Abono";
}

/**
 * La cita del paciente que mejor explica un cobro: la última que empezó
 * antes del pago; si no, la primera del día.
 */
export function citaDelCobro(
  citasDelPaciente: readonly CitaDelDia[] | undefined,
  paidAt: string,
): CitaDelDia | undefined {
  if (!citasDelPaciente?.length) return undefined;
  const pago = new Date(paidAt).getTime();
  const ordenadas = [...citasDelPaciente].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  let elegida: CitaDelDia | undefined;
  for (const c of ordenadas) {
    if (new Date(c.startsAt).getTime() <= pago) elegida = c;
  }
  return elegida ?? ordenadas[0];
}

/**
 * Movimientos del día, uno por cobro. Un cobro repartido en varios medios
 * (mismo `paymentGroupId`) es una sola fila con sus partes. El profesional
 * sale de la prestación cobrada; si el pago no la tiene, de la cita del día
 * del paciente.
 */
export function armarMovimientos(
  pagos: readonly PagoDelDia[],
  ctx: {
    timeZone: string;
    pacientes: ReadonlyMap<string, string>;
    items: ReadonlyMap<string, ItemCobrado>;
    citasPorPaciente: ReadonlyMap<string, readonly CitaDelDia[]>;
    profesionales: ReadonlyMap<string, ProfesionalDelDia>;
  },
): MovimientoDelDia[] {
  const grupos = new Map<string, PagoDelDia[]>();
  for (const p of pagos) {
    const clave = p.paymentGroupId ?? p.id;
    const lista = grupos.get(clave) ?? [];
    lista.push(p);
    grupos.set(clave, lista);
  }
  const movimientos: MovimientoDelDia[] = [];
  for (const [id, partesPago] of grupos) {
    const primero = [...partesPago].sort(
      (a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime(),
    )[0];
    const conItem = partesPago.find((p) => p.treatmentItemId && ctx.items.has(p.treatmentItemId));
    const item = conItem ? ctx.items.get(conItem.treatmentItemId!) : undefined;
    const cita = citaDelCobro(ctx.citasPorPaciente.get(primero.patientId), primero.paidAt);
    const professionalId = item?.professionalId ?? cita?.professionalId ?? null;
    const nota = partesPago.find((p) => p.notes?.trim()) ?? primero;
    const partes = new Map<string, ParteDelCobro>();
    for (const p of partesPago) {
      const medio = etiquetaDeMedio(p.method, p.methodName);
      const enEfectivo = esCobroEnEfectivo(p.method);
      const clave = `${enEfectivo ? "cash" : "banco"}|${medio}`;
      const parte = partes.get(clave) ?? { medio, enEfectivo, cents: 0 };
      parte.cents += p.amountCents;
      partes.set(clave, parte);
    }
    movimientos.push({
      id,
      paidAt: primero.paidAt,
      hora: hora(primero.paidAt, ctx.timeZone),
      patientId: primero.patientId,
      paciente: ctx.pacientes.get(primero.patientId)?.trim() || "Paciente",
      concepto: conceptoDe(item, nota, cita),
      professionalId,
      profesional: professionalId ? (ctx.profesionales.get(professionalId)?.nombre ?? null) : null,
      partes: [...partes.values()].sort(
        (a, b) => Number(b.enEfectivo) - Number(a.enEfectivo) || b.cents - a.cents,
      ),
      totalCents: partesPago.reduce((s, p) => s + p.amountCents, 0),
    });
  }
  return movimientos.sort(
    (a, b) =>
      new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime() || a.id.localeCompare(b.id),
  );
}

/**
 * Movimientos filtrados por medio. Con un filtro, el monto visible de un
 * cobro repartido es solo la parte en ese medio (así el total cuadra con la
 * mezcla por medio de la tarjeta).
 */
export function filtrarPorMedio(
  movimientos: readonly MovimientoDelDia[],
  medio: string | null,
): { filas: (MovimientoDelDia & { montoVisibleCents: number })[]; totalCents: number } {
  const filas = movimientos.flatMap((m) => {
    if (medio === null) return [{ ...m, montoVisibleCents: m.totalCents }];
    const enMedio = m.partes.filter((p) => p.medio === medio);
    if (enMedio.length === 0) return [];
    return [{ ...m, montoVisibleCents: enMedio.reduce((s, p) => s + p.cents, 0) }];
  });
  return { filas, totalCents: filas.reduce((s, f) => s + f.montoVisibleCents, 0) };
}

export interface AtendidaSinCobro {
  citaId: string;
  patientId: string;
  paciente: string;
  concepto: string;
  profesional: string | null;
  hora: string;
  /** Saldo del paciente (facturado − pagado). `null` sin permiso de finanzas o sin plan. */
  saldoCents: number | null;
}

/**
 * Citas atendidas hoy (`finalizada`) cuyo paciente no tiene ningún cobro
 * vigente en el día. Un paciente con dos citas atendidas aparece una vez
 * (la última): el cobro se resuelve por paciente, no por cita.
 */
export function atendidasSinCobro(
  citas: readonly CitaDelDia[],
  pacientesConCobro: ReadonlySet<string>,
  ctx: {
    timeZone: string;
    pacientes: ReadonlyMap<string, string>;
    profesionales: ReadonlyMap<string, ProfesionalDelDia>;
    saldos: ReadonlyMap<string, number> | null;
  },
): AtendidaSinCobro[] {
  const porPaciente = new Map<string, CitaDelDia>();
  for (const c of citas) {
    if (c.status !== "finalizada" || pacientesConCobro.has(c.patientId)) continue;
    const previa = porPaciente.get(c.patientId);
    if (!previa || new Date(c.startsAt).getTime() > new Date(previa.startsAt).getTime()) {
      porPaciente.set(c.patientId, c);
    }
  }
  return [...porPaciente.values()]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .map((c) => ({
      citaId: c.id,
      patientId: c.patientId,
      paciente: ctx.pacientes.get(c.patientId)?.trim() || "Paciente",
      concepto: c.treatmentLabel?.trim() || "Atención",
      profesional: ctx.profesionales.get(c.professionalId)?.nombre ?? null,
      hora: hora(c.startsAt, ctx.timeZone),
      saldoCents: ctx.saldos?.get(c.patientId) ?? null,
    }));
}

/** Suma de los saldos positivos de las atendidas sin cobro; `null` si no se conoce ninguno. */
export function porCobrarDelDia(atendidas: readonly AtendidaSinCobro[]): number | null {
  const conocidos = atendidas.filter((a) => a.saldoCents !== null);
  if (conocidos.length === 0) return null;
  return conocidos.reduce((s, a) => s + Math.max(0, a.saldoCents ?? 0), 0);
}

export interface ComisionDelDia {
  professionalId: string;
  nombre: string;
  color: string | null;
  cobradoCents: number;
  produccionCents: number;
  procedimientos: number;
  /** `null` = sin regla configurada (no es cero: regla 11). */
  comisionCents: number | null;
  /** "40 %" o "Fijo por procedimiento"; "Sin regla" si no hay. */
  regla: string;
}

function etiquetaCortaDeRegla(rule: CommissionRuleAmounts | null): string {
  if (!rule) return "Sin regla";
  if (rule.kind === "percent") {
    const pct = rule.percentBps / 100;
    return `${Number.isInteger(pct) ? pct : pct.toFixed(1).replace(".", ",")} %`;
  }
  return "Fijo por procedimiento";
}

/**
 * Comisiones del día por profesional: mismo cálculo que el reporte de
 * comisiones (`calcularComision`, sobre la producción realizada hoy) y, al
 * lado, lo cobrado hoy atribuido a cada profesional. Solo aparecen quienes
 * cobraron o produjeron algo hoy; el orden es por comisión y después por
 * cobrado.
 */
export function comisionesDelDia(
  profesionales: readonly ProfesionalDelDia[],
  movimientos: readonly Pick<MovimientoDelDia, "professionalId" | "totalCents">[],
  produccion: ReadonlyMap<string, { cents: number; cantidad: number }>,
  reglas: ReadonlyMap<string, CommissionRuleAmounts>,
): ComisionDelDia[] {
  const cobrado = new Map<string, number>();
  for (const m of movimientos) {
    if (!m.professionalId) continue;
    cobrado.set(m.professionalId, (cobrado.get(m.professionalId) ?? 0) + m.totalCents);
  }
  return profesionales
    .map((pro) => {
      const prod = produccion.get(pro.id) ?? { cents: 0, cantidad: 0 };
      const rule = reglas.get(pro.id) ?? null;
      const { commissionCents } = calcularComision(rule, prod.cents, prod.cantidad);
      return {
        professionalId: pro.id,
        nombre: pro.nombre,
        color: pro.color,
        cobradoCents: cobrado.get(pro.id) ?? 0,
        produccionCents: prod.cents,
        procedimientos: prod.cantidad,
        comisionCents: commissionCents,
        regla: etiquetaCortaDeRegla(rule),
      };
    })
    .filter((c) => c.cobradoCents > 0 || c.produccionCents > 0)
    .sort(
      (a, b) =>
        (b.comisionCents ?? -1) - (a.comisionCents ?? -1) ||
        b.cobradoCents - a.cobradoCents ||
        a.nombre.localeCompare(b.nombre),
    );
}

/** Lo que pinta la pantalla de la caja del día. */
export interface ResumenCajaDelDia {
  fecha: string;
  timeZone: string;
  cobradoCents: number;
  /** Cobros (un repartido cuenta uno). */
  cantidadCobros: number;
  /** Profesionales distintos a los que se les atribuye algún cobro. */
  cantidadProfesionales: number;
  /** Efectivo del día (entra al cajón) y lo que va al banco. */
  enEfectivoCents: number;
  aConciliarCents: number;
  porHora: CobroPorHora[];
  porMedio: MedioDelDia[];
  movimientos: MovimientoDelDia[];
  atendidasSinCobro: AtendidaSinCobro[];
  /** Saldo de las atendidas sin cobro. `null` sin permiso de finanzas. */
  porCobrarCents: number | null;
  /** `null` = el rol no ve comisiones de otros (sin `finance:view`). */
  comisiones: ComisionDelDia[] | null;
  /** Quién abrió la caja abierta, si hay y se puede leer. */
  abiertaPor: string | null;
  /** Sucursal de la caja (o la única de la clínica). */
  sucursal: string | null;
  /** true si alguna lectura pasó de las páginas permitidas (no debería). */
  truncado: boolean;
}

/** Arma el resumen completo a partir de las filas del día. */
export function armarResumen(input: {
  fecha: string;
  timeZone: string;
  pagos: readonly PagoDelDia[];
  citas: readonly CitaDelDia[];
  pacientes: ReadonlyMap<string, string>;
  items: ReadonlyMap<string, ItemCobrado>;
  profesionales: readonly ProfesionalDelDia[];
  saldos: ReadonlyMap<string, number> | null;
  comisiones: {
    produccion: ReadonlyMap<string, { cents: number; cantidad: number }>;
    reglas: ReadonlyMap<string, CommissionRuleAmounts>;
  } | null;
  abiertaPor: string | null;
  sucursal: string | null;
  truncado: boolean;
}): ResumenCajaDelDia {
  const profesionales = new Map(input.profesionales.map((p) => [p.id, p]));
  const citasPorPaciente = new Map<string, CitaDelDia[]>();
  for (const c of input.citas) {
    const lista = citasPorPaciente.get(c.patientId) ?? [];
    lista.push(c);
    citasPorPaciente.set(c.patientId, lista);
  }
  const movimientos = armarMovimientos(input.pagos, {
    timeZone: input.timeZone,
    pacientes: input.pacientes,
    items: input.items,
    citasPorPaciente,
    profesionales,
  });
  const atendidas = atendidasSinCobro(input.citas, new Set(input.pagos.map((p) => p.patientId)), {
    timeZone: input.timeZone,
    pacientes: input.pacientes,
    profesionales,
    saldos: input.saldos,
  });
  const porMedio = mezclaPorMedio(input.pagos);
  const enEfectivoCents = porMedio.filter((m) => m.enEfectivo).reduce((s, m) => s + m.cents, 0);
  const cobradoCents = input.pagos.reduce((s, p) => s + p.amountCents, 0);
  return {
    fecha: input.fecha,
    timeZone: input.timeZone,
    cobradoCents,
    cantidadCobros: movimientos.length,
    cantidadProfesionales: new Set(
      movimientos.map((m) => m.professionalId).filter((id): id is string => id !== null),
    ).size,
    enEfectivoCents,
    aConciliarCents: cobradoCents - enEfectivoCents,
    porHora: cobrosPorHora(input.pagos, input.timeZone),
    porMedio,
    movimientos,
    atendidasSinCobro: atendidas,
    porCobrarCents: input.saldos ? porCobrarDelDia(atendidas) : null,
    comisiones: input.comisiones
      ? comisionesDelDia(
          input.profesionales,
          movimientos,
          input.comisiones.produccion,
          input.comisiones.reglas,
        )
      : null,
    abiertaPor: input.abiertaPor,
    sucursal: input.sucursal,
    truncado: input.truncado,
  };
}
