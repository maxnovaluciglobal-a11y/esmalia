import { createFileRoute } from "@tanstack/react-router";
import { LegalH2, LegalP, LegalUl, LegalLi } from "@/components/legal-page";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/docs/primeros-pasos")({
  head: () => {
    const canonical = canonicalHead("/docs/primeros-pasos");
    return {
      meta: [
        { title: "Primeros pasos · Documentación · Esmalia" },
        {
          name: "description",
          content:
            "Crea tu clínica en Esmalia, carga tus pacientes, suma a tu equipo y agenda tu primera cita. Guía paso a paso, sin tarjeta para empezar.",
        },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: PrimerosPasos,
});

function PrimerosPasos() {
  return (
    <article>
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Documentación</p>
      <h1 className="font-display mt-2 text-3xl font-bold tracking-tight">Primeros pasos</h1>

      <LegalH2>1. Crea tu clínica</LegalH2>
      <LegalP>
        Desde "Empieza gratis" el onboarding te pide los datos básicos de tu clínica en 4 pasos: la
        clínica (con su país, que fija moneda y zona horaria), la sucursal y sus boxes, las
        especialidades y tu equipo. No hace falta tarjeta para arrancar.
      </LegalP>

      <LegalH2>2. Carga tus pacientes</LegalH2>
      <LegalP>
        Puedes cargar pacientes uno por uno desde la ficha, o importar tu base actual con el
        importador CSV (pacientes y citas) si venías de otro sistema o de una planilla.
      </LegalP>

      <LegalH2>3. Agrega a tu equipo</LegalH2>
      <LegalP>
        Invita al resto del personal y asígnale un rol: administrador, dentista, asistente o
        recepción. El rol define qué puede ver cada persona — por ejemplo, recepción no ve notas
        clínicas.
      </LegalP>

      <LegalH2>4. Agenda tu primera cita</LegalH2>
      <LegalP>
        Desde la agenda, elige paciente, profesional y horario. Cuando la cita esté cerca, su
        recordatorio va a aparecer en la cola de WhatsApp para que tu equipo lo despache — no hace
        falta configurar nada más para eso.
      </LegalP>

      <LegalH2>5. Suma lo demás cuando lo necesites</LegalH2>
      <LegalP>
        El odontograma, los presupuestos, el plan de tratamiento y los pagos viven en la ficha de
        cada paciente. No es necesario configurarlos por adelantado — se usan a medida que atiendes.
      </LegalP>
      <LegalUl>
        <LegalLi>
          Para conectar el número real de WhatsApp de tu clínica, ver "Conectar WhatsApp".
        </LegalLi>
        <LegalLi>Para que tus pacientes pidan citas solos, ver "Portal de pacientes".</LegalLi>
      </LegalUl>
    </article>
  );
}
