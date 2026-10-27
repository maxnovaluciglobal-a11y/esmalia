import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarPlus, Check, Delete, Loader2, LogIn, Wallet } from "lucide-react";

import type { ContextoDispositivo } from "@/components/dispositivos/pantalla-dispositivo";
import { EsmaliaLogo } from "@/components/esmalia-logo";
import { formatMoney } from "@/lib/finance/finance";
import { mensajeDeError } from "@/lib/mensaje-error";
import { formatearRut, rutEsValido } from "@/lib/patients/rut";
import type { DiaDisponible } from "@/lib/reserva/disponibilidad-reserva";
import { horaCorta, horaLocalTexto } from "@/lib/reserva/hora-local";
import type { MotivoReserva } from "@/lib/reserva/reserva";
import {
  agendarEnTotem,
  horasParaAgendar,
  identificarEnTotem,
  marcarLlegadaEnTotem,
  opcionesParaAgendar,
  resumenDelTotem,
  terminarSesionDelTotem,
  type CitaDeHoyTotem,
  type OpcionesAgendar,
  type ResumenTotem,
} from "@/lib/totem/totem.functions";
import {
  ETIQUETA_VERIFICACION,
  esDiaYMesPosible,
  SEGUNDOS_INACTIVIDAD,
  SEGUNDOS_PANTALLA_FINAL,
  type TipoVerificacion,
} from "@/lib/totem/totem";
import { cn } from "@/lib/utils";

/**
 * Tótem de la sala de espera (AUT-01 check-in, AUT-02 agendar, AUT-03 saldo).
 *
 * Dispositivo público: la sesión del paciente vive solo en el estado de esta
 * página. Tras cada uso vuelve sola a la pantalla inicial (inactividad o
 * pantalla final) y avisa al servidor que cierre la sesión. Nunca muestra
 * datos de otro paciente: cada pantalla sale del resumen de la sesión actual.
 */

type Intencion = "llegada" | "agendar" | "saldo";

type Paso =
  | { p: "inicio" }
  | { p: "documento"; intencion: Intencion }
  | { p: "verificar"; intencion: Intencion; documento: string }
  | { p: "panel"; intencion: Intencion; sesion: string; resumen: ResumenTotem }
  | { p: "llegada"; nombre: string; turno: number | null; yaEstaba: boolean }
  | { p: "agendar"; sesion: string; resumen: ResumenTotem }
  | { p: "agendada"; nombre: string; inicio: string; zona: string };

const CLASE_TECLA =
  "inline-flex h-[4.5rem] items-center justify-center rounded-2xl border border-border bg-card text-3xl font-medium transition-colors active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-20";
const CLASE_PRIMARIO =
  "inline-flex min-h-16 items-center justify-center gap-2 rounded-full bg-foreground px-8 text-xl font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50";
const CLASE_SECUNDARIO =
  "inline-flex min-h-16 items-center justify-center gap-2 rounded-full border border-border bg-card px-8 text-xl font-medium transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Totem({ token, dispositivo, alInvalidar }: ContextoDispositivo) {
  const [paso, setPaso] = useState<Paso>({ p: "inicio" });
  const terminarFn = useServerFn(terminarSesionDelTotem);
  const sesionActual = paso.p === "panel" || paso.p === "agendar" ? paso.sesion : null;
  const sesionRef = useRef<string | null>(null);
  sesionRef.current = sesionActual;

  const volverAlInicio = useCallback(() => {
    const sesion = sesionRef.current;
    if (sesion) void terminarFn({ data: { token, sesion } }).catch(() => undefined);
    setPaso({ p: "inicio" });
  }, [terminarFn, token]);

  const segundos =
    paso.p === "llegada" || paso.p === "agendada" ? SEGUNDOS_PANTALLA_FINAL : SEGUNDOS_INACTIVIDAD;
  const restante = useInactividad(paso.p !== "inicio", segundos, volverAlInicio, paso);
  const esPais = (dispositivo.pais ?? "CL").toUpperCase() === "CL";

  const invalidar = (r: { invalido: boolean }) => {
    if (r.invalido) alInvalidar();
    return r.invalido;
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-8">
        <div className="min-w-0">
          <p className="truncate font-display text-2xl font-semibold leading-tight">
            {dispositivo.clinica}
          </p>
          <p className="truncate text-base text-muted-foreground">{dispositivo.sucursal}</p>
        </div>
        {paso.p !== "inicio" && (
          <button
            type="button"
            onClick={volverAlInicio}
            className={cn(CLASE_SECUNDARIO, "min-h-14 px-6 text-lg")}
          >
            Terminar
          </button>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-8 sm:py-10">
        {paso.p === "inicio" && (
          <Inicio
            clinica={dispositivo.clinica}
            onElegir={(intencion) => setPaso({ p: "documento", intencion })}
          />
        )}
        {paso.p === "documento" && (
          <PasoDocumento
            esChile={esPais}
            onAtras={volverAlInicio}
            onListo={(documento) =>
              setPaso({ p: "verificar", intencion: paso.intencion, documento })
            }
          />
        )}
        {paso.p === "verificar" && (
          <PasoVerificar
            token={token}
            documento={paso.documento}
            onAtras={() => setPaso({ p: "documento", intencion: paso.intencion })}
            onInvalido={invalidar}
            onIdentificado={(sesion, resumen) =>
              setPaso(
                paso.intencion === "agendar" && resumen.puedeAgendar
                  ? { p: "agendar", sesion, resumen }
                  : { p: "panel", intencion: paso.intencion, sesion, resumen },
              )
            }
          />
        )}
        {paso.p === "panel" && (
          <Panel
            token={token}
            sesion={paso.sesion}
            resumen={paso.resumen}
            intencion={paso.intencion}
            onInvalido={invalidar}
            onLlegada={(turno, yaEstaba) =>
              setPaso({ p: "llegada", nombre: paso.resumen.nombre, turno, yaEstaba })
            }
            onAgendar={() => setPaso({ p: "agendar", sesion: paso.sesion, resumen: paso.resumen })}
            onSesionVencida={volverAlInicio}
          />
        )}
        {paso.p === "llegada" && (
          <Final onListo={volverAlInicio}>
            <Titular antes="Listo," enfasis={paso.nombre} despues="." />
            {paso.turno != null && (
              <div className="mt-8">
                <p className="text-xl text-muted-foreground">Tu número es</p>
                <p className="cifra mt-1 text-[clamp(6rem,22vw,11rem)] leading-none text-foreground">
                  {paso.turno}
                </p>
              </div>
            )}
            <p className="mt-6 max-w-xl text-2xl leading-snug">
              {paso.yaEstaba
                ? "Ya tenías marcada tu llegada. Toma asiento: te llamaremos por la pantalla."
                : "Marcamos tu llegada. Toma asiento: te llamaremos por la pantalla."}
            </p>
          </Final>
        )}
        {paso.p === "agendar" && (
          <Agendar
            token={token}
            sesion={paso.sesion}
            resumen={paso.resumen}
            onInvalido={invalidar}
            onAtras={() =>
              setPaso({
                p: "panel",
                intencion: "agendar",
                sesion: paso.sesion,
                resumen: paso.resumen,
              })
            }
            onAgendada={(inicio, zona) =>
              setPaso({ p: "agendada", nombre: paso.resumen.nombre, inicio, zona })
            }
          />
        )}
        {paso.p === "agendada" && (
          <Final onListo={volverAlInicio}>
            <Titular antes="Pedimos tu hora," enfasis={paso.nombre} despues="." />
            <p className="cifra mt-8 text-4xl sm:text-5xl">
              {fechaLarga(paso.inicio, paso.zona)} · {horaDe(paso.inicio, paso.zona)}
            </p>
            <p className="mt-6 max-w-xl text-2xl leading-snug">
              Queda pendiente hasta que la clínica la acepte. Puedes confirmarla en recepción.
            </p>
          </Final>
        )}
      </main>

      {restante != null && restante <= 10 && paso.p !== "llegada" && paso.p !== "agendada" && (
        <div
          role="alertdialog"
          aria-labelledby="totem-sigues-ahi"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card px-4 py-6 shadow-ink-strong sm:px-8"
        >
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4">
            <p id="totem-sigues-ahi" className="text-2xl font-medium">
              ¿Sigues ahí? Volvemos al inicio en <span className="cifra">{restante}</span> s.
            </p>
            <button type="button" className={CLASE_PRIMARIO}>
              Sí, continuar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Cuenta regresiva de inactividad: cualquier toque o tecla la reinicia; al
 * llegar a cero vuelve al inicio. `clave` reinicia el conteo al cambiar de
 * pantalla.
 */
function useInactividad(
  activo: boolean,
  segundos: number,
  alVencer: () => void,
  clave: unknown,
): number | null {
  const [restante, setRestante] = useState<number | null>(null);
  const ultimo = useRef(Date.now());
  const vencer = useRef(alVencer);
  vencer.current = alVencer;

  useEffect(() => {
    if (!activo) {
      setRestante(null);
      return;
    }
    ultimo.current = Date.now();
    setRestante(segundos);
    const tocar = () => {
      ultimo.current = Date.now();
    };
    window.addEventListener("pointerdown", tocar, { passive: true });
    window.addEventListener("keydown", tocar);
    const id = setInterval(() => {
      const quedan = Math.max(0, segundos - Math.floor((Date.now() - ultimo.current) / 1000));
      setRestante(quedan);
      if (quedan === 0) vencer.current();
    }, 1000);
    return () => {
      clearInterval(id);
      window.removeEventListener("pointerdown", tocar);
      window.removeEventListener("keydown", tocar);
    };
  }, [activo, segundos, clave]);

  return restante;
}

// ─── Piezas ───────────────────────────────────────────────────────────────

function Titular({
  antes,
  enfasis,
  despues,
}: {
  antes: string;
  enfasis: string;
  despues?: string;
}) {
  return (
    <h1 className="font-display text-[clamp(2.75rem,7vw,4.75rem)] font-medium leading-[0.95] tracking-[-0.02em] text-balance">
      {antes} <em className="text-brand-600">{enfasis}</em>
      {despues ?? null}
    </h1>
  );
}

function BotonAtras({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-6 inline-flex min-h-12 items-center gap-2 self-start rounded-full px-2 text-lg font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-5" aria-hidden /> Atrás
    </button>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-6 rounded-xl border border-destructive-border bg-destructive-soft px-5 py-4 text-xl"
    >
      {children}
    </p>
  );
}

function Final({ children, onListo }: { children: ReactNode; onListo: () => void }) {
  return (
    <section className="flex flex-1 flex-col justify-center" aria-live="polite">
      {children}
      <button type="button" onClick={onListo} className={cn(CLASE_PRIMARIO, "mt-12 self-start")}>
        <Check className="size-6" aria-hidden /> Listo
      </button>
    </section>
  );
}

function Teclado({
  onTecla,
  onBorrar,
  conK,
}: {
  onTecla: (t: string) => void;
  onBorrar: () => void;
  conK: boolean;
}) {
  const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <div className="grid w-full max-w-md grid-cols-3 gap-3" role="group" aria-label="Teclado">
      {teclas.map((t) => (
        <button key={t} type="button" className={CLASE_TECLA} onClick={() => onTecla(t)}>
          {t}
        </button>
      ))}
      {conK ? (
        <button type="button" className={CLASE_TECLA} onClick={() => onTecla("K")}>
          K
        </button>
      ) : (
        <span aria-hidden />
      )}
      <button type="button" className={CLASE_TECLA} onClick={() => onTecla("0")}>
        0
      </button>
      <button type="button" className={CLASE_TECLA} onClick={onBorrar} aria-label="Borrar">
        <Delete className="size-8" aria-hidden />
      </button>
    </div>
  );
}

// ─── Inicio ───────────────────────────────────────────────────────────────

function Inicio({ clinica, onElegir }: { clinica: string; onElegir: (i: Intencion) => void }) {
  const opciones: { i: Intencion; titulo: string; detalle: string; icono: ReactNode }[] = [
    {
      i: "llegada",
      titulo: "Marcar mi llegada",
      detalle: "Avisa que ya estás aquí para tu hora de hoy",
      icono: <LogIn className="size-8" aria-hidden />,
    },
    {
      i: "agendar",
      titulo: "Agendar una hora",
      detalle: "Elige día y hora para tu próxima visita",
      icono: <CalendarPlus className="size-8" aria-hidden />,
    },
    {
      i: "saldo",
      titulo: "Ver mi saldo",
      detalle: "Lo que tienes pendiente de pago",
      icono: <Wallet className="size-8" aria-hidden />,
    },
  ];
  return (
    <section className="flex flex-1 flex-col justify-center">
      <p className="kicker text-sm">Recepción</p>
      <h1 className="mt-3 font-display text-[clamp(3rem,8vw,5.5rem)] font-medium leading-[0.92] tracking-[-0.02em] text-balance">
        Hola, te damos la bienvenida a <em className="text-brand-600">{clinica}</em>
      </h1>
      <p className="mt-5 text-2xl text-muted-foreground">Toca lo que quieres hacer.</p>
      <ul className="mt-10 grid gap-4 md:grid-cols-3">
        {opciones.map((o, n) => (
          <li key={o.i}>
            <button
              type="button"
              onClick={() => onElegir(o.i)}
              className={cn(
                "flex h-full min-h-44 w-full flex-col justify-between gap-6 rounded-3xl p-6 text-left transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                n === 0
                  ? "bg-night text-on-night"
                  : "border border-border bg-card text-foreground hover:border-foreground/40",
              )}
            >
              <span className={n === 0 ? "text-brand-on-night" : "text-brand-600"}>{o.icono}</span>
              <span>
                <span className="block font-display text-3xl font-semibold leading-tight">
                  {o.titulo}
                </span>
                <span
                  className={cn(
                    "mt-1 block text-lg",
                    n === 0 ? "text-on-night-2" : "text-muted-foreground",
                  )}
                >
                  {o.detalle}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-10 flex items-center gap-2 text-base text-muted-foreground">
        Con <EsmaliaLogo size={16} variant="icon" /> Esmalia · Tus datos no quedan guardados en esta
        pantalla.
      </p>
    </section>
  );
}

// ─── Documento ────────────────────────────────────────────────────────────

function PasoDocumento({
  esChile,
  onAtras,
  onListo,
}: {
  esChile: boolean;
  onAtras: () => void;
  onListo: (documento: string) => void;
}) {
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mostrado = esChile && valor.length > 1 ? formatearRut(valor) : valor;

  const continuar = () => {
    if (esChile ? !rutEsValido(valor) : valor.length < 5) {
      setError(
        esChile
          ? "Revisa tu RUT: los números y el dígito verificador."
          : "Revisa tu número de documento.",
      );
      return;
    }
    onListo(valor);
  };

  return (
    <section className="flex flex-col">
      <BotonAtras onClick={onAtras} />
      <Titular antes="Escribe tu" enfasis={esChile ? "RUT" : "documento"} />
      <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-start">
        <div className="flex-1 space-y-4">
          <label htmlFor="totem-documento" className="block text-xl text-muted-foreground">
            {esChile ? "Con dígito verificador, sin puntos ni guion." : "Solo números."}
          </label>
          <input
            id="totem-documento"
            value={mostrado}
            inputMode="none"
            autoComplete="off"
            onChange={(e) => {
              setError(null);
              setValor(
                e.target.value
                  .toUpperCase()
                  .replace(esChile ? /[^0-9K]/g : /[^0-9]/g, "")
                  .slice(0, 12),
              );
            }}
            className="cifra block h-20 w-full rounded-2xl border border-input bg-card px-5 text-4xl tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-invalid={Boolean(error)}
          />
          {error && <Aviso>{error}</Aviso>}
          <button
            type="button"
            onClick={continuar}
            disabled={valor.length < 2}
            className={cn(CLASE_PRIMARIO, "w-full")}
          >
            Continuar
          </button>
        </div>
        <Teclado
          conK={esChile}
          onTecla={(t) => {
            setError(null);
            setValor((v) => (v.length < 12 ? v + t : v));
          }}
          onBorrar={() => setValor((v) => v.slice(0, -1))}
        />
      </div>
    </section>
  );
}

// ─── Verificación ─────────────────────────────────────────────────────────

function PasoVerificar({
  token,
  documento,
  onAtras,
  onInvalido,
  onIdentificado,
}: {
  token: string;
  documento: string;
  onAtras: () => void;
  onInvalido: (r: { invalido: boolean }) => boolean;
  onIdentificado: (sesion: string, resumen: ResumenTotem) => void;
}) {
  const identificarFn = useServerFn(identificarEnTotem);
  const resumenFn = useServerFn(resumenDelTotem);
  const [tipo, setTipo] = useState<TipoVerificacion>("telefono");
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const et = ETIQUETA_VERIFICACION[tipo];

  const enviar = async () => {
    if (valor.length !== 4) return;
    if (tipo === "nacimiento" && !esDiaYMesPosible(valor)) {
      setError("Revisa el día y el mes: por ejemplo, 0703 es 7 de marzo.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const r = await identificarFn({ data: { token, datos: { rut: documento, tipo, valor } } });
      if (onInvalido(r) || r.invalido) return;
      if (!r.identificacion.ok) {
        setError(r.identificacion.motivo);
        setValor("");
        return;
      }
      const sesion = r.identificacion.sesion;
      const res = await resumenFn({ data: { token, sesion } });
      if (onInvalido(res) || res.invalido) return;
      if (!res.resultado.ok) {
        setError(res.resultado.motivo);
        return;
      }
      onIdentificado(sesion, res.resultado.resumen);
    } catch (e) {
      setError(mensajeDeError(e, "No pudimos revisar tus datos. Acércate a recepción."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="flex flex-col">
      <BotonAtras onClick={onAtras} />
      <Titular antes="Un dato para" enfasis="confirmar" despues=" que eres tú" />
      <div className="mt-6 flex flex-wrap gap-3" role="radiogroup" aria-label="Dato para confirmar">
        {(Object.keys(ETIQUETA_VERIFICACION) as TipoVerificacion[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tipo === t}
            onClick={() => {
              setTipo(t);
              setValor("");
              setError(null);
            }}
            className={cn(
              "inline-flex min-h-14 items-center rounded-full border px-6 text-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tipo === t
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:border-foreground/40",
            )}
          >
            {ETIQUETA_VERIFICACION[t].titulo}
          </button>
        ))}
      </div>
      <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-start">
        <div className="flex-1 space-y-4">
          <p className="text-xl text-muted-foreground">{et.ayuda}</p>
          <div className="flex gap-3" aria-label={et.titulo} role="img">
            {[0, 1, 2, 3].map((n) => (
              <span
                key={n}
                className={cn(
                  "cifra flex h-20 w-16 items-center justify-center rounded-2xl border text-4xl sm:w-20",
                  valor[n]
                    ? "border-foreground bg-card"
                    : "border-border bg-muted/40 text-muted-foreground/50",
                )}
              >
                {valor[n] ? "•" : et.marcador[n]}
              </span>
            ))}
          </div>
          {error && <Aviso>{error}</Aviso>}
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={valor.length !== 4 || enviando}
            className={cn(CLASE_PRIMARIO, "w-full")}
          >
            {enviando && <Loader2 className="size-6 animate-spin" aria-hidden />}
            Continuar
          </button>
        </div>
        <Teclado
          conK={false}
          onTecla={(t) => {
            setError(null);
            setValor((v) => (v.length < 4 ? v + t : v));
          }}
          onBorrar={() => setValor((v) => v.slice(0, -1))}
        />
      </div>
    </section>
  );
}

// ─── Panel del paciente ───────────────────────────────────────────────────

function horaDe(iso: string, zona: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: zona,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

const conMayuscula = (t: string) => t.charAt(0).toLocaleUpperCase("es") + t.slice(1);

function fechaLarga(iso: string, zona: string): string {
  return conMayuscula(
    new Intl.DateTimeFormat("es-CL", {
      timeZone: zona,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(iso)),
  );
}

const ESTADO_CITA: Record<string, string> = {
  tentativa: "Por confirmar",
  confirmada: "Confirmada",
  "en-sala": "Ya marcaste tu llegada",
  finalizada: "Atendida",
  ausente: "Marcada como ausente",
};

function Panel({
  token,
  sesion,
  resumen,
  intencion,
  onInvalido,
  onLlegada,
  onAgendar,
  onSesionVencida,
}: {
  token: string;
  sesion: string;
  resumen: ResumenTotem;
  intencion: Intencion;
  onInvalido: (r: { invalido: boolean }) => boolean;
  onLlegada: (turno: number | null, yaEstaba: boolean) => void;
  onAgendar: () => void;
  onSesionVencida: () => void;
}) {
  const llegadaFn = useServerFn(marcarLlegadaEnTotem);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const marcar = async (c: CitaDeHoyTotem) => {
    setEnCurso(c.id);
    setError(null);
    try {
      const r = await llegadaFn({ data: { token, sesion, appointmentId: c.id } });
      if (onInvalido(r) || r.invalido) return;
      if (r.llegada.ok) onLlegada(r.llegada.turno, r.llegada.yaEstaba);
      else setError(r.llegada.motivo);
    } catch (e) {
      setError(mensajeDeError(e, "No pudimos marcar tu llegada. Acércate a recepción."));
    } finally {
      setEnCurso(null);
    }
  };

  const saldo = (
    <section
      aria-labelledby="totem-saldo"
      className={cn(
        "rounded-3xl border border-border bg-card p-6",
        intencion === "saldo" && "order-first",
      )}
    >
      <h2 id="totem-saldo" className="kicker text-sm">
        Tu saldo
      </h2>
      {resumen.saldoCents != null && resumen.saldoCents > 0 ? (
        <>
          <p className="cifra mt-3 text-5xl">{formatMoney(resumen.saldoCents, resumen.moneda)}</p>
          <p className="mt-2 text-xl text-muted-foreground">
            Pendiente de pago. Paga en recepción.
          </p>
        </>
      ) : (
        <p className="mt-3 text-2xl">No tienes saldo pendiente.</p>
      )}
    </section>
  );

  return (
    <section className="flex flex-col gap-8">
      <Titular antes="Hola," enfasis={resumen.nombre} despues="." />
      {error && <Aviso>{error}</Aviso>}
      <div className="flex flex-col gap-6">
        {saldo}
        <section aria-labelledby="totem-hoy" className="space-y-4">
          <h2 id="totem-hoy" className="kicker text-sm">
            Tus horas de hoy
          </h2>
          {resumen.citas.length === 0 ? (
            <p className="text-2xl text-muted-foreground">
              No tienes horas para hoy en esta sucursal. Si crees que es un error, acércate a
              recepción.
            </p>
          ) : (
            <ul className="space-y-3">
              {resumen.citas.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-night p-6 text-on-night"
                >
                  <div>
                    <p className="cifra text-5xl leading-none">{horaDe(c.inicio, resumen.zona)}</p>
                    <p className="mt-2 text-xl text-on-night-2">
                      {c.profesional} · {ESTADO_CITA[c.estado] ?? c.estado}
                      {c.turno != null && ` · N.º ${c.turno}`}
                    </p>
                  </div>
                  {c.puedeLlegar ? (
                    <button
                      type="button"
                      onClick={() => void marcar(c)}
                      disabled={enCurso !== null}
                      className="inline-flex min-h-16 items-center gap-2 rounded-full bg-brand-on-night px-8 text-xl font-semibold text-night transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-on-night focus-visible:ring-offset-2 focus-visible:ring-offset-night disabled:opacity-50"
                    >
                      {enCurso === c.id ? (
                        <Loader2 className="size-6 animate-spin" aria-hidden />
                      ) : (
                        <LogIn className="size-6" aria-hidden />
                      )}
                      Ya llegué
                    </button>
                  ) : c.estado === "tentativa" || c.estado === "confirmada" ? (
                    <p className="max-w-56 text-lg text-on-night-2">
                      Podrás marcar tu llegada desde 2 horas antes.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="flex flex-wrap gap-3">
        {resumen.puedeAgendar ? (
          <button type="button" onClick={onAgendar} className={CLASE_SECUNDARIO}>
            <CalendarPlus className="size-6" aria-hidden /> Agendar otra hora
          </button>
        ) : (
          intencion === "agendar" && (
            <p className="text-xl text-muted-foreground">
              Para agendar una hora, acércate a recepción.
            </p>
          )
        )}
        <button type="button" onClick={onSesionVencida} className={CLASE_PRIMARIO}>
          Listo
        </button>
      </div>
    </section>
  );
}

// ─── Agendar ──────────────────────────────────────────────────────────────

function Chip({
  activo,
  onClick,
  children,
  detalle,
}: {
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
  detalle?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "inline-flex min-h-16 items-center gap-3 rounded-full border px-6 text-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        activo
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card hover:border-foreground/40",
      )}
    >
      <span>{children}</span>
      {detalle && (
        <span className={cn("text-base", activo ? "text-background/75" : "text-muted-foreground")}>
          {detalle}
        </span>
      )}
    </button>
  );
}

function diaCorto(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  return conMayuscula(
    new Intl.DateTimeFormat("es-CL", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(d),
  );
}

function Agendar({
  token,
  sesion,
  resumen,
  onInvalido,
  onAtras,
  onAgendada,
}: {
  token: string;
  sesion: string;
  resumen: ResumenTotem;
  onInvalido: (r: { invalido: boolean }) => boolean;
  onAtras: () => void;
  onAgendada: (inicio: string, zona: string) => void;
}) {
  const opcionesFn = useServerFn(opcionesParaAgendar);
  const horasFn = useServerFn(horasParaAgendar);
  const agendarFn = useServerFn(agendarEnTotem);
  const [opciones, setOpciones] = useState<OpcionesAgendar | null>(null);
  const [motivo, setMotivo] = useState<MotivoReserva | null>(null);
  const [profesional, setProfesional] = useState<string | null | undefined>(undefined);
  const [dias, setDias] = useState<DiaDisponible[] | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [hora, setHora] = useState<{ inicio: number; profesionalId: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void opcionesFn({ data: { token, sesion } })
      .then((r) => {
        if (!vivo || onInvalido(r) || r.invalido) return;
        if (r.resultado.ok) setOpciones(r.resultado.opciones);
        else setError(r.resultado.motivo);
      })
      .catch((e) => setError(mensajeDeError(e, "No pudimos abrir la agenda.")));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez al abrir
  }, []);

  const buscarHoras = async (m: MotivoReserva, prof: string | null) => {
    setCargando(true);
    setError(null);
    setDias(null);
    setDia(null);
    setHora(null);
    try {
      const r = await horasFn({
        data: { token, sesion, motivo: { tipo: m.tipo, id: m.id }, profesionalId: prof },
      });
      if (onInvalido(r) || r.invalido) return;
      if (!r.resultado.ok) {
        setError(r.resultado.motivo);
        return;
      }
      const conHoras = r.resultado.horas.dias.filter((d) => d.horas.length > 0);
      setDias(conHoras);
      setDia(conHoras[0]?.fecha ?? null);
    } catch (e) {
      setError(mensajeDeError(e, "No pudimos buscar horas."));
    } finally {
      setCargando(false);
    }
  };

  const confirmar = async () => {
    if (!motivo || !dia || !hora) return;
    setCargando(true);
    setError(null);
    try {
      const r = await agendarFn({
        data: {
          token,
          sesion,
          motivo: { tipo: motivo.tipo, id: motivo.id },
          profesionalId: hora.profesionalId,
          inicio: horaLocalTexto(dia, hora.inicio),
        },
      });
      if (onInvalido(r) || r.invalido) return;
      if (r.resultado.ok) onAgendada(r.resultado.inicio, r.resultado.zona);
      else setError(r.resultado.motivo);
    } catch (e) {
      setError(mensajeDeError(e, "No pudimos agendar tu hora. Acércate a recepción."));
    } finally {
      setCargando(false);
    }
  };

  const diaElegido = dias?.find((d) => d.fecha === dia) ?? null;
  const nombreProf = (id: string) => opciones?.profesionales.find((p) => p.id === id)?.nombre ?? "";

  return (
    <section className="flex flex-col gap-8">
      <BotonAtras onClick={onAtras} />
      <Titular antes="Agenda tu" enfasis="próxima hora" />
      {error && <Aviso>{error}</Aviso>}
      {!opciones && !error && (
        <p className="flex items-center gap-3 text-xl text-muted-foreground" role="status">
          <Loader2 className="size-6 animate-spin" aria-hidden /> Abriendo la agenda…
        </p>
      )}
      {opciones && (
        <>
          <div className="space-y-3">
            <h2 className="kicker text-sm">Motivo</h2>
            <div className="flex flex-wrap gap-3">
              {opciones.motivos.map((m) => (
                <Chip
                  key={`${m.tipo}:${m.id}`}
                  activo={motivo?.id === m.id && motivo.tipo === m.tipo}
                  onClick={() => {
                    setMotivo(m);
                    if (profesional !== undefined) void buscarHoras(m, profesional);
                  }}
                >
                  {m.nombre}
                </Chip>
              ))}
            </div>
          </div>
          {motivo && (
            <div className="space-y-3">
              <h2 className="kicker text-sm">Profesional</h2>
              <div className="flex flex-wrap gap-3">
                <Chip
                  activo={profesional === null}
                  onClick={() => {
                    setProfesional(null);
                    void buscarHoras(motivo, null);
                  }}
                >
                  Cualquiera
                </Chip>
                {opciones.profesionales.map((p) => (
                  <Chip
                    key={p.id}
                    activo={profesional === p.id}
                    onClick={() => {
                      setProfesional(p.id);
                      void buscarHoras(motivo, p.id);
                    }}
                  >
                    {p.nombre}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {cargando && !dias && (
            <p className="flex items-center gap-3 text-xl text-muted-foreground" role="status">
              <Loader2 className="size-6 animate-spin" aria-hidden /> Buscando horas libres…
            </p>
          )}
          {dias && dias.length === 0 && (
            <p className="text-xl text-muted-foreground">
              No hay horas libres en los próximos días. Acércate a recepción y te ayudamos.
            </p>
          )}
          {dias && dias.length > 0 && (
            <div className="space-y-3">
              <h2 className="kicker text-sm">Día</h2>
              <div className="flex flex-wrap gap-3">
                {dias.map((d) => (
                  <Chip
                    key={d.fecha}
                    activo={dia === d.fecha}
                    onClick={() => {
                      setDia(d.fecha);
                      setHora(null);
                    }}
                  >
                    <span>{diaCorto(d.fecha)}</span>
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {diaElegido && (
            <div className="space-y-3">
              <h2 className="kicker text-sm">Hora</h2>
              <div className="flex flex-wrap gap-3">
                {diaElegido.horas.map((h) => (
                  <Chip
                    key={`${h.inicio}-${h.profesionalId}`}
                    activo={hora?.inicio === h.inicio}
                    onClick={() => setHora({ inicio: h.inicio, profesionalId: h.profesionalId })}
                    detalle={profesional === null ? nombreProf(h.profesionalId) : undefined}
                  >
                    <span className="cifra">{horaCorta(h.inicio)}</span>
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {hora && dia && motivo && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-night p-6 text-on-night">
              <p className="text-xl">
                <span>{diaCorto(dia)}</span> ·{" "}
                <span className="cifra">{horaCorta(hora.inicio)}</span> · {motivo.nombre} ·{" "}
                {nombreProf(hora.profesionalId)}
              </p>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={cargando}
                className="inline-flex min-h-16 items-center gap-2 rounded-full bg-brand-on-night px-8 text-xl font-semibold text-night transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-on-night disabled:opacity-50"
              >
                {cargando && <Loader2 className="size-6 animate-spin" aria-hidden />}
                Pedir esta hora
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
