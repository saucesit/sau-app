-- A qué módulo entra cada empresa después del login.
--
-- Hoy todos caen en `/`, y para una empresa con un solo módulo esa pantalla no
-- sirve: Forani aterriza en un Inicio que le dice "Todavía no hay módulos
-- activos" —el Dashboard no conocía el taller— cuando en realidad tiene uno.
--
-- La decisión es de la empresa, no del email ni del nombre: una columna que
-- dice cuál es su módulo principal. Explícita y predecible, para que el día que
-- una empresa sume un segundo módulo su entrada no cambie sola.
--
-- Cuando está vacía, la pantalla deduce: si la empresa tiene exactamente un
-- módulo activo con ruta conocida, entra ahí; si no, a `/` como siempre.
--
-- Esto es NAVEGACIÓN, no autorización. No concede ni quita nada: quien entra a
-- su módulo sigue viendo exactamente lo que sus permisos y las policies le
-- permiten. Ningún permiso, membresía ni policy se toca en esta migración.

alter table empresa
  add column if not exists modulo_inicio text;

comment on column empresa.modulo_inicio is
  'Módulo al que entra el usuario después del login. Si es null, la pantalla deduce: un único módulo activo entra ahí, varios van al Inicio general.';

-- Tiene que ser uno de los módulos que existen, y además estar activo en la
-- empresa: configurar un inicio que la empresa no tiene sería mandar a alguien
-- a una pantalla cerrada.
alter table empresa drop constraint if exists empresa_modulo_inicio_check;
alter table empresa add constraint empresa_modulo_inicio_check
  check (
    modulo_inicio is null
    or (
      modulo_inicio = any (array['ventas','caja','compras','equipo','stock',
                                 'fiado','presupuestos','agente','taller'])
      and modulo_inicio = any (modulos_activos)
    )
  );

-- TALLER FORANI entra al taller. Es el único con configuración explícita por
-- ahora; el resto queda en null y la regla derivada los resuelve igual.
update empresa
   set modulo_inicio = 'taller'
 where nombre_fantasia = 'TALLER FORANI'
   and 'taller' = any (modulos_activos);

select json_build_object(
  'configurados', (select json_agg(json_build_object(
     'empresa', nombre_fantasia, 'inicio', modulo_inicio))
     from empresa where modulo_inicio is not null),
  'derivados', (select json_agg(json_build_object(
     'empresa', nombre_fantasia, 'unico_modulo', modulos_activos[1]))
     from empresa
    where modulo_inicio is null and array_length(modulos_activos, 1) = 1),
  'al_inicio_general', (select json_agg(nombre_fantasia)
     from empresa
    where modulo_inicio is null and coalesce(array_length(modulos_activos, 1), 0) <> 1)
) as resultado;
