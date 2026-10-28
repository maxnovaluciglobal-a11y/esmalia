# Protección de rama de `main` (preparada, no activada)

Estado al 28-oct-2026: `main` **no** está protegido. Comprobado con la API pública: `curl https://api.github.com/repos/maxnovaluciglobal-a11y/esmalia/branches/main` → `"protected": false`, `required_status_checks.enforcement_level: "off"`. Hoy «PR con CI verde» es una convención de quien trabaja, no una barrera: un push directo o un merge con CI rojo despliega igual, porque **Vercel publica a producción en cada push a `main`**.

Este documento deja listo el comando y las reglas. **Activarlo lo decide Walter.** Nada de esto se aplicó.

## Qué se activaría

Script: `scripts/proteger-main.sh` (sin argumentos solo muestra el estado y las reglas; `--aplicar` las pone; `--quitar` las saca).

| Regla                             | Valor                                                            | Por qué                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Checks obligatorios               | `typecheck`, `lint`, `test` (jobs de `.github/workflows/ci.yml`) | Son los que hoy pasan en cada PR y en `main`. Verificado en la API de check-runs del commit `976bb6c`.      |
| `strict` (rama al día con `main`) | **No**                                                           | Con varios PR en paralelo obligaría a rebasar cada uno después de cada merge.                               |
| PR obligatorio                    | Sí, con **0** aprobaciones                                       | Bloquea el push directo. 0 aprobaciones porque hay un solo mantenedor: GitHub no deja aprobar el propio PR. |
| Historia lineal                   | Sí                                                               | La convención ya es squash (`gh pr merge N --squash --delete-branch`).                                      |
| Force-push y borrar la rama       | Prohibidos                                                       | Es la regla 3 del `CLAUDE.md`, hecha técnica.                                                               |
| `enforce_admins`                  | **No**                                                           | El dueño puede saltarse la protección en una emergencia. Con `true` ni él podría; se decide abajo.          |
| Conversaciones resueltas          | No exigido                                                       | Nadie las usa hoy.                                                                                          |

## Cómo activarlo

Hace falta una cuenta con **ADMIN** sobre el repo. La cuenta de trabajo (`walterlamadriz-ai`) tiene solo `write` (verificado: `gh api repos/maxnovaluciglobal-a11y/esmalia --jq .permissions` → `admin: false`), así que lo corre el dueño (`maxnovaluciglobal-a11y`) o se hace desde la web:

```bash
gh auth status                                  # tiene que ser el dueño
bash scripts/proteger-main.sh                   # mira estado y reglas, no cambia nada
bash scripts/proteger-main.sh --aplicar         # activa
curl -s https://api.github.com/repos/maxnovaluciglobal-a11y/esmalia/branches/main | grep '"protected"'   # → true
```

Por la web: Settings → Branches → Add branch ruleset / protection rule para `main`, con la tabla de arriba.

Prueba recomendada justo después: abrir un PR de prueba con un test que falla y comprobar que el botón de merge queda bloqueado; y que un PR verde se mergea con `gh pr merge N --squash --delete-branch`.

## Reversa de emergencia

```bash
bash scripts/proteger-main.sh --quitar
```

## Riesgos y cosas a saber antes de activar

1. **El nombre de los checks tiene que coincidir.** Si alguien renombra un job de `ci.yml` (`typecheck`, `lint`, `test`), ese check obligatorio deja de llegar y **todo merge queda esperando para siempre**. Hay que volver a correr `--aplicar` con el nombre nuevo.
2. **Vercel despliega al hacer push, no antes.** La protección impide mergear con CI rojo, pero un build de Vercel que falle después del merge igual deja `main` con un deploy en error (el anterior sigue sirviendo). Para que producción _espere_ a CI existe «Deployment Checks» en Vercel (el team está en Pro según el `CLAUDE.md`; **no verifiqué** que esa función esté incluida en el plan): exige que checks de GitHub pasen antes de promover el deploy a producción. Se configura en la consola de Vercel (proyecto `esmalia` → Settings; **el nombre exacto de la opción no lo comprobé, verificarlo en la consola**). No lo configuré.
3. **No incluí el check `Vercel` como obligatorio** a propósito: es el build de preview, y un preview que falla por algo ajeno (cuota, red) bloquearía merges que no tienen nada de malo. Se puede sumar después con `"Vercel"` en `contexts`.
4. **Si el repo pasa a privado** (pregunta 4 del plan transversal), la protección de rama de repos privados **puede requerir un plan de pago de GitHub** (así lo indica el plan transversal y no lo confirmé); hoy el repo es público y no lo necesita. Verificar el plan antes de hacerlo privado, o la protección podría dejar de aplicarse.
5. **Quien mergea:** la cuenta de trabajo (`write`) podrá mergear PR con CI verde y no podrá pushear directo. El dueño sigue pudiendo saltársela (por `enforce_admins: false`). Si Walter prefiere que ni el dueño pueda, cambiar a `true` en el script; el costo es que un hotfix urgente con CI roto exige primero `--quitar`.
6. **El workflow de CI no tiene filtro de rutas** (`on: pull_request` a secas), así que un PR solo de docs también corre los tres checks y no queda esperando uno que nunca llega. Si algún día se agrega `paths-ignore` al CI, hay que revisar esto (un check obligatorio que no corre bloquea el merge).
7. **`sync_with_base_branch` / merges de `main` a la rama de trabajo** siguen funcionando; la historia lineal solo se exige en `main`.
8. **No protege los tags ni las ramas de trabajo**, y no reemplaza el control de quién puede tocar los secrets de Actions (la clave del backup está ahí; ver `docs/BACKUPS.md`).

## Alternativa: rulesets

GitHub también ofrece _rulesets_ (más flexibles, con lista de quién puede saltárselos). La protección clásica de arriba basta con un solo mantenedor; si se suma más gente, conviene pasar a un ruleset.
