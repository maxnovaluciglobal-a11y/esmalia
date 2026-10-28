import {
  contarFilas,
  rutSintetico,
  diaRelativo,
  instanteDeLaClinica,
  paso,
  USUARIO_DEMO_ID,
  type Admin,
  type ContextoDemo,
  type PasoDeSiembra,
} from "@/lib/demo/contexto.server";
import { sumarDiasCiviles } from "@/lib/demo/dia-de-la-clinica";

/**
 * Demo completa · el historial de la clínica: tres meses de atenciones y cobros anteriores a
 * la semilla de `reset_demo_clinic()` (que solo cubre los últimos ~20 días), para que los
 * informes tengan período anterior contra el cual comparar, los gráficos tengan forma, las
 * cuentas por cobrar tengan distinta antigüedad y los pacientes nuevos se repartan en el tiempo.
 *
 * Todas las fechas son relativas al "hoy" de la clínica (regla 7), nunca al día de UTC, y todo
 * es idempotente: cada paso mira si su parte ya existe antes de sembrar.
 */

/** Generador pseudoaleatorio determinista: la demo se ve igual en cada reseteo. */
function lcg(semilla: number) {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const MEDIOS = [
  "cash",
  "debit_card",
  "debit_card",
  "credit_card",
  "credit_card",
  "transfer",
  "cash",
  "transfer",
] as const;

type Procedimiento = { id: string; name: string; price: number; minutos: number };

async function cargarProcedimientos(ctx: ContextoDemo): Promise<Procedimiento[]> {
  const { data } = await ctx.admin
    .from("procedures")
    .select("id, name, default_price_cents, duration_min")
    .eq("clinic_id", ctx.clinicId)
    .order("code");
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.default_price_cents,
    minutos: p.duration_min ?? 30,
  }));
}

function sumarMinutos(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutos;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Día de la semana (1 = lunes … 7 = domingo) de una fecha civil. */
function diaDeLaSemana(dia: string): number {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// ─── Atenciones y cobros de los 3 meses anteriores ───────────────────────

async function sembrarAtencionesAnteriores(ctx: ContextoDemo) {
  const corte = instanteDeLaClinica(ctx, diaRelativo(ctx, -30), "00:00");
  const { count } = await ctx.admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .lt("starts_at", corte);
  if ((count ?? 0) > 0) return;
  const procs = await cargarProcedimientos(ctx);
  if (procs.length === 0 || ctx.pacientes.length === 0 || ctx.profesionales.length === 0) return;
  const clinicas = procs.filter((p) => p.price <= 250_000);

  const azar = lcg(20261028);
  type Visita = {
    paciente: string;
    profesional: string;
    sucursal: string | undefined;
    proc: Procedimiento;
    dia: string;
    inicio: string;
    fin: string;
    estado: "finalizada" | "ausente" | "cancelada";
    medio: (typeof MEDIOS)[number];
    pagada: boolean;
  };
  const visitas: Visita[] = [];
  // Del día -31 al -100: de lunes a sábado, un puñado de citas por día.
  for (let atras = 31; atras <= 100; atras++) {
    const dia = diaRelativo(ctx, -atras);
    const dow = diaDeLaSemana(dia);
    if (dow === 7) continue;
    // Pocos días con mucho movimiento y otros tranquilos, para que el gráfico tenga forma.
    const cuantas = dow === 6 ? 2 : 2 + Math.floor(azar() * 3);
    const horas = ["09:00", "10:30", "12:00", "15:00", "16:30"];
    ctx.profesionales.forEach((prof, ip) => {
      for (let k = 0; k < cuantas; k++) {
        if ((ip + k + atras) % 3 === 0) continue;
        const hora = horas[(k + ip) % horas.length];
        const proc = clinicas[Math.floor(azar() * clinicas.length)];
        const paciente = ctx.pacientes[Math.floor(azar() * ctx.pacientes.length)];
        const r = azar();
        visitas.push({
          paciente: paciente.id,
          profesional: prof.id,
          sucursal: prof.sucursalId ?? ctx.sucursales[0]?.id,
          proc,
          dia,
          inicio: hora,
          fin: sumarMinutos(hora, proc.minutos),
          estado: r < 0.82 ? "finalizada" : r < 0.92 ? "ausente" : "cancelada",
          medio: MEDIOS[Math.floor(azar() * MEDIOS.length)],
          // Una de cada diez atenciones queda sin cobrar: da saldos pendientes creíbles.
          pagada: azar() < 0.9,
        });
      }
    });
  }

  const citas = visitas.map((v) => ({
    clinic_id: ctx.clinicId,
    branch_id: v.sucursal,
    patient_id: v.paciente,
    professional_id: v.profesional,
    procedure_id: v.proc.id,
    treatment_label: v.proc.name,
    starts_at: instanteDeLaClinica(ctx, v.dia, v.inicio),
    ends_at: instanteDeLaClinica(ctx, v.dia, v.fin),
    status: v.estado,
    created_by: USUARIO_DEMO_ID,
    created_at: instanteDeLaClinica(ctx, sumarDiasCiviles(v.dia, -3), "11:00"),
  }));
  for (let i = 0; i < citas.length; i += 100) {
    const { error } = await ctx.admin.from("appointments").insert(citas.slice(i, i + 100) as never);
    if (error) throw new Error(`citas anteriores: ${error.message}`);
  }

  // Cada atención realizada es una prestación de un plan "Atenciones anteriores" del paciente:
  // así lo realizado, lo cobrado y el saldo cuadran (cobrado = realizado, salvo el 10 % sin
  // cobrar) y los informes por profesional y por mes tienen producción.
  const realizadas = visitas.filter((v) => v.estado === "finalizada");
  const pacientesConAtencion = [...new Set(realizadas.map((v) => v.paciente))];
  const { data: planes, error: errPlanes } = await ctx.admin
    .from("treatment_plans")
    .insert(
      pacientesConAtencion.map((id) => ({
        clinic_id: ctx.clinicId,
        patient_id: id,
        name: "Atenciones anteriores",
        status: "completed" as const,
        total_cents: realizadas
          .filter((v) => v.paciente === id)
          .reduce((suma, v) => suma + v.proc.price, 0),
        created_by: USUARIO_DEMO_ID,
        created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -100), "09:00"),
        started_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -100), "09:00"),
        completed_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -31), "19:00"),
      })),
    )
    .select("id, patient_id");
  if (errPlanes) throw new Error(`planes anteriores: ${errPlanes.message}`);
  const planDe = new Map((planes ?? []).map((p) => [p.patient_id, p.id]));
  const posicion = new Map<string, number>();
  const claves: string[] = [];
  const items = realizadas.map((v) => {
    const pos = (posicion.get(v.paciente) ?? 0) + 1;
    posicion.set(v.paciente, pos);
    claves.push(`${planDe.get(v.paciente)}:${pos}`);
    return {
      clinic_id: ctx.clinicId,
      plan_id: planDe.get(v.paciente)!,
      procedure_id: v.proc.id,
      name_snapshot: v.proc.name,
      price_cents: v.proc.price,
      status: "completed" as const,
      completed_at: instanteDeLaClinica(ctx, v.dia, v.fin),
      completed_by: USUARIO_DEMO_ID,
      professional_id: v.profesional,
      position: pos,
    };
  });
  const idPorMarca = new Map<string, string>();
  for (let i = 0; i < items.length; i += 100) {
    const { data, error } = await ctx.admin
      .from("treatment_items")
      .insert(items.slice(i, i + 100))
      .select("id, plan_id, position");
    if (error) throw new Error(`prestaciones anteriores: ${error.message}`);
    for (const f of data ?? []) idPorMarca.set(`${f.plan_id}:${f.position}`, f.id);
  }
  const pagos = realizadas
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.pagada)
    .map(({ v, i }) => ({
      clinic_id: ctx.clinicId,
      patient_id: v.paciente,
      amount_cents: v.proc.price,
      method: v.medio,
      paid_at: instanteDeLaClinica(ctx, v.dia, v.fin),
      notes: `Pago ${v.proc.name.toLowerCase()}`,
      created_by: USUARIO_DEMO_ID,
      treatment_item_id: idPorMarca.get(claves[i]) ?? null,
      treatment_plan_id: planDe.get(v.paciente) ?? null,
    }));
  for (let i = 0; i < pagos.length; i += 100) {
    const { error } = await ctx.admin.from("payments").insert(pagos.slice(i, i + 100) as never);
    if (error) throw new Error(`cobros anteriores: ${error.message}`);
  }
}

/** Reparte el alta de los pacientes en los últimos meses (todos nacían "hoy" en cada reseteo). */
async function repartirAltasDePacientes(ctx: ContextoDemo) {
  const dias = [150, 128, 110, 94, 80, 52, 34, 17, 5, 2];
  // Idempotente: recién reseteada, casi todos los pacientes tienen el alta de las últimas horas.
  const { count } = await ctx.admin
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .gt("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString());
  if ((count ?? 0) < 6) return;
  for (let i = 0; i < ctx.pacientes.length; i++) {
    const d = dias[i % dias.length];
    const { error } = await ctx.admin
      .from("patients")
      .update({ created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -d), "10:00") })
      .eq("id", ctx.pacientes[i].id)
      .eq("clinic_id", ctx.clinicId);
    if (error) throw new Error(`altas de pacientes: ${error.message}`);
  }
}

// ─── Presupuestos de los meses anteriores ────────────────────────────────

type PresupuestoPasado = {
  numero: string;
  hace: number;
  estado: "accepted" | "rejected" | "expired" | "sent";
  items: readonly [string, number][];
};

const PRESUPUESTOS_PASADOS: readonly PresupuestoPasado[] = [
  {
    numero: "DEMO-0101",
    hace: 82,
    estado: "accepted",
    items: [
      ["Resina / obturación", 2],
      ["Control y limpieza", 1],
    ],
  },
  {
    numero: "DEMO-0102",
    hace: 71,
    estado: "accepted",
    items: [
      ["Endodoncia", 1],
      ["Corona dental", 1],
    ],
  },
  { numero: "DEMO-0103", hace: 63, estado: "rejected", items: [["Blanqueamiento dental", 1]] },
  {
    numero: "DEMO-0104",
    hace: 55,
    estado: "accepted",
    items: [
      ["Extracción simple", 2],
      ["Control y limpieza", 1],
    ],
  },
  { numero: "DEMO-0105", hace: 48, estado: "expired", items: [["Instalación de brackets", 1]] },
  { numero: "DEMO-0106", hace: 41, estado: "accepted", items: [["Resina / obturación", 3]] },
  { numero: "DEMO-0107", hace: 34, estado: "sent", items: [["Corona dental", 2]] },
  // Vence en 3 días: alimenta "Por vencer" y el seguimiento de presupuestos.
  {
    numero: "DEMO-0108",
    hace: 27,
    estado: "sent",
    items: [
      ["Blanqueamiento dental", 1],
      ["Control y limpieza", 1],
    ],
  },
];

async function sembrarPresupuestosAnteriores(ctx: ContextoDemo) {
  const { count } = await ctx.admin
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("number", PRESUPUESTOS_PASADOS[0].numero);
  if ((count ?? 0) > 0) return;
  const procs = await cargarProcedimientos(ctx);
  const porNombre = new Map(procs.map((p) => [p.name, p]));
  for (const [i, q] of PRESUPUESTOS_PASADOS.entries()) {
    const paciente = ctx.pacientes[(i * 3 + 1) % ctx.pacientes.length];
    const prof = ctx.profesionales[i % ctx.profesionales.length];
    const lineas = q.items
      .map(([nombre, cantidad]) => ({ proc: porNombre.get(nombre), cantidad }))
      .filter((l): l is { proc: Procedimiento; cantidad: number } => !!l.proc);
    if (lineas.length === 0) continue;
    const total = lineas.reduce((s, l) => s + l.proc.price * l.cantidad, 0);
    const creado = instanteDeLaClinica(ctx, diaRelativo(ctx, -q.hace), "10:00");
    const { data: quote, error } = await ctx.admin
      .from("quotes")
      .insert({
        clinic_id: ctx.clinicId,
        patient_id: paciente.id,
        professional_id: prof.id,
        number: q.numero,
        status: "sent",
        subtotal_cents: total,
        total_cents: total,
        created_by: USUARIO_DEMO_ID,
        created_at: creado,
        sent_at: creado,
        valid_until: diaRelativo(ctx, -q.hace + 30),
      })
      .select("id")
      .single();
    if (error) throw new Error(`presupuesto ${q.numero}: ${error.message}`);
    const { error: errItems } = await ctx.admin.from("quote_items").insert(
      lineas.map((l, pos) => ({
        clinic_id: ctx.clinicId,
        quote_id: quote.id,
        procedure_id: l.proc.id,
        name_snapshot: l.proc.name,
        quantity: l.cantidad,
        unit_price_cents: l.proc.price,
        total_cents: l.proc.price * l.cantidad,
        position: pos + 1,
      })),
    );
    if (errItems) throw new Error(`ítems de ${q.numero}: ${errItems.message}`);

    if (q.estado === "accepted") {
      // El disparador `convert_accepted_quote_to_plan` crea el plan y sus ítems.
      const { error: errAcepta } = await ctx.admin
        .from("quotes")
        .update({ status: "accepted", accepted_at: creado })
        .eq("id", quote.id)
        .eq("clinic_id", ctx.clinicId);
      if (errAcepta) throw new Error(`aceptar ${q.numero}: ${errAcepta.message}`);
      const { data: plan } = await ctx.admin
        .from("treatment_plans")
        .select("id")
        .eq("clinic_id", ctx.clinicId)
        .eq("quote_id", quote.id)
        .maybeSingle();
      if (plan) {
        const terminado = instanteDeLaClinica(
          ctx,
          diaRelativo(ctx, -Math.max(q.hace - 12, 3)),
          "13:00",
        );
        await ctx.admin
          .from("treatment_items")
          .update({ status: "completed", completed_at: terminado, professional_id: prof.id })
          .eq("plan_id", plan.id)
          .eq("clinic_id", ctx.clinicId);
        await ctx.admin
          .from("treatment_plans")
          .update({ created_at: creado, started_at: creado })
          .eq("id", plan.id)
          .eq("clinic_id", ctx.clinicId);
      }
    } else if (q.estado === "rejected") {
      await ctx.admin
        .from("quotes")
        .update({
          status: "rejected",
          rejected_at: diaRelativo(ctx, -q.hace + 6) + "T15:00:00Z",
          rejection_reason: "Prefiere esperar al próximo mes.",
        })
        .eq("id", quote.id)
        .eq("clinic_id", ctx.clinicId);
    } else if (q.estado === "expired") {
      await ctx.admin
        .from("quotes")
        .update({ status: "expired", expired_at: diaRelativo(ctx, -q.hace + 30) + "T04:00:00Z" })
        .eq("id", quote.id)
        .eq("clinic_id", ctx.clinicId);
    }
  }
}

// ─── Gastos de los meses anteriores ──────────────────────────────────────

const GASTOS_VARIABLES = [
  {
    categoria: "Insumos",
    descripcion: "Reposición de insumos clínicos",
    proveedor: "Dental Sur",
    monto: 214_000,
    dia: 9,
  },
  {
    categoria: "Laboratorio",
    descripcion: "Trabajos de laboratorio del mes",
    proveedor: "Laboratorio Dental Andes",
    monto: 186_000,
    dia: 14,
  },
  {
    categoria: "Marketing",
    descripcion: "Publicidad en redes",
    proveedor: "Meta",
    monto: 90_000,
    dia: 17,
  },
  {
    categoria: "Mantención",
    descripcion: "Mantención del autoclave",
    proveedor: "Servicio Técnico Dental",
    monto: 75_000,
    dia: 22,
  },
] as const;

async function sembrarGastosAnteriores(ctx: ContextoDemo) {
  const { data: previos } = await ctx.admin
    .from("expenses")
    .select("id")
    .eq("clinic_id", ctx.clinicId)
    .lt("incurred_on", diaRelativo(ctx, -35))
    .limit(1);
  if ((previos?.length ?? 0) > 0) return;
  const { data: fijos } = await ctx.admin
    .from("recurring_expenses")
    .select("id, category, description, supplier, amount_cents, day_of_month")
    .eq("clinic_id", ctx.clinicId);
  const filas: Record<string, unknown>[] = [];
  for (let m = 1; m <= 3; m++) {
    const base = sumarDiasCiviles(`${ctx.hoy.slice(0, 7)}-01`, -m * 28);
    const mes = base.slice(0, 7);
    for (const f of fijos ?? []) {
      if (f.category === "Software" && m > 2) continue;
      filas.push({
        clinic_id: ctx.clinicId,
        category: f.category,
        description: f.description,
        supplier: f.supplier,
        amount_cents: f.amount_cents,
        incurred_on: `${mes}-${String(Math.min(f.day_of_month, 28)).padStart(2, "0")}`,
        recurring_expense_id: f.id,
        recurring_period: `${mes}-01`,
        created_by: USUARIO_DEMO_ID,
      });
    }
    for (const g of GASTOS_VARIABLES) {
      filas.push({
        clinic_id: ctx.clinicId,
        category: g.categoria,
        description: g.descripcion,
        supplier: g.proveedor,
        amount_cents: g.monto + m * 4_000,
        incurred_on: `${mes}-${String(g.dia).padStart(2, "0")}`,
        created_by: USUARIO_DEMO_ID,
      });
    }
  }
  const { error } = await ctx.admin.from("expenses").insert(filas as never);
  if (error) throw new Error(`gastos anteriores: ${error.message}`);
}

// ─── Cuentas por cobrar con distinta antigüedad ──────────────────────────

type CuentaDeEjemplo = {
  descripcion: string;
  monto: number;
  emitida: number;
  vence: number | null;
  abonado: number;
  anulada?: string;
  cuotas?: number;
};

const CUENTAS: readonly CuentaDeEjemplo[] = [
  {
    descripcion: "Corona dental pieza 2.6",
    monto: 250_000,
    emitida: -125,
    vence: -100,
    abonado: 70_000,
  },
  {
    descripcion: "Tratamiento de ortodoncia · fase 1",
    monto: 380_000,
    emitida: -90,
    vence: -65,
    abonado: 120_000,
  },
  { descripcion: "Endodoncia pieza 4.6", monto: 180_000, emitida: -60, vence: -35, abonado: 0 },
  {
    descripcion: "Prótesis removible superior",
    monto: 420_000,
    emitida: -30,
    vence: -8,
    abonado: 0,
  },
  {
    descripcion: "Prótesis fija de tres piezas · saldo",
    monto: 280_000,
    emitida: -20,
    vence: 0,
    abonado: 100_000,
  },
  {
    descripcion: "Plan de rehabilitación · cuota inicial",
    monto: 360_000,
    emitida: -5,
    vence: 25,
    abonado: 0,
    cuotas: 3,
  },
  {
    descripcion: "Blanqueamiento dental",
    monto: 120_000,
    emitida: -50,
    vence: -40,
    abonado: 120_000,
  },
  {
    descripcion: "Limpieza y flúor",
    monto: 45_000,
    emitida: -45,
    vence: null,
    abonado: 0,
    anulada: "Se cobró en el mesón con otro medio.",
  },
];

async function sembrarCuentasPorCobrarAnteriores(ctx: ContextoDemo) {
  const { count } = await ctx.admin
    .from("receivables")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("description", CUENTAS[0].descripcion);
  if ((count ?? 0) > 0) return;
  const filas = CUENTAS.map((c, i) => {
    const paciente = ctx.pacientes[(i * 2 + 3) % ctx.pacientes.length];
    return {
      clinic_id: ctx.clinicId,
      patient_id: paciente.id,
      description: c.descripcion,
      amount_cents: c.monto,
      issued_on: diaRelativo(ctx, c.emitida),
      due_on: c.vence === null ? null : diaRelativo(ctx, c.vence),
      created_by: USUARIO_DEMO_ID,
      ...(c.anulada
        ? {
            voided_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -44), "12:00"),
            voided_by: USUARIO_DEMO_ID,
            void_reason: c.anulada,
          }
        : {}),
    };
  });
  const { data, error } = await ctx.admin
    .from("receivables")
    .insert(filas)
    .select("id, patient_id, description");
  if (error) throw new Error(`cuentas por cobrar: ${error.message}`);
  const porDescripcion = new Map((data ?? []).map((r) => [r.description, r]));
  const abonos: Record<string, unknown>[] = [];
  for (const [i, c] of CUENTAS.entries()) {
    const cuenta = porDescripcion.get(c.descripcion);
    if (!cuenta) continue;
    if (c.abonado > 0) {
      abonos.push({
        clinic_id: ctx.clinicId,
        patient_id: cuenta.patient_id,
        receivable_id: cuenta.id,
        amount_cents: c.abonado,
        method: MEDIOS[i % MEDIOS.length],
        paid_at: instanteDeLaClinica(ctx, diaRelativo(ctx, c.emitida + 12), "12:30"),
        notes: `Abono · ${c.descripcion}`,
        created_by: USUARIO_DEMO_ID,
      });
    }
    if (c.cuotas) {
      const cuota = Math.floor(c.monto / c.cuotas);
      const cuotas = Array.from({ length: c.cuotas }, (_, k) => ({
        due_on: diaRelativo(ctx, c.vence! + k * 30),
        amount_cents: k === c.cuotas! - 1 ? c.monto - cuota * (c.cuotas! - 1) : cuota,
      }));
      const { error: errCuotas } = await ctx.admin.rpc("definir_cuotas", {
        p_receivable_id: cuenta.id,
        p_cuotas: cuotas as never,
      });
      if (errCuotas) throw new Error(`cuotas: ${errCuotas.message}`);
    }
  }
  if (abonos.length > 0) {
    const { error: errAbonos } = await ctx.admin.from("payments").insert(abonos as never);
    if (errAbonos) throw new Error(`abonos: ${errAbonos.message}`);
  }
}

// ─── Pacientes sin visita reciente ───────────────────────────────────────

const PACIENTES_SIN_VISITA = [
  {
    nombre: "Constanza Araya Molina",
    rut: 17_456_789,
    nacimiento: "1990-05-14",
    estado: "inactive",
    hace: 290,
  },
  {
    nombre: "Felipe Cortés Ibarra",
    rut: 16_789_012,
    nacimiento: "1984-11-02",
    estado: "active",
    hace: 232,
  },
  {
    nombre: "Valeria Domínguez Paz",
    rut: 15_321_654,
    nacimiento: "1977-08-29",
    estado: "inactive",
    hace: 205,
  },
] as const;

/**
 * Tres pacientes cuya última visita fue hace más de seis meses y sin cita futura: son los que
 * muestran "Sin visita en 6 meses" y "Sin cita futura" en Pacientes y alimentan la reactivación.
 */
async function sembrarPacientesSinVisitaReciente(ctx: ContextoDemo) {
  const { count } = await ctx.admin
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("full_name", PACIENTES_SIN_VISITA[0].nombre);
  if ((count ?? 0) > 0) return;
  const prof = ctx.profesionales[0];
  const sucursal = prof?.sucursalId ?? ctx.sucursales[0]?.id ?? null;
  const procs = await cargarProcedimientos(ctx);
  const control = procs.find((p) => p.name === "Control y limpieza") ?? procs[0];
  for (const [i, f] of PACIENTES_SIN_VISITA.entries()) {
    const correo = f.nombre
      .split(" ")[0]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const { data: paciente, error } = await ctx.admin
      .from("patients")
      .insert({
        clinic_id: ctx.clinicId,
        branch_id: sucursal,
        primary_professional_id: prof?.id ?? null,
        full_name: f.nombre,
        document_id: rutSintetico(f.rut),
        birth_date: f.nacimiento,
        phone: `+56 9 6123 45${11 + i}`,
        email: `${correo}@demo.esmalia.com`,
        status: f.estado,
        created_by: USUARIO_DEMO_ID,
        created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -(f.hace + 60)), "10:00"),
      })
      .select("id")
      .single();
    if (error) throw new Error(`paciente sin visita reciente: ${error.message}`);
    if (!prof || !sucursal || !control) continue;
    const dia = diaRelativo(ctx, -f.hace);
    const { error: errCita } = await ctx.admin.from("appointments").insert({
      clinic_id: ctx.clinicId,
      branch_id: sucursal,
      patient_id: paciente.id,
      professional_id: prof.id,
      procedure_id: control.id,
      treatment_label: control.name,
      starts_at: instanteDeLaClinica(ctx, dia, "10:00"),
      ends_at: instanteDeLaClinica(ctx, dia, "10:30"),
      status: "finalizada",
      created_by: USUARIO_DEMO_ID,
      created_at: instanteDeLaClinica(ctx, sumarDiasCiviles(dia, -3), "11:00"),
    });
    if (errCita) throw new Error(`cita de ${f.nombre}: ${errCita.message}`);
  }
}

// ─── Producción del mes en curso ─────────────────────────────────────────

/**
 * Prestaciones realizadas en lo que va del mes (calendario de la clínica), repartidas entre
 * los profesionales y con pagos de la mayoría, para que Finanzas, Comisiones, "Mi desempeño"
 * y Empresas con convenio muestren producción real del período. Los afiliados al convenio
 * llevan su descuento del 15 % (lo que paga el paciente va en `patient_cents`).
 */
async function sembrarProduccionDelMes(ctx: ContextoDemo) {
  const { count } = await ctx.admin
    .from("treatment_plans")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("name", "Tratamientos del mes");
  if ((count ?? 0) > 0) return;
  const procs = (await cargarProcedimientos(ctx)).filter((p) => p.price <= 250_000);
  if (procs.length === 0 || ctx.profesionales.length === 0 || ctx.pacientes.length === 0) return;
  const { data: afiliados } = await ctx.admin
    .from("partner_company_patients")
    .select("patient_id")
    .eq("clinic_id", ctx.clinicId);
  const idsAfiliados = (afiliados ?? []).map((a) => a.patient_id);
  const conAtencion = ctx.pacientes.filter((p) => p.nombre !== PACIENTES_SIN_VISITA[0].nombre);
  const inicioMes = `${ctx.hoy.slice(0, 7)}-01`;
  const dias: string[] = [];
  for (let d = inicioMes; d <= ctx.hoy; d = sumarDiasCiviles(d, 1)) dias.push(d);
  const horas = ["10:00", "11:30", "15:30"];

  type Prestacion = {
    paciente: string;
    profesional: string;
    proc: Procedimiento;
    dia: string;
    hora: string;
    afiliado: boolean;
    pagada: boolean;
    medio: (typeof MEDIOS)[number];
  };
  const prestaciones: Prestacion[] = [];
  ctx.profesionales.forEach((prof, ip) => {
    for (let k = 0; k < 3; k++) {
      const idx = ip * 3 + k;
      const afiliado = idsAfiliados.length > 0 && idx < idsAfiliados.length * 2 && idx % 2 === 0;
      const paciente = afiliado
        ? idsAfiliados[(idx / 2) % idsAfiliados.length]
        : conAtencion[(idx * 3 + 2) % conAtencion.length].id;
      prestaciones.push({
        paciente,
        profesional: prof.id,
        proc: procs[(idx * 5 + 1) % procs.length],
        dia: dias[Math.min(dias.length - 1, Math.floor((k * dias.length) / 3 + (ip % 2)))],
        hora: horas[(k + ip) % horas.length],
        afiliado,
        pagada: k < 2,
        medio: MEDIOS[(idx + 2) % MEDIOS.length],
      });
    }
  });

  const porPaciente = new Map<string, Prestacion[]>();
  for (const pr of prestaciones) {
    porPaciente.set(pr.paciente, [...(porPaciente.get(pr.paciente) ?? []), pr]);
  }
  const aPagar = (pr: Prestacion) =>
    pr.afiliado ? pr.proc.price - Math.round(pr.proc.price * 0.15) : pr.proc.price;
  const { data: planes, error: errPlanes } = await ctx.admin
    .from("treatment_plans")
    .insert(
      [...porPaciente.entries()].map(([id, lista]) => ({
        clinic_id: ctx.clinicId,
        patient_id: id,
        name: "Tratamientos del mes",
        status: "active" as const,
        total_cents: lista.reduce((suma, pr) => suma + pr.proc.price, 0),
        created_by: USUARIO_DEMO_ID,
        started_at: instanteDeLaClinica(ctx, inicioMes, "09:00"),
      })),
    )
    .select("id, patient_id");
  if (errPlanes) throw new Error(`plan del mes: ${errPlanes.message}`);
  const planDe = new Map((planes ?? []).map((pl) => [pl.patient_id, pl.id]));
  const posicion = new Map<string, number>();
  const claves: string[] = [];
  const items = prestaciones.map((pr) => {
    const planId = planDe.get(pr.paciente)!;
    const pos = (posicion.get(planId) ?? 0) + 1;
    posicion.set(planId, pos);
    claves.push(`${planId}:${pos}`);
    return {
      clinic_id: ctx.clinicId,
      plan_id: planId,
      procedure_id: pr.proc.id,
      name_snapshot: pr.proc.name,
      price_cents: pr.proc.price,
      patient_cents: pr.afiliado ? aPagar(pr) : null,
      status: "completed" as const,
      completed_at: instanteDeLaClinica(ctx, pr.dia, pr.hora),
      completed_by: USUARIO_DEMO_ID,
      professional_id: pr.profesional,
      position: pos,
    };
  });
  const { data: creados, error: errItems } = await ctx.admin
    .from("treatment_items")
    .insert(items)
    .select("id, plan_id, position");
  if (errItems) throw new Error(`prestaciones del mes: ${errItems.message}`);
  const idPorClave = new Map((creados ?? []).map((it) => [`${it.plan_id}:${it.position}`, it.id]));
  const pagos = prestaciones
    .map((pr, i) => ({ pr, i }))
    .filter(({ pr }) => pr.pagada)
    .map(({ pr, i }) => ({
      clinic_id: ctx.clinicId,
      patient_id: pr.paciente,
      amount_cents: aPagar(pr),
      method: pr.medio,
      paid_at: instanteDeLaClinica(ctx, pr.dia, sumarMinutos(pr.hora, 60)),
      notes: `Pago ${pr.proc.name.toLowerCase()}`,
      created_by: USUARIO_DEMO_ID,
      treatment_item_id: idPorClave.get(claves[i]) ?? null,
      treatment_plan_id: planDe.get(pr.paciente) ?? null,
    }));
  const { error: errPagos } = await ctx.admin.from("payments").insert(pagos as never);
  if (errPagos) throw new Error(`cobros del mes: ${errPagos.message}`);
}

// ─── Inventario, esterilización y membresías: lo que faltaba mostrar ─────

async function completarInventarioEsterilizacionYMembresias(ctx: ContextoDemo) {
  // Inventario: cada insumo en la sucursal que lo usa (antes salían "Sin asignar").
  const { data: insumos } = await ctx.admin
    .from("inventory_items")
    .select("id")
    .eq("clinic_id", ctx.clinicId)
    .is("branch_id", null)
    .order("name");
  for (const [i, it] of (insumos ?? []).entries()) {
    const sucursal = ctx.sucursales[i % Math.max(ctx.sucursales.length, 1)];
    if (!sucursal) break;
    const { error } = await ctx.admin
      .from("inventory_items")
      .update({ branch_id: sucursal.id })
      .eq("id", it.id)
      .eq("clinic_id", ctx.clinicId);
    if (error) throw new Error(`sucursal del insumo: ${error.message}`);
  }

  // Esterilización: un paquete dado de baja (con su motivo), además de los usados y vigentes.
  const { count: bajas } = await ctx.admin
    .from("sterilization_packages")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .in("status", ["descartado", "retirado"]);
  if ((bajas ?? 0) === 0) {
    const { data: disponible } = await ctx.admin
      .from("sterilization_packages")
      .select("id")
      .eq("clinic_id", ctx.clinicId)
      .eq("status", "disponible")
      .order("number")
      .limit(1)
      .maybeSingle();
    if (disponible) {
      const { error } = await ctx.admin
        .from("sterilization_packages")
        .update({
          status: "descartado",
          discard_reason: "El envoltorio se humedeció al guardarlo; se vuelve a esterilizar.",
          discarded_at: new Date().toISOString(),
          discarded_by: USUARIO_DEMO_ID,
        })
        .eq("id", disponible.id)
        .eq("clinic_id", ctx.clinicId);
      if (error) throw new Error(`baja de un paquete: ${error.message}`);
    }
  }

  // Membresías: una anulada, además de las vigentes.
  const { count: anuladas } = await ctx.admin
    .from("patient_memberships")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("status", "cancelled");
  if ((anuladas ?? 0) === 0) {
    const { data: plan } = await ctx.admin
      .from("membership_plans")
      .select("id, name, fee_cents, billing_period")
      .eq("clinic_id", ctx.clinicId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    const { data: inscritos } = await ctx.admin
      .from("patient_memberships")
      .select("patient_id")
      .eq("clinic_id", ctx.clinicId);
    const yaInscritos = new Set((inscritos ?? []).map((m) => m.patient_id));
    const paciente = ctx.pacientes.find((p) => !yaInscritos.has(p.id));
    if (plan && paciente) {
      const inicio = `${sumarDiasCiviles(`${ctx.hoy.slice(0, 7)}-01`, -62).slice(0, 7)}-01`;
      const { error } = await ctx.admin.from("patient_memberships").insert({
        clinic_id: ctx.clinicId,
        patient_id: paciente.id,
        plan_id: plan.id,
        plan_name_snapshot: plan.name,
        fee_cents: plan.fee_cents,
        billing_period: plan.billing_period,
        starts_on: inicio,
        status: "cancelled",
        cancelled_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -20), "12:00"),
        cancelled_by: USUARIO_DEMO_ID,
        ends_on: `${ctx.hoy.slice(0, 7)}-01`,
        notes: "Se dio de baja por cambio de ciudad.",
        created_by: USUARIO_DEMO_ID,
      });
      if (error) throw new Error(`membresía anulada: ${error.message}`);
    }
  }
}

// ─── Aranceles: paquetes y reajuste de precios ───────────────────────────

const PAQUETES = [
  {
    nombre: "Control semestral completo",
    descripcion: "Control, limpieza y aplicación de flúor.",
    precio: 62_000,
    items: [["Control y limpieza", 1]],
  },
  {
    nombre: "Rehabilitación de una pieza",
    descripcion: "Endodoncia y corona sobre la misma pieza.",
    precio: 395_000,
    items: [
      ["Endodoncia", 1],
      ["Corona dental", 1],
    ],
  },
  {
    nombre: "Inicio de ortodoncia",
    descripcion: "Instalación de brackets y dos controles.",
    precio: 920_000,
    items: [
      ["Instalación de brackets", 1],
      ["Control de ortodoncia", 2],
    ],
  },
] as const;

async function sembrarPaquetes(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "procedure_packages", ctx.clinicId)) > 0) return;
  const procs = await cargarProcedimientos(ctx);
  const porNombre = new Map(procs.map((p) => [p.name, p]));
  for (const [i, p] of PAQUETES.entries()) {
    const { data: paquete, error } = await ctx.admin
      .from("procedure_packages")
      .insert({
        clinic_id: ctx.clinicId,
        name: p.nombre,
        description: p.descripcion,
        price_cents: p.precio,
        currency: "CLP",
        position: i + 1,
        created_by: USUARIO_DEMO_ID,
      })
      .select("id")
      .single();
    if (error) throw new Error(`paquete: ${error.message}`);
    const { error: errItems } = await ctx.admin.from("procedure_package_items").insert(
      p.items.map(([nombre, cantidad], pos) => ({
        clinic_id: ctx.clinicId,
        package_id: paquete.id,
        procedure_id: porNombre.get(nombre)?.id ?? null,
        name_snapshot: nombre,
        quantity: cantidad,
        position: pos + 1,
      })),
    );
    if (errItems) throw new Error(`ítems de paquete: ${errItems.message}`);
  }
}

async function sembrarReajusteDeAranceles(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "procedure_price_realignments", ctx.clinicId)) > 0) return;
  const procs = await cargarProcedimientos(ctx);
  const items = procs.slice(0, 4).map((p) => ({
    procedure_id: p.id,
    name: p.name,
    old_cents: Math.round(p.price / 1.05 / 1000) * 1000,
    new_cents: p.price,
  }));
  const { error } = await ctx.admin.from("procedure_price_realignments").insert({
    clinic_id: ctx.clinicId,
    mode: "percent",
    percent: 5,
    rounding_cents: 1000,
    scope_label: "Todo el arancel",
    affected_count: items.length,
    items,
    created_by: USUARIO_DEMO_ID,
    created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -75), "09:30"),
  } as never);
  if (error) throw new Error(`reajuste de aranceles: ${error.message}`);
}

/** Presupuestos sin profesional ("Sin asignar" en la lista): se reparten entre el equipo clínico. */
async function asignarProfesionalAPresupuestos(ctx: ContextoDemo) {
  const { data: sin } = await ctx.admin
    .from("quotes")
    .select("id")
    .eq("clinic_id", ctx.clinicId)
    .is("professional_id", null)
    .order("created_at");
  for (const [i, q] of (sin ?? []).entries()) {
    const prof = ctx.profesionales[i % ctx.profesionales.length];
    const { error } = await ctx.admin
      .from("quotes")
      .update({ professional_id: prof.id })
      .eq("id", q.id)
      .eq("clinic_id", ctx.clinicId);
    if (error) throw new Error(`profesional del presupuesto: ${error.message}`);
  }
}

export function pasosDeHistorial(admin: Admin): PasoDeSiembra[] {
  return [
    paso(admin, "atenciones y cobros anteriores", sembrarAtencionesAnteriores),
    paso(admin, "altas de pacientes en el tiempo", repartirAltasDePacientes),
    paso(admin, "pacientes sin visita reciente", sembrarPacientesSinVisitaReciente),
    paso(admin, "producción del mes en curso", sembrarProduccionDelMes),
    paso(
      admin,
      "inventario, esterilización y membresías",
      completarInventarioEsterilizacionYMembresias,
    ),
    paso(admin, "presupuestos anteriores", sembrarPresupuestosAnteriores),
    paso(admin, "profesional en los presupuestos", asignarProfesionalAPresupuestos),
    paso(admin, "gastos anteriores", sembrarGastosAnteriores),
    paso(admin, "cuentas por cobrar antiguas", sembrarCuentasPorCobrarAnteriores),
    paso(admin, "paquetes de prestaciones", sembrarPaquetes),
    paso(admin, "reajuste de aranceles", sembrarReajusteDeAranceles),
  ];
}
