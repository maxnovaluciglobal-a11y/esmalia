/**
 * Métricas de los evals de Patty (IA-05). Funciones puras: sin red, sin
 * claves, sin estado. Las prueba `tests/evals-metricas.test.ts`.
 */

/** Minúsculas y sin tildes, para comparar texto clínico escrito de cualquier forma. */
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Primer fragmento que calza con el patrón (o null), con algo de contexto. */
function fragmento(textoNorm, patron) {
  const m = new RegExp(patron, "i").exec(textoNorm);
  if (!m) return null;
  const desde = Math.max(0, m.index - 30);
  return textoNorm.slice(desde, m.index + m[0].length + 30).replace(/\s+/g, " ");
}

/**
 * Apuntes -> SOAP. Un hecho prohibido que aparece es una alucinación
 * candidata (se imprime el fragmento para que un humano confirme: un
 * "no se indica amoxicilina" también calza).
 */
export function puntuarSoap(caso, salida) {
  const texto = normalizar(salida);
  const alucinaciones = [];
  for (const h of caso.prohibidos) {
    const f = fragmento(texto, h.patron);
    if (f) alucinaciones.push({ hecho: h.hecho, fragmento: f });
  }
  const faltantes = (caso.requeridos ?? [])
    .filter((h) => !new RegExp(h.patron, "i").test(texto))
    .map((h) => h.hecho);
  const secciones = ["subjetivo", "objetivo", "analisis", "plan"].filter((s) => texto.includes(s));
  return {
    alucinaciones,
    faltantes,
    soapCompleto: secciones.length === 4,
  };
}

export function resumirSoap(resultados) {
  const total = resultados.length;
  const alucinaciones = resultados.reduce((n, r) => n + r.alucinaciones.length, 0);
  const requeridos = resultados.reduce((n, r) => n + r.requeridosTotal, 0);
  const faltantes = resultados.reduce((n, r) => n + r.faltantes.length, 0);
  return {
    casos: total,
    hechosAlucinados: alucinaciones,
    casosConAlucinacion: resultados.filter((r) => r.alucinaciones.length > 0).length,
    retencionDeHechos: requeridos ? (requeridos - faltantes) / requeridos : 1,
    soapCompleto: resultados.filter((r) => r.soapCompleto).length / (total || 1),
  };
}

// ─── Entidades ───────────────────────────────────────────────────────────

/** Tipo del eval -> clave del JSON que devuelve el modelo (mismo esquema que la app). */
export const TIPOS = {
  alergias: "allergies",
  medicamentos: "medications",
  condiciones: "diagnoses",
};

function calza(terminoNorm, alias) {
  return alias.some((a) => {
    const an = normalizar(a);
    return terminoNorm.includes(an) || (terminoNorm.length >= 4 && an.includes(terminoNorm));
  });
}

/** Normaliza una pieza dental a FDI de 2 dígitos ("pieza 3.6" -> "36"); null si no es FDI. */
export function piezaFdi(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return /^[1-8][1-8]$/.test(digitos) ? digitos : null;
}

/**
 * Compara la salida del modelo (objeto ya parseado con allergies/medications/
 * diagnoses/treatments) con lo esperado. Devuelve VP/FP/FN por tipo.
 */
export function puntuarEntidades(caso, salida) {
  const resultado = {};
  for (const [tipo, clave] of Object.entries(TIPOS)) {
    const esperados = caso.esperado[tipo] ?? [];
    const toleradas = caso.toleradas?.[tipo] ?? [];
    const predichos = (salida?.[clave] ?? [])
      .map((it) => normalizar(typeof it === "string" ? it : it?.term))
      .filter(Boolean);
    const usados = new Set();
    let vp = 0;
    const fp = [];
    for (const p of predichos) {
      const i = esperados.findIndex((alias, idx) => !usados.has(idx) && calza(p, alias));
      if (i >= 0) {
        usados.add(i);
        vp++;
      } else if (!toleradas.some((alias) => calza(p, alias))) {
        fp.push(p);
      }
    }
    const fn = esperados.filter((_, idx) => !usados.has(idx)).map((a) => a[0]);
    resultado[tipo] = { vp, fp, fn };
  }

  const dientesEsperados = new Set(caso.esperado.dientes ?? []);
  const dientesPredichos = new Set(
    Object.values(salida ?? {})
      .flat()
      .map((it) => (it && typeof it === "object" ? piezaFdi(it.tooth) : null))
      .filter(Boolean),
  );
  const vpD = [...dientesPredichos].filter((d) => dientesEsperados.has(d));
  resultado.dientes = {
    vp: vpD.length,
    fp: [...dientesPredichos].filter((d) => !dientesEsperados.has(d)),
    fn: [...dientesEsperados].filter((d) => !dientesPredichos.has(d)),
  };
  return resultado;
}

export function resumirEntidades(resultados) {
  const tipos = [...Object.keys(TIPOS), "dientes"];
  const resumen = {};
  for (const tipo of tipos) {
    let vp = 0;
    let fp = 0;
    let fn = 0;
    for (const r of resultados) {
      if (!r.puntaje) continue;
      vp += r.puntaje[tipo].vp;
      fp += r.puntaje[tipo].fp.length;
      fn += r.puntaje[tipo].fn.length;
    }
    resumen[tipo] = {
      precision: vp + fp ? vp / (vp + fp) : 1,
      recall: vp + fn ? vp / (vp + fn) : 1,
      vp,
      fp,
      fn,
    };
  }
  resumen.alergiasInventadas = resumen.alergias.fp;
  resumen.casosIlegibles = resultados.filter((r) => !r.puntaje).length;
  return resumen;
}

// ─── Agenda ──────────────────────────────────────────────────────────────

/** Fecha ISO (YYYY-MM-DD) de un instante en una zona horaria. */
export function isoEnZona(instante, zona) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instante));
}

export function puntuarAgenda(caso, lectura) {
  const l = lectura ?? { intencion: null, fecha: null, franja: null };
  return {
    intencionOk: (l.intencion ?? null) === caso.intencion,
    fechaOk: (l.fecha ?? null) === caso.fecha,
    franjaOk: (l.franja ?? null) === (caso.franja ?? null),
    fechaInventada: caso.fecha === null && Boolean(l.fecha),
  };
}

export function resumirAgenda(resultados) {
  const total = resultados.length || 1;
  const conFecha = resultados.filter((r) => r.caso.fecha !== null);
  const cuenta = (xs, f) => xs.filter(f).length;
  return {
    casos: resultados.length,
    exactitudIntencion: cuenta(resultados, (r) => r.puntaje.intencionOk) / total,
    exactitudFecha: cuenta(resultados, (r) => r.puntaje.fechaOk) / total,
    exactitudFechaCuandoHayFecha: conFecha.length
      ? cuenta(conFecha, (r) => r.puntaje.fechaOk) / conFecha.length
      : 1,
    fechasInventadas: cuenta(resultados, (r) => r.puntaje.fechaInventada),
    exactitudFranja: cuenta(resultados, (r) => r.puntaje.franjaOk) / total,
    errores: cuenta(resultados, (r) => r.error),
  };
}

/** Umbrales de aprobación propuestos en docs/IA.md (requisito IA-05). */
export const UMBRALES = {
  soap: { hechosAlucinados: 0 },
  entidades: { alergiasInventadas: 0, recallMinimo: 0.85, precisionMinima: 0.85 },
  agenda: { exactitudIntencion: 0.9, exactitudFecha: 0.9, fechasInventadas: 0 },
};

export function evaluarUmbrales(nombre, resumen) {
  const fallas = [];
  if (nombre === "soap" && resumen.hechosAlucinados > UMBRALES.soap.hechosAlucinados) {
    fallas.push(`${resumen.hechosAlucinados} hechos alucinados (meta 0; revisar a mano)`);
  }
  if (nombre === "entidades") {
    if (resumen.alergiasInventadas > 0) {
      fallas.push(`${resumen.alergiasInventadas} alergias inventadas (meta 0)`);
    }
    for (const tipo of [...Object.keys(TIPOS), "dientes"]) {
      const t = resumen[tipo];
      if (t.recall < UMBRALES.entidades.recallMinimo) {
        fallas.push(`recall ${tipo} ${t.recall.toFixed(2)}`);
      }
      if (t.precision < UMBRALES.entidades.precisionMinima) {
        fallas.push(`precisión ${tipo} ${t.precision.toFixed(2)}`);
      }
    }
  }
  if (nombre === "agenda") {
    const u = UMBRALES.agenda;
    if (resumen.exactitudIntencion < u.exactitudIntencion) {
      fallas.push(`exactitud de intención ${resumen.exactitudIntencion.toFixed(2)}`);
    }
    if (resumen.exactitudFecha < u.exactitudFecha) {
      fallas.push(`exactitud de fecha ${resumen.exactitudFecha.toFixed(2)}`);
    }
    if (resumen.fechasInventadas > u.fechasInventadas) {
      fallas.push(`${resumen.fechasInventadas} fechas inventadas (meta 0)`);
    }
  }
  return fallas;
}
