import { createFileRoute } from "@tanstack/react-router";
import { LegalH2, LegalLi, LegalNotice, LegalP, LegalUl } from "@/components/legal-page";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/docs/suscripcion-y-prueba")({
  head: () => {
    const canonical = canonicalHead("/docs/suscripcion-y-prueba");
    return {
      meta: [
        { title: "Prueba gratis, suscripción y pagos · Documentación · Esmalia" },
        {
          name: "description",
          content:
            "Cómo funciona la prueba gratis de 14 días de Esmalia, cómo te suscribes y cancelas, y qué pasa con tu clínica si un pago falla o la prueba termina sin suscripción.",
        },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: SuscripcionYPrueba,
});

function SuscripcionYPrueba() {
  return (
    <article>
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Documentación</p>
      <h1 className="font-display mt-2 text-3xl font-bold tracking-tight">
        Prueba gratis, suscripción y pagos
      </h1>

      <LegalH2>La prueba gratis</LegalH2>
      <LegalP>
        Al crear tu clínica tienes 14 días de prueba, sin dejar tarjeta. Puedes ver cuántos días te
        quedan en el aviso de arriba de la aplicación. Tres funciones (el WhatsApp de la clínica, el
        portal del paciente y la página de efectividad) se activan en una llamada de puesta en
        marcha, o al suscribirte.
      </LegalP>

      <LegalH2>Cómo te suscribes</LegalH2>
      <LegalP>
        Entra a Suscripción, elige el plan (Solo, para 1 profesional, o Clínica, hasta 3) y sigue el
        pago con Stripe. El cobro es mensual y en dólares (USD). Si te suscribes antes de que
        termine la prueba, no se te cobra hasta que termine la prueba.
      </LegalP>

      <LegalH2>Cómo cancelas o cambias la tarjeta</LegalH2>
      <LegalP>
        Desde Suscripción entras al portal de pagos de Stripe: ahí cancelas, cambias la tarjeta o el
        plan y descargas tus facturas. Si cancelas, la suscripción sigue activa hasta el fin del
        período que ya pagaste.
      </LegalP>

      <LegalH2>Si la prueba termina y no te suscribes</LegalH2>
      <LegalP>
        Tu clínica no se cierra ni pierdes datos. La agenda, los pacientes y las fichas clínicas
        siguen abiertos. Lo que se pausa son los informes (finanzas, comisiones, inventario y los
        demás reportes) hasta que te suscribas.
      </LegalP>

      <LegalH2>Si un pago falla</LegalH2>
      <LegalUl>
        <LegalLi>
          Durante 7 días todo sigue funcionando igual, y verás un aviso con los días que quedan.
          Stripe reintenta el cobro, y la mayoría de los pagos fallidos se resuelven solos o
          actualizando la tarjeta en Suscripción.
        </LegalLi>
        <LegalLi>
          Si pasan esos 7 días sin regularizar el pago, la clínica pasa a modo solo lectura: puedes
          ver y exportar todo, pero no crear ni editar. La excepción es la nota clínica de una cita
          en curso, que siempre se puede registrar.
        </LegalLi>
        <LegalLi>
          Al regularizar el pago desde Suscripción, vuelves a poder crear y editar con normalidad.
        </LegalLi>
      </LegalUl>
      <LegalNotice>
        Tu historia clínica es tuya: en ningún caso se bloquea el acceso a ella ni su exportación
        por un pago pendiente. Ver la guía de exportación en esta misma documentación.
      </LegalNotice>
    </article>
  );
}
