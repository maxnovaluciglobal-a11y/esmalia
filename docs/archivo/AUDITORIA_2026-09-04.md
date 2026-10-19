> **Archivado el 2026-10-19: histórico, no vigente.** Lo reemplaza la auditoría 360 total del 18-oct-2026 (fuera del repo: `04 - Esmalia/00 - Gestion/auditorias/2026-10-18-auditoria-360-total/`); lo que quedó por hacer está en [`docs/ROADMAP.md`](../ROADMAP.md). Se conserva como registro de cómo se pensó y decidió en su momento; no lo uses como fuente de estado ni de planes. Las rutas `docs/…` que aparecen abajo apuntan a la ubicación anterior (hoy `docs/archivo/`). Motivo: hallazgo GOB-03 de la auditoría 360 del 18-oct-2026.

# Auditoría multi-agente — 4 de septiembre de 2026

Cuatro agentes revisaron en paralelo todo lo construido ese día (Tandas A, B y
C del plan competitivo contra Dentalink): seguridad y RLS, correctitud del
dinero, accesibilidad y UX, y deuda técnica/drift de tipos.

Este documento es el registro completo. Lo **corregido** está en el commit de
correcciones y en la migración `20260904180000_correcciones_auditoria.sql`; lo
**pendiente** está al final con su razón.

---

## Corregido

### Dinero

| #   | Hallazgo                                                                                                                                                                                                                                                                                                    | Dónde estaba                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| D1  | **El descuento comercial nunca bajaba a las líneas.** Se restaba solo al total del presupuesto, pero el trigger de conversión copia `quote_items.total_cents` → `treatment_items.price_cents`, y de ahí sale el saldo. Un 20 % de descuento se veía en el presupuesto y el paciente igual debía el 100 %.   | `finance.functions.ts` · `computeQuoteTotals` |
| D2  | **El semáforo de cobro por línea era código muerto.** `paidCentsByItem` lee `payments.treatment_item_id`; `registerPayment` no aceptaba ese campo, así que la columna nunca se escribía. Ninguna línea podía salir de "sin pagos imputados".                                                                | `finance.functions.ts` · `registerPayment`    |
| D3  | **Dos números distintos para el saldo en la misma página.** La tarjeta de FinanceSection sumaba `priceCents` y el encabezado `patientCents`. Con convenio al 60 %, el encabezado decía "Debe $40.000" y la tarjeta "$100.000". Mismo error en el subtotal por fase y en el semáforo.                        | `finance-section.tsx`                         |
| D4  | **Un presupuesto podía duplicar la deuda.** La guarda del trigger era `OLD.status = 'accepted'`, pero el trigger termina con `NEW.status := 'converted'`: la fila persistida nunca queda en `'accepted'`, así que la condición jamás volvía a ser cierta. Re-aceptar creaba otro plan con los mismos ítems. | `convert_accepted_quote_to_plan`              |

**D1 y D4 se agravan mutuamente** y son los dos que más plata mueven. D4 venía
de la migración original de agosto; las dos reescrituras de septiembre (fases y
convenios) lo arrastraron sin verlo.

**Sobre D2 — falla de verificación, no solo de código.** Verifiqué el semáforo
insertando el pago directo por API en vez de usar la app. El render se veía
correcto y el camino de escritura estaba roto. La lección: verificar el camino
completo, no el estado final que uno mismo fabricó.

### Permisos

| #   | Hallazgo                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `getAppointmentPatientBalances` validaba `finance:view` **solo en el navegador**. El JWT vive en `localStorage`, así que una recepcionista podía pedir el saldo exacto de 500 pacientes en un request. `requireFinanceView` ya existía para exactamente este gap.                     |
| P2  | `lab_orders.cost_cents` —lo que la clínica le paga al proveedor— era visible para todo el equipo clínico, cuando `expenses`, el mismo tipo de dato, sí estaba restringido. De paso, `accounting` estaba excluido de la tabla y entraba a `/laboratorios` para ver una pantalla vacía. |
| P3  | `created_by` era falsificable en las cuatro tablas nuevas: el default `auth.uid()` solo aplica si el cliente omite la columna, y ningún `WITH CHECK` lo exigía. Un contador podía cargar un gasto a nombre del dueño.                                                                 |
| P4  | `agreement_coverage` no validaba que el convenio y la prestación fueran de la misma clínica que la fila. Impacto de integridad, no de confidencialidad.                                                                                                                               |

### Accesibilidad y UX

| #   | Hallazgo                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **El foco no se veía en ningún campo nuevo.** `focus:border-brand/50` da 1.42:1 en modo claro — un matiz, no un indicador. El repo ya tenía la solución escrita en `filters.tsx`. 20 sitios.                                                                                                                                                                                                 |
| A2  | `ItemStatusPicker` sin nombre accesible: en un plan de diez ítems, diez comboboxes que se anuncian igual.                                                                                                                                                                                                                                                                                    |
| A3  | **Mensajes de error que mienten.** "No tienes permisos para X" se disparaba ante _cualquier_ fallo de escritura y concatenaba el texto crudo de Postgres. Un nombre de medio de pago repetido decía "No tienes permisos" y mostraba `duplicate key value violates unique constraint` — mandaba al usuario a buscar en la dirección equivocada. 25 sitios; `mensajeDb` existe justo para eso. |

### Herramienta

| #   | Hallazgo                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | **Un carácter invisible se coló por tercera vez el mismo día**: un byte NUL como centinela de un `Map`, y dos regex de diacríticos con los caracteres combinantes literales. Ni el typecheck ni el lint los ven. Ahora `scripts/check-invisibles.mjs` corre en `lint-staged`. Se detectó a sí mismo en el primer intento, lo cual confirma que hacía falta. |

---

## Pendiente, con su razón

### Alto — vale la pena hacerlo pronto

**`supabase login` y retirar el parcheo a mano de `types.ts`.** El CLI está
instalado (v2.114.0) y `package.json` ya tiene el script `types:gen`; lo único
que falta es autenticar. Hoy la regla 4 del CLAUDE.md obliga a parchear los
tipos a mano en cada migración, con el riesgo de drift permanente que eso
implica. La auditoría verificó que **hoy no hay drift** —55/55 tablas, 669/669
columnas, 19/19 enums, 6/6 RPCs— pero eso es suerte sostenida por disciplina,
no una garantía. Conviene además agregar `supabase` como `devDependency` para
que el script no dependa de un binario global.

**Moneda hardcodeada.** ✅ **Cerrado el 05-sep** (tanda de moneda). Ninguna
server function acepta ya `currency`: la fija el trigger
`moneda_desde_la_clinica` desde `clinics.currency`, y las columnas perdieron su
`DEFAULT 'CLP'` para que un trigger caído falle fuerte en vez de escribir Chile
en silencio. `formatMoney`/`toCents`/`fromCents` pasaron a exigir la moneda, y
el locale de formato sale de ella en vez de estar fijo en `es-CL`.

**Dos convenciones de captura de monto conviven.** ✅ **Cerrado el 05-sep.**
Quedó una sola: todo input de dinero es `MoneyInput`, que recibe y devuelve
cents y se encarga de mostrar la unidad visible con el `step` de la moneda. El
texto crudo vive dentro del componente porque, derivándolo del round-trip,
escribir "45." se borraba solo — invisible en CLP, rompedor en MXN. La regla de
sincronización se extrajo a `money-input-sync.ts` y está probada.

### Medio

- **Cobertura del 100 % → el saldo dice "Sin datos".** `getPatient` hace
  `totalBilled === 0 && totalPaid === 0 ? null : balance`. Con un plan
  enteramente cubierto por el convenio, todos los `patient_cents` valen 0 —un
  valor real— y el encabezado muestra "Sin datos" mientras el badge de la
  agenda, sobre el mismo helper, dice "Al día". Es el 0-legítimo-tratado-como-
  ausencia que la regla 11 quiere evitar, en el lugar donde más cuesta verlo.
- **La cobertura de convenios guarda en silencio**, sin toast ni indicador, y
  el toggle `%`/`$` no dispara la mutación: si tocás el toggle y clickeás
  afuera, la pantalla muestra "No cubre" mientras la base conserva el valor
  anterior.
- **`allows_discount` es una regla solo del cliente.** El servidor nunca la
  consulta al calcular el descuento. Impacto acotado (quien puede presupuestar
  ya controla el precio), pero la regla que existe para proteger un convenio no
  se cumple.
- **20 foreign keys ausentes del bloque `Relationships` de `types.ts`.** Cero
  impacto hoy —el código usa solo tres embedded selects, todos sobre relaciones
  declaradas— pero es la trampa exacta que el CLAUDE.md advierte. Se arregla
  solo si se hace el `types:gen`.
- **Tablas con scroll horizontal sin `tabIndex`**: quien no usa mouse no puede
  ver la última columna en pantallas angostas. Cinco tablas nuevas.
- **Contraste en modo claro**: `text-warning` sobre `bg-warning-soft` da 2.72:1
  y el botón "Descartar" del aviso de firma 1.74:1. El modo oscuro pasa todo.
  Se arregla bajando dos tokens en `styles.css`, sin tocar componentes.

### Bajo

- El semáforo de pago distingue estados **solo por matiz** (gris/ámbar/verde),
  sin diferencia de forma. Afecta a ~8 % de los odontólogos varones. La
  corrección compatible con la decisión de no usar texto es variar la forma:
  anillo vacío → medio relleno → macizo.
- El foco se pierde al cerrar el diálogo abierto desde el odontograma: el
  `PopoverTrigger` es un `<span>` sin `tabIndex`, así que Radix devuelve el
  foco a un elemento desmontado y termina en `body`.
- Acordeones sin `aria-expanded` (convenios y las dos secciones de finanzas).
- Un `<Link>` dentro de un `<label>` en `/fusionar-fichas` hace que el radio se
  anuncie con todo el contenido de la fila.
- `laboratorios.tsx` descarta en silencio lo que no parsea como número de pieza.
- El AlertDialog de borrar gasto no dice **cuál** gasto.
- `/medios-de-pago` es la única pantalla nueva sin estado vacío.
- **Diez exports muertos** (lista completa en el informe del agente de deuda).
  El más interesante es `createWarehouse`: no es basura, es un botón que falta.
- **`patient_medical_history_audit`**: la tabla entera no se nombra en `src/`.
  Es un audit trail clínico que se escribe por trigger y no tiene forma de
  leerse. Decisión de producto, no limpieza.
- **`patients.document_id_hash`**: se escribe y tiene índice dedicado, pero
  nada consulta por él. La búsqueda por documento sin descifrar nunca se
  construyó; hoy el índice es solo costo de escritura.
- `gastos.tsx` calcula el período por defecto sin timezone mientras el botón
  "Limpiar" sí la pasa: en una clínica fuera de Chile pueden diferir en un día.

### Duplicación que vale extraer

- `setXActive` — cinco funciones byte-idénticas salvo tabla y sustantivo.
- La mutación crear/editar de los diálogos — cuatro copias del mismo patrón.
- La constante `INPUT` — duplicada en cinco rutas y doce veces más inline.

### Duplicación que conviene dejar

- `list<Catálogo>` con `incluirInactivos`: lo genuinamente compartido son tres
  líneas; el orden, las columnas y el mapper difieren en cada uno.
- Los diálogos en sí: los campos divergen de verdad.

---

## Lo que la auditoría confirmó que está bien

Vale registrarlo para no volver a auditarlo:

- **`merge_patients`** es la función `SECURITY DEFINER` mejor hecha del lote:
  valida rol explícitamente, verifica que ambas fichas sean de la clínica,
  filtra cada UPDATE por `clinic_id`, hace `REVOKE ALL` antes del `GRANT` y
  corre en una sola transacción.
- **`registerPayment`** resuelve la retención leyendo de la base filtrando por
  `id` + `clinic_id` y calcula el neto en el servidor. No acepta el neto ni el
  porcentaje del cliente.
- **`cargarCoberturaDelPaciente`** resuelve el convenio server-side, nunca
  desde el request — lo que decide cuánto debe un paciente no lo manda el
  navegador.
- **`fetchPatientBalances`** usa `?? price_cents` y no `|| price_cents`: un
  `patient_cents` de 0 se respeta en vez de caer al precio de lista.
- **`inventory_stock`** tiene GRANT de escritura pero solo policy de SELECT.
  Parece un olvido y no lo es: RLS es deny-by-default, así que la escritura
  queda cerrada a todos salvo al trigger `SECURITY DEFINER`.
- **`types.ts` sin drift**: 55/55 tablas, 669/669 columnas, 19/19 enums con sus
  valores, 6/6 RPCs con sus firmas.
- **Cero `@ts-ignore`, cero `@ts-expect-error`, cero `@ts-nocheck`** escritos a
  mano en todo el repo.
- **`QuoteItemsEditor`** tiene `aria-label` en cada uno de sus ocho controles,
  incluido el toggle `$`/`%` con etiqueta dinámica.
- Las tarjetas de estado vacío explican el _por qué_, no solo el _qué_, y las
  notas al pie de cada pantalla explican reglas de negocio no obvias.
