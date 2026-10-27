// Guardia compartida de los pasos del simulacro que escriben: solo aceptan una
// base local (el Supabase efímero del runner). Si por error alguien exporta la
// URL de producción en la misma terminal, el paso aborta antes de tocar nada.

const HOSTS_LOCALES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function esUrlLocal(url) {
  try {
    const u = new URL(url);
    return HOSTS_LOCALES.has(u.hostname) && !url.includes("supabase.co");
  } catch {
    return false;
  }
}

export function exigirBaseLocal(url) {
  if (!esUrlLocal(url ?? "")) {
    console.error(
      "El simulacro solo restaura en una base local efímera: SUPABASE_URL tiene que ser http://127.0.0.1:<puerto>.",
    );
    process.exit(2);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Falta SUPABASE_SERVICE_ROLE_KEY de la base efímera.");
    process.exit(2);
  }
  return url;
}
