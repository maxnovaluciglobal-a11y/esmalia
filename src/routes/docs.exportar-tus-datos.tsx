import { createFileRoute } from "@tanstack/react-router";
import { LegalH2, LegalLi, LegalNotice, LegalP, LegalUl } from "@/components/legal-page";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/docs/exportar-tus-datos")({
  head: () => {
    const canonical = canonicalHead("/docs/exportar-tus-datos");
    return {
      meta: [
        { title: "Exportar los datos de tu clínica · Documentación · Esmalia" },
        {
          name: "description",
          content:
            "Cómo sacar de Esmalia todos los datos de tu clínica en un archivo ZIP con planillas CSV, y cómo entregarle a un paciente la copia de su ficha.",
        },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: ExportarTusDatos,
});

function ExportarTusDatos() {
  return (
    <article>
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Documentación</p>
      <h1 className="font-display mt-2 text-3xl font-bold tracking-tight">
        Exportar los datos de tu clínica
      </h1>
      <LegalP>
        Los datos de tu clínica son tuyos y puedes sacarlos cuando quieras, sin avisarnos y sin
        costo. Hay dos formas: todos los datos de la clínica, o la ficha de un solo paciente.
      </LegalP>

      <LegalH2>Todos los datos de la clínica</LegalH2>
      <LegalP>
        Entra a Ajustes, sección "Tus datos", y pulsa "Exportar todos los datos". Lo pueden hacer el
        dueño y los administradores. Se descarga un archivo ZIP con una planilla CSV por tema, que
        puedes abrir en Excel o en Google Sheets:
      </LegalP>
      <LegalUl>
        <LegalLi>Pacientes, con su anamnesis, signos vitales y tutores.</LegalLi>
        <LegalLi>Citas, sucursales y profesionales.</LegalLi>
        <LegalLi>Notas clínicas con todas sus versiones, odontograma y periodontograma.</LegalLi>
        <LegalLi>Presupuestos, planes de tratamiento, pagos y cajas.</LegalLi>
        <LegalLi>Consentimientos firmados, recetas, documentos y laboratorios.</LegalLi>
      </LegalUl>
      <LegalP>
        El ZIP trae además un archivo LEEME que explica cada planilla y cómo se cruzan entre sí. Los
        archivos grandes (radiografías, fotos, firmas) se incluyen hasta un tope de tamaño; si
        alguno no cabe, el LEEME explica cómo pedírnoslo.
      </LegalP>

      <LegalH2>La ficha de un solo paciente</LegalH2>
      <LegalP>
        Si un paciente te pide copia de su historia, abre su ficha y pulsa "Exportar ficha". Lo
        pueden hacer el dueño, los administradores y los dentistas. Obtienes un ZIP con la ficha en
        PDF y sus datos en CSV, listo para entregárselo.
      </LegalP>

      <LegalH2>Qué queda registrado</LegalH2>
      <LegalP>
        Cada exportación queda registrada (quién la hizo y cuándo), porque son datos de salud.
      </LegalP>

      <LegalNotice>
        Exportar siempre está disponible, también si tu suscripción tiene un pago pendiente.
      </LegalNotice>
    </article>
  );
}
