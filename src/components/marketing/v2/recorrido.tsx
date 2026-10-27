// Recorrido comercial (/recorrido, 21-oct-2026). Es lo que Walter manda por
// WhatsApp cuando una clínica responde el primer mensaje del kit: una página
// para leer en el celular, con pantallas reales de la clínica demo, y que se
// imprime como PDF para quien lo pida. Plan aprobado:
// 07 - Clientes y Ventas/kit-piloto/2026-10-21-plan-recorrido-comercial.md.
//
// Reglas de veracidad (las mismas de la landing):
// - Las capturas son de /demo (datos de prueba) y la página lo dice.
// - Ningún recordatorio sale solo: lo envía alguien de la clínica con un toque.
// - WhatsApp oficial y Patty están en habilitación; sin fechas.
// - Precio en USD, el mismo de /precios. Oferta fundadora = oferta-clinicas-fundadoras.md.
import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { SiteFooter } from "@/components/site-chrome";
import { enlaceWhatsAppVentas } from "@/lib/marketing/contacto";
import { registrarEvento } from "@/lib/marketing/eventos";
import { PRECIO_FUNDADOR_EXPLICACION } from "@/lib/marketing/precio-fundador";

import { EncabezadoV2, type EnlaceSeccion } from "./encabezado";

const SECCIONES: readonly EnlaceSeccion[] = [
  { label: "El recorrido", href: "#recorrido" },
  { label: "Pantallas", href: "#pantallas" },
  { label: "Dudas", href: "#dudas" },
  { label: "Oferta", href: "#oferta" },
];

const ANTES = [
  "La agenda en un cuaderno, en Google Calendar o en la cabeza de la recepción.",
  "Las confirmaciones salen del WhatsApp personal, una por una.",
  "Los cobros y lo que falta cobrar viven en una planilla aparte.",
  "Para saber cómo va el mes hay que sentarse a sumar.",
] as const;

const DESPUES = [
  "Una agenda por profesional, que se mueve arrastrando la cita.",
  "El recordatorio sale con el mensaje ya escrito y un toque.",
  "El presupuesto nace del odontograma y el saldo se actualiza solo.",
  "La caja cuadra al cierre y el día se ve en una pantalla.",
] as const;

const PASOS = [
  {
    t: "Escribe",
    d: "Te pide hora por WhatsApp o desde el portal del paciente. La solicitud aparece al costado de la agenda.",
  },
  {
    t: "Se agenda",
    d: "Queda en la columna del profesional que corresponde. Si hay que moverla, se arrastra.",
  },
  {
    t: "Se confirma",
    d: "Antes de la cita, tu recepción manda el recordatorio por WhatsApp con un toque. El mensaje ya viene escrito.",
  },
  {
    t: "Se atiende",
    d: "Alergias a la vista, odontograma, periodontograma y notas clínicas firmadas en la misma ficha.",
  },
  {
    t: "Decide",
    d: "El presupuesto se arma con lo que marcaste en el odontograma. Si lo acepta, pasa solo a plan de tratamiento.",
  },
  {
    t: "Paga",
    d: "Efectivo, tarjeta o transferencia. El saldo del paciente se actualiza y la caja del día lo suma.",
  },
  {
    t: "Vuelve",
    d: "Esmalia arma la lista de controles pendientes y saldos por cobrar. Tu equipo los avisa con un toque.",
  },
] as const;

type Pantalla = {
  id: string;
  titulo: ReactNode;
  texto: string;
  puntos: readonly string[];
  imagenes: readonly { src: string; ancho: number; alto: number; alt: string }[];
};

const PANTALLAS: readonly Pantalla[] = [
  {
    id: "hoy",
    titulo: (
      <>
        El día entero, <em>apenas entras.</em>
      </>
    ),
    texto:
      "La primera pantalla responde lo que preguntas cada mañana: quién viene, quién no confirmó y cuánto falta cobrar.",
    puntos: [
      "Cobrado hoy, por cobrar y citas confirmadas.",
      "La agenda del día con el saldo de cada paciente.",
      "Lo pendiente: citas sin confirmar, mensajes sin responder y avisos por despachar.",
    ],
    imagenes: [
      {
        src: "/recorrido/hoy.webp",
        ancho: 1600,
        alto: 785,
        alt: "Pantalla Hoy de Esmalia: cobrado hoy, por cobrar, citas del día y pendientes por resolver.",
      },
    ],
  },
  {
    id: "agenda",
    titulo: (
      <>
        Una columna <em>por profesional.</em>
      </>
    ),
    texto:
      "Día, semana o mes. Las solicitudes que llegan desde el portal del paciente esperan al costado hasta que alguien las agenda.",
    puntos: [
      "Mover una cita es arrastrarla.",
      "El estado se ve por color: confirmada, en sala, atendida.",
      "Sigue funcionando sin internet y se pone al día cuando vuelve la conexión.",
    ],
    imagenes: [
      {
        src: "/recorrido/agenda.webp",
        ancho: 1600,
        alto: 631,
        alt: "Agenda de Esmalia en vista de día, con una columna por profesional y las solicitudes del portal al costado.",
      },
    ],
  },
  {
    id: "ficha",
    titulo: (
      <>
        La ficha, <em>con el odontograma adentro.</em>
      </>
    ),
    texto:
      "Todo el paciente en un lugar: datos, convenio, alerta médica, odontograma, notas, presupuestos, pagos y documentos.",
    puntos: [
      "Odontograma con numeración FDI: dentición permanente, mixta y temporal.",
      "Periodontograma de 6 puntos por pieza.",
      "Las notas firmadas no se borran: se corrigen con una adenda.",
      "Consentimientos con firma y exportación de la ficha completa.",
    ],
    imagenes: [
      {
        src: "/recorrido/ficha.webp",
        ancho: 1600,
        alto: 515,
        alt: "Encabezado de la ficha de un paciente de prueba, con próxima cita, saldo, convenio y alerta médica.",
      },
      {
        src: "/recorrido/odontograma.webp",
        ancho: 1600,
        alto: 935,
        alt: "Odontograma de Esmalia con piezas marcadas según la convención clínica.",
      },
    ],
  },
  {
    id: "caja",
    titulo: (
      <>
        La caja <em>cuadra sola.</em>
      </>
    ),
    texto:
      "Los cobros en efectivo se suman al esperado del cierre. Tarjetas y transferencias quedan aparte, para conciliar con el banco.",
    puntos: [
      "Arqueo contando por billete y moneda.",
      "Un pago mal cargado se revierte dejando registro; no se borra.",
      "Comisiones por profesional y morosidad por antigüedad.",
    ],
    imagenes: [
      {
        src: "/recorrido/caja.webp",
        ancho: 1600,
        alto: 938,
        alt: "Caja del día de Esmalia abierta, con el esperado, los cobros del turno y el arqueo por billete.",
      },
    ],
  },
  {
    id: "recordatorios",
    titulo: (
      <>
        Los avisos, <em>listos para mandar.</em>
      </>
    ),
    texto:
      "Esmalia arma la lista de a quién hay que escribirle hoy. Tu equipo revisa y lo manda por WhatsApp o correo con un toque.",
    puntos: [
      "Recordatorio 48 horas antes y aviso 3 horas antes.",
      "Pacientes con control pendiente, pedido de reseña y aviso de saldo.",
      "Nada sale solo. El envío automático por WhatsApp llega con la conexión oficial de Meta, que está en habilitación.",
    ],
    imagenes: [
      {
        src: "/recorrido/recordatorios.webp",
        ancho: 1600,
        alto: 723,
        alt: "Lista de recordatorios de Esmalia con botones para enviar por WhatsApp o correo.",
      },
    ],
  },
];

const DIFERENCIAS = [
  {
    t: "El precio está publicado",
    d: "Solo US$19,99 al mes (1 profesional) o Clínica US$49,99 (hasta 3). No hay que pedirle el valor a un asesor.",
  },
  {
    t: "Funciona sin internet",
    d: "Si se corta la conexión, la agenda y las fichas siguen abiertas, y todo se sincroniza cuando vuelve.",
  },
  {
    t: "Tus pacientes tienen su portal",
    d: "Ven sus citas y piden hora desde un link, sin crear cuenta ni instalar nada.",
  },
  {
    t: "Hablas con quien lo hace",
    d: "Durante el piloto, el soporte es directo con el fundador por WhatsApp, con respuesta en menos de 4 horas hábiles.",
  },
] as const;

const DATOS = [
  "Cada clínica está aislada: tus datos no se cruzan con los de otra, y se verifica en la base, no solo en la pantalla.",
  "Las historias clínicas no se borran y queda registro de quién abrió cada ficha.",
  "Respaldo diario cifrado, guardado fuera del servidor principal.",
  "Exportas toda la clínica con un botón, cuando quieras.",
  "Acuerdo de tratamiento de datos (DPA) público en esmalia.com/dpa.",
] as const;

const DUDAS = [
  {
    q: "Ya tengo un sistema (o un cuaderno). ¿Por qué cambiar?",
    a: "No tienes que cambiar de un día para otro. La primera semana puedes usar los dos en paralelo. Si vienes de una planilla o de otro sistema, en la oferta fundadora te cargamos pacientes y citas futuras en 48 horas hábiles.",
  },
  {
    q: "¿Y si después me quiero ir?",
    a: "Exportas toda la clínica con un botón (pacientes, citas, fichas, pagos) y te la llevas. No hay contrato de permanencia.",
  },
  {
    q: "¿Cobran por dentista o por usuario?",
    a: "El plan se define por cuántos profesionales atienden: Solo (1) a US$19,99 al mes o Clínica (hasta 3) a US$49,99. Se cobra en dólares, con tarjeta.",
  },
  {
    q: "¿Mi equipo va a saber usarlo?",
    a: "La puesta en marcha es una videollamada de 20 minutos: agenda, horarios, roles de recepción y plantillas de WhatsApp. Después, cualquier duda va directo por WhatsApp.",
  },
  {
    q: "¿Los recordatorios salen solos?",
    a: "Todavía no. Esmalia arma la lista y el mensaje, y tu recepción lo envía con un toque desde su WhatsApp. El envío automático llega cuando terminemos la conexión oficial con Meta; no tenemos fecha cerrada.",
  },
  {
    q: "¿Qué no hace todavía?",
    a: "No emite boleta ni factura electrónica (la sigues emitiendo en tu sistema tributario), no tiene app en las tiendas (se instala desde el navegador) y no hace telemedicina. Patty, la asistente con IA, está en habilitación.",
  },
] as const;

function Flecha() {
  return (
    <span className="lv-arrow" aria-hidden="true">
      →
    </span>
  );
}

function Botones({ lugar, claro = false }: { lugar: string; claro?: boolean }) {
  const whatsapp = enlaceWhatsAppVentas();
  return (
    <div className="lv-ctas rc-ctas">
      <a
        href={whatsapp.href}
        target={whatsapp.esWhatsApp ? "_blank" : undefined}
        rel={whatsapp.esWhatsApp ? "noopener" : undefined}
        onClick={() => registrarEvento("cta_click", { cta: "whatsapp", lugar })}
        className={claro ? "lv-btn lv-btn-ink" : "lv-btn lv-btn-ocre"}
      >
        {whatsapp.esWhatsApp ? "Escribirle a Walter" : "Escribirnos"} <Flecha />
      </a>
      <Link
        to="/auth"
        search={{ signup: true }}
        onClick={() => registrarEvento("cta_click", { cta: "signup", lugar })}
        className="lv-btn lv-btn-line"
      >
        Probar 14 días gratis
      </Link>
    </div>
  );
}

function Captura({
  img,
  prioridad = false,
}: {
  img: Pantalla["imagenes"][number];
  prioridad?: boolean;
}) {
  return (
    <a
      href={img.src}
      target="_blank"
      rel="noopener"
      className="rc-shot"
      aria-label={`${img.alt} Abrir en tamaño completo.`}
    >
      <img
        src={img.src}
        width={img.ancho}
        height={img.alto}
        alt={img.alt}
        loading={prioridad ? "eager" : "lazy"}
        decoding="async"
      />
    </a>
  );
}

export function Recorrido() {
  // En papel no hay clic: al imprimir (o guardar como PDF) se abren todas las
  // dudas para que las respuestas salgan en la hoja.
  useEffect(() => {
    const abrir = () =>
      document.querySelectorAll<HTMLDetailsElement>(".rc-acc details").forEach((d) => {
        d.open = true;
      });
    window.addEventListener("beforeprint", abrir);
    return () => window.removeEventListener("beforeprint", abrir);
  }, []);

  return (
    <div className="lv2 rc">
      <div className="rc-noprint">
        <EncabezadoV2 secciones={SECCIONES} />
      </div>
      <main id="main-content">
        <section className="rc-hero" aria-labelledby="rc-h1">
          <div className="lv-wrap rc-narrow">
            <p className="rc-sello">Recorrido por Esmalia · 3 minutos</p>
            <h1 className="rc-h1" id="rc-h1">
              Tu clínica, <em>de la primera pregunta al próximo control.</em>
            </h1>
            <p className="lv-lead rc-lead">
              Agenda, ficha clínica, presupuestos, caja y recordatorios por WhatsApp en un solo
              lugar. Lo que sigue son pantallas reales de Esmalia, con los datos de prueba de
              nuestra clínica demo.
            </p>
            <ul className="rc-hechos" aria-label="En resumen">
              <li>
                <b>Desde US$19,99</b> al mes
              </li>
              <li>
                <b>14 días</b> gratis, sin tarjeta
              </li>
              <li>
                <b>Sin internet</b> también funciona
              </li>
            </ul>
            <Botones lugar="recorrido-portada" />
          </div>
          <div className="lv-wrap rc-hero-shot">
            <Captura img={PANTALLAS[0].imagenes[0]} prioridad />
          </div>
        </section>

        <section className="rc-sec rc-cambio" aria-labelledby="rc-cambio-h">
          <div className="lv-wrap">
            <h2 className="lv-h-sec lv-h-sm" id="rc-cambio-h">
              Lo que cambia <em>en tu semana.</em>
            </h2>
            <div className="rc-cambio-grid">
              <div>
                <h3 className="rc-h3">Hoy</h3>
                <ul className="rc-lista rc-lista-antes">
                  {ANTES.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="rc-h3">Con Esmalia</h3>
                <ul className="rc-lista rc-lista-despues">
                  {DESPUES.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section
          id="recorrido"
          className="rc-sec lv-on-night rc-pasos"
          aria-labelledby="rc-pasos-h"
        >
          <div className="lv-wrap">
            <h2 className="lv-h-sec lv-h-sm" id="rc-pasos-h">
              Un paciente entero, <em>sin salir de Esmalia.</em>
            </h2>
            <ol className="rc-ol">
              {PASOS.map((p) => (
                <li key={p.t}>
                  <b>{p.t}</b>
                  <span>{p.d}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <div id="pantallas">
          {PANTALLAS.slice(1).map((p, i) => (
            <section
              key={p.id}
              className={i % 2 ? "rc-sec rc-pantalla rc-alterna" : "rc-sec rc-pantalla"}
              aria-labelledby={`rc-${p.id}-h`}
            >
              <div className="lv-wrap rc-pantalla-grid">
                <div className="rc-pantalla-txt">
                  <h2 className="lv-h-sec lv-h-sm" id={`rc-${p.id}-h`}>
                    {p.titulo}
                  </h2>
                  <p className="rc-p">{p.texto}</p>
                  <ul className="rc-lista rc-lista-despues">
                    {p.puntos.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
                <div className="rc-pantalla-img">
                  {p.imagenes.map((img) => (
                    <Captura key={img.src} img={img} />
                  ))}
                  <p className="rc-ver-grande">Toca la imagen para verla en grande.</p>
                </div>
              </div>
            </section>
          ))}
        </div>

        <section className="rc-sec rc-dif" aria-labelledby="rc-dif-h">
          <div className="lv-wrap">
            <h2 className="lv-h-sec lv-h-sm" id="rc-dif-h">
              Lo que nos hace <em>distintos.</em>
            </h2>
            <dl className="rc-dl">
              {DIFERENCIAS.map((d) => (
                <div key={d.t}>
                  <dt>{d.t}</dt>
                  <dd>{d.d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="rc-sec rc-datos" aria-labelledby="rc-datos-h">
          <div className="lv-wrap rc-datos-grid">
            <h2 className="lv-h-sec lv-h-sm" id="rc-datos-h">
              Dónde quedan <em>tus datos.</em>
            </h2>
            <ul className="rc-lista rc-lista-despues">
              {DATOS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </section>

        <section id="dudas" className="rc-sec rc-dudas" aria-labelledby="rc-dudas-h">
          <div className="lv-wrap rc-narrow">
            <h2 className="lv-h-sec lv-h-sm" id="rc-dudas-h">
              Las dudas de siempre, <em>sin vueltas.</em>
            </h2>
            <div className="rc-acc">
              {DUDAS.map((d) => (
                <details key={d.q}>
                  <summary>{d.q}</summary>
                  <p>{d.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="oferta" className="rc-oferta" aria-labelledby="rc-oferta-h">
          <div className="lv-wrap rc-narrow">
            <h2 className="lv-h-sec" id="rc-oferta-h">
              20 clínicas <em>fundadoras.</em>
            </h2>
            <ul className="rc-oferta-lista">
              <li>
                <b>3 meses gratis</b> del plan Clínica, contados desde la puesta en marcha.
              </li>
              <li>
                <b>Te migramos nosotros</b> pacientes y citas futuras desde tu planilla o tu
                sistema.
              </li>
              <li>
                <b>Puesta en marcha 1:1</b> de 20 minutos y soporte directo por WhatsApp.
              </li>
              <li>
                <b>Después, la mitad.</b> {PRECIO_FUNDADOR_EXPLICACION}
              </li>
            </ul>
            <p className="rc-oferta-nota">
              Para consultas y clínicas de 1 a 3 sillones en Santiago. Vale hasta el 31 de enero de
              2027 o hasta llenar los 20 cupos.
            </p>
            <Botones lugar="recorrido-oferta" claro />
            <p className="rc-print-only rc-contacto-impreso">
              esmalia.com · WhatsApp +56 9 5499 6514 · hola@esmalia.com
            </p>
          </div>
        </section>

        <div className="lv-wrap rc-pie">
          <p>
            Pantallas reales de Esmalia con datos de prueba de la clínica demo. Recorrido
            actualizado en octubre de 2026.
          </p>
          <button type="button" className="rc-imprimir rc-noprint" onClick={() => window.print()}>
            Guardar como PDF
          </button>
        </div>
      </main>
      <div className="lv-foot dark rc-noprint">
        <SiteFooter />
      </div>
    </div>
  );
}
