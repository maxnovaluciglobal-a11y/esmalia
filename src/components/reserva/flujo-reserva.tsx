import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarCheck, Loader2, Mail, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fechaLarga, hora as horaDe } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import type { HoraDisponible } from "@/lib/reserva/disponibilidad-reserva";
import { horaCorta, horaLocalTexto } from "@/lib/reserva/hora-local";
import {
  abrirReserva,
  confirmarReserva,
  horasDeReserva,
  pedirCodigoDeReserva,
  type ReservaAbierta,
  type ReservaConfirmada,
} from "@/lib/reserva/reserva-publica.functions";
import {
  claveDeMotivo,
  duracionLegible,
  type MotivoReserva,
  type SolicitudReserva,
} from "@/lib/reserva/reserva";
import { cn } from "@/lib/utils";

import {
  ChipOpcion,
  EncabezadoReserva,
  IndicadorPasos,
  ResumenEnTintaReserva,
  SelectorDeHora,
} from "./piezas";

/**
 * Reserva en línea (RES-01 a RES-04): procedimiento → profesional (opcional)
 * → día y hora → datos → código → listo. Una columna, pensada para el
 * celular. La cita queda "por confirmar": la acepta el profesional.
 */

type Activa = Extract<ReservaAbierta, { estado: "activa" }>;
type Paso = "motivo" | "profesional" | "hora" | "datos" | "codigo" | "listo";

const NOMBRES_PASO: Record<Exclude<Paso, "listo">, string> = {
  motivo: "Qué necesitas",
  profesional: "Profesional",
  hora: "Día y hora",
  datos: "Tus datos",
  codigo: "Código",
};

export function FlujoReserva({
  slug,
  profesional,
  recall,
}: {
  slug: string;
  profesional?: string;
  recall?: string;
}) {
  const abrir = useServerFn(abrirReserva);
  const q = useQuery({
    queryKey: ["reserva-publica", slug, profesional ?? null, recall ?? null],
    queryFn: () => abrir({ data: { slug, profesional, recall } }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (q.isPending) {
    return (
      <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-brand" aria-hidden /> Abriendo la agenda…
      </p>
    );
  }
  if (q.isError) {
    return <Aviso titulo="No pudimos abrir la reserva">{mensajeDeError(q.error)}</Aviso>;
  }
  const r = q.data;
  if (r.estado === "no_existe") {
    return (
      <Aviso titulo="Este link no existe">
        Revisa la dirección o pídele a la clínica su link de reserva.
      </Aviso>
    );
  }
  if (r.estado === "apagada") {
    return (
      <Aviso titulo="Reservas en línea en pausa">
        {r.clinica ?? "La clínica"} no está recibiendo reservas en línea en este momento. Llama o
        escribe a la clínica para pedir tu hora.
      </Aviso>
    );
  }
  if (r.motivos.length === 0 || r.profesionales.length === 0 || r.sucursales.length === 0) {
    return (
      <Aviso titulo="Todavía no hay horas para reservar">
        {r.clinica} está preparando su agenda en línea. Llama o escribe a la clínica para pedir tu
        hora.
      </Aviso>
    );
  }
  return <Flujo r={r} />;
}

function Flujo({ r }: { r: Activa }) {
  const fijo = r.profesionalFijo ? r.profesionales.find((p) => p.id === r.profesionalFijo) : null;
  const pasos: Exclude<Paso, "listo">[] = fijo
    ? ["motivo", "hora", "datos", "codigo"]
    : ["motivo", "profesional", "hora", "datos", "codigo"];

  const [paso, setPaso] = useState<Paso>("motivo");
  const [sucursalId, setSucursalId] = useState<string>(
    (fijo?.sucursalId && r.sucursales.some((s) => s.id === fijo.sucursalId)
      ? fijo.sucursalId
      : r.sucursales[0]?.id) ?? "",
  );
  const [motivo, setMotivo] = useState<MotivoReserva | null>(
    r.motivos.length === 1 ? r.motivos[0] : null,
  );
  const [profesionalId, setProfesionalId] = useState<string | null>(fijo?.id ?? null);
  const [fecha, setFecha] = useState<string | null>(null);
  const [hora, setHora] = useState<HoraDisponible | null>(null);
  const [datos, setDatos] = useState({
    nombre: r.nombrePrecargado ?? "",
    email: "",
    telefono: "",
    rut: "",
    nota: "",
    sitioWeb: "",
  });
  const [verificacion, setVerificacion] = useState<{ id: string; enviadoA: string } | null>(null);
  const [listo, setListo] = useState<Extract<ReservaConfirmada, { ok: true }> | null>(null);

  const sucursal = r.sucursales.find((s) => s.id === sucursalId) ?? null;
  const profesionalesDeSucursal = r.profesionales;
  const nombreProfesional = (id: string | null) =>
    r.profesionales.find((p) => p.id === id)?.nombre ?? null;

  const actual = paso === "listo" ? pasos.length : pasos.indexOf(paso) + 1;
  const irA = (p: Paso) => {
    setPaso(p);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const anterior = () => {
    if (paso === "listo") return;
    const i = pasos.indexOf(paso);
    if (i > 0) irA(pasos[i - 1]);
  };

  const solicitud = (): SolicitudReserva => {
    if (!motivo || !hora || !fecha || !sucursalId) throw new Error("Falta elegir el horario.");
    return {
      slug: r.slug,
      sucursalId,
      profesionalId: hora.profesionalId,
      motivo: { tipo: motivo.tipo, id: motivo.id },
      inicio: horaLocalTexto(fecha, hora.inicio),
      ...datos,
    };
  };

  const filasResumen = [
    ...(motivo ? [{ etiqueta: "Motivo", valor: motivo.nombre }] : []),
    ...(r.sucursales.length > 1 && sucursal
      ? [{ etiqueta: "Sucursal", valor: sucursal.nombre }]
      : []),
    ...(hora
      ? [{ etiqueta: "Profesional", valor: nombreProfesional(hora.profesionalId) ?? "" }]
      : profesionalId
        ? [{ etiqueta: "Profesional", valor: nombreProfesional(profesionalId) ?? "" }]
        : []),
    ...(hora && fecha
      ? [
          {
            etiqueta: "Cuándo",
            valor: `${fechaLarga(fecha)}, ${horaCorta(hora.inicio)}`,
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto w-full max-w-xl space-y-7">
      <EncabezadoReserva
        contexto={
          <>
            <b className="font-semibold text-foreground/80">{r.clinica}</b>
            {fijo ? <span> · {fijo.nombre}</span> : null}
          </>
        }
        antes={paso === "listo" ? "Tu hora quedó" : "Reserva tu"}
        enfasis={paso === "listo" ? "reservada" : "hora"}
      />

      {paso !== "listo" ? (
        <IndicadorPasos actual={actual} total={pasos.length} nombre={NOMBRES_PASO[paso]} />
      ) : null}

      {r.nota && paso === "motivo" ? (
        <p className="rounded-[12px] border border-hairline bg-card p-4 text-base">{r.nota}</p>
      ) : null}

      {paso !== "motivo" && paso !== "listo" && filasResumen.length > 0 ? (
        <ResumenEnTintaReserva filas={filasResumen} />
      ) : null}

      {paso === "motivo" && (
        <section className="space-y-5">
          {r.sucursales.length > 1 && !fijo ? (
            <div>
              <h2 className="mb-2 text-base font-semibold">Sucursal</h2>
              <div className="flex flex-wrap gap-2">
                {r.sucursales.map((s) => (
                  <ChipOpcion
                    key={s.id}
                    activo={s.id === sucursalId}
                    onClick={() => {
                      setSucursalId(s.id);
                      setHora(null);
                      setFecha(null);
                    }}
                    detalle={s.ciudad ?? undefined}
                  >
                    {s.nombre}
                  </ChipOpcion>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <h2 className="mb-2 text-base font-semibold">¿Qué necesitas?</h2>
            <ul className="divide-y divide-hairline overflow-hidden rounded-[14px] border border-border bg-card">
              {r.motivos.map((m) => {
                const activo = motivo ? claveDeMotivo(motivo) === claveDeMotivo(m) : false;
                return (
                  <li key={claveDeMotivo(m)}>
                    <button
                      type="button"
                      aria-pressed={activo}
                      onClick={() => {
                        setMotivo(m);
                        setHora(null);
                        setFecha(null);
                      }}
                      className={cn(
                        "flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        activo ? "bg-foreground text-background" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="text-base font-medium">{m.nombre}</span>
                      <span
                        className={cn(
                          "shrink-0 text-sm",
                          activo ? "text-background/75" : "text-muted-foreground",
                        )}
                      >
                        {duracionLegible(m.duracion)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <Siguiente
            disabled={!motivo || !sucursalId}
            onClick={() => irA(fijo ? "hora" : "profesional")}
          />
        </section>
      )}

      {paso === "profesional" && (
        <section className="space-y-5">
          <h2 className="text-base font-semibold">¿Con quién quieres atenderte?</h2>
          <div className="flex flex-wrap gap-2">
            <ChipOpcion
              activo={profesionalId === null}
              onClick={() => {
                setProfesionalId(null);
                setHora(null);
              }}
            >
              Cualquiera disponible
            </ChipOpcion>
            {profesionalesDeSucursal.map((p) => (
              <ChipOpcion
                key={p.id}
                activo={profesionalId === p.id}
                onClick={() => {
                  setProfesionalId(p.id);
                  setHora(null);
                }}
              >
                {p.nombre}
              </ChipOpcion>
            ))}
          </div>
          <Navegacion onAtras={anterior} onSiguiente={() => irA("hora")} />
        </section>
      )}

      {paso === "hora" && motivo && sucursal && (
        <PasoHora
          slug={r.slug}
          sucursalId={sucursal.id}
          motivo={motivo}
          profesionalId={profesionalId}
          fecha={fecha}
          setFecha={setFecha}
          hora={hora}
          setHora={setHora}
          onAtras={anterior}
          onSiguiente={() => irA("datos")}
        />
      )}

      {paso === "datos" && (
        <PasoDatos
          pideRut={r.pideRut}
          datos={datos}
          setDatos={setDatos}
          solicitud={solicitud}
          onAtras={anterior}
          onCodigo={(v) => {
            setVerificacion(v);
            irA("codigo");
          }}
        />
      )}

      {paso === "codigo" && verificacion && (
        <PasoCodigo
          verificacion={verificacion}
          solicitud={solicitud}
          onAtras={() => irA("datos")}
          onReenviado={setVerificacion}
          onOcupado={() => {
            setHora(null);
            irA("hora");
          }}
          onListo={(x) => {
            setListo(x);
            irA("listo");
          }}
        />
      )}

      {paso === "listo" && listo && (
        <section className="space-y-5">
          <ResumenEnTintaReserva
            titulo={
              <>
                {fechaLarga(listo.inicio, listo.zona)},{" "}
                <span className="text-brand-on-night">{horaDe(listo.inicio, listo.zona)}</span>
              </>
            }
            filas={filasResumen.filter((f) => f.etiqueta !== "Cuándo")}
          />
          <div className="flex items-start gap-3 rounded-[12px] border border-hairline bg-card p-4">
            <CalendarCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
            <p className="text-base">
              Tu hora queda <b className="font-semibold">por confirmar</b>: {listo.clinica} la
              revisa y te avisa. Desde tu link puedes confirmar que vas, cambiar la hora o
              cancelarla.
            </p>
          </div>
          <Button asChild size="lg" className="h-12 w-full text-base">
            <a href={listo.enlace}>Ver y gestionar mi cita</a>
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Guarda este link: es personal y no lo compartas.
          </p>
        </section>
      )}
    </div>
  );
}

function PasoHora({
  slug,
  sucursalId,
  motivo,
  profesionalId,
  fecha,
  setFecha,
  hora,
  setHora,
  onAtras,
  onSiguiente,
}: {
  slug: string;
  sucursalId: string;
  motivo: MotivoReserva;
  profesionalId: string | null;
  fecha: string | null;
  setFecha: (f: string | null) => void;
  hora: HoraDisponible | null;
  setHora: (h: HoraDisponible | null) => void;
  onAtras: () => void;
  onSiguiente: () => void;
}) {
  const horasFn = useServerFn(horasDeReserva);
  const [desde, setDesde] = useState<string | undefined>(undefined);
  const q = useQuery({
    queryKey: [
      "reserva-horas",
      slug,
      sucursalId,
      claveDeMotivo(motivo),
      profesionalId,
      desde ?? null,
    ],
    queryFn: () =>
      horasFn({
        data: {
          slug,
          sucursalId,
          motivo: { tipo: motivo.tipo, id: motivo.id },
          profesionalId,
          desde,
        },
      }),
    staleTime: 30_000,
    retry: false,
  });

  // Primer día con horas, apenas llegan.
  const dias = useMemo(() => q.data?.dias ?? [], [q.data]);
  useEffect(() => {
    if (!fecha || !dias.some((d) => d.fecha === fecha && d.horas.length > 0)) {
      const primero = dias.find((d) => d.horas.length > 0);
      if (primero && primero.fecha !== fecha) {
        setFecha(primero.fecha);
        setHora(null);
      }
    }
  }, [dias, fecha, setFecha, setHora]);

  return (
    <section className="space-y-5">
      {q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {mensajeDeError(q.error)}
        </p>
      ) : (
        <SelectorDeHora
          dias={dias}
          fecha={fecha}
          onFecha={(f) => {
            setFecha(f);
            setHora(null);
          }}
          hora={hora}
          onHora={setHora}
          cargando={q.isPending}
          hayMas={q.data?.hayMas}
          onMasDias={() => {
            if (q.data?.siguienteDesde) {
              setDesde(q.data.siguienteDesde);
              setFecha(null);
              setHora(null);
            }
          }}
        />
      )}
      {desde ? (
        <button
          type="button"
          onClick={() => {
            setDesde(undefined);
            setFecha(null);
            setHora(null);
          }}
          className="text-sm font-semibold text-muted-foreground underline underline-offset-4"
        >
          Volver a los primeros días
        </button>
      ) : null}
      <Navegacion onAtras={onAtras} onSiguiente={onSiguiente} disabled={!hora} />
    </section>
  );
}

type Datos = {
  nombre: string;
  email: string;
  telefono: string;
  rut: string;
  nota: string;
  sitioWeb: string;
};

function PasoDatos({
  pideRut,
  datos,
  setDatos,
  solicitud,
  onAtras,
  onCodigo,
}: {
  pideRut: boolean;
  datos: Datos;
  setDatos: (d: Datos) => void;
  solicitud: () => SolicitudReserva;
  onAtras: () => void;
  onCodigo: (v: { id: string; enviadoA: string }) => void;
}) {
  const pedir = useServerFn(pedirCodigoDeReserva);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Datos) => (e: { target: { value: string } }) =>
    setDatos({ ...datos, [k]: e.target.value });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await pedir({ data: solicitud() });
      if (r.ok) onCodigo({ id: r.verificacionId, enviadoA: r.enviadoA });
      else setError(r.motivo);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <Campo id="reserva-nombre" etiqueta="Nombre y apellido">
        <Input
          id="reserva-nombre"
          value={datos.nombre}
          onChange={set("nombre")}
          autoComplete="name"
          maxLength={200}
          required
          className="h-12 text-base"
        />
      </Campo>
      <Campo
        id="reserva-email"
        etiqueta="Correo"
        ayuda="Te mandamos un código para confirmar que eres tú."
      >
        <Input
          id="reserva-email"
          type="email"
          inputMode="email"
          value={datos.email}
          onChange={set("email")}
          autoComplete="email"
          maxLength={254}
          required
          className="h-12 text-base"
        />
      </Campo>
      <Campo id="reserva-telefono" etiqueta="Teléfono (WhatsApp)">
        <Input
          id="reserva-telefono"
          type="tel"
          inputMode="tel"
          value={datos.telefono}
          onChange={set("telefono")}
          autoComplete="tel"
          maxLength={40}
          required
          className="h-12 text-base"
        />
      </Campo>
      {pideRut ? (
        <Campo
          id="reserva-rut"
          etiqueta="RUT (opcional)"
          ayuda="Si ya eres paciente, nos ayuda a encontrar tu ficha."
        >
          <Input
            id="reserva-rut"
            value={datos.rut}
            onChange={set("rut")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            className="h-12 text-base"
          />
        </Campo>
      ) : null}
      <Campo id="reserva-nota" etiqueta="¿Algo que la clínica deba saber? (opcional)">
        <textarea
          id="reserva-nota"
          value={datos.nota}
          onChange={set("nota")}
          maxLength={500}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Campo>
      {/* Trampa para bots: oculto para las personas y los lectores de pantalla. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="reserva-sitio">Sitio web</label>
        <input
          id="reserva-sitio"
          tabIndex={-1}
          autoComplete="off"
          value={datos.sitioWeb}
          onChange={set("sitioWeb")}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Usamos tus datos solo para tu atención en esta clínica.
      </p>
      <Navegacion
        onAtras={onAtras}
        tipo="submit"
        cargando={enviando}
        textoSiguiente="Enviarme el código"
        disabled={!datos.nombre.trim() || !datos.email.trim() || !datos.telefono.trim()}
      />
    </form>
  );
}

function PasoCodigo({
  verificacion,
  solicitud,
  onAtras,
  onReenviado,
  onOcupado,
  onListo,
}: {
  verificacion: { id: string; enviadoA: string };
  solicitud: () => SolicitudReserva;
  onAtras: () => void;
  onReenviado: (v: { id: string; enviadoA: string }) => void;
  onOcupado: () => void;
  onListo: (r: Extract<ReservaConfirmada, { ok: true }>) => void;
}) {
  const confirmar = useServerFn(confirmarReserva);
  const pedir = useServerFn(pedirCodigoDeReserva);
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await confirmar({
        data: { solicitud: solicitud(), verificacionId: verificacion.id, codigo },
      });
      if (r.ok) onListo(r);
      else {
        setError(r.restantes ? `${r.motivo} Te quedan ${r.restantes} intentos.` : r.motivo);
      }
    } catch (err) {
      const m = mensajeDeError(err);
      if (/tomar ese horario|ya no se puede reservar/.test(m)) onOcupado();
      setError(m);
    } finally {
      setEnviando(false);
    }
  }

  async function reenviar() {
    setError(null);
    setAviso(null);
    try {
      const r = await pedir({ data: solicitud() });
      if (r.ok) {
        onReenviado({ id: r.verificacionId, enviadoA: r.enviadoA });
        setAviso("Te mandamos un código nuevo.");
        setCodigo("");
      } else setError(r.motivo);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="flex items-start gap-3 rounded-[12px] border border-hairline bg-card p-4">
        <Mail className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
        <p className="text-base">
          Te mandamos un código de 6 dígitos a{" "}
          <b className="font-semibold">{verificacion.enviadoA}</b>. Vence en 10 minutos.
        </p>
      </div>
      <Campo id="reserva-codigo" etiqueta="Código">
        <Input
          id="reserva-codigo"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123 456"
          maxLength={9}
          className="cifra h-12 text-center text-xl tracking-[0.3em]"
        />
      </Campo>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {aviso ? <p className="text-sm text-muted-foreground">{aviso}</p> : null}
      <Navegacion
        onAtras={onAtras}
        tipo="submit"
        cargando={enviando}
        textoSiguiente="Reservar"
        disabled={codigo.replace(/\D/g, "").length !== 6}
      />
      <button
        type="button"
        onClick={reenviar}
        className="w-full text-center text-sm font-semibold text-muted-foreground underline underline-offset-4"
      >
        No me llegó: mandar otro código
      </button>
    </form>
  );
}

function Campo({
  id,
  etiqueta,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-base font-semibold">
        {etiqueta}
      </Label>
      {children}
      {ayuda ? <p className="text-sm text-muted-foreground">{ayuda}</p> : null}
    </div>
  );
}

function Siguiente({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="lg"
      className="h-12 w-full text-base"
      disabled={disabled}
      onClick={onClick}
    >
      Siguiente
    </Button>
  );
}

function Navegacion({
  onAtras,
  onSiguiente,
  disabled,
  tipo = "button",
  cargando,
  textoSiguiente = "Siguiente",
}: {
  onAtras: () => void;
  onSiguiente?: () => void;
  disabled?: boolean;
  tipo?: "button" | "submit";
  cargando?: boolean;
  textoSiguiente?: string;
}) {
  return (
    <div className="flex gap-3 pt-1">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 shrink-0 rounded-full px-4"
        onClick={onAtras}
        aria-label="Volver al paso anterior"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </Button>
      <Button
        type={tipo}
        size="lg"
        className="h-12 flex-1 text-base"
        disabled={disabled || cargando}
        onClick={tipo === "button" ? onSiguiente : undefined}
      >
        {cargando ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
        {textoSiguiente}
      </Button>
    </div>
  );
}

export function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-3 py-12 text-center">
      <XCircle className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <h1 className="font-display text-3xl font-medium">{titulo}</h1>
      <p className="text-base text-muted-foreground">{children}</p>
    </div>
  );
}
