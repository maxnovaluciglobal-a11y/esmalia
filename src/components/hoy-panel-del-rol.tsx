import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import type { Cita } from "@/lib/clinic-operations/clinic-data";
import { formatoFecha } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import { fechaCortaHora, hora } from "@/lib/formato-fecha";
import type { Bloque, PanelDeHoy, PerfilDePanel } from "@/lib/panel/panel-por-rol";
import { cn } from "@/lib/utils";

/**
 * Bloques de Hoy por rol (Ola 11 · PAN-04 dirección, PAN-06 profesional,
 * PAN-07 recepción y coordinación, PAN-08 técnico/a dental; REC-10 insumos).
 * Es solo presentación: qué bloques van y si muestran dinero lo decide Hoy con
 * `bloquesDelPanel` / `bloqueMuestraDinero`, y los datos llegan ya recortados
 * por la base (`panel_de_hoy`). Paneles A+ de 14 px, cifras en Cormorant.
 */

const PANEL = "flex min-w-0 flex-col rounded-[14px] border border-hairline bg-card";
const ENLACE =
  "inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-brand-700 underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9";

const TITULO_PERFIL: Record<PerfilDePanel, { antes: string; enfasis: string }> = {
  direccion: { antes: "La clínica", enfasis: "de un vistazo" },
  profesional: { antes: "Tu día", enfasis: "clínico" },
  recepcion: { antes: "El mostrador", enfasis: "de hoy" },
  laboratorio: { antes: "Laboratorio", enfasis: "e insumos" },
  contabilidad: { antes: "Caja y", enfasis: "presupuestos" },
  asistente: { antes: "Insumos", enfasis: "del box" },
};

const ESTADO_LAB: Record<string, string> = {
  enviado: "Enviada",
  en_proceso: "En proceso",
  reprocesar: "Por rehacer",
};

function Tarjeta({
  id,
  titulo,
  enfasis,
  pie,
  children,
}: {
  id: Bloque;
  titulo: string;
  enfasis: string;
  pie?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`bloque-${id}`} className={cn(PANEL, "scroll-mt-24")}>
      <h3
        id={`bloque-${id}`}
        className="px-5 pt-[18px] pb-3 font-display text-[22px] font-medium leading-none"
      >
        {titulo} <em className="text-brand-600">{enfasis}</em>
      </h3>
      <div className="flex-1 px-5 pb-4">{children}</div>
      {pie && <div className="border-t border-hairline px-5 py-1.5">{pie}</div>}
    </section>
  );
}

function Cifra({ valor, label, tono }: { valor: string; label: string; tono?: "warning" }) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "whitespace-nowrap font-display text-[34px] font-medium leading-none [font-variant-numeric:lining-nums]",
          tono === "warning" && "text-warning",
        )}
      >
        {valor}
      </p>
      <p className="mt-1 truncate text-[12.5px] font-semibold text-muted-foreground">{label}</p>
    </div>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

/** `inicio` de una cita son minutos desde las 8:00 (mismo criterio que Hoy). */
function horaDeCita(inicio: number) {
  const total = 8 * 60 + inicio;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function horas(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export interface DatosDelPanel {
  panel: PanelDeHoy | undefined;
  cargando: boolean;
  conError: boolean;
  currency: string;
  zonaHoraria?: string;
  hoy: string;
  citasHoy: Cita[];
  /** Minutos desde las 8:00 de la clínica, ahora. */
  ahoraMin: number;
  myProfessionalId: string | null;
  nombreProfesional: Map<string, string>;
  /** Cobrado hoy formateado (null = no ve finanzas o no cargó). */
  cobradoHoy: string | null;
  /** Por cobrar a los pacientes de hoy formateado (null = no ve finanzas). */
  porCobrarHoy: string | null;
  ocupacion: { porcentaje: number | null; ocupados: number; disponibles: number } | null;
}

export function PanelDelRol({
  perfil,
  bloques,
  muestraDinero,
  datos,
}: {
  perfil: PerfilDePanel;
  bloques: Bloque[];
  muestraDinero: (b: Bloque) => boolean;
  datos: DatosDelPanel;
}) {
  if (bloques.length === 0) return null;
  const titulo = TITULO_PERFIL[perfil];
  return (
    <section aria-labelledby="panel-del-rol" className="space-y-3">
      <h2 id="panel-del-rol" className="font-display text-[30px] font-medium leading-none">
        {titulo.antes} <em className="text-brand-600">{titulo.enfasis}</em>
      </h2>
      {datos.conError && (
        <p role="status" className="text-sm text-muted-foreground">
          Parte del panel no cargó: lo que falta dice “Sin datos”.
        </p>
      )}
      <div className="grid items-stretch gap-[18px] md:grid-cols-2 xl:grid-cols-3">
        {bloques.map((b) => (
          <BloqueDelPanel key={b} bloque={b} dinero={muestraDinero(b)} d={datos} />
        ))}
      </div>
    </section>
  );
}

function BloqueDelPanel({
  bloque,
  dinero,
  d,
}: {
  bloque: Bloque;
  dinero: boolean;
  d: DatosDelPanel;
}) {
  const p = d.panel;
  const sinDatos = d.cargando ? "Cargando…" : "Sin datos";

  switch (bloque) {
    case "caja":
      return (
        <Tarjeta
          id="caja"
          titulo="Caja"
          enfasis="de hoy"
          pie={
            <Link to="/cajas" className={ENLACE}>
              Ir a cajas →
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-4">
            <Cifra valor={p?.cajas ? String(p.cajas.abiertas) : "—"} label="Cajas abiertas" />
            {dinero && <Cifra valor={d.cobradoHoy ?? "—"} label="Cobrado hoy" />}
          </div>
          {p?.cajas?.miaAbiertaDesde && (
            <p className="mt-3 text-sm text-muted-foreground">
              Tu caja está abierta desde las{" "}
              <span className="cifra">{hora(p.cajas.miaAbiertaDesde, d.zonaHoraria)}</span>.
            </p>
          )}
        </Tarjeta>
      );

    case "cobros":
      return (
        <Tarjeta
          id="cobros"
          titulo="Cobros"
          enfasis="del mostrador"
          pie={
            <Link to="/cajas" className={ENLACE}>
              {p?.cajas?.miaAbiertaDesde ? "Ir a tu caja →" : "Abrir caja →"}
            </Link>
          }
        >
          {!p?.cajas ? (
            <Vacio>{sinDatos}</Vacio>
          ) : p.cajas.miaAbiertaDesde ? (
            <p className="text-[15px]">
              Tu caja está <b className="font-semibold">abierta</b> desde las{" "}
              <span className="cifra">{hora(p.cajas.miaAbiertaDesde, d.zonaHoraria)}</span>.
            </p>
          ) : (
            <p className="text-[15px]">
              No tienes una caja abierta. Ábrela antes del primer cobro del día.
            </p>
          )}
          {dinero && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Cifra valor={d.cobradoHoy ?? "—"} label="Cobrado hoy" />
              <Cifra valor={d.porCobrarHoy ?? "—"} label="Por cobrar hoy" />
            </div>
          )}
        </Tarjeta>
      );

    case "ocupacion": {
      const o = d.ocupacion;
      return (
        <Tarjeta
          id="ocupacion"
          titulo="Ocupación"
          enfasis="de hoy"
          pie={
            <Link
              to="/agenda"
              search={{
                q: "",
                fecha: d.hoy,
                vista: "dia",
                sucursal: "",
                profesional: "",
                estado: "",
                page: 1,
              }}
              className={ENLACE}
            >
              Ver huecos en la agenda →
            </Link>
          }
        >
          {!o ? (
            <Vacio>{sinDatos}</Vacio>
          ) : o.porcentaje === null ? (
            <Vacio>
              Sin horario declarado para hoy: carga el horario de cada profesional para medir la
              ocupación.
            </Vacio>
          ) : (
            <>
              <Cifra valor={`${o.porcentaje} %`} label="De las horas declaradas" />
              <div
                aria-hidden
                className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"
                title={`${o.porcentaje} %`}
              >
                <div className="h-full bg-cobalt" style={{ width: `${o.porcentaje}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {horas(o.ocupados)} agendadas de {horas(o.disponibles)}
              </p>
            </>
          )}
        </Tarjeta>
      );
    }

    case "presupuestos": {
      const pr = p?.presupuestos;
      return (
        <Tarjeta
          id="presupuestos"
          titulo="Presupuestos"
          enfasis="en juego"
          pie={
            <Link to="/presupuestos" className={ENLACE}>
              Ver presupuestos →
            </Link>
          }
        >
          {!pr || !dinero ? (
            <Vacio>{sinDatos}</Vacio>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Cifra valor={String(pr.abiertos)} label="Esperan respuesta" />
                <Cifra valor={String(pr.aceptadosMes)} label="Aceptados este mes" />
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Monto que espera respuesta</dt>
                  <dd className="cifra">{formatMoney(pr.abiertosCents, d.currency)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Aceptado este mes</dt>
                  <dd className="cifra">{formatMoney(pr.aceptadosMesCents, d.currency)}</dd>
                </div>
                {pr.porVencer > 0 && (
                  <div className="flex justify-between gap-3 text-warning">
                    <dt>Vencen en 7 días</dt>
                    <dd className="cifra">{pr.porVencer}</dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </Tarjeta>
      );
    }

    case "mi-dia": {
      const mias = d.myProfessionalId
        ? d.citasHoy.filter((c) => c.profesionalId === d.myProfessionalId)
        : [];
      const proximas = mias.filter((c) => c.estado !== "finalizada" && c.estado !== "ausente");
      return (
        <Tarjeta
          id="mi-dia"
          titulo="Tus citas"
          enfasis="de hoy"
          pie={
            <Link to="/mi-agenda" className={ENLACE}>
              Abrir mi agenda →
            </Link>
          }
        >
          {!d.myProfessionalId ? (
            <Vacio>
              Tu usuario no está vinculado a una ficha de profesional. Pídele a administración que
              lo vincule en Profesionales.
            </Vacio>
          ) : mias.length === 0 ? (
            <Vacio>{d.cargando ? "Cargando…" : "No tienes citas hoy."}</Vacio>
          ) : (
            <>
              <p className="mb-2 text-sm text-muted-foreground">
                {mias.length} {mias.length === 1 ? "cita" : "citas"} ·{" "}
                {mias.filter((c) => c.estado === "finalizada").length} atendidas
              </p>
              <ul className="divide-y divide-hairline">
                {proximas.slice(0, 4).map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/pacientes/$pacienteId"
                      params={{ pacienteId: c.pacienteId }}
                      className="flex min-h-11 items-center gap-3 py-1.5 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="w-12 shrink-0 cifra text-sm text-muted-foreground">
                        {horaDeCita(c.inicio)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-display text-[17px] font-medium">{c.paciente}</span>
                        <span className="text-[13px] text-muted-foreground">
                          {" "}
                          · {c.tratamiento}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Tarjeta>
      );
    }

    case "pendientes-clinicos": {
      const notas = p?.notasSinFirmar;
      const revisiones = p?.alertas.revisiones_pedidas ?? 0;
      return (
        <Tarjeta
          id="pendientes-clinicos"
          titulo="Pendientes"
          enfasis="clínicos"
          pie={
            revisiones > 0 ? (
              <Link
                to="/notificaciones"
                search={{ estado: "sin-leer", tipo: "clinico" }}
                className={ENLACE}
              >
                {revisiones} {revisiones === 1 ? "revisión pedida" : "revisiones pedidas"} →
              </Link>
            ) : undefined
          }
        >
          {!notas ? (
            <Vacio>{sinDatos}</Vacio>
          ) : notas.length === 0 ? (
            <Vacio>No tienes notas sin firmar.</Vacio>
          ) : (
            <ul className="divide-y divide-hairline">
              {notas.map((n) => (
                <li key={n.id}>
                  <Link
                    to="/pacientes/$pacienteId"
                    params={{ pacienteId: n.pacienteId }}
                    className="flex min-h-11 flex-col justify-center py-1.5 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="truncate text-[15px] font-medium">
                      {n.paciente ?? "Paciente"} · {n.titulo}
                    </span>
                    <span className="text-[12.5px] text-muted-foreground">
                      Borrador del {fechaCortaHora(n.creada, d.zonaHoraria)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      );
    }

    case "mi-desempeno": {
      const des = p?.desempenoPropio;
      return (
        <Tarjeta
          id="mi-desempeno"
          titulo="Tu desempeño"
          enfasis="del mes"
          pie={
            <Link
              to="/mi-desempeno"
              search={{ desde: `${d.hoy.slice(0, 7)}-01`, hasta: d.hoy }}
              className={ENLACE}
            >
              Ver mi desempeño →
            </Link>
          }
        >
          {!des ? (
            <Vacio>
              {d.cargando
                ? "Cargando…"
                : "Se mide cuando tu usuario está vinculado a un profesional."}
            </Vacio>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Cifra valor={String(des.atendidasMes)} label="Pacientes atendidos" />
              <Cifra
                valor={String(des.ausentesMes)}
                label="No llegaron"
                tono={des.ausentesMes > 0 ? "warning" : undefined}
              />
            </div>
          )}
        </Tarjeta>
      );
    }

    case "reservas-en-linea": {
      const reservas = p?.reservas;
      return (
        <Tarjeta id="reservas-en-linea" titulo="Reservas" enfasis="en línea">
          {!reservas ? (
            <Vacio>{sinDatos}</Vacio>
          ) : reservas.length === 0 ? (
            <Vacio>No hay reservas por aceptar.</Vacio>
          ) : (
            <ul className="divide-y divide-hairline">
              {reservas.map((r) => (
                <li key={r.id} className="flex min-h-12 items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[17px] font-medium">
                      {r.paciente ?? "Paciente"}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      <span className="cifra">{fechaCortaHora(r.inicio, d.zonaHoraria)}</span>
                      {" · "}
                      {d.nombreProfesional.get(r.profesionalId) ?? "Profesional"}
                    </span>
                  </span>
                  <Link
                    to="/agenda"
                    search={{
                      q: "",
                      fecha: r.inicio.slice(0, 10),
                      vista: "dia",
                      sucursal: "",
                      profesional: "",
                      estado: "",
                      page: 1,
                    }}
                    className={ENLACE}
                  >
                    Aceptar →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      );
    }

    case "llegadas": {
      const enSala = d.citasHoy.filter((c) => c.estado === "en-sala");
      const porLlegar = d.citasHoy
        .filter(
          (c) =>
            (c.estado === "tentativa" || c.estado === "confirmada") &&
            c.inicio + c.duracion > d.ahoraMin,
        )
        .slice(0, 4);
      return (
        <Tarjeta id="llegadas" titulo="Llegadas" enfasis="de hoy">
          <div className="mb-3 grid grid-cols-2 gap-4">
            <Cifra valor={String(enSala.length)} label="En sala" />
            <Cifra valor={String(porLlegar.length)} label="Por llegar ahora" />
          </div>
          {enSala.length + porLlegar.length === 0 ? (
            <Vacio>{d.cargando ? "Cargando…" : "Nadie por llegar en este momento."}</Vacio>
          ) : (
            <ul className="divide-y divide-hairline">
              {[...enSala, ...porLlegar].slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link
                    to="/pacientes/$pacienteId"
                    params={{ pacienteId: c.pacienteId }}
                    className="flex min-h-11 items-center gap-3 py-1.5 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="w-12 shrink-0 cifra text-sm text-muted-foreground">
                      {horaDeCita(c.inicio)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-display text-[17px] font-medium">
                      {c.paciente}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[12.5px] font-semibold",
                        c.estado === "en-sala" ? "text-info" : "text-muted-foreground",
                      )}
                    >
                      {c.estado === "en-sala"
                        ? "En sala"
                        : c.pacienteConfirmo
                          ? "Viene"
                          : "Sin respuesta"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      );
    }

    case "laboratorio": {
      const lab = p?.laboratorio;
      return (
        <Tarjeta
          id="laboratorio"
          titulo="Órdenes de"
          enfasis="laboratorio"
          pie={
            <Link to="/laboratorios" search={{ estado: "" }} className={ENLACE}>
              Ir a laboratorio →
            </Link>
          }
        >
          {!lab ? (
            <Vacio>{sinDatos}</Vacio>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-3 gap-3">
                <Cifra
                  valor={String(lab.atrasadas)}
                  label="Atrasadas"
                  tono={lab.atrasadas > 0 ? "warning" : undefined}
                />
                <Cifra valor={String(lab.porRecibirSemana)} label="Llegan en 7 días" />
                <Cifra valor={String(lab.enCurso)} label="En curso" />
              </div>
              {lab.ordenes.length === 0 ? (
                <Vacio>No hay órdenes en curso.</Vacio>
              ) : (
                <ul className="divide-y divide-hairline">
                  {lab.ordenes.map((o) => (
                    <li key={o.id} className="flex min-h-11 items-center gap-3 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">
                          {o.descripcion}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted-foreground">
                          {o.paciente ?? "Paciente"}
                          {o.laboratorio ? ` · ${o.laboratorio}` : ""}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-right text-[12.5px] font-semibold",
                          o.atrasada ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {o.atrasada ? "Atrasada" : (ESTADO_LAB[o.estado] ?? o.estado)}
                        <span className="block font-normal cifra">
                          {o.vence ? formatoFecha(o.vence) : "Sin fecha"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Tarjeta>
      );
    }

    case "insumos": {
      const stock = p?.stockBajo;
      return (
        <Tarjeta
          id="insumos"
          titulo="Insumos"
          enfasis="bajo el mínimo"
          pie={
            <Link to="/inventario" className={ENLACE}>
              Ir a inventario →
            </Link>
          }
        >
          {!stock ? (
            <Vacio>{sinDatos}</Vacio>
          ) : stock.length === 0 ? (
            <Vacio>Todos los insumos con mínimo están sobre su umbral.</Vacio>
          ) : (
            <ul className="divide-y divide-hairline">
              {stock.map((i) => (
                <li key={i.id} className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-[15px] font-medium">{i.nombre}</span>
                  <span className="shrink-0 text-right text-[12.5px]">
                    <span className="cifra font-semibold text-warning">{i.actual}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      de mín. <span className="cifra">{i.minimo}</span> {i.unidad}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      );
    }
  }
}
