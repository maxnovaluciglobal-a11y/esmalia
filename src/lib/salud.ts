/**
 * Cuerpo y headers de /api/health (src/routes/api.health.ts). Aparte del
 * archivo de ruta para poder testearlo sin levantar el servidor
 * (tests/estado-servicio.test.ts).
 */
export function respuestaDeSalud(ok: boolean, timestamp = new Date().toISOString()): Response {
  return Response.json(
    { status: ok ? "ok" : "error", timestamp },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
