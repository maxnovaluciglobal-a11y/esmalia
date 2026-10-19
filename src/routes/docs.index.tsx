import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, FileUp, MessageCircle, Shield, Sparkles } from "lucide-react";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/docs/")({
  head: () => canonicalHead("/docs"),
  component: DocsIndex,
});

const cards = [
  {
    to: "/docs/primeros-pasos" as const,
    icon: Sparkles,
    title: "Primeros pasos",
    text: "Cómo dar de alta tu clínica, cargar pacientes y agendar tu primera cita.",
  },
  {
    to: "/docs/migrar-desde-otro-sistema" as const,
    icon: FileUp,
    title: "Migrar desde otro sistema",
    text: "Plantillas CSV para traer tus pacientes y citas, qué se importa y cómo correr los dos sistemas en paralelo.",
  },
  {
    to: "/docs/whatsapp" as const,
    icon: MessageCircle,
    title: "Conectar WhatsApp",
    text: "Diferencia entre el modo manual (wa.me) y conectar el número real de tu clínica.",
  },
  {
    to: "/docs/portal-pacientes" as const,
    icon: CalendarDays,
    title: "Portal de pacientes",
    text: "Cómo tus pacientes piden citas solos, sin crear una cuenta.",
  },
  {
    to: "/docs/datos-y-seguridad" as const,
    icon: Shield,
    title: "Datos y seguridad",
    text: "Dónde vive la información de tu clínica y cómo está aislada de otras clínicas.",
  },
];

function DocsIndex() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">Documentación</h1>
      <p className="mt-3 max-w-lg text-base leading-relaxed text-muted-foreground">
        Guías cortas para sacarle jugo a Esmalia. Si buscas algo más puntual, el{" "}
        <Link to="/faq" className="text-brand-700 underline underline-offset-2">
          FAQ
        </Link>{" "}
        capaz lo responde más rápido.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="rounded-xl border border-hairline bg-card p-5 transition-colors hover:border-brand/40 hover:bg-brand-100/40"
          >
            <c.icon className="size-5 text-brand-700" />
            <p className="font-display mt-3 text-base font-bold">{c.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
