/**
 * CRM-03 · Plantillas de mensajes (Ola 8). Lógica pura, igual en el editor
 * (vista previa, aviso de variables desconocidas) y en el servidor (envío).
 *
 * Mismo formato de variables que el motor de documentos de la Ola 4
 * (`{{grupo.nombre}}`, en español; se reutiliza su lector de variables), pero
 * con un catálogo propio y corto: un mensaje no es un documento.
 *
 * El texto es plano: en WhatsApp sale tal cual y en el correo se escapa entero
 * (nunca se interpreta como HTML), así que un valor de la ficha no puede
 * inyectar nada.
 */
import { extraerVariables } from "@/lib/documentos/motor";

export const CANALES_DE_PLANTILLA = ["whatsapp", "correo"] as const;
export type CanalDePlantilla = (typeof CANALES_DE_PLANTILLA)[number];

export const ETIQUETA_CANAL: Record<CanalDePlantilla, string> = {
  whatsapp: "WhatsApp",
  correo: "Correo",
};

export interface VariableDeMensaje {
  clave: string;
  etiqueta: string;
  ejemplo: string;
}

export const VARIABLES_DE_MENSAJE: readonly VariableDeMensaje[] = [
  { clave: "paciente.nombre", etiqueta: "Nombre completo del paciente", ejemplo: "Ana Pérez Soto" },
  { clave: "paciente.primer_nombre", etiqueta: "Primer nombre del paciente", ejemplo: "Ana" },
  { clave: "clinica.nombre", etiqueta: "Nombre de la clínica", ejemplo: "Clínica Sonrisa" },
  { clave: "clinica.telefono", etiqueta: "Teléfono de la clínica", ejemplo: "+56 2 2345 6789" },
  {
    clave: "reserva.link",
    etiqueta: "Link para reservar en línea (si la reserva está encendida)",
    ejemplo: "https://esmalia.com/reservar/clinica-sonrisa",
  },
];

const CLAVES = new Set(VARIABLES_DE_MENSAJE.map((v) => v.clave));

export const LARGO_MAXIMO_CUERPO = 2000;
export const LARGO_MAXIMO_ASUNTO = 150;

export interface AnalisisDeMensaje {
  variables: string[];
  desconocidas: string[];
  problemas: string[];
}

export function analizarMensaje(cuerpo: string, asunto?: string | null): AnalisisDeMensaje {
  const texto = `${asunto ?? ""}\n${cuerpo}`;
  const variables = extraerVariables(texto);
  const desconocidas = variables.filter((v) => !CLAVES.has(v));
  const problemas: string[] = [];
  if (cuerpo.trim().length < 2) problemas.push("Escribe el texto del mensaje.");
  if (cuerpo.length > LARGO_MAXIMO_CUERPO) {
    problemas.push(`El texto pasa de ${LARGO_MAXIMO_CUERPO} caracteres.`);
  }
  if (asunto !== undefined && asunto !== null && asunto.length > LARGO_MAXIMO_ASUNTO) {
    problemas.push(`El asunto pasa de ${LARGO_MAXIMO_ASUNTO} caracteres.`);
  }
  for (const v of desconocidas) {
    problemas.push(`La variable {{${v}}} no existe. Usa una de la lista.`);
  }
  // Llaves sueltas: "{{paciente.nombre}" o "{paciente}" quedarían a la vista del paciente.
  const sinVariables = texto.replace(/\{\{\s*[^{}]*?\s*\}\}/g, "");
  if (/[{}]/.test(sinVariables)) {
    problemas.push(
      "Hay llaves { } sueltas: las variables van con dos llaves, como {{paciente.nombre}}.",
    );
  }
  return { variables, desconocidas, problemas };
}

export type ValoresDeMensaje = Partial<Record<string, string | null>>;

export function primerNombreDe(nombre: string | null | undefined): string {
  return (nombre ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Largo bajo el cual una línea que perdió un dato es solo su rótulo ("Reserva aquí:"). */
const LARGO_DE_ROTULO = 40;

/**
 * Reemplaza las variables. Una variable sin valor (la clínica sin teléfono,
 * la reserva apagada) queda vacía: si su línea era corta (solo el rótulo del
 * dato, como "Llámanos al {{clinica.telefono}}") la línea entera se quita; en
 * una línea larga se quita solo el dato y la puntuación que quedó colgando.
 */
export function renderMensaje(cuerpo: string, valores: ValoresDeMensaje): string {
  const lineas = cuerpo.replace(/\r\n?/g, "\n").split("\n");
  const salida: string[] = [];
  for (const linea of lineas) {
    let tuvoVariableVacia = false;
    const nueva = linea.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (todo, clave: string) => {
      if (!CLAVES.has(clave)) return todo;
      const v = valores[clave];
      if (v === undefined || v === null || v.trim() === "") {
        tuvoVariableVacia = true;
        return "";
      }
      return v;
    });
    if (!tuvoVariableVacia) {
      salida.push(nueva);
      continue;
    }
    if (nueva.replace(/[\s:·,.-]/g, "").length <= LARGO_DE_ROTULO) continue;
    salida.push(
      nueva
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([.,;:])/g, "$1")
        .replace(/:\s*([.,;]?)\s*$/, "$1")
        .trimEnd(),
    );
  }
  return salida
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Valores de ejemplo para la vista previa del editor. */
export function valoresDeEjemplo(clinica?: string | null): ValoresDeMensaje {
  const v: ValoresDeMensaje = {};
  for (const x of VARIABLES_DE_MENSAJE) v[x.clave] = x.ejemplo;
  if (clinica) v["clinica.nombre"] = clinica;
  return v;
}

export function valoresParaPaciente(args: {
  paciente: string;
  clinica: string;
  telefonoClinica: string | null;
  linkReserva: string | null;
}): ValoresDeMensaje {
  return {
    "paciente.nombre": args.paciente,
    "paciente.primer_nombre": primerNombreDe(args.paciente),
    "clinica.nombre": args.clinica,
    "clinica.telefono": args.telefonoClinica,
    "reserva.link": args.linkReserva,
  };
}

export interface PlantillaSugerida {
  nombre: string;
  canal: CanalDePlantilla;
  asunto: string | null;
  cuerpo: string;
}

/** Puntos de partida para una clínica que no tiene plantillas todavía. */
export const PLANTILLAS_SUGERIDAS: readonly PlantillaSugerida[] = [
  {
    nombre: "Te extrañamos (WhatsApp)",
    canal: "whatsapp",
    asunto: null,
    cuerpo:
      "Hola, {{paciente.primer_nombre}}. Te escribimos de {{clinica.nombre}}: hace un tiempo que no te vemos y queremos saber cómo estás. Si quieres agendar un control, responde este mensaje.\n\nO elige tu hora aquí: {{reserva.link}}",
  },
  {
    nombre: "Control anual (correo)",
    canal: "correo",
    asunto: "Es momento de tu control en {{clinica.nombre}}",
    cuerpo:
      "Hola, {{paciente.primer_nombre}}:\n\nYa pasó un año desde tu última revisión. Un control a tiempo evita tratamientos más largos.\n\nPuedes reservar tu hora aquí: {{reserva.link}}\nO llámanos al {{clinica.telefono}}.\n\nSaludos,\n{{clinica.nombre}}",
  },
  {
    nombre: "Retomar tratamiento (WhatsApp)",
    canal: "whatsapp",
    asunto: null,
    cuerpo:
      "Hola, {{paciente.primer_nombre}}. En {{clinica.nombre}} vimos que tu tratamiento quedó pendiente. ¿Te acomoda que coordinemos la próxima sesión?",
  },
];
