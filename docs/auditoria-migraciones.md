# Auditoría de las migraciones — 29/09/2026

Revisión **estática** de las 32 migraciones (`0001` a `0032`) más una lectura del
catálogo de la base de producción, para saber qué falta para reconstruir el
esquema desde cero.

> **Esto no prueba que las migraciones funcionen.** Nadie las ejecutó nunca
> contra una base vacía, y no se puede hacer hasta tener el entorno separado.
> Lo que sigue son problemas detectables leyendo, más una lista aparte de cosas
> que solo se van a ver al ejecutarlas.

Método: análisis de dependencias sobre el texto de las migraciones (qué crea cada
una y en qué orden), contrastado con `pg_tables`, `pg_proc`, `pg_trigger`,
`pg_policies`, `pg_type`, `pg_extension` y `storage.buckets` de producción. Todo
de lectura; no se escribió nada.

---

## A. Errores comprobables por lectura

Estos se ven sin ejecutar nada y **frenan el arranque de una base vacía**.

### A1. `0019` y `0021` hacen `alter table presupuesto`, y ninguna migración crea esa tabla

```
0019_presupuesto_enviado.sql       alter table presupuesto add column enviado …
0021_presupuesto_tiene_cambios.sql alter table presupuesto add column tiene_cambios …
```

`supabase start` va a cortar en `0019` con `relation "presupuesto" does not exist`.
Es el primer punto de falla y es seguro.

### A2. Siete tablas de producción no las crea ninguna migración

| Tabla | Filas hoy | Policies | La usa |
|---|---|---|---|
| `presupuesto` | 2 | 1 | Presupuestos (Fede) |
| `presupuesto_item` | 2 | 1 | Presupuestos |
| `plantilla_presupuesto` | 3 | 1 | Presupuestos |
| `catalogo_item` | 0 | 1 | Presupuestos |
| `pedido` | 0 | 2 | Pedidos públicos |
| `tarea_contadora` | 12 | 1 | Panel de la contadora |
| `leads_nico` | 1 | **0** | Captación de leads |

Se crearon a mano en el panel de Supabase. **El módulo de presupuestos entero no
tiene migraciones.** Su estructura quedó capturada en
[`auditoria-migraciones/ddl-capturado.sql`](auditoria-migraciones/ddl-capturado.sql).

### A3. El trigger de saldo de fiado de producción no es el de la migración

| | Migración `0013` | Producción |
|---|---|---|
| Función | `fn_actualizar_saldo_fiado` | `actualizar_saldo_fiado` |
| Trigger | `trg_actualizar_saldo_fiado` | `trg_saldo_fiado` |
| Eventos | `after insert` | `after insert or update or delete` |
| Usa | `NEW.cliente_fiado_id` | `coalesce(NEW…, OLD…)` |
| Toca `updated_at` | sí | no |
| `security definer` | sí | no |

Producción corre una versión reescrita a mano que la migración nunca reflejó.
Una base creada desde cero se queda con la vieja, que **no recalcula el saldo al
borrar ni al editar un movimiento**. Es una diferencia de comportamiento, no de
nombres.

### A4. El bucket `consultas` no lo crea ninguna migración

`0025` crea el bucket `taller` con sus dos policies. El bucket `consultas`
—**público**— y sus policies `lecturas publicas consultas` / `uploads publicos
consultas` se hicieron a mano. Una base nueva no los tiene y la carga de audios
de consultas falla.

### A5. Función huérfana en producción

`taller_crear_monto()` sigue existiendo aunque `0026` borró su trigger y la
reemplazó por `taller_alta_vehiculo()`. No hace daño —nada la invoca— pero es
ruido que conviene limpiar.

---

## B. Observaciones que no bloquean el arranque

- **El bucket `consultas` acepta subidas de `anon`.** La policy `uploads publicos
  consultas` es `for insert to anon, authenticated with check (bucket_id =
  'consultas')`: con la anon key —que está en el navegador— cualquiera puede
  escribir archivos en un bucket público, sin límite de cantidad. Es
  preexistente y no tiene que ver con esta auditoría, pero lo dejo anotado para
  revisarlo aparte.
- **`leads_nico` tiene RLS activo y cero policies.** Nadie puede leerla por la
  API; solo `service_role`. Tiene una fila con nombre, teléfono y email de una
  persona. Funciona por accidente, no por diseño.
- **No hay trigger en `auth.users`.** Las filas de `profile` las crean las edge
  functions. En una base nueva, alguien que se registre por la app queda sin
  perfil. Es el comportamiento actual, no una regresión.
- **`0001` usa `create type` y `create table` sin `if not exists`.** Para una base
  vacía está bien; solo importa si alguna vez se reaplica.
- **Extensiones:** producción tiene `pgcrypto` y `uuid-ossp`. Ninguna migración
  las declara, pero tampoco las usan: `gen_random_uuid()` es nativo desde PG 13.
  Sí las usa `scripts/seed-pruebas-taller.sql` (`crypt`, `gen_salt`), que no es
  una migración.
- **Versión de Postgres:** producción es **17.6** y el `config.toml` local quedó
  en `major_version = 17`. Coinciden.

---

## C. Lo que solo se va a saber ejecutando

No lo puedo afirmar leyendo. Son los candidatos a romper después de A1–A4:

1. **Orden real de las 32.** El análisis de dependencias no encontró más tablas
   ni funciones usadas antes de existir, pero solo cubre `alter`, `references`,
   `create policy`, `create trigger`, `insert` y `update`. **Los cuerpos de las
   funciones no se validan al crearlas**, así que una función que consulte una
   tabla inexistente se crea igual y falla recién al llamarla.
2. **Policies que se pisan.** Varias migraciones redefinen policies de otras
   (`0008`, `0009`, `0026` sobre `0025`, `0031` sobre `0001`). El resultado final
   de aplicarlas en orden puede no ser el que tiene producción hoy.
3. **Columnas agregadas a mano** que no aparecen en ningún `alter`. Comparé
   tablas, tipos, funciones, triggers, policies y buckets, pero **no comparé
   columna por columna** de las 26 tablas que sí tienen migración.
4. **Edge functions.** Necesitan secretos propios: `ANTHROPIC_API_KEY`,
   `GROQ_API_KEY`, `CALLMEBOT_API_KEY`, `WA_VERIFY_TOKEN`. Sin ellos las
   funciones del agente y del webhook no arrancan, aunque el taller sí anda.
5. **`supabase start` en sí.** Nunca se corrió en esta máquina.

---

## D. Propuesta de corrección, sin tocar la base existente

**No reescribir `0001`–`0032`.** Están aplicadas en producción y no hay tabla de
control; editarlas no cambia nada en la base real y solo rompe la trazabilidad
de lo que de verdad se corrió.

En cambio, una migración nueva **`0033_esquema_faltante.sql`** que:

1. Cree las siete tablas de A2 con `create table if not exists`, sus constraints y
   sus policies (`drop policy if exists` + `create policy`).
2. Cree la función y el trigger de fiado de A3 **con los nombres y el cuerpo que
   ya tiene producción**, y borre los de `0013` si existen.
3. Cree el bucket `consultas` con `on conflict do nothing` y sus dos policies.
4. Borre `taller_crear_monto()` de A5.

Escrita así, **aplicada contra producción no cambia absolutamente nada** —todo ya
existe— y aplicada contra una base vacía la completa. Eso es lo que la vuelve
segura: es idempotente por construcción.

Queda un problema de orden: `0019` y `0021` corren **antes** que `0033` y siguen
fallando. Dos salidas:

- **Renumerar** el archivo como `0018b_presupuestos.sql`, que se ordena antes de
  `0019`. Cambia el orden histórico pero no el contenido de ninguna migración ya
  aplicada.
- **Envolver** los `alter` de `0019` y `0021` en un `do $$ … if exists … end $$`.
  Esto sí toca dos migraciones históricas, pero de forma inocua: en producción
  las columnas ya están y el bloque no hace nada.

Prefiero la primera: no toca archivos aplicados.

**Nada de esto está escrito todavía.** Espero tu OK.

---

## E. Qué no revisé

- Columna por columna de las 26 tablas que sí tienen migración (ver C3).
- Índices.
- Los cuerpos de las funciones del taller contra su versión en producción.
- Grants.
- Si las edge functions del repositorio son las que están desplegadas.
