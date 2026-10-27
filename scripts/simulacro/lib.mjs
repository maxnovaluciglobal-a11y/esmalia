// Lógica pura del simulacro de restauración (SEG-05).
//
// Vive aparte de los scripts que hablan con Docker, B2 o Supabase para que
// tests/simulacro-restauracion.test.ts la pruebe con un backup de juguete,
// sin red ni base. Nada de lo que sale de acá lleva datos de pacientes: solo
// nombres de tabla, conteos, ids técnicos de constraints y tiempos.

/** Conteo de filas por tabla según el propio backup (el "manifiesto" del JSON). */
export function conteosDelBackup(doc) {
  if (!doc || typeof doc !== "object" || !doc.tables || typeof doc.tables !== "object") {
    throw new Error("El backup no tiene la forma { exportedAt, tables: { … } }");
  }
  const conteos = {};
  for (const [tabla, filas] of Object.entries(doc.tables)) {
    if (!Array.isArray(filas)) throw new Error(`La tabla ${tabla} del backup no es una lista`);
    conteos[tabla] = filas.length;
  }
  return conteos;
}

/** Ids de usuarios de auth que trae el backup (null si es un backup viejo, sin `auth_users`). */
export function usuariosDelBackup(doc) {
  if (!Array.isArray(doc?.auth_users)) return null;
  return doc.auth_users.map((u) => u.id).filter(Boolean);
}

/** Objetos que dice el manifiesto de Storage, por bucket: { bucket: [{ path, size }] }. */
export function objetosDelManifiesto(manifest) {
  if (!manifest) return null;
  const out = {};
  for (const b of manifest.buckets ?? []) {
    out[b.id] = (b.objects ?? []).map((o) => ({ path: o.path, size: o.size }));
  }
  return out;
}

/**
 * Compara lo esperado (backup) con lo restaurado (base efímera) y decide.
 *
 * Entradas (todas salvo `backup` son mediciones hechas contra la base efímera):
 * - backup:      el JSON descifrado ({ exportedAt, tables, auth_users? }).
 * - conteosBase: { tabla: filas | null } — null si la tabla no existe en el esquema.
 * - fksRotas:    [{ tabla, columna, referencia, huerfanos }] con huerfanos > 0.
 * - fksRevisadas: cuántas FKs se revisaron (para el reporte).
 * - usuariosRestaurados: ids del backup que quedaron en auth.users como usuarios reales.
 * - usuariosStub: usuarios inventados por la carga para FKs sin usuario en el backup.
 * - manifiesto:  manifest.json del storage.tar.gz (o null si no hubo backup de Storage).
 * - objetosBase: { bucket: [{ path, size }] } leídos de storage.objects (o null).
 * - migraciones: { ok, fallidas: [nombre] }.
 * - tiempos:     [{ paso, segundos, rto: boolean }] — rto marca los pasos que cuentan para el RTO.
 *
 * Devuelve { estado: "ok" | "falla", checks: [{ id, ok, detalle }], rtoSegundos, … }.
 */
export function evaluarSimulacro({
  backup,
  conteosBase,
  fksRotas = [],
  fksRevisadas = 0,
  usuariosRestaurados = [],
  usuariosStub = 0,
  manifiesto = null,
  objetosBase = null,
  migraciones = { ok: 0, fallidas: [] },
  tiempos = [],
}) {
  const checks = [];
  const esperado = conteosDelBackup(backup);

  // 1. Migraciones: el esquema tiene que levantar entero antes de cargar nada.
  checks.push({
    id: "migraciones",
    ok: migraciones.fallidas.length === 0 && migraciones.ok > 0,
    detalle:
      migraciones.fallidas.length === 0
        ? `${migraciones.ok} migraciones aplicadas`
        : `${migraciones.fallidas.length} migraciones fallaron: ${migraciones.fallidas.join(", ")}`,
  });

  // 2. Conteos por tabla contra el manifiesto del backup.
  const distintas = [];
  const sinTabla = [];
  for (const [tabla, filas] of Object.entries(esperado)) {
    const real = conteosBase?.[tabla];
    if (real === null || real === undefined) sinTabla.push(tabla);
    else if (real !== filas) distintas.push({ tabla, backup: filas, base: real });
  }
  const totalTablas = Object.keys(esperado).length;
  checks.push({
    id: "conteos",
    ok: distintas.length === 0 && sinTabla.length === 0 && totalTablas > 0,
    detalle:
      totalTablas === 0
        ? "el backup no trae tablas"
        : `${totalTablas - distintas.length - sinTabla.length}/${totalTablas} tablas con el mismo conteo` +
          (distintas.length
            ? `; distintas: ${distintas.map((d) => `${d.tabla} (backup ${d.backup}, base ${d.base})`).join(", ")}`
            : "") +
          (sinTabla.length ? `; sin tabla en el esquema: ${sinTabla.join(", ")}` : ""),
  });

  // 3. Integridad referencial (la carga se hace sin chequear FKs, se mide acá).
  checks.push({
    id: "fks",
    ok: fksRotas.length === 0,
    detalle:
      fksRotas.length === 0
        ? `${fksRevisadas} FKs revisadas, 0 filas huérfanas`
        : `${fksRotas.length} de ${fksRevisadas} FKs con huérfanos: ` +
          fksRotas
            .map((f) => `${f.tabla}.${f.columna} → ${f.referencia} (${f.huerfanos})`)
            .join(", "),
  });

  // 4. Usuarios de auth: todos los del backup tienen que volver con su mismo id.
  const idsBackup = usuariosDelBackup(backup);
  if (idsBackup === null) {
    checks.push({
      id: "auth",
      ok: true,
      omitido: true,
      detalle: `backup anterior al 10-oct-2026, sin auth_users (${usuariosStub} usuarios stub para no romper FKs)`,
    });
  } else {
    const restaurados = new Set(usuariosRestaurados);
    const faltan = idsBackup.filter((id) => !restaurados.has(id));
    checks.push({
      id: "auth",
      ok: faltan.length === 0,
      detalle:
        `${idsBackup.length - faltan.length}/${idsBackup.length} usuarios restaurados con su id` +
        (faltan.length ? `; faltan ${faltan.length}` : "") +
        (usuariosStub ? `; ${usuariosStub} ids referenciados sin usuario en el backup (stub)` : ""),
    });
  }

  // 5. Storage: cada objeto del manifiesto, en su bucket, con el mismo tamaño.
  const esperadoStorage = objetosDelManifiesto(manifiesto);
  if (esperadoStorage === null) {
    checks.push({ id: "storage", ok: true, omitido: true, detalle: "sin backup de Storage" });
  } else {
    let total = 0;
    const faltantes = [];
    for (const [bucket, objetos] of Object.entries(esperadoStorage)) {
      const enBase = new Map((objetosBase?.[bucket] ?? []).map((o) => [o.path, o.size]));
      for (const o of objetos) {
        total++;
        if (enBase.get(o.path) !== o.size) faltantes.push(bucket);
      }
    }
    const fallidosAlExportar = manifiesto.failed?.length ?? 0;
    checks.push({
      id: "storage",
      ok: faltantes.length === 0,
      detalle:
        `${total - faltantes.length}/${total} archivos restaurados con su tamaño en ${Object.keys(esperadoStorage).length} buckets` +
        (faltantes.length ? `; faltan o difieren ${faltantes.length}` : "") +
        (fallidosAlExportar
          ? `; ${fallidosAlExportar} no se pudieron exportar en el backup (aviso)`
          : ""),
    });
  }

  const rtoSegundos = redondear(tiempos.filter((t) => t.rto).reduce((s, t) => s + t.segundos, 0));
  const totalSegundos = redondear(tiempos.reduce((s, t) => s + t.segundos, 0));
  return {
    estado: checks.every((c) => c.ok) ? "ok" : "falla",
    exportedAt: backup.exportedAt ?? null,
    tablas: totalTablas,
    filas: Object.values(esperado).reduce((s, n) => s + n, 0),
    checks,
    tiempos,
    rtoSegundos,
    totalSegundos,
  };
}

function redondear(n) {
  return Math.round(n * 10) / 10;
}

/** Duración legible: "48,3 s" o "4 min 12 s". */
export function formatearDuracion(segundos) {
  if (segundos < 60) return `${String(redondear(segundos)).replace(".", ",")} s`;
  const min = Math.floor(segundos / 60);
  const s = Math.round(segundos - min * 60);
  return `${min} min ${s} s`;
}

/** Reporte en Markdown para el resumen del job y el artefacto. Sin datos de pacientes. */
export function reporteMarkdown(resultado, { origen = "", fecha = new Date().toISOString() } = {}) {
  const icono = resultado.estado === "ok" ? "✅" : "🔴";
  const lineas = [
    `## ${icono} Simulacro de restauración: ${resultado.estado === "ok" ? "correcto" : "con fallas"}`,
    "",
    `- Fecha del simulacro: ${fecha}`,
    `- Backup: ${origen || "(sin nombre)"} · exportado ${resultado.exportedAt ?? "(sin fecha)"}`,
    `- ${resultado.tablas} tablas, ${resultado.filas} filas`,
    `- **RTO medido (bajar → base restaurada con usuarios y archivos): ${formatearDuracion(resultado.rtoSegundos)}**`,
    "",
    "| Verificación | Resultado | Detalle |",
    "| --- | --- | --- |",
    ...resultado.checks.map(
      (c) => `| ${c.id} | ${c.omitido ? "➖ omitida" : c.ok ? "✅" : "🔴"} | ${c.detalle} |`,
    ),
    "",
    "| Paso | Tiempo | Cuenta para el RTO |",
    "| --- | --- | --- |",
    ...resultado.tiempos.map(
      (t) => `| ${t.paso} | ${formatearDuracion(t.segundos)} | ${t.rto ? "sí" : "no"} |`,
    ),
    `| **Total** | **${formatearDuracion(resultado.totalSegundos)}** | |`,
    "",
    "_Base efímera en el runner (Supabase local en Docker), descartada al terminar. Este reporte solo tiene nombres de tabla, conteos y tiempos._",
  ];
  return lineas.join("\n") + "\n";
}

/**
 * Elige el último backup de un listado de B2 (`rclone lsf`): los nombres llevan
 * el sello UTC `esmalia_YYYYMMDD_HHMMSS`, así que el orden alfabético es el
 * cronológico. Devuelve también el de Storage con el mismo sello, si existe.
 */
export function elegirUltimoBackup(archivosDb, archivosStorage = []) {
  const db = archivosDb
    .map((s) => s.trim())
    .filter((s) => /^esmalia_\d{8}_\d{6}\.json\.gz\.age$/.test(s))
    .sort();
  if (db.length === 0) return null;
  const ultimo = db[db.length - 1];
  const sello = ultimo.slice("esmalia_".length, "esmalia_".length + 15);
  const storage = archivosStorage
    .map((s) => s.trim())
    .find((s) => s === `esmalia_storage_${sello}.tar.gz.age`);
  return { db: ultimo, storage: storage ?? null, sello };
}
