import { Link } from "@tanstack/react-router";

import { EsmaliaLogo } from "@/components/esmalia-logo";
import { registrarEvento } from "@/lib/marketing/eventos";

import { PausarMovimiento } from "./pausar-movimiento";

export type EnlaceSeccion = { label: string; href: `#${string}` };

/** Encabezado de la landing A+: anclas a las secciones de la misma página. */
export function EncabezadoV2({ secciones }: { secciones: readonly EnlaceSeccion[] }) {
  return (
    <div className="lv-wrap">
      <header className="lv-site">
        <Link to="/" aria-label="Esmalia, inicio" className="flex items-center py-1">
          <EsmaliaLogo size={30} />
        </Link>
        <nav aria-label="Secciones">
          {secciones.map((s) => (
            <a key={s.href} href={s.href}>
              {s.label}
            </a>
          ))}
        </nav>
        <div className="lv-sp">
          <PausarMovimiento />
          <Link to="/auth" className="lv-ingresar">
            Ingresar
          </Link>
          <Link
            to="/auth"
            search={{ signup: true }}
            onClick={() => registrarEvento("cta_click", { cta: "signup", lugar: "v2-nav" })}
            className="lv-btn lv-btn-ink lv-btn-sm"
          >
            Probar 14 días
          </Link>
        </div>
      </header>
    </div>
  );
}
