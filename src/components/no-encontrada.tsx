import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { ACCESS_QUERY_KEY, type ClinicAccess } from "@/lib/access/access";
import { getMyAccess } from "@/lib/access/access.functions";

/** Cuerpo del 404 dentro de la app: qué pasó y la salida a Hoy. */
export function CuerpoNoEncontrada() {
  // El título de la pestaña: la URL no existe, así que ninguna ruta lo pone.
  useEffect(() => {
    document.title = "Página no encontrada | Esmalia";
  }, []);
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <p className="kicker">Error 404</p>
      <h2 className="mt-2 font-display text-3xl font-semibold">No encontramos esta página</h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Puede que el enlace esté mal escrito, que la página se haya movido o que la ficha ya no
        exista.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to="/dashboard" className={buttonVariants()}>
          Ir a Hoy
        </Link>
        <Link to="/ajustes" className={buttonVariants({ variant: "outline" })}>
          Ver Ajustes
        </Link>
      </div>
    </div>
  );
}

/** 404 dentro del shell, cuando se conoce el acceso (ruta de la clínica). */
export function NoEncontradaEnShell({ access }: { access: ClinicAccess }) {
  return (
    <AppShell title="Página no encontrada" access={access}>
      <CuerpoNoEncontrada />
    </AppShell>
  );
}

/**
 * 404 de una URL que no existe, para quien tiene sesión (UX: antes caía en
 * la página pública, sin menú ni forma de volver). Pide el acceso igual que
 * el layout de la clínica (misma clave de caché); mientras carga, o si la
 * cuenta todavía no tiene clínica, muestra el cuerpo solo, con su "Ir a Hoy".
 * Se carga diferido desde `__root.tsx` para no sumarle la app a la landing.
 */
export default function NoEncontradaConSesion() {
  const { data: access } = useQuery({
    queryKey: ACCESS_QUERY_KEY,
    queryFn: () => getMyAccess({}),
    staleTime: 5 * 60 * 1000,
  });
  if (access?.clinic && access.role) return <NoEncontradaEnShell access={access} />;
  return (
    <main id="main-content" className="flex min-h-dvh items-center bg-background px-4">
      <CuerpoNoEncontrada />
    </main>
  );
}
