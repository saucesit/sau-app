# Entorno de pruebas local

Estado: **preparado, sin ejecutar.** Falta instalar Docker y falta resolver lo
que impide levantar una base vacía (ver [auditoria-migraciones.md](auditoria-migraciones.md)).

Qué base usa cada cosa:

| Comando | Base |
|---|---|
| `npm run dev` | la de `.env.local` → **producción** |
| `npm run dev:local` | la de `.env.desarrollo` → **local, descartable** |

---

## Lo que ya está en la rama

| Archivo | Qué es |
|---|---|
| `supabase/config.toml` | Config del stack local. Postgres 17 (igual que producción), `site_url` apuntando a `localhost:5173`, confirmación de email apagada |
| `supabase/seed.sql` | Datos ficticios: dos empresas inventadas, 12 vehículos en las seis etapas con excepciones y demoras, 6 entregados repartidos en tres años, y un catálogo mínimo de almacén. Lo corre solo `supabase db reset` |
| `scripts/seed-usuarios-locales.sql` | Los siete usuarios de prueba. La contraseña se pasa por parámetro y no queda versionada |
| `.env.desarrollo.example` | Plantilla de las variables locales |
| `npm run dev:local` | Levanta Vite en modo `desarrollo` y con `--host`, para entrar desde el celular |

Ningún archivo contiene contraseñas, claves ni datos de clientes.

## Lo que falta ejecutar

1. Liberar espacio en `C:` (hoy quedan 2,7 GB y hacen falta ~15).
2. `wsl --install` y reiniciar.
3. Instalar Docker Desktop y mover su disco a `D:`.
4. **Saltear `0019` y `0021`.** Son las dos únicas migraciones que rompen contra
   una base vacía: hacen `alter table presupuesto` y esa tabla no la crea
   ninguna migración. Se comprobó que son las **únicas** referencias duras a las
   siete tablas que faltan — el resto son comentarios. Sacándolas de la carpeta,
   el taller queda completo y solo quedan inutilizables Presupuestos, Pedidos y
   el panel de la contadora, que no entran en esta prueba. Así no hace falta
   decidir todavía lo de `0018b`.
5. `supabase start`.
6. Copiar `.env.desarrollo.example` a `.env.desarrollo` y completarlo con lo que
   imprima `supabase status`.
7. Crear los usuarios:
   ```
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
        -v clave="LaQueElijas" -f scripts/seed-usuarios-locales.sql
   ```
8. `npm run dev:local`.
9. Verificar la facturación:
   ```
   SUPA_PASS="LaQueElijas" node scripts/pruebas-facturacion.mjs
   ```
   Corta sola si detecta que apunta a un `supabase.co`, para que no se dispare
   contra producción por descuido.

## Usuarios que crea el paso 7

Todos con la misma contraseña, la que se pase por `-v clave`.

| Email | Empresa | Para qué sirve |
|---|---|---|
| `duena@local.test` | Chapería del Valle | Ve todo, incluido ADMIN |
| `encargado@local.test` | Chapería del Valle | Valida y ve montos, no marca trabajo |
| `chapista@local.test` | Chapería del Valle | Marca solo en Chapa y Preparación |
| `pintor@local.test` | Chapería del Valle | Marca solo en Pintura y Pre Entrega |
| `recepcion@local.test` | Chapería del Valle | Carga vehículos, **no ve montos** |
| `sinetapas@local.test` | Chapería del Valle | Permiso de trabajar sin etapas: reproduce el caso que quedó abierto |
| `almacen@local.test` | La Esquina | El resto de SAU, para verificar que el taller no se le filtra |

## Recorrido completo desde el celular

Con `npm run dev:local`, entrando por `http://<IP-de-la-PC>:5173` desde la misma
red. Todo con **un solo vehículo**, que es lo que de verdad cierra la prueba.

1. Entrar como `recepcion@local.test` y cargar un vehículo nuevo con teléfono.
2. **Cámara:** sacar una foto. Tiene que aparecer en la lista.
3. **Galería:** agregar 2 o 3 ya existentes. El contador **suma**, no reinicia.
4. **Tercera tanda:** repetir, e incluir a propósito una foto ya cargada. No
   debería duplicarse.
5. **Quitar:** sacar una con la ✕ y confirmar que esa no se sube.
6. Adjuntar la orden interna en PDF y guardar. Verificar el bloque RESPALDO.
7. Avanzar el vehículo por las etapas: marcar con `chapista@local.test` y
   `pintor@local.test`, validar con `encargado@local.test`.
8. **Entregarlo** desde `encargado@local.test`.
9. Ir a ENTREGADOS, **buscarlo por patente** y confirmar que conserva todas las
   fotos, el PDF y la bitácora completa, incluidos los eventos de cada etapa.

Mirar con ojo crítico: si el iPhone **hace zoom** al enfocar un campo (no
debería), si el riel entra sin cortarse, y si la cadena de etapas se lee.

### Si el celular no carga

En este orden:

1. Que `npm run dev:local` haya impreso una línea **Network:**, no solo Local.
2. Confirmar la IP actual de la PC (`ipconfig`): es DHCP y cambia.
3. Que los dos dispositivos estén en la misma red, sin red de invitados de por
   medio.
4. Recién ahí, el firewall.
