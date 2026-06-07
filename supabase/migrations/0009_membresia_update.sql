-- =====================================================================
--  Migración 0009 — Política UPDATE para membresías
--  Sin esta política, los admins no pueden modificar permisos de su equipo.
--  También agrega política SELECT en profile para ver el nombre de los
--  compañeros dentro de la misma empresa.
-- =====================================================================

-- Admins y contadoras pueden actualizar membresías
create policy membresia_update on membresia
  for update using ( es_contadora_o_admin() );

-- Ver perfiles de compañeros dentro del mismo negocio
create policy profile_empresa on profile
  for select using (
    exists (
      select 1
      from membresia m
      where m.usuario_id = profile.id
        and m.activa = true
        and m.empresa_id in (select empresas_del_usuario())
    )
  );
