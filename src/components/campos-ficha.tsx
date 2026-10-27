import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import {
  ETIQUETA_PREVISION,
  ETIQUETA_SEXO,
  INSTITUCIONES_FFAA,
  ISAPRES_POR_DEFECTO,
  ORIGEN_OTRO,
  ORIGENES_POR_DEFECTO,
  PREVISIONES,
  SEXOS,
  TRAMOS_FONASA,
  type CampoFicha,
  type EstadoCamposFicha,
  type Prevision,
  type Sexo,
  type TramoFonasa,
} from "@/lib/patients/datos-ficha";
import {
  ETIQUETA_TIPO_DOCUMENTO,
  formatearRut,
  TIPOS_DOCUMENTO,
  type TipoDocumento,
} from "@/lib/patients/rut";
import { cn } from "@/lib/utils";

const CAMPO =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";

/**
 * Campos de la ficha que agregó la Ola 1 · Frente Pacientes, compartidos por
 * "Nuevo paciente" y "Editar datos": documento con tipo (FIC-01), previsión
 * (FIC-02), contacto de emergencia (FIC-03), origen (FIC-04) y domicilio
 * (SEG-08). Controlado: el padre guarda el estado y valida con
 * `erroresDeCamposFicha`. La previsión y el domicilio solo se muestran en
 * clínicas de Chile.
 */
export function CamposFicha({
  idBase,
  valor,
  onChange,
  errores,
  esChile,
  previsionObligatoria,
  isapres,
  origenes,
  origenBloqueado,
  conDocumento = true,
}: {
  idBase: string;
  valor: EstadoCamposFicha;
  onChange: (cambio: Partial<EstadoCamposFicha>) => void;
  errores: Partial<Record<CampoFicha, string>>;
  esChile: boolean;
  previsionObligatoria: boolean;
  /** Listas de la clínica; si todavía no cargan, se usan las de siempre. */
  isapres?: readonly string[];
  origenes?: readonly string[];
  /** Texto que explica por qué el origen ya está fijado (código de referido). */
  origenBloqueado?: string | null;
  /** El documento puede ir en otra parte del formulario (Editar datos lo tiene arriba). */
  conDocumento?: boolean;
}) {
  const id = (c: string) => `${idBase}-${c}`;
  const listaIsapres = conActual(
    isapres?.length ? isapres : ISAPRES_POR_DEFECTO,
    valor.institucion,
  );
  const listaOrigenes = conActual(origenes?.length ? origenes : ORIGENES_POR_DEFECTO, valor.origen);

  return (
    <div className="space-y-4">
      {conDocumento && (
        <CampoDocumento
          idBase={idBase}
          tipo={valor.documentoTipo}
          documento={valor.documento}
          error={errores.documento}
          onChange={onChange}
        />
      )}

      {esChile && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Previsión
            {previsionObligatoria ? (
              <span className="text-destructive"> *</span>
            ) : (
              <span className="font-normal text-muted-foreground"> (Decreto 41)</span>
            )}
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              id={id("prevision")}
              aria-label="Previsión"
              value={valor.plan}
              onChange={(e) =>
                onChange({
                  plan: e.target.value as Prevision | "",
                  tramo: "",
                  institucion: "",
                })
              }
              aria-invalid={errores.prevision ? true : undefined}
              aria-describedby={errores.prevision ? id("prevision-error") : undefined}
              className={cn(CAMPO, errores.prevision && "border-destructive")}
            >
              <option value="">{previsionObligatoria ? "Elige una opción" : "Pendiente"}</option>
              {PREVISIONES.map((p) => (
                <option key={p} value={p}>
                  {ETIQUETA_PREVISION[p]}
                </option>
              ))}
            </select>
            {valor.plan === "fonasa" && (
              <select
                aria-label="Tramo de Fonasa"
                value={valor.tramo}
                onChange={(e) => onChange({ tramo: e.target.value as TramoFonasa | "" })}
                className={CAMPO}
              >
                <option value="">Tramo</option>
                {TRAMOS_FONASA.map((t) => (
                  <option key={t} value={t}>
                    Tramo {t}
                  </option>
                ))}
              </select>
            )}
            {valor.plan === "isapre" && (
              <select
                aria-label="Isapre"
                value={valor.institucion}
                onChange={(e) => onChange({ institucion: e.target.value })}
                className={CAMPO}
              >
                <option value="">Elige la isapre</option>
                {listaIsapres.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            )}
            {valor.plan === "ffaa" && (
              <select
                aria-label="Institución"
                value={valor.institucion}
                onChange={(e) => onChange({ institucion: e.target.value })}
                className={CAMPO}
              >
                <option value="">Capredena o Dipreca</option>
                {INSTITUCIONES_FFAA.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            )}
          </div>
          <MensajeError id={id("prevision-error")} texto={errores.prevision} />
          <p className="text-xs text-muted-foreground">
            Es independiente de los convenios de la clínica.
          </p>
        </fieldset>
      )}

      {esChile && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor={id("direccion")}>Dirección</Label>
            <input
              id={id("direccion")}
              value={valor.direccion}
              onChange={(e) => onChange({ direccion: e.target.value })}
              autoComplete="off"
              maxLength={200}
              className={CAMPO}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("comuna")}>Comuna</Label>
            <input
              id={id("comuna")}
              value={valor.comuna}
              onChange={(e) => onChange({ comuna: e.target.value })}
              autoComplete="off"
              maxLength={80}
              className={CAMPO}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5 sm:max-w-xs">
        <Label htmlFor={id("sexo")}>
          Sexo <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <select
          id={id("sexo")}
          value={valor.sexo}
          onChange={(e) => onChange({ sexo: e.target.value as Sexo | "" })}
          className={CAMPO}
        >
          <option value="">Sin registrar</option>
          {SEXOS.map((s) => (
            <option key={s} value={s}>
              {ETIQUETA_SEXO[s]}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Solo sirve para los informes de la clínica. Puedes dejarlo sin registrar.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Contacto de emergencia{" "}
          <span className="font-normal text-muted-foreground">(opcional)</span>
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CampoTexto
            id={id("contactoNombre")}
            etiqueta="Nombre"
            valor={valor.contactoNombre}
            error={errores.contactoNombre}
            maxLength={120}
            onChange={(v) => onChange({ contactoNombre: v })}
          />
          <CampoTexto
            id={id("contactoRelacion")}
            etiqueta="Relación"
            placeholder="Madre, pareja…"
            valor={valor.contactoRelacion}
            error={errores.contactoRelacion}
            maxLength={60}
            onChange={(v) => onChange({ contactoRelacion: v })}
          />
          <CampoTexto
            id={id("contactoTelefono")}
            etiqueta="Teléfono"
            tipo="tel"
            valor={valor.contactoTelefono}
            error={errores.contactoTelefono}
            maxLength={40}
            onChange={(v) => onChange({ contactoTelefono: v })}
          />
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={id("origen")}>¿Cómo llegó a la clínica?</Label>
        {origenBloqueado ? (
          <p id={id("origen")} className="rounded-lg border border-hairline px-3 py-2 text-sm">
            {origenBloqueado}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              id={id("origen")}
              value={valor.origen}
              onChange={(e) => onChange({ origen: e.target.value })}
              aria-invalid={errores.origen ? true : undefined}
              aria-describedby={errores.origen ? id("origen-error") : undefined}
              className={cn(CAMPO, errores.origen && "border-destructive")}
            >
              <option value="">Sin dato</option>
              {listaOrigenes.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            {valor.origen && (
              <input
                aria-label="Detalle del origen"
                value={valor.origenDetalle}
                onChange={(e) => onChange({ origenDetalle: e.target.value })}
                placeholder={valor.origen === ORIGEN_OTRO ? "¿Dónde?" : "Detalle (opcional)"}
                maxLength={200}
                className={CAMPO}
              />
            )}
          </div>
        )}
        <MensajeError id={id("origen-error")} texto={errores.origen} />
      </div>
    </div>
  );
}

/** Tipo + número de documento. El RUT se valida y se formatea al salir del campo. */
export function CampoDocumento({
  idBase,
  tipo,
  documento,
  error,
  onChange,
  onSalir,
  extra,
}: {
  idBase: string;
  tipo: TipoDocumento;
  documento: string;
  error?: string;
  onChange: (cambio: { documentoTipo?: TipoDocumento; documento?: string }) => void;
  /** Al salir del campo, con el documento ya formateado (para buscar duplicados). */
  onSalir?: (documento: string) => void;
  extra?: ReactNode;
}) {
  const idDoc = `${idBase}-documento`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={idDoc}>Documento</Label>
      <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2">
        <select
          aria-label="Tipo de documento"
          value={tipo}
          onChange={(e) => onChange({ documentoTipo: e.target.value as TipoDocumento })}
          className={CAMPO}
        >
          {TIPOS_DOCUMENTO.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO_DOCUMENTO[t]}
            </option>
          ))}
        </select>
        <input
          id={idDoc}
          value={documento}
          onChange={(e) => onChange({ documento: e.target.value })}
          onBlur={() => {
            const final = tipo === "rut" && documento.trim() ? formatearRut(documento) : documento;
            if (final !== documento) onChange({ documento: final });
            onSalir?.(final);
          }}
          inputMode={tipo === "rut" ? "text" : undefined}
          placeholder={tipo === "rut" ? "12.345.678-5" : undefined}
          autoComplete="off"
          maxLength={40}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${idDoc}-error` : undefined}
          className={cn(CAMPO, error && "border-destructive")}
        />
      </div>
      <MensajeError id={`${idDoc}-error`} texto={error} />
      {extra}
    </div>
  );
}

function CampoTexto({
  id,
  etiqueta,
  valor,
  onChange,
  error,
  tipo = "text",
  placeholder,
  maxLength,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  error?: string;
  tipo?: "text" | "tel";
  placeholder?: string;
  maxLength: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {etiqueta}
      </Label>
      <input
        id={id}
        type={tipo}
        inputMode={tipo === "tel" ? "tel" : undefined}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(CAMPO, error && "border-destructive")}
      />
      <MensajeError id={`${id}-error`} texto={error} />
    </div>
  );
}

function MensajeError({ id, texto }: { id: string; texto?: string }) {
  if (!texto) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {texto}
    </p>
  );
}

/** La lista, más el valor actual si ya no está (una opción desactivada sigue visible en su ficha). */
function conActual(lista: readonly string[], actual: string): string[] {
  const t = actual.trim();
  return t && !lista.includes(t) ? [...lista, t] : [...lista];
}
