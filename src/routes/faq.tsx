import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { canonicalHead, faqJsonLdScript } from "@/lib/seo";

const grupos: { t: string; items: { q: string; a: string }[] }[] = [
  {
    t: "General",
    items: [
      {
        q: "¿Qué es Esmalia?",
        a: "Un software de gestión para clínicas dentales: agenda, ficha clínica, odontograma, presupuestos, cobranza y WhatsApp integrado, todo en un solo lugar.",
      },
      {
        q: "¿Para qué tamaño de clínica está pensado?",
        a: "Para clínicas chicas y medianas de Latinoamérica — desde un dentista solo hasta un equipo de varios profesionales y varias sucursales.",
      },
      {
        q: "¿Necesito instalar algo?",
        a: 'No hace falta: Esmalia funciona desde el navegador en computadora o celular. Si quieres, puedes instalarla desde el mismo navegador ("Instalar aplicación") y queda con su ícono como una app más, sin pasar por ninguna tienda.',
      },
      {
        q: "¿Qué pasa si se corta internet en la clínica?",
        a: "Sigues atendiendo. Puedes consultar la agenda y las fichas, cobrar, agendar citas, editar notas clínicas y marcar el odontograma: lo que registres queda guardado en el equipo y se sincroniza solo cuando vuelve internet, sin que nadie tenga que apretar nada. La app te muestra cuántas operaciones faltan subir. Lo que sí necesita conexión es mandar mensajes de WhatsApp y crear presupuestos, y la app lo avisa en el momento en vez de fallar en silencio.",
      },
      {
        q: "Si cobro sin internet, ¿puede duplicarse el pago al sincronizar?",
        a: "No. Cada operación lleva un identificador propio generado en el equipo, así que si la sincronización se reintenta el servidor reconoce que ya la había guardado y no la registra de nuevo. Además el cobro queda con la hora en que lo hiciste, no con la hora en que se sincronizó, para que el cierre de caja del día cuadre.",
      },
      {
        q: "¿Y si dos personas editan la misma nota o marcan la misma pieza dental mientras una está sin internet?",
        a: "No se pierde nada, pero tampoco se pisan en silencio. Si al sincronizar el sistema ve que alguien más ya cambió lo mismo, deja ambas versiones a la vista en una bandeja de conflictos para que el profesional elija cuál vale.",
      },
    ],
  },
  {
    t: "Empezar",
    items: [
      {
        q: "¿Cómo empiezo?",
        a: 'Puedes entrar a la demo desde el botón "Ver demo": solo te pedimos nombre y email, sin tarjeta ni contraseña. O crea tu clínica gratis en unos minutos con "Empieza gratis".',
      },
      {
        q: "¿Puedo importar los pacientes que ya tengo?",
        a: "Sí, hay un importador de pacientes y citas por CSV para no tener que cargar todo a mano.",
      },
      {
        q: "¿Cuánto tarda el onboarding?",
        a: "El alta de una clínica nueva es un flujo guiado de 4 pasos: clínica, sucursal y boxes, especialidades y equipo. Después de eso ya puedes cargar pacientes y agendar.",
      },
    ],
  },
  {
    t: "WhatsApp",
    items: [
      {
        q: "¿Cómo funcionan los recordatorios por WhatsApp?",
        a: "Esmalia arma la cola de recordatorios (48h y 3h antes de la cita) y tu equipo los despacha con un clic desde /recordatorios. Nunca se manda un mensaje sin que alguien de tu clínica lo dispare.",
      },
      {
        q: "¿Tengo que conectar mi número de WhatsApp?",
        a: "No es obligatorio. Sin conectar nada, Esmalia arma el link de wa.me y tú lo abres manualmente. Si conectas tu número (Meta Cloud API), el envío se puede automatizar más — igual siempre queda a criterio de tu equipo cuándo despachar.",
      },
      {
        q: "¿Qué pasa si alguien que no es mi paciente me escribe por WhatsApp?",
        a: "Queda guardado como lead nuevo, sin perderse en el chat, para que tu equipo lo revise y lo convierta en paciente si corresponde.",
      },
    ],
  },
  {
    t: "Pacientes y datos",
    items: [
      {
        q: "¿Mis pacientes pueden agendar una cita solos?",
        a: "Sí, por un link de portal que tu clínica les comparte — sin que necesiten crear una cuenta.",
      },
      {
        q: "¿Dónde se guardan mis datos?",
        a: "En Supabase, en la región de São Paulo, Brasil. El detalle completo está en la Política de Privacidad.",
      },
      {
        q: "¿Otras clínicas pueden ver mis datos?",
        a: "No. Cada clínica tiene sus datos aislados a nivel de base de datos (row-level security), no solo a nivel de interfaz.",
      },
      {
        q: "Si me quiero ir, ¿puedo llevarme mis datos?",
        a: "Sí. Quien administra la clínica puede exportar todos sus datos desde Ajustes en cualquier momento, también antes de cerrar la cuenta. Si lo prefieres, escríbenos a soporte@esmalia.com y te los enviamos.",
      },
    ],
  },
  {
    t: "Precio",
    items: [
      {
        q: "¿Cuánto cuesta Esmalia?",
        a: "Desde US$29/mes (Solo, 1 profesional) o US$69/mes (Clínica, hasta 3) — sin cobro por sucursal. Las clínicas fundadoras pagan la mitad del precio de su plan durante 12 meses; después, el precio de lista. Prueba gratis de 14 días sin tarjeta.",
      },
    ],
  },
];

export const Route = createFileRoute("/faq")({
  head: () => {
    const canonical = canonicalHead("/faq");
    return {
      meta: [
        { title: "Preguntas frecuentes · Esmalia" },
        {
          name: "description",
          content:
            "Respuestas sobre cómo funciona Esmalia: empezar, WhatsApp, portal de pacientes, tus datos y precio.",
        },
        { property: "og:title", content: "Preguntas frecuentes · Esmalia" },
        {
          property: "og:description",
          content:
            "Respuestas sobre cómo funciona Esmalia: empezar, WhatsApp, portal de pacientes, tus datos y precio.",
        },
        { property: "og:type", content: "website" },
        ...canonical.meta,
      ],
      links: canonical.links,
      scripts: faqJsonLdScript(grupos.flatMap((g) => g.items)),
    };
  },
  component: Faq,
});

function Faq() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-2xl px-6 py-16 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Recursos</p>
        <h1 className="font-display mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Preguntas frecuentes
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          ¿No encuentras lo que buscas? Escríbenos a{" "}
          <a href="mailto:hola@esmalia.com" className="text-brand-700 underline underline-offset-2">
            hola@esmalia.com
          </a>
          .
        </p>

        <div className="mt-10 space-y-10">
          {grupos.map((g) => (
            <section key={g.t}>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
                {g.t}
              </h2>
              <Accordion type="single" collapsible className="mt-3">
                {g.items.map((item) => (
                  <AccordionItem key={item.q} value={item.q} className="border-hairline">
                    <AccordionTrigger className="text-left font-semibold hover:no-underline">
                      {item.q}
                    </AccordionTrigger>
                    {/* forceMount: la respuesta queda en el HTML del SSR aunque esté
                        cerrada (Radix la oculta con el atributo hidden). Sin
                        esto, Google y los crawlers de LLM ven solo preguntas. */}
                    <AccordionContent forceMount className="text-muted-foreground">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>

        <p className="mt-12 text-sm text-muted-foreground">
          ¿Quieres más detalle técnico? Mira la{" "}
          <Link to="/docs" className="text-brand-700 underline underline-offset-2">
            documentación
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
