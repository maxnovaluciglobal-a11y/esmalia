// Precios de la landing A+. Decisión de Walter (19-oct-2026): los planes se
// diferencian SOLO por la cantidad de profesionales (Solo: 1; Clínica: hasta
// 3). La landing no promete funciones exclusivas por plan: lo que incluye se
// muestra una sola vez, para los dos.
//
// Montos: los dos tiers de Stripe (src/lib/stripe.server.ts), Solo US$19,99 y
// Clínica US$49,99, con 14 días de prueba sin tarjeta. El cobro es en USD.
import { Link } from "@tanstack/react-router";

import { enlaceWhatsAppVentas } from "@/lib/marketing/contacto";
import { registrarEvento } from "@/lib/marketing/eventos";
import { etiquetaUsd, PRECIO_CLINICA_CENTS, PRECIO_SOLO_CENTS } from "@/lib/marketing/precio-lista";
import { setPlanIntent, type PlanIntent } from "@/lib/marketing/plan-intent";
import { cn } from "@/lib/utils";

const PLANES: readonly {
  id: PlanIntent;
  nombre: string;
  profesionales: string;
  para: string;
  usd: number;
  oscuro?: boolean;
}[] = [
  {
    id: "solo",
    nombre: "Solo",
    profesionales: "1 profesional",
    para: "Para el dentista que atiende por su cuenta.",
    usd: PRECIO_SOLO_CENTS / 100,
  },
  {
    id: "clinica",
    nombre: "Clínica",
    profesionales: "Hasta 3 profesionales",
    para: "Para equipos chicos que comparten agenda y caja.",
    usd: PRECIO_CLINICA_CENTS / 100,
    oscuro: true,
  },
];

const INCLUYE = [
  "Agenda por profesional y por sucursal",
  "Ficha clínica, odontograma y periodontograma",
  "Presupuestos que pasan a plan de tratamiento",
  "Recordatorios por WhatsApp con un toque",
  "Caja diaria con arqueo y comisiones",
  "Portal del paciente",
  "Importación CSV y exportación completa",
  "Espacio para radiografías, fotos y escaneos: 15 GB en Solo y 45 GB en Clínica",
  "Funciona sin internet y sincroniza al volver",
] as const;

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function PreciosV2() {
  const whatsapp = enlaceWhatsAppVentas();
  return (
    <section className="lv-price" id="precios" aria-labelledby="lv-pr-h">
      <div className="lv-wrap">
        <div className="lv-sec-head">
          <h2 className="lv-h-sec" id="lv-pr-h">
            Dos planes. <em>Sin letra chica.</em>
          </h2>
          <p className="lv-lead">
            Cambia solo cuántos profesionales atienden. Se cobra en dólares por Stripe y se cancela
            cuando quieras.
          </p>
        </div>
        <div className="lv-p-grid">
          {PLANES.map((p) => (
            <article key={p.id} className={cn("lv-plan", p.oscuro && "night lv-on-night")}>
              <h3 className="nm">{p.nombre}</h3>
              <p className="who">{p.para}</p>
              <p className="pr">
                <b>{etiquetaUsd(Math.round(p.usd * 100))}</b>
                <span>/ mes</span>
              </p>
              <p className="pros">{p.profesionales}</p>
              <Link
                to="/auth"
                search={{ signup: true }}
                onClick={() => {
                  setPlanIntent(p.id);
                  registrarEvento("cta_click", { cta: `plan-${p.id}`, lugar: "v2-precios" });
                }}
                className={cn("lv-btn", p.oscuro ? "lv-btn-ocre" : "lv-btn-line")}
              >
                Probar {p.nombre} 14 días
                {p.oscuro && (
                  <span className="lv-arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </Link>
            </article>
          ))}
        </div>
        <div className="lv-p-incl">
          <h3>
            Los dos planes <em>traen todo.</em>
          </h3>
          <ul>
            {INCLUYE.map((i) => (
              <li key={i}>
                <Check />
                {i}
              </li>
            ))}
          </ul>
        </div>
        <div className="lv-p-note">
          <h3>¿Más de 3 profesionales o varias sedes?</h3>
          <p>
            El plan Red se arma a medida.{" "}
            <a
              href={whatsapp.href}
              onClick={() => registrarEvento("cta_click", { cta: "red", lugar: "v2-precios" })}
              className="underline underline-offset-4"
              {...(whatsapp.esWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {whatsapp.esWhatsApp ? "Escríbenos por WhatsApp" : "Escríbenos"}
            </a>
            . 14 días gratis y sin tarjeta en cualquier plan; el precio en moneda local que veas en
            otras páginas es solo una referencia.
          </p>
        </div>
      </div>
    </section>
  );
}
