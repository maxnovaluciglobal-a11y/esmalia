// Landing A+ (dirección aprobada por Walter el 19-oct-2026). Fuente de diseño:
// 04 - Marca y Diseno/exploracion-2026-10-19/a-plus-final/home.html.
//
// Reglas de veracidad (las mismas de routes/index.tsx):
// - Todos los datos de agenda, pacientes y montos son de ejemplo y lo dicen.
// - Ningún recordatorio sale solo: lo envía alguien de la clínica con un toque.
// - WhatsApp oficial y Patty están en habilitación.
// - Los planes se diferencian solo por cuántos profesionales atienden.
// - No hay testimonios inventados.
import { CalculadoraFugas } from "@/components/marketing/calculadora-fugas";
import { FranjaSeguridad } from "@/components/marketing/franja-seguridad";
import { SiteFooter } from "@/components/site-chrome";
import { useMovimiento } from "@/hooks/use-movimiento";

import { Cifras } from "./cifras";
import { CtaFinal } from "./cta-final";
import { EncabezadoV2, type EnlaceSeccion } from "./encabezado";
import { HeroDia } from "./hero-dia";
import { Marquee } from "./marquee";
import { PreciosV2 } from "./precios-v2";
import { TimelinePrueba } from "./timeline-prueba";

const SECCIONES: readonly EnlaceSeccion[] = [
  { label: "Cifras", href: "#cifras" },
  { label: "Calculadora", href: "#calculadora" },
  { label: "Cómo funciona", href: "#como" },
  { label: "Precios", href: "#precios" },
];

const CONDICIONES = [
  "caries",
  "obturación",
  "endodoncia",
  "corona",
  "implante",
  "sellante",
  "fractura",
  "extracción indicada",
  "prótesis fija",
  "pieza ausente",
  "lesión cervical",
  "restauración desadaptada",
] as const;

export function LandingV2() {
  const { animar } = useMovimiento();

  return (
    <div className="lv2" data-mov={animar ? "on" : "off"}>
      <EncabezadoV2 secciones={SECCIONES} />
      <main id="main-content">
        <HeroDia />
        <Marquee palabras={CONDICIONES} direccion={1.1} className="lv-band" />
        <div id="cifras" className="scroll-mt-4">
          <Cifras />
        </div>
        <section id="calculadora" className="lv-calc scroll-mt-4" aria-label="Calculadora de fugas">
          <div className="lv-wrap">
            <CalculadoraFugas />
          </div>
        </section>
        <TimelinePrueba />
        <FranjaSeguridad className="max-w-none w-[min(1320px,100%-48px)] px-0 max-[720px]:w-[calc(100%-32px)]" />
        <PreciosV2 />
        <CtaFinal />
      </main>
      <SiteFooter />
    </div>
  );
}
