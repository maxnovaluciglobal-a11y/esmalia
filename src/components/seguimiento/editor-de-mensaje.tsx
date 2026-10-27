import { useId, useMemo, useRef } from "react";
import { AlertTriangle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  analizarMensaje,
  LARGO_MAXIMO_ASUNTO,
  LARGO_MAXIMO_CUERPO,
  renderMensaje,
  valoresDeEjemplo,
  VARIABLES_DE_MENSAJE,
  type CanalDePlantilla,
} from "@/lib/seguimiento/plantillas";

/**
 * Editor de un mensaje con variables en español (CRM-03): asunto (correo),
 * texto, botones para insertar variables donde está el cursor, aviso de
 * variables desconocidas y vista previa con datos de ejemplo. Lo usan las
 * plantillas y las campañas.
 */
export function EditorDeMensaje({
  canal,
  asunto,
  cuerpo,
  onAsunto,
  onCuerpo,
  clinica,
}: {
  canal: CanalDePlantilla;
  asunto: string;
  cuerpo: string;
  onAsunto: (v: string) => void;
  onCuerpo: (v: string) => void;
  clinica: string;
}) {
  const fid = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const analisis = useMemo(
    () => analizarMensaje(cuerpo, canal === "correo" ? asunto : null),
    [cuerpo, asunto, canal],
  );
  const valores = useMemo(() => valoresDeEjemplo(clinica), [clinica]);

  const insertar = (clave: string) => {
    const el = area.current;
    const texto = `{{${clave}}}`;
    if (!el) {
      onCuerpo(`${cuerpo}${texto}`);
      return;
    }
    const inicio = el.selectionStart ?? cuerpo.length;
    const fin = el.selectionEnd ?? cuerpo.length;
    const nuevo = cuerpo.slice(0, inicio) + texto + cuerpo.slice(fin);
    onCuerpo(nuevo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + texto.length, inicio + texto.length);
    });
  };

  return (
    <div className="space-y-3">
      {canal === "correo" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-asunto`}>Asunto</Label>
          <Input
            id={`${fid}-asunto`}
            value={asunto}
            onChange={(e) => onAsunto(e.target.value)}
            maxLength={LARGO_MAXIMO_ASUNTO}
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${fid}-cuerpo`}>Mensaje</Label>
        <textarea
          id={`${fid}-cuerpo`}
          ref={area}
          value={cuerpo}
          onChange={(e) => onCuerpo(e.target.value)}
          maxLength={LARGO_MAXIMO_CUERPO}
          rows={canal === "correo" ? 8 : 5}
          className="w-full rounded-lg border border-control bg-card px-3 py-2 text-[15px] leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <p className="cifra text-right text-xs text-muted-foreground">
          {cuerpo.length}/{LARGO_MAXIMO_CUERPO}
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">Insertar un dato</p>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES_DE_MENSAJE.map((v) => (
            <button
              key={v.clave}
              type="button"
              onClick={() => insertar(v.clave)}
              title={v.etiqueta}
              className="inline-flex h-8 items-center rounded-full border border-control px-3 text-[13px] font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
            >
              {v.etiqueta.split(" (")[0]}
            </button>
          ))}
        </div>
      </div>
      {analisis.problemas.length > 0 && cuerpo.trim().length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning">
          {analisis.problemas.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}
      {cuerpo.trim().length > 0 && (
        <div className="rounded-lg border border-hairline bg-secondary/60 px-3 py-2.5">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            Así se ve (con datos de ejemplo)
          </p>
          {canal === "correo" && asunto && (
            <p className="mb-1 text-sm font-semibold">{renderMensaje(asunto, valores)}</p>
          )}
          <p className="whitespace-pre-line text-sm">{renderMensaje(cuerpo, valores)}</p>
        </div>
      )}
    </div>
  );
}
