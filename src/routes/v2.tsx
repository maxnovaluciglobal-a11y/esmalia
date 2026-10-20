// src/routes/v2.tsx
//
// La landing A+ se armó en /v2 y el PR 8 (20-oct-2026) la pasó a "/".
// Redirección permanente 308: vercel.json la resuelve antes de llegar a la
// app; esta ruta cubre la navegación del lado del cliente.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/v2")({
  beforeLoad: () => {
    throw redirect({ to: "/", statusCode: 308 });
  },
});
