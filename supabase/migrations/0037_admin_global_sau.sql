-- Administrador global de SAU, explícito y cerrado.
--
-- NO APLICADA. Espera aprobación: cambia quién puede acceder a qué.
--
-- ESTO ES URGENTE. No es solo una limpieza del modelo descartado.
--
-- La definición que corre en producción NO es la de la migración 0001: se
-- reescribió a mano en algún momento y el archivo nunca se actualizó. La real es:
--
--   es_contadora_o_admin() =
--        profile.es_sau_admin = true
--     OR membresía con rol 'contadora' o 'admin' en CUALQUIER empresa
--
-- O sea que `es_sau_admin` ya gobierna las 21 policies. Y, comprobado el
-- 01/10/2026, cualquier usuario logueado podía ponerse ese atributo solo:
--
--   PATCH /profile?id=eq.<el suyo>   { "es_sau_admin": true }
--
-- Eso le daba, de una llamada, acceso de lectura a TODAS las empresas de SAU:
-- ventas, compras, cajas, equipos, montos del taller. Lo verifiqué con una
-- cuenta de prueba, que pasó de ver 1 empresa a ver las 8, y la revertí.
--
-- El segundo problema, el que venía del modelo descartado: ser admin de UNA
-- empresa alcanza para entrar a TODAS. El rol de la membresía no dice nada
-- sobre SAU, dice algo sobre esa empresa.
--
-- El reemplazo es un atributo de la persona: es_sau_admin. Pero primero hay que
-- cerrarlo, porque hoy está abierto de par en par.

-- ── 1. Cerrar la escalada de privilegios ──────────────────────────
-- Está en 0037a_cerrar_escalada.sql, separada para poder aplicarla sola y ya.
-- Esta migración da por hecho que 0037a corrió antes.

-- ── 2. La condición explícita ─────────────────────────────────────

create or replace function es_admin_sau()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.es_sau_admin from profile p where p.id = auth.uid()), false)
$$;

grant execute on function es_admin_sau() to authenticated;

comment on function es_admin_sau() is
  'Administración global de SAU: configurar empresas y dar soporte. Es un atributo de la persona, no de una membresía. Solo se asigna con SQL y la bandera sau.admin_global.';

-- ── 3. El atajo pasa a significar otra cosa ───────────────────────
-- Se redefine el cuerpo en vez de reescribir las 21 policies que lo nombran.
-- Es el cambio más chico que logra el efecto completo, y deja una sola línea
-- para revisar en vez de veintiuna. El nombre queda mintiendo; renombrarlo es
-- una limpieza aparte, cuando esto esté asentado.
--
-- A partir de acá, ser 'admin' o 'contadora' en la membresía de una empresa NO
-- da ningún acceso fuera de esa empresa.

create or replace function es_contadora_o_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin_sau()
$$;

comment on function es_contadora_o_admin() is
  'OBSOLETA en el nombre: hoy devuelve es_admin_sau(). Se conserva porque la nombran 21 policies. No agregar usos nuevos.';

-- ── 4. Lo mismo adentro del taller ────────────────────────────────
-- tiene_permiso_taller arrancaba con el mismo atajo. Queda igual de forma,
-- pero ahora la primera condición es el administrador global de verdad, y el
-- rol de la membresía solo vale dentro de SU empresa.

create or replace function tiene_permiso_taller(p_empresa uuid, p_permiso text)
returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin_sau() or exists (
    select 1 from membresia m
    where m.usuario_id = auth.uid()
      and m.empresa_id = p_empresa
      and m.activa = true
      and (m.rol in ('contadora','admin') or p_permiso = any(m.permisos))
  );
$$;

-- Ojo: adentro del exists, `m.rol in ('contadora','admin')` sigue valiendo, y
-- está bien: ahí ya está acotado a la empresa de la fila. Lo que se corrigió
-- es que ese rol dejara de abrir las puertas de las demás.

-- ── 5. Se deja de generar trabajo del servicio descartado ─────────
-- Las tareas que ya existen NO se tocan: son 12 filas históricas y quedan
-- donde están. Lo que se corta es que se sigan creando, y eso vive en la edge
-- function crear-cliente, no acá.
