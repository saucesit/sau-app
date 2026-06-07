-- =====================================================================
--  Migración 0003 — Permiso RRHH
--  empresa.rrhh → puede gestionar usuarios de la empresa
--                 sin acceder a datos financieros
-- =====================================================================

-- Agregar empresa.rrhh a los permisos del rol dueño (ya lo tiene todo)
-- y dejarlo disponible para asignarlo manualmente a quien corresponda.
-- No se agrega a 'empleado' por defecto — el dueño lo asigna explícitamente.

-- Actualizar la función tiene_permiso para que RRHH
-- pueda gestionar usuarios pero no bypasee permisos financieros.
create or replace function tiene_permiso(p text)
  returns boolean language sql security definer stable as $$
  select exists (
    select 1 from membresia
    where usuario_id = auth.uid()
      and activa = true
      and (p = any(permisos) or rol in ('contadora', 'admin'))
  )
$$;

-- Agregar empresa.rrhh al rol dueno (ya lo tenían pero lo dejamos explícito)
update membresia
  set permisos = array_append(permisos, 'empresa.rrhh')
where rol = 'dueno'
  and not ('empresa.rrhh' = any(permisos));
