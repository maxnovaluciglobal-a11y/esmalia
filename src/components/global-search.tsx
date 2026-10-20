import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, CornerDownLeft, LockOpen, Search, UserRound } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { hasPermission, type ClinicAccess } from "@/lib/access/access";
import { ajustesVisibles, destinosVisibles } from "@/lib/access/navegacion";
import { buscarPacientes } from "@/lib/patients/buscar-pacientes.functions";
import { accionesRapidas } from "@/lib/shell-v2";
import { cn } from "@/lib/utils";
import { useSoloLectura } from "@/hooks/use-solo-lectura";

/**
 * Búsqueda ⌘K. Reemplaza a la versión deshabilitada que leía los arrays MOCK
 * del prototipo (auditoría architecture-3): ahora solo hay dos fuentes, las
 * dos reales — las páginas que el rol puede abrir y los pacientes de la
 * clínica activa (`buscarPacientes`, con su propio chequeo de permiso).
 */
export function GlobalSearch({
  access,
  atajo = false,
  shellV2 = false,
  enBarraSuperior = false,
}: {
  access: ClinicAccess;
  /** Shell A+: disparador en pastilla con el atajo siempre visible y grupo
   *  "Acciones" (Nueva cita, Abrir caja). Con el flag apagado, como antes. */
  shellV2?: boolean;
  /** Instancia de la barra superior (tablet y celular). */
  enBarraSuperior?: boolean;
  /** Solo UNA instancia escucha ⌘K: el shell monta el buscador dos veces
   *  (sidebar y header de tablet/celular) y, si las dos escuchaban, se abrían
   *  dos diálogos superpuestos. */
  atajo?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [qDiferida, setQDiferida] = useState("");
  const navigate = useNavigate();
  // El atajo se muestra según la plataforma. Arranca en "Ctrl K" (la mayoría
  // de las clínicas usa Windows) y se corrige en el cliente: leerlo durante el
  // render rompería la hidratación, porque en SSR no hay navigator.
  const [esMac, setEsMac] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const plataforma = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
    setEsMac(/mac|iphone|ipad|ipod/i.test(plataforma));
  }, []);

  useEffect(() => {
    if (!atajo) return;
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setAbierto((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atajo]);

  useEffect(() => {
    const t = window.setTimeout(() => setQDiferida(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);

  const paginas = useMemo(() => {
    const desdeDestinos = destinosVisibles(access.role).flatMap((d) =>
      d.pestanas.map((p) => ({
        to: p.to,
        label: p.label === d.label ? d.label : `${d.label} · ${p.label}`,
      })),
    );
    const desdeAjustes = ajustesVisibles(access.role).flatMap((g) =>
      g.items.map((i) => ({ to: i.to, label: `Ajustes · ${i.label}` })),
    );
    const vistas = new Set<string>();
    return [...desdeDestinos, ...desdeAjustes].filter((p) =>
      vistas.has(p.to) ? false : (vistas.add(p.to), true),
    );
  }, [access.role]);

  const termino = q.trim().toLowerCase();
  const paginasFiltradas = termino
    ? paginas.filter((p) => p.label.toLowerCase().includes(termino))
    : paginas.slice(0, 8);
  // En solo lectura las acciones crean algo: no se ofrecen (el servidor
  // igual las rechazaría).
  const soloLectura = useSoloLectura();
  const acciones = shellV2 && !soloLectura ? accionesRapidas(access.role, q) : [];

  const clinicId = access.clinic?.id;
  const puedeBuscarPacientes = hasPermission(access.role, "patients:view") && Boolean(clinicId);
  const buscar = useServerFn(buscarPacientes);
  const { data: pacientes = [], isFetching } = useQuery({
    queryKey: ["buscar-pacientes", clinicId, qDiferida],
    enabled: abierto && puedeBuscarPacientes && qDiferida.length >= 2,
    queryFn: () => buscar({ data: { clinicId: clinicId!, q: qDiferida } }),
    staleTime: 30_000,
  });

  function ir(to: string) {
    setAbierto(false);
    setQ("");
    void navigate({ to });
  }

  /** Acción rápida: la ruta destino lee el pedido de la URL y abre su
   *  diálogo (agenda con `?nueva=1`, caja con `?abrir=1`). */
  function ejecutar(href: string) {
    setAbierto(false);
    setQ("");
    void navigate({ href });
  }

  return (
    <>
      {shellV2 ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Buscar paciente, página o acción"
          aria-keyshortcuts="Meta+K Control+K"
          className={cn(
            "flex h-9 items-center gap-2 rounded-full border text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            enBarraSuperior
              ? "w-9 justify-center border-border text-muted-foreground hover:border-brand/60 hover:text-foreground sm:w-full sm:justify-start sm:px-3"
              : "w-full border-night-line bg-night-2 px-3 text-on-night-2 hover:text-on-night",
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className={cn("flex-1 truncate text-left", enBarraSuperior && "hidden sm:inline")}>
            Buscar…
          </span>
          <kbd
            aria-hidden
            className={cn(
              "rounded-sm border px-1.5 font-mono text-[11px] leading-5",
              enBarraSuperior ? "hidden border-border md:inline" : "border-night-line",
            )}
          >
            {esMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Buscar paciente o página"
          className="flex h-9 w-9 items-center justify-center gap-2 rounded-md border border-border text-sm text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground sm:w-full sm:justify-start sm:px-3"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="hidden flex-1 truncate text-left sm:inline">Buscar paciente…</span>
          <kbd
            aria-hidden
            className="hidden rounded-sm border border-border px-1.5 text-xs sm:inline"
          >
            {esMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        {/* En celular va arriba y no centrado: centrado, el teclado tapaba
            los resultados. */}
        <DialogContent className="overflow-hidden p-0 max-sm:top-[8dvh] max-sm:w-[calc(100%-2rem)] max-sm:translate-y-0 max-sm:rounded-lg">
          <DialogTitle className="sr-only">Buscar en Esmalia</DialogTitle>
          <Command
            label="Buscar en Esmalia"
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
          >
            <CommandInput
              value={q}
              onValueChange={setQ}
              placeholder={
                puedeBuscarPacientes
                  ? "Paciente, documento, teléfono o página…"
                  : "Ir a una página…"
              }
            />
            <CommandList>
              <CommandEmpty>
                {isFetching ? "Buscando…" : "Sin resultados para esa búsqueda."}
              </CommandEmpty>
              {pacientes.length > 0 && (
                <CommandGroup heading="Pacientes">
                  {pacientes.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`paciente-${p.id}`}
                      onSelect={() => ir(`/pacientes/${p.id}`)}
                    >
                      <UserRound className="text-muted-foreground" aria-hidden />
                      <span className="flex-1 truncate">{p.nombre}</span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {p.documento ?? p.telefono ?? ""}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {acciones.length > 0 && (
                <CommandGroup heading="Acciones">
                  {acciones.map((a) => {
                    const Icono = a.id === "abrir-caja" ? LockOpen : CalendarPlus;
                    return (
                      <CommandItem
                        key={a.id}
                        value={`accion-${a.id}`}
                        onSelect={() => ejecutar(a.href)}
                      >
                        <Icono className="text-muted-foreground" aria-hidden />
                        <span className="flex-1 truncate">{a.label}</span>
                        <span className="truncate text-xs text-muted-foreground">{a.detalle}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              {paginasFiltradas.length > 0 && (
                <CommandGroup heading="Ir a">
                  {paginasFiltradas.map((p) => (
                    <CommandItem key={p.to} value={`pagina-${p.to}`} onSelect={() => ir(p.to)}>
                      <CornerDownLeft className="text-muted-foreground" aria-hidden />
                      {p.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
