import { nombreSeccionSoap, separarSoap } from "@/lib/clinical/soap";
import { cn } from "@/lib/utils";

/**
 * Lectura de una nota con la jerarquía del prototipo A+: la letra S, O, A o
 * P grande en Cormorant ocre y el texto al lado. Si la nota no está escrita
 * en SOAP, se muestra tal cual (no se inventa una estructura).
 */
export function SoapLectura({ contenido, className }: { contenido: string; className?: string }) {
  const secciones = separarSoap(contenido);
  if (!secciones) {
    return (
      <p className={cn("max-w-[68ch] whitespace-pre-wrap text-base leading-relaxed", className)}>
        {contenido}
      </p>
    );
  }
  return (
    <dl className={cn("grid grid-cols-[34px_1fr] gap-x-2.5 gap-y-3", className)}>
      {secciones.map((s) => (
        <div key={s.letra} className="contents">
          <dt className="font-display text-[30px] leading-[0.9] font-medium text-brand-600">
            <abbr title={nombreSeccionSoap(s.letra)} className="no-underline">
              {s.letra}
            </abbr>
          </dt>
          <dd className="max-w-[68ch] whitespace-pre-wrap text-base leading-relaxed">
            {s.texto || <span className="text-muted-foreground">Sin registro.</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
