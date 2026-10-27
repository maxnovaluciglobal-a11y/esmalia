import { useId, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { EsmaliaLogo } from "@/components/esmalia-logo";
import { vincularDispositivo } from "@/lib/dispositivos/dispositivo-publico.functions";
import { normalizarCodigoVinculacion, type TipoDispositivo } from "@/lib/dispositivos/dispositivos";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * Vincular un dispositivo (AUT-06): se escribe el código de un solo uso que
 * generó owner/admin en Ajustes → Dispositivos. El servidor devuelve el token
 * propio del dispositivo; se guarda y no se vuelve a pedir hasta que la
 * clínica lo revoque.
 */
export function VincularDispositivo({
  aviso,
  onVinculado,
}: {
  aviso: string | null;
  onVinculado: (token: string, tipo: TipoDispositivo) => void;
}) {
  const id = useId();
  const vincularFn = useServerFn(vincularDispositivo);
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!normalizarCodigoVinculacion(codigo)) {
      setError("Son 8 letras y números, como ABCD-EFGH.");
      return;
    }
    setEnviando(true);
    try {
      const r = await vincularFn({ data: { codigo } });
      if (r.ok) onVinculado(r.token, r.tipo);
      else setError(r.motivo);
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos vincular el dispositivo. Vuelve a intentarlo."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10 sm:px-8">
      <EsmaliaLogo size={30} />
      <h1 className="mt-10 font-display text-[clamp(2.5rem,7vw,4rem)] font-medium leading-[0.95] tracking-[-0.02em]">
        Vincula este <em className="text-brand-600">dispositivo</em>
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        En Esmalia, entra a Ajustes → Dispositivos, elige este dispositivo y toca “Generar código”.
        Escríbelo aquí. Vence en 10 minutos y sirve una sola vez.
      </p>
      {aviso && (
        <p
          role="status"
          className="mt-6 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-base"
        >
          {aviso}
        </p>
      )}
      <form onSubmit={(e) => void enviar(e)} className="mt-8 space-y-4" noValidate>
        <label htmlFor={`${id}-codigo`} className="block text-base font-medium">
          Código de vinculación
        </label>
        <input
          id={`${id}-codigo`}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase().slice(0, 9))}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-EFGH"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="cifra block h-20 w-full rounded-xl border border-input bg-card px-5 text-center text-[clamp(2rem,6vw,3rem)] tracking-[0.18em] uppercase placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="text-base text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex h-16 w-full items-center justify-center gap-2 rounded-full bg-foreground text-lg font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
        >
          {enviando && <Loader2 className="size-5 animate-spin" aria-hidden />}
          Vincular
        </button>
      </form>
    </main>
  );
}
