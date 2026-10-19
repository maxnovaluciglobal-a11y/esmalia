import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalH2, LegalP } from "@/components/legal-page";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/nosotros")({
  head: () => {
    const canonical = canonicalHead("/nosotros");
    return {
      meta: [
        { title: "Quiénes somos · Esmalia" },
        {
          name: "description",
          content:
            "Esmalia es un software para clínicas dentales de Latinoamérica que construye su fundador, con soporte directo. Por qué existe y cómo se hace.",
        },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: Nosotros,
});

function Nosotros() {
  return (
    <LegalPage label="Empresa" title="Quiénes somos">
      <div className="flex items-start gap-4 rounded-xl border border-hairline bg-card p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-foreground font-display text-lg font-bold text-background">
          W
        </span>
        <div>
          <p className="text-base leading-relaxed text-foreground">
            "Soy Walter. Hice Esmalia porque vi clínicas ahogadas en planillas y recordatorios a
            mano. Está pensado para cómo se trabaja en LatAm. Si lo pruebas y algo te traba,
            escríbeme — te respondo yo."
          </p>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Walter La Madriz · fundador de Esmalia
          </p>
        </div>
      </div>

      <LegalH2>Por qué Esmalia</LegalH2>
      <LegalP>
        Esmalia nació de ver de cerca cómo se administra una clínica dental chica o mediana en
        Latinoamérica: agenda en WhatsApp o en papel, fichas clínicas en Excel o en carpetas,
        recordatorios de cita que dependen de que alguien se acuerde de mandarlos a mano. El
        software que existe para esto suele estar hecho para otro mercado, en otro idioma, con otro
        precio.
      </LegalP>
      <LegalP>
        La apuesta de Esmalia es simple: agenda, ficha clínica, odontograma, presupuestos y cobranza
        en un solo lugar, con WhatsApp integrado de forma nativa — no como un agregado. Menos
        planillas, menos pacientes que se pierden entre un sistema y otro.
      </LegalP>

      <LegalH2>Cómo se hace</LegalH2>
      <LegalP>
        Esmalia lo construye su fundador, con soporte directo: si escribes, te responde quien hace
        el producto. No hay una empresa grande detrás. Eso significa que las decisiones se toman
        rápido y el producto mejora seguido, pero también que el equipo es chico. Preferimos ser
        honestos con esto antes que prometer una estructura que todavía no existe.
      </LegalP>
      <LegalP>
        Cualquier clínica puede usar Esmalia hoy: lo pruebas 14 días gratis, sin tarjeta, y si te
        sirve te suscribes desde la página de precios. Lo que todavía no hace está dicho en cada
        página de funciones, para que lo sepas antes de pagar.
      </LegalP>

      <LegalH2>La empresa detrás</LegalH2>
      <LegalP>
        Esmalia es operado por MAXNOVA &amp; LUCI Global LLC, una LLC constituida en Estados Unidos.
        Más detalles de cómo tratamos los datos de tu clínica y tus pacientes están en la{" "}
        <a href="/privacidad" className="text-brand-700 underline underline-offset-2">
          Política de Privacidad
        </a>
        .
      </LegalP>

      <LegalH2>Contacto</LegalH2>
      <LegalP>
        Para consultas o soporte:{" "}
        <a href="mailto:hola@esmalia.com" className="text-brand-700 underline underline-offset-2">
          hola@esmalia.com
        </a>
        .
      </LegalP>
    </LegalPage>
  );
}
