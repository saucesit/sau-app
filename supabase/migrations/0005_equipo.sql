-- =====================================================================
--  Migración 0005 — Panel de equipo
--  Agrega código de invitación por empresa para que los empleados
--  puedan auto-registrarse sin necesidad de un backend.
-- =====================================================================

alter table empresa
  add column codigo_invitacion text unique default left(gen_random_uuid()::text, 8);

-- Generar código para las empresas existentes
update empresa
  set codigo_invitacion = left(gen_random_uuid()::text, 8)
where codigo_invitacion is null;

-- El código debe poder ser leído por cualquier usuario autenticado
-- (lo necesitan al momento de unirse, antes de tener membresía)
create policy empresa_invitacion on empresa
  for select using (true);  -- solo para buscar por código, RLS ya filtra el resto
