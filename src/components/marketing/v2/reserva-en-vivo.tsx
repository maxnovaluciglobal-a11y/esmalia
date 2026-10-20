// "Así reserva tu paciente": un ejemplo usable del pedido de hora del portal
// y lo que ve recepción. Todo es de ejemplo (no lee Supabase ni el portal).
//
// Veracidad: en el portal real el paciente pide una hora y la solicitud
// entra a la bandeja de la agenda para que el equipo la confirme
// (routes/docs.portal-pacientes.tsx). Por eso la cita de ejemplo cae en el
// sillón marcada "por confirmar" y nunca como confirmada.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { EsmaliaLogo } from "@/components/esmalia-logo";

import { hora, minutos } from "./datos-ejemplo";
import {
  AGENDA_BASE,
  DIAS,
  H0,
  HORAS,
  PROFESIONALES,
  SPAN,
  TRATAMIENTOS,
  horasLibres,
  type Evento,
} from "./reserva-datos";

export function ReservaEnVivo() {
  const [tr, setTr] = useState(0);
  const [pro, setPro] = useState(-1);
  const [dia, setDia] = useState(0);
  const [eleccion, setEleccion] = useState<[number, number] | null>(null);
  const [reservas, setReservas] = useState<Record<number, Evento | undefined>>({});
  const [listo, setListo] = useState<string | null>(null);

  const linea = useRef<HTMLDivElement>(null);
  const reservaDelDia = reservas[dia];

  // En pantallas chicas la línea de tiempo se desplaza: se lleva a la vista
  // la cita recién pedida para que se vea caer.
  useEffect(() => {
    const w = linea.current;
    const n = w?.querySelector<HTMLElement>(".lv-ap.new");
    if (!w || !n) return;
    const dx = n.getBoundingClientRect().left - w.getBoundingClientRect().left;
    if (dx < 0 || dx > w.clientWidth - 80) w.scrollLeft += dx - 130;
  }, [reservaDelDia]);

  const dur = TRATAMIENTOS[tr].min;
  const agenda = useMemo(() => {
    const nueva = reservas[dia];
    const base = AGENDA_BASE[dia];
    if (!nueva) return base;
    // El hueco que la reserva ocupa deja de mostrarse como hueco.
    const sinHueco = base.filter(
      (e) =>
        !(
          e.e === "gap" &&
          e.p === nueva.p &&
          minutos(e.ini) < minutos(nueva.fin) &&
          minutos(e.fin) > minutos(nueva.ini)
        ),
    );
    return [...sinHueco, nueva];
  }, [dia, reservas]);
  const libres = useMemo(() => horasLibres(agenda, dia, pro, dur), [agenda, dia, pro, dur]);

  function cambiar(fn: () => void) {
    fn();
    setEleccion(null);
    setListo(null);
  }

  function reservar(e: FormEvent) {
    e.preventDefault();
    if (!eleccion) return;
    const [s, p] = eleccion;
    const nueva: Evento = {
      p,
      ini: hora(s),
      fin: hora(s + dur),
      quien: "Tú (ejemplo)",
      que: `${TRATAMIENTOS[tr].nombre} · por confirmar`,
      e: "pend",
      nuevo: true,
    };
    setReservas((r) => ({ ...r, [dia]: nueva }));
    setEleccion(null);
    setListo(
      `Listo: tu pedido quedó en el ${PROFESIONALES[p].sillon} (${PROFESIONALES[p].nombre}) a las ${hora(s)}, por confirmar. Recepción ya lo ve.`,
    );
  }

  const mensaje =
    listo ??
    (eleccion
      ? `${TRATAMIENTOS[tr].nombre} · ${DIAS[dia].texto} · ${hora(eleccion[0])} con ${PROFESIONALES[eleccion[1]].nombre}.`
      : "Elige una hora para continuar.");

  return (
    <section className="lv-book" id="reserva" aria-labelledby="lv-bk-h">
      <div className="lv-wrap">
        <div className="lv-sec-head">
          <h2 className="lv-h-sec" id="lv-bk-h">
            Así reserva <em>tu paciente.</em>
          </h2>
          <p className="lv-lead">
            Desde el portal de la clínica pide tratamiento, profesional y hora. El pedido cae al
            instante en el sillón que corresponde, marcado por confirmar: nadie lo agenda sin que tu
            equipo lo revise. Pruébalo, es un ejemplo.
          </p>
        </div>
        <div className="lv-bk-grid">
          <form className="lv-bk-w" onSubmit={reservar} aria-label="Pedido de hora de ejemplo">
            <div className="lv-bk-head">
              <span className="lv-bk-cl">
                <EsmaliaLogo variant="icon" size={24} />
                Clínica demo · Providencia
              </span>
              <span className="lv-bk-tag">Ejemplo</span>
            </div>
            <fieldset>
              <legend>Tratamiento</legend>
              <div className="lv-bk-opts">
                {TRATAMIENTOS.map((t, i) => (
                  <label key={t.nombre}>
                    <input
                      type="radio"
                      name="lv-tr"
                      checked={tr === i}
                      onChange={() => cambiar(() => setTr(i))}
                    />
                    <span>
                      {t.nombre}
                      <small>{t.min} min</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Profesional</legend>
              <div className="lv-bk-opts">
                {[{ nombre: "Cualquiera" }, ...PROFESIONALES].map((p, i) => (
                  <label key={p.nombre}>
                    <input
                      type="radio"
                      name="lv-pro"
                      checked={pro === i - 1}
                      onChange={() => cambiar(() => setPro(i - 1))}
                    />
                    <span>{p.nombre}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Día</legend>
              <div className="lv-bk-opts lv-bk-days">
                {DIAS.map((d, i) => (
                  <label key={d.n}>
                    <input
                      type="radio"
                      name="lv-dia"
                      checked={dia === i}
                      onChange={() => cambiar(() => setDia(i))}
                      aria-label={d.largo}
                    />
                    <span>
                      <b>{d.n}</b>
                      {d.corto}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Horas libres · {libres.length}</legend>
              <div className="lv-bk-slots">
                {libres.length ? (
                  libres.map(([s, p]) => {
                    const elegida = eleccion?.[0] === s && eleccion?.[1] === p;
                    return (
                      <button
                        key={`${s}-${p}`}
                        type="button"
                        aria-pressed={elegida}
                        aria-label={`${hora(s)} con ${PROFESIONALES[p].nombre}`}
                        onClick={() => {
                          setEleccion([s, p]);
                          setListo(null);
                        }}
                      >
                        {hora(s)}
                        {pro < 0 && <small>{PROFESIONALES[p].corto}</small>}
                      </button>
                    );
                  })
                ) : (
                  <p className="none">No quedan horas libres ese día con esa opción.</p>
                )}
              </div>
            </fieldset>
            <div className="lv-bk-foot">
              <p className={listo ? "ok" : undefined} aria-live="polite">
                {mensaje}
              </p>
              <button className="lv-btn lv-btn-ocre" type="submit" disabled={!eleccion}>
                Pedir hora
              </button>
            </div>
          </form>

          <div
            className="lv-bk-ag lv-on-night"
            role="region"
            aria-label="Agenda de la clínica, vista de recepción, datos de ejemplo"
          >
            <div className="lv-bk-ag-h">
              <div>
                <p className="lbl">Lo que ve recepción</p>
                <h3>{DIAS[dia].largo} · tres sillones</h3>
              </div>
              <span className="lv-bk-live">
                <i aria-hidden="true" />
                En vivo
              </span>
            </div>
            <div className="lv-tl-wrap" ref={linea}>
              <div className="lv-tl lv-bk-tl">
                <div />
                <div
                  className="lv-tl-hours"
                  style={{ gridTemplateColumns: `repeat(${HORAS.length}, 1fr)` }}
                  aria-hidden="true"
                >
                  {HORAS.map((h) => (
                    <span key={h}>{String(h).padStart(2, "0")}</span>
                  ))}
                </div>
                {PROFESIONALES.map((p, k) => (
                  <FilaRecepcion key={p.sillon} p={k} agenda={agenda} />
                ))}
              </div>
            </div>
            <p className="lv-bk-note">
              Los pedidos del portal entran <b>por confirmar</b> y recepción los confirma. El aviso
              de 48 h se arma solo y lo envía recepción con un toque.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FilaRecepcion({ p, agenda }: { p: number; agenda: readonly Evento[] }) {
  const pct = (m: number) => `${(m / SPAN) * 100}%`;
  return (
    <>
      <div className="lv-tl-who">
        {PROFESIONALES[p].sillon}
        <small>{PROFESIONALES[p].nombre}</small>
      </div>
      <div
        className="lv-bk-row"
        style={{
          background:
            "repeating-linear-gradient(90deg, var(--night-line) 0 1px, transparent 1px 10%)",
        }}
      >
        <div className="lv-lunch" style={{ left: "40%", width: "10%" }} />
        {agenda
          .filter((e) => e.p === p)
          .map((e) => {
            const estilo: CSSProperties = {
              left: pct(minutos(e.ini) - H0),
              width: `calc(${pct(minutos(e.fin) - minutos(e.ini))} - 3px)`,
            };
            return (
              <div
                key={`${e.ini}-${e.quien}`}
                className={`lv-ap ${e.e}${e.nuevo ? " new" : ""}`}
                style={estilo}
              >
                <span>{e.e === "gap" ? "Hueco" : e.quien}</span>
                <small>
                  <span className="lv-mono">{e.ini}</span>
                  {e.e === "gap" ? "" : ` · ${e.que}`}
                </small>
              </div>
            );
          })}
      </div>
    </>
  );
}
