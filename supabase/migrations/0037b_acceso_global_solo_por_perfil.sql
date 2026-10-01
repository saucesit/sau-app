-- El acceso entre empresas pasa a depender solo de profile.es_sau_admin.
--
-- Única cosa que hace esta migración. Lo ajeno a ese objetivo —retirar rutas,
-- menús y la generación de tareas del servicio contable— queda afuera, en la
-- rama, sin aplicar.
--
-- Qué cierra, comprobado el 01/10/2026 contra la base: quien tiene
-- `empresa.admin` en una empresa podía hacer
--
--   PATCH /membresia?id=eq.<la suya>   { "rol": "admin" }
--
-- y pasaba de ver 1 empresa a ver las 8, con 36 vehículos y sus montos. La
-- policy membresia_update deja editar las membresías de la propia empresa sin
-- restricción de columnas, y el rol 'admin' abría las puertas de las demás.
--
-- La raíz no es esa policy: es que cuatro funciones trataban el rol de UNA
-- membresía como si dijera algo sobre SAU. Se corta ahí, que es donde se
-- arregla una vez y no cuatro.
--
-- Requiere 0037a aplicada: sin el cierre de la escalada por el perfil, mover
-- el acceso global a es_sau_admin sería mudarse a una puerta abierta.

-- ── 1. La condición explícita ─────────────────────────────────────
-- Consulta exclusivamente al usuario autenticado: filtra por auth.uid() y
-- devuelve una sola fila. No mira membresías ni roles.
--
-- search_path fijo y referencias calificadas: es security definer, así que sin
-- eso alguien con permiso de crear objetos podría anteponer un esquema con una
-- tabla `profile` falsa y hacerla devolver true.

create or replace function public.es_admin_sau()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select p.es_sau_admin from public.profile p where p.id = auth.uid()),
    false)
$$;

revoke all on function public.es_admin_sau() from public, anon;
grant execute on function public.es_admin_sau() to authenticated;

comment on function public.es_admin_sau() is
  'Administración global de SAU. Atributo de la persona (profile.es_sau_admin), protegido por 0037a. El rol de una membresía NO otorga acceso global.';

-- ── 2. El atajo principal ─────────────────────────────────────────
-- Se redefine el cuerpo en vez de reescribir las 21 policies que la nombran:
-- una línea para revisar en lugar de veintiuna, y el mismo efecto.
-- Se le agrega el search_path que no tenía.

create or replace function public.es_contadora_o_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.es_admin_sau()
$$;

comment on function public.es_contadora_o_admin() is
  'OBSOLETA en el nombre: hoy devuelve es_admin_sau(). Se conserva porque la nombran 21 policies. No agregar usos nuevos.';

-- ── 3. El atajo del taller ────────────────────────────────────────
-- Misma forma de antes. Lo que cambia es que la primera condición ahora es el
-- administrador global de verdad.
--
-- La segunda conserva `m.rol in ('contadora','admin')`, y está bien: ahí ya
-- está acotada a la empresa de la fila. Lo que se corrigió es que ese rol
-- dejara de abrir las puertas de las demás empresas.

create or replace function public.tiene_permiso_taller(p_empresa uuid, p_permiso text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.es_admin_sau() or exists (
    select 1 from public.membresia m
    where m.usuario_id = auth.uid()
      and m.empresa_id = p_empresa
      and m.activa = true
      and (m.rol in ('contadora','admin') or p_permiso = any(m.permisos))
  );
$$;

-- ── 4. El cuarto atajo, que no usa nadie pero está armado ─────────
-- tiene_permiso(p) preguntaba "¿tenés este permiso en ALGUNA empresa?" y
-- aceptaba el rol como comodín, sin acotar a ninguna. Hoy no la nombra ninguna
-- policy ni ninguna función —está muerta—, pero es una trampa puesta para el
-- próximo que la use. Se corrige con el mismo criterio y se le pone search_path.

create or replace function public.tiene_permiso(p text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.es_admin_sau() or exists (
    select 1 from public.membresia m
    where m.usuario_id = auth.uid()
      and m.activa = true
      and p = any(m.permisos)
  )
$$;

comment on function public.tiene_permiso(p text) is
  'No la usa ninguna policy. No dice en QUÉ empresa: si hace falta un permiso por empresa, usar tiene_permiso_taller o es_admin_de_empresa.';

-- ── 5. search_path a la que faltaba ───────────────────────────────
-- empresas_del_usuario() es security definer y la nombran varias policies.
-- No cambia su lógica.

create or replace function public.empresas_del_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.empresa_id from public.membresia m
  where m.usuario_id = auth.uid() and m.activa = true
$$;

-- ── Lo que NO toca esta migración ─────────────────────────────────
-- es_admin_de_empresa(p_empresa) sigue igual. Acepta rol 'admin'/'contadora'
-- DENTRO de la empresa que recibe, así que no cruza a ninguna otra. Que alguien
-- con empresa.admin pueda darse ese rol en SU empresa es elevación interna, no
-- acceso entre empresas, y queda informado aparte.
