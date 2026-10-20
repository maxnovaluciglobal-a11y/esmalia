import { Fragment, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { PublicPageShell } from "@/components/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { type Enlace, NOMBRE_COLECCION } from "@/content";
import type { Bloque, PaginaContenido } from "@/content/tipos";
import { registrarEvento } from "@/lib/marketing/eventos";
import { cn } from "@/lib/utils";

const ENLACE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

/** Texto en línea con **negrita** y [enlaces](/ruta). Lo demás se muestra tal cual. */
export function TextoEnLinea({ texto }: { texto: string }) {
  const partes = texto.split(ENLACE).filter(Boolean);
  return (
    <>
      {partes.map((parte, i) => {
        if (parte.startsWith("**") && parte.endsWith("**")) {
          return <strong key={i}>{parte.slice(2, -2)}</strong>;
        }
        const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(parte);
        if (m) {
          const [, etiqueta, href] = m;
          const externo = /^https?:\/\//.test(href);
          return (
            <a
              key={i}
              href={href}
              className="text-brand-700 underline underline-offset-2 hover:no-underline"
              {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {etiqueta}
            </a>
          );
        }
        return <Fragment key={i}>{parte}</Fragment>;
      })}
    </>
  );
}

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(texto)
          .then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          })
          .catch(() => {});
      }}
      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground print:hidden"
    >
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
}

/** Solo en plantillas: imprime la página con los estilos `print:` (sin
 *  header, footer, CTA ni botones). Un onClick, nada más de JS. */
function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground print:hidden"
    >
      Imprimir o guardar en PDF
    </button>
  );
}

function RenderBloque({ bloque }: { bloque: Bloque }): ReactNode {
  switch (bloque.tipo) {
    case "p":
      return (
        <p className="mt-4 text-[16px] leading-relaxed text-foreground/85">
          <TextoEnLinea texto={bloque.texto} />
        </p>
      );
    case "lista": {
      const Lista = bloque.ordenada ? "ol" : "ul";
      return (
        <Lista
          className={cn(
            "mt-4 space-y-2 pl-5 text-[16px] leading-relaxed text-foreground/85",
            bloque.ordenada ? "list-decimal" : "list-disc marker:text-brand-700",
          )}
        >
          {bloque.items.map((item) => (
            <li key={item}>
              <TextoEnLinea texto={item} />
            </li>
          ))}
        </Lista>
      );
    }
    case "tabla":
      return (
        <figure className="mt-6 print:break-inside-avoid">
          <div className="overflow-x-auto rounded-xl border border-hairline print:overflow-visible">
            <table
              className={cn(
                "w-full border-collapse text-left text-sm print:min-w-0 print:text-xs",
                // Tablas anchas (comparativas): se desplazan en su contenedor en
                // vez de apretar cada celda a dos palabras por línea.
                bloque.columnas.length > 5 ? "min-w-[900px]" : "min-w-[560px]",
              )}
            >
              <thead className="bg-muted/50">
                <tr>
                  {bloque.columnas.map((c) => (
                    <th key={c} scope="col" className="px-3 py-2.5 font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bloque.filas.map((fila, i) => (
                  <tr key={i} className="border-t border-hairline align-top">
                    {fila.map((celda, j) =>
                      j === 0 ? (
                        <th
                          key={j}
                          scope="row"
                          className={cn("px-3 py-2.5 font-medium", bloque.rellenable && "h-11")}
                        >
                          <TextoEnLinea texto={celda} />
                        </th>
                      ) : (
                        <td
                          key={j}
                          className={cn(
                            "px-3 py-2.5 text-foreground/80",
                            bloque.rellenable && "h-11 border-l border-hairline",
                          )}
                        >
                          <TextoEnLinea texto={celda} />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bloque.nota ? (
            <figcaption className="mt-2 text-xs text-muted-foreground">
              <TextoEnLinea texto={bloque.nota} />
            </figcaption>
          ) : null}
        </figure>
      );
    case "aviso":
      return (
        <div className="mt-6 rounded-xl border border-brand/25 bg-brand-100 p-4 text-sm leading-relaxed text-foreground">
          <TextoEnLinea texto={bloque.texto} />
        </div>
      );
    case "plantilla":
      return (
        <div className="mt-4 rounded-xl border border-hairline bg-card p-4 print:break-inside-avoid">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{bloque.titulo}</p>
            <BotonCopiar texto={bloque.texto} />
          </div>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">
            {bloque.texto}
          </p>
        </div>
      );
  }
}

function fechaLarga(iso: string) {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** Página editorial completa (funciones, país, comparativas, guías, plantillas). */
export function PaginaContenidoView({
  pagina,
  relacionados,
}: {
  pagina: PaginaContenido;
  relacionados: Enlace[];
}) {
  return (
    <PublicPageShell mainClassName="max-w-3xl px-6 py-14 text-foreground sm:py-20">
      <nav aria-label="Ruta" className="text-xs text-muted-foreground print:hidden">
        <Link to="/" className="hover:underline">
          Inicio
        </Link>
        <span aria-hidden="true"> / </span>
        <span>{NOMBRE_COLECCION[pagina.coleccion]}</span>
      </nav>

      <article className="mt-6">
        <p className="kicker">{pagina.kicker}</p>
        <h1 className="mt-3 font-display text-4xl font-normal leading-[1.05] tracking-[-0.01em] text-balance sm:text-5xl">
          {pagina.h1}
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-foreground/85">
          <TextoEnLinea texto={pagina.resumen} />
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          {pagina.autor.nombre}, {pagina.autor.rol.toLowerCase()} · Actualizado el{" "}
          <time dateTime={pagina.actualizado}>{fechaLarga(pagina.actualizado)}</time>
          {pagina.revisor
            ? ` · Revisado por ${pagina.revisor.nombre} (${pagina.revisor.credencial})`
            : null}
        </p>
        {pagina.coleccion === "plantillas" ? <BotonImprimir /> : null}

        {pagina.secciones.map((s) => (
          <section key={s.h2} className="mt-12">
            <h2 className="font-display text-2xl font-normal leading-tight text-balance sm:text-3xl">
              {s.h2}
            </h2>
            {s.bloques.map((b, i) => (
              <RenderBloque key={i} bloque={b} />
            ))}
          </section>
        ))}

        {pagina.faq?.length ? (
          <section className="mt-14" aria-labelledby="faq-titulo">
            <h2
              id="faq-titulo"
              className="font-display text-2xl font-normal leading-tight sm:text-3xl"
            >
              Preguntas frecuentes
            </h2>
            <dl className="mt-4 divide-y divide-hairline border-y border-hairline">
              {pagina.faq.map((f) => (
                <div key={f.q} className="py-4">
                  <dt className="font-semibold">{f.q}</dt>
                  <dd className="mt-2 leading-relaxed text-foreground/80">
                    <TextoEnLinea texto={f.a} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section className="mt-14 rounded-2xl border border-hairline bg-card p-6 sm:p-8 print:hidden">
          <h2 className="font-display text-2xl font-normal">Mira Esmalia por dentro</h2>
          <p className="mt-2 text-foreground/80">
            Entra a una clínica de demostración con datos de ejemplo, o prueba 14 días gratis sin
            tarjeta.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/demo"
              onClick={() => registrarEvento("cta_click", { cta: "demo", lugar: pagina.path })}
              className={buttonVariants({ size: "lg" })}
            >
              Entrar a la demo
            </a>
            <Link to="/precios" className={buttonVariants({ size: "lg", variant: "outline" })}>
              Ver precios
            </Link>
          </div>
        </section>

        {pagina.fuentes?.length ? (
          <section className="mt-12">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Fuentes
            </h2>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {pagina.fuentes.map((f) => (
                <li key={f.url}>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {f.titulo}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {relacionados.length ? (
          <section className="mt-12 print:hidden">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Sigue leyendo
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {relacionados.map((r) => (
                <li key={r.path}>
                  <a
                    href={r.path}
                    className="block h-full rounded-xl border border-hairline p-4 hover:border-brand/40"
                  >
                    <span className="block text-xs text-muted-foreground">
                      {NOMBRE_COLECCION[r.coleccion]}
                    </span>
                    <span className="mt-1 block font-semibold">{r.h1}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </PublicPageShell>
  );
}

/** Índice de una o más colecciones (ej. /funciones, /recursos). */
export function IndiceContenido({
  kicker,
  titulo,
  intro,
  grupos,
  extra,
}: {
  kicker: string;
  titulo: string;
  intro: string;
  grupos: { titulo: string; paginas: Enlace[] }[];
  extra?: ReactNode;
}) {
  return (
    <PublicPageShell mainClassName="max-w-4xl px-6 py-14 text-foreground sm:py-20">
      <p className="kicker">{kicker}</p>
      <h1 className="mt-3 font-display text-4xl font-normal leading-[1.05] text-balance sm:text-5xl">
        {titulo}
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-foreground/80">{intro}</p>
      {grupos
        .filter((g) => g.paginas.length)
        .map((g) => (
          <section key={g.titulo} className="mt-12">
            <h2 className="font-display text-2xl font-normal">{g.titulo}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {g.paginas.map((p) => (
                <li key={p.path}>
                  <a
                    href={p.path}
                    className="block h-full rounded-xl border border-hairline p-4 hover:border-brand/40"
                  >
                    <span className="block font-semibold">{p.h1}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                      {p.enUnaLinea}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {extra}
    </PublicPageShell>
  );
}
