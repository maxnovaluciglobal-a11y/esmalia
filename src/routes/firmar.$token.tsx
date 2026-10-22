import { useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock,
  Download,
  FileSignature,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { EsmaliaLogo } from "@/components/esmalia-logo";
import { HojaDocumento } from "@/components/documentos/hoja-documento";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { huellaCorta } from "@/lib/documentos/huella";
import { firmaEnTintaOscura } from "@/lib/firma-distancia/imagen";
import {
  abrirFirmaADistancia,
  enviarCodigoParaFirmar,
  firmarDocumentoADistancia,
  verificarRutParaFirmar,
  type EstadoPublico,
  type FirmaAbierta,
  type ResultadoDeFirma,
  type VerificacionDeRut,
} from "@/lib/firma-distancia/firma.functions";
import { minutosHasta } from "@/lib/firma-distancia/estado";
import { fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * Firma a distancia (Ola 5 · DOC-05): `<dominio>/firmar/<token>`.
 *
 * Página pública, sin login y sin índice. El token viaja solo en el path
 * (Sentry lo tapa); el servidor guarda su sha256. Pasos:
 *
 *   1. RUT del paciente (o de su tutor) → el servidor abre una sesión de 30
 *      min y recién ahí entrega el documento.
 *   2. El paciente lee el documento completo, pide el código (le llega por
 *      correo), escribe su nombre, marca "Leí y acepto" y, si quiere, dibuja
 *      su firma.
 *   3. Firma: la evidencia queda en la ficha y el paciente descarga la copia
 *      firmada en PDF en ese momento.
 *
 * Mobile-first: una columna, botones grandes, teclado numérico para el
 * código. La sesión vive en memoria: si se recarga, se pide el RUT de nuevo.
 */
export const Route = createFileRoute("/firmar/$token")({
  head: () => ({
    meta: [
      { title: "Firma de documento · Esmalia" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: FirmarPage,
});

type Paso =
  | { tipo: "cargando" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "fin"; estado: EstadoPublico; info: FirmaAbierta | null }
  | { tipo: "rut"; info: FirmaAbierta }
  | { tipo: "documento"; info: FirmaAbierta; doc: Extract<VerificacionDeRut, { ok: true }> }
  | {
      tipo: "firmado";
      info: FirmaAbierta;
      doc: Extract<VerificacionDeRut, { ok: true }>;
      r: Extract<ResultadoDeFirma, { ok: true }>;
    };

function FirmarPage() {
  const { token } = Route.useParams();
  const abrir = useServerFn(abrirFirmaADistancia);
  const [paso, setPaso] = useState<Paso>({ tipo: "cargando" });

  useEffect(() => {
    let vivo = true;
    abrir({ data: { token } })
      .then((info) => {
        if (!vivo) return;
        setPaso(
          info.estado === "enviada" || info.estado === "abierta"
            ? { tipo: "rut", info }
            : { tipo: "fin", estado: info.estado, info },
        );
      })
      .catch((e) => vivo && setPaso({ tipo: "error", mensaje: mensajeDeError(e) }));
    return () => {
      vivo = false;
    };
  }, [token, abrir]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-hairline bg-card/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold leading-tight">
              {"info" in paso && paso.info?.clinica ? paso.info.clinica : "Firma de documento"}
            </p>
            <p className="text-xs text-muted-foreground">Firma electrónica simple · Ley 19.799</p>
          </div>
          <EsmaliaLogo size={22} variant="icon" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        {paso.tipo === "cargando" && (
          <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-brand" aria-hidden /> Abriendo…
          </p>
        )}
        {paso.tipo === "error" && (
          <Aviso
            icono={<XCircle className="size-8 text-destructive" aria-hidden />}
            titulo="No pudimos abrir el documento"
          >
            {paso.mensaje}
          </Aviso>
        )}
        {paso.tipo === "fin" && <Fin estado={paso.estado} info={paso.info} />}
        {paso.tipo === "rut" && (
          <PasoRut
            token={token}
            info={paso.info}
            onVerificado={(doc) => setPaso({ tipo: "documento", info: paso.info, doc })}
            onCerrado={(estado) => setPaso({ tipo: "fin", estado, info: paso.info })}
          />
        )}
        {paso.tipo === "documento" && (
          <PasoDocumento
            token={token}
            info={paso.info}
            doc={paso.doc}
            onFirmado={(r) => setPaso({ tipo: "firmado", info: paso.info, doc: paso.doc, r })}
            onSesionVencida={() => setPaso({ tipo: "rut", info: paso.info })}
          />
        )}
        {paso.tipo === "firmado" && <Firmado info={paso.info} doc={paso.doc} r={paso.r} />}
      </main>
    </div>
  );
}

function Aviso({
  icono,
  titulo,
  children,
}: {
  icono: ReactNode;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
      {icono}
      <h1 className="font-display text-2xl font-semibold">{titulo}</h1>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function Fin({ estado, info }: { estado: EstadoPublico; info: FirmaAbierta | null }) {
  const clinica = info?.clinica ?? "tu clínica";
  switch (estado) {
    case "firmada":
      return (
        <Aviso
          icono={<CheckCircle2 className="size-8 text-success" aria-hidden />}
          titulo="Este documento ya está firmado"
        >
          <p>
            {info?.firmadaEl ? `Se firmó el ${fechaHora(info.firmadaEl, info.zona)}. ` : ""}
            Si necesitas una copia, pídesela a {clinica}.
          </p>
        </Aviso>
      );
    case "vencida":
      return (
        <Aviso
          icono={<Clock className="size-8 text-warning" aria-hidden />}
          titulo="Este link venció"
        >
          <p>Pídele a {clinica} que te mande uno nuevo.</p>
        </Aviso>
      );
    case "cancelada":
      return (
        <Aviso
          icono={<XCircle className="size-8 text-muted-foreground" aria-hidden />}
          titulo="Pedido de firma cancelado"
        >
          <p>{clinica} canceló este pedido. Si crees que es un error, escríbeles.</p>
        </Aviso>
      );
    case "reemplazada":
      return (
        <Aviso
          icono={<Mail className="size-8 text-brand" aria-hidden />}
          titulo="Tienes un link más nuevo"
        >
          <p>{clinica} te mandó un link nuevo para firmar. Usa ese: este ya no sirve.</p>
        </Aviso>
      );
    case "limitada":
      return (
        <Aviso
          icono={<Clock className="size-8 text-warning" aria-hidden />}
          titulo="Demasiados intentos"
        >
          <p>
            Hubo muchos intentos desde esta conexión. Espera unos minutos y vuelve a abrir el link.
          </p>
        </Aviso>
      );
    default:
      return (
        <Aviso
          icono={<XCircle className="size-8 text-destructive" aria-hidden />}
          titulo="Link no válido"
        >
          <p>Revisa que el link esté completo o pídele a tu clínica uno nuevo.</p>
        </Aviso>
      );
  }
}

// ─── Paso 1: RUT ─────────────────────────────────────────────────────────────

function PasoRut({
  token,
  info,
  onVerificado,
  onCerrado,
}: {
  token: string;
  info: FirmaAbierta;
  onVerificado: (doc: Extract<VerificacionDeRut, { ok: true }>) => void;
  onCerrado: (estado: EstadoPublico) => void;
}) {
  const verificar = useServerFn(verificarRutParaFirmar);
  const [rut, setRut] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bloqueadaHasta, setBloqueadaHasta] = useState<string | null>(info.bloqueadaHasta);
  const tutor = info.firmante === "tutor";

  async function continuar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError(null);
    setEnviando(true);
    try {
      const r = await verificar({ data: { token, rut } });
      if (r.ok) return onVerificado(r);
      if (r.bloqueadaHasta) {
        setBloqueadaHasta(r.bloqueadaHasta);
        return;
      }
      if (r.estado !== "enviada" && r.estado !== "abierta") return onCerrado(r.estado);
      setError(
        r.restantes !== null
          ? `El RUT no coincide con el que tiene la clínica. Te quedan ${r.restantes} intento${r.restantes === 1 ? "" : "s"}.`
          : "El RUT no coincide con el que tiene la clínica.",
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  const bloqueada = bloqueadaHasta && new Date(bloqueadaHasta) > new Date();
  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand-700">
          <FileSignature className="size-5" aria-hidden />
        </span>
        <h1 className="font-display text-3xl font-semibold leading-tight">
          {info.clinica ?? "Tu clínica"} te pide una firma
        </h1>
        <p className="text-sm text-muted-foreground">
          {info.tipo === "presupuesto"
            ? "Vas a revisar un presupuesto y, si estás de acuerdo, aceptarlo con tu firma."
            : "Vas a leer un documento y firmarlo desde tu celular."}{" "}
          Primero confirma que eres {tutor ? "el tutor o representante legal del paciente" : "tú"}.
        </p>
      </div>

      {bloqueada ? (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-warning-border bg-warning-soft p-4 text-sm text-warning"
        >
          <LockKeyhole className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            Por seguridad bloqueamos la firma por {minutosHasta(bloqueadaHasta!)} minuto
            {minutosHasta(bloqueadaHasta!) === 1 ? "" : "s"} después de varios intentos. Vuelve a
            intentarlo después.
          </p>
        </div>
      ) : (
        <form onSubmit={continuar} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rut">{tutor ? "RUT del tutor o representante" : "Tu RUT"}</Label>
            <Input
              id="rut"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              placeholder="Ej.: 12.345.678-5"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              maxLength={20}
              className="h-12 text-base"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "rut-error" : "rut-ayuda"}
            />
            <p id="rut-ayuda" className="text-xs text-muted-foreground">
              Lo comparamos con el de la ficha de la clínica. No lo guardamos completo.
            </p>
            {error && (
              <p id="rut-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full text-base"
            disabled={enviando || rut.trim().length < 3}
          >
            {enviando && <Loader2 className="animate-spin" aria-hidden />} Continuar
          </Button>
        </form>
      )}

      {info.venceEl && (
        <p className="text-center text-xs text-muted-foreground">
          Este link es personal y vence el {fechaHora(info.venceEl, info.zona)}.
        </p>
      )}
    </section>
  );
}

// ─── Paso 2: documento, código y firma ───────────────────────────────────────

function PasoDocumento({
  token,
  info,
  doc,
  onFirmado,
  onSesionVencida,
}: {
  token: string;
  info: FirmaAbierta;
  doc: Extract<VerificacionDeRut, { ok: true }>;
  onFirmado: (r: Extract<ResultadoDeFirma, { ok: true }>) => void;
  onSesionVencida: () => void;
}) {
  const enviarCodigo = useServerFn(enviarCodigoParaFirmar);
  const firmar = useServerFn(firmarDocumentoADistancia);
  const [codigoEnviado, setCodigoEnviado] = useState<{
    a: string | null;
    redirigido: boolean;
  } | null>(null);
  const [espera, setEspera] = useState(0);
  const [pidiendo, setPidiendo] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [acepto, setAcepto] = useState(false);
  const [firma, setFirma] = useState<string | null>(null);
  const [firmando, setFirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firmarRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function pedirCodigo() {
    setError(null);
    setPidiendo(true);
    try {
      const r = await enviarCodigo({ data: { token, sesion: doc.sesion } });
      if (r.ok) {
        setCodigoEnviado({ a: r.codigoA, redirigido: r.redirigido });
        setEspera(60);
      } else {
        setError(r.motivo);
        if (r.esperarSegundos) setEspera(r.esperarSegundos);
        if (/sesión venció/i.test(r.motivo)) onSesionVencida();
      }
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setPidiendo(false);
    }
  }

  const codigoListo = /^\d{6}$/.test(codigo.replace(/\s/g, ""));
  const listo = codigoListo && nombre.trim().length >= 3 && acepto;

  async function enviarFirma(e: React.FormEvent) {
    e.preventDefault();
    if (!listo || firmando) return;
    setError(null);
    setFirmando(true);
    try {
      const imagen = firma ? await firmaEnTintaOscura(firma) : null;
      const r = await firmar({
        data: {
          token,
          sesion: doc.sesion,
          codigo,
          nombre: nombre.trim(),
          acepto: true,
          ...(imagen ? { firma: imagen } : {}),
        },
      });
      if (r.ok) return onFirmado(r);
      setError(
        r.restantes !== null && r.restantes > 0
          ? `${r.motivo} Te quedan ${r.restantes} intento${r.restantes === 1 ? "" : "s"}.`
          : r.motivo,
      );
      if (/sesión venció/i.test(r.motivo)) onSesionVencida();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setFirmando(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
          {doc.tipo === "presupuesto" ? "Presupuesto para aceptar" : "Documento para firmar"}
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight">{doc.titulo}</h1>
        <p className="text-sm text-muted-foreground">
          Léelo completo. Al final pedimos un código y tu firma.
        </p>
      </div>

      {doc.bloques ? (
        <HojaDocumento
          bloques={doc.bloques}
          firmaUrl={doc.firmaProfesionalUrl}
          className="px-4 py-6 sm:px-10 sm:py-10"
          encabezado={
            doc.hoja ? (
              <header className="mb-6 border-b border-border pb-3">
                <p className="font-display text-lg font-semibold leading-tight">
                  {doc.hoja.clinicName}
                </p>
                {doc.hoja.lineasEncabezado.map((l) => (
                  <p key={l} className="text-xs text-muted-foreground">
                    {l}
                  </p>
                ))}
                <p className="mt-1 text-xs text-muted-foreground">{doc.hoja.referencia}</p>
              </header>
            ) : undefined
          }
          pie={
            <footer className="mt-8 border-t border-hairline pt-3 text-[11px] text-muted-foreground">
              Huella SHA-256 del documento:{" "}
              <span className="cifra break-all">{huellaCorta(doc.documentoSha256, 32)}</span>
            </footer>
          }
        />
      ) : (
        <p
          role="alert"
          className="rounded-md border border-destructive-border bg-destructive-soft p-4 text-sm text-destructive"
        >
          No podemos mostrar este documento. Avísale a la clínica.
        </p>
      )}

      <form
        onSubmit={enviarFirma}
        className="card-clinical mx-auto max-w-xl space-y-6 p-5 sm:p-6"
        aria-labelledby="titulo-firmar"
      >
        <h2 id="titulo-firmar" ref={firmarRef} className="font-display text-2xl font-semibold">
          {doc.tipo === "presupuesto" ? "Aceptar y firmar" : "Firmar"}
        </h2>

        <div className="space-y-3">
          <p className="text-sm font-medium">1. Código de verificación</p>
          {!codigoEnviado ? (
            <p className="text-sm text-muted-foreground">
              Te mandamos un código de 6 dígitos a tu correo{doc.codigoA ? ` (${doc.codigoA})` : ""}
              . Vence en 10 minutos.
            </p>
          ) : (
            <p role="status" className="flex items-start gap-2 text-sm text-success">
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Te enviamos el código{codigoEnviado.a ? ` a ${codigoEnviado.a}` : ""}. Revisa
                también la carpeta de spam.
                {codigoEnviado.redirigido
                  ? " (La clínica está en modo de prueba: el correo llegó a su casilla de pruebas.)"
                  : ""}
              </span>
            </p>
          )}
          <Button
            type="button"
            variant={codigoEnviado ? "outline" : "default"}
            className="h-11 w-full"
            onClick={() => void pedirCodigo()}
            disabled={pidiendo || espera > 0}
          >
            {pidiendo && <Loader2 className="animate-spin" aria-hidden />}
            {codigoEnviado
              ? espera > 0
                ? `Pedir otro código en ${espera} s`
                : "Pedir otro código"
              : "Enviarme el código"}
          </Button>
          {codigoEnviado && (
            <div className="space-y-1.5">
              <Label htmlFor="codigo">Código</Label>
              <Input
                id="codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                className="cifra h-12 text-center text-xl tracking-[0.3em]"
              />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nombre" className="text-sm font-medium">
            2. Tu nombre completo
          </Label>
          <Input
            id="nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoComplete="name"
            placeholder={doc.nombreFirmante || "Nombre y apellidos"}
            maxLength={120}
            className="h-12 text-base"
          />
          {doc.firmante === "tutor" && (
            <p className="text-xs text-muted-foreground">
              Firmas como tutor o representante legal del paciente.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">3. Tu firma (opcional)</p>
          <SignaturePad label="Dibuja tu firma" onChange={setFirma} />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-hairline bg-muted/30 p-3 text-sm">
          <input
            type="checkbox"
            checked={acepto}
            onChange={(e) => setAcepto(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-brand"
          />
          <span>
            <span className="font-medium">Leí y acepto.</span>{" "}
            <span className="text-muted-foreground">{doc.textoAceptacion}</span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="h-12 w-full text-base"
          disabled={!listo || firmando}
        >
          {firmando ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <FileSignature aria-hidden />
          )}
          {doc.tipo === "presupuesto" ? "Aceptar y firmar" : "Firmar documento"}
        </Button>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Guardamos la fecha y hora, tu dirección IP, tu dispositivo y la huella del documento como
          evidencia de la firma. La firma no se puede editar ni borrar.
        </p>
      </form>
      {info.venceEl && (
        <p className="text-center text-xs text-muted-foreground">
          El link vence el {fechaHora(info.venceEl, info.zona)}.
        </p>
      )}
    </div>
  );
}

// ─── Paso 3: firmado ─────────────────────────────────────────────────────────

function descargar(pdf: { base64: string; nombre: string }) {
  const bytes = Uint8Array.from(atob(pdf.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = pdf.nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Firmado({
  info,
  doc,
  r,
}: {
  info: FirmaAbierta;
  doc: Extract<VerificacionDeRut, { ok: true }>;
  r: Extract<ResultadoDeFirma, { ok: true }>;
}) {
  return (
    <section className="mx-auto max-w-md space-y-6 py-8 text-center">
      <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Listo, quedó firmado</h1>
        <p className="text-sm text-muted-foreground">
          {doc.tipo === "presupuesto" ? "Aceptaste" : "Firmaste"} “{doc.titulo}” el{" "}
          {fechaHora(r.firmadaEl, info.zona)}. {info.clinica ?? "La clínica"} ya tiene la copia en
          tu ficha.
        </p>
      </div>
      {r.pdf ? (
        <Button size="lg" className="h-12 w-full text-base" onClick={() => descargar(r.pdf!)}>
          <Download aria-hidden /> Descargar copia firmada (PDF)
        </Button>
      ) : (
        <p className="rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning">
          La firma quedó registrada, pero no pudimos armar tu copia en PDF. Pídesela a la clínica.
        </p>
      )}
      <dl className="space-y-1 rounded-lg border border-hairline p-3 text-left text-xs text-muted-foreground">
        <div>
          <dt className="inline font-medium text-foreground">Huella del documento: </dt>
          <dd className="cifra inline break-all">{huellaCorta(r.documentoSha256, 32)}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">Huella de la evidencia: </dt>
          <dd className="cifra inline break-all">{huellaCorta(r.evidenciaSha256, 32)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">Ya puedes cerrar esta página.</p>
    </section>
  );
}
