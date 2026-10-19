> **Archivado el 2026-10-19: histórico, no vigente.** Lo reemplaza la auditoría 360 total del 18-oct-2026 (fuera del repo: `04 - Esmalia/00 - Gestion/auditorias/2026-10-18-auditoria-360-total/`); lo que quedó por hacer está en [`docs/ROADMAP.md`](../ROADMAP.md). Se conserva como registro de cómo se pensó y decidió en su momento; no lo uses como fuente de estado ni de planes. Las rutas `docs/…` que aparecen abajo apuntan a la ubicación anterior (hoy `docs/archivo/`). Motivo: hallazgo GOB-03 de la auditoría 360 del 18-oct-2026.

# Auditoría 360 — Esmalia (Aurora Dental OS) — 2026-08-26

Auditoría más profunda hecha hasta ahora sobre el producto. 9 áreas, cada hallazgo pasado por investigación + contraauditoría + defensa antes de llegar a este reporte. Sigue en formato y espíritu a `AUDITORIA_360_REPORTE_2026-08-21.md`, pero cubre exclusivamente lo construido desde esa fecha (Tier 1-3 + Auth Google nativo) más lo que quedó pendiente de la ronda anterior.

---

## 1. Resumen ejecutivo

**Madurez del producto hoy:** Esmalia sigue siendo un core clínico serio — probablemente el mejor de su categoría LatAm en rigor de datos (odontograma versionado con dentición temporal, periodontograma, consentimientos firmados con snapshot inmutable, presupuesto con firma). Eso no cambió y hay que usarlo en el discurso comercial sin miedo. Lo que cambió desde el 21-ago es que se construyeron ~15 features nuevas (Tier 1-3) a buena velocidad, y esa velocidad dejó tres patrones repetidos: **(a)** features nuevas que no heredan las protecciones que el resto del sistema sí tiene (RLS testeado, cola offline, versionado inmutable de datos clínicos), **(b)** UI que resuelve el caso feliz pero no el caso chairside real (firma que se desalinea, banner de alergia que no llega a agenda, targets táctiles de 9-10px en tablet), y **(c)** features de negocio (comisiones, self-service, trial) construidas sin el control mínimo que las haría seguras de escalar (sin límite de seats, sin gate de billing, sin antifraude de trial).

Nada de esto bloquea el piloto actual de 3-5 clínicas amigas — son gente conocida, con volumen bajo y tolerancia a fricción. Pero **el momento de arreglarlo es antes de sumar la sexta clínica o la primera que no sea amiga**, no después.

**Los 5 riesgos/oportunidades más grandes de esta ronda:**

1. **Cero backups offsite reales, 7+ corridas fallando en silencio** (seguridad-1) — con PHI real de pilotos amigas hoy en Supabase sin ninguna copia fuera de esa misma cuenta. Esto es el hallazgo más grave de toda la auditoría: no es deuda técnica, es que si algo le pasa a esa cuenta de Supabase, se pierde todo. Arreglo de 2 secrets, ya identificado.
2. **El self-service de "Empieza gratis" no tiene gate de billing** (marketing-2b) — cualquier clínica que se registre hoy tiene acceso completo gratis indefinido, sin empujón a pagar. Escalar adquisición de tráfico ahora mismo generaría cero ingresos nuevos.
3. **Alergias: el dato clínico de mayor riesgo no llega al punto de atención** (producto-1/ux-1) y además es mutable sin historial (seguridad-3/arq-5), rompiendo el propio patrón de versionado que el sistema exige en todo lo demás. Es barato de arreglar y es exactamente el tipo de gap que un incidente real (por más raro que sea) vuelve carísimo en confianza.
4. **Ley 21.719 (cifrado de datos de salud, Chile) quedó a medio camino** — peor que no haber empezado: hay infraestructura de cifrado visible en el schema pero el dato real (`document_id`) sigue en texto plano. Quedan ~3 meses para vigencia plena y no hay fecha de corte fijada.
5. **Pricing sin instrumentación de uso real**: no hay contador de profesionales/sillones que valide los límites de los planes Solo/Clínica, así que Walter no sabe hoy cuánto está regalando por clínica ni tiene datos para decidir el precio regular post-piloto. Es la pieza que destraba pricing-4, pricing-5 y el cierre del "precio fundador".

**Veredicto general:** producto técnicamente sólido en su núcleo, con deuda de "features nuevas sin las barandillas del resto del sistema" concentrada y identificable. Ninguno de los 41 hallazgos de esta ronda es un fuego que haya que apagar hoy con las pilotos actuales — pero hay 3-4 (backups, alergias, gate de billing, cifrado Ley 21.719) que si Walter no los mira antes de la próxima etapa (más clínicas, dinero real entrando, auditor de compliance chileno tocando la puerta) se pagan mucho más caro que ahora.

---

## 2. Tabla consolidada de hallazgos

Convención: **Impacto/Esfuerzo** = alto/medio/bajo. **Veredicto**: agregar (pasa a backlog), diferir (válido, no urgente), mantener (fortaleza confirmada, no tocar), sacar (descartado).

### Seguridad y compliance

| ID           | Título                                                    | Veredicto | Impacto | Esfuerzo |
| ------------ | --------------------------------------------------------- | --------- | ------- | -------- |
| seguridad-1  | 0 backups offsite reales, 7+ corridas fallando            | agregar   | alto    | bajo     |
| seguridad-1b | Corrida de backup colgada 6h sin investigar               | agregar   | bajo    | bajo     |
| seguridad-2  | Cifrado Ley 21.719 a medio camino, sin fecha de corte     | agregar   | alto    | medio    |
| seguridad-3  | Anamnesis con alergias mutable sin historial              | agregar   | alto    | medio    |
| seguridad-4  | HTML injection en emails transaccionales (renderTemplate) | agregar   | medio   | bajo     |
| seguridad-5  | Sentry: redactado de PII incompleto (breadcrumbs/extra)   | diferir   | medio   | bajo     |
| seguridad-6  | CRON_SECRET comparado sin timing-safe                     | diferir   | bajo    | bajo     |

### Arquitectura y deuda técnica

| ID    | Título                                                          | Veredicto | Impacto | Esfuerzo |
| ----- | --------------------------------------------------------------- | --------- | ------- | -------- |
| arq-1 | Comisiones se calculan sobre regla vigente, sin período cerrado | agregar   | alto    | medio    |
| arq-2 | Smoke test de RLS no cubre las 7 tablas nuevas Tier 1-3         | agregar   | alto    | bajo     |
| arq-3 | Cola offline no cubre alergias ni firmas                        | agregar   | alto    | medio    |
| arq-4 | Falla de subida de firma se guarda como "accepted" igual        | agregar   | medio   | bajo     |
| arq-5 | Alergias mutables sin auditoría (ver seguridad-3)               | diferir   | medio   | medio    |
| arq-6 | types.ts parcheado a mano, sin drift hoy                        | mantener  | bajo    | bajo     |
| arq-7 | Horario de profesional sin excepciones puntuales                | diferir   | medio   | medio    |
| arq-8 | commission_rules sin estado "cerrado" (causa raíz de arq-1)     | agregar   | alto    | medio    |
| arq-9 | Query de comisiones sin índice para su patrón de acceso         | agregar   | bajo    | bajo     |

### Producto vs. competencia

| ID          | Título                                                                              | Veredicto | Impacto | Esfuerzo |
| ----------- | ----------------------------------------------------------------------------------- | --------- | ------- | -------- |
| producto-1  | Alerta de alergia no llega a agenda/check-in                                        | agregar   | alto    | bajo     |
| producto-2  | Inventario a nivel clínica, no sucursal                                             | agregar   | medio   | bajo     |
| producto-3  | "Encuesta de satisfacción" es solo mensaje, sin captura                             | diferir   | bajo    | bajo     |
| producto-4  | Comisiones sin integración a flujo de liquidación real                              | diferir   | bajo    | bajo     |
| producto-5  | Consentimientos firmados: diferenciador real                                        | mantener  | alto    | bajo     |
| producto-6  | Dentición temporal FDI 51-85 soportada                                              | mantener  | medio   | bajo     |
| producto-7  | Recordatorios por email heredan decisión anti-cron de WhatsApp sin evaluarse aparte | diferir   | medio   | bajo     |
| producto-8  | Sin vista de gestión de cartera en riesgo (recall)                                  | agregar   | medio   | medio    |
| producto-9  | Comisión no cruza si el pago fue cobrado                                            | diferir   | bajo    | bajo     |
| producto-10 | Portal: TTL 7 días correcto, pero sin revocación individual                         | agregar   | bajo    | bajo     |

### UX clínica diaria

| ID   | Título                                                           | Veredicto | Impacto | Esfuerzo |
| ---- | ---------------------------------------------------------------- | --------- | ------- | -------- |
| ux-1 | Banner de alergia ausente en agenda y en NuevaCitaDialog         | agregar   | alto    | bajo     |
| ux-2 | Pad de firma: desajuste de coordenadas táctiles                  | agregar   | alto    | bajo     |
| ux-3 | Dentist no ve su propia comisión; backend tampoco filtra         | agregar   | alto    | medio    |
| ux-4 | Vistas semana/mes de agenda: targets táctiles de 9-10px          | agregar   | medio   | medio    |
| ux-5 | Periodontograma no parte del sondaje anterior                    | diferir   | medio   | medio    |
| ux-6 | Archivar documento: solo hover, sin aria-label, sin confirmación | agregar   | medio   | bajo     |
| ux-7 | Revocar consentimiento sin confirmación                          | agregar   | bajo    | bajo     |

### Visual y diseño

| ID       | Título                                                     | Veredicto | Impacto | Esfuerzo |
| -------- | ---------------------------------------------------------- | --------- | ------- | -------- |
| visual-1 | SignaturePad: bug de escalado de coordenadas               | agregar   | alto    | bajo     |
| visual-2 | Trazo de firma hex fijo, invisible en dark mode            | agregar   | medio   | bajo     |
| visual-3 | Mockup de landing con paleta y estado de cita inventados   | agregar   | medio   | bajo     |
| visual-4 | Color "ausente" del odontograma con bajo contraste en dark | agregar   | medio   | bajo     |
| visual-5 | Vista mensual de agenda: texto 9px sin resguardo           | agregar   | medio   | medio    |
| visual-6 | Botones sm/select de comisiones y presupuesto bajo 44px    | agregar   | medio   | medio    |
| visual-7 | Encuesta de satisfacción sin ninguna UI                    | diferir   | medio   | alto     |
| visual-8 | Color de profesional: se guarda, nunca se usa en agenda    | agregar   | bajo    | bajo     |
| visual-9 | Dark mode no persiste ni respeta tema del sistema          | agregar   | bajo    | bajo     |

### Marketing, landing y adquisición

| ID           | Título                                                                 | Veredicto | Impacto | Esfuerzo |
| ------------ | ---------------------------------------------------------------------- | --------- | ------- | -------- |
| marketing-1  | Cero analytics en landing/app                                          | agregar   | alto    | bajo     |
| marketing-2  | Self-service sin calificación, contradice "escríbenos" de nosotros.tsx | agregar   | alto    | medio    |
| marketing-2b | Self-service sin gate de billing real                                  | agregar   | alto    | medio    |
| marketing-3  | Sin canal WhatsApp de contacto, solo mailto                            | agregar   | medio   | bajo     |
| marketing-4  | Cero prueba social real (testimonios/logos de pilotos)                 | agregar   | medio   | bajo     |
| marketing-5  | Fotos hero stock genéricas, contradicen "hecho para LatAm"             | agregar   | medio   | medio    |
| marketing-6  | Precio fundador sin urgencia ni justificación de la brecha             | agregar   | medio   | bajo     |
| marketing-7  | Demo sin tour ni foco en dolores vendidos                              | agregar   | alto    | medio    |
| marketing-8  | Sitemap roto, dominio no comprado                                      | agregar   | bajo    | bajo     |
| marketing-9  | Sin og:image/twitter:image                                             | agregar   | bajo    | bajo     |

### Comunicaciones (WhatsApp, email, notificaciones)

| ID  | Título                                                                             | Veredicto | Impacto | Esfuerzo |
| --- | ---------------------------------------------------------------------------------- | --------- | ------- | -------- |
| F1  | Botón "Email" del aviso de 3h siempre falla (falta template `appointment_checkin`) | agregar   | alto    | bajo     |
| F2  | Comisiones/documentos/encuestas no generan ningún aviso a nadie                    | agregar   | alto    | medio    |
| F3  | Presupuesto y recibo de pago son WhatsApp-only, sin fallback a email               | agregar   | medio   | medio    |
| F4  | Voseo rioplatense sembrado en todas las clínicas, incl. MX/CO/PE                   | agregar   | medio   | medio    |
| F5  | Comentario de código incorrecto sobre `nps_survey` en mapeo Meta API               | agregar   | bajo    | bajo     |
| F6  | Cooldown de `treatment_followup` reusa la constante equivocada                     | agregar   | bajo    | bajo     |
| F7  | Falla de auto-respuesta a lead nuevo de WhatsApp solo en `console.error`           | agregar   | medio   | bajo     |
| F8  | Sin límite de frecuencia cruzada entre tipos de outreach                           | diferir   | bajo    | medio    |

### Pricing y monetización

| ID                                            | Título                                                 | Veredicto | Impacto | Esfuerzo |
| --------------------------------------------- | ------------------------------------------------------ | --------- | ------- | -------- |
| pricing-seat-limit-no-enforced                | Límite de seats (1 / hasta 3) no se valida en código   | agregar   | alto    | bajo     |
| pricing-underpriced-vs-dentiqa                | 22%-3.6x más barato que Dentiqa                        | diferir   | medio   | bajo     |
| pricing-stale-comment-drift                   | Comentario en código dice "$49 flat", ya no es así     | agregar   | bajo    | bajo     |
| pricing-sin-facturacion-local-b2b             | Sin factura/boleta local, solo invoice Stripe USD      | diferir   | medio   | medio    |
| pricing-usd-only-friccion-latam               | Checkout solo USD, sin métodos de pago locales         | diferir   | medio   | medio    |
| pricing-sin-anual-ni-escalon-confirmado       | Confirmado: sin plan anual ni escalón por sillón       | diferir   | medio   | bajo     |
| pricing-trial-sin-antifraude                  | Trial sin tarjeta, sin control de abuso por email      | agregar   | medio   | bajo     |
| pricing-sin-setup-fee-ni-costo-implementacion | Sin fee de activación (vs. GastroCore360 que sí cobra) | diferir   | bajo    | bajo     |
| pricing-founder-sin-criterio-de-cierre        | "Precio fundador de por vida" sin fecha/cupo de cierre | agregar   | medio   | bajo     |
| pricing-trial-costo-marginal-no-medido        | Costo marginal de WhatsApp/email en trial sin medir    | agregar   | bajo    | bajo     |
| pricing-concentracion-proveedor-pago          | Concentración en Stripe                                | sacar     | bajo    | alto     |

### Operación y GTM con un solo founder

| ID    | Título                                                              | Veredicto | Impacto | Esfuerzo |
| ----- | ------------------------------------------------------------------- | --------- | ------- | -------- |
| ops-1 | Checklist de lanzamiento no cubre 3 pasos operativos nuevos         | agregar   | alto    | bajo     |
| ops-2 | Toast de bloqueo por sandbox usa jerga técnica ("sandbox")          | agregar   | medio   | bajo     |
| ops-3 | Comisiones: sin "marcar pagado", dedupe ni export contable          | agregar   | medio   | medio    |
| ops-4 | Backup a B2 sigue sin secrets — confirmado por 2 auditores          | agregar   | alto    | bajo     |
| ops-5 | Cero canal de soporte dentro de la app autenticada                  | agregar   | medio   | bajo     |
| ops-6 | Onboarding automatizado: no es el cuello de botella                 | mantener  | bajo    | bajo     |
| ops-7 | El cuello de botella real es proceso humano, no falla técnica       | mantener  | medio   | bajo     |
| ops-8 | Mensaje de error de sandbox redactado para dev, no para recepción   | agregar   | medio   | bajo     |
| ops-9 | `commission_rules` sin vigencia temporal — altera meses ya cerrados | agregar   | medio   | medio    |

**Total: 58 hallazgos con contenido real** en las 9 áreas — 41 agregar, 12 diferir, 6 mantener, 1 sacar (contando arq-5 y seguridad-3 como una sola cosa vista desde dos ángulos, y arq-1/arq-8 como el mismo fix; F2/ops-2 y ops-8 se tratan como hallazgos separados por tener mitigaciones distintas pese a tocar el mismo síntoma).

---

## 3. Detalle por área

### 3.1 Seguridad y compliance de datos de salud

RLS sigue impecable: las 9 tablas nuevas de Tier 1-3 tienen `ENABLE ROW LEVEL SECURITY` y policy, sin excepción. El contraauditor no encontró ni una tabla nueva sin protección — eso es una buena señal de disciplina incluso bajo velocidad.

Los tres problemas reales:

- **Backups (seguridad-1):** el pipeline de export + cifrado age funciona perfecto, pero el paso "subir a B2" falla hace 7+ corridas seguidas con `account not found` — y los secrets de B2 nunca se cargaron, mientras los de Supabase sí se cargaron el mismo día. Dato duro: Walter tocó secrets ese día y salteó específicamente los de B2. Hoy: cero backups fuera de la propia cuenta de Supabase de producción. Fix: pegar `B2_ACCOUNT_ID`/`B2_APPLICATION_KEY` si la cuenta/bucket ya existen (si no, hay que crearlos primero, sube el esfuerzo). Sumado: una corrida quedó colgada 6h01m el 19-ago (vs. 35-52s normal) con status `cancelled` — vale un `gh run view --log` puntual antes de asumir que es ruido.

- **Cifrado Ley 21.719 (seguridad-2):** la migración de `document_id_enc`/`document_id_hash` está construida pero sin caller real — `patients.document_id` en texto plano sigue siendo la única fuente de lectura/escritura. Esto es peor que no haber empezado: ante un auditor se ve como incumplimiento consciente, no como atraso. Recomendación: fijar fecha de corte (1-nov-2026, un mes de margen) en `PLAN_ACCION.md` y extender a phone/birth_date en la misma pasada.

- **Anamnesis mutable (seguridad-3):** contraste verificado dentro del mismo lote de commits — `patient_medical_history` (26-ago) no versiona, mientras `clinical_documents_and_consents` del mismo día sí bloquea UPDATE directo con triggers. No es un patrón viejo colado, es una inconsistencia dentro de la misma tanda. Es el peor lugar posible para perder sin rastro el valor anterior de una alergia.

Hallazgo revisado y bajado de prioridad: el "portal como superficie compuesta" que proponía el contraauditor no se sostiene — leído `portal.functions.ts` completo, no hay alta ni edición de `full_name` desde `/portal`, y el único campo libre (`reason`, hasta 500 chars) nunca llega a `renderTemplate`. Queda como seguridad-4 (HTML injection) con impacto medio, no alto, porque hoy el input a templates lo arma staff autenticado, no un tercero.

Diferidos razonables: Sentry con redactado incompleto (no explotable, DSN no seteado hoy — resolver antes de activarlo) y `CRON_SECRET` sin timing-safe compare (bajo impacto real, endpoint de demo sintética).

### 3.2 Arquitectura y deuda técnica

El núcleo pre-auditado sigue sólido. El problema es el mismo patrón en tres lugares: features Tier 1-3 no heredaron las protecciones estructurales del resto del sistema.

- **Comisiones sin período cerrado (arq-1 + arq-8, mismo fix):** `getCommissionReport` calcula sobre la regla vigente hoy, sin tabla de liquidaciones cerradas. El propio comentario de la migración admite "no hay tabla de liquidaciones cerradas todavía". Con un founder solo operando rápido, correr el reporte dos veces en el mismo mes puede derivar en pagar de más sin que nada avise. Fix: una tabla `commission_settlements` (period_from, period_to, closed_at, closed_by, líneas congeladas) resuelve ambos hallazgos a la vez — no son dos tareas, es una.

- **Smoke test de RLS sin las tablas nuevas (arq-2):** el propio encabezado del test dice que nació de un hallazgo de la auditoría anterior sobre este mismo blind spot, y las 7 tablas nuevas (incluida PHI y documentos legales firmados) no entraron. Esfuerzo bajo — repetir el patrón ya existente.

- **Cola offline sin alergias ni firmas (arq-3):** `OperacionKind` solo tiene 5 kinds; `medical-history-card.tsx` hace `useMutation` directo, y si falla por red el dato se pierde con solo un `toast.error`. Coherente con "offline-first" como promesa de marca, inconsistente en la implementación real. Recomendación: partir en dos tandas — anamnesis primero (barata, mismo patrón que notas clínicas), firmas después (blob de imagen en IndexedDB, más riesgo de cuota).

- **arq-4:** si falla la subida de la firma del presupuesto, el sistema guarda "accepted" igual sin distinguir "no firmó" de "quisimos guardar y falló". Fix trivial: loguear + exponer flag `signatureUploadFailed`.

Mantener sin cambios: `types.ts` sigue parcheado a mano pero sin drift real hoy (arq-6). Diferido con matiz: horario de profesional sin excepciones puntuales (arq-7) — sube a impacto medio porque el workaround real (editar el horario semanal) es fácil de hacer mal por apuro.

Nuevo de bajo costo: `arq-9`, índice faltante en `treatment_items` para el patrón de acceso real del reporte de comisiones — fix de una línea, bajo impacto hoy por volumen piloto.

### 3.3 Producto — gap vs. competencia

El diagnóstico central se sostiene en las dos rondas: el core clínico (odontograma con dentición temporal, periodontograma, consentimientos firmados) es diferenciador real frente a Dentalink/Dentiqa — **mantener y usarlo activamente en discurso comercial** (producto-5, producto-6). El riesgo no es "falta producto", es que se construyeron features nuevas (comisiones, NPS, inventario) sin validación de piloto real, mientras dos gaps estructurales genuinos siguen sin resolver.

- **producto-1 (alergia no llega al punto de atención):** ajustado con el contraauditor — no es solo la vista del dentista en agenda, es que recepción/asistente pueden preparar sala/instrumental sin abrir nunca la ficha completa. Mismo query, dos puntos de renderizado nuevos.
- **producto-2 (inventario sin sucursal):** invisible hoy (0-1 sucursal por piloto), se activa el día que la primera abra una segunda. Fix barato ahora: `branch_id` nullable ya, filtrado completo en UI cuando haga falta.
- **producto-10 (portal, TTL):** corrección importante — el hallazgo original del contraauditor de "sin expiración corta" es **incorrecto**, el TTL de 7 días está implementado y documentado (`portal-token.server.ts:16,67`). El gap real y más acotado: no hay revocación individual dentro de esa ventana si un paciente reenvía el link por error.
- **producto-8 (nuevo, cartera en riesgo):** el dato de "meses sin visita" solo se consume para armar el mensaje de WhatsApp, no hay vista de gestión de cartera tipo Dentalink/Curve. Oportunidad de retención no explotada, no una falla.
- Diferidos razonables sin objeción: encuesta sin captura (producto-3, solo problema de copy — renombrar el template, no tocar backend), comisiones aisladas (producto-4, producto-9), recordatorios por email heredando decisión anti-cron de WhatsApp sin evaluación propia (producto-7 — confirmar con Walter si aplica el mismo criterio).

### 3.4 UX clínica de uso diario

Los 7 hallazgos originales se sostienen sin bajas. El patrón de fondo: el odontograma y notas clínicas (auditados el 21-ago) siguen siendo el estándar de calidad del repo — targets táctiles WCAG documentados, foco de teclado, versionado inmutable — y las features nuevas no llegan a ese nivel todavía.

- **ux-1 (alergia, extendido):** el contraauditor sumó que `NuevaCitaDialog` tampoco muestra alergias al crear la cita — mismo root cause que producto-1, otro punto de falla. Fix único: incluir `allergies` en el payload que agenda/appointments ya usa.
- **ux-2 (firma, alto impacto):** el pad de firma tiene desajuste de coordenadas táctiles real, no un edge case — cualquier diálogo con ancho distinto de 460px CSS desplaza y recorta el trazo. Afecta consentimiento y aprobación de presupuesto, ambos flujos legalmente sensibles.
- **ux-3 (comisiones, esfuerzo subido a medio):** el dentist no puede ver su propia liquidación (no tiene `finance:view`), y el contraauditor encontró que tampoco alcanza con arreglar la ruta — `getCommissionLines` no filtra por `professionalId` en el handler server-side, trae todos los profesionales de la clínica. Hay que auditar y filtrar también el backend.
- **ux-4 (targets táctiles agenda semana/mes):** text-[9px] y controles de 12-24px de alto en la pantalla de mayor uso diario, justo donde el propio repo ya documenta el patrón correcto (`OCLUSAL_HIT_MIN=24` con cita a WCAG 2.5.8) sin haberlo aplicado acá.
- **ux-6 (archivar documento):** solo hover (inalcanzable en tablet táctil), `title` en vez de `aria-label` (mudo en VoiceOver/Safari iOS), sin confirmación. Tres problemas, un fix.
- Diferido razonable: periodontograma sin prellenado del sondaje anterior (ux-5) — baja frecuencia de uso real con 3-5 pilotos, validar antes de invertir.

### 3.5 Visual y diseño de interfaz

El sistema de diseño base (tokens oklch, shadcn/ui, `card-clinical`) sigue sólido y aplicado con disciplina en los módulos nuevos. Las grietas están donde más importa:

- **visual-1 (SignaturePad, mismo bug que ux-2, ángulo de código):** canvas con resolución interna fija 460x160 pero renderizado a `w-full`; `pointerPos()` calcula sobre el tamaño renderizado sin ningún factor `canvas.width/rect.width`. Fix de un one-liner, bug real de alto impacto porque es evidencia legal.
- **visual-2 (color de trazo hardcodeado):** viola la regla propia de `styles.css` ("nunca colores literales"), pero mitigado en severidad real: dark mode arranca siempre en `false` sin persistencia (confirmado, `useState(false)` sin localStorage ni `matchMedia`), así que no es lo primero que ve un usuario nuevo.
- **visual-3 (mockup de landing engañoso):** no es solo "otra paleta" (decisión intencional y documentada) — el problema real es presentar el mockup con chrome de navegador simulando captura real, incluyendo un estado de cita ("Recordado") que no existe en el tipo `Cita["estado"]`. Un prospecto que pasa de landing a app encuentra una agenda distinta a la prometida.
- **visual-4 (contraste dark, acotado):** no es sistémico a los 10 colores del odontograma como sugería la redacción original — solo "ausente" (#525252) falla contraste real en dark. La causa raíz (hex crudos sin verificar contraste) sí es deuda sistémica, pero el impacto visual hoy es puntual.
- Nuevos válidos: **visual-8**, color de identidad de profesional guardado pero nunca usado en agenda (feature huérfana, esperada por el usuario como en Dentalink/Open Dental); **visual-9**, dark mode sin persistencia ni respeto al tema del sistema — reduce adopción real justo en el escenario (consultorio con luz baja) donde más se necesitaría.
- Diferido: encuesta de satisfacción sin ninguna interfaz visual (visual-7, esfuerzo alto — construir una pantalla real de captura, no una mejora incremental).

### 3.6 Marketing, landing y adquisición

El hallazgo más importante de toda el área es el combo **marketing-2 + marketing-2b**: el botón "Empieza gratis" es signup self-service real sin calificación (contradice a la propia página `nosotros.tsx`, que pide escribir antes de sumarse) **y** no tiene ningún gate de billing — `trial-banner.tsx` documenta explícitamente "acceso libre hasta que el owner active el plan por su cuenta". Traducido: escalar adquisición de tráfico hoy generaría cero ingresos incrementales, porque cualquiera que entre por ese botón tiene acceso completo gratis indefinido. Esto no es un problema de conversión, es un problema de que el flujo de conversión a pago ni siquiera existe todavía.

Resto del área, confirmado sin grandes sorpresas: cero analytics (marketing-1, prerequisito de cualquier decisión de adquisición futura), sin canal WhatsApp de contacto pese a ser un producto WhatsApp-céntrico (marketing-3), cero prueba social real con 3-5 pilotos activas que costaría una llamada de 10 minutos (marketing-4), fotos stock que contradicen "hecho para LatAm" (marketing-5), precio fundador sin cupo/fecha (marketing-6, se retoma en pricing), demo sin tour que suelta al visitante sin guía (marketing-7 — corregido el framing: la demo es de solo lectura por trigger a nivel DB, no expone PHI real, buena noticia de privacidad; el problema de UX se mantiene), sitemap roto en dominio no comprado (marketing-8), sin og:image en un producto que se comparte por WhatsApp (marketing-9).

### 3.7 Comunicaciones con pacientes y equipo

(Repetida en una segunda pasada tras fallar en la ronda inicial.) El hallazgo más urgente es un bug reproducible en producción, no una mejora: **F1**, el botón "Email" del aviso de 3h en `/recordatorios` siempre falla porque nunca se sembró el template de email para `appointment_checkin` (solo se sembró para `appointment_confirmation` y `appointment_reminder`). Con clínicas piloto activas cargando pacientes con email, es cuestión de días hasta que alguien lo reporte. Fix de una migración.

- **F2 (silencio interno):** comisiones liquidadas, documentos por firmar y encuestas de satisfacción no generan ningún aviso — ni al paciente ni al staff, ni email/WhatsApp/toast persistente. Verificado que no existe ningún archivo de notificaciones en el repo. Un profesional a comisión solo se entera si entra a mirar.
- **F3 (asimetría de canal):** presupuesto (`quote_sent`) y recibo de pago (`payment_receipt`) siguen siendo WhatsApp-only — quedaron atrás cuando se agregó email para confirmación/recordatorio/NPS. Un paciente con email pero sin WhatsApp habilitado pierde justo los dos mensajes de mayor peso comercial y legal.
- **F4 (voseo, alcance corregido):** el contraauditor y la defensa confirmaron que el voseo rioplatense ("respondé", "tenés", "podés") no es un patrón nuevo de las migraciones de email — está sembrado desde Fase 0 en TODOS los templates de WhatsApp también, para clínicas de cualquier país. Con target explícito CL/MX/CO/PE/AR (CLAUDE.md), suena marcadamente extranjero fuera de CL/AR. El fix correcto es auditar `handle_new_clinic()` completo de una sola vez, no parchar template por template.
- **F7 (fallo silencioso de captación):** si Meta rechaza la auto-respuesta a un lead nuevo de WhatsApp, el error queda solo en `console.error` — sin Sentry (que sí está integrado y en uso en otro lado del repo) ni aviso visible. Es el peor momento para fallar en silencio: el primer contacto con un lead de captación.
- Bajo impacto, fix barato: F5 (comentario de código incorrecto sobre `nps_survey` que podría inducir un envío no controlado el día que se apruebe esa plantilla en Meta) y F6 (cooldown de `treatment_followup` reusa la constante de ventana máxima en vez de tener la suya — inofensivo hoy, se activa si se amplía la ventana).
- Diferido razonable: F8, sin límite de frecuencia cruzada entre tipos de outreach — hoy el staff despacha a mano y puede notar duplicados; anotarlo antes de escalar volumen.

### 3.8 Pricing y monetización

Modelo Solo US$29 / Clínica US$69 (fundador) bien construido en Stripe: checkout sin fricción, portal self-service, trial 14 días. El problema estructural: **los tiers se venden por "1 profesional/sillón" vs. "hasta 3" y el código no cuenta ni limita nada** (pricing-seat-limit-no-enforced) — Walter no sabe hoy cuántos sillones está regalando en las pilotos. Este hallazgo es la llave que destraba el resto del área: sin ese contador no hay datos de uso real para diseñar el escalón por sillón (pricing-4), decidir el descuento anual (pricing-5), ni fijar cuándo cierra "esta etapa" del precio fundador (pricing-founder-sin-criterio-de-cierre). Los tres quedan secuenciados **después** de instrumentar el conteo, no en paralelo.

Frente a Dentiqa (competidor más comparable, mismo pitch de "sin cobro por usuario"): Esmalia está entre 22% y 3.6x más barato (US$29-69 vs. US$89-249). Correcto no tocar el precio de las pilotos actuales; al fijar el precio regular post-piloto, anclarlo igual o levemente por encima de Dentiqa Starter, con los datos de seats ya en mano.

Subido a "agregar" (antes diferido): **trial sin antifraude** (pricing-trial-sin-antifraude) — con self-service abierto y sin gate de billing (ver marketing-2b), el trial de 14 días sin tarjeta y sin dedupe por email es una puerta abierta a extender indefinidamente el acceso gratis con emails alternativos. Es un gate binario de seguridad de ingresos, no una mejora incremental, así que corresponde resolverlo antes de abrir la landing a self-service real, no "cuando se pueda".

Deuda documental barata: un comentario en `pricing-display.ts` sigue diciendo "el cobro real siempre es US$49 flat" cuando el modelo real son dos tiers — induce a error a cualquiera debuggeando Stripe (pricing-stale-comment-drift).

Diferidos razonables sin objeción: facturación local (medio impacto real, Stripe ya emite invoice PDF vía portal), checkout solo USD (fricción real pero diseño consciente y documentado; pesa más en Argentina que en el resto de LatAm por percepciones cambiarias, evaluar aparte si Argentina entra al roadmap), plan anual/escalón por sillón (correcto esperar datos de churn real), setup fee (incoherente cobrarlo mientras el onboarding sea manual con clínicas amigas).

Descartado: concentración en Stripe como único proveedor de pago — es un riesgo de continuidad de negocio/infraestructura, no de estrategia de pricing, y construir una alternativa hoy es esfuerzo alto totalmente desproporcionado al riesgo real de una empresa unipersonal pre-lanzamiento.

### 3.9 Operación y GTM con un solo founder

(Repetida en una segunda pasada tras fallar en la ronda inicial.) El diagnóstico de fondo: **el cuello de botella para sumar 2-3 clínicas piloto simultáneas es proceso humano repetitivo, no capacidad técnica ni una automatización que falle en silencio** (ops-7, confirmado por dos auditores) — el onboarding automatizado central (`completeClinicSetup`) cubre bien lo esencial y no es frágil (ops-6, mantener).

- **ops-4 (backups, reforzado):** confirmado en vivo por dos auditores independientes, mismo resultado — `gh secret list` sin `B2_ACCOUNT_ID`/`B2_APPLICATION_KEY`. Refuerza seguridad-1 desde el ángulo operativo: es una tarea de 10 minutos de Walter en el dashboard de Backblaze, no un problema de código.
- **ops-1 (checklist de lanzamiento, corregido):** el hallazgo original sobreestimaba el problema — `consent_templates` resultó ser 100% self-service (no un paso SQL manual). El gap real y más acotado son 3 pasos operativos que `DEPLOY_PRODUCTION.md` no menciona todavía: activar producción de email, cargar horarios, configurar comisiones.
- **ops-2/ops-8 (mensaje de sandbox, corregido):** el hallazgo original decía "fallo silencioso" y era incorrecto — sí hay un `toast.error` inmediato al hacer click. El problema real es que el mensaje dice literalmente "Sandbox activo..." sin explicar qué significa ni qué hacer, lenguaje de desarrollador para una recepcionista. Fix de una línea de copy.
- **ops-3 + ops-9 (comisiones, mismo módulo):** sin "marcar como pagado" ni dedupe de período liquidado (ops-3), y sin vigencia temporal en `commission_rules` — cambiar una regla hoy altera retroactivamente reportes de meses ya cerrados (ops-9, hallazgo nuevo confirmado). Se recomienda resolver ambos juntos: una tabla de liquidaciones + versionado temporal de las reglas.
- **ops-5:** cero canal de soporte dentro de la app autenticada, confirmado con búsqueda ampliada a todas las rutas — el único contacto real es un `mailto` en una página pública de marketing.

---

## 4. Comparación competitiva actualizada

| Frente                                         | Esmalia hoy                                                                                            | Dentalink                                                                          | Dentiqa                                               | Otros relevantes                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Odontograma/periodontograma                    | Versionado por evento, dentición temporal FDI 51-85 soportada en el registro real (no catálogo aparte) | Estándar, sin versionado por evento documentado                                    | Gama más simple                                       | Dentipilot/Dentum: gama baja, sin dentición pediátrica nativa                         |
| Consentimientos firmados                       | Snapshot inmutable de título/cuerpo + firma real + revocación como evento (nunca DELETE)               | No destacan esto como diferenciador                                                | No destacan esto                                      | Diferenciador real de Esmalia, argumento de venta bajo Ley 21.719                     |
| Precio                                         | Solo US$29 / Clínica US$69 (fundador)                                                                  | Cobra por profesional+sucursal, clínica de 3 dentistas fácil supera US$100-150/mes | Starter US$89, Professional US$149, Enterprise US$249 | Dentum desde ~US$37                                                                   |
| Identidad de profesional en agenda             | Color guardado pero no usado (visual-8)                                                                | Sí, color por profesional en agenda                                                | —                                                     | Gap real vs. expectativa de categoría                                                 |
| Gestión de cartera en riesgo (recall)          | Solo dentro de la cola de outreach, sin vista dedicada (producto-8)                                    | Sí tiene vista dedicada                                                            | —                                                     | Curve también la tiene                                                                |
| Portal de pacientes con reserva en tiempo real | Deliberadamente NO (aprobación manual, decisión correcta en salud — no reabrir)                        | Algunos sí ofrecen reserva directa                                                 | —                                                     | Ver `producto-6` de la auditoría anterior, sigue vigente                              |
| Analytics de adquisición                       | Cero instrumentación                                                                                   | —                                                                                  | —                                                     | Bloqueante para escalar tráfico, no es comparación de producto sino de madurez de GTM |

**Lectura de conjunto:** el core clínico compite de igual a igual o por encima de la categoría LatAm en rigor de datos, y el precio ancla muy por debajo de Dentiqa (el competidor más parecido en pitch). El gap no es de producto clínico, es de "features de negocio construidas sin la instrumentación para escalarlas con seguridad" (seats, billing gate, analytics, antifraude de trial) — exactamente lo esperable en una etapa pre-lanzamiento, pero hay que cerrarlo antes, no después, de invertir en adquisición.

---

## 5. Pendientes heredados de la auditoría anterior (21-ago)

| Pendiente                                                                                    | Estado a hoy (26-ago)                                                                                                                                                                                                                                                                                                                                                                                             | Cambia esta auditoría                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **security-6 Fase 1b** (cutover real del cifrado `document_id`, extender a phone/birth_date) | Sigue sin ejecutar. Confirmado en código: `document_id_enc`/`document_id_hash` existen sin caller real (seguridad-2).                                                                                                                                                                                                                                                                                             | **Sí cambia el framing**: antes era "atraso", ahora es "peor que no haber empezado" — infraestructura visible ante un auditor, dato real sin cifrar. Quedan ~3 meses para vigencia plena de la Ley 21.719. Se agrega recomendación concreta: fijar 1-nov-2026 como fecha de corte en `PLAN_ACCION.md` ya. |
| **product-8** (facturación electrónica SII Chile)                                            | Sin cambios — sigue bloqueado por falta de credenciales SII de Walter. No se re-audita ni se recomienda construir sin eso.                                                                                                                                                                                                                                                                                        | No cambia.                                                                                                                                                                                                                                                                                                |
| **pricing-4** (escalón por sillón) / **pricing-5** (descuento anual)                         | Confirmado en código que siguen sin construirse (`BillingPlan = 'solo'                                                                                                                                                                                                                                                                                                                                            | 'clinica'`, sin variante annual).                                                                                                                                                                                                                                                                         | **Sí cambia el orden de resolución**: esta auditoría identifica que la pieza que realmente los destraba es instrumentar el conteo de seats primero (`pricing-seat-limit-no-enforced`) — sin eso, cualquier escalón o descuento se diseña a ciegas. No corresponde tocar el precio de las pilotos actuales en ningún caso. |
| **Validación de Vercel prod / Stripe Live** (pricing-1)                                      | No verificado directamente en esta ronda (fuera del alcance de los 9 auditores), pero el hallazgo nuevo más fuerte de esta ronda — self-service sin gate de billing (marketing-2b) — es una razón adicional para **no apurar el paso a Stripe Live todavía**: hoy el propio self-service en TEST no genera ingresos aunque se activara Live, porque el flujo de checkout ni siquiera se dispara en el onboarding. | **Sí cambia la recomendación**: antes de repetir la creación de precios en Stripe LIVE, resolver primero el gate de billing (marketing-2b) y el antifraude de trial (pricing-trial-sin-antifraude) — de lo contrario pasar a Live no cambia nada del problema de fondo.                                   |
| **Backups automáticos** (.github/workflows/backup.yml fallaban 4/4)                          | La alerta por GitHub Issue que se agregó sí funciona (efecto secundario positivo: permitió confirmar que siguen fallando). La causa raíz (secrets de B2/offsite faltantes) **sigue sin resolver**, y empeoró en cobertura temporal: ahora son 7+ corridas consecutivas de falla, no 4.                                                                                                                            | **No cambia la naturaleza del problema, pero sí la urgencia** — es el hallazgo #1 de esta ronda (seguridad-1). Cuanto más tiempo pasa con PHI real de pilotos sin ningún backup offsite, más grave es la exposición si algo le pasa a la cuenta de Supabase.                                              |

**Comunicaciones y Operación/GTM** fallaron en la ronda inicial (contenido de placeholder) y se repitieron en una segunda pasada dedicada — ver §3.7 y §3.9. Con eso, las 9 áreas quedan cubiertas con contenido real. El hallazgo más urgente que aportó el repaso es **F1** (botón de email del aviso de 3h siempre falla, bug reproducible ya en producción) y el refuerzo de **seguridad-1** por un segundo auditor independiente confirmando la misma falta de secrets de B2.

---

## 6. Qué haría primero (extendido a 6 tras el repaso de Comunicaciones/Operación)

1. Pegar los secrets de B2 y confirmar una corrida de backup exitosa (seguridad-1/ops-4, confirmado por dos auditores independientes) — es lo único de toda la lista que, si sale mal, no tiene vuelta atrás.
2. Sembrar el template de email de `appointment_checkin` o sacar el botón (F1) — es el único hallazgo de toda la auditoría que ya es un bug reproducible en producción hoy, no un riesgo latente.
3. Fix de escalado de `SignaturePad` (visual-1/ux-2) — one-liner, dos flujos legales rotos.
4. Banner de alergia en agenda + NuevaCitaDialog (producto-1/ux-1) — dato clínico de mayor riesgo, fix de UI sobre un query que ya existe.
5. Fijar fecha de corte para security-6 Fase 1b en `PLAN_ACCION.md` (seguridad-2) — no es código, es media hora de gestión con ~3 meses de margen real.
6. Instrumentar el conteo de seats por clínica (pricing-seat-limit-no-enforced) — destraba pricing-4, pricing-5 y la decisión de cuándo cerrar el precio fundador con datos en vez de intuición.
