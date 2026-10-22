import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarPlus,
  CornerDownLeft,
  Loader2,
  LockOpen,
  Search,
  UserPlus,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

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
import {
  accionesRapidas,
  hrefDeAccion,
  hrefDeCobro,
  paginasQueCoinciden,
  type AccionRapida,
  type PaginaBuscable,
} from "@/lib/shell";
import { cn } from "@/lib/utils";
import { useSoloLectura } from "@/hooks/use-solo-lectura";

const ICONO_ACCION: Record<AccionRapida["id"], LucideIcon> = {
  "nueva-cita": CalendarPlus,
  "abrir-caja": LockOpen,
  "registrar-pago": Wallet,
  "crear-paciente": UserPlus,
};

/**
 * Búsqueda ⌘K. Reemplaza a la versión deshabilitada que leía los arrays MOCK
 * del prototipo (auditoría architecture-3): ahora solo hay dos fuentes, las
 * dos reales — las páginas que el rol puede abrir y los pacientes de la
 * clínica activa (`buscarPacientes`, con su propio chequeo de permiso).
 */
export function GlobalSearch({
  access,
  atajo = false,
  enBarraSuperior = false,
}: {
  access: ClinicAccess;
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
  /** Ítem resaltado (controlado): cuando llegan pacientes, pasa al primero. */
  const [seleccion, setSeleccion] = useState("");
  /** "Registrar pago" elegido: el buscador pasa a pedir el paciente a cobrar. */
  const [cobrando, setCobrando] = useState(false);
  const disparadorRef = useRef<HTMLButtonElement>(null);
  const entradaRef = useRef<HTMLInputElement>(null);
  /** Al cerrar navegando, el foco queda en la página nueva y no vuelve al botón. */
  const cerroNavegando = useRef(false);
  const navigate = useNavigate();
  const ubicacion = useRouterState({ select: (st) => st.location });
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

  // Cada apertura arranca vacía: antes quedaba la búsqueda anterior.
  useEffect(() => {
    if (!abierto) return;
    cerroNavegando.current = false;
    setCobrando(false);
    setQ("");
    setQDiferida("");
    setSeleccion("");
  }, [abierto]);

  const paginas = useMemo((): PaginaBuscable[] => {
    const desdeDestinos = destinosVisibles(access.role).flatMap((d) =>
      d.pestanas.map((p) => ({
        to: p.to,
        label: p.label === d.label ? d.label : `${d.label} · ${p.label}`,
        sinonimos: [p.label, ...(p.sinonimos ?? [])],
      })),
    );
    const desdeAjustes = ajustesVisibles(access.role).flatMap((g) =>
      g.items.map((i) => ({
        to: i.to,
        label: `Ajustes · ${i.label}`,
        sinonimos: [i.label, ...(i.sinonimos ?? [])],
      })),
    );
    const vistas = new Set<string>();
    return [...desdeDestinos, ...desdeAjustes].filter((p) =>
      vistas.has(p.to) ? false : (vistas.add(p.to), true),
    );
  }, [access.role]);

  // Desde el comienzo de una palabra: "isi" ya no trae "Reportes · Comisiones".
  const paginasFiltradas = paginasQueCoinciden(paginas, q);
  // En solo lectura las acciones crean algo: no se ofrecen (el servidor
  // igual las rechazaría).
  const soloLectura = useSoloLectura();
  const acciones = !soloLectura && !cobrando ? accionesRapidas(access.role, q) : [];

  const clinicId = access.clinic?.id;
  const puedeBuscarPacientes = hasPermission(access.role, "patients:view") && Boolean(clinicId);
  const buscar = useServerFn(buscarPacientes);
  const buscandoPacientes = puedeBuscarPacientes && q.trim().length >= 2;
  const { data: pacientes = [], isFetching } = useQuery({
    queryKey: ["buscar-pacientes", clinicId, qDiferida],
    enabled: abierto && puedeBuscarPacientes && qDiferida.length >= 2,
    queryFn: () => buscar({ data: { clinicId: clinicId!, q: qDiferida } }),
    staleTime: 30_000,
  });

  // Los pacientes llegan después que las páginas (debounce + red) y cmdk ya
  // había resaltado la primera página: con un paciente encontrado, Enter
  // tiene que abrir su ficha.
  const primerPaciente = pacientes[0]?.id;
  useEffect(() => {
    if (primerPaciente) setSeleccion(`paciente-${primerPaciente}`);
  }, [primerPaciente]);

  function ir(to: string) {
    cerroNavegando.current = true;
    setAbierto(false);
    void navigate({ to });
  }

  /** Acción rápida: la ruta destino lee el pedido de la URL y abre su
   *  diálogo (agenda con `?nueva=1`, caja con `?abrir=1`). Si ya se está en
   *  esa ruta, conserva su vista, fecha y filtros (`hrefDeAccion`). */
  function ejecutar(accion: AccionRapida) {
    // Registrar pago: el cobro es de un paciente, así que primero se elige a
    // quién y después se abre su ficha con el pago ya abierto.
    if (accion.id === "registrar-pago" && puedeBuscarPacientes) {
      setCobrando(true);
      setQ("");
      setQDiferida("");
      setSeleccion("");
      // Con mouse o toque el foco pudo salir del campo: vuelve para escribir.
      entradaRef.current?.focus();
      return;
    }
    cerroNavegando.current = true;
    setAbierto(false);
    void navigate({ href: hrefDeAccion(accion, ubicacion) });
  }

  return (
    <>
      <button
        ref={disparadorRef}
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

      <Dialog open={abierto} onOpenChange={setAbierto}>
        {/* En celular va arriba y no centrado: centrado, el teclado tapaba
            los resultados. */}
        <DialogContent
          className="overflow-hidden p-0 max-sm:top-[8dvh] max-sm:w-[calc(100%-2rem)] max-sm:translate-y-0 max-sm:rounded-lg"
          onCloseAutoFocus={(e) => {
            // Cerrar sin elegir nada (Esc, clic afuera) devuelve el foco al
            // botón que lo abrió, aunque se haya abierto con ⌘K. Si se
            // navegó, se deja que la página nueva maneje el foco.
            const boton = disparadorRef.current;
            if (cerroNavegando.current) {
              e.preventDefault();
              return;
            }
            if (boton && boton.offsetParent !== null) {
              e.preventDefault();
              boton.focus();
            }
          }}
        >
          <DialogTitle className="sr-only">Buscar en Esmalia</DialogTitle>
          <Command
            label="Buscar en Esmalia"
            shouldFilter={false}
            value={seleccion}
            onValueChange={setSeleccion}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
          >
            <CommandInput
              ref={entradaRef}
              value={q}
              onValueChange={setQ}
              placeholder={
                cobrando
                  ? "¿A qué paciente? Nombre, documento o teléfono…"
                  : puedeBuscarPacientes
                    ? "Paciente, documento, teléfono o página…"
                    : "Ir a una página…"
              }
            />
            <CommandList>
              <CommandEmpty>
                {buscandoPacientes && (isFetching || q.trim() !== qDiferida)
                  ? "Buscando…"
                  : cobrando && q.trim().length < 2
                    ? "Registrar pago: escribe al menos 2 letras del paciente."
                    : "Sin resultados para esa búsqueda."}
              </CommandEmpty>
              {buscandoPacientes &&
                pacientes.length === 0 &&
                (isFetching || q.trim() !== qDiferida) &&
                (acciones.length > 0 || paginasFiltradas.length > 0) && (
                  <p
                    role="status"
                    className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs text-muted-foreground"
                  >
                    <Loader2 className="size-3 animate-spin" aria-hidden /> Buscando pacientes…
                  </p>
                )}
              {pacientes.length > 0 && (
                <CommandGroup heading={cobrando ? "Registrar pago a…" : "Pacientes"}>
                  {pacientes.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`paciente-${p.id}`}
                      onSelect={() => ir(cobrando ? hrefDeCobro(p.id) : `/pacientes/${p.id}`)}
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
                    const Icono = ICONO_ACCION[a.id];
                    return (
                      <CommandItem key={a.id} value={`accion-${a.id}`} onSelect={() => ejecutar(a)}>
                        <Icono className="text-muted-foreground" aria-hidden />
                        <span className="flex-1 truncate">{a.label}</span>
                        <span className="truncate text-xs text-muted-foreground">{a.detalle}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              {!cobrando && paginasFiltradas.length > 0 && (
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
