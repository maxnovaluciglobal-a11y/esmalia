// Los 14 días de prueba en una clínica típica (ilustrativo). Cada paso es algo
// que el producto hace hoy: alta de la clínica, importación CSV en todos los
// planes, recordatorios con un toque, presupuesto que pasa a plan, caja con
// arqueo y exportación completa.
type Paso = {
  titulo: string;
  detalle: string;
  marcas:
    | { tipo: "barra"; desde: number; hasta: number; tono?: "oc" | "cb" }
    | { tipo: "dias"; dias: readonly number[]; tono: "sm" | "oc" };
};

const PASOS: readonly Paso[] = [
  {
    titulo: "Creas la clínica",
    detalle: "País, sucursal, profesionales y sillones",
    marcas: { tipo: "barra", desde: 1, hasta: 2, tono: "oc" },
  },
  {
    titulo: "Importas tus pacientes",
    detalle: "Desde una planilla CSV, en todos los planes",
    marcas: { tipo: "barra", desde: 1, hasta: 3 },
  },
  {
    titulo: "Agendas y envías recordatorios",
    detalle: "Con un toque, desde el WhatsApp de la clínica",
    marcas: { tipo: "barra", desde: 2, hasta: 15, tono: "cb" },
  },
  {
    titulo: "Fichas, odontograma y presupuestos",
    detalle: "El presupuesto aceptado pasa a plan",
    marcas: { tipo: "barra", desde: 3, hasta: 15 },
  },
  {
    titulo: "Cierras la caja cada día",
    detalle: "Arqueo al cierre, por medio de pago",
    marcas: { tipo: "dias", dias: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13], tono: "sm" },
  },
  {
    titulo: "Decides",
    detalle: "Solo o Clínica. O exportas todo y te vas.",
    marcas: { tipo: "dias", dias: [14], tono: "oc" },
  },
];

export function TimelinePrueba() {
  return (
    <section className="lv-how lv-on-night" id="como" aria-labelledby="lv-how-h">
      <div className="lv-wrap">
        <div className="lv-sec-head">
          <h2 className="lv-h-sec" id="lv-how-h">
            De la planilla a la agenda, <em>en tu primera semana.</em>
          </h2>
          <p className="lv-lead">
            Así se ven los 14 días de prueba en una clínica típica. Sin instalar nada y sin tarjeta.
          </p>
        </div>
        <ol className="lv-tlh">
          <li className="lv-tlh-days" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i}>{i === 0 || i === 6 || i === 13 ? `Día ${i + 1}` : ""}</span>
            ))}
          </li>
          {PASOS.map((p) => (
            <li key={p.titulo} className="lv-tlh-item">
              <div className="lv-tlh-lbl">
                {p.titulo}
                <small>{p.detalle}</small>
              </div>
              <div className="lv-tlh-trk" aria-hidden="true">
                {p.marcas.tipo === "barra" ? (
                  <div
                    className={p.marcas.tono ? `lv-bar ${p.marcas.tono}` : "lv-bar"}
                    style={{ gridColumn: `${p.marcas.desde} / ${p.marcas.hasta}` }}
                  />
                ) : (
                  p.marcas.dias.map((d) => (
                    <i
                      key={d}
                      className={`lv-dm ${p.marcas.tipo === "dias" ? p.marcas.tono : ""}`}
                      style={{ gridColumn: d }}
                    />
                  ))
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
