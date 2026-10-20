// src/components/marketing/franja-seguridad.tsx
//
// Franja "Los datos de tus pacientes, protegidos" de la portada (extraída de
// routes/index.tsx el 19-oct-2026 para reusarla en la landing A+ de /v2).
// Solo dice lo que el producto hace hoy: ver el comentario al inicio de
// routes/index.tsx.
import { Link } from "@tanstack/react-router";
import { ArrowRight, DatabaseBackup, Lock, ShieldCheck, Users } from "lucide-react";

import { cn } from "@/lib/utils";

// ── Seguridad de datos ──────────────────────────────────────────────

const garantias = [
  {
    icono: ShieldCheck,
    titulo: "Cada clínica, aislada",
    texto:
      "La base de datos verifica que perteneces a la clínica antes de devolver una sola fila (row-level security), no solo la pantalla.",
  },
  {
    icono: Users,
    titulo: "Cada rol ve lo suyo",
    texto: "Recepción ve agenda y contactos, pero no la historia clínica ni los pagos.",
  },
  {
    icono: DatabaseBackup,
    titulo: "Respaldo todos los días",
    texto: "Una copia diaria cifrada de tus datos, guardada fuera de la plataforma principal.",
  },
  {
    icono: Lock,
    titulo: "Cifrado en tránsito",
    texto: "Todo viaja por HTTPS. Los servidores están en São Paulo, Brasil.",
  },
] as const;

export function FranjaSeguridad({ className }: { className?: string } = {}) {
  return (
    <section
      aria-labelledby="seguridad-titulo"
      className={cn("mx-auto max-w-6xl px-6 py-14", className)}
    >
      <div className="border-y border-border py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2
            id="seguridad-titulo"
            className="max-w-xl font-display text-3xl font-normal leading-tight sm:text-4xl"
          >
            Los datos de tus pacientes, protegidos.
          </h2>
          <Link
            to="/docs/datos-y-seguridad"
            className="inline-flex items-center gap-1.5 text-sm text-brand-700 underline-offset-4 hover:underline"
          >
            Cómo protegemos tus datos
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {garantias.map((g) => (
            <li key={g.titulo} className="min-w-0">
              <g.icono className="size-5 text-brand-700" aria-hidden />
              <h3 className="mt-3 font-medium">{g.titulo}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{g.texto}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
