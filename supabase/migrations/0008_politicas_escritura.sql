-- =====================================================================
--  Migración 0008 — Políticas INSERT/UPDATE para onboarding
--  Sin estas políticas, usuarios autenticados no pueden crear empresas
--  ni unirse a ellas (RLS deniega por defecto si no hay política).
-- =====================================================================

-- Empresa: cualquier usuario autenticado puede crear una empresa nueva
create policy empresa_insert on empresa
  for insert with check (auth.uid() is not null);

-- Empresa: un miembro puede actualizar su propia empresa (ej: activar modo real)
create policy empresa_update on empresa
  for update using (id in (select empresas_del_usuario()));

-- Membresía: el usuario puede insertar su propia membresía
-- (onboarding como dueño, o al unirse por código de invitación)
create policy membresia_insert on membresia
  for insert with check (usuario_id = auth.uid());
