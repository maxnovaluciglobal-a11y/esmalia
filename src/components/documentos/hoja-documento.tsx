import type { ReactNode } from "react";

import type { Bloque, Tramo } from "@/lib/documentos/tipos";
import { cn } from "@/lib/utils";

/**
 * Hoja de un documento (DOC-01): pinta los bloques del motor con React, sin
 * `innerHTML`, así que ni una plantilla ni un dato de la ficha pueden
 * inyectar markup. La usan la vista previa del editor, la del diálogo de
 * emisión y la página del documento emitido (que es la que se imprime).
 *
 * `resaltar` marca las variables en la vista previa: lo que salió de la
 * ficha, lo que falta (línea para completar) y las variables desconocidas.
 */
export function HojaDocumento({
  bloques,
  encabezado,
  pie,
  firmaUrl,
  resaltar = false,
  className,
}: {
  bloques: readonly Bloque[];
  encabezado?: ReactNode;
  pie?: ReactNode;
  /** Imagen de la firma del profesional (URL firmada o data URL). */
  firmaUrl?: string | null;
  resaltar?: boolean;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "hoja-documento mx-auto w-full max-w-[210mm] rounded-md border border-hairline bg-card px-6 py-8 text-card-foreground shadow-sm sm:px-12 sm:py-12",
        className,
      )}
    >
      {encabezado}
      <div className="space-y-3 text-[15px] leading-relaxed">
        {bloques.map((b, i) => (
          <BloqueDocumento key={i} bloque={b} resaltar={resaltar} firmaUrl={firmaUrl ?? null} />
        ))}
      </div>
      {pie}
    </article>
  );
}

function TramosDocumento({ tramos, resaltar }: { tramos: readonly Tramo[]; resaltar: boolean }) {
  return (
    <>
      {tramos.map((t, i) => {
        if (t.tipo === "salto") return <br key={i} />;
        let contenido: ReactNode = t.texto;
        if (resaltar && t.desconocida) {
          contenido = (
            <mark
              className="rounded-sm bg-destructive-soft px-0.5 text-destructive"
              title="Variable desconocida"
            >
              {t.texto}
            </mark>
          );
        } else if (resaltar && t.faltante) {
          contenido = (
            <span
              className="rounded-sm border border-dashed border-warning-border bg-warning-soft px-1 text-warning"
              title="Sin dato: se imprime una línea para completar a mano"
            >
              {t.texto}
            </span>
          );
        } else if (resaltar && t.variable) {
          contenido = (
            <span className="rounded-sm bg-brand-soft" title={`{{${t.variable}}}`}>
              {t.texto}
            </span>
          );
        }
        return t.negrita ? <strong key={i}>{contenido}</strong> : <span key={i}>{contenido}</span>;
      })}
    </>
  );
}

function BloqueDocumento({
  bloque: b,
  resaltar,
  firmaUrl,
}: {
  bloque: Bloque;
  resaltar: boolean;
  firmaUrl: string | null;
}) {
  switch (b.tipo) {
    case "titulo":
      return b.nivel === 1 ? (
        <h2 className="pb-2 pt-1 font-display text-2xl font-semibold leading-tight">
          <TramosDocumento tramos={b.tramos} resaltar={resaltar} />
        </h2>
      ) : (
        <h3 className="pt-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <TramosDocumento tramos={b.tramos} resaltar={resaltar} />
        </h3>
      );
    case "parrafo":
      return (
        <p>
          <TramosDocumento tramos={b.tramos} resaltar={resaltar} />
        </p>
      );
    case "lista":
      return (
        <ul className="list-disc space-y-1 pl-6">
          {b.items.map((item, i) => (
            <li key={i}>
              <TramosDocumento tramos={item} resaltar={resaltar} />
            </li>
          ))}
        </ul>
      );
    case "tabla":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                {b.columnas.map((c, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={cn(
                      "px-2 py-1.5 font-semibold",
                      c.alineacion === "derecha" ? "text-right" : "text-left",
                    )}
                  >
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.filas.length === 0 ? (
                <tr>
                  <td colSpan={b.columnas.length} className="px-2 py-2 text-muted-foreground">
                    {b.vacia ?? "Sin datos."}
                  </td>
                </tr>
              ) : (
                b.filas.map((f, i) => (
                  <tr key={i} className="border-b border-hairline">
                    {f.map((v, j) => (
                      <td
                        key={j}
                        className={cn(
                          "px-2 py-1.5 align-top",
                          b.columnas[j]?.alineacion === "derecha" && "cifra text-right",
                        )}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {b.pie && (
              <tfoot>
                <tr className="font-semibold">
                  {b.pie.map((v, j) => (
                    <td
                      key={j}
                      className={cn(
                        "px-2 py-1.5",
                        b.columnas[j]?.alineacion === "derecha" && "cifra text-right",
                      )}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      );
    case "firma":
      return (
        <div className="firma-documento ml-auto mt-12 w-full max-w-[260px] break-inside-avoid pt-2 text-center text-sm">
          <div className="flex h-16 items-end justify-center">
            {firmaUrl ? (
              <img
                src={firmaUrl}
                alt={`Firma de ${b.nombre}`}
                className="max-h-16 max-w-[200px] object-contain dark:invert"
              />
            ) : null}
          </div>
          <div className="border-t border-foreground/50 pt-1.5">
            <p className="font-semibold">{b.nombre}</p>
            {b.especialidad && <p className="text-muted-foreground">{b.especialidad}</p>}
            {b.registro && <p className="text-muted-foreground">{b.registro}</p>}
            {!firmaUrl && <p className="text-xs text-muted-foreground">Firma y timbre</p>}
          </div>
        </div>
      );
  }
}
